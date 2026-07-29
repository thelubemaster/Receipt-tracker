import type { AiId } from './aiRoster'

/**
 * Free-form category id (slug). Built-in presets like "fuel" / "engine" still work;
 * AI and user can invent new ones (e.g. "engine-powertrain", "filters-fluids").
 */
export type CategoryId = string

export interface ReceiptLineItem {
  id: string
  description: string
  amount: number
  categoryId: CategoryId
}

/** A receipt-tracking project (school bus, kitchen remodel, trip, etc.). */
export interface Project {
  id: string
  name: string
  description: string
  /** Cover photo in the images store */
  coverImageId: string | null
  createdAt: string
  updatedAt: string
}

export interface Purchase {
  id: string
  /** Which project this receipt belongs to */
  projectId: string
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

export interface CustomCategory {
  id: string
  label: string
  color: string
}

export interface AppSettings {
  /** @deprecated Prefer Project.name — kept for migration from single-project era */
  projectName: string
  lastSeenVersion: string
  /**
   * Quick light mode: when false, skips all “heavy” tier AIs
   * (Hammer, Titan, Mosaic, Bloom, Prism, Council, …).
   */
  maxPowerMode: boolean
  /**
   * Free AIs the user turned off (e.g. phone too weak for Titan/Mosaic).
   * Core AIs (Scout, Ledger, Cashier, Clerk, Arbiter) cannot be disabled.
   */
  disabledAis: import('./aiRoster').AiId[]
  /**
   * Categories the AI or user invented (engine parts, etc.).
   * Grouped with builtins in pickers and home breakdown.
   */
  customCategories: CustomCategory[]
}

/** Which free AI primarily produced each field (for ✓/✗ weighting). */
export type FieldSources = {
  total?: AiId
  vendor?: AiId
  category?: AiId
  date?: AiId
  shipping?: AiId
  fees?: AiId
  /** line item id → AI */
  lines?: Record<string, AiId>
  /** Main OCR path that fed the parse */
  ocr?: AiId
  /**
   * Best single AI to credit for “the answer” this scan
   * (highest reliability / most fields / quorum winner).
   */
  primary?: AiId
  /** Short human label for who answered (shown after rescan) */
  answerLabel?: string
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
  fieldSources?: FieldSources
}

export type ScanFormSeed = Partial<Purchase> & {
  agentReport?: string
  activeAiLabel?: string
  rawText?: string
  confidence?: number
  source?: string
  subtotal?: number | null
  tax?: number | null
  fieldSources?: FieldSources
}

export type Screen =
  | { name: 'home' }
  | { name: 'project'; projectId: string }
  | { name: 'project-edit'; projectId?: string }
  | {
      name: 'add'
      projectId: string
      initial?: ScanFormSeed
      receiptBlob?: Blob
      receiptPreviewUrl?: string
    }
  | { name: 'edit'; purchaseId: string; projectId: string }
  | { name: 'detail'; purchaseId: string; projectId: string }
  | {
      name: 'scan'
      projectId: string
      /** Re-run AI on this photo (e.g. after a bad first read) */
      retryBlob?: Blob
      retryPreviewUrl?: string
      /** Snapshot of the answer the user rejected — AIs diversify away from it */
      rejected?: import('./agents/retryFeedback').RejectedScanSnapshot
    }
  | { name: 'settings' }
