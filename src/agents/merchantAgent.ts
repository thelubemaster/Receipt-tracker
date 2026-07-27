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

function titleCaseVendor(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function extractVendor(text: string): string {
  const lower = text.toLowerCase()

  // 1) Known big-box hints
  for (const hint of VENDOR_HINTS) {
    if (lower.includes(hint)) {
      const idx = lower.indexOf(hint)
      const snippet = text.slice(idx, idx + hint.length)
      return titleCaseVendor(snippet)
    }
  }

  // 2) Domain / URL → brand (swagperformanceparts.com)
  const domain = text.match(
    /(?:https?:\/\/)?(?:www\.)?([a-z0-9][-a-z0-9]{2,})\.(?:com|net|org|io|co|shop)\b/i,
  )
  if (domain) {
    const host = domain[1]
    if (
      !/google|facebook|apple|bigcommerce|shopify|paypal|amazonaws|gmail/i.test(host)
    ) {
      return titleCaseVendor(host.replace(/[-_]/g, ' '))
    }
  }

  // 3) ALL-CAPS brand-like lines (prefer later in receipt — store footer)
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const capsCandidates: string[] = []
  for (const line of lines) {
    if (line.length < 4 || line.length > 40) continue
    if (!/^[A-Z0-9][A-Z0-9 .&'\-]{3,}$/.test(line)) continue
    if (/\d{5,}/.test(line)) continue
    if (/TOTAL|ORDER|SHIP|TAX|CARD|PAYMENT|ITEMS|CART|SKU|QTY/i.test(line)) continue
    capsCandidates.push(line)
  }
  if (capsCandidates.length) {
    // Prefer last solid brand line (footer)
    return titleCaseVendor(capsCandidates[capsCandidates.length - 1])
  }

  // 4) First clean early line (legacy) — but skip OCR garbage (few vowels, brackets)
  for (const line of lines.slice(0, 12)) {
    if (line.length < 3 || line.length > 40) continue
    if (/^\d+$/.test(line)) continue
    if (/[\[\]{}|\\]/.test(line)) continue
    if (totalNoise(line)) continue
    if (/\d{2,}[\/\-]\d/.test(line)) continue
    if (/\$/.test(line)) continue
    const letters = (line.match(/[A-Za-z]/g) || []).length
    const vowels = (line.match(/[aeiouAEIOU]/g) || []).length
    if (letters < 4) continue
    if (vowels < 2 && letters > 6) continue // garbage OCR like VITCEVRVITvIeen
    if (/[A-Za-z]{3,}/.test(line)) {
      return titleCaseVendor(line)
    }
  }
  return ''
}

function totalNoise(line: string): boolean {
  return /total|receipt|invoice|thank|store\s*#|tel|phone|www\.|http|order contains|shipped|cart items/i.test(
    line,
  )
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
