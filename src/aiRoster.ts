/**
 * Named AIs in Schoolie — free-first.
 * On-device AIs are always free. Gemini uses Google’s free AI Studio tier.
 * Grok / ChatGPT remain optional paid-cloud if you already have keys.
 */

export type AiId =
  | 'scout'
  | 'forge'
  | 'ledger'
  | 'cashier'
  | 'clerk'
  | 'arbiter'
  | 'gemini'
  | 'grok'
  | 'chatgpt'

export type AiKind = 'on-device' | 'cloud'
export type AiCost = 'free' | 'free-tier' | 'paid'

export interface AiProfile {
  id: AiId
  name: string
  fullName: string
  kind: AiKind
  cost: AiCost
  role: string
  workingLine: string
  engine: string
  emoji: string
  color: string
  needsKey?: 'xai' | 'openai' | 'gemini'
  /** Higher = more thorough / “high-powered” */
  power: number
}

export const AI_ROSTER: AiProfile[] = [
  {
    id: 'scout',
    name: 'Scout',
    fullName: 'Scout · Photo Reader',
    kind: 'on-device',
    cost: 'free',
    role: 'Fast on-device OCR (two passes) — free, runs fully on your phone.',
    workingLine: 'Scout is scanning the photo…',
    engine: 'Tesseract.js (on your phone)',
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
    role: 'Free high-power on-device reader: multiple image preprocesses + dual OCR, picks the best text.',
    workingLine: 'Forge is deep-scanning the photo…',
    engine: 'Tesseract.js multi-preprocess (on your phone)',
    emoji: '🔥',
    color: '#e07a3d',
    power: 4,
  },
  {
    id: 'ledger',
    name: 'Ledger',
    fullName: 'Ledger · Line Items',
    kind: 'on-device',
    cost: 'free',
    role: 'Breaks text into product lines with prices and schoolie categories.',
    workingLine: 'Ledger is listing every item on the receipt…',
    engine: 'On-device rules agent',
    emoji: '📋',
    color: '#6b8f71',
    power: 2,
  },
  {
    id: 'cashier',
    name: 'Cashier',
    fullName: 'Cashier · Totals',
    kind: 'on-device',
    cost: 'free',
    role: 'Finds grand total, subtotal, and tax with voting strategies.',
    workingLine: 'Cashier is checking the totals…',
    engine: 'On-device voting agent',
    emoji: '💵',
    color: '#e8a54b',
    power: 2,
  },
  {
    id: 'clerk',
    name: 'Clerk',
    fullName: 'Clerk · Store & Date',
    kind: 'on-device',
    cost: 'free',
    role: 'Identifies store/vendor and purchase date.',
    workingLine: 'Clerk is reading the store and date…',
    engine: 'On-device rules agent',
    emoji: '🏪',
    color: '#9c6644',
    power: 1,
  },
  {
    id: 'arbiter',
    name: 'Arbiter',
    fullName: 'Arbiter · Cross-check',
    kind: 'on-device',
    cost: 'free',
    role: 'Cross-checks free on-device AIs and settles disagreements.',
    workingLine: 'Arbiter is cross-checking the team…',
    engine: 'On-device consensus agent',
    emoji: '⚖️',
    color: '#b8a0d4',
    power: 3,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    fullName: 'Gemini · Google (free tier)',
    kind: 'cloud',
    cost: 'free-tier',
    role: 'Free-tier Google vision model — re-reads the photo and itemizes the receipt (optional free API key).',
    workingLine: 'Gemini is scanning the photo…',
    engine: 'gemini-2.0-flash via generativelanguage.googleapis.com',
    emoji: '✦',
    color: '#8ab4f8',
    needsKey: 'gemini',
    power: 5,
  },
  {
    id: 'grok',
    name: 'Grok',
    fullName: 'Grok · xAI (paid)',
    kind: 'cloud',
    cost: 'paid',
    role: 'Optional paid cloud vision (only if you already have an xAI key).',
    workingLine: 'Grok is scanning the photo…',
    engine: 'grok-4.5 via api.x.ai',
    emoji: '⚡',
    color: '#f0c36a',
    needsKey: 'xai',
    power: 5,
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    fullName: 'ChatGPT · OpenAI (paid)',
    kind: 'cloud',
    cost: 'paid',
    role: 'Optional paid cloud vision (only if you already have an OpenAI key).',
    workingLine: 'ChatGPT is scanning the photo…',
    engine: 'gpt-4o via api.openai.com',
    emoji: '◎',
    color: '#74aa9c',
    needsKey: 'openai',
    power: 5,
  },
]

export function getAi(id: AiId): AiProfile {
  return AI_ROSTER.find((a) => a.id === id) ?? AI_ROSTER[0]
}

export function freeAis(): AiProfile[] {
  return AI_ROSTER.filter((a) => a.cost === 'free' || a.cost === 'free-tier')
}

export function aiNameList(ids: AiId[]): string {
  return ids.map((id) => getAi(id).name).join(', ')
}
