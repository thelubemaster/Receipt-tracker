import { describe, expect, it } from 'vitest'
import {
  applyUserMarksToResult,
  emptyPartMarks,
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

  it('formatRejectionBrief lists marked wrong/right parts', () => {
    const marks = emptyPartMarks()
    marks.total = 'right'
    marks.missingItems = 'wrong'
    marks.lines = { a: 'wrong' }
    const brief = formatRejectionBrief(
      snapshotFromSuggestion({
        amount: 76.67,
        vendor: 'Swag',
        attempt: 1,
        marks,
        lineItems: [
          { id: 'a', description: 'Bad filter', amount: 39.97, categoryId: 'fuel' },
        ],
      }),
    )
    expect(brief).toMatch(/FIX ONLY THESE|FIX THESE/i)
    expect(brief).toMatch(/KEEP THESE|TOTAL keep/i)
    expect(brief).toMatch(/LINE WRONG|Bad filter/i)
  })

  it('applyUserMarksToResult keeps right total and drops wrong line clones', () => {
    const marks = emptyPartMarks()
    marks.total = 'right'
    marks.vendor = 'right'
    marks.lines = { bad: 'wrong', good: 'right' }
    const rejected = snapshotFromSuggestion({
      amount: 50,
      vendor: 'KeepMe',
      marks,
      lineItems: [
        { id: 'bad', description: 'Wrong part', amount: 10, categoryId: 'misc' },
        { id: 'good', description: 'Good part', amount: 40, categoryId: 'tools' },
      ],
    })
    const result = applyUserMarksToResult(
      fake({
        amount: 99,
        vendor: 'Other',
        lineItems: [
          { id: '1', description: 'Wrong part', amount: 10, categoryId: 'misc' },
          { id: '2', description: 'New item', amount: 20, categoryId: 'misc' },
        ],
      }),
      rejected,
    )
    expect(result.amount).toBe(50)
    expect(result.vendor).toBe('KeepMe')
    expect(result.lineItems.some((i) => i.description === 'Wrong part')).toBe(false)
    expect(result.lineItems.some((i) => i.description === 'Good part')).toBe(true)
  })

  it('unmarked fields stay kept when something else is marked wrong', () => {
    const marks = emptyPartMarks()
    marks.lines = { bad: 'wrong' }
    // total/vendor unset — should keep previous
    const rejected = snapshotFromSuggestion({
      amount: 76.67,
      vendor: 'Swag',
      categoryId: 'fuel',
      marks,
      lineItems: [
        { id: 'good', description: 'Racor filter', amount: 39.97, categoryId: 'fuel' },
        { id: 'bad', description: 'Wrong line', amount: 1, categoryId: 'misc' },
      ],
    })
    const result = applyUserMarksToResult(
      fake({
        amount: 999,
        vendor: 'Changed',
        categoryId: 'tools',
        lineItems: [
          { id: 'x', description: 'Wrong line', amount: 1, categoryId: 'misc' },
          { id: 'y', description: 'Something else', amount: 5, categoryId: 'misc' },
        ],
      }),
      rejected,
    )
    expect(result.amount).toBe(76.67)
    expect(result.vendor).toBe('Swag')
    expect(result.categoryId).toBe('fuel')
    expect(result.lineItems.some((i) => i.description === 'Racor filter')).toBe(true)
    expect(result.lineItems.some((i) => i.description === 'Wrong line')).toBe(false)
  })
})
