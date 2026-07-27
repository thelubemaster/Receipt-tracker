/**
 * Sieve — free multi-strategy line-item ensemble (no API key).
 * Runs strict + relaxed parsers and merges unique items.
 */
import type { ReceiptLineItem } from '../types'
import { categorizeText } from './keywords'
import { runLineItemsAgent, type LineItemsAgentResult } from './lineItemsAgent'
import { lastMoneyOnLine, roundMoney } from './moneyParse'

function relaxedLineItems(text: string): ReceiptLineItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3)

  const items: ReceiptLineItem[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/\b(subtotal|total|tax|visa|mastercard|debit|change|cash|thank)\b/i.test(line)) continue
    const amount = lastMoneyOnLine(line)
    if (amount == null || amount <= 0 || amount > 20000) continue
    let desc = line
      .replace(/\$?\s*\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (desc.length < 2) {
      // price on this line, description above
      const prev = lines[i - 1]
      if (prev && !/\d+[.,]\d{2}/.test(prev) && prev.length < 50) {
        desc = prev
      }
    }
    if (desc.length < 2 || !/[A-Za-z]{2,}/.test(desc)) continue
    const { categoryId } = categorizeText(desc)
    items.push({
      id: `sieve-r-${i}`,
      description: desc.slice(0, 80),
      amount: roundMoney(amount),
      categoryId,
    })
  }
  return items
}

function keyOf(it: ReceiptLineItem): string {
  const d = it.description.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40)
  return `${d}|${it.amount.toFixed(2)}`
}

/**
 * Merge two item lists; prefer longer description when keys collide.
 */
export function mergeLineItemLists(a: ReceiptLineItem[], b: ReceiptLineItem[]): ReceiptLineItem[] {
  const map = new Map<string, ReceiptLineItem>()
  for (const it of [...a, ...b]) {
    const k = keyOf(it)
    const prev = map.get(k)
    if (!prev || it.description.length > prev.description.length) {
      map.set(k, it)
    }
  }
  return [...map.values()]
}

export function runSieveAgent(text: string): LineItemsAgentResult {
  const primary = runLineItemsAgent(text)
  const relaxed = relaxedLineItems(text)
  const merged = mergeLineItemLists(primary.items, relaxed)
  const itemsSum = roundMoney(merged.reduce((s, it) => s + it.amount, 0))

  let confidence = 0.25
  if (merged.length >= 1) confidence += 0.25
  if (merged.length >= 3) confidence += 0.15
  if (merged.length > primary.items.length) confidence += 0.1
  confidence = Math.min(0.92, confidence)

  return {
    agent: 'line-items',
    items: merged.map((it, i) => ({ ...it, id: `sieve-${i}` })),
    itemsSum,
    confidence,
    notes: [
      `Sieve merged ${primary.items.length} strict + ${relaxed.length} relaxed → ${merged.length} items`,
    ],
  }
}
