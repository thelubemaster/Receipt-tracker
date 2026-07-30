/**
 * In-app APK install.
 * Android will not change the home-screen icon without a package install —
 * this starts that install from inside the app (DownloadManager or WebView download).
 */
import { isNativeCapacitorApp } from './installApp'

type ApkPlugin = {
  canInstallPackages: () => Promise<{ allowed: boolean }>
  openInstallPermissionSettings: () => Promise<void>
  downloadAndInstall: (opts: {
    url: string
    fileName?: string
  }) => Promise<{ installed?: boolean; path?: string; started?: boolean }>
  installFile: (opts: { path: string }) => Promise<void>
}

async function getPlugin(): Promise<ApkPlugin | null> {
  if (!isNativeCapacitorApp()) return null
  try {
    const { registerPlugin } = await import('@capacitor/core')
    // Probe: if plugin isn't in this APK, calls will reject
    const plugin = registerPlugin<ApkPlugin>('ApkInstaller')
    return plugin
  } catch {
    return null
  }
}

export async function canInstallApkPackages(): Promise<boolean> {
  const p = await getPlugin()
  if (!p) return false
  try {
    const r = await p.canInstallPackages()
    return !!r.allowed
  } catch {
    return false
  }
}

export async function openApkInstallPermissionSettings(): Promise<void> {
  const p = await getPlugin()
  if (!p) return
  try {
    await p.openInstallPermissionSettings()
  } catch {
    /* ignore */
  }
}

/**
 * Start APK download from *inside* the app and open Android's Install screen.
 *
 * Android does not allow changing the home-screen icon via web OTA alone.
 * This is the package update that changes the icon — launched from the app UI
 * so you never open a browser or hunt for files on GitHub.
 */
export async function downloadAndInstallApk(
  url: string,
  onProgress?: (msg: string) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const p = await getPlugin()
  if (p) {
    try {
      // Detect missing native plugin (registerPlugin succeeds; call fails)
      try {
        await p.canInstallPackages()
      } catch {
        // Plugin not in this APK build — use WebView download path below
        throw new Error('PLUGIN_MISSING')
      }

      const allowed = await canInstallApkPackages()
      if (!allowed) {
        onProgress?.(
          'Allow “Install unknown apps” for Cost Tracker, then tap the button again…',
        )
        await p.openInstallPermissionSettings()
      }
      onProgress?.('Downloading in the background… (check the notification shade)')
      await p.downloadAndInstall({
        url,
        fileName: 'schoolie-update.apk',
      })
      onProgress?.('Tap Install when Android asks — then open Cost Tracker again.')
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'PLUGIN_MISSING') {
        onProgress?.(`Installer issue (${msg}). Trying built-in download…`)
      }
      /* fall through */
    }
  }

  // Older APKs without ApkInstaller — still stay inside the app WebView
  try {
    onProgress?.('Starting download from inside the app…')
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = url
    document.body.appendChild(iframe)
    setTimeout(() => {
      try {
        iframe.remove()
      } catch {
        /* ignore */
      }
    }, 60_000)

    const a = document.createElement('a')
    a.href = url
    a.setAttribute('download', 'schoolie-update.apk')
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()

    setTimeout(() => {
      try {
        window.location.href = url
      } catch {
        /* ignore */
      }
    }, 500)

    onProgress?.(
      'Download started. Open the notification or Downloads, tap the APK, then Install. After that the home-screen logo updates.',
    )
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Could not start APK download',
    }
  }
}
