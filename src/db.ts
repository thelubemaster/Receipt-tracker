/**
 * Local storage for Schoolie — free, on-device only.
 *
 * Strategy:
 * 1. Prefer IndexedDB (open existing DB first — no version fight / tab blocking).
 * 2. If IDB is unavailable, use localStorage as permanent backup (survives refresh).
 * Tabs do not matter for the backup path; data stays on this device either way.
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
/** Bump when stores change. v3: always recreate any missing stores (fixes partial DBs). */
const DB_VERSION = 3
const REQUIRED_STORES = ['purchases', 'images', 'settings', 'meta'] as const
const SETTINGS_KEY = 'app'
const META_KEY = 'meta'
const MEMORY_KEY = 'receipt-memory'

const LS_PURCHASES = 'schoolie.v1.purchases'
const LS_SETTINGS = 'schoolie.v1.settings'
const LS_LEADERBOARD = 'schoolie.v1.leaderboard'
const LS_MEMORY = 'schoolie.v1.memory'
const LS_IMAGES = 'schoolie.v1.images' // id -> dataUrl (best-effort)

type ImageRow = { id: string; blob: Blob; createdAt: string }
type StorageMode = 'idb' | 'local'

let mode: StorageMode | null = null
let idb: IDBPDatabase<SchoolieDB> | null = null
let initPromise: Promise<void> | null = null
let storageNotice: string | null = null

/** Soft banner text after boot (clear after reading). */
export function getStorageNotice(): string | null {
  return storageNotice
}

export function clearStorageNotice(): void {
  storageNotice = null
}

export function isUsingMemoryStorage(): boolean {
  return mode === 'local'
}

function canUseLocalStorage(): boolean {
  try {
    const k = '__schoolie_probe__'
    localStorage.setItem(k, '1')
    localStorage.removeItem(k)
    return true
  } catch {
    return false
  }
}

function lsRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function lsWrite(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.warn('[schoolie] localStorage write failed', key, e)
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  }) as Promise<T>
}

function hasAllStores(db: { objectStoreNames: DOMStringList }): boolean {
  return REQUIRED_STORES.every((name) => db.objectStoreNames.contains(name))
}

function missingStores(db: { objectStoreNames: DOMStringList }): string[] {
  return REQUIRED_STORES.filter((name) => !db.objectStoreNames.contains(name))
}

/**
 * Create every required object store that is missing.
 * Must NOT gate on oldVersion alone — partial DBs at version 1/2/3 need repair.
 */
function ensureStores(db: IDBPDatabase<SchoolieDB>, _oldVersion: number) {
  if (!db.objectStoreNames.contains('purchases')) {
    const purchases = db.createObjectStore('purchases', { keyPath: 'id' })
    purchases.createIndex('by-date', 'date')
    purchases.createIndex('by-created', 'createdAt')
  }
  if (!db.objectStoreNames.contains('images')) {
    db.createObjectStore('images', { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains('settings')) {
    db.createObjectStore('settings', { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains('meta')) {
    db.createObjectStore('meta', { keyPath: 'id' })
  }
}

function openIdbAtVersion(version: number): Promise<IDBPDatabase<SchoolieDB>> {
  return openDB<SchoolieDB>(DB_NAME, version, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      ensureStores(db as IDBPDatabase<SchoolieDB>, oldVersion)
      // Repair purchases indexes if store pre-existed without them
      try {
        if (db.objectStoreNames.contains('purchases') && transaction) {
          const store = transaction.objectStore('purchases')
          if (!store.indexNames.contains('by-date')) {
            store.createIndex('by-date', 'date')
          }
          if (!store.indexNames.contains('by-created')) {
            store.createIndex('by-created', 'createdAt')
          }
        }
      } catch (e) {
        console.warn('[schoolie] index repair skipped', e)
      }
    },
    blocked() {
      console.warn('[schoolie] IDB open blocked — close other Schoolie tabs if load fails')
    },
    blocking() {
      try {
        idb?.close()
      } catch {
        /* ignore */
      }
      idb = null
      // allow re-init later
      if (mode === 'idb') {
        mode = null
        initPromise = null
      }
    },
    terminated() {
      idb = null
      if (mode === 'idb') {
        mode = null
        initPromise = null
      }
    },
  })
}

function deleteIdb(): Promise<void> {
  return new Promise((resolve) => {
    try {
      idb?.close()
    } catch {
      /* ignore */
    }
    idb = null
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    try {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = () => finish()
      req.onerror = () => finish()
      req.onblocked = () => setTimeout(finish, 400)
    } catch {
      finish()
    }
    setTimeout(finish, 2500)
  })
}

/**
 * Open IDB and guarantee all required stores exist.
 * 1) open existing as-is if complete and version ≥ schema
 * 2) upgrade (create missing stores) if incomplete or outdated
 * 3) wipe + recreate as last resort (localStorage backup still holds purchases)
 */
async function openIdbFriendly(): Promise<IDBPDatabase<SchoolieDB> | null> {
  if (typeof indexedDB === 'undefined') return null

  // 1) Open whatever version already exists
  try {
    const existing = await withTimeout(openDB<SchoolieDB>(DB_NAME), 5000, 'open existing')
    const missing = missingStores(existing)
    const needsUpgrade = missing.length > 0 || existing.version < DB_VERSION

    if (!needsUpgrade && hasAllStores(existing)) {
      return existing as IDBPDatabase<SchoolieDB>
    }

    // Upgrade: at least DB_VERSION, or +1 past current if already higher but incomplete
    const target = Math.max(DB_VERSION, existing.version + (missing.length ? 1 : 0))
    if (missing.length) {
      console.warn('[schoolie] IDB missing stores:', missing.join(', '), '→ upgrading to', target)
    }
    existing.close()
    const upgraded = await withTimeout(openIdbAtVersion(target), 6000, 'upgrade stores')
    if (hasAllStores(upgraded)) return upgraded
    console.warn('[schoolie] upgrade still missing stores:', missingStores(upgraded).join(', '))
    try {
      upgraded.close()
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.warn('[schoolie] open existing failed', e)
  }

  // 2) Open at current schema version (fresh install or after close)
  try {
    const db = await withTimeout(openIdbAtVersion(DB_VERSION), 5000, 'open schema')
    if (hasAllStores(db)) return db
    try {
      db.close()
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.warn('[schoolie] open schema failed', e)
  }

  // 3) Higher leftover version (e.g. old experiment at v4+)
  try {
    const probe = await withTimeout(openDB<SchoolieDB>(DB_NAME), 4000, 'probe version')
    const ver = Math.max(probe.version, DB_VERSION) + 1
    probe.close()
    const db = await withTimeout(openIdbAtVersion(ver), 5000, 'open next')
    if (hasAllStores(db)) return db
    try {
      db.close()
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.warn('[schoolie] open next failed', e)
  }

  // 4) Wipe once and recreate clean schema (purchases survive in localStorage backup)
  try {
    await deleteIdb()
    const db = await withTimeout(openIdbAtVersion(DB_VERSION), 5000, 'open fresh')
    if (hasAllStores(db)) return db
    try {
      db.close()
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.warn('[schoolie] recreate failed', e)
  }

  return null
}

function isMissingStoreError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /object store|not found|NotFoundError/i.test(msg)
}

/** Drop broken IDB handle so the next call re-opens / repairs. */
function invalidateIdb() {
  try {
    idb?.close()
  } catch {
    /* ignore */
  }
  idb = null
  mode = null
  initPromise = null
}

async function ensureStorage(): Promise<void> {
  if (mode === 'idb' && idb) return
  if (mode === 'local') return
  if (initPromise) return initPromise

  initPromise = (async () => {
    const db = await openIdbFriendly()
    if (db) {
      mode = 'idb'
      idb = db
      storageNotice = null
      // Migrate localStorage backup into IDB if IDB is empty
      await migrateLocalToIdbIfEmpty(db)
      return
    }
    // Permanent device backup — not session memory
    mode = 'local'
    if (!canUseLocalStorage()) {
      storageNotice =
        'Browser storage is restricted. Purchases may not persist after you close the tab.'
    } else {
      storageNotice = null // silent permanent localStorage — no scary tab message
    }
  })()

  try {
    await initPromise
  } catch (e) {
    console.warn('[schoolie] ensureStorage failed, using localStorage', e)
    mode = 'local'
    initPromise = Promise.resolve()
  }
}

async function migrateLocalToIdbIfEmpty(db: IDBPDatabase<SchoolieDB>): Promise<void> {
  try {
    const count = await db.count('purchases')
    if (count > 0) return
    const fromLs = lsRead<Purchase[]>(LS_PURCHASES, [])
    if (!fromLs.length) return
    for (const p of fromLs) {
      await db.put('purchases', normalizePurchase(p))
    }
    const settings = lsRead<AppSettings | null>(LS_SETTINGS, null)
    if (settings) {
      await db.put('settings', { id: SETTINGS_KEY, ...settings })
    }
    const board = lsRead<LeaderboardMap | null>(LS_LEADERBOARD, null)
    if (board) {
      await db.put('meta', { id: META_KEY, leaderboard: board })
    }
    const memory = lsRead<ReceiptMemory | null>(LS_MEMORY, null)
    if (memory?.version === 1) {
      await db.put('meta', { id: MEMORY_KEY, receiptMemory: memory })
    }
    console.info('[schoolie] restored', fromLs.length, 'purchases from local backup into IndexedDB')
  } catch (e) {
    console.warn('[schoolie] migrate local→idb failed', e)
  }
}

/** Mirror important data to localStorage whenever we use IDB (backup if IDB breaks later). */
function backupPurchaseList(list: Purchase[]): void {
  if (!canUseLocalStorage()) return
  try {
    // Strip nothing critical — purchases are JSON-safe (no blobs on the purchase itself)
    lsWrite(LS_PURCHASES, list)
  } catch {
    /* ignore */
  }
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

function sortPurchases(list: Purchase[]): Purchase[] {
  return list
    .map(normalizePurchase)
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date)
      return b.createdAt.localeCompare(a.createdAt)
    })
}

async function useLocalPurchases(): Promise<Purchase[]> {
  return sortPurchases(lsRead<Purchase[]>(LS_PURCHASES, []))
}

export async function listPurchases(): Promise<Purchase[]> {
  await ensureStorage()
  if (mode !== 'idb' || !idb) return useLocalPurchases()
  try {
    const all = await idb.getAll('purchases')
    const sorted = sortPurchases(all)
    backupPurchaseList(sorted)
    return sorted
  } catch (e) {
    if (!isMissingStoreError(e)) throw e
    console.warn('[schoolie] listPurchases store missing — repairing', e)
    invalidateIdb()
    await ensureStorage()
    const db = idb
    if (mode !== 'idb' || !db) return useLocalPurchases()
    try {
      const all = await db.getAll('purchases')
      const sorted = sortPurchases(all)
      backupPurchaseList(sorted)
      return sorted
    } catch {
      mode = 'local'
      return useLocalPurchases()
    }
  }
}

export async function getPurchase(id: string): Promise<Purchase | undefined> {
  await ensureStorage()
  if (mode === 'local') {
    const p = lsRead<Purchase[]>(LS_PURCHASES, []).find((x) => x.id === id)
    return p ? normalizePurchase(p) : undefined
  }
  try {
    const p = await idb!.get('purchases', id)
    return p ? normalizePurchase(p) : undefined
  } catch (e) {
    if (!isMissingStoreError(e)) throw e
    invalidateIdb()
    await ensureStorage()
    const p = lsRead<Purchase[]>(LS_PURCHASES, []).find((x) => x.id === id)
    return p ? normalizePurchase(p) : undefined
  }
}

export async function savePurchase(purchase: Purchase): Promise<void> {
  await ensureStorage()
  const row = normalizePurchase(purchase)
  if (mode === 'local') {
    const list = lsRead<Purchase[]>(LS_PURCHASES, []).filter((p) => p.id !== row.id)
    list.push(row)
    lsWrite(LS_PURCHASES, list)
    return
  }
  try {
    await idb!.put('purchases', row)
    try {
      const all = await idb!.getAll('purchases')
      backupPurchaseList(all)
    } catch {
      backupPurchaseList([row, ...lsRead<Purchase[]>(LS_PURCHASES, []).filter((p) => p.id !== row.id)])
    }
  } catch (e) {
    if (!isMissingStoreError(e)) throw e
    invalidateIdb()
    await ensureStorage()
    if (mode === 'idb' && idb) {
      await idb.put('purchases', row)
      return
    }
    const list = lsRead<Purchase[]>(LS_PURCHASES, []).filter((p) => p.id !== row.id)
    list.push(row)
    lsWrite(LS_PURCHASES, list)
  }
}

export async function deletePurchase(id: string): Promise<void> {
  await ensureStorage()
  if (mode === 'local') {
    const list = lsRead<Purchase[]>(LS_PURCHASES, [])
    const hit = list.find((p) => p.id === id)
    lsWrite(
      LS_PURCHASES,
      list.filter((p) => p.id !== id),
    )
    if (hit?.receiptImageId) {
      const imgs = lsRead<Record<string, string>>(LS_IMAGES, {})
      delete imgs[hit.receiptImageId]
      lsWrite(LS_IMAGES, imgs)
    }
    return
  }
  try {
    const purchase = await idb!.get('purchases', id)
    await idb!.delete('purchases', id)
    if (purchase?.receiptImageId) {
      try {
        await idb!.delete('images', purchase.receiptImageId)
      } catch {
        /* image store optional */
      }
    }
    try {
      backupPurchaseList(await idb!.getAll('purchases'))
    } catch {
      /* ignore */
    }
  } catch (e) {
    if (!isMissingStoreError(e)) throw e
    invalidateIdb()
    mode = 'local'
    initPromise = Promise.resolve()
    const list = lsRead<Purchase[]>(LS_PURCHASES, []).filter((p) => p.id !== id)
    lsWrite(LS_PURCHASES, list)
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob | undefined> {
  try {
    const res = await fetch(dataUrl)
    return await res.blob()
  } catch {
    return undefined
  }
}

async function saveImageLocal(id: string, blob: Blob): Promise<void> {
  try {
    if (blob.size < 1_200_000) {
      const dataUrl = await blobToDataUrl(blob)
      const imgs = lsRead<Record<string, string>>(LS_IMAGES, {})
      imgs[id] = dataUrl
      const keys = Object.keys(imgs)
      if (keys.length > 30) {
        for (const k of keys.slice(0, keys.length - 30)) delete imgs[k]
      }
      lsWrite(LS_IMAGES, imgs)
    }
  } catch {
    /* image optional in local mode */
  }
}

export async function saveImage(blob: Blob): Promise<string> {
  await ensureStorage()
  const id = newId()
  const row: ImageRow = { id, blob, createdAt: new Date().toISOString() }
  if (mode === 'local') {
    await saveImageLocal(id, blob)
    return id
  }
  try {
    await idb!.put('images', row)
  } catch (e) {
    if (!isMissingStoreError(e)) throw e
    invalidateIdb()
    await ensureStorage()
    if (mode === 'idb' && idb) {
      try {
        await idb.put('images', row)
        return id
      } catch {
        /* fall through */
      }
    }
    await saveImageLocal(id, blob)
  }
  return id
}

export async function getImage(id: string): Promise<Blob | undefined> {
  await ensureStorage()
  if (mode === 'local') {
    const imgs = lsRead<Record<string, string>>(LS_IMAGES, {})
    const dataUrl = imgs[id]
    if (!dataUrl) return undefined
    return dataUrlToBlob(dataUrl)
  }
  try {
    const row = await idb!.get('images', id)
    return row?.blob
  } catch (e) {
    if (!isMissingStoreError(e)) throw e
    const imgs = lsRead<Record<string, string>>(LS_IMAGES, {})
    const dataUrl = imgs[id]
    if (!dataUrl) return undefined
    return dataUrlToBlob(dataUrl)
  }
}

function parseSettingsRow(
  row: (AppSettings & { id?: string }) | null | undefined,
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
  if (mode === 'local') {
    return parseSettingsRow(lsRead<AppSettings | null>(LS_SETTINGS, null))
  }
  try {
    const row = await idb!.get('settings', SETTINGS_KEY)
    const parsed = parseSettingsRow(row)
    lsWrite(LS_SETTINGS, parsed)
    return parsed
  } catch (e) {
    if (!isMissingStoreError(e)) throw e
    console.warn('[schoolie] settings store missing — repairing', e)
    invalidateIdb()
    await ensureStorage()
    if (mode === 'idb' && idb) {
      try {
        const row = await idb.get('settings', SETTINGS_KEY)
        const parsed = parseSettingsRow(row)
        lsWrite(LS_SETTINGS, parsed)
        return parsed
      } catch {
        /* fall through */
      }
    }
    return parseSettingsRow(lsRead<AppSettings | null>(LS_SETTINGS, null))
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureStorage()
  lsWrite(LS_SETTINGS, settings)
  if (mode === 'local') return
  try {
    await idb!.put('settings', { id: SETTINGS_KEY, ...settings })
  } catch (e) {
    if (!isMissingStoreError(e)) throw e
    invalidateIdb()
    await ensureStorage()
    if (mode === 'idb' && idb) {
      try {
        await idb.put('settings', { id: SETTINGS_KEY, ...settings })
      } catch {
        /* localStorage already has it */
      }
    }
  }
}

export async function getLeaderboard(): Promise<LeaderboardMap | null> {
  await ensureStorage()
  if (mode === 'local') {
    return lsRead<LeaderboardMap | null>(LS_LEADERBOARD, null)
  }
  try {
    const row = await idb!.get('meta', META_KEY)
    return row?.leaderboard ?? lsRead<LeaderboardMap | null>(LS_LEADERBOARD, null)
  } catch (e) {
    if (!isMissingStoreError(e)) throw e
    return lsRead<LeaderboardMap | null>(LS_LEADERBOARD, null)
  }
}

export async function saveLeaderboard(leaderboard: LeaderboardMap): Promise<void> {
  await ensureStorage()
  lsWrite(LS_LEADERBOARD, leaderboard)
  if (mode === 'local') return
  try {
    const existing = await idb!.get('meta', META_KEY)
    await idb!.put('meta', { ...existing, id: META_KEY, leaderboard })
  } catch (e) {
    if (!isMissingStoreError(e)) throw e
    /* localStorage already has it */
  }
}

export async function getReceiptMemory(): Promise<ReceiptMemory> {
  try {
    await ensureStorage()
    if (mode === 'local') {
      const m = lsRead<ReceiptMemory | null>(LS_MEMORY, null)
      return m?.version === 1 ? m : emptyReceiptMemory()
    }
    const row = await idb!.get('meta', MEMORY_KEY)
    if (row?.receiptMemory?.version === 1) return row.receiptMemory
    const main = await idb!.get('meta', META_KEY)
    if (main?.receiptMemory?.version === 1) return main.receiptMemory
    const ls = lsRead<ReceiptMemory | null>(LS_MEMORY, null)
    if (ls?.version === 1) return ls
  } catch {
    /* optional */
  }
  return emptyReceiptMemory()
}

export async function saveReceiptMemory(memory: ReceiptMemory): Promise<void> {
  const payload: ReceiptMemory = {
    ...memory,
    updatedAt: new Date().toISOString(),
  }
  lsWrite(LS_MEMORY, payload)
  try {
    await ensureStorage()
    if (mode === 'local') return
    await idb!.put('meta', { id: MEMORY_KEY, receiptMemory: payload })
  } catch (e) {
    console.warn('[schoolie] could not save receipt memory to IDB', e)
  }
}

export async function clearReceiptMemory(): Promise<void> {
  await saveReceiptMemory(emptyReceiptMemory())
}

export async function clearAllData(): Promise<void> {
  lsWrite(LS_PURCHASES, [])
  lsWrite(LS_IMAGES, {})
  lsWrite(LS_MEMORY, emptyReceiptMemory())
  await ensureStorage()
  if (mode === 'local' || !idb) return
  try {
    if (idb.objectStoreNames.contains('purchases')) await idb.clear('purchases')
    if (idb.objectStoreNames.contains('images')) await idb.clear('images')
    if (idb.objectStoreNames.contains('meta')) {
      await idb.delete('meta', MEMORY_KEY).catch(() => undefined)
    }
  } catch (e) {
    console.warn('[schoolie] clearAllData IDB partial', e)
  }
}

/**
 * Wipe IndexedDB and reopen a clean schema.
 * Also clears purchases/images/memory in localStorage so "Reset local data" is a full wipe.
 */
export async function resetDatabase(): Promise<void> {
  try {
    idb?.close()
  } catch {
    /* ignore */
  }
  idb = null
  mode = null
  initPromise = null

  // Full wipe so a half-broken schema cannot come back from LS migration only half-fixed
  try {
    localStorage.removeItem(LS_PURCHASES)
    localStorage.removeItem(LS_IMAGES)
    localStorage.removeItem(LS_MEMORY)
    localStorage.removeItem(LS_LEADERBOARD)
    // keep settings (project name) — less annoying after reset
  } catch {
    /* ignore */
  }

  try {
    await deleteIdb()
  } catch {
    /* ignore */
  }

  // Force a clean open. ensureStorage falls back to localStorage if IDB is broken.
  await ensureStorage()
  storageNotice = null
}
