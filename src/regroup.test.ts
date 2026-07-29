import { describe, expect, it } from 'vitest'
import { reclassifyPurchase, regroupAllPurchases } from './regroup'
import type { Purchase } from './types'

function base(partial: Partial<Purchase> = {}): Purchase {
  return {
    id: 'p1',
    projectId: 'p1',
    date: '2026-07-20',
    description: 'Parts order',
    amount: 100,
    categoryId: 'misc',
    vendor: 'NAPA',
    notes: '',
    projectId: 'p1',
    receiptImageId: null,
    lineItems: [],
    aisUsed: [],
    bestAiId: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...partial,
  }
}

describe('regroup', () => {
  it('reclassifies engine parts out of misc', () => {
    const p = base({
      categoryId: 'misc',
      description: 'IPD piston kit and ARP head studs',
      lineItems: [
        {
          id: '1',
          description: 'IPD FORGED PISTON KIT POWERSTROKE',
          amount: 489,
          categoryId: 'misc',
        },
        {
          id: '2',
          description: 'ARP 2000 HEAD STUD KIT',
          amount: 312,
          categoryId: 'misc',
        },
      ],
    })
    const r = reclassifyPurchase(p)
    expect(r.categoryId).not.toBe('misc')
    expect(r.categoryId === 'engine' || /engine|powertrain/i.test(r.categoryId)).toBe(true)
    expect(r.lineItems.every((li) => li.categoryId !== 'misc' || /shipping|fee/i.test(li.description))).toBe(
      true,
    )
  })

  it('puts romex under electrical and groups spend', () => {
    const p = base({
      categoryId: 'misc',
      description: 'Home Depot wire',
      lineItems: [
        { id: '1', description: 'ROMEX 12/2 W/G 50', amount: 62.4, categoryId: 'misc' },
        { id: '2', description: 'RIGID FOAM 2IN', amount: 48.97, categoryId: 'misc' },
      ],
    })
    const r = reclassifyPurchase(p)
    // Highest spend line is romex → electrical, or foam → insulation; either is a real group
    expect(r.categoryId).toMatch(/electrical|insulation/)
    expect(r.lineItems.find((i) => /romex/i.test(i.description))?.categoryId).toBe('electrical')
  })

  it('regroupAll counts changes and collects labels', () => {
    const list = [
      base({
        id: 'a',
        categoryId: 'misc',
        lineItems: [
          { id: '1', description: 'OIL FILTER PH8A', amount: 8.99, categoryId: 'misc' },
        ],
      }),
      base({
        id: 'b',
        categoryId: 'electrical',
        description: 'Romex',
        lineItems: [
          { id: '1', description: 'ROMEX 12/2', amount: 40, categoryId: 'electrical' },
        ],
      }),
    ]
    const result = regroupAllPurchases(list)
    expect(result.changed).toBeGreaterThanOrEqual(1)
    expect(result.labels.length).toBeGreaterThan(0)
    expect(result.purchases).toHaveLength(2)
  })
})
