/**
 * User-controlled category rename / merge.
 * Rewrites purchase + line-item category ids; optional custom list updates.
 */
import {
  BUILTIN_CATEGORIES,
  colorForCategoryId,
  getCategory,
  makeCustomCategory,
  slugifyCategory,
  type Category,
} from './categories'
import type { Purchase } from './types'

export type CategoryUsage = {
  id: string
  label: string
  color: string
  /** Receipts with this as primary category */
  receiptCount: number
  /** Line items with this category */
  lineCount: number
}

/** Categories actually used in a purchase list (for manage UI). */
export function listUsedCategories(
  purchases: Purchase[],
  custom: Category[] = [],
): CategoryUsage[] {
  const receiptCounts = new Map<string, number>()
  const lineCounts = new Map<string, number>()
  for (const p of purchases) {
    const id = p.categoryId || 'misc'
    receiptCounts.set(id, (receiptCounts.get(id) || 0) + 1)
    for (const li of p.lineItems ?? []) {
      const lid = li.categoryId || 'misc'
      lineCounts.set(lid, (lineCounts.get(lid) || 0) + 1)
    }
  }
  const ids = new Set([...receiptCounts.keys(), ...lineCounts.keys()])
  const rows: CategoryUsage[] = []
  for (const id of ids) {
    const cat = getCategory(id, custom)
    rows.push({
      id,
      label: cat.label,
      color: cat.color,
      receiptCount: receiptCounts.get(id) || 0,
      lineCount: lineCounts.get(id) || 0,
    })
  }
  return rows.sort(
    (a, b) =>
      b.receiptCount + b.lineCount - (a.receiptCount + a.lineCount) ||
      a.label.localeCompare(b.label),
  )
}

/** Apply fromId → toId on one purchase (receipt + line items). */
export function remapPurchaseCategory(
  purchase: Purchase,
  fromId: string,
  toId: string,
): Purchase {
  if (!fromId || !toId || fromId === toId) return purchase
  const categoryId = purchase.categoryId === fromId ? toId : purchase.categoryId
  let lineChanged = false
  const lineItems = (purchase.lineItems ?? []).map((li) => {
    if (li.categoryId === fromId) {
      lineChanged = true
      return { ...li, categoryId: toId }
    }
    return li
  })
  if (categoryId === purchase.categoryId && !lineChanged) {
    return purchase
  }
  return {
    ...purchase,
    categoryId,
    lineItems,
    updatedAt: new Date().toISOString(),
  }
}

export function remapPurchasesCategory(
  purchases: Purchase[],
  fromId: string,
  toId: string,
): { purchases: Purchase[]; changed: number } {
  let changed = 0
  const next = purchases.map((p) => {
    const r = remapPurchaseCategory(p, fromId, toId)
    if (r !== p) changed++
    return r
  })
  return { purchases: next, changed }
}

/**
 * Rename a category: new label (and id slug). Remaps all purchases from old id.
 * Builtin ids keep their id but can still merge *into* a new custom name.
 */
export function planCategoryRename(
  fromId: string,
  newLabel: string,
  custom: Category[] = [],
): {
  toId: string
  toLabel: string
  nextCustom: Category[]
} {
  const clean = newLabel.trim() || getCategory(fromId, custom).label
  const cat = makeCustomCategory(clean)
  // Renaming a builtin "engine" to "Engine work" → new custom id engine-work
  // Renaming custom "towing" label only → may keep same id if slug matches
  let toId = cat.id
  let toLabel = cat.label
  if (BUILTIN_CATEGORIES.some((b) => b.id === fromId) && slugifyCategory(clean) === fromId) {
    toId = fromId
    toLabel = BUILTIN_CATEGORIES.find((b) => b.id === fromId)!.label
  }

  let nextCustom = [...custom]
  // Remove old custom entry if id changes
  if (fromId !== toId) {
    nextCustom = nextCustom.filter((c) => c.id !== fromId)
  }
  // Upsert target as custom if not builtin
  if (!BUILTIN_CATEGORIES.some((b) => b.id === toId)) {
    const existing = nextCustom.find((c) => c.id === toId)
    if (existing) {
      nextCustom = nextCustom.map((c) =>
        c.id === toId ? { ...c, label: toLabel, color: c.color || colorForCategoryId(toId) } : c,
      )
    } else {
      nextCustom = [
        ...nextCustom,
        {
          id: toId,
          label: toLabel,
          color: colorForCategoryId(toId),
          custom: true,
        },
      ]
    }
  }
  return { toId, toLabel, nextCustom }
}

/**
 * Merge one or more source category ids into a target (existing id or new label).
 */
export function planCategoryMerge(
  fromIds: string[],
  target: { id?: string; label?: string },
  custom: Category[] = [],
): {
  toId: string
  toLabel: string
  nextCustom: Category[]
  fromIds: string[]
} {
  const sources = [...new Set(fromIds.filter(Boolean))]
  let toId = (target.id || '').trim()
  let toLabel = (target.label || '').trim()
  let nextCustom = [...custom]

  if (!toId && toLabel) {
    const planned = planCategoryRename(sources[0] || 'misc', toLabel, custom)
    toId = planned.toId
    toLabel = planned.toLabel
    nextCustom = planned.nextCustom
  } else if (toId) {
    const cat = getCategory(toId, custom)
    toLabel = toLabel || cat.label
    if (!BUILTIN_CATEGORIES.some((b) => b.id === toId)) {
      if (!nextCustom.some((c) => c.id === toId)) {
        nextCustom = [
          ...nextCustom,
          { id: toId, label: toLabel, color: colorForCategoryId(toId), custom: true },
        ]
      }
    }
  } else {
    toId = 'misc'
    toLabel = 'Misc'
  }

  // Drop custom entries for sources that were merged away (not the target)
  nextCustom = nextCustom.filter((c) => c.id === toId || !sources.includes(c.id))

  return {
    toId,
    toLabel,
    nextCustom,
    fromIds: sources.filter((id) => id !== toId),
  }
}
