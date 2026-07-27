/**
 * Free, keyless AIs only — all run on-device in the browser.
 */

export type AiId =
  | 'scout'
  | 'forge'
  | 'lens'
  | 'ledger'
  | 'sieve'
  | 'cashier'
  | 'clerk'
  | 'arbiter'
  | 'quorum'

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
  power: number
}

export const AI_ROSTER: AiProfile[] = [
  {
    id: 'scout',
    name: 'Scout',
    fullName: 'Scout · Fast OCR',
    kind: 'on-device',
    cost: 'free',
    role: 'Fast dual-pass OCR fallback. No key. Fully on your phone.',
    workingLine: 'Scout is scanning the photo…',
    engine: 'Tesseract.js dual-pass',
    emoji: '🔭',
    color: '#5b9fd4',
    power: 2,
  },
  {
    id: 'forge',
    name: 'Forge',
    fullName: 'Forge · High-Power OCR',
    kind: 'on-device',
    cost: 'free',
    role: 'Multi-preprocess OCR (contrast, threshold, invert) × layout modes. Picks best text.',
    workingLine: 'Forge is deep-scanning the photo…',
    engine: 'Tesseract.js multi-preprocess',
    emoji: '🔥',
    color: '#e07a3d',
    power: 5,
  },
  {
    id: 'lens',
    name: 'Lens',
    fullName: 'Lens · Multi-Scale OCR',
    kind: 'on-device',
    cost: 'free',
    role: 'Upscales the receipt and re-reads tiny print; merges lines Forge may miss.',
    workingLine: 'Lens is magnifying fine print…',
    engine: 'Tesseract.js upscale pass',
    emoji: '🔍',
    color: '#6ec6ff',
    power: 4,
  },
  {
    id: 'ledger',
    name: 'Ledger',
    fullName: 'Ledger · Line Items',
    kind: 'on-device',
    cost: 'free',
    role: 'Primary line-item extractor (description, price, schoolie category).',
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
    role: 'Second line-item strategy (strict + relaxed). Merges with Ledger so fewer items are dropped.',
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
    role: 'Votes across total/subtotal/tax strategies for the amount you paid.',
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
    role: 'Finds store/vendor name and purchase date.',
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
    role: 'Cross-checks line sums vs totals and files the purchase.',
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
    role: 'Highest-power free judge: compares Forge vs Lens full parses and keeps the strongest result.',
    workingLine: 'Quorum is voting on the final answer…',
    engine: 'On-device dual-parse vote',
    emoji: '👑',
    color: '#f0c36a',
    power: 5,
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
