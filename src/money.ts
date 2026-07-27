/** Format a dollar amount for display. */
export function formatMoney(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(safe)
}

/** Parse user input into a non-negative number, or null if invalid. */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

export function sumAmounts(amounts: number[]): number {
  return Math.round(amounts.reduce((s, a) => s + (Number.isFinite(a) ? a : 0), 0) * 100) / 100
}
