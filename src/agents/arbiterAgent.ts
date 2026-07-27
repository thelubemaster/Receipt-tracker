import type { CategoryId, ReceiptLineItem, ReceiptSuggestion } from '../types'
import { categorizeText } from './keywords'
import type { LineItemsAgentResult } from './lineItemsAgent'
import { primaryCategoryFromItems } from './lineItemsAgent'
import type { MerchantAgentResult } from './merchantAgent'
import { roundMoney } from './moneyParse'
import type { TotalsAgentResult } from './totalsAgent'

export type ArbiterResult = ReceiptSuggestion & {
  source: 'on-device'
  confidence: number
  rawText: string
  agentReport: string
  agreement: {
    totalSource: string
    linesMatchTotal: boolean | null
    agents: string[]
  }
}

function nearlyEqual(a: number, b: number, tol = 0.06): boolean {
  return Math.abs(a - b) <= Math.max(tol, b * 0.02)
}

/**
 * Agent D — Arbiter.
 * Cross-checks line-items, totals, and merchant agents; reconciles conflicts.
 */
export function runArbiterAgent(input: {
  rawText: string
  lines: LineItemsAgentResult
  totals: TotalsAgentResult
  merchant: MerchantAgentResult
}): ArbiterResult {
  const { rawText, lines, totals, merchant } = input
  const report: string[] = []
  const agents = ['ocr', 'line-items', 'totals', 'merchant', 'arbiter']

  let amount = totals.total
  let totalSource = 'totals-agent'
  let linesMatchTotal: boolean | null = null

  // Cross-check: items sum vs declared total
  if (lines.items.length && amount != null) {
    linesMatchTotal = nearlyEqual(lines.itemsSum, amount)
    if (linesMatchTotal) {
      report.push(
        `✓ Line items sum ($${lines.itemsSum.toFixed(2)}) matches total ($${amount.toFixed(2)})`,
      )
      totalSource = 'totals+lines-agree'
    } else if (nearlyEqual(lines.itemsSum, amount, 1.5)) {
      report.push(
        `~ Line sum $${lines.itemsSum.toFixed(2)} ≈ total $${amount.toFixed(2)} (small OCR gap)`,
      )
      totalSource = 'totals-near-lines'
    } else if (
      totals.subtotal != null &&
      nearlyEqual(lines.itemsSum, totals.subtotal)
    ) {
      report.push(
        `✓ Line sum matches subtotal ($${totals.subtotal.toFixed(2)}); total includes tax`,
      )
      totalSource = 'lines-match-subtotal'
      linesMatchTotal = true
    } else if (lines.items.length >= 2 && lines.confidence >= 0.4) {
      // Prefer line sum if totals look weak or line sum is more detailed
      const preferLines =
        totals.confidence < 0.55 ||
        (lines.itemsSum > 0 && amount > 0 && lines.itemsSum < amount * 0.5)
      if (preferLines && lines.itemsSum > 0) {
        // Don't replace total with sum when sum is clearly only part of purchase
        if (amount > 0 && lines.itemsSum >= amount * 0.75) {
          report.push(
            `⚠ Conflict: lines $${lines.itemsSum.toFixed(2)} vs total $${amount.toFixed(2)} — keeping total, keeping all lines`,
          )
        } else {
          report.push(
            `⚠ Conflict: lines $${lines.itemsSum.toFixed(2)} vs total $${amount.toFixed(2)} — keeping total from totals agent`,
          )
        }
        totalSource = 'totals-over-lines'
      } else {
        report.push(
          `⚠ Line sum $${lines.itemsSum.toFixed(2)} ≠ total $${amount.toFixed(2)} — using totals agent`,
        )
      }
    }
  } else if (lines.items.length && amount == null) {
    amount = lines.itemsSum
    totalSource = 'lines-sum-only'
    report.push(`No total line found — using line items sum $${amount.toFixed(2)}`)
  } else if (!lines.items.length) {
    report.push('Line-items agent found no rows — description will be coarser')
  }

  // Subtotal + tax vs total
  if (totals.subtotal != null && totals.tax != null && amount != null) {
    const st = roundMoney(totals.subtotal + totals.tax)
    if (nearlyEqual(st, amount)) {
      report.push(
        `✓ Subtotal + tax ($${st.toFixed(2)}) agrees with total`,
      )
    }
  }

  const lineItems: ReceiptLineItem[] = lines.items
  let categoryId: CategoryId =
    lineItems.length > 0 ? primaryCategoryFromItems(lineItems) : categorizeText(rawText).categoryId

  // If overall text strongly says otherwise and items are mixed, keep spend-based primary
  const overall = categorizeText(rawText)
  if (lineItems.length === 0 && overall.score > 0) {
    categoryId = overall.categoryId
  }

  const description =
    lineItems.length > 0
      ? lineItems
          .map((it) => it.description)
          .slice(0, 8)
          .join('; ')
          .slice(0, 160)
      : merchant.vendor
        ? `Store purchase — ${merchant.vendor}`
        : 'Store purchase'

  let confidence =
    (lines.confidence * 0.35 + totals.confidence * 0.4 + merchant.confidence * 0.25) *
    (linesMatchTotal === false ? 0.9 : 1)

  if (lineItems.length >= 2 && amount != null) confidence += 0.05
  if (linesMatchTotal === true) confidence += 0.08
  confidence = Math.min(0.96, Math.round(confidence * 100) / 100)

  report.push(
    `Agents: line-items conf ${Math.round(lines.confidence * 100)}%, totals ${Math.round(totals.confidence * 100)}%, merchant ${Math.round(merchant.confidence * 100)}%`,
  )
  report.push(`Final total source: ${totalSource}`)

  const notesParts = [
    `Multi-agent · conf ${Math.round(confidence * 100)}%`,
    lineItems.length ? `${lineItems.length} items` : 'no itemized rows',
    totals.tax != null ? `tax $${totals.tax.toFixed(2)}` : null,
  ].filter(Boolean)

  return {
    date: merchant.date,
    vendor: merchant.vendor,
    amount,
    description,
    categoryId,
    notes: notesParts.join(' · '),
    lineItems,
    subtotal: totals.subtotal,
    tax: totals.tax,
    source: 'on-device',
    confidence,
    rawText: rawText.slice(0, 6000),
    agentReport: report.join('\n'),
    agreement: {
      totalSource,
      linesMatchTotal,
      agents,
    },
  }
}
