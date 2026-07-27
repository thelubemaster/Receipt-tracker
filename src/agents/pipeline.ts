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
}

/**
 * Free keyless multi-agent pipeline with optional max-power engines.
 * Forge + Lens always; Hammer (parallel OCR) + Titan (neural) when maxPower.
 * Quorum votes across all successful OCR paths.
 */
export async function runMultiAgentReceiptPipeline(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
  options: PipelineOptions = {},
): Promise<LocalAgentResult> {
  const maxPower = options.maxPower !== false

  onProgress?.({
    stage: 'prepare',
    progress: 0.02,
    message: maxPower
      ? 'Starting MAX-POWER free AI team (Hammer + Titan)…'
      : 'Starting free AI team…',
    aiId: 'hammer',
    aiName: 'Hammer',
  })

  const ocrTexts: { label: string; text: string; note: string; ais: AiId[] }[] = []

  // --- Forge ---
  try {
    const forge = await runForgeOcr(imageBlob, onProgress)
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
    const lens = await runLensOcr(imageBlob, onProgress)
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

  // --- Hammer (max power parallel swarm) ---
  if (maxPower) {
    try {
      const hammer = await runHammerOcr(imageBlob, onProgress)
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
      const titan = await runTitanNeural(imageBlob, onProgress)
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
      const r = await worker.recognize(imageBlob)
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

  onProgress?.({
    stage: 'parse',
    progress: 0.7,
    message: `Parsing ${usable.length} OCR paths with Ledger/Sieve…`,
    aiId: 'sieve',
    aiName: 'Sieve',
  })

  const parses = usable.map((u) => parseFromText(u.text, u.label, u.note, u.ais))

  // Merged OCR super-text
  let merged = usable[0].text
  for (let i = 1; i < usable.length; i++) {
    merged = mergeOcrTexts(merged, usable[i].text)
  }
  if (usable.length > 1 && scoreOcrText(merged) > scoreOcrText(usable[0].text)) {
    parses.push(
      parseFromText(
        merged,
        'Merged multi-OCR path',
        `Merged ${usable.length} OCR engines`,
        usable.flatMap((u) => u.ais),
      ),
    )
  }

  onProgress?.({
    stage: 'arbitrate',
    progress: 0.88,
    message: `Quorum is voting across ${parses.length} full parses…`,
    aiId: 'quorum',
    aiName: 'Quorum',
  })

  let final = parses[0]
  for (let i = 1; i < parses.length; i++) {
    final = runQuorumAgent(final, parses[i])
  }

  // Use richest OCR text for council hunting
  let councilText = usable[0].text
  for (let i = 1; i < usable.length; i++) {
    councilText = mergeOcrTexts(councilText, usable[i].text)
  }
  if (!final.rawText || councilText.length > final.rawText.length) {
    final = { ...final, rawText: councilText }
  }

  onProgress?.({
    stage: 'arbitrate',
    progress: 0.93,
    message: 'Council is debating — agents challenging gaps…',
    aiId: 'council',
    aiName: 'Council',
  })

  final = runCouncilAgent(final, councilText || final.rawText || '', (msg, aiId) => {
    onProgress?.({
      stage: 'arbitrate',
      progress: 0.94,
      message: msg.slice(0, 120),
      aiId: aiId ?? 'council',
      aiName: aiId ? aiId.charAt(0).toUpperCase() + aiId.slice(1) : 'Council',
    })
  })

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
      final = runCouncilAgent(final, councilText || final.rawText || '', (msg, aiId) => {
        onProgress?.({
          stage: 'arbitrate',
          progress: 0.98,
          message: msg.slice(0, 120),
          aiId: aiId ?? 'council',
          aiName: aiId ? aiId.charAt(0).toUpperCase() + aiId.slice(1) : 'Council',
        })
      })
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
  final.activeAiLabel = maxPower
    ? 'Max-power free team + Council + Seeker'
    : 'Free team + Council + Seeker'
  final.agentReport = [
    maxPower
      ? 'MAX POWER free AIs: Forge, Lens, Hammer, Titan, Ledger, Sieve, Cashier, Clerk, Arbiter, Quorum, Council, Seeker'
      : 'Free AIs: Forge, Lens, Ledger, Sieve, Cashier, Clerk, Arbiter, Quorum, Council, Seeker',
    ...usable.map((u) => u.note),
    final.agentReport,
  ].join('\n')
  final.source = 'on-device'

  onProgress?.({
    stage: 'done',
    progress: 1,
    message: 'Seeker + Council finished — free AI team done',
    aiId: 'seeker',
    aiName: 'Seeker',
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
