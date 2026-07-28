/**
 * Noisy OCR dumps — broken line wraps, missing $, OCR garbage, multi-column prices.
 * Ground truth is the real receipt; we assert the team still recovers the important facts.
 */
import { describe, expect, it } from 'vitest'
import { parseReceiptText } from '../localAgent'
import { runLineItemsAgent, isFeeLineItem, isShippingLineItem } from './lineItemsAgent'
import { runTeamHuddle } from './teamHuddle'
import { extractVendor } from './merchantAgent'

function nearly(a: number | null | undefined, b: number, tol = 0.08) {
  if (a == null) return false
  return Math.abs(a - b) <= tol
}

function products(items: { description: string; amount: number }[]) {
  return items.filter((i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description))
}

/** Messy online parts order OCR (like a phone photo of an email) */
const NOISY_ENGINE = `
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
IPD FORGED
PISTON KIT
IPD-PK73 1 $489.00 $489.00
ARP 2000
HEAD STUD
KIT 250-4202
1 $312.50 $312.50
Caterpillar Fuel Filter
1R-0750 For XDP Cat
1 $26.75 $26.75
Subtotal: $828.25
Shipping: $24.95
TN State Sales Tax: $0.00
Grand total: $853.20
Payment method: Credit Card / Debit Card
SWAGPERFORMANCEPARTS
https://swagperformanceparts.com
SWAGPERFORMANCEPARTS is powered by
Bigcommerce.
`

const TRUTH_NOISY_ENGINE = {
  total: 853.2,
  shipping: 24.95,
  products: [489, 312.5, 26.75],
  vendor: /swag/i,
}

/** Thermal receipt with cramped columns and OCR price glitches */
const NOISY_HD = `
H0ME DEP0T #4821
07/20/2026 14:22
SALES ASSOC 09
RIGID F0AM 2IN 4X8
48.97
R0MEX 12/2 W/G 50'
62.40
4GANG METAL B0X
12.88
SUBT0TAL
124.25
SALES TAX
9.94
T0TAL
134.19
VISA CHIP
****4521
AUTH CODE 008821
`

const TRUTH_NOISY_HD = {
  total: 134.19,
  products: [48.97, 62.4, 12.88],
  vendor: /home|depot|hd/i,
}

/** Auto parts counter ticket — parts + fee */
const NOISY_NAPA = `
NAPA AUT0 PARTS
ST0RE 312
07/22/2026
0IL FILTER PH8A        8.99
AIR FILTER 46308      24.55
5W30 SYN 5QT          32.99
SUBTOTAL              66.53
C0NVENIENCE FEE        1.99
TAX                    5.48
T0TAL                 74.00
CASH
`

const TRUTH_NAPA = {
  total: 74.0,
  fee: 1.99,
  products: [8.99, 24.55, 32.99],
  vendor: /napa/i,
}

describe('Noisy OCR — engine parts email', () => {
  it('recovers grand total and shipping', () => {
    const r = parseReceiptText(NOISY_ENGINE)
    expect(nearly(r.amount, TRUTH_NOISY_ENGINE.total), `total got ${r.amount}`).toBe(true)
    const ship = r.lineItems.find((i) => isShippingLineItem(i.description))
    expect(ship && nearly(ship.amount, TRUTH_NOISY_ENGINE.shipping)).toBe(true)
  })

  it('finds all three product amounts', () => {
    const r = parseReceiptText(NOISY_ENGINE)
    const p = products(r.lineItems)
    for (const amt of TRUTH_NOISY_ENGINE.products) {
      expect(p.some((i) => nearly(i.amount, amt)), `missing $${amt} in ${p.map((x) => x.amount)}`).toBe(
        true,
      )
    }
  })

  it('vendor from footer not address garbage', () => {
    const v = extractVendor(NOISY_ENGINE)
    expect(v).toMatch(TRUTH_NOISY_ENGINE.vendor)
    expect(v.toLowerCase()).not.toMatch(/pennsylvania|bangor|little creek/)
  })

  it('category is engine/fuel family not kitchen/bathroom', () => {
    const r = parseReceiptText(NOISY_ENGINE)
    expect(r.categoryId).not.toMatch(/kitchen|bathroom|furniture|solar|windows/)
    expect(
      r.categoryId === 'engine' ||
        r.categoryId === 'fuel' ||
        /engine|fuel|powertrain|filter|piston|parts/i.test(r.categoryId),
    ).toBe(true)
  })
})

describe('Noisy OCR — Home Depot thermal', () => {
  it('total and three line amounts', () => {
    const r = parseReceiptText(NOISY_HD)
    expect(nearly(r.amount, TRUTH_NOISY_HD.total), `total ${r.amount}`).toBe(true)
    const p = products(r.lineItems)
    for (const amt of TRUTH_NOISY_HD.products) {
      expect(p.some((i) => nearly(i.amount, amt)), `missing $${amt} got ${JSON.stringify(p)}`).toBe(
        true,
      )
    }
  })

  it('vendor is Home Depot not VISA CHIP', () => {
    const v = extractVendor(NOISY_HD)
    expect(v).toMatch(TRUTH_NOISY_HD.vendor)
    expect(v.toLowerCase()).not.toMatch(/visa|chip|auth/)
  })

  it('category is electrical/insulation not OCR garbage like r0mex', () => {
    const r = parseReceiptText(NOISY_HD)
    expect(r.categoryId).not.toMatch(/r0mex|0mex|visa/i)
    expect(
      r.categoryId === 'electrical' ||
        r.categoryId === 'insulation' ||
        /electrical|insulation|romex|foam|wire/i.test(r.categoryId),
    ).toBe(true)
  })
})

describe('Noisy OCR — NAPA with convenience fee', () => {
  it('products + fee + total', () => {
    const r = parseReceiptText(NOISY_NAPA)
    expect(nearly(r.amount, TRUTH_NAPA.total), `total ${r.amount}`).toBe(true)
    const fee = r.lineItems.find((i) => isFeeLineItem(i.description))
    expect(fee && nearly(fee.amount, TRUTH_NAPA.fee), `fee ${fee?.amount}`).toBe(true)
    const p = products(r.lineItems)
    for (const amt of TRUTH_NAPA.products) {
      expect(p.some((i) => nearly(i.amount, amt)), `missing $${amt}`).toBe(true)
    }
  })

  it('vendor is NAPA not cash/card', () => {
    const v = extractVendor(NOISY_NAPA)
    expect(v).toMatch(TRUTH_NAPA.vendor)
  })

  it('huddle transcript shows agents talking', () => {
    const r = runTeamHuddle(
      [{ label: 'napa', text: NOISY_NAPA, note: 'noise', ais: ['forge'] }],
      { enabled: () => true },
    )
    expect(r.agentReport || '').toMatch(/huddle|finding|challenge|decision|Cashier|Ledger|Sieve|Quorum/i)
    expect(nearly(r.amount, TRUTH_NAPA.total)).toBe(true)
  })
})

describe('diagnostic dump (always logs summary)', () => {
  it('prints compare table for manual review', () => {
    const cases = [
      { name: 'Engine email', text: NOISY_ENGINE, truth: TRUTH_NOISY_ENGINE },
      { name: 'Home Depot', text: NOISY_HD, truth: TRUTH_NOISY_HD },
      { name: 'NAPA', text: NOISY_NAPA, truth: TRUTH_NAPA },
    ]
    for (const c of cases) {
      const r = parseReceiptText(c.text)
      const li = runLineItemsAgent(c.text)
      // eslint-disable-next-line no-console
      console.log(
        `\n=== ${c.name} ===\n` +
          `vendor: ${r.vendor}\n` +
          `total: ${r.amount} (want ${c.truth.total})\n` +
          `category: ${r.categoryId}\n` +
          `lineItems: ${r.lineItems.map((i) => `${i.description.slice(0, 40)}=$${i.amount}`).join(' | ')}\n` +
          `ledger shipping=${li.shipping} fee=${li.fee}\n`,
      )
    }
    expect(true).toBe(true)
  })
})
