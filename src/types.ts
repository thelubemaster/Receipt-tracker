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
  aisUsed: AiId[]
  bestAiId?: AiId | null
  createdAt: string
  updatedAt: string
}

export interface AppSettings {
  projectName: string
  lastSeenVersion: string
  /** Run Hammer + Titan heavy engines (default true) */
  maxPowerMode: boolean
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
  aisUsed?: AiId[]
  activeAiLabel?: string
}

export type ScanFormSeed = Partial<Purchase> & {
  agentReport?: string
  activeAiLabel?: string
  rawText?: string
  confidence?: number
  source?: string
  subtotal?: number | null
  tax?: number | null
}

export type Screen =
  | { name: 'home' }
  | {
      name: 'add'
      initial?: ScanFormSeed
      receiptBlob?: Blob
      receiptPreviewUrl?: string
    }
  | { name: 'edit'; purchaseId: string }
  | { name: 'detail'; purchaseId: string }
  | {
      name: 'scan'
      /** Re-run AI on this photo (e.g. after a bad first read) */
      retryBlob?: Blob
      retryPreviewUrl?: string
      /** Snapshot of the answer the user rejected — AIs diversify away from it */
      rejected?: import('./agents/retryFeedback').RejectedScanSnapshot
    }
  | { name: 'settings' }
