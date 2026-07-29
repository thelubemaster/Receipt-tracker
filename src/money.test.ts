import { describe, expect, it } from 'vitest'
import {
  formatAmountForInput,
  formatMoney,
  parseMoneyInput,
  parseMoneyInputLoose,
  sanitizeMoneyTyping,
  sumAmounts,
} from './money'
import { purchasesToCsv } from './exportData'
import { categoryBreakdown, totalSpent } from './stats'
import type { Purchase } from './types'

describe('money', () => {
  it('formats USD', () => {
    expect(formatMoney(12.5)).toBe('$12.50')
    expect(formatMoney(1000)).toBe('$1,000.00')
  })

  it('parses money input', () => {
    expect(parseMoneyInput('$1,234.56')).toBe(1234.56)
    expect(parseMoneyInput('12')).toBe(12)
    expect(parseMoneyInput('12.50')).toBe(12.5)
    expect(parseMoneyInput('')).toBeNull()
    expect(parseMoneyInput('-3')).toBeNull()
  })

  it('keeps period while typing cents', () => {
    expect(sanitizeMoneyTyping('12.')).toBe('12.')
    expect(sanitizeMoneyTyping('12.5')).toBe('12.5')
    expect(sanitizeMoneyTyping('12.50')).toBe('12.50')
    expect(sanitizeMoneyTyping('12.509')).toBe('12.50')
    expect(sanitizeMoneyTyping('$3.2')).toBe('3.2')
    // incomplete drafts are not final numbers yet
    expect(parseMoneyInput('12.')).toBeNull()
    expect(parseMoneyInput('.')).toBeNull()
    expect(parseMoneyInputLoose('12.')).toBe(12)
    expect(parseMoneyInputLoose('12.50')).toBe(12.5)
    expect(formatAmountForInput(12.5)).toBe('12.5')
  })

  it('sums amounts', () => {
    expect(sumAmounts([1.1, 2.2, 3.3])).toBe(6.6)
  })
})

describe('stats', () => {
  const sample: Purchase[] = [
    {
      id: '1',
      projectId: 'p1',
      date: '2026-07-01',
      description: 'Foam',
      amount: 100,
      categoryId: 'insulation',
      vendor: 'HD',
      notes: '',
    receiptImageId: null,
      lineItems: [],
      aisUsed: [],
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    {
      id: '2',
      projectId: 'p1',
      date: '2026-07-02',
      description: 'Wire',
      amount: 50,
      categoryId: 'electrical',
      vendor: 'Lowe',
      notes: '',
    receiptImageId: null,
      lineItems: [],
      aisUsed: [],
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    },
  ]

  it('totals spend', () => {
    expect(totalSpent(sample)).toBe(150)
  })

  it('breaks down categories', () => {
    const b = categoryBreakdown(sample)
    expect(b[0].categoryId).toBe('insulation')
    expect(b[0].percent).toBe(66.7)
  })
})

describe('export', () => {
  it('builds csv', () => {
    const csv = purchasesToCsv([
      {
        id: '1',
        projectId: 'p1',
        date: '2026-07-01',
        description: 'Foam, board',
        amount: 10,
        categoryId: 'insulation',
        vendor: 'Store',
        notes: 'hi',
        receiptImageId: 'img',
        lineItems: [],
        aisUsed: [],
        createdAt: '',
        updatedAt: '',
      },
    ])
    expect(csv).toContain('date,vendor,description')
    expect(csv).toContain('"Foam, board"')
    expect(csv).toContain('yes')
  })
})
