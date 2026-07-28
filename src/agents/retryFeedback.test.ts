import { describe, expect, it } from 'vitest'
import {
  formatRejectionBrief,
  pickDiversifiedParse,
  similarityToRejected,
  snapshotFromSuggestion,
} from './retryFeedback'
import type { LocalAgentResult } from './pipeline'

function fake(
  partial: Partial<LocalAgentResult> & { amount?: number | null; lineItems?: LocalAgentResult['lineItems'] },
): LocalAgentResult {
  return {
    date: null,
    vendor: partial.vendor ?? '',
    amount: partial.amount ?? null,
    description: partial.description ?? '',
    categoryId: partial.categoryId ?? 'misc',
    notes: '',
    lineItems: partial.lineItems ?? [],
    source: 'on-device',
    confidence: partial.confidence ?? 0.7,
    rawText: '',
    ...partial,
  }
}

describe('retry feedback — user rejected a scan', () => {
  it('scores near-identical answers as highly similar', () => {
    const rejected = snapshotFromSuggestion({
      amount: 76.67,
      vendor: 'Swag',
      description: 'Filter; Filter',
      lineItems: [
        { id: '1', description: 'Racor filter', amount: 39.97, categoryId: 'fuel' },
        { id: '2', description: 'Cat filter', amount: 26.75, categoryId: 'fuel' },
        { id: '3', description: 'Shipping', amount: 9.95, categoryId: 'misc' },
      ],
      attempt: 1,
    })
    const same = fake({
      amount: 76.67,
      vendor: 'Swag Performance',
      lineItems: [
        { id: 'a', description: 'Racor filter kit', amount: 39.97, categoryId: 'fuel' },
        { id: 'b', description: 'Cat filter', amount: 26.75, categoryId: 'fuel' },
        { id: 'c', description: 'Shipping', amount: 9.95, categoryId: 'misc' },
      ],
    })
    expect(similarityToRejected(same, rejected)).toBeGreaterThan(0.75)
  })

  it('scores a different total/items as low similarity', () => {
    const rejected = snapshotFromSuggestion({
      amount: 50,
      vendor: 'Store',
      lineItems: [{ id: '1', description: 'Widget', amount: 50, categoryId: 'misc' }],
      attempt: 1,
    })
    const other = fake({
      amount: 120.5,
      vendor: 'Other',
      lineItems: [
        { id: '1', description: 'Foam board', amount: 80, categoryId: 'insulation' },
        { id: '2', description: 'Tape', amount: 40.5, categoryId: 'tools' },
      ],
    })
    expect(similarityToRejected(other, rejected)).toBeLessThan(0.4)
  })

  it('pickDiversifiedParse avoids the rejected clone', () => {
    const rejected = snapshotFromSuggestion({
      amount: 10,
      vendor: 'A',
      lineItems: [{ id: '1', description: 'Bad item', amount: 10, categoryId: 'misc' }],
      attempt: 1,
    })
    const clone = fake({
      amount: 10,
      vendor: 'A',
      confidence: 0.95,
      lineItems: [{ id: '1', description: 'Bad item', amount: 10, categoryId: 'misc' }],
    })
    const alt = fake({
      amount: 22,
      vendor: 'B',
      confidence: 0.6,
      lineItems: [
        { id: '1', description: 'Better item', amount: 12, categoryId: 'tools' },
        { id: '2', description: 'Other', amount: 10, categoryId: 'misc' },
      ],
    })
    const { winner, report } = pickDiversifiedParse(
      [clone, alt],
      rejected,
      (c) => (c.confidence ?? 0) * 40 + (c.lineItems?.length ?? 0) * 5,
    )
    expect(winner.amount).toBe(22)
    expect(report).toMatch(/USER REJECTED|Diversified/i)
  })

  it('formatRejectionBrief mentions attempt and total', () => {
    const brief = formatRejectionBrief(
      snapshotFromSuggestion({ amount: 76.67, vendor: 'Swag', attempt: 2, lineItems: [] }),
    )
    expect(brief).toMatch(/#2/)
    expect(brief).toMatch(/76\.67/)
    expect(brief).toMatch(/Do NOT return the same answer/i)
  })
})
