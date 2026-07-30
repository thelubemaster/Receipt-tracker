/**
 * Shows exact versions on this device and runs the right updates in order:
 * 1) app content (Capgo OTA)  2) Android package (in-app download + Install)
 */
import { useCallback, useEffect, useState } from 'react'
import {
  applyAppBundleUpdate,
  checkForAppBundleUpdate,
  useGitHubUpdates,
  setAutoUpdate,
} from './appUpdate'
import { downloadAndInstallApk } from './apkInstaller'
import { isNativeCapacitorApp } from './installApp'
import { readVersionSnapshot, type VersionSnapshot } from './versionProbe'
import { APP_VERSION } from './version'

/** Full update panel — Settings only (main screens just show a tiny version chip). */
export function UpdateCenter() {
  const [snap, setSnap] = useState<VersionSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [percent, setPercent] = useState<number | null>(null)
  const native = isNativeCapacitorApp()

  const refresh = useCallback(async () => {
    try {
      const s = await readVersionSnapshot()
      setSnap(s)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not read versions')
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

  async function getUpToDate() {
    setBusy(true)
    setPercent(null)
    setStatus('Checking what you have…')
    try {
      await useGitHubUpdates()
      await setAutoUpdate(true)
      let s = await readVersionSnapshot()
      setSnap(s)

      // ── Step 1: content (so you get the latest updater UI + logic) ──
      if (s.contentUpdateAvailable) {
        setStatus(`Updating app content to v${s.latestContentVersion}…`)
        const web = await Promise.race([
          checkForAppBundleUpdate(),
          new Promise<Awaited<ReturnType<typeof checkForAppBundleUpdate>>>((resolve) =>
            setTimeout(
              () => resolve({ status: 'error', message: 'Content check timed out' }),
              15_000,
            ),
          ),
        ])
        if (web.status === 'available') {
          const applied = await Promise.race([
            applyAppBundleUpdate(web.manifest, (m) => setStatus(m)),
            new Promise<{ ok: false; message: string }>((resolve) =>
              setTimeout(
                () => resolve({ ok: false, message: 'Content download timed out' }),
                50_000,
              ),
            ),
          ])
          if (applied.ok) {
            setStatus(`Content updated to v${web.manifest.version}. Continuing…`)
            // Capgo will reload shortly; if not, keep going
            await new Promise((r) => setTimeout(r, 800))
          } else {
            setStatus(`Content: ${applied.message}. Trying package update anyway…`)
          }
        }
        s = await readVersionSnapshot()
        setSnap(s)
      }

      // ── Step 2: Android package (logo + real in-app installer) ──
      if (s.shellUpdateAvailable && native) {
        setStatus(
          `Downloading Android package build ${s.latestShellCode} (~15 MB)…`,
        )
        setPercent(0)
        const r = await downloadAndInstallApk(s.apkUrl, (m) => {
          setStatus(m)
          const match = /(\d+)\s*%/.exec(m)
          if (match) setPercent(parseInt(match[1], 10))
          else if (/MB|Connecting|Redirect|Still downloading|alternate|Preparing|Saving/i.test(m)) {
            // Keep bar alive with indeterminate-ish motion when only text updates
            setPercent((prev) => {
              if (prev == null || prev < 1) return 1
              if (prev >= 95) return prev
              return prev
            })
          }
        })
        if (r.ok) {
          setPercent(100)
          setStatus(
            'Confirm Install on the Android screen. After it finishes, open Cost Tracker again — logo and updater will match.',
          )
        } else {
          setStatus(r.message)
          setPercent(null)
        }
      } else if (!s.contentUpdateAvailable && !s.shellUpdateAvailable) {
        setStatus(
          `You're up to date. Content v${s.contentVersion}, package build ${s.shellVersionCode ?? 'n/a'}.`,
        )
      } else if (!native) {
        setStatus(`Content v${s.contentVersion}. Install the Android app for package updates.`)
      }

      await refresh()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Update failed')
      setPercent(null)
    } finally {
      setBusy(false)
    }
  }

  if (!snap && !status) {
    return (
      <div className="card settings-card">
        <strong>Updates</strong>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          Reading versions on this device…
        </p>
      </div>
    )
  }

  const s = snap
  const needsWork = !!(s && (s.contentUpdateAvailable || s.shellUpdateAvailable))

  return (
    <div className="card settings-card update-center">
      <strong>Updates & versions</strong>
      <p className="muted" style={{ margin: '6px 0 12px' }}>
        {s?.summary || status || '…'}
      </p>

      {s && (
        <div className="version-table">
          <div className="version-row">
            <span>App content (features)</span>
            <span className="version-values">
              <strong>v{s.contentVersion}</strong>
              {s.latestContentVersion && s.latestContentVersion !== s.contentVersion && (
                <span className="version-target"> → v{s.latestContentVersion}</span>
              )}
              <span className={s.contentUpdateAvailable ? 'pill pill-warn' : 'pill pill-ok'}>
                {s.contentUpdateAvailable ? 'update' : 'ok'}
              </span>
            </span>
          </div>
          <div className="version-row">
            <span>Android package (logo)</span>
            <span className="version-values">
              <strong>
                {s.shellVersionCode != null
                  ? `build ${s.shellVersionCode}`
                  : native
                    ? 'unknown'
                    : 'n/a'}
              </strong>
              {s.shellVersionName ? ` (v${s.shellVersionName})` : ''}
              {s.shellUpdateAvailable && (
                <span className="version-target"> → build {s.latestShellCode}</span>
              )}
              <span className={s.shellUpdateAvailable ? 'pill pill-warn' : 'pill pill-ok'}>
                {s.shellUpdateAvailable ? 'update' : 'ok'}
              </span>
            </span>
          </div>
          <div className="version-row">
            <span>In-app installer</span>
            <span className="version-values">
              <strong>
                {s.installer === 'ready'
                  ? 'ready'
                  : s.installer === 'missing'
                    ? 'not in this package yet'
                    : s.installer}
              </strong>
              <span
                className={
                  s.installer === 'ready' ? 'pill pill-ok' : 'pill pill-warn'
                }
              >
                {s.installer === 'ready' ? 'ok' : 'needed'}
              </span>
            </span>
          </div>
        </div>
      )}

      {s && s.steps.length > 0 && (
        <ol className="update-steps">
          {s.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}

      {percent != null && (
        <div className="native-update-progress" aria-hidden>
          <div className="native-update-progress-fill" style={{ width: `${percent}%` }} />
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 12, minHeight: 48 }}
        disabled={busy}
        onClick={() => void getUpToDate()}
      >
        {busy
          ? percent != null && percent < 100
            ? `Downloading package… ${percent}%`
            : 'Working…'
          : needsWork
            ? 'Get up to date'
            : 'Check again'}
      </button>

      {status && (
        <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.88rem' }} role="status">
          {status}
        </p>
      )}

      <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.78rem' }}>
        Running UI build v{APP_VERSION}
        {s?.shellVersionCode != null ? ` · package build ${s.shellVersionCode}` : ''}.
      </p>
    </div>
  )
}
