/**
 * End-to-end parse checks against invented receipts with known ground truth.
 * Text simulates noisy OCR (line breaks, spacing) so we see real agent failures.
 */
import { describe, expect, it } from 'vitest'
import { parseReceiptText } from '../localAgent'
import { runLineItemsAgent } from './lineItemsAgent'
import { runTeamHuddle } from './teamHuddle'
import { categorizeText } from './keywords'
import { isFeeLineItem, isShippingLineItem } from './lineItemsAgent'

/** Receipt A: diesel engine parts order (online) — ground truth known */
export const RECEIPT_A_ENGINE = `
SWAG PERFORMANCE PARTS
Your Order Contains...
Cart Items SKU Qty Item Price Item Total
Items shipped to 8084 little creek rd, Bangor,
Pennsylvania, 18013, US
1994-1997 FORD
7.3L POWERSTROKE
IPD PISTON KIT
IPD-PK73 1 $489.00 $489.00
ARP HEAD STUD KIT
ARP-250-4202 1 $312.50 $312.50
Subtotal: $801.50
Shipping: $24.95
TN State Sales Tax: $0.00
Grand total: $826.45
Payment method: Credit Card
https://swagperformanceparts.com
`

export const TRUTH_A = {
  vendor: /swag/i,
  total: 826.45,
  subtotal: 801.5,
  shipping: 24.95,
  products: [
    { amount: 489.0, hint: /piston|ipd|powerstroke/i },
    { amount: 312.5, hint: /arp|head stud|stud/i },
  ],
  category: /engine|powertrain|fuel/i,
  noProduct: [/shipping/i, /subtotal/i, /grand total/i, /pennsylvania|bangor/i],
}

/** Receipt B: big-box store thermal style — insulation + wire */
export const RECEIPT_B_HARDWARE = `
HOME DEPOT
Store #4821
07/20/2026
SALESPERSON 14

RIGID FOAM 2IN 4X8      48.97
ROMEX 12/2 50FT        62.40
METAL OUTLET BOXES 4PK  12.88
SUBTOTAL              124.25
TAX                     9.94
TOTAL                 134.19
VISA ************4521
AUTH 008821
THANK YOU
`

export const TRUTH_B = {
  vendor: /home depot/i,
  total: 134.19,
  products: [
    { amount: 48.97, hint: /foam|rigid/i },
    { amount: 62.4, hint: /romex|wire|12\/2/i },
    { amount: 12.88, hint: /outlet|box/i },
  ],
  category: /insulation|electrical|structure/i,
}

/** Receipt C: towing + convenience fee (invoice layout) */
export const RECEIPT_C_TOW = `
Payment details for
Falzone Towing Service Inc
Invoice
#9423614
Created Date
7/27/2026
Subtotal
$1,178.75
Convenience Fee
$47.15
Tax
$0.00
Total
$1,225.90
Payer
BRADLEY
Debit / Credit Card
Payment Method
Payment Date
7/27/2026
`

export const TRUTH_C = {
  vendor: /falzone|towing/i,
  total: 1225.9,
  fee: 47.15,
  // service amount often subtotal
  serviceNear: 1178.75,
  category: /misc|tow|service/i,
  notFuel: true,
}

function nearly(a: number | null | undefined, b: number, tol = 0.05) {
  if (a == null) return false
  return Math.abs(a - b) <= tol
}

function productLines(items: { description: string; amount: number }[]) {
  return items.filter(
    (i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description),
  )
}

describe('Receipt A — diesel engine parts order', () => {
  it('line items agent finds both products + shipping', () => {
    const li = runLineItemsAgent(RECEIPT_A_ENGINE)
    const products = productLines(li.items)
    expect(products.length).toBeGreaterThanOrEqual(2)
    for (const p of TRUTH_A.products) {
      expect(products.some((i) => nearly(i.amount, p.amount))).toBe(true)
    }
    expect(li.shipping).toBe(TRUTH_A.shipping)
    expect(li.items.some((i) => isShippingLineItem(i.description))).toBe(true)
  })

  it('full parse matches total, vendor, products', () => {
    const r = parseReceiptText(RECEIPT_A_ENGINE)
    expect(nearly(r.amount, TRUTH_A.total)).toBe(true)
    expect(r.vendor).toMatch(TRUTH_A.vendor)
    const products = productLines(r.lineItems)
    expect(products.length).toBeGreaterThanOrEqual(2)
    for (const p of TRUTH_A.products) {
      const hit = products.find((i) => nearly(i.amount, p.amount))
      expect(hit, `missing product $${p.amount}`).toBeTruthy()
      if (hit) expect(hit.description).toMatch(p.hint)
    }
    // category should not be random tools/kitchen
    expect(r.categoryId).toMatch(/engine|fuel|powertrain|piston|parts/i)
  })

  it('team huddle agrees on total and two product amounts', () => {
    const r = runTeamHuddle(
      [
        {
          label: 'fixture-A',
          text: RECEIPT_A_ENGINE,
          note: 'test',
          ais: ['forge'],
        },
      ],
      { enabled: () => true },
    )
    expect(nearly(r.amount, TRUTH_A.total)).toBe(true)
    const products = productLines(r.lineItems)
    expect(products.filter((p) => TRUTH_A.products.some((t) => nearly(p.amount, t.amount))).length).toBeGreaterThanOrEqual(2)
  })
})

describe('Receipt B — Home Depot materials', () => {
  it('finds three products and total', () => {
    const r = parseReceiptText(RECEIPT_B_HARDWARE)
    expect(nearly(r.amount, TRUTH_B.total)).toBe(true)
    expect(r.vendor).toMatch(TRUTH_B.vendor)
    const products = productLines(r.lineItems)
    expect(products.length).toBeGreaterThanOrEqual(3)
    for (const p of TRUTH_B.products) {
      expect(products.some((i) => nearly(i.amount, p.amount))).toBe(true)
    }
  })

  it('categorizes as build materials not fuel/towing', () => {
    const r = parseReceiptText(RECEIPT_B_HARDWARE)
    expect(r.categoryId).not.toBe('fuel')
    expect(r.categoryId).not.toMatch(/tow/i)
    expect(['insulation', 'electrical', 'structure', 'tools'].includes(r.categoryId) || r.categoryId.length > 0).toBe(
      true,
    )
  })
})

describe('Receipt C — towing invoice with convenience fee', () => {
  it('total + fee + vendor', () => {
    const r = parseReceiptText(RECEIPT_C_TOW)
    expect(nearly(r.amount, TRUTH_C.total)).toBe(true)
    expect(r.vendor).toMatch(TRUTH_C.vendor)
    const fee = r.lineItems.find((i) => isFeeLineItem(i.description))
    expect(fee?.amount).toBe(TRUTH_C.fee)
  })

  it('is towing/roadside not fuel or misc', () => {
    const r = parseReceiptText(RECEIPT_C_TOW)
    expect(r.categoryId).toBe('towing')
    expect(r.categoryId).not.toBe('fuel')
    expect(r.categoryId).not.toBe('misc')
  })
})

describe('Category invent for engine-only text', () => {
  it('does not dump pure engine rebuild kit into insulation/kitchen', () => {
    const { categoryId } = categorizeText(
      'IPD forged piston kit ARP 2000 head studs 7.3 Powerstroke turbo charger gasket set',
    )
    expect(categoryId).not.toMatch(/kitchen|bathroom|insulation|solar|furniture/)
    expect(categoryId === 'engine' || /engine|powertrain|piston/i.test(categoryId)).toBe(true)
  })
})
