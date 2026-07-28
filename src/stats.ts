import { allCategories, getCategory, type Category } from './categories'
import { sumAmounts } from './money'
import type { CategoryId, Purchase } from './types'

export interface CategoryTotal {
  categoryId: CategoryId
  label: string
  color: string
  amount: number
  percent: number
}

/** Home-screen group: category bucket + the receipts inside it. */
export interface PurchaseGroup {
  categoryId: CategoryId
  label: string
  color: string
  amount: number
  percent: number
  count: number
  purchases: Purchase[]
}

export function totalSpent(purchases: Purchase[]): number {
  return sumAmounts(purchases.map((p) => p.amount))
}

/**
 * Breakdown by whatever category ids appear in purchases (builtins + free-form).
 */
export function categoryBreakdown(
  purchases: Purchase[],
  custom: Category[] = [],
): CategoryTotal[] {
  return groupPurchasesByCategory(purchases, custom).map((g) => ({
    categoryId: g.categoryId,
    label: g.label,
    color: g.color,
    amount: g.amount,
    percent: g.percent,
  }))
}

/**
 * Group receipts for the main screen (AI / free-form category buckets).
 * Sorted by spend descending.
 */
export function groupPurchasesByCategory(
  purchases: Purchase[],
  custom: Category[] = [],
): PurchaseGroup[] {
  const total = totalSpent(purchases)
  const map = new Map<CategoryId, Purchase[]>()
  for (const p of purchases) {
    const id = p.categoryId || 'misc'
    const arr = map.get(id) ?? []
    arr.push(p)
    map.set(id, arr)
  }

  const known = allCategories(custom)
  const groups: PurchaseGroup[] = []

  for (const [id, list] of map) {
    const amount = Math.round(sumAmounts(list.map((p) => p.amount)) * 100) / 100
    if (amount <= 0 && list.length === 0) continue
    const cat = getCategory(id, known)
    // Keep receipt order (already date-desc from listPurchases)
    groups.push({
      categoryId: id,
      label: cat.label,
      color: cat.color,
      amount,
      percent: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
      count: list.length,
      purchases: list,
    })
  }

  return groups.sort((a, b) => b.amount - a.amount || b.count - a.count)
}
