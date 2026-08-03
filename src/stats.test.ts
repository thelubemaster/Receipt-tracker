import { describe, expect, it } from 'vitest'
import {
  categoryBreakdown,
  groupPurchasesByCategoryExact,
  groupPurchasesForDisplay,
  totalSpent,
} from './stats'
import type { Purchase } from './types'

function p(partial: Partial<Purchase> & Pick<Purchase, 'id' | 'amount' | 'categoryId'>): Purchase {
  return {
    projectId: 'p1',
    date: '2026-07-01',
    description: 'Item',
    vendor: '',
    notes: '',
    receiptImageId: null,
    lineItems: [],
    aisUsed: [],
    bestAiId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...partial,
  }
}

describe('groupPurchasesForDisplay', () => {
  it('puts similar categories in one visual group without changing receipts', () => {
    const purchases = [
      p({ id: '1', amount: 100, categoryId: 'engine', description: 'Pistons' }),
      p({ id: '2', amount: 50, categoryId: 'engine-parts', description: 'Studs' }),
      p({ id: '3', amount: 40, categoryId: 'electrical', description: 'Romex' }),
    ]
    expect(totalSpent(purchases)).toBe(190)
    const groups = groupPurchasesForDisplay(purchases)
    // engine + engine-parts share a display group
    const engineish = groups.find((g) =>
      g.purchases.some((x) => x.id === '1' || x.id === '2'),
    )!
    expect(engineish.count).toBe(2)
    expect(engineish.amount).toBe(150)
    expect(engineish.purchases.map((x) => x.id).sort()).toEqual(['1', '2'])
    // Original categories untouched
    expect(purchases.find((x) => x.id === '1')!.categoryId).toBe('engine')
    expect(purchases.find((x) => x.id === '2')!.categoryId).toBe('engine-parts')
    // Electrical alone
    expect(groups.find((g) => g.purchases.some((x) => x.id === '3'))!.count).toBe(1)
  })

  it('exact breakdown still lists each real category for spend', () => {
    const purchases = [
      p({ id: '1', amount: 100, categoryId: 'engine' }),
      p({ id: '2', amount: 50, categoryId: 'engine-parts' }),
    ]
    const exact = groupPurchasesByCategoryExact(purchases)
    expect(exact).toHaveLength(2)
    expect(categoryBreakdown(purchases)).toHaveLength(2)
  })
})
