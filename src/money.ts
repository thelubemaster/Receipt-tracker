/** Format a dollar amount for display. */
export function formatMoney(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(safe)
}

/**
 * Keep what the user is typing for a money field (allows "12." while entering cents).
 * Strips junk, allows one decimal, max 2 fraction digits.
 */
export function sanitizeMoneyTyping(raw: string): string {
  // Keep digits + separators; drop $ and letters
  let s = raw.replace(/[^\d.,]/g, '')
  // Treat comma as decimal only when there is no period (EU-style "12,50")
  if (s.includes(',') && !s.includes('.')) {
    const parts = s.split(',')
    s = parts[0] + (parts.length > 1 ? '.' + parts.slice(1).join('') : '')
  } else {
    // Period is decimal; commas are thousand separators
    s = s.replace(/,/g, '')
  }
  const dot = s.indexOf('.')
  if (dot !== -1) {
    const whole = s.slice(0, dot).replace(/\./g, '')
    const frac = s.slice(dot + 1).replace(/\./g, '').slice(0, 2)
    s = `${whole}.${frac}`
  }
  return s
}

/** Display helper for controlled money inputs (no forced trailing zeros). */
export function formatAmountForInput(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return ''
  const r = Math.round(amount * 100) / 100
  return String(r)
}

/**
 * Parse user input into a non-negative number, or null if invalid / incomplete.
 * Incomplete drafts like "." or "12." return null so the UI can keep the draft string.
 */
export function parseMoneyInput(raw: string): number | null {
  if (/[-]/.test(raw)) return null
  const cleaned = sanitizeMoneyTyping(raw)
  if (!cleaned || cleaned === '.') return null
  // Incomplete trailing decimal while typing — not a final value yet
  if (cleaned.endsWith('.')) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

/**
 * Like parseMoneyInput but accepts trailing "." as the whole-dollar amount
 * (for blur / save: "12." → 12).
 */
export function parseMoneyInputLoose(raw: string): number | null {
  if (/[-]/.test(raw)) return null
  const cleaned = sanitizeMoneyTyping(raw)
  if (!cleaned || cleaned === '.') return null
  const n = Number(cleaned.endsWith('.') ? cleaned.slice(0, -1) : cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

export function sumAmounts(amounts: number[]): number {
  return Math.round(amounts.reduce((s, a) => s + (Number.isFinite(a) ? a : 0), 0) * 100) / 100
}
