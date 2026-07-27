/** Shared money token parsing for agent team. */

export function parseMoneyTokens(text: string): number[] {
  const amounts: number[] = []
  const re = /\$?\s*(-?\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
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
