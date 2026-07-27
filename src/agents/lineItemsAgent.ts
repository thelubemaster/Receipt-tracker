import type { CategoryId, ReceiptLineItem } from '../types'
import { categorizeText } from './keywords'
import { lastMoneyOnLine, roundMoney } from './moneyParse'

const SKIP_LINE =
  /\b(subtotal|sub total|total|tax|sales tax|vat|gst|hst|cash|change|visa|mastercard|debit|credit|auth|approval|balance due|amount due|grand total|payment|tender|thank|store\s*#|tel|phone|www\.|http|cashier|register|tran|invoice|receipt|member|rewards|savings|you saved|coupon|promo|discount|card\s*#|\*{4}|xxxx|aid\s|tc#|ref\s?#)\b/i

const QTY_PREFIX = /^(?:@?\s*)?(\d+(?:\.\d+)?)\s*(?:x|@|ea|pc|pcs)?\s+/i

export type LineItemsAgentResult = {
  agent: 'line-items'
  items: ReceiptLineItem[]
  itemsSum: number
  confidence: number
  notes: string[]
}

function cleanDescription(raw: string): string {
  let s = raw
    .replace(/\$?\s*\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  s = s.replace(QTY_PREFIX, '').trim()
  // strip trailing sku-like tokens
  s = s.replace(/\b\d{5,}\b/g, '').replace(/\s{2,}/g, ' ').trim()
  return s.slice(0, 80)
}

function isLikelyItemLine(line: string, amount: number): boolean {
  if (amount <= 0 || amount > 50000) return false
  if (SKIP_LINE.test(line)) return false
  if (line.length < 3 || line.length > 90) return false
  const letters = (line.match(/[A-Za-z]/g) || []).length
  if (letters < 2) return false
  // pure money lines
  if (/^\$?\s*[\d.,]+\s*$/.test(line.trim())) return false
  return true
}

/**
 * Agent A — Line-item extractor.
 * Pulls each purchasable row (description + price) from OCR text.
 */
export function runLineItemsAgent(text: string): LineItemsAgentResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const items: ReceiptLineItem[] = []
  const notes: string[] = []
  let pendingDesc: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const amount = lastMoneyOnLine(line)

    if (amount == null) {
      // description might be on its own line with price on next
      if (
        !SKIP_LINE.test(line) &&
        /[A-Za-z]{3,}/.test(line) &&
        line.length <= 60 &&
        !/^\d{1,2}[\/\-.]/.test(line)
      ) {
        pendingDesc = line
      }
      continue
    }

    // price-only line following a description
    if (/^\$?\s*[\d.,]+\s*$/.test(line.trim()) && pendingDesc) {
      const desc = cleanDescription(pendingDesc)
      const { categoryId } = categorizeText(desc)
      if (desc.length >= 2) {
        items.push({
          id: `li-${items.length}-${i}`,
          description: desc,
          amount: roundMoney(amount),
          categoryId,
        })
      }
      pendingDesc = null
      continue
    }

    if (!isLikelyItemLine(line, amount)) {
      pendingDesc = null
      continue
    }

    let desc = cleanDescription(line)
    if (pendingDesc && desc.length < 4) {
      desc = cleanDescription(pendingDesc)
    }
    pendingDesc = null

    if (desc.length < 2) continue

    // Merge qty line patterns like "2 @ 12.00"
    const { categoryId } = categorizeText(desc)
    items.push({
      id: `li-${items.length}-${i}`,
      description: desc,
      amount: roundMoney(amount),
      categoryId,
    })
  }

  // Deduplicate near-identical consecutive rows
  const deduped: ReceiptLineItem[] = []
  for (const item of items) {
    const prev = deduped[deduped.length - 1]
    if (
      prev &&
      prev.description.toLowerCase() === item.description.toLowerCase() &&
      prev.amount === item.amount
    ) {
      continue
    }
    deduped.push(item)
  }

  // Drop very large "items" that are almost certainly totals (safety)
  const filtered = deduped.filter((it) => {
    if (/\btotal\b/i.test(it.description)) return false
    return true
  })

  const itemsSum = roundMoney(filtered.reduce((s, it) => s + it.amount, 0))
  let confidence = 0.2
  if (filtered.length >= 1) confidence += 0.25
  if (filtered.length >= 3) confidence += 0.15
  if (filtered.length >= 5) confidence += 0.1
  confidence = Math.min(0.9, confidence)

  if (!filtered.length) {
    notes.push('No line items confidently detected')
  } else {
    notes.push(`Found ${filtered.length} line item(s), sum ${itemsSum.toFixed(2)}`)
  }

  return {
    agent: 'line-items',
    items: filtered,
    itemsSum,
    confidence,
    notes,
  }
}

export function primaryCategoryFromItems(items: ReceiptLineItem[]): CategoryId {
  if (!items.length) return 'misc'
  const spend = new Map<CategoryId, number>()
  for (const it of items) {
    spend.set(it.categoryId, (spend.get(it.categoryId) ?? 0) + it.amount)
  }
  let best: CategoryId = 'misc'
  let bestAmt = -1
  for (const [id, amt] of spend) {
    if (amt > bestAmt) {
      bestAmt = amt
      best = id
    }
  }
  return best
}
