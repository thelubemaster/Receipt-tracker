import { describe, expect, it } from 'vitest'
import { parseReceiptText } from '../localAgent'
import { extractVendor } from './merchantAgent'
import { runLineItemsAgent } from './lineItemsAgent'

const TOW_OCR = `
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

describe('Falzone towing invoice (user debug)', () => {
  it('detects towing company as vendor not payer', () => {
    const v = extractVendor(TOW_OCR)
    expect(v.toLowerCase()).toMatch(/falzone|towing/)
  })

  it('does not treat subtotal/total/fees as product catalog junk', () => {
    const lines = runLineItemsAgent(TOW_OCR)
    // Should not list Total / Subtotal / Payment Date as products
    expect(lines.items.every((i) => !/^(subtotal|total|payment date|created date)$/i.test(i.description.trim()))).toBe(
      true,
    )
  })

  it('full parse recognizes towing service amount', () => {
    const r = parseReceiptText(TOW_OCR)
    expect(r.amount).toBe(1225.9)
    expect(r.vendor.toLowerCase()).toMatch(/falzone|towing/)
    // Prefer a service line near subtotal, not "convenience fee" alone as the story
    const blob = `${r.description} ${r.lineItems.map((i) => i.description).join(' ')}`.toLowerCase()
    expect(blob).toMatch(/tow|falzone|service/)
  })
})
