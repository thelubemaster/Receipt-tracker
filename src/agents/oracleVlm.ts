/**
 * Oracle — free on-device vision-language document reader.
 *
 * Uses Donut DocVQA (Transformers.js · document-question-answering) to
 * *look at the receipt image* and answer structured questions — not classic
 * Tesseract character OCR.
 *
 * Model: Xenova/donut-base-finetuned-docvqa (ONNX, first-run download then cache).
 * Soft-fails if ONNX cannot start so other free AIs still run.
 */
import type { CategoryId, ReceiptLineItem } from '../types'
import { categorizeText } from './keywords'
import { parseMoneyTokens, roundMoney } from './moneyParse'
import type { AgentProgress, LocalAgentResult } from './pipeline'

export const ORACLE_MODEL_ID = 'Xenova/donut-base-finetuned-docvqa'

export type OracleQa = { question: string; answer: string }

export type OracleResult = {
  /** Pseudo-receipt text built from answers (feeds the parse engine) */
  text: string
  answers: OracleQa[]
  vendor: string
  amount: number | null
  date: string | null
  subtotal: number | null
  tax: number | null
  shipping: number | null
  fee: number | null
  items: ReceiptLineItem[]
  device: string
  model: string
  confidence: number
  unavailable?: boolean
  reason?: string
}

type DocQaPipe = (
  image: string | Blob | HTMLCanvasElement,
  question: string,
  opts?: { max_new_tokens?: number },
) => Promise<{ answer: string }[] | { answer: string }>

let pipePromise: Promise<{ pipe: DocQaPipe; device: string }> | null = null
let oracleHardFail: string | null = null

function isOnnxSessionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /onnx|ERROR_CODE|graph\.cc|create.*session|SessionOptions|wasm|Unsupported pipeline|Unauthorized|404|not found/i.test(
    msg,
  )
}

async function getPipe(onProgress?: (p: AgentProgress) => void) {
  if (oracleHardFail) throw new Error(oracleHardFail)

  if (!pipePromise) {
    pipePromise = (async () => {
      onProgress?.({
        stage: 'ocr',
        progress: 0.06,
        message: 'Oracle is loading free vision model (Donut DocVQA)…',
        aiId: 'oracle',
        aiName: 'Oracle',
      })

      const { env, pipeline } = await import('@huggingface/transformers')
      env.allowLocalModels = false
      try {
        const onnxWasm = (env as { backends?: { onnx?: { wasm?: Record<string, unknown> } } })
          .backends?.onnx?.wasm
        if (onnxWasm) {
          onnxWasm.numThreads = 1
          onnxWasm.simd = true
          onnxWasm.proxy = false
        }
      } catch {
        /* ignore */
      }

      const hasGpu = Boolean((navigator as Navigator & { gpu?: unknown }).gpu)
      const attempts: { device: 'wasm' | 'webgpu' | 'cpu'; dtype: string; label: string }[] = [
        { device: 'wasm', dtype: 'q8', label: 'wasm+q8' },
        { device: 'wasm', dtype: 'fp32', label: 'wasm+fp32' },
        ...(hasGpu
          ? ([{ device: 'webgpu' as const, dtype: 'fp32', label: 'webgpu+fp32' }] as const)
          : []),
      ]

      let lastErr: unknown = null
      for (const attempt of attempts) {
        try {
          onProgress?.({
            stage: 'ocr',
            progress: 0.09,
            message: `Oracle starting vision session (${attempt.label})…`,
            aiId: 'oracle',
            aiName: 'Oracle',
          })
          const pipe = (await pipeline('document-question-answering', ORACLE_MODEL_ID, {
            device: attempt.device,
            dtype: attempt.dtype as 'q8' | 'fp32' | 'fp16',
          })) as unknown as DocQaPipe
          return { pipe, device: attempt.label }
        } catch (e) {
          lastErr = e
        }
      }

      const msg =
        lastErr instanceof Error
          ? lastErr.message.slice(0, 180)
          : 'Could not create vision session'
      oracleHardFail = `Oracle unavailable: ${msg}`
      throw new Error(oracleHardFail)
    })().catch((e) => {
      pipePromise = null
      throw e
    })
  }

  return pipePromise
}

/** Shrink huge photos so DocVQA stays within phone memory. */
async function prepImageForVlm(blob: Blob, maxEdge = 1280): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const long = Math.max(bitmap.width, bitmap.height)
    const scale = long > maxEdge ? maxEdge / long : 1
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    // Mild contrast helps DocVQA on dim phone shots
    try {
      const img = ctx.getImageData(0, 0, w, h)
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        const v = Math.min(255, Math.max(0, (g - 128) * 1.2 + 128))
        d[i] = d[i + 1] = d[i + 2] = v
      }
      ctx.putImageData(img, 0, 0)
    } catch {
      /* keep draw */
    }
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png')
    })
  } finally {
    bitmap.close()
  }
}

async function ask(
  pipe: DocQaPipe,
  image: Blob,
  question: string,
): Promise<string> {
  const url = URL.createObjectURL(image)
  try {
    const out = await pipe(url, question, { max_new_tokens: 64 })
    const arr = Array.isArray(out) ? out : [out]
    return (arr[0]?.answer || '').trim()
  } finally {
    URL.revokeObjectURL(url)
  }
}

function parseMoneyAnswer(raw: string): number | null {
  if (!raw) return null
  // Reject pure non-money answers
  if (/^(n\/?a|none|unknown|not found|null)$/i.test(raw.trim())) return null
  const tokens = parseMoneyTokens(raw)
  if (tokens.length) return roundMoney(tokens[tokens.length - 1])
  // Bare number like "76.67" or "1,225.90"
  const m = raw.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/)
  if (m) {
    const n = parseFloat(m[1])
    if (Number.isFinite(n) && n > 0 && n < 100000) return roundMoney(n)
  }
  return null
}

function parseDateAnswer(raw: string): string | null {
  if (!raw || /n\/?a|unknown|none/i.test(raw)) return null
  const iso = raw.match(/(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const us = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})/)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  const us2 = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})\b/)
  if (us2) return `20${us2[3]}-${us2[1].padStart(2, '0')}-${us2[2].padStart(2, '0')}`
  return null
}

function cleanVendor(raw: string): string {
  if (!raw) return ''
  let v = raw
    .replace(/^the\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^(n\/?a|unknown|none|null|store|vendor)$/i.test(v)) return ''
  if (v.length > 48) v = v.slice(0, 48)
  return v
}

/** Parse "item1 $x; item2 $y" style free answers into line items. */
function parseItemsAnswer(raw: string): ReceiptLineItem[] {
  if (!raw || /^(n\/?a|none|unknown)$/i.test(raw.trim())) return []
  const items: ReceiptLineItem[] = []
  // Split on newlines, semicolons, or " and " between priced chunks
  const chunks = raw
    .split(/[\n;•]+|(?<=\d{2})\s+(?=[A-Za-z])/)
    .map((c) => c.trim())
    .filter((c) => c.length > 2)

  for (let i = 0; i < chunks.length && items.length < 12; i++) {
    const chunk = chunks[i]
    const amounts = parseMoneyTokens(chunk)
    const amount = amounts.length ? roundMoney(amounts[amounts.length - 1]) : null
    if (amount == null || amount <= 0 || amount > 50000) continue
    let desc = chunk
      .replace(/\$\s*\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})/g, ' ')
      .replace(/\b\d+[.,]\d{2}\b/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 80)
    if (desc.length < 2) desc = `Item ${items.length + 1}`
    if (/\b(total|subtotal|tax|shipping|fee)\b/i.test(desc)) continue
    const { categoryId } = categorizeText(desc)
    items.push({
      id: `oracle-${items.length}`,
      description: desc,
      amount,
      categoryId,
    })
  }
  return items
}

const QUESTIONS: { key: string; question: string }[] = [
  { key: 'vendor', question: 'What is the store name or company name on this receipt?' },
  { key: 'total', question: 'What is the total amount due or grand total?' },
  { key: 'date', question: 'What is the date on this receipt or invoice?' },
  { key: 'subtotal', question: 'What is the subtotal before tax?' },
  { key: 'tax', question: 'What is the tax amount?' },
  { key: 'shipping', question: 'What is the shipping or delivery charge? Answer none if none.' },
  { key: 'fee', question: 'What is the convenience fee or service fee? Answer none if none.' },
  {
    key: 'items',
    question:
      'List the product or service line items with their prices, one per line. Skip totals and tax.',
  },
]

/**
 * Run Oracle vision Q&A on a receipt photo.
 * Never throws to the UI — returns unavailable on hard fail.
 */
export async function runOracleVlm(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<OracleResult> {
  const empty = (extra: Partial<OracleResult> = {}): OracleResult => ({
    text: '',
    answers: [],
    vendor: '',
    amount: null,
    date: null,
    subtotal: null,
    tax: null,
    shipping: null,
    fee: null,
    items: [],
    device: 'unavailable',
    model: ORACLE_MODEL_ID,
    confidence: 0,
    unavailable: true,
    ...extra,
  })

  if (oracleHardFail) {
    onProgress?.({
      stage: 'ocr',
      progress: 0.15,
      message: 'Oracle skipped (vision model unavailable on this device)…',
      aiId: 'oracle',
      aiName: 'Oracle',
    })
    return empty({ reason: oracleHardFail })
  }

  let pipe: DocQaPipe
  let device: string
  try {
    const loaded = await getPipe(onProgress)
    pipe = loaded.pipe
    device = loaded.device
  } catch (e) {
    const reason =
      e instanceof Error ? e.message.slice(0, 200) : 'Vision session failed'
    oracleHardFail = reason
    return empty({ reason })
  }

  onProgress?.({
    stage: 'ocr',
    progress: 0.15,
    message: `Oracle vision ready (${device}) — reading the page…`,
    aiId: 'oracle',
    aiName: 'Oracle',
  })

  try {
    const image = await prepImageForVlm(imageBlob)
    const answers: OracleQa[] = []
    const map: Record<string, string> = {}

    for (let i = 0; i < QUESTIONS.length; i++) {
      const q = QUESTIONS[i]
      onProgress?.({
        stage: 'ocr',
        progress: 0.18 + (i / QUESTIONS.length) * 0.55,
        message: `Oracle is reading: ${q.question.slice(0, 48)}…`,
        aiId: 'oracle',
        aiName: 'Oracle',
      })
      try {
        const answer = await ask(pipe, image, q.question)
        if (answer) {
          answers.push({ question: q.question, answer })
          map[q.key] = answer
        }
      } catch (e) {
        if (isOnnxSessionError(e)) {
          oracleHardFail = e instanceof Error ? e.message : 'ONNX failed mid-read'
          pipePromise = null
          break
        }
      }
    }

    if (!answers.length) {
      return empty({
        device,
        reason: oracleHardFail || 'Oracle returned no answers',
      })
    }

    const vendor = cleanVendor(map.vendor || '')
    const amount = parseMoneyAnswer(map.total || '')
    const date = parseDateAnswer(map.date || '')
    const subtotal = parseMoneyAnswer(map.subtotal || '')
    const tax = parseMoneyAnswer(map.tax || '')
    let shipping = parseMoneyAnswer(map.shipping || '')
    let fee = parseMoneyAnswer(map.fee || '')
    if (shipping != null && /none|n\/a|0\.00|^0$/i.test(map.shipping || '')) shipping = null
    if (fee != null && /none|n\/a|0\.00|^0$/i.test(map.fee || '')) fee = null
    const items = parseItemsAnswer(map.items || '')

    // Build a synthetic receipt dump so classic engine/path can also use it
    const textLines = [
      vendor,
      date ? `Date ${date}` : null,
      ...items.map((it) => `${it.description} ${it.amount.toFixed(2)}`),
      subtotal != null ? `SUBTOTAL ${subtotal.toFixed(2)}` : null,
      tax != null ? `TAX ${tax.toFixed(2)}` : null,
      shipping != null ? `SHIPPING ${shipping.toFixed(2)}` : null,
      fee != null ? `CONVENIENCE FEE ${fee.toFixed(2)}` : null,
      amount != null ? `GRAND TOTAL ${amount.toFixed(2)}` : null,
      // Keep raw answers for debug / engine harvest
      ...answers.map((a) => `${a.question} → ${a.answer}`),
    ].filter(Boolean) as string[]

    let confidence = 0.35
    if (vendor) confidence += 0.12
    if (amount != null) confidence += 0.22
    if (date) confidence += 0.08
    if (items.length) confidence += Math.min(0.15, items.length * 0.04)
    if (subtotal != null && amount != null) confidence += 0.08
    confidence = Math.min(0.94, confidence)

    onProgress?.({
      stage: 'ocr',
      progress: 0.78,
      message:
        amount != null
          ? `Oracle read total $${amount.toFixed(2)}${vendor ? ` · ${vendor}` : ''}`
          : `Oracle finished ${answers.length} vision answers`,
      aiId: 'oracle',
      aiName: 'Oracle',
    })

    return {
      text: textLines.join('\n'),
      answers,
      vendor,
      amount,
      date,
      subtotal,
      tax,
      shipping,
      fee,
      items,
      device,
      model: ORACLE_MODEL_ID,
      confidence,
      unavailable: false,
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 200) : 'Oracle runtime error'
    if (isOnnxSessionError(e)) {
      oracleHardFail = reason
      pipePromise = null
    }
    onProgress?.({
      stage: 'ocr',
      progress: 0.3,
      message: 'Oracle vision error — other free AIs continue…',
      aiId: 'oracle',
      aiName: 'Oracle',
    })
    return empty({ reason, device: 'error' })
  }
}

/** Turn Oracle structured answers into a LocalAgentResult (pipeline-ready). */
export function oracleToLocalResult(o: OracleResult): LocalAgentResult | null {
  if (o.unavailable || (!o.amount && !o.vendor && !o.text)) return null

  const lineItems: ReceiptLineItem[] = [...o.items]
  if (o.shipping != null && o.shipping > 0) {
    lineItems.push({
      id: 'oracle-ship',
      description: 'Shipping',
      amount: o.shipping,
      categoryId: 'misc',
    })
  }
  if (o.fee != null && o.fee > 0) {
    lineItems.push({
      id: 'oracle-fee',
      description: 'Convenience fee',
      amount: o.fee,
      categoryId: 'misc',
    })
  }

  // If no product lines but we have subtotal, invent a service line
  if (!o.items.length && o.subtotal != null && o.subtotal > 0) {
    const desc = o.vendor ? `${o.vendor} — service / goods` : 'Service / goods'
    const { categoryId } = categorizeText(`${o.vendor} ${o.text}`)
    lineItems.unshift({
      id: 'oracle-svc',
      description: desc,
      amount: o.subtotal,
      categoryId,
    })
  }

  const categoryId: CategoryId =
    o.items.length > 0
      ? o.items.reduce(
          (best, it) =>
            it.amount > best.amount ? { id: it.categoryId, amount: it.amount } : best,
          { id: 'misc' as CategoryId, amount: -1 },
        ).id
      : categorizeText(`${o.vendor} ${o.text}`).categoryId

  const description =
    o.items.length > 0
      ? o.items
          .map((i) => i.description)
          .slice(0, 6)
          .join('; ')
          .slice(0, 160)
      : o.vendor
        ? `Receipt — ${o.vendor}`
        : 'Receipt'

  return {
    date: o.date || new Date().toISOString().slice(0, 10),
    vendor: o.vendor,
    amount: o.amount,
    description,
    categoryId,
    notes: `Oracle VLM · conf ${Math.round(o.confidence * 100)}% · ${o.device}`,
    lineItems,
    subtotal: o.subtotal,
    tax: o.tax,
    source: 'on-device',
    confidence: o.confidence,
    rawText: o.text,
    agentReport: [
      `Oracle vision model: ${o.model}`,
      `Device: ${o.device}`,
      ...o.answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`),
    ].join('\n'),
    aisUsed: ['oracle'],
    activeAiLabel: 'Oracle · vision document reader',
    fieldSources: {
      primary: 'oracle',
      ocr: 'oracle',
      total: 'oracle',
      vendor: 'oracle',
      category: 'oracle',
      date: 'oracle',
      answerLabel: 'Oracle (Donut DocVQA vision)',
    },
  }
}

export function getOracleStatus(): { ok: boolean; reason: string | null } {
  return { ok: !oracleHardFail, reason: oracleHardFail }
}
