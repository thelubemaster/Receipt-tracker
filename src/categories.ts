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

/**
 * Map free-form / AI slug variants onto a stable builtin id when they mean
 * the same thing. Example: "engine-and-powertrain" → "engine"
 * (slugify turns "Engine & Powertrain" into "engine-and-powertrain").
 * Display and invent only — does not rewrite saved purchases by itself.
 */
const CATEGORY_ID_ALIASES: Record<string, string> = {
  // Engine & Powertrain family
  engine: 'engine',
  engines: 'engine',
  powertrain: 'engine',
  'power-train': 'engine',
  'engine-powertrain': 'engine',
  'engine-and-powertrain': 'engine',
  engineparts: 'engine',
  'engine-parts': 'engine',
  motor: 'engine',
  motors: 'engine',
  drivetrain: 'engine',
  'drive-train': 'engine',
  // Clear free-form ↔ preset (only obvious synonyms — not loose words like "battery")
  electrical: 'electrical',
  electric: 'electrical',
  electronics: 'electrical',
  wiring: 'electrical',
  fuel: 'fuel',
  'fuel-system': 'fuel',
  fuelsystem: 'fuel',
  structure: 'structure',
  insulation: 'insulation',
  plumbing: 'plumbing',
  solar: 'solar',
  tools: 'tools',
  'tools-and-supplies': 'tools',
  safety: 'safety',
  kitchen: 'kitchen',
  bathroom: 'bathroom',
  flooring: 'flooring',
  furniture: 'furniture',
  interior: 'interior',
  propane: 'propane',
  windows: 'windows',
  'windows-and-doors': 'windows',
  misc: 'misc',
  other: 'misc',
  general: 'misc',
}

/** Prefer builtin id when the free-form slug is a known synonym. */
export function canonicalizeCategoryId(id: string): string {
  const raw = (id || '').trim()
  if (!raw) return 'misc'
  const lower = raw.toLowerCase()
  if (BUILTIN_CATEGORIES.some((c) => c.id === lower)) return lower

  // Already a slug, or a label
  const slug = raw.includes(' ') || raw.includes('&')
    ? slugifyCategory(raw)
    : lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  if (BUILTIN_CATEGORIES.some((c) => c.id === slug)) return slug

  // Builtin label slugified: "Engine & Powertrain" → engine-and-powertrain
  for (const c of BUILTIN_CATEGORIES) {
    if (slugifyCategory(c.label) === slug) return c.id
  }

  const alias = CATEGORY_ID_ALIASES[slug] || CATEGORY_ID_ALIASES[lower]
  if (alias) return alias

  return raw
}

export function makeCustomCategory(label: string): Category {
  const clean = label.trim() || 'Misc'
  const slug = slugifyCategory(clean)
  const canon = canonicalizeCategoryId(slug)
  const builtin = BUILTIN_CATEGORIES.find((c) => c.id === canon)
  // Don't invent a near-duplicate of a schoolie preset (Engine And Powertrain vs Engine & Powertrain)
  if (builtin && (canon === slug || slugifyCategory(builtin.label) === slug || CATEGORY_ID_ALIASES[slug] === canon)) {
    return { ...builtin }
  }
  return {
    id: slug,
    label: clean,
    color: colorForCategoryId(slug),
    custom: true,
  }
}

/** Resolve a category id using builtins + optional custom list from settings. */
export function getCategory(
  id: string,
  custom: Category[] = [],
): Category {
  const raw = (id || 'misc').trim() || 'misc'
  const canon = canonicalizeCategoryId(raw)
  // Known alias of a schoolie preset → always show the clean preset label
  // (engine-and-powertrain → Engine & Powertrain)
  if (canon !== raw.toLowerCase() || BUILTIN_CATEGORIES.some((c) => c.id === canon)) {
    const builtin = BUILTIN_CATEGORIES.find((c) => c.id === canon)
    if (builtin) return builtin
  }
  const fromCustom = custom.find((c) => c.id === raw || c.id === canon)
  if (fromCustom) return fromCustom
  // Free-form id we haven't stored yet
  return {
    id: raw,
    label: humanizeCategoryId(raw),
    color: colorForCategoryId(raw),
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
    // Skip builtins and known aliases (engine-and-powertrain → engine)
    const canon = canonicalizeCategoryId(raw)
    if (BUILTIN_CATEGORIES.some((c) => c.id === canon || c.id === raw || c.label === raw)) {
      continue
    }
    const cat = makeCustomCategory(
      raw.includes('-') && raw === slugifyCategory(raw) ? humanizeCategoryId(raw) : raw,
    )
    if (!cat.custom || BUILTIN_CATEGORIES.some((b) => b.id === cat.id)) continue
    if (!map.has(cat.id)) {
      map.set(cat.id, cat)
    }
  }
  return [...map.values()]
}
