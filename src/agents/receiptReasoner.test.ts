import { describe, expect, it } from 'vitest'
import type { LocalAgentResult } from './pipeline'
import {
  critiqueParse,
  reasonAboutReceipt,
  resolveFromOcrConstraints,
  vendorQuality,
} from './receiptReasoner'

const AMAZON_OCR = `
Order Summary
Order placed May 27,2026 Order # 113-0548166-9548225
Items) SUBTOTAL:              $93.00
SHIPPING & HANDLING:          $0.00
TOTAL before TAX:                  $93.00
Estimated TAX to be.               $0.00
GRAND TOTAL:                      $93.00
THORNE - Magnesium CitraMate
THORNE - Vitamin D-5,000
THORNE - Vitamin K
THORNE - Zinc Bisglycinate 30 mg
S000
`

function badDraft(): LocalAgentResult {
  return {
    date: '2026-06-27',
    vendor: 'S000',
    amount: 93,
    description: 'garbage',
    categoryId: 'misc',
    notes: '',
    lineItems: [
      {
        id: '1',
        description: 'Bs Suoplement',
        amount: 48166.95,
        categoryId: 'misc',
      },
      { id: '2', description: 'Shipping', amount: 27.2, categoryId: 'misc' },
      { id: '3', description: 'Convenience fee', amount: 93, categoryId: 'misc' },
    ],
    subtotal: 93,
    tax: 93,
    source: 'on-device',
    confidence: 0.97,
    rawText: AMAZON_OCR,
    agentReport: 'bad',
    aisUsed: ['forge'],
  }
}

describe('receipt reasoner (figure it out)', () => {
  it('flags impossible product ghosts and fee=total as fatal', () => {
    const c = critiqueParse(badDraft(), AMAZON_OCR)
    expect(c.ok).toBe(false)
    const codes = c.issues.map((i) => i.code)
    expect(codes).toContain('product-oversize')
    expect(codes.some((x) => x === 'fee-is-total' || x === 'tax-is-total')).toBe(true)
  })

  it('rejects OCR-crumb vendors', () => {
    expect(vendorQuality('S000')).toBe(0)
    expect(vendorQuality('Amazon')).toBeGreaterThan(8)
  })

  it('constraint re-solve fixes the Amazon-style explosion offline', () => {
    const fixed = resolveFromOcrConstraints(AMAZON_OCR, badDraft())
    expect(fixed.amount).toBeCloseTo(93, 1)
    expect(fixed.lineItems.every((i) => i.amount < 500)).toBe(true)
    const fee = fixed.lineItems.find((i) => /fee/i.test(i.description))
    if (fee) expect(Math.abs(fee.amount - 93)).toBeGreaterThan(0.5)
    expect(fixed.tax === null || fixed.tax === 0 || (fixed.tax != null && fixed.tax < 5)).toBe(
      true,
    )
    const c = critiqueParse(fixed, AMAZON_OCR)
    expect(c.issues.filter((i) => i.code === 'product-oversize').length).toBe(0)
  })

  it('reasonAboutReceipt repairs a broken draft', async () => {
    const { result, repaired, critique } = await reasonAboutReceipt(badDraft(), AMAZON_OCR, {
      allowLlm: false,
    })
    expect(repaired).toBe(true)
    expect(result.amount).toBeCloseTo(93, 1)
    expect(result.lineItems.every((i) => i.amount < 500)).toBe(true)
    expect(critique.issues.filter((i) => i.code === 'product-oversize').length).toBe(0)
  })
})
