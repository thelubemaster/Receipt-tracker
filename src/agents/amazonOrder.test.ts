import { describe, expect, it } from 'vitest'
import { parseReceiptText } from '../localAgent'
import { extractDate, extractVendor } from './merchantAgent'
import { parseMoneyTokens, stripOrderIds } from './moneyParse'
import { runReceiptEngine } from './receiptEngine'
import { runTotalsAgent } from './totalsAgent'

/**
 * Real user dump: Amazon Thorne supplement order PDF (OCR of 2 pages).
 * Order # 113-0548166-9548225 · GRAND TOTAL $93.00 · tax $0 · ship $0
 */
const AMAZON_OCR = `
Order Summary
Order placed May 27,2026 Order # 113-0548166-9548225
shipto                                        Payment method                                        Order Summary
Bradley                                 Mastercard ending In 3765                      Items) SUBTOTAL:              $93.00
8084 LITTLE CREEK RD                                      SHIPPING &          $0.00
BANGOR, PA 18013-4160                                                                              HANDLING:
United States                                                                                                     TOTAL before TAX:                  $93.00
Estimated TAX to be.               $0.00
collected:
GRAND TOTAL:                      $93.00
Delivered May 28
Your package was left near the front door or porch.
THORNE - Magnesium CitraMate - Magnesium Citrate & Malate
Supplement - Supports Heart Health, Skeletal Muscles, Cardiac &
Lung Function, Bone Density & More - Third-Party Certified - 90
servings
Sold by: Pattern.
Return window closed on June 27, 2026.
THORNE - Vitamin D-5,000 - Vitamin D3 Supplement - Supports
Healthy Bones, Teeth & Muscles, Plus Cardiovascular & Immune
Function NSF Certified for Sport - Gluten, Dairy & Soy-Free - 60
Capsules
Sold by: Pattern.
THORNE - Vitamin K - Vitamins K1 and K2 (as MK-4 and MK-7)
Capsule Supplement - Supports Strong Bones - Clinically Studied
ingredients - Third-Party Certified - Gluten, Dairy & Soy-Free - 60
Capsules
Sold by: Pattern.
THORNE - Zinc Bisglycinate 30 mg - Highly Absorbable Zinc
Supplement - Supports Immune System, Eye Skin & Reproductive
Health - Third-Party Certified - Gluten, Dairy & Soy-Free - 60
Capsules
Sold by: Pattern.
S000
`

describe('Amazon order PDF scan (user debug 2026-07-31)', () => {
  it('strips Amazon order numbers so they never become $48166.95', () => {
    const stripped = stripOrderIds('Order # 113-0548166-9548225 TOTAL $93.00')
    expect(stripped).not.toMatch(/0548166/)
    const monies = parseMoneyTokens('Order # 113-0548166-9548225 GRAND TOTAL $93.00')
    expect(monies).toContain(93)
    expect(monies.every((n) => n < 1000)).toBe(true)
  })

  it('detects Amazon as vendor not S000', () => {
    expect(extractVendor(AMAZON_OCR).toLowerCase()).toBe('amazon')
  })

  it('prefers order placed date over return window', () => {
    const d = extractDate(AMAZON_OCR)
    expect(d).toBe('2026-05-27')
  })

  it('does not treat TOTAL before TAX as tax = $93', () => {
    const t = runTotalsAgent(AMAZON_OCR)
    expect(t.total).toBeCloseTo(93, 1)
    expect(t.tax === null || t.tax === 0 || (t.tax != null && t.tax < 5)).toBe(true)
  })

  it('engine: total 93, tax ~0, no order-id product ghost', () => {
    const r = runReceiptEngine(AMAZON_OCR)
    expect(r.amount).toBeCloseTo(93, 1)
    expect(r.tax === null || r.tax === 0 || (r.tax != null && r.tax < 5)).toBe(true)
    expect(r.vendor.toLowerCase()).toMatch(/amazon/)
    for (const li of r.lineItems) {
      expect(li.amount).toBeLessThan(500)
      if (!/shipping|fee/i.test(li.description)) {
        expect(li.amount).toBeLessThanOrEqual(93 * 2.5)
      }
    }
    // Fee must not clone grand total
    const fee = r.lineItems.find((i) => /fee/i.test(i.description))
    if (fee) expect(Math.abs(fee.amount - 93)).toBeGreaterThan(0.5)
  })

  it('full parse is usable for Amazon $93 Thorne order', () => {
    const r = parseReceiptText(AMAZON_OCR)
    expect(r.amount).toBeCloseTo(93, 1)
    expect(r.vendor.toLowerCase()).toMatch(/amazon/)
    expect(r.date).toBe('2026-05-27')
    // No five-digit ghost product
    expect(r.lineItems.every((i) => i.amount < 500)).toBe(true)
  })
})

// Reasoner multi-item expansion is covered in receiptReasoner.test.ts
