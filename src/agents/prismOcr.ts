/**
 * Prism — free multi-layout OCR (no API key).
 * Runs several Tesseract page-segmentation modes on one preprocess
 * and keeps the richest text. Medium-heavy CPU.
 */
import type { AgentProgress } from './pipeline'

export type PrismOcrResult = {
  text: string
  bestPass: string
  modesRun: number
}

function score(text: string): number {
  const lines = text.split(/\n/).filter((l) => l.trim()).length
  const money = (text.match(/\d+[.,]\d{2}/g) || []).length
  const letters = (text.match(/[A-Za-z]/g) || []).length
  return lines * 2 + money * 7 + Math.min(letters, 1000) * 0.05
}

async function prep(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const maxEdge = 1700
    const scale = Math.min(1.2, maxEdge / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(bitmap, 0, 0, w, h)
    const id = ctx.getImageData(0, 0, w, h)
    const d = id.data
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const v = Math.min(255, Math.max(0, (g - 128) * 1.5 + 128))
      d[i] = d[i + 1] = d[i + 2] = v
    }
    ctx.putImageData(id, 0, 0)
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png')
    })
  } finally {
    bitmap.close()
  }
}

export async function runPrismOcr(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<PrismOcrResult> {
  onProgress?.({
    stage: 'ocr',
    progress: 0.18,
    message: 'Prism is splitting light across layout modes…',
    aiId: 'prism',
    aiName: 'Prism',
  })

  const prepared = await prep(imageBlob)
  const Tesseract = await import('tesseract.js')
  const modes = [
    { name: 'auto', psm: Tesseract.PSM.AUTO },
    { name: 'single-block', psm: Tesseract.PSM.SINGLE_BLOCK },
    { name: 'single-column', psm: Tesseract.PSM.SINGLE_COLUMN },
    { name: 'sparse', psm: Tesseract.PSM.SPARSE_TEXT },
    { name: 'raw-line', psm: Tesseract.PSM.RAW_LINE },
  ]

  const worker = await Tesseract.createWorker('eng', 1)
  let bestText = ''
  let bestScore = -1
  let bestPass = ''
  try {
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i]
      onProgress?.({
        stage: 'ocr',
        progress: 0.22 + (i / modes.length) * 0.45,
        message: `Prism layout mode: ${mode.name}…`,
        aiId: 'prism',
        aiName: 'Prism',
      })
      await worker.setParameters({
        tessedit_pageseg_mode: mode.psm,
        preserve_interword_spaces: '1',
      })
      const r = await worker.recognize(prepared)
      const text = r.data.text || ''
      const s = score(text)
      if (s > bestScore) {
        bestScore = s
        bestText = text
        bestPass = `prism+${mode.name}`
      }
    }
  } finally {
    await worker.terminate()
  }

  return { text: bestText.trim(), bestPass, modesRun: modes.length }
}
