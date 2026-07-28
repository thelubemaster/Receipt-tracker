/**
 * Mosaic — free tile OCR (no API key).
 * Splits the receipt into a grid, OCR each tile, stitches lines.
 * Heavy on CPU/memory — great on desktop, optional on phone.
 */
import type { AgentProgress } from './pipeline'

export type MosaicOcrResult = {
  text: string
  tiles: number
  bestPass: string
}

async function tileBlobs(blob: Blob): Promise<{ name: string; blob: Blob }[]> {
  const bitmap = await createImageBitmap(blob)
  try {
    const maxW = 1600
    const scale = Math.min(1, maxW / bitmap.width)
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const cols = w > 900 ? 2 : 1
    const rows = h > 1400 ? 4 : h > 900 ? 3 : 2
    const overlap = 0.08
    const out: { name: string; blob: Blob }[] = []

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tw = w / cols
        const th = h / rows
        const ox = tw * overlap
        const oy = th * overlap
        const x0 = Math.max(0, Math.floor(c * tw - (c > 0 ? ox : 0)))
        const y0 = Math.max(0, Math.floor(r * th - (r > 0 ? oy : 0)))
        const x1 = Math.min(w, Math.ceil((c + 1) * tw + (c < cols - 1 ? ox : 0)))
        const y1 = Math.min(h, Math.ceil((r + 1) * th + (r < rows - 1 ? oy : 0)))
        const cw = Math.max(1, x1 - x0)
        const ch = Math.max(1, y1 - y0)
        const canvas = document.createElement('canvas')
        canvas.width = cw
        canvas.height = ch
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, cw, ch)
        // draw scaled full image then crop region
        const full = document.createElement('canvas')
        full.width = w
        full.height = h
        const fctx = full.getContext('2d')
        if (!fctx) continue
        fctx.drawImage(bitmap, 0, 0, w, h)
        // contrast
        const id = fctx.getImageData(0, 0, w, h)
        const d = id.data
        for (let i = 0; i < d.length; i += 4) {
          const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
          const v = Math.min(255, Math.max(0, (g - 128) * 1.4 + 128))
          d[i] = d[i + 1] = d[i + 2] = v
        }
        fctx.putImageData(id, 0, 0)
        ctx.drawImage(full, x0, y0, cw, ch, 0, 0, cw, ch)
        const tileBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.9)
        })
        out.push({ name: `r${r}c${c}`, blob: tileBlob })
      }
    }
    return out
  } finally {
    bitmap.close()
  }
}

export async function runMosaicOcr(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<MosaicOcrResult> {
  onProgress?.({
    stage: 'ocr',
    progress: 0.2,
    message: 'Mosaic is tiling the receipt for piece-by-piece OCR…',
    aiId: 'mosaic',
    aiName: 'Mosaic',
  })

  const tiles = await tileBlobs(imageBlob)
  const Tesseract = await import('tesseract.js')
  const worker = await Tesseract.createWorker('eng', 1)
  await worker.setParameters({
    preserve_interword_spaces: '1',
    tessedit_pageseg_mode: Tesseract.PSM.AUTO,
  })

  const parts: string[] = []
  try {
    for (let i = 0; i < tiles.length; i++) {
      onProgress?.({
        stage: 'ocr',
        progress: 0.25 + (i / Math.max(1, tiles.length)) * 0.45,
        message: `Mosaic OCR tile ${i + 1}/${tiles.length}…`,
        aiId: 'mosaic',
        aiName: 'Mosaic',
      })
      const r = await worker.recognize(tiles[i].blob)
      const t = (r.data.text || '').trim()
      if (t) parts.push(t)
    }
  } finally {
    await worker.terminate()
  }

  const text = parts.join('\n')
  onProgress?.({
    stage: 'ocr',
    progress: 0.72,
    message: `Mosaic stitched ${tiles.length} tiles · ${text.length} chars`,
    aiId: 'mosaic',
    aiName: 'Mosaic',
  })

  return {
    text,
    tiles: tiles.length,
    bestPass: `mosaic-${tiles.length}tiles`,
  }
}
