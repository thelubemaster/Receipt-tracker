import { describe, expect, it } from 'vitest'
import { banFromRejected, runReceiptEngine } from './receiptEngine'
import { linesFromGlyphs, normalizeToLines } from './layoutText'

describe('layoutText', () => {
  it('groups glyphs into visual lines by Y', () => {
    const lines = linesFromGlyphs([
      { str: 'HOME', x: 10, y: 100 },
      { str: 'DEPOT', x: 50, y: 100 },
      { str: 'TOTAL', x: 10, y: 40 },
      { str: '12.50', x: 80, y: 41 },
    ])
    expect(lines.length).toBe(2)
    expect(lines[0].text).toMatch(/HOME/)
    expect(lines[1].text).toMatch(/TOTAL/)
    expect(lines[1].text).toMatch(/12\.50/)
  })

  it('joins label + amount orphan lines', () => {
    const lines = normalizeToLines('SUBTOTAL\n48.97\nTAX\n4.12\nTOTAL\n53.09')
    expect(lines.some((l) => /SUBTOTAL.*48\.97/i.test(l))).toBe(true)
    expect(lines.some((l) => /TOTAL.*53\.09/i.test(l))).toBe(true)
  })
})

describe('receiptEngine', () => {
  it('reads a clean store receipt', () => {
    const text = `
HOME DEPOT #4821
RIGID FOAM 1IN 48.97
ROMEX 12/2 62.40
SUBTOTAL 111.37
TAX 8.91
TOTAL 120.28
`
    const r = runReceiptEngine(text)
    expect(r.amount).toBeCloseTo(120.28, 1)
    expect(r.vendor.toLowerCase()).toContain('home depot')
    expect(r.subtotal).toBeCloseTo(111.37, 1)
    expect(r.tax).toBeCloseTo(8.91, 1)
    expect(r.lineItems.length).toBeGreaterThanOrEqual(2)
  })

  it('does not return a banned total on retry', () => {
    const text = `
NAPA AUTO
OIL FILTER 8.99
SUBTOTAL 72.01
TAX 1.99
TOTAL 74.00
GRAND TOTAL 74.00
`
    const ban = banFromRejected({ amount: 72.01, marks: { total: 'wrong', vendor: 'unset' } })
    const r = runReceiptEngine(text, { ban })
    expect(r.amount).not.toBeCloseTo(72.01, 1)
    expect(r.amount).toBeCloseTo(74.0, 1)
  })

  it('finds fee from arithmetic', () => {
    const text = `
INVOICE
Towing service 150.00
SUBTOTAL 150.00
TAX 0.00
CONVENIENCE FEE
12.00
TOTAL 162.00
`
    const r = runReceiptEngine(text)
    expect(r.amount).toBeCloseTo(162, 1)
    const fee = r.lineItems.find((i) => /fee/i.test(i.description))
    expect(fee?.amount).toBeCloseTo(12, 1)
  })
})
