import { VENDOR_HINTS } from './keywords'

export type MerchantAgentResult = {
  agent: 'merchant'
  vendor: string
  date: string | null
  confidence: number
  notes: string[]
}

export function extractDate(text: string): string | null {
  const patterns: RegExp[] = [
    /\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/,
    /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})\b/,
    /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})\b/,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i,
  ]

  for (let i = 0; i < patterns.length; i++) {
    const re = patterns[i]
    const m = text.match(re)
    if (!m) continue
    try {
      if (i === 0) {
        return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
      }
      if (i === 1) {
        return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
      }
      if (i === 2) {
        return `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
      }
      if (i === 3) {
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
        return `${m[3]}-${mo}-${m[2].padStart(2, '0')}`
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
      const idx = lower.indexOf(hint)
      const snippet = text.slice(idx, idx + hint.length)
      return snippet.replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase())
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && l.length <= 40)

  for (const line of lines.slice(0, 10)) {
    if (/^\d+$/.test(line)) continue
    if (/total|receipt|invoice|thank|store\s*#|tel|phone|www\.|http/i.test(line)) continue
    if (/\d{2,}[\/\-]\d/.test(line)) continue
    if (/\$/.test(line)) continue
    if (/[A-Za-z]{3,}/.test(line)) {
      return line.replace(/\s+/g, ' ').slice(0, 48)
    }
  }
  return ''
}

/** Agent C — merchant / date specialist. */
export function runMerchantAgent(text: string): MerchantAgentResult {
  const vendor = extractVendor(text)
  const date = extractDate(text)
  let confidence = 0.2
  if (vendor) confidence += 0.4
  if (date) confidence += 0.3
  return {
    agent: 'merchant',
    vendor,
    date,
    confidence: Math.min(0.95, confidence),
    notes: [
      vendor ? `Vendor: ${vendor}` : 'Vendor unclear',
      date ? `Date: ${date}` : 'Date unclear',
    ],
  }
}
