#!/usr/bin/env node
/**
 * HTTPS server for Android:
 * - Install page + schoolie.apk download
 * - OTA web updates: GET /api/app-update + /downloads/web-update.zip
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
  readdirSync,
} from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces } from 'node:os'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const CERT_DIR = join(ROOT, '.certs')
const KEY = join(CERT_DIR, 'key.pem')
const CERT = join(CERT_DIR, 'cert.pem')
const PORT = Number(process.env.SCHOOLIE_PORT || 4190)

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

function walkFiles(dir, base = dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name)
    if (name.isDirectory()) walkFiles(full, base, out)
    else out.push(full)
  }
  return out
}

/** Build web-update.zip for Capgo OTA (must contain index.html at zip root). */
function ensureWebUpdateZip() {
  mkdirSync(join(DIST, 'downloads'), { recursive: true })
  const zipPath = join(DIST, 'downloads', 'web-update.zip')
  const version = readAppVersion()
  // Prefer system zip for correct store paths Capgo expects
  try {
    // Exclude the APK and the zip itself from the OTA bundle
    execSync(
      `cd "${DIST}" && rm -f downloads/web-update.zip && zip -qr downloads/web-update.zip . -x "downloads/schoolie.apk" -x "downloads/web-update.zip"`,
      { stdio: 'pipe' },
    )
    console.log(`OTA bundle: downloads/web-update.zip (v${version})`)
    return
  } catch (e) {
    console.warn('zip CLI failed, OTA zip may be missing', e.message)
  }
}

function writeUpdateServerJson(baseUrl) {
  const payload = {
    baseUrl,
    version: readAppVersion(),
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(join(DIST, 'update-server.json'), JSON.stringify(payload, null, 2))
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

function handler(req, res) {
  const url = req.url || '/'
  const pathOnly = url.split('?')[0]

  // CORS so the installed app can call the update API over HTTPS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (pathOnly === '/api/app-update') {
    const host = req.headers.host || `127.0.0.1:${PORT}`
    const proto = 'https'
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
    })
    res.end(body)
    return
  }

  const file = resolvePath(url)
  if (!file) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const type = MIME[extname(file)] || 'application/octet-stream'
  const noCache =
    file.endsWith('index.html') ||
    file.endsWith('sw.js') ||
    file.endsWith('web-update.zip') ||
    file.endsWith('version.json') ||
    file.endsWith('update-server.json')
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600',
  })
  createReadStream(file).pipe(res)
}

ensureBuild()
ensureCert()
const ips = lanIps()
const primary = ips[0] || '127.0.0.1'
const baseUrl = `https://${primary}:${PORT}`
writeUpdateServerJson(baseUrl)
ensureWebUpdateZip()

const opts = {
  key: readFileSync(KEY),
  cert: readFileSync(CERT),
}

const server = createHttpsServer(opts, handler)
server.listen(PORT, '0.0.0.0', () => {
  console.log('')
  console.log('==============================================')
  console.log('  Schoolie Android (install + OTA updates)')
  console.log('==============================================')
  for (const ip of ips.length ? ips : ['127.0.0.1']) {
    console.log(`  Phone →  https://${ip}:${PORT}/`)
  }
  console.log('')
  console.log('  First install: open URL → Download APK → Install')
  console.log('  Later updates: open app → Settings → Check for updates')
  console.log('  (no re-download of the full APK for web/AI changes)')
  const apk = join(DIST, 'downloads/schoolie.apk')
  console.log(
    existsSync(apk) ? '  APK: /downloads/schoolie.apk' : '  APK missing — run npm run apk',
  )
  console.log(
    existsSync(join(DIST, 'downloads/web-update.zip'))
      ? '  OTA: /downloads/web-update.zip'
      : '  OTA zip missing',
  )
  console.log('==============================================')
  console.log('')
})

try {
  createHttpServer((req, res) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '')
    const ip = host || lanIps()[0] || '127.0.0.1'
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
      <body style="font-family:system-ui;background:#0c0e13;color:#f5f1ea;padding:2rem;line-height:1.5">
      <h1>Use HTTPS</h1>
      <p><a style="color:#f0c36a;font-size:1.2rem" href="https://${ip}:${PORT}/">Open Schoolie → https://${ip}:${PORT}/</a></p>
      </body>`)
  }).listen(4191, '0.0.0.0')
} catch {
  /* ignore */
}
