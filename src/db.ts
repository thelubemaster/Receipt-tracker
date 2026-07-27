import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
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
}

const DB_NAME = 'schoolie-tracker'
const DB_VERSION = 1
const SETTINGS_KEY = 'app'

let dbPromise: Promise<IDBPDatabase<SchoolieDB>> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<SchoolieDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const purchases = db.createObjectStore('purchases', { keyPath: 'id' })
        purchases.createIndex('by-date', 'date')
        purchases.createIndex('by-created', 'createdAt')
        db.createObjectStore('images', { keyPath: 'id' })
        db.createObjectStore('settings', { keyPath: 'id' })
      },
    })
  }
  return dbPromise
}

export function newId(): string {
  return crypto.randomUUID()
}

export async function listPurchases(): Promise<Purchase[]> {
  const db = await getDb()
  const all = await db.getAll('purchases')
  return all.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date)
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export async function getPurchase(id: string): Promise<Purchase | undefined> {
  const db = await getDb()
  return db.get('purchases', id)
}

export async function savePurchase(purchase: Purchase): Promise<void> {
  const db = await getDb()
  await db.put('purchases', purchase)
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
  return {
    apiKey: row?.apiKey ?? '',
    projectName: row?.projectName ?? 'My Schoolie',
    lastSeenVersion: row?.lastSeenVersion ?? '',
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await getDb()
  await db.put('settings', { id: SETTINGS_KEY, ...settings })
}

export async function clearAllData(): Promise<void> {
  const db = await getDb()
  await db.clear('purchases')
  await db.clear('images')
}
