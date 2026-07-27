/**
 * Free, keyless AIs only — all run on-device. Higher power = more CPU/GPU work.
 */

export type AiId =
  | 'scout'
  | 'forge'
  | 'lens'
  | 'hammer'
  | 'titan'
  | 'ledger'
  | 'sieve'
  | 'cashier'
  | 'clerk'
  | 'arbiter'
  | 'quorum'
  | 'council'
  | 'seeker'

export type AiKind = 'on-device'

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
}

export const AI_ROSTER: AiProfile[] = [
  {
    id: 'scout',
    name: 'Scout',
    fullName: 'Scout · Fast OCR',
    kind: 'on-device',
    cost: 'free',
    role: 'Light dual-pass OCR fallback.',
    workingLine: 'Scout is scanning the photo…',
    engine: 'Tesseract.js dual-pass',
    emoji: '🔭',
    color: '#5b9fd4',
    power: 2,
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
  },
  {
    id: 'hammer',
    name: 'Hammer',
    fullName: 'Hammer · Max-CPU OCR swarm',
    kind: 'on-device',
    cost: 'free',
    role: 'Spawns multiple OCR workers in parallel across many image variants — heavy on battery/CPU, no API key.',
    workingLine: 'Hammer is smashing the receipt with parallel OCR…',
    engine: 'Tesseract.js multi-worker parallel swarm',
    emoji: '🔨',
    color: '#ff7043',
    power: 9,
  },
  {
    id: 'titan',
    name: 'Titan',
    fullName: 'Titan · Neural OCR (on-device)',
    kind: 'on-device',
    cost: 'free',
    role: 'Runs a free neural text-recognition model in the browser (WebGPU/WASM). First run downloads the model once, then offline.',
    workingLine: 'Titan neural net is reading the photo…',
    engine: 'Transformers.js · TrOCR (local neural)',
    emoji: '🦾',
    color: '#ab47bc',
    power: 10,
  },
  {
    id: 'ledger',
    name: 'Ledger',
    fullName: 'Ledger · Line Items',
    kind: 'on-device',
    cost: 'free',
    role: 'Primary line-item extractor.',
    workingLine: 'Ledger is listing every item…',
    engine: 'On-device rules agent',
    emoji: '📋',
    color: '#6b8f71',
    power: 3,
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
  },
  {
    id: 'quorum',
    name: 'Quorum',
    fullName: 'Quorum · Final Vote',
    kind: 'on-device',
    cost: 'free',
    role: 'Merges every OCR path (Forge, Lens, Hammer, Titan) into one answer.',
    workingLine: 'Quorum is voting on the final answer…',
    engine: 'On-device multi-parse vote',
    emoji: '👑',
    color: '#f0c36a',
    power: 6,
  },
  {
    id: 'council',
    name: 'Council',
    fullName: 'Council · Agent Debate',
    kind: 'on-device',
    cost: 'free',
    role: 'Agents talk on a shared board: Cashier challenges gaps, Sieve hunts missing prices, Clerk fixes vendor, then they agree.',
    workingLine: 'Council is debating the receipt…',
    engine: 'Blackboard multi-round free agents',
    emoji: '🏛️',
    color: '#90caf9',
    power: 8,
  },
  {
    id: 'seeker',
    name: 'Seeker',
    fullName: 'Seeker · Free Web Lookup',
    kind: 'on-device',
    cost: 'free',
    role: 'Looks up SKUs/products on the free public web (DuckDuckGo + Wikipedia via local proxy). No API key. Needs network.',
    workingLine: 'Seeker is scanning the internet for product info…',
    engine: 'Free web proxy (DuckDuckGo Instant Answer + Wikipedia)',
    emoji: '🌐',
    color: '#26c6da',
    power: 7,
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
