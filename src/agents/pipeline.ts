import type { AiId } from '../aiRoster'
import type { ReceiptSuggestion } from '../types'
import { runArbiterAgent } from './arbiterAgent'
import { runForgeOcr } from './forgeOcr'
import { runHammerOcr } from './hammerOcr'
import { mergeOcrTexts, runLensOcr } from './lensOcr'
import { runLineItemsAgent } from './lineItemsAgent'
import { runMerchantAgent } from './merchantAgent'
import { runCouncilAgent } from './councilAgent'
import { runQuorumAgent } from './quorumAgent'
import {
  diversifyImageForRetry,
  formatRejectionBrief,
  pickDiversifiedParse,
  similarityToRejected,
  type RejectedScanSnapshot,
} from './retryFeedback'
import { applySeekerToDraft, runSeekerAgent } from './seekerAgent'
import { runSieveAgent } from './sieveAgent'
import { runTotalsAgent } from './totalsAgent'

export type LocalAgentResult = ReceiptSuggestion & {
  source: 'on-device'
  confidence: number
  rawText: string
  agentReport?: string
  aisUsed?: AiId[]
}

export type AgentProgress = {
  stage: 'prepare' | 'ocr' | 'parse' | 'arbitrate' | 'done' | string
  progress: number
  message: string
  aiId?: AiId
  aiName?: string
}

function scoreOcrText(text: string): number {
  const lines = text.split(/\n/).filter((l) => l.trim()).length
  const money = (text.match(/\d+[.,]\d{2}/g) || []).length
  const letters = (text.match(/[A-Za-z]/g) || []).length
  return lines * 2 + money * 5 + Math.min(letters, 800) * 0.05
}

function parseFromText(
  rawText: string,
  label: string,
  ocrNote: string,
  extraAis: AiId[],
): LocalAgentResult {
  const sieve = runSieveAgent(rawText)
  const totals = runTotalsAgent(rawText)
  const merchant = runMerchantAgent(rawText)
  const ledgerOnly = runLineItemsAgent(rawText)

  const result = runArbiterAgent({
    rawText,
    lines: {
      ...sieve,
      notes: [...sieve.notes, `Ledger alone: ${ledgerOnly.items.length} items`],
    },
    totals,
    merchant,
  })

  result.aisUsed = Array.from(
    new Set<AiId>(['ledger', 'sieve', 'cashier', 'clerk', 'arbiter', ...extraAis]),
  )
  result.activeAiLabel = label
  result.agentReport = [
    `Free parse path: ${label}`,
    ocrNote,
    `Ledger: ${ledgerOnly.items.length} · Sieve: ${sieve.items.length}`,
    result.agentReport,
  ].join('\n')
  return result
}

export type PipelineOptions = {
  /** Default true — run Hammer swarm + Titan neural (heavy phone load) */
  maxPower?: boolean
  /**
   * User pressed Try again — previous answer was wrong.
   * Pipeline diversifies OCR + picks a different parse.
   */
  rejected?: RejectedScanSnapshot
}

function scoreParseCandidate(c: LocalAgentResult): number {
  let s = (c.confidence ?? 0) * 40
  s += Math.min(12, (c.lineItems?.length ?? 0) * 2)
  if (c.amount != null) s += 15
  if (c.vendor) s += 8
  if (c.date) s += 6
  if (c.lineItems?.length && c.amount != null) {
    const sum = c.lineItems.reduce((a, i) => a + i.amount, 0)
    if (Math.abs(sum - c.amount) < 1 || Math.abs(sum - (c.subtotal ?? -1)) < 1) s += 12
  }
  s += Math.min(10, (c.description?.length ?? 0) / 20)
  return s
}

/**
 * Free keyless multi-agent pipeline with optional max-power engines.
 * Forge + Lens always; Hammer (parallel OCR) + Titan (neural) when maxPower.
 * Quorum votes across all successful OCR paths.
 * On retry, rejected snapshot steers AIs away from the same wrong answer.
 */
export async function runMultiAgentReceiptPipeline(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
  options: PipelineOptions = {},
): Promise<LocalAgentResult> {
  const rejected = options.rejected
  // Retries always push hard — user already said the first answer was wrong
  const maxPower = rejected ? true : options.maxPower !== false
  const attempt = rejected?.attempt ?? 0

  let workBlob = imageBlob
  if (rejected && attempt >= 1) {
    onProgress?.({
      stage: 'prepare',
      progress: 0.02,
      message: `Try again #${attempt}: AIs know the last answer was wrong — re-reading differently…`,
      aiId: 'arbiter',
      aiName: 'Arbiter',
    })
    try {
      workBlob = await diversifyImageForRetry(imageBlob, attempt)
    } catch {
      workBlob = imageBlob
    }
  } else {
    onProgress?.({
      stage: 'prepare',
      progress: 0.02,
      message: maxPower
        ? 'Starting MAX-POWER free AI team (Hammer + Titan)…'
        : 'Starting free AI team…',
      aiId: 'hammer',
      aiName: 'Hammer',
    })
  }

  const ocrTexts: { label: string; text: string; note: string; ais: AiId[] }[] = []

  // --- Forge ---
  try {
    const forge = await runForgeOcr(workBlob, onProgress)
    if (forge.text.trim()) {
      ocrTexts.push({
        label: 'Forge path',
        text: forge.text,
        note: `Forge best: ${forge.bestPass}`,
        ais: ['forge'],
      })
    }
  } catch (e) {
    ocrTexts.push({
      label: 'Forge path',
      text: '',
      note: `Forge failed: ${e instanceof Error ? e.message : 'error'}`,
      ais: ['forge'],
    })
  }

  // --- Lens ---
  try {
    const lens = await runLensOcr(workBlob, onProgress)
    if (lens.text.trim()) {
      ocrTexts.push({
        label: 'Lens path',
        text: lens.text,
        note: `Lens best: ${lens.bestPass}`,
        ais: ['lens'],
      })
    }
  } catch (e) {
    /* optional */
  }

  // --- Ruler (layout-aware document rows: names + prices on the same line) ---
  try {
    const { runRulerOcr } = await import('./rulerOcr')
    const ruler = await runRulerOcr(workBlob, onProgress)
    if (ruler.text.trim()) {
      ocrTexts.push({
        label: 'Ruler layout path',
        text: ruler.text,
        note: `Ruler: ${ruler.lineCount} document lines · ${ruler.wordCount} words · ${ruler.bestPass}`,
        ais: ['ruler'],
      })
      // Prefer Ruler text for council hunting when it found more money-on-line rows
    }
  } catch (e) {
    onProgress?.({
      stage: 'ocr',
      progress: 0.48,
      message: `Ruler skipped: ${e instanceof Error ? e.message : 'unavailable'}`,
      aiId: 'ruler',
      aiName: 'Ruler',
    })
  }

  // --- Hammer (max power parallel swarm) ---
  if (maxPower) {
    try {
      const hammer = await runHammerOcr(workBlob, onProgress)
      if (hammer.text.trim()) {
        ocrTexts.push({
          label: 'Hammer path',
          text: hammer.text,
          note: `Hammer: ${hammer.workersUsed} workers × ${hammer.variantsRun} jobs · best ${hammer.bestPass}`,
          ais: ['hammer'],
        })
      }
    } catch (e) {
      onProgress?.({
        stage: 'ocr',
        progress: 0.5,
        message: `Hammer failed: ${e instanceof Error ? e.message : 'error'}`,
        aiId: 'hammer',
        aiName: 'Hammer',
      })
    }
  }

  // --- Titan neural ---
  if (maxPower) {
    try {
      const { runTitanNeural } = await import('./titanNeural')
      const titan = await runTitanNeural(workBlob, onProgress)
      if (titan.text.trim()) {
        ocrTexts.push({
          label: 'Titan neural path',
          text: titan.text,
          note: `Titan ${titan.model} on ${titan.device} · ${titan.strips} strips`,
          ais: ['titan'],
        })
      }
    } catch (e) {
      onProgress?.({
        stage: 'ocr',
        progress: 0.55,
        message: `Titan skipped: ${e instanceof Error ? e.message : 'unavailable'}`,
        aiId: 'titan',
        aiName: 'Titan',
      })
    }
  }

  const usable = ocrTexts.filter((o) => o.text.trim().length > 10)
  if (!usable.length) {
    // last-ditch scout
    try {
      const Tesseract = await import('tesseract.js')
      onProgress?.({
        stage: 'ocr',
        progress: 0.6,
        message: 'Scout emergency fallback…',
        aiId: 'scout',
        aiName: 'Scout',
      })
      const worker = await Tesseract.createWorker('eng')
      const r = await worker.recognize(workBlob)
      await worker.terminate()
      usable.push({
        label: 'Scout fallback',
        text: r.data.text || '',
        note: 'Scout emergency',
        ais: ['scout'],
      })
    } catch (e) {
      throw new Error(
        e instanceof Error ? e.message : 'All free OCR engines failed on this device',
      )
    }
  }

  // Prefer Ruler (layout) when it found more product+price rows
  const layoutish = (t: string) =>
    t.split(/\n/).filter((l) => /[A-Za-z]{3,}/.test(l) && /\d+[.,]\d{2}/.test(l)).length
  usable.sort((a, b) => {
    const la = (a.ais.includes('ruler') ? 4 : 0) + layoutish(a.text) * 2 + scoreOcrText(a.text) * 0.01
    const lb = (b.ais.includes('ruler') ? 4 : 0) + layoutish(b.text) * 2 + scoreOcrText(b.text) * 0.01
    return lb - la
  })

  onProgress?.({
    stage: 'parse',
    progress: 0.7,
    message: `Parsing ${usable.length} OCR paths with Ledger/Sieve (layout-first)…`,
    aiId: 'sieve',
    aiName: 'Sieve',
  })

  const parses = usable.map((u) => parseFromText(u.text, u.label, u.note, u.ais))

  // Merged OCR super-text (layout-first when Ruler present)
  let merged = usable[0].text
  for (let i = 1; i < usable.length; i++) {
    merged = mergeOcrTexts(merged, usable[i].text)
  }
  if (usable.length > 1 && scoreOcrText(merged) > scoreOcrText(usable[0].text) * 0.85) {
    parses.push(
      parseFromText(
        merged,
        'Merged multi-OCR path',
        `Merged ${usable.length} OCR engines (layout-first)`,
        usable.flatMap((u) => u.ais),
      ),
    )
  }

  onProgress?.({
    stage: 'arbitrate',
    progress: 0.88,
    message: rejected
      ? `Quorum is voting — avoiding the answer you rejected…`
      : `Quorum is voting across ${parses.length} full parses…`,
    aiId: 'quorum',
    aiName: 'Quorum',
  })

  // Use richest OCR text for council hunting
  let councilText = usable[0].text
  for (let i = 1; i < usable.length; i++) {
    councilText = mergeOcrTexts(councilText, usable[i].text)
  }

  // When user rejected a prior answer, diversify across full parse candidates
  // instead of pairwise-merging (merge often recreated the same wrong items).
  let final: LocalAgentResult
  let diversifyReport = ''
  if (rejected && parses.length) {
    const picked = pickDiversifiedParse(parses, rejected, scoreParseCandidate)
    final = picked.winner
    diversifyReport = picked.report
    // Still merge items from other candidates that don't match the rejected set
    for (const p of parses) {
      if (p === final) continue
      if (similarityToRejected(p, rejected) < 0.7) {
        final = runQuorumAgent(final, p)
      }
    }
  } else {
    final = parses[0]
    for (let i = 1; i < parses.length; i++) {
      final = runQuorumAgent(final, parses[i])
    }
  }

  if (!final.rawText || councilText.length > final.rawText.length) {
    final = { ...final, rawText: councilText }
  }

  onProgress?.({
    stage: 'arbitrate',
    progress: 0.93,
    message: rejected
      ? 'Council knows the last scan was wrong — debating a different reading…'
      : 'Council is debating — agents challenging gaps…',
    aiId: 'council',
    aiName: 'Council',
  })

  final = runCouncilAgent(
    final,
    councilText || final.rawText || '',
    (msg, aiId) => {
      onProgress?.({
        stage: 'arbitrate',
        progress: 0.94,
        message: msg.slice(0, 120),
        aiId: aiId ?? 'council',
        aiName: aiId ? aiId.charAt(0).toUpperCase() + aiId.slice(1) : 'Council',
      })
    },
    rejected,
  )

  // If still nearly identical to rejected, force another council pass from alternate OCR
  if (rejected && similarityToRejected(final, rejected) >= 0.82) {
    onProgress?.({
      stage: 'arbitrate',
      progress: 0.95,
      message: 'Still too similar to the rejected answer — forcing alternate parse…',
      aiId: 'arbiter',
      aiName: 'Arbiter',
    })
    // Prefer the lowest-similarity parse as a fresh draft
    const alt = pickDiversifiedParse(parses, rejected, (c) => scoreParseCandidate(c) * 0.5)
    final = runCouncilAgent(
      {
        ...alt.winner,
        rawText: councilText || alt.winner.rawText,
      },
      councilText || final.rawText || '',
      (msg, aiId) => {
        onProgress?.({
          stage: 'arbitrate',
          progress: 0.955,
          message: msg.slice(0, 120),
          aiId: aiId ?? 'council',
          aiName: 'Council',
        })
      },
      {
        ...rejected,
        attempt: rejected.attempt + 1,
        userNote: (rejected.userNote || '') + ' Still too similar — push harder for a different split.',
      },
    )
    diversifyReport += `\nForced alternate draft (sim was high). ${alt.report}`
  }

  // Seeker — free internet enrichment (DuckDuckGo + Wikipedia via host proxy)
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    onProgress?.({
      stage: 'arbitrate',
      progress: 0.96,
      message: 'Seeker is scanning the internet for product info…',
      aiId: 'seeker',
      aiName: 'Seeker',
    })
    try {
      const seek = await runSeekerAgent(final, {
        onProgress: (msg, aiId) =>
          onProgress?.({
            stage: 'arbitrate',
            progress: 0.97,
            message: msg.slice(0, 120),
            aiId: aiId ?? 'seeker',
            aiName: 'Seeker',
          }),
      })
      final = applySeekerToDraft(final, seek)
      // Re-run a light council pass so agents react to web facts
      final = runCouncilAgent(
        final,
        councilText || final.rawText || '',
        (msg, aiId) => {
          onProgress?.({
            stage: 'arbitrate',
            progress: 0.98,
            message: msg.slice(0, 120),
            aiId: aiId ?? 'council',
            aiName: aiId ? aiId.charAt(0).toUpperCase() + aiId.slice(1) : 'Council',
          })
        },
        rejected,
      )
    } catch (e) {
      final.agentReport = [
        final.agentReport,
        `Seeker skipped: ${e instanceof Error ? e.message : 'offline or proxy unavailable'}`,
      ].join('\n')
    }
  }

  final.aisUsed = Array.from(
    new Set<AiId>([
      ...(final.aisUsed ?? []),
      'forge',
      'lens',
      'ruler',
      'hammer',
      'titan',
      'scout',
      'ledger',
      'sieve',
      'cashier',
      'clerk',
      'arbiter',
      'quorum',
      'council',
      'seeker',
    ]),
  )
  final.activeAiLabel = rejected
    ? `Retry #${attempt} · free team (avoided rejected answer)`
    : maxPower
      ? 'Max-power free team + Ruler layout + Council + Seeker'
      : 'Free team + Ruler layout + Council + Seeker'
  final.agentReport = [
    rejected ? formatRejectionBrief(rejected) : null,
    diversifyReport || null,
    maxPower
      ? 'MAX POWER free AIs: Forge, Lens, Ruler, Hammer, Titan, Ledger, Sieve, Cashier, Clerk, Arbiter, Quorum, Council, Seeker'
      : 'Free AIs: Forge, Lens, Ruler, Ledger, Sieve, Cashier, Clerk, Arbiter, Quorum, Council, Seeker',
    ...usable.map((u) => u.note),
    final.agentReport,
  ]
    .filter(Boolean)
    .join('\n')
  final.source = 'on-device'

  onProgress?.({
    stage: 'done',
    progress: 1,
    message: 'Ruler + Seeker + Council finished — free AI team done',
    aiId: 'ruler',
    aiName: 'Ruler',
  })

  return final
}

export async function disposeOnDeviceAgent(): Promise<void> {
  try {
    const { disposeForgeWorker } = await import('./forgeOcr')
    await disposeForgeWorker()
  } catch {
    /* ignore */
  }
  try {
    const { disposeRulerWorker } = await import('./rulerOcr')
    await disposeRulerWorker()
  } catch {
    /* ignore */
  }
}

export async function prepareImageForOcr(blob: Blob, maxEdge = 1400): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(bitmap, 0, 0, w, h)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.88)
    })
  } finally {
    bitmap.close()
  }
}
