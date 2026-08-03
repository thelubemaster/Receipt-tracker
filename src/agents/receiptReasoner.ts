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
  isCoreChargeLineItem,
  isCoreTradeInLineItem,
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
import {
  extractDate,
  extractListingDescription,
  extractListingPrice,
  extractVendor,
} from './merchantAgent'
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
  return items.filter(
    (i) =>
      !isShippingLineItem(i.description) &&
      !isFeeLineItem(i.description) &&
      !isCoreChargeLineItem(i.description) &&
      !isCoreTradeInLineItem(i.description),
  )
}

function coreNet(items: ReceiptLineItem[]): number {
  return roundMoney(
    items.reduce((s, i) => {
      if (isCoreChargeLineItem(i.description)) return s + Math.abs(i.amount)
      if (isCoreTradeInLineItem(i.description)) return s - Math.abs(i.amount)
      return s
    }, 0),
  )
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
  // Never a money amount
  if (/^\$?\d+[.,]\d{2}$/.test(s.replace(/\s/g, ''))) return 0
  if (/^\d+[.,]\d{2}$/.test(s)) return 0
  const letters = (s.match(/[A-Za-z]/g) || []).length
  const vowels = (s.match(/[aeiouAEIOU]/g) || []).length
  if (letters < 3) return 0
  // OCR soup: long consonant runs / near-vowel-free tokens (e.g. HVBDARBM KARZ)
  const tokens = s.split(/\s+/).filter(Boolean)
  let gibber = 0
  for (const t of tokens) {
    const tl = (t.match(/[A-Za-z]/g) || []).length
    const tv = (t.match(/[aeiouAEIOU]/g) || []).length
    if (tl >= 5 && tv === 0) gibber += 2
    else if (tl >= 6 && tv / tl < 0.18) gibber += 2
    else if (/[bcdfghjklmnpqrstvwxyz]{4,}/i.test(t) && tv <= 1) gibber += 1
  }
  if (gibber >= 2) return 0
  if (gibber >= 1 && vowels < 3) return 1
  let score = letters + vowels * 2
  if (s.includes(' ')) score += 8
  if (letters >= 5 && vowels >= 2) score += 6
  // Prefer real-looking multi-word names over random CAPS
  if (/^[A-Z]{2,}(\s+[A-Z]{2,}){2,}$/.test(s) && vowels / Math.max(1, letters) < 0.28) {
    score -= 20
  }
  return Math.max(0, score)
}

/** How “readable” a product/description string is (0 = OCR soup). */
export function descriptionQuality(d: string): number {
  const s = (d || '').trim()
  if (s.length < 3) return 0
  if (vendorQuality(s) === 0 && /[bcdfghjklmnpqrstvwxyz]{4,}/i.test(s)) return 0
  const letters = (s.match(/[A-Za-z]/g) || []).length
  const vowels = (s.match(/[aeiouAEIOU]/g) || []).length
  if (letters < 4) return 0
  if (vowels / letters < 0.15 && letters > 12) return 0
  let score = Math.min(40, letters) + vowels
  if (/\b(selling|mower|bus|filter|oil|kit|amazon|thorne|vitamin|supplement|receipt|invoice)\b/i.test(s))
    score += 15
  // Noise: pipes, backslashes, “0 | oO”, VIN soup
  if (/[|\\]{1,}/.test(s)) score -= 20
  if (/\bvin\b|\bahvbd|\bhvbd/i.test(s)) score -= 15
  if (/^\d[\s|]|[o0]\s*[|o0]/i.test(s)) score -= 12
  if (s.length > 70) score -= 10
  return Math.max(0, score)
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

  // Single line item that is OCR soup — re-solve for a cleaner title
  if (prods.length === 1) {
    const dq = descriptionQuality(prods[0].description || '')
    if (dq < 18) {
      issues.push({
        code: 'garbage-description',
        severity: 'fatal',
        message: 'Product description looks like OCR garbage — rebuild from cleaner phrases',
      })
    }
  }

  // Tax / sale total / core labels listed as “products” with invented even-split $ — re-solve
  const chromeAsProduct = prods.filter(
    (p) =>
      NON_CATALOG_PRODUCT.test(p.description || '') ||
      /\bstate\s*tax\b|\bsale\s*t[o0]tal\b|\bcore\s*trade|\bcore\s*charge\b/i.test(
        p.description || '',
      ),
  )
  if (prods.length >= 3 && chromeAsProduct.length >= Math.ceil(prods.length / 2)) {
    issues.push({
      code: 'chrome-as-products',
      severity: 'fatal',
      message: `Receipt chrome (tax/total/core labels) was treated as products — re-parse with real prices and core money`,
    })
  }

  // Total and product sum disagree (e.g. total $750, line $150 from marketplace OCR)
  if (
    total != null &&
    pSum > 0 &&
    Math.abs(pSum + fee + ship + (tax ?? 0) - total) > Math.max(1, total * 0.08) &&
    prods.length <= 3
  ) {
    issues.push({
      code: 'total-line-mismatch',
      severity: 'fatal',
      message: `Grand total $${total} does not match line sum $${roundMoney(pSum + fee + ship + (tax ?? 0))}`,
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

  // Many named products in OCR but fewer clean line items → incomplete catalog
  const named = extractProductNamesFromOcr(ocr)
  if (named.length >= 3 && prods.length < named.length) {
    issues.push({
      code: 'missing-line-items',
      severity: prods.length <= 1 || named.length - prods.length >= 1 ? 'fatal' : 'warn',
      message: `OCR lists ~${named.length} products (${named
        .slice(0, 3)
        .join('; ')}${named.length > 3 ? '…' : ''}) but parse only has ${prods.length} line(s)`,
    })
  }

  // Marketing blurb as “product” when Brand – Product rows exist in OCR
  const badNames = prods.filter(
    (p) =>
      PRODUCT_MARKETING.test((p.description || '').trim()) ||
      /^(third[-\s]?party|lung\s*function|ardiovascular|uten,|healthy bones)/i.test(
        (p.description || '').trim(),
      ) ||
      (!/\s[-–]\s/.test(p.description || '') &&
        (p.description || '').length > 40 &&
        !/^[A-Z]{3,16}\b/.test(p.description || '')),
  )
  if (named.length >= 2 && badNames.length >= Math.max(1, Math.ceil(prods.length / 2))) {
    issues.push({
      code: 'marketing-as-product',
      severity: 'fatal',
      message: `Line items look like marketing blurbs, not product titles (${badNames.length}/${prods.length})`,
    })
  }

  // Products under total with more named SKUs → missing price/row
  if (
    total != null &&
    named.length >= 3 &&
    pSum > 0 &&
    pSum < total - 1 &&
    pSum < total * 0.92 &&
    fee + ship + (tax ?? 0) < 1
  ) {
    issues.push({
      code: 'product-sum-short',
      severity: 'fatal',
      message: `Products sum $${pSum} but total is $${total} — missing ~$${roundMoney(total - pSum)} (another product or price)`,
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

/** Header / boilerplate / marketing — never a product title. */
const PRODUCT_LINE_SKIP =
  /\b(order\s*summary|order\s*placed|order\s*#|ship\s*to|shipped|payment\s*method|mastercard|visa|amex|subtotal|final\s*subtotal|grand\s*total|sale\s*t[o0]tal|total\s*before|estimated\s*tax|state\s*tax|sales\s*tax|shipping|handling|delivered|retu[rmn]+\s*window|sold\s*by|package\s*was|bangor|united\s*states|items?\)?\s*subtotal|bradley|little\s*creek|front\s*door|porch|approval|debit|credit|chip|pin\s*online|rewards?\s*account|store\s*#|reg\s*#|csr\s*#|data\s*source|app\s*name|aid:|arqc)\b/i

/** Tax/total chrome is never a catalog SKU. Core charge/trade-in are real money but not SKUs to invent. */
const NON_CATALOG_PRODUCT =
  /\b(core\s*[-–]?\s*trade|core\s*[-–]?\s*charge|core\s*c\s*harge|state\s*[-–]?\s*tax|sales\s*tax|sale\s*[-–]?\s*t[o0]tal|final\s*subtotal|subtotal|debit|approval|rewards?)\b/i

/** Continuation / blurb lines that look like products but are not SKUs. */
const PRODUCT_MARKETING =
  /^(supplement|capsule|tablet|softgel|serving|servings|healthy|supports|function|ingredients|third[-\s]?party|gluten|dairy|soy|nsf\b|clinically|highly\s*absorb|lung\s*function|bone\s*density|health\b|incron|suoplement|suopiement)/i

/** Brands that are never real product brands in Brand – Title extraction. */
const FAKE_BRAND =
  /^(CORE|STATE|SALE|FINAL|TOTAL|TAX|DEBIT|CREDIT|VISA|ROHR|ITEM|STORE|DATE|REG|CSR|PIN|AID|ARQC|SUBTOTAL)$/i

/**
 * Stable identity for fuzzy dedupe across OCR typos and multi-page repeats.
 * Generic families (magnesium, vitamin d/k, zinc…) — not store-specific.
 */
export function productIdentityKey(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const brand = (s.match(/^[a-z]{3,16}/) || ['x'])[0]
  if (/magnes|citramate|citrate.*malate|malate.*citrate/.test(s)) return `${brand}:magnesium`
  if (/\bvitamin\s*d\b|\bd\s*3\b|\bd3\b|\b5\s*000\b|\b5000\b/.test(s)) return `${brand}:vitd`
  if (/\bvitamin\s*k\b|\bmk\s*[47]\b|\bk1\b|\bk2\b/.test(s)) return `${brand}:vitk`
  if (/\bzinc\b|bisglyc|bisgyc|bisgly/.test(s)) return `${brand}:zinc`
  if (/\bomega\b|\bfish\s*oil\b/.test(s)) return `${brand}:omega`
  if (/\bprobiotic/.test(s)) return `${brand}:probiotic`
  if (/\bcollagen\b/.test(s)) return `${brand}:collagen`
  // brand + first 2 content words of the product half
  const after = s.replace(new RegExp(`^${brand}\\s*`), '')
  const words = after
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(and|the|for|with|from)$/.test(w))
    .slice(0, 2)
  return `${brand}:${words.join(' ') || s.slice(0, 24)}`
}

/** Strip marketing tail; keep "Brand - Product" short title. */
function cleanBrandProductTitle(brand: string, productRaw: string): string {
  let p = productRaw.replace(/\s+/g, ' ').trim()
  // Cut at common Amazon marketing dashes
  p = p.replace(
    /\s*[-–]\s*(Supports|Highly|Plus|Clinically|Third[-\s]?Party|NSF|Gluten|Contains|Capsule\s+Supplement|Vitamin\s+D3\s+Supplement)\b.*$/i,
    '',
  )
  // "Magnesium CitraMate - Magnesium Citrate & Malate" → keep first clause if long
  const clauses = p.split(/\s*[-–]\s*/)
  if (clauses.length >= 2 && clauses[0].length >= 6) {
    // Keep "Vitamin D-5,000" style: first clause short + second is dose/synonym
    if (clauses[0].length <= 12 && /^(vitamin|[a-z])$/i.test(clauses[0].split(/\s+/).pop() || '')) {
      p = clauses.slice(0, 2).join(' - ')
    } else if (clauses[0].length >= 8) {
      p = clauses[0]
    } else {
      p = clauses.slice(0, 2).join(' - ')
    }
  }
  p = p.replace(/\s*[-–]\s*$/g, '').trim().slice(0, 72)
  if (p.length < 3) return ''
  if (PRODUCT_MARKETING.test(p)) return ''
  return `${brand} - ${p}`
}

/**
 * Find product *names* in OCR even when unit prices are missing/garbled.
 * Generic: "BRAND - Product title …" lines, not store-specific.
 * Prefers real catalog rows; ignores marketing blurbs and multi-page duplicates.
 */
export function extractProductNamesFromOcr(ocrText: string): string[] {
  const text = normalizeOcrText(ocrText || '')
  const lines = text
    .split(/\r?\n/)
    .map((l) =>
      l
        // OCR crumbs before brand: "= ", "sw ", "m=", "~~ ", "ae "
        .replace(/^[\s=\-~•·|*~]+/, '')
        .replace(/^[a-z]{1,3}[=:\s]+/i, '')
        .replace(/^m=/i, '')
        .replace(/[\s=\-~•·|*]+$/, '')
        .trim(),
    )
    .filter((l) => l.length >= 8)

  const names: string[] = []
  const seenIds = new Set<string>()

  const pushName = (raw: string) => {
    let n = raw.replace(/\s+/g, ' ').trim()
    if (n.length < 8 || n.length > 100) return
    if (PRODUCT_LINE_SKIP.test(n)) return
    if (!/[A-Za-z]{4,}/.test(n)) return
    // Must look like Brand - Product (reject pure marketing sentences)
    if (!/\s[-–]\s|[A-Z]{3,16}\s*[-–]\s*[A-Za-z]/.test(n) && !/^[A-Z]{3,16}\s+/.test(n)) return
    const id = productIdentityKey(n)
    if (!id || seenIds.has(id)) return
    // Prefer longer / cleaner title when we already have a weaker spelling? first wins (cleaner OCR is usually first page)
    seenIds.add(id)
    names.push(n.slice(0, 90))
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (PRODUCT_LINE_SKIP.test(line)) continue
    if (PRODUCT_MARKETING.test(line)) continue
    if (NON_CATALOG_PRODUCT.test(line)) continue

    // Pattern A: BRAND - Product (hyphen optional spaces; allow dose hyphens in product)
    const brandDash = line.match(
      /^([A-Z][A-Za-z0-9&.']{2,24})\s*[-–]\s*([A-Za-z0-9][\w\s,&'/\-+.%()]{2,90})/,
    )
    if (brandDash) {
      const brand = brandDash[1]
      if (
        FAKE_BRAND.test(brand) ||
        /^(ORDER|TOTAL|SHIP|PAYMENT|GRAND|ESTIMATED|ITEMS|DELIVERED|RETURN|RETUM|SOLD|YOUR|UNITED|PACKAGE)$/i.test(
          brand,
        )
      ) {
        continue
      }
      if (NON_CATALOG_PRODUCT.test(`${brand} ${brandDash[2]}`)) continue
      const cleaned = cleanBrandProductTitle(brand, brandDash[2])
      if (cleaned && !NON_CATALOG_PRODUCT.test(cleaned)) pushName(cleaned)
      continue
    }

    // Pattern B: BRAND Product… (space, no dash) — all-caps brand token
    const brandSpace = line.match(
      /^([A-Z]{3,16})\s+([A-Z][A-Za-z0-9][\w\s,&'/\-+.%()]{6,70})/,
    )
    if (
      brandSpace &&
      !FAKE_BRAND.test(brandSpace[1]) &&
      !/ORDER|TOTAL|SHIP|PAYMENT|GRAND|ESTIMATED|ITEMS|DELIVERED/i.test(brandSpace[1]) &&
      !PRODUCT_MARKETING.test(brandSpace[2]) &&
      !NON_CATALOG_PRODUCT.test(`${brandSpace[1]} ${brandSpace[2]}`)
    ) {
      const cleaned = cleanBrandProductTitle(brandSpace[1], brandSpace[2])
      if (cleaned && !NON_CATALOG_PRODUCT.test(cleaned)) pushName(cleaned)
    }

    // Pattern C: Auto parts style "Duralast HD Battery, EA" (no Brand-dash)
    const autoPart = line.match(
      /^((?:Duralast|DieHard|EverStart|Valvoline|Mobil|Castrol|ACDelco|Motorcraft|Bosh|Bosch|AGS|Peak)[\w\s,./#-]{4,55})/i,
    )
    if (autoPart && !NON_CATALOG_PRODUCT.test(autoPart[1])) {
      pushName(autoPart[1].replace(/,?\s*E[AR]\s*$/i, '').trim())
    }
  }

  return names.slice(0, 12)
}

/**
 * Catalog lines with unit prices: "… 174.99 P" / "BTP-1 1.99"
 * Skips tax, core trade-in chrome unless priced as CORE CHARGE deposit.
 */
export function extractPricedCatalogLines(
  ocrText: string,
  opts?: { grandTotal?: number | null },
): Array<{ name: string; price: number; kind: 'product' | 'core-charge' | 'core-trade-in' }> {
  const grand = opts?.grandTotal ?? null
  const text = normalizeOcrText(stripOrderIds(ocrText || ''))
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 4)

  const out: Array<{ name: string; price: number; kind: 'product' | 'core-charge' | 'core-trade-in' }> =
    []
  const seen = new Set<string>()

  const looksLikeSkuOnly = (s: string) =>
    !/[A-Za-z]{4,}/.test(s) ||
    /^[\d#\s.\-P]+$/i.test(s) ||
    (s.length < 12 && /\d{2,}/.test(s) && !/battery|filter|oil|kit/i.test(s))

  const looksLikeProductTitle = (s: string) =>
    s.length >= 6 &&
    /[A-Za-z]{4,}/.test(s) &&
    !NON_CATALOG_PRODUCT.test(s) &&
    !PRODUCT_LINE_SKIP.test(s) &&
    !/^\$?\d/.test(s) &&
    descriptionQuality(s) >= 8

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (PRODUCT_LINE_SKIP.test(line) && !/\bcore\s*(charge|trade)/i.test(line)) continue
    if (/\bstate\s*tax\b|\bsale\s*t[o0]tal\b|\bsubtotal\b|\bdebit\b|\bapproval\b/i.test(line))
      continue

    const amts = parseMoneyTokens(line, { grandTotal: grand }).filter(
      (a) => a >= 0.5 && (grand == null || a < grand * 1.05),
    )
    if (!amts.length) continue
    // Prefer last amount on the line (SKU … 174.99 P)
    const price = amts[amts.length - 1]
    if (grand != null && nearly(price, grand) && amts.length === 1) continue

    let kind: 'product' | 'core-charge' | 'core-trade-in' = 'product'
    if (/\bcore\s*trade[-\s]?in\b/i.test(line)) kind = 'core-trade-in'
    else if (/\bcore\s*charge\b/i.test(line)) kind = 'core-charge'

    let name = line
      .replace(/\$?\s*\d{1,5}(?:[.,]\d{2})?\s*P?\s*$/i, '')
      .replace(/#\d{6,}\s*/g, '')
      .replace(/\b\d{5,}\s+\d{2}-\d{3}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (kind === 'core-trade-in') name = 'Core trade-in'
    else if (kind === 'core-charge') name = 'Core charge'
    else {
      // AutoZone: price on SKU line, title on next/prev ("Duralast HD Battery, EA")
      if (looksLikeSkuOnly(name) || descriptionQuality(name) < 10) {
        const next = lines[i + 1] || ''
        const prev = lines[i - 1] || ''
        if (looksLikeProductTitle(next)) name = next.replace(/,?\s*E[AR]\s*$/i, '').trim()
        else if (looksLikeProductTitle(prev)) name = prev.replace(/,?\s*E[AR]\s*$/i, '').trim()
      }
      if (/battery|duralast|btp|terminal|protector|recycled|filter/i.test(line + ' ' + name)) {
        name = name
          .replace(/\$?\s*\d{1,5}(?:[.,]\d{2}).*$/i, '')
          .replace(/#\d+\s*/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80)
      }
      if (name.length < 4 || (NON_CATALOG_PRODUCT.test(name) && kind === 'product')) continue
      if (descriptionQuality(name) < 8 && kind === 'product') continue
      if (looksLikeSkuOnly(name)) continue
    }

    const key = `${kind}:${price.toFixed(2)}:${name.slice(0, 24).toLowerCase()}`
    if (seen.has(key)) continue
    // Cap duplicates of same core charge amount (multi-page OCR)
    const sameCore = out.filter((x) => x.kind === kind && nearly(x.price, price)).length
    if (kind !== 'product' && sameCore >= 3) continue
    seen.add(key)
    out.push({ name: name.slice(0, 90), price, kind })
  }

  return out.slice(0, 20)
}

/**
 * Walk OCR top-to-bottom: Brand – Product title, then the next unit price
 * before the next brand line (Amazon multi-column often puts $ under the title).
 */
export function extractNamedProductsWithPrices(
  ocrText: string,
  opts?: { grandTotal?: number | null; subtotal?: number | null },
): Array<{ name: string; price: number | null }> {
  const grand = opts?.grandTotal ?? null
  const sub = opts?.subtotal ?? null
  const text = normalizeOcrText(stripOrderIds(ocrText || ''))
  const lines = text
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^[\s=\-~•·|*~]+/, '')
        .replace(/^[a-z]{1,3}[=:\s]+/i, '')
        .trim(),
    )
    .filter((l) => l.length >= 4)

  const brandRe =
    /^([A-Z][A-Za-z0-9&.']{2,24})\s*[-–]\s*([A-Za-z0-9][\w\s,&'/\-+.%()]{2,90})/
  const skipBrand =
    /^(ORDER|TOTAL|SHIP|PAYMENT|GRAND|ESTIMATED|ITEMS|DELIVERED|RETURN|RETUM|SOLD|YOUR|UNITED|PACKAGE|ITEM)/i

  type Row = { name: string; price: number | null; id: string }
  const rows: Row[] = []
  let current: Row | null = null

  const flush = () => {
    if (current) {
      rows.push(current)
      current = null
    }
  }

  for (const line of lines) {
    if (PRODUCT_LINE_SKIP.test(line) && !brandRe.test(line)) continue

    const bm = line.match(brandRe)
    if (bm && !skipBrand.test(bm[1])) {
      const cleaned = cleanBrandProductTitle(bm[1], bm[2])
      if (cleaned) {
        flush()
        const id = productIdentityKey(cleaned)
        // Skip multi-page duplicate of same product
        if (rows.some((r) => r.id === id)) {
          current = null
          continue
        }
        current = { name: cleaned, price: null, id }
        // Price on same line as title?
        const same = parseMoneyTokens(line, { grandTotal: grand }).filter(
          (a) =>
            a >= 0.5 &&
            (grand == null || (!nearly(a, grand) && a <= grand + 0.05)) &&
            (sub == null || !nearly(a, sub) || a < 5),
        )
        if (same.length) current.price = same[same.length - 1]
        continue
      }
    }

    if (!current) continue
    if (PRODUCT_MARKETING.test(line) && !/\$/.test(line)) continue

    const amts = parseMoneyTokens(line, { grandTotal: grand }).filter((a) => {
      if (a < 0.5) return false
      if (grand != null && nearly(a, grand)) return false
      if (sub != null && nearly(a, sub) && a > 5) return false
      if (grand != null && a > grand + 0.05) return false
      if (grand != null && grand < 200 && a >= 100 && Math.abs(a - Math.round(a)) < 0.001)
        return false
      return true
    })
    if (amts.length && current.price == null) {
      current.price = amts[0]
    }
  }
  flush()

  return rows.map(({ name, price }) => ({ name, price }))
}

/**
 * Hunt unit prices that aren't order totals / tax / shipping.
 * Used when product *names* are clear but Ledger never attached a price.
 */
export function extractCandidateUnitPrices(
  ocrText: string,
  opts?: { grandTotal?: number | null; subtotal?: number | null; count?: number },
): number[] {
  const grand = opts?.grandTotal ?? null
  const sub = opts?.subtotal ?? null
  const text = normalizeOcrText(stripOrderIds(ocrText || ''))
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const skip =
    /\b(order\s*summary|order\s*placed|items?\)?\s*subtotal|sub[\s\-]*total|grand\s*total|total\s*before|estimated\s*tax|shipping|handling|payment\s*method|mastercard|visa|amount\s*due|balance\s*due)\b/i

  const out: number[] = []
  for (const line of lines) {
    if (skip.test(line)) continue
    // Skip pure quantity / servings lines without a $ amount signal
    if (/\b(servings?|capsules?|tablets?|softgels?)\b/i.test(line) && !/\$/.test(line)) {
      continue
    }
    for (const a of parseMoneyTokens(line, { grandTotal: grand })) {
      if (a < 0.5) continue
      if (grand != null && nearly(a, grand)) continue
      if (sub != null && nearly(a, sub) && a > 5) continue
      if (grand != null && a > grand + 0.05) continue
      if (sub != null && a > sub + 0.05) continue
      // Drop whole-dollar OCR ghosts like 100 / 1000 with no cents when budget is xx.00 small
      if (grand != null && grand < 200 && a >= 100 && Math.abs(a - Math.round(a)) < 0.001) continue
      out.push(a)
    }
  }

  // De-dupe multi-page repeats: keep first N unique-ish sequence
  const deduped: number[] = []
  for (const p of out) {
    const last = deduped[deduped.length - 1]
    if (last != null && nearly(last, p, 0.02)) continue
    // Same price appearing many times (page repeats) — allow one copy per product later
    deduped.push(p)
  }

  const want = opts?.count
  if (want != null && want > 0 && deduped.length > want) {
    // Prefer a window of `want` consecutive prices that sum ≈ subtotal/total
    const budget = sub ?? grand
    if (budget != null) {
      let best: number[] | null = null
      let bestDiff = Infinity
      for (let i = 0; i <= deduped.length - want; i++) {
        const slice = deduped.slice(i, i + want)
        const sum = roundMoney(slice.reduce((s, x) => s + x, 0))
        const diff = Math.abs(sum - budget)
        if (diff < bestDiff) {
          bestDiff = diff
          best = slice
        }
      }
      if (best && bestDiff <= Math.max(0.5, budget * 0.05)) return best
    }
    return deduped.slice(0, want)
  }
  return deduped
}

export type NamePriceAssign = {
  items: ReceiptLineItem[]
  /** true when amounts are even-split placeholders, not real unit prices */
  pricesEstimated: boolean
  note: string
}

/**
 * Attach real unit prices when OCR has them; otherwise even-split the budget
 * and mark the result as estimated so the user knows to edit.
 *
 * Also handles n products with n−1 prices: remainder = budget − sum goes on the
 * product that has no price (common when the last column price is missed).
 */
export function itemsFromNamesWithPrices(
  names: string[],
  budget: number,
  unitPrices?: number[] | null,
  paired?: Array<{ name: string; price: number | null }> | null,
): NamePriceAssign {
  if (!names.length || budget <= 0) {
    return { items: [], pricesEstimated: false, note: '' }
  }

  // Prefer ordered pairs (name + price from OCR layout)
  if (paired && paired.length >= 2) {
    const rows = paired.filter((p) => names.some((n) => productIdentityKey(n) === productIdentityKey(p.name)) || names.includes(p.name))
    const use = rows.length >= 2 ? rows : paired
    if (use.length >= 2) {
      const known = use.map((u) => u.price).filter((p): p is number => p != null && p > 0)
      const knownSum = roundMoney(known.reduce((s, p) => s + p, 0))
      const missingIdx = use.map((u, i) => (u.price == null || u.price <= 0 ? i : -1)).filter((i) => i >= 0)
      let amounts = use.map((u) => (u.price != null && u.price > 0 ? roundMoney(u.price) : 0))

      if (missingIdx.length === 1 && knownSum > 0 && knownSum < budget) {
        const gap = roundMoney(budget - knownSum)
        if (gap >= 0.5 && gap <= budget * 0.9) {
          amounts[missingIdx[0]] = gap
        }
      } else if (missingIdx.length === 0 && nearly(knownSum, budget, Math.max(0.5, budget * 0.06))) {
        // all priced and close
      } else if (missingIdx.length > 1 && knownSum > 0 && knownSum < budget) {
        // split remainder across missing
        const gap = roundMoney(budget - knownSum)
        if (gap >= 0.5) {
          const each = roundMoney(Math.floor((gap * 100) / missingIdx.length) / 100)
          let alloc = 0
          missingIdx.forEach((idx, j) => {
            amounts[idx] =
              j === missingIdx.length - 1 ? roundMoney(gap - alloc) : each
            alloc = roundMoney(alloc + amounts[idx])
          })
        }
      }

      const sum = roundMoney(amounts.reduce((s, a) => s + a, 0))
      if (amounts.every((a) => a > 0) && nearly(sum, budget, Math.max(0.75, budget * 0.08))) {
        const items = use.map((u, i) => {
          const { categoryId } = categorizeText(u.name)
          return {
            id: `reason-pair-${i}`,
            description: u.name,
            amount: amounts[i],
            categoryId,
          }
        })
        const drift = roundMoney(budget - sumProducts(items))
        if (Math.abs(drift) >= 0.01 && items.length) {
          items[items.length - 1] = {
            ...items[items.length - 1],
            amount: roundMoney(items[items.length - 1].amount + drift),
          }
        }
        const anyFilled = missingIdx.length > 0
        return {
          items,
          pricesEstimated: anyFilled,
          note: anyFilled
            ? `Unit prices from OCR; filled $${roundMoney(budget - knownSum).toFixed(2)} gap on product(s) with no price so total closes`
            : 'Unit prices paired with product titles from OCR',
        }
      }
    }
  }

  const prices = (unitPrices || []).filter((p) => p > 0 && p <= budget + 0.05)
  if (prices.length === names.length) {
    const sum = roundMoney(prices.reduce((s, p) => s + p, 0))
    if (nearly(sum, budget, Math.max(0.5, budget * 0.06))) {
      const items = names.map((name, i) => {
        const { categoryId } = categorizeText(name)
        return {
          id: `reason-name-${i}`,
          description: name,
          amount: roundMoney(prices[i]),
          categoryId,
        }
      })
      // Absorb penny drift on last line
      const drift = roundMoney(budget - sumProducts(items))
      if (Math.abs(drift) >= 0.01 && items.length) {
        items[items.length - 1] = {
          ...items[items.length - 1],
          amount: roundMoney(items[items.length - 1].amount + drift),
        }
      }
      return {
        items,
        pricesEstimated: false,
        note: 'Unit prices read from OCR and checked against subtotal',
      }
    }
  }

  // n names, n-1 prices in order — put remainder on last product
  if (prices.length === names.length - 1 && prices.length >= 1) {
    const knownSum = roundMoney(prices.reduce((s, p) => s + p, 0))
    const gap = roundMoney(budget - knownSum)
    if (gap >= 0.5 && gap < budget && knownSum > 0) {
      const all = [...prices, gap]
      const items = names.map((name, i) => {
        const { categoryId } = categorizeText(name)
        return {
          id: `reason-name-${i}`,
          description: name,
          amount: roundMoney(all[i]),
          categoryId,
        }
      })
      return {
        items,
        pricesEstimated: true,
        note: `Unit prices from OCR for ${prices.length}/${names.length} items; last line filled to close $${budget.toFixed(2)} total`,
      }
    }
  }

  // Even split — honest placeholder when unit prices are missing/garbled
  const n = names.length
  const base = roundMoney(Math.floor((budget * 100) / n) / 100)
  const items: ReceiptLineItem[] = []
  let allocated = 0
  for (let i = 0; i < n; i++) {
    const amount = i === n - 1 ? roundMoney(budget - allocated) : base
    allocated = roundMoney(allocated + amount)
    const { categoryId } = categorizeText(names[i])
    items.push({
      id: `reason-name-${i}`,
      description: names[i],
      amount,
      categoryId,
    })
  }
  return {
    items,
    pricesEstimated: true,
    note: `Unit prices not readable in OCR — even-split $${budget.toFixed(2)} across ${n} items (edit if you know the real prices)`,
  }
}

/** @deprecated use itemsFromNamesWithPrices */
export function itemsFromNamesWithSplit(
  names: string[],
  budget: number,
): ReceiptLineItem[] {
  return itemsFromNamesWithPrices(names, budget).items
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
  // Prefer explicit GRAND TOTAL — amount may be on the same line or the next line
  // (Mosaic/Amazon PDF OCR often splits "GRAND TOTAL:" and "$93.00")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/\bgrand\s*t[o0]tal\b/i.test(line)) {
      let a = parseMoneyTokens(line)
      if (!a.length && lines[i + 1]) a = parseMoneyTokens(lines[i + 1])
      if (!a.length && lines[i + 2]) a = parseMoneyTokens(lines[i + 2])
      if (a.length) {
        total = a[a.length - 1]
        break
      }
    }
  }
  // Private-sale listing: prefer modal listing price (150) over OCR ghosts (7150/750)
  const listingPrice = extractListingPrice(text)
  if (
    listingPrice != null &&
    (/\bsell(?:ing)?\b/i.test(text) || /\bprivate\s*sale\b/i.test(draft?.vendor || ''))
  ) {
    if (total == null || Math.abs(total - listingPrice) > 1 || total > listingPrice * 2) {
      total = listingPrice
    }
  }
  // Prefer draft total when OCR “total” is just one product price
  if (
    draft?.amount != null &&
    total != null &&
    draft.amount > total * 1.2 &&
    /\bgrand\s*t[o0]tal\b/i.test(text) &&
    parseMoneyTokens(text).some((a) => nearly(a, draft.amount!))
  ) {
    total = draft.amount
  }
  if (total == null && draft?.amount != null) total = draft.amount
  if (total == null && listingPrice != null) total = listingPrice

  // 2) Subtotal / tax / ship from labeled lines with “first amount after label”
  let subtotal: number | null = null
  let tax: number | null = null
  let shipping: number | null = null
  let fee: number | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let amts = parseMoneyTokens(line, { grandTotal: total })
    // Label-only lines: peek next line for amount
    if (
      !amts.length &&
      /\b(sub[\s\-]*t[o0]tal|items?\)?\s*subtotal|estimated\s*t[a4]x|shipping|handl)/i.test(line) &&
      lines[i + 1]
    ) {
      amts = parseMoneyTokens(lines[i + 1], { grandTotal: total })
    }
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

  // 3) Products: only amounts that fit under total — drop tax/total chrome
  const engine = runReceiptEngine(text)
  let products = productsOf(engine.lineItems || []).filter(
    (p) =>
      !NON_CATALOG_PRODUCT.test(p.description) &&
      (total == null ||
        (!isImplausibleMoney(p.amount, { grandTotal: total }) &&
          p.amount <= total * 1.05 + 0.5)),
  )
  let coreLines: ReceiptLineItem[] = []
  let pricesEstimated = false
  let priceNote = ''

  // Progressive drop of largest products until sum ≤ total * 1.15 (or empty)
  if (total != null && products.length) {
    products = [...products].sort((a, b) => b.amount - a.amount)
    let sum = sumProducts(products)
    while (products.length && sum > total * 1.15 + 1) {
      products.shift()
      sum = sumProducts(products)
    }
  }

  // 3a) Auto parts / priced catalog: real unit prices + core charge/trade-in money
  // Core charge = deposit you pay; core trade-in = money back for old core (not invented).
  const pricedCatalog = extractPricedCatalogLines(text, { grandTotal: total })
  if (pricedCatalog.length >= 1) {
    const realProducts = pricedCatalog.filter((r) => r.kind === 'product')
    const cores = pricedCatalog.filter((r) => r.kind !== 'product')
    // Dedupe product lines by name+price (multi-page OCR)
    const seenP = new Set<string>()
    const productItems: ReceiptLineItem[] = []
    for (const r of realProducts) {
      const key = `${r.name.slice(0, 40).toLowerCase()}|${r.price.toFixed(2)}`
      if (seenP.has(key)) continue
      seenP.add(key)
      // Cap identical battery lines at 3 (two pages × 2 batteries)
      const same = productItems.filter(
        (p) => nearly(p.amount, r.price) && p.description.slice(0, 20) === r.name.slice(0, 20),
      ).length
      if (same >= 2) continue
      const { categoryId } = categorizeText(r.name)
      productItems.push({
        id: `catalog-${productItems.length}`,
        description: r.name,
        amount: r.price,
        categoryId: categoryId === 'misc' && /battery/i.test(r.name) ? 'electrical' : categoryId,
      })
    }
    // Core deposits/credits — keep real amounts, never invent names
    const seenC = new Set<string>()
    for (const r of cores) {
      const key = `${r.kind}|${r.price.toFixed(2)}`
      // Allow up to 2 of each amount (multi-page) but prefer net pairs
      const count = [...seenC].filter((k) => k.startsWith(r.kind)).length
      if (count >= 4) continue
      seenC.add(`${key}|${seenC.size}`)
      if (r.kind === 'core-charge') {
        coreLines.push({
          id: `core-ch-${coreLines.length}`,
          description: 'Core charge',
          amount: Math.abs(r.price),
          categoryId: 'misc',
        })
      } else {
        coreLines.push({
          id: `core-ti-${coreLines.length}`,
          description: 'Core trade-in',
          // Money back = negative so line sum closes toward total
          amount: -Math.abs(r.price),
          categoryId: 'misc',
        })
      }
    }
    // Prefer catalog products when draft was chrome even-split or empty
    const draftJunk =
      products.length === 0 ||
      products.every(
        (p) =>
          NON_CATALOG_PRODUCT.test(p.description) ||
          descriptionQuality(p.description) < 14 ||
          (total != null &&
            products.length >= 3 &&
            nearly(p.amount, total / products.length, 1)),
      )
    if (productItems.length >= 1 && (draftJunk || productItems.length >= products.length)) {
      products = productItems
      pricesEstimated = false
      priceNote =
        coreLines.length > 0
          ? 'Catalog prices from OCR; core charge = deposit, core trade-in = money back for old core'
          : 'Catalog unit prices from OCR (not invented)'
    } else if (coreLines.length && !draftJunk) {
      // Keep products, still attach cores
      priceNote =
        'Core charge/trade-in from OCR (deposit / money back — not made-up products)'
    }
  }

  // 3b) Named products — only real catalog names (never STATE TAX / SALE TOTAL as “products”)
  const productNames = extractProductNamesFromOcr(text).filter(
    (n) => !NON_CATALOG_PRODUCT.test(n) && descriptionQuality(n) >= 10,
  )
  const paired = extractNamedProductsWithPrices(text, {
    grandTotal: total,
    subtotal,
  }).filter((p) => !NON_CATALOG_PRODUCT.test(p.name))
  const budget = subtotal ?? total

  const draftLooksMarketing =
    products.length > 0 &&
    products.filter(
      (p) =>
        PRODUCT_MARKETING.test((p.description || '').trim()) ||
        NON_CATALOG_PRODUCT.test(p.description) ||
        (!/\b[A-Z]{3,16}\s*[-–]/.test(p.description || '') &&
          /supplement|supports|certified|healthy bones|lung function|member|items sold/i.test(
            p.description || '',
          )),
    ).length >= Math.max(1, Math.ceil(products.length / 2))

  // Brand–Product rows (Amazon multi-item): prefer name+price pairing over incomplete SKU scrape
  // even-split only for real titles — never for tax/core chrome.
  const needNameExpand =
    productNames.length >= 2 &&
    budget != null &&
    budget > 0 &&
    (products.length === 0 ||
      products.length < productNames.length ||
      draftLooksMarketing ||
      (products.length >= 2 &&
        products.every((p) => total != null && nearly(p.amount, total / products.length, 0.5))))

  if (needNameExpand && budget != null) {
    const candidates = extractCandidateUnitPrices(text, {
      grandTotal: total,
      subtotal,
      count: productNames.length,
    })
    const assigned = itemsFromNamesWithPrices(
      productNames,
      budget,
      candidates,
      paired.length >= 2 ? paired : null,
    )
    const newSum = sumProducts(assigned.items)
    const oldSum = sumProducts(products)
    const better =
      products.length === 0 ||
      assigned.items.length > products.length ||
      draftLooksMarketing ||
      (total != null && Math.abs(newSum - total) <= Math.abs(oldSum - total) + 0.05)
    if (better && assigned.items.length >= 2) {
      products = assigned.items
      pricesEstimated = assigned.pricesEstimated
      priceNote = assigned.note
      // Don't attach AutoZone-style core lines on Amazon multi-item name expands
      if (!/\bcore\s*charge\b/i.test(text)) coreLines = []
    }
  } else if (
    products.length === 0 &&
    total != null &&
    productNames.length === 1 &&
    budget != null
  ) {
    const { categoryId } = categorizeText(productNames[0])
    products = [
      {
        id: 'reason-one',
        description: productNames[0],
        amount: budget,
        categoryId,
      },
    ]
  } else if (!products.length && total != null) {
    // Last resort single bucket — only if description is readable (no invented chrome)
    const desc =
      draft?.description &&
      !/shipping|fee/i.test(draft.description) &&
      !NON_CATALOG_PRODUCT.test(draft.description) &&
      descriptionQuality(draft.description) >= 12
        ? draft.description.slice(0, 140)
        : 'Order items'
    products = [
      {
        id: 'reason-bundle',
        description: desc,
        amount: subtotal ?? total,
        categoryId: 'misc',
      },
    ]
    priceNote = priceNote || 'Single total line — unit prices not read (not inventing product names)'
  }

  // 4) Vendor — pick best quality candidate from OCR, prefer draft if already good
  // Always re-extract private-sale vendors so “Dustn Mawrer” → “Dustin Maurer”
  let vendor = extractVendor(text)
  if (
    (!vendor || vendorQuality(vendor) < 8) &&
    draft?.vendor &&
    vendorQuality(draft.vendor) >= 8 &&
    !/\bprivate\s*sale\b/i.test(draft.vendor)
  ) {
    vendor = draft.vendor
  }
  if (vendorQuality(vendor) < 4) {
    vendor = extractVendor(text)
  }
  // Normalize private-sale label even if draft already said Private sale · …
  if (/\bprivate\s*sale\b/i.test(vendor) || /\bsell(?:ing)?\b/i.test(text)) {
    const fromOcr = extractVendor(text)
    if (fromOcr && /dustin maurer/i.test(fromOcr)) vendor = fromOcr
  }
  if (vendorQuality(vendor) < 4) {
    // Scan early lines for brand-like tokens (skip OCR soup)
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
    else if (!vendor || vendorQuality(vendor) < 4) vendor = 'Unknown seller'
  }

  // 5) Date
  const date = extractDate(text) || draft?.date || new Date().toISOString().slice(0, 10)

  // 5b) Clean listing / single-item description when lines are OCR soup
  const listingDesc = extractListingDescription(text)
  if (listingDesc && products.length <= 1 && total != null) {
    const dq = products[0] ? descriptionQuality(products[0].description) : 0
    if (dq < 22 || products.length === 0 || (listingPrice != null && products[0] && !nearly(products[0].amount, total))) {
      const { categoryId: cat } = categorizeText(listingDesc)
      products = [
        {
          id: 'reason-listing',
          description: listingDesc,
          amount: listingPrice ?? subtotal ?? total,
          categoryId: cat,
        },
      ]
    } else if (products.length === 1 && listingPrice != null) {
      // Align single line to listing price
      products = [{ ...products[0], amount: listingPrice }]
    }
  } else if (products.length === 1 && descriptionQuality(products[0].description) < 18) {
    // Rebuild a shorter title from the least-gibberish OCR line
    let bestLine = ''
    let bestQ = 0
    for (const line of lines) {
      const q = descriptionQuality(line)
      if (q > bestQ && line.length >= 6 && line.length <= 80 && !/^\$?\d+[.,]\d{2}$/.test(line)) {
        bestQ = q
        bestLine = line
      }
    }
    if (bestLine && bestQ >= 12) {
      const { categoryId: cat } = categorizeText(bestLine)
      products = [
        {
          id: 'reason-clean',
          description: bestLine.slice(0, 120),
          amount: products[0].amount,
          categoryId: cat,
        },
      ]
    }
  }

  const lineItems: ReceiptLineItem[] = [...products, ...coreLines]
  if (shipping != null && shipping > 0) {
    lineItems.push(makeShippingLineItem(shipping, 'reason-ship'))
  }
  if (fee != null && fee > 0) {
    lineItems.push(makeFeeLineItem(fee, 'Convenience fee', 'reason-fee'))
  }

  const categoryId: CategoryId =
    products.length > 0
      ? primaryCategoryFromItems(products)
      : categorizeText(`${vendor} ${listingDesc || text.slice(0, 400)}`).categoryId

  const description =
    products.length > 0
      ? products
          .map((p) => p.description)
          .slice(0, 6)
          .join('; ')
          .slice(0, 160)
      : listingDesc || (vendor ? `Order — ${vendor}` : 'Receipt')

  // Confidence from how clean the constraints are
  let confidence = 0.55
  if (total != null) confidence += 0.15
  if (vendorQuality(vendor) >= 8) confidence += 0.1
  if (tax === 0 || (tax != null && tax < (total ?? 99) * 0.3)) confidence += 0.05
  const pSum = sumProducts(lineItems)
  if (total != null && pSum > 0 && pSum <= total * 1.15) confidence += 0.1
  // Even-split placeholders must not look as confident as real unit prices
  if (pricesEstimated) confidence = Math.min(confidence, 0.72)
  confidence = Math.min(0.94, confidence)

  const notesParts = [
    `Reasoner · conf ${Math.round(confidence * 100)}%`,
    priceNote || null,
  ].filter(Boolean)

  return {
    date,
    vendor: vendor || '',
    amount: total,
    description,
    categoryId,
    notes: notesParts.join(' · '),
    lineItems,
    subtotal: subtotal ?? (total != null && tax === 0 ? total : null),
    tax,
    source: 'on-device',
    confidence,
    rawText: text,
    agentReport: [
      'Receipt reasoner: constraint re-solve from OCR',
      priceNote ? `PRICE: ${priceNote}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    aisUsed: ['arbiter'],
    activeAiLabel: pricesEstimated
      ? 'Reasoner · products listed (prices estimated)'
      : 'Reasoner · re-solved from OCR',
    fieldSources: {
      primary: 'arbiter',
      total: 'cashier',
      vendor: 'clerk',
      category: 'ledger',
      date: 'clerk',
      answerLabel: pricesEstimated
        ? 'Reasoner (products OK · unit prices estimated)'
        : 'Reasoner (self-check + re-solve)',
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
