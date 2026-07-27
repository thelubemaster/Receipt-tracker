import { CATEGORIES } from './categories'
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

export function categoryBreakdown(purchases: Purchase[]): CategoryTotal[] {
  const total = totalSpent(purchases)
  const map = new Map<CategoryId, number>()
  for (const p of purchases) {
    map.set(p.categoryId, (map.get(p.categoryId) ?? 0) + p.amount)
  }

  return CATEGORIES.map((c) => {
    const amount = Math.round((map.get(c.id) ?? 0) * 100) / 100
    const percent = total > 0 ? Math.round((amount / total) * 1000) / 10 : 0
    return {
      categoryId: c.id,
      label: c.label,
      color: c.color,
      amount,
      percent,
    }
  })
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
}
