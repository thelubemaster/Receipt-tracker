/**
 * Over-the-air updates for the installed Android app.
 *
 * Sources (first that works wins):
 * 1. User-set update server (LAN: npm run start:android)
 * 2. Bundled default → GitHub Pages
 * 3. GitHub Releases (latest) for web-update.zip
 *
 * No full APK reinstall needed for most web/feature changes.
 */
import {
  GITHUB_PAGES_BASE,
  GITHUB_RELEASES_LATEST,
  GITHUB_REPO_URL,
  UPDATE_MANIFEST_PATH,
} from './githubConfig'
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
  // 2) Bundled default from build / GitHub Pages
  try {
    const res = await fetch('./update-server.json', { cache: 'no-store' })
    if (res.ok) {
      const j = (await res.json()) as { baseUrl?: string }
      if (j.baseUrl) return normalizeBase(j.baseUrl)
    }
  } catch {
    /* ignore */
  }
  // 3) Hard-coded GitHub Pages for this project
  return GITHUB_PAGES_BASE
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

function resolveManifestUrl(base: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('/')) return `${base}${url}`
  return `${base}/${url.replace(/^\.\//, '')}`
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Try LAN API then static app-update.json on the same base. */
async function loadManifestFromBase(base: string): Promise<UpdateManifest | null> {
  const b = normalizeBase(base)
  // LAN server shape
  const api = await fetchJson(`${b}/api/app-update`)
  if (api && typeof api === 'object') {
    const m = api as Partial<UpdateManifest>
    if (m.version && m.url) {
      return {
        version: String(m.version).replace(/^v/i, ''),
        url: resolveManifestUrl(b, String(m.url)),
        notes: m.notes,
      }
    }
  }
  // Static GitHub Pages / CDN shape
  const file = await fetchJson(`${b}/${UPDATE_MANIFEST_PATH}`)
  if (file && typeof file === 'object') {
    const m = file as Partial<UpdateManifest>
    if (m.version && m.url) {
      return {
        version: String(m.version).replace(/^v/i, ''),
        url: resolveManifestUrl(b, String(m.url)),
        notes: m.notes,
      }
    }
  }
  return null
}

/** Public GitHub Releases → web-update.zip (or schoolie-web-update.zip). */
async function loadManifestFromGitHubReleases(): Promise<UpdateManifest | null> {
  const data = await fetchJson(GITHUB_RELEASES_LATEST)
  if (!data || typeof data !== 'object') return null
  const rel = data as {
    tag_name?: string
    name?: string
    body?: string
    assets?: Array<{ name?: string; browser_download_url?: string }>
  }
  const version = String(rel.tag_name || rel.name || '')
    .replace(/^v/i, '')
    .trim()
  if (!version) return null
  const assets = rel.assets || []
  const zip =
    assets.find((a) => a.name === 'web-update.zip') ||
    assets.find((a) => a.name === 'schoolie-web-update.zip') ||
    assets.find((a) => (a.name || '').endsWith('.zip') && (a.name || '').includes('update')) ||
    assets.find((a) => (a.name || '').endsWith('.zip'))
  if (!zip?.browser_download_url) return null
  return {
    version,
    url: zip.browser_download_url,
    notes: rel.body?.slice(0, 200) || `Release from ${GITHUB_REPO_URL}`,
  }
}

/**
 * Check for a newer web bundle.
 * Order: explicit server → default server (GitHub Pages) → GitHub Releases.
 */
export async function checkForAppBundleUpdate(
  serverBase?: string,
): Promise<UpdateCheckResult> {
  const preferred = normalizeBase(serverBase || (await getUpdateServer()))
  const candidates = [
    preferred,
    GITHUB_PAGES_BASE,
  ].filter((v, i, arr) => v && arr.indexOf(v) === i)

  let lastError = ''
  for (const base of candidates) {
    try {
      const manifest = await loadManifestFromBase(base)
      if (!manifest) continue
      if (compareVersions(manifest.version, APP_VERSION) > 0) {
        return { status: 'available', manifest }
      }
      return { status: 'current', version: APP_VERSION }
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'check failed'
    }
  }

  // GitHub Releases fallback (works without Pages)
  try {
    const manifest = await loadManifestFromGitHubReleases()
    if (manifest) {
      if (compareVersions(manifest.version, APP_VERSION) > 0) {
        return { status: 'available', manifest }
      }
      return { status: 'current', version: APP_VERSION }
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : lastError
  }

  if (!preferred) {
    return {
      status: 'skipped',
      message: `No update source. Repo: ${GITHUB_REPO_URL}`,
    }
  }

  return {
    status: 'error',
    message:
      lastError ||
      'Could not reach GitHub updates yet. Push a release (or enable Pages) on the Receipt-tracker repo.',
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
