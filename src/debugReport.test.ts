import { describe, expect, it } from 'vitest'
import {
  compactAgentReport,
  compactOcrText,
  formatProjectDebugText,
  formatScanDebugText,
} from './debugReport'

describe('compact helpers', () => {
  it('truncates long OCR with head and tail', () => {
    const big = `${'A'.repeat(2000)}\nTOTAL 99.00\n${'B'.repeat(2000)}`
    const c = compactOcrText(big, 500)
    expect(c.length).toBeLessThan(600)
    expect(c).toMatch(/chars cut for Termux/)
    expect(c.startsWith('A')).toBe(true)
    expect(c.endsWith('B')).toBe(true)
  })

  it('strips [finding] huddle spam from agent reports', () => {
    const report = [
      'WHO ANSWERED: Quorum',
      '[finding] mosaic: I read 42 lines, 7 money tokens. Score 156.',
      '[finding] hammer: I read 39 lines. Score 149.',
      '[decision] quorum: Final: 2 items, total $26.13',
      'REASONER: repair passes consistency checks',
    ].join('\n')
    const c = compactAgentReport(report)
    expect(c).toContain('WHO ANSWERED')
    expect(c).toContain('[decision]')
    expect(c).toContain('REASONER')
    expect(c).not.toMatch(/I read 42 lines/)
  })
})

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
        agentReport: 'Actually ran: Forge, Ledger\n[finding] skip me\nREASONER: ok',
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
    expect(text).toContain('COST TRACKER SCAN')
    expect(text).toContain('Total wrong')
    expect(text).toContain('HOME DEPOT')
    expect(text).toContain('120.28')
    expect(text).toContain('OCR')
    expect(text).toContain('TOTAL 120.28')
    expect(text).toContain('forge')
    expect(text).toContain('REPORT')
    expect(text).not.toContain('skip me')
    expect(text.length).toBeLessThan(4000)
  })
})

describe('formatProjectDebugText', () => {
  it('lists every receipt and AI dumps for the project in compact form', () => {
    const hugeReport = Array.from({ length: 80 }, (_, i) =>
      `[finding] agent${i}: I read ${i} lines, money tokens. Score ${i}.`,
    ).join('\n')
    // Put the money line near the end so head+tail compact still keeps it
    const hugeOcr = `${'X'.repeat(5000)}\n${'Y'.repeat(4000)}\nSALE TOTAL 365.20`
    const text = formatProjectDebugText({
      projectName: 'School bus',
      projectId: 'p1',
      purchases: [
        {
          id: 'r1-long-id-here',
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
            rawText: hugeOcr,
            agentReport: `Actually ran: Forge\n${hugeReport}\nREASONER: ok`,
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
    expect(text).toContain('COST TRACKER PROJECT')
    expect(text).toContain('compact')
    expect(text).toContain('School bus')
    expect(text).toContain('AutoZone')
    expect(text).toContain('SALE TOTAL 365.20')
    expect(text).toContain('utoZone')
    expect(text).toContain('none saved')
    expect(text).toContain('dumps: 1/2')
    expect(text).not.toMatch(/I read 40 lines/)
    // Whole multi-receipt dump stays small enough for Termux paste
    expect(text.length).toBeLessThan(8000)
  })
})
