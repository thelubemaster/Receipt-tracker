/**
 * Free, keyless AIs only — all run on-device (or free web via local proxy).
 * Higher power = more CPU/GPU/RAM. Users can disable any non-core AI in Settings.
 */

export type AiId =
  | 'scout'
  | 'forge'
  | 'lens'
  | 'hammer'
  | 'titan'
  | 'ruler'
  | 'mosaic'
  | 'wedge'
  | 'prism'
  | 'bloom'
  | 'ledger'
  | 'sieve'
  | 'cashier'
  | 'clerk'
  | 'arbiter'
  | 'quorum'
  | 'council'
  | 'seeker'

export type AiKind = 'on-device' | 'free-web'

export type AiTier = 'core' | 'standard' | 'heavy'

export interface AiProfile {
  id: AiId
  name: string
  fullName: string
  kind: AiKind
  cost: 'free'
  role: string
  workingLine: string
  engine: string
  emoji: string
  color: string
  /** 1–10 phone load / thoroughness */
  power: number
  /**
   * core = needed for a minimal scan (cannot disable)
   * standard = useful, can disable
   * heavy = may struggle on older phones — can disable
   */
  tier: AiTier
  /** Show “may be slow on phone” in Settings */
  phoneWarning?: string
}

export const AI_ROSTER: AiProfile[] = [
  {
    id: 'scout',
    name: 'Scout',
    fullName: 'Scout · Fast OCR',
    kind: 'on-device',
    cost: 'free',
    role: 'Light dual-pass OCR fallback when others fail.',
    workingLine: 'Scout is scanning the photo…',
    engine: 'Tesseract.js dual-pass',
    emoji: '🔭',
    color: '#5b9fd4',
    power: 2,
    tier: 'core',
  },
  {
    id: 'forge',
    name: 'Forge',
    fullName: 'Forge · Multi-preprocess OCR',
    kind: 'on-device',
    cost: 'free',
    role: 'Contrast / threshold / invert preprocess × layout modes.',
    workingLine: 'Forge is deep-scanning the photo…',
    engine: 'Tesseract.js multi-preprocess',
    emoji: '🔥',
    color: '#e07a3d',
    power: 5,
    tier: 'standard',
  },
  {
    id: 'lens',
    name: 'Lens',
    fullName: 'Lens · Multi-scale OCR',
    kind: 'on-device',
    cost: 'free',
    role: 'Upscales the image and re-reads fine print.',
    workingLine: 'Lens is magnifying fine print…',
    engine: 'Tesseract.js upscale pass',
    emoji: '🔍',
    color: '#6ec6ff',
    power: 5,
    tier: 'standard',
  },
  {
    id: 'ruler',
    name: 'Ruler',
    fullName: 'Ruler · Document layout OCR',
    kind: 'on-device',
    cost: 'free',
    role: 'Maps every word box on the photo into real receipt rows.',
    workingLine: 'Ruler is mapping every line on the photo…',
    engine: 'Tesseract word boxes + layout reconstruct',
    emoji: '📏',
    color: '#42a5f5',
    power: 7,
    tier: 'standard',
    phoneWarning: 'Uses more CPU than Forge for layout mapping.',
  },
  {
    id: 'wedge',
    name: 'Wedge',
    fullName: 'Wedge · Deskew OCR',
    kind: 'on-device',
    cost: 'free',
    role: 'Straightens crooked phone photos, then OCR — free, no key.',
    workingLine: 'Wedge is straightening the receipt…',
    engine: 'Canvas deskew + Tesseract.js',
    emoji: '📐',
    color: '#66bb6a',
    power: 6,
    tier: 'standard',
  },
  {
    id: 'prism',
    name: 'Prism',
    fullName: 'Prism · Multi-layout OCR',
    kind: 'on-device',
    cost: 'free',
    role: 'Tries many Tesseract page-layout modes and keeps the richest text.',
    workingLine: 'Prism is splitting light across layout modes…',
    engine: 'Tesseract multi-PSM ensemble',
    emoji: '💎',
    color: '#ce93d8',
    power: 7,
    tier: 'heavy',
    phoneWarning: 'Several full OCR passes — can feel slow on older phones.',
  },
  {
    id: 'bloom',
    name: 'Bloom',
    fullName: 'Bloom · 2× upscale OCR',
    kind: 'on-device',
    cost: 'free',
    role: 'Aggressively enlarges the photo for tiny print, then OCR.',
    workingLine: 'Bloom is enlarging the receipt 2×…',
    engine: '2× canvas upscale + Tesseract.js',
    emoji: '🌸',
    color: '#f48fb1',
    power: 8,
    tier: 'heavy',
    phoneWarning: 'High memory use — may struggle on low-RAM phones.',
  },
  {
    id: 'mosaic',
    name: 'Mosaic',
    fullName: 'Mosaic · Tile OCR',
    kind: 'on-device',
    cost: 'free',
    role: 'Splits the receipt into tiles, OCR each piece, stitches — free, no key.',
    workingLine: 'Mosaic is tiling the receipt…',
    engine: 'Grid tile OCR + stitch',
    emoji: '🧩',
    color: '#ff8a65',
    power: 9,
    tier: 'heavy',
    phoneWarning: 'Many OCR jobs — often too much for mid/low phones.',
  },
  {
    id: 'hammer',
    name: 'Hammer',
    fullName: 'Hammer · Max-CPU OCR swarm',
    kind: 'on-device',
    cost: 'free',
    role: 'Spawns multiple OCR workers in parallel across many image variants.',
    workingLine: 'Hammer is smashing the receipt with parallel OCR…',
    engine: 'Tesseract.js multi-worker parallel swarm',
    emoji: '🔨',
    color: '#ff7043',
    power: 9,
    tier: 'heavy',
    phoneWarning: 'Very high CPU — heat and battery drain.',
  },
  {
    id: 'titan',
    name: 'Titan',
    fullName: 'Titan · Neural OCR (on-device)',
    kind: 'on-device',
    cost: 'free',
    role: 'Free neural text model in the browser (WebGPU/WASM). First run downloads once.',
    workingLine: 'Titan neural net is reading the photo…',
    engine: 'Transformers.js · TrOCR (local neural)',
    emoji: '🦾',
    color: '#ab47bc',
    power: 10,
    tier: 'heavy',
    phoneWarning: 'May fail or freeze on low-end phones; downloads a model first.',
  },
  {
    id: 'ledger',
    name: 'Ledger',
    fullName: 'Ledger · Line Items',
    kind: 'on-device',
    cost: 'free',
    role: 'Primary line-item extractor (rules — light).',
    workingLine: 'Ledger is listing every item…',
    engine: 'On-device rules agent',
    emoji: '📋',
    color: '#6b8f71',
    power: 3,
    tier: 'core',
  },
  {
    id: 'sieve',
    name: 'Sieve',
    fullName: 'Sieve · Line-Item Ensemble',
    kind: 'on-device',
    cost: 'free',
    role: 'Second strategy merge so fewer products are dropped.',
    workingLine: 'Sieve is double-checking line items…',
    engine: 'On-device multi-strategy agent',
    emoji: '🌀',
    color: '#4db6ac',
    power: 4,
    tier: 'standard',
  },
  {
    id: 'cashier',
    name: 'Cashier',
    fullName: 'Cashier · Totals',
    kind: 'on-device',
    cost: 'free',
    role: 'Votes across total strategies.',
    workingLine: 'Cashier is checking the totals…',
    engine: 'On-device voting agent',
    emoji: '💵',
    color: '#e8a54b',
    power: 3,
    tier: 'core',
  },
  {
    id: 'clerk',
    name: 'Clerk',
    fullName: 'Clerk · Store & Date',
    kind: 'on-device',
    cost: 'free',
    role: 'Finds store and date.',
    workingLine: 'Clerk is reading the store and date…',
    engine: 'On-device rules agent',
    emoji: '🏪',
    color: '#9c6644',
    power: 2,
    tier: 'core',
  },
  {
    id: 'arbiter',
    name: 'Arbiter',
    fullName: 'Arbiter · Cross-check',
    kind: 'on-device',
    cost: 'free',
    role: 'Cross-checks line sums vs totals.',
    workingLine: 'Arbiter is cross-checking the team…',
    engine: 'On-device consensus agent',
    emoji: '⚖️',
    color: '#b8a0d4',
    power: 4,
    tier: 'core',
  },
  {
    id: 'quorum',
    name: 'Quorum',
    fullName: 'Quorum · Final Vote',
    kind: 'on-device',
    cost: 'free',
    role: 'Merges every OCR path into one answer.',
    workingLine: 'Quorum is voting on the final answer…',
    engine: 'On-device multi-parse vote',
    emoji: '👑',
    color: '#f0c36a',
    power: 6,
    tier: 'standard',
  },
  {
    id: 'council',
    name: 'Council',
    fullName: 'Council · Agent Debate',
    kind: 'on-device',
    cost: 'free',
    role: 'Agents debate on a blackboard to fill gaps and agree.',
    workingLine: 'Council is debating the receipt…',
    engine: 'Blackboard multi-round free agents',
    emoji: '🏛️',
    color: '#90caf9',
    power: 8,
    tier: 'heavy',
    phoneWarning: 'Extra CPU after OCR — turn off if scans feel stuck.',
  },
  {
    id: 'seeker',
    name: 'Seeker',
    fullName: 'Seeker · Free Web Lookup',
    kind: 'free-web',
    cost: 'free',
    role: 'Looks up SKUs on DuckDuckGo + Wikipedia via free proxy. No API key. Needs network.',
    workingLine: 'Seeker is scanning the internet for product info…',
    engine: 'Free web proxy (DDG + Wikipedia)',
    emoji: '🌐',
    color: '#26c6da',
    power: 7,
    tier: 'standard',
    phoneWarning: 'Needs network + the app host proxy; safe to disable offline.',
  },
]

export function getAi(id: AiId): AiProfile {
  return AI_ROSTER.find((a) => a.id === id) ?? AI_ROSTER[0]
}

export function freeAis(): AiProfile[] {
  return AI_ROSTER
}

export function aiNameList(ids: AiId[]): string {
  return ids.map((id) => getAi(id).name).join(', ')
}

export function isCoreAi(id: AiId): boolean {
  return getAi(id).tier === 'core'
}

export function isHeavyAi(id: AiId): boolean {
  return getAi(id).tier === 'heavy'
}

/** Valid AiIds only (filters junk from storage). */
export function sanitizeDisabledAis(list: unknown): AiId[] {
  if (!Array.isArray(list)) return []
  const valid = new Set(AI_ROSTER.map((a) => a.id))
  const out: AiId[] = []
  for (const x of list) {
    if (typeof x === 'string' && valid.has(x as AiId) && !isCoreAi(x as AiId)) {
      if (!out.includes(x as AiId)) out.push(x as AiId)
    }
  }
  return out
}

/**
 * Whether an AI should run for this scan.
 * Core AIs always run. Others respect disabled list.
 * maxPowerMode=false also turns off heavy tier (quick light mode).
 */
export function isAiEnabled(
  id: AiId,
  opts: { disabledAis?: AiId[]; maxPowerMode?: boolean } = {},
): boolean {
  const profile = getAi(id)
  if (profile.tier === 'core') return true
  const disabled = opts.disabledAis ?? []
  if (disabled.includes(id)) return false
  if (opts.maxPowerMode === false && profile.tier === 'heavy') return false
  return true
}

export function enabledAiIds(opts: {
  disabledAis?: AiId[]
  maxPowerMode?: boolean
}): AiId[] {
  return AI_ROSTER.filter((a) => isAiEnabled(a.id, opts)).map((a) => a.id)
}

/** Default: nothing disabled — user turns off what their phone can’t handle. */
export function defaultDisabledAis(): AiId[] {
  return []
}
