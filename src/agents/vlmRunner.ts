/**
 * Run vision-language models against a receipt image.
 *
 * Remote path: Hugging Face Inference / OpenAI-compatible router (free tier when available).
 * Optional free HF token in Settings improves rate limits.
 * Soft-fails per model so classic OCR still works offline.
 */
import type { AiId } from '../aiRoster'
import type { CategoryId, ReceiptLineItem } from '../types'
import { categorizeText } from './keywords'
import { parseMoneyTokens, roundMoney } from './moneyParse'
import type { AgentProgress, LocalAgentResult } from './pipeline'
import { RECEIPT_VLM_PROMPT, VLM_MODELS, type VlmModelSpec } from './vlmModels'

export type VlmExtract = {
  vendor: string
  date: string | null
  total: number | null
  subtotal: number | null
  tax: number | null
  shipping: number | null
  fee: number | null
  items: { description: string; amount: number }[]
  raw_text: string
}

export type VlmRunResult = {
  aiId: AiId
  label: string
  modelId: string
  extract: VlmExtract | null
  text: string
  confidence: number
  ok: boolean
  message: string
}

const HF_TOKEN_KEY = 'schoolie-hf-token'

export async function getHfToken(): Promise<string | null> {
  try {
    const ls = localStorage.getItem(HF_TOKEN_KEY)
    if (ls?.trim()) return ls.trim()
  } catch {
    /* ignore */
  }
  try {
    const { Preferences } = await import('@capacitor/preferences')
    const { value } = await Preferences.get({ key: HF_TOKEN_KEY })
    return value?.trim() || null
  } catch {
    return null
  }
}

export async function setHfToken(token: string): Promise<void> {
  const t = token.trim()
  try {
    if (t) localStorage.setItem(HF_TOKEN_KEY, t)
    else localStorage.removeItem(HF_TOKEN_KEY)
  } catch {
    /* ignore */
  }
  try {
    const { Preferences } = await import('@capacitor/preferences')
    if (t) await Preferences.set({ key: HF_TOKEN_KEY, value: t })
    else await Preferences.remove({ key: HF_TOKEN_KEY })
  } catch {
    /* ignore */
  }
}

async function blobToJpegDataUrl(blob: Blob, maxEdge = 1280): Promise<string> {
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
    if (!ctx) throw new Error('canvas')
    ctx.drawImage(bitmap, 0, 0, w, h)
    const jpeg = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('encode'))),
        'image/jpeg',
        0.88,
      )
    })
    const buf = await jpeg.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buf)
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return `data:image/jpeg;base64,${btoa(binary)}`
  } finally {
    bitmap.close()
  }
}

function extractJsonObject(raw: string): unknown | null {
  if (!raw) return null
  let s = raw.trim()
  // strip ```json fences
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(s.slice(start, end + 1))
  } catch {
    return null
  }
}

function numField(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return roundMoney(v)
  if (typeof v === 'string') {
    const t = parseMoneyTokens(v)
    if (t.length) return roundMoney(t[t.length - 1])
    const m = v.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
    if (m) {
      const n = parseFloat(m[0])
      if (Number.isFinite(n)) return roundMoney(n)
    }
  }
  return null
}

export function parseVlmExtract(raw: string): VlmExtract | null {
  const obj = extractJsonObject(raw)
  if (!obj || typeof obj !== 'object') {
    // Fall back: try to scrape money + vendor from free text
    const amounts = parseMoneyTokens(raw)
    if (!amounts.length && !raw.trim()) return null
    return {
      vendor: '',
      date: null,
      total: amounts.length ? roundMoney(amounts[amounts.length - 1]) : null,
      subtotal: null,
      tax: null,
      shipping: null,
      fee: null,
      items: [],
      raw_text: raw.slice(0, 4000),
    }
  }
  const o = obj as Record<string, unknown>
  const itemsRaw = Array.isArray(o.items) ? o.items : []
  const items: { description: string; amount: number }[] = []
  for (const it of itemsRaw) {
    if (!it || typeof it !== 'object') continue
    const row = it as Record<string, unknown>
    const desc = String(row.description ?? row.name ?? row.item ?? '').trim()
    const amount = numField(row.amount ?? row.price ?? row.total)
    if (!desc || amount == null || amount <= 0) continue
    if (/\b(subtotal|grand\s*total|^total$|tax|shipping|fee)\b/i.test(desc)) continue
    items.push({ description: desc.slice(0, 100), amount })
  }
  return {
    vendor: String(o.vendor ?? o.store ?? o.merchant ?? '').trim().slice(0, 60),
    date: o.date ? String(o.date).slice(0, 16) : null,
    total: numField(o.total ?? o.grand_total ?? o.amount_due ?? o.amount),
    subtotal: numField(o.subtotal),
    tax: numField(o.tax ?? o.sales_tax),
    shipping: numField(o.shipping ?? o.freight),
    fee: numField(o.fee ?? o.convenience_fee ?? o.service_fee),
    items,
    raw_text: String(o.raw_text ?? o.text ?? raw).slice(0, 4000),
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

/**
 * Call HF OpenAI-compatible router with a vision message.
 * Works for many multimodal models hosted on Hugging Face Inference Providers.
 */
async function callHfRouter(
  modelId: string,
  dataUrl: string,
  token: string | null,
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const body = {
    model: modelId,
    max_tokens: 800,
    temperature: 0.1,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: RECEIPT_VLM_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  }

  const urls = [
    'https://router.huggingface.co/v1/chat/completions',
    'https://api-inference.huggingface.co/v1/chat/completions',
  ]

  let lastErr = 'HF vision call failed'
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const text = await res.text()
      if (!res.ok) {
        lastErr = `HTTP ${res.status}: ${text.slice(0, 160)}`
        // 401/403 without token — stop trying same model on other hosts later
        if (res.status === 401 || res.status === 403) {
          if (!token) lastErr = 'HF needs a free token (Settings → Vision models)'
          continue
        }
        if (res.status === 404 || res.status === 410) continue
        continue
      }
      try {
        const j = JSON.parse(text) as {
          choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[]
          generated_text?: string
          error?: string
        }
        if (j.error) {
          lastErr = String(j.error).slice(0, 160)
          continue
        }
        const content = j.choices?.[0]?.message?.content
        if (typeof content === 'string' && content.trim()) return content
        if (Array.isArray(content)) {
          const joined = content
            .map((c) => (typeof c === 'string' ? c : c?.text || ''))
            .join('\n')
            .trim()
          if (joined) return joined
        }
        if (j.generated_text?.trim()) return j.generated_text
        lastErr = 'Empty model response'
      } catch {
        if (text.trim().startsWith('{') || text.includes('vendor')) return text
        lastErr = 'Bad JSON response'
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(lastErr)
}

/**
 * Older HF image-to-text / image-text-to-text inference endpoint.
 */
async function callHfInferenceLegacy(
  modelId: string,
  imageBlob: Blob,
  token: string | null,
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  // Some hosts want raw bytes + prompt query
  const url = `https://api-inference.huggingface.co/models/${modelId}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': imageBlob.type || 'image/jpeg',
      'x-wait-for-model': 'true',
    },
    body: imageBlob,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HF inference HTTP ${res.status}: ${text.slice(0, 140)}`)
  try {
    const j = JSON.parse(text) as
      | { generated_text?: string }[]
      | { generated_text?: string }
      | { error?: string }
    if (!Array.isArray(j) && j && 'error' in j && j.error) throw new Error(String(j.error))
    if (Array.isArray(j)) {
      return j.map((x) => x.generated_text || '').join('\n').trim()
    }
    if (j && typeof j === 'object' && 'generated_text' in j) {
      return String((j as { generated_text?: string }).generated_text || '')
    }
  } catch (e) {
    if (e instanceof Error && /HF inference|error/i.test(e.message)) throw e
  }
  // If response is plain text
  if (text.trim()) return text
  throw new Error('Empty legacy inference response')
}

async function runOneModel(
  spec: VlmModelSpec,
  imageBlob: Blob,
  dataUrl: string,
  token: string | null,
  onProgress?: (p: AgentProgress) => void,
): Promise<VlmRunResult> {
  const candidates = [spec.hfModelId, ...(spec.altHfModelIds || [])]
  let lastErr = 'no model id worked'

  for (const modelId of candidates) {
    onProgress?.({
      stage: 'ocr',
      progress: 0.35,
      message: `${spec.label} reading receipt (${modelId.split('/').pop()})…`,
      aiId: spec.aiId,
      aiName: spec.label,
    })
    try {
      let raw = ''
      try {
        raw = await withTimeout(
          callHfRouter(modelId, dataUrl, token),
          55_000,
          spec.label,
        )
      } catch (routerErr) {
        // Fallback: raw image inference (works for some OCR-specialized hosts)
        try {
          raw = await withTimeout(
            callHfInferenceLegacy(modelId, imageBlob, token),
            55_000,
            `${spec.label}-legacy`,
          )
        } catch {
          throw routerErr
        }
      }

      // If model returned free text without JSON, wrap as raw_text and re-prompt style parse
      let extract = parseVlmExtract(raw)
      if (!extract?.total && raw.trim()) {
        // Second chance: ask model to convert free OCR dump — skip extra network; scrape
        const amounts = parseMoneyTokens(raw)
        extract = {
          vendor: extract?.vendor || '',
          date: extract?.date || null,
          total: amounts.length ? roundMoney(Math.max(...amounts)) : null,
          subtotal: extract?.subtotal ?? null,
          tax: extract?.tax ?? null,
          shipping: extract?.shipping ?? null,
          fee: extract?.fee ?? null,
          items: extract?.items ?? [],
          raw_text: raw.slice(0, 4000),
        }
      }

      if (!extract || (!extract.total && !extract.vendor && !extract.raw_text)) {
        lastErr = 'Model returned no usable receipt fields'
        continue
      }

      let confidence = 0.4
      if (extract.vendor) confidence += 0.12
      if (extract.total != null) confidence += 0.22
      if (extract.items.length) confidence += Math.min(0.18, extract.items.length * 0.04)
      if (extract.subtotal != null) confidence += 0.06
      confidence = Math.min(0.96, confidence)

      const text = buildPseudoReceipt(extract)
      return {
        aiId: spec.aiId,
        label: spec.label,
        modelId,
        extract,
        text,
        confidence,
        ok: true,
        message: `${spec.label} OK · total ${extract.total ?? '—'} · ${modelId}`,
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }

  return {
    aiId: spec.aiId,
    label: spec.label,
    modelId: spec.hfModelId,
    extract: null,
    text: '',
    confidence: 0,
    ok: false,
    message: `${spec.label}: ${lastErr.slice(0, 140)}`,
  }
}

function buildPseudoReceipt(e: VlmExtract): string {
  const lines: string[] = []
  if (e.vendor) lines.push(e.vendor)
  if (e.date) lines.push(`Date ${e.date}`)
  for (const it of e.items) {
    lines.push(`${it.description} ${it.amount.toFixed(2)}`)
  }
  if (e.subtotal != null) lines.push(`SUBTOTAL ${e.subtotal.toFixed(2)}`)
  if (e.tax != null) lines.push(`TAX ${e.tax.toFixed(2)}`)
  if (e.shipping != null) lines.push(`SHIPPING ${e.shipping.toFixed(2)}`)
  if (e.fee != null) lines.push(`CONVENIENCE FEE ${e.fee.toFixed(2)}`)
  if (e.total != null) lines.push(`GRAND TOTAL ${e.total.toFixed(2)}`)
  if (e.raw_text) lines.push(e.raw_text)
  return lines.join('\n')
}

export function vlmResultToLocal(r: VlmRunResult): LocalAgentResult | null {
  if (!r.ok || !r.extract) return null
  const e = r.extract
  const lineItems: ReceiptLineItem[] = e.items.map((it, i) => {
    const { categoryId } = categorizeText(it.description)
    return {
      id: `${r.aiId}-${i}`,
      description: it.description,
      amount: it.amount,
      categoryId,
    }
  })
  if (e.shipping != null && e.shipping > 0) {
    lineItems.push({
      id: `${r.aiId}-ship`,
      description: 'Shipping',
      amount: e.shipping,
      categoryId: 'misc',
    })
  }
  if (e.fee != null && e.fee > 0) {
    lineItems.push({
      id: `${r.aiId}-fee`,
      description: 'Convenience fee',
      amount: e.fee,
      categoryId: 'misc',
    })
  }
  if (!e.items.length && e.subtotal != null && e.subtotal > 0) {
    const desc = e.vendor ? `${e.vendor} — goods / service` : 'Goods / service'
    const { categoryId } = categorizeText(`${e.vendor} ${e.raw_text}`)
    lineItems.unshift({
      id: `${r.aiId}-svc`,
      description: desc,
      amount: e.subtotal,
      categoryId,
    })
  }

  const categoryId: CategoryId =
    e.items.length > 0
      ? e.items.reduce(
          (best, it) => {
            const { categoryId: id } = categorizeText(it.description)
            return it.amount > best.amount ? { id, amount: it.amount } : best
          },
          { id: 'misc' as CategoryId, amount: -1 },
        ).id
      : categorizeText(`${e.vendor} ${e.raw_text}`).categoryId

  const description =
    e.items.length > 0
      ? e.items
          .map((i) => i.description)
          .slice(0, 6)
          .join('; ')
          .slice(0, 160)
      : e.vendor
        ? `Receipt — ${e.vendor}`
        : 'Receipt'

  return {
    date: e.date && /^\d{4}-\d{2}-\d{2}/.test(e.date)
      ? e.date.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    vendor: e.vendor,
    amount: e.total,
    description,
    categoryId,
    notes: `${r.label} VLM · conf ${Math.round(r.confidence * 100)}%`,
    lineItems,
    subtotal: e.subtotal,
    tax: e.tax,
    source: 'on-device',
    confidence: r.confidence,
    rawText: r.text,
    agentReport: [
      `Vision model: ${r.label} (${r.modelId})`,
      r.message,
      e.raw_text ? `Transcript excerpt:\n${e.raw_text.slice(0, 500)}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    aisUsed: [r.aiId],
    activeAiLabel: `${r.label} · vision`,
    fieldSources: {
      primary: r.aiId,
      ocr: r.aiId,
      total: r.aiId,
      vendor: r.aiId,
      category: r.aiId,
      date: r.aiId,
      answerLabel: `${r.label} (vision-language model)`,
    },
  }
}

/**
 * Run enabled VLM models (priority order), limited concurrency.
 * Returns successful extracts + status notes.
 */
export async function runEnabledVlms(
  imageBlob: Blob,
  options: {
    enabled: (id: AiId) => boolean
    onProgress?: (p: AgentProgress) => void
    /** Max models to try per scan */
    maxModels?: number
  },
): Promise<{ results: VlmRunResult[]; notes: string[] }> {
  const notes: string[] = []
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    notes.push('VLMs skipped — offline')
    return { results: [], notes }
  }

  const queue = VLM_MODELS.filter((m) => options.enabled(m.aiId)).sort(
    (a, b) => b.priority - a.priority,
  )
  if (!queue.length) {
    notes.push('No vision VLMs enabled')
    return { results: [], notes }
  }

  const maxModels = options.maxModels ?? 2
  const token = await getHfToken()
  if (!token) {
    notes.push(
      'No HF token — free public inference may rate-limit. Add a free Hugging Face token in Settings for reliable VLM scans.',
    )
  }

  let dataUrl: string
  try {
    dataUrl = await blobToJpegDataUrl(imageBlob)
  } catch (e) {
    notes.push(`VLM image prep failed: ${e instanceof Error ? e.message : 'error'}`)
    return { results: [], notes }
  }

  const results: VlmRunResult[] = []
  const tryList = queue.slice(0, maxModels)

  for (const spec of tryList) {
    options.onProgress?.({
      stage: 'ocr',
      progress: 0.32,
      message: `Vision model ${spec.label} (${spec.sizeHint})…`,
      aiId: spec.aiId,
      aiName: spec.label,
    })
    const r = await runOneModel(spec, imageBlob, dataUrl, token, options.onProgress)
    results.push(r)
    notes.push(r.message)
    // If we already have a strong total+vendor, stop early
    if (r.ok && r.extract?.total != null && (r.extract.vendor || r.extract.items.length)) {
      break
    }
  }

  // Queue remainder as "skipped this scan"
  for (const spec of queue.slice(maxModels)) {
    notes.push(`${spec.label} queued next time (limit ${maxModels}/scan)`)
  }

  return { results, notes }
}

export function listVlmModels(): VlmModelSpec[] {
  return [...VLM_MODELS]
}
