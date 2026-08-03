/**
 * Regroup saved receipts on the home screen.
 *
 * Does NOT re-run AI invent / keyword reclassification on receipts that already
 * have a category. That would overwrite what the scan AIs already marked.
 *
 * Instead:
 * 1. Merge *alike* category labels so similar receipts land in one home group
 *    (e.g. "engine" + "engine-parts" → same bucket).
 * 2. Only invent a category for receipts still stuck on "misc" with no real
 *    line-item categories — never rewrite an AI/user category.
 * 3. Line-item categories are left untouched.
 */
import { categorizeText } from './agents/keywords'
import {
  isFeeLineItem,
  isShippingLineItem,
  primaryCategoryFromItems,
} from './agents/lineItemsAgent'
import { humanizeCategoryId } from './categories'
import type { CategoryId, Purchase, ReceiptLineItem } from './types'

function productish(items: ReceiptLineItem[]): boolean {
  return items.some(
    (i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description),
  )
}

/** True when the receipt already has a real category (AI or user), not empty/misc. */
export function hasAssignedCategory(purchase: Purchase): boolean {
  const id = (purchase.categoryId || '').trim()
  if (id && id !== 'misc') return true
  return (purchase.lineItems ?? []).some((li) => {
    if (isShippingLineItem(li.description) || isFeeLineItem(li.description)) return false
    const c = (li.categoryId || '').trim()
    return !!c && c !== 'misc'
  })
}

/**
 * Only used for receipts still on misc with no useful line categories.
 * Never call this to overwrite an existing AI category.
 */
export function classifyMiscOnly(purchase: Purchase): Purchase {
  if (hasAssignedCategory(purchase)) return purchase

  const lineItems = purchase.lineItems ?? []
  const textBlob = [
    purchase.description,
    purchase.vendor,
    purchase.notes,
    ...lineItems.map((l) => l.description),
  ]
    .filter(Boolean)
    .join(' ')

  let categoryId: CategoryId
  if (productish(lineItems)) {
    // Prefer primary from existing line cats if any were set
    const fromLines = primaryCategoryFromItems(lineItems)
    if (fromLines && fromLines !== 'misc') {
      categoryId = fromLines
    } else {
      // Invent from product text — receipt was never categorized
      categoryId = categorizeText(textBlob).categoryId
    }
  } else {
    categoryId = categorizeText(textBlob).categoryId
  }

  if (categoryId === 'misc') {
    const overall = categorizeText(textBlob)
    if (overall.score > 0 && overall.categoryId !== 'misc') {
      categoryId = overall.categoryId
    }
  }

  if (categoryId === purchase.categoryId) return purchase
  return {
    ...purchase,
    // Keep every line item exactly as AI/user left it
    lineItems,
    categoryId,
  }
}

/** Tokens for similarity (engine-powertrain → [engine, powertrain]). */
function categoryTokens(id: string): Set<string> {
  const raw = (id || 'misc')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const stop = new Set([
    'and',
    'or',
    'the',
    'a',
    'of',
    'for',
    'to',
    'parts',
    'part',
    'system',
    'systems',
    'misc',
    'other',
    'general',
  ])
  const toks = raw.split(/\s+/).filter((t) => t.length > 1 && !stop.has(t))
  return new Set(toks.length ? toks : raw ? [raw] : ['misc'])
}

/**
 * Related category families for *display* grouping only.
 * "engine" and "powertrain" share no letters, so token overlap alone fails —
 * these synonyms put them in one visual group without rewriting receipt categories.
 */
const CATEGORY_FAMILIES: string[][] = [
  [
    'engine',
    'engines',
    'powertrain',
    'power-train',
    'engine-powertrain',
    'engine-and-powertrain',
    'engineparts',
    'engine-parts',
    'motor',
    'motors',
    'drivetrain',
    'drive-train',
  ],
  [
    'electrical',
    'electric',
    'electronics',
    'wiring',
    'sensors',
    'sensor',
    'electrical-and-sensors',
  ],
  [
    'fuel',
    'fuel-system',
    'fuelsystem',
    'diesel',
    'filters-and-fluids',
    'filters',
    'fluids',
    'oil',
  ],
  ['brakes', 'brake', 'suspension', 'brakes-and-suspension'],
  ['cooling', 'coolant', 'radiator', 'cooling-system'],
  ['exhaust', 'emissions', 'exhaust-and-emissions', 'dpf'],
  ['towing', 'tow', 'hitch', 'trailer', 'towing-and-hitch'],
  ['body', 'exterior', 'body-and-exterior'],
  ['structure', 'framing', 'lumber', 'metal'],
  ['insulation', 'foam'],
  ['plumbing', 'pipe', 'pipes'],
  ['solar', 'battery', 'batteries', 'electrical-solar'],
]

/** Family key if this category id/label belongs to a known related set. */
export function categoryFamily(id: string): string | null {
  const norm = (id || '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (!norm || norm === 'misc') return null
  const labelNorm = humanizeCategoryId(id)
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  for (const fam of CATEGORY_FAMILIES) {
    const key = fam[0]
    for (const term of fam) {
      if (
        norm === term ||
        labelNorm === term ||
        norm.includes(term) ||
        term.includes(norm) ||
        labelNorm.includes(term) ||
        term.includes(labelNorm)
      ) {
        return key
      }
    }
    // token hit: "engine-and-powertrain" tokens engine + powertrain
    const toks = categoryTokens(id)
    if ([...toks].some((t) => fam.includes(t))) return key
  }
  return null
}

/** How alike two category ids are (0–1). Display grouping only. */
export function categorySimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  if (la === lb) return 1

  // Same known family (engine ↔ powertrain, engine ↔ Engine & Powertrain, …)
  const fa = categoryFamily(a)
  const fb = categoryFamily(b)
  if (fa && fb && fa === fb) return 0.92

  // prefix / contains (engine vs engine-parts)
  if (la.startsWith(lb) || lb.startsWith(la) || la.includes(lb) || lb.includes(la)) {
    const shorter = Math.min(la.length, lb.length)
    const longer = Math.max(la.length, lb.length)
    return Math.max(0.72, shorter / longer)
  }
  // Label text overlap (humanized)
  const ha = humanizeCategoryId(a).toLowerCase()
  const hb = humanizeCategoryId(b).toLowerCase()
  if (ha === hb) return 1
  if (ha.includes(hb) || hb.includes(ha)) {
    const shorter = Math.min(ha.length, hb.length)
    const longer = Math.max(ha.length, hb.length)
    return Math.max(0.7, shorter / longer)
  }

  const ta = categoryTokens(a)
  const tb = categoryTokens(b)
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  return union > 0 ? inter / union : 0
}

/** Lower threshold so family matches and soft overlaps still cluster. */
const ALIKE_THRESHOLD = 0.5

/**
 * Build a map: each category id → canonical id to merge into.
 * Prefers the id used by the most receipts; ties break toward shorter/builtin-ish.
 */
export function buildCategoryMergeMap(
  purchases: Purchase[],
  knownLabels: Map<string, string> = new Map(),
): Map<string, string> {
  const counts = new Map<string, number>()
  for (const p of purchases) {
    const id = p.categoryId || 'misc'
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  const ids = [...counts.keys()].filter((id) => id && id !== 'misc')
  // Union-find style clustering of alike ids
  const parent = new Map<string, string>()
  for (const id of ids) parent.set(id, id)

  function find(x: string): string {
    let p = parent.get(x) || x
    while (parent.get(p) && parent.get(p) !== p) p = parent.get(p)!
    // path compress
    let cur = x
    while (cur !== p) {
      const n = parent.get(cur) || cur
      parent.set(cur, p)
      cur = n
    }
    return p
  }
  function union(a: string, b: string) {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    // Prefer higher count, then shorter id
    const ca = counts.get(ra) || 0
    const cb = counts.get(rb) || 0
    if (cb > ca || (cb === ca && rb.length < ra.length)) parent.set(ra, rb)
    else parent.set(rb, ra)
  }

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (categorySimilarity(ids[i], ids[j]) >= ALIKE_THRESHOLD) {
        union(ids[i], ids[j])
      }
    }
  }

  const map = new Map<string, string>()
  map.set('misc', 'misc')
  for (const id of ids) {
    map.set(id, find(id))
  }
  // Attach human labels for debug/absorb (canonical keeps its id)
  for (const [from, to] of map) {
    if (!knownLabels.has(to)) {
      knownLabels.set(to, humanizeCategoryId(to))
    }
    if (!knownLabels.has(from)) {
      knownLabels.set(from, humanizeCategoryId(from))
    }
  }
  return map
}

/**
 * @deprecated Use classifyMiscOnly — kept name so older tests/imports still compile
 * while behavior no longer overwrites AI categories.
 */
export function reclassifyPurchase(purchase: Purchase): Purchase {
  return classifyMiscOnly(purchase)
}

export type RegroupResult = {
  purchases: Purchase[]
  /** How many receipts had only their group (categoryId) adjusted for clustering */
  changed: number
  /** Category ids / labels to absorb into settings */
  labels: string[]
  /** How many were left untouched because AI/user already categorized them */
  preserved: number
  /** How many misc receipts got a first category */
  filledMisc: number
  /** How many were moved only to merge with an alike group */
  mergedAlike: number
}

/**
 * Regroup for the home screen without overwriting AI category marks.
 * Does not write to IndexedDB — caller saves.
 */
export function regroupAllPurchases(purchases: Purchase[]): RegroupResult {
  const now = new Date().toISOString()
  let filledMisc = 0
  let preserved = 0

  // Pass 1: only fill misc; never rewrite assigned categories or line items
  const afterFill = purchases.map((p) => {
    if (hasAssignedCategory(p)) {
      preserved++
      return p
    }
    const next = classifyMiscOnly(p)
    if (next.categoryId !== p.categoryId) {
      filledMisc++
      return { ...next, updatedAt: now }
    }
    return p
  })

  // Pass 2: merge alike category ids so similar receipts share one group
  const mergeMap = buildCategoryMergeMap(afterFill)
  let mergedAlike = 0
  const next = afterFill.map((p) => {
    const current = p.categoryId || 'misc'
    const canonical = mergeMap.get(current) || current
    if (canonical !== current) {
      mergedAlike++
      return { ...p, categoryId: canonical, updatedAt: now }
    }
    return p
  })

  const labels: string[] = []
  for (const p of next) {
    labels.push(p.categoryId || 'misc')
    for (const li of p.lineItems ?? []) labels.push(li.categoryId)
  }

  const changed = filledMisc + mergedAlike
  return {
    purchases: next,
    changed,
    labels,
    preserved,
    filledMisc,
    mergedAlike,
  }
}

/** Helper for UI: label of a category id if known. */
export function regroupCategoryLabel(id: string): string {
  return humanizeCategoryId(id)
}
