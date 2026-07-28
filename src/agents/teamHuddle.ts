/**
 * Team Huddle — free on-device multi-agent conversation.
 *
 * Every enabled AI posts on a shared blackboard, reads the others,
 * challenges gaps, and converges on one answer together.
 * No API keys. Runs entirely on the phone (optional Seeker web is separate).
 */
import type { AiId } from '../aiRoster'
import type { CategoryId, ReceiptLineItem } from '../types'
import { Blackboard } from './blackboard'
import { categorizeText } from './keywords'
import {
  dedupeItemsByAmount,
  isFeeLineItem,
  isShippingLineItem,
  makeFeeLineItem,
  makeShippingLineItem,
  primaryCategoryFromItems,
  runLineItemsAgent,
} from './lineItemsAgent'
import { extractDate, extractVendor, runMerchantAgent } from './merchantAgent'
import { parseMoneyTokens, roundMoney } from './moneyParse'
import { normalizeOcrText } from './normalizeOcrText'
import type { LocalAgentResult } from './pipeline'
import { runQuorumAgent } from './quorumAgent'
import { runSieveAgent } from './sieveAgent'
import { runTotalsAgent } from './totalsAgent'
import { runArbiterAgent } from './arbiterAgent'

export type OcrPath = {
  label: string
  text: string
  note: string
  ais: AiId[]
}

export type HuddleOptions = {
  enabled: (id: AiId) => boolean
  onTalk?: (msg: string, aiId?: AiId) => void
  reliability?: Partial<Record<AiId, number>>
}

function nearly(a: number, b: number, tol = 0.08): boolean {
  return Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.02)
}

function scoreOcr(text: string): number {
  const lines = text.split(/\n/).filter((l) => l.trim()).length
  const money = (text.match(/\d+[.,]\d{2}/g) || []).length
  const letters = (text.match(/[A-Za-z]/g) || []).length
  return lines * 2 + money * 7 + Math.min(letters, 900) * 0.05
}

function productSum(items: ReceiptLineItem[]): number {
  return roundMoney(
    items
      .filter((i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description))
      .reduce((s, i) => s + i.amount, 0),
  )
}

function parseOne(text: string, label: string, ais: AiId[], enabled: (id: AiId) => boolean): LocalAgentResult {
  const cleaned = normalizeOcrText(text)
  const ledger = runLineItemsAgent(cleaned)
  const sieve = enabled('sieve') ? runSieveAgent(cleaned) : ledger
  const totals = runTotalsAgent(cleaned)
  const merchant = runMerchantAgent(cleaned)
  const draft = runArbiterAgent({
    rawText: cleaned,
    lines: {
      ...sieve,
      notes: [...(sieve.notes || []), `Ledger: ${ledger.items.length}`],
    },
    totals,
    merchant,
  })
  draft.aisUsed = Array.from(new Set<AiId>([...ais, 'ledger', 'cashier', 'clerk', 'arbiter', ...(enabled('sieve') ? (['sieve'] as AiId[]) : [])]))
  draft.activeAiLabel = label
  draft.agentReport = [`Parse from ${label}`, draft.agentReport].join('\n')
  return draft
}

/**
 * Multi-round on-device huddle over OCR paths.
 */
export function runTeamHuddle(
  ocrPaths: OcrPath[],
  opts: HuddleOptions,
): LocalAgentResult {
  const board = new Blackboard()
  const talk = (
    from: AiId | 'system',
    kind: 'finding' | 'question' | 'answer' | 'challenge' | 'decision',
    text: string,
    to?: AiId | 'all',
  ) => {
    board.post(from, kind, text, { to })
    opts.onTalk?.(`${from}: ${text}`, from === 'system' ? undefined : from)
  }

  const enabled = opts.enabled
  // Normalize OCR confusables (T0TAL, C0NVENIENCE, H0ME DEP0T) before anyone votes
  const usable = ocrPaths
    .map((p) => ({ ...p, text: normalizeOcrText(p.text) }))
    .filter((p) => p.text.trim().length > 8)
  if (!usable.length) {
    throw new Error('No OCR text for team huddle')
  }

  // ── Round 1: OCR agents introduce what they saw ──
  talk('system', 'finding', 'Team huddle starting — all free AIs on this phone.')
  const ocrRanked = [...usable].sort((a, b) => scoreOcr(b.text) - scoreOcr(a.text))
  for (const path of ocrRanked) {
    const ai = path.ais[0] || 'scout'
    if (!enabled(ai) && ai !== 'scout') continue
    const money = (path.text.match(/\d+[.,]\d{2}/g) || []).length
    const lines = path.text.split(/\n/).filter((l) => l.trim()).length
    talk(
      ai,
      'finding',
      `I read ${lines} lines, ${money} money tokens (${path.note}). Score ${scoreOcr(path.text).toFixed(0)}.`,
    )
  }

  // Pick best OCR texts for parse (top 3) — agents agree on sources
  const top = ocrRanked.slice(0, Math.min(3, ocrRanked.length))
  talk(
    'quorum',
    'decision',
    `Using top ${top.length} OCR reads for debate: ${top.map((t) => t.label).join(', ')}.`,
  )

  // ── Round 2: each parse specialist reads best OCR and posts ──
  const parses: LocalAgentResult[] = top.map((t) => parseOne(t.text, t.label, t.ais, enabled))

  // Merge OCR super-text for hunting
  let councilText = top[0].text
  for (let i = 1; i < top.length; i++) {
    // simple append unique lines
    const have = new Set(councilText.split(/\n/).map((l) => l.trim().toLowerCase()))
    for (const line of top[i].text.split(/\n/)) {
      const t = line.trim()
      if (t && !have.has(t.toLowerCase())) {
        councilText += '\n' + t
        have.add(t.toLowerCase())
      }
    }
  }

  for (let i = 0; i < parses.length; i++) {
    const p = parses[i]
    const ai = top[i].ais[0] || 'forge'
    talk(
      enabled('ledger') ? 'ledger' : 'arbiter',
      'finding',
      `From ${top[i].label}: ${p.lineItems.length} items, total ${p.amount != null ? `$${p.amount.toFixed(2)}` : '—'}, vendor “${p.vendor || '—'}”.`,
      'all',
    )
    void ai
  }

  // Specialists post from richest text
  const bestText = top[0].text
  if (enabled('cashier') || true) {
    const totals = runTotalsAgent(councilText.length > bestText.length ? councilText : bestText)
    talk(
      'cashier',
      'finding',
      totals.total != null
        ? `Grand total I see: $${totals.total.toFixed(2)}${totals.subtotal != null ? ` · subtotal $${totals.subtotal.toFixed(2)}` : ''}${totals.tax != null ? ` · tax $${totals.tax.toFixed(2)}` : ''}`
        : 'No clear grand total in OCR.',
    )
  }
  if (enabled('clerk') || true) {
    const v = extractVendor(councilText)
    const d = extractDate(councilText)
    talk('clerk', 'finding', `Vendor “${v || 'unclear'}”${d ? ` · date ${d}` : ''}.`)
  }
  if (enabled('sieve') || enabled('ledger')) {
    const sieve = runSieveAgent(councilText)
    talk(
      'sieve',
      'finding',
      `Line-item ensemble: ${sieve.items.length} rows summing $${sieve.itemsSum.toFixed(2)}.`,
    )
  }

  // ── Round 3: Quorum merges parse paths (they “vote” with talk) ──
  let draft = parses[0]
  if (enabled('quorum') && parses.length > 1) {
    talk('quorum', 'finding', `Voting across ${parses.length} full parses…`)
    for (let i = 1; i < parses.length; i++) {
      const before = draft.lineItems.length
      draft = runQuorumAgent(draft, parses[i])
      talk(
        'quorum',
        'answer',
        `After vote with path ${i + 1}: ${draft.lineItems.length} items (was ${before}), total ${draft.amount != null ? `$${draft.amount.toFixed(2)}` : '—'}.`,
      )
    }
  } else {
    talk('quorum', 'finding', 'Single parse path — Quorum notes consensus by default.')
  }

  // ── Round 4: Cross-check challenges ──
  let items = [...(draft.lineItems ?? [])]
  let amount = draft.amount
  let vendor = draft.vendor
  let subtotal = draft.subtotal ?? null
  let tax = draft.tax ?? null

  const totals2 = runTotalsAgent(councilText)
  if (totals2.total != null) amount = amount ?? totals2.total
  if (totals2.subtotal != null) subtotal = subtotal ?? totals2.subtotal
  if (totals2.tax != null) tax = tax ?? totals2.tax
  const betterVendor = extractVendor(councilText)
  if (betterVendor && (!vendor || vendor.length < 4)) {
    talk('clerk', 'answer', `Updating vendor → ${betterVendor}`)
    vendor = betterVendor
  }

  const pSum = productSum(items)
  if (subtotal != null && !nearly(pSum, subtotal)) {
    talk(
      'cashier',
      'challenge',
      `Ledger/Sieve: products sum $${pSum.toFixed(2)} but subtotal is $${subtotal.toFixed(2)}. Gap $${roundMoney(subtotal - pSum).toFixed(2)} — hunt OCR.`,
      'sieve',
    )
  } else if (amount != null && !nearly(pSum, amount) && items.length < 3) {
    talk(
      'cashier',
      'challenge',
      `Only ${items.length} product line(s) for total $${amount.toFixed(2)}. Look for more items.`,
      'ledger',
    )
  } else {
    talk('cashier', 'finding', 'Math looks roughly consistent with OCR totals.')
  }

  // ── Round 5: Sieve + Ledger respond — hunt missing money ──
  const monies = parseMoneyTokens(councilText).map(roundMoney)
  const have = new Set(items.map((i) => i.amount.toFixed(2)))
  const shippingLine = items.find((i) => isShippingLineItem(i.description))
  const feeLine = items.find((i) => isFeeLineItem(i.description))
  const skipAmts = new Set<string>()
  if (amount != null) skipAmts.add(amount.toFixed(2))
  if (subtotal != null) skipAmts.add(subtotal.toFixed(2))
  if (tax != null) skipAmts.add(tax.toFixed(2))
  if (shippingLine) skipAmts.add(shippingLine.amount.toFixed(2))
  if (feeLine) feeLine && skipAmts.add(feeLine.amount.toFixed(2))

  const need =
    subtotal != null ? roundMoney(subtotal - pSum) : amount != null ? roundMoney(amount - pSum) : null

  const candidates = [...new Set(monies)]
    .filter((m) => m >= 0.5 && !have.has(m.toFixed(2)) && !skipAmts.has(m.toFixed(2)))
    .sort((a, b) => {
      if (need != null) return Math.abs(a - need) - Math.abs(b - need)
      return b - a
    })

  for (const m of candidates.slice(0, 4)) {
    // context
    const lines = councilText.split(/\n/).map((l) => l.trim())
    let ctx = ''
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(m.toFixed(2)) || lines[i].includes(String(m))) {
        ctx = lines
          .slice(Math.max(0, i - 3), i + 1)
          .join(' ')
          .replace(/\$?\d+[.,]\d{2}/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
          .slice(0, 80)
        break
      }
    }
    if (!ctx || ctx.length < 3) continue
    if (/\b(subtotal|grand total|tax|payment|payer)\b/i.test(ctx) && !/filter|kit|foam|romex|wire|part/i.test(ctx)) {
      continue
    }
    if (/\b(shipping|freight|delivery)\b/i.test(ctx)) {
      if (!shippingLine) {
        items.push(makeShippingLineItem(m))
        talk('ledger', 'answer', `Cashier gap → found Shipping $${m.toFixed(2)}.`)
      }
      continue
    }
    if (/\b(convenience|service fee|processing fee|handling)\b/i.test(ctx)) {
      if (!feeLine) {
        items.push(makeFeeLineItem(m, ctx))
        talk('ledger', 'answer', `Found Fee $${m.toFixed(2)}.`)
      }
      continue
    }
    const { categoryId } = categorizeText(ctx)
    items.push({
      id: `huddle-${m}-${items.length}`,
      description: ctx || `Item $${m.toFixed(2)}`,
      amount: m,
      categoryId,
    })
    talk('sieve', 'answer', `Hunted missing amount $${m.toFixed(2)}: “${(ctx || 'item').slice(0, 40)}”.`)
    have.add(m.toFixed(2))
    if (need != null && nearly(productSum(items), subtotal ?? amount ?? -1)) break
  }

  // Shipping / fee from OCR if missing
  const ledgerFull = runLineItemsAgent(councilText)
  if (ledgerFull.shipping != null && !items.some((i) => isShippingLineItem(i.description))) {
    items.push(makeShippingLineItem(ledgerFull.shipping))
    talk('clerk', 'answer', `Shipping section: $${ledgerFull.shipping.toFixed(2)}.`)
  }
  if (ledgerFull.fee != null && !items.some((i) => isFeeLineItem(i.description))) {
    items.push(makeFeeLineItem(ledgerFull.fee))
    talk('clerk', 'answer', `Fees section: $${ledgerFull.fee.toFixed(2)}.`)
  }

  // Dedupe products vs subtotal
  const ships = items.filter((i) => isShippingLineItem(i.description))
  const fees = items.filter((i) => isFeeLineItem(i.description))
  let products = items.filter(
    (i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description),
  )
  if (subtotal != null && productSum(products) > subtotal * 1.08) {
    talk('arbiter', 'challenge', `Product sum inflated vs subtotal — collapsing dupes.`)
    products = dedupeItemsByAmount(products, subtotal)
  } else {
    products = dedupeItemsByAmount(products, subtotal)
  }
  items = [...products, ...ships.slice(0, 1), ...fees.slice(0, 2)]

  // ── Round 6: Arbiter closes ──
  const finalProductSum = productSum(items)
  const allSum = roundMoney(items.reduce((s, i) => s + i.amount, 0))
  if (subtotal != null && nearly(finalProductSum, subtotal)) {
    talk('arbiter', 'decision', `✓ Products $${finalProductSum.toFixed(2)} match subtotal.`)
  }
  if (amount != null && nearly(allSum, amount)) {
    talk('arbiter', 'decision', `✓ All lines (products+ship+fees) = total $${amount.toFixed(2)}.`)
  } else if (amount != null) {
    talk(
      'arbiter',
      'finding',
      `Soft close: lines $${allSum.toFixed(2)} vs total $${amount.toFixed(2)} — keeping total from Cashier.`,
    )
  }

  // Recategorize products
  items = items.map((i) => {
    if (isShippingLineItem(i.description) || isFeeLineItem(i.description)) {
      return { ...i, categoryId: 'misc' as CategoryId }
    }
    const { categoryId } = categorizeText(i.description)
    return { ...i, categoryId }
  })

  const categoryId = primaryCategoryFromItems(items)
  const description =
    items.length > 0
      ? items
          .map((i) => i.description)
          .slice(0, 8)
          .join('; ')
          .slice(0, 160)
      : draft.description

  talk(
    'quorum',
    'decision',
    `Team agreement: ${items.length} lines, total $${(amount ?? allSum).toFixed(2)}, vendor ${vendor || '—'}, category ${categoryId}.`,
  )

  const aisUsed = new Set<AiId>([
    ...(draft.aisUsed ?? []),
    ...usable.flatMap((u) => u.ais),
    'ledger',
    'cashier',
    'clerk',
    'arbiter',
    'quorum',
  ])
  if (enabled('sieve')) aisUsed.add('sieve')
  if (enabled('council')) aisUsed.add('council')

  const conf =
    Math.min(
      0.97,
      (draft.confidence ?? 0.5) +
        (nearly(finalProductSum, subtotal ?? -1) ? 0.08 : 0) +
        (items.length >= 2 ? 0.04 : 0),
    )

  return {
    date: draft.date || extractDate(councilText),
    vendor,
    amount,
    description,
    categoryId,
    notes: `Team huddle · ${items.length} lines · conf ${Math.round(conf * 100)}%`,
    lineItems: items,
    subtotal,
    tax,
    source: 'on-device',
    confidence: conf,
    rawText: councilText.slice(0, 8000),
    aisUsed: Array.from(aisUsed),
    activeAiLabel: 'On-device team huddle (agents talking)',
    fieldSources: {
      total: 'cashier',
      vendor: 'clerk',
      category: 'ledger',
      date: draft.date ? 'clerk' : undefined,
      shipping: ships[0] ? 'ledger' : undefined,
      lines: Object.fromEntries(
        items.map((li) => [
          li.id,
          isShippingLineItem(li.description) || isFeeLineItem(li.description)
            ? ('ledger' as AiId)
            : ('sieve' as AiId),
        ]),
      ),
      ocr: top[0]?.ais[0],
    },
    agentReport: [
      '—— On-device team huddle (AIs talking to each other) ——',
      board.transcript(),
      draft.agentReport,
    ]
      .filter(Boolean)
      .join('\n'),
  }
}
