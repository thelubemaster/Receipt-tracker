/**
 * Home-screen logo update card — works after web OTA without reinstalling first.
 * Opens system download/Install immediately (no hanging native wait).
 */
import { useCallback, useEffect, useState } from 'react'
import { checkForApkUpdate, getNativeAppInfo } from './appUpdate'
import { downloadAndInstallApk, openSystemApkUrl } from './apkInstaller'
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
      } else if (!native) {
        // Still offer — better than silent fail
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
    setStatus('Opening download…')
    try {
      // Fire system open immediately so something visible happens in <1s
      openSystemApkUrl(url)
      const result = await downloadAndInstallApk(url, (m) => setStatus(m))
      if (result.ok) {
        setStatus(
          'If Install did not appear: swipe down notifications → tap the APK download → Install. Then open Cost Tracker from the home screen.',
        )
      } else {
        setStatus(result.message)
      }
    } catch (e) {
      // Still try system open
      openSystemApkUrl(url)
      setStatus(
        e instanceof Error
          ? e.message
          : 'Tap your notification shade for the download, then Install.',
      )
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
            Tap the button. Android will download the package (~15&nbsp;MB) and ask to{' '}
            <em>Install</em>. That is required for the home-screen icon — there is no way around
            it on Android.
          </p>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>
            {nativeLabel ? `Installed: ${nativeLabel} → ` : ''}
            need build {apk.versionCode}
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
        {busy ? 'Opening download…' : 'Update home-screen logo now'}
      </button>
      {/* Visible link so user can also open download if WebView blocks intents */}
      <a
        className="btn btn-secondary"
        style={{
          width: '100%',
          marginTop: 10,
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textDecoration: 'none',
        }}
        href={apk.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          openSystemApkUrl(apk.url)
          setStatus('Opened download link. Tap Install when Android asks.')
        }}
      >
        Open download link
      </a>
      {status && (
        <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.88rem' }} role="status">
          {status}
        </p>
      )}
    </div>
  )
}
