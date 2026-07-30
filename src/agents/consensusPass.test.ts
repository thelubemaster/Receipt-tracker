import { describe, expect, it } from 'vitest'
import {
  clusterMoneyVotes,
  dedupeProductsAgainstTotal,
  pickConsensusTotal,
  runConsensusPass,
} from './consensusPass'
import type { LocalAgentResult } from './pipeline'
import type { ReceiptLineItem } from '../types'

function item(desc: string, amount: number, id = desc): ReceiptLineItem {
  return { id, description: desc, amount, categoryId: 'misc' }
}

function draft(partial: Partial<LocalAgentResult> = {}): LocalAgentResult {
  return {
    date: null,
    vendor: 'NAPA',
    amount: 74,
    description: 'parts',
    categoryId: 'misc',
    notes: '',
    lineItems: [
      item('5W30 SYN 5QT', 32.99),
      item('AIR FILTER', 24.55),
      item('OIL FILTER PH8', 8.99),
      item('Convenience fee', 1.99),
    ],
    subtotal: 66.53,
    tax: 5.48,
    source: 'on-device',
    confidence: 0.5,
    rawText: 'NAPA\nTOTAL 74.00\nSUBTOTAL 66.53\nTAX 5.48\nCONVENIENCE FEE 1.99',
    ...partial,
  }
}

describe('consensusPass', () => {
  it('clusters close money amounts into one vote', () => {
    const c = clusterMoneyVotes([74, 74.0, 73.99, 10], [3, 3, 1, 1])
    expect(c[0].value).toBeCloseTo(74, 1)
    expect(c[0].count).toBeGreaterThanOrEqual(2)
  })

  it('picks total supported by products+fee+tax', () => {
    const items = [
      item('5W30', 32.99),
      item('AIR FILTER', 24.55),
      item('OIL FILTER', 8.99),
      item('Convenience fee', 1.99),
    ]
    // Wrong draft total 72.01 (classic subtotal+tax without fee)
    const pick = pickConsensusTotal({
      draftTotal: 72.01,
      draftSubtotal: 66.53,
      draftTax: 5.48,
      items,
      pathTotals: [74, 72.01, 74],
      ocrTotals: [74],
    })
    expect(pick.total).toBeCloseTo(74, 1)
    expect(pick.agreement).toBeGreaterThanOrEqual(2)
  })

  it('removes duplicate product lines that overshoot total', () => {
    const items = [
      item('ROMEX 12/2', 62.4, '1'),
      item('ROMEX 12/2', 62.4, '2'), // OCR dupe
      item('METAL BOX', 12.88, '3'),
    ]
    const { items: out, removed } = dedupeProductsAgainstTotal(items, 75.28)
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(out.filter((i) => /ROMEX/i.test(i.description))).toHaveLength(1)
  })

  it('runConsensusPass upgrades wrong total when paths agree', () => {
    const base = draft({ amount: 72.01, confidence: 0.45 })
    const pathA = draft({ amount: 74 })
    const pathB = draft({ amount: 74, vendor: 'NAPA AUTO' })
    const pathC = draft({ amount: 72.01 })
    const out = runConsensusPass(base, [pathA, pathB, pathC], base.rawText)
    expect(out.amount).toBeCloseTo(74, 1)
    expect(out.confidence).toBeGreaterThan(0.5)
    expect(out.agentReport).toMatch(/CONSENSUS/i)
  })

  it('votes vendor when multiple paths share a store name', () => {
    const base = draft({ vendor: 'VISA', amount: 74 })
    const paths = [
      draft({ vendor: 'HOME DEPOT', amount: 74 }),
      draft({ vendor: 'Home Depot', amount: 74 }),
      draft({ vendor: 'VISA CHIP', amount: 74 }),
    ]
    const out = runConsensusPass(base, paths, 'HOME DEPOT\nTOTAL 74.00')
    expect(out.vendor?.toLowerCase()).toMatch(/home depot/)
  })
})
