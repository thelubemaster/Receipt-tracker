import type { CategoryId, ReceiptLineItem } from '../types'
import { categorizeText } from './keywords'
import { lastMoneyOnLine, parseMoneyTokens, roundMoney } from './moneyParse'

/** Not product rows — fees, totals, chrome UI, etc. */
const SKIP_LINE =
  /\b(subtotal|sub total|total|grand total|tax|sales tax|vat|gst|hst|shipping|freight|delivery|cash|change|visa|mastercard|debit|credit|auth|approval|balance due|amount due|payment method|tender|thank|store\s*#|tel|phone|www\.|http|https|cashier|register|tran|invoice|receipt|member|rewards|savings|you saved|coupon|promo|discount|card\s*#|\*{4}|xxxx|aid\s|tc#|ref\s?#|cart items|item price|item total|qty|sku|order contains|items shipped|powered by|launch your own|bigcommerce|reply|forward)\b/i

const FEE_LINE = /\b(shipping|freight|delivery|handling)\b/i

const PRICE_ONLY = /^\$?\s*[\d.,]+\s*$/
const SKU_QTY_PRICE =
  /^[A-Z0-9][\w\-\/]*\s+\d+\s+\$?\d+[.,]\d{2}(?:\s+\$?\d+[.,]\d{2})?$/i
const QTY_DUAL_PRICE = /^\d+\s+\$?\d+[.,]\d{2}(?:\s+\$?\d+[.,]\d{2})+$/

export type LineItemsAgentResult = {
  agent: 'line-items'
  items: ReceiptLineItem[]
  itemsSum: number
  confidence: number
  notes: string[]
  shipping?: number | null
}

function cleanDescription(raw: string): string {
  let s = raw
    // strip all money tokens
    .replace(/\$\s*\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})/g, ' ')
    .replace(/\b\d+[.,]\d{2}\b/g, ' ')
    // strip lone qty near end
    .replace(/\s+\d+\s*$/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  // strip pure SKU-looking short tokens only when we still have words
  if (/[A-Za-z]{4,}/.test(s)) {
    s = s.replace(/\b[A-Z0-9]{2,}-\d{3,}\b/g, ' ').replace(/\s{2,}/g, ' ').trim()
  }
  return s.slice(0, 100)
}

function isNoiseDescLine(line: string): boolean {
  if (!line || line.length < 2) return true
  if (SKIP_LINE.test(line)) return true
  if (PRICE_ONLY.test(line)) return true
  if (/^[\W\d]+$/.test(line)) return true
  // phone chrome
  if (/^\d{1,2}:\d{2}/.test(line)) return true
  if (/^[.\W]{1,6}$/.test(line)) return true
  return false
}

function looksLikeProductName(line: string): boolean {
  if (isNoiseDescLine(line)) return false
  if (line.length > 80) return false
  if (!/[A-Za-z]{2,}/.test(line)) return false
  // year ranges ok: 1994-1997 FORD
  return true
}

/**
 * Build product description from buffered name lines + the priced row.
 */
function assembleDescription(buffer: string[], pricedLine: string): string {
  const parts = [...buffer]
  // If priced line has real words (not only SKU/qty/prices), include them
  const withoutMoney = pricedLine
    .replace(/\$\s*\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})/g, ' ')
    .replace(/\b\d+[.,]\d{2}\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  // Drop trailing qty
  const maybeWords = withoutMoney.replace(/^\d+\s+/, '').replace(/\s+\d+$/, '').trim()
  if (
    maybeWords.length >= 4 &&
    /[A-Za-z]{3,}/.test(maybeWords) &&
    !SKU_QTY_PRICE.test(pricedLine.trim())
  ) {
    // Prefer not duplicating SKU-only fragments already in buffer
    if (!parts.some((p) => p.toLowerCase().includes(maybeWords.toLowerCase().slice(0, 12)))) {
      parts.push(maybeWords)
    }
  }
  return cleanDescription(parts.join(' '))
}

/**
 * Agent A — Line-item extractor (multi-line e-commerce + store receipts).
 */
export function runLineItemsAgent(text: string): LineItemsAgentResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const items: ReceiptLineItem[] = []
  const notes: string[] = []
  let buffer: string[] = []
  let shipping: number | null = null

  const flushBuffer = () => {
    buffer = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const amounts = parseMoneyTokens(line)
    const amount = amounts.length ? amounts[amounts.length - 1] : null

    // Shipping / freight fee — record but not a product
    if (amount != null && FEE_LINE.test(line)) {
      shipping = roundMoney(amount)
      flushBuffer()
      continue
    }

    // Totals / tax / payment chrome
    if (SKIP_LINE.test(line) && amount != null) {
      flushBuffer()
      continue
    }
    if (SKIP_LINE.test(line) && amount == null) {
      // header rows shouldn't wipe product buffer mid-item... only clear if clearly section chrome
      if (/\b(subtotal|grand total|payment|cart items|item price)\b/i.test(line)) {
        flushBuffer()
      }
      continue
    }

    if (amount == null) {
      if (looksLikeProductName(line)) {
        // Accumulate multi-line product titles (max 6 lines)
        if (buffer.length < 6) buffer.push(line)
        else {
          buffer.shift()
          buffer.push(line)
        }
      }
      continue
    }

    // Price-bearing row
    const isPriceOnly = PRICE_ONLY.test(line) || QTY_DUAL_PRICE.test(line) || SKU_QTY_PRICE.test(line)
    const letters = (line.match(/[A-Za-z]/g) || []).length

    // Need either a buffer of product names or words on this line
    if (buffer.length === 0 && letters < 3 && !isPriceOnly) {
      continue
    }
    if (buffer.length === 0 && letters < 3 && isPriceOnly) {
      // orphan price — skip
      continue
    }

    // Prefer item total: if two similar prices, last is usually line total
    let itemAmount = roundMoney(amount)
    if (amounts.length >= 2) {
      itemAmount = roundMoney(amounts[amounts.length - 1])
    }

    if (itemAmount <= 0 || itemAmount > 50000) {
      flushBuffer()
      continue
    }

    let desc = assembleDescription(buffer, line)
    // If description still looks like only a SKU, try previous non-buffer line context
    if (desc.length < 4 || !/[A-Za-z]{3,}/.test(desc)) {
      // look back up to 4 lines
      const back: string[] = []
      for (let j = i - 1; j >= 0 && back.length < 4; j--) {
        if (looksLikeProductName(lines[j]) && !lastMoneyOnLine(lines[j])) {
          back.unshift(lines[j])
        } else if (lastMoneyOnLine(lines[j]) != null) break
      }
      if (back.length) desc = cleanDescription(back.join(' '))
    }

    if (desc.length < 3 || !/[A-Za-z]{2,}/.test(desc)) {
      flushBuffer()
      continue
    }

    // Don't treat pure "Shipping" style as product (belt-and-suspenders)
    if (FEE_LINE.test(desc) || /\bsubtotal\b|\btax\b|\btotal\b/i.test(desc)) {
      flushBuffer()
      continue
    }

    const { categoryId } = categorizeText(desc + ' ' + buffer.join(' '))
    items.push({
      id: `li-${items.length}-${i}`,
      description: desc,
      amount: itemAmount,
      categoryId,
    })
    flushBuffer()
  }

  // Deduplicate consecutive identical
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
    // Also drop if same amount+overlapping desc within list
    const dup = deduped.find(
      (d) =>
        d.amount === item.amount &&
        (d.description.toLowerCase().includes(item.description.toLowerCase().slice(0, 12)) ||
          item.description.toLowerCase().includes(d.description.toLowerCase().slice(0, 12))),
    )
    if (dup) {
      if (item.description.length > dup.description.length) {
        dup.description = item.description
        dup.categoryId = item.categoryId
      }
      continue
    }
    deduped.push(item)
  }

  const filtered = deduped.filter((it) => {
    if (/\btotal\b/i.test(it.description)) return false
    if (FEE_LINE.test(it.description)) return false
    return true
  })

  const itemsSum = roundMoney(filtered.reduce((s, it) => s + it.amount, 0))
  let confidence = 0.2
  if (filtered.length >= 1) confidence += 0.25
  if (filtered.length >= 2) confidence += 0.2
  if (filtered.length >= 3) confidence += 0.1
  confidence = Math.min(0.92, confidence)

  if (!filtered.length) notes.push('No line items confidently detected')
  else notes.push(`Found ${filtered.length} line item(s), sum ${itemsSum.toFixed(2)}`)
  if (shipping != null) notes.push(`Shipping fee ${shipping.toFixed(2)} (not a product line)`)

  return {
    agent: 'line-items',
    items: filtered,
    itemsSum,
    confidence,
    notes,
    shipping,
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
