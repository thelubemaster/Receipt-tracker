/**
 * Read what this install actually has, and what it needs next.
 * Used to drive step-by-step updates (content OTA → Android package).
 */
import {
  checkForApkUpdate,
  checkForAppBundleUpdate,
  getNativeAppInfo,
} from './appUpdate'
import { githubApkForTag } from './githubConfig'
import { isNativeCapacitorApp } from './installApp'
import {
  APK_RELEASE_TAG,
  APK_VERSION_CODE,
  APP_VERSION,
} from './version'

export type InstallerStatus = 'ready' | 'missing' | 'unknown' | 'browser'

export type VersionSnapshot = {
  /** Web/UI version running right now (Capgo or bundled) */
  contentVersion: string
  /** Android package versionName (from APK) */
  shellVersionName: string | null
  /** Android versionCode (from APK) */
  shellVersionCode: number | null
  /** Latest content available on GitHub */
  latestContentVersion: string | null
  /** Latest shell versionCode we know about */
  latestShellCode: number
  latestShellName: string
  /** APK download URL for the shell they need */
  apkUrl: string
  /** Can this install download+install APK fully in-app? */
  installer: InstallerStatus
  /** Content OTA available? */
  contentUpdateAvailable: boolean
  /** Android package update available? */
  shellUpdateAvailable: boolean
  /** Human summary */
  summary: string
  /** Ordered next steps */
  steps: string[]
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
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

/** Probe whether ApkInstaller native plugin answers. */
export async function probeInAppInstaller(): Promise<InstallerStatus> {
  if (!isNativeCapacitorApp()) return 'browser'
  try {
    const { registerPlugin } = await import('@capacitor/core')
    const p = registerPlugin<{
      canInstallPackages: () => Promise<{ allowed: boolean }>
    }>('ApkInstaller')
    await withTimeout(p.canInstallPackages(), 3500)
    return 'ready'
  } catch {
    return 'missing'
  }
}

export async function readVersionSnapshot(): Promise<VersionSnapshot> {
  const contentVersion = APP_VERSION
  let shellVersionName: string | null = null
  let shellVersionCode: number | null = null

  const native = await getNativeAppInfo()
  if (native) {
    shellVersionName = native.versionName
    shellVersionCode = native.versionCode
  }

  let latestContentVersion: string | null = null
  let contentUpdateAvailable = false
  try {
    const web = await withTimeout(checkForAppBundleUpdate(), 12_000)
    if (web.status === 'available') {
      contentUpdateAvailable = true
      latestContentVersion = web.manifest.version
    } else if (web.status === 'current') {
      latestContentVersion = web.version
    }
  } catch {
    latestContentVersion = null
  }

  let latestShellCode = APK_VERSION_CODE
  let latestShellName = APP_VERSION
  let apkUrl = githubApkForTag(APK_RELEASE_TAG)
  try {
    const apk = await withTimeout(checkForApkUpdate(), 12_000)
    if (apk.status === 'available') {
      latestShellCode = apk.versionCode
      latestShellName = apk.versionName
      apkUrl = apk.url
    } else if (apk.status === 'current') {
      latestShellCode = Math.max(latestShellCode, apk.versionCode)
      latestShellName = apk.versionName
    }
  } catch {
    /* use bundled floors */
  }

  const installer = await probeInAppInstaller()

  const shellUpdateAvailable =
    isNativeCapacitorApp() &&
    (shellVersionCode == null || shellVersionCode < latestShellCode)

  const steps: string[] = []
  if (contentUpdateAvailable) {
    steps.push(`Update app content to v${latestContentVersion}`)
  }
  if (shellUpdateAvailable) {
    if (installer === 'ready') {
      steps.push(
        `Update Android package to build ${latestShellCode} (logo + in-app installer) — downloads inside the app`,
      )
    } else if (installer === 'missing') {
      steps.push(
        `Android package is build ${shellVersionCode ?? '?'} — needs build ${latestShellCode}. In-app downloader missing on this package; content update first may help, then try package update again.`,
      )
    } else {
      steps.push(`Update Android package to build ${latestShellCode}`)
    }
  }
  if (!steps.length) {
    steps.push('Everything looks up to date for this device.')
  }

  let summary: string
  if (!isNativeCapacitorApp()) {
    summary = `Running in browser — content v${contentVersion}. Install the Android app for home-screen icon updates.`
  } else if (shellUpdateAvailable && contentUpdateAvailable) {
    summary = `Content and Android package are both behind. Update both (content first, then package).`
  } else if (shellUpdateAvailable) {
    summary = `App content is v${contentVersion}. Android package is build ${shellVersionCode ?? '?'} and needs build ${latestShellCode} for the logo and full installer.`
  } else if (contentUpdateAvailable) {
    summary = `Android package OK (build ${shellVersionCode}). Content can update to v${latestContentVersion}.`
  } else {
    summary = `Up to date — content v${contentVersion}, package build ${shellVersionCode ?? 'n/a'}.`
  }

  return {
    contentVersion,
    shellVersionName,
    shellVersionCode,
    latestContentVersion,
    latestShellCode,
    latestShellName,
    apkUrl,
    installer,
    contentUpdateAvailable,
    shellUpdateAvailable,
    summary,
    steps,
  }
}

export function defaultApkUrl(): string {
  return githubApkForTag(APK_RELEASE_TAG)
}
