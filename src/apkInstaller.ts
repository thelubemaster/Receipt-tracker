/**
 * Fully in-app APK update — download + system PackageInstaller.
 * No browser, no external download links, no window.open.
 *
 * Works on old shells (build 27+) and new ones (build 29+):
 * 1) Native downloadAndInstall (always — build 27 has this)
 * 2) CapacitorHttp / XHR + installBase64 (only when native plugin supports it)
 *
 * Critical: never abort a healthy native download just because progress
 * events are missing — older ApkInstaller emitted off the main thread so
 * JS often saw “0% forever” while the file was still downloading.
 */
import { isNativeCapacitorApp } from './installApp'
import { GITHUB_APK_LATEST, githubApkForTag } from './githubConfig'
import { APK_RELEASE_TAG } from './version'

type ProgressEvent = { percent?: number; message?: string }
type InstallStatusEvent = { status?: number; message?: string }

type ApkPlugin = {
  canInstallPackages: () => Promise<{ allowed: boolean }>
  openInstallPermissionSettings: () => Promise<void>
  downloadAndInstall: (opts: {
    url: string
    fileName?: string
  }) => Promise<{ installed?: boolean; path?: string }>
  installFile: (opts: { path: string }) => Promise<void>
  installBase64?: (opts: { data: string }) => Promise<{ installed?: boolean; path?: string }>
  addListener: (
    event: 'apkProgress' | 'apkInstallStatus',
    cb: (data: ProgressEvent & InstallStatusEvent) => void,
  ) => Promise<{ remove: () => Promise<void> | void }>
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

async function getPlugin(): Promise<ApkPlugin | null> {
  if (!isNativeCapacitorApp()) return null
  try {
    const { registerPlugin } = await import('@capacitor/core')
    return registerPlugin<ApkPlugin>('ApkInstaller')
  } catch {
    return null
  }
}

/** True when this APK shell can accept bytes from the WebView. */
async function pluginSupportsInstallBase64(plugin: ApkPlugin): Promise<boolean> {
  if (typeof plugin.installBase64 === 'function') return true
  // Capacitor still exposes missing methods as bridges that reject with UNIMPLEMENTED
  try {
    await withTimeout(
      plugin.installBase64!({ data: '' }).then(
        () => false,
        (e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e)
          if (/not implemented|UNIMPLEMENTED|is not implemented|does not exist/i.test(msg)) {
            return false
          }
          // "data is required" / empty data → method exists
          if (/data|required|empty|incomplete/i.test(msg)) return true
          return false
        },
      ),
      2500,
      'installBase64 probe',
    )
    return true
  } catch {
    return false
  }
}

export async function canInstallApkPackages(): Promise<boolean> {
  const p = await getPlugin()
  if (!p) return false
  try {
    const r = await withTimeout(p.canInstallPackages(), 5000, 'permission check')
    return !!r.allowed
  } catch {
    return false
  }
}

export async function openApkInstallPermissionSettings(): Promise<void> {
  const p = await getPlugin()
  if (!p) return
  try {
    await withTimeout(p.openInstallPermissionSettings(), 5000, 'open settings')
  } catch {
    /* ignore */
  }
}

/** Candidate APK URLs (versioned first, then latest). */
export function apkUrlCandidates(primary?: string | null): string[] {
  const list: string[] = []
  const add = (u: string) => {
    if (u && !list.includes(u)) list.push(u)
  }
  if (primary) add(primary)
  add(githubApkForTag(APK_RELEASE_TAG))
  add(GITHUB_APK_LATEST)
  return list
}

/**
 * Optional redirect resolve — short timeout only. Never download the body.
 * Older WebViews hang on GET of a 15 MB release asset.
 */
export async function resolveFinalDownloadUrl(startUrl: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch(startUrl, {
      method: 'HEAD',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: '*/*' },
    })
    // response.url is final after follow (when supported)
    if (res.url && /^https?:\/\//i.test(res.url)) return res.url
    return startUrl
  } catch {
    return startUrl
  } finally {
    clearTimeout(timer)
  }
}

function blobToBase64(blob: Blob, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.min(90, Math.round((ev.loaded / ev.total) * 90)))
      }
    }
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

/** ~15 MB package — synthetic % so the UI never freezes at 0% when native is silent. */
function startSyntheticProgress(
  onProgress: ((msg: string) => void) | undefined,
  label: string,
): () => void {
  const started = Date.now()
  // Expect ~15 MB; pace fake progress to ~90% over ~90s then crawl
  const tick = () => {
    const sec = Math.max(1, Math.round((Date.now() - started) / 1000))
    const pct =
      sec < 90
        ? Math.min(90, Math.round((sec / 90) * 90))
        : Math.min(97, 90 + Math.floor((sec - 90) / 15))
    onProgress?.(`${label} ${pct}% · ${sec}s`)
  }
  tick()
  const id = setInterval(tick, 1000)
  return () => clearInterval(id)
}

/**
 * Native downloadAndInstall — the only path that works on package build 27.
 * Waits for real completion; does not abort just because events are quiet.
 */
async function downloadViaNative(
  url: string,
  plugin: ApkPlugin,
  onProgress?: (msg: string) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const removers: Array<() => void> = []
  let sawNativeProgress = false
  let stopSynth: (() => void) | null = null

  try {
    try {
      const prog = await plugin.addListener('apkProgress', (data) => {
        if (data?.message) {
          sawNativeProgress = true
          stopSynth?.()
          stopSynth = null
          onProgress?.(data.message)
        } else if (typeof data?.percent === 'number' && data.percent >= 0) {
          sawNativeProgress = true
          stopSynth?.()
          stopSynth = null
          onProgress?.(`Downloading… ${data.percent}%`)
        }
      })
      removers.push(() => {
        void prog.remove()
      })
    } catch {
      /* listeners optional */
    }

    try {
      const inst = await plugin.addListener('apkInstallStatus', (data) => {
        if (data?.message) onProgress?.(data.message)
      })
      removers.push(() => {
        void inst.remove()
      })
    } catch {
      /* optional */
    }

    stopSynth = startSyntheticProgress(onProgress, 'Downloading package…')
    onProgress?.('Connecting to download server… 1%')

    try {
      await withTimeout(
        plugin.downloadAndInstall({ url, fileName: 'schoolie-update.apk' }),
        300_000,
        'in-app download',
      )
      stopSynth?.()
      onProgress?.(
        'Confirm Install on the system screen. When it finishes, open Cost Tracker from the home screen.',
      )
      return { ok: true }
    } catch (e) {
      stopSynth?.()
      const message = e instanceof Error ? e.message : String(e)
      // Keep a hint when events never arrived (old shells)
      if (!sawNativeProgress && /timed out/i.test(message)) {
        return {
          ok: false,
          message:
            'Download timed out with no progress from the package installer. Try Wi‑Fi, then tap Get up to date again.',
        }
      }
      return { ok: false, message }
    }
  } finally {
    stopSynth?.()
    for (const r of removers) {
      try {
        r()
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * CapacitorHttp (native, no CORS) → installBase64. Only for shells that have it.
 */
async function downloadViaCapacitorHttp(
  url: string,
  plugin: ApkPlugin,
  onProgress?: (msg: string) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (typeof plugin.installBase64 !== 'function') {
    return { ok: false, message: 'installBase64 not available' }
  }

  const stopSynth = startSyntheticProgress(onProgress, 'Downloading via app network…')
  try {
    const { CapacitorHttp } = await import('@capacitor/core')
    onProgress?.('Downloading via app network… 5%')
    const res = await withTimeout(
      CapacitorHttp.get({
        url,
        connectTimeout: 45_000,
        readTimeout: 280_000,
        responseType: 'blob',
        headers: {
          Accept: '*/*',
          'User-Agent': 'ProjectCostTracker-InAppUpdater/2.1',
        },
      }),
      300_000,
      'CapacitorHttp download',
    )

    if (res.status < 200 || res.status >= 300) {
      return { ok: false, message: `Download failed (HTTP ${res.status})` }
    }

    // Native returns base64 string for blob responseType
    let b64: string
    if (typeof res.data === 'string') {
      b64 = res.data.includes(',') ? res.data.slice(res.data.indexOf(',') + 1) : res.data
    } else if (res.data instanceof Blob) {
      b64 = await blobToBase64(res.data)
    } else {
      return { ok: false, message: 'Unexpected download payload' }
    }

    // Rough size check: base64 of 100KB ≈ 136KB chars
    if (!b64 || b64.length < 130_000) {
      return {
        ok: false,
        message: `Download incomplete (${b64?.length ?? 0} chars). Try Wi‑Fi.`,
      }
    }

    stopSynth()
    onProgress?.('Preparing package for Install… 95%')
    await withTimeout(plugin.installBase64!({ data: b64 }), 120_000, 'install package')
    onProgress?.(
      'Confirm Install on the system screen. When it finishes, open Cost Tracker from the home screen.',
    )
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    }
  } finally {
    stopSynth()
  }
}

/**
 * WebView XHR fallback (may hit CORS on some CDNs). Needs installBase64.
 */
async function downloadViaWebView(
  url: string,
  plugin: ApkPlugin,
  onProgress?: (msg: string) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (typeof plugin.installBase64 !== 'function') {
    return { ok: false, message: 'installBase64 not available' }
  }

  onProgress?.('Downloading via app network… 0%')
  let finalUrl = url
  try {
    finalUrl = await resolveFinalDownloadUrl(url)
  } catch {
    finalUrl = url
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', finalUrl, true)
    xhr.responseType = 'blob'
    xhr.timeout = 280_000
    xhr.setRequestHeader('Accept', '*/*')
    xhr.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        const pct = Math.min(88, Math.round((ev.loaded / ev.total) * 88))
        onProgress?.(
          `Downloading… ${pct}% (${Math.round(ev.loaded / (1024 * 1024))} MB)`,
        )
      } else if (ev.loaded > 0) {
        onProgress?.(`Downloading… ${Math.round(ev.loaded / (1024 * 1024))} MB`)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
        resolve(xhr.response as Blob)
      } else {
        reject(new Error(`Download failed (HTTP ${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error while downloading package'))
    xhr.ontimeout = () => reject(new Error('Download timed out — try Wi‑Fi'))
    xhr.send()
  })

  if (!blob || blob.size < 100_000) {
    return {
      ok: false,
      message: `Download incomplete (${blob?.size ?? 0} bytes). Try again on Wi‑Fi.`,
    }
  }

  onProgress?.('Preparing package for Install…')
  const b64 = await blobToBase64(blob, (pct) => {
    onProgress?.(`Preparing… ${Math.min(95, 88 + Math.round(pct * 0.07))}%`)
  })

  try {
    await withTimeout(plugin.installBase64!({ data: b64 }), 120_000, 'install package')
    onProgress?.(
      'Confirm Install on the system screen. When it finishes, open Cost Tracker from the home screen.',
    )
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Download the APK inside the app and show Android’s Install confirmation.
 * Entirely in-process — no browser.
 */
export async function downloadAndInstallApk(
  url: string,
  onProgress?: (msg: string) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isNativeCapacitorApp()) {
    return {
      ok: false,
      message: 'Updates install only inside the Android app.',
    }
  }

  onProgress?.('Starting package update… 0%')

  const p = await getPlugin()
  if (!p) {
    return {
      ok: false,
      message:
        'In-app installer is not available in this app build. Keep Wi‑Fi on so content can update, force-close and reopen, then try again.',
    }
  }

  try {
    await withTimeout(p.canInstallPackages(), 4000, 'installer probe')
  } catch {
    return {
      ok: false,
      message:
        'In-app installer not ready yet. Force-close and reopen the app, then tap Update again.',
    }
  }

  const allowed = await canInstallApkPackages()
  if (!allowed) {
    onProgress?.(
      'Allow Install for Cost Tracker on the next screen, then return here and tap Update again.',
    )
    await openApkInstallPermissionSettings()
    return {
      ok: false,
      message:
        'Permission needed: Settings → Allow “Install unknown apps” for Cost Tracker, then tap Update again.',
    }
  }

  const hasBase64 = await pluginSupportsInstallBase64(p)
  const urls = apkUrlCandidates(url)
  let lastError = 'Download failed'

  for (let i = 0; i < urls.length; i++) {
    const candidate = urls[i]
    onProgress?.(
      i === 0
        ? 'Downloading update inside the app… 1%'
        : `Trying alternate download link (${i + 1}/${urls.length})… 1%`,
    )

    // 1) Native downloader — works on package build 27 (no installBase64 needed)
    //    Pass the GitHub release URL as-is; native follows redirects itself.
    //    Do NOT pre-download in WebView (hangs) and do NOT abort on quiet progress.
    const native = await downloadViaNative(candidate, p, onProgress)
    if (native.ok) return native
    lastError = native.message

    if (/permission|unknown apps|not implemented|UNIMPLEMENTED/i.test(native.message)) {
      return native
    }

    // 2) Only when this shell can install bytes from JS (build 29+)
    if (hasBase64) {
      onProgress?.('Switching to alternate download method… 2%')
      const http = await downloadViaCapacitorHttp(candidate, p, onProgress)
      if (http.ok) return http
      lastError = http.message

      const web = await downloadViaWebView(candidate, p, onProgress)
      if (web.ok) return web
      lastError = web.message
    }
  }

  if (!hasBase64) {
    return {
      ok: false,
      message: `${lastError}. Stay on Wi‑Fi and tap Get up to date again — this package build downloads inside the app (no browser). If it keeps failing, force-close the app once and retry.`,
    }
  }

  return {
    ok: false,
    message: `${lastError}. Check Wi‑Fi and try again.`,
  }
}
