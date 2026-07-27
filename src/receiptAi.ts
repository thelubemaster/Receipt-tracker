import { CATEGORIES, isCategoryId } from './categories'
import {
  runOnDeviceReceiptAgent,
  type AgentProgress,
  type LocalAgentResult,
} from './localAgent'
import type { CategoryId, ReceiptSuggestion } from './types'

const XAI_URL = 'https://api.x.ai/v1/responses'
const MODEL = 'grok-4.5'

export type ScanResult = ReceiptSuggestion & {
  source: 'on-device' | 'cloud'
  confidence?: number
  rawText?: string
}

export type ScanOptions = {
  apiKey?: string
  /** Prefer cloud when API key present (default false — on-device first). */
  preferCloud?: boolean
  onProgress?: (p: AgentProgress & { engine: 'on-device' | 'cloud' }) => void
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
- Prefer schoolie-build categories per item (foam → insulation; romex → electrical; lumber → structure; etc.).
- description = join of line item names.
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
  if (start === -1 || end === -1) {
    throw new Error('AI did not return JSON')
  }

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
    agentReport: `Cloud agent · ${lineItems.length} line item(s)`,
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

export async function parseReceiptImageCloud(
  apiKey: string,
  imageBlob: Blob,
): Promise<ScanResult> {
  if (!apiKey.trim()) {
    throw new Error('Add your xAI API key in Settings for cloud boost.')
  }

  let dataUrl = await blobToDataUrl(imageBlob)
  if (!dataUrl.startsWith('data:image/jpeg') && !dataUrl.startsWith('data:image/png')) {
    dataUrl = await ensureJpegOrPngDataUrl(imageBlob)
  }

  const response = await fetch(XAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: dataUrl,
              detail: 'high',
            },
            {
              type: 'input_text',
              text: buildPrompt(),
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(
      `Cloud scan failed (${response.status}). ${errText.slice(0, 200) || 'Check your API key and network.'}`,
    )
  }

  const data: unknown = await response.json()
  const text = extractOutputText(data)
  if (!text) {
    throw new Error('Cloud scan returned empty response.')
  }
  return {
    ...parseSuggestionJson(text),
    source: 'cloud',
    confidence: 0.9,
  }
}

function mergeLocalAndCloud(local: LocalAgentResult, cloud: ScanResult): ScanResult {
  const localLines = local.lineItems?.length ?? 0
  const cloudLines = cloud.lineItems?.length ?? 0
  const useCloudLines = cloudLines > localLines
  const lineItems = useCloudLines ? cloud.lineItems : local.lineItems

  let amount = local.amount
  let amountSource = 'on-device'
  if (cloud.amount != null && local.amount != null) {
    if (Math.abs(cloud.amount - local.amount) < 0.06) {
      amount = local.amount
      amountSource = 'agents-agree'
    } else if ((cloud.confidence ?? 0) >= 0.85) {
      amount = cloud.amount
      amountSource = 'cloud'
    }
  } else if (cloud.amount != null && local.amount == null) {
    amount = cloud.amount
    amountSource = 'cloud'
  }

  const description =
    lineItems.length > 0
      ? lineItems
          .map((l) => l.description)
          .slice(0, 8)
          .join('; ')
      : cloud.description || local.description

  const report = [
    'Multi-agent consensus (on-device team + cloud)',
    local.agentReport,
    cloud.agentReport,
    `Amount source: ${amountSource}`,
    `Line items: ${useCloudLines ? 'cloud' : 'on-device'} (${lineItems.length})`,
  ]
    .filter(Boolean)
    .join('\n')

  return {
    date: local.date || cloud.date,
    vendor: local.vendor || cloud.vendor,
    amount,
    description,
    categoryId: lineItems.length
      ? local.categoryId
      : cloud.categoryId || local.categoryId,
    notes: [local.notes, cloud.notes, 'cross-checked'].filter(Boolean).join(' · '),
    lineItems,
    subtotal: local.subtotal ?? cloud.subtotal ?? null,
    tax: local.tax ?? cloud.tax ?? null,
    source: 'on-device',
    confidence: Math.min(
      0.97,
      ((local.confidence ?? 0.5) + (cloud.confidence ?? 0.5)) / 2 + 0.1,
    ),
    rawText: local.rawText,
    agentReport: report,
  }
}

/** @deprecated use scanReceipt */
export async function parseReceiptImage(
  apiKey: string,
  imageBlob: Blob,
): Promise<ReceiptSuggestion> {
  return parseReceiptImageCloud(apiKey, imageBlob)
}

/**
 * Multi-agent on-device team first (OCR dual-pass + line-items + totals + merchant + arbiter).
 * If API key present, cloud agent also runs and results are cross-checked when
 * line items are thin or confidence is low — or always when preferCloud.
 */
export async function scanReceipt(
  imageBlob: Blob,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const { apiKey = '', preferCloud = false, onProgress } = options

  onProgress?.({
    stage: 'prepare',
    progress: 0.02,
    message: 'Starting multi-agent team…',
    engine: 'on-device',
  })

  const local: LocalAgentResult = await runOnDeviceReceiptAgent(imageBlob, (p) =>
    onProgress?.({ ...p, engine: 'on-device' }),
  )

  const wantsCloud =
    Boolean(apiKey.trim()) &&
    (preferCloud ||
      local.confidence < 0.62 ||
      local.amount == null ||
      (local.lineItems?.length ?? 0) < 2)

  if (wantsCloud) {
    onProgress?.({
      stage: 'ocr',
      progress: 0.88,
      message: 'Cloud agent cross-checking…',
      engine: 'cloud',
    })
    try {
      const cloud = await parseReceiptImageCloud(apiKey, imageBlob)
      return mergeLocalAndCloud(local, cloud)
    } catch {
      return local
    }
  }

  return local
}
