import type { AiId } from './aiRoster'

export type CategoryId =
  | 'structure'
  | 'insulation'
  | 'electrical'
  | 'solar'
  | 'plumbing'
  | 'propane'
  | 'interior'
  | 'kitchen'
  | 'bathroom'
  | 'flooring'
  | 'windows'
  | 'furniture'
  | 'tools'
  | 'safety'
  | 'fuel'
  | 'misc'

export interface ReceiptLineItem {
  id: string
  description: string
  amount: number
  categoryId: CategoryId
}

export interface Purchase {
  id: string
  date: string
  description: string
  amount: number
  categoryId: CategoryId
  vendor: string
  notes: string
  receiptImageId: string | null
  lineItems: ReceiptLineItem[]
  /** Which named AIs worked this scan */
  aisUsed: AiId[]
  /** User-picked best AI for this receipt (optional) */
  bestAiId?: AiId | null
  createdAt: string
  updatedAt: string
}

export interface AppSettings {
  /** xAI / Grok API key */
  apiKey: string
  /** OpenAI / ChatGPT API key */
  openaiApiKey: string
  projectName: string
  /** Last app version the user acknowledged (What's new). */
  lastSeenVersion: string
}

export interface ReceiptSuggestion {
  date: string | null
  vendor: string
  amount: number | null
  description: string
  categoryId: CategoryId
  notes: string
  lineItems: ReceiptLineItem[]
  subtotal?: number | null
  tax?: number | null
  agentReport?: string
  /** Named AIs that participated */
  aisUsed?: AiId[]
  /** Primary cloud or on-device lead for UI badge */
  activeAiLabel?: string
}

export type Screen =
  | { name: 'home' }
  | {
      name: 'add'
      initial?: Partial<Purchase> & { agentReport?: string; activeAiLabel?: string }
      receiptBlob?: Blob
      receiptPreviewUrl?: string
    }
  | { name: 'edit'; purchaseId: string }
  | { name: 'detail'; purchaseId: string }
  | { name: 'scan' }
  | { name: 'settings' }
