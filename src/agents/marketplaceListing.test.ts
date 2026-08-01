import { describe, expect, it } from 'vitest'
import { extractDate, extractListingDescription, extractVendor } from './merchantAgent'
import {
  critiqueParse,
  descriptionQuality,
  reasonAboutReceipt,
  vendorQuality,
} from './receiptReasoner'
import type { LocalAgentResult } from './pipeline'

/** Phone screenshot of a private-sale / Marketplace post (garbled OCR). */
const LISTING_OCR = `
SN  Ok  Sola
TX Dushin Mowrer Oma selling
or 499 Tovecnodoned Bus
NIN A HVBDADMKAR 23155 To
Dredly Cope = Lc 150.09
Ao loss.
Bradley Carport
V26/2026
~~ Dustin Mowe
aurer om Selling
TT Dustin Mowe
oe 499 Trverenadtono
NIN A HVBDARBM KARZ
Dredly Cap. Jue
Aolloss.
Gurer Ou Selling
nad Bus
XH213255 Jo
Loc   150.00
Bradley Corpert
V26/2026
TT Dustin Maurer Gm selling
co 499 Tevernadioned Bus
brody Coot 3c 7150.00
`

function badDraft(): LocalAgentResult {
  return {
    date: '2026-08-01',
    vendor: 'NIN A HVBDARBM KARZ',
    amount: 150,
    description:
      'TT Dustin Mowe oe 499 Trverenadtono NIN A HVBDARBM KARZ Dredly Cap. Jue Aolloss. Gurer Ou Selling na',
    categoryId: 'engine',
    notes: '',
    lineItems: [
      {
        id: '1',
        description:
          'TT Dustin Mowe oe 499 Trverenadtono NIN A HVBDARBM KARZ Dredly Cap. Jue Aolloss. Gurer Ou Selling na',
        amount: 150,
        categoryId: 'engine',
      },
    ],
    subtotal: null,
    tax: null,
    source: 'on-device',
    confidence: 0.98,
    rawText: LISTING_OCR,
    agentReport: 'bad',
    aisUsed: ['mosaic'],
  }
}

describe('marketplace / private-sale listing OCR', () => {
  it('rejects OCR-soup vendor strings', () => {
    expect(vendorQuality('NIN A HVBDARBM KARZ')).toBeLessThan(4)
    expect(vendorQuality('Amazon')).toBeGreaterThan(8)
    expect(vendorQuality('150.00')).toBe(0)
  })

  it('extracts private-sale vendor and listing title', () => {
    const v = extractVendor(LISTING_OCR)
    expect(v.toLowerCase()).toMatch(/private sale|dustin/)
    expect(v.toLowerCase()).not.toMatch(/hvbd|karz/)
    const d = extractListingDescription(LISTING_OCR)
    expect(d).toBeTruthy()
    expect(d!.toLowerCase()).toMatch(/bus|dustin/)
  })

  it('reads V26/2026 as a July date (7→V OCR)', () => {
    const d = extractDate(LISTING_OCR)
    expect(d).toBe('2026-07-26')
  })

  it('reasoner rebuilds garbage listing into clean private-sale answer', async () => {
    const c = critiqueParse(badDraft(), LISTING_OCR)
    expect(c.ok).toBe(false)
    expect(
      c.issues.some((i) =>
        ['weak-vendor', 'garbage-description'].includes(i.code),
      ),
    ).toBe(true)

    const { result, repaired } = await reasonAboutReceipt(badDraft(), LISTING_OCR, {
      allowLlm: false,
    })
    expect(repaired).toBe(true)
    expect(result.amount).toBeCloseTo(150, 1)
    expect(vendorQuality(result.vendor)).toBeGreaterThanOrEqual(4)
    expect(result.vendor.toLowerCase()).toMatch(/private sale|dustin|bradley/)
    expect(descriptionQuality(result.lineItems[0]?.description || '')).toBeGreaterThanOrEqual(12)
    expect(result.lineItems[0]?.description.toLowerCase()).toMatch(/bus|dustin|sale|mower/)
    expect(result.lineItems[0]?.description.toLowerCase()).not.toMatch(/hvbdarbm/)
  })
})
