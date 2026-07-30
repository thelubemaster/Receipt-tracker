import { describe, expect, it } from 'vitest'
import { formatScanDebugText } from './debugReport'

describe('formatScanDebugText', () => {
  it('includes OCR, ais, totals for pasting into chat', () => {
    const text = formatScanDebugText({
      userNote: 'Total wrong',
      suggestion: {
        vendor: 'HOME DEPOT',
        amount: 120.28,
        date: '2026-07-30',
        description: 'foam',
        categoryId: 'insulation',
        notes: 'Engine',
        lineItems: [{ id: '1', description: 'RIGID FOAM', amount: 48.97, categoryId: 'insulation' }],
        subtotal: 111.37,
        tax: 8.91,
        aisUsed: ['forge', 'ledger', 'cashier'],
        activeAiLabel: 'Answer from Quorum · OCR Forge',
        confidence: 0.8,
        rawText: 'HOME DEPOT\nTOTAL 120.28',
        agentReport: 'Actually ran: Forge, Ledger',
        fieldSources: { primary: 'quorum', ocr: 'forge' },
      },
      form: {
        vendor: 'HOME DEPOT',
        amount: '120.28',
        date: '2026-07-30',
        description: 'foam',
        categoryId: 'insulation',
        notes: '',
        lineItems: [{ id: '1', description: 'RIGID FOAM', amount: 48.97, categoryId: 'insulation' }],
      },
    })
    expect(text).toContain('SCHOOLIE SCAN DEBUG')
    expect(text).toContain('Total wrong')
    expect(text).toContain('HOME DEPOT')
    expect(text).toContain('120.28')
    expect(text).toContain('RAW OCR')
    expect(text).toContain('TOTAL 120.28')
    expect(text).toContain('forge')
    expect(text).toContain('FULL AGENT REPORT')
  })
})
