import { describe, expect, it } from 'vitest'
import { emptyReceiptMemory, learnFromPurchase } from '../receiptMemory'
import type { Purchase } from '../types'
import { parseReceiptText } from '../localAgent'
import { runLocalSmartPass } from './localSmartPass'
import type { LocalAgentResult } from './pipeline'

const TOW = `
Payment details for
Falzone Towing Service Inc
Invoice
#9423614
Subtotal
$1,178.75
Convenience Fee
$47.15
Tax
$0.00
Total
$1,225.90
`

describe('localSmartPass', () => {
  it('fills fee and invents towing category on invoice OCR', () => {
    const draft: LocalAgentResult = {
      date: null,
      vendor: '',
      amount: null,
      description: '',
      categoryId: 'misc',
      notes: '',
      lineItems: [],
      source: 'on-device',
      confidence: 0.3,
      rawText: TOW,
    }
    const r = runLocalSmartPass(draft, TOW)
    expect(r.amount).toBe(1225.9)
    expect(r.lineItems.some((i) => /fee/i.test(i.description) && i.amount === 47.15)).toBe(true)
    expect(r.categoryId).toMatch(/tow/i)
    expect(r.categoryId).not.toBe('misc')
  })

  it('uses local memory for known vendor category', () => {
    let mem = emptyReceiptMemory()
    const p: Purchase = {
      id: '1',
      date: '2026-07-01',
      description: 'Tow',
      amount: 100,
      categoryId: 'towing',
      vendor: 'Falzone Towing Service Inc',
      notes: '',
      receiptImageId: null,
      lineItems: [
        { id: '1', description: 'Towing', amount: 90, categoryId: 'towing' },
        { id: '2', description: 'Convenience fee', amount: 10, categoryId: 'misc' },
      ],
      aisUsed: [],
      createdAt: '',
      updatedAt: '',
    }
    mem = learnFromPurchase(mem, p)
    const draft: LocalAgentResult = {
      date: null,
      vendor: 'Falzone',
      amount: 100,
      description: 'Service',
      categoryId: 'misc',
      notes: '',
      lineItems: [{ id: '1', description: 'Service', amount: 100, categoryId: 'misc' }],
      source: 'on-device',
      confidence: 0.4,
      rawText: 'Falzone Towing Service Inc Total 100.00',
    }
    const r = runLocalSmartPass(draft, draft.rawText, mem)
    expect(r.categoryId).toMatch(/tow/i)
  })

  it('full parse + smart path still works on clean tow OCR', () => {
    const r = parseReceiptText(TOW)
    expect(r.amount).toBe(1225.9)
    expect(r.categoryId).toMatch(/tow/i)
  })
})
