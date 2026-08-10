/**
 * Universal install screen — same entry for Android and Apple.
 *
 * - Android: download project-cost-tracker.apk (real home-screen app + OTA)
 * - iPhone / iPad: free PWA via Safari → Share → Add to Home Screen
 *   (Apple does not allow installing Android APKs; App Store requires a paid
 *   developer account. The web app is the same product on both.)
 */
import { useEffect, useRef, useState } from 'react'
import { APK_FILE_NAME } from './brand'
import {
  GITHUB_APK_LATEST,
  GITHUB_INSTALL_URL,
  GITHUB_PAGES_BASE,
  GITHUB_REPO_URL,
} from './githubConfig'
import { isAndroid, isIos, isNativeCapacitorApp, isStandaloneApp } from './installApp'
import { formatVersionLabel } from './version'

type Props = {
  onContinueInBrowser: () => void
}

function startDownload(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = APK_FILE_NAME
  a.rel = 'noopener'
  a.target = '_blank'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function AndroidInstaller(props: Props) {
  const android = isAndroid()
  const ios = isIos()
  const [status, setStatus] = useState(
    android ? 'Starting download…' : ios ? 'Install on your home screen' : 'Choose how to install',
  )
  const started = useRef(false)

  function downloadApk() {
    try {
      localStorage.setItem('schoolie-update-server', GITHUB_PAGES_BASE)
    } catch {
      /* ignore */
    }
    setStatus(`Download started — open ${APK_FILE_NAME}, then tap Install.`)
    startDownload(GITHUB_APK_LATEST)
  }

  useEffect(() => {
    if (!android) return
    if (started.current) return
    started.current = true
    const t = window.setTimeout(downloadApk, 400)
    return () => window.clearTimeout(t)
  }, [android])

  const title = ios
    ? 'Install on iPhone / iPad'
    : android
      ? 'Install on Android'
      : 'Install Project Cost Tracker'

  const kicker = ios
    ? `Apple · ${formatVersionLabel()}`
    : android
      ? `Android · ${formatVersionLabel()}`
      : `Android & Apple · ${formatVersionLabel()}`

  return (
    <div className="installer-shell">
      <div className="installer-card">
        <img
          src="./pwa-512.png"
          alt="Project Cost Tracker"
          className="installer-hero-logo"
          width={96}
          height={96}
        />
        <p className="installer-kicker">{kicker}</p>
        <h1 className="installer-title">{title}</h1>

        {ios ? (
          <>
            <p className="installer-lead">
              Same app as Android — free, on-device receipt scanning. On Apple, add it to your Home
              Screen from Safari (no App Store needed).
            </p>
            <p className="installer-status">{status}</p>

            <div className="installer-steps-block" style={{ marginTop: 12 }}>
              <h2>Install on this iPhone / iPad</h2>
              <ol className="installer-ol">
                <li>
                  Open this page in <strong>Safari</strong> (required — not Chrome)
                </li>
                <li>
                  Tap the <strong>Share</strong> button (square with ↑) at the bottom of Safari
                </li>
                <li>
                  Scroll and tap <strong>Add to Home Screen</strong>
                </li>
                <li>
                  Tap <strong>Add</strong> — then open <strong>Cost Tracker</strong> from your home
                  screen
                </li>
              </ol>
            </div>

            <button
              type="button"
              className="btn btn-primary installer-cta"
              onClick={() => {
                setStatus('After you Add to Home Screen, open the icon like any other app.')
                try {
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                } catch {
                  /* ignore */
                }
              }}
            >
              I’m in Safari — ready to Share
            </button>

            <p className="muted" style={{ marginTop: 16, fontSize: '0.9rem' }}>
              Bookmark this install link for later:
              <br />
              <a href={GITHUB_INSTALL_URL}>{GITHUB_INSTALL_URL.replace('https://', '')}</a>
            </p>
          </>
        ) : (
          <>
            <p className="installer-lead">
              One link for phones. On Android you get the APK; on iPhone/iPad you add the free web
              app to the Home Screen.
            </p>

            {android ? (
              <>
                <button type="button" className="btn btn-primary installer-cta" onClick={downloadApk}>
                  Download {APK_FILE_NAME}
                </button>
                <p className="installer-status">{status}</p>

                <div className="installer-steps-block" style={{ marginTop: 20 }}>
                  <h2>3 steps</h2>
                  <ol className="installer-ol">
                    <li>
                      Open the downloaded <strong>{APK_FILE_NAME}</strong>
                    </li>
                    <li>
                      Allow <strong>Install unknown apps</strong> if Android asks
                    </li>
                    <li>
                      Tap <strong>Install</strong> → <strong>Open</strong>
                    </li>
                  </ol>
                </div>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-primary installer-cta" onClick={downloadApk}>
                  Android — Download app
                </button>
                <a
                  className="btn btn-secondary installer-cta"
                  style={{ display: 'block', textAlign: 'center', marginTop: 10, textDecoration: 'none' }}
                  href={GITHUB_INSTALL_URL}
                >
                  iPhone / iPad — Open install page
                </a>
                <p className="installer-status" style={{ marginTop: 12 }}>
                  On iPhone: open the install page in Safari → Share → Add to Home Screen.
                </p>
              </>
            )}

            <p className="muted" style={{ marginTop: 16, fontSize: '0.9rem' }}>
              Android APK:{' '}
              <a href={GITHUB_APK_LATEST} download={APK_FILE_NAME} rel="noopener">
                {APK_FILE_NAME}
              </a>
              <br />
              Shared install link:{' '}
              <a href={GITHUB_INSTALL_URL}>{GITHUB_INSTALL_URL.replace('https://', '')}</a>
              <br />
              <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                {GITHUB_REPO_URL.replace('https://', '')}
              </a>
            </p>
          </>
        )}

        <button type="button" className="installer-skip" onClick={props.onContinueInBrowser}>
          Continue in browser without installing
        </button>
      </div>
    </div>
  )
}

/** Show full-page installer for phones that are not already installed. */
export function shouldShowAndroidInstaller(): boolean {
  if (typeof window === 'undefined') return false
  if (isNativeCapacitorApp() || isStandaloneApp()) return false
  if (new URLSearchParams(window.location.search).get('app') === '1') return false
  if (new URLSearchParams(window.location.search).get('install') === '1') return true
  try {
    if (localStorage.getItem('schoolie-skip-installer') === '1') return false
  } catch {
    /* ignore */
  }
  // Same entry path for Android and Apple phones
  return isAndroid() || isIos()
}

export function rememberSkipInstaller(): void {
  try {
    localStorage.setItem('schoolie-skip-installer', '1')
  } catch {
    /* ignore */
  }
}
