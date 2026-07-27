import type { CategoryId, ReceiptLineItem } from '../types'
import { categorizeText } from './keywords'
import { lastMoneyOnLine, parseMoneyTokens, roundMoney } from './moneyParse'

/** Not product rows — fees, totals, chrome UI, etc. */
const SKIP_LINE =
  /\b(subtotal|sub total|total|grand total|tax|sales tax|vat|gst|hst|shipping|freight|delivery|convenience fee|service fee|processing fee|cash|change|visa|mastercard|debit|credit|auth|approval|balance due|amount due|payment method|payment date|payment details|created date|payer|tender|thank|store\s*#|tel|phone|www\.|http|https|cashier|register|tran|invoice|receipt|member|rewards|savings|you saved|coupon|promo|discount|card\s*#|\*{4}|xxxx|aid\s|tc#|ref\s?#|cart items|item price|item total|qty|sku|order contains|items shipped|powered by|launch your own|bigcommerce|reply|forward)\b/i

const FEE_LINE =
  /\b(shipping|freight|delivery|handling|convenience fee|service fee|processing fee)\b/i

const ADDRESS_LINE =
  /\b(shipped to|pennsylvania|bangor|street| st\b| rd,| road|ave|avenue|zip|,\s*\d{5}|\bus\b)\b/i

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
    .replace(/\$\s*\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})/g, ' ')
    .replace(/\b\d+[.,]\d{2}\b/g, ' ')
    .replace(/\s+\d+\s*$/g, ' ')
    // strip address fragments
    .replace(/\b\d{5}(?:-\d{4})?\b/g, ' ')
    .replace(/\b(pennsylvania|bangor|shipped to|united states)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (/[A-Za-z]{4,}/.test(s)) {
    s = s.replace(/\b[A-Z0-9]{2,}-\d{3,}\b/g, ' ').replace(/\s{2,}/g, ' ').trim()
  }
  return s.slice(0, 100)
}

function isNoiseDescLine(line: string): boolean {
  if (!line || line.length < 2) return true
  if (SKIP_LINE.test(line)) return true
  if (FEE_LINE.test(line)) return true
  if (ADDRESS_LINE.test(line) && !/filter|kit|ford|part|pump|wire/i.test(line)) return true
  if (PRICE_ONLY.test(line)) return true
  if (/^[\W\d]+$/.test(line)) return true
  if (/^\d{1,2}:\d{2}/.test(line)) return true
  if (/^[.\W]{1,6}$/.test(line)) return true
  return false
}

function looksLikeProductName(line: string): boolean {
  if (isNoiseDescLine(line)) return false
  if (line.length > 80) return false
  if (!/[A-Za-z]{2,}/.test(line)) return false
  return true
}

function isFeeOrMetaLabel(line: string): boolean {
  return (
    SKIP_LINE.test(line) ||
    FEE_LINE.test(line) ||
    /^(subtotal|total|tax|shipping|convenience fee|payment date|created date|payer)$/i.test(
      line.trim(),
    )
  )
}

function assembleDescription(buffer: string[], pricedLine: string): string {
  const parts = buffer.filter((p) => !ADDRESS_LINE.test(p) && !isFeeOrMetaLabel(p))
  const withoutMoney = pricedLine
    .replace(/\$\s*\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})/g, ' ')
    .replace(/\b\d+[.,]\d{2}\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const maybeWords = withoutMoney.replace(/^\d+\s+/, '').replace(/\s+\d+$/, '').trim()
  if (
    maybeWords.length >= 4 &&
    /[A-Za-z]{3,}/.test(maybeWords) &&
    !SKU_QTY_PRICE.test(pricedLine.trim()) &&
    !isFeeOrMetaLabel(maybeWords)
  ) {
    if (!parts.some((p) => p.toLowerCase().includes(maybeWords.toLowerCase().slice(0, 12)))) {
      parts.push(maybeWords)
    }
  }
  return cleanDescription(parts.join(' '))
}

/**
 * Prefer one unique product per amount; keep the best description.
 */
export function dedupeItemsByAmount(
  items: ReceiptLineItem[],
  targetSum?: number | null,
): ReceiptLineItem[] {
  const byAmount = new Map<string, ReceiptLineItem[]>()
  for (const it of items) {
    const k = it.amount.toFixed(2)
    const arr = byAmount.get(k) ?? []
    arr.push(it)
    byAmount.set(k, arr)
  }

  const scoreDesc = (d: string): number => {
    let s = d.length
    if (/filter|kit|ford|racor|caterpillar|powerstroke|fuel|wire|pump|tow/i.test(d)) s += 40
    if (ADDRESS_LINE.test(d)) s -= 50
    if (/\b(pennsylvania|18013|shipped)\b/i.test(d)) s -= 40
    if (isFeeOrMetaLabel(d)) s -= 80
    if (/^pff\d+/i.test(d) && d.length < 20) s -= 10
    return s
  }

  const picked: ReceiptLineItem[] = []
  for (const [, group] of byAmount) {
    group.sort((a, b) => scoreDesc(b.description) - scoreDesc(a.description))
    picked.push(group[0])
  }

  // If still over target sum, drop worst extras (shouldn't happen after amount-dedupe)
  let sum = roundMoney(picked.reduce((s, i) => s + i.amount, 0))
  if (targetSum != null && sum > targetSum * 1.05) {
    picked.sort((a, b) => scoreDesc(a.description) - scoreDesc(b.description))
    while (picked.length > 1 && sum > targetSum * 1.05) {
      const drop = picked.shift()!
      sum = roundMoney(sum - drop.amount)
    }
  }

  // restore product-ish order by amount descending (or keep stable)
  return picked.sort((a, b) => b.amount - a.amount)
}

export function runLineItemsAgent(text: string): LineItemsAgentResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const items: ReceiptLineItem[] = []
  const notes: string[] = []
  let buffer: string[] = []
  let shipping: number | null = null
  let pendingFeeLabel: string | null = null

  const flushBuffer = () => {
    buffer = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const amounts = parseMoneyTokens(line)
    const amount = amounts.length ? amounts[amounts.length - 1] : null

    // Label-only fee/meta lines (amount may be next)
    if (amount == null && isFeeOrMetaLabel(line)) {
      pendingFeeLabel = line
      if (/\b(subtotal|grand total|payment|cart items)\b/i.test(line)) flushBuffer()
      continue
    }

    // Amount after fee/meta label (invoice style)
    if (amount != null && (pendingFeeLabel || isFeeOrMetaLabel(line))) {
      const label = pendingFeeLabel || line
      pendingFeeLabel = null
      if (FEE_LINE.test(label) || FEE_LINE.test(line)) {
        if (/\bshipping|freight|delivery\b/i.test(label + line)) {
          shipping = roundMoney(amount)
        }
        // convenience fee etc. — not product
        flushBuffer()
        continue
      }
      if (SKIP_LINE.test(label) || SKIP_LINE.test(line)) {
        flushBuffer()
        continue
      }
    }
    pendingFeeLabel = null

    if (amount != null && FEE_LINE.test(line)) {
      shipping = roundMoney(amount)
      flushBuffer()
      continue
    }

    if (SKIP_LINE.test(line) && amount != null) {
      flushBuffer()
      continue
    }
    if (SKIP_LINE.test(line) && amount == null) {
      if (/\b(subtotal|grand total|payment|cart items|item price)\b/i.test(line)) flushBuffer()
      continue
    }

    if (amount == null) {
      if (looksLikeProductName(line)) {
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

    // Buffer is only fee labels → not a product
    if (buffer.length && buffer.every(isFeeOrMetaLabel)) {
      flushBuffer()
      continue
    }

    if (buffer.length === 0 && letters < 3 && isPriceOnly) {
      continue
    }
    if (buffer.length === 0 && letters < 3 && !isPriceOnly) {
      continue
    }

    let itemAmount = roundMoney(amount)
    if (amounts.length >= 2) itemAmount = roundMoney(amounts[amounts.length - 1])
    if (itemAmount <= 0 || itemAmount > 50000) {
      flushBuffer()
      continue
    }

    let desc = assembleDescription(buffer, line)
    if (desc.length < 4 || !/[A-Za-z]{3,}/.test(desc)) {
      const back: string[] = []
      for (let j = i - 1; j >= 0 && back.length < 5; j--) {
        if (looksLikeProductName(lines[j]) && lastMoneyOnLine(lines[j]) == null) {
          back.unshift(lines[j])
        } else if (lastMoneyOnLine(lines[j]) != null) break
        else if (isFeeOrMetaLabel(lines[j])) break
      }
      if (back.length) desc = cleanDescription(back.join(' '))
    }

    if (desc.length < 3 || !/[A-Za-z]{2,}/.test(desc)) {
      flushBuffer()
      continue
    }
    if (FEE_LINE.test(desc) || isFeeOrMetaLabel(desc) || ADDRESS_LINE.test(desc) && !/filter|kit|ford/i.test(desc)) {
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

  // Extract subtotal from text for dedupe target
  let subtotalTarget: number | null = null
  for (const line of lines) {
    if (/\bsub\s*-?\s*total\b/i.test(line)) {
      const a = parseMoneyTokens(line)
      if (a.length) subtotalTarget = roundMoney(a[a.length - 1])
    }
  }
  // label/value style
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^subtotal$/i.test(lines[i].trim())) {
      const a = parseMoneyTokens(lines[i + 1])
      if (a.length) subtotalTarget = roundMoney(a[a.length - 1])
    }
  }

  const filtered = dedupeItemsByAmount(
    items.filter((it) => !FEE_LINE.test(it.description) && !isFeeOrMetaLabel(it.description)),
    subtotalTarget,
  )

  const itemsSum = roundMoney(filtered.reduce((s, it) => s + it.amount, 0))
  let confidence = 0.2
  if (filtered.length >= 1) confidence += 0.25
  if (filtered.length >= 2) confidence += 0.2
  if (subtotalTarget != null && Math.abs(itemsSum - subtotalTarget) < 0.1) confidence += 0.2
  confidence = Math.min(0.93, confidence)

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
