import { describe, expect, it } from 'vitest'
import { runLineItemsAgent } from './lineItemsAgent'
import { extractVendor } from './merchantAgent'
import { parseReceiptText } from '../localAgent'
import { categorizeText } from './keywords'

/** OCR text captured from user's real bad-scan report (Swag Performance Parts order email). */
const SWAG_OCR = `
6:15 >.
[VITCEVRVITvIeen
12248284469
Your Order Contains...
Cart ltems SKU Qty Item Price Item Total
Items shipped to 8084 little creek rd, Bangor,
Pennsylvania, 18013, US
1994-1997 FORD
7.3L
POWERSTROKE /
RACOR PFF7678
PFF7678 1 $39.97 $39.97
PARFIT FUEL
FILTER KIT
Caterpillar Fuel Filter
1R-0750 For XDP Cat
1R-
1 $26.75 $26.75
0750
Filter Adapter Kits
Subtotal: $66.72
Shipping: $9.95
TN State Sales Tax: $0.00
Grand total: $76.67
Payment method: Credit Card / Debit Card
SWAGPERFORMANCEPARTS
https://swagperformanceparts.com
SWAGPERFORMANCEPARTS is powered by
Bigcommerce. Launch your own store for free with
Bigcommerce.
`

describe('Swag Performance Parts receipt (real user debug scan)', () => {
  it('extracts both product line items and not shipping', () => {
    const lines = runLineItemsAgent(SWAG_OCR)
    expect(lines.items.length).toBeGreaterThanOrEqual(2)
    const amounts = lines.items.map((i) => i.amount).sort((a, b) => a - b)
    expect(amounts).toContain(26.75)
    expect(amounts).toContain(39.97)
    expect(lines.items.every((i) => !/shipping/i.test(i.description))).toBe(true)
    expect(lines.shipping).toBe(9.95)
  })

  it('names products with fuel filter context', () => {
    const lines = runLineItemsAgent(SWAG_OCR)
    const blob = lines.items.map((i) => i.description).join(' ').toLowerCase()
    expect(blob).toMatch(/fuel|filter|racor|caterpillar|ford|powerstroke/)
  })

  it('detects vendor from domain or brand footer', () => {
    const v = extractVendor(SWAG_OCR)
    expect(v.toLowerCase()).toMatch(/swag/)
  })

  it('categorizes fuel filters as tools', () => {
    const { categoryId } = categorizeText('Racor fuel filter kit powerstroke')
    expect(categoryId).toBe('tools')
  })

  it('full parse gets grand total 76.67 and 2+ items', () => {
    const r = parseReceiptText(SWAG_OCR)
    expect(r.amount).toBe(76.67)
    expect(r.lineItems.length).toBeGreaterThanOrEqual(2)
    expect(r.vendor.toLowerCase()).toMatch(/swag/)
  })

  it('council debate log shows agents talking', () => {
    const r = parseReceiptText(SWAG_OCR)
    expect(r.agentReport || '').toMatch(/Council debate|cashier|challenge|hunted|missing|dedupe|Collapsed/i)
    const sums = r.lineItems.reduce((s, i) => s + i.amount, 0)
    // products should approach subtotal 66.72 (39.97+26.75) — not 3x duplicates
    expect(sums).toBeGreaterThanOrEqual(60)
    expect(sums).toBeLessThanOrEqual(70)
    expect(r.lineItems.length).toBeLessThanOrEqual(3)
  })
})
