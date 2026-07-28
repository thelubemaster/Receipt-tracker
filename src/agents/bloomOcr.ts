/**
 * Bloom — free aggressive upscale OCR (no API key).
 * 2× enlarge + contrast, then OCR. Heavy on memory — optional on small phones.
 */
import type { AgentProgress } from './pipeline'

export type BloomOcrResult = {
  text: string
  bestPass: string
  scale: number
}

async function bloomPrep(blob: Blob, factor: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const maxEdge = 2200
    let w = Math.round(bitmap.width * factor)
    let h = Math.round(bitmap.height * factor)
    const long = Math.max(w, h)
    if (long > maxEdge) {
      const s = maxEdge / long
      w = Math.max(1, Math.round(w * s))
      h = Math.max(1, Math.round(h * s))
    }
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    const id = ctx.getImageData(0, 0, w, h)
    const d = id.data
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      // hard boost for faint thermal ink
      let v = Math.min(255, Math.max(0, (g - 128) * 1.65 + 128))
      if (v > 155) v = 255
      else if (v < 100) v = 0
      d[i] = d[i + 1] = d[i + 2] = v
    }
    ctx.putImageData(id, 0, 0)
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.88)
    })
  } finally {
    bitmap.close()
  }
}

export async function runBloomOcr(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<BloomOcrResult> {
  const scale = 2
  onProgress?.({
    stage: 'ocr',
    progress: 0.2,
    message: 'Bloom is enlarging the receipt 2× for fine print…',
    aiId: 'bloom',
    aiName: 'Bloom',
  })

  const prepared = await bloomPrep(imageBlob, scale)
  const Tesseract = await import('tesseract.js')
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.({
          stage: 'ocr',
          progress: 0.35 + m.progress * 0.4,
          message: `Bloom OCR on upscaled photo… ${Math.round(m.progress * 100)}%`,
          aiId: 'bloom',
          aiName: 'Bloom',
        })
      }
    },
  })
  try {
    await worker.setParameters({
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
    })
    const r = await worker.recognize(prepared)
    return {
      text: (r.data.text || '').trim(),
      bestPass: `bloom-x${scale}`,
      scale,
    }
  } finally {
    await worker.terminate()
  }
}
