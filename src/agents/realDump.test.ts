import { describe, expect, it } from 'vitest'
import {
  extractProductNamesFromOcr,
  critiqueParse,
  resolveFromOcrConstraints,
  reasonAboutReceipt,
} from './receiptReasoner'
import type { LocalAgentResult } from './pipeline'

/** Exact messy OCR from phone scan debug (Amazon 4× Thorne, no unit prices). */
const REAL = `Order Summary
Order placed May 27,2026 Order # 113-0548166-9548225
shipto                                        Payment method                                        Order Summary
Bradley                                 Mastercard_ending In 3765                      Items) Subtotal:              $93.00
8084 LITTLE CREEK RD       (Whew etted transactions             Shipping &          $0.00
BANGOR, PA 18013-4160                                                                              Handling:
Uniteg states                                                                                                     Total before tax:                  $93.00
Estimated tax to be.               $0.00
collected:
Grand Total:                      $93.00
Delivered May 28
Your package was left near the front door or porch.
= THORNE - Magnesium CitraMate - Magnesium Citrate & Malate
‘Supplement - Supports Heart Health, Skeletal Muscles, Cardiac &
BB Lung Function, Bone Density & More? - Third-Party Certfied- 90
= servings
Sold by: Patem.
Retum window closed on June 27, 2026.
su:
== THORNE - Vitamin D-5,000 - Vitamin D3 Supplement - Supports
Healthy Bones, Teeth & Muscles, Plus Cardiovascular & Immune
A incron NSF Certited for Sport - Gluten, Day & SoycFes - 60
I. Capsules
== slaby-patiem.
S000
sw THORNE - Vitamin K - Vitamins K1 and K2 (a5 MK-4 and MK-7)
Capsule Supplement - Supports Strong Bones* - Clinically Studied
ingredients - Thra.Party Certified - Guten, Dalry & Soy-Free - 60
=. Capsules
== solabypatiem.
100
m= THORNE-Zinc Bisglycinate 30 mg - Highly Absorbable Zinc
Fi Suopiement- Supports immune System, Eye. Sin & Reproductive
Health - Third-Party Certified - Gluten, Dairy & Soy-Free - 60
Sa Capsules
== solaby-patiem.
~~ THORNE - Magnesium CitraMate - Magneskum Citrate & Malate
ae THORNE - Vitamin K - Vitamins K1 and K2 (as MK-4 and MK-7)
m= THORNE - Zinc Bisglycinate 30 mg - Highly Absorbable Zinc
THORNE - Magneskam Citrate - Magneshim Citrate & Malate
THORNE - Vitamin D-5,000 - Wtamin D3 Supplement - Supports
THORNE - Vitamin K - amis KY and K2 (a5 MK4 and MK.)
THORNE - 2c Bisgycinate 30 mg - ighly Absorbable Zinc
`

const collapsed: LocalAgentResult = {
  date: '2026-05-27',
  vendor: 'Amazon',
  amount: 93,
  description: 'THORNE; Magnesium',
  categoryId: 'thorne-parts',
  notes: '',
  lineItems: [
    {
      id: '1',
      description: 'THORNE; Magnesium CitraMate - M; Supplement - S; Third-P',
      amount: 93,
      categoryId: 'thorne-parts',
    },
  ],
  subtotal: 93,
  tax: 0,
  source: 'on-device',
  confidence: 0.94,
  rawText: REAL,
  agentReport: 'phone 1.32.0 collapsed',
  aisUsed: ['forge'],
}

describe('real phone dump (Amazon 4 Thorne)', () => {
  it('extracts exactly four unique products from messy multi-page OCR', () => {
    const names = extractProductNamesFromOcr(REAL)
    expect(names.length).toBe(4)
    const blob = names.join(' | ').toLowerCase()
    expect(blob).toMatch(/magnesium|citramate/)
    expect(blob).toMatch(/vitamin\s*d|5,?000/)
    expect(blob).toMatch(/vitamin\s*k/)
    expect(blob).toMatch(/zinc|bisglyc/)
    expect(blob).not.toMatch(/return window|lung function|suopiement/)
  })

  it('reasoner expands collapsed $93 bundle into 4 lines that sum to $93', async () => {
    const c = critiqueParse(collapsed, REAL)
    expect(c.ok).toBe(false)
    expect(c.issues.some((i) => i.code === 'missing-line-items')).toBe(true)

    const r = await reasonAboutReceipt(collapsed, REAL, { allowLlm: false })
    expect(r.repaired).toBe(true)
    const prods = r.result.lineItems.filter((i) => !/ship|fee/i.test(i.description))
    expect(prods.length).toBe(4)
    const sum = prods.reduce((s, i) => s + i.amount, 0)
    expect(sum).toBeCloseTo(93, 1)
    expect(r.result.amount).toBeCloseTo(93, 1)
    expect(r.result.vendor.toLowerCase()).toMatch(/amazon/)
  })

  it('constraint resolve alone lists four products', () => {
    const fixed = resolveFromOcrConstraints(REAL, collapsed)
    const prods = fixed.lineItems.filter((i) => !/ship|fee/i.test(i.description))
    expect(prods.length).toBe(4)
    expect(prods.reduce((s, i) => s + i.amount, 0)).toBeCloseTo(93, 1)
  })
})
