import { describe, expect, it } from 'vitest'
import { categoryBreakdown, groupPurchasesByCategory, totalSpent } from './stats'
import type { Purchase } from './types'

function p(partial: Partial<Purchase> & Pick<Purchase, 'id' | 'amount' | 'categoryId'>): Purchase {
  return {
    date: '2026-07-01',
    description: 'Item',
    vendor: '',
    notes: '',
    projectId: 'p1',
    receiptImageId: null,
    lineItems: [],
    aisUsed: [],
    bestAiId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...partial,
  }
}

describe('groupPurchasesByCategory', () => {
  it('clusters receipts into AI/free-form groups on the home chart', () => {
    const purchases = [
      p({ id: '1', amount: 100, categoryId: 'engine', description: 'Pistons' }),
      p({ id: '2', amount: 50, categoryId: 'engine', description: 'Studs' }),
      p({ id: '3', amount: 40, categoryId: 'electrical', description: 'Romex' }),
    ]
    expect(totalSpent(purchases)).toBe(190)
    const groups = groupPurchasesByCategory(purchases)
    expect(groups[0].categoryId).toBe('engine')
    expect(groups[0].count).toBe(2)
    expect(groups[0].amount).toBe(150)
    expect(groups[0].purchases.map((x) => x.id).sort()).toEqual(['1', '2'])
    expect(groups[1].categoryId).toBe('electrical')
    expect(categoryBreakdown(purchases)).toHaveLength(2)
  })
})
