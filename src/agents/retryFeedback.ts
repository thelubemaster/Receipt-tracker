/**
 * User rejected a scan (pressed Try again).
 * Free AIs use this so a retry does not blindly return the same answer.
 * Optional per-field marks (✓ right / ✗ wrong) focus the re-scan.
 */
import type { CategoryId, FieldSources, ReceiptLineItem } from '../types'
import type { LocalAgentResult } from './pipeline'
import { categorizeText } from './keywords'
import {
  extractFeeFromText,
  isFeeLineItem,
  isShippingLineItem,
  makeFeeLineItem,
} from './lineItemsAgent'
import { roundMoney } from './moneyParse'

/** User mark on a field or line item */
export type FieldMark = 'right' | 'wrong' | 'unset'

export type ScanPartMarks = {
  total: FieldMark
  vendor: FieldMark
  category: FieldMark
  date: FieldMark
  /** Product list incomplete / missing items */
  missingItems: FieldMark
  /** Shipping section overall */
  shipping: FieldMark
  /** Fees section (convenience / service / processing) */
  fees: FieldMark
  /** Per line-item id */
  lines: Record<string, FieldMark>
}

export function emptyPartMarks(): ScanPartMarks {
  return {
    total: 'unset',
    vendor: 'unset',
    category: 'unset',
    date: 'unset',
    missingItems: 'unset',
    shipping: 'unset',
    fees: 'unset',
    lines: {},
  }
}

export function hasAnyWrongMark(marks?: ScanPartMarks | null): boolean {
  if (!marks) return false
  if (
    marks.total === 'wrong' ||
    marks.vendor === 'wrong' ||
    marks.category === 'wrong' ||
    marks.date === 'wrong' ||
    marks.missingItems === 'wrong' ||
    marks.shipping === 'wrong' ||
    marks.fees === 'wrong'
  ) {
    return true
  }
  return Object.values(marks.lines).some((m) => m === 'wrong')
}

/**
 * When the user marked anything ✗, unmarked fields count as “leave it”
 * (implicitly correct). Explicit ✓ also keeps. Only ✗ is rewritten.
 */
export function shouldKeepMark(m: FieldMark | undefined, partialMode: boolean): boolean {
  if (m === 'wrong') return false
  if (m === 'right') return true
  // unset
  return partialMode
}

export function lineMarkOf(
  li: { id?: string; mark?: FieldMark },
  marks?: ScanPartMarks | null,
): FieldMark {
  if (li.mark && li.mark !== 'unset') return li.mark
  if (li.id && marks?.lines[li.id]) return marks.lines[li.id]
  return 'unset'
}

export function hasAnyRightMark(marks?: ScanPartMarks | null): boolean {
  if (!marks) return false
  if (
    marks.total === 'right' ||
    marks.vendor === 'right' ||
    marks.category === 'right' ||
    marks.date === 'right' ||
    marks.shipping === 'right'
  ) {
    return true
  }
  return Object.values(marks.lines).some((m) => m === 'right')
}

export type RejectedScanSnapshot = {
  amount: number | null
  vendor: string
  description: string
  categoryId?: CategoryId
  date?: string
  lineItems: Array<{
    id?: string
    description: string
    amount: number
    categoryId?: CategoryId
    mark?: FieldMark
  }>
  subtotal?: number | null
  tax?: number | null
  confidence?: number
  rawText?: string
  /** How many times the user has already rejected a result for this photo */
  attempt: number
  /** Optional free-text from the form (what looked wrong) */
  userNote?: string
  /** Per-section / per-line marks from the review form */
  marks?: ScanPartMarks
  /** Who produced the previous answer (so kept fields keep credit) */
  fieldSources?: FieldSources
}

export function snapshotFromSuggestion(input: {
  amount?: number | null
  vendor?: string
  description?: string
  categoryId?: CategoryId
  date?: string
  lineItems?: ReceiptLineItem[]
  subtotal?: number | null
  tax?: number | null
  confidence?: number
  rawText?: string
  attempt?: number
  userNote?: string
  marks?: ScanPartMarks
  fieldSources?: FieldSources
}): RejectedScanSnapshot {
  const marks = input.marks
  return {
    amount: input.amount ?? null,
    vendor: input.vendor ?? '',
    description: input.description ?? '',
    categoryId: input.categoryId,
    date: input.date,
    lineItems: (input.lineItems ?? []).map((li) => ({
      id: li.id,
      description: li.description,
      amount: li.amount,
      categoryId: li.categoryId,
      mark: marks?.lines[li.id] ?? 'unset',
    })),
    subtotal: input.subtotal ?? null,
    tax: input.tax ?? null,
    confidence: input.confidence,
    rawText: input.rawText,
    attempt: input.attempt ?? 1,
    userNote: input.userNote,
    marks,
    fieldSources: input.fieldSources,
  }
}

function nearly(a: number, b: number, tol = 0.05): boolean {
  return Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.01)
}

function amountSet(items: Array<{ amount: number }>): string {
  return items
    .map((i) => roundMoney(i.amount).toFixed(2))
    .sort()
    .join('|')
}

function descKey(d: string): string {
  return d
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 48)
}

/**
 * 0 = totally different, 1 = essentially the same answer the user already rejected.
 * When partial marks exist, only fields/lines marked ✗ count toward “same wrong answer”.
 */
export function similarityToRejected(
  result: Pick<LocalAgentResult, 'amount' | 'vendor' | 'description' | 'lineItems'> & {
    categoryId?: LocalAgentResult['categoryId']
    date?: LocalAgentResult['date']
  },
  rejected: RejectedScanSnapshot,
): number {
  const marks = rejected.marks
  const partial = hasAnyWrongMark(marks)

  // Full reject path (no field marks): classic overall similarity
  if (!partial || !marks) {
    let score = 0
    let weight = 0
    weight += 0.35
    if (result.amount != null && rejected.amount != null) {
      if (nearly(result.amount, rejected.amount)) score += 0.35
      else if (Math.abs(result.amount - rejected.amount) < rejected.amount * 0.05) score += 0.15
    }
    weight += 0.4
    const a = amountSet(result.lineItems ?? [])
    const b = amountSet(rejected.lineItems)
    if (a && b && a === b) score += 0.4
    else if (a && b) {
      const sa = new Set(a.split('|'))
      const sb = new Set(b.split('|'))
      let inter = 0
      for (const x of sa) if (sb.has(x)) inter++
      const union = new Set([...sa, ...sb]).size || 1
      score += 0.4 * (inter / union)
    }
    weight += 0.15
    const da = new Set((result.lineItems ?? []).map((i) => descKey(i.description)).filter(Boolean))
    const db = new Set(rejected.lineItems.map((i) => descKey(i.description)).filter(Boolean))
    if (da.size && db.size) {
      let inter = 0
      for (const x of da) if (db.has(x)) inter++
      score += 0.15 * (inter / Math.max(da.size, db.size))
    }
    weight += 0.1
    const va = (result.vendor || '').toLowerCase().trim()
    const vb = (rejected.vendor || '').toLowerCase().trim()
    if (va && vb && (va === vb || va.includes(vb) || vb.includes(va))) score += 0.1
    return Math.min(1, score / Math.max(0.5, weight) * weight)
  }

  // Partial: only penalize repeating ✗ fields
  let bad = 0
  let checks = 0
  if (marks.total === 'wrong') {
    checks++
    if (
      result.amount != null &&
      rejected.amount != null &&
      nearly(result.amount, rejected.amount)
    ) {
      bad++
    }
  }
  if (marks.vendor === 'wrong') {
    checks++
    const va = (result.vendor || '').toLowerCase().trim()
    const vb = (rejected.vendor || '').toLowerCase().trim()
    if (va && vb && (va === vb || va.includes(vb) || vb.includes(va))) bad++
  }
  if (marks.category === 'wrong') {
    checks++
    if (result.categoryId && rejected.categoryId && result.categoryId === rejected.categoryId) {
      bad++
    }
  }
  if (marks.date === 'wrong') {
    checks++
    if (result.date && rejected.date && result.date === rejected.date) bad++
  }

  const wrongLines = rejected.lineItems.filter(
    (li) => lineMarkOf(li, marks) === 'wrong',
  )
  for (const w of wrongLines) {
    checks++
    const hit = (result.lineItems ?? []).some(
      (i) =>
        nearly(i.amount, w.amount) &&
        (descKey(i.description) === descKey(w.description) ||
          descKey(i.description).includes(descKey(w.description).slice(0, 12)) ||
          descKey(w.description).includes(descKey(i.description).slice(0, 12))),
    )
    if (hit) bad++
  }

  if (marks.shipping === 'wrong') {
    checks++
    const prevShip = rejected.lineItems.find((i) => isShippingLineItem(i.description))
    if (prevShip) {
      const hit = (result.lineItems ?? []).some(
        (i) => isShippingLineItem(i.description) && nearly(i.amount, prevShip.amount),
      )
      if (hit) bad++
    }
  }

  if (marks.fees === 'wrong') {
    checks++
    const prevFees = rejected.lineItems.filter((i) => isFeeLineItem(i.description))
    const newFees = (result.lineItems ?? []).filter((i) => isFeeLineItem(i.description))
    if (prevFees.length === 0) {
      // User said fees wrong because section was EMPTY — still empty = same bad answer
      if (newFees.length === 0) bad++
    } else {
      // Still has the same wrong fee amount(s)
      const same = prevFees.every((p) =>
        newFees.some((n) => nearly(n.amount, p.amount)),
      )
      if (same && newFees.length > 0) bad++
    }
  }

  if (checks === 0) return 0
  return bad / checks
}

/** Human-readable brief for agent reports */
export function formatRejectionBrief(rejected: RejectedScanSnapshot): string {
  const marks = rejected.marks
  const wrongBits: string[] = []
  const keepBits: string[] = []
  const partial = hasAnyWrongMark(marks)

  if (marks) {
    if (marks.total === 'wrong') {
      wrongBits.push(
        `TOTAL wrong (was ${rejected.amount != null ? `$${rejected.amount.toFixed(2)}` : 'empty'}) — MUST change`,
      )
    } else if (shouldKeepMark(marks.total, partial) && rejected.amount != null) {
      keepBits.push(`TOTAL keep $${rejected.amount.toFixed(2)}`)
    }
    if (marks.vendor === 'wrong') {
      wrongBits.push(`VENDOR wrong (was “${rejected.vendor || '—'}”) — MUST change`)
    } else if (shouldKeepMark(marks.vendor, partial) && rejected.vendor) {
      keepBits.push(`VENDOR keep “${rejected.vendor}”`)
    }
    if (marks.category === 'wrong') {
      wrongBits.push(`CATEGORY wrong (was ${rejected.categoryId || '—'})`)
    } else if (shouldKeepMark(marks.category, partial) && rejected.categoryId) {
      keepBits.push(`CATEGORY keep ${rejected.categoryId}`)
    }
    if (marks.date === 'wrong') wrongBits.push('DATE wrong — MUST change')
    else if (shouldKeepMark(marks.date, partial) && rejected.date) {
      keepBits.push(`DATE keep ${rejected.date}`)
    }
    if (marks.missingItems === 'wrong') {
      wrongBits.push('PRODUCT LIST incomplete — hunt MISSING items; keep unmarked lines')
    }
    if (marks.shipping === 'wrong') {
      const ship = rejected.lineItems.find((i) => isShippingLineItem(i.description))
      wrongBits.push(
        `SHIPPING wrong${ship ? ` (was $${ship.amount.toFixed(2)})` : ''} — MUST change`,
      )
    } else if (shouldKeepMark(marks.shipping, partial)) {
      const ship = rejected.lineItems.find((i) => isShippingLineItem(i.description))
      if (ship) keepBits.push(`SHIPPING keep $${ship.amount.toFixed(2)}`)
    }
    if (marks.fees === 'wrong') {
      const prevFee = rejected.lineItems.find((i) => isFeeLineItem(i.description))
      wrongBits.push(
        prevFee
          ? `FEES wrong (was $${prevFee.amount.toFixed(2)}) — MUST change amount`
          : 'FEES wrong (section was EMPTY) — MUST find convenience/service fee from OCR',
      )
    }
    for (const li of rejected.lineItems) {
      const m = lineMarkOf(li, marks)
      const label = `${li.description.slice(0, 36)} $${li.amount.toFixed(2)}`
      if (m === 'wrong') wrongBits.push(`LINE WRONG (ban this): ${label}`)
      else if (shouldKeepMark(m, partial)) keepBits.push(`LINE KEEP: ${label}`)
    }
  }

  if (wrongBits.length || keepBits.length) {
    const note = rejected.userNote ? ` Note: ${rejected.userNote}` : ''
    return [
      `USER MARKED parts on attempt #${rejected.attempt}.`,
      wrongBits.length ? `FIX ONLY THESE (do not repeat): ${wrongBits.join(' · ')}` : null,
      keepBits.length
        ? `KEEP THESE (unmarked or ✓ — do not change): ${keepBits.join(' · ')}`
        : null,
      'Unmarked sections are treated as correct. Only rewrite ✗ parts.',
      note.trim() || null,
    ]
      .filter(Boolean)
      .join(' ')
  }

  const items =
    rejected.lineItems.length > 0
      ? rejected.lineItems
          .map((i) => `${i.description.slice(0, 40)} $${i.amount.toFixed(2)}`)
          .join('; ')
      : rejected.description || '(no items)'
  const total =
    rejected.amount != null ? `$${rejected.amount.toFixed(2)}` : 'unknown total'
  const note = rejected.userNote ? ` User note: ${rejected.userNote}` : ''
  return `USER REJECTED attempt #${rejected.attempt}: total ${total}, vendor “${rejected.vendor || '—'}”, lines: ${items}.${note} Do NOT return the same answer — find a better reading.`
}

/**
 * After a re-parse: keep unmarked/✓ fields from the previous answer,
 * ban ✗ lines, and force different values for ✗ totals/vendor when the
 * new parse still cloned them.
 */
export function applyUserMarksToResult(
  result: LocalAgentResult,
  rejected: RejectedScanSnapshot,
): LocalAgentResult {
  const marks = rejected.marks
  if (!marks) return result

  const partial = hasAnyWrongMark(marks)
  let amount = result.amount
  let vendor = result.vendor
  let categoryId = result.categoryId
  let date = result.date
  let items = [...(result.lineItems ?? [])]
  const notes: string[] = []

  // --- Scalar fields: keep unless marked wrong ---
  if (shouldKeepMark(marks.total, partial) && rejected.amount != null) {
    amount = rejected.amount
    notes.push('kept total (✓ or unmarked)')
  } else if (marks.total === 'wrong' && rejected.amount != null) {
    if (amount != null && nearly(amount, rejected.amount)) {
      // Still the same — try product+fee sum if different
      const sum = roundMoney(items.reduce((s, i) => s + i.amount, 0))
      if (sum > 0 && !nearly(sum, rejected.amount)) {
        amount = sum
        notes.push(`total was still wrong clone — used line sum $${sum.toFixed(2)}`)
      } else {
        notes.push('total still matched rejected; left for user to edit')
      }
    }
  }

  if (shouldKeepMark(marks.vendor, partial) && rejected.vendor) {
    vendor = rejected.vendor
    notes.push('kept vendor')
  } else if (marks.vendor === 'wrong' && rejected.vendor) {
    const va = (vendor || '').toLowerCase()
    const vb = rejected.vendor.toLowerCase()
    if (va && (va === vb || va.includes(vb) || vb.includes(va))) {
      vendor = ''
      notes.push('cleared vendor clone of rejected')
    }
  }

  if (shouldKeepMark(marks.category, partial) && rejected.categoryId) {
    categoryId = rejected.categoryId
    notes.push('kept category')
  } else if (marks.category === 'wrong') {
    const blob = [
      vendor,
      result.description,
      result.rawText?.slice(0, 900),
      items.map((i) => i.description).join(' '),
    ]
      .filter(Boolean)
      .join(' ')
    const next = categorizeText(blob, { avoidId: rejected.categoryId })
    if (next.categoryId && next.categoryId !== rejected.categoryId) {
      categoryId = next.categoryId
      notes.push(`category was ✗ (${rejected.categoryId}) → ${categoryId}`)
    } else if (/\btow|wrecker|roadside|flatbed/i.test(blob)) {
      categoryId = 'towing'
      notes.push('category was ✗ misc → towing (OCR/vendor signal)')
    } else if (categoryId === rejected.categoryId) {
      // still stuck — prefer non-misc invent
      categoryId = next.categoryId || 'misc'
      notes.push(`category forced off ${rejected.categoryId} → ${categoryId}`)
    }
  }
  if (shouldKeepMark(marks.date, partial) && rejected.date) {
    date = rejected.date
    notes.push('kept date')
  }

  // --- Lines: ban wrong; keep right + unmarked (in partial mode) ---
  const wrongLines = rejected.lineItems.filter((li) => lineMarkOf(li, marks) === 'wrong')
  const keepLines = rejected.lineItems.filter((li) =>
    shouldKeepMark(lineMarkOf(li, marks), partial),
  )

  const wrongKeys = new Set(
    wrongLines.map((li) => `${descKey(li.description)}|${roundMoney(li.amount).toFixed(2)}`),
  )
  const wrongAmounts = new Set(wrongLines.map((li) => roundMoney(li.amount).toFixed(2)))
  // Only ban amount alone if no kept line uses that amount
  for (const li of keepLines) {
    wrongAmounts.delete(roundMoney(li.amount).toFixed(2))
  }

  items = items.filter((li) => {
    const k = `${descKey(li.description)}|${roundMoney(li.amount).toFixed(2)}`
    if (wrongKeys.has(k)) return false
    // Drop reintroduced wrong amounts (same $ as banned line) when not kept elsewhere
    if (wrongAmounts.has(roundMoney(li.amount).toFixed(2))) {
      // allow if description clearly different product words
      const hitWrong = wrongLines.some(
        (w) =>
          nearly(w.amount, li.amount) &&
          (descKey(w.description) === descKey(li.description) ||
            descKey(li.description).includes(descKey(w.description).slice(0, 10))),
      )
      if (hitWrong) return false
    }
    return true
  })

  // Ensure keep lines present
  for (const li of keepLines) {
    const k = `${descKey(li.description)}|${roundMoney(li.amount).toFixed(2)}`
    const exists = items.some(
      (x) => `${descKey(x.description)}|${roundMoney(x.amount).toFixed(2)}` === k,
    )
    if (!exists) {
      items.push({
        id: li.id || `kept-${Math.random().toString(36).slice(2, 10)}`,
        description: li.description,
        amount: li.amount,
        categoryId: (li.categoryId ?? categoryId ?? 'misc') as CategoryId,
      })
    }
  }

  // Shipping section
  const prevShip = rejected.lineItems.find((i) => isShippingLineItem(i.description))
  if (shouldKeepMark(marks.shipping, partial) && prevShip) {
    items = items.filter((i) => !isShippingLineItem(i.description))
    items.push({
      id: prevShip.id || 'ship-kept',
      description: 'Shipping',
      amount: prevShip.amount,
      categoryId: 'misc',
    })
  } else if (marks.shipping === 'wrong' && prevShip) {
    items = items.filter(
      (i) => !(isShippingLineItem(i.description) && nearly(i.amount, prevShip.amount)),
    )
  }

  // Fees section (convenience / service)
  const prevFees = rejected.lineItems.filter((i) => isFeeLineItem(i.description))
  if (shouldKeepMark(marks.fees, partial) && prevFees.length) {
    items = items.filter((i) => !isFeeLineItem(i.description))
    for (const f of prevFees) {
      items.push({
        id: f.id || `fee-kept-${f.amount}`,
        description: f.description || 'Convenience fee',
        amount: f.amount,
        categoryId: 'misc',
      })
    }
  } else if (marks.fees === 'wrong') {
    // Drop previous wrong fee amounts
    for (const f of prevFees) {
      items = items.filter(
        (i) => !(isFeeLineItem(i.description) && nearly(i.amount, f.amount)),
      )
    }
    const hasFee = items.some((i) => isFeeLineItem(i.description))
    if (!hasFee) {
      // User said fees wrong — most often because the section was EMPTY.
      // Hunt OCR hard (and total−subtotal−tax) so we don't come back empty again.
      const ban = prevFees[0]?.amount ?? null
      const found =
        extractFeeFromText(result.rawText || rejected.rawText || '', {
          force: true,
          banAmount: ban,
        }) ||
        extractFeeFromText(result.rawText || rejected.rawText || '', { force: true })
      if (found) {
        items.push(makeFeeLineItem(found.amount, found.label))
        notes.push(`fees was ✗ — filled $${found.amount.toFixed(2)} from OCR`)
      } else if (
        rejected.amount != null &&
        rejected.subtotal != null &&
        rejected.amount > rejected.subtotal
      ) {
        const implied = roundMoney(
          rejected.amount - rejected.subtotal - (rejected.tax ?? 0),
        )
        if (implied > 0.2 && (ban == null || !nearly(implied, ban))) {
          items.push(makeFeeLineItem(implied))
          notes.push(`fees was ✗ — used total−subtotal−tax = $${implied.toFixed(2)}`)
        }
      } else {
        notes.push('fees was ✗ but OCR still has no fee amount — type it in Fees')
      }
    }
  }

  // After category fix, stamp non-fee product lines when category was ✗
  if (marks.category === 'wrong' && categoryId) {
    items = items.map((i) =>
      isShippingLineItem(i.description) || isFeeLineItem(i.description)
        ? i
        : { ...i, categoryId },
    )
  }

  // If missing items marked wrong, prefer keeping previous products + any NEW amounts from parse
  if (marks.missingItems === 'wrong') {
    notes.push('missing-items mode: kept unmarked lines, accepted new non-banned lines')
  }

  const description =
    items.length > 0
      ? items
          .map((i) => i.description)
          .slice(0, 8)
          .join('; ')
          .slice(0, 160)
      : result.description

  // Merge field attribution: kept fields credit previous AI; new ones credit rescan AIs
  const prevSrc = rejected.fieldSources ?? {}
  const nextSrc = result.fieldSources ?? {}
  const lineSources: NonNullable<FieldSources['lines']> = { ...(nextSrc.lines ?? {}) }
  for (const li of keepLines) {
    if (li.id && prevSrc.lines?.[li.id]) lineSources[li.id] = prevSrc.lines[li.id]
  }
  for (const li of items) {
    if (!lineSources[li.id]) {
      if (isShippingLineItem(li.description)) lineSources[li.id] = nextSrc.shipping ?? prevSrc.shipping ?? 'ledger'
      else if (isFeeLineItem(li.description)) lineSources[li.id] = nextSrc.fees ?? prevSrc.fees ?? 'ledger'
      else lineSources[li.id] = nextSrc.lines?.[li.id] ?? 'sieve'
    }
  }

  const fieldSources: FieldSources = {
    ocr: nextSrc.ocr ?? prevSrc.ocr,
    total: shouldKeepMark(marks.total, partial) ? prevSrc.total ?? nextSrc.total : nextSrc.total ?? 'cashier',
    vendor: shouldKeepMark(marks.vendor, partial)
      ? prevSrc.vendor ?? nextSrc.vendor
      : nextSrc.vendor ?? 'clerk',
    category: shouldKeepMark(marks.category, partial)
      ? prevSrc.category ?? nextSrc.category
      : nextSrc.category ?? 'ledger',
    date: shouldKeepMark(marks.date, partial) ? prevSrc.date ?? nextSrc.date : nextSrc.date ?? 'clerk',
    shipping: shouldKeepMark(marks.shipping, partial)
      ? prevSrc.shipping ?? nextSrc.shipping
      : nextSrc.shipping ?? 'ledger',
    fees: shouldKeepMark(marks.fees, partial) ? prevSrc.fees ?? nextSrc.fees : nextSrc.fees ?? 'ledger',
    lines: lineSources,
    primary: nextSrc.primary ?? prevSrc.primary ?? nextSrc.ocr ?? 'quorum',
    answerLabel: undefined,
  }
  fieldSources.answerLabel = buildAnswerLabel(fieldSources, result.aisUsed)

  return {
    ...result,
    amount,
    vendor,
    categoryId,
    date,
    lineItems: items,
    description,
    fieldSources,
    activeAiLabel: fieldSources.answerLabel || result.activeAiLabel,
    agentReport: [
      result.agentReport,
      'Applied user marks: unmarked = keep; ✗ banned from repeating.',
      fieldSources.answerLabel ? `Answer credit: ${fieldSources.answerLabel}` : null,
      ...notes,
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

/** Human-readable “who answered” line from field sources + team list */
export function buildAnswerLabel(
  sources: FieldSources | undefined,
  aisUsed?: string[],
): string {
  if (sources?.answerLabel) return sources.answerLabel
  const bits: string[] = []
  if (sources?.primary) bits.push(sources.primary)
  if (sources?.ocr && sources.ocr !== sources.primary) bits.push(`OCR:${sources.ocr}`)
  if (sources?.total && !bits.includes(sources.total)) bits.push(`total:${sources.total}`)
  if (sources?.vendor && !bits.includes(sources.vendor)) bits.push(`vendor:${sources.vendor}`)
  if (bits.length) return bits.join(' · ')
  if (aisUsed?.length) return aisUsed.slice(0, 6).join(', ')
  return 'On-device team'
}

/**
 * Pick the best parse that is not a near-clone of the rejected answer.
 * Falls back to least-similar among decent candidates.
 */
export function pickDiversifiedParse(
  candidates: LocalAgentResult[],
  rejected: RejectedScanSnapshot | undefined,
  baseScore: (c: LocalAgentResult) => number,
): { winner: LocalAgentResult; report: string } {
  if (!candidates.length) {
    throw new Error('No parse candidates')
  }
  if (!rejected) {
    let best = candidates[0]
    let bestS = baseScore(best)
    for (let i = 1; i < candidates.length; i++) {
      const s = baseScore(candidates[i])
      if (s > bestS) {
        best = candidates[i]
        bestS = s
      }
    }
    return { winner: best, report: `Picked best parse (score ${bestS.toFixed(1)})` }
  }

  const scored = candidates.map((c, i) => {
    const quality = baseScore(c)
    const sim = similarityToRejected(c, rejected)
    // Heavy penalty for cloning the rejected answer
    const penalty = sim * (45 + rejected.attempt * 10)
    return { c, i, quality, sim, adjusted: quality - penalty }
  })
  scored.sort((a, b) => b.adjusted - a.adjusted || b.quality - a.quality)

  // Prefer adjusted winner if not almost identical; else least-similar with ok quality
  let pick = scored[0]
  if (pick.sim >= 0.85) {
    const alt = scored
      .filter((s) => s.sim < 0.75 && s.quality >= pick.quality * 0.55)
      .sort((a, b) => b.adjusted - a.adjusted)[0]
    if (alt) pick = alt
    else {
      // take lowest similarity
      const least = [...scored].sort((a, b) => a.sim - b.sim || b.quality - a.quality)[0]
      if (least.sim < pick.sim) pick = least
    }
  }

  const report = [
    formatRejectionBrief(rejected),
    `Diversified pick: candidate #${pick.i + 1} quality ${pick.quality.toFixed(1)}, similarity-to-rejected ${(pick.sim * 100).toFixed(0)}%, adjusted ${pick.adjusted.toFixed(1)}`,
    `Other candidates: ${scored
      .slice(0, 4)
      .map(
        (s) =>
          `#${s.i + 1} q=${s.quality.toFixed(0)} sim=${(s.sim * 100).toFixed(0)}% adj=${s.adjusted.toFixed(0)}`,
      )
      .join(' · ')}`,
  ].join('\n')

  return { winner: pick.c, report }
}

/**
 * Mild image transforms so OCR on retry is not bit-identical.
 * attempt 1 = stronger contrast, 2 = slight scale+sharpen feel, 3 = invert-ish soft
 */
export async function diversifyImageForRetry(
  blob: Blob,
  attempt: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const maxEdge = 1900
    const base = Math.min(1.15 + attempt * 0.08, maxEdge / Math.max(bitmap.width, bitmap.height, 1))
    // tiny rotation alternate so layout bands shift a bit
    const rotDeg = attempt % 2 === 0 ? 0.4 : -0.35
    const rot = (rotDeg * Math.PI) / 180
    const w0 = Math.max(1, Math.round(bitmap.width * base))
    const h0 = Math.max(1, Math.round(bitmap.height * base))
    const pad = Math.ceil(Math.max(w0, h0) * 0.02)
    const w = w0 + pad * 2
    const h = h0 + pad * 2
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.translate(w / 2, h / 2)
    ctx.rotate(rot)
    ctx.drawImage(bitmap, -w0 / 2, -h0 / 2, w0, h0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    const imageData = ctx.getImageData(0, 0, w, h)
    const d = imageData.data
    const mode = attempt % 3
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      if (mode === 0) {
        g = Math.min(255, Math.max(0, (g - 128) * 1.55 + 128))
      } else if (mode === 1) {
        g = g > 145 ? 255 : g < 110 ? 0 : (g - 110) * (255 / 35)
      } else {
        const boosted = Math.min(255, Math.max(0, (g - 120) * 1.35 + 120))
        g = 255 - boosted * 0.15 + boosted * 0.85 // soft punch
      }
      d[i] = d[i + 1] = d[i + 2] = g
    }
    ctx.putImageData(imageData, 0, 0)

    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.92)
    })
  } finally {
    bitmap.close()
  }
}
