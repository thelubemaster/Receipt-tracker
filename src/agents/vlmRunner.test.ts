import { describe, expect, it } from 'vitest'
import { parseVlmExtract, vlmResultToLocal, type VlmRunResult } from './vlmRunner'
import { VLM_MODELS } from './vlmModels'

describe('VLM model registry', () => {
  it('includes all requested vision models', () => {
    const ids = VLM_MODELS.map((m) => m.aiId)
    expect(ids).toContain('qwen25vl')
    expect(ids).toContain('qwen3vl')
    expect(ids).toContain('rolmocr')
    expect(ids).toContain('gotocr')
    expect(ids).toContain('smolvlm')
    expect(ids).toContain('internvl')
    expect(ids).toContain('deepseekocr')
  })
})

describe('parseVlmExtract', () => {
  it('parses JSON receipt extraction', () => {
    const raw = JSON.stringify({
      vendor: 'Home Depot',
      date: '2026-07-30',
      total: 120.28,
      subtotal: 111.37,
      tax: 8.91,
      items: [
        { description: 'Rigid foam', amount: 48.97 },
        { description: 'Romex', amount: 62.4 },
      ],
      raw_text: 'HOME DEPOT TOTAL 120.28',
    })
    const e = parseVlmExtract(raw)
    expect(e?.vendor).toMatch(/Home Depot/i)
    expect(e?.total).toBeCloseTo(120.28, 1)
    expect(e?.items.length).toBe(2)
  })

  it('handles fenced JSON', () => {
    const raw = '```json\n{"vendor":"NAPA","total":74.00,"items":[]}\n```'
    const e = parseVlmExtract(raw)
    expect(e?.vendor).toBe('NAPA')
    expect(e?.total).toBeCloseTo(74, 1)
  })
})

describe('vlmResultToLocal', () => {
  it('maps extract to LocalAgentResult', () => {
    const r: VlmRunResult = {
      aiId: 'qwen25vl',
      label: 'Qwen2.5-VL',
      modelId: 'Qwen/Qwen2.5-VL-7B-Instruct',
      extract: {
        vendor: 'Swag',
        date: '2026-07-30',
        total: 76.67,
        subtotal: 66.72,
        tax: 0,
        shipping: 9.95,
        fee: null,
        items: [{ description: 'Fuel filter', amount: 39.97 }],
        raw_text: 'Grand total 76.67',
      },
      text: 'Swag\nTOTAL 76.67',
      confidence: 0.85,
      ok: true,
      message: 'ok',
    }
    const local = vlmResultToLocal(r)!
    expect(local.amount).toBeCloseTo(76.67, 1)
    expect(local.aisUsed).toContain('qwen25vl')
    expect(local.lineItems.some((i) => /shipping/i.test(i.description))).toBe(true)
  })
})
