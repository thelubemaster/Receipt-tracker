/**
 * Device capability scan — can this phone run free on-device AIs?
 */

export type CapLevel = 'pass' | 'warn' | 'fail'

export type CapabilityCheck = {
  id: string
  name: string
  level: CapLevel
  detail: string
}

export type DeviceProbeResult = {
  checkedAt: string
  score: number
  maxScore: number
  grade: 'excellent' | 'good' | 'limited' | 'poor'
  summary: string
  checks: CapabilityCheck[]
  canRunOnDeviceAi: boolean
  canRunCloudAi: boolean
  recommended: string[]
}

function check(id: string, name: string, level: CapLevel, detail: string): CapabilityCheck {
  return { id, name, level, detail }
}

export async function probeDevice(): Promise<DeviceProbeResult> {
  const checks: CapabilityCheck[] = []

  // WebAssembly (Tesseract)
  const hasWasm = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function'
  checks.push(
    check(
      'wasm',
      'WebAssembly',
      hasWasm ? 'pass' : 'fail',
      hasWasm ? 'Available — Scout/Forge OCR can run' : 'Missing — free on-device OCR cannot run',
    ),
  )

  // Workers
  const hasWorkers = typeof Worker !== 'undefined'
  checks.push(
    check(
      'workers',
      'Web Workers',
      hasWorkers ? 'pass' : 'warn',
      hasWorkers ? 'Available — OCR won’t freeze the UI' : 'Missing — OCR may freeze the page',
    ),
  )

  // Canvas
  let hasCanvas = false
  try {
    const c = document.createElement('canvas')
    hasCanvas = Boolean(c.getContext('2d'))
  } catch {
    hasCanvas = false
  }
  checks.push(
    check(
      'canvas',
      'Canvas 2D',
      hasCanvas ? 'pass' : 'fail',
      hasCanvas ? 'Available — image prep works' : 'Missing — cannot preprocess receipts',
    ),
  )

  // IndexedDB
  const hasIdb = typeof indexedDB !== 'undefined'
  checks.push(
    check(
      'idb',
      'IndexedDB',
      hasIdb ? 'pass' : 'fail',
      hasIdb ? 'Available — purchases & photos can be stored' : 'Missing — data may not persist',
    ),
  )

  // Camera / media
  const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  checks.push(
    check(
      'camera',
      'Camera access API',
      hasMedia ? 'pass' : 'warn',
      hasMedia
        ? 'Available — you can take receipt photos'
        : 'Limited — gallery pick may still work',
    ),
  )

  // CPU cores
  const cores = navigator.hardwareConcurrency || 0
  checks.push(
    check(
      'cpu',
      'CPU cores',
      cores >= 4 ? 'pass' : cores >= 2 ? 'warn' : 'warn',
      cores
        ? `${cores} logical cores — ${cores >= 4 ? 'good for Forge' : 'Forge may be slower'}`
        : 'Unknown core count',
    ),
  )

  // Memory (Chrome/Android often expose this)
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (typeof mem === 'number') {
    checks.push(
      check(
        'ram',
        'Device memory',
        mem >= 4 ? 'pass' : mem >= 2 ? 'warn' : 'warn',
        `~${mem} GB reported — ${mem >= 4 ? 'comfortable for multi-pass OCR' : 'use Scout if Forge is slow'}`,
      ),
    )
  } else {
    checks.push(check('ram', 'Device memory', 'warn', 'Not reported by this browser'))
  }

  // Network
  const online = navigator.onLine
  checks.push(
    check(
      'network',
      'Network',
      online ? 'pass' : 'warn',
      online
        ? 'Online — free Gemini (and optional paid cloud) can run'
        : 'Offline — only free on-device AIs will work',
    ),
  )

  // Connection quality
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } })
    .connection
  if (conn?.effectiveType) {
    const et = conn.effectiveType
    const ok = et === '4g' || et === '3g'
    checks.push(
      check(
        'net-quality',
        'Connection quality',
        ok ? 'pass' : 'warn',
        `${et}${conn.saveData ? ' · data-saver on' : ''} — cloud free-tier may ${ok ? 'be fine' : 'be slow'}`,
      ),
    )
  }

  // Storage estimate
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate()
      const quotaMb = Math.round((est.quota || 0) / (1024 * 1024))
      const usageMb = Math.round((est.usage || 0) / (1024 * 1024))
      checks.push(
        check(
          'storage',
          'Browser storage',
          quotaMb >= 50 ? 'pass' : 'warn',
          `~${usageMb} MB used of ~${quotaMb} MB quota`,
        ),
      )
    }
  } catch {
    checks.push(check('storage', 'Browser storage', 'warn', 'Could not estimate storage'))
  }

  // Secure context (camera / SW)
  checks.push(
    check(
      'secure',
      'Secure context (HTTPS)',
      window.isSecureContext ? 'pass' : 'warn',
      window.isSecureContext
        ? 'Secure — camera & install work best'
        : 'Not secure — some phone features may be blocked',
    ),
  )

  // Service worker
  checks.push(
    check(
      'sw',
      'Service Worker',
      'serviceWorker' in navigator ? 'pass' : 'warn',
      'serviceWorker' in navigator
        ? 'Available — install / offline shell supported'
        : 'Missing — limited offline install',
    ),
  )

  // Score
  let score = 0
  let maxScore = 0
  for (const c of checks) {
    maxScore += 2
    if (c.level === 'pass') score += 2
    else if (c.level === 'warn') score += 1
  }

  const canRunOnDeviceAi = hasWasm && hasCanvas
  const canRunCloudAi = online
  const pct = maxScore ? score / maxScore : 0
  const grade =
    pct >= 0.85 ? 'excellent' : pct >= 0.65 ? 'good' : pct >= 0.45 ? 'limited' : 'poor'

  const recommended: string[] = []
  if (canRunOnDeviceAi) {
    recommended.push('Scout (free)')
    if (cores >= 2 && hasWorkers) recommended.push('Forge high-power OCR (free)')
    recommended.push('Ledger · Cashier · Clerk · Arbiter (free)')
  }
  if (canRunCloudAi) recommended.push('Gemini free-tier (needs free Google AI Studio key)')

  const summary = canRunOnDeviceAi
    ? `Device looks ${grade} for free on-device AIs.${canRunCloudAi ? ' Cloud free-tier also possible.' : ' Offline — cloud skipped.'}`
    : 'This device may struggle with free on-device OCR (missing WASM/canvas).'

  return {
    checkedAt: new Date().toISOString(),
    score,
    maxScore,
    grade,
    summary,
    checks,
    canRunOnDeviceAi,
    canRunCloudAi,
    recommended,
  }
}
