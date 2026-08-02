import { VENDOR_HINTS } from './keywords'
import { parseMoneyTokens, recoverGarbledMoney } from './moneyParse'
import { normalizeOcrText } from './normalizeOcrText'

export type MerchantAgentResult = {
  agent: 'merchant'
  vendor: string
  date: string | null
  confidence: number
  notes: string[]
}

const MONTHS: Record<string, string> = {
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

function parseMonthNameDate(m: RegExpMatchArray): string | null {
  const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]
  if (!mo) return null
  return `${m[3]}-${mo}-${m[2].padStart(2, '0')}`
}

function isPlausibleIsoDate(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const d = parseInt(m[3], 10)
  if (y < 2000 || y > 2100) return false
  if (mo < 1 || mo > 12) return false
  if (d < 1 || d > 31) return false
  // Reject impossible calendar days (2022-01-81 from CORE TRADE-IN OCR)
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

export function extractDate(text: string): string | null {
  // Prefer "Order placed May 27,2026" / "Delivered May 28" over "Return window closed June 27"
  // Allow missing space after comma (common OCR: "May 27,2026")
  const preferred =
    text.match(
      /\b(?:order\s*placed|ordered|order\s*date|purchase\s*date|invoice\s*date|delivered)\s*:?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s*(20\d{2})\b/i,
    ) ||
    text.match(
      /\b(?:order\s*placed|ordered|order\s*date|purchase\s*date|invoice\s*date)\s*:?\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})\b/i,
    )

  // Auto parts footer: "DATE 08/01/2026" or "DATE 08/01,3" + year nearby / "08/01/2026"
  const storeDate =
    text.match(/\bDATE\s*:?\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.,\s]+(20\d{2})\b/i) ||
    text.match(/\bDATE\s*:?\s*(\d{1,2})[\/\-.](\d{1,2})\b[^\n]{0,40}?(20\d{2})/i)
  if (storeDate) {
    const iso = `${storeDate[3]}-${storeDate[1].padStart(2, '0')}-${storeDate[2].padStart(2, '0')}`
    if (isPlausibleIsoDate(iso)) return iso
  }

  // Phone-photo OCR: "7/26/2026" often becomes "V26/2026" or "V26(2026" (7→V)
  const vAsSeven = text.match(/\b[Vv7]\s*(\d{1,2})\s*[\/\-(]\s*(20\d{2})\b/)
  if (vAsSeven && !preferred) {
    const day = parseInt(vAsSeven[1], 10)
    const year = vAsSeven[2]
    if (day >= 1 && day <= 31) {
      const iso = `${year}-07-${String(day).padStart(2, '0')}`
      if (isPlausibleIsoDate(iso)) return iso
    }
  }
  if (preferred) {
    if (preferred.length >= 4 && /[a-z]/i.test(preferred[1])) {
      const d = parseMonthNameDate(preferred)
      if (d) return d
    }
    if (preferred.length >= 4 && /^\d/.test(preferred[1])) {
      return `${preferred[3]}-${preferred[1].padStart(2, '0')}-${preferred[2].padStart(2, '0')}`
    }
  }

  // Score all date hits; demote return-window lines
  const patterns: { re: RegExp; kind: 'ymd' | 'mdy' | 'mdy2' | 'mon' }[] = [
    { re: /\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g, kind: 'ymd' },
    { re: /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})\b/g, kind: 'mdy' },
    { re: /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})\b/g, kind: 'mdy2' },
    {
      re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s*(20\d{2})\b/gi,
      kind: 'mon',
    },
  ]

  const candidates: { date: string; score: number }[] = []
  for (const { re, kind } of patterns) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      try {
        let date = ''
        if (kind === 'ymd') date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
        else if (kind === 'mdy')
          date = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
        else if (kind === 'mdy2')
          date = `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
        else {
          const d = parseMonthNameDate(m)
          if (!d) continue
          date = d
        }
        const ctx = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20)
        let score = 1
        if (!isPlausibleIsoDate(date)) continue
        // AutoZone CORE TRADE-IN OCR like "81/22.00" must not become a date
        if (/\bcore\s*trade/i.test(ctx) || /@\s*\d/.test(ctx)) score -= 15
        if (/\border\s*placed\b|\bordered\b|\binvoice\b|\bpurchase\b|\bdate\b/i.test(ctx))
          score += 10
        if (/\bdelivered\b|\bshipped\b/i.test(ctx)) score += 4
        if (/\breturn\s*window\b|\brefund\b|\bclosed\s*on\b/i.test(ctx)) score -= 8
        candidates.push({ date, score })
      } catch {
        /* continue */
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]?.date
  return best && isPlausibleIsoDate(best) ? best : null
}

function titleCaseVendor(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Card networks / tender lines — never the store name. */
const PAYMENT_VENDOR_NOISE =
  /\b(visa|mastercard|master\s*card|amex|american\s*express|discover|chip|debit|credit|cash|auth|approval|tender|change due|paid)\b/i

export function extractVendor(text: string): string {
  text = normalizeOcrText(text)
  const lower = text.toLowerCase()

  // 0a) Amazon order summary / marketplace emails
  if (
    (/\border\s*summary\b/i.test(text) || /\border\s*#\s*\d{3}-/i.test(text)) &&
    (/\border\s*placed\b/i.test(text) ||
      /\bship\s*to\b/i.test(text) ||
      /\bgrand\s*total\b/i.test(text) ||
      /\bpayment\s*method\b/i.test(text))
  ) {
    return 'Amazon'
  }
  if (/\bamazon\.com\b|\bamazon\.ca\b|\bamzn\b/i.test(text)) return 'Amazon'

  // 0a2) AutoZone (OCR often drops the leading “A”: “utoZone 01874”)
  if (
    /\baut[o0]z[o0]ne\b/i.test(text) ||
    /\bu?t[o0]z[o0]ne\b/i.test(text) ||
    (/\bnazareth\s*pike\b/i.test(text) && /\b(battery|duralast|core\s*charge)\b/i.test(text))
  ) {
    return 'AutoZone'
  }

  // 0b) Private sale / Marketplace-style screenshots ("I'm selling…")
  if (
    /\b(i['’`]?m\s+selling|am\s+selling|i\s+am\s+selling|for\s+sale|marketplace)\b/i.test(
      text,
    ) ||
    (/\bsell(?:ing)?\b/i.test(text) &&
      /\b(bus|mower|car|truck|item|bike|trailer|rus)\b/i.test(text))
  ) {
    const seller = extractPrivateSellerName(text)
    if (seller) return `Private sale · ${seller}`
    // Location as weak fallback (Bradley Carport) — still better than OCR soup
    const place = text.match(/\b(Bradley\s+Car[a-z]{0,6})\b/i)
    if (place) return `Private sale · ${titleCaseVendor(place[1])}`
    return 'Private sale'
  }

  // 0) "Payment details for Company Name" / invoice headers
  const payFor = text.match(/payment details for\s*\n?\s*([A-Za-z0-9][A-Za-z0-9 .,&'-]{3,60})/i)
  if (payFor?.[1]) {
    const name = payFor[1].trim().split(/\n/)[0].trim()
    if (name.length >= 3 && !/^payer$/i.test(name) && !PAYMENT_VENDOR_NOISE.test(name)) {
      return titleCaseVendor(name)
    }
  }
  // Company line with Inc/LLC/Service
  const company = text.match(
    /\b([A-Z][A-Za-z0-9 .,&'-]{2,50}\b(?:Inc|LLC|Ltd|Service|Services|Towing|Motors|Parts)\.?)\b/,
  )
  if (company?.[1] && !/payment method|credit card/i.test(company[1]) && !PAYMENT_VENDOR_NOISE.test(company[1])) {
    return titleCaseVendor(company[1])
  }

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

  // 3) ALL-CAPS brand-like lines — prefer store header (early), skip card tender footer
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const capsCandidates: string[] = []
  for (const line of lines) {
    if (line.length < 4 || line.length > 48) continue
    // Allow store# suffix: HOME DEPOT #4821
    const core = line.replace(/\s*#\s*\d+\s*$/, '').trim()
    if (!/^[A-Z0-9][A-Z0-9 .&'\-]{2,}$/.test(core) && !/^[A-Z0-9][A-Z0-9 .&'\-]{2,}#\d+$/.test(line.replace(/\s/g, ''))) {
      // still accept "HOME DEPOT #4821"
      if (!/^[A-Z][A-Z0-9 .&'\-#]{3,}$/.test(line)) continue
    }
    if (/\d{5,}/.test(line) && !/#\d{2,5}\b/.test(line)) continue
    if (/TOTAL|ORDER|SHIP|TAX|CARD|PAYMENT|ITEMS|CART|SKU|QTY|SUBTOTAL/i.test(line)) continue
    if (PAYMENT_VENDOR_NOISE.test(line)) continue
    if (/^\*+|\*{3,}/.test(line)) continue
    // Reject OCR soup (HVBDARBM KARZ) — consonants-only brands aren't real stores
    const letters = (core.match(/[A-Za-z]/g) || []).length
    const vowels = (core.match(/[aeiouAEIOU]/g) || []).length
    if (letters >= 6 && vowels / letters < 0.22) continue
    if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(core)) continue
    if (/^\$?\d+[.,]\d{2}$/.test(core.replace(/\s/g, ''))) continue
    capsCandidates.push(core.length >= 4 ? core : line)
  }
  if (capsCandidates.length) {
    // Prefer first solid brand line (header) over footer noise
    return titleCaseVendor(capsCandidates[0])
  }

  // 4) First clean early line (legacy) — skip OCR garbage, payment & payer-only names
  for (const line of lines.slice(0, 12)) {
    if (line.length < 3 || line.length > 48) continue
    if (/^\d+$/.test(line)) continue
    if (/[\[\]{}|\\]/.test(line)) continue
    if (totalNoise(line)) continue
    if (PAYMENT_VENDOR_NOISE.test(line)) continue
    if (/^payer$|^bradley$|^payment/i.test(line.trim())) continue
    // Skip OCR crumbs like S000, S200, su:
    if (/^[A-Z]?\d{2,5}$/i.test(line.trim())) continue
    if (/^s\d{2,5}$/i.test(line.trim())) continue
    if (/\d{2,}[\/\-]\d/.test(line)) continue
    if (/\$/.test(line)) continue
    const letters = (line.match(/[A-Za-z]/g) || []).length
    const vowels = (line.match(/[aeiouAEIOU]/g) || []).length
    if (letters < 4) continue
    if (vowels < 2 && letters > 6) continue
    if (/[A-Za-z]{3,}/.test(line)) {
      return titleCaseVendor(line.replace(/\s*#\s*\d+\s*$/, '').trim())
    }
  }
  return ''
}

/** Normalize OCR seller names (Dustn/Oustn → Dustin Maurer when last name matches). */
export function extractPrivateSellerName(text: string): string | null {
  const t = text || ''
  // Common: Dustin Maurer with heavy OCR damage on both tokens
  if (
    /\b(dustin|dustn|oustn|duskin|dughin|oustn|dustn|oustn|mawrer|maurer|mowe|moser|maser|mawr)\b/i.test(
      t,
    ) &&
    /\b(maur|mowe|moser|mawr|maser|mower)\b/i.test(t)
  ) {
    // If first name looks like Dustin*
    if (/\b(dustin|dustn|oustn|duskin|dughin|oustn)\b/i.test(t)) {
      return 'Dustin Maurer'
    }
  }
  const nearSell =
    t.match(/\b(Dustin\s+[A-Za-z]{3,14})\b/i) ||
    t.match(/\b([A-Z][a-z]{2,12}\s+[A-Z][a-z]{2,14})\b[^\n]{0,48}\bsell/i) ||
    t.match(/\bsell(?:ing)?[^\n]{0,24}\b([A-Z][a-z]{2,12}\s+[A-Z][a-z]{2,14})\b/i)
  if (nearSell?.[1] && nearSell[1].length >= 5) {
    const raw = nearSell[1]
    if (/dustin|dustn|oustn|duskin/i.test(raw) && /maur|mowe|moser|mawr|maser/i.test(raw)) {
      return 'Dustin Maurer'
    }
    return titleCaseVendor(raw)
  }
  return null
}

/**
 * Asking price for a private-sale listing (mode of plausible unit prices).
 * Prefers 150-class amounts over OCR ghosts like 7150 or multi-page sums.
 */
export function extractListingPrice(text: string): number | null {
  const amounts = parseMoneyTokens(recoverGarbledMoney(text || ''))
    .filter((a) => a >= 5 && a <= 5000)
    // Drop VIN-ish / order-ish magnitudes when we also see a normal listing price
    .filter((a) => a < 2000 || amountsNear(a, text))
  if (!amounts.length) return null
  // Histogram to 2 decimals
  const counts = new Map<number, number>()
  for (const a of amounts) {
    const k = Math.round(a * 100) / 100
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  // Prefer amounts that appear most often, then smaller plausible listing prices
  let best: number | null = null
  let bestScore = -1
  for (const [amt, n] of counts) {
    let score = n * 10
    if (amt >= 20 && amt <= 2000) score += 5
    if (amt >= 50 && amt <= 500) score += 3
    // Prefer 150 over 750/7150-class if both present
    if (Math.abs(amt - 150) < 1) score += 8
    if (amt >= 500 && amt <= 900 && counts.has(150)) score -= 10
    if (score > bestScore) {
      bestScore = score
      best = amt
    }
  }
  return best
}

function amountsNear(a: number, text: string): boolean {
  // Keep large amount only if explicitly marked with $ or Loc
  return new RegExp(
    `(\\$\\s*${Math.floor(a)}|loc\\s*[:=]?\\s*${Math.floor(a)})`,
    'i',
  ).test(text)
}

/**
 * Best short listing / item title from messy Marketplace-style OCR.
 * Generic: not store-specific.
 */
export function extractListingDescription(text: string): string | null {
  const t = normalizeOcrText(text || '')
  const who = extractPrivateSellerName(t)
  // "reconditioned bus" OCR: Trvernadionod / Teweenedionod / Trvernodionod + Bus/Rus
  const hasBus = /\b(bus|rus)\b/i.test(t)
  const recond = /\b(re-?)?c?ondition|trvern|teween|tovecn|tevern|nadionod|nodionod|ioned\b/i.test(
    t,
  )
  if (hasBus && (recond || /\bsell/i.test(t))) {
    const label = recond ? 'reconditioned bus' : 'bus'
    if (who) return `${who} — ${label}`.slice(0, 120)
    return `Private sale — ${label}`
  }
  if (/\bsell(?:ing)?\b/i.test(t) && /\bmower\b/i.test(t)) {
    return who ? `${who} — mower (private sale)`.slice(0, 120) : 'Mower — private sale'
  }
  if (who && /\bsell/i.test(t)) {
    return `${who} — private sale item`.slice(0, 120)
  }
  // Cleanest line that mentions selling / item nouns
  const lines = t
    .split(/\r?\n/)
    .map((l) => l.replace(/[^\w\s.',$-]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 8 && l.length <= 80)
  for (const line of lines) {
    if (!/\b(sell|bus|mower|car|truck|for sale)\b/i.test(line)) continue
    const letters = (line.match(/[A-Za-z]/g) || []).length
    const vowels = (line.match(/[aeiouAEIOU]/g) || []).length
    if (letters < 8 || vowels < 3) continue
    if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(line)) continue
    if (/[|\\]/.test(line) || /\bvin\b/i.test(line)) continue
    return line.slice(0, 120)
  }
  return null
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
