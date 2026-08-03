import { describe, expect, it } from 'vitest'
import { categorizeText } from './keywords'
import {
  extractPricedCatalogLines,
  reasonAboutReceipt,
  resolveFromOcrConstraints,
} from './receiptReasoner'
import { extractVendor } from './merchantAgent'
import type { LocalAgentResult } from './pipeline'

/** Garbled AutoZone multi-pass OCR (shape from project dump / scan debug). */
const AUTOZONE_OCR = `
utoZone 01874
857 NAZARETH PIKE
NAZARETH, PA
(610)614-1620
#000097512 31-950                174.99 P
Duralast HD Battery, EA
#000097512 CORE CHARGE           22.00 P
CORE TRADE-IN -  @1/22.00
#000097512 CORE TRADE-IN         22.00 P
#000097512 31-950                174.99 P
Duralast HD Battery, EA
#000097512 CORE CHARGE           22.00 P
#000097512 CORE TRADE-IN         22.00 P
#000089986 CORE TRADE-IN         10.00
Green Recycled Battery, EA
#000249149 BTP-1                   1.99 P
AGS Battery Terminal and Cable Protector
SUBTOTAL $353.96
STATE TAX @ 6.000% $21.24
SALE TOTAL $365.20
DEBIT $365.20
DATE 08/01/2026 11:25
`

function junkDraft(): LocalAgentResult {
  return {
    date: '2022-01-81',
    vendor: 'AGS Battery Terminal and',
    amount: 365.2,
    description: 'CORE - TRADE-IN; STATE - TAX; SALE - TOTAL',
    categoryId: 'core-parts',
    notes: 'even-split invent',
    lineItems: [
      { id: '1', description: 'CORE - TRADE-IN', amount: 40.57, categoryId: 'core-parts' },
      { id: '2', description: 'STATE - TAX 2 6.0002', amount: 40.57, categoryId: 'state' },
      { id: '3', description: 'SALE - TOTAL -20', amount: 40.57, categoryId: 'sale' },
      { id: '4', description: 'CORE - CHARGE ite fl', amount: 40.57, categoryId: 'core-parts' },
      { id: '5', description: 'ROHR - CORE CHARGE 22.00 P', amount: 40.57, categoryId: 'rohr-parts' },
      { id: '6', description: 'CORE - CHARGE M1000', amount: 40.57, categoryId: 'core-parts' },
      { id: '7', description: 'STATE - TAX a 6.0005 a', amount: 40.57, categoryId: 'state' },
      { id: '8', description: 'SALE - TOTAL', amount: 40.57, categoryId: 'sale' },
      { id: '9', description: 'STATE - TAX 2 6.000%', amount: 40.64, categoryId: 'state' },
    ],
    subtotal: null,
    tax: null,
    source: 'on-device',
    confidence: 0.72,
    rawText: AUTOZONE_OCR,
    agentReport: 'junk',
    aisUsed: ['hammer'],
  }
}

describe('AutoZone receipt — real money, no invented words', () => {
  it('detects AutoZone vendor', () => {
    expect(extractVendor(AUTOZONE_OCR).toLowerCase()).toBe('autozone')
  })

  it('does not invent categories from CORE / STATE / SALE tokens', () => {
    expect(categorizeText('CORE - TRADE-IN').categoryId).toBe('misc')
    expect(categorizeText('STATE TAX 6.000%').categoryId).toBe('misc')
    expect(categorizeText('SALE TOTAL').categoryId).toBe('misc')
    expect(categorizeText('Duralast HD Battery').categoryId).not.toBe('core-parts')
  })

  it('extracts priced products and core charge/trade-in as real money', () => {
    const rows = extractPricedCatalogLines(AUTOZONE_OCR, { grandTotal: 365.2 })
    const products = rows.filter((r) => r.kind === 'product')
    const charges = rows.filter((r) => r.kind === 'core-charge')
    const trades = rows.filter((r) => r.kind === 'core-trade-in')
    expect(products.some((p) => p.price === 174.99)).toBe(true)
    expect(charges.some((c) => c.price === 22)).toBe(true)
    expect(trades.some((t) => t.price === 22 || t.price === 10)).toBe(true)
    // Never treat tax/total as catalog product
    expect(products.every((p) => !/state\s*tax|sale\s*total/i.test(p.name))).toBe(true)
  })

  it('reasoner replaces even-split junk with real lines + core money', async () => {
    const { result, repaired } = await reasonAboutReceipt(junkDraft(), AUTOZONE_OCR, {
      allowLlm: false,
    })
    expect(repaired).toBe(true)
    expect(result.vendor.toLowerCase()).toBe('autozone')
    expect(result.amount).toBeCloseTo(365.2, 1)

    const descs = result.lineItems.map((i) => i.description.toLowerCase())
    // No invented even-split tax/total product names
    expect(descs.some((d) => d.includes('state') && d.includes('tax'))).toBe(false)
    expect(descs.some((d) => d.includes('sale') && d.includes('total'))).toBe(false)
    // Core is real money labels
    expect(descs.some((d) => d === 'core charge' || d.includes('core charge'))).toBe(true)
    expect(descs.some((d) => d.includes('core trade-in'))).toBe(true)
    // Real product signal
    expect(
      descs.some((d) => d.includes('battery') || d.includes('duralast') || d.includes('btp')),
    ).toBe(true)
    // No even-split $40.57 inventions
    expect(result.lineItems.every((i) => Math.abs(Math.abs(i.amount) - 40.57) > 0.5)).toBe(true)
    // Trade-in is money back (negative or labeled)
    const trade = result.lineItems.find((i) => /trade-in/i.test(i.description))
    expect(trade).toBeTruthy()
    expect(trade!.amount).toBeLessThan(0)
  })

  it('constraint resolve prefers AutoZone + catalog over AGS vendor', () => {
    const fixed = resolveFromOcrConstraints(AUTOZONE_OCR, junkDraft())
    expect(fixed.vendor.toLowerCase()).toBe('autozone')
    expect(fixed.lineItems.some((i) => /core charge/i.test(i.description))).toBe(true)
  })
})
