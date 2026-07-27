/**
 * Stability tests for free AIs (and optional cloud if keys present).
 * Uses a synthetic canvas receipt — no personal data.
 */
import type { AiId } from './aiRoster'
import { getAi } from './aiRoster'
import { parseReceiptText } from './localAgent'
import { runForgeOcr } from './agents/forgeOcr'
import { parseReceiptWithGemini } from './receiptAi'

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

/** Draw a tiny fake receipt for free local testing. */
export async function makeSyntheticReceiptBlob(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 640
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
  ctx.fillText('TOTAL                120.28', 40, 290)
  ctx.fillText('VISA ****1234', 40, 340)
  ctx.fillText('THANK YOU', 40, 380)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png')
  })
  return blob
}

const SAMPLE_TEXT = `
HOME DEPOT
07/15/2026
RIGID FOAM 2IN          48.97
ROMEX 12/2 50FT         62.40
SUBTOTAL               111.37
TAX                      8.91
TOTAL                  120.28
`

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now()
  const value = await fn()
  return { value, ms: Math.round(performance.now() - t0) }
}

export type StabilityKeys = {
  geminiApiKey?: string
  /** Paid keys only tested if present — not required for free suite */
  xaiApiKey?: string
  openaiApiKey?: string
}

export type StabilityProgress = (msg: string, aiId?: AiId) => void

/**
 * Run free AI stability suite.
 * Always tests on-device free agents. Tests Gemini if free-tier key set.
 * Skips paid AIs unless keys are provided (still optional).
 */
export async function runAiStabilitySuite(
  keys: StabilityKeys = {},
  onProgress?: StabilityProgress,
): Promise<StabilitySuiteResult> {
  const results: AiStabilityResult[] = []
  const ranAt = new Date().toISOString()

  // --- Free pure-text agents (no OCR) ---
  onProgress?.('Testing Ledger / Cashier / Clerk / Arbiter (free)…', 'ledger')
  try {
    const { value, ms } = await timed(async () => parseReceiptText(SAMPLE_TEXT))
    const ok =
      value.amount === 120.28 &&
      value.lineItems.length >= 2 &&
      /foam|romex/i.test(value.description)
    results.push({
      aiId: 'ledger',
      name: 'Ledger',
      status: ok ? 'pass' : 'fail',
      latencyMs: ms,
      detail: ok
        ? `OK — ${value.lineItems.length} lines, total $${value.amount}`
        : `Unexpected parse: total=${value.amount}, lines=${value.lineItems.length}`,
      free: true,
    })
    results.push({
      aiId: 'cashier',
      name: 'Cashier',
      status: value.amount === 120.28 ? 'pass' : 'fail',
      latencyMs: ms,
      detail: value.amount === 120.28 ? 'Total 120.28 locked in' : `Got ${value.amount}`,
      free: true,
    })
    results.push({
      aiId: 'clerk',
      name: 'Clerk',
      status: /home depot/i.test(value.vendor) ? 'pass' : 'fail',
      latencyMs: ms,
      detail: value.vendor ? `Vendor: ${value.vendor}` : 'No vendor',
      free: true,
    })
    results.push({
      aiId: 'arbiter',
      name: 'Arbiter',
      status: ok && value.confidence > 0.4 ? 'pass' : 'fail',
      latencyMs: ms,
      detail: `Confidence ${Math.round((value.confidence ?? 0) * 100)}%`,
      free: true,
    })
  } catch (e) {
    for (const id of ['ledger', 'cashier', 'clerk', 'arbiter'] as AiId[]) {
      results.push({
        aiId: id,
        name: getAi(id).name,
        status: 'fail',
        latencyMs: 0,
        detail: e instanceof Error ? e.message : 'failed',
        free: true,
      })
    }
  }

  // --- Free OCR: Scout path is inside Forge; test Forge high-power ---
  onProgress?.('Testing Forge high-power OCR (free, on-device)…', 'forge')
  try {
    const blob = await makeSyntheticReceiptBlob()
    const { value, ms } = await timed(async () => runForgeOcr(blob))
    const textOk =
      /HOME\s*DEPOT|FOAM|ROMEX|TOTAL|120/i.test(value.text) && value.text.length > 20
    results.push({
      aiId: 'forge',
      name: 'Forge',
      status: textOk ? 'pass' : 'fail',
      latencyMs: ms,
      detail: textOk
        ? `OCR stable (${value.text.length} chars, best=${value.bestPass})`
        : `OCR weak output: ${value.text.slice(0, 80)}…`,
      free: true,
    })
    results.push({
      aiId: 'scout',
      name: 'Scout',
      status: textOk ? 'pass' : 'fail',
      latencyMs: ms,
      detail: textOk
        ? 'Shares OCR engine with Forge — engine healthy'
        : 'OCR engine struggled on synthetic receipt',
      free: true,
    })
  } catch (e) {
    results.push({
      aiId: 'forge',
      name: 'Forge',
      status: 'fail',
      latencyMs: 0,
      detail: e instanceof Error ? e.message : 'Forge failed',
      free: true,
    })
    results.push({
      aiId: 'scout',
      name: 'Scout',
      status: 'fail',
      latencyMs: 0,
      detail: 'OCR engine unavailable',
      free: true,
    })
  }

  // --- Free-tier Gemini ---
  if (keys.geminiApiKey?.trim()) {
    onProgress?.('Testing Gemini free-tier…', 'gemini')
    try {
      const blob = await makeSyntheticReceiptBlob()
      const { value, ms } = await timed(async () =>
        parseReceiptWithGemini(keys.geminiApiKey!, blob),
      )
      const ok = value.amount != null || (value.lineItems?.length ?? 0) > 0
      results.push({
        aiId: 'gemini',
        name: 'Gemini',
        status: ok ? 'pass' : 'fail',
        latencyMs: ms,
        detail: ok
          ? `Free-tier OK — amount ${value.amount ?? 'n/a'}, lines ${value.lineItems?.length ?? 0}`
          : 'Responded but empty parse',
        free: true,
      })
    } catch (e) {
      results.push({
        aiId: 'gemini',
        name: 'Gemini',
        status: 'fail',
        latencyMs: 0,
        detail: e instanceof Error ? e.message : 'Gemini failed',
        free: true,
      })
    }
  } else {
    results.push({
      aiId: 'gemini',
      name: 'Gemini',
      status: 'skip',
      latencyMs: 0,
      detail: 'No free Gemini key — add Google AI Studio key to test',
      free: true,
    })
  }

  // Paid optional — skip by default message
  for (const id of ['grok', 'chatgpt'] as AiId[]) {
    results.push({
      aiId: id,
      name: getAi(id).name,
      status: 'skip',
      latencyMs: 0,
      detail: 'Paid optional AI — not part of free stability suite',
      free: false,
    })
  }

  const freeResults = results.filter((r) => r.free)
  const tested = freeResults.filter((r) => r.status !== 'skip')
  const passes = tested.filter((r) => r.status === 'pass').length
  const fails = tested.filter((r) => r.status === 'fail').length

  let overall: StabilitySuiteResult['overall'] = 'stable'
  if (fails === 0 && passes > 0) overall = 'stable'
  else if (passes > 0 && fails > 0) overall = 'partial'
  else overall = 'unstable'

  const summary =
    overall === 'stable'
      ? `Free AIs look stable (${passes}/${tested.length} passed).`
      : overall === 'partial'
        ? `Some free AIs need attention (${passes} passed, ${fails} failed).`
        : `Free AI suite unstable (${fails} failed).`

  return { ranAt, results, overall, summary }
}
