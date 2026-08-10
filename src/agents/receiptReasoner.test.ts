import { describe, expect, it } from 'vitest'
import type { LocalAgentResult } from './pipeline'
import {
  critiqueParse,
  descriptionQuality,
  extractOrderSummaryStack,
  extractProductNamesFromOcr,
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
Delivered May 28
= THORNE - Magnesium CitraMate - Magnesium Citrate & Malate
Supplement - Supports Heart Health
Sold by: Pattern.
Return window closed on June 27, 2026.
== THORNE - Vitamin D-5,000 - Vitamin D3 Supplement - Supports
Healthy Bones, Teeth & Muscles
Sold by: Pattern.
sw THORNE - Vitamin K - Vitamins K1 and K2 (as MK-4 and MK-7)
Capsule Supplement - Supports Strong Bones
Sold by: Pattern.
m= THORNE - Zinc Bisglycinate 30 mg - Highly Absorbable Zinc
Supplement - Supports Immune System
Sold by: Pattern.
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

  it('finds all four Thorne product names without needing unit prices', () => {
    const names = extractProductNamesFromOcr(AMAZON_OCR)
    expect(names.length).toBe(4)
    const blob = names.join(' ').toLowerCase()
    expect(blob).toMatch(/magnesium|citramate/)
    expect(blob).toMatch(/vitamin\s*d/)
    expect(blob).toMatch(/vitamin\s*k/)
    expect(blob).toMatch(/zinc/)
    // Must not treat marketing blurbs as products
    expect(blob).not.toMatch(/lung function|return window|healthy bones, teeth/)
  })

  it('lists each product as its own line when prices are missing', () => {
    const fixed = resolveFromOcrConstraints(AMAZON_OCR, badDraft())
    const products = fixed.lineItems.filter(
      (i) => !/shipping|fee/i.test(i.description),
    )
    expect(products.length).toBe(4)
    const sum = products.reduce((s, i) => s + i.amount, 0)
    expect(sum).toBeCloseTo(93, 1)
    expect(products.every((i) => i.amount > 0 && i.amount < 93)).toBe(true)
    // Even split of $93 → ~$23.25 each (placeholder — OCR has no unit prices)
    expect(products.every((i) => i.amount >= 23 && i.amount <= 24)).toBe(true)
    expect(fixed.notes || fixed.agentReport || '').toMatch(/even-?split|not readable|estimated/i)
    expect(fixed.confidence).toBeLessThanOrEqual(0.75)
  })

  it('uses real unit prices when OCR has them and they sum to subtotal', () => {
    const withPrices = `
Order Summary
Items SUBTOTAL: $100.00
GRAND TOTAL: $100.00
THORNE - Magnesium CitraMate $26.00
THORNE - Vitamin D-5,000 $24.00
THORNE - Vitamin K $25.00
THORNE - Zinc Bisglycinate 30 mg $25.00
`
    const fixed = resolveFromOcrConstraints(withPrices, null)
    const products = fixed.lineItems.filter((i) => !/shipping|fee/i.test(i.description))
    expect(products.length).toBe(4)
    expect(products.map((p) => p.amount).sort((a, b) => a - b)).toEqual([24, 25, 25, 26])
    expect(fixed.notes || '').not.toMatch(/even-?split/i)
  })

  it('pairs mosaic unit prices to THORNE titles and fills missing zinc price', async () => {
    // Real-world 1.32.4 dump shape: prices under titles; zinc has no $ in OCR
    const mosaicOcr = `
Order Summary
Order placed May 27, 2026
ITEM(s) SUBTOTAL:
GRAND TOTAL:
$93.00
$0.00
THORNE - Magnesium CitraMate - Magnesium Citr
Supplement - Supports Heart Health, Skeletal Mu:
Lung Function, Bone Density & More* - Third-Part:
Sold by: Pattern.
$22.00
THORNE - Vitamin D-5,000 - Vitamin D3 Supplem
Healthy Bones, Teeth & Muscles, Plus Cardiovascul
$20.00
THORNE - Vitamin K - Vitamins K1 and K2 (as MK-
Capsule Supplement - Supports Strong Bones* - C
$31.00
THORNE - Zinc Bisglycinate 30 mg - Highly Absort
Supplement - Supports Immune System, Eye, Skin
`
    const marketingDraft: LocalAgentResult = {
      date: '2026-05-27',
      vendor: 'Amazon',
      amount: 93,
      description: 'bad',
      categoryId: 'windows',
      notes: '',
      lineItems: [
        {
          id: '1',
          description: 'Supplement - Supports Heart Health, Skeletal Mu',
          amount: 22,
          categoryId: 'misc',
        },
        {
          id: '2',
          description: 'Third-Party Certified - 90 THORNE - Vitamin D',
          amount: 20,
          categoryId: 'misc',
        },
        {
          id: '3',
          description: 'ardiovascular & Immune uten, Dairy & Soy-Free',
          amount: 31,
          categoryId: 'hardware-and-fasteners',
        },
      ],
      subtotal: null,
      tax: null,
      source: 'on-device',
      confidence: 0.9,
      rawText: mosaicOcr,
      agentReport: 'bad marketing names',
      aisUsed: ['mosaic'],
    }

    const c = critiqueParse(marketingDraft, mosaicOcr)
    expect(c.ok).toBe(false)
    expect(
      c.issues.some((i) =>
        ['marketing-as-product', 'missing-line-items', 'product-sum-short'].includes(i.code),
      ),
    ).toBe(true)

    const { result, repaired } = await reasonAboutReceipt(marketingDraft, mosaicOcr, {
      allowLlm: false,
    })
    expect(repaired).toBe(true)
    const prods = result.lineItems.filter((i) => !/ship|fee/i.test(i.description))
    expect(prods.length).toBe(4)
    const blob = prods.map((p) => p.description).join(' ').toLowerCase()
    expect(blob).toMatch(/magnesium|citramate/)
    expect(blob).toMatch(/vitamin\s*d/)
    expect(blob).toMatch(/vitamin\s*k/)
    expect(blob).toMatch(/zinc/)
    // Should not be pure marketing blurbs
    expect(prods.every((p) => /thorne/i.test(p.description))).toBe(true)
    const sum = prods.reduce((s, i) => s + i.amount, 0)
    expect(sum).toBeCloseTo(93, 1)
    // Known mosaic prices present
    expect(prods.some((p) => Math.abs(p.amount - 22) < 0.02)).toBe(true)
    expect(prods.some((p) => Math.abs(p.amount - 31) < 0.02)).toBe(true)
  })

  it('flags single-line collapse when OCR has many products', () => {
    const collapsed: LocalAgentResult = {
      ...badDraft(),
      vendor: 'Amazon',
      tax: 0,
      lineItems: [
        {
          id: '1',
          description: 'THORNE bundle',
          amount: 93,
          categoryId: 'misc',
        },
      ],
    }
    const c = critiqueParse(collapsed, AMAZON_OCR)
    expect(c.ok).toBe(false)
    expect(c.issues.some((i) => i.code === 'missing-line-items')).toBe(true)
  })

  /**
   * User dump 2026-08-10 R1: Amazon battery cable lugs.
   * Stacked summary amounts + "Supplied by" OCR garbage as product names.
   */
  const AMAZON_CABLE_OCR = `
Order Summary
Order placed August 9, 2026
Order # 112-5476060-9670657
Ship to Bradley
BANGOR, PA 18013-4160
Payment method Mastercard ending In 3765
Item(s) Subtotal:
Shipping &
Handling:
Total before tax:
Estimated tax to be
collected:
Grand Total:
$24.65
$0.00
$1.48
$26.13
Arriving Wednesday
4 AWG/Gauge - 3/8" Battery Cable Lug Copper Connector Wire Ring
Sold by: AIRIC ELECTRICAL ACCESSORIES
[             Supplied by: Other
$6.99
Sold by: TKDMR Store
TKDMR 8 PCS 4/0 AWG - 3/8 Battery Cable Lugs Copper Wire Ring
Terminals
Supplied by: Other
$17.66
Grand Total:                       $26.13
`

  it('Amazon cable order: grand total $26.13 not items subtotal $24.65', () => {
    const stack = extractOrderSummaryStack(AMAZON_CABLE_OCR)
    expect(stack.total).toBeCloseTo(26.13, 1)
    expect(stack.subtotal).toBeCloseTo(24.65, 1)
    expect(stack.shipping === 0 || stack.shipping === null || (stack.shipping ?? 0) < 0.1).toBe(
      true,
    )

    const fixed = resolveFromOcrConstraints(AMAZON_CABLE_OCR, {
      date: '2026-08-09',
      vendor: 'Amazon',
      amount: 24.65,
      description: 'Supplied by: Oth; : Terminals',
      categoryId: 'electrical',
      notes: '',
      lineItems: [
        { id: '1', description: '[             Supplied by: Oth', amount: 6.99, categoryId: 'misc' },
        { id: '2', description: ': Terminals', amount: 17.66, categoryId: 'misc' },
      ],
      source: 'on-device',
      confidence: 0.9,
      rawText: AMAZON_CABLE_OCR,
      agentReport: 'bad',
      aisUsed: ['forge'],
    })
    expect(fixed.amount).toBeCloseTo(26.13, 1)
    const ship = fixed.lineItems.find((i) => /shipping/i.test(i.description))
    if (ship) expect(ship.amount).toBeLessThan(1)
    const prods = fixed.lineItems.filter((i) => !/ship|fee|tax/i.test(i.description))
    expect(prods.every((p) => descriptionQuality(p.description) >= 10)).toBe(true)
    expect(prods.every((p) => !/supplied\s*by/i.test(p.description))).toBe(true)
    const blob = prods.map((p) => p.description).join(' ').toLowerCase()
    expect(blob).toMatch(/awg|battery|cable|tkdmr|lug/)
  })

  /**
   * User dump R2: multi-item Amazon electrical — shipping was wrongly $433.63 (items subtotal).
   */
  const AMAZON_ELEC_OCR = `
Order Summary
Order placed August 9, 2026      Order # 112-8610033-3484203
Item(s) Subtotal:              $433.63
shipping &                        $0.00
Handling:
Total before tax:                $433.63
Estimated tax to be            $26.02
collected:
Grand Total:                     $459.65
Arriving Wednesday
260Pcs Heat Shrink Wire Connectors Kit - Marine /
Electrical Connectors - Crimp Terminal Set for Elec
Sold by: Ccwoo
$21.98
True MODS 12V Automotive Waterproof 5-Pin Pre
Box Block Kit
Sold by: OnlineLEDStore
$49.99
Blue Sea Systems ST Blade Fuse Block 12 Circuit w
Cover, 100 Amps, 5026
Sold by: Amazon.com
$44.00
IWISS Deutsch DT Series Connector Assortment, Si
Contacts, Waterproof Automotive Electrical Conne
Sold by: iwiss
$46.99
DaierTek 300A Bus Bar 12V Marine 12V Power Dist
Cover 6 x 3/8" (M10) Terminal Studs Max 300V AC
Sold by: DaierTek
$29.99
ALFOCI 482 PCS DT Deustch Connector Kit, 2 3 4 €
Waterproof Automotive Electrical Connectors
Sold by: Henan)
$99.99
250A Relay, 12VDC Continuous Duty SPST 4-pin H
Sold by: IRHAPSODY® Store
$14.99
Blue Sea Systems 3000 HD-Serles Heavy Duty On-Off Battery Switch
$81.70
`

  it('Amazon multi-item: shipping is $0 not $433.63 subtotal; grand $459.65', () => {
    const fixed = resolveFromOcrConstraints(AMAZON_ELEC_OCR, {
      date: '2026-08-09',
      vendor: 'Amazon',
      amount: 459.65,
      description: 'junk',
      categoryId: 'electrical',
      notes: '',
      lineItems: [
        { id: '1', description: 'ALFOCI kit', amount: 99.99, categoryId: 'electrical' },
        { id: 'ship', description: 'Shipping', amount: 433.63, categoryId: 'misc' },
      ],
      source: 'on-device',
      confidence: 0.5,
      rawText: AMAZON_ELEC_OCR,
      agentReport: 'bad ship',
      aisUsed: ['forge'],
    })
    expect(fixed.amount).toBeCloseTo(459.65, 1)
    const ship = fixed.lineItems.find((i) => /shipping/i.test(i.description))
    expect(!ship || ship.amount < 1).toBe(true)
    const prods = fixed.lineItems.filter((i) => !/ship|fee/i.test(i.description))
    expect(prods.length).toBeGreaterThanOrEqual(4)
    expect(prods.every((p) => p.amount < 200)).toBe(true)
    const sum = prods.reduce((s, p) => s + p.amount, 0)
    // Product sum should be near items subtotal, not include fake shipping
    expect(sum).toBeGreaterThan(200)
    expect(sum).toBeLessThan(460)
  })

  it('rejects Supplied by / Terminals as product titles', () => {
    expect(descriptionQuality('[             Supplied by: Oth')).toBe(0)
    expect(descriptionQuality(': Terminals')).toBe(0)
    expect(descriptionQuality('Sold by: TKDMR Store')).toBe(0)
  })

  /**
   * User dump 2026-08-10: Amazon ICP sensor $79.47 + Motorcraft cam sensor $34.97
   * = subtotal $114.44 + tax $6.87 = grand $121.31. Must not glue wrong prices.
   */
  const AMAZON_SENSORS_OCR = `
Order Summary
Order placed August 9, 2026     Order # 113-0833286-9218643
Item(s) Subtotal:
Shipping &
Handling:
Total before tax:
Estimated tax to be
collected:
Grand Total:
$114.44
$0.00
$6.87
$121.31
Arriving Friday
ICP Sensor Fits 7.3 Powerstroke Replaces F6TZ-9F8
Sold by: Stab Motorsports LLC
Supplied by: Other
$79.47
Motorcraft DU-87 Camshaft Position Sensor
Sold by: Amazon.com
supplied by: Other
$34.97
Grand Total:            $121.31
`

  it('Amazon sensors: two products with correct prices; grand $121.31', () => {
    const names = extractProductNamesFromOcr(AMAZON_SENSORS_OCR)
    expect(names.some((n) => /motorcraft/i.test(n))).toBe(true)
    expect(names.some((n) => /icp|powerstroke|sensor/i.test(n))).toBe(true)

    const fixed = resolveFromOcrConstraints(AMAZON_SENSORS_OCR, {
      date: '2026-08-09',
      vendor: 'Amazon',
      amount: 121.31,
      description: 'Motorcraft DU-87 Camshaft Position Sensor',
      categoryId: 'engine',
      notes: '',
      lineItems: [
        {
          id: '1',
          description: 'Motorcraft DU-87 Camshaft Position Sensor',
          amount: 79.47,
          categoryId: 'engine',
        },
      ],
      source: 'on-device',
      confidence: 0.9,
      rawText: AMAZON_SENSORS_OCR,
      agentReport: 'bad pair',
      aisUsed: ['forge'],
    })
    expect(fixed.amount).toBeCloseTo(121.31, 1)
    const prods = fixed.lineItems.filter((i) => !/ship|fee|tax/i.test(i.description))
    expect(prods.length).toBeGreaterThanOrEqual(2)
    const prices = prods.map((p) => p.amount).sort((a, b) => a - b)
    expect(prices).toContain(34.97)
    expect(prices).toContain(79.47)
    const motor = prods.find((p) => /motorcraft/i.test(p.description))
    expect(motor?.amount).toBeCloseTo(34.97, 1)
    const icp = prods.find((p) => /icp|powerstroke|f6tz/i.test(p.description))
    expect(icp?.amount).toBeCloseTo(79.47, 1)
    const sum = prods.reduce((s, p) => s + p.amount, 0)
    expect(sum).toBeCloseTo(114.44, 1)
  })
})
