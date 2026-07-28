/**
 * Full-page Android installer — downloads a real APK so Android installs
 * Schoolie like any normal app (not a browser bookmark).
 */
import { useState } from 'react'
import { isAndroid, isNativeCapacitorApp, isStandaloneApp } from './installApp'
import { formatVersionLabel } from './version'

type Props = {
  onContinueInBrowser: () => void
}

const APK_HREF = './downloads/schoolie.apk'

export function AndroidInstaller(props: Props) {
  const [downloading, setDownloading] = useState(false)

  function downloadApk() {
    setDownloading(true)
    // Remember this server so the installed app can OTA-update later
    try {
      const base = `${window.location.protocol}//${window.location.host}`
      localStorage.setItem('schoolie-update-server', base)
    } catch {
      /* ignore */
    }
    // Trigger download of real Android package
    const a = document.createElement('a')
    a.href = APK_HREF
    a.download = 'schoolie.apk'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Android will open the package installer when the download finishes
    setTimeout(() => setDownloading(false), 1500)
  }

  return (
    <div className="installer-shell">
      <div className="installer-card">
        <img
          src="./pwa-512.png"
          alt="Schoolie"
          className="installer-hero-logo"
          width={96}
          height={96}
        />
        <p className="installer-kicker">Android app · {formatVersionLabel()}</p>
        <h1 className="installer-title">Install Schoolie</h1>
        <p className="installer-lead">
          Download the real Android app (APK). Your phone will open the normal Android installer —
          same as installing any other app. No Play Store required.
        </p>

        <button
          type="button"
          className="btn btn-primary installer-cta"
          disabled={downloading}
          onClick={downloadApk}
        >
          {downloading ? 'Starting download…' : 'Download & install app'}
        </button>

        <div className="installer-steps-block" style={{ marginTop: 20 }}>
          <h2>After the download</h2>
          <ol className="installer-ol">
            <li>
              Open the downloaded file <strong>schoolie.apk</strong> (notification or Files app).
            </li>
            <li>
              If Android asks, allow <strong>Install unknown apps</strong> for Chrome / Files.
            </li>
            <li>
              Tap <strong>Install</strong> on the system installer screen.
            </li>
            <li>
              Tap <strong>Open</strong> — Schoolie is now in your app tray with the bus logo.
            </li>
          </ol>
        </div>

        <div className="installer-checks">
          <h3>Tips</h3>
          <ul>
            <li>Use Chrome or your default browser on this Wi‑Fi</li>
            <li>If install is blocked, Settings → Apps → Special access → Install unknown apps</li>
            <li>After install, open Schoolie → Settings → set update server if needed</li>
            <li>
              Later updates: keep the PC on <code>npm run start:android</code>, then{' '}
              <strong>Check for updates</strong> in the app (no new APK)
            </li>
          </ul>
        </div>

        <a className="installer-apk-link" href={APK_HREF} download="schoolie.apk">
          Direct link: schoolie.apk
        </a>

        <button type="button" className="installer-skip" onClick={props.onContinueInBrowser}>
          Continue in browser without installing
        </button>
      </div>
    </div>
  )
}

/** Show installer page instead of the full app? */
export function shouldShowAndroidInstaller(): boolean {
  if (typeof window === 'undefined') return false
  // Already the installed APK / PWA / desktop app → open Schoolie, not the store page
  if (isNativeCapacitorApp() || isStandaloneApp()) return false
  // Query override for testing: ?app=1 skips installer
  if (new URLSearchParams(window.location.search).get('app') === '1') return false
  // Force installer: ?install=1
  if (new URLSearchParams(window.location.search).get('install') === '1') return true
  // Remember user chose browser
  try {
    if (localStorage.getItem('schoolie-skip-installer') === '1') return false
  } catch {
    /* ignore */
  }
  // Only the mobile browser download page (not the installed app)
  return isAndroid()
}

export function rememberSkipInstaller(): void {
  try {
    localStorage.setItem('schoolie-skip-installer', '1')
  } catch {
    /* ignore */
  }
}
