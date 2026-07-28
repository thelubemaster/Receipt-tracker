import type { AiId } from '../aiRoster'
import { isAiEnabled } from '../aiRoster'
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
  applyUserMarksToResult,
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
  enabled: (id: AiId) => boolean,
): LocalAgentResult {
  const ledgerOnly = runLineItemsAgent(rawText)
  const sieve = enabled('sieve')
    ? runSieveAgent(rawText)
    : {
        ...ledgerOnly,
        notes: [...ledgerOnly.notes, 'Sieve disabled — Ledger only'],
      }
  const totals = runTotalsAgent(rawText)
  const merchant = runMerchantAgent(rawText)

  const result = runArbiterAgent({
    rawText,
    lines: {
      ...sieve,
      notes: [...sieve.notes, `Ledger alone: ${ledgerOnly.items.length} items`],
    },
    totals,
    merchant,
  })

  const used: AiId[] = ['ledger', 'cashier', 'clerk', 'arbiter', ...extraAis]
  if (enabled('sieve')) used.push('sieve')
  result.aisUsed = Array.from(new Set<AiId>(used))
  result.activeAiLabel = label
  result.agentReport = [
    `Free parse path: ${label}`,
    ocrNote,
    `Ledger: ${ledgerOnly.items.length} · Sieve: ${enabled('sieve') ? sieve.items.length : 'off'}`,
    result.agentReport,
  ].join('\n')
  return result
}

export type PipelineOptions = {
  /** Default true — heavy-tier free AIs allowed (unless individually disabled) */
  maxPower?: boolean
  /** User-disabled free AIs (Settings toggles) */
  disabledAis?: AiId[]
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
  // Retries allow heavy tier unless user explicitly disabled those AIs
  const maxPower = rejected ? true : options.maxPower !== false
  const disabledAis = options.disabledAis ?? []
  const enabled = (id: AiId) => isAiEnabled(id, { disabledAis, maxPowerMode: maxPower })
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
        ? 'Starting free AI team (heavy engines allowed if enabled)…'
        : 'Starting free AI team (light mode — heavy AIs off)…',
      aiId: 'forge',
      aiName: 'Forge',
    })
  }

  const ocrTexts: { label: string; text: string; note: string; ais: AiId[] }[] = []
  const skipped: string[] = []

  async function runOcrIfEnabled(
    id: AiId,
    label: string,
    runner: () => Promise<{ text: string; note: string }>,
  ) {
    if (!enabled(id)) {
      skipped.push(`${label} off`)
      return
    }
    try {
      const r = await runner()
      if (r.text.trim()) {
        ocrTexts.push({ label, text: r.text, note: r.note, ais: [id] })
      }
    } catch (e) {
      onProgress?.({
        stage: 'ocr',
        progress: 0.45,
        message: `${label} skipped: ${e instanceof Error ? e.message : 'error'}`,
        aiId: id,
        aiName: label.split(' ')[0],
      })
    }
  }

  // --- Forge ---
  await runOcrIfEnabled('forge', 'Forge path', async () => {
    const forge = await runForgeOcr(workBlob, onProgress)
    return { text: forge.text, note: `Forge best: ${forge.bestPass}` }
  })

  // --- Lens ---
  await runOcrIfEnabled('lens', 'Lens path', async () => {
    const lens = await runLensOcr(workBlob, onProgress)
    return { text: lens.text, note: `Lens best: ${lens.bestPass}` }
  })

  // --- Ruler ---
  await runOcrIfEnabled('ruler', 'Ruler layout path', async () => {
    const { runRulerOcr } = await import('./rulerOcr')
    const ruler = await runRulerOcr(workBlob, onProgress)
    return {
      text: ruler.text,
      note: `Ruler: ${ruler.lineCount} document lines · ${ruler.wordCount} words · ${ruler.bestPass}`,
    }
  })

  // --- Wedge (deskew) ---
  await runOcrIfEnabled('wedge', 'Wedge deskew path', async () => {
    const { runWedgeOcr } = await import('./wedgeOcr')
    const wedge = await runWedgeOcr(workBlob, onProgress)
    return { text: wedge.text, note: `Wedge deskew ${wedge.angleDeg.toFixed(1)}° · ${wedge.bestPass}` }
  })

  // --- Prism (multi-PSM) ---
  await runOcrIfEnabled('prism', 'Prism multi-layout path', async () => {
    const { runPrismOcr } = await import('./prismOcr')
    const prism = await runPrismOcr(workBlob, onProgress)
    return { text: prism.text, note: `Prism ${prism.modesRun} modes · ${prism.bestPass}` }
  })

  // --- Bloom (2× upscale) ---
  await runOcrIfEnabled('bloom', 'Bloom upscale path', async () => {
    const { runBloomOcr } = await import('./bloomOcr')
    const bloom = await runBloomOcr(workBlob, onProgress)
    return { text: bloom.text, note: `Bloom ×${bloom.scale} · ${bloom.bestPass}` }
  })

  // --- Mosaic (tile) ---
  await runOcrIfEnabled('mosaic', 'Mosaic tile path', async () => {
    const { runMosaicOcr } = await import('./mosaicOcr')
    const mosaic = await runMosaicOcr(workBlob, onProgress)
    return { text: mosaic.text, note: `Mosaic ${mosaic.tiles} tiles · ${mosaic.bestPass}` }
  })

  // --- Hammer ---
  await runOcrIfEnabled('hammer', 'Hammer path', async () => {
    const hammer = await runHammerOcr(workBlob, onProgress)
    return {
      text: hammer.text,
      note: `Hammer: ${hammer.workersUsed} workers × ${hammer.variantsRun} jobs · best ${hammer.bestPass}`,
    }
  })

  // --- Titan neural ---
  await runOcrIfEnabled('titan', 'Titan neural path', async () => {
    const { runTitanNeural } = await import('./titanNeural')
    const titan = await runTitanNeural(workBlob, onProgress)
    return {
      text: titan.text,
      note: `Titan ${titan.model} on ${titan.device} · ${titan.strips} strips`,
    }
  })

  const usable = ocrTexts.filter((o) => o.text.trim().length > 10)
  if (!usable.length) {
    // last-ditch scout (core — always allowed)
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

  const parses = usable.map((u) => parseFromText(u.text, u.label, u.note, u.ais, enabled))

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
        enabled,
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
    if (enabled('quorum')) {
      for (const p of parses) {
        if (p === final) continue
        if (similarityToRejected(p, rejected) < 0.7) {
          final = runQuorumAgent(final, p)
        }
      }
    }
  } else if (enabled('quorum') && parses.length > 1) {
    final = parses[0]
    for (let i = 1; i < parses.length; i++) {
      final = runQuorumAgent(final, parses[i])
    }
  } else {
    final = parses[0]
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

  if (enabled('council')) {
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
  } else {
    skipped.push('Council off')
  }

  // If still nearly identical to rejected, force another council pass from alternate OCR
  if (enabled('council') && rejected && similarityToRejected(final, rejected) >= 0.82) {
    onProgress?.({
      stage: 'arbitrate',
      progress: 0.95,
      message: 'Still too similar to the rejected answer — forcing alternate parse…',
      aiId: 'arbiter',
      aiName: 'Arbiter',
    })
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
  if (enabled('seeker') && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
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
      if (enabled('council')) {
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
      }
    } catch (e) {
      final.agentReport = [
        final.agentReport,
        `Seeker skipped: ${e instanceof Error ? e.message : 'offline or proxy unavailable'}`,
      ].join('\n')
    }
  } else if (!enabled('seeker')) {
    skipped.push('Seeker off')
  }

  const ranIds = new Set<AiId>([
    ...(final.aisUsed ?? []),
    ...usable.flatMap((u) => u.ais),
    'scout',
    'ledger',
    'cashier',
    'clerk',
    'arbiter',
  ])
  for (const id of [
    'forge',
    'lens',
    'ruler',
    'wedge',
    'prism',
    'bloom',
    'mosaic',
    'hammer',
    'titan',
    'sieve',
    'quorum',
    'council',
    'seeker',
  ] as AiId[]) {
    if (enabled(id)) ranIds.add(id)
  }
  final.aisUsed = Array.from(ranIds)
  final.activeAiLabel = rejected
    ? `Retry #${attempt} · free team (avoided rejected answer)`
    : maxPower
      ? 'Free team (heavy allowed if enabled)'
      : 'Free team (light mode)'
  final.agentReport = [
    rejected ? formatRejectionBrief(rejected) : null,
    diversifyReport || null,
    skipped.length ? `Disabled/skipped: ${skipped.join(', ')}` : null,
    `Free AIs this run: ${Array.from(ranIds).join(', ')}`,
    ...usable.map((u) => u.note),
    final.agentReport,
  ]
    .filter(Boolean)
    .join('\n')
  if (rejected?.marks) {
    final = applyUserMarksToResult(final, rejected)
  }

  final.source = 'on-device'

  onProgress?.({
    stage: 'done',
    progress: 1,
    message: rejected?.marks
      ? 'Retry finished using your ✓/✗ marks…'
      : 'Ruler + Seeker + Council finished — free AI team done',
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
