import { describe, expect, it } from 'vitest'
import {
  categoryFromMemory,
  emptyReceiptMemory,
  findVendorMemory,
  learnFromPurchase,
  normalizeVendorKey,
} from './receiptMemory'
import type { Purchase } from './types'

function purchase(partial: Partial<Purchase> & Pick<Purchase, 'vendor' | 'categoryId'>): Purchase {
  return {
    id: '1',
    date: '2026-07-20',
    description: 'Tow',
    amount: 200,
    notes: '',
    receiptImageId: null,
    lineItems: [
      {
        id: 'a',
        description: 'Towing service',
        amount: 180,
        categoryId: partial.categoryId,
      },
      {
        id: 'b',
        description: 'Convenience fee',
        amount: 20,
        categoryId: 'misc',
      },
    ],
    aisUsed: [],
    bestAiId: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...partial,
  }
}

describe('receiptMemory (local only)', () => {
  it('normalizes vendor keys', () => {
    expect(normalizeVendorKey('HOME DEPOT #4821')).toContain('home depot')
    expect(normalizeVendorKey('Falzone Towing Service Inc')).toMatch(/falzone/)
  })

  it('learns fee habit and category for a vendor', () => {
    let mem = emptyReceiptMemory()
    mem = learnFromPurchase(
      mem,
      purchase({ vendor: 'Falzone Towing Service Inc', categoryId: 'towing', amount: 200 }),
    )
    const hit = findVendorMemory(mem, 'Falzone Towing Service')
    expect(hit).toBeTruthy()
    expect(hit!.oftenHasFee).toBe(true)
    expect(hit!.feeAmounts).toContain(20)
    expect(hit!.categoryId).toMatch(/tow/i)
  })

  it('matches category hints from prior product text', () => {
    let mem = emptyReceiptMemory()
    mem = learnFromPurchase(
      mem,
      purchase({
        vendor: 'Swag',
        categoryId: 'engine',
        description: 'IPD piston kit powerstroke',
        lineItems: [
          {
            id: '1',
            description: 'IPD FORGED PISTON KIT POWERSTROKE',
            amount: 489,
            categoryId: 'engine',
          },
        ],
      }),
    )
    const hint = categoryFromMemory(mem, 'IPD piston powerstroke head stud rebuild')
    expect(hint?.categoryId).toBe('engine')
  })
})
