/**
 * Wedge — free deskew OCR (no API key).
 * Estimates skew from edge contrast, rotates, then OCR.
 * Helps crooked phone photos of paper receipts.
 */
import type { AgentProgress } from './pipeline'

export type WedgeOcrResult = {
  text: string
  angleDeg: number
  bestPass: string
}

function estimateSkewDegrees(imageData: ImageData): number {
  // Sample horizontal projection variance at small angles
  const { width: w, height: h, data } = imageData
  const angles = [-4, -2.5, -1.5, -0.8, 0, 0.8, 1.5, 2.5, 4]
  let best = 0
  let bestScore = -Infinity

  for (const deg of angles) {
    const rad = (deg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    // project a band of dark pixels
    const bins = new Float64Array(h)
    const step = Math.max(2, Math.floor(w / 120))
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4
        const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        if (g > 140) continue
        // rotate point around center
        const cx = x - w / 2
        const cy = y - h / 2
        const ry = Math.round(cx * sin + cy * cos + h / 2)
        if (ry >= 0 && ry < h) bins[ry] += 1
      }
    }
    // score = variance of projection (text lines create peaks)
    let mean = 0
    for (let i = 0; i < h; i++) mean += bins[i]
    mean /= h
    let var_ = 0
    for (let i = 0; i < h; i++) {
      const d = bins[i] - mean
      var_ += d * d
    }
    if (var_ > bestScore) {
      bestScore = var_
      best = deg
    }
  }
  return best
}

async function deskewBlob(blob: Blob): Promise<{ blob: Blob; angleDeg: number }> {
  const bitmap = await createImageBitmap(blob)
  try {
    const maxEdge = 1600
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
    const angleDeg = estimateSkewDegrees(imageData)

    const pad = Math.ceil(Math.max(w, h) * 0.05)
    const out = document.createElement('canvas')
    out.width = w + pad * 2
    out.height = h + pad * 2
    const octx = out.getContext('2d')
    if (!octx) throw new Error('Canvas unavailable')
    octx.fillStyle = '#ffffff'
    octx.fillRect(0, 0, out.width, out.height)
    octx.translate(out.width / 2, out.height / 2)
    octx.rotate((-angleDeg * Math.PI) / 180)
    octx.drawImage(canvas, -w / 2, -h / 2)
    // contrast
    const id = octx.getImageData(0, 0, out.width, out.height)
    const d = id.data
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const v = Math.min(255, Math.max(0, (g - 128) * 1.35 + 128))
      d[i] = d[i + 1] = d[i + 2] = v
    }
    octx.putImageData(id, 0, 0)

    const outBlob = await new Promise<Blob>((resolve, reject) => {
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.9)
    })
    return { blob: outBlob, angleDeg }
  } finally {
    bitmap.close()
  }
}

export async function runWedgeOcr(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<WedgeOcrResult> {
  onProgress?.({
    stage: 'ocr',
    progress: 0.22,
    message: 'Wedge is straightening the receipt…',
    aiId: 'wedge',
    aiName: 'Wedge',
  })

  const { blob, angleDeg } = await deskewBlob(imageBlob)
  const Tesseract = await import('tesseract.js')
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.({
          stage: 'ocr',
          progress: 0.3 + m.progress * 0.4,
          message: `Wedge OCR after deskew (${angleDeg.toFixed(1)}°)… ${Math.round(m.progress * 100)}%`,
          aiId: 'wedge',
          aiName: 'Wedge',
        })
      }
    },
  })
  try {
    await worker.setParameters({
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
    })
    const r = await worker.recognize(blob)
    const text = (r.data.text || '').trim()
    return {
      text,
      angleDeg,
      bestPass: `wedge-deskew-${angleDeg.toFixed(1)}`,
    }
  } finally {
    await worker.terminate()
  }
}
