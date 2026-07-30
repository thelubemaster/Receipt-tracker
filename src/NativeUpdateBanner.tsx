/**
 * Fully in-app home-screen logo / shell update.
 * Download + PackageInstaller only — no browser, no external links.
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
  const [percent, setPercent] = useState<number | null>(null)

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
    } catch {
      setApk({
        versionCode: APK_VERSION_CODE,
        versionName: APP_VERSION,
        url: githubApkForTag(APK_RELEASE_TAG),
      })
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
    setPercent(0)
    setStatus('Starting in-app download…')
    try {
      const result = await downloadAndInstallApk(url, (m) => {
        setStatus(m)
        const match = /(\d+)\s*%/.exec(m)
        if (match) setPercent(parseInt(match[1], 10))
        if (/Install/i.test(m)) setPercent(100)
      })
      if (result.ok) {
        setPercent(100)
        setStatus(
          'Confirm Install on the system screen, then open Cost Tracker from the home screen.',
        )
      } else {
        setStatus(result.message)
        setPercent(null)
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Update failed')
      setPercent(null)
    } finally {
      setBusy(false)
    }
  }

  if (!isNativeCapacitorApp() || !apk) return null

  return (
    <div className="native-update-card" role="region" aria-label="In-app app update">
      <div className="native-update-row">
        <img
          src="./pwa-192.png"
          alt=""
          width={56}
          height={56}
          className="native-update-preview"
        />
        <div className="native-update-copy">
          <strong>Update available (in-app)</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Downloads and installs entirely inside Cost Tracker — no browser. You only confirm{' '}
            <em>Install</em> on the Android screen.
          </p>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>
            {nativeLabel ? `${nativeLabel} → ` : ''}
            build {apk.versionCode}
          </p>
        </div>
      </div>

      {percent != null && (
        <div className="native-update-progress" aria-hidden>
          <div className="native-update-progress-fill" style={{ width: `${percent}%` }} />
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 12, minHeight: 52, fontSize: '1.05rem' }}
        disabled={busy}
        onClick={() => void startUpdate()}
      >
        {busy
          ? percent != null && percent < 100
            ? `Downloading… ${percent}%`
            : 'Working…'
          : 'Update now (in-app)'}
      </button>

      {status && (
        <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.88rem' }} role="status">
          {status}
        </p>
      )}
    </div>
  )
}
