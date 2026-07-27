/**
 * Hammer — free max-CPU parallel OCR swarm (no API key).
 * Spawns multiple Tesseract workers and runs many image variants concurrently.
 */
import Tesseract from 'tesseract.js'
import type { AgentProgress } from './pipeline'

export type HammerResult = {
  text: string
  bestPass: string
  scores: { pass: string; score: number; chars: number }[]
  workersUsed: number
  variantsRun: number
}

function scoreOcrText(text: string): number {
  const lines = text.split(/\n/).filter((l) => l.trim()).length
  const money = (text.match(/\d+[.,]\d{2}/g) || []).length
  const letters = (text.match(/[A-Za-z]/g) || []).length
  return lines * 2 + money * 7 + Math.min(letters, 1200) * 0.06
}

async function blobFromCanvas(
  canvas: HTMLCanvasElement,
  quality = 0.9,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality)
  })
}

type Variant = { name: string; blob: Blob }

async function buildVariants(blob: Blob): Promise<Variant[]> {
  const bitmap = await createImageBitmap(blob)
  const maxEdge = 1800
  const baseScale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const variants: Variant[] = []

  const scales = [1, 1.25, 1.5, 1.75]
  const maps: { name: string; fn: (r: number, g: number, b: number) => number }[] = [
    {
      name: 'contrast',
      fn: (r, g, b) => {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b
        return Math.min(255, Math.max(0, (gray - 128) * 1.4 + 128))
      },
    },
    {
      name: 'thresh',
      fn: (r, g, b) => {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b
        return gray > 135 ? 255 : 0
      },
    },
    {
      name: 'soft',
      fn: (r, g, b) => {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b
        return Math.min(255, Math.max(0, (gray - 100) * 1.15 + 90))
      },
    },
  ]

  try {
    for (const scale of scales) {
      const w = Math.max(1, Math.round(bitmap.width * baseScale * scale))
      const h = Math.max(1, Math.round(bitmap.height * baseScale * scale))
      if (w * h > 1800 * 2400) continue // cap memory
      for (const m of maps) {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        ctx.drawImage(bitmap, 0, 0, w, h)
        const imageData = ctx.getImageData(0, 0, w, h)
        const d = imageData.data
        for (let i = 0; i < d.length; i += 4) {
          const v = m.fn(d[i], d[i + 1], d[i + 2])
          d[i] = d[i + 1] = d[i + 2] = v
        }
        ctx.putImageData(imageData, 0, 0)
        variants.push({
          name: `${m.name}@${scale.toFixed(2)}`,
          blob: await blobFromCanvas(canvas, 0.88),
        })
      }
    }
  } finally {
    bitmap.close()
  }

  return variants
}

async function createWorkerPool(size: number) {
  const workers = await Promise.all(
    Array.from({ length: size }, () =>
      Tesseract.createWorker('eng', 1, {
        // quieter
        logger: () => {},
      }),
    ),
  )
  for (const w of workers) {
    await w.setParameters({ preserve_interword_spaces: '1' })
  }
  return workers
}

/**
 * Hammer: parallel multi-worker OCR across many variants.
 * Uses ~min(4, hardwareConcurrency) workers — designed to load the phone.
 */
export async function runHammerOcr(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<HammerResult> {
  const cores = navigator.hardwareConcurrency || 2
  const poolSize = Math.min(4, Math.max(2, Math.floor(cores / 1))) // 2–4 workers

  onProgress?.({
    stage: 'ocr',
    progress: 0.05,
    message: `Hammer is spinning up ${poolSize} OCR workers…`,
    aiId: 'hammer',
    aiName: 'Hammer',
  })

  const variants = await buildVariants(imageBlob)
  const workers = await createWorkerPool(poolSize)
  const TesseractMod = Tesseract

  const jobs: { name: string; blob: Blob; psm: Tesseract.PSM }[] = []
  const psms: Tesseract.PSM[] = [TesseractMod.PSM.AUTO, TesseractMod.PSM.SPARSE_TEXT]
  for (const v of variants) {
    for (const psm of psms) {
      jobs.push({ name: `${v.name}+psm${psm}`, blob: v.blob, psm })
    }
  }

  // Cap jobs to keep runtime sane but still heavy (~16–24)
  const maxJobs = Math.min(jobs.length, poolSize * 6)
  const queue = jobs.slice(0, maxJobs)

  onProgress?.({
    stage: 'ocr',
    progress: 0.12,
    message: `Hammer is running ${queue.length} parallel OCR jobs on ${poolSize} workers…`,
    aiId: 'hammer',
    aiName: 'Hammer',
  })

  let completed = 0
  const scores: HammerResult['scores'] = []
  let bestText = ''
  let bestScore = -1
  let bestPass = ''

  let cursor = 0
  async function workerLoop(worker: Tesseract.Worker) {
    while (cursor < queue.length) {
      const jobIndex = cursor++
      const job = queue[jobIndex]
      try {
        await worker.setParameters({ tessedit_pageseg_mode: job.psm })
        const result = await worker.recognize(job.blob)
        const text = result.data.text || ''
        const score = scoreOcrText(text)
        scores.push({ pass: job.name, score, chars: text.length })
        if (score > bestScore) {
          bestScore = score
          bestText = text
          bestPass = job.name
        }
      } catch {
        scores.push({ pass: job.name, score: 0, chars: 0 })
      }
      completed++
      onProgress?.({
        stage: 'ocr',
        progress: 0.12 + (completed / queue.length) * 0.7,
        message: `Hammer OCR swarm ${completed}/${queue.length}…`,
        aiId: 'hammer',
        aiName: 'Hammer',
      })
    }
  }

  try {
    await Promise.all(workers.map((w) => workerLoop(w)))
  } finally {
    await Promise.all(workers.map((w) => w.terminate()))
  }

  onProgress?.({
    stage: 'ocr',
    progress: 0.85,
    message: `Hammer finished — best ${bestPass}`,
    aiId: 'hammer',
    aiName: 'Hammer',
  })

  return {
    text: bestText,
    bestPass,
    scores,
    workersUsed: poolSize,
    variantsRun: queue.length,
  }
}
