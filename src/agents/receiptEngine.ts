/**
 * Receipt / invoice structured engine — primary parse path.
 *
 * Deterministic, arithmetic-first. Not a “team chat” layer.
 * Input: clean lines (from layout PDF or normalized OCR).
 * Output: vendor, date, totals, line items that reconcile when possible.
 */
import type { CategoryId, ReceiptLineItem } from '../types'
import { categorizeText } from './keywords'
import {
  isFeeLineItem,
  isShippingLineItem,
  makeFeeLineItem,
  makeShippingLineItem,
  primaryCategoryFromItems,
} from './lineItemsAgent'
import { materializeLines, type LayoutLine } from './layoutText'
import { parseMoneyTokens, roundMoney } from './moneyParse'
import { normalizeOcrText } from './normalizeOcrText'
import { extractDate, extractVendor } from './merchantAgent'
import type { LocalAgentResult } from './pipeline'

export type EngineBan = {
  amounts?: number[]
  vendors?: string[]
  /** Prefer alternate strategies when set */
  forceAlternateTotal?: boolean
}

export type EngineOptions = {
  ban?: EngineBan
  /** Prefer this total if math allows (user marked total correct) */
  preferTotal?: number | null
  preferVendor?: string | null
}

function nearly(a: number, b: number, tol = 0.06): boolean {
  return Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.015)
}

function bannedAmount(n: number, ban?: EngineBan): boolean {
  if (!ban?.amounts?.length) return false
  return ban.amounts.some((b) => nearly(b, n, 0.03))
}

function bannedVendor(v: string, ban?: EngineBan): boolean {
  if (!ban?.vendors?.length || !v) return false
  const a = v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return ban.vendors.some((b) => {
    const x = b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    return x && (a === x || a.includes(x) || x.includes(a))
  })
}

const SKIP =
  /\b(sub[\s\-]*total|grand\s*total|total|tax|sales\s*tax|vat|gst|hst|amount\s*due|balance\s*due|cash|change|visa|mastercard|amex|debit|credit|auth|approval|tender|thank|invoice\s*#|invoice\s*number|order\s*#|po\s*#|page\s+\d|tel|phone|www\.|http|https|qty|quantity|description|unit\s*price|extended|item\s*total|due\s*date|bill\s*to|ship\s*to|remit|account|items?\s*shipped|shipped\s*to|sold\s*to|payer|payment\s*method|payment\s*date|created\s*date)\b/i

const SHIP = /\b(shipping|freight|delivery|postage)\b/i
const FEE =
  /\b(convenience|service\s*fee|processing|handling|surcharge|cc\s*fee|card\s*fee)\b/i

const ADDRESS =
  /\b(shipped\s*to|sold\s*to|bill\s*to|street| st\b| rd\b| road|ave|avenue|drive| blvd|zip|pennsylvania|united\s*states|\b[A-Z]{2}\s+\d{5}\b|\b\d{5}(?:-\d{4})?\b)\b/i

type LabeledMoney = {
  kind: 'total' | 'subtotal' | 'tax' | 'shipping' | 'fee' | 'other'
  amount: number
  line: string
  weight: number
  index: number
}

function classifyLabel(line: string): LabeledMoney['kind'] | null {
  if (/\bsub[\s\-]*t[o0]tal\b/i.test(line)) return 'subtotal'
  if (/\b(sales\s*)?tax\b|\bvat\b|\bgst\b|\bhst\b/i.test(line) && !/\bpre-?tax\b/i.test(line))
    return 'tax'
  if (SHIP.test(line) && !/\bship\s*to\b/i.test(line)) return 'shipping'
  if (FEE.test(line)) return 'fee'
  if (/\bgrand\s*t[o0]tal\b|\bamount\s*due\b|\bbalance\s*due\b/i.test(line)) return 'total'
  if (/\bt[o0]tal\b/i.test(line) && !/\bsub\b/i.test(line) && !/\bitem\s*total\b/i.test(line))
    return 'total'
  return null
}

function harvestLabeledMoney(lines: string[], ban?: EngineBan): LabeledMoney[] {
  const out: LabeledMoney[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1] || ''
    const kind = classifyLabel(line) || (classifyLabel(`${line} ${next}`) as LabeledMoney['kind'] | null)
    if (!kind) continue
    let amounts = parseMoneyTokens(line)
    if (!amounts.length) amounts = parseMoneyTokens(next)
    if (!amounts.length) continue
    // Prefer last money on line (running totals print earlier amounts first)
    const amount = roundMoney(amounts[amounts.length - 1])
    if (amount <= 0 || amount >= 100000) continue
    if (bannedAmount(amount, ban) && kind === 'total') continue

    let weight = 5
    if (kind === 'total') {
      if (/\bgrand\b|\bamount\s*due\b|\bbalance\s*due\b/i.test(line)) weight = 14
      else weight = 12
      // Totals near the bottom of the document are more trustworthy
      weight += Math.min(4, Math.floor((i / Math.max(1, lines.length)) * 4))
    } else if (kind === 'subtotal') weight = 10
    else if (kind === 'tax') weight = 9
    else if (kind === 'fee') weight = 8
    else if (kind === 'shipping') weight = 8

    out.push({ kind, amount, line, weight, index: i })
  }
  return out
}

function pickBest(
  items: LabeledMoney[],
  kind: LabeledMoney['kind'],
  ban?: EngineBan,
): number | null {
  const cands = items
    .filter((x) => x.kind === kind)
    .filter((x) => !(kind === 'total' && bannedAmount(x.amount, ban)))
    .sort((a, b) => b.weight - a.weight || b.index - a.index)
  return cands[0]?.amount ?? null
}

/**
 * Product rows: description + amount, excluding totals/fees/shipping labels.
 */
function extractProducts(lines: string[], ban?: EngineBan): ReceiptLineItem[] {
  const items: ReceiptLineItem[] = []
  let buffer: string[] = []

  const isProductish = (line: string) => {
    if (!line || line.length < 2) return false
    if (ADDRESS.test(line) && !/filter|kit|ford|pump|wire|oil|foam|part|stud/i.test(line))
      return false
    if (SKIP.test(line) && !/filter|kit|part|pump|wire|oil|foam|tow|stud|piston/i.test(line))
      return false
    if (SHIP.test(line) || FEE.test(line)) return false
    if (/^[\d\W]+$/.test(line)) return false
    if (!/[A-Za-z]{2,}/.test(line)) return false
    if (line.length > 90) return false
    // Pure address / city lines
    if (/^\d+\s+\w+.*(rd|st|ave|dr|ln)\b/i.test(line)) return false
    return true
  }

  const cleanDesc = (raw: string) =>
    raw
      .replace(/\$\s*\d{1,5}(?:[.,]\d{3})*(?:[.,]\d{2})/g, ' ')
      .replace(/\b\d+[.,]\d{2}\b/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 100)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const amounts = parseMoneyTokens(line)
    const amount = amounts.length ? roundMoney(amounts[amounts.length - 1]) : null

    // Pure label rows for totals — reset buffer
    if (amount == null) {
      if (classifyLabel(line) || SKIP.test(line)) {
        if (/\b(subtotal|total|tax|payment|amount due)\b/i.test(line)) buffer = []
        continue
      }
      if (isProductish(line)) {
        if (buffer.length < 5) buffer.push(line)
        else {
          buffer.shift()
          buffer.push(line)
        }
      }
      continue
    }

    // Skip total/tax/fee/shipping priced rows as products
    if (classifyLabel(line) || SHIP.test(line) || FEE.test(line)) {
      buffer = []
      continue
    }
    if (SKIP.test(line) && !isProductish(cleanDesc(line))) {
      buffer = []
      continue
    }

    if (amount <= 0 || amount > 50000) {
      buffer = []
      continue
    }
    if (bannedAmount(amount, ban)) {
      // still allow product with different interpretation later
    }

    let desc = cleanDesc([...buffer, line].join(' '))
    if (desc.length < 3 || !/[A-Za-z]{2,}/.test(desc)) {
      // look back for description-only lines
      const back: string[] = []
      for (let j = i - 1; j >= 0 && back.length < 4; j--) {
        if (parseMoneyTokens(lines[j]).length) break
        if (isProductish(lines[j])) back.unshift(lines[j])
        else if (SKIP.test(lines[j])) break
      }
      desc = cleanDesc(back.join(' '))
    }

    if (desc.length < 3 || !/[A-Za-z]{2,}/.test(desc)) {
      buffer = []
      continue
    }
    if (SHIP.test(desc) || FEE.test(desc) || SKIP.test(desc)) {
      buffer = []
      continue
    }
    if (ADDRESS.test(desc) && !/filter|kit|ford|pump|wire|oil|foam|part|stud|piston|tow/i.test(desc)) {
      buffer = []
      continue
    }
    // Description that is mostly an address + a product fragment — strip address head
    if (/\bshipped to\b/i.test(desc)) {
      desc = desc.replace(/^.*?\b(us|usa)\b\s*/i, '').trim()
      if (desc.length < 6) {
        buffer = []
        continue
      }
    }

    const { categoryId } = categorizeText(desc)
    items.push({
      id: `eng-${items.length}-${i}`,
      description: desc,
      amount,
      categoryId,
    })
    buffer = []
  }

  // Dedupe identical amount+similar desc
  const seen = new Set<string>()
  const deduped: ReceiptLineItem[] = []
  for (const it of items) {
    const k = `${it.amount.toFixed(2)}|${it.description.toLowerCase().slice(0, 24)}`
    if (seen.has(k)) continue
    seen.add(k)
    deduped.push(it)
  }
  return deduped
}

function reconcile(input: {
  total: number | null
  subtotal: number | null
  tax: number | null
  shipping: number | null
  fee: number | null
  products: ReceiptLineItem[]
  ban?: EngineBan
}): {
  total: number | null
  subtotal: number | null
  tax: number | null
  shipping: number | null
  fee: number | null
  products: ReceiptLineItem[]
  notes: string[]
  confidence: number
} {
  const notes: string[] = []
  let { total, subtotal, tax, shipping, fee } = input
  let products = [...input.products]
  const pSum = () =>
    roundMoney(products.reduce((s, i) => s + i.amount, 0))

  // Drop product rows that equal the grand total when we already have a total
  // (common OCR: "TOTAL 134.19" also scraped as a product)
  if (total != null) {
    const before = products.length
    products = products.filter((i) => !nearly(i.amount, total!))
    if (products.length < before) notes.push('Engine: dropped product row that cloned grand total')
  }

  // If products sum to subtotal, great
  if (subtotal != null && products.length && nearly(pSum(), subtotal)) {
    notes.push('Engine: products sum matches subtotal')
  }

  // Implied fee: total − subtotal − tax − ship
  if (total != null && subtotal != null) {
    const implied = roundMoney(total - subtotal - (tax ?? 0) - (shipping ?? 0))
    if (implied > 0.2 && implied < subtotal * 0.35 && fee == null) {
      fee = implied
      notes.push(`Engine: implied fee $${fee.toFixed(2)} from total−subtotal−tax−ship`)
    }
  }

  // If no total but we have subtotal+tax(+fee+ship)
  if (total == null && subtotal != null) {
    total = roundMoney(subtotal + (tax ?? 0) + (fee ?? 0) + (shipping ?? 0))
    notes.push(`Engine: total = subtotal+tax+fee+ship → $${total.toFixed(2)}`)
  }

  // If total banned, try reconstruct from parts
  if (total != null && bannedAmount(total, input.ban)) {
    if (subtotal != null) {
      const alt = roundMoney(subtotal + (tax ?? 0) + (fee ?? 0) + (shipping ?? 0))
      if (!bannedAmount(alt, input.ban) && alt > 0) {
        notes.push(`Engine: banned total avoided → using reconstructed $${alt.toFixed(2)}`)
        total = alt
      } else {
        total = null
        notes.push('Engine: banned total cleared pending alternate')
      }
    } else {
      total = null
    }
  }

  // If products + extras close the total, boost confidence
  let conf = 0.45
  if (total != null) conf += 0.15
  if (subtotal != null) conf += 0.08
  if (tax != null) conf += 0.05
  if (products.length >= 1) conf += 0.1
  if (total != null && subtotal != null && tax != null) {
    const built = roundMoney(subtotal + tax + (fee ?? 0) + (shipping ?? 0))
    if (nearly(built, total)) {
      conf += 0.2
      notes.push('Engine: arithmetic lock (subtotal+tax+fee+ship = total)')
    }
  }
  if (total != null && products.length) {
    const built = roundMoney(pSum() + (tax ?? 0) + (fee ?? 0) + (shipping ?? 0))
    if (nearly(built, total, 0.15)) {
      conf += 0.12
      notes.push('Engine: products+tax+fee+ship ≈ total')
    }
  }

  return {
    total,
    subtotal,
    tax,
    shipping,
    fee,
    products,
    notes,
    confidence: Math.min(0.97, conf),
  }
}

/**
 * Main entry — structured receipt/invoice parse.
 */
export function runReceiptEngine(
  rawText: string,
  options: EngineOptions & { layoutLines?: LayoutLine[] | null } = {},
): LocalAgentResult {
  const text = normalizeOcrText(rawText || '')
  const lines = materializeLines(text, options.layoutLines)
  const ban = options.ban

  const labeled = harvestLabeledMoney(lines, ban)
  let total = options.preferTotal ?? pickBest(labeled, 'total', ban)
  let subtotal = pickBest(labeled, 'subtotal', ban)
  let tax = pickBest(labeled, 'tax', ban)
  let shipping = pickBest(labeled, 'shipping', ban)
  let fee = pickBest(labeled, 'fee', ban)

  // Force alternate total: pick 2nd-best total candidate or reconstruct
  if (ban?.forceAlternateTotal || (total != null && bannedAmount(total, ban))) {
    const totals = labeled
      .filter((x) => x.kind === 'total' && !bannedAmount(x.amount, ban))
      .sort((a, b) => b.weight - a.weight || b.index - a.index)
    if (totals[0] && (total == null || !nearly(totals[0].amount, total))) {
      total = totals[0].amount
    } else if (totals[1]) {
      total = totals[1].amount
    } else if (subtotal != null) {
      total = roundMoney(subtotal + (tax ?? 0) + (fee ?? 0) + (shipping ?? 0))
    }
  }

  let products = extractProducts(lines, ban)

  const rec = reconcile({
    total,
    subtotal,
    tax,
    shipping,
    fee,
    products,
    ban,
  })
  total = rec.total
  subtotal = rec.subtotal
  tax = rec.tax
  shipping = rec.shipping
  fee = rec.fee
  products = rec.products

  // Prefer user-locked total if provided and not conflicting with ban
  if (
    options.preferTotal != null &&
    !bannedAmount(options.preferTotal, ban) &&
    (total == null || nearly(total, options.preferTotal) || (rec.confidence < 0.7))
  ) {
    total = options.preferTotal
  }

  const lineItems: ReceiptLineItem[] = [...products]
  if (shipping != null && shipping > 0) {
    lineItems.push(makeShippingLineItem(shipping, 'eng-ship'))
  }
  if (fee != null && fee > 0) {
    lineItems.push(makeFeeLineItem(fee, 'Convenience fee', 'eng-fee'))
  }

  let vendor =
    options.preferVendor && !bannedVendor(options.preferVendor, ban)
      ? options.preferVendor
      : extractVendor(text)
  if (bannedVendor(vendor, ban)) {
    // Try again from top lines only (header)
    const header = lines.slice(0, 12).join('\n')
    const v2 = extractVendor(header)
    vendor = bannedVendor(v2, ban) ? '' : v2
  }

  const date = extractDate(text)
  const categoryId: CategoryId =
    lineItems.length > 0
      ? primaryCategoryFromItems(lineItems.filter((i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description)))
      : categorizeText(text).categoryId

  const description =
    products.length > 0
      ? products
          .map((p) => p.description)
          .slice(0, 8)
          .join('; ')
          .slice(0, 160)
      : vendor
        ? `Invoice — ${vendor}`
        : 'Invoice / receipt'

  let confidence = rec.confidence
  if (vendor) confidence += 0.05
  if (date) confidence += 0.03
  if (bannedVendor(vendor, ban)) {
    vendor = ''
    confidence -= 0.1
  }
  confidence = Math.max(0.2, Math.min(0.98, confidence))

  const itemsSum = roundMoney(lineItems.reduce((s, i) => s + i.amount, 0))

  return {
    date: date || new Date().toISOString().slice(0, 10),
    vendor: vendor || '',
    amount: total,
    description,
    categoryId,
    notes: `Engine · conf ${Math.round(confidence * 100)}%`,
    lineItems,
    subtotal,
    tax,
    source: 'on-device',
    confidence,
    rawText: text,
    agentReport: [
      'Receipt engine (structured, arithmetic-first).',
      ...rec.notes,
      `Lines: ${lines.length} · products: ${products.length} · labeled money hits: ${labeled.length}`,
      total != null ? `Total $${total.toFixed(2)}` : 'Total unknown',
      subtotal != null ? `Subtotal $${subtotal.toFixed(2)}` : null,
      tax != null ? `Tax $${tax.toFixed(2)}` : null,
      fee != null ? `Fee $${fee.toFixed(2)}` : null,
      shipping != null ? `Ship $${shipping.toFixed(2)}` : null,
      `Items sum $${itemsSum.toFixed(2)}`,
      vendor ? `Vendor: ${vendor}` : 'Vendor unknown',
    ]
      .filter(Boolean)
      .join('\n'),
    aisUsed: ['ledger', 'cashier', 'clerk', 'arbiter'],
    activeAiLabel: 'Receipt engine',
    fieldSources: {
      primary: 'arbiter',
      total: 'cashier',
      vendor: 'clerk',
      category: 'ledger',
      date: 'clerk',
      answerLabel: 'Receipt engine (structured)',
    },
  }
}

/** Build ban list from a rejected snapshot (✗ marks or full reject). */
export function banFromRejected(rejected: {
  amount?: number | null
  vendor?: string
  marks?: {
    total?: string
    vendor?: string
  } | null
}): EngineBan {
  const ban: EngineBan = { amounts: [], vendors: [], forceAlternateTotal: false }
  const marks = rejected.marks
  const anyMarks =
    !!marks &&
    Object.values(marks).some((v) => v === 'wrong' || v === 'right' || (v && typeof v === 'object'))

  // Full retry (no marks) or total explicitly wrong → ban that total
  if (!anyMarks || marks?.total === 'wrong') {
    if (rejected.amount != null) ban.amounts!.push(rejected.amount)
    ban.forceAlternateTotal = true
  }
  if (!anyMarks || marks?.vendor === 'wrong') {
    if (rejected.vendor) ban.vendors!.push(rejected.vendor)
  }
  return ban
}
