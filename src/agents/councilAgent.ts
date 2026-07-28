/**
 * Council — free multi-round agent conversation (no API key).
 *
 * Agents post on a blackboard, challenge gaps (e.g. missing $26.75 when
 * grand total is $76.67), hunt OCR for orphan amounts, and refine the parse.
 */
import type { AiId } from '../aiRoster'
import type { ReceiptLineItem } from '../types'
import { Blackboard } from './blackboard'
import { categorizeText } from './keywords'
import {
  dedupeItemsByAmount,
  extractFeeFromText,
  isFeeLineItem,
  isShippingLineItem,
  makeFeeLineItem,
  makeShippingLineItem,
  primaryCategoryFromItems,
  runLineItemsAgent,
} from './lineItemsAgent'
import { extractVendor } from './merchantAgent'
import { parseMoneyTokens, roundMoney } from './moneyParse'
import type { LocalAgentResult } from './pipeline'
import {
  applyUserMarksToResult,
  formatRejectionBrief,
  hasAnyWrongMark,
  lineMarkOf,
  shouldKeepMark,
  similarityToRejected,
  type RejectedScanSnapshot,
} from './retryFeedback'
import { runTotalsAgent } from './totalsAgent'

function nearlyEqual(a: number, b: number, tol = 0.08): boolean {
  return Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.02)
}

function allMoneyInText(text: string): number[] {
  return parseMoneyTokens(text)
    .filter((n) => n > 0 && n < 100000)
    .map((n) => roundMoney(n))
}

function contextAroundAmount(text: string, amount: number): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const needle = amount.toFixed(2)
  const alt = amount.toFixed(2).replace('.', ',')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle) || lines[i].includes(alt) || lines[i].includes(String(amount))) {
      const slice = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 2))
      return slice
        .filter((l) => l && !/^(subtotal|shipping|tax|grand total|payment)/i.test(l))
        .join(' ')
        .replace(/\$?\d+[.,]\d{2}/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 100)
    }
  }
  return ''
}

/**
 * Drop tax/total chrome mistaken as products.
 * Keep shipping AND convenience/service fees (own sections).
 */
function isChromeProductDesc(s: string): boolean {
  if (isShippingLineItem(s) || isFeeLineItem(s)) return false
  return /\b(tax|sales tax|subtotal|grand total|^total$|payment date|created date|payer)\b/i.test(s)
}

function productSum(items: ReceiptLineItem[]): number {
  return roundMoney(
    items
      .filter((i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description))
      .reduce((s, i) => s + i.amount, 0),
  )
}

function extractFee(text: string, force = false, banAmount?: number | null): number | null {
  return extractFeeFromText(text, { force, banAmount })?.amount ?? null
}

/**
 * Hunt for product amounts present in OCR but missing from current items.
 */
export function huntMissingItems(
  rawText: string,
  existing: ReceiptLineItem[],
  targets: { subtotal: number | null; total: number | null; shipping: number | null },
): ReceiptLineItem[] {
  const have = new Set(existing.map((i) => i.amount.toFixed(2)))
  const monies = allMoneyInText(rawText)
  const found: ReceiptLineItem[] = []

  // Preferred: amounts that help close subtotal gap (products only)
  const itemSum = productSum(existing)
  const need =
    targets.subtotal != null
      ? roundMoney(targets.subtotal - itemSum)
      : targets.total != null
        ? roundMoney(targets.total - itemSum - (targets.shipping ?? 0))
        : null

  const candidates = [...new Set(monies)].filter((m) => {
    if (have.has(m.toFixed(2))) return false
    if (targets.shipping != null && nearlyEqual(m, targets.shipping)) return false
    if (targets.total != null && nearlyEqual(m, targets.total)) return false
    if (targets.subtotal != null && nearlyEqual(m, targets.subtotal)) return false
    if (m < 0.5) return false
    return true
  })

  // Sort: prefer amount matching the gap
  candidates.sort((a, b) => {
    if (need != null) {
      const da = Math.abs(a - need)
      const db = Math.abs(b - need)
      if (da !== db) return da - db
    }
    return b - a
  })

  for (const amount of candidates) {
    const ctx = contextAroundAmount(rawText, amount)
    if (!ctx || ctx.length < 3) continue
    if (isChromeProductDesc(ctx) || isShippingLineItem(ctx) || isFeeLineItem(ctx)) continue
    // skip pure address-ish
    if (/\b(shipped to|pennsylvania|street|road|rd,|ave)\b/i.test(ctx) && !/filter|kit|ford|part/i.test(ctx)) {
      continue
    }
    const { categoryId } = categorizeText(ctx)
    found.push({
      id: `council-hunt-${amount}-${found.length}`,
      description: ctx || `Item $${amount.toFixed(2)}`,
      amount,
      categoryId,
    })
    // stop if we've closed the subtotal gap
    const newSum = roundMoney(itemSum + found.reduce((s, i) => s + i.amount, 0))
    if (targets.subtotal != null && nearlyEqual(newSum, targets.subtotal)) break
    if (found.length >= 4) break
  }

  return found
}

function extractShipping(text: string): number | null {
  for (const line of text.split(/\r?\n/)) {
    if (/\bshipping\b|\bfreight\b|\bdelivery\b/i.test(line)) {
      const amts = parseMoneyTokens(line)
      if (amts.length) return roundMoney(amts[amts.length - 1])
    }
  }
  return null
}

export type CouncilResult = LocalAgentResult & {
  councilLog: string
}

/**
 * Multi-round council over a draft parse + raw OCR.
 * When `rejected` is set (user pressed Try again), agents know that answer was wrong.
 */
export function runCouncilAgent(
  draft: LocalAgentResult,
  rawText: string,
  onTalk?: (msg: string, aiId?: AiId) => void,
  rejected?: RejectedScanSnapshot,
): CouncilResult {
  const board = new Blackboard()
  const talk = (from: AiId | 'system', kind: 'finding' | 'question' | 'answer' | 'challenge' | 'decision', text: string) => {
    board.post(from, kind, text)
    onTalk?.(`${from}: ${text}`, from === 'system' ? undefined : from)
  }

  let items = [...(draft.lineItems ?? [])]
  let amount = draft.amount
  let vendor = draft.vendor
  let subtotal = draft.subtotal ?? null
  let tax = draft.tax ?? null
  let shipping = extractShipping(rawText)
  // Prefer fee already on draft lines; fall back to OCR extract
  let fee: number | null =
    items.find((i) => isFeeLineItem(i.description))?.amount ?? extractFee(rawText)

  // --- Round 0: user rejection (Try again) / per-field marks ---
  if (rejected) {
    talk('system', 'challenge', formatRejectionBrief(rejected))
    const marks = rejected.marks
    const partial = hasAnyWrongMark(marks)

    talk(
      'arbiter',
      'challenge',
      partial
        ? `User marked specific parts wrong on attempt #${rejected.attempt}. Unmarked = keep. Fix only ✗.`
        : `User pressed Try again (#${rejected.attempt}). Treat the previous answer as untrusted — re-check OCR.`,
    )

    // Partial marks: seed with previous lines that were NOT marked wrong
    if (marks && partial) {
      const keepPrev = rejected.lineItems.filter((li) =>
        shouldKeepMark(lineMarkOf(li, marks), true),
      )
      const wrongLines = rejected.lineItems.filter((li) => lineMarkOf(li, marks) === 'wrong')
      // Start from kept previous lines
      items = keepPrev.map((li) => ({
        id: li.id || `kept-${li.amount}`,
        description: li.description,
        amount: li.amount,
        categoryId: (li.categoryId ?? 'misc') as import('../types').CategoryId,
      }))
      talk(
        'ledger',
        'decision',
        `Seeded ${items.length} kept line(s); banned ${wrongLines.length} wrong line(s).`,
      )
      if (shouldKeepMark(marks.total, true) && rejected.amount != null) {
        amount = rejected.amount
        talk('cashier', 'decision', `Keeping total $${amount.toFixed(2)} (unmarked/✓).`)
      } else if (marks.total === 'wrong') {
        talk('cashier', 'challenge', 'Total marked wrong — must not reuse previous total.')
        if (amount != null && rejected.amount != null && nearlyEqual(amount, rejected.amount)) {
          amount = null
        }
      }
      if (shouldKeepMark(marks.vendor, true) && rejected.vendor) {
        vendor = rejected.vendor
      } else if (marks.vendor === 'wrong') {
        talk('clerk', 'challenge', 'Vendor marked wrong — re-read store name from OCR.')
        vendor = ''
      }
      if (marks.shipping === 'wrong') {
        talk('clerk', 'challenge', 'Shipping marked wrong — re-read shipping from OCR.')
        shipping = extractShipping(rawText)
      }
      if (marks.fees === 'wrong') {
        talk(
          'clerk',
          'challenge',
          'Fees marked wrong — MUST fill Fees section (was empty or incorrect). Hunt convenience/service fee hard.',
        )
      }
      if (marks.category === 'wrong') {
        talk(
          'ledger',
          'challenge',
          `Category marked wrong (was ${rejected.categoryId || '—'}) — re-classify from vendor + OCR, not Misc by default.`,
        )
      }
      if (marks.missingItems === 'wrong') {
        talk('sieve', 'challenge', 'Product list incomplete — hunt for NEW items only.')
      }
      // Merge fresh OCR products that aren't banned wrong clones
      const freshLines = runLineItemsAgent(rawText)
      const wrongKeys = new Set(
        wrongLines.map(
          (w) =>
            `${w.description.toLowerCase().slice(0, 20)}|${roundMoney(w.amount).toFixed(2)}`,
        ),
      )
      for (const f of freshLines.items) {
        if (isFeeLineItem(f.description) || isShippingLineItem(f.description)) continue
        const k = `${f.description.toLowerCase().slice(0, 20)}|${roundMoney(f.amount).toFixed(2)}`
        if (wrongKeys.has(k)) continue
        const dup = items.find((i) => nearlyEqual(i.amount, f.amount))
        if (!dup) {
          items.push(f)
          talk('sieve', 'answer', `Added candidate line $${f.amount.toFixed(2)}: ${f.description.slice(0, 40)}`)
        }
      }
      if (freshLines.shipping != null && marks.shipping !== 'wrong' && shouldKeepMark(marks.shipping, true)) {
        // keep prior shipping if any
      } else if (marks.shipping === 'wrong' || (shipping == null && freshLines.shipping != null)) {
        shipping = freshLines.shipping ?? shipping
      }
      // Fees: when marked ✗, FORCE a re-hunt (including when previous section was empty).
      // Bugfix: old code skipped adding fees when marks.fees === 'wrong'.
      if (marks.fees === 'wrong') {
        const prevFeeAmt = rejected.lineItems.find((i) => isFeeLineItem(i.description))?.amount ?? null
        const forced =
          extractFee(rawText, true, prevFeeAmt) ??
          freshLines.fee ??
          extractFee(rawText, true, null)
        items = items.filter((i) => !isFeeLineItem(i.description))
        if (forced != null && forced > 0) {
          fee = forced
          items.push(makeFeeLineItem(forced))
          talk('clerk', 'answer', `Fees section filled after ✗ mark: $${forced.toFixed(2)}`)
        } else {
          talk('clerk', 'challenge', 'Still no fee amount found in OCR — user may need to type it.')
        }
      } else if (freshLines.fee != null) {
        const hasFee = items.some((i) => isFeeLineItem(i.description))
        if (!hasFee) {
          fee = freshLines.fee
          items.push(makeFeeLineItem(freshLines.fee))
          talk('clerk', 'answer', `Fees section: $${freshLines.fee.toFixed(2)}`)
        }
      }
      // Fresh totals only when total marked wrong
      if (marks.total === 'wrong') {
        const freshTotals = runTotalsAgent(rawText)
        if (freshTotals.total != null && (rejected.amount == null || !nearlyEqual(freshTotals.total, rejected.amount))) {
          amount = freshTotals.total
          talk('cashier', 'answer', `New total from OCR: $${amount.toFixed(2)}`)
        }
        if (freshTotals.subtotal != null) subtotal = freshTotals.subtotal
        if (freshTotals.tax != null) tax = freshTotals.tax
      }
    } else if (
      rejected.lineItems.length > 0 &&
      items.length > 0 &&
      similarityToRejected(
        { amount, vendor, description: draft.description, lineItems: items },
        rejected,
      ) >= 0.75
    ) {
      const before = items.length
      const kept = items.filter((i) => {
        if (isShippingLineItem(i.description)) return true
        const hit = rejected.lineItems.some(
          (r) =>
            nearlyEqual(r.amount, i.amount) &&
            r.description.toLowerCase().slice(0, 20) === i.description.toLowerCase().slice(0, 20),
        )
        return !hit
      })
      if (kept.filter((i) => !isShippingLineItem(i.description)).length === 0) {
        items = items.filter((i) => isShippingLineItem(i.description))
        talk(
          'ledger',
          'decision',
          `Cleared ${before - items.length} rejected product line(s) — hunting OCR fresh.`,
        )
      } else if (kept.length < before) {
        items = kept
        talk('ledger', 'decision', `Removed ${before - kept.length} line(s) that matched the rejected answer.`)
      }
      if (rejected.amount != null && amount != null && nearlyEqual(amount, rejected.amount)) {
        talk('cashier', 'challenge', `Rejected total $${rejected.amount.toFixed(2)} — re-evaluating grand total from OCR.`)
      }
    }

    // Full reject only: re-read everything. Partial marks already seeded above.
    if (!partial) {
      const freshTotals = runTotalsAgent(rawText)
      const freshLines = runLineItemsAgent(rawText)
      if (freshTotals.total != null) {
        if (rejected.amount == null || !nearlyEqual(freshTotals.total, rejected.amount) || amount == null) {
          if (amount == null || (rejected.amount != null && nearlyEqual(amount, rejected.amount))) {
            amount = freshTotals.total
            talk('cashier', 'answer', `Fresh total from OCR: $${amount.toFixed(2)}`)
          }
        }
        if (freshTotals.subtotal != null) subtotal = freshTotals.subtotal
        if (freshTotals.tax != null) tax = freshTotals.tax
      }
      const productCount = items.filter((i) => !isShippingLineItem(i.description)).length
      if (productCount === 0 && freshLines.items.length > 0) {
        items = [...freshLines.items]
        talk('ledger', 'answer', `Loaded ${items.length} line(s) from a fresh OCR pass.`)
      } else if (
        freshLines.items.length > 0 &&
        similarityToRejected(
          { amount, vendor, description: draft.description, lineItems: items },
          rejected,
        ) >= 0.8
      ) {
        const freshSim = similarityToRejected(
          {
            amount: freshTotals.total,
            vendor,
            description: freshLines.items.map((i) => i.description).join('; '),
            lineItems: freshLines.items,
          },
          rejected,
        )
        if (freshSim < 0.8) {
          items = [...freshLines.items]
          talk('ledger', 'answer', `Swapped in alternate OCR lines (less like the rejected answer).`)
        }
      }
    }
  }

  // --- Round 1: open statements ---
  talk('cashier', 'finding', amount != null ? `Grand total I read: $${amount.toFixed(2)}` : 'No grand total found')
  talk(
    'ledger',
    'finding',
    `I have ${items.filter((i) => !isShippingLineItem(i.description)).length} product line(s) summing to $${productSum(items).toFixed(2)}`,
  )
  if (shipping != null) {
    talk('clerk', 'finding', `Shipping: $${shipping.toFixed(2)} — keep as its own section`)
  }
  talk('clerk', 'finding', vendor ? `Vendor: ${vendor}` : 'Vendor unclear — scanning footer/domain…')

  // Fix vendor via shared OCR if garbage
  const betterVendor = extractVendor(rawText)
  if (betterVendor && (!vendor || vendor.length < 4 || /[\[\]{}|\\]/.test(vendor))) {
    talk('clerk', 'answer', `Updating vendor → ${betterVendor}`)
    vendor = betterVendor
  }

  // --- Round 2: Cashier challenges Ledger ---
  const itemSum = productSum(items)
  if (subtotal != null && !nearlyEqual(itemSum, subtotal)) {
    talk(
      'cashier',
      'challenge',
      `Subtotal is $${subtotal.toFixed(2)} but products only sum to $${itemSum.toFixed(2)}. Missing ~$${roundMoney(subtotal - itemSum).toFixed(2)} — Sieve/Ledger, hunt OCR.`,
    )
  } else if (amount != null && shipping != null && !nearlyEqual(itemSum + shipping, amount) && subtotal == null) {
    talk(
      'cashier',
      'challenge',
      `Total $${amount.toFixed(2)} ≠ products $${itemSum.toFixed(2)} + shipping $${shipping.toFixed(2)}. Hunt missing products.`,
    )
  } else if (amount != null && !nearlyEqual(itemSum, amount) && items.filter((i) => !isShippingLineItem(i.description)).length < 2) {
    talk(
      'cashier',
      'challenge',
      `Only ${items.filter((i) => !isShippingLineItem(i.description)).length} product line(s) for total $${amount.toFixed(2)}. Look harder for more items.`,
    )
  }

  // --- Round 3: Hunt missing amounts ---
  const hunted = huntMissingItems(
    rawText,
    items.filter((i) => !isShippingLineItem(i.description)),
    {
      subtotal,
      total: amount,
      shipping,
    },
  )
  if (hunted.length) {
    talk(
      'sieve',
      'answer',
      `Found ${hunted.length} missing product amount(s): ${hunted.map((h) => `$${h.amount.toFixed(2)} (${h.description.slice(0, 40)})`).join('; ')}`,
    )
    // merge
    for (const h of hunted) {
      const dup = items.find((i) => nearlyEqual(i.amount, h.amount) && !isShippingLineItem(i.description))
      if (!dup) items.push(h)
      else if (h.description.length > dup.description.length) {
        dup.description = h.description
        dup.categoryId = h.categoryId
      }
    }
  } else {
    talk('sieve', 'finding', 'No obvious missing product amounts in OCR after filters.')
  }

  // Drop tax/total chrome mistaken as products — keep shipping + fees
  const before = items.length
  items = items.filter((i) => !isChromeProductDesc(i.description))
  if (items.length < before) {
    talk('arbiter', 'decision', 'Removed tax/total chrome from line items (shipping + fees kept).')
  }

  // Ensure shipping has its own line when OCR had a price
  if (shipping != null && shipping > 0) {
    const hasShip = items.some(
      (i) => isShippingLineItem(i.description) && nearlyEqual(i.amount, shipping!),
    )
    if (!hasShip) {
      // remove any wrong shipping-ish rows with different amounts first
      items = items.filter((i) => !isShippingLineItem(i.description))
      items.push(makeShippingLineItem(shipping))
      talk('clerk', 'decision', `Added Shipping section: $${shipping.toFixed(2)}`)
    }
  }

  // Ensure fees section when OCR had a convenience/service fee
  if (fee != null && fee > 0) {
    const hasFee = items.some(
      (i) => isFeeLineItem(i.description) && nearlyEqual(i.amount, fee!),
    )
    if (!hasFee) {
      items = items.filter((i) => !isFeeLineItem(i.description))
      items.push(makeFeeLineItem(fee))
      talk('clerk', 'decision', `Added Fees section: $${fee.toFixed(2)}`)
    }
  }

  // Deduplicate inflated product merges — keep shipping + fees aside
  let shipRows = items.filter((i) => isShippingLineItem(i.description))
  let feeRows = items.filter((i) => isFeeLineItem(i.description))
  let productsOnly = items.filter(
    (i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description),
  )
  const sumBefore = productSum(items)
  if (subtotal != null && sumBefore > subtotal * 1.08) {
    talk(
      'arbiter',
      'challenge',
      `Product sum $${sumBefore.toFixed(2)} > subtotal $${subtotal.toFixed(2)} — collapsing duplicate amounts.`,
    )
    productsOnly = dedupeItemsByAmount(productsOnly, subtotal)
    talk(
      'arbiter',
      'decision',
      `After dedupe: ${productsOnly.length} product(s) + ${shipRows.length} shipping + ${feeRows.length} fee`,
    )
  } else if (amount != null && sumBefore > amount * 1.15) {
    talk('arbiter', 'challenge', `Product sum inflated vs total — deduping by amount.`)
    productsOnly = dedupeItemsByAmount(productsOnly, amount)
  } else {
    const deduped = dedupeItemsByAmount(productsOnly, subtotal)
    if (deduped.length < productsOnly.length) {
      talk(
        'arbiter',
        'decision',
        `Collapsed ${productsOnly.length - deduped.length} duplicate product row(s).`,
      )
      productsOnly = deduped
    }
  }
  // One shipping row max
  if (shipRows.length > 1) {
    const keep = shipRows.sort((a, b) => b.amount - a.amount)[0]
    shipRows = [makeShippingLineItem(keep.amount, keep.id)]
  }
  // One fee row max
  if (feeRows.length > 1) {
    const keep = feeRows.sort((a, b) => b.amount - a.amount)[0]
    feeRows = [makeFeeLineItem(keep.amount, keep.description, keep.id)]
  } else if (feeRows.length === 0 && fee != null && fee > 0) {
    feeRows = [makeFeeLineItem(fee)]
  }
  items = [...productsOnly, ...shipRows, ...feeRows]

  // Service-style invoice (subtotal + fee, little product catalog): rebuild from OCR words
  // Category is free-form invent (e.g. receipt says "towing" → group "Towing"), not a hardcoded preset.
  if (
    /\btow(ing)?\b|wrecker|roadside|flatbed/i.test(rawText) &&
    (subtotal != null || amount != null)
  ) {
    const towVendor = extractVendor(rawText)
    const serviceAmt =
      subtotal ?? (amount != null && shipping != null ? roundMoney(amount - shipping) : amount)
    if (serviceAmt != null) {
      const invented = categorizeText(
        `${towVendor} ${rawText.slice(0, 600)} towing service roadside`,
      )
      talk(
        'council',
        'answer',
        `Service invoice — category from receipt text → ${invented.label || invented.categoryId}. $${serviceAmt.toFixed(2)}.`,
      )
      const foundFee =
        fee ??
        extractFee(rawText, true) ??
        extractFeeFromText(rawText, { force: true })?.amount ??
        null
      items = [
        {
          id: 'council-tow-1',
          description: `${towVendor || 'Service'} — ${invented.label || 'service'}`,
          amount: serviceAmt,
          categoryId: invented.categoryId,
        },
      ]
      if (foundFee != null && foundFee > 0) {
        fee = foundFee
        items.push(makeFeeLineItem(foundFee, 'Convenience fee', 'council-tow-fee'))
      }
      vendor = towVendor || vendor
    }
  }

  // --- Round 4: Re-categorize materials (and towing lines) ---
  {
    const avoidCat =
      rejected?.marks?.category === 'wrong' ? rejected.categoryId ?? null : null
    items = items.map((i) => {
      if (isShippingLineItem(i.description)) {
        return { ...i, description: 'Shipping', categoryId: 'misc' as const }
      }
      if (isFeeLineItem(i.description)) {
        return { ...i, categoryId: 'misc' as const }
      }
      const blob = `${i.description} ${vendor} ${rawText.slice(0, 400)}`
      const { categoryId } = categorizeText(blob, { avoidId: avoidCat })
      if (categoryId !== i.categoryId) {
        talk('ledger', 'answer', `Recategorized “${i.description.slice(0, 36)}” → ${categoryId}`)
        return { ...i, categoryId }
      }
      return i
    })
  }

  // --- Round 5: Arithmetic agreement ---
  const finalProductSum = productSum(items)
  const finalSum = roundMoney(items.reduce((s, i) => s + i.amount, 0))
  const shipAmt =
    shipping ??
    items.find((i) => isShippingLineItem(i.description))?.amount ??
    null
  if (subtotal != null && nearlyEqual(finalProductSum, subtotal)) {
    talk('quorum', 'decision', `✓ Products $${finalProductSum.toFixed(2)} match subtotal.`)
  }
  const feeAmt =
    fee ?? items.find((i) => isFeeLineItem(i.description))?.amount ?? null
  if (
    amount != null &&
    shipAmt != null &&
    feeAmt != null &&
    nearlyEqual(finalProductSum + shipAmt + feeAmt, amount)
  ) {
    talk(
      'quorum',
      'decision',
      `✓ Products + shipping + fee = total $${amount.toFixed(2)}.`,
    )
  } else if (amount != null && shipAmt != null && nearlyEqual(finalProductSum + shipAmt, amount)) {
    talk(
      'quorum',
      'decision',
      `✓ Products $${finalProductSum.toFixed(2)} + shipping $${shipAmt.toFixed(2)} = total $${amount.toFixed(2)}.`,
    )
  } else if (
    amount != null &&
    feeAmt != null &&
    nearlyEqual(finalProductSum + feeAmt + (tax ?? 0), amount)
  ) {
    talk(
      'quorum',
      'decision',
      `✓ Products + fee (+ tax) ≈ total $${amount.toFixed(2)}.`,
    )
  } else if (amount != null && nearlyEqual(finalSum, amount)) {
    talk('quorum', 'decision', `✓ All lines (products + shipping + fees) = grand total $${amount.toFixed(2)}.`)
  } else {
    talk(
      'quorum',
      'finding',
      `Soft match: products $${finalProductSum.toFixed(2)}, all lines $${finalSum.toFixed(2)}, subtotal ${subtotal ?? '—'}, total ${amount ?? '—'}, shipping ${shipAmt ?? '—'}, fee ${feeAmt ?? '—'}.`,
    )
  }

  const description =
    items.length > 0
      ? items
          .map((i) => i.description)
          .slice(0, 8)
          .join('; ')
          .slice(0, 180)
      : draft.description

  let categoryId = items.length ? primaryCategoryFromItems(items) : draft.categoryId
  // Overall OCR text invents free-form groups (e.g. "towing" on the page → Towing)
  {
    const overall = categorizeText(
      `${vendor} ${draft.description} ${rawText.slice(0, 800)} ${items.map((i) => i.description).join(' ')}`,
      {
        avoidId:
          rejected?.marks?.category === 'wrong' ? rejected.categoryId ?? null : null,
      },
    )
    if (
      (overall.invented && overall.score >= 2 && overall.categoryId !== 'misc') ||
      (overall.score >= 4 && overall.categoryId !== 'misc') ||
      (rejected?.marks?.category === 'wrong' &&
        overall.categoryId !== rejected.categoryId &&
        overall.score > 0)
    ) {
      categoryId = overall.categoryId
      talk(
        'ledger',
        'decision',
        `Receipt-level category → ${overall.label || categoryId}${overall.invented ? ' (invented from text)' : ''}`,
      )
    }
  }
  // Respect category marked ✓ right
  if (rejected?.marks?.category === 'right' && rejected.categoryId) {
    categoryId = rejected.categoryId
  } else if (rejected?.marks?.category === 'wrong') {
    // Force off the banned category
    if (categoryId === rejected.categoryId || !categoryId) {
      const forced = categorizeText(
        `${vendor} ${rawText} ${items.map((i) => i.description).join(' ')}`,
        { avoidId: rejected.categoryId },
      )
      categoryId = forced.categoryId
      talk(
        'ledger',
        'decision',
        `Category was ✗ (${rejected.categoryId}) — switched to ${categoryId}`,
      )
    }
    // Stamp product lines with the corrected bucket (fees/shipping stay misc)
    items = items.map((i) =>
      isShippingLineItem(i.description) || isFeeLineItem(i.description)
        ? i
        : { ...i, categoryId },
    )
  }
  // Respect total / vendor marked ✓ right
  if (rejected?.marks?.total === 'right' && rejected.amount != null) {
    amount = rejected.amount
  }
  if (rejected?.marks?.vendor === 'right' && rejected.vendor) {
    vendor = rejected.vendor
  }
  // Final fee ensure when user said fees wrong
  if (rejected?.marks?.fees === 'wrong') {
    const hasFee = items.some((i) => isFeeLineItem(i.description))
    if (!hasFee) {
      const prevFee = rejected.lineItems.find((i) => isFeeLineItem(i.description))?.amount
      const forced = extractFee(rawText, true, prevFee ?? null)
      if (forced != null) {
        items.push(makeFeeLineItem(forced))
        fee = forced
        talk('clerk', 'decision', `Forced fee after marks: $${forced.toFixed(2)}`)
      }
    }
  }

  let confidence = draft.confidence ?? 0.5
  if (hunted.length) confidence = Math.min(0.96, confidence + 0.08)
  if (subtotal != null && nearlyEqual(finalProductSum, subtotal)) {
    confidence = Math.min(0.97, confidence + 0.06)
  }
  if (shipAmt != null) confidence = Math.min(0.97, confidence + 0.02)

  talk('quorum', 'decision', `Final: ${items.length} items, total $${(amount ?? finalSum).toFixed(2)}, vendor ${vendor || '—'}`)

  let result: CouncilResult = {
    ...draft,
    vendor,
    amount,
    description,
    categoryId,
    date: rejected?.marks?.date === 'right' && rejected.date ? rejected.date : draft.date,
    lineItems: items,
    subtotal,
    tax,
    notes: [
      draft.notes,
      `Council: ${items.length} items after debate`,
      shipping != null ? `ship $${shipping.toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    confidence,
    agentReport: [
      draft.agentReport,
      '—— Council debate (agents talking) ——',
      board.transcript(),
    ]
      .filter(Boolean)
      .join('\n'),
    aisUsed: Array.from(new Set([...(draft.aisUsed ?? []), 'council' as AiId, 'quorum', 'sieve', 'cashier', 'ledger', 'clerk', 'arbiter'])),
    activeAiLabel: 'Council (multi-agent debate)',
    councilLog: board.transcript(),
  }

  if (rejected?.marks) {
    result = {
      ...applyUserMarksToResult(result, rejected),
      councilLog: result.councilLog,
    }
  }
  return result
}
