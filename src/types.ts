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

export interface Purchase {
  id: string
  date: string
  description: string
  amount: number
  categoryId: CategoryId
  vendor: string
  notes: string
  receiptImageId: string | null
  createdAt: string
  updatedAt: string
}

export interface AppSettings {
  apiKey: string
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
}

export type Screen =
  | { name: 'home' }
  | { name: 'add'; initial?: Partial<Purchase>; receiptBlob?: Blob; receiptPreviewUrl?: string }
  | { name: 'edit'; purchaseId: string }
  | { name: 'detail'; purchaseId: string }
  | { name: 'scan' }
  | { name: 'settings' }
