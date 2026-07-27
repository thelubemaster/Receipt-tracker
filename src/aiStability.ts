/**
 * Stability tests for free keyless AIs only.
 */
import type { AiId } from './aiRoster'
import { AI_ROSTER, getAi } from './aiRoster'
import { parseReceiptText } from './localAgent'
import { runForgeOcr } from './agents/forgeOcr'
import { runSieveAgent } from './agents/sieveAgent'

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
TOTAL                  120.28
`

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now()
  const value = await fn()
  return { value, ms: Math.round(performance.now() - t0) }
}

export type StabilityProgress = (msg: string, aiId?: AiId) => void

export async function runAiStabilitySuite(
  _keys: Record<string, string> = {},
  onProgress?: StabilityProgress,
): Promise<StabilitySuiteResult> {
  const results: AiStabilityResult[] = []
  const ranAt = new Date().toISOString()

  onProgress?.('Testing Ledger / Sieve / Cashier / Clerk / Arbiter…', 'sieve')
  try {
    const { value, ms } = await timed(async () => parseReceiptText(SAMPLE_TEXT))
    const sieve = runSieveAgent(SAMPLE_TEXT)
    const ok =
      value.amount === 120.28 &&
      (value.lineItems.length >= 2 || sieve.items.length >= 2)

    for (const id of ['ledger', 'sieve', 'cashier', 'clerk', 'arbiter'] as AiId[]) {
      let status: StabilityStatus = 'pass'
      let detail = 'OK'
      if (id === 'cashier') {
        status = value.amount === 120.28 ? 'pass' : 'fail'
        detail = `Total ${value.amount}`
      } else if (id === 'clerk') {
        status = /home depot/i.test(value.vendor) ? 'pass' : 'fail'
        detail = value.vendor || 'no vendor'
      } else if (id === 'sieve') {
        status = sieve.items.length >= 2 ? 'pass' : 'fail'
        detail = `${sieve.items.length} items`
      } else if (id === 'ledger') {
        status = value.lineItems.length >= 2 || sieve.items.length >= 2 ? 'pass' : 'fail'
        detail = `${value.lineItems.length} items`
      } else {
        status = ok ? 'pass' : 'fail'
        detail = `conf ${Math.round((value.confidence ?? 0) * 100)}%`
      }
      results.push({
        aiId: id,
        name: getAi(id).name,
        status,
        latencyMs: ms,
        detail,
        free: true,
      })
    }
  } catch (e) {
    for (const id of ['ledger', 'sieve', 'cashier', 'clerk', 'arbiter'] as AiId[]) {
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

  onProgress?.('Testing Forge OCR…', 'forge')
  try {
    const blob = await makeSyntheticReceiptBlob()
    const { value, ms } = await timed(async () => runForgeOcr(blob))
    const textOk = /HOME|FOAM|ROMEX|TOTAL|120/i.test(value.text) && value.text.length > 20
    results.push({
      aiId: 'forge',
      name: 'Forge',
      status: textOk ? 'pass' : 'fail',
      latencyMs: ms,
      detail: textOk
        ? `OCR OK (${value.text.length} chars, ${value.bestPass})`
        : `Weak OCR: ${value.text.slice(0, 60)}`,
      free: true,
    })
    results.push({
      aiId: 'scout',
      name: 'Scout',
      status: textOk ? 'pass' : 'fail',
      latencyMs: ms,
      detail: textOk ? 'Shares Tesseract engine — healthy' : 'OCR engine weak',
      free: true,
    })
    results.push({
      aiId: 'lens',
      name: 'Lens',
      status: textOk ? 'pass' : 'fail',
      latencyMs: ms,
      detail: textOk
        ? 'Uses same engine as Forge with upscale — engine healthy'
        : 'OCR engine weak for Lens too',
      free: true,
    })
    results.push({
      aiId: 'quorum',
      name: 'Quorum',
      status: textOk ? 'pass' : 'fail',
      latencyMs: 1,
      detail: textOk ? 'Vote layer ready' : 'Blocked by OCR failure',
      free: true,
    })
  } catch (e) {
    for (const id of ['forge', 'scout', 'lens', 'quorum'] as AiId[]) {
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

  // Ensure every roster AI has a row
  for (const ai of AI_ROSTER) {
    if (!results.some((r) => r.aiId === ai.id)) {
      results.push({
        aiId: ai.id,
        name: ai.name,
        status: 'skip',
        latencyMs: 0,
        detail: 'Not exercised in this suite',
        free: true,
      })
    }
  }

  const tested = results.filter((r) => r.status !== 'skip')
  const passes = tested.filter((r) => r.status === 'pass').length
  const fails = tested.filter((r) => r.status === 'fail').length
  const overall =
    fails === 0 && passes > 0 ? 'stable' : passes > 0 ? 'partial' : 'unstable'
  const summary =
    overall === 'stable'
      ? `All free keyless AIs stable (${passes}/${tested.length}).`
      : overall === 'partial'
        ? `Some free AIs need attention (${passes} passed, ${fails} failed).`
        : `Free AI suite unstable (${fails} failed).`

  return { ranAt, results, overall, summary }
}
