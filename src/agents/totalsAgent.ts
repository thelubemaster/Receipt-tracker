import { parseMoneyTokens, roundMoney } from './moneyParse'

export type TotalsAgentResult = {
  agent: 'totals'
  total: number | null
  subtotal: number | null
  tax: number | null
  confidence: number
  strategyVotes: { label: string; total: number; weight: number }[]
  notes: string[]
}

/**
 * Agent B — Totals specialist.
 * Several strategies vote; highest weighted score wins grand total.
 */
export function runTotalsAgent(text: string): TotalsAgentResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const votes: { label: string; total: number; weight: number }[] = []
  const notes: string[] = []

  let subtotal: number | null = null
  let tax: number | null = null

  // Support label on one line, $amount on the next (invoice apps)
  const effective: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const amts = parseMoneyTokens(line)
    if (
      !amts.length &&
      /^(subtotal|total|tax|grand total|convenience fee|shipping)$/i.test(line.trim()) &&
      i + 1 < lines.length &&
      parseMoneyTokens(lines[i + 1]).length
    ) {
      effective.push(`${line} ${lines[i + 1]}`)
      i++
      continue
    }
    effective.push(line)
  }

  for (const line of effective) {
    const amounts = parseMoneyTokens(line)
    if (!amounts.length) continue
    const amount = Math.max(...amounts.map(Math.abs))

    if (/\bsub\s*-?\s*total\b/i.test(line)) {
      subtotal = roundMoney(amount)
      continue
    }
    if (/\b(sales\s*)?tax\b|\bvat\b|\bgst\b|\bhst\b/i.test(line) && !/\bpre-?tax\b/i.test(line)) {
      tax = roundMoney(amount)
      continue
    }

    // Strategy votes for TOTAL
    if (/\bgrand\s*total\b/i.test(line)) {
      votes.push({ label: 'grand-total-line', total: roundMoney(amount), weight: 12 })
    } else if (/\bamount\s*due\b|\bbalance\s*due\b/i.test(line)) {
      votes.push({ label: 'amount-due-line', total: roundMoney(amount), weight: 11 })
    } else if (/\btotal\b/i.test(line) && !/\bsub\b/i.test(line) && !/\btax\b/i.test(line)) {
      votes.push({ label: 'total-line', total: roundMoney(amount), weight: 10 })
    } else if (/\b(visa|mastercard|amex|debit|credit)\b/i.test(line)) {
      votes.push({ label: 'card-charge-line', total: roundMoney(amount), weight: 7 })
    } else if (/\b(paid|payment|tender)\b/i.test(line) && !/payment date|payment method|payment details/i.test(line)) {
      votes.push({ label: 'payment-line', total: roundMoney(amount), weight: 6 })
    }
  }

  // Strategy: largest money token near end of receipt
  const tail = lines.slice(-12).join('\n')
  const tailAmounts = parseMoneyTokens(tail).filter((a) => a > 0)
  if (tailAmounts.length) {
    const maxTail = Math.max(...tailAmounts)
    votes.push({ label: 'tail-max', total: roundMoney(maxTail), weight: 3 })
  }

  // Strategy: subtotal + tax
  if (subtotal != null && tax != null) {
    votes.push({
      label: 'subtotal-plus-tax',
      total: roundMoney(subtotal + tax),
      weight: 9,
    })
  }

  // Aggregate votes by amount
  const byAmount = new Map<number, number>()
  for (const v of votes) {
    byAmount.set(v.total, (byAmount.get(v.total) ?? 0) + v.weight)
  }

  let total: number | null = null
  let bestWeight = 0
  for (const [amt, w] of byAmount) {
    if (w > bestWeight) {
      bestWeight = w
      total = amt
    }
  }

  // Fallback: global max money (weak)
  if (total == null) {
    const all = parseMoneyTokens(text).filter((a) => a > 0)
    if (all.length) {
      total = roundMoney(Math.max(...all))
      votes.push({ label: 'global-max-fallback', total, weight: 1 })
      notes.push('Fell back to largest amount on receipt')
    }
  }

  let confidence = 0.15
  if (bestWeight >= 10) confidence = 0.85
  else if (bestWeight >= 7) confidence = 0.7
  else if (bestWeight >= 4) confidence = 0.5
  else if (total != null) confidence = 0.3

  if (subtotal != null && total != null && subtotal > total) {
    notes.push('Subtotal > total (OCR noise possible)')
    confidence *= 0.85
  }

  notes.push(
    total != null
      ? `Totals agent → ${total.toFixed(2)} (weight ${bestWeight})`
      : 'Totals agent found no amount',
  )

  return {
    agent: 'totals',
    total,
    subtotal,
    tax,
    confidence: Math.min(0.95, confidence),
    strategyVotes: votes,
    notes,
  }
}
