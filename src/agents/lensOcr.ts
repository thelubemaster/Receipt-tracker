/**
 * Lens — free multi-scale OCR (no API key).
 * Upscales image so tiny receipt text is more readable, then OCR.
 */
import type { AgentProgress } from './pipeline'
import { runForgeOcr, type ForgeOcrResult } from './forgeOcr'

async function upscaleBlob(blob: Blob, factor = 1.6): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const w = Math.min(2000, Math.round(bitmap.width * factor))
    const h = Math.min(2800, Math.round(bitmap.height * factor))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    // mild unsharp-ish contrast
    const imageData = ctx.getImageData(0, 0, w, h)
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const v = Math.min(255, Math.max(0, (g - 128) * 1.25 + 128))
      d[i] = d[i + 1] = d[i + 2] = v
    }
    ctx.putImageData(imageData, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.9)
    })
  } finally {
    bitmap.close()
  }
}

export async function runLensOcr(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<ForgeOcrResult> {
  onProgress?.({
    stage: 'ocr',
    progress: 0.35,
    message: 'Lens is magnifying fine print…',
    aiId: 'lens',
    aiName: 'Lens',
  })
  const up = await upscaleBlob(imageBlob, 1.55)
  const result = await runForgeOcr(up, (p) =>
    onProgress?.({
      ...p,
      aiId: 'lens',
      aiName: 'Lens',
      message: p.message.replace(/^Forge/, 'Lens'),
    }),
  )
  return {
    ...result,
    bestPass: `lens+${result.bestPass}`,
  }
}

/** Merge two OCR texts by keeping unique non-empty lines (order preserved). */
export function mergeOcrTexts(a: string, b: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of [...a.split(/\r?\n/), ...b.split(/\r?\n/)]) {
    const t = line.trim()
    if (!t) continue
    const key = t.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    // near-duplicate collapse
    let dup = false
    for (const s of seen) {
      if (s.includes(key) || key.includes(s)) {
        if (key.length > s.length) {
          // prefer longer
        } else {
          dup = true
        }
      }
    }
    if (dup) continue
    seen.add(key)
    out.push(t)
  }
  return out.join('\n')
}
