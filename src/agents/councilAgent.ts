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
import { primaryCategoryFromItems } from './lineItemsAgent'
import { extractVendor } from './merchantAgent'
import { parseMoneyTokens, roundMoney } from './moneyParse'
import type { LocalAgentResult } from './pipeline'

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

function isFeeDesc(s: string): boolean {
  return /\b(shipping|freight|delivery|tax|subtotal|total|handling)\b/i.test(s)
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

  // Preferred: amounts that help close subtotal gap
  const itemSum = roundMoney(existing.reduce((s, i) => s + i.amount, 0))
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
    if (isFeeDesc(ctx)) continue
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
 */
export function runCouncilAgent(
  draft: LocalAgentResult,
  rawText: string,
  onTalk?: (msg: string, aiId?: AiId) => void,
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

  // --- Round 1: open statements ---
  talk('cashier', 'finding', amount != null ? `Grand total I read: $${amount.toFixed(2)}` : 'No grand total found')
  talk(
    'ledger',
    'finding',
    `I have ${items.length} product line(s) summing to $${roundMoney(items.reduce((s, i) => s + i.amount, 0)).toFixed(2)}`,
  )
  if (shipping != null) talk('clerk', 'finding', `Shipping fee: $${shipping.toFixed(2)} (not a product)`)
  talk('clerk', 'finding', vendor ? `Vendor: ${vendor}` : 'Vendor unclear — scanning footer/domain…')

  // Fix vendor via shared OCR if garbage
  const betterVendor = extractVendor(rawText)
  if (betterVendor && (!vendor || vendor.length < 4 || /[\[\]{}|\\]/.test(vendor))) {
    talk('clerk', 'answer', `Updating vendor → ${betterVendor}`)
    vendor = betterVendor
  }

  // --- Round 2: Cashier challenges Ledger ---
  const itemSum = roundMoney(items.reduce((s, i) => s + i.amount, 0))
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
  } else if (amount != null && !nearlyEqual(itemSum, amount) && items.length < 2) {
    talk(
      'cashier',
      'challenge',
      `Only ${items.length} product line(s) for total $${amount.toFixed(2)}. Look harder for more items.`,
    )
  }

  // --- Round 3: Hunt missing amounts ---
  const hunted = huntMissingItems(rawText, items, {
    subtotal,
    total: amount,
    shipping,
  })
  if (hunted.length) {
    talk(
      'sieve',
      'answer',
      `Found ${hunted.length} missing product amount(s): ${hunted.map((h) => `$${h.amount.toFixed(2)} (${h.description.slice(0, 40)})`).join('; ')}`,
    )
    // merge
    for (const h of hunted) {
      const dup = items.find((i) => nearlyEqual(i.amount, h.amount))
      if (!dup) items.push(h)
      else if (h.description.length > dup.description.length) {
        dup.description = h.description
        dup.categoryId = h.categoryId
      }
    }
  } else {
    talk('sieve', 'finding', 'No obvious missing product amounts in OCR after filters.')
  }

  // Drop shipping-as-product if still present
  const before = items.length
  items = items.filter((i) => !isFeeDesc(i.description))
  if (items.length < before) {
    talk('arbiter', 'decision', 'Removed shipping/tax-like rows from product list.')
  }

  // --- Round 4: Re-categorize with full product names ---
  items = items.map((i) => {
    const { categoryId } = categorizeText(i.description)
    if (categoryId !== i.categoryId && categoryId !== 'misc') {
      talk('ledger', 'answer', `Recategorized “${i.description.slice(0, 36)}” → ${categoryId}`)
      return { ...i, categoryId }
    }
    return i
  })

  // --- Round 5: Arithmetic agreement ---
  const finalSum = roundMoney(items.reduce((s, i) => s + i.amount, 0))
  if (subtotal != null && nearlyEqual(finalSum, subtotal)) {
    talk('quorum', 'decision', `✓ Products $${finalSum.toFixed(2)} match subtotal.`)
  } else if (amount != null && shipping != null && nearlyEqual(finalSum + shipping, amount)) {
    talk(
      'quorum',
      'decision',
      `✓ Products $${finalSum.toFixed(2)} + shipping $${shipping.toFixed(2)} = total $${amount.toFixed(2)}.`,
    )
  } else if (amount != null && nearlyEqual(finalSum, amount)) {
    talk('quorum', 'decision', `✓ Products sum equals grand total $${amount.toFixed(2)}.`)
  } else {
    talk(
      'quorum',
      'finding',
      `Soft match: products $${finalSum.toFixed(2)}, subtotal ${subtotal ?? '—'}, total ${amount ?? '—'}, shipping ${shipping ?? '—'}.`,
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
  if (subtotal != null && nearlyEqual(finalSum, subtotal)) confidence = Math.min(0.97, confidence + 0.06)

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
