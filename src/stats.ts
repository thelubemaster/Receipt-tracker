import { allCategories, getCategory, humanizeCategoryId, type Category } from './categories'
import { sumAmounts } from './money'
import { categorySimilarity, buildCategoryMergeMap, categoryFamily } from './regroup'
import type { CategoryId, Purchase } from './types'

export interface CategoryTotal {
  categoryId: CategoryId
  label: string
  color: string
  amount: number
  percent: number
}

/** Home-screen group: visual bucket (may hold several real categories). */
export interface PurchaseGroup {
  /** Display key for the group (stable for expand/collapse) */
  categoryId: CategoryId
  label: string
  color: string
  amount: number
  percent: number
  count: number
  purchases: Purchase[]
  /**
   * Real category ids inside this visual group (unchanged on each receipt).
   * Empty when the group is a single exact category.
   */
  memberCategoryIds?: CategoryId[]
}

export function totalSpent(purchases: Purchase[]): number {
  return sumAmounts(purchases.map((p) => p.amount))
}

/**
 * Breakdown by whatever category ids appear in purchases (builtins + free-form).
 * Exact categories — does not merge or rewrite receipts.
 */
export function categoryBreakdown(
  purchases: Purchase[],
  custom: Category[] = [],
): CategoryTotal[] {
  return groupPurchasesByCategoryExact(purchases, custom).map((g) => ({
    categoryId: g.categoryId,
    label: g.label,
    color: g.color,
    amount: g.amount,
    percent: g.percent,
  }))
}

/**
 * Exact groups: one bucket per categoryId as stored on the receipt.
 * Does not change any purchase.
 */
export function groupPurchasesByCategoryExact(
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

/**
 * @deprecated Prefer groupPurchasesForDisplay — kept for imports/tests.
 */
export function groupPurchasesByCategory(
  purchases: Purchase[],
  custom: Category[] = [],
): PurchaseGroup[] {
  return groupPurchasesForDisplay(purchases, custom)
}

/**
 * Visual groups for the project home screen.
 *
 * - Never changes purchase.categoryId or line items
 * - Puts similar categories in the same group (engine + engine-parts, etc.)
 * - Also groups same-vendor receipts when both are misc/weak
 * - Each receipt still shows its real category in the list
 */
export function groupPurchasesForDisplay(
  purchases: Purchase[],
  custom: Category[] = [],
): PurchaseGroup[] {
  if (!purchases.length) return []

  const total = totalSpent(purchases)
  const known = allCategories(custom)

  // Map each category id → display cluster id (no DB writes)
  const mergeMap = buildCategoryMergeMap(purchases)
  // Also fold pure misc into a neighbor when same vendor has a real category
  const byVendor = new Map<string, Purchase[]>()
  for (const p of purchases) {
    const v = (p.vendor || '').trim().toLowerCase()
    if (!v) continue
    const arr = byVendor.get(v) ?? []
    arr.push(p)
    byVendor.set(v, arr)
  }
  for (const list of byVendor.values()) {
    const strong = list.find((p) => {
      const id = p.categoryId || 'misc'
      return id !== 'misc'
    })
    if (!strong) continue
    const strongCanon = mergeMap.get(strong.categoryId || 'misc') || strong.categoryId || 'misc'
    for (const p of list) {
      const id = p.categoryId || 'misc'
      if (id === 'misc') {
        // Display-only: show misc under same-vendor group when possible
        mergeMap.set(`__vendor_misc_${p.id}`, strongCanon)
      }
    }
  }

  const buckets = new Map<string, Purchase[]>()
  for (const p of purchases) {
    const raw = p.categoryId || 'misc'
    let canon = mergeMap.get(raw) || raw
    if (raw === 'misc') {
      const vendorKey = `__vendor_misc_${p.id}`
      if (mergeMap.has(vendorKey)) canon = mergeMap.get(vendorKey)!
    }
    const arr = buckets.get(canon) ?? []
    arr.push(p)
    buckets.set(canon, arr)
  }

  const groups: PurchaseGroup[] = []
  for (const [canon, list] of buckets) {
    const amount = Math.round(sumAmounts(list.map((p) => p.amount)) * 100) / 100
    const memberIds = [
      ...new Set(list.map((p) => p.categoryId || 'misc')),
    ].sort()
    // Label: most common real category in the bucket, else humanize canon
    const counts = new Map<string, number>()
    for (const p of list) {
      const id = p.categoryId || 'misc'
      counts.set(id, (counts.get(id) || 0) + 1)
    }
    let topId = canon
    let topN = 0
    for (const [id, n] of counts) {
      if (n > topN || (n === topN && id !== 'misc' && topId === 'misc')) {
        topN = n
        topId = id
      }
    }
    // Same family (engine + powertrain) → prefer family key label ("Engine & Powertrain")
    const fams = [
      ...new Set(
        memberIds
          .map((id) => categoryFamily(id))
          .filter((f): f is string => !!f),
      ),
    ]
    if (fams.length === 1) {
      topId = fams[0]
    }
    const cat = getCategory(topId, known)
    // When several real categories sit together, show them in the title
    let label = cat.label
    if (memberIds.length > 1) {
      const memberLabels = [
        ...new Set(memberIds.map((id) => getCategory(id, known).label)),
      ]
      if (memberLabels.length > 1) {
        // Prefer family name when it already covers the idea; still note members
        const covered = memberLabels.every(
          (ml) =>
            ml.toLowerCase() === label.toLowerCase() ||
            label.toLowerCase().includes(ml.toLowerCase()) ||
            ml.toLowerCase().includes(label.toLowerCase().split(/\s+/)[0] || ''),
        )
        if (!covered) {
          label = `${label} · ${memberLabels.filter((ml) => ml !== cat.label).join(' · ')}`
        }
      }
    }

    groups.push({
      categoryId: `display:${canon}`,
      label,
      color: cat.color,
      amount,
      percent: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
      count: list.length,
      purchases: list,
      memberCategoryIds: memberIds,
    })
  }

  return groups.sort((a, b) => b.amount - a.amount || b.count - a.count)
}

/** Short label for a receipt’s own category (for list rows). */
export function purchaseCategoryLabel(
  purchase: Purchase,
  custom: Category[] = [],
): string {
  return getCategory(purchase.categoryId || 'misc', custom).label
}

// re-export for tests that import similarity via stats historically
export { categorySimilarity, humanizeCategoryId }
