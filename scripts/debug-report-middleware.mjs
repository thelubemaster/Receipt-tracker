/**
 * Shared connect middleware for Vite dev + preview.
 * Saves bad-scan reports under debug-scans/ so the coding agent can inspect them.
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'debug-scans')

function ensureOut() {
  mkdirSync(OUT, { recursive: true })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function extFromMime(mime) {
  if (mime?.includes('png')) return 'png'
  if (mime?.includes('webp')) return 'webp'
  return 'jpg'
}

function listReports() {
  ensureOut()
  if (!existsSync(OUT)) return []
  const ids = readdirSync(OUT).filter((name) => {
    try {
      return statSync(join(OUT, name)).isDirectory()
    } catch {
      return false
    }
  })

  const reports = []
  for (const id of ids) {
    const metaPath = join(OUT, id, 'meta.json')
    if (!existsSync(metaPath)) continue
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      reports.push({
        id,
        createdAt: meta.createdAt ?? '',
        userNote: meta.userNote ?? '',
        amount: meta.suggestion?.amount ?? null,
        vendor: meta.suggestion?.vendor ?? '',
        aisUsed: meta.suggestion?.aisUsed ?? [],
        hasReceipt: existsSync(join(OUT, id, `receipt.${extFromMime(meta.receiptMime)}`))
          || existsSync(join(OUT, id, 'receipt.jpg'))
          || existsSync(join(OUT, id, 'receipt.png')),
        appVersion: meta.appVersion ?? '',
      })
    } catch {
      /* skip */
    }
  }
  reports.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return reports
}

function sendJson(res, status, obj) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.end(JSON.stringify(obj))
}

export function attachDebugReportMiddleware(middlewares) {
  middlewares.use(async (req, res, next) => {
    const url = req.url?.split('?')[0] || ''

    if (req.method === 'OPTIONS' && url.startsWith('/api/debug')) {
      res.statusCode = 204
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.end()
      return
    }

    if (req.method === 'POST' && url === '/api/debug-report') {
      try {
        const raw = await readBody(req)
        const body = JSON.parse(raw.toString('utf-8'))
        const id = String(body.id || `report_${Date.now()}`).replace(/[^\w\-]+/g, '_')
        const dir = join(OUT, id)
        mkdirSync(dir, { recursive: true })

        const dataUrl = String(body.receiptDataUrl || '')
        const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
        let receiptFile = null
        if (mimeMatch) {
          const mime = mimeMatch[1]
          const b64 = mimeMatch[2]
          const ext = extFromMime(mime)
          receiptFile = `receipt.${ext}`
          writeFileSync(join(dir, receiptFile), Buffer.from(b64, 'base64'))
        }

        const meta = {
          id,
          createdAt: body.createdAt || new Date().toISOString(),
          appVersion: body.appVersion || '',
          userNote: body.userNote || '',
          suggestion: body.suggestion || {},
          formSnapshot: body.formSnapshot || null,
          receiptMime: mimeMatch?.[1] || body.receiptMime || '',
          receiptFile,
          savedAt: new Date().toISOString(),
        }
        writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))

        if (body.suggestion?.rawText) {
          writeFileSync(join(dir, 'ocr.txt'), String(body.suggestion.rawText))
        }
        if (body.suggestion?.agentReport) {
          writeFileSync(join(dir, 'agent-report.txt'), String(body.suggestion.agentReport))
        }
        writeFileSync(
          join(dir, 'suggestion.json'),
          JSON.stringify(body.suggestion || {}, null, 2),
        )
        if (body.formSnapshot) {
          writeFileSync(join(dir, 'form-snapshot.json'), JSON.stringify(body.formSnapshot, null, 2))
        }

        // Index for quick listing
        ensureOut()
        writeFileSync(join(OUT, 'LATEST.txt'), `${id}\n${meta.createdAt}\n${meta.userNote}\n`)

        sendJson(res, 200, {
          ok: true,
          id,
          path: `debug-scans/${id}`,
          receiptFile,
        })
      } catch (e) {
        sendJson(res, 400, {
          ok: false,
          error: e instanceof Error ? e.message : 'Failed to save report',
        })
      }
      return
    }

    if (req.method === 'GET' && url === '/api/debug-reports') {
      sendJson(res, 200, { reports: listReports() })
      return
    }

    const one = url.match(/^\/api\/debug-reports\/([^/]+)\/?$/)
    if (req.method === 'GET' && one) {
      const id = decodeURIComponent(one[1])
      const metaPath = join(OUT, id, 'meta.json')
      if (!existsSync(metaPath)) {
        sendJson(res, 404, { error: 'not found' })
        return
      }
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
        sendJson(res, 200, meta)
      } catch (e) {
        sendJson(res, 500, { error: e instanceof Error ? e.message : 'read failed' })
      }
      return
    }

    const receipt = url.match(/^\/api\/debug-reports\/([^/]+)\/receipt\/?$/)
    if (req.method === 'GET' && receipt) {
      const id = decodeURIComponent(receipt[1])
      const dir = join(OUT, id)
      for (const name of ['receipt.jpg', 'receipt.jpeg', 'receipt.png', 'receipt.webp']) {
        const p = join(dir, name)
        if (existsSync(p)) {
          const buf = readFileSync(p)
          res.statusCode = 200
          res.setHeader('Content-Type', name.endsWith('png') ? 'image/png' : name.endsWith('webp') ? 'image/webp' : 'image/jpeg')
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.end(buf)
          return
        }
      }
      sendJson(res, 404, { error: 'no receipt' })
      return
    }

    next()
  })
}
