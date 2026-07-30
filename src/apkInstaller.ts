/**
 * In-app APK install — MUST return quickly (never spin “Updating…” forever).
 *
 * Works on *existing* installs via web OTA alone:
 * - Does NOT rely on hanging DownloadManager bridge calls
 * - Opens the APK URL with the system (browser / package installer)
 * - Optional: briefly try new native helpers if present, with short timeouts
 */
import { isNativeCapacitorApp } from './installApp'

type ApkPlugin = {
  canInstallPackages?: () => Promise<{ allowed: boolean }>
  openInstallPermissionSettings?: () => Promise<void>
  openApkUrl?: (opts: { url: string }) => Promise<{ opened?: boolean }>
  downloadAndInstall?: (opts: {
    url: string
    fileName?: string
  }) => Promise<{ installed?: boolean; path?: string; started?: boolean }>
  enqueueSystemDownload?: (opts: {
    url: string
    fileName?: string
  }) => Promise<{ started?: boolean; downloadId?: number }>
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      ms,
    )
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

/** Open an HTTPS APK URL with Android’s system handler (no hang). */
export function openSystemApkUrl(url: string): void {
  // 1) Android intent → external browser / download (works in many WebViews)
  try {
    const stripped = url.replace(/^https?:\/\//i, '')
    const intent = `intent://${stripped}#Intent;scheme=https;action=android.intent.action.VIEW;end`
    const a = document.createElement('a')
    a.href = intent
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch {
    /* continue */
  }

  // 2) Cordova-style system target
  try {
    const a2 = document.createElement('a')
    a2.href = url
    a2.setAttribute('target', '_system')
    a2.rel = 'noopener'
    document.body.appendChild(a2)
    a2.click()
    a2.remove()
  } catch {
    /* continue */
  }

  // 3) Hidden iframe (some WebViews start download)
  try {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0'
    iframe.src = url
    document.body.appendChild(iframe)
    setTimeout(() => {
      try {
        iframe.remove()
      } catch {
        /* ignore */
      }
    }, 30_000)
  } catch {
    /* continue */
  }

  // 4) Same-tab navigation last (may leave WebView briefly)
  setTimeout(() => {
    try {
      window.open(url, '_blank')
    } catch {
      try {
        window.location.assign(url)
      } catch {
        /* ignore */
      }
    }
  }, 250)
}

/**
 * Start APK install from inside the app.
 * Always settles the promise within a few seconds so the button never sticks.
 */
export async function downloadAndInstallApk(
  url: string,
  onProgress?: (msg: string) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  onProgress?.('Opening system download / Install…')

  const p = await getPlugin()

  // Optional: nudge “install unknown apps” (2s max — never hang)
  if (p?.canInstallPackages && p?.openInstallPermissionSettings) {
    try {
      const { allowed } = await withTimeout(p.canInstallPackages(), 2000, 'perm')
      if (!allowed) {
        onProgress?.(
          'Turn ON “Install unknown apps” for Cost Tracker, then come back and tap the button again.',
        )
        await withTimeout(p.openInstallPermissionSettings(), 2000, 'settings').catch(
          () => undefined,
        )
      }
    } catch {
      /* no native plugin or timed out — fine */
    }
  }

  // Optional: new native openApkUrl (1.25.2+) — 2s max
  if (p?.openApkUrl) {
    try {
      await withTimeout(p.openApkUrl({ url }), 2500, 'openApkUrl')
      onProgress?.(
        'Install screen or download should be open. Tap Install, then open Cost Tracker again.',
      )
      return { ok: true }
    } catch {
      /* fall through */
    }
  }

  // Optional: system DownloadManager enqueue that resolves immediately (fixed plugin)
  if (p?.enqueueSystemDownload) {
    try {
      await withTimeout(
        p.enqueueSystemDownload({ url, fileName: 'schoolie-update.apk' }),
        2500,
        'enqueue',
      )
      onProgress?.(
        'Download started (notification). When it finishes, tap it → Install.',
      )
      return { ok: true }
    } catch {
      /* fall through */
    }
  }

  // Do NOT call downloadAndInstall here — older native builds hang forever on it.

  // Pure web path — works with current install after OTA, no reinstall
  openSystemApkUrl(url)
  onProgress?.(
    'Download should start now. Open the notification or browser download → tap the APK → Install. Then open the app from the home screen.',
  )
  return { ok: true }
}

export async function canInstallApkPackages(): Promise<boolean> {
  const p = await getPlugin()
  if (!p?.canInstallPackages) return true
  try {
    const r = await withTimeout(p.canInstallPackages(), 2000, 'perm')
    return !!r.allowed
  } catch {
    return true
  }
}

export async function openApkInstallPermissionSettings(): Promise<void> {
  const p = await getPlugin()
  if (!p?.openInstallPermissionSettings) return
  try {
    await withTimeout(p.openInstallPermissionSettings(), 2000, 'settings')
  } catch {
    /* ignore */
  }
}
