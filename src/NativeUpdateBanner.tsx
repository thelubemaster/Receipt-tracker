/**
 * Prompts to update the *native* shell (home-screen icon).
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
    try {
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
      if (native && native.versionCode < APK_VERSION_CODE) {
        setApk({
          versionCode: APK_VERSION_CODE,
          versionName: APP_VERSION,
          url: githubApkForTag(APK_RELEASE_TAG),
        })
      } else {
        setApk(null)
      }
    } catch (e) {
      // Still offer update if native probe fails
      setApk({
        versionCode: APK_VERSION_CODE,
        versionName: APP_VERSION,
        url: githubApkForTag(APK_RELEASE_TAG),
      })
      setStatus(e instanceof Error ? e.message : 'Could not read app version')
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
    setStatus('Starting…')
    try {
      const result = await downloadAndInstallApk(url, (m) => setStatus(m))
      if (result.ok) {
        setStatus(
          (prev) =>
            prev ||
            'When Android shows Install, tap it. Then open Cost Tracker from the home screen.',
        )
      } else {
        setStatus(result.message)
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

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
          <strong>Update home-screen logo</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Tap once. The app downloads the package and opens Install. Allow “Install unknown apps”
            for Cost Tracker if Android asks.
          </p>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>
            Your package: {nativeLabel || '…'} → need build {apk.versionCode}
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
        {busy ? 'Working…' : 'Update home-screen logo now'}
      </button>
      {status && (
        <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.88rem' }} role="status">
          {status}
        </p>
      )}
    </div>
  )
}
