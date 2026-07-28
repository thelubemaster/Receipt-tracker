import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { sanitizeDisabledAis } from './aiRoster'
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
/**
 * Schema version. Receipt memory uses the existing `meta` store (no new stores).
 * We open at 2; if a device already has a higher version (partial v3 bump), open that.
 */
const DB_VERSION = 2
const SETTINGS_KEY = 'app'
const META_KEY = 'meta'
const MEMORY_KEY = 'receipt-memory'

/** Max time to wait for IndexedDB open (blocked upgrades used to hang forever). */
const DB_OPEN_MS = 6000

let dbPromise: Promise<IDBPDatabase<SchoolieDB>> | null = null

function upgradeSchoolie(db: IDBPDatabase<SchoolieDB>, oldVersion: number) {
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
}

function openSchoolieDb(version: number): Promise<IDBPDatabase<SchoolieDB>> {
  return openDB<SchoolieDB>(DB_NAME, version, {
    upgrade(db, oldVersion) {
      upgradeSchoolie(db as IDBPDatabase<SchoolieDB>, oldVersion)
    },
    blocked() {
      console.warn(
        '[schoolie] IndexedDB open blocked — close other Schoolie tabs and refresh.',
      )
    },
    blocking() {
      console.warn('[schoolie] IndexedDB connection is blocking; closing for upgrade.')
    },
    terminated() {
      dbPromise = null
    },
  })
}

async function openSchoolieDbResilient(): Promise<IDBPDatabase<SchoolieDB>> {
  try {
    return await openSchoolieDb(DB_VERSION)
  } catch (e) {
    // Existing DB is a higher version (e.g. brief v3 experiment) — open without downgrade
    const msg = e instanceof Error ? e.message : String(e)
    if (/version|less than/i.test(msg)) {
      return await openSchoolieDb(3)
    }
    throw e
  }
}

function getDb(): Promise<IDBPDatabase<SchoolieDB>> {
  if (!dbPromise) {
    const open = openSchoolieDbResilient()
    const timeout = new Promise<never>((_, reject) => {
      const t =
        typeof globalThis.setTimeout === 'function'
          ? globalThis.setTimeout.bind(globalThis)
          : (fn: () => void, ms: number) => {
              /* node fallback */
              return setTimeout(fn, ms)
            }
      t(() => {
        reject(
          new Error(
            'Database is taking too long to open. Close other Schoolie tabs, then refresh. If it still hangs, use “Reset local data” or clear site data for this app.',
          ),
        )
      }, DB_OPEN_MS)
    })
    dbPromise = Promise.race([open, timeout]).catch((err) => {
      dbPromise = null
      throw err
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
  try {
    const db = await getDb()
    const row = await db.get('meta', MEMORY_KEY)
    if (row?.receiptMemory && row.receiptMemory.version === 1) {
      return row.receiptMemory
    }
    const main = await db.get('meta', META_KEY)
    if (main?.receiptMemory && main.receiptMemory.version === 1) {
      return main.receiptMemory
    }
  } catch {
    /* memory is optional — never block the app */
  }
  return emptyReceiptMemory()
}

export async function saveReceiptMemory(memory: ReceiptMemory): Promise<void> {
  try {
    const db = await getDb()
    await db.put('meta', {
      id: MEMORY_KEY,
      receiptMemory: { ...memory, updatedAt: new Date().toISOString() },
    })
  } catch (e) {
    console.warn('[schoolie] could not save receipt memory', e)
  }
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

/**
 * If IndexedDB is stuck (blocked upgrade), delete the whole DB and start fresh.
 * Call only with user consent — wipes local purchases/images.
 */
export async function resetDatabase(): Promise<void> {
  dbPromise = null
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'))
    req.onblocked = () => {
      console.warn('[schoolie] deleteDatabase blocked — close other tabs')
    }
  })
}
