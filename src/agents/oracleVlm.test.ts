import { describe, expect, it } from 'vitest'
import { oracleToLocalResult, type OracleResult } from './oracleVlm'

describe('oracleToLocalResult', () => {
  it('builds a structured result from vision answers', () => {
    const o: OracleResult = {
      text: `HOME DEPOT
SUBTOTAL 111.37
TAX 8.91
GRAND TOTAL 120.28`,
      answers: [
        { question: 'store?', answer: 'HOME DEPOT' },
        { question: 'total?', answer: '120.28' },
      ],
      vendor: 'HOME DEPOT',
      amount: 120.28,
      date: '2026-07-30',
      subtotal: 111.37,
      tax: 8.91,
      shipping: null,
      fee: null,
      items: [
        {
          id: 'oracle-0',
          description: 'RIGID FOAM',
          amount: 48.97,
          categoryId: 'insulation',
        },
      ],
      device: 'wasm+q8',
      model: 'Xenova/donut-base-finetuned-docvqa',
      confidence: 0.8,
    }
    const r = oracleToLocalResult(o)
    expect(r).not.toBeNull()
    expect(r!.amount).toBeCloseTo(120.28, 1)
    expect(r!.vendor.toLowerCase()).toContain('home depot')
    expect(r!.aisUsed).toContain('oracle')
    expect(r!.lineItems.length).toBeGreaterThanOrEqual(1)
  })

  it('returns null when vision model was unavailable', () => {
    const o: OracleResult = {
      text: '',
      answers: [],
      vendor: '',
      amount: null,
      date: null,
      subtotal: null,
      tax: null,
      shipping: null,
      fee: null,
      items: [],
      device: 'unavailable',
      model: 'x',
      confidence: 0,
      unavailable: true,
    }
    expect(oracleToLocalResult(o)).toBeNull()
  })

  it('invents a service line when only subtotal is known', () => {
    const o: OracleResult = {
      text: 'Falzone Towing\nSUBTOTAL 1178.75\nTOTAL 1225.90',
      answers: [],
      vendor: 'Falzone Towing Service Inc',
      amount: 1225.9,
      date: null,
      subtotal: 1178.75,
      tax: 0,
      shipping: null,
      fee: 47.15,
      items: [],
      device: 'wasm',
      model: 'x',
      confidence: 0.7,
    }
    const r = oracleToLocalResult(o)!
    expect(r.amount).toBeCloseTo(1225.9, 1)
    expect(r.lineItems.some((i) => /service|falzone|goods/i.test(i.description))).toBe(true)
    expect(r.lineItems.some((i) => /fee/i.test(i.description))).toBe(true)
  })
})
