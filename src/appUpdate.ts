/**
 * Over-the-air updates for the installed Android app.
 *
 * Default source: GitHub Releases (thelubemaster/Receipt-tracker).
 *
 * Two layers (both run from inside the app — no browser reinstall dance):
 * 1) Web OTA (Capgo) — UI, features, bugfixes via web-update.zip
 * 2) APK update — launcher icon, plugins, permissions via schoolie.apk
 *    (downloaded with Android DownloadManager, then system Install prompt)
 */
import {
  GITHUB_APK_LATEST,
  GITHUB_PAGES_BASE,
  GITHUB_RELEASES_LATEST,
  GITHUB_REPO_URL,
  UPDATE_MANIFEST_PATH,
} from './githubConfig'

export { GITHUB_PAGES_BASE } from './githubConfig'
import { downloadAndInstallApk } from './apkInstaller'
import { APP_VERSION, APK_VERSION_CODE, APK_RELEASE_TAG } from './version'
import { isNativeCapacitorApp } from './installApp'
import { githubApkForTag } from './githubConfig'

const PREF_SERVER = 'schoolie-update-server'
const PREF_AUTO = 'schoolie-auto-update'

/** Direct zip on Releases — works even when GitHub Pages is off. */
export const GITHUB_WEB_UPDATE_ZIP =
  `${GITHUB_REPO_URL}/releases/latest/download/web-update.zip`

/** Versioned zip URL (preferred — avoids /latest/ cache and bad Capgo redirects). */
export function githubWebUpdateZipForVersion(version: string): string {
  const v = String(version || '').replace(/^v/i, '').trim()
  if (!v) return GITHUB_WEB_UPDATE_ZIP
  return `${GITHUB_REPO_URL}/releases/download/v${v}/web-update.zip`
}

export type UpdateManifest = {
  version: string
  url: string
  notes?: string
  source?: string
  /** Native shell version name (when APK should be installed) */
  apkVersion?: string
  /** Android versionCode of the published APK */
  apkVersionCode?: number
  apkUrl?: string
}

export type UpdateCheckResult =
  | { status: 'current'; version: string; source?: string }
  | { status: 'available'; manifest: UpdateManifest }
  | { status: 'error'; message: string }
  | { status: 'skipped'; message: string }

export type FullUpdateResult = {
  web: UpdateCheckResult
  apk:
    | { status: 'current'; versionCode: number; versionName: string }
    | { status: 'available'; versionCode: number; versionName: string; url: string }
    | { status: 'error'; message: string }
    | { status: 'skipped'; message: string }
  appliedWeb?: boolean
  appliedApk?: boolean
  message: string
}

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
export async function preferGitHubUpdates(): Promise<string> {
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

function parseManifest(
  raw: Partial<UpdateManifest>,
  sourceLabel: string,
  base?: string,
): UpdateManifest | null {
  if (!raw.version || !raw.url) return null
  const url = base ? resolveManifestUrl(base, String(raw.url)) : String(raw.url)
  return {
    version: String(raw.version).replace(/^v/i, ''),
    url,
    notes: raw.notes,
    source: sourceLabel,
    apkVersion: raw.apkVersion ? String(raw.apkVersion).replace(/^v/i, '') : undefined,
    apkVersionCode:
      typeof raw.apkVersionCode === 'number'
        ? raw.apkVersionCode
        : raw.apkVersionCode != null
          ? parseInt(String(raw.apkVersionCode), 10) || undefined
          : undefined,
    apkUrl: raw.apkUrl
      ? base
        ? resolveManifestUrl(base, String(raw.apkUrl))
        : String(raw.apkUrl)
      : undefined,
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
    const m = parseManifest(api as Partial<UpdateManifest>, sourceLabel, b)
    if (m) return m
  }
  const file = await fetchJson(`${b}/${UPDATE_MANIFEST_PATH}`)
  if (file && typeof file === 'object') {
    return parseManifest(file as Partial<UpdateManifest>, sourceLabel, b)
  }
  return null
}

/** Public GitHub Releases → web-update.zip */
async function loadManifestFromGitHubReleases(): Promise<UpdateManifest | null> {
  // Prefer lightweight app-update.json asset (no API rate limit, always versioned zip)
  const fromFile = await fetchJson(
    `${GITHUB_REPO_URL}/releases/latest/download/app-update.json`,
  )
  if (fromFile && typeof fromFile === 'object') {
    const j = fromFile as Partial<UpdateManifest>
    const version = String(j.version || '')
      .replace(/^v/i, '')
      .trim()
    if (version) {
      return {
        version,
        // Prefer versioned asset path — Capgo follows this more reliably than /latest/
        url: githubWebUpdateZipForVersion(version),
        notes: j.notes || 'GitHub Releases',
        source: 'github-releases-json',
        apkVersion: j.apkVersion || version,
        apkVersionCode:
          typeof j.apkVersionCode === 'number' ? j.apkVersionCode : undefined,
        apkUrl: j.apkUrl || GITHUB_APK_LATEST,
      }
    }
  }

  const data = await fetchJson(GITHUB_RELEASES_LATEST)
  if (!data || typeof data !== 'object') {
    const install = await fetchJson(
      `${GITHUB_REPO_URL}/releases/latest/download/install.json`,
    )
    if (install && typeof install === 'object') {
      const j = install as { version?: string }
      if (j.version) {
        const version = String(j.version).replace(/^v/i, '')
        return {
          version,
          url: githubWebUpdateZipForVersion(version),
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
  // Prefer versioned release path over browser_download_url (same redirects, cleaner logs)
  const url = githubWebUpdateZipForVersion(version) || zip?.browser_download_url || GITHUB_WEB_UPDATE_ZIP
  const apkAsset =
    assets.find((a) => a.name === 'project-cost-tracker.apk') ||
    assets.find((a) => a.name === 'schoolie.apk') ||
    assets.find((a) => (a.name || '').endsWith('.apk'))
  return {
    version,
    url,
    notes: rel.body?.slice(0, 200) || `Release from ${GITHUB_REPO_URL}`,
    source: 'github-releases',
    apkVersion: version,
    apkUrl: apkAsset?.browser_download_url || GITHUB_APK_LATEST,
  }
}

/** Native shell info (versionCode / versionName from the installed APK). */
export async function getNativeAppInfo(): Promise<{
  versionName: string
  versionCode: number
} | null> {
  if (!isNativeCapacitorApp()) return null
  try {
    const { App } = await import('@capacitor/app')
    const info = await App.getInfo()
    const versionCode = parseInt(String(info.build || '0'), 10) || 0
    return {
      versionName: info.version || '0',
      versionCode,
    }
  } catch {
    return null
  }
}

/**
 * Is a published APK newer than the shell this install was built with?
 * Launcher icon / native plugins only update via APK.
 *
 * Always floors remote versionCode at APK_VERSION_CODE (bundled in this web
 * build) so a missing/stale GitHub manifest cannot hide a needed shell update.
 * APK URL prefers a versioned release asset (never 404 from web-only "latest").
 */
export async function checkForApkUpdate(
  manifest?: UpdateManifest | null,
): Promise<FullUpdateResult['apk']> {
  if (!isNativeCapacitorApp()) {
    return { status: 'skipped', message: 'Not the installed Android app' }
  }
  const native = await getNativeAppInfo()
  if (!native) {
    return { status: 'error', message: 'Could not read installed app version' }
  }

  // Bundled floor — this web build expects at least this shell
  let remoteCode = APK_VERSION_CODE
  let remoteName = APP_VERSION
  let apkUrl = githubApkForTag(APK_RELEASE_TAG)

  // Merge remote app-update.json / manifest if newer
  const applyRemote = (m: Partial<UpdateManifest>) => {
    const code =
      typeof m.apkVersionCode === 'number'
        ? m.apkVersionCode
        : m.apkVersionCode != null
          ? parseInt(String(m.apkVersionCode), 10) || 0
          : 0
    if (code > remoteCode) remoteCode = code
    if (m.apkVersion) remoteName = String(m.apkVersion).replace(/^v/i, '')
    else if (m.version && code >= remoteCode) {
      remoteName = String(m.version).replace(/^v/i, '')
    }
    // Only trust apkUrl if it points at a real APK asset
    if (
      m.apkUrl &&
      /\.apk(\?|$)/i.test(String(m.apkUrl)) &&
      /project-cost-tracker\.apk|schoolie\.apk|releases\//i.test(String(m.apkUrl))
    ) {
      apkUrl = String(m.apkUrl)
    }
  }

  if (manifest) applyRemote(manifest)

  try {
    const file = await fetchJson(
      `${GITHUB_REPO_URL}/releases/latest/download/app-update.json`,
    )
    if (file && typeof file === 'object') applyRemote(file as Partial<UpdateManifest>)
  } catch {
    /* offline — still use bundled floor */
  }

  // Prefer versioned URL when using our known shell tag
  if (remoteCode <= APK_VERSION_CODE) {
    apkUrl = githubApkForTag(APK_RELEASE_TAG)
    remoteName = remoteName || APP_VERSION
  }

  if (remoteCode > native.versionCode) {
    return {
      status: 'available',
      versionCode: remoteCode,
      versionName: remoteName || String(remoteCode),
      url: apkUrl,
    }
  }

  return {
    status: 'current',
    versionCode: native.versionCode,
    versionName: native.versionName,
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
      message:
        'In-app OTA only works in the installed Android app. On browser/PWA open the install page and pull to refresh, or reinstall the APK.',
    }
  }
  const version = String(manifest.version || '').replace(/^v/i, '')
  // Try several URLs — GitHub /latest/ and API asset URLs sometimes fail on Capgo/Android
  const urls = [
    githubWebUpdateZipForVersion(version),
    manifest.url,
    GITHUB_WEB_UPDATE_ZIP,
  ].filter((u, i, arr) => !!u && /^https?:\/\//i.test(u) && arr.indexOf(u) === i)

  let lastError = 'Update failed'
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    // Prevent Capgo rollback while we install
    try {
      await CapacitorUpdater.notifyAppReady()
    } catch {
      /* ok */
    }

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]
      try {
        onProgress?.(
          i === 0
            ? `Downloading v${version}…`
            : `Retry download (${i + 1}/${urls.length})…`,
        )
        const bundle = await CapacitorUpdater.download({
          url,
          version: `${version}${i > 0 ? `-${i}` : ''}`,
        })
        onProgress?.('Installing…')
        await CapacitorUpdater.set(bundle)
        onProgress?.('Restarting…')
        setTimeout(() => {
          window.location.reload()
        }, 400)
        return { ok: true }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
        onProgress?.(`Download failed: ${lastError}`)
      }
    }
    return {
      ok: false,
      message: `${lastError}. Try Wi‑Fi, then Settings → Get up to date again. Or reinstall from the install page.`,
    }
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
 * One-shot update from inside the app:
 * 1) Web OTA if a newer web-update.zip exists
 * 2) APK download+install if native versionCode is behind (icon, plugins, …)
 */
export async function runInAppUpdate(
  onStatus?: (msg: string) => void,
): Promise<FullUpdateResult> {
  const web = await checkForAppBundleUpdate()
  let appliedWeb = false
  let appliedApk = false
  const parts: string[] = []

  let manifest: UpdateManifest | null =
    web.status === 'available' ? web.manifest : web.status === 'current' ? null : null

  // Still load manifest metadata for APK fields when web is current
  if (!manifest || manifest.apkVersionCode == null) {
    try {
      const fromGh = await loadManifestFromGitHubReleases()
      if (fromGh) {
        manifest = manifest
          ? {
              ...manifest,
              apkVersion: manifest.apkVersion || fromGh.apkVersion,
              apkVersionCode: manifest.apkVersionCode ?? fromGh.apkVersionCode,
              apkUrl: manifest.apkUrl || fromGh.apkUrl,
            }
          : fromGh
      }
    } catch {
      /* ignore */
    }
    try {
      const file = await fetchJson(
        `${GITHUB_REPO_URL}/releases/latest/download/app-update.json`,
      )
      if (file && typeof file === 'object') {
        const m = parseManifest(file as Partial<UpdateManifest>, 'github-asset')
        if (m) {
          manifest = manifest
            ? {
                ...manifest,
                apkVersion: m.apkVersion || manifest.apkVersion,
                apkVersionCode: m.apkVersionCode ?? manifest.apkVersionCode,
                apkUrl: m.apkUrl || manifest.apkUrl,
              }
            : m
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Prefer shell/logo update first so “Updating…” is never stuck on Capgo
  const apk = await checkForApkUpdate(manifest)
  if (apk.status === 'available') {
    onStatus?.(`Opening home-screen logo update (v${apk.versionName})…`)
    try {
      const r = await downloadAndInstallApk(apk.url, onStatus)
      appliedApk = r.ok
      parts.push(
        r.ok
          ? 'Logo package download opened — tap Install, then open the app again'
          : `Logo package update failed: ${r.message}`,
      )
    } catch (e) {
      parts.push(e instanceof Error ? e.message : 'Logo package update failed')
    }
  } else if (apk.status === 'current') {
    parts.push(`Native shell v${apk.versionName} (${apk.versionCode})`)
  }

  if (web.status === 'available') {
    onStatus?.(`Updating app content to v${web.manifest.version}…`)
    try {
      const applied = await Promise.race([
        applyAppBundleUpdate(web.manifest, onStatus),
        new Promise<{ ok: false; message: string }>((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: false,
                message: 'Content update timed out — try again on Wi‑Fi',
              }),
            45_000,
          ),
        ),
      ])
      appliedWeb = applied.ok
      parts.push(
        applied.ok
          ? `Content updated to v${web.manifest.version}`
          : `Content update: ${applied.message}`,
      )
    } catch (e) {
      parts.push(e instanceof Error ? e.message : 'Content update failed')
    }
  } else if (web.status === 'current') {
    parts.push(`Content up to date (v${web.version})`)
  } else if (web.status === 'error') {
    parts.push(web.message)
  }

  return {
    web,
    apk,
    appliedWeb,
    appliedApk,
    message: parts.join(' · ') || 'No updates found',
  }
}

/**
 * Silent update on app open:
 * - web OTA when available
 * - if native APK is behind, start in-app APK download (user taps Install once)
 */
export async function autoUpdateIfAvailable(
  onStatus?: (msg: string) => void,
): Promise<void> {
  if (!isNativeCapacitorApp()) return
  try {
    await preferGitHubUpdates()
  } catch {
    /* ignore */
  }
  if (!(await getAutoUpdate())) return
  await runInAppUpdate(onStatus)
}
