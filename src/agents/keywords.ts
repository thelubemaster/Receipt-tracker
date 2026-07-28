/**
 * Free-form + preset categorization.
 * Strong keyword hits map to schoolie presets; otherwise invent a useful
 * category label from the product text (engine parts, etc.) instead of Misc.
 */
import type { CategoryId } from '../types'
import { makeCustomCategory, slugifyCategory } from '../categories'

/** Built-in keyword lists (presets). */
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  structure: [
    'lumber',
    'plywood',
    '2x4',
    '2x6',
    'osb',
    'stud',
    'framing',
    'sheet metal',
    'steel plate',
    'rust',
    'primer',
    'weld',
    'rivet',
    'angle iron',
    'joist',
    'deck',
    'pressure treat',
  ],
  insulation: [
    'insulation',
    'foam',
    'rigid foam',
    'polyiso',
    'rockwool',
    'mineral wool',
    'thinsulate',
    'reflectix',
    'spray foam',
    'vapor barrier',
    'housewrap',
    'fiberglass',
  ],
  electrical: [
    'wire',
    'wiring',
    'outlet',
    'breaker',
    'fuse',
    'electrical',
    'conduit',
    'romex',
    'switch',
    'junction',
    'led strip',
    'dimmer',
    'gfci',
    'receptacle',
    'nm-b',
    'thhn',
  ],
  solar: [
    'solar',
    'mppt',
    'inverter',
    'lithium',
    'lifepo',
    'battery',
    'deep cycle',
    'charge controller',
    'pv panel',
    'solar panel',
    'busbar',
    'victron',
    'renogy',
  ],
  plumbing: [
    'pipe',
    'pvc',
    'pex',
    'plumbing',
    'valve',
    'faucet',
    'fitting',
    'water pump',
    'sharkbite',
    'drain',
    'elbow',
    'coupling',
  ],
  propane: ['propane', 'heater', 'furnace', 'diesel heater', 'mr heater', 'regulator', 'gas line'],
  interior: ['drywall', 'shiplap', 'paneling', 'trim', 'molding', 'caulk', 'paint', 'adhesive'],
  kitchen: ['sink', 'countertop', 'fridge', 'refrigerator', 'cooktop', 'microwave'],
  bathroom: ['toilet', 'shower', 'vanity', 'bathroom', 'cassette'],
  flooring: ['flooring', 'vinyl plank', 'laminate', 'subfloor', 'underlayment'],
  windows: ['window', 'door', 'awning', 'vent fan', 'maxxair'],
  furniture: ['bed', 'sofa', 'cushion', 'mattress', 'cabinet'],
  tools: ['drill', 'saw', 'wrench', 'socket', 'screwdriver', 'multimeter', 'tool'],
  safety: ['fire extinguisher', 'co detector', 'smoke detector', 'first aid', 'seat belt'],
  fuel: [
    'diesel fuel',
    'gasoline',
    'def fluid',
    'fuel station',
    'gallons diesel',
    'travel',
    'hotel',
    'campground',
  ],
  engine: [
    'engine',
    'powerstroke',
    'caterpillar',
    'cummins',
    'duramax',
    'turbo',
    'gasket',
    'piston',
    'camshaft',
    'crankshaft',
    'injector',
    'injection pump',
    'oil pump',
    'water pump',
    'thermostat',
    'timing chain',
    'timing belt',
    'valve cover',
    'head bolt',
    'glow plug',
    'ipd',
    'arp stud',
    'egr',
    'cp3',
    'cp4',
    'high pressure oil',
    'hpops',
    'oil cooler',
    'intercooler',
    'exhaust manifold',
    'intake manifold',
    'serpentine belt',
    'harmonic balancer',
    'flex plate',
    'flywheel',
    'torque converter',
    'transmission',
    'torque',
    'clutch',
    'rebuild kit',
  ],
  // No hardcoded service buckets — free-form invent reads the receipt (e.g. "towing")
  misc: ['labor', 'service fee', 'convenience fee', 'processing fee'],
}

/**
 * Free-form families — invent these when built-in score is weak.
 * First strong match wins as a new/grouped category label.
 * Labels are invented names (not schoolie presets), e.g. "Towing" when OCR says towing.
 */
const DYNAMIC_FAMILIES: { label: string; words: string[] }[] = [
  {
    // Name matches what appears on invoices — free-form, not a builtin preset
    label: 'Towing',
    words: [
      'tow',
      'towing',
      'towed',
      'wrecker',
      'roadside',
      'flatbed',
      'impound',
      'tow truck',
      'towing service',
      'winch',
      'recovery',
    ],
  },
  {
    label: 'Engine & Powertrain',
    words: [
      'engine',
      'powerstroke',
      'caterpillar',
      'cummins',
      'turbo',
      'gasket',
      'piston',
      'injector',
      'glow plug',
      'oil cooler',
      'head gasket',
      'valve cover',
      'timing',
      'crank',
      'camshaft',
      'rebuild',
      'ipd',
      'arp',
      'egr',
      'intercooler',
      'manifold',
    ],
  },
  {
    label: 'Fuel system',
    words: [
      'fuel filter',
      'racor',
      'diesel filter',
      'lift pump',
      'fuel pump',
      'fuel line',
      'fuel tank',
      'water separator',
      'parfit',
      'pff',
      '1r-0750',
      'fuel kit',
    ],
  },
  {
    label: 'Filters & fluids',
    words: [
      'oil filter',
      'air filter',
      'cabin filter',
      'motor oil',
      'synthetic oil',
      'coolant',
      'antifreeze',
      'transmission fluid',
      'gear oil',
      'hydraulic fluid',
    ],
  },
  {
    label: 'Brakes & suspension',
    words: [
      'brake',
      'rotor',
      'caliper',
      'pad',
      'shock',
      'strut',
      'spring',
      'ball joint',
      'tie rod',
      'hub assembly',
      'wheel bearing',
    ],
  },
  {
    label: 'Electrical & sensors',
    words: [
      'sensor',
      'alternator',
      'starter',
      'wiring harness',
      'pcm',
      'ecm',
      'relay',
      'solenoid',
      'actuator',
      'map sensor',
      'maf',
      'o2 sensor',
      'cps',
      'ckp',
    ],
  },
  {
    label: 'Cooling system',
    words: [
      'radiator',
      'thermostat',
      'coolant hose',
      'water pump',
      'fan clutch',
      'heater core',
      'overflow',
    ],
  },
  {
    label: 'Exhaust & emissions',
    words: ['exhaust', 'muffler', 'downpipe', 'dpf', 'scr', 'def', 'catalytic', 'turbo elbow'],
  },
  {
    label: 'Body & exterior',
    words: ['bumper', 'fender', 'mirror', 'hood', 'door handle', 'latch', 'weatherstrip'],
  },
  {
    label: 'Towing & hitch',
    words: ['hitch', 'receiver', 'trailer ball', 'tow bar', 'weight distribution', 'gooseneck'],
  },
  {
    label: 'Hardware & fasteners',
    words: ['bolt', 'nut', 'washer', 'screw', 'clamp', 'hose clamp', 'stud', 'fastener'],
  },
]

export const VENDOR_HINTS = [
  'home depot',
  'lowe',
  "lowe's",
  'lowes',
  'menards',
  'harbor freight',
  'ace hardware',
  'amazon',
  'walmart',
  'costco',
  'tractor supply',
  'grainger',
  'autozone',
  'oreilly',
  "o'reilly",
  'napa',
  'ikea',
  'swag performance',
  'swagperformanceparts',
  'rockauto',
  'summit racing',
  'diesel power products',
]

function scoreWords(lower: string, words: string[]): number {
  let score = 0
  for (const w of words) {
    if (lower.includes(w)) score += w.includes(' ') ? 3 : 2
  }
  return score
}

/**
 * Invent a readable free-form category from product text when presets don't fit.
 */
export function inventCategoryFromText(text: string): { categoryId: CategoryId; label: string; score: number } {
  const lower = text.toLowerCase()

  let bestLabel = ''
  let bestScore = 0
  for (const fam of DYNAMIC_FAMILIES) {
    const s = scoreWords(lower, fam.words)
    if (s > bestScore) {
      bestScore = s
      bestLabel = fam.label
    }
  }

  if (bestScore >= 2 && bestLabel) {
    const cat = makeCustomCategory(bestLabel)
    // Prefer stable builtin id only for schoolie build-out presets
    if (bestLabel === 'Engine & Powertrain') {
      return { categoryId: 'engine', label: bestLabel, score: bestScore }
    }
    if (bestLabel === 'Fuel system') {
      return { categoryId: 'fuel', label: 'Fuel & Travel', score: bestScore }
    }
    // Free-form invent (Towing, Filters & fluids, …) — not hardcoded presets
    return { categoryId: cat.id, label: cat.label, score: bestScore }
  }

  // Last resort: pull meaningful product words (not pure misc dump)
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'item',
    'qty',
    'each',
    'total',
    'order',
    'shipped',
    'filter', // too generic alone without family
  ])
  const tokens = lower
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .split(/[\s/]+/)
    .filter(
      (t) =>
        t.length >= 4 &&
        !stop.has(t) &&
        !/^\d+$/.test(t) &&
        // skip OCR junk / part codes as category names (r0mex, ph8a, 5w30)
        !/\d/.test(t) &&
        /[aeiou]/.test(t),
    )
  const unique: string[] = []
  for (const t of tokens) {
    if (!unique.includes(t)) unique.push(t)
    if (unique.length >= 3) break
  }

  if (unique.length >= 1) {
    // Prefer a short group name so similar parts cluster
    const shortLabel =
      unique.length >= 2
        ? `${unique[0].charAt(0).toUpperCase()}${unique[0].slice(1)} parts`
        : `${unique[0].charAt(0).toUpperCase()}${unique[0].slice(1)}`
    const short = makeCustomCategory(shortLabel)
    return { categoryId: short.id, label: short.label, score: 1 }
  }

  return { categoryId: 'misc', label: 'Misc', score: 0 }
}

/**
 * Categorize free-form text.
 * - Strong preset keyword match → use preset
 * - Else invent a free-form category (engine parts, filters, etc.)
 * - Avoid dumping everything into Misc when there is product signal
 * - optional avoidId: user marked previous category ✗ — pick something else
 */
export function categorizeText(
  text: string,
  opts?: { avoidId?: CategoryId | null },
): {
  categoryId: CategoryId
  score: number
  label?: string
  invented?: boolean
} {
  const lower = text.toLowerCase()
  const avoid = opts?.avoidId || null

  // Rank all presets
  const ranked: { id: CategoryId; score: number }[] = []
  for (const [id, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (id === 'misc') continue
    const score = scoreWords(lower, words)
    if (score > 0) ranked.push({ id: id as CategoryId, score })
  }
  ranked.sort((a, b) => b.score - a.score)

  let best: CategoryId = 'misc'
  let bestScore = 0
  for (const r of ranked) {
    if (avoid && r.id === avoid) continue
    best = r.id
    bestScore = r.score
    break
  }

  // Strong schoolie-preset hit
  if (bestScore >= 4) {
    return { categoryId: best, score: bestScore, invented: false }
  }

  // Prefer free-form invent from words on the receipt (towing, filters, etc.)
  const invented = inventCategoryFromText(text)
  if (avoid && invented.categoryId === avoid) {
    // invent landed on banned id — fall through
  } else if (invented.score > bestScore || (bestScore < 3 && invented.score >= 2)) {
    return {
      categoryId: invented.categoryId,
      score: invented.score,
      label: invented.label,
      invented: true,
    }
  }

  if (bestScore > 0) {
    return { categoryId: best, score: bestScore, invented: false }
  }

  // Truly empty signal
  if (invented.score > 0 && invented.categoryId !== avoid) {
    return {
      categoryId: invented.categoryId,
      score: invented.score,
      label: invented.label,
      invented: true,
    }
  }

  return { categoryId: 'misc', score: 0, invented: false }
}

/** Ensure a category id is a clean slug (for free-typed UI values). */
export function normalizeCategoryInput(raw: string): { id: CategoryId; label: string } {
  const t = raw.trim()
  if (!t) return { id: 'misc', label: 'Misc' }
  // user picked a builtin id
  if (CATEGORY_KEYWORDS[t]) {
    return { id: t, label: t }
  }
  const cat = makeCustomCategory(t)
  return { id: cat.id, label: cat.label }
}

// re-export for agents that only need slug
export { slugifyCategory }
