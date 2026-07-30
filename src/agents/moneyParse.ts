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

export function parseMoneyTokens(text: string): number[] {
  const amounts: number[] = []
  const cleaned = normalizeMoneyNoise(text)
  const re = /\$?\s*(-?\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    let raw = m[1].replace(/\s/g, '')
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
    if (neg) n = -n
    amounts.push(Math.round(n * 100) / 100)
  }
  return amounts
}

export function lastMoneyOnLine(line: string): number | null {
  const amounts = parseMoneyTokens(line)
  if (!amounts.length) return null
  return amounts[amounts.length - 1]
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}
