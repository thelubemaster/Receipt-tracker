/**
 * Fully in-app APK update — download + system PackageInstaller.
 * No browser, no external download links, no window.open.
 *
 * Paths:
 * 1) Native HttpURLConnection download (preferred)
 * 2) WebView XHR download + installBase64 (fallback if native stalls)
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
  installBase64: (opts: { data: string }) => Promise<{ installed?: boolean; path?: string }>
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
 * Follow redirects in the WebView (often more reliable than HttpURLConnection
 * on some devices for GitHub → Azure release assets).
 */
export async function resolveFinalDownloadUrl(startUrl: string): Promise<string> {
  let current = startUrl
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        headers: { Accept: '*/*' },
      })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('Location') || res.headers.get('location')
        if (!loc) break
        current = new URL(loc, current).href
        continue
      }
      // Some WebViews auto-follow anyway — URL is already final
      return current
    } catch {
      break
    }
  }
  return current
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
      // strip data:…;base64, prefix for native
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * Download APK via XHR in the WebView (good redirect/CDN support), then
 * hand bytes to native PackageInstaller.
 */
async function downloadViaWebView(
  url: string,
  plugin: ApkPlugin,
  onProgress?: (msg: string) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  onProgress?.('Downloading via app network… 0%')
  const finalUrl = await resolveFinalDownloadUrl(url)
  onProgress?.('Connected — downloading package…')

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

  // installBase64 may be missing on very old shells
  if (typeof plugin.installBase64 !== 'function') {
    return {
      ok: false,
      message:
        'This app build can download but needs a one-time package update to finish Install. Try “Get up to date” again after reopening, or use the native downloader.',
    }
  }

  const removers: Array<() => void> = []
  try {
    const prog = await plugin.addListener('apkProgress', (data) => {
      if (data?.message) onProgress?.(data.message)
    })
    removers.push(() => {
      void prog.remove()
    })
    await withTimeout(plugin.installBase64({ data: b64 }), 120_000, 'install package')
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
    for (const r of removers) {
      try {
        r()
      } catch {
        /* ignore */
      }
    }
  }
}

async function downloadViaNative(
  url: string,
  plugin: ApkPlugin,
  onProgress?: (msg: string) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const removers: Array<() => void> = []
  let lastProgressAt = Date.now()
  let lastMsg = ''

  try {
    const prog = await plugin.addListener('apkProgress', (data) => {
      lastProgressAt = Date.now()
      if (data?.message) {
        lastMsg = data.message
        onProgress?.(data.message)
      } else if (typeof data?.percent === 'number' && data.percent >= 0) {
        lastMsg = `Downloading… ${data.percent}%`
        onProgress?.(lastMsg)
      }
    })
    removers.push(() => {
      void prog.remove()
    })

    const inst = await plugin.addListener('apkInstallStatus', (data) => {
      if (data?.message) onProgress?.(data.message)
    })
    removers.push(() => {
      void inst.remove()
    })

    // Stall watchdog: if no progress for 20s after start, abort and let fallback run
    const stall = new Promise<{ ok: false; message: string }>((resolve) => {
      const t = setInterval(() => {
        if (Date.now() - lastProgressAt > 22_000) {
          clearInterval(t)
          resolve({
            ok: false,
            message: 'Native download stalled — trying alternate method…',
          })
        }
      }, 2000)
      // clear when outer settles — caller ignores if already done
      setTimeout(() => clearInterval(t), 300_000)
    })

    const download = withTimeout(
      plugin.downloadAndInstall({ url, fileName: 'schoolie-update.apk' }).then(() => {
        onProgress?.(
          'Confirm Install on the system screen. When it finishes, open Cost Tracker from the home screen.',
        )
        return { ok: true as const }
      }),
      280_000,
      'in-app download',
    ).catch((e: unknown) => ({
      ok: false as const,
      message: e instanceof Error ? e.message : String(e),
    }))

    const result = await Promise.race([download, stall])
    if (!result.ok && /stalled/i.test(result.message)) {
      // Don't leave native thread hanging forever — best effort
      return result
    }
    return result
  } finally {
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

  const urls = apkUrlCandidates(url)
  let lastError = 'Download failed'

  for (let i = 0; i < urls.length; i++) {
    const candidate = urls[i]
    onProgress?.(
      i === 0
        ? 'Downloading update inside the app…'
        : `Trying alternate download link (${i + 1}/${urls.length})…`,
    )

    // Prefer resolving redirects in WebView first (helps some devices)
    let finalUrl = candidate
    try {
      finalUrl = await resolveFinalDownloadUrl(candidate)
    } catch {
      finalUrl = candidate
    }

    // 1) Native downloader
    const native = await downloadViaNative(finalUrl, p, onProgress)
    if (native.ok) return native
    lastError = native.message

    // If permission / unimplemented — don't keep trying URLs the same way
    if (/permission|unknown apps|not implemented|UNIMPLEMENTED/i.test(native.message)) {
      return native
    }

    // 2) WebView XHR fallback (same URL, different stack)
    onProgress?.('Switching to alternate download method…')
    const web = await downloadViaWebView(finalUrl, p, onProgress)
    if (web.ok) return web
    lastError = web.message
  }

  return {
    ok: false,
    message: `${lastError}. Check Wi‑Fi and try again.`,
  }
}
