/**
 * Full-page Android installer — downloads a real APK so Android installs
 * Schoolie like any normal app (not a browser bookmark).
 *
 * Uses resumable Range chunks (with retries) so a 60MB APK does not sit
 * forever in Chrome’s flaky background downloader.
 */
import { useState } from 'react'
import { isAndroid, isNativeCapacitorApp, isStandaloneApp } from './installApp'
import { formatVersionLabel } from './version'

type Props = {
  onContinueInBrowser: () => void
}

const CHUNK_SIZE = 1024 * 1024 // 1 MB — small enough to survive Wi‑Fi blips
const CHUNK_RETRIES = 6
const CHUNK_TIMEOUT_MS = 45_000

/** Prefer plain HTTP for APK (self-signed HTTPS often stalls Android downloads). */
function apkDownloadUrl(): string {
  try {
    const { protocol, hostname, port } = window.location
    // If user is on HTTPS :4193, point download at HTTP :4190
    if (protocol === 'https:' || port === '4193') {
      const host = hostname || '127.0.0.1'
      return `http://${host}:4190/downloads/schoolie.apk`
    }
    // Absolute URL avoids service-worker / relative-path quirks on some phones
    if (hostname) {
      const p = port ? `:${port}` : ''
      return `${protocol}//${hostname}${p}/downloads/schoolie.apk`
    }
  } catch {
    /* ignore */
  }
  return './downloads/schoolie.apk'
}

function updateServerBase(): string {
  try {
    const { hostname } = window.location
    return `http://${hostname || '127.0.0.1'}:4190`
  } catch {
    return ''
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function formatMb(n: number) {
  return (n / 1024 / 1024).toFixed(1)
}

/**
 * Download APK in 1MB Range chunks with per-chunk timeout + retry.
 * Survives the pauses that kill a single long Chrome download.
 */
async function downloadApkResumable(
  url: string,
  onProgress: (msg: string) => void,
): Promise<Blob> {
  // Size probe
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

  // If HEAD failed or no length, try a single ranged probe
  if (!total) {
    try {
      const probe = await fetch(url, {
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
        mode: 'cors',
      })
      const cr = probe.headers.get('Content-Range') // bytes 0-0/SIZE
      const m = cr?.match(/\/(\d+)$/)
      if (m) total = Number(m[1])
      // drain body
      await probe.arrayBuffer()
    } catch {
      /* fall through to single-stream */
    }
  }

  // No size → one stream with timeout watchdog (still better than browser DL mgr)
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

        // Server sent whole file (ignored Range) — accept and finish
        if (res.status === 200) {
          const full = await res.arrayBuffer()
          if (full.byteLength >= total * 0.9) {
            onProgress(`Downloading… 100% (${formatMb(full.byteLength)} MB)`)
            return new Blob([full], { type: 'application/vnd.android.package-archive' })
          }
          // Partial 200 is weird — treat as this chunk if size matches
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
  // 5 min hard cap for whole file
  const timer = window.setTimeout(() => controller.abort(), 5 * 60_000)
  try {
    const res = await fetch(url, { cache: 'no-store', mode: 'cors', signal: controller.signal })
    if (!res.ok) throw new Error(`Download failed (${res.status})`)
    const total = Number(res.headers.get('Content-Length') || 0)
    const reader = res.body?.getReader()
    if (!reader) {
      const blob = await res.blob()
      return blob
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
  // Keep URL alive long enough for the system download to start
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000)
}

export function AndroidInstaller(props: Props) {
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function downloadApk() {
    setDownloading(true)
    setError(null)
    setProgress('Starting reliable download…')
    // Remember this server so the installed app can OTA-update later
    try {
      const base = updateServerBase() || `${window.location.protocol}//${window.location.host}`
      localStorage.setItem('schoolie-update-server', base)
    } catch {
      /* ignore */
    }

    const url = apkDownloadUrl()
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
      setError(`${msg}. Opening direct link as fallback…`)
      setProgress('If the bar still stalls, use the direct APK link below, or try again on Wi‑Fi.')
      // Top-level navigation often works when fetch is blocked (mixed content / SW)
      try {
        window.location.href = url
      } catch {
        /* ignore */
      }
    } finally {
      setDownloading(false)
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
          onClick={() => void downloadApk()}
        >
          {downloading ? 'Downloading…' : 'Download & install app'}
        </button>
        {progress && <p className="installer-status">{progress}</p>}
        {error && <p className="installer-status">{error}</p>}

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
          <h3>Tips if download pauses</h3>
          <ul>
            <li>
              Use <strong>http://</strong>
              {typeof window !== 'undefined' ? window.location.hostname : 'YOUR-PC-IP'}
              :4190/ — not https
            </li>
            <li>
              Tap the blue button (resumable chunks). Do not rely on a stuck Chrome download
              notification — cancel it and retry here
            </li>
            <li>Keep the phone awake and on Wi‑Fi until you see “Download complete”</li>
            <li>If install is blocked: Settings → Apps → Special access → Install unknown apps</li>
            <li>
              Later updates: PC runs <code>npm run start:android</code>, then app Settings → Check for
              updates
            </li>
          </ul>
        </div>

        <a className="installer-apk-link" href={apkDownloadUrl()} download="schoolie.apk">
          Direct APK link (browser download manager)
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
