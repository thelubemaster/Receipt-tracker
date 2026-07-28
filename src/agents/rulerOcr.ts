/**
 * Ruler — free layout-aware document OCR.
 * Reads word boxes (not just a text dump) so each receipt row keeps its
 * product name + price together. Built for multi-line item lists.
 */
import type { Worker } from 'tesseract.js'
import type { AgentProgress } from './pipeline'
import {
  reconstructDocumentText,
  scoreLayoutText,
  type OcrWordBox,
} from './layoutReconstruct'

export type RulerOcrResult = {
  text: string
  plainText: string
  bestPass: string
  lineCount: number
  wordCount: number
  scores: { pass: string; score: number; chars: number }[]
}

async function documentPreprocess(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    // Upscale small phone photos so fine line items stay sharp
    const maxEdge = 2000
    const minEdge = 1200
    const long = Math.max(bitmap.width, bitmap.height)
    let scale = Math.min(1.8, maxEdge / long)
    if (long * scale < minEdge) scale = minEdge / long
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h)
    const d = imageData.data
    // Strong contrast grayscale — helps thermal + phone glare
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const boosted = Math.min(255, Math.max(0, (gray - 128) * 1.45 + 128))
      d[i] = d[i + 1] = d[i + 2] = boosted
    }
    ctx.putImageData(imageData, 0, 0)
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png')
    })
  } finally {
    bitmap.close()
  }
}

function wordsFromTesseract(data: {
  words?: Array<{
    text: string
    confidence: number
    bbox: { x0: number; y0: number; x1: number; y1: number }
  }>
  lines?: Array<{
    text: string
    confidence: number
    bbox: { x0: number; y0: number; x1: number; y1: number }
    words?: Array<{
      text: string
      confidence: number
      bbox: { x0: number; y0: number; x1: number; y1: number }
    }>
  }>
}): OcrWordBox[] {
  const out: OcrWordBox[] = []
  if (data.words?.length) {
    for (const w of data.words) {
      if (!w?.text?.trim()) continue
      out.push({
        text: w.text,
        x0: w.bbox.x0,
        y0: w.bbox.y0,
        x1: w.bbox.x1,
        y1: w.bbox.y1,
        confidence: w.confidence,
      })
    }
    return out
  }
  // Fallback: explode lines into pseudo-words (left→right estimate)
  if (data.lines?.length) {
    for (const line of data.lines) {
      if (line.words?.length) {
        for (const w of line.words) {
          out.push({
            text: w.text,
            x0: w.bbox.x0,
            y0: w.bbox.y0,
            x1: w.bbox.x1,
            y1: w.bbox.y1,
            confidence: w.confidence,
          })
        }
      } else if (line.text?.trim()) {
        out.push({
          text: line.text.trim(),
          x0: line.bbox.x0,
          y0: line.bbox.y0,
          x1: line.bbox.x1,
          y1: line.bbox.y1,
          confidence: line.confidence,
        })
      }
    }
  }
  return out
}

let workerPromise: Promise<Worker> | null = null

async function getWorker(onProgress?: (p: AgentProgress) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      onProgress?.({
        stage: 'ocr',
        progress: 0.08,
        message: 'Ruler is loading layout OCR…',
        aiId: 'ruler',
        aiName: 'Ruler',
      })
      const Tesseract = await import('tesseract.js')
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            onProgress?.({
              stage: 'ocr',
              progress: 0.2 + m.progress * 0.45,
              message: `Ruler is mapping every line on the photo… ${Math.round(m.progress * 100)}%`,
              aiId: 'ruler',
              aiName: 'Ruler',
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

export async function runRulerOcr(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<RulerOcrResult> {
  onProgress?.({
    stage: 'prepare',
    progress: 0.06,
    message: 'Ruler is sharpening the document for line reading…',
    aiId: 'ruler',
    aiName: 'Ruler',
  })

  const prepared = await documentPreprocess(imageBlob)
  const worker = await getWorker(onProgress)
  const Tesseract = await import('tesseract.js')

  // Document-friendly page modes (not sparse free-form)
  const modes = [
    { name: 'auto', psm: Tesseract.PSM.AUTO },
    { name: 'single-block', psm: Tesseract.PSM.SINGLE_BLOCK },
    { name: 'sparse', psm: Tesseract.PSM.SPARSE_TEXT },
  ]

  const scores: RulerOcrResult['scores'] = []
  let bestText = ''
  let bestPlain = ''
  let bestScore = -1
  let bestPass = ''
  let bestWords = 0
  let bestLines = 0

  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i]
    onProgress?.({
      stage: 'ocr',
      progress: 0.15 + (i / modes.length) * 0.55,
      message: `Ruler layout pass (${mode.name})…`,
      aiId: 'ruler',
      aiName: 'Ruler',
    })

    await worker.setParameters({
      tessedit_pageseg_mode: mode.psm,
      preserve_interword_spaces: '1',
    })

    const result = await worker.recognize(prepared)
    const plain = (result.data.text || '').trim()
    const words = wordsFromTesseract(result.data as Parameters<typeof wordsFromTesseract>[0])
    const pageW =
      (result.data as { imageWidth?: number }).imageWidth ||
      (words.length ? Math.max(...words.map((w) => w.x1)) : 0)
    const pageH =
      (result.data as { imageHeight?: number }).imageHeight ||
      (words.length ? Math.max(...words.map((w) => w.y1)) : 0)

    const rebuilt = reconstructDocumentText(words, pageW, pageH)
    // Prefer layout text; keep plain as fallback if layout collapsed
    const layoutScore = scoreLayoutText(rebuilt.text)
    const plainScore = scoreLayoutText(plain) * 0.85
    const useLayout = rebuilt.text.trim().length > 20 && layoutScore >= plainScore * 0.9
    const text = useLayout ? rebuilt.text : plain || rebuilt.text
    const score = Math.max(layoutScore, plainScore) + (useLayout ? 5 : 0)
    const pass = `ruler+${mode.name}${useLayout ? '+layout' : '+plain'}`

    scores.push({ pass, score, chars: text.length })
    if (score > bestScore) {
      bestScore = score
      bestText = text
      bestPlain = plain
      bestPass = pass
      bestWords = words.length
      bestLines = rebuilt.lines.length || text.split('\n').length
    }
  }

  onProgress?.({
    stage: 'ocr',
    progress: 0.72,
    message: `Ruler locked ${bestLines} document lines (${bestPass})`,
    aiId: 'ruler',
    aiName: 'Ruler',
  })

  return {
    text: bestText,
    plainText: bestPlain,
    bestPass,
    lineCount: bestLines,
    wordCount: bestWords,
    scores,
  }
}

export async function disposeRulerWorker(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise
    await w.terminate()
    workerPromise = null
  }
}
