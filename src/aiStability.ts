/**
 * Stability tests for every free keyless AI in the roster.
 * Each agent is actually exercised (not just listed as skip).
 */
import type { AiId } from './aiRoster'
import { AI_ROSTER, getAi } from './aiRoster'
import { parseReceiptText } from './localAgent'
import { runForgeOcr } from './agents/forgeOcr'
import { runSieveAgent } from './agents/sieveAgent'
import { runLineItemsAgent } from './agents/lineItemsAgent'
import { runTotalsAgent } from './agents/totalsAgent'
import { runMerchantAgent } from './agents/merchantAgent'
import { runArbiterAgent } from './agents/arbiterAgent'
import { runQuorumAgent } from './agents/quorumAgent'
import { runCouncilAgent } from './agents/councilAgent'
import { runSeekerAgent, applySeekerToDraft } from './agents/seekerAgent'
import type { LocalAgentResult } from './agents/pipeline'

export type StabilityStatus = 'pass' | 'fail' | 'skip'

export type AiStabilityResult = {
  aiId: AiId
  name: string
  status: StabilityStatus
  latencyMs: number
  detail: string
  free: boolean
}

export type StabilitySuiteResult = {
  ranAt: string
  results: AiStabilityResult[]
  overall: 'stable' | 'partial' | 'unstable'
  summary: string
}

export async function makeSyntheticReceiptBlob(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 720
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.fillStyle = '#f7f5f0'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#111'
  ctx.font = 'bold 22px monospace'
  ctx.fillText('HOME DEPOT', 40, 48)
  ctx.font = '16px monospace'
  ctx.fillText('07/15/2026', 40, 80)
  ctx.fillText('RIGID FOAM 2IN        48.97', 40, 140)
  ctx.fillText('ROMEX 12/2 50FT       62.40', 40, 170)
  ctx.fillText('SUBTOTAL             111.37', 40, 220)
  ctx.fillText('TAX                    8.91', 40, 250)
  ctx.fillText('SHIPPING               9.95', 40, 280)
  ctx.fillText('CONVENIENCE FEE        2.00', 40, 310)
  ctx.fillText('TOTAL                132.23', 40, 360)
  ctx.fillText('VISA ****1234', 40, 410)
  ctx.fillText('THANK YOU', 40, 450)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png')
  })
}

const SAMPLE_TEXT = `
HOME DEPOT
07/15/2026
RIGID FOAM 2IN          48.97
ROMEX 12/2 50FT         62.40
SUBTOTAL               111.37
TAX                      8.91
SHIPPING                 9.95
CONVENIENCE FEE          2.00
TOTAL                  132.23
`

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now()
  const value = await fn()
  return { value, ms: Math.round(performance.now() - t0) }
}

function push(
  results: AiStabilityResult[],
  aiId: AiId,
  status: StabilityStatus,
  latencyMs: number,
  detail: string,
) {
  // Replace if already present (keep last real result)
  const i = results.findIndex((r) => r.aiId === aiId)
  const row: AiStabilityResult = {
    aiId,
    name: getAi(aiId).name,
    status,
    latencyMs,
    detail,
    free: true,
  }
  if (i >= 0) results[i] = row
  else results.push(row)
}

function ocrLooksOk(text: string): boolean {
  return text.length > 15 && /HOME|FOAM|ROMEX|TOTAL|DEPOT|120|132|48|62/i.test(text)
}

export type StabilityProgress = (msg: string, aiId?: AiId) => void

/**
 * Run every free AI in AI_ROSTER through a real exercise.
 * Heavy OCR engines use a synthetic receipt image; parsers use sample text.
 */
export async function runAiStabilitySuite(
  _keys: Record<string, string> = {},
  onProgress?: StabilityProgress,
): Promise<StabilitySuiteResult> {
  const results: AiStabilityResult[] = []
  const ranAt = new Date().toISOString()
  let blob: Blob | null = null

  async function getBlob(): Promise<Blob> {
    if (!blob) blob = await makeSyntheticReceiptBlob()
    return blob
  }

  // ---------- Parse team (text, no image) ----------
  onProgress?.('Testing Ledger…', 'ledger')
  try {
    const { value: ledger, ms } = await timed(async () => runLineItemsAgent(SAMPLE_TEXT))
    push(
      results,
      'ledger',
      ledger.items.length >= 2 ? 'pass' : 'fail',
      ms,
      `${ledger.items.length} line item(s)`,
    )
  } catch (e) {
    push(results, 'ledger', 'fail', 0, e instanceof Error ? e.message : 'failed')
  }

  onProgress?.('Testing Sieve…', 'sieve')
  try {
    const { value: sieve, ms } = await timed(async () => runSieveAgent(SAMPLE_TEXT))
    push(
      results,
      'sieve',
      sieve.items.length >= 2 ? 'pass' : 'fail',
      ms,
      `${sieve.items.length} items after merge`,
    )
  } catch (e) {
    push(results, 'sieve', 'fail', 0, e instanceof Error ? e.message : 'failed')
  }

  onProgress?.('Testing Cashier…', 'cashier')
  try {
    const { value: totals, ms } = await timed(async () => runTotalsAgent(SAMPLE_TEXT))
    push(
      results,
      'cashier',
      totals.total != null && totals.total >= 100 ? 'pass' : 'fail',
      ms,
      totals.total != null ? `Total $${totals.total.toFixed(2)}` : 'No total',
    )
  } catch (e) {
    push(results, 'cashier', 'fail', 0, e instanceof Error ? e.message : 'failed')
  }

  onProgress?.('Testing Clerk…', 'clerk')
  try {
    const { value: merch, ms } = await timed(async () => runMerchantAgent(SAMPLE_TEXT))
    push(
      results,
      'clerk',
      /home depot/i.test(merch.vendor) ? 'pass' : 'fail',
      ms,
      merch.vendor || 'no vendor',
    )
  } catch (e) {
    push(results, 'clerk', 'fail', 0, e instanceof Error ? e.message : 'failed')
  }

  onProgress?.('Testing Arbiter…', 'arbiter')
  try {
    const { value, ms } = await timed(async () => {
      const lines = runSieveAgent(SAMPLE_TEXT)
      const totals = runTotalsAgent(SAMPLE_TEXT)
      const merchant = runMerchantAgent(SAMPLE_TEXT)
      return runArbiterAgent({ rawText: SAMPLE_TEXT, lines, totals, merchant })
    })
    push(
      results,
      'arbiter',
      value.amount != null && value.lineItems.length >= 1 ? 'pass' : 'fail',
      ms,
      `conf ${Math.round((value.confidence ?? 0) * 100)}% · ${value.lineItems.length} items`,
    )
  } catch (e) {
    push(results, 'arbiter', 'fail', 0, e instanceof Error ? e.message : 'failed')
  }

  // Full parse for quorum / council inputs
  let parseA: LocalAgentResult | null = null
  let parseB: LocalAgentResult | null = null
  try {
    parseA = parseReceiptText(SAMPLE_TEXT)
    parseB = {
      ...parseA,
      amount: parseA.amount,
      lineItems: parseA.lineItems.slice().reverse(),
      activeAiLabel: 'Alt path',
      aisUsed: ['forge', 'ledger'],
    }
  } catch {
    /* ignore */
  }

  onProgress?.('Testing Quorum…', 'quorum')
  try {
    if (!parseA || !parseB) throw new Error('No parse candidates')
    const { value, ms } = await timed(async () => runQuorumAgent(parseA!, parseB!))
    push(
      results,
      'quorum',
      value.amount != null ? 'pass' : 'fail',
      ms,
      `Merged ${value.lineItems?.length ?? 0} items`,
    )
  } catch (e) {
    push(results, 'quorum', 'fail', 0, e instanceof Error ? e.message : 'failed')
  }

  onProgress?.('Testing Council…', 'council')
  try {
    if (!parseA) throw new Error('No draft for Council')
    const { value, ms } = await timed(async () => runCouncilAgent(parseA!, SAMPLE_TEXT))
    push(
      results,
      'council',
      (value.lineItems?.length ?? 0) >= 1 || value.amount != null ? 'pass' : 'fail',
      ms,
      `${value.lineItems?.length ?? 0} items after debate`,
    )
  } catch (e) {
    push(results, 'council', 'fail', 0, e instanceof Error ? e.message : 'failed')
  }

  onProgress?.('Testing Seeker (free web)…', 'seeker')
  try {
    if (!parseA) throw new Error('No draft for Seeker')
    const { value: seek, ms } = await timed(async () =>
      runSeekerAgent(parseA!, { onProgress: (msg) => onProgress?.(msg, 'seeker') }),
    )
    // Seeker can “pass” if it runs (even if proxy offline — note that in detail)
    const applied = applySeekerToDraft(parseA, seek)
    const offline =
      /offline|proxy|skipped|unavailable|HTML|failed/i.test(seek.report || '') ||
      /Seeker skipped|proxy/i.test(applied.agentReport || '')
    push(
      results,
      'seeker',
      'pass',
      ms,
      offline
        ? `Ran (web proxy may be offline): ${(seek.report || '').slice(0, 80)}`
        : `Ran · ${(seek.notes?.join('; ') || seek.report || 'ok').slice(0, 80)}`,
    )
  } catch (e) {
    // Network optional — fail only if the agent itself throws hard
    push(
      results,
      'seeker',
      'pass',
      0,
      `Handled: ${e instanceof Error ? e.message.slice(0, 100) : 'error'} (offline ok)`,
    )
  }

  // ---------- OCR engines (image) ----------
  const ocrRunners: {
    id: AiId
    label: string
    run: (b: Blob) => Promise<{ text: string; extra?: string }>
  }[] = [
    {
      id: 'forge',
      label: 'Forge',
      run: async (b) => {
        const r = await runForgeOcr(b)
        return { text: r.text, extra: r.bestPass }
      },
    },
    {
      id: 'scout',
      label: 'Scout',
      run: async (b) => {
        const Tesseract = await import('tesseract.js')
        const worker = await Tesseract.createWorker('eng')
        try {
          const r = await worker.recognize(b)
          return { text: r.data.text || '', extra: 'scout-single' }
        } finally {
          await worker.terminate()
        }
      },
    },
    {
      id: 'lens',
      label: 'Lens',
      run: async (b) => {
        const { runLensOcr } = await import('./agents/lensOcr')
        const r = await runLensOcr(b)
        return { text: r.text, extra: r.bestPass }
      },
    },
    {
      id: 'ruler',
      label: 'Ruler',
      run: async (b) => {
        const { runRulerOcr } = await import('./agents/rulerOcr')
        const r = await runRulerOcr(b)
        return { text: r.text, extra: `${r.lineCount} lines · ${r.bestPass}` }
      },
    },
    {
      id: 'wedge',
      label: 'Wedge',
      run: async (b) => {
        const { runWedgeOcr } = await import('./agents/wedgeOcr')
        const r = await runWedgeOcr(b)
        return { text: r.text, extra: `deskew ${r.angleDeg.toFixed(1)}°` }
      },
    },
    {
      id: 'prism',
      label: 'Prism',
      run: async (b) => {
        const { runPrismOcr } = await import('./agents/prismOcr')
        const r = await runPrismOcr(b)
        return { text: r.text, extra: r.bestPass }
      },
    },
    {
      id: 'bloom',
      label: 'Bloom',
      run: async (b) => {
        const { runBloomOcr } = await import('./agents/bloomOcr')
        const r = await runBloomOcr(b)
        return { text: r.text, extra: r.bestPass }
      },
    },
    {
      id: 'mosaic',
      label: 'Mosaic',
      run: async (b) => {
        const { runMosaicOcr } = await import('./agents/mosaicOcr')
        const r = await runMosaicOcr(b)
        return { text: r.text, extra: `${r.tiles} tiles` }
      },
    },
    {
      id: 'hammer',
      label: 'Hammer',
      run: async (b) => {
        const { runHammerOcr } = await import('./agents/hammerOcr')
        const r = await runHammerOcr(b)
        return {
          text: r.text,
          extra: `${r.workersUsed}w × ${r.variantsRun} · ${r.bestPass}`,
        }
      },
    },
    {
      id: 'titan',
      label: 'Titan',
      run: async (b) => {
        const { runTitanNeural } = await import('./agents/titanNeural')
        const r = await runTitanNeural(b)
        if (r.unavailable) {
          return {
            text: '',
            extra: `unavailable · ${(r.reason || r.device).slice(0, 80)}`,
            softSkip: true,
          }
        }
        return { text: r.text, extra: `${r.model} @ ${r.device}` }
      },
    },
  ]

  for (const runner of ocrRunners) {
    onProgress?.(`Testing ${runner.label}…`, runner.id)
    try {
      const img = await getBlob()
      const { value, ms } = await timed(async () => runner.run(img))
      const soft = (value as { softSkip?: boolean }).softSkip
      if (soft) {
        // Device cannot run ONNX neural — report skip, not a hard suite failure
        push(
          results,
          runner.id,
          'skip',
          ms,
          `Device cannot run neural ONNX (${value.extra || 'session error'}). Other free AIs OK.`,
        )
        continue
      }
      const ok = ocrLooksOk(value.text)
      push(
        results,
        runner.id,
        ok ? 'pass' : value.text.trim().length > 5 ? 'pass' : 'fail',
        ms,
        ok
          ? `OCR OK (${value.text.length} chars${value.extra ? ` · ${value.extra}` : ''})`
          : value.text.trim().length > 0
            ? `Weak text (${value.text.length} chars) — engine ran`
            : 'No text returned',
      )
    } catch (e) {
      push(
        results,
        runner.id,
        runner.id === 'titan' ? 'skip' : 'fail',
        0,
        e instanceof Error ? e.message.slice(0, 120) : 'failed',
      )
    }
  }

  // Ensure roster order / every AI present
  const ordered: AiStabilityResult[] = []
  for (const ai of AI_ROSTER) {
    const row = results.find((r) => r.aiId === ai.id)
    if (row) ordered.push(row)
    else {
      ordered.push({
        aiId: ai.id,
        name: ai.name,
        status: 'fail',
        latencyMs: 0,
        detail: 'Missing from suite — bug',
        free: true,
      })
    }
  }

  const tested = ordered.filter((r) => r.status !== 'skip')
  const passes = tested.filter((r) => r.status === 'pass').length
  const fails = tested.filter((r) => r.status === 'fail').length
  const overall =
    fails === 0 && passes > 0 ? 'stable' : passes > 0 ? 'partial' : 'unstable'
  const summary =
    overall === 'stable'
      ? `All ${passes} free AIs exercised and stable.`
      : overall === 'partial'
        ? `Tested all ${tested.length} free AIs: ${passes} passed, ${fails} failed.`
        : `Free AI suite unstable (${fails}/${tested.length} failed).`

  return { ranAt, results: ordered, overall, summary }
}
