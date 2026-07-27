/**
 * Named AIs in Schoolie — shown during scans, Settings roster, and leaderboard.
 */

export type AiId =
  | 'scout'
  | 'ledger'
  | 'cashier'
  | 'clerk'
  | 'arbiter'
  | 'grok'
  | 'chatgpt'

export type AiKind = 'on-device' | 'cloud'

export interface AiProfile {
  id: AiId
  /** Short display name (e.g. Grok, ChatGPT) */
  name: string
  /** Longer title */
  fullName: string
  kind: AiKind
  /** What they do */
  role: string
  /** Present-tense line while working: "Grok is scanning the photo…" */
  workingLine: string
  /** Model / engine note */
  engine: string
  emoji: string
  color: string
  /** Requires an API key in Settings */
  needsKey?: 'xai' | 'openai'
}

export const AI_ROSTER: AiProfile[] = [
  {
    id: 'scout',
    name: 'Scout',
    fullName: 'Scout · Photo Reader',
    kind: 'on-device',
    role: 'Reads the receipt photo with on-device OCR (two passes) and pulls out the raw text.',
    workingLine: 'Scout is scanning the photo…',
    engine: 'Tesseract.js (on your phone)',
    emoji: '🔭',
    color: '#5b9fd4',
  },
  {
    id: 'ledger',
    name: 'Ledger',
    fullName: 'Ledger · Line Items',
    kind: 'on-device',
    role: 'Breaks the text into every product line with prices and schoolie categories.',
    workingLine: 'Ledger is listing every item on the receipt…',
    engine: 'On-device rules agent',
    emoji: '📋',
    color: '#6b8f71',
  },
  {
    id: 'cashier',
    name: 'Cashier',
    fullName: 'Cashier · Totals',
    kind: 'on-device',
    role: 'Finds grand total, subtotal, and tax; strategies vote so the total is trustworthy.',
    workingLine: 'Cashier is checking the totals…',
    engine: 'On-device voting agent',
    emoji: '💵',
    color: '#e8a54b',
  },
  {
    id: 'clerk',
    name: 'Clerk',
    fullName: 'Clerk · Store & Date',
    kind: 'on-device',
    role: 'Identifies the store/vendor and purchase date.',
    workingLine: 'Clerk is reading the store and date…',
    engine: 'On-device rules agent',
    emoji: '🏪',
    color: '#9c6644',
  },
  {
    id: 'arbiter',
    name: 'Arbiter',
    fullName: 'Arbiter · Cross-check',
    kind: 'on-device',
    role: 'Compares the other on-device AIs and settles disagreements (lines vs total, etc.).',
    workingLine: 'Arbiter is cross-checking the team…',
    engine: 'On-device consensus agent',
    emoji: '⚖️',
    color: '#b8a0d4',
  },
  {
    id: 'grok',
    name: 'Grok',
    fullName: 'Grok · xAI',
    kind: 'cloud',
    role: 'Cloud vision model that re-reads the photo and suggests full line items (optional).',
    workingLine: 'Grok is scanning the photo…',
    engine: 'grok-4.5 via api.x.ai',
    emoji: '✦',
    color: '#f0c36a',
    needsKey: 'xai',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    fullName: 'ChatGPT · OpenAI',
    kind: 'cloud',
    role: 'Cloud vision model that re-reads the photo as a second opinion (optional).',
    workingLine: 'ChatGPT is scanning the photo…',
    engine: 'gpt-4o via api.openai.com',
    emoji: '◎',
    color: '#74aa9c',
    needsKey: 'openai',
  },
]

export function getAi(id: AiId): AiProfile {
  return AI_ROSTER.find((a) => a.id === id) ?? AI_ROSTER[0]
}

export function aiNameList(ids: AiId[]): string {
  return ids.map((id) => getAi(id).name).join(', ')
}
