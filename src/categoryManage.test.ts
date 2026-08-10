import { describe, expect, it } from 'vitest'
import {
  listUsedCategories,
  planCategoryMerge,
  planCategoryRename,
  remapPurchaseCategory,
  remapPurchasesCategory,
} from './categoryManage'
import type { Purchase } from './types'

function p(partial: Partial<Purchase> & Pick<Purchase, 'id' | 'categoryId'>): Purchase {
  return {
    projectId: 'proj',
    date: '2026-08-01',
    description: 'Item',
    amount: 10,
    vendor: '',
    notes: '',
    receiptImageId: null,
    lineItems: [],
    aisUsed: [],
    bestAiId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...partial,
  }
}

describe('category manage', () => {
  it('remaps receipt and line item categories', () => {
    const purchase = p({
      id: '1',
      categoryId: 'powertrain',
      lineItems: [
        { id: 'a', description: 'kit', amount: 5, categoryId: 'powertrain' },
        { id: 'b', description: 'wire', amount: 5, categoryId: 'electrical' },
      ],
    })
    const next = remapPurchaseCategory(purchase, 'powertrain', 'engine')
    expect(next.categoryId).toBe('engine')
    expect(next.lineItems[0].categoryId).toBe('engine')
    expect(next.lineItems[1].categoryId).toBe('electrical')
  })

  it('counts usages', () => {
    const list = [
      p({ id: '1', categoryId: 'engine' }),
      p({
        id: '2',
        categoryId: 'powertrain',
        lineItems: [{ id: 'x', description: 'x', amount: 1, categoryId: 'engine' }],
      }),
    ]
    const used = listUsedCategories(list)
    const engine = used.find((u) => u.id === 'engine')!
    expect(engine.receiptCount).toBe(1)
    expect(engine.lineCount).toBe(1)
  })

  it('rename plans a new custom id and merge remaps many sources', () => {
    const renamed = planCategoryRename('powertrain', 'Engine bay', [
      { id: 'powertrain', label: 'Powertrain', color: '#000', custom: true },
    ])
    expect(renamed.toId).toBe('engine-bay')
    expect(renamed.toLabel).toBe('Engine bay')

    const merged = planCategoryMerge(
      ['powertrain', 'engine-parts'],
      { id: 'engine' },
      [{ id: 'powertrain', label: 'Powertrain', color: '#000', custom: true }],
    )
    expect(merged.toId).toBe('engine')
    expect(merged.fromIds).toContain('powertrain')
    expect(merged.nextCustom.every((c) => c.id !== 'powertrain')).toBe(true)

    const batch = remapPurchasesCategory(
      [
        p({ id: '1', categoryId: 'powertrain' }),
        p({ id: '2', categoryId: 'engine-parts' }),
        p({ id: '3', categoryId: 'towing' }),
      ],
      'powertrain',
      'engine',
    )
    expect(batch.changed).toBe(1)
    expect(batch.purchases.find((x) => x.id === '1')!.categoryId).toBe('engine')
    expect(batch.purchases.find((x) => x.id === '3')!.categoryId).toBe('towing')
  })
})
