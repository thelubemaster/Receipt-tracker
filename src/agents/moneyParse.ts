/** Shared money token parsing for agent team. */

/**
 * Normalize OCR money confusions before parsing:
 * $12.9O → $12.90, l2.50 → 12.50, 1O.99 → 10.99
 * (No lookbehind — older Android WebViews still need this path.)
 */
function normalizeMoneyNoise(text: string): string {
  return text
    // digit + O/o + digit/dot/end → digit + 0 + …
    .replace(/(\d)[Oo](?=\d|[.,]|$)/g, '$10')
    // $ or whitespace + O/o + digit → 0
    .replace(/([$\s])[Oo](?=\d)/g, '$10')
    .replace(/^[Oo](?=\d)/g, '0')
    // l/I as 1 after $ or space or digit
    .replace(/([$\s])[lI](?=\d)/g, '$11')
    .replace(/(\d)[lI](?=\d)/g, '$11')
    .replace(/\$\s*[Ss](\d)/g, '$$$1')
}

/**
 * Amazon / marketplace order ids: 113-0548166-9548225
 * OCR often turns these into fake "money" like 48166.95.
 */
export function stripOrderIds(text: string): string {
  return text
    .replace(/\b\d{3}-\d{7}-\d{7}\b/g, ' ')
    .replace(/\bOrder\s*#?\s*\d[\d\s.\-]{8,}\b/gi, ' ')
    .replace(/\b\d{3}[\s.]\d{7}[\s.]\d{7}\b/g, ' ')
}

/** True when a number is almost certainly not a product price on a normal receipt. */
export function isImplausibleMoney(
  n: number,
  opts?: { grandTotal?: number | null },
): boolean {
  if (!Number.isFinite(n) || n <= 0) return true
  // Hard ceiling for single line items (order-id ghosts)
  if (n >= 10_000) return true
  const g = opts?.grandTotal
  if (g != null && g > 0) {
    // Product/fee/ship can't be many× larger than the grand total
    if (n > g * 2.5 && n > g + 5) return true
  }
  return false
}

/**
 * Parse money tokens, ignoring Amazon-style order numbers and
 * multi-hyphen SKU blobs that look like prices.
 */
export function parseMoneyTokens(
  text: string,
  opts?: { grandTotal?: number | null },
): number[] {
  const amounts: number[] = []
  const cleaned = stripOrderIds(normalizeMoneyNoise(text || ''))
  // Prefer $ amounts; also allow plain d.dd without $ (thermal receipts).
  // No lookbehind — older Android WebViews still need this path.
  const re = /\$\s*(-?\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2}))|([^0-9\-.]|^)(-?\d{1,4}[.,]\d{2})(?![0-9\-])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    const withDollar = Boolean(m[1])
    let raw = (m[1] || m[3] || '').replace(/\s/g, '')
    if (!raw) continue
    const neg = raw.startsWith('-')
    if (neg) raw = raw.slice(1)
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
    let n = Number(raw)
    if (!Number.isFinite(n) || n <= 0 || n >= 100000) continue
    // Reject huge whole-dollar amounts without $ (order-id fragments)
    if (!withDollar && n >= 1000 && Math.abs(n - Math.round(n)) < 0.001) continue
    if (isImplausibleMoney(n, opts)) continue
    if (neg) n = -n
    amounts.push(Math.round(n * 100) / 100)
  }
  return amounts
}

export function lastMoneyOnLine(
  line: string,
  opts?: { grandTotal?: number | null },
): number | null {
  const amounts = parseMoneyTokens(line, opts)
  if (!amounts.length) return null
  return amounts[amounts.length - 1]
}

/**
 * Prefer the first money amount after a keyword (label) — better for
 * multi-column PDF OCR where "SHIPPING $0.00 … TOTAL $93.00" share a line.
 */
export function moneyAfterLabel(line: string, labelRe: RegExp): number | null {
  const cleaned = stripOrderIds(normalizeMoneyNoise(line || ''))
  const m = cleaned.match(labelRe)
  if (!m || m.index == null) return null
  const after = cleaned.slice(m.index + m[0].length)
  const amounts = parseMoneyTokens(after)
  return amounts.length ? amounts[0] : null
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}
