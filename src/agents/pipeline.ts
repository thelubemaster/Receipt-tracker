import type { Worker } from 'tesseract.js'
import type { AiId } from '../aiRoster'
import type { ReceiptSuggestion } from '../types'
import { runArbiterAgent } from './arbiterAgent'
import { runLineItemsAgent } from './lineItemsAgent'
import { runMerchantAgent } from './merchantAgent'
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
  /** Named AI currently working (for UI) */
  aiId?: AiId
  aiName?: string
}

/** Downscale + grayscale for low-power OCR. */
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
    const imageData = ctx.getImageData(0, 0, w, h)
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const v = Math.min(255, Math.max(0, (g - 128) * 1.2 + 128))
      d[i] = d[i + 1] = d[i + 2] = v
    }
    ctx.putImageData(imageData, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Image encode failed'))),
        'image/jpeg',
        0.88,
      )
    })
  } finally {
    bitmap.close()
  }
}

function scoreOcrText(text: string): number {
  const lines = text.split(/\n/).filter((l) => l.trim()).length
  const money = (text.match(/\d+[.,]\d{2}/g) || []).length
  const letters = (text.match(/[A-Za-z]/g) || []).length
  return lines * 2 + money * 5 + Math.min(letters, 800) * 0.05
}

let workerPromise: Promise<Worker> | null = null

async function getWorker(onProgress?: (p: AgentProgress) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      onProgress?.({
        stage: 'ocr',
        progress: 0.05,
        message: 'Scout is starting up…',
        aiId: 'scout',
        aiName: 'Scout',
      })
      const Tesseract = await import('tesseract.js')
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            onProgress?.({
              stage: 'ocr',
              progress: 0.12 + m.progress * 0.45,
              message: `Scout is scanning the photo… ${Math.round(m.progress * 100)}%`,
              aiId: 'scout',
              aiName: 'Scout',
            })
          } else if (m.status === 'loading language traineddata') {
            onProgress?.({
              stage: 'ocr',
              progress: 0.08,
              message: 'Scout is loading the offline language pack…',
              aiId: 'scout',
              aiName: 'Scout',
            })
          }
        },
      })
      await worker.setParameters({
        preserve_interword_spaces: '1',
      })
      return worker
    })()
  }
  return workerPromise
}

/**
 * Free high-power path: Forge multi-preprocess OCR, then Ledger/Cashier/Clerk/Arbiter.
 */
export async function runMultiAgentReceiptPipeline(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<LocalAgentResult> {
  onProgress?.({
    stage: 'prepare',
    progress: 0.02,
    message: 'Warming up free AI team…',
    aiId: 'forge',
    aiName: 'Forge',
  })

  // Prefer Forge (free high-power). Fall back to Scout dual-pass if Forge throws.
  let rawText = ''
  let ocrNote = ''
  try {
    const { runForgeOcr } = await import('./forgeOcr')
    const forge = await runForgeOcr(imageBlob, onProgress)
    rawText = forge.text
    ocrNote = `Forge (free high-power): best pass ${forge.bestPass}`
  } catch {
    onProgress?.({
      stage: 'ocr',
      progress: 0.2,
      message: 'Scout is scanning the photo (fallback)…',
      aiId: 'scout',
      aiName: 'Scout',
    })
    const prepared = await prepareImageForOcr(imageBlob)
    const worker = await getWorker(onProgress)
    const Tesseract = await import('tesseract.js')
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO })
    const pass1 = await worker.recognize(prepared)
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT })
    const pass2 = await worker.recognize(prepared)
    const t1 = pass1.data.text || ''
    const t2 = pass2.data.text || ''
    rawText = scoreOcrText(t1) >= scoreOcrText(t2) ? t1 : t2
    ocrNote = 'Scout free OCR fallback'
  }

  onProgress?.({
    stage: 'parse',
    progress: 0.68,
    message: 'Ledger is listing every item on the receipt…',
    aiId: 'ledger',
    aiName: 'Ledger',
  })
  const lines = runLineItemsAgent(rawText)

  onProgress?.({
    stage: 'parse',
    progress: 0.76,
    message: 'Cashier is checking the totals…',
    aiId: 'cashier',
    aiName: 'Cashier',
  })
  const totals = runTotalsAgent(rawText)

  onProgress?.({
    stage: 'parse',
    progress: 0.82,
    message: 'Clerk is reading the store and date…',
    aiId: 'clerk',
    aiName: 'Clerk',
  })
  const merchant = runMerchantAgent(rawText)

  onProgress?.({
    stage: 'arbitrate',
    progress: 0.9,
    message: 'Arbiter is cross-checking the team…',
    aiId: 'arbiter',
    aiName: 'Arbiter',
  })

  const result = runArbiterAgent({ rawText, lines, totals, merchant })
  result.aisUsed = ['forge', 'scout', 'ledger', 'cashier', 'clerk', 'arbiter']
  result.activeAiLabel = 'Free on-device team (Forge → Arbiter)'
  result.agentReport = [
    'Free AI team: Forge, Scout, Ledger, Cashier, Clerk, Arbiter',
    ocrNote,
    result.agentReport,
  ].join('\n')
  result.notes = [result.notes, `${lines.items.length} line items`].filter(Boolean).join(' · ')

  onProgress?.({
    stage: 'done',
    progress: 1,
    message: 'Free on-device AI team finished',
    aiId: 'arbiter',
    aiName: 'Arbiter',
  })
  return result
}

export async function disposeOnDeviceAgent(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise
    await w.terminate()
    workerPromise = null
  }
}
