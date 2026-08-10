import { describe, expect, it } from 'vitest'
import { filterPurchases, purchaseMatchesQuery } from './searchPurchases'
import type { Purchase } from './types'

function p(partial: Partial<Purchase> & Pick<Purchase, 'id'>): Purchase {
  return {
    projectId: 'proj',
    date: '2026-08-01',
    description: 'Battery cable',
    amount: 26.13,
    categoryId: 'electrical',
    vendor: 'Amazon',
    notes: 'lugs',
    receiptImageId: null,
    lineItems: [
      { id: '1', description: '4 AWG cable lug', amount: 6.99, categoryId: 'electrical' },
    ],
    aisUsed: [],
    bestAiId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...partial,
  }
}

describe('search purchases', () => {
  const list = [
    p({ id: '1' }),
    p({
      id: '2',
      vendor: 'AutoZone',
      description: 'HD Battery',
      categoryId: 'engine',
      amount: 365.2,
      lineItems: [],
      notes: '',
    }),
    p({
      id: '3',
      vendor: 'Falzone',
      description: 'Tow bill',
      categoryId: 'towing',
      amount: 1225.9,
      lineItems: [],
      notes: '',
    }),
  ]

  it('matches vendor and product text', () => {
    expect(purchaseMatchesQuery(list[0], 'amazon')).toBe(true)
    expect(purchaseMatchesQuery(list[0], 'awg lug')).toBe(true)
    expect(purchaseMatchesQuery(list[0], 'autozone')).toBe(false)
  })

  it('matches amount fragments and category labels', () => {
    expect(filterPurchases(list, '365').map((x) => x.id)).toEqual(['2'])
    expect(filterPurchases(list, 'tow').map((x) => x.id)).toEqual(['3'])
    expect(filterPurchases(list, 'electrical').map((x) => x.id)).toEqual(['1'])
  })

  it('empty query returns all', () => {
    expect(filterPurchases(list, '  ')).toHaveLength(3)
  })
})
