/**
 * Fully in-app APK update — download + system PackageInstaller.
 * No browser, no external download links, no window.open.
 */
import { isNativeCapacitorApp } from './installApp'

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
        'In-app installer is not available in this app build. Open the app after the automatic content update finishes, then try again.',
    }
  }

  // Probe plugin quickly
  try {
    await withTimeout(p.canInstallPackages(), 4000, 'installer probe')
  } catch {
    return {
      ok: false,
      message:
        'In-app installer not ready yet. Wait for the app content update to finish, force-close and reopen the app, then tap Update again.',
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

  onProgress?.('Downloading update inside the app…')

  const removers: Array<() => void> = []
  try {
    const prog = await p.addListener('apkProgress', (data) => {
      if (data?.message) onProgress?.(data.message)
      else if (typeof data?.percent === 'number' && data.percent >= 0) {
        onProgress?.(`Downloading… ${data.percent}%`)
      }
    })
    removers.push(() => {
      void prog.remove()
    })

    const inst = await p.addListener('apkInstallStatus', (data) => {
      if (data?.message) onProgress?.(data.message)
    })
    removers.push(() => {
      void inst.remove()
    })

    await withTimeout(
      p.downloadAndInstall({ url, fileName: 'schoolie-update.apk' }),
      250_000,
      'in-app download',
    )

    onProgress?.(
      'Confirm Install on the system screen. When it finishes, open Cost Tracker from the home screen.',
    )
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Common Capacitor “plugin not implemented” when native shell is old
    if (/not implemented|UNIMPLEMENTED|plugin is not implemented/i.test(msg)) {
      return {
        ok: false,
        message:
          'This install of the app is missing the in-app downloader. Keep the app open on Wi‑Fi so content can update; then force-close and reopen and try Update again. If it still fails, the native shell must update once via the in-app Installer when it appears.',
      }
    }
    return { ok: false, message: msg }
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
