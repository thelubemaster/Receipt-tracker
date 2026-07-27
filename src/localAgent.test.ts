import { describe, expect, it } from 'vitest'
import {
  categorizeText,
  extractAmount,
  extractDate,
  extractVendor,
  parseReceiptText,
} from './localAgent'

const SAMPLE = `
HOME DEPOT
Store #1234
07/15/2026

RIGID FOAM 2IN          48.97
ROMEX 12/2 50FT         62.40
SUBTOTAL               111.37
TAX                      8.91
TOTAL                  120.28
VISA ****1234
THANK YOU
`

describe('localAgent parse', () => {
  it('extracts total amount preferring TOTAL line', () => {
    expect(extractAmount(SAMPLE)).toBe(120.28)
  })

  it('extracts date', () => {
    expect(extractDate(SAMPLE)).toBe('2026-07-15')
  })

  it('extracts vendor', () => {
    expect(extractVendor(SAMPLE).toLowerCase()).toContain('home depot')
  })

  it('categorizes insulation/electrical materials', () => {
    const { categoryId } = categorizeText(SAMPLE)
    expect(['insulation', 'electrical', 'structure']).toContain(categoryId)
  })

  it('builds a full suggestion', () => {
    const r = parseReceiptText(SAMPLE)
    expect(r.source).toBe('on-device')
    expect(r.amount).toBe(120.28)
    expect(r.confidence).toBeGreaterThan(0.5)
    expect(r.description.length).toBeGreaterThan(3)
  })
})
