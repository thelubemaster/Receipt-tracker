/**
 * Low-power on-device receipt agent.
 * Runs entirely in the browser (Tesseract OCR + lightweight parsing rules).
 * No network required after OCR language data is cached.
 * Tesseract is lazy-loaded so the main app stays light until first scan.
 */
import type { CategoryId, ReceiptSuggestion } from './types'
import type { Worker } from 'tesseract.js'

export type AgentProgress = {
  stage: 'prepare' | 'ocr' | 'parse' | 'done'
  progress: number
  message: string
}

export type LocalAgentResult = ReceiptSuggestion & {
  source: 'on-device'
  confidence: number
  rawText: string
}

const CATEGORY_KEYWORDS: Record<CategoryId, string[]> = {
  structure: [
    'lumber',
    'plywood',
    '2x4',
    '2x6',
    'osb',
    'stud',
    'framing',
    'sheet metal',
    'steel',
    'rust',
    'primer',
    'weld',
    'rivet',
    'screw',
    'bolt',
    'bracket',
    'angle iron',
  ],
  insulation: [
    'insulation',
    'foam',
    'rigid foam',
    'polyiso',
    'rockwool',
    'mineral wool',
    'thinsulate',
    'reflectix',
    'spray foam',
    'vapor barrier',
    'housewrap',
  ],
  electrical: [
    'wire',
    'wiring',
    'outlet',
    'breaker',
    'fuse',
    'electrical',
    'conduit',
    'romex',
    'switch',
    'junction',
    'led strip',
    'dimmer',
    'gauge wire',
    'terminal',
  ],
  solar: [
    'solar',
    'mppt',
    'inverter',
    'lithium',
    'lifepo',
    'battery',
    'deep cycle',
    'charge controller',
    'pv panel',
    'solar panel',
    'busbar',
    'anderson',
  ],
  plumbing: [
    'pipe',
    'pvc',
    'pex',
    'plumbing',
    'valve',
    'faucet',
    'fitting',
    'water pump',
    'tank',
    'hose',
    'sharkbite',
    'drain',
  ],
  propane: [
    'propane',
    'heater',
    'furnace',
    'diesel heater',
    'mr heater',
    'regulator',
    'gas line',
    'stove',
    'oven',
  ],
  interior: [
    'drywall',
    'shiplap',
    'paneling',
    'trim',
    'molding',
    'caulk',
    'paint',
    'primer',
    'adhesive',
    'construction adhesive',
  ],
  kitchen: [
    'sink',
    'countertop',
    'fridge',
    'refrigerator',
    'cooktop',
    'microwave',
    'cabinet',
    'kitchen',
    'dishwasher',
  ],
  bathroom: [
    'toilet',
    'shower',
    'bath',
    'bathroom',
    'cassette',
    'composting',
    'vanity',
    'mirror',
  ],
  flooring: ['floor', 'flooring', 'vinyl', 'lvp', 'laminate', 'subfloor', 'tile', 'carpet'],
  windows: ['window', 'door', 'awning', 'seal', 'weatherstrip', 'glass', 'egress'],
  furniture: ['mattress', 'sofa', 'couch', 'table', 'chair', 'bed', 'cushion', 'furniture'],
  tools: [
    'drill',
    'saw',
    'tool',
    'clamp',
    'tape measure',
    'screwdriver',
    'wrench',
    'bit set',
    'multimeter',
  ],
  safety: [
    'extinguisher',
    'smoke',
    'co detector',
    'fire',
    'first aid',
    'safety',
    'harness',
    'goggle',
  ],
  fuel: ['fuel', 'gasoline', 'diesel', 'gas station', 'shell', 'chevron', 'exxon', 'bp ', 'mobil'],
  misc: [],
}

const VENDOR_HINTS = [
  'home depot',
  'lowe',
  "lowe's",
  'lowes',
  'menards',
  'harbor freight',
  'ace hardware',
  'amazon',
  'walmart',
  'target',
  'costco',
  'sam\'s',
  'sams club',
  'tractor supply',
  'grainger',
  'autozone',
  'oreilly',
  "o'reilly",
  'napa',
  'ikea',
  'rei',
  'northern tool',
  'micro center',
  'best buy',
]

/** Downscale large photos so OCR stays low-power on phones. */
export async function prepareImageForOcr(blob: Blob, maxEdge = 1280): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(bitmap, 0, 0, w, h)
    // mild contrast boost helps OCR without heavy filters
    const imageData = ctx.getImageData(0, 0, w, h)
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const v = Math.min(255, Math.max(0, (g - 128) * 1.15 + 128))
      d[i] = d[i + 1] = d[i + 2] = v
    }
    ctx.putImageData(imageData, 0, 0)
    const out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Image encode failed'))),
        'image/jpeg',
        0.85,
      )
    })
    return out
  } finally {
    bitmap.close()
  }
}

function parseMoneyTokens(text: string): number[] {
  const amounts: number[] = []
  const re = /\$?\s*(\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    let raw = m[1].replace(/\s/g, '')
    // European style 12,34 vs 1.234,56
    if (raw.includes(',') && raw.includes('.')) {
      if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
        raw = raw.replace(/\./g, '').replace(',', '.')
      } else {
        raw = raw.replace(/,/g, '')
      }
    } else if (raw.includes(',') && /^\d+,\d{2}$/.test(raw)) {
      raw = raw.replace(',', '.')
    } else {
      raw = raw.replace(/,/g, '')
    }
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0 && n < 100000) {
      amounts.push(Math.round(n * 100) / 100)
    }
  }
  return amounts
}

export function extractAmount(text: string): number | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const totalHints =
    /\b(total|amount due|amount due|balance due|grand total|amt due|purchase total|card total|visa|mastercard|debit|paid|payment)\b/i

  const candidates: { amount: number; score: number }[] = []

  for (const line of lines) {
    const amounts = parseMoneyTokens(line)
    if (!amounts.length) continue
    const amount = Math.max(...amounts)
    let score = amount
    if (totalHints.test(line)) score += 1000
    if (/\btotal\b/i.test(line) && !/\bsubtotal\b/i.test(line)) score += 500
    if (/\bsubtotal\b/i.test(line)) score -= 400
    if (/\btax\b/i.test(line)) score -= 300
    candidates.push({ amount, score })
  }

  if (!candidates.length) {
    const all = parseMoneyTokens(text)
    if (!all.length) return null
    return Math.max(...all)
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates[0].amount
}

export function extractDate(text: string): string | null {
  const patterns: RegExp[] = [
    /\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/,
    /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})\b/,
    /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})\b/,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(20\d{2})\b/i,
  ]

  for (const re of patterns) {
    const m = text.match(re)
    if (!m) continue
    try {
      if (re === patterns[0]) {
        const y = m[1]
        const mo = m[2].padStart(2, '0')
        const d = m[3].padStart(2, '0')
        return `${y}-${mo}-${d}`
      }
      if (re === patterns[1]) {
        const mo = m[1].padStart(2, '0')
        const d = m[2].padStart(2, '0')
        const y = m[3]
        return `${y}-${mo}-${d}`
      }
      if (re === patterns[2]) {
        const mo = m[1].padStart(2, '0')
        const d = m[2].padStart(2, '0')
        const y = `20${m[3]}`
        return `${y}-${mo}-${d}`
      }
      if (re === patterns[3]) {
        const months: Record<string, string> = {
          jan: '01',
          feb: '02',
          mar: '03',
          apr: '04',
          may: '05',
          jun: '06',
          jul: '07',
          aug: '08',
          sep: '09',
          oct: '10',
          nov: '11',
          dec: '12',
        }
        const mo = months[m[1].slice(0, 3).toLowerCase()]
        const d = m[2].padStart(2, '0')
        return `${m[3]}-${mo}-${d}`
      }
    } catch {
      /* continue */
    }
  }
  return null
}

export function extractVendor(text: string): string {
  const lower = text.toLowerCase()
  for (const hint of VENDOR_HINTS) {
    if (lower.includes(hint)) {
      // Return a clean title-ish form from original text if possible
      const idx = lower.indexOf(hint)
      const snippet = text.slice(idx, idx + hint.length)
      return snippet.replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase())
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && l.length <= 40)
  for (const line of lines.slice(0, 8)) {
    if (/^\d+$/.test(line)) continue
    if (/total|receipt|invoice|thank|store\s*#|tel|phone|www\.|http/i.test(line)) continue
    if (/\d{2,}[\/\-]\d/.test(line)) continue
    if (/\$/.test(line)) continue
    // Prefer lines that look like names
    if (/[A-Za-z]{3,}/.test(line)) {
      return line.replace(/\s+/g, ' ').slice(0, 48)
    }
  }
  return ''
}

export function categorizeText(text: string): { categoryId: CategoryId; score: number } {
  const lower = text.toLowerCase()
  let best: CategoryId = 'misc'
  let bestScore = 0

  for (const [id, words] of Object.entries(CATEGORY_KEYWORDS) as [CategoryId, string[]][]) {
    if (id === 'misc') continue
    let score = 0
    for (const w of words) {
      if (lower.includes(w)) score += w.includes(' ') ? 3 : 2
    }
    if (score > bestScore) {
      bestScore = score
      best = id
    }
  }
  return { categoryId: best, score: bestScore }
}

export function extractDescription(text: string, vendor: string, categoryId: CategoryId): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const itemish = lines.filter((l) => {
    if (l.length < 4 || l.length > 60) return false
    if (/total|subtotal|tax|cash|change|visa|mastercard|debit|auth|approval/i.test(l)) return false
    if (vendor && l.toLowerCase().includes(vendor.toLowerCase())) return false
    // often items have a price on the line
    return /[A-Za-z]{3,}/.test(l) && (/\d/.test(l) || l.split(/\s+/).length <= 8)
  })

  if (itemish.length) {
    const picks = itemish
      .slice(0, 3)
      .map((l) => l.replace(/\s+\$?\d+[.,]\d{2}\s*$/, '').trim())
      .filter(Boolean)
    if (picks.length) return picks.join('; ').slice(0, 120)
  }

  const labels: Record<CategoryId, string> = {
    structure: 'Structure materials',
    insulation: 'Insulation supplies',
    electrical: 'Electrical supplies',
    solar: 'Solar / power gear',
    plumbing: 'Plumbing supplies',
    propane: 'Propane / heat supplies',
    interior: 'Interior build materials',
    kitchen: 'Kitchen supplies',
    bathroom: 'Bathroom supplies',
    flooring: 'Flooring materials',
    windows: 'Windows / doors',
    furniture: 'Furniture',
    tools: 'Tools & supplies',
    safety: 'Safety gear',
    fuel: 'Fuel',
    misc: 'Store purchase',
  }
  return vendor ? `${labels[categoryId]} — ${vendor}` : labels[categoryId]
}

/** Pure parse step — exported for unit tests. */
export function parseReceiptText(rawText: string): LocalAgentResult {
  const text = rawText.replace(/\u0000/g, ' ').trim()
  const amount = extractAmount(text)
  const date = extractDate(text)
  const vendor = extractVendor(text)
  const { categoryId, score: catScore } = categorizeText(text)
  const description = extractDescription(text, vendor, categoryId)

  let confidence = 0.25
  if (amount != null) confidence += 0.35
  if (date) confidence += 0.15
  if (vendor) confidence += 0.15
  if (catScore > 0) confidence += Math.min(0.2, catScore * 0.04)
  if (description && !description.startsWith('Store purchase')) confidence += 0.05
  confidence = Math.min(0.95, Math.round(confidence * 100) / 100)

  return {
    date,
    vendor,
    amount,
    description,
    categoryId,
    notes: text
      ? `On-device read · conf ${Math.round(confidence * 100)}%`
      : '',
    source: 'on-device',
    confidence,
    rawText: text.slice(0, 4000),
  }
}

let workerPromise: Promise<Worker> | null = null

async function getWorker(onProgress?: (p: AgentProgress) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      onProgress?.({
        stage: 'ocr',
        progress: 0.05,
        message: 'Starting on-device agent…',
      })
      const Tesseract = await import('tesseract.js')
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            onProgress?.({
              stage: 'ocr',
              progress: 0.15 + m.progress * 0.7,
              message: `Reading receipt on device… ${Math.round(m.progress * 100)}%`,
            })
          } else if (m.status === 'loading language traineddata') {
            onProgress?.({
              stage: 'ocr',
              progress: 0.08,
              message: 'Loading offline language pack…',
            })
          }
        },
      })
      // Faster / lower power page segmentation
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
        preserve_interword_spaces: '1',
      })
      return worker
    })()
  }
  return workerPromise
}

export async function runOnDeviceReceiptAgent(
  imageBlob: Blob,
  onProgress?: (p: AgentProgress) => void,
): Promise<LocalAgentResult> {
  onProgress?.({ stage: 'prepare', progress: 0.02, message: 'Preparing photo for low-power scan…' })
  const prepared = await prepareImageForOcr(imageBlob)

  onProgress?.({ stage: 'ocr', progress: 0.1, message: 'On-device agent reading text…' })
  const worker = await getWorker(onProgress)
  const result = await worker.recognize(prepared)
  const rawText = result.data.text || ''

  onProgress?.({ stage: 'parse', progress: 0.92, message: 'Filing purchase details…' })
  const parsed = parseReceiptText(rawText)
  onProgress?.({ stage: 'done', progress: 1, message: 'Done' })
  return parsed
}

/** Terminate worker to free memory (optional; call from Settings). */
export async function disposeOnDeviceAgent(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise
    await w.terminate()
    workerPromise = null
  }
}
