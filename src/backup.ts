/**
 * Full on-device backup / restore — projects, receipts, photos, settings, AI memory.
 * JSON file the user can download and re-import on a new phone.
 */
import {
  clearAllDataForRestore,
  getImage,
  getLeaderboard,
  getReceiptMemory,
  getSettings,
  listImageIds,
  listProjects,
  listPurchases,
  putImage,
  saveLeaderboard,
  saveProject,
  savePurchase,
  saveReceiptMemory,
  saveSettings,
} from './db'
import { blobToDataUrl } from './imagePick'
import type { LeaderboardMap } from './leaderboard'
import type { ReceiptMemory } from './receiptMemory'
import type { AppSettings, Project, Purchase } from './types'
import { APP_VERSION } from './version'

export const BACKUP_FORMAT = 'schoolie-backup' as const
export const BACKUP_VERSION = 1 as const

export type BackupImage = {
  id: string
  /** data:image/jpeg;base64,... or raw base64 */
  dataUrl: string
  type?: string
}

export type SchoolieBackup = {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  appVersion: string
  exportedAt: string
  projects: Project[]
  purchases: Purchase[]
  settings: AppSettings
  leaderboard: LeaderboardMap | null
  receiptMemory: ReceiptMemory
  images: BackupImage[]
}

export type BackupSummary = {
  projects: number
  purchases: number
  images: number
  exportedAt?: string
  appVersion?: string
}

function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl.trim())
  if (!m) {
    // raw base64 → jpeg
    const binary = atob(dataUrl.replace(/\s/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: 'image/jpeg' })
  }
  const mime = m[1] || 'image/jpeg'
  const isB64 = Boolean(m[2])
  const payload = m[3]
  if (isB64) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }
  return new Blob([decodeURIComponent(payload)], { type: mime })
}

export function isSchoolieBackup(raw: unknown): raw is SchoolieBackup {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  return (
    o.format === BACKUP_FORMAT &&
    (o.version === 1 || o.version === BACKUP_VERSION) &&
    Array.isArray(o.projects) &&
    Array.isArray(o.purchases)
  )
}

export function summarizeBackup(b: SchoolieBackup): BackupSummary {
  return {
    projects: b.projects?.length ?? 0,
    purchases: b.purchases?.length ?? 0,
    images: b.images?.length ?? 0,
    exportedAt: b.exportedAt,
    appVersion: b.appVersion,
  }
}

/** Build a full backup of everything on this device. */
export async function createBackup(): Promise<SchoolieBackup> {
  const [projects, purchases, settings, leaderboard, receiptMemory, imageIds] =
    await Promise.all([
      listProjects(),
      listPurchases(),
      getSettings(),
      getLeaderboard(),
      getReceiptMemory(),
      listImageIds(),
    ])

  // Also collect ids referenced by purchases/projects (covers edge cases)
  const needed = new Set(imageIds)
  for (const p of projects) {
    if (p.coverImageId) needed.add(p.coverImageId)
  }
  for (const p of purchases) {
    if (p.receiptImageId) needed.add(p.receiptImageId)
  }

  const images: BackupImage[] = []
  for (const id of needed) {
    try {
      const blob = await getImage(id)
      if (!blob || blob.size <= 0) continue
      const dataUrl = await blobToDataUrl(blob)
      images.push({
        id,
        dataUrl,
        type: blob.type || 'image/jpeg',
      })
    } catch {
      /* skip broken image */
    }
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    projects,
    purchases,
    settings,
    leaderboard,
    receiptMemory,
    images,
  }
}

export function downloadBackupFile(backup: SchoolieBackup): void {
  const stamp = new Date().toISOString().slice(0, 10)
  const blob = new Blob([JSON.stringify(backup)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `schoolie-backup-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function parseBackupFile(file: File | Blob): Promise<SchoolieBackup> {
  const text = await file.text()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON. Pick a Schoolie backup (.json).')
  }
  if (!isSchoolieBackup(raw)) {
    throw new Error(
      'That file is not a Schoolie backup. Export one from Settings → Backup first.',
    )
  }
  return raw
}

export type RestoreResult = {
  projects: number
  purchases: number
  images: number
  settingsRestored: boolean
}

/**
 * Replace local data with the backup (full restore).
 * Does not merge — existing projects/receipts are wiped first.
 */
export async function restoreBackup(backup: SchoolieBackup): Promise<RestoreResult> {
  if (!isSchoolieBackup(backup)) {
    throw new Error('Invalid backup')
  }

  await clearAllDataForRestore()

  let imagesOk = 0
  for (const img of backup.images ?? []) {
    if (!img?.id || !img.dataUrl) continue
    try {
      const blob = dataUrlToBlob(img.dataUrl)
      await putImage(img.id, blob)
      imagesOk++
    } catch {
      /* keep going */
    }
  }

  for (const project of backup.projects ?? []) {
    if (!project?.id) continue
    await saveProject(project)
  }

  for (const purchase of backup.purchases ?? []) {
    if (!purchase?.id) continue
    await savePurchase(purchase)
  }

  let settingsRestored = false
  if (backup.settings && typeof backup.settings === 'object') {
    await saveSettings(backup.settings)
    settingsRestored = true
  }

  if (backup.leaderboard) {
    try {
      await saveLeaderboard(backup.leaderboard)
    } catch {
      /* optional */
    }
  }

  if (backup.receiptMemory) {
    try {
      await saveReceiptMemory(backup.receiptMemory)
    } catch {
      /* optional */
    }
  }

  return {
    projects: backup.projects?.length ?? 0,
    purchases: backup.purchases?.length ?? 0,
    images: imagesOk,
    settingsRestored,
  }
}
