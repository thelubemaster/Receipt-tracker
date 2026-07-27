/**
 * Forge — free high-power on-device OCR.
 * Multiple preprocess variants + dual page segmentation; keeps richest text.
 */
import type { Worker } from 'tesseract.js'
import type { AgentProgress } from './pipeline'

export type ForgeOcrResult = {
  text: string
  bestPass: string
  scores: { pass: string; score: number; chars: number }[]
}

function scoreOcrText(text: string): number {
  const lines = text.split(/\n/).filter((l) => l.trim()).length
  const money = (text.match(/\d+[.,]\d{2}/g) || []).length
  const letters = (text.match(/[A-Za-z]/g) || []).length
  return lines * 2 + money * 6 + Math.min(letters, 1000) * 0.05
}

async function preprocessVariants(blob: Blob): Promise<{ name: string; blob: Blob }[]> {
  const bitmap = await createImageBitmap(blob)
  const maxEdge = 1600
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))

  const variants: { name: string; blob: Blob }[] = []

  async function render(name: string, map: (r: number, g: number, b: number) => number) {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(bitmap, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h)
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
      const v = map(d[i], d[i + 1], d[i + 2])
      d[i] = d[i + 1] = d[i + 2] = v
    }
    ctx.putImageData(imageData, 0, 0)
    const out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.9)
    })
    variants.push({ name, blob: out })
  }

  // Contrast-boost grayscale
  await render('contrast', (r, g, b) => {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b
    return Math.min(255, Math.max(0, (gray - 128) * 1.35 + 128))
  })
  // Hard threshold (helps faint thermal receipts)
  await render('threshold', (r, g, b) => {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b
    return gray > 140 ? 255 : 0
  })
  // Inverted contrast (dark paper / light ink edge cases)
  await render('invert-soft', (r, g, b) => {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b
    const boosted = Math.min(255, Math.max(0, (gray - 128) * 1.2 + 128))
    return 255 - boosted
  })

  bitmap.close()
  return variants
}

let workerPromise: Promise<Worker> | null = null

async function getWorker(onProgress?: (p: AgentProgress) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      onProgress?.({
        stage: 'ocr',
        progress: 0.05,
        message: 'Forge is starting OCR engine…',
        aiId: 'forge',
        aiName: 'Forge',
      })
      const Tesseract = await import('tesseract.js')
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            onProgress?.({
              stage: 'ocr',
              progress: 0.15 + m.progress * 0.5,
              message: `Forge is deep-scanning the photo… ${Math.round(m.progress * 100)}%`,
              aiId: 'forge',
              aiName: 'Forge',
            })
          }
        },
      })
      await worker.setParameters({ preserve_interword_spaces: '1' })
      return worker
    })()
  }
  return workerPromise
}

export async function runForgeOcr(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<ForgeOcrResult> {
  onProgress?.({
    stage: 'prepare',
    progress: 0.04,
    message: 'Forge is preparing high-power passes…',
    aiId: 'forge',
    aiName: 'Forge',
  })

  const variants = await preprocessVariants(imageBlob)
  const worker = await getWorker(onProgress)
  const Tesseract = await import('tesseract.js')

  const scores: ForgeOcrResult['scores'] = []
  let bestText = ''
  let bestScore = -1
  let bestPass = ''

  const modes = [
    { name: 'auto', psm: Tesseract.PSM.AUTO },
    { name: 'sparse', psm: Tesseract.PSM.SPARSE_TEXT },
  ]

  let step = 0
  const total = variants.length * modes.length
  for (const variant of variants) {
    for (const mode of modes) {
      step++
      onProgress?.({
        stage: 'ocr',
        progress: 0.1 + (step / total) * 0.7,
        message: `Forge is scanning (${variant.name}/${mode.name})…`,
        aiId: 'forge',
        aiName: 'Forge',
      })
      await worker.setParameters({ tessedit_pageseg_mode: mode.psm })
      const result = await worker.recognize(variant.blob)
      const text = result.data.text || ''
      const score = scoreOcrText(text)
      const pass = `${variant.name}+${mode.name}`
      scores.push({ pass, score, chars: text.length })
      if (score > bestScore) {
        bestScore = score
        bestText = text
        bestPass = pass
      }
    }
  }

  onProgress?.({
    stage: 'ocr',
    progress: 0.85,
    message: `Forge picked best pass: ${bestPass}`,
    aiId: 'forge',
    aiName: 'Forge',
  })

  return { text: bestText, bestPass, scores }
}

export async function disposeForgeWorker(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise
    await w.terminate()
    workerPromise = null
  }
}
