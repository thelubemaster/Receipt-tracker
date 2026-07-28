/**
 * Local storage for Schoolie — IndexedDB with automatic recovery.
 * If IDB is blocked/broken, fall back to in-memory so the app always boots.
 * Free · on-device only · no network.
 */
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
      receiptMemory?: ReceiptMemory
    }
  }
}

const DB_NAME = 'schoolie-tracker'
const DB_VERSION = 2
const SETTINGS_KEY = 'app'
const META_KEY = 'meta'
const MEMORY_KEY = 'receipt-memory'

type ImageRow = { id: string; blob: Blob; createdAt: string }
type MetaRow = {
  id: string
  leaderboard?: LeaderboardMap
  receiptMemory?: ReceiptMemory
}

/** Session fallback when IndexedDB will not open */
type MemoryBackend = {
  purchases: Map<string, Purchase>
  images: Map<string, ImageRow>
  settings: (AppSettings & { id: string }) | null
  meta: Map<string, MetaRow>
}

type StorageMode = 'idb' | 'memory'

let mode: StorageMode | null = null
let idb: IDBPDatabase<SchoolieDB> | null = null
let mem: MemoryBackend | null = null
let initPromise: Promise<void> | null = null
/** Soft notice for the UI (auto-recovered storage) */
let storageNotice: string | null = null

export function getStorageNotice(): string | null {
  return storageNotice
}

export function clearStorageNotice(): void {
  storageNotice = null
}

export function isUsingMemoryStorage(): boolean {
  return mode === 'memory'
}

function defaultSettings(): AppSettings {
  return {
    projectName: 'My Schoolie',
    lastSeenVersion: '',
    maxPowerMode: true,
    disabledAis: [],
    customCategories: [],
  }
}

function emptyMemoryBackend(): MemoryBackend {
  return {
    purchases: new Map(),
    images: new Map(),
    settings: null,
    meta: new Map(),
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  }) as Promise<T>
}

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

function openIdb(version: number): Promise<IDBPDatabase<SchoolieDB>> {
  return openDB<SchoolieDB>(DB_NAME, version, {
    upgrade(db, oldVersion) {
      upgradeSchoolie(db as IDBPDatabase<SchoolieDB>, oldVersion)
    },
    blocked() {
      console.warn('[schoolie] IndexedDB blocked by another tab')
    },
    blocking() {
      // Another tab wants to upgrade — release our connection
      try {
        idb?.close()
      } catch {
        /* ignore */
      }
      idb = null
      mode = null
      initPromise = null
    },
    terminated() {
      idb = null
      mode = null
      initPromise = null
    },
  })
}

function deleteIdb(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      idb?.close()
    } catch {
      /* ignore */
    }
    idb = null
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'))
    req.onblocked = () => {
      // Still resolve after a short wait so we can fall back to memory
      console.warn('[schoolie] deleteDatabase blocked')
      setTimeout(() => resolve(), 500)
    }
  })
}

async function tryOpenIdb(): Promise<IDBPDatabase<SchoolieDB> | null> {
  // Prefer current schema version
  try {
    return await withTimeout(openIdb(DB_VERSION), 2500, 'openDB v2')
  } catch (e) {
    console.warn('[schoolie] open v2 failed', e)
  }
  // Higher version left behind by a partial upgrade attempt
  try {
    return await withTimeout(openIdb(3), 2500, 'openDB v3')
  } catch (e) {
    console.warn('[schoolie] open v3 failed', e)
  }
  // Wipe and recreate
  try {
    await withTimeout(deleteIdb(), 2000, 'deleteDatabase')
    return await withTimeout(openIdb(DB_VERSION), 2500, 'openDB fresh')
  } catch (e) {
    console.warn('[schoolie] recreate failed', e)
  }
  return null
}

function useMemory(reason: string) {
  mode = 'memory'
  mem = emptyMemoryBackend()
  idb = null
  storageNotice =
    reason ||
    'Using temporary in-memory storage (IndexedDB unavailable). Data lasts until you close this tab.'
  console.warn('[schoolie]', storageNotice)
}

/**
 * Ensure storage is ready. Never hangs forever — falls back to memory.
 */
async function ensureStorage(): Promise<void> {
  if (mode === 'idb' && idb) return
  if (mode === 'memory' && mem) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    // Environments without IndexedDB
    if (typeof indexedDB === 'undefined') {
      useMemory('IndexedDB is not available in this browser — using temporary memory storage.')
      return
    }
    const db = await tryOpenIdb()
    if (db) {
      mode = 'idb'
      idb = db
      storageNotice = null
      return
    }
    useMemory(
      'Could not open the local database (often another tab blocking it). Using temporary memory storage for this session. Close other Schoolie tabs and refresh to use permanent storage.',
    )
  })().finally(() => {
    // keep initPromise resolved so we don't re-enter loops; reset only on explicit reset
  })

  return initPromise
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizePurchase(p: Purchase): Purchase {
  return {
    ...p,
    lineItems: Array.isArray(p.lineItems) ? p.lineItems : [],
    aisUsed: Array.isArray(p.aisUsed) ? p.aisUsed : [],
  }
}

export async function listPurchases(): Promise<Purchase[]> {
  await ensureStorage()
  if (mode === 'memory' && mem) {
    return Array.from(mem.purchases.values())
      .map(normalizePurchase)
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date)
        return b.createdAt.localeCompare(a.createdAt)
      })
  }
  const all = await idb!.getAll('purchases')
  return all
    .map(normalizePurchase)
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date)
      return b.createdAt.localeCompare(a.createdAt)
    })
}

export async function getPurchase(id: string): Promise<Purchase | undefined> {
  await ensureStorage()
  if (mode === 'memory' && mem) {
    const p = mem.purchases.get(id)
    return p ? normalizePurchase(p) : undefined
  }
  const p = await idb!.get('purchases', id)
  return p ? normalizePurchase(p) : undefined
}

export async function savePurchase(purchase: Purchase): Promise<void> {
  await ensureStorage()
  const row = normalizePurchase(purchase)
  if (mode === 'memory' && mem) {
    mem.purchases.set(row.id, row)
    return
  }
  await idb!.put('purchases', row)
}

export async function deletePurchase(id: string): Promise<void> {
  await ensureStorage()
  if (mode === 'memory' && mem) {
    const purchase = mem.purchases.get(id)
    mem.purchases.delete(id)
    if (purchase?.receiptImageId) mem.images.delete(purchase.receiptImageId)
    return
  }
  const purchase = await idb!.get('purchases', id)
  await idb!.delete('purchases', id)
  if (purchase?.receiptImageId) {
    await idb!.delete('images', purchase.receiptImageId)
  }
}

export async function saveImage(blob: Blob): Promise<string> {
  await ensureStorage()
  const id = newId()
  const row: ImageRow = { id, blob, createdAt: new Date().toISOString() }
  if (mode === 'memory' && mem) {
    mem.images.set(id, row)
    return id
  }
  await idb!.put('images', row)
  return id
}

export async function getImage(id: string): Promise<Blob | undefined> {
  await ensureStorage()
  if (mode === 'memory' && mem) {
    return mem.images.get(id)?.blob
  }
  const row = await idb!.get('images', id)
  return row?.blob
}

function parseSettingsRow(
  row: (AppSettings & { id: string }) | null | undefined,
): AppSettings {
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

export async function getSettings(): Promise<AppSettings> {
  await ensureStorage()
  if (mode === 'memory' && mem) {
    return parseSettingsRow(mem.settings)
  }
  const row = await idb!.get('settings', SETTINGS_KEY)
  return parseSettingsRow(row)
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureStorage()
  const row = { id: SETTINGS_KEY, ...settings }
  if (mode === 'memory' && mem) {
    mem.settings = row
    return
  }
  await idb!.put('settings', row)
}

export async function getLeaderboard(): Promise<LeaderboardMap | null> {
  await ensureStorage()
  if (mode === 'memory' && mem) {
    return mem.meta.get(META_KEY)?.leaderboard ?? null
  }
  const row = await idb!.get('meta', META_KEY)
  return row?.leaderboard ?? null
}

export async function saveLeaderboard(leaderboard: LeaderboardMap): Promise<void> {
  await ensureStorage()
  if (mode === 'memory' && mem) {
    const existing = mem.meta.get(META_KEY) ?? { id: META_KEY }
    mem.meta.set(META_KEY, { ...existing, id: META_KEY, leaderboard })
    return
  }
  const existing = await idb!.get('meta', META_KEY)
  await idb!.put('meta', { ...existing, id: META_KEY, leaderboard })
}

export async function getReceiptMemory(): Promise<ReceiptMemory> {
  try {
    await ensureStorage()
    if (mode === 'memory' && mem) {
      const row = mem.meta.get(MEMORY_KEY) ?? mem.meta.get(META_KEY)
      if (row?.receiptMemory?.version === 1) return row.receiptMemory
      return emptyReceiptMemory()
    }
    const row = await idb!.get('meta', MEMORY_KEY)
    if (row?.receiptMemory?.version === 1) return row.receiptMemory
    const main = await idb!.get('meta', META_KEY)
    if (main?.receiptMemory?.version === 1) return main.receiptMemory
  } catch {
    /* optional */
  }
  return emptyReceiptMemory()
}

export async function saveReceiptMemory(memory: ReceiptMemory): Promise<void> {
  try {
    await ensureStorage()
    const payload: MetaRow = {
      id: MEMORY_KEY,
      receiptMemory: { ...memory, updatedAt: new Date().toISOString() },
    }
    if (mode === 'memory' && mem) {
      mem.meta.set(MEMORY_KEY, payload)
      return
    }
    await idb!.put('meta', payload)
  } catch (e) {
    console.warn('[schoolie] could not save receipt memory', e)
  }
}

export async function clearReceiptMemory(): Promise<void> {
  await saveReceiptMemory(emptyReceiptMemory())
}

export async function clearAllData(): Promise<void> {
  await ensureStorage()
  if (mode === 'memory' && mem) {
    mem.purchases.clear()
    mem.images.clear()
    mem.meta.clear()
    return
  }
  await idb!.clear('purchases')
  await idb!.clear('images')
  await clearReceiptMemory()
}

/**
 * Force-delete IndexedDB and reopen (or memory). Safe to call from UI.
 */
export async function resetDatabase(): Promise<void> {
  initPromise = null
  mode = null
  try {
    idb?.close()
  } catch {
    /* ignore */
  }
  idb = null
  mem = null
  try {
    await withTimeout(deleteIdb(), 3000, 'reset deleteDatabase')
  } catch {
    /* ignore */
  }
  // Prefer a clean IDB; fall back to memory automatically
  await ensureStorage()
  if (mode === 'idb') {
    storageNotice = 'Local database was reset. You can scan again.'
  }
}

// silence unused defaultSettings if tree-shaken — used for docs/default
void defaultSettings
