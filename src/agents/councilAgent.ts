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
  isShippingLineItem,
  makeShippingLineItem,
  primaryCategoryFromItems,
  runLineItemsAgent,
} from './lineItemsAgent'
import { extractVendor } from './merchantAgent'
import { parseMoneyTokens, roundMoney } from './moneyParse'
import type { LocalAgentResult } from './pipeline'
import {
  formatRejectionBrief,
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

/** Drop tax/total chrome — but keep shipping as a real tracked line. */
function isNonShippingFeeDesc(s: string): boolean {
  if (isShippingLineItem(s)) return false
  return /\b(tax|subtotal|grand total|^total$|handling|convenience fee|service fee|payment date|created date|payer)\b/i.test(
    s,
  )
}

function productSum(items: ReceiptLineItem[]): number {
  return roundMoney(
    items.filter((i) => !isShippingLineItem(i.description)).reduce((s, i) => s + i.amount, 0),
  )
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
    if (isNonShippingFeeDesc(ctx) || isShippingLineItem(ctx)) continue
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

  // --- Round 0: user rejection (Try again) ---
  if (rejected) {
    talk('system', 'challenge', formatRejectionBrief(rejected))
    talk(
      'arbiter',
      'challenge',
      `User pressed Try again (#${rejected.attempt}). Treat the previous total/items as untrusted — re-check OCR for a different split.`,
    )
    // Drop line items that exactly match the rejected set (same amounts) so hunt can rebuild
    const rejectedAmounts = new Set(
      rejected.lineItems.map((i) => roundMoney(i.amount).toFixed(2)),
    )
    if (
      rejected.lineItems.length > 0 &&
      items.length > 0 &&
      similarityToRejected(
        { amount, vendor, description: draft.description, lineItems: items },
        rejected,
      ) >= 0.75
    ) {
      const before = items.length
      // Keep shipping; clear product clones of the rejected answer
      const kept = items.filter((i) => {
        if (isShippingLineItem(i.description)) return true
        // drop if this amount+desc pair was in the rejected answer
        const hit = rejected.lineItems.some(
          (r) =>
            nearlyEqual(r.amount, i.amount) &&
            r.description.toLowerCase().slice(0, 20) === i.description.toLowerCase().slice(0, 20),
        )
        return !hit
      })
      // If we wiped almost everything, clear products and re-hunt
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
      // If total matched rejected total, distrust it and re-read from totals agent via OCR later
      if (rejected.amount != null && amount != null && nearlyEqual(amount, rejected.amount)) {
        talk('cashier', 'challenge', `Rejected total $${rejected.amount.toFixed(2)} — re-evaluating grand total from OCR.`)
      }
    }
    void rejectedAmounts

    // Re-read totals + line items fresh from OCR (ignore draft clones of rejected)
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
    // If products were cleared or still look like the rejected set, adopt fresh OCR lines
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
      // Prefer fresh if it differs from rejected more than current draft
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

  // Drop tax/total chrome mistaken as products — keep shipping
  const before = items.length
  items = items.filter((i) => !isNonShippingFeeDesc(i.description))
  if (items.length < before) {
    talk('arbiter', 'decision', 'Removed tax/fee chrome from line items (shipping kept).')
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

  // Deduplicate inflated product merges (same $39.97 three times, etc.) — keep shipping aside
  let shipRows = items.filter((i) => isShippingLineItem(i.description))
  let productsOnly = items.filter((i) => !isShippingLineItem(i.description))
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
      `After dedupe: ${productsOnly.length} product(s) + ${shipRows.length} shipping`,
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
  items = [...productsOnly, ...shipRows]

  // Towing / service invoice: rebuild as a service line (category: misc = services/labor)
  if (/\btow(ing)?\b/i.test(rawText)) {
    const towVendor = extractVendor(rawText)
    if (subtotal != null || amount != null) {
      const serviceAmt =
        subtotal ?? (amount != null && shipping != null ? roundMoney(amount - shipping) : amount)
      if (serviceAmt != null) {
        talk(
          'council',
          'answer',
          `Towing/service invoice detected — filing as service (Misc), not fuel/parts. $${serviceAmt.toFixed(2)}.`,
        )
        const feeMatch = rawText.match(/convenience fee[\s\S]{0,20}?\$?\s*([\d,]+(?:\.\d{2})?)/i)
        let fee: number | null = null
        if (feeMatch) {
          const n = Number(feeMatch[1].replace(/,/g, ''))
          if (Number.isFinite(n)) fee = roundMoney(n)
        }
        items = [
          {
            id: 'council-tow-1',
            description: `${towVendor || 'Towing'} — towing service`,
            amount: serviceAmt,
            categoryId: 'misc',
          },
        ]
        if (fee != null && fee > 0) {
          items.push({
            id: 'council-tow-fee',
            description: 'Convenience / processing fee',
            amount: fee,
            categoryId: 'misc',
          })
        }
        vendor = towVendor || vendor
      }
    }
  }

  // --- Round 4: Re-categorize materials (not service invoices already handled) ---
  if (!/\btow(ing)?\b/i.test(rawText)) {
    items = items.map((i) => {
      if (isShippingLineItem(i.description)) {
        return { ...i, description: 'Shipping', categoryId: 'misc' as const }
      }
      const { categoryId } = categorizeText(i.description)
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
  if (amount != null && shipAmt != null && nearlyEqual(finalProductSum + shipAmt, amount)) {
    talk(
      'quorum',
      'decision',
      `✓ Products $${finalProductSum.toFixed(2)} + shipping $${shipAmt.toFixed(2)} = total $${amount.toFixed(2)}.`,
    )
  } else if (amount != null && nearlyEqual(finalSum, amount)) {
    talk('quorum', 'decision', `✓ All lines (products + shipping) = grand total $${amount.toFixed(2)}.`)
  } else {
    talk(
      'quorum',
      'finding',
      `Soft match: products $${finalProductSum.toFixed(2)}, all lines $${finalSum.toFixed(2)}, subtotal ${subtotal ?? '—'}, total ${amount ?? '—'}, shipping ${shipAmt ?? '—'}.`,
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

  const categoryId = items.length ? primaryCategoryFromItems(items) : draft.categoryId
  let confidence = draft.confidence ?? 0.5
  if (hunted.length) confidence = Math.min(0.96, confidence + 0.08)
  if (subtotal != null && nearlyEqual(finalProductSum, subtotal)) {
    confidence = Math.min(0.97, confidence + 0.06)
  }
  if (shipAmt != null) confidence = Math.min(0.97, confidence + 0.02)

  talk('quorum', 'decision', `Final: ${items.length} items, total $${(amount ?? finalSum).toFixed(2)}, vendor ${vendor || '—'}`)

  return {
    ...draft,
    vendor,
    amount,
    description,
    categoryId,
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
}
