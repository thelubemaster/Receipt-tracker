/**
 * Free internet lookup proxy (no API keys).
 * Uses DuckDuckGo Instant Answer + Wikipedia OpenSearch from the server
 * so the phone app can enrich receipt SKUs without CORS/API keys.
 */
import { URL } from 'node:url'

function sendJson(res, status, obj) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(obj))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function fetchText(url, timeoutMs = 8000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'SchoolieTracker/1.0 (free receipt lookup; local personal use)',
        Accept: 'application/json, text/html;q=0.9,*/*;q=0.8',
      },
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text }
  } finally {
    clearTimeout(t)
  }
}

async function duckDuckGoInstant(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  const { ok, text } = await fetchText(url)
  if (!ok) return { source: 'duckduckgo', snippets: [], title: '' }
  try {
    const data = JSON.parse(text)
    const snippets = []
    if (data.Heading) snippets.push(String(data.Heading))
    if (data.AbstractText) snippets.push(String(data.AbstractText))
    if (Array.isArray(data.RelatedTopics)) {
      for (const t of data.RelatedTopics.slice(0, 5)) {
        if (t?.Text) snippets.push(String(t.Text))
        if (Array.isArray(t?.Topics)) {
          for (const st of t.Topics.slice(0, 3)) {
            if (st?.Text) snippets.push(String(st.Text))
          }
        }
      }
    }
    if (data.Answer) snippets.push(String(data.Answer))
    return {
      source: 'duckduckgo',
      title: data.Heading || '',
      url: data.AbstractURL || '',
      snippets: snippets.filter(Boolean).slice(0, 8),
    }
  } catch {
    return { source: 'duckduckgo', snippets: [], title: '' }
  }
}

async function wikipediaSearch(query) {
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=4&namespace=0&format=json`
  const { ok, text } = await fetchText(url)
  if (!ok) return { source: 'wikipedia', snippets: [], title: '' }
  try {
    const data = JSON.parse(text)
    // [query, titles[], descriptions[], urls[]]
    const titles = data[1] || []
    const descs = data[2] || []
    const urls = data[3] || []
    const snippets = titles.map((t, i) => `${t}: ${descs[i] || ''}`.trim())
    return {
      source: 'wikipedia',
      title: titles[0] || '',
      url: urls[0] || '',
      snippets: snippets.filter(Boolean).slice(0, 6),
    }
  } catch {
    return { source: 'wikipedia', snippets: [], title: '' }
  }
}

/** Lightweight HTML scrape of DDG lite results for product SKUs. */
async function duckDuckGoHtml(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const { ok, text } = await fetchText(url, 10000)
  if (!ok || !text) return { source: 'duckduckgo-html', snippets: [], title: '' }
  const snippets = []
  // result__a and result__snippet classes (best-effort)
  const titleRe = /class="result__a"[^>]*>([^<]+)</gi
  const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = titleRe.exec(text)) && snippets.length < 6) {
    const t = m[1].replace(/\s+/g, ' ').trim()
    if (t) snippets.push(t)
  }
  while ((m = snipRe.exec(text)) && snippets.length < 10) {
    const t = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (t.length > 20) snippets.push(t.slice(0, 220))
  }
  return {
    source: 'duckduckgo-html',
    title: snippets[0] || '',
    url: '',
    snippets: snippets.slice(0, 8),
  }
}

async function lookupQuery(query) {
  const q = String(query || '').trim().slice(0, 160)
  if (q.length < 2) {
    return { ok: false, error: 'empty query', results: [] }
  }

  const results = []
  try {
    const ddg = await duckDuckGoInstant(q)
    if (ddg.snippets.length) results.push(ddg)
  } catch {
    /* continue */
  }
  try {
    const wiki = await wikipediaSearch(q)
    if (wiki.snippets.length) results.push(wiki)
  } catch {
    /* continue */
  }
  // HTML fallback when instant answer is thin (common for product SKUs)
  const hasMeat = results.some((r) => r.snippets.join(' ').length > 40)
  if (!hasMeat) {
    try {
      const html = await duckDuckGoHtml(q)
      if (html.snippets.length) results.push(html)
    } catch {
      /* continue */
    }
  }

  const combined = results.flatMap((r) => r.snippets).filter(Boolean)
  return {
    ok: true,
    query: q,
    results,
    summary: combined.slice(0, 6).join(' · ').slice(0, 600),
  }
}

export function attachWebLookupMiddleware(middlewares) {
  middlewares.use(async (req, res, next) => {
    const rawUrl = req.url || ''
    const path = rawUrl.split('?')[0]

    if (req.method === 'OPTIONS' && path.startsWith('/api/web-lookup')) {
      res.statusCode = 204
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.end()
      return
    }

    if (req.method === 'GET' && path === '/api/web-lookup') {
      try {
        const u = new URL(rawUrl, 'http://localhost')
        const q = u.searchParams.get('q') || ''
        const data = await lookupQuery(q)
        sendJson(res, 200, data)
      } catch (e) {
        sendJson(res, 500, {
          ok: false,
          error: e instanceof Error ? e.message : 'lookup failed',
        })
      }
      return
    }

    if (req.method === 'POST' && path === '/api/web-lookup') {
      try {
        const raw = await readBody(req)
        const body = JSON.parse(raw.toString('utf-8') || '{}')
        const queries = Array.isArray(body.queries)
          ? body.queries.map(String).slice(0, 6)
          : body.q
            ? [String(body.q)]
            : []
        const out = []
        for (const q of queries) {
          out.push(await lookupQuery(q))
        }
        sendJson(res, 200, { ok: true, lookups: out })
      } catch (e) {
        sendJson(res, 500, {
          ok: false,
          error: e instanceof Error ? e.message : 'lookup failed',
        })
      }
      return
    }

    next()
  })
}
