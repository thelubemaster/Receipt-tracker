/**
 * Forge — free high-power on-device OCR.
 * Multiple preprocess variants + receipt-oriented page segmentation; keeps richest text.
 */
import type { Worker } from 'tesseract.js'
import type { AgentProgress } from './pipeline'
import { scoreOcrText } from './ocrScore'

export type ForgeOcrResult = {
  text: string
  bestPass: string
  scores: { pass: string; score: number; chars: number }[]
}

async function blobFromGray(
  w: number,
  h: number,
  gray: Uint8ClampedArray,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  const imageData = ctx.createImageData(w, h)
  const d = imageData.data
  for (let p = 0; p < w * h; p++) {
    const v = gray[p]
    const i = p * 4
    d[i] = d[i + 1] = d[i + 2] = v
    d[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png')
  })
}

/**
 * Receipt-friendly preprocess variants.
 * Avoid a single global hard threshold — that destroys thermal gray text.
 */
async function preprocessVariants(blob: Blob): Promise<{ name: string; blob: Blob }[]> {
  const bitmap = await createImageBitmap(blob)
  const maxEdge = 1800
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    bitmap.close()
    throw new Error('Canvas unavailable')
  }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const n = w * h
  const base = new Uint8ClampedArray(n)
  for (let p = 0; p < n; p++) {
    const i = p * 4
    base[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  }

  // Percentile stretch → contrast gray
  const samples: number[] = []
  const step = Math.max(1, Math.floor(n / 50_000))
  for (let p = 0; p < n; p += step) samples.push(base[p])
  samples.sort((a, b) => a - b)
  const lo = samples[Math.floor(samples.length * 0.02)] ?? 0
  const hi = samples[Math.floor(samples.length * 0.98)] ?? 255
  const range = Math.max(1, hi - lo)
  const contrast = new Uint8ClampedArray(n)
  for (let p = 0; p < n; p++) {
    contrast[p] = Math.max(0, Math.min(255, ((base[p] - lo) / range) * 255))
  }

  // Adaptive local threshold (block mean) — robust on uneven lighting
  const adaptive = new Uint8ClampedArray(n)
  const block = Math.max(15, Math.floor(Math.min(w, h) / 40) | 1) // odd
  const half = (block / 2) | 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let c = 0
      for (let dy = -half; dy <= half; dy += 2) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -half; dx <= half; dx += 2) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          sum += contrast[yy * w + xx]
          c++
        }
      }
      const mean = c ? sum / c : 128
      const v = contrast[y * w + x]
      // Slightly below local mean → ink (black)
      adaptive[y * w + x] = v < mean - 8 ? 0 : 255
    }
  }

  // Soft global threshold as a third option (only when contrast is decent)
  const softThresh = new Uint8ClampedArray(n)
  const mid = samples[Math.floor(samples.length * 0.55)] ?? 140
  for (let p = 0; p < n; p++) {
    softThresh[p] = contrast[p] > mid ? 255 : 0
  }

  const variants: { name: string; blob: Blob }[] = [
    { name: 'contrast', blob: await blobFromGray(w, h, contrast) },
    { name: 'adaptive', blob: await blobFromGray(w, h, adaptive) },
    { name: 'soft-bin', blob: await blobFromGray(w, h, softThresh) },
  ]
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
      // Receipt-friendly defaults (spaces + no forced dictionary “corrections” on SKUs)
      await worker.setParameters({
        preserve_interword_spaces: '1',
        // Allow digits and common receipt punctuation; letters still free via default
        tessedit_char_blacklist: '|{}[]<>~`',
      })
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
  // Always include the already-prepped input as a “color/gray as-is” pass
  variants.unshift({ name: 'as-is', blob: imageBlob })

  const worker = await getWorker(onProgress)
  const Tesseract = await import('tesseract.js')

  const scores: ForgeOcrResult['scores'] = []
  let bestText = ''
  let bestScore = -1
  let bestPass = ''

  // Receipt layout modes: tall column, block of text, sparse labels
  const modes = [
    { name: 'column', psm: Tesseract.PSM.SINGLE_COLUMN },
    { name: 'block', psm: Tesseract.PSM.SINGLE_BLOCK },
    { name: 'auto', psm: Tesseract.PSM.AUTO },
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
      await worker.setParameters({
        tessedit_pageseg_mode: mode.psm,
        preserve_interword_spaces: '1',
      })
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
