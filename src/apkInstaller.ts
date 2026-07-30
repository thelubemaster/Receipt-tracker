/**
 * In-app APK install (native Capacitor plugin).
 * Downloads the new APK via Android DownloadManager and opens the system installer.
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
    return registerPlugin<ApkPlugin>('ApkInstaller')
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
  await p.openInstallPermissionSettings()
}

/**
 * Download APK from url and open the Android package installer.
 * First run may open Settings so the user can allow installs from this app.
 */
export async function downloadAndInstallApk(
  url: string,
  onProgress?: (msg: string) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const p = await getPlugin()
  if (!p) {
    // Older APK without the installer plugin — still open download from inside the app
    try {
      onProgress?.('Opening download inside the app…')
      try {
        const { App } = await import('@capacitor/app')
        // Capacitor 7: openUrl launches the system handler for the APK link
        await (App as unknown as { openUrl?: (o: { url: string }) => Promise<void> }).openUrl?.({
          url,
        })
      } catch {
        /* fall through */
      }
      // Always also try window / anchor — works in WebView for https APK URLs
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener'
      a.download = 'schoolie.apk'
      document.body.appendChild(a)
      a.click()
      a.remove()
      return { ok: true }
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : 'Could not open download',
      }
    }
  }
  try {
    const allowed = await canInstallApkPackages()
    if (!allowed) {
      onProgress?.('Allow “Install unknown apps” for Cost Tracker, then try again…')
      await p.openInstallPermissionSettings()
    }
    onProgress?.('Downloading update… (see the notification for progress)')
    await p.downloadAndInstall({
      url,
      fileName: 'schoolie-update.apk',
    })
    onProgress?.('Opening installer — tap Install when prompted.')
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'APK update failed',
    }
  }
}
