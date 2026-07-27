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

Read the receipt image carefully (OCR the text). Extract purchase details and choose the best conversion category.

Return ONLY valid JSON (no markdown fences) with this shape:
{
  "date": "YYYY-MM-DD or null if unknown",
  "vendor": "store or vendor name",
  "amount": 0.00,
  "description": "short description of what was bought",
  "categoryId": "one category id from the list",
  "notes": "optional extra details from the receipt"
}

Rules:
- amount is the total paid as a number (use the grand total / amount due).
- categoryId MUST be one of these ids:
${categoryList}
- Prefer schoolie-build categories (e.g. lumber/plywood → structure or interior; wire/breakers → electrical; foam/wool → insulation; solar panels/batteries → solar; pipe/fittings → plumbing; etc.).
- If unclear, use "misc".
- description should be human-readable and useful in a spend log.
- If multiple items, summarize the main purchase(s).`
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

  return {
    date,
    vendor: typeof parsed.vendor === 'string' ? parsed.vendor : '',
    amount,
    description: typeof parsed.description === 'string' ? parsed.description : '',
    categoryId,
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
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
  return { ...parseSuggestionJson(text), source: 'cloud', confidence: 0.9 }
}

/** @deprecated use scanReceipt */
export async function parseReceiptImage(
  apiKey: string,
  imageBlob: Blob,
): Promise<ReceiptSuggestion> {
  return parseReceiptImageCloud(apiKey, imageBlob)
}

/**
 * Default path: low-power on-device agent (Tesseract + local rules).
 * Optional cloud boost when API key is set and on-device confidence is low,
 * or when preferCloud is true.
 */
export async function scanReceipt(
  imageBlob: Blob,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const { apiKey = '', preferCloud = false, onProgress } = options

  if (preferCloud && apiKey.trim()) {
    onProgress?.({
      stage: 'ocr',
      progress: 0.2,
      message: 'Cloud AI reading receipt…',
      engine: 'cloud',
    })
    try {
      return await parseReceiptImageCloud(apiKey, imageBlob)
    } catch {
      // fall through to on-device
    }
  }

  onProgress?.({
    stage: 'prepare',
    progress: 0.02,
    message: 'Starting on-device agent…',
    engine: 'on-device',
  })

  const local: LocalAgentResult = await runOnDeviceReceiptAgent(imageBlob, (p) =>
    onProgress?.({ ...p, engine: 'on-device' }),
  )

  const needsBoost =
    apiKey.trim() &&
    (local.confidence < 0.55 || local.amount == null || !local.description)

  if (needsBoost) {
    onProgress?.({
      stage: 'ocr',
      progress: 0.5,
      message: 'Boosting with cloud AI…',
      engine: 'cloud',
    })
    try {
      const cloud = await parseReceiptImageCloud(apiKey, imageBlob)
      return {
        ...cloud,
        notes: [cloud.notes, 'Cloud boost after on-device pass'].filter(Boolean).join(' · '),
      }
    } catch {
      return local
    }
  }

  return local
}
