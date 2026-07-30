import { describe, expect, it } from 'vitest'
import { parseMoneyTokens } from './moneyParse'

describe('parseMoneyTokens OCR noise', () => {
  it('reads O as zero in amounts', () => {
    expect(parseMoneyTokens('TOTAL $12.9O')).toContain(12.9)
    expect(parseMoneyTokens('1O.99')).toContain(10.99)
  })

  it('reads l as 1 after $', () => {
    expect(parseMoneyTokens('$l2.50')).toContain(12.5)
  })

  it('still parses clean money', () => {
    expect(parseMoneyTokens('TOTAL 134.19')).toEqual([134.19])
    expect(parseMoneyTokens('Subtotal 48.97 TAX 4.12')).toEqual([48.97, 4.12])
  })
})
