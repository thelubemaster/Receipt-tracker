/**
 * Flexible categories — built-in presets + free-form labels the AI / user invents.
 * Custom categories persist in settings so similar spends group over time.
 */

export interface Category {
  id: string
  label: string
  color: string
  /** true when user or AI created it (not a schoolie build-out preset) */
  custom?: boolean
}

/** Schoolie conversion presets — still available, not required. */
export const BUILTIN_CATEGORIES: Category[] = [
  { id: 'structure', label: 'Structure & Body', color: '#c45c26' },
  { id: 'insulation', label: 'Insulation', color: '#6b8f71' },
  { id: 'electrical', label: 'Electrical', color: '#e6b422' },
  { id: 'solar', label: 'Solar & Power', color: '#f0a202' },
  { id: 'plumbing', label: 'Plumbing', color: '#3d7ea6' },
  { id: 'propane', label: 'Propane & Heat', color: '#d94f30' },
  { id: 'interior', label: 'Interior Buildout', color: '#8b6f47' },
  { id: 'kitchen', label: 'Kitchen', color: '#b5651d' },
  { id: 'bathroom', label: 'Bathroom', color: '#5b8fa8' },
  { id: 'flooring', label: 'Flooring', color: '#7a5c45' },
  { id: 'windows', label: 'Windows & Doors', color: '#4a90a4' },
  { id: 'furniture', label: 'Furniture', color: '#9c6644' },
  { id: 'tools', label: 'Tools & Supplies', color: '#5c6b73' },
  { id: 'safety', label: 'Safety', color: '#c0392b' },
  { id: 'fuel', label: 'Fuel & Travel', color: '#2c3e50' },
  { id: 'engine', label: 'Engine & Powertrain', color: '#6d4c41' },
  { id: 'towing', label: 'Towing & Roadside', color: '#455a64' },
  { id: 'misc', label: 'Misc', color: '#7f8c8d' },
]

/** @deprecated use BUILTIN_CATEGORIES — kept for older imports */
export const CATEGORIES = BUILTIN_CATEGORIES

export const CATEGORY_IDS = BUILTIN_CATEGORIES.map((c) => c.id)

const PALETTE = [
  '#c45c26',
  '#6b8f71',
  '#e6b422',
  '#f0a202',
  '#3d7ea6',
  '#d94f30',
  '#8b6f47',
  '#b5651d',
  '#5b8fa8',
  '#7a5c45',
  '#4a90a4',
  '#9c6644',
  '#5c6b73',
  '#ab47bc',
  '#26a69a',
  '#ef6c00',
  '#5c6bc0',
  '#8d6e63',
]

export function slugifyCategory(label: string): string {
  const s = label
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return s || 'misc'
}

export function colorForCategoryId(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function humanizeCategoryId(id: string): string {
  if (!id) return 'Misc'
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function makeCustomCategory(label: string): Category {
  const clean = label.trim() || 'Misc'
  const id = slugifyCategory(clean)
  return {
    id,
    label: clean,
    color: colorForCategoryId(id),
    custom: true,
  }
}

/** Resolve a category id using builtins + optional custom list from settings. */
export function getCategory(
  id: string,
  custom: Category[] = [],
): Category {
  const fromCustom = custom.find((c) => c.id === id)
  if (fromCustom) return fromCustom
  const fromBuiltin = BUILTIN_CATEGORIES.find((c) => c.id === id)
  if (fromBuiltin) return fromBuiltin
  // Free-form id we haven't stored yet
  return {
    id,
    label: humanizeCategoryId(id),
    color: colorForCategoryId(id),
    custom: true,
  }
}

export function isCategoryId(value: string): boolean {
  return typeof value === 'string' && value.length > 0
}

/** Merge builtins + customs (customs override same id). */
export function allCategories(custom: Category[] = []): Category[] {
  const map = new Map<string, Category>()
  for (const c of BUILTIN_CATEGORIES) map.set(c.id, c)
  for (const c of custom) map.set(c.id, { ...c, custom: true })
  return [...map.values()]
}

/**
 * Register labels used on a purchase into the custom list (deduped).
 * Returns updated custom categories.
 */
export function absorbCategoryLabels(
  custom: Category[],
  labelsOrIds: string[],
): Category[] {
  const map = new Map<string, Category>()
  for (const c of custom) map.set(c.id, c)
  for (const raw of labelsOrIds) {
    if (!raw || raw === 'misc') continue
    const asBuiltin = BUILTIN_CATEGORIES.find((c) => c.id === raw || c.label === raw)
    if (asBuiltin) continue
    const cat = makeCustomCategory(raw.includes('-') && raw === slugifyCategory(raw) ? humanizeCategoryId(raw) : raw)
    if (!map.has(cat.id) && !BUILTIN_CATEGORIES.some((b) => b.id === cat.id)) {
      map.set(cat.id, cat)
    }
  }
  return [...map.values()]
}
