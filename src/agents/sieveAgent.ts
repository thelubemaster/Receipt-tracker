/**
 * Sieve — free multi-strategy line-item ensemble (no API key).
 * Runs strict + relaxed parsers and merges unique items.
 */
import type { ReceiptLineItem } from '../types'
import { categorizeText } from './keywords'
import {
  isShippingLineItem,
  makeShippingLineItem,
  runLineItemsAgent,
  type LineItemsAgentResult,
} from './lineItemsAgent'
import { lastMoneyOnLine, roundMoney } from './moneyParse'

function relaxedLineItems(text: string): ReceiptLineItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3)

  const items: ReceiptLineItem[] = []
  let shipping: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Capture shipping as its own line; skip other totals chrome
    if (/\b(shipping|freight|delivery|postage)\b/i.test(line) && !/\bshipped to\b/i.test(line)) {
      const amount = lastMoneyOnLine(line)
      if (amount != null && amount > 0) shipping = roundMoney(amount)
      else if (i + 1 < lines.length) {
        const next = lastMoneyOnLine(lines[i + 1])
        if (next != null) shipping = roundMoney(next)
      }
      continue
    }
    if (
      /\b(subtotal|grand total|tax|visa|mastercard|debit|change|cash|thank|payment)\b/i.test(line) ||
      /^total\b/i.test(line)
    ) {
      continue
    }
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
    if (isShippingLineItem(desc)) {
      shipping = roundMoney(amount)
      continue
    }
    const { categoryId } = categorizeText(desc)
    items.push({
      id: `sieve-r-${i}`,
      description: desc.slice(0, 80),
      amount: roundMoney(amount),
      categoryId,
    })
  }
  if (shipping != null) items.push(makeShippingLineItem(shipping, 'sieve-r-shipping'))
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

/**
 * Pair description blocks with prices using layout-friendly line structure.
 * Handles: multi-line product names, then "1 $39.97 $39.97" on the next row.
 * Shipping is pulled into its own line item.
 */
function layoutAwareLineItems(text: string): ReceiptLineItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const skip =
    /\b(subtotal|grand total|tax|visa|mastercard|debit|payment|invoice|payer|cart items|item price|thank|change|cash|convenience fee)\b/i
  const skipTotal = /^total\b/i

  const items: ReceiptLineItem[] = []
  let buf: string[] = []
  let shipping: number | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/\b(shipping|freight|delivery|postage)\b/i.test(line) && !/\bshipped to\b/i.test(line)) {
      const amount = lastMoneyOnLine(line)
      if (amount != null && amount > 0) shipping = roundMoney(amount)
      else if (i + 1 < lines.length) {
        const next = lastMoneyOnLine(lines[i + 1])
        if (next != null) shipping = roundMoney(next)
      }
      buf = []
      continue
    }
    if ((skip.test(line) || skipTotal.test(line)) && !/filter|kit|ford|part/i.test(line)) {
      buf = []
      continue
    }

    const amount = lastMoneyOnLine(line)
    const letters = (line.match(/[A-Za-z]/g) || []).length

    if (amount == null) {
      if (letters >= 2 && line.length < 100 && !skip.test(line)) {
        if (buf.length < 8) buf.push(line)
        else {
          buf.shift()
          buf.push(line)
        }
      }
      continue
    }

    if (amount <= 0 || amount > 50000) {
      buf = []
      continue
    }

    const onLine = line
      .replace(/\$?\s*\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})/g, ' ')
      .replace(/\b\d+\b/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()

    let desc = [...buf, onLine]
      .filter((p) => p && !skip.test(p) && !isShippingLineItem(p))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim()

    if (desc.length < 3) {
      for (let j = i - 1; j >= 0 && j >= i - 5; j--) {
        if (skip.test(lines[j]) || isShippingLineItem(lines[j])) break
        if (lastMoneyOnLine(lines[j]) != null) break
        if (/[A-Za-z]{2,}/.test(lines[j])) {
          desc = `${lines[j]} ${desc}`.trim()
        }
      }
    }

    if (isShippingLineItem(desc) || isShippingLineItem(line)) {
      shipping = roundMoney(amount)
      buf = []
      continue
    }

    if (desc.length < 3 || !/[A-Za-z]{2,}/.test(desc)) {
      buf = []
      continue
    }

    const { categoryId } = categorizeText(desc)
    items.push({
      id: `sieve-layout-${i}`,
      description: desc.slice(0, 100),
      amount: roundMoney(amount),
      categoryId,
    })
    buf = []
  }

  if (shipping != null) items.push(makeShippingLineItem(shipping, 'sieve-layout-shipping'))
  return items
}

/** Prefer a single Shipping row when merges collide on different keys. */
function finalizeMerged(items: ReceiptLineItem[]): ReceiptLineItem[] {
  const products: ReceiptLineItem[] = []
  let ship: ReceiptLineItem | null = null
  for (const it of items) {
    if (isShippingLineItem(it.description)) {
      if (!ship || it.amount > ship.amount) ship = makeShippingLineItem(it.amount, it.id)
    } else {
      products.push(it)
    }
  }
  if (ship) products.push(ship)
  return products
}

export function runSieveAgent(text: string): LineItemsAgentResult {
  const primary = runLineItemsAgent(text)
  const relaxed = relaxedLineItems(text)
  const layout = layoutAwareLineItems(text)
  const merged = finalizeMerged(
    mergeLineItemLists(mergeLineItemLists(primary.items, relaxed), layout),
  )
  const itemsSum = roundMoney(merged.reduce((s, it) => s + it.amount, 0))
  const shipping = merged.find((i) => isShippingLineItem(i.description))?.amount ?? null

  let confidence = 0.25
  if (merged.length >= 1) confidence += 0.25
  if (merged.length >= 3) confidence += 0.15
  if (merged.length > primary.items.length) confidence += 0.1
  if (layout.length >= primary.items.length && layout.length >= 2) confidence += 0.05
  if (shipping != null) confidence = Math.min(0.95, confidence + 0.03)
  confidence = Math.min(0.94, confidence)

  return {
    agent: 'line-items',
    items: merged.map((it, i) => ({ ...it, id: `sieve-${i}` })),
    itemsSum,
    confidence,
    shipping,
    notes: [
      `Sieve merged ${primary.items.length} strict + ${relaxed.length} relaxed + ${layout.length} layout → ${merged.length} items`,
      shipping != null ? `Shipping section $${shipping.toFixed(2)}` : null,
    ].filter(Boolean) as string[],
  }
}
