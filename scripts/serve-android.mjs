#!/usr/bin/env node
/**
 * Android install + OTA server.
 * - HTTP :4190  primary (reliable APK downloads — no cert stalls)
 * - HTTPS :4193 optional (same files)
 * Supports Range / Content-Length so phone downloads don't pause forever.
 */
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createHttpServer } from 'node:http'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  createReadStream,
  openSync,
  readSync,
  closeSync,
} from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const CERT_DIR = join(ROOT, '.certs')
const KEY = join(CERT_DIR, 'key.pem')
const CERT = join(CERT_DIR, 'cert.pem')
const HTTP_PORT = Number(process.env.SCHOOLIE_PORT || 4190)
const HTTPS_PORT = Number(process.env.SCHOOLIE_HTTPS_PORT || 4193)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
  '.apk': 'application/vnd.android.package-archive',
  '.zip': 'application/zip',
}

function lanIps() {
  const ips = []
  const nets = networkInterfaces()
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address)
    }
  }
  return ips
}

function readAppVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    return String(pkg.version || '0.0.0')
  } catch {
    return '0.0.0'
  }
}

function ensureBuild() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.log('Building Schoolie…')
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' })
  }
  // Ensure APK is in dist for download
  const srcApk = join(ROOT, 'public/downloads/schoolie.apk')
  const dstApk = join(DIST, 'downloads/schoolie.apk')
  mkdirSync(join(DIST, 'downloads'), { recursive: true })
  if (existsSync(srcApk) && (!existsSync(dstApk) || statSync(srcApk).mtimeMs > statSync(dstApk).mtimeMs)) {
    execSync(`cp -f "${srcApk}" "${dstApk}"`)
  }
  const built = join(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk')
  if (existsSync(built)) {
    const need =
      !existsSync(dstApk) || statSync(built).size !== statSync(dstApk).size
    if (need) {
      execSync(`cp -f "${built}" "${dstApk}"`)
      execSync(`cp -f "${built}" "${srcApk}"`)
    }
  }
}

function ensureCert() {
  mkdirSync(CERT_DIR, { recursive: true })
  if (existsSync(KEY) && existsSync(CERT)) return
  console.log('Creating local HTTPS certificate…')
  const ips = lanIps()
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',')
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${KEY}" -out "${CERT}" -days 825 -nodes -subj "/CN=Schoolie" -addext "subjectAltName=${san}"`,
      { stdio: 'pipe' },
    )
  } catch {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${KEY}" -out "${CERT}" -days 825 -nodes -subj "/CN=Schoolie"`,
      { stdio: 'inherit' },
    )
  }
}

function ensureWebUpdateZip() {
  mkdirSync(join(DIST, 'downloads'), { recursive: true })
  try {
    execSync(
      `cd "${DIST}" && rm -f downloads/web-update.zip && zip -qr downloads/web-update.zip . -x "downloads/schoolie.apk" -x "downloads/web-update.zip"`,
      { stdio: 'pipe' },
    )
    console.log(`OTA bundle ready (v${readAppVersion()})`)
  } catch (e) {
    console.warn('zip failed:', e.message)
  }
}

function writeUpdateServerJson(baseUrl) {
  writeFileSync(
    join(DIST, 'update-server.json'),
    JSON.stringify(
      { baseUrl, version: readAppVersion(), updatedAt: new Date().toISOString() },
      null,
      2,
    ),
  )
}

function resolvePath(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0])
  if (p === '/') p = '/index.html'
  const full = join(DIST, p.replace(/^\//, ''))
  if (!full.startsWith(DIST)) return null
  if (existsSync(full) && statSync(full).isFile()) return full
  const index = join(DIST, 'index.html')
  return existsSync(index) ? index : null
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null
  const part = rangeHeader.replace(/bytes=/, '').split(',')[0].trim()
  const [startS, endS] = part.split('-')
  let start = startS === '' ? NaN : parseInt(startS, 10)
  let end = endS === '' || endS === undefined ? size - 1 : parseInt(endS, 10)
  if (Number.isNaN(start)) {
    // suffix: bytes=-500
    const suffix = parseInt(endS, 10)
    if (Number.isNaN(suffix)) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  }
  if (Number.isNaN(end) || end >= size) end = size - 1
  if (start < 0 || start > end || start >= size) return null
  return { start, end }
}

function pipeFile(stream, res, label) {
  // Prevent hung sockets when the phone pauses/cancels mid-download
  const onError = (err) => {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.warn(`stream error (${label}):`, err.message || err)
    }
    try {
      stream.destroy()
    } catch {
      /* ignore */
    }
    if (!res.writableEnded) {
      try {
        res.destroy()
      } catch {
        /* ignore */
      }
    }
  }
  stream.on('error', onError)
  res.on('error', onError)
  res.on('close', () => {
    if (!stream.destroyed) stream.destroy()
  })
  stream.pipe(res)
}

function sendFile(req, res, filePath) {
  const st = statSync(filePath)
  const size = st.size
  const type = MIME[extname(filePath)] || 'application/octet-stream'
  const isApk = filePath.endsWith('.apk')
  const isZip = filePath.endsWith('.zip')
  const noCache =
    filePath.endsWith('index.html') ||
    filePath.endsWith('sw.js') ||
    filePath.endsWith('web-update.zip') ||
    filePath.endsWith('version.json') ||
    filePath.endsWith('update-server.json') ||
    isApk

  const baseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Accept-Ranges': 'bytes',
    'Content-Type': type,
    'Cache-Control': noCache ? 'no-store, no-cache, must-revalidate' : 'public, max-age=3600',
    Connection: 'keep-alive',
    'Keep-Alive': 'timeout=300',
    // Avoid intermediaries trying to buffer/transform the APK
    'Content-Encoding': 'identity',
    'X-Accel-Buffering': 'no',
  }
  if (isApk) {
    baseHeaders['Content-Disposition'] = 'attachment; filename="schoolie.apk"'
    baseHeaders['X-Content-Type-Options'] = 'nosniff'
  }
  if (isZip) {
    baseHeaders['Content-Disposition'] = 'attachment; filename="web-update.zip"'
  }

  // HEAD with Range still returns full size (clients use Content-Length)
  if (req.method === 'HEAD') {
    res.writeHead(200, { ...baseHeaders, 'Content-Length': size })
    res.end()
    return
  }

  const range = parseRange(req.headers.range, size)
  if (range) {
    const { start, end } = range
    const chunk = end - start + 1
    if (isApk && chunk >= size) {
      console.log(`APK full via range from ${req.socket.remoteAddress || '?'}`)
    }
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': chunk,
    })
    // 64KB chunks stream more smoothly over flaky LAN than huge buffers
    const stream = createReadStream(filePath, {
      start,
      end,
      highWaterMark: 64 * 1024,
    })
    pipeFile(stream, res, `range ${start}-${end}`)
    return
  }

  if (isApk) {
    console.log(`APK full download from ${req.socket.remoteAddress || '?'}`)
  }
  res.writeHead(200, {
    ...baseHeaders,
    'Content-Length': size,
  })
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 })
  pipeFile(stream, res, 'full')
}

function handler(req, res) {
  try {
    const url = req.url || '/'
    const pathOnly = url.split('?')[0]

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range',
      })
      res.end()
      return
    }

    if (pathOnly === '/api/app-update') {
      const host = req.headers.host || `127.0.0.1:${HTTP_PORT}`
      // Prefer same scheme client used; default http for reliable OTA on LAN
      const proto = req.socket.encrypted ? 'https' : 'http'
      const base = `${proto}://${host}`
      const version = readAppVersion()
      const body = JSON.stringify({
        version,
        url: `${base}/downloads/web-update.zip`,
        notes: `Schoolie v${version} web update`,
      })
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(body)
      return
    }

    // Health
    if (pathOnly === '/api/health') {
      const apk = join(DIST, 'downloads/schoolie.apk')
      const body = JSON.stringify({
        ok: true,
        version: readAppVersion(),
        apk: existsSync(apk) ? statSync(apk).size : 0,
      })
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(body)
      return
    }

    const file = resolvePath(url)
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }
    sendFile(req, res, file)
  } catch (e) {
    console.error('request error', e)
    if (!res.headersSent) res.writeHead(500)
    res.end('Server error')
  }
}

ensureBuild()
ensureCert()
const ips = lanIps()
const primary = ips[0] || '127.0.0.1'
// Prefer HTTP base for downloads (more reliable on Android)
writeUpdateServerJson(`http://${primary}:${HTTP_PORT}`)
ensureWebUpdateZip()

const httpServer = createHttpServer({ keepAlive: true, keepAliveTimeout: 300000 }, handler)
httpServer.timeout = 0 // no request timeout for big APK
httpServer.headersTimeout = 0
httpServer.requestTimeout = 0
httpServer.keepAliveTimeout = 300000
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log('')
  console.log('==============================================')
  console.log('  Schoolie Android installer (stable download)')
  console.log('==============================================')
  for (const ip of ips.length ? ips : ['127.0.0.1']) {
    console.log(`  Phone Chrome →  http://${ip}:${HTTP_PORT}/`)
    console.log(`  Direct APK   →  http://${ip}:${HTTP_PORT}/downloads/schoolie.apk`)
  }
  const apk = join(DIST, 'downloads/schoolie.apk')
  if (existsSync(apk)) {
    const mb = (statSync(apk).size / (1024 * 1024)).toFixed(1)
    console.log(`  APK size: ${mb} MB (Range + Content-Length enabled)`)
  } else {
    console.log('  APK missing — run: npm run apk')
  }
  console.log('==============================================')
  console.log('')
})

// Optional HTTPS (same handler) — downloads work better on HTTP above
try {
  const opts = { key: readFileSync(KEY), cert: readFileSync(CERT) }
  const httpsServer = createHttpsServer(
    { ...opts, keepAlive: true, keepAliveTimeout: 300000 },
    handler,
  )
  httpsServer.timeout = 0
  httpsServer.headersTimeout = 0
  httpsServer.requestTimeout = 0
  httpsServer.keepAliveTimeout = 300000
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    for (const ip of ips.length ? ips : ['127.0.0.1']) {
      console.log(`  HTTPS (optional) → https://${ip}:${HTTPS_PORT}/`)
    }
  })
} catch (e) {
  console.warn('HTTPS not started:', e.message)
}
