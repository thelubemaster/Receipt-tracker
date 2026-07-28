/**
 * Titan — free on-device neural OCR via Transformers.js (no API key).
 * First run may download a small TrOCR model; then cache offline.
 *
 * ONNX WebGPU often throws graph.cc session errors on phones / remote
 * browsers — we prefer WASM, never crash the app, and soft-disable after fail.
 */
import type { AgentProgress } from './pipeline'

export type TitanResult = {
  text: string
  strips: number
  device: string
  model: string
  /** True when neural session could not start (scan continues without Titan) */
  unavailable?: boolean
  reason?: string
}

const MODEL_ID = 'Xenova/trocr-small-printed'

type CaptionPipe = (
  input: string | Blob | HTMLCanvasElement,
  opts?: { max_new_tokens?: number },
) => Promise<{ generated_text: string } | { generated_text: string }[]>

let pipePromise: Promise<{ pipe: CaptionPipe; device: string }> | null = null
/** Once session create fails hard, skip Titan for the rest of this page session */
let titanHardFail: string | null = null

function isOnnxSessionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /onnx|ERROR_CODE|graph\.cc|create.*session|SessionOptions|wasm/i.test(msg)
}

async function getPipe(onProgress?: (p: AgentProgress) => void) {
  if (titanHardFail) {
    throw new Error(titanHardFail)
  }

  if (!pipePromise) {
    pipePromise = (async () => {
      onProgress?.({
        stage: 'ocr',
        progress: 0.08,
        message: 'Titan is loading free neural model (WASM, on-device)…',
        aiId: 'titan',
        aiName: 'Titan',
      })

      const { env, pipeline } = await import('@huggingface/transformers')
      env.allowLocalModels = false
      // Safer defaults — multi-thread WASM + WebGPU graphs break on many devices
      try {
        const onnxWasm = (env as { backends?: { onnx?: { wasm?: Record<string, unknown> } } })
          .backends?.onnx?.wasm
        if (onnxWasm) {
          onnxWasm.numThreads = 1
          onnxWasm.simd = true
          onnxWasm.proxy = false
        }
      } catch {
        /* ignore env knobs */
      }

      const attempts: { device: 'wasm' | 'webgpu' | 'cpu'; dtype: string; label: string }[] = [
        // WASM first — most reliable on phones / remote browsers
        { device: 'wasm', dtype: 'q8', label: 'wasm+q8' },
        { device: 'wasm', dtype: 'fp32', label: 'wasm+fp32' },
        // WebGPU last — often hits graph.cc session errors
        { device: 'webgpu', dtype: 'fp32', label: 'webgpu+fp32' },
      ]

      // Skip webgpu attempt if no GPU
      const hasGpu = Boolean((navigator as Navigator & { gpu?: unknown }).gpu)
      const plan = attempts.filter((a) => a.device !== 'webgpu' || hasGpu)

      let lastErr: unknown = null
      for (const attempt of plan) {
        try {
          onProgress?.({
            stage: 'ocr',
            progress: 0.1,
            message: `Titan starting neural session (${attempt.label})…`,
            aiId: 'titan',
            aiName: 'Titan',
          })
          const pipe = (await pipeline('image-to-text', MODEL_ID, {
            device: attempt.device,
            dtype: attempt.dtype as 'q8' | 'fp32' | 'fp16',
          })) as CaptionPipe
          return { pipe, device: attempt.label }
        } catch (e) {
          lastErr = e
          // continue to next backend
        }
      }

      const msg =
        lastErr instanceof Error
          ? lastErr.message.slice(0, 180)
          : 'Could not create ONNX session'
      titanHardFail = `Titan unavailable: ${msg}`
      throw new Error(titanHardFail)
    })().catch((e) => {
      // Don't cache a rejected promise forever — allow soft fail path
      pipePromise = null
      throw e
    })
  }

  return pipePromise
}

/** Split receipt into horizontal strips (with overlap) for TrOCR. */
async function sliceStrips(blob: Blob, stripCount = 6): Promise<Blob[]> {
  const bitmap = await createImageBitmap(blob)
  try {
    const maxW = 512
    const scale = Math.min(1, maxW / bitmap.width)
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const full = document.createElement('canvas')
    full.width = w
    full.height = h
    const fctx = full.getContext('2d')
    if (!fctx) return []
    fctx.drawImage(bitmap, 0, 0, w, h)

    const strips: Blob[] = []
    const stripH = Math.max(48, Math.floor(h / stripCount))
    const overlap = Math.floor(stripH * 0.12)
    for (let y = 0; y < h; y += stripH - overlap) {
      const ch = Math.min(stripH + overlap, h - y)
      if (ch < 24) break
      const c = document.createElement('canvas')
      c.width = w
      c.height = ch
      const ctx = c.getContext('2d')
      if (!ctx) break
      ctx.drawImage(full, 0, y, w, ch, 0, 0, w, ch)
      const imageData = ctx.getImageData(0, 0, w, ch)
      const d = imageData.data
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        const v =
          g < 90
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

async function runOne(pipe: CaptionPipe, blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob)
  try {
    const out = await pipe(url, { max_new_tokens: 48 })
    const arr = Array.isArray(out) ? out : [out]
    return arr.map((o) => o.generated_text || '').join(' ').trim()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Titan neural strip OCR — free, local when ONNX works.
 * Never throws to the UI: returns empty text + unavailable if session fails.
 */
export async function runTitanNeural(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<TitanResult> {
  if (titanHardFail) {
    onProgress?.({
      stage: 'ocr',
      progress: 0.2,
      message: 'Titan skipped (neural engine unavailable on this device)…',
      aiId: 'titan',
      aiName: 'Titan',
    })
    return {
      text: '',
      strips: 0,
      device: 'unavailable',
      model: MODEL_ID,
      unavailable: true,
      reason: titanHardFail,
    }
  }

  let pipe: CaptionPipe
  let device: string
  try {
    const loaded = await getPipe(onProgress)
    pipe = loaded.pipe
    device = loaded.device
  } catch (e) {
    const reason =
      e instanceof Error
        ? e.message.slice(0, 200)
        : 'ONNX session failed (graph/session error)'
    titanHardFail = reason
    pipePromise = null
    onProgress?.({
      stage: 'ocr',
      progress: 0.2,
      message: 'Titan unavailable on this device — other free AIs continue…',
      aiId: 'titan',
      aiName: 'Titan',
    })
    return {
      text: '',
      strips: 0,
      device: 'unavailable',
      model: MODEL_ID,
      unavailable: true,
      reason,
    }
  }

  onProgress?.({
    stage: 'ocr',
    progress: 0.2,
    message: `Titan neural net ready (${device}) — slicing receipt…`,
    aiId: 'titan',
    aiName: 'Titan',
  })

  try {
    const strips = await sliceStrips(imageBlob, 6)
    const lines: string[] = []

    for (let i = 0; i < strips.length; i++) {
      onProgress?.({
        stage: 'ocr',
        progress: 0.22 + (i / Math.max(1, strips.length)) * 0.55,
        message: `Titan neural strip ${i + 1}/${strips.length}…`,
        aiId: 'titan',
        aiName: 'Titan',
      })
      try {
        const t = await runOne(pipe, strips[i])
        if (t) lines.push(t)
      } catch (e) {
        if (isOnnxSessionError(e)) {
          titanHardFail = e instanceof Error ? e.message : 'ONNX strip failed'
          pipePromise = null
          break
        }
      }
    }

    // Light full-page pass only if strips worked
    if (lines.length > 0 && !titanHardFail) {
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
        const scale = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height))
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
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
    }

    const text = lines.join('\n')
    onProgress?.({
      stage: 'ocr',
      progress: 0.92,
      message:
        lines.length > 0
          ? `Titan finished (${lines.length} strips on ${device})`
          : 'Titan produced no text — other AIs carry the scan',
      aiId: 'titan',
      aiName: 'Titan',
    })

    return {
      text,
      strips: strips.length,
      device,
      model: MODEL_ID,
      unavailable: lines.length === 0 && Boolean(titanHardFail),
      reason: titanHardFail ?? undefined,
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 200) : 'Titan runtime error'
    if (isOnnxSessionError(e)) {
      titanHardFail = reason
      pipePromise = null
    }
    onProgress?.({
      stage: 'ocr',
      progress: 0.3,
      message: 'Titan hit a neural engine error — continuing with other free AIs…',
      aiId: 'titan',
      aiName: 'Titan',
    })
    return {
      text: '',
      strips: 0,
      device: 'unavailable',
      model: MODEL_ID,
      unavailable: true,
      reason,
    }
  }
}

/** For settings / tests — was Titan permanently disabled this session? */
export function getTitanStatus(): { ok: boolean; reason: string | null } {
  return { ok: !titanHardFail, reason: titanHardFail }
}
