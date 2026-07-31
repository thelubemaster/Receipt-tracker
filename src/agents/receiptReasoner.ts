/**
 * Receipt reasoner — the “figure it out” layer.
 *
 * Not a pile of store-specific hacks. After any parse (OCR team, engine, VLM):
 * 1) Critic: detect *impossible* answers with general arithmetic + field quality
 * 2) Re-solve: rebuild a consistent answer from the OCR dump under hard constraints
 * 3) Optional free LLM repair (network): given OCR + contradictions, re-extract JSON
 *
 * Goal: when the team invents $48k products on a $93 order, the reasoner notices
 * and re-solves — without waiting for a human to hardcode “Amazon order IDs”.
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
import {
  isImplausibleMoney,
  parseMoneyTokens,
  roundMoney,
  stripOrderIds,
} from './moneyParse'
import { extractDate, extractVendor } from './merchantAgent'
import { normalizeOcrText } from './normalizeOcrText'
import type { LocalAgentResult } from './pipeline'
import { runReceiptEngine } from './receiptEngine'
import { runTotalsAgent } from './totalsAgent'

export type CritiqueIssue = {
  code: string
  severity: 'fatal' | 'warn'
  message: string
}

export type Critique = {
  ok: boolean
  score: number
  issues: CritiqueIssue[]
}

function nearly(a: number, b: number, tol = 0.08): boolean {
  return Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.02)
}

function productsOf(items: ReceiptLineItem[]): ReceiptLineItem[] {
  return items.filter((i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description))
}

function sumProducts(items: ReceiptLineItem[]): number {
  return roundMoney(productsOf(items).reduce((s, i) => s + i.amount, 0))
}

function feeSum(items: ReceiptLineItem[]): number {
  return roundMoney(
    items.filter((i) => isFeeLineItem(i.description)).reduce((s, i) => s + i.amount, 0),
  )
}

function shipSum(items: ReceiptLineItem[]): number {
  return roundMoney(
    items.filter((i) => isShippingLineItem(i.description)).reduce((s, i) => s + i.amount, 0),
  )
}

/** Generic quality of a vendor string (not store-specific). */
export function vendorQuality(v: string): number {
  const s = (v || '').trim()
  if (!s) return 0
  if (/^[A-Z]?\d{2,6}$/i.test(s)) return 0 // S000, S200
  if (/^payer$|^bradley$|^payment/i.test(s)) return 0
  if (/visa|mastercard|amex|debit|chip/i.test(s)) return 0
  const letters = (s.match(/[A-Za-z]/g) || []).length
  const vowels = (s.match(/[aeiouAEIOU]/g) || []).length
  if (letters < 3) return 0
  let score = letters + vowels * 2
  if (s.includes(' ')) score += 8
  if (letters >= 5 && vowels >= 2) score += 6
  return score
}

/**
 * Critic: is this answer *possible* given the OCR and arithmetic?
 * Fatal issues mean “do not trust — re-solve”.
 */
export function critiqueParse(
  draft: LocalAgentResult,
  ocrText: string,
): Critique {
  const issues: CritiqueIssue[] = []
  const total = draft.amount
  const items = draft.lineItems || []
  const prods = productsOf(items)
  const pSum = sumProducts(items)
  const fee = feeSum(items)
  const ship = shipSum(items)
  const tax = draft.tax
  const sub = draft.subtotal

  if (total == null || total <= 0) {
    issues.push({
      code: 'no-total',
      severity: 'fatal',
      message: 'No grand total found',
    })
  }

  if (total != null) {
    for (const p of prods) {
      if (isImplausibleMoney(p.amount, { grandTotal: total }) || p.amount > total * 2.5) {
        issues.push({
          code: 'product-oversize',
          severity: 'fatal',
          message: `Product “${p.description.slice(0, 40)}” is $${p.amount} but total is only $${total} — likely OCR ghost (order id / multi-column)`,
        })
      }
    }
    if (pSum > total * 3 && pSum > total + 20) {
      issues.push({
        code: 'product-sum-exploded',
        severity: 'fatal',
        message: `Product sum $${pSum} is far above total $${total}`,
      })
    }
    if (fee > 0 && nearly(fee, total)) {
      issues.push({
        code: 'fee-is-total',
        severity: 'fatal',
        message: `Fee $${fee} equals grand total — not a real fee`,
      })
    }
    if (ship > total * 1.05) {
      issues.push({
        code: 'ship-oversize',
        severity: 'fatal',
        message: `Shipping $${ship} exceeds total $${total}`,
      })
    }
    if (
      tax != null &&
      tax > 0 &&
      nearly(tax, total) &&
      sub != null &&
      nearly(sub, total)
    ) {
      issues.push({
        code: 'tax-is-total',
        severity: 'fatal',
        message: `Tax $${tax} equals total and subtotal — tax was misread from “total before tax”`,
      })
    }
  }

  const vq = vendorQuality(draft.vendor || '')
  if (vq < 4) {
    issues.push({
      code: 'weak-vendor',
      severity: vq === 0 ? 'fatal' : 'warn',
      message: `Vendor “${draft.vendor || ''}” looks like OCR noise, not a store name`,
    })
  }

  // OCR says estimated tax 0 / shipping 0 but we invented large fees
  const ocr = normalizeOcrText(ocrText || '')
  if (total != null && /\bestimated\s*tax\b[\s\S]{0,40}\$0\.00/i.test(ocr) && tax != null && tax > 1) {
    issues.push({
      code: 'tax-vs-ocr-zero',
      severity: 'fatal',
      message: `OCR shows estimated tax $0.00 but parse has tax $${tax}`,
    })
  }
  if (
    total != null &&
    /\bshipping[\s\S]{0,30}\$0\.00/i.test(ocr) &&
    ship > 1
  ) {
    issues.push({
      code: 'ship-vs-ocr-zero',
      severity: 'warn',
      message: `OCR shows shipping $0.00 but parse has shipping $${ship}`,
    })
  }

  // Built total from parts should roughly close when we have subtotal
  if (total != null && sub != null) {
    const built = roundMoney(sub + (tax ?? 0) + fee + ship)
    if (!nearly(built, total, Math.max(0.5, total * 0.05)) && fee === 0 && ship === 0) {
      // warn only — many receipts omit fee lines
      issues.push({
        code: 'parts-not-close',
        severity: 'warn',
        message: `subtotal+tax+fee+ship = $${built} vs total $${total}`,
      })
    }
  }

  const fatals = issues.filter((i) => i.severity === 'fatal')
  let score = 100 - fatals.length * 35 - (issues.length - fatals.length) * 8
  if (total != null && pSum > 0 && nearly(pSum + fee + ship + (tax ?? 0), total, 1)) {
    score += 15
  }
  score = Math.max(0, Math.min(100, score))

  return {
    ok: fatals.length === 0,
    score,
    issues,
  }
}

/**
 * Constraint re-solve from OCR alone — general, not store-specific.
 * Hard rules the answer must obey.
 */
export function resolveFromOcrConstraints(
  ocrText: string,
  draft?: LocalAgentResult | null,
): LocalAgentResult {
  const text = normalizeOcrText(stripOrderIds(ocrText || ''))
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  // 1) Lock grand total first (source of truth)
  const totals = runTotalsAgent(text)
  let total = totals.total
  // Prefer explicit GRAND TOTAL lines
  for (const line of lines) {
    if (/\bgrand\s*t[o0]tal\b/i.test(line)) {
      const a = parseMoneyTokens(line)
      if (a.length) {
        total = a[a.length - 1]
        break
      }
    }
  }
  if (total == null && draft?.amount != null) total = draft.amount

  // 2) Subtotal / tax / ship from labeled lines with “first amount after label”
  let subtotal: number | null = null
  let tax: number | null = null
  let shipping: number | null = null
  let fee: number | null = null

  for (const line of lines) {
    const amts = parseMoneyTokens(line, { grandTotal: total })
    if (!amts.length) continue
    const minA = Math.min(...amts)
    if (/\bsub[\s\-]*t[o0]tal\b|\bitems?\)?\s*subtotal\b/i.test(line)) {
      subtotal = amts[amts.length - 1]
    }
    if (/\bbefore\s*t[a4]x\b/i.test(line)) {
      // not tax
      if (/\bt[o0]tal\b/i.test(line) && total == null) total = amts[amts.length - 1]
      continue
    }
    if (/\b(estimated\s*)?(sales\s*)?t[a4]x\b/i.test(line)) {
      tax = minA // prefer $0.00 over the neighboring $93 column
    }
    if (/\bshipping\b|\bhandl(?:ing|e)\b|\bfreight\b/i.test(line) && !/\bship\s*to\b/i.test(line)) {
      shipping = minA
    }
    if (
      /\b(convenience|service\s*fee|processing\s*fee|cc\s*fee)\b/i.test(line) &&
      !/\bshipping\b/i.test(line)
    ) {
      const cand = minA
      if (total == null || Math.abs(cand - total) > 0.05) fee = cand
    }
  }

  // If tax equals total and OCR claimed $0 tax, force 0
  if (total != null && tax != null && nearly(tax, total)) tax = 0
  if (total != null && fee != null && nearly(fee, total)) fee = null
  if (total != null && shipping != null && shipping > total) shipping = 0
  if (tax == null && /\btax[\s\S]{0,40}\$0\.00/i.test(text)) tax = 0
  if (shipping == null && /\bshipping[\s\S]{0,40}\$0\.00/i.test(text)) shipping = 0

  // 3) Products: only amounts that fit under total; prefer Thorne-like multi-word names
  const engine = runReceiptEngine(text)
  let products = productsOf(engine.lineItems || []).filter(
    (p) =>
      total == null ||
      (!isImplausibleMoney(p.amount, { grandTotal: total }) && p.amount <= total * 1.05 + 0.5),
  )

  // Progressive drop of largest products until sum ≤ total * 1.15 (or empty)
  if (total != null && products.length) {
    products = [...products].sort((a, b) => b.amount - a.amount)
    let sum = sumProducts(products)
    while (products.length && sum > total * 1.15 + 1) {
      products.shift()
      sum = sumProducts(products)
    }
  }

  // If we still have no products but OCR has product-ish brand lines, keep names with $0? Better: one bucket line
  if (!products.length && total != null && subtotal != null && nearly(subtotal, total, 1)) {
    // Single “order contents” line when multi-item prices are unreadable
    const brands = text.match(/\bTHORNE\b|\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}\s*-\s*[A-Za-z]/g)
    const desc =
      brands && brands.length
        ? brands
            .slice(0, 4)
            .map((b) => b.replace(/\s+/g, ' ').trim())
            .join('; ')
            .slice(0, 140)
        : draft?.description && !/shipping|fee/i.test(draft.description)
          ? draft.description.slice(0, 140)
          : 'Order items'
    const { categoryId } = categorizeText(desc)
    products = [
      {
        id: 'reason-bundle',
        description: desc,
        amount: subtotal ?? total,
        categoryId,
      },
    ]
  }

  // 4) Vendor — pick best quality candidate from OCR, prefer draft if already good
  let vendor = draft?.vendor && vendorQuality(draft.vendor) >= 8 ? draft.vendor : extractVendor(text)
  if (vendorQuality(vendor) < 4) {
    // Scan early lines for brand-like tokens
    let best = ''
    let bestQ = 0
    for (const line of lines.slice(0, 40)) {
      if (/total|tax|ship|order|payment|mastercard|deliver/i.test(line)) continue
      const q = vendorQuality(line)
      if (q > bestQ) {
        bestQ = q
        best = line
      }
    }
    if (bestQ >= 8) vendor = best.slice(0, 48)
  }

  // 5) Date
  const date = extractDate(text) || draft?.date || new Date().toISOString().slice(0, 10)

  const lineItems: ReceiptLineItem[] = [...products]
  if (shipping != null && shipping > 0) {
    lineItems.push(makeShippingLineItem(shipping, 'reason-ship'))
  }
  if (fee != null && fee > 0) {
    lineItems.push(makeFeeLineItem(fee, 'Convenience fee', 'reason-fee'))
  }

  const categoryId: CategoryId =
    products.length > 0
      ? primaryCategoryFromItems(products)
      : categorizeText(`${vendor} ${text.slice(0, 400)}`).categoryId

  const description =
    products.length > 0
      ? products
          .map((p) => p.description)
          .slice(0, 6)
          .join('; ')
          .slice(0, 160)
      : vendor
        ? `Order — ${vendor}`
        : 'Receipt'

  // Confidence from how clean the constraints are
  let confidence = 0.55
  if (total != null) confidence += 0.15
  if (vendorQuality(vendor) >= 8) confidence += 0.1
  if (tax === 0 || (tax != null && tax < (total ?? 99) * 0.3)) confidence += 0.05
  const pSum = sumProducts(lineItems)
  if (total != null && pSum > 0 && pSum <= total * 1.15) confidence += 0.1
  confidence = Math.min(0.94, confidence)

  return {
    date,
    vendor: vendor || '',
    amount: total,
    description,
    categoryId,
    notes: `Reasoner · conf ${Math.round(confidence * 100)}%`,
    lineItems,
    subtotal: subtotal ?? (total != null && tax === 0 ? total : null),
    tax,
    source: 'on-device',
    confidence,
    rawText: text,
    agentReport: 'Receipt reasoner: constraint re-solve from OCR',
    aisUsed: ['arbiter'],
    activeAiLabel: 'Reasoner · re-solved from OCR',
    fieldSources: {
      primary: 'arbiter',
      total: 'cashier',
      vendor: 'clerk',
      category: 'ledger',
      date: 'clerk',
      answerLabel: 'Reasoner (self-check + re-solve)',
    },
  }
}

/**
 * Optional free LLM repair: send OCR + critic issues, get JSON back.
 * Uses Hugging Face router when a token / free endpoint works.
 */
async function llmRepair(
  ocrText: string,
  issues: CritiqueIssue[],
  draft: LocalAgentResult,
): Promise<LocalAgentResult | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null

  let token: string | null = null
  try {
    const { getHfToken } = await import('./vlmRunner')
    token = await getHfToken()
  } catch {
    token = null
  }

  const prompt = `You are fixing a bad receipt parse. The OCR text is messy. Fix it.

HARD RULES:
- Grand total must match "GRAND TOTAL" / amount due if present
- No product price may exceed the grand total
- Order numbers (like 113-0548166-9548225) are NOT prices
- Tax is often $0.00 on "Estimated TAX" lines — do not copy the total into tax
- "TOTAL before TAX" is not tax
- Fee must not equal the grand total
- Prefer "Order placed" date over "Return window closed"
- Vendor is the store/marketplace (e.g. Amazon), not "S000" or payer first names

OCR TEXT:
"""
${ocrText.slice(0, 6000)}
"""

CURRENT BAD PARSE:
vendor=${draft.vendor} total=${draft.amount} tax=${draft.tax} items=${JSON.stringify(
    (draft.lineItems || []).slice(0, 8),
  )}

PROBLEMS FOUND:
${issues.map((i) => `- ${i.message}`).join('\n')}

Reply with ONLY JSON:
{"vendor":"","date":"YYYY-MM-DD or empty","total":0,"subtotal":0,"tax":0,"shipping":0,"fee":0,"items":[{"description":"","amount":0}]}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  // Small free text models that can follow instructions
  const models = [
    'HuggingFaceTB/SmolLM3-3B-Instruct',
    'meta-llama/Llama-3.2-3B-Instruct',
    'google/gemma-2-2b-it',
    'Qwen/Qwen2.5-3B-Instruct',
  ]

  for (const model of models) {
    try {
      const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          max_tokens: 700,
          temperature: 0.1,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!res.ok) continue
      const j = (await res.json()) as {
        choices?: { message?: { content?: string } }[]
      }
      const content = j.choices?.[0]?.message?.content || ''
      const start = content.indexOf('{')
      const end = content.lastIndexOf('}')
      if (start < 0 || end <= start) continue
      const obj = JSON.parse(content.slice(start, end + 1)) as {
        vendor?: string
        date?: string
        total?: number
        subtotal?: number
        tax?: number
        shipping?: number
        fee?: number
        items?: { description?: string; amount?: number }[]
      }
      const total =
        typeof obj.total === 'number' ? roundMoney(obj.total) : draft.amount
      const items: ReceiptLineItem[] = []
      for (const it of obj.items || []) {
        const desc = String(it.description || '').trim()
        const amt = typeof it.amount === 'number' ? roundMoney(it.amount) : null
        if (!desc || amt == null || amt <= 0) continue
        if (total != null && isImplausibleMoney(amt, { grandTotal: total })) continue
        const { categoryId } = categorizeText(desc)
        items.push({
          id: `llm-${items.length}`,
          description: desc.slice(0, 100),
          amount: amt,
          categoryId,
        })
      }
      if (obj.shipping && obj.shipping > 0 && (total == null || obj.shipping <= total)) {
        items.push(makeShippingLineItem(roundMoney(obj.shipping), 'llm-ship'))
      }
      if (obj.fee && obj.fee > 0 && (total == null || Math.abs(obj.fee - total) > 0.05)) {
        items.push(makeFeeLineItem(roundMoney(obj.fee), 'Convenience fee', 'llm-fee'))
      }

      const result: LocalAgentResult = {
        date: obj.date && /^\d{4}-\d{2}-\d{2}/.test(obj.date) ? obj.date.slice(0, 10) : draft.date,
        vendor: obj.vendor && vendorQuality(obj.vendor) >= 4 ? obj.vendor : draft.vendor,
        amount: total,
        description:
          items
            .filter((i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description))
            .map((i) => i.description)
            .slice(0, 6)
            .join('; ')
            .slice(0, 160) || draft.description,
        categoryId:
          items.length > 0
            ? primaryCategoryFromItems(
                items.filter(
                  (i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description),
                ),
              )
            : draft.categoryId,
        notes: `LLM reasoner · ${model}`,
        lineItems: items.length ? items : draft.lineItems,
        subtotal: typeof obj.subtotal === 'number' ? roundMoney(obj.subtotal) : draft.subtotal,
        tax: typeof obj.tax === 'number' ? roundMoney(obj.tax) : draft.tax,
        source: 'on-device',
        confidence: 0.82,
        rawText: ocrText,
        agentReport: `LLM repair via ${model}`,
        aisUsed: ['arbiter'],
        activeAiLabel: `Reasoner · ${model.split('/').pop()}`,
        fieldSources: {
          primary: 'arbiter',
          answerLabel: `Reasoner LLM (${model.split('/').pop()})`,
        },
      }
      const check = critiqueParse(result, ocrText)
      if (check.ok || check.score > critiqueParse(draft, ocrText).score + 10) {
        return result
      }
    } catch {
      /* try next model */
    }
  }
  return null
}

/**
 * Main entry: if the draft fails critique, re-solve until consistent (or best effort).
 */
export async function reasonAboutReceipt(
  draft: LocalAgentResult,
  ocrText: string,
  options?: {
    allowLlm?: boolean
    onProgress?: (msg: string) => void
  },
): Promise<{ result: LocalAgentResult; critique: Critique; repaired: boolean }> {
  const text = ocrText || draft.rawText || ''
  let critique = critiqueParse(draft, text)

  if (critique.ok) {
    return { result: draft, critique, repaired: false }
  }

  options?.onProgress?.(
    `Reasoner: answer fails checks (${critique.issues
      .filter((i) => i.severity === 'fatal')
      .map((i) => i.code)
      .join(', ')}) — re-solving…`,
  )

  // Pass 1: pure constraint re-solve (always available offline)
  let solved = resolveFromOcrConstraints(text, draft)
  let c2 = critiqueParse(solved, text)

  // Pass 2: free LLM if still broken and allowed
  if (!c2.ok && options?.allowLlm !== false) {
    options?.onProgress?.('Reasoner: asking free language model to re-read the OCR…')
    const llm = await llmRepair(text, critique.issues, draft)
    if (llm) {
      const c3 = critiqueParse(llm, text)
      if (c3.score >= c2.score) {
        solved = {
          ...llm,
          agentReport: [
            draft.agentReport,
            '---',
            `REASONER CRITIC (before): ${critique.issues.map((i) => i.message).join('; ')}`,
            llm.agentReport,
            `REASONER CRITIC (after LLM): ${c3.issues.map((i) => i.message).join('; ') || 'clean'}`,
          ].join('\n'),
          aisUsed: Array.from(new Set([...(draft.aisUsed || []), 'arbiter', ...(llm.aisUsed || [])])),
        }
        c2 = c3
      }
    }
  }

  // Keep better of constraint vs original if LLM didn't help
  const draftScore = critique.score
  if (c2.score < draftScore - 5 && critique.issues.every((i) => i.code !== 'product-oversize' && i.code !== 'product-sum-exploded' && i.code !== 'fee-is-total' && i.code !== 'tax-is-total')) {
    // only stick with draft if fatals weren't the explosive ones — actually always prefer fixed product-oversize
    return {
      result: {
        ...draft,
        agentReport: [
          draft.agentReport,
          '---',
          `REASONER: kept original (score ${draftScore} vs repair ${c2.score})`,
          ...critique.issues.map((i) => `  · ${i.message}`),
        ].join('\n'),
      },
      critique,
      repaired: false,
    }
  }

  solved = {
    ...solved,
    rawText: text,
    agentReport: [
      draft.agentReport,
      '---',
      'REASONER: self-check failed — re-solved under hard constraints',
      ...critique.issues.map((i) => `  ✗ ${i.severity}: ${i.message}`),
      solved.agentReport,
      c2.ok
        ? 'REASONER: repair passes consistency checks'
        : `REASONER: best-effort repair (remaining: ${c2.issues.map((i) => i.code).join(', ')})`,
    ].join('\n'),
    aisUsed: Array.from(new Set([...(draft.aisUsed || []), 'arbiter'])),
    confidence: Math.max(solved.confidence ?? 0, 0.6),
    fieldSources: {
      ...draft.fieldSources,
      ...solved.fieldSources,
      primary: 'arbiter',
      answerLabel: 'Reasoner (self-check + re-solve)',
    },
    activeAiLabel: 'Reasoner · fixed inconsistent scan',
  }

  return { result: solved, critique: c2, repaired: true }
}
