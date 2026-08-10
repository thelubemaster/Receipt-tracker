import { describe, expect, it } from 'vitest'
import { formatProjectDebugText, formatScanDebugText } from './debugReport'

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
    expect(text).toContain('PROJECT COST TRACKER SCAN DEBUG')
    expect(text).toContain('Total wrong')
    expect(text).toContain('HOME DEPOT')
    expect(text).toContain('120.28')
    expect(text).toContain('RAW OCR')
    expect(text).toContain('TOTAL 120.28')
    expect(text).toContain('forge')
    expect(text).toContain('FULL AGENT REPORT')
  })
})

describe('formatProjectDebugText', () => {
  it('lists every receipt and AI dumps for the project', () => {
    const text = formatProjectDebugText({
      projectName: 'School bus',
      projectId: 'p1',
      purchases: [
        {
          id: 'r1',
          date: '2026-08-01',
          vendor: 'AutoZone',
          amount: 365.2,
          description: 'batteries',
          categoryId: 'electrical',
          notes: '',
          lineItems: [
            { id: '1', description: 'Battery', amount: 174.99, categoryId: 'electrical' },
          ],
          aisUsed: ['forge'],
          scanDebug: {
            capturedAt: '2026-08-01T12:00:00.000Z',
            rawText: 'AUTOZONE\nSALE TOTAL 365.20',
            agentReport: 'Actually ran: Forge',
            confidence: 0.7,
            aiAnswer: {
              vendor: 'utoZone',
              amount: 22,
              description: 'core',
              lineItems: [],
            },
          },
        },
        {
          id: 'r2',
          date: '2026-08-02',
          vendor: 'Manual',
          amount: 10,
          description: 'tape',
          categoryId: 'misc',
          notes: '',
          lineItems: [],
          aisUsed: [],
          scanDebug: null,
        },
      ],
    })
    expect(text).toContain('PROJECT COST TRACKER DATA')
    expect(text).toContain('School bus')
    expect(text).toContain('AutoZone')
    expect(text).toContain('SALE TOTAL 365.20')
    expect(text).toContain('utoZone')
    expect(text).toContain('none saved')
    expect(text).toContain('Scan dumps saved: 1/2')
  })
})
