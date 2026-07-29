/**
 * Simple Android install screen: one tap → download schoolie.apk from GitHub.
 * No zip packs, no LAN server required.
 */
import { useEffect, useRef, useState } from 'react'
import { GITHUB_APK_LATEST, GITHUB_PAGES_BASE, GITHUB_REPO_URL } from './githubConfig'
import { isAndroid, isNativeCapacitorApp, isStandaloneApp } from './installApp'
import { formatVersionLabel } from './version'

type Props = {
  onContinueInBrowser: () => void
}

function startDownload(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = 'schoolie.apk'
  a.rel = 'noopener'
  a.target = '_blank'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function AndroidInstaller(props: Props) {
  const [status, setStatus] = useState('Starting download…')
  const started = useRef(false)

  function download() {
    try {
      localStorage.setItem('schoolie-update-server', GITHUB_PAGES_BASE)
    } catch {
      /* ignore */
    }
    setStatus('Download started — open schoolie.apk, then tap Install.')
    startDownload(GITHUB_APK_LATEST)
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    const t = window.setTimeout(download, 400)
    return () => window.clearTimeout(t)
  }, [])

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
        <p className="installer-kicker">Android · {formatVersionLabel()}</p>
        <h1 className="installer-title">Install Project Cost Tracker</h1>
        <p className="installer-lead">
          One download. After install, the app updates itself from GitHub when you open it.
        </p>

        <button type="button" className="btn btn-primary installer-cta" onClick={download}>
          Download schoolie.apk
        </button>
        <p className="installer-status">{status}</p>

        <div className="installer-steps-block" style={{ marginTop: 20 }}>
          <h2>3 steps</h2>
          <ol className="installer-ol">
            <li>
              Open the downloaded <strong>schoolie.apk</strong>
            </li>
            <li>
              Allow <strong>Install unknown apps</strong> if Android asks
            </li>
            <li>
              Tap <strong>Install</strong> → <strong>Open</strong>
            </li>
          </ol>
        </div>

        <p className="muted" style={{ marginTop: 16, fontSize: '0.9rem' }}>
          Direct link:{' '}
          <a href={GITHUB_APK_LATEST} download="schoolie.apk" rel="noopener">
            schoolie.apk
          </a>
          <br />
          <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
            {GITHUB_REPO_URL.replace('https://', '')}
          </a>
        </p>

        <button type="button" className="installer-skip" onClick={props.onContinueInBrowser}>
          Continue in browser without installing
        </button>
      </div>
    </div>
  )
}

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
  return isAndroid()
}

export function rememberSkipInstaller(): void {
  try {
    localStorage.setItem('schoolie-skip-installer', '1')
  } catch {
    /* ignore */
  }
}
