/**
 * Over-the-air updates for the installed Android app.
 *
 * Default source: GitHub Releases (thelubemaster/Receipt-tracker).
 * Optional: LAN PC (npm run start:android) if you paste that address.
 *
 * No full APK reinstall needed for most web/feature changes.
 */
import {
  GITHUB_PAGES_BASE,
  GITHUB_RELEASES_LATEST,
  GITHUB_REPO_URL,
  UPDATE_MANIFEST_PATH,
} from './githubConfig'

export { GITHUB_PAGES_BASE } from './githubConfig'
import { APP_VERSION } from './version'
import { isNativeCapacitorApp } from './installApp'

const PREF_SERVER = 'schoolie-update-server'
const PREF_AUTO = 'schoolie-auto-update'

/** Direct zip on Releases — works even when GitHub Pages is off. */
export const GITHUB_WEB_UPDATE_ZIP =
  `${GITHUB_REPO_URL}/releases/latest/download/web-update.zip`

export type UpdateManifest = {
  version: string
  url: string
  notes?: string
  source?: string
}

export type UpdateCheckResult =
  | { status: 'current'; version: string; source?: string }
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

function isLanLikeUrl(url: string): boolean {
  try {
    const u = new URL(url.includes('://') ? url : `http://${url}`)
    const h = u.hostname
    if (h === 'localhost' || h === '127.0.0.1') return true
    if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true
    if (/^192\.168\.\d+\.\d+$/.test(h)) return true
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(h)) return true
    if (/^100\.\d+\.\d+\.\d+$/.test(h)) return true // Tailscale / CGNAT
    if (u.port === '4190' || u.port === '4193') return true
    return false
  } catch {
    return false
  }
}

export async function getUpdateServer(): Promise<string> {
  // 1) Preferences (user set / remembered)
  try {
    if (isNativeCapacitorApp()) {
      const { Preferences } = await import('@capacitor/preferences')
      const { value } = await Preferences.get({ key: PREF_SERVER })
      if (value) {
        // Old installs remembered the PC LAN address — migrate to GitHub
        if (isLanLikeUrl(value)) {
          await setUpdateServer(GITHUB_PAGES_BASE)
          return GITHUB_PAGES_BASE
        }
        return normalizeBase(value)
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const ls = localStorage.getItem(PREF_SERVER)
    if (ls) {
      if (isLanLikeUrl(ls)) {
        await setUpdateServer(GITHUB_PAGES_BASE)
        return GITHUB_PAGES_BASE
      }
      return normalizeBase(ls)
    }
  } catch {
    /* ignore */
  }
  // 2) Bundled default
  try {
    const res = await fetch('./update-server.json', { cache: 'no-store' })
    if (res.ok) {
      const j = (await res.json()) as { baseUrl?: string }
      if (j.baseUrl) return normalizeBase(j.baseUrl)
    }
  } catch {
    /* ignore */
  }
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

/** Clear custom server and use GitHub (Pages + Releases). */
export async function useGitHubUpdates(): Promise<string> {
  await setUpdateServer(GITHUB_PAGES_BASE)
  return GITHUB_PAGES_BASE
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
async function loadManifestFromBase(
  base: string,
  sourceLabel: string,
): Promise<UpdateManifest | null> {
  const b = normalizeBase(base)
  const api = await fetchJson(`${b}/api/app-update`)
  if (api && typeof api === 'object') {
    const m = api as Partial<UpdateManifest>
    if (m.version && m.url) {
      return {
        version: String(m.version).replace(/^v/i, ''),
        url: resolveManifestUrl(b, String(m.url)),
        notes: m.notes,
        source: sourceLabel,
      }
    }
  }
  const file = await fetchJson(`${b}/${UPDATE_MANIFEST_PATH}`)
  if (file && typeof file === 'object') {
    const m = file as Partial<UpdateManifest>
    if (m.version && m.url) {
      return {
        version: String(m.version).replace(/^v/i, ''),
        url: resolveManifestUrl(b, String(m.url)),
        notes: m.notes,
        source: sourceLabel,
      }
    }
  }
  return null
}

/** Public GitHub Releases → web-update.zip */
async function loadManifestFromGitHubReleases(): Promise<UpdateManifest | null> {
  const data = await fetchJson(GITHUB_RELEASES_LATEST)
  if (!data || typeof data !== 'object') {
    // API blocked? Try fixed download URL + tag from a lightweight install.json asset
    const install = await fetchJson(
      `${GITHUB_REPO_URL}/releases/latest/download/install.json`,
    )
    if (install && typeof install === 'object') {
      const j = install as { version?: string }
      if (j.version) {
        return {
          version: String(j.version).replace(/^v/i, ''),
          url: GITHUB_WEB_UPDATE_ZIP,
          notes: 'GitHub Releases',
          source: 'github-releases',
        }
      }
    }
    return null
  }
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
    assets.find((a) => (a.name || '').endsWith('.zip') && (a.name || '').includes('update'))
  const url = zip?.browser_download_url || GITHUB_WEB_UPDATE_ZIP
  return {
    version,
    url,
    notes: rel.body?.slice(0, 200) || `Release from ${GITHUB_REPO_URL}`,
    source: 'github-releases',
  }
}

/**
 * Check every source and pick the newest bundle.
 * Always includes GitHub Releases so a leftover LAN address cannot block updates.
 */
export async function checkForAppBundleUpdate(
  serverBase?: string,
): Promise<UpdateCheckResult> {
  const preferred = normalizeBase(serverBase || (await getUpdateServer()))
  const candidates: Array<{ base: string; label: string }> = []
  const seen = new Set<string>()
  const add = (base: string, label: string) => {
    const b = normalizeBase(base)
    if (!b || seen.has(b)) return
    seen.add(b)
    candidates.push({ base: b, label })
  }

  // GitHub first when preferred is GitHub/Pages; LAN only if user still set it
  if (preferred && !isLanLikeUrl(preferred)) {
    add(preferred, 'update-server')
  }
  add(GITHUB_PAGES_BASE, 'github-pages')
  if (preferred && isLanLikeUrl(preferred)) {
    add(preferred, 'lan-pc')
  }

  let best: UpdateManifest | null = null
  let lastError = ''
  let sawAny = false

  for (const { base, label } of candidates) {
    try {
      const manifest = await loadManifestFromBase(base, label)
      if (!manifest) continue
      sawAny = true
      if (!best || compareVersions(manifest.version, best.version) > 0) {
        best = manifest
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'check failed'
    }
  }

  // Always consult Releases API
  try {
    const manifest = await loadManifestFromGitHubReleases()
    if (manifest) {
      sawAny = true
      if (!best || compareVersions(manifest.version, best.version) > 0) {
        best = manifest
      }
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : lastError
  }

  if (best) {
    if (compareVersions(best.version, APP_VERSION) > 0) {
      return { status: 'available', manifest: best }
    }
    return {
      status: 'current',
      version: APP_VERSION,
      source: best.source,
    }
  }

  if (!sawAny) {
    return {
      status: 'error',
      message:
        lastError ||
        'Could not reach GitHub updates. Check your internet, then try again.',
    }
  }

  return { status: 'current', version: APP_VERSION }
}

/**
 * Download and apply OTA web update (native APK only).
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
    onProgress?.(`Downloading update from ${manifest.source || 'server'}…`)
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    const bundle = await CapacitorUpdater.download({
      url: manifest.url,
      version: manifest.version,
    })
    onProgress?.('Installing…')
    await CapacitorUpdater.set(bundle)
    onProgress?.('Restarting…')
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

export async function notifyNativeAppReady(): Promise<void> {
  if (!isNativeCapacitorApp()) return
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    await CapacitorUpdater.notifyAppReady()
  } catch {
    /* plugin missing in browser */
  }
}

/**
 * Silent update on app open:
 * - force GitHub as source (forget old LAN PC addresses)
 * - if a newer web-update.zip is on Releases, download & apply
 */
export async function autoUpdateIfAvailable(
  onStatus?: (msg: string) => void,
): Promise<void> {
  if (!isNativeCapacitorApp()) return
  try {
    await useGitHubUpdates()
  } catch {
    /* ignore */
  }
  if (!(await getAutoUpdate())) return
  const check = await checkForAppBundleUpdate()
  if (check.status !== 'available') return
  onStatus?.(`Updating to v${check.manifest.version}…`)
  await applyAppBundleUpdate(check.manifest, onStatus)
}
