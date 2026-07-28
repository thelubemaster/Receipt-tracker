/**
 * Re-apply free on-device categorization to saved receipts / line items,
 * then they cluster into the same home-screen groups the AI invents on scan.
 */
import { categorizeText } from './agents/keywords'
import {
  isFeeLineItem,
  isShippingLineItem,
  primaryCategoryFromItems,
} from './agents/lineItemsAgent'
import type { CategoryId, Purchase, ReceiptLineItem } from './types'

function productish(items: ReceiptLineItem[]): boolean {
  return items.some(
    (i) => !isShippingLineItem(i.description) && !isFeeLineItem(i.description),
  )
}

/** Re-run the same keyword / invent logic used at scan time. */
export function reclassifyPurchase(purchase: Purchase): Purchase {
  const lineItems = (purchase.lineItems ?? []).map((li) => {
    if (isShippingLineItem(li.description) || isFeeLineItem(li.description)) {
      return { ...li, categoryId: 'misc' as CategoryId }
    }
    const { categoryId } = categorizeText(li.description)
    return { ...li, categoryId }
  })

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
    categoryId = primaryCategoryFromItems(lineItems)
  } else {
    categoryId = categorizeText(textBlob).categoryId
  }

  // If lines were thin/misc, let overall receipt text invent a better group
  if (categoryId === 'misc') {
    const overall = categorizeText(textBlob)
    if (overall.score > 0 && overall.categoryId !== 'misc') {
      categoryId = overall.categoryId
    }
  }

  return {
    ...purchase,
    lineItems,
    categoryId,
  }
}

function sameLines(a: ReceiptLineItem[], b: ReceiptLineItem[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false
    if (a[i].categoryId !== b[i].categoryId) return false
    if (a[i].description !== b[i].description) return false
    if (Math.abs(a[i].amount - b[i].amount) > 0.001) return false
  }
  return true
}

export type RegroupResult = {
  purchases: Purchase[]
  /** How many receipts had category or line-item categories change */
  changed: number
  /** Category ids / labels to absorb into settings */
  labels: string[]
}

/**
 * Regroup every saved receipt with the current free categorizer.
 * Does not write to IndexedDB — caller saves.
 */
export function regroupAllPurchases(purchases: Purchase[]): RegroupResult {
  const now = new Date().toISOString()
  let changed = 0
  const labels: string[] = []
  const next = purchases.map((p) => {
    const r = reclassifyPurchase(p)
    labels.push(r.categoryId)
    for (const li of r.lineItems) labels.push(li.categoryId)
    const didChange =
      r.categoryId !== p.categoryId || !sameLines(r.lineItems, p.lineItems ?? [])
    if (didChange) {
      changed++
      return { ...r, updatedAt: now }
    }
    return r
  })
  return { purchases: next, changed, labels }
}
