/**
 * Full-page Android installer — downloads a real APK so Android installs
 * Schoolie like any normal app (not a browser bookmark).
 *
 * Primary source: GitHub Releases (no PC required).
 * LAN source: same-origin /downloads/schoolie.apk when served from the PC.
 */
import { useEffect, useRef, useState } from 'react'
import {
  GITHUB_APK_LATEST,
  GITHUB_PAGES_BASE,
  GITHUB_RELEASES_PAGE,
  GITHUB_REPO_URL,
} from './githubConfig'
import { isAndroid, isNativeCapacitorApp, isStandaloneApp } from './installApp'
import { formatVersionLabel } from './version'

type Props = {
  onContinueInBrowser: () => void
}

const CHUNK_SIZE = 1024 * 1024 // 1 MB
const CHUNK_RETRIES = 6
const CHUNK_TIMEOUT_MS = 45_000

function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) {
    return true
  }
  // RFC1918
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(h)) return true
  // Tailscale / CGNAT common ranges used in this project
  if (/^100\.\d+\.\d+\.\d+$/.test(h)) return true
  return false
}

function isLanInstallerHost(): boolean {
  try {
    const { hostname, port } = window.location
    if (port === '4190' || port === '4193') return true
    return isPrivateOrLocalHost(hostname)
  } catch {
    return false
  }
}

/**
 * Where to get the APK:
 * - On your PC install server → local /downloads/schoolie.apk (HTTP preferred)
 * - Everywhere else (GitHub Pages, etc.) → GitHub Releases latest
 */
function apkDownloadUrl(): string {
  try {
    const { protocol, hostname, port } = window.location
    if (isLanInstallerHost()) {
      if (protocol === 'https:' || port === '4193') {
        return `http://${hostname || '127.0.0.1'}:4190/downloads/schoolie.apk`
      }
      const p = port ? `:${port}` : ''
      return `${protocol}//${hostname}${p}/downloads/schoolie.apk`
    }
  } catch {
    /* ignore */
  }
  return GITHUB_APK_LATEST
}

function updateServerBase(): string {
  // Always default OTA to GitHub so the installed app does not stay stuck on a LAN PC
  return GITHUB_PAGES_BASE
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function formatMb(n: number) {
  return (n / 1024 / 1024).toFixed(1)
}

function isGitHubApkUrl(url: string): boolean {
  return /github\.com|githubusercontent\.com/i.test(url)
}

/** Start a normal browser download (best for GitHub Releases — no CORS issues). */
function startBrowserDownload(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = 'schoolie.apk'
  a.rel = 'noopener'
  a.target = '_blank'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Download APK in 1MB Range chunks with per-chunk timeout + retry.
 * Same-origin / LAN only — GitHub assets often block CORS fetch.
 */
async function downloadApkResumable(
  url: string,
  onProgress: (msg: string) => void,
): Promise<Blob> {
  let total = 0
  try {
    const head = await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
      mode: 'cors',
    })
    total = Number(head.headers.get('Content-Length') || 0)
  } catch {
    /* continue without size */
  }

  if (!total) {
    try {
      const probe = await fetch(url, {
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
        mode: 'cors',
      })
      const cr = probe.headers.get('Content-Range')
      const m = cr?.match(/\/(\d+)$/)
      if (m) total = Number(m[1])
      await probe.arrayBuffer()
    } catch {
      /* fall through */
    }
  }

  if (!total || total < CHUNK_SIZE) {
    onProgress('Downloading… (single stream)')
    return downloadApkSingleStream(url, onProgress)
  }

  const parts: ArrayBuffer[] = []
  let offset = 0
  let lastPct = -1

  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE - 1, total - 1)
    let lastErr: unknown

    for (let attempt = 1; attempt <= CHUNK_RETRIES; attempt++) {
      try {
        const controller = new AbortController()
        const timer = window.setTimeout(() => controller.abort(), CHUNK_TIMEOUT_MS)
        const res = await fetch(url, {
          headers: { Range: `bytes=${offset}-${end}` },
          cache: 'no-store',
          mode: 'cors',
          signal: controller.signal,
        })
        window.clearTimeout(timer)

        if (res.status === 200) {
          const full = await res.arrayBuffer()
          if (full.byteLength >= total * 0.9) {
            onProgress(`Downloading… 100% (${formatMb(full.byteLength)} MB)`)
            return new Blob([full], { type: 'application/vnd.android.package-archive' })
          }
          if (full.byteLength === end - offset + 1) {
            parts.push(full)
            offset += full.byteLength
            lastErr = null
            break
          }
          throw new Error(`Unexpected full response (${full.byteLength} bytes)`)
        }

        if (res.status !== 206) {
          throw new Error(`HTTP ${res.status}`)
        }

        const buf = await res.arrayBuffer()
        if (buf.byteLength === 0) throw new Error('Empty chunk')

        parts.push(buf)
        offset += buf.byteLength
        lastErr = null

        const pct = Math.min(99, Math.round((offset / total) * 100))
        if (pct !== lastPct) {
          lastPct = pct
          onProgress(`Downloading… ${pct}% (${formatMb(offset)} / ${formatMb(total)} MB)`)
        }
        break
      } catch (e) {
        lastErr = e
        const label = e instanceof Error ? e.message : 'network error'
        onProgress(
          `Paused at ${formatMb(offset)} MB — retry ${attempt}/${CHUNK_RETRIES} (${label})…`,
        )
        await sleep(400 * attempt)
      }
    }

    if (lastErr != null) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error('Chunk download failed after retries')
    }
  }

  onProgress(`Saving APK… (${formatMb(total)} MB)`)
  return new Blob(parts, { type: 'application/vnd.android.package-archive' })
}

async function downloadApkSingleStream(
  url: string,
  onProgress: (msg: string) => void,
): Promise<Blob> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 5 * 60_000)
  try {
    const res = await fetch(url, { cache: 'no-store', mode: 'cors', signal: controller.signal })
    if (!res.ok) throw new Error(`Download failed (${res.status})`)
    const total = Number(res.headers.get('Content-Length') || 0)
    const reader = res.body?.getReader()
    if (!reader) {
      return await res.blob()
    }
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.length
        if (total > 0) {
          const pct = Math.min(99, Math.round((received / total) * 100))
          onProgress(`Downloading… ${pct}% (${formatMb(received)} MB)`)
        } else {
          onProgress(`Downloading… ${formatMb(received)} MB`)
        }
      }
    }
    return new Blob(chunks as BlobPart[], {
      type: 'application/vnd.android.package-archive',
    })
  } finally {
    window.clearTimeout(timer)
  }
}

function saveBlobAsApk(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = 'schoolie.apk'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000)
}

export function AndroidInstaller(props: Props) {
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<string | null>('Preparing automatic download…')
  const [error, setError] = useState<string | null>(null)
  const fromGitHub = !isLanInstallerHost()
  const autoStarted = useRef(false)

  async function downloadApk() {
    setDownloading(true)
    setError(null)
    setProgress(fromGitHub ? 'Auto-starting download from GitHub…' : 'Starting reliable download…')

    // Remember update source so the installed app can OTA later
    try {
      localStorage.setItem('schoolie-update-server', updateServerBase())
    } catch {
      /* ignore */
    }

    const url = apkDownloadUrl()

    // GitHub Releases: use browser download (fetch is often CORS-blocked)
    if (isGitHubApkUrl(url) || fromGitHub) {
      try {
        startBrowserDownload(url)
        setProgress(
          'Download started automatically. When schoolie.apk finishes, open it and tap Install.',
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Download failed'
        setError(msg)
        try {
          window.location.href = url
        } catch {
          /* ignore */
        }
      } finally {
        setDownloading(false)
      }
      return
    }

    // LAN: resumable same-origin fetch
    try {
      const blob = await downloadApkResumable(url, setProgress)
      if (blob.size < 1_000_000) {
        throw new Error(`APK too small (${blob.size} bytes) — incomplete download`)
      }
      saveBlobAsApk(blob)
      setProgress(
        `Download complete (${formatMb(blob.size)} MB) — open schoolie.apk and tap Install.`,
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Download failed'
      setError(`${msg}. Trying GitHub…`)
      setProgress('Falling back to GitHub Releases download…')
      startBrowserDownload(GITHUB_APK_LATEST)
    } finally {
      setDownloading(false)
    }
  }

  // Auto-start APK download when this page opens on Android
  useEffect(() => {
    if (autoStarted.current) return
    autoStarted.current = true
    try {
      if (new URLSearchParams(window.location.search).get('nodl') === '1') {
        setProgress('Auto-download paused (?nodl=1). Tap the button to download.')
        return
      }
    } catch {
      /* ignore */
    }
    const t = window.setTimeout(() => {
      void downloadApk()
    }, 450)
    return () => window.clearTimeout(t)
    // one-shot on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          On Android this page <strong>starts the APK download automatically</strong>. When it
          finishes, open <strong>schoolie.apk</strong> and tap Install (Android always asks once —
          that can&apos;t be skipped for security).
        </p>

        <button
          type="button"
          className="btn btn-primary installer-cta"
          disabled={downloading}
          onClick={() => void downloadApk()}
        >
          {downloading ? 'Downloading…' : 'Download again'}
        </button>
        {progress && <p className="installer-status">{progress}</p>}
        {error && <p className="installer-status">{error}</p>}

        <p className="muted" style={{ marginTop: 12, fontSize: '0.9rem', wordBreak: 'break-all' }}>
          Direct link:{' '}
          <a href={GITHUB_APK_LATEST} download="schoolie.apk" rel="noopener">
            schoolie.apk
          </a>
        </p>

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
            <li>
              <strong>Later updates:</strong> the installed app auto-downloads a small{' '}
              <code>web-update.zip</code> from GitHub, unpacks it, and restarts — no APK reinstall.
            </li>
          </ol>
        </div>

        <div className="installer-checks">
          <h3>Tips</h3>
          <ul>
            <li>
              First install = <strong>schoolie.apk</strong> (one time). Updates = automatic zip
              inside the app.
            </li>
            <li>
              Releases:{' '}
              <a href={GITHUB_RELEASES_PAGE} target="_blank" rel="noreferrer">
                GitHub Releases
              </a>
            </li>
            <li>Stay on Wi‑Fi until the APK finishes (about 60 MB)</li>
            <li>If install is blocked: Settings → Apps → Special access → Install unknown apps</li>
            <li>
              Source:{' '}
              <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                {GITHUB_REPO_URL.replace('https://', '')}
              </a>
            </li>
          </ul>
        </div>

        <a className="installer-apk-link" href={GITHUB_APK_LATEST} download="schoolie.apk">
          Download schoolie.apk (GitHub)
        </a>
        {isLanInstallerHost() && (
          <a
            className="installer-apk-link"
            href={apkDownloadUrl()}
            download="schoolie.apk"
            style={{ display: 'block', marginTop: 8 }}
          >
            Local PC APK (LAN server)
          </a>
        )}

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
