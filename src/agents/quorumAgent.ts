/**
 * Quorum — free final vote between two full parses (no API key).
 */
import type { LocalAgentResult } from './pipeline'
import { mergeLineItemLists } from './sieveAgent'
import { roundMoney } from './moneyParse'
import { primaryCategoryFromItems } from './lineItemsAgent'

function scoreCandidate(c: LocalAgentResult): number {
  let s = (c.confidence ?? 0) * 40
  s += Math.min(12, (c.lineItems?.length ?? 0) * 2)
  if (c.amount != null) s += 15
  if (c.vendor) s += 8
  if (c.date) s += 6
  if (c.lineItems?.length && c.amount != null) {
    const sum = c.lineItems.reduce((a, i) => a + i.amount, 0)
    if (Math.abs(sum - c.amount) < 1 || Math.abs(sum - (c.subtotal ?? -1)) < 1) s += 12
  }
  s += Math.min(10, (c.description?.length ?? 0) / 20)
  return s
}

export function runQuorumAgent(
  a: LocalAgentResult,
  b: LocalAgentResult,
): LocalAgentResult {
  const sa = scoreCandidate(a)
  const sb = scoreCandidate(b)
  const winner = sa >= sb ? a : b
  const loser = sa >= sb ? b : a

  // Prefer winner totals/vendor/date; merge line items from both for coverage
  const mergedItems = mergeLineItemLists(a.lineItems ?? [], b.lineItems ?? [])
  const description =
    mergedItems.length > 0
      ? mergedItems
          .map((i) => i.description)
          .slice(0, 8)
          .join('; ')
          .slice(0, 160)
      : winner.description

  const amount = winner.amount
  const categoryId =
    mergedItems.length > 0 ? primaryCategoryFromItems(mergedItems) : winner.categoryId

  const report = [
    `Quorum free vote: ${sa >= sb ? 'A' : 'B'} won (scores ${sa.toFixed(1)} vs ${sb.toFixed(1)})`,
    `Winner source: ${winner.activeAiLabel || winner.notes}`,
    `Merged line items: ${mergedItems.length} (A ${a.lineItems?.length ?? 0} + B ${b.lineItems?.length ?? 0})`,
    winner.agentReport,
    loser.agentReport ? `Runner-up notes:\n${loser.agentReport}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return {
    date: winner.date || loser.date,
    vendor: winner.vendor || loser.vendor,
    amount,
    description,
    categoryId,
    notes: [
      'Quorum free vote',
      mergedItems.length ? `${mergedItems.length} items` : null,
      amount != null ? `$${roundMoney(amount).toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    lineItems: mergedItems,
    subtotal: winner.subtotal ?? loser.subtotal ?? null,
    tax: winner.tax ?? loser.tax ?? null,
    source: 'on-device',
    confidence: Math.min(0.97, Math.max(winner.confidence, loser.confidence) + 0.04),
    rawText: (winner.rawText?.length || 0) >= (loser.rawText?.length || 0) ? winner.rawText : loser.rawText,
    agentReport: report,
    aisUsed: Array.from(
      new Set([...(a.aisUsed ?? []), ...(b.aisUsed ?? []), 'quorum' as const]),
    ),
    activeAiLabel: 'Quorum (free on-device)',
  }
}
