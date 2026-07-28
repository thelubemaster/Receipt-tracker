/**
 * On-device receipt memory — learns from saved (and corrected) purchases.
 * Free · local only · no network. Stored in IndexedDB meta.
 */
import type { CategoryId, Purchase, ReceiptLineItem } from './types'
import { isFeeLineItem, isShippingLineItem } from './agents/lineItemsAgent'

export type VendorMemory = {
  /** Normalized lookup key */
  key: string
  displayName: string
  categoryId: CategoryId
  /** User often had a convenience/service fee with this vendor */
  oftenHasFee: boolean
  /** Recent fee amounts (for this vendor), newest last */
  feeAmounts: number[]
  timesSeen: number
  lastSeen: string
}

/** Free-form text → category associations the user confirmed */
export type TextCategoryHint = {
  /** Lowercase tokens that co-occurred with this category */
  tokens: string[]
  categoryId: CategoryId
  hits: number
}

export type ReceiptMemory = {
  version: 1
  vendors: Record<string, VendorMemory>
  textHints: TextCategoryHint[]
  updatedAt: string
}

export function emptyReceiptMemory(): ReceiptMemory {
  return {
    version: 1,
    vendors: {},
    textHints: [],
    updatedAt: new Date(0).toISOString(),
  }
}

/** Normalize store names for matching: "HOME DEPOT #4821" → "home depot" */
export function normalizeVendorKey(vendor: string): string {
  return vendor
    .toLowerCase()
    .replace(/[#*]+/g, ' ')
    .replace(/\b(inc|llc|ltd|co|corp|store|the)\b\.?/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
}

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'item',
  'total',
  'subtotal',
  'tax',
  'payment',
  'invoice',
  'receipt',
  'store',
  'date',
  'cash',
  'card',
  'visa',
  'debit',
  'credit',
  'fee',
  'shipping',
])

export function tokenizeForMemory(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .split(/[\s/]+/)
    .filter((t) => t.length >= 4 && !STOP.has(t) && !/^\d+$/.test(t) && !/\d/.test(t))
    .slice(0, 24)
}

function feeFromLines(items: ReceiptLineItem[]): number | null {
  const fees = items.filter((i) => isFeeLineItem(i.description))
  if (!fees.length) return null
  return fees[0].amount
}

/**
 * Absorb one confirmed purchase into memory (call on Save).
 */
export function learnFromPurchase(memory: ReceiptMemory, purchase: Purchase): ReceiptMemory {
  const next: ReceiptMemory = {
    version: 1,
    vendors: { ...memory.vendors },
    textHints: memory.textHints.map((h) => ({ ...h, tokens: [...h.tokens] })),
    updatedAt: new Date().toISOString(),
  }

  const vendor = purchase.vendor?.trim()
  if (vendor && vendor.length >= 3) {
    const key = normalizeVendorKey(vendor)
    if (key.length >= 3) {
      const fee = feeFromLines(purchase.lineItems ?? [])
      const prev = next.vendors[key]
      const feeAmounts = prev?.feeAmounts ? [...prev.feeAmounts] : []
      if (fee != null && fee > 0) {
        feeAmounts.push(fee)
        while (feeAmounts.length > 8) feeAmounts.shift()
      }
      const oftenHasFee =
        fee != null
          ? true
          : prev
            ? prev.oftenHasFee && prev.timesSeen >= 2
            : false
      next.vendors[key] = {
        key,
        displayName: vendor.slice(0, 60),
        categoryId: purchase.categoryId || prev?.categoryId || 'misc',
        oftenHasFee: fee != null ? true : oftenHasFee,
        feeAmounts,
        timesSeen: (prev?.timesSeen ?? 0) + 1,
        lastSeen: purchase.date || next.updatedAt,
      }
    }
  }

  // Product text → category (skip shipping/fees)
  const productText = (purchase.lineItems ?? [])
    .filter((i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description))
    .map((i) => i.description)
    .join(' ')
  const blob = `${purchase.description} ${productText} ${purchase.vendor || ''}`
  const tokens = tokenizeForMemory(blob)
  if (tokens.length && purchase.categoryId && purchase.categoryId !== 'misc') {
    const existing = next.textHints.find((h) => h.categoryId === purchase.categoryId)
    if (existing) {
      const set = new Set([...existing.tokens, ...tokens])
      existing.tokens = Array.from(set).slice(0, 40)
      existing.hits += 1
    } else {
      next.textHints.push({
        tokens: tokens.slice(0, 16),
        categoryId: purchase.categoryId,
        hits: 1,
      })
    }
    // Cap hints
    next.textHints.sort((a, b) => b.hits - a.hits)
    next.textHints = next.textHints.slice(0, 40)
  }

  return next
}

export function findVendorMemory(
  memory: ReceiptMemory,
  vendorOrText: string,
): VendorMemory | null {
  const key = normalizeVendorKey(vendorOrText)
  if (!key) return null
  if (memory.vendors[key]) return memory.vendors[key]
  // Fuzzy: known key contained in OCR or vice versa
  for (const v of Object.values(memory.vendors)) {
    if (key.includes(v.key) || v.key.includes(key)) return v
    if (vendorOrText.toLowerCase().includes(v.key) && v.key.length >= 4) return v
  }
  return null
}

/**
 * Score free-form category hints against OCR / description text.
 */
export function categoryFromMemory(
  memory: ReceiptMemory,
  text: string,
): { categoryId: CategoryId; score: number } | null {
  const tokens = new Set(tokenizeForMemory(text))
  if (!tokens.size) return null
  let best: { categoryId: CategoryId; score: number } | null = null
  for (const h of memory.textHints) {
    let hits = 0
    for (const t of h.tokens) {
      if (tokens.has(t)) hits++
    }
    const score = hits * 2 + Math.min(3, h.hits)
    if (hits >= 1 && (!best || score > best.score)) {
      best = { categoryId: h.categoryId, score }
    }
  }
  return best && best.score >= 3 ? best : null
}

export function memoryStats(memory: ReceiptMemory): { vendors: number; hints: number } {
  return {
    vendors: Object.keys(memory.vendors).length,
    hints: memory.textHints.length,
  }
}
