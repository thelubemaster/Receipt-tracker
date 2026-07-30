/**
 * Consistency / consensus pass — free, on-device.
 *
 * After the multi-agent team produces a draft (and possibly several OCR→parse
 * paths), this layer makes results more stable by:
 * 1) Voting totals across parse paths + OCR money lines
 * 2) Voting vendor / date when paths agree
 * 3) Arithmetic reconciliation (subtotal + tax + fee + shipping ≈ total)
 * 4) Dropping clear duplicate product lines that break the total
 * 5) Boosting confidence when ≥2 independent paths agree
 *
 * No network. No API keys.
 */
import type { CategoryId, ReceiptLineItem } from '../types'
import {
  isFeeLineItem,
  isShippingLineItem,
  makeFeeLineItem,
  primaryCategoryFromItems,
} from './lineItemsAgent'
import { parseMoneyTokens, roundMoney } from './moneyParse'
import { normalizeOcrText } from './normalizeOcrText'
import type { LocalAgentResult } from './pipeline'
import { runTotalsAgent } from './totalsAgent'

function nearly(a: number, b: number, tol = 0.08): boolean {
  return Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.015)
}

function normVendor(v: string | null | undefined): string {
  return (v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 48)
}

function productLines(items: ReceiptLineItem[]): ReceiptLineItem[] {
  return items.filter((i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description))
}

function productSum(items: ReceiptLineItem[]): number {
  return roundMoney(productLines(items).reduce((s, i) => s + i.amount, 0))
}

function feeAmount(items: ReceiptLineItem[]): number {
  return roundMoney(
    items.filter((i) => isFeeLineItem(i.description)).reduce((s, i) => s + i.amount, 0),
  )
}

function shipAmount(items: ReceiptLineItem[]): number {
  return roundMoney(
    items.filter((i) => isShippingLineItem(i.description)).reduce((s, i) => s + i.amount, 0),
  )
}

/** Cluster money values that are within 2¢ (or 1.5%) into vote buckets. */
export function clusterMoneyVotes(
  amounts: number[],
  weights?: number[],
): { value: number; weight: number; count: number }[] {
  const buckets: { value: number; weight: number; count: number }[] = []
  amounts.forEach((raw, i) => {
    if (!Number.isFinite(raw) || raw <= 0) return
    const a = roundMoney(raw)
    const w = weights?.[i] ?? 1
    const hit = buckets.find((b) => nearly(b.value, a, 0.03))
    if (hit) {
      hit.weight += w
      hit.count += 1
      // Keep the more "round" / common representation
      if (Math.abs(a - Math.round(a * 100) / 100) < 1e-9) hit.value = a
    } else {
      buckets.push({ value: a, weight: w, count: 1 })
    }
  })
  return buckets.sort((a, b) => b.weight - a.weight || b.count - a.count)
}

/**
 * Money lines that look like grand totals in OCR (not unit prices mid-list).
 */
export function extractTotalCandidatesFromOcr(text: string): number[] {
  const t = normalizeOcrText(text)
  const totals = runTotalsAgent(t)
  const out: number[] = []
  if (totals.total != null) out.push(totals.total)
  // Also harvest explicit TOTAL / AMOUNT DUE lines
  for (const line of t.split(/\n/)) {
    if (
      /\b(grand\s+)?total\b|\bamount\s+due\b|\bbalance\s+due\b|\bcard\s+(total|charge)\b/i.test(
        line,
      ) &&
      !/\bsub\s*total\b/i.test(line)
    ) {
      const monies = parseMoneyTokens(line)
      if (monies.length) out.push(monies[monies.length - 1])
    }
  }
  return out
}

/**
 * Prefer a total that is supported by math and/or multi-path agreement.
 */
export function pickConsensusTotal(input: {
  draftTotal: number | null
  draftSubtotal: number | null
  draftTax: number | null
  items: ReceiptLineItem[]
  pathTotals: number[]
  ocrTotals: number[]
}): { total: number | null; reason: string; agreement: number } {
  const { draftTotal, draftSubtotal, draftTax, items, pathTotals, ocrTotals } = input
  const pSum = productSum(items)
  const fee = feeAmount(items)
  const ship = shipAmount(items)
  const tax = draftTax ?? 0

  const mathCandidates: { value: number; weight: number; label: string }[] = []
  if (pSum > 0) {
    const withExtras = roundMoney(pSum + fee + ship + tax)
    mathCandidates.push({ value: withExtras, weight: 6, label: 'products+fee+ship+tax' })
    if (fee || ship) {
      mathCandidates.push({
        value: roundMoney(pSum + fee + ship),
        weight: 4,
        label: 'products+fee+ship',
      })
    }
  }
  if (draftSubtotal != null && draftTax != null) {
    mathCandidates.push({
      value: roundMoney(draftSubtotal + draftTax + fee + ship),
      weight: 7,
      label: 'subtotal+tax+fee+ship',
    })
  }

  const allValues: number[] = []
  const allWeights: number[] = []
  for (const t of pathTotals) {
    allValues.push(t)
    allWeights.push(5)
  }
  for (const t of ocrTotals) {
    allValues.push(t)
    allWeights.push(3)
  }
  if (draftTotal != null) {
    allValues.push(draftTotal)
    allWeights.push(4)
  }
  for (const m of mathCandidates) {
    allValues.push(m.value)
    allWeights.push(m.weight)
  }

  const clusters = clusterMoneyVotes(allValues, allWeights)
  if (!clusters.length) return { total: draftTotal, reason: 'no votes', agreement: 0 }

  // Prefer clusters that also match arithmetic
  let best = clusters[0]
  let bestScore = best.weight
  let bestReason = `vote $${best.value.toFixed(2)} (w=${best.weight.toFixed(1)}, n=${best.count})`

  for (const c of clusters.slice(0, 5)) {
    let score = c.weight
    let why = `vote w=${c.weight.toFixed(1)} n=${c.count}`
    for (const m of mathCandidates) {
      if (nearly(m.value, c.value, 0.12)) {
        score += m.weight + 3
        why += ` + ${m.label}`
      }
    }
    // Slight preference for draft if tied
    if (draftTotal != null && nearly(c.value, draftTotal, 0.05)) {
      score += 1.5
      why += ' + draft'
    }
    if (score > bestScore) {
      bestScore = score
      best = c
      bestReason = `$${c.value.toFixed(2)} (${why})`
    }
  }

  return {
    total: best.value,
    reason: bestReason,
    agreement: best.count,
  }
}

/**
 * Drop obvious duplicate product rows when sum overshoots total badly.
 * Keeps the first occurrence of each (amount + rough name).
 */
export function dedupeProductsAgainstTotal(
  items: ReceiptLineItem[],
  total: number | null,
): { items: ReceiptLineItem[]; removed: number } {
  const products = productLines(items)
  const specials = items.filter(
    (i) => isShippingLineItem(i.description) || isFeeLineItem(i.description),
  )
  if (!products.length) return { items, removed: 0 }

  const seen = new Set<string>()
  const kept: ReceiptLineItem[] = []
  let removed = 0
  for (const p of products) {
    const key = `${roundMoney(p.amount)}|${p.description.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24)}`
    if (seen.has(key)) {
      removed++
      continue
    }
    seen.add(key)
    kept.push(p)
  }

  // If still overshooting total, drop the smallest products until under (rare OCR ghosts)
  if (total != null && total > 0) {
    let sum = productSum(kept) + feeAmount(specials) + shipAmount(specials)
    if (sum > total * 1.15 + 0.5) {
      const sorted = [...kept].sort((a, b) => a.amount - b.amount)
      while (sorted.length > 1 && sum > total * 1.08 + 0.25) {
        const drop = sorted.shift()!
        const idx = kept.findIndex((k) => k.id === drop.id)
        if (idx >= 0) {
          kept.splice(idx, 1)
          removed++
          sum = productSum(kept) + feeAmount(specials) + shipAmount(specials)
        } else break
      }
    }
  }

  return { items: [...kept, ...specials], removed }
}

export function runConsensusPass(
  draft: LocalAgentResult,
  pathParses: LocalAgentResult[],
  rawText: string,
): LocalAgentResult {
  const text = normalizeOcrText(rawText || draft.rawText || '')
  const notes: string[] = []
  let items = [...(draft.lineItems ?? [])]
  let amount = draft.amount
  let vendor = draft.vendor
  let date = draft.date
  let categoryId = draft.categoryId
  let subtotal = draft.subtotal ?? null
  let tax = draft.tax ?? null
  let confidence = draft.confidence ?? 0.4

  const paths = pathParses.length ? pathParses : [draft]
  const pathTotals = paths.map((p) => p.amount).filter((n): n is number => n != null && n > 0)
  const ocrTotals = extractTotalCandidatesFromOcr(text)

  // Re-read totals from OCR for subtotal/tax if missing
  const totals = runTotalsAgent(text)
  if (subtotal == null && totals.subtotal != null) subtotal = totals.subtotal
  if (tax == null && totals.tax != null) tax = totals.tax

  const consensus = pickConsensusTotal({
    draftTotal: amount,
    draftSubtotal: subtotal,
    draftTax: tax,
    items,
    pathTotals,
    ocrTotals: [...ocrTotals, ...(totals.total != null ? [totals.total] : [])],
  })

  if (consensus.total != null) {
    if (amount == null || !nearly(amount, consensus.total, 0.05)) {
      notes.push(
        `Consensus total → $${consensus.total.toFixed(2)} (${consensus.reason}${
          amount != null ? `; was $${amount.toFixed(2)}` : ''
        })`,
      )
      amount = consensus.total
    } else if (consensus.agreement >= 2) {
      notes.push(`Consensus: ${consensus.agreement} paths agree on $${amount.toFixed(2)}`)
    }
    if (consensus.agreement >= 2) confidence = Math.min(0.97, confidence + 0.1)
    else if (consensus.agreement >= 1) confidence = Math.min(0.94, confidence + 0.04)
  }

  // Vendor vote
  const vendorVotes = new Map<string, { display: string; w: number }>()
  for (const p of paths) {
    const n = normVendor(p.vendor)
    if (n.length < 2) continue
    const cur = vendorVotes.get(n) || { display: p.vendor || n, w: 0 }
    cur.w += 1
    if ((p.vendor || '').length > cur.display.length) cur.display = p.vendor || cur.display
    vendorVotes.set(n, cur)
  }
  if (vendorVotes.size) {
    const ranked = [...vendorVotes.entries()].sort((a, b) => b[1].w - a[1].w)
    const [topKey, top] = ranked[0]
    if (top.w >= 2 || !normVendor(vendor) || normVendor(vendor).length < 3) {
      if (normVendor(vendor) !== topKey) {
        notes.push(`Consensus vendor → ${top.display} (${top.w} paths)`)
        vendor = top.display
        confidence = Math.min(0.96, confidence + 0.03)
      }
    }
  }

  // Date vote
  const dates = paths.map((p) => p.date).filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d))
  if (dates.length) {
    const freq = new Map<string, number>()
    for (const d of dates) freq.set(d, (freq.get(d) || 0) + 1)
    const bestDate = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]
    if (bestDate && (bestDate[1] >= 2 || !date)) {
      if (date !== bestDate[0]) {
        date = bestDate[0]
        notes.push(`Consensus date → ${date}`)
      }
    }
  }

  // Dedupe products that blow past total
  const deduped = dedupeProductsAgainstTotal(items, amount)
  if (deduped.removed > 0) {
    items = deduped.items
    notes.push(`Consensus: removed ${deduped.removed} duplicate/ghost product line(s)`)
  }

  // If fee missing but total − (products + tax + ship) is a small positive → invent fee
  const pSum = productSum(items)
  const ship = shipAmount(items)
  let fee = feeAmount(items)
  if (amount != null && fee <= 0) {
    const implied = roundMoney(amount - pSum - (tax ?? 0) - ship)
    if (implied >= 0.3 && implied <= Math.max(25, amount * 0.12)) {
      // Only if OCR mentions fee-ish words OR residual is tiny convenience fee range
      if (/\b(fee|convenience|service|surcharge|processing)\b/i.test(text) || implied <= 5) {
        items = [...items, makeFeeLineItem(implied)]
        fee = implied
        notes.push(`Consensus: residual fee $${implied.toFixed(2)} (total − products − tax − ship)`)
      }
    }
  }

  // Math confidence
  if (amount != null) {
    const rebuilt = roundMoney(pSum + feeAmount(items) + shipAmount(items) + (tax ?? 0))
    if (nearly(rebuilt, amount, 0.15)) {
      confidence = Math.min(0.98, confidence + 0.08)
      notes.push('Consensus: products + fee + ship + tax ≈ total')
    } else if (subtotal != null && nearly(pSum, subtotal, 0.15)) {
      confidence = Math.min(0.95, confidence + 0.04)
    }
  }

  // Category: prefer non-misc majority from paths / line items
  const catVotes = new Map<string, number>()
  for (const p of paths) {
    if (p.categoryId && p.categoryId !== 'misc') {
      catVotes.set(p.categoryId, (catVotes.get(p.categoryId) || 0) + 1)
    }
  }
  if (catVotes.size) {
    const topCat = [...catVotes.entries()].sort((a, b) => b[1] - a[1])[0]
    if (topCat[1] >= 2 && (categoryId === 'misc' || !categoryId)) {
      categoryId = topCat[0] as CategoryId
      notes.push(`Consensus category → ${categoryId}`)
    }
  }
  if (items.length && (categoryId === 'misc' || !categoryId)) {
    const primary = primaryCategoryFromItems(items)
    if (primary !== 'misc') categoryId = primary
  }

  const description =
    items.length > 0
      ? items
          .map((i) => i.description)
          .slice(0, 8)
          .join('; ')
          .slice(0, 180)
      : draft.description

  // Penalize low agreement / empty parse
  if (paths.length >= 2 && consensus.agreement < 2 && (confidence ?? 0) > 0.55) {
    confidence = Math.max(0.35, confidence - 0.08)
    notes.push('Consensus: OCR paths disagreed — confidence tempered')
  }

  return {
    ...draft,
    amount,
    vendor,
    date,
    categoryId: (categoryId || 'misc') as CategoryId,
    subtotal,
    tax,
    lineItems: items,
    description,
    confidence,
    rawText: text || draft.rawText,
    agentReport: [
      draft.agentReport,
      notes.length
        ? `CONSENSUS PASS (stable results):\n- ${notes.join('\n- ')}`
        : 'CONSENSUS PASS: draft already stable',
    ]
      .filter(Boolean)
      .join('\n'),
    fieldSources: {
      ...(draft.fieldSources ?? {}),
      primary: draft.fieldSources?.primary ?? 'quorum',
      total: draft.fieldSources?.total ?? 'cashier',
    },
    aisUsed: Array.from(new Set([...(draft.aisUsed ?? []), 'quorum' as const])),
  }
}
