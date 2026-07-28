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
const DB_VERSION = 2
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

function ensureStores(db: IDBPDatabase<SchoolieDB>, oldVersion: number) {
  if (oldVersion < 1) {
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
  }
  if (oldVersion < 2 || !db.objectStoreNames.contains('meta')) {
    if (!db.objectStoreNames.contains('meta')) {
      db.createObjectStore('meta', { keyPath: 'id' })
    }
  }
}

function openIdbAtVersion(version: number): Promise<IDBPDatabase<SchoolieDB>> {
  return openDB<SchoolieDB>(DB_NAME, version, {
    upgrade(db, oldVersion) {
      ensureStores(db as IDBPDatabase<SchoolieDB>, oldVersion)
    },
    blocked() {
      console.warn('[schoolie] IDB open blocked')
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
 * Open IDB without picking a fight over version:
 * 1) open current version as-is
 * 2) if stores missing, bump +1 and create them
 * 3) if that fails, recreate clean v2
 */
async function openIdbFriendly(): Promise<IDBPDatabase<SchoolieDB> | null> {
  if (typeof indexedDB === 'undefined') return null

  // 1) Open whatever version already exists (no upgrade → no block from version change)
  try {
    const existing = await withTimeout(openDB<SchoolieDB>(DB_NAME), 4000, 'open existing')
    const needMeta = !existing.objectStoreNames.contains('meta')
    const needPurchases = !existing.objectStoreNames.contains('purchases')
    if (!needMeta && !needPurchases) {
      return existing as IDBPDatabase<SchoolieDB>
    }
    const nextVer = Math.max(existing.version, 1) + 1
    existing.close()
    return await withTimeout(openIdbAtVersion(nextVer), 4000, 'upgrade stores')
  } catch (e) {
    console.warn('[schoolie] open existing failed', e)
  }

  // 2) Fresh open at our schema version
  try {
    return await withTimeout(openIdbAtVersion(DB_VERSION), 4000, 'open v2')
  } catch (e) {
    console.warn('[schoolie] open v2 failed', e)
  }

  // 3) Higher version left over
  try {
    return await withTimeout(openIdbAtVersion(3), 4000, 'open v3')
  } catch (e) {
    console.warn('[schoolie] open v3 failed', e)
  }

  // 4) Wipe once and recreate
  try {
    await deleteIdb()
    return await withTimeout(openIdbAtVersion(DB_VERSION), 4000, 'open fresh')
  } catch (e) {
    console.warn('[schoolie] recreate failed', e)
  }

  return null
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

export async function listPurchases(): Promise<Purchase[]> {
  await ensureStorage()
  if (mode === 'local') {
    return sortPurchases(lsRead<Purchase[]>(LS_PURCHASES, []))
  }
  const all = await idb!.getAll('purchases')
  const sorted = sortPurchases(all)
  backupPurchaseList(sorted)
  return sorted
}

export async function getPurchase(id: string): Promise<Purchase | undefined> {
  await ensureStorage()
  if (mode === 'local') {
    const p = lsRead<Purchase[]>(LS_PURCHASES, []).find((x) => x.id === id)
    return p ? normalizePurchase(p) : undefined
  }
  const p = await idb!.get('purchases', id)
  return p ? normalizePurchase(p) : undefined
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
  await idb!.put('purchases', row)
  // keep backup in sync
  try {
    const all = await idb!.getAll('purchases')
    backupPurchaseList(all)
  } catch {
    /* ignore */
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
  const purchase = await idb!.get('purchases', id)
  await idb!.delete('purchases', id)
  if (purchase?.receiptImageId) {
    await idb!.delete('images', purchase.receiptImageId)
  }
  try {
    backupPurchaseList(await idb!.getAll('purchases'))
  } catch {
    /* ignore */
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

export async function saveImage(blob: Blob): Promise<string> {
  await ensureStorage()
  const id = newId()
  const row: ImageRow = { id, blob, createdAt: new Date().toISOString() }
  if (mode === 'local') {
    try {
      // Cap size ~1.5MB data URL to avoid filling localStorage
      if (blob.size < 1_200_000) {
        const dataUrl = await blobToDataUrl(blob)
        const imgs = lsRead<Record<string, string>>(LS_IMAGES, {})
        imgs[id] = dataUrl
        // keep last 30 images
        const keys = Object.keys(imgs)
        if (keys.length > 30) {
          for (const k of keys.slice(0, keys.length - 30)) delete imgs[k]
        }
        lsWrite(LS_IMAGES, imgs)
      }
    } catch {
      /* image optional in local mode */
    }
    return id
  }
  await idb!.put('images', row)
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
  const row = await idb!.get('images', id)
  return row?.blob
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
  const row = await idb!.get('settings', SETTINGS_KEY)
  const parsed = parseSettingsRow(row)
  lsWrite(LS_SETTINGS, parsed)
  return parsed
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureStorage()
  if (mode === 'local') {
    lsWrite(LS_SETTINGS, settings)
    return
  }
  await idb!.put('settings', { id: SETTINGS_KEY, ...settings })
  lsWrite(LS_SETTINGS, settings)
}

export async function getLeaderboard(): Promise<LeaderboardMap | null> {
  await ensureStorage()
  if (mode === 'local') {
    return lsRead<LeaderboardMap | null>(LS_LEADERBOARD, null)
  }
  const row = await idb!.get('meta', META_KEY)
  return row?.leaderboard ?? lsRead<LeaderboardMap | null>(LS_LEADERBOARD, null)
}

export async function saveLeaderboard(leaderboard: LeaderboardMap): Promise<void> {
  await ensureStorage()
  lsWrite(LS_LEADERBOARD, leaderboard)
  if (mode === 'local') return
  const existing = await idb!.get('meta', META_KEY)
  await idb!.put('meta', { ...existing, id: META_KEY, leaderboard })
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
  await ensureStorage()
  if (mode === 'local') {
    lsWrite(LS_PURCHASES, [])
    lsWrite(LS_IMAGES, {})
    lsWrite(LS_MEMORY, emptyReceiptMemory())
    return
  }
  await idb!.clear('purchases')
  await idb!.clear('images')
  await clearReceiptMemory()
  lsWrite(LS_PURCHASES, [])
  lsWrite(LS_IMAGES, {})
}

export async function resetDatabase(): Promise<void> {
  initPromise = null
  mode = null
  try {
    idb?.close()
  } catch {
    /* ignore */
  }
  idb = null
  try {
    await deleteIdb()
  } catch {
    /* ignore */
  }
  // Keep localStorage purchases unless user is wiping everything via clearAllData
  await ensureStorage()
  if (mode === 'idb') {
    storageNotice = null
  }
}
