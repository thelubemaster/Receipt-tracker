import { describe, expect, it } from 'vitest'
import {
  buildCategoryMergeMap,
  categorySimilarity,
  classifyMiscOnly,
  hasAssignedCategory,
  regroupAllPurchases,
} from './regroup'
import type { Purchase } from './types'

function base(partial: Partial<Purchase> = {}): Purchase {
  return {
    id: 'p1',
    projectId: 'proj',
    date: '2026-07-20',
    description: 'Parts order',
    amount: 100,
    categoryId: 'misc',
    vendor: 'NAPA',
    notes: '',
    receiptImageId: null,
    lineItems: [],
    aisUsed: [],
    bestAiId: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...partial,
  }
}

describe('regroup — preserve AI categories', () => {
  it('does not overwrite an AI-assigned receipt category', () => {
    const p = base({
      categoryId: 'engine',
      description: 'Random lumber and foam that might invent another cat',
      lineItems: [
        {
          id: '1',
          description: 'PLYWOOD 3/4',
          amount: 40,
          categoryId: 'structure',
        },
      ],
    })
    expect(hasAssignedCategory(p)).toBe(true)
    const r = classifyMiscOnly(p)
    expect(r.categoryId).toBe('engine')
    expect(r.lineItems[0].categoryId).toBe('structure')
  })

  it('does not rewrite line-item categories when receipt is already marked', () => {
    const p = base({
      categoryId: 'electrical',
      lineItems: [
        { id: '1', description: 'ROMEX 12/2', amount: 40, categoryId: 'electrical' },
        { id: '2', description: 'OIL FILTER', amount: 9, categoryId: 'filters-and-fluids' },
      ],
    })
    const r = classifyMiscOnly(p)
    expect(r.categoryId).toBe('electrical')
    expect(r.lineItems.map((l) => l.categoryId)).toEqual(['electrical', 'filters-and-fluids'])
  })

  it('fills misc-only receipts so they can join a group', () => {
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
      ],
    })
    const r = classifyMiscOnly(p)
    expect(r.categoryId).not.toBe('misc')
    // Line items stay as they were (misc) — we don't re-mark AI lines
    expect(r.lineItems[0].categoryId).toBe('misc')
  })

  it('merges alike categories without reclassifying content', () => {
    const list = [
      base({
        id: 'a',
        categoryId: 'engine',
        description: 'Head studs',
        lineItems: [
          { id: '1', description: 'ARP HEAD STUDS', amount: 100, categoryId: 'engine' },
        ],
      }),
      base({
        id: 'b',
        categoryId: 'engine-parts',
        description: 'Pistons',
        lineItems: [
          { id: '1', description: 'IPD PISTONS', amount: 200, categoryId: 'engine-parts' },
        ],
      }),
      base({
        id: 'c',
        categoryId: 'electrical',
        description: 'Wire',
        lineItems: [
          { id: '1', description: 'ROMEX', amount: 50, categoryId: 'electrical' },
        ],
      }),
    ]
    expect(categorySimilarity('engine', 'engine-parts')).toBeGreaterThanOrEqual(0.55)
    const map = buildCategoryMergeMap(list)
    // engine and engine-parts should collapse to one canonical
    expect(map.get('engine')).toBe(map.get('engine-parts'))
    expect(map.get('electrical')).toBe('electrical')

    const result = regroupAllPurchases(list)
    const a = result.purchases.find((p) => p.id === 'a')!
    const b = result.purchases.find((p) => p.id === 'b')!
    const c = result.purchases.find((p) => p.id === 'c')!
    // Alike receipts share a group
    expect(a.categoryId).toBe(b.categoryId)
    // Unrelated stays
    expect(c.categoryId).toBe('electrical')
    // Line items never rewritten
    expect(a.lineItems[0].categoryId).toBe('engine')
    expect(b.lineItems[0].categoryId).toBe('engine-parts')
    expect(result.preserved).toBe(3)
    expect(result.filledMisc).toBe(0)
    expect(result.mergedAlike).toBeGreaterThanOrEqual(1)
  })

  it('regroupAll does not change line items of already-categorized receipts', () => {
    const list = [
      base({
        id: 'a',
        categoryId: 'kitchen',
        lineItems: [
          { id: '1', description: 'SINK FAUCET', amount: 80, categoryId: 'kitchen' },
        ],
      }),
      base({
        id: 'b',
        categoryId: 'misc',
        description: 'ROMEX 12/2 electrical wire',
        lineItems: [
          { id: '1', description: 'ROMEX 12/2 W/G', amount: 40, categoryId: 'misc' },
        ],
      }),
    ]
    const result = regroupAllPurchases(list)
    const a = result.purchases.find((p) => p.id === 'a')!
    const b = result.purchases.find((p) => p.id === 'b')!
    expect(a.categoryId).toBe('kitchen')
    expect(a.lineItems[0].categoryId).toBe('kitchen')
    // misc can be filled
    expect(b.categoryId).not.toBe('misc')
    // but line item left as-is
    expect(b.lineItems[0].categoryId).toBe('misc')
  })
})
