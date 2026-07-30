/**
 * Prompts to update the *native* shell (home-screen icon, installer plugin, …).
 * Android cannot change the launcher icon via web OTA — this downloads the APK
 * from inside the app and opens the system Install screen (one tap).
 */
import { useCallback, useEffect, useState } from 'react'
import { checkForApkUpdate, getNativeAppInfo } from './appUpdate'
import { downloadAndInstallApk } from './apkInstaller'
import { isNativeCapacitorApp } from './installApp'
import { APK_VERSION_CODE, APP_VERSION } from './version'

type ApkAvail = {
  versionCode: number
  versionName: string
  url: string
}

export function NativeUpdateBanner() {
  const [apk, setApk] = useState<ApkAvail | null>(null)
  const [nativeLabel, setNativeLabel] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const refresh = useCallback(async () => {
    if (!isNativeCapacitorApp()) return
    const native = await getNativeAppInfo()
    if (native) {
      setNativeLabel(`v${native.versionName} (${native.versionCode})`)
    }
    const r = await checkForApkUpdate()
    if (r.status === 'available') {
      setApk({
        versionCode: r.versionCode,
        versionName: r.versionName,
        url: r.url,
      })
    } else {
      setApk(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // Re-check when returning to the app (e.g. after Install screen)
    const onVis = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [refresh])

  async function startUpdate() {
    if (!apk) return
    setBusy(true)
    setStatus('Starting download inside the app…')
    try {
      const result = await downloadAndInstallApk(apk.url, (m) => setStatus(m))
      if (result.ok) {
        setStatus(
          'When Android asks, tap Install. Then open Cost Tracker again — your home-screen logo will update.',
        )
      } else {
        setStatus(result.message)
      }
    } finally {
      setBusy(false)
    }
  }

  if (!isNativeCapacitorApp() || dismissed || !apk) return null

  return (
    <div className="native-update-card" role="region" aria-label="Home screen logo update">
      <div className="native-update-row">
        <img
          src="./pwa-192.png"
          alt=""
          width={56}
          height={56}
          className="native-update-preview"
        />
        <div className="native-update-copy">
          <strong>Update home-screen logo</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Android keeps the old icon until the app package is updated. Tap below — the app
            downloads it here (~15&nbsp;MB). You only tap <em>Install</em> when Android asks.
          </p>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>
            Installed shell: {nativeLabel || '…'} · New: v{apk.versionName} ({apk.versionCode}) ·
            content v{APP_VERSION} / apkCode {APK_VERSION_CODE}
          </p>
        </div>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 12, minHeight: 48 }}
        disabled={busy}
        onClick={() => void startUpdate()}
      >
        {busy ? 'Downloading…' : 'Update logo from the app'}
      </button>
      {status && (
        <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.88rem' }}>
          {status}
        </p>
      )}
      <button
        type="button"
        className="native-update-later"
        onClick={() => setDismissed(true)}
      >
        Later
      </button>
    </div>
  )
}
