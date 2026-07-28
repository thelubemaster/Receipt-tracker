/**
 * Full-page Android installer.
 * Browser PWA install is flaky on HTTP; this page walks the user through a
 * correct install and tries the native install prompt when available.
 */
import { useEffect, useState } from 'react'
import {
  hasNativeInstallPrompt,
  isAndroid,
  isStandaloneApp,
  promptInstall,
  subscribeInstallPrompt,
} from './installApp'
import { formatVersionLabel } from './version'

type Props = {
  onContinueInBrowser: () => void
}

export function AndroidInstaller(props: Props) {
  const [canPrompt, setCanPrompt] = useState(() => hasNativeInstallPrompt())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [step, setStep] = useState(1)

  useEffect(() => {
    return subscribeInstallPrompt(() => setCanPrompt(hasNativeInstallPrompt()))
  }, [])

  async function tryInstall() {
    setBusy(true)
    setStatus(null)
    try {
      const outcome = await promptInstall()
      if (outcome === 'accepted') {
        setStatus('Installed. Open Schoolie from your home screen / app tray.')
        setStep(3)
        return
      }
      if (outcome === 'dismissed') {
        setStatus('Install was cancelled. Use the steps below, or try again.')
        setStep(2)
        return
      }
      // Native prompt not available (common on HTTP / in-app browsers)
      setStep(2)
      setStatus(
        'Chrome did not offer automatic install. Use the menu steps below — that still puts the app icon on your phone.',
      )
    } finally {
      setBusy(false)
    }
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
        <p className="installer-kicker">Android app installer · {formatVersionLabel()}</p>
        <h1 className="installer-title">Install Schoolie</h1>
        <p className="installer-lead">
          This page installs Schoolie as a real app icon on your phone. Do not rely on random browser
          shortcuts — follow the button or the exact steps below.
        </p>

        {step === 1 && (
          <>
            <button
              type="button"
              className="btn btn-primary installer-cta"
              disabled={busy}
              onClick={() => void tryInstall()}
            >
              {busy ? 'Opening installer…' : canPrompt ? 'Install Schoolie now' : 'Start install'}
            </button>
            <p className="muted installer-hint">
              Use <strong>Chrome</strong> (not Instagram, Facebook, or Samsung Internet private mode
              if install fails). Stay on this Wi‑Fi page until the icon appears.
            </p>
          </>
        )}

        {step >= 2 && (
          <div className="installer-steps-block">
            <h2>Install with Chrome menu (works when the button cannot)</h2>
            <ol className="installer-ol">
              <li>
                Confirm you are in <strong>Chrome</strong> — address bar should show the Schoolie URL.
              </li>
              <li>
                Tap the <strong>⋮</strong> three-dot menu (top right).
              </li>
              <li>
                Tap <strong>Install app</strong>. If you do not see that, tap{' '}
                <strong>Add to Home screen</strong> / <strong>Add to phone</strong>.
              </li>
              <li>
                Tap <strong>Install</strong> / <strong>Add</strong> on the confirmation sheet.
              </li>
              <li>
                Leave the browser and open the <strong>Schoolie</strong> bus icon from your home
                screen or app tray.
              </li>
            </ol>
            <button
              type="button"
              className="btn btn-primary installer-cta"
              disabled={busy}
              onClick={() => void tryInstall()}
            >
              {busy ? 'Trying…' : 'Try automatic install again'}
            </button>
          </div>
        )}

        {status && <p className="installer-status">{status}</p>}

        <div className="installer-checks">
          <h3>Checklist if the icon is missing</h3>
          <ul>
            <li>You used Chrome, not an in-app browser</li>
            <li>You chose Install / Add — not “Bookmark”</li>
            <li>Look in the app tray for “Schoolie”, not only the home screen</li>
            <li>Open the new icon once so Android finishes installing it</li>
          </ul>
        </div>

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
  if (isStandaloneApp()) return false
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
  return isAndroid()
}

export function rememberSkipInstaller(): void {
  try {
    localStorage.setItem('schoolie-skip-installer', '1')
  } catch {
    /* ignore */
  }
}
