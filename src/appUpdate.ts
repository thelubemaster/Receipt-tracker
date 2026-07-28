/**
 * Over-the-air updates for the installed Android app.
 * Downloads a small web bundle from your PC (npm run start:android) —
 * no full APK reinstall needed for most changes.
 */
import { APP_VERSION } from './version'
import { isNativeCapacitorApp } from './installApp'

const PREF_SERVER = 'schoolie-update-server'
const PREF_AUTO = 'schoolie-auto-update'

export type UpdateManifest = {
  version: string
  url: string
  notes?: string
}

export type UpdateCheckResult =
  | { status: 'current'; version: string }
  | { status: 'available'; manifest: UpdateManifest }
  | { status: 'error'; message: string }
  | { status: 'skipped'; message: string }

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Compare semver-ish strings: a > b → 1 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}

export async function getUpdateServer(): Promise<string> {
  // 1) Preferences (user set / remembered)
  try {
    if (isNativeCapacitorApp()) {
      const { Preferences } = await import('@capacitor/preferences')
      const { value } = await Preferences.get({ key: PREF_SERVER })
      if (value) return normalizeBase(value)
    }
  } catch {
    /* ignore */
  }
  try {
    const ls = localStorage.getItem(PREF_SERVER)
    if (ls) return normalizeBase(ls)
  } catch {
    /* ignore */
  }
  // 2) Bundled default from serve-android / build
  try {
    const res = await fetch('./update-server.json', { cache: 'no-store' })
    if (res.ok) {
      const j = (await res.json()) as { baseUrl?: string }
      if (j.baseUrl) return normalizeBase(j.baseUrl)
    }
  } catch {
    /* ignore */
  }
  return ''
}

export async function setUpdateServer(url: string): Promise<void> {
  const base = normalizeBase(url)
  try {
    if (isNativeCapacitorApp()) {
      const { Preferences } = await import('@capacitor/preferences')
      await Preferences.set({ key: PREF_SERVER, value: base })
    }
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(PREF_SERVER, base)
  } catch {
    /* ignore */
  }
}

export async function getAutoUpdate(): Promise<boolean> {
  try {
    if (isNativeCapacitorApp()) {
      const { Preferences } = await import('@capacitor/preferences')
      const { value } = await Preferences.get({ key: PREF_AUTO })
      if (value != null) return value === '1'
    }
  } catch {
    /* ignore */
  }
  try {
    const ls = localStorage.getItem(PREF_AUTO)
    if (ls != null) return ls === '1'
  } catch {
    /* ignore */
  }
  return true
}

export async function setAutoUpdate(on: boolean): Promise<void> {
  const v = on ? '1' : '0'
  try {
    if (isNativeCapacitorApp()) {
      const { Preferences } = await import('@capacitor/preferences')
      await Preferences.set({ key: PREF_AUTO, value: v })
    }
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(PREF_AUTO, v)
  } catch {
    /* ignore */
  }
}

export async function checkForAppBundleUpdate(
  serverBase?: string,
): Promise<UpdateCheckResult> {
  const base = normalizeBase(serverBase || (await getUpdateServer()))
  if (!base) {
    return {
      status: 'skipped',
      message: 'Set your update server (computer HTTPS address) first.',
    }
  }
  try {
    const res = await fetch(`${base}/api/app-update`, { cache: 'no-store' })
    if (!res.ok) {
      return { status: 'error', message: `Server returned ${res.status}` }
    }
    const manifest = (await res.json()) as UpdateManifest
    if (!manifest.version || !manifest.url) {
      return { status: 'error', message: 'Invalid update response from server' }
    }
    // Resolve relative zip URLs against server base
    if (manifest.url.startsWith('/')) {
      manifest.url = `${base}${manifest.url}`
    }
    if (compareVersions(manifest.version, APP_VERSION) > 0) {
      return { status: 'available', manifest }
    }
    return { status: 'current', version: APP_VERSION }
  } catch (e) {
    return {
      status: 'error',
      message:
        e instanceof Error
          ? e.message
          : 'Could not reach update server. Is the computer running npm run start:android?',
    }
  }
}

/**
 * Download and apply OTA web update (native APK only).
 * Returns true if the app will reload with the new version.
 */
export async function applyAppBundleUpdate(
  manifest: UpdateManifest,
  onProgress?: (msg: string) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isNativeCapacitorApp()) {
    return {
      ok: false,
      message: 'OTA updates apply inside the installed Android app only.',
    }
  }
  try {
    onProgress?.('Downloading update…')
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    const bundle = await CapacitorUpdater.download({
      url: manifest.url,
      version: manifest.version,
    })
    onProgress?.('Installing…')
    await CapacitorUpdater.set(bundle)
    onProgress?.('Restarting…')
    // Capgo switches bundle; force reload as backup
    setTimeout(() => {
      window.location.reload()
    }, 400)
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Update failed',
    }
  }
}

/** Call once when the native app UI is ready (prevents Capgo rollback). */
export async function notifyNativeAppReady(): Promise<void> {
  if (!isNativeCapacitorApp()) return
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    await CapacitorUpdater.notifyAppReady()
  } catch {
    /* plugin missing in browser */
  }
}

/** Background check: if auto-update on and newer bundle exists, apply it. */
export async function autoUpdateIfAvailable(
  onStatus?: (msg: string) => void,
): Promise<void> {
  if (!isNativeCapacitorApp()) return
  if (!(await getAutoUpdate())) return
  const check = await checkForAppBundleUpdate()
  if (check.status !== 'available') return
  onStatus?.(`Updating to v${check.manifest.version}…`)
  await applyAppBundleUpdate(check.manifest, onStatus)
}
