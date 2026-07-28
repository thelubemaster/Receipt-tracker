import { describe, expect, it } from 'vitest'
import {
  attachOrphanPrices,
  clusterWordsIntoRows,
  foldDescriptionBlocks,
  reconstructDocumentText,
  rowToLayoutLine,
  type OcrWordBox,
  type LayoutLine,
} from './layoutReconstruct'
import { runLineItemsAgent } from './lineItemsAgent'

function w(text: string, x0: number, y0: number, x1?: number, y1?: number): OcrWordBox {
  return {
    text,
    x0,
    y0,
    x1: x1 ?? x0 + text.length * 8,
    y1: y1 ?? y0 + 14,
    confidence: 90,
  }
}

describe('layout reconstruct — document rows', () => {
  it('clusters words on the same visual row and keeps price on the right', () => {
    const words = [
      w('FORD', 10, 100),
      w('FILTER', 60, 102),
      w('KIT', 130, 101),
      w('$39.97', 320, 100),
      w('CAT', 10, 140),
      w('FILTER', 50, 142),
      w('$26.75', 320, 141),
    ]
    const { text, lines } = reconstructDocumentText(words, 400)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(text).toMatch(/39\.97/)
    expect(text).toMatch(/26\.75/)
    // each product should share a line with its price after reconstruction
    const withPrice = lines.filter((l) => /[A-Za-z]{3,}/.test(l.text) && /\d+\.\d{2}/.test(l.text))
    expect(withPrice.length).toBeGreaterThanOrEqual(2)
  })

  it('attaches orphan prices sitting below multi-line product names', () => {
    const words = [
      w('1994-1997', 10, 80),
      w('FORD', 100, 80),
      w('POWERSTROKE', 10, 100),
      w('RACOR', 10, 120),
      w('PFF7678', 80, 120),
      w('1', 280, 145),
      w('$39.97', 300, 145),
      w('$39.97', 360, 145),
      w('Caterpillar', 10, 180),
      w('Fuel', 100, 180),
      w('Filter', 140, 180),
      w('1', 280, 210),
      w('$26.75', 300, 210),
      w('$26.75', 360, 210),
      w('Subtotal', 10, 250),
      w('$66.72', 320, 250),
    ]
    const { text } = reconstructDocumentText(words, 420)
    const items = runLineItemsAgent(text)
    expect(items.items.length).toBeGreaterThanOrEqual(2)
    const amounts = items.items.map((i) => i.amount).sort((a, b) => a - b)
    expect(amounts).toContain(26.75)
    expect(amounts).toContain(39.97)
    const blob = items.items.map((i) => i.description).join(' ').toLowerCase()
    expect(blob).toMatch(/ford|racor|caterpillar|fuel|filter|powerstroke/)
  })

  it('row clustering tolerates slight Y jitter', () => {
    const rows = clusterWordsIntoRows([
      w('A', 0, 10, 10, 24),
      w('B', 20, 12, 30, 26),
      w('C', 0, 40, 10, 54),
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0].map((x) => x.text).join('')).toMatch(/A|B/)
  })

  it('attachOrphanPrices merges price-only band into description above', () => {
    const lines: LayoutLine[] = [
      {
        text: 'PARFIT FUEL FILTER KIT',
        yMid: 100,
        x0: 10,
        x1: 200,
        words: [w('PARFIT', 10, 95)],
        hasRightPrice: false,
        amount: null,
      },
      {
        text: '$39.97',
        yMid: 120,
        x0: 300,
        x1: 360,
        words: [w('$39.97', 300, 115)],
        hasRightPrice: true,
        amount: 39.97,
      },
    ]
    const fixed = attachOrphanPrices(lines, 400)
    expect(fixed.length).toBe(1)
    expect(fixed[0].text).toMatch(/39\.97/)
    expect(fixed[0].text).toMatch(/FILTER/)
  })

  it('foldDescriptionBlocks joins multi-line names into priced rows', () => {
    const lines: LayoutLine[] = [
      {
        text: '1994-1997 FORD',
        yMid: 80,
        x0: 10,
        x1: 150,
        words: [],
        hasRightPrice: false,
      },
      {
        text: 'POWERSTROKE RACOR',
        yMid: 100,
        x0: 10,
        x1: 180,
        words: [],
        hasRightPrice: false,
      },
      {
        text: 'PFF7678 1 $39.97 $39.97',
        yMid: 120,
        x0: 10,
        x1: 360,
        words: [],
        hasRightPrice: true,
        amount: 39.97,
      },
    ]
    const folded = foldDescriptionBlocks(lines)
    expect(folded.length).toBe(1)
    expect(folded[0].text).toMatch(/FORD/)
    expect(folded[0].text).toMatch(/39\.97/)
  })

  it('rowToLayoutLine sorts left to right', () => {
    const line = rowToLayoutLine([w('KIT', 100, 10), w('FUEL', 10, 10), w('12.00', 300, 10)], 400)
    expect(line.text.toLowerCase().indexOf('fuel')).toBeLessThan(line.text.toLowerCase().indexOf('kit'))
  })
})
