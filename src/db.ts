/**
 * Local storage for Project Cost Tracker — free, on-device only.
 *
 * Strategy:
 * 1. Prefer IndexedDB when the full schema is present and healthy.
 * 2. On ANY store/schema error → wipe/repair once, then permanent localStorage.
 * 3. Public load APIs never throw storage errors (app always boots).
 * 4. Multiple projects; each purchase belongs to a projectId.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { sanitizeDisabledAis } from './aiRoster'
import type { LeaderboardMap } from './leaderboard'
import {
  emptyReceiptMemory,
  type ReceiptMemory,
} from './receiptMemory'
import type { AppSettings, Project, Purchase } from './types'

interface SchoolieDB extends DBSchema {
  projects: {
    key: string
    value: Project
    indexes: { 'by-updated': string }
  }
  purchases: {
    key: string
    value: Purchase
    indexes: { 'by-date': string; 'by-created': string; 'by-project': string }
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
/** v5: multi-project (projects store + purchase.projectId) */
const DB_VERSION = 5
const REQUIRED_STORES = ['projects', 'purchases', 'images', 'settings', 'meta'] as const
const SETTINGS_KEY = 'app'
const META_KEY = 'meta'
const MEMORY_KEY = 'receipt-memory'
const DEFAULT_PROJECT_ID = 'default-project'

const LS_PROJECTS = 'outlay.v1.projects'
const LS_PURCHASES = 'schoolie.v1.purchases'
const LS_SETTINGS = 'schoolie.v1.settings'
const LS_LEADERBOARD = 'schoolie.v1.leaderboard'
const LS_MEMORY = 'schoolie.v1.memory'
const LS_IMAGES = 'schoolie.v1.images'
const LS_FORCE_LOCAL = 'schoolie.v1.force-local'

type ImageRow = { id: string; blob: Blob; createdAt: string }
type StorageMode = 'idb' | 'local'

let mode: StorageMode | null = null
let idb: IDBPDatabase<SchoolieDB> | null = null
let initPromise: Promise<void> | null = null
let storageNotice: string | null = null

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

function forceLocalPreferred(): boolean {
  try {
    return localStorage.getItem(LS_FORCE_LOCAL) === '1'
  } catch {
    return false
  }
}

function setForceLocal(on: boolean): void {
  try {
    if (on) localStorage.setItem(LS_FORCE_LOCAL, '1')
    else localStorage.removeItem(LS_FORCE_LOCAL)
  } catch {
    /* ignore */
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

function isStorageSchemaError(e: unknown): boolean {
  if (!e) return false
  const any = e as { name?: string; message?: string }
  const name = String(any.name || '')
  const msg = String(any.message || e)
  return (
    name === 'NotFoundError' ||
    name === 'InvalidStateError' ||
    /object store|not found|NotFoundError|transaction|InvalidState|closing|aborted/i.test(
      msg,
    )
  )
}

function ensureStores(db: IDBPDatabase<SchoolieDB>) {
  if (!db.objectStoreNames.contains('projects')) {
    const projects = db.createObjectStore('projects', { keyPath: 'id' })
    projects.createIndex('by-updated', 'updatedAt')
  }
  if (!db.objectStoreNames.contains('purchases')) {
    const purchases = db.createObjectStore('purchases', { keyPath: 'id' })
    purchases.createIndex('by-date', 'date')
    purchases.createIndex('by-created', 'createdAt')
    purchases.createIndex('by-project', 'projectId')
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
    upgrade(db, _oldVersion, _newVersion, transaction) {
      ensureStores(db as IDBPDatabase<SchoolieDB>)
      try {
        if (db.objectStoreNames.contains('purchases') && transaction) {
          const store = transaction.objectStore('purchases')
          if (!store.indexNames.contains('by-date')) store.createIndex('by-date', 'date')
          if (!store.indexNames.contains('by-created')) {
            store.createIndex('by-created', 'createdAt')
          }
          if (!store.indexNames.contains('by-project')) {
            store.createIndex('by-project', 'projectId')
          }
        }
        if (db.objectStoreNames.contains('projects') && transaction) {
          const store = transaction.objectStore('projects')
          if (!store.indexNames.contains('by-updated')) {
            store.createIndex('by-updated', 'updatedAt')
          }
        }
      } catch (e) {
        console.warn('[schoolie] index repair skipped', e)
      }
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

/** Smoke-test every required store with a real transaction. */
async function probeStores(db: IDBPDatabase<SchoolieDB>): Promise<boolean> {
  if (!hasAllStores(db)) return false
  try {
    await db.count('projects')
    await db.count('purchases')
    await db.count('images')
    await db.count('settings')
    await db.count('meta')
    return true
  } catch (e) {
    console.warn('[schoolie] IDB probe failed', e)
    return false
  }
}

async function openIdbFriendly(): Promise<IDBPDatabase<SchoolieDB> | null> {
  if (typeof indexedDB === 'undefined') return null

  const tryVersion = async (version: number, label: string) => {
    const db = await withTimeout(openIdbAtVersion(version), 6000, label)
    if (await probeStores(db)) return db
    try {
      db.close()
    } catch {
      /* ignore */
    }
    return null
  }

  // 1) Existing DB
  try {
    const existing = await withTimeout(openDB<SchoolieDB>(DB_NAME), 5000, 'open existing')
    const missing = missingStores(existing)
    const needsUpgrade = missing.length > 0 || existing.version < DB_VERSION

    if (!needsUpgrade && (await probeStores(existing as IDBPDatabase<SchoolieDB>))) {
      return existing as IDBPDatabase<SchoolieDB>
    }

    const target = Math.max(DB_VERSION, (existing.version || 0) + 1)
    existing.close()
    const upgraded = await tryVersion(target, 'upgrade stores')
    if (upgraded) return upgraded
  } catch (e) {
    console.warn('[schoolie] open existing failed', e)
  }

  // 2) Schema version
  try {
    const db = await tryVersion(DB_VERSION, 'open schema')
    if (db) return db
  } catch (e) {
    console.warn('[schoolie] open schema failed', e)
  }

  // 3) Bump past whatever is stuck
  try {
    const probe = await withTimeout(openDB<SchoolieDB>(DB_NAME), 4000, 'probe version')
    const ver = Math.max(probe.version, DB_VERSION) + 1
    probe.close()
    const db = await tryVersion(ver, 'open next')
    if (db) return db
  } catch (e) {
    console.warn('[schoolie] open next failed', e)
  }

  // 4) Nuclear wipe + recreate
  try {
    await deleteIdb()
    const db = await tryVersion(DB_VERSION, 'open fresh')
    if (db) return db
  } catch (e) {
    console.warn('[schoolie] recreate failed', e)
  }

  return null
}

function useLocalMode(reason?: string): void {
  if (reason) console.warn('[schoolie] using localStorage:', reason)
  try {
    idb?.close()
  } catch {
    /* ignore */
  }
  idb = null
  mode = 'local'
  initPromise = Promise.resolve()
  setForceLocal(true)
}

async function ensureStorage(): Promise<void> {
  if (mode === 'local') return
  if (mode === 'idb' && idb) {
    // Re-probe lightly? skip for speed
    return
  }
  if (initPromise) return initPromise

  initPromise = (async () => {
    // Previous session had a broken IDB — stay on local until reset
    if (forceLocalPreferred()) {
      mode = 'local'
      return
    }

    const db = await openIdbFriendly()
    if (db && (await probeStores(db))) {
      mode = 'idb'
      idb = db
      storageNotice = null
      setForceLocal(false)
      await migrateLocalToIdbIfEmpty(db)
      await ensureDefaultProjectAndIds(db)
      return
    }

    mode = 'local'
    if (!canUseLocalStorage()) {
      storageNotice =
        'Browser storage is restricted. Purchases may not persist after you close the tab.'
    } else {
      storageNotice = null
    }
  })()

  try {
    await initPromise
  } catch (e) {
    console.warn('[schoolie] ensureStorage failed', e)
    useLocalMode(e instanceof Error ? e.message : 'init failed')
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

function backupPurchaseList(list: Purchase[]): void {
  if (!canUseLocalStorage()) return
  try {
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
    projectId: p.projectId || DEFAULT_PROJECT_ID,
    lineItems: Array.isArray(p.lineItems) ? p.lineItems : [],
    aisUsed: Array.isArray(p.aisUsed) ? p.aisUsed : [],
  }
}

function normalizeProject(p: Project): Project {
  return {
    id: p.id,
    name: (p.name || 'Untitled project').trim() || 'Untitled project',
    description: typeof p.description === 'string' ? p.description : '',
    coverImageId: p.coverImageId ?? null,
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
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

function sortProjects(list: Project[]): Project[] {
  return list
    .map(normalizeProject)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function useLocalProjects(): Project[] {
  return sortProjects(lsRead<Project[]>(LS_PROJECTS, []))
}

async function useLocalPurchases(projectId?: string): Promise<Purchase[]> {
  const all = sortPurchases(lsRead<Purchase[]>(LS_PURCHASES, []))
  if (!projectId) return all
  return all.filter((p) => p.projectId === projectId)
}

function backupProjects(list: Project[]): void {
  if (!canUseLocalStorage()) return
  try {
    lsWrite(LS_PROJECTS, list)
  } catch {
    /* ignore */
  }
}

/**
 * One-time: ensure at least one project exists and every purchase has projectId.
 */
async function ensureDefaultProjectAndIds(
  db?: IDBPDatabase<SchoolieDB> | null,
): Promise<void> {
  try {
    const settings = await getSettings()
    const now = new Date().toISOString()
    let projects = await listProjectsRaw()
    if (projects.length === 0) {
      const seeded: Project = {
        id: DEFAULT_PROJECT_ID,
        name: settings.projectName?.trim() || 'My project',
        description: '',
        coverImageId: null,
        createdAt: now,
        updatedAt: now,
      }
      await saveProject(seeded)
      projects = [seeded]
    }
    const defaultId = projects[0]?.id || DEFAULT_PROJECT_ID
    const purchases = await listPurchases()
    let changed = false
    for (const p of purchases) {
      if (!p.projectId) {
        await savePurchase({ ...p, projectId: defaultId })
        changed = true
      }
    }
    if (changed) console.info('[outlay] migrated purchases onto projects')
    void db
  } catch (e) {
    console.warn('[outlay] project migration', e)
  }
}

async function listProjectsRaw(): Promise<Project[]> {
  await ensureStorage()
  if (mode === 'local' || !idb) return useLocalProjects()
  try {
    if (!idb.objectStoreNames.contains('projects')) return useLocalProjects()
    return sortProjects(await idb.getAll('projects'))
  } catch {
    return useLocalProjects()
  }
}

export async function listProjects(): Promise<Project[]> {
  try {
    await ensureStorage()
    // Ensure migration has a chance to seed a project
    if (mode === 'idb' && idb) {
      const n = await idb.count('projects').catch(() => 0)
      if (n === 0) await ensureDefaultProjectAndIds(idb)
    } else if (useLocalProjects().length === 0) {
      await ensureDefaultProjectAndIds(null)
    }
    const list = await listProjectsRaw()
    backupProjects(list)
    return list
  } catch (e) {
    console.warn('[outlay] listProjects failed', e)
    return useLocalProjects()
  }
}

export async function getProject(id: string): Promise<Project | undefined> {
  try {
    await ensureStorage()
    if (mode === 'local' || !idb) {
      return useLocalProjects().find((p) => p.id === id)
    }
    const row = await idb.get('projects', id)
    return row ? normalizeProject(row) : undefined
  } catch {
    return useLocalProjects().find((p) => p.id === id)
  }
}

export async function saveProject(project: Project): Promise<void> {
  const row = normalizeProject({
    ...project,
    updatedAt: new Date().toISOString(),
  })
  try {
    await ensureStorage()
    if (mode === 'local' || !idb) {
      const list = useLocalProjects().filter((p) => p.id !== row.id)
      list.push(row)
      backupProjects(list)
      return
    }
    await idb.put('projects', row)
    backupProjects(await idb.getAll('projects'))
  } catch (e) {
    console.warn('[outlay] saveProject failed → local', e)
    if (isStorageSchemaError(e)) useLocalMode(String(e))
    const list = useLocalProjects().filter((p) => p.id !== row.id)
    list.push(row)
    backupProjects(list)
  }
}

export async function deleteProject(id: string): Promise<void> {
  try {
    await ensureStorage()
    const purchases = await listPurchases(id)
    for (const p of purchases) {
      await deletePurchase(p.id)
    }
    if (mode === 'local' || !idb) {
      backupProjects(useLocalProjects().filter((p) => p.id !== id))
      return
    }
    await idb.delete('projects', id)
    backupProjects(await idb.getAll('projects'))
  } catch (e) {
    console.warn('[outlay] deleteProject', e)
    backupProjects(useLocalProjects().filter((p) => p.id !== id))
  }
}

/** Never throws — app must always load. Optional project filter. */
export async function listPurchases(projectId?: string): Promise<Purchase[]> {
  try {
    await ensureStorage()
    if (mode !== 'idb' || !idb) return useLocalPurchases(projectId)
    let all: Purchase[]
    if (projectId && idb.objectStoreNames.contains('purchases')) {
      try {
        all = await idb.getAllFromIndex('purchases', 'by-project', projectId)
      } catch {
        all = (await idb.getAll('purchases')).filter(
          (p) => (p.projectId || DEFAULT_PROJECT_ID) === projectId,
        )
      }
    } else {
      all = await idb.getAll('purchases')
    }
    const sorted = sortPurchases(all)
    backupPurchaseList(await idb.getAll('purchases').catch(() => sorted))
    return projectId
      ? sorted.filter((p) => p.projectId === projectId)
      : sorted
  } catch (e) {
    console.warn('[schoolie] listPurchases failed → local', e)
    if (isStorageSchemaError(e)) useLocalMode(String(e))
    return useLocalPurchases(projectId)
  }
}

export { DEFAULT_PROJECT_ID }

export async function getPurchase(id: string): Promise<Purchase | undefined> {
  try {
    await ensureStorage()
    if (mode === 'local' || !idb) {
      const p = lsRead<Purchase[]>(LS_PURCHASES, []).find((x) => x.id === id)
      return p ? normalizePurchase(p) : undefined
    }
    const p = await idb.get('purchases', id)
    return p ? normalizePurchase(p) : undefined
  } catch (e) {
    if (isStorageSchemaError(e)) useLocalMode(String(e))
    const p = lsRead<Purchase[]>(LS_PURCHASES, []).find((x) => x.id === id)
    return p ? normalizePurchase(p) : undefined
  }
}

export async function savePurchase(purchase: Purchase): Promise<void> {
  const row = normalizePurchase(purchase)
  const writeLocal = () => {
    const list = lsRead<Purchase[]>(LS_PURCHASES, []).filter((p) => p.id !== row.id)
    list.push(row)
    lsWrite(LS_PURCHASES, list)
  }
  try {
    await ensureStorage()
    if (mode === 'local' || !idb) {
      writeLocal()
      return
    }
    await idb.put('purchases', row)
    try {
      backupPurchaseList(await idb.getAll('purchases'))
    } catch {
      writeLocal()
    }
  } catch (e) {
    console.warn('[schoolie] savePurchase failed → local', e)
    if (isStorageSchemaError(e)) useLocalMode(String(e))
    writeLocal()
  }
}

export async function deletePurchase(id: string): Promise<void> {
  const writeLocal = () => {
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
  }
  try {
    await ensureStorage()
    if (mode === 'local' || !idb) {
      writeLocal()
      return
    }
    const purchase = await idb.get('purchases', id)
    await idb.delete('purchases', id)
    if (purchase?.receiptImageId) {
      try {
        await idb.delete('images', purchase.receiptImageId)
      } catch {
        /* optional */
      }
    }
    try {
      backupPurchaseList(await idb.getAll('purchases'))
    } catch {
      /* ignore */
    }
  } catch (e) {
    if (isStorageSchemaError(e)) useLocalMode(String(e))
    writeLocal()
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
    /* optional */
  }
}

export async function saveImage(blob: Blob): Promise<string> {
  const id = newId()
  const row: ImageRow = { id, blob, createdAt: new Date().toISOString() }
  try {
    await ensureStorage()
    if (mode === 'local' || !idb) {
      await saveImageLocal(id, blob)
      return id
    }
    await idb.put('images', row)
  } catch (e) {
    if (isStorageSchemaError(e)) useLocalMode(String(e))
    await saveImageLocal(id, blob)
  }
  return id
}

export async function getImage(id: string): Promise<Blob | undefined> {
  try {
    await ensureStorage()
    if (mode === 'local' || !idb) {
      const imgs = lsRead<Record<string, string>>(LS_IMAGES, {})
      const dataUrl = imgs[id]
      if (!dataUrl) return undefined
      return dataUrlToBlob(dataUrl)
    }
    const row = await idb.get('images', id)
    return row?.blob
  } catch {
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
    projectName: row?.projectName ?? 'My project',
    lastSeenVersion: row?.lastSeenVersion ?? '',
    maxPowerMode: row?.maxPowerMode !== false,
    disabledAis: sanitizeDisabledAis(
      (row as { disabledAis?: unknown } | undefined)?.disabledAis,
    ),
    customCategories,
  }
}

/** Never throws */
export async function getSettings(): Promise<AppSettings> {
  try {
    await ensureStorage()
    if (mode === 'local' || !idb) {
      return parseSettingsRow(lsRead<AppSettings | null>(LS_SETTINGS, null))
    }
    const row = await idb.get('settings', SETTINGS_KEY)
    const parsed = parseSettingsRow(row)
    lsWrite(LS_SETTINGS, parsed)
    return parsed
  } catch (e) {
    console.warn('[schoolie] getSettings failed → local', e)
    if (isStorageSchemaError(e)) useLocalMode(String(e))
    return parseSettingsRow(lsRead<AppSettings | null>(LS_SETTINGS, null))
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  lsWrite(LS_SETTINGS, settings)
  try {
    await ensureStorage()
    if (mode === 'local' || !idb) return
    await idb.put('settings', { id: SETTINGS_KEY, ...settings })
  } catch (e) {
    if (isStorageSchemaError(e)) useLocalMode(String(e))
  }
}

export async function getLeaderboard(): Promise<LeaderboardMap | null> {
  try {
    await ensureStorage()
    if (mode === 'local' || !idb) {
      return lsRead<LeaderboardMap | null>(LS_LEADERBOARD, null)
    }
    const row = await idb.get('meta', META_KEY)
    return row?.leaderboard ?? lsRead<LeaderboardMap | null>(LS_LEADERBOARD, null)
  } catch {
    return lsRead<LeaderboardMap | null>(LS_LEADERBOARD, null)
  }
}

export async function saveLeaderboard(leaderboard: LeaderboardMap): Promise<void> {
  lsWrite(LS_LEADERBOARD, leaderboard)
  try {
    await ensureStorage()
    if (mode === 'local' || !idb) return
    const existing = await idb.get('meta', META_KEY)
    await idb.put('meta', { ...existing, id: META_KEY, leaderboard })
  } catch {
    /* local ok */
  }
}

export async function getReceiptMemory(): Promise<ReceiptMemory> {
  try {
    await ensureStorage()
    if (mode === 'local' || !idb) {
      const m = lsRead<ReceiptMemory | null>(LS_MEMORY, null)
      return m?.version === 1 ? m : emptyReceiptMemory()
    }
    const row = await idb.get('meta', MEMORY_KEY)
    if (row?.receiptMemory?.version === 1) return row.receiptMemory
    const main = await idb.get('meta', META_KEY)
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
    if (mode === 'local' || !idb) return
    await idb.put('meta', { id: MEMORY_KEY, receiptMemory: payload })
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
  try {
    await ensureStorage()
    if (mode === 'local' || !idb) return
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
 * Full wipe of broken IDB + local purchase data, then reopen.
 * Always succeeds — falls back to localStorage if IDB is dead.
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

  try {
    localStorage.removeItem(LS_PURCHASES)
    localStorage.removeItem(LS_IMAGES)
    localStorage.removeItem(LS_MEMORY)
    localStorage.removeItem(LS_LEADERBOARD)
    localStorage.removeItem(LS_FORCE_LOCAL)
  } catch {
    /* ignore */
  }

  try {
    await deleteIdb()
  } catch {
    /* ignore */
  }

  // Give the browser a beat to finish delete
  await new Promise((r) => setTimeout(r, 100))

  try {
    await ensureStorage()
  } catch {
    useLocalMode('reset fallback')
  }
  storageNotice = null
}
