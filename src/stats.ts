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
  const total = totalSpent(purchases)
  const map = new Map<CategoryId, number>()
  for (const p of purchases) {
    const id = p.categoryId || 'misc'
    map.set(id, (map.get(id) ?? 0) + p.amount)
  }

  // Also roll up line-item categories when present (richer view later);
  // purchase-level category is the home chart for now.
  const known = allCategories(custom)
  const rows: CategoryTotal[] = []

  for (const [id, amountRaw] of map) {
    const amount = Math.round(amountRaw * 100) / 100
    if (amount <= 0) continue
    const cat = getCategory(id, known)
    rows.push({
      categoryId: id,
      label: cat.label,
      color: cat.color,
      amount,
      percent: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
    })
  }

  return rows.sort((a, b) => b.amount - a.amount)
}
