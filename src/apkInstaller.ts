/**
 * In-app APK install — never hangs the UI.
 * Prefer openApkUrl (instant), then streaming download with progress + timeout.
 */
import { isNativeCapacitorApp } from './installApp'

type ApkPlugin = {
  canInstallPackages: () => Promise<{ allowed: boolean }>
  openInstallPermissionSettings: () => Promise<void>
  openApkUrl: (opts: { url: string }) => Promise<{ opened?: boolean }>
  downloadAndInstall: (opts: {
    url: string
    fileName?: string
  }) => Promise<{ installed?: boolean; path?: string; started?: boolean }>
  enqueueSystemDownload: (opts: {
    url: string
    fileName?: string
  }) => Promise<{ started?: boolean; downloadId?: number }>
  installFile: (opts: { path: string }) => Promise<void>
  addListener?: (
    event: string,
    cb: (data: { percent?: number; message?: string }) => void,
  ) => Promise<{ remove: () => void }>
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
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
    const r = await withTimeout(p.canInstallPackages(), 4000, 'permission check')
    return !!r.allowed
  } catch {
    return false
  }
}

export async function openApkInstallPermissionSettings(): Promise<void> {
  const p = await getPlugin()
  if (!p) return
  try {
    await withTimeout(p.openInstallPermissionSettings(), 4000, 'open settings')
  } catch {
    /* ignore */
  }
}

/**
 * Start APK install from inside the app. Always finishes the promise quickly
 * enough that the button does not spin forever.
 */
export async function downloadAndInstallApk(
  url: string,
  onProgress?: (msg: string) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const p = await getPlugin()

  // ── Strategy A: native plugin openApkUrl (instant, never hangs) ──
  if (p) {
    try {
      await withTimeout(p.canInstallPackages(), 3000, 'plugin probe')
      const allowed = await canInstallApkPackages()
      if (!allowed) {
        onProgress?.('Opening “Install unknown apps” permission — turn it ON for Cost Tracker, then tap the button again.')
        await openApkInstallPermissionSettings()
        // Give user a moment; still try to open URL
      }

      // Prefer streaming download with progress when plugin is present
      onProgress?.('Downloading update (0%)…')
      let removeProgress: (() => void) | undefined
      try {
        if (p.addListener) {
          const handle = await p.addListener('apkProgress', (data) => {
            if (data?.message) onProgress?.(data.message)
            else if (typeof data?.percent === 'number') {
              onProgress?.(`Downloading… ${data.percent}%`)
            }
          })
          removeProgress = () => {
            try {
              handle.remove()
            } catch {
              /* ignore */
            }
          }
        }
        await withTimeout(
          p.downloadAndInstall({ url, fileName: 'schoolie-update.apk' }),
          200_000,
          'download',
        )
        onProgress?.('Installer opened — tap Install. Then open Cost Tracker from the home screen.')
        return { ok: true }
      } catch (dlErr) {
        const m = dlErr instanceof Error ? dlErr.message : String(dlErr)
        onProgress?.(`Direct download failed (${m}). Opening system download…`)
        // Fall through to openApkUrl
      } finally {
        removeProgress?.()
      }

      try {
        await withTimeout(p.openApkUrl({ url }), 8000, 'open url')
        onProgress?.(
          'System download opened. When the file finishes, tap it → Install. Then open the app again.',
        )
        return { ok: true }
      } catch {
        try {
          await withTimeout(
            p.enqueueSystemDownload({ url, fileName: 'schoolie-update.apk' }),
            8000,
            'system download',
          )
          onProgress?.(
            'Download started in notifications. When done, tap the notification → Install.',
          )
          return { ok: true }
        } catch (e2) {
          onProgress?.(
            e2 instanceof Error
              ? `System download failed: ${e2.message}`
              : 'System download failed',
          )
        }
      }
    } catch {
      // Plugin missing or dead — browser-style fallback below
      onProgress?.('Using fallback download…')
    }
  }

  // ── Strategy B: no plugin / all native paths failed ──
  try {
    onProgress?.('Opening download link…')
    // Capacitor Browser-like: open in system handler
    try {
      const { Capacitor } = await import('@capacitor/core')
      // @ts-expect-error Capacitor may expose openUrl in some shells
      if (typeof Capacitor?.openUrl === 'function') {
        // @ts-expect-error
        await Capacitor.openUrl({ url })
        onProgress?.('Opened download. Tap Install when ready.')
        return { ok: true }
      }
    } catch {
      /* ignore */
    }

    const a = document.createElement('a')
    a.href = url
    a.target = '_system'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()

    // Last resort: navigate WebView (may leave the app briefly)
    setTimeout(() => {
      try {
        window.open(url, '_blank')
      } catch {
        try {
          window.location.href = url
        } catch {
          /* ignore */
        }
      }
    }, 200)

    onProgress?.(
      'If nothing opened: allow Install unknown apps for this app in Android Settings, then try again. Or open Downloads after the file finishes.',
    )
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Could not start APK download',
    }
  }
}
