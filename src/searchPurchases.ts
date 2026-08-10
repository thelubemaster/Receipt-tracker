/**
 * Filter purchases by free-text query (vendor, description, category, lines, amount, date).
 */
import { getCategory, type Category } from './categories'
import type { Purchase } from './types'

function haystack(p: Purchase, custom: Category[]): string {
  const cat = getCategory(p.categoryId || 'misc', custom).label
  const lines = (p.lineItems ?? [])
    .map((li) => `${li.description} ${li.categoryId} ${getCategory(li.categoryId, custom).label}`)
    .join(' ')
  return [
    p.vendor,
    p.description,
    p.notes,
    p.date,
    p.categoryId,
    cat,
    String(p.amount),
    p.amount.toFixed(2),
    lines,
  ]
    .join(' ')
    .toLowerCase()
}

/** True if purchase matches every whitespace-separated token in query. */
export function purchaseMatchesQuery(
  purchase: Purchase,
  query: string,
  custom: Category[] = [],
): boolean {
  const q = (query || '').trim().toLowerCase()
  if (!q) return true
  const tokens = q.split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const h = haystack(purchase, custom)
  return tokens.every((t) => h.includes(t))
}

export function filterPurchases(
  purchases: Purchase[],
  query: string,
  custom: Category[] = [],
): Purchase[] {
  const q = (query || '').trim()
  if (!q) return purchases
  return purchases.filter((p) => purchaseMatchesQuery(p, q, custom))
}
