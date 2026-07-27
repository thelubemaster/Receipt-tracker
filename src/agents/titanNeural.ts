/**
 * Titan — free on-device neural OCR via Transformers.js (no API key).
 * First run downloads a small TrOCR model; then works offline from cache.
 * Uses WebGPU when available, otherwise WASM — heavy on the phone.
 */
import type { AgentProgress } from './pipeline'

export type TitanResult = {
  text: string
  strips: number
  device: string
  model: string
}

const MODEL_ID = 'Xenova/trocr-small-printed'

type CaptionPipe = (
  input: string | Blob | HTMLCanvasElement,
  opts?: { max_new_tokens?: number },
) => Promise<{ generated_text: string } | { generated_text: string }[]>

let pipePromise: Promise<{ pipe: CaptionPipe; device: string }> | null = null

async function getPipe(onProgress?: (p: AgentProgress) => void) {
  if (!pipePromise) {
    pipePromise = (async () => {
      onProgress?.({
        stage: 'ocr',
        progress: 0.08,
        message: 'Titan is loading free neural model (one-time download)…',
        aiId: 'titan',
        aiName: 'Titan',
      })
      const { env, pipeline } = await import('@huggingface/transformers')
      env.allowLocalModels = false
      // Prefer WebGPU when available for real phone load / speed
      let device: 'webgpu' | 'wasm' = 'wasm'
      try {
        if ((navigator as Navigator & { gpu?: unknown }).gpu) {
          device = 'webgpu'
        }
      } catch {
        device = 'wasm'
      }

      try {
        const pipe = (await pipeline('image-to-text', MODEL_ID, {
          device,
          dtype: device === 'webgpu' ? 'fp16' : 'q8',
        })) as CaptionPipe
        return { pipe, device }
      } catch {
        // WebGPU failed — WASM fallback
        const pipe = (await pipeline('image-to-text', MODEL_ID, {
          device: 'wasm',
          dtype: 'q8',
        })) as CaptionPipe
        return { pipe, device: 'wasm' }
      }
    })()
  }
  return pipePromise
}

async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob)
}

/** Split receipt into horizontal strips (with overlap) for TrOCR. */
async function sliceStrips(blob: Blob, stripCount = 8): Promise<Blob[]> {
  const bitmap = await loadBitmap(blob)
  try {
    const maxW = 768
    const scale = Math.min(1, maxW / bitmap.width)
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const full = document.createElement('canvas')
    full.width = w
    full.height = h
    const fctx = full.getContext('2d')!
    fctx.drawImage(bitmap, 0, 0, w, h)

    const strips: Blob[] = []
    const stripH = Math.max(48, Math.floor(h / stripCount))
    const overlap = Math.floor(stripH * 0.15)
    for (let y = 0; y < h; y += stripH - overlap) {
      const ch = Math.min(stripH + overlap, h - y)
      if (ch < 24) break
      const c = document.createElement('canvas')
      c.width = w
      c.height = ch
      const ctx = c.getContext('2d')!
      ctx.drawImage(full, 0, y, w, ch, 0, 0, w, ch)
      // boost contrast for dark UI screenshots
      const imageData = ctx.getImageData(0, 0, w, ch)
      const d = imageData.data
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        // invert-ish if mostly dark (phone email screenshot)
        const avgHint = g
        const v =
          avgHint < 90
            ? Math.min(255, Math.max(0, 255 - (g - 20) * 1.2))
            : Math.min(255, Math.max(0, (g - 128) * 1.3 + 128))
        d[i] = d[i + 1] = d[i + 2] = v
      }
      ctx.putImageData(imageData, 0, 0)
      const b = await new Promise<Blob>((resolve, reject) => {
        c.toBlob((x) => (x ? resolve(x) : reject(new Error('encode'))), 'image/png')
      })
      strips.push(b)
      if (y + ch >= h) break
    }
    return strips
  } finally {
    bitmap.close()
  }
}

async function runOne(
  pipe: CaptionPipe,
  blob: Blob,
): Promise<string> {
  const url = URL.createObjectURL(blob)
  try {
    const out = await pipe(url, { max_new_tokens: 64 })
    const arr = Array.isArray(out) ? out : [out]
    return arr.map((o) => o.generated_text || '').join(' ').trim()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Titan neural strip OCR — free, local, CPU/GPU heavy.
 */
export async function runTitanNeural(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<TitanResult> {
  const { pipe, device } = await getPipe(onProgress)

  onProgress?.({
    stage: 'ocr',
    progress: 0.2,
    message: `Titan neural net ready (${device}) — slicing receipt…`,
    aiId: 'titan',
    aiName: 'Titan',
  })

  const strips = await sliceStrips(imageBlob, 10)
  const lines: string[] = []

  for (let i = 0; i < strips.length; i++) {
    onProgress?.({
      stage: 'ocr',
      progress: 0.22 + (i / strips.length) * 0.6,
      message: `Titan neural strip ${i + 1}/${strips.length}…`,
      aiId: 'titan',
      aiName: 'Titan',
    })
    try {
      const t = await runOne(pipe, strips[i])
      if (t) lines.push(t)
    } catch {
      /* skip strip */
    }
  }

  // Also try whole-page once (downscaled)
  onProgress?.({
    stage: 'ocr',
    progress: 0.85,
    message: 'Titan full-page neural pass…',
    aiId: 'titan',
    aiName: 'Titan',
  })
  try {
    const bitmap = await createImageBitmap(imageBlob)
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const pageBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png')
    })
    const pageText = await runOne(pipe, pageBlob)
    if (pageText) lines.push(pageText)
  } catch {
    /* optional */
  }

  const text = lines.join('\n')
  onProgress?.({
    stage: 'ocr',
    progress: 0.92,
    message: `Titan finished (${lines.length} neural strips on ${device})`,
    aiId: 'titan',
    aiName: 'Titan',
  })

  return {
    text,
    strips: strips.length,
    device,
    model: MODEL_ID,
  }
}
