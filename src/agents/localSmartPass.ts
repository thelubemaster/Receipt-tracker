/**
 * Local smart pass — free on-device repair after the multi-agent parse.
 * Uses arithmetic, fee extraction, free-form invent, and on-device memory.
 * No network. No API keys.
 */
import type { CategoryId } from '../types'
import {
  categoryFromMemory,
  findVendorMemory,
  type ReceiptMemory,
} from '../receiptMemory'
import { categorizeText } from './keywords'
import {
  extractFeeFromText,
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
  return Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.02)
}

function productSum(items: LocalAgentResult['lineItems']): number {
  return roundMoney(
    items
      .filter((i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description))
      .reduce((s, i) => s + i.amount, 0),
  )
}

/**
 * Strengthen a draft parse using only local signals + optional memory.
 */
export function runLocalSmartPass(
  draft: LocalAgentResult,
  rawText: string,
  memory?: ReceiptMemory | null,
): LocalAgentResult {
  const text = normalizeOcrText(rawText || draft.rawText || '')
  let items = [...(draft.lineItems ?? [])]
  let amount = draft.amount
  let vendor = draft.vendor
  let categoryId = draft.categoryId
  let subtotal = draft.subtotal ?? null
  let tax = draft.tax ?? null
  const notes: string[] = []

  // Totals re-read (catches T0TAL-style after normalize)
  const totals = runTotalsAgent(text)
  if (totals.subtotal != null) subtotal = totals.subtotal
  if (totals.tax != null) tax = totals.tax
  if (totals.total != null && (amount == null || totals.confidence > 0.55)) {
    if (amount == null || !nearly(amount, totals.total)) {
      if (amount == null || totals.confidence >= (draft.confidence ?? 0.4)) {
        amount = totals.total
        notes.push(`Smart: total from OCR → $${amount.toFixed(2)}`)
      }
    }
  }

  // Fee hunt when missing
  let hasFee = items.some((i) => isFeeLineItem(i.description))
  if (!hasFee) {
    const found = extractFeeFromText(text, { force: true })
    if (found) {
      items.push(makeFeeLineItem(found.amount, found.label))
      hasFee = true
      notes.push(`Smart: filled fee $${found.amount.toFixed(2)} from OCR`)
    }
  }

  // Vendor memory (local only)
  const memHit =
    memory &&
    (findVendorMemory(memory, vendor || '') ||
      findVendorMemory(memory, text.slice(0, 400)))
  if (memHit) {
    if (!vendor || vendor.length < 3) {
      vendor = memHit.displayName
      notes.push(`Memory: vendor → ${vendor}`)
    }
    // Fee: if this store usually has one and we still don't
    if (memHit.oftenHasFee && !hasFee) {
      const found = extractFeeFromText(text, { force: true })
      if (found) {
        items.push(makeFeeLineItem(found.amount, found.label))
        hasFee = true
        notes.push(`Memory: ${memHit.displayName} usually has a fee → $${found.amount.toFixed(2)}`)
      } else if (memHit.feeAmounts.length && amount != null && subtotal != null) {
        const implied = roundMoney(amount - subtotal - (tax ?? 0))
        const typical = memHit.feeAmounts[memHit.feeAmounts.length - 1]
        if (implied > 0.2 && nearly(implied, typical, 0.5)) {
          items.push(makeFeeLineItem(implied))
          hasFee = true
          notes.push(`Memory: fee ≈ usual $${typical.toFixed(2)} → $${implied.toFixed(2)}`)
        }
      }
    }
    // Category from this vendor if draft is misc/weak
    if (
      memHit.categoryId &&
      memHit.categoryId !== 'misc' &&
      (categoryId === 'misc' || !categoryId) &&
      memHit.timesSeen >= 1
    ) {
      categoryId = memHit.categoryId
      notes.push(`Memory: category for ${memHit.displayName} → ${categoryId}`)
    }
  }

  // Free-form invent / memory text hints from full OCR
  const invent = categorizeText(`${vendor} ${draft.description} ${text.slice(0, 900)}`)
  if (invent.categoryId !== 'misc' && invent.score >= 2) {
    if (categoryId === 'misc' || invent.score >= 4 || invent.invented) {
      if (categoryId === 'misc' || invent.invented) {
        categoryId = invent.categoryId
        notes.push(
          `Smart: category from receipt text → ${invent.label || categoryId}${invent.invented ? ' (invented)' : ''}`,
        )
      }
    }
  }
  if (memory) {
    const hint = categoryFromMemory(memory, `${vendor} ${text}`)
    if (hint && (categoryId === 'misc' || hint.score >= 5)) {
      categoryId = hint.categoryId
      notes.push(`Memory: text hints → ${categoryId}`)
    }
  }

  // Stamp product lines when we fixed category off misc
  if (categoryId && categoryId !== 'misc') {
    items = items.map((i) =>
      isShippingLineItem(i.description) || isFeeLineItem(i.description)
        ? i
        : { ...i, categoryId: i.categoryId === 'misc' ? categoryId : i.categoryId },
    )
  }

  // Prefer spend-based primary when products disagree with misc
  if (items.length) {
    const primary = primaryCategoryFromItems(items)
    if (primary !== 'misc' && categoryId === 'misc') {
      categoryId = primary
      notes.push(`Smart: primary from line items → ${categoryId}`)
    }
  }

  // If total still null, try largest money / line sum
  if (amount == null) {
    const monies = parseMoneyTokens(text).filter((n) => n > 0)
    if (monies.length) {
      amount = roundMoney(Math.max(...monies))
      notes.push(`Smart: fallback total max money $${amount.toFixed(2)}`)
    }
  }

  // Confidence bump when arithmetic agrees
  let confidence = draft.confidence ?? 0.4
  const pSum = productSum(items)
  const feeAmt = items.find((i) => isFeeLineItem(i.description))?.amount ?? 0
  const shipAmt = items.find((i) => isShippingLineItem(i.description))?.amount ?? 0
  if (amount != null && nearly(pSum + feeAmt + shipAmt + (tax ?? 0), amount, 0.15)) {
    confidence = Math.min(0.96, confidence + 0.12)
    notes.push('Smart: lines + fee + tax ≈ total')
  } else if (subtotal != null && nearly(pSum, subtotal)) {
    confidence = Math.min(0.92, confidence + 0.08)
  }
  if (hasFee) confidence = Math.min(0.95, confidence + 0.03)
  if (categoryId !== 'misc') confidence = Math.min(0.95, confidence + 0.02)

  const description =
    items.length > 0
      ? items
          .map((i) => i.description)
          .slice(0, 8)
          .join('; ')
          .slice(0, 180)
      : draft.description

  return {
    ...draft,
    amount,
    vendor,
    categoryId: categoryId as CategoryId,
    subtotal,
    tax,
    lineItems: items,
    description,
    confidence,
    rawText: text || draft.rawText,
    agentReport: [
      draft.agentReport,
      notes.length ? `LOCAL SMART PASS (free, on-device):\n- ${notes.join('\n- ')}` : 'LOCAL SMART PASS: no changes',
    ]
      .filter(Boolean)
      .join('\n'),
    fieldSources: {
      ...(draft.fieldSources ?? {}),
      // Credit local repair as ledger/cashier/clerk as appropriate
      fees: hasFee ? (draft.fieldSources?.fees ?? 'ledger') : draft.fieldSources?.fees,
      category: draft.fieldSources?.category ?? 'ledger',
    },
  }
}
