#!/usr/bin/env node
/**
 * HTTPS static server for Android install.
 * Chrome only offers a reliable "Install app" prompt on secure origins.
 * Self-signed cert is fine for home Wi‑Fi (user taps Proceed once).
 */
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createHttpServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, statSync, createReadStream } from 'node:fs'
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

function resolvePath(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0])
  if (p === '/') p = '/index.html'
  // prevent path escape
  const full = join(DIST, p.replace(/^\//, ''))
  if (!full.startsWith(DIST)) return null
  if (existsSync(full) && statSync(full).isFile()) return full
  // SPA fallback
  const index = join(DIST, 'index.html')
  return existsSync(index) ? index : null
}

function handler(req, res) {
  const file = resolvePath(req.url || '/')
  if (!file) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const type = MIME[extname(file)] || 'application/octet-stream'
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': file.endsWith('index.html') || file.endsWith('sw.js')
      ? 'no-cache'
      : 'public, max-age=3600',
  })
  createReadStream(file).pipe(res)
}

ensureBuild()
ensureCert()

const opts = {
  key: readFileSync(KEY),
  cert: readFileSync(CERT),
}

const server = createHttpsServer(opts, handler)
server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIps()
  console.log('')
  console.log('==============================================')
  console.log('  Schoolie Android INSTALLER (HTTPS)')
  console.log('==============================================')
  for (const ip of ips.length ? ips : ['127.0.0.1']) {
    console.log(`  Phone Chrome →  https://${ip}:${PORT}/`)
  }
  console.log('')
  console.log('  1) Open the https:// link in Chrome')
  console.log('  2) Advanced → Proceed (one-time cert warning)')
  console.log('  3) Tap “Download & install app” (real APK)')
  console.log('  4) Allow install → Open Schoolie from app tray')
  const apk = join(DIST, 'downloads/schoolie.apk')
  console.log(existsSync(apk) ? '  APK: ready at /downloads/schoolie.apk' : '  APK missing — run npm run apk')
  console.log('==============================================')
  console.log('')
})

// Also keep plain HTTP on 4191 redirecting message (optional helper)
try {
  createHttpServer((req, res) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '')
    const ip = host || lanIps()[0] || '127.0.0.1'
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
      <body style="font-family:system-ui;background:#0c0e13;color:#f5f1ea;padding:2rem;line-height:1.5">
      <h1>Use HTTPS to install</h1>
      <p>Android Chrome installs Schoolie correctly only over HTTPS.</p>
      <p><a style="color:#f0c36a;font-size:1.2rem" href="https://${ip}:${PORT}/">Open installer → https://${ip}:${PORT}/</a></p>
      <p style="color:#9aa3b5">Accept the certificate warning once, then Install.</p>
      </body>`)
  }).listen(4191, '0.0.0.0')
} catch {
  /* ignore */
}
