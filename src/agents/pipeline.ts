import type { AiId } from '../aiRoster'
import type { ReceiptSuggestion } from '../types'
import { runArbiterAgent } from './arbiterAgent'
import { runForgeOcr } from './forgeOcr'
import { mergeOcrTexts, runLensOcr } from './lensOcr'
import { runLineItemsAgent } from './lineItemsAgent'
import { runMerchantAgent } from './merchantAgent'
import { runQuorumAgent } from './quorumAgent'
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

/** Quick Scout dual-pass OCR (free). */
async function runScoutOcr(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<string> {
  onProgress?.({
    stage: 'ocr',
    progress: 0.12,
    message: 'Scout is scanning the photo…',
    aiId: 'scout',
    aiName: 'Scout',
  })
  const Tesseract = await import('tesseract.js')
  const worker = await Tesseract.createWorker('eng', 1)
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' })
    // simple prep
    const bitmap = await createImageBitmap(imageBlob)
    const maxEdge = 1400
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.88)
    })
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO })
    const p1 = await worker.recognize(blob)
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT })
    const p2 = await worker.recognize(blob)
    const t1 = p1.data.text || ''
    const t2 = p2.data.text || ''
    return scoreOcrText(t1) >= scoreOcrText(t2) ? t1 : t2
  } finally {
    await worker.terminate()
  }
}

function parseFromText(
  rawText: string,
  label: string,
  ocrNote: string,
  extraAis: AiId[],
): LocalAgentResult {
  const sieve = runSieveAgent(rawText)
  // Prefer sieve items (includes ledger-style + relaxed)
  const lines = sieve
  const totals = runTotalsAgent(rawText)
  const merchant = runMerchantAgent(rawText)
  // Also run pure ledger for report comparison
  const ledgerOnly = runLineItemsAgent(rawText)

  const result = runArbiterAgent({
    rawText,
    lines: {
      ...lines,
      notes: [...lines.notes, `Ledger alone: ${ledgerOnly.items.length} items`],
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
    `Ledger: ${ledgerOnly.items.length} items · Sieve: ${sieve.items.length} items`,
    result.agentReport,
  ].join('\n')
  return result
}

/**
 * Free keyless multi-agent pipeline:
 * Forge + Lens OCR → Sieve/Ledger/Cashier/Clerk/Arbiter on each text → Quorum vote.
 */
export async function runMultiAgentReceiptPipeline(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<LocalAgentResult> {
  onProgress?.({
    stage: 'prepare',
    progress: 0.02,
    message: 'Starting free keyless AI team…',
    aiId: 'forge',
    aiName: 'Forge',
  })

  // --- Forge (high-power preprocess OCR) ---
  let forgeText = ''
  let forgeNote = 'Forge unavailable'
  try {
    const forge = await runForgeOcr(imageBlob, onProgress)
    forgeText = forge.text
    forgeNote = `Forge best pass: ${forge.bestPass}`
  } catch (e) {
    forgeNote = `Forge failed: ${e instanceof Error ? e.message : 'error'}`
  }

  // --- Lens (upscale OCR) ---
  let lensText = ''
  let lensNote = 'Lens unavailable'
  try {
    const lens = await runLensOcr(imageBlob, onProgress)
    lensText = lens.text
    lensNote = `Lens best pass: ${lens.bestPass}`
  } catch (e) {
    lensNote = `Lens failed: ${e instanceof Error ? e.message : 'error'}`
  }

  // --- Scout fallback if both empty ---
  if (!forgeText.trim() && !lensText.trim()) {
    try {
      forgeText = await runScoutOcr(imageBlob, onProgress)
      forgeNote = 'Scout fallback OCR'
    } catch (e) {
      throw new Error(
        e instanceof Error ? e.message : 'All free OCR engines failed on this device',
      )
    }
  }

  onProgress?.({
    stage: 'parse',
    progress: 0.72,
    message: 'Ledger & Sieve are listing items…',
    aiId: 'sieve',
    aiName: 'Sieve',
  })

  const parseA = parseFromText(
    forgeText || lensText,
    'Forge path',
    forgeNote,
    forgeText ? ['forge'] : ['scout'],
  )

  onProgress?.({
    stage: 'parse',
    progress: 0.8,
    message: 'Cashier & Clerk on Lens text…',
    aiId: 'cashier',
    aiName: 'Cashier',
  })

  const parseB = parseFromText(
    lensText || forgeText,
    'Lens path',
    lensNote,
    lensText ? ['lens'] : forgeText ? ['forge'] : ['scout'],
  )

  // Optional: also parse merged OCR for more coverage
  const mergedText = mergeOcrTexts(forgeText, lensText)
  const parseM =
    mergedText && mergedText !== forgeText && mergedText !== lensText
      ? parseFromText(mergedText, 'Merged OCR path', 'Forge+Lens line merge', [
          'forge',
          'lens',
        ])
      : null

  onProgress?.({
    stage: 'arbitrate',
    progress: 0.9,
    message: 'Quorum is voting on the final answer…',
    aiId: 'quorum',
    aiName: 'Quorum',
  })

  let final = runQuorumAgent(parseA, parseB)
  if (parseM) {
    final = runQuorumAgent(final, parseM)
  }

  // Ensure scout tag if used
  if (!forgeText && !lensText) {
    final.aisUsed = Array.from(new Set([...(final.aisUsed ?? []), 'scout' as AiId]))
  }
  final.aisUsed = Array.from(
    new Set<AiId>([
      ...(final.aisUsed ?? []),
      'forge',
      'lens',
      'ledger',
      'sieve',
      'cashier',
      'clerk',
      'arbiter',
      'quorum',
    ]),
  )
  final.activeAiLabel = 'Free keyless team (Quorum)'
  final.agentReport = [
    'Free keyless AIs: Forge, Lens, Scout, Ledger, Sieve, Cashier, Clerk, Arbiter, Quorum',
    forgeNote,
    lensNote,
    final.agentReport,
  ].join('\n')
  final.source = 'on-device'

  onProgress?.({
    stage: 'done',
    progress: 1,
    message: 'Free AI team finished',
    aiId: 'quorum',
    aiName: 'Quorum',
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
    const out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.88)
    })
    return out
  } finally {
    bitmap.close()
  }
}
