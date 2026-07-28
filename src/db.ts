import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { LeaderboardMap } from './leaderboard'
import {
  emptyReceiptMemory,
  type ReceiptMemory,
} from './receiptMemory'
import type { AppSettings, Purchase } from './types'

interface SchoolieDB extends DBSchema {
  purchases: {
    key: string
    value: Purchase
    indexes: { 'by-date': string; 'by-created': string }
  }
  images: {
    key: string
    value: { id: string; blob: Blob; createdAt: string }
  }
  settings: {
    key: string
    value: AppSettings & { id: string }
  }
  meta: {
    key: string
    value: {
      id: string
      leaderboard?: LeaderboardMap
      /** On-device learnings from saved receipts — free, never leaves the phone */
      receiptMemory?: ReceiptMemory
    }
  }
}

const DB_NAME = 'schoolie-tracker'
const DB_VERSION = 3
const SETTINGS_KEY = 'app'
const META_KEY = 'meta'
const MEMORY_KEY = 'receipt-memory'

let dbPromise: Promise<IDBPDatabase<SchoolieDB>> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<SchoolieDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const purchases = db.createObjectStore('purchases', { keyPath: 'id' })
          purchases.createIndex('by-date', 'date')
          purchases.createIndex('by-created', 'createdAt')
          db.createObjectStore('images', { keyPath: 'id' })
          db.createObjectStore('settings', { keyPath: 'id' })
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta', { keyPath: 'id' })
          }
        }
        // v3: receiptMemory lives on meta rows (no new store required)
      },
    })
  }
  return dbPromise
}

export function newId(): string {
  return crypto.randomUUID()
}

function normalizePurchase(p: Purchase): Purchase {
  return {
    ...p,
    lineItems: Array.isArray(p.lineItems) ? p.lineItems : [],
    aisUsed: Array.isArray(p.aisUsed) ? p.aisUsed : [],
  }
}

export async function listPurchases(): Promise<Purchase[]> {
  const db = await getDb()
  const all = await db.getAll('purchases')
  return all
    .map(normalizePurchase)
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date)
      return b.createdAt.localeCompare(a.createdAt)
    })
}

export async function getPurchase(id: string): Promise<Purchase | undefined> {
  const db = await getDb()
  const p = await db.get('purchases', id)
  return p ? normalizePurchase(p) : undefined
}

export async function savePurchase(purchase: Purchase): Promise<void> {
  const db = await getDb()
  await db.put('purchases', normalizePurchase(purchase))
}

export async function deletePurchase(id: string): Promise<void> {
  const db = await getDb()
  const purchase = await db.get('purchases', id)
  await db.delete('purchases', id)
  if (purchase?.receiptImageId) {
    await db.delete('images', purchase.receiptImageId)
  }
}

export async function saveImage(blob: Blob): Promise<string> {
  const db = await getDb()
  const id = newId()
  await db.put('images', { id, blob, createdAt: new Date().toISOString() })
  return id
}

export async function getImage(id: string): Promise<Blob | undefined> {
  const db = await getDb()
  const row = await db.get('images', id)
  return row?.blob
}

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb()
  const row = await db.get('settings', SETTINGS_KEY)
  const { sanitizeDisabledAis } = await import('./aiRoster')
  const rawCustom = (row as { customCategories?: unknown } | undefined)?.customCategories
  const customCategories = Array.isArray(rawCustom)
    ? rawCustom
        .filter(
          (c): c is { id: string; label: string; color: string } =>
            !!c &&
            typeof c === 'object' &&
            typeof (c as { id?: unknown }).id === 'string' &&
            typeof (c as { label?: unknown }).label === 'string',
        )
        .map((c) => ({
          id: c.id,
          label: c.label,
          color: typeof c.color === 'string' ? c.color : '#7f8c8d',
        }))
    : []
  return {
    projectName: row?.projectName ?? 'My Schoolie',
    lastSeenVersion: row?.lastSeenVersion ?? '',
    maxPowerMode: row?.maxPowerMode !== false,
    disabledAis: sanitizeDisabledAis(
      (row as { disabledAis?: unknown } | undefined)?.disabledAis,
    ),
    customCategories,
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await getDb()
  await db.put('settings', { id: SETTINGS_KEY, ...settings })
}

export async function getLeaderboard(): Promise<LeaderboardMap | null> {
  const db = await getDb()
  const row = await db.get('meta', META_KEY)
  return row?.leaderboard ?? null
}

export async function saveLeaderboard(leaderboard: LeaderboardMap): Promise<void> {
  const db = await getDb()
  const existing = await db.get('meta', META_KEY)
  await db.put('meta', { ...existing, id: META_KEY, leaderboard })
}

export async function getReceiptMemory(): Promise<ReceiptMemory> {
  const db = await getDb()
  const row = await db.get('meta', MEMORY_KEY)
  if (row?.receiptMemory && row.receiptMemory.version === 1) {
    return row.receiptMemory
  }
  // Also allow memory nested under main meta (older experiments)
  const main = await db.get('meta', META_KEY)
  if (main?.receiptMemory && main.receiptMemory.version === 1) {
    return main.receiptMemory
  }
  return emptyReceiptMemory()
}

export async function saveReceiptMemory(memory: ReceiptMemory): Promise<void> {
  const db = await getDb()
  await db.put('meta', {
    id: MEMORY_KEY,
    receiptMemory: { ...memory, updatedAt: new Date().toISOString() },
  })
}

export async function clearReceiptMemory(): Promise<void> {
  await saveReceiptMemory(emptyReceiptMemory())
}

export async function clearAllData(): Promise<void> {
  const db = await getDb()
  await db.clear('purchases')
  await db.clear('images')
  await clearReceiptMemory()
}
