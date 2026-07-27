import type { AiId } from './aiRoster'
import { CATEGORIES, isCategoryId } from './categories'
import {
  runOnDeviceReceiptAgent,
  type AgentProgress,
  type LocalAgentResult,
} from './localAgent'
import type { CategoryId, ReceiptSuggestion } from './types'

const XAI_URL = 'https://api.x.ai/v1/responses'
const GROK_MODEL = 'grok-4.5'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL = 'gpt-4o'

export type ScanResult = ReceiptSuggestion & {
  source: 'on-device' | 'cloud' | 'mixed'
  confidence?: number
  rawText?: string
}

export type ScanOptions = {
  apiKey?: string
  openaiApiKey?: string
  geminiApiKey?: string
  /** Prefer free AIs only (default true) — skip paid Grok/ChatGPT unless false */
  freeOnly?: boolean
  onProgress?: (
    p: AgentProgress & {
      engine: 'on-device' | 'cloud'
      aiId?: AiId
      aiName?: string
    },
  ) => void
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
    reader.readAsDataURL(blob)
  })
}

function buildPrompt(): string {
  const categoryList = CATEGORIES.map((c) => `- ${c.id}: ${c.label}`).join('\n')
  return `You are helping track purchases for a school bus conversion into a livable "schoolie".

Read the receipt carefully. Extract EVERY line item (not just a summary), plus totals.

Return ONLY valid JSON (no markdown fences) with this shape:
{
  "date": "YYYY-MM-DD or null if unknown",
  "vendor": "store or vendor name",
  "amount": 0.00,
  "subtotal": 0.00,
  "tax": 0.00,
  "description": "semicolon-separated short list of items",
  "categoryId": "primary category id by spend",
  "notes": "optional",
  "lineItems": [
    { "description": "item name", "amount": 0.00, "categoryId": "one category id" }
  ]
}

Rules:
- lineItems must list each purchased product/service row (skip tender/change/total/tax lines).
- amount is the grand total / amount due.
- categoryId values MUST be from:
${categoryList}
- Prefer schoolie-build categories per item.
- If unclear category, use "misc".`
}

function extractOutputText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const obj = data as Record<string, unknown>
  if (typeof obj.output_text === 'string') return obj.output_text
  const output = obj.output
  if (!Array.isArray(output)) return ''
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as { type?: string; text?: string }
      if ((b.type === 'output_text' || b.type === 'text') && typeof b.text === 'string') {
        parts.push(b.text)
      }
    }
  }
  return parts.join('\n')
}

function parseSuggestionJson(text: string): ReceiptSuggestion {
  let cleaned = text.trim()
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) cleaned = fence[1].trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('AI did not return JSON')

  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>

  let amount: number | null = null
  if (typeof parsed.amount === 'number' && Number.isFinite(parsed.amount)) {
    amount = Math.round(parsed.amount * 100) / 100
  } else if (typeof parsed.amount === 'string') {
    const n = Number(String(parsed.amount).replace(/[$,\s]/g, ''))
    if (Number.isFinite(n)) amount = Math.round(n * 100) / 100
  }

  const categoryRaw = String(parsed.categoryId ?? 'misc')
  const categoryId: CategoryId = isCategoryId(categoryRaw) ? categoryRaw : 'misc'
  let date: string | null = null
  if (typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
    date = parsed.date
  }

  let subtotal: number | null = null
  let tax: number | null = null
  if (typeof parsed.subtotal === 'number' && Number.isFinite(parsed.subtotal)) {
    subtotal = Math.round(parsed.subtotal * 100) / 100
  }
  if (typeof parsed.tax === 'number' && Number.isFinite(parsed.tax)) {
    tax = Math.round(parsed.tax * 100) / 100
  }

  const lineItems: ReceiptSuggestion['lineItems'] = []
  if (Array.isArray(parsed.lineItems)) {
    parsed.lineItems.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') return
      const row = raw as Record<string, unknown>
      const desc = typeof row.description === 'string' ? row.description.trim() : ''
      let itemAmt: number | null = null
      if (typeof row.amount === 'number' && Number.isFinite(row.amount)) {
        itemAmt = Math.round(row.amount * 100) / 100
      } else if (typeof row.amount === 'string') {
        const n = Number(String(row.amount).replace(/[$,\s]/g, ''))
        if (Number.isFinite(n)) itemAmt = Math.round(n * 100) / 100
      }
      if (!desc || itemAmt == null || itemAmt < 0) return
      const catRaw = String(row.categoryId ?? 'misc')
      lineItems.push({
        id: `cloud-${i}`,
        description: desc.slice(0, 80),
        amount: itemAmt,
        categoryId: isCategoryId(catRaw) ? catRaw : 'misc',
      })
    })
  }

  const description =
    typeof parsed.description === 'string' && parsed.description.trim()
      ? parsed.description
      : lineItems.map((l) => l.description).join('; ')

  return {
    date,
    vendor: typeof parsed.vendor === 'string' ? parsed.vendor : '',
    amount,
    description,
    categoryId,
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    lineItems,
    subtotal,
    tax,
  }
}

async function ensureJpegOrPngDataUrl(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process image')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.92)
}

async function imageDataUrl(imageBlob: Blob): Promise<string> {
  let dataUrl = await blobToDataUrl(imageBlob)
  if (!dataUrl.startsWith('data:image/jpeg') && !dataUrl.startsWith('data:image/png')) {
    dataUrl = await ensureJpegOrPngDataUrl(imageBlob)
  }
  return dataUrl
}

/** Gemini free-tier (Google AI Studio) scans the photo */
export async function parseReceiptWithGemini(
  apiKey: string,
  imageBlob: Blob,
): Promise<ScanResult> {
  if (!apiKey.trim()) throw new Error('Add your free Gemini API key in Settings.')
  const dataUrl = await imageDataUrl(imageBlob)
  const base64 = dataUrl.split(',')[1] || ''
  const mime = dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey.trim())}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: buildPrompt() },
            { inline_data: { mime_type: mime, data: base64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.1 },
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Gemini scan failed (${response.status}). ${errText.slice(0, 180)}`)
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || ''
  if (!text) throw new Error('Gemini returned an empty response.')
  const parsed = parseSuggestionJson(text)
  return {
    ...parsed,
    source: 'cloud',
    confidence: 0.9,
    aisUsed: ['gemini'],
    activeAiLabel: 'Gemini',
    agentReport: `Gemini (Google free tier · gemini-2.0-flash) scanned the photo · ${parsed.lineItems.length} line items`,
  }
}

export async function parseReceiptWithGrok(apiKey: string, imageBlob: Blob): Promise<ScanResult> {
  if (!apiKey.trim()) throw new Error('Add your Grok (xAI) API key in Settings.')
  const dataUrl = await imageDataUrl(imageBlob)
  const response = await fetch(XAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: dataUrl, detail: 'high' },
            { type: 'input_text', text: buildPrompt() },
          ],
        },
      ],
    }),
  })
  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Grok scan failed (${response.status}). ${errText.slice(0, 180)}`)
  }
  const text = extractOutputText(await response.json())
  if (!text) throw new Error('Grok returned an empty response.')
  const parsed = parseSuggestionJson(text)
  return {
    ...parsed,
    source: 'cloud',
    confidence: 0.9,
    aisUsed: ['grok'],
    activeAiLabel: 'Grok',
    agentReport: `Grok (xAI · ${GROK_MODEL}) scanned the photo · ${parsed.lineItems.length} line items`,
  }
}

export async function parseReceiptWithChatGPT(
  apiKey: string,
  imageBlob: Blob,
): Promise<ScanResult> {
  if (!apiKey.trim()) throw new Error('Add your ChatGPT (OpenAI) API key in Settings.')
  const dataUrl = await imageDataUrl(imageBlob)
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt() },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ],
      max_tokens: 2000,
    }),
  })
  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`ChatGPT scan failed (${response.status}). ${errText.slice(0, 180)}`)
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('ChatGPT returned an empty response.')
  const parsed = parseSuggestionJson(text)
  return {
    ...parsed,
    source: 'cloud',
    confidence: 0.9,
    aisUsed: ['chatgpt'],
    activeAiLabel: 'ChatGPT',
    agentReport: `ChatGPT (OpenAI · ${OPENAI_MODEL}) scanned the photo · ${parsed.lineItems.length} line items`,
  }
}

function mergeResults(parts: ScanResult[]): ScanResult {
  if (parts.length === 1) return parts[0]

  let bestLines = parts[0].lineItems
  let bestLinesFrom = parts[0].activeAiLabel || 'team'
  for (const c of parts) {
    if ((c.lineItems?.length ?? 0) > bestLines.length) {
      bestLines = c.lineItems
      bestLinesFrom = c.activeAiLabel || 'cloud'
    }
  }

  const amounts = parts.map((p) => p.amount).filter((a): a is number => a != null)
  let amount: number | null = parts[0].amount
  let amountFrom = parts[0].activeAiLabel || 'team'
  if (amounts.length >= 2) {
    const rounded = amounts.map((a) => Math.round(a * 100) / 100)
    const counts = new Map<number, number>()
    for (const a of rounded) counts.set(a, (counts.get(a) ?? 0) + 1)
    let top = rounded[0]
    let topN = 0
    for (const [a, n] of counts) {
      if (n > topN) {
        top = a
        topN = n
      }
    }
    amount = top
    amountFrom = topN >= 2 ? 'AIs agree' : (parts[parts.length - 1].activeAiLabel || 'cloud')
  }

  const aisUsed = Array.from(new Set(parts.flatMap((p) => p.aisUsed ?? []))) as AiId[]
  const names = [...new Set(parts.map((p) => p.activeAiLabel).filter(Boolean))].join(' + ')
  const hasCloud = parts.some((p) => p.source === 'cloud')

  return {
    date: parts.map((p) => p.date).find(Boolean) ?? null,
    vendor: parts.map((p) => p.vendor).find((v) => v?.trim()) ?? '',
    amount,
    description:
      bestLines.length > 0
        ? bestLines
            .map((l) => l.description)
            .slice(0, 8)
            .join('; ')
        : parts.map((p) => p.description).find((d) => d?.trim()) ?? '',
    categoryId: parts[0].categoryId,
    notes: parts
      .map((p) => p.notes)
      .filter(Boolean)
      .join(' · '),
    lineItems: bestLines,
    subtotal: parts.map((p) => p.subtotal).find((x) => x != null) ?? null,
    tax: parts.map((p) => p.tax).find((x) => x != null) ?? null,
    source: hasCloud ? 'mixed' : 'on-device',
    confidence: Math.min(
      0.97,
      parts.reduce((s, p) => s + (p.confidence ?? 0.5), 0) / parts.length + 0.05,
    ),
    rawText: parts[0].rawText,
    aisUsed,
    activeAiLabel: names || 'AI team',
    agentReport: [
      `AIs that scanned: ${names}`,
      `Line items from: ${bestLinesFrom} (${bestLines.length})`,
      `Total from: ${amountFrom}`,
      ...parts.map((p) => p.agentReport).filter(Boolean),
    ].join('\n'),
  }
}

/**
 * Free-first: Forge on-device team always, then Gemini free-tier if key set.
 * Paid Grok/ChatGPT only run when freeOnly is false and keys exist.
 */
export async function scanReceipt(
  imageBlob: Blob,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const {
    apiKey = '',
    openaiApiKey = '',
    geminiApiKey = '',
    freeOnly = true,
    onProgress,
  } = options

  onProgress?.({
    stage: 'prepare',
    progress: 0.02,
    message: 'Starting free AI team…',
    engine: 'on-device',
    aiId: 'forge',
    aiName: 'Forge',
  })

  const local: LocalAgentResult = await runOnDeviceReceiptAgent(imageBlob, (p) =>
    onProgress?.({ ...p, engine: 'on-device', aiId: p.aiId, aiName: p.aiName }),
  )

  const results: ScanResult[] = [
    {
      ...local,
      source: 'on-device',
      aisUsed: local.aisUsed ?? ['forge', 'scout', 'ledger', 'cashier', 'clerk', 'arbiter'],
      activeAiLabel: 'Free on-device team',
    },
  ]

  // Free-tier cloud first
  if (geminiApiKey.trim()) {
    onProgress?.({
      stage: 'ocr',
      progress: 0.88,
      message: 'Gemini is scanning the photo…',
      engine: 'cloud',
      aiId: 'gemini',
      aiName: 'Gemini',
    })
    try {
      results.push(await parseReceiptWithGemini(geminiApiKey, imageBlob))
    } catch {
      /* keep free on-device */
    }
  }

  if (!freeOnly && apiKey.trim()) {
    onProgress?.({
      stage: 'ocr',
      progress: 0.93,
      message: 'Grok is scanning the photo…',
      engine: 'cloud',
      aiId: 'grok',
      aiName: 'Grok',
    })
    try {
      results.push(await parseReceiptWithGrok(apiKey, imageBlob))
    } catch {
      /* ignore */
    }
  }

  if (!freeOnly && openaiApiKey.trim()) {
    onProgress?.({
      stage: 'ocr',
      progress: 0.96,
      message: 'ChatGPT is scanning the photo…',
      engine: 'cloud',
      aiId: 'chatgpt',
      aiName: 'ChatGPT',
    })
    try {
      results.push(await parseReceiptWithChatGPT(openaiApiKey, imageBlob))
    } catch {
      /* ignore */
    }
  }

  onProgress?.({
    stage: 'done',
    progress: 1,
    message: 'Free AI team finished — preparing your review…',
    engine: 'on-device',
    aiName: 'Team',
  })

  return mergeResults(results)
}
