import { describe, expect, it } from 'vitest'
import { normalizeOcrText } from './normalizeOcrText'

describe('normalizeOcrText', () => {
  it('fixes total / subtotal / convenience fee zeros', () => {
    const n = normalizeOcrText('SUBT0TAL 66.53\nC0NVENIENCE FEE 1.99\nT0TAL 74.00')
    expect(n).toMatch(/SUBTOTAL/)
    expect(n).toMatch(/CONVENIENCE FEE/)
    expect(n).toMatch(/TOTAL 74/)
    expect(n).not.toMatch(/T0TAL|C0NVENIENCE|SUBT0TAL/)
  })

  it('fixes Home Depot and product OCR zeros', () => {
    const n = normalizeOcrText("H0ME DEP0T #4821\nR0MEX 12/2\nRIGID F0AM\n4GANG METAL B0X")
    expect(n).toMatch(/HOME DEPOT/)
    expect(n).toMatch(/ROMEX/)
    expect(n).toMatch(/FOAM/)
    expect(n).toMatch(/BOX/)
  })

  it('fixes 0IL and AUT0 without breaking part codes', () => {
    const n = normalizeOcrText('NAPA AUT0 PARTS\n0IL FILTER PH8A\n5W30 SYN 5QT')
    expect(n).toMatch(/AUTO PARTS/)
    expect(n).toMatch(/OIL FILTER/)
    expect(n).toMatch(/5W30/) // zeros in oil grade stay
  })

  it('does not mangle plain money amounts', () => {
    const n = normalizeOcrText('Item 10.00\nTax 1.00\nTotal 11.00')
    expect(n).toContain('10.00')
    expect(n).toContain('1.00')
    expect(n).toContain('11.00')
  })

  it('fixes letter-O in money tokens', () => {
    const n = normalizeOcrText('$48.9O and 1O.99')
    expect(n).toMatch(/48\.90/)
    expect(n).toMatch(/10\.99/)
  })
})
