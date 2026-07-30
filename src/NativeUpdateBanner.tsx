/**
 * Prompts to update the *native* shell (home-screen icon).
 * Android cannot change the launcher icon via web OTA — this downloads the APK
 * from inside the app and opens the system Install screen.
 */
import { useCallback, useEffect, useState } from 'react'
import { checkForApkUpdate, getNativeAppInfo } from './appUpdate'
import { downloadAndInstallApk } from './apkInstaller'
import { githubApkForTag } from './githubConfig'
import { isNativeCapacitorApp } from './installApp'
import { APK_RELEASE_TAG, APK_VERSION_CODE, APP_VERSION } from './version'

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

  const refresh = useCallback(async () => {
    if (!isNativeCapacitorApp()) return
    const native = await getNativeAppInfo()
    if (native) {
      setNativeLabel(`v${native.versionName} (build ${native.versionCode})`)
    }
    const r = await checkForApkUpdate()
    if (r.status === 'available') {
      setApk({
        versionCode: r.versionCode,
        versionName: r.versionName,
        url: r.url,
      })
      return
    }
    // Hard fallback: if shell is older than this web build expects, always offer update
    if (native && native.versionCode < APK_VERSION_CODE) {
      setApk({
        versionCode: APK_VERSION_CODE,
        versionName: APP_VERSION,
        url: githubApkForTag(APK_RELEASE_TAG),
      })
    } else {
      setApk(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onVis = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [refresh])

  async function startUpdate() {
    const url = apk?.url || githubApkForTag(APK_RELEASE_TAG)
    setBusy(true)
    setStatus('Starting download inside the app…')
    try {
      // If Android blocks unknown apps, open settings first
      const result = await downloadAndInstallApk(url, (m) => setStatus(m))
      if (result.ok) {
        setStatus(
          'Next: open the download notification (or Files → Downloads), tap the APK, then Install. Your home-screen logo updates after that.',
        )
      } else {
        setStatus(result.message)
      }
    } finally {
      setBusy(false)
    }
  }

  // Always show on native until shell is current — cannot dismiss permanently
  // while out of date (user said logo still wrong / update not working)
  if (!isNativeCapacitorApp() || !apk) return null

  return (
    <div className="native-update-card" role="region" aria-label="Home screen logo update">
      <div className="native-update-row">
        <img
          src="./pwa-192.png"
          alt="New logo"
          width={56}
          height={56}
          className="native-update-preview"
        />
        <div className="native-update-copy">
          <strong>Home-screen logo needs a package update</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Android will not change the icon with a normal app refresh. Tap the button — this app
            downloads the update (~15&nbsp;MB). Then tap <em>Install</em> when Android asks. You do
            not need a browser or GitHub.
          </p>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>
            Your package: {nativeLabel || '…'} → need build {apk.versionCode} (v{apk.versionName})
          </p>
        </div>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 12, minHeight: 52, fontSize: '1.05rem' }}
        disabled={busy}
        onClick={() => void startUpdate()}
      >
        {busy ? 'Downloading…' : 'Update home-screen logo now'}
      </button>
      {status && (
        <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.88rem' }}>
          {status}
        </p>
      )}
    </div>
  )
}
