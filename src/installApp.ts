/**
 * Android / mobile install helpers.
 * On Android, Schoolie becomes a real home-screen app via PWA install
 * (Chrome → Install app / Add to Home screen). No Electron on Android.
 */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

/** Call once at app start */
export function setupInstallCapture(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

export function subscribeInstallPrompt(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function hasNativeInstallPrompt(): boolean {
  return deferredPrompt != null
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable'
  const p = deferredPrompt
  deferredPrompt = null
  await p.prompt()
  const { outcome } = await p.userChoice
  notify()
  return outcome
}

/**
 * True when running inside the real Android/iOS package (Capacitor WebView),
 * not Chrome. Capacitor injects window.Capacitor.
 */
export function isNativeCapacitorApp(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (
    window as Window & {
      Capacitor?: {
        isNativePlatform?: () => boolean
        getPlatform?: () => string
      }
    }
  ).Capacitor
  if (cap) {
    try {
      if (typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) return true
    } catch {
      /* ignore */
    }
    try {
      const p = cap.getPlatform?.()
      if (p === 'android' || p === 'ios') return true
    } catch {
      /* ignore */
    }
  }
  // Android System WebView (APK) user-agent marker — "; wv)"
  if (/Android/i.test(navigator.userAgent) && /; wv\)/i.test(navigator.userAgent)) {
    return true
  }
  // Capacitor Android often loads from https://localhost
  try {
    const { protocol, hostname } = window.location
    if (
      hostname === 'localhost' &&
      (protocol === 'https:' || protocol === 'http:' || protocol === 'capacitor:')
    ) {
      // Only treat as native if not a normal desktop browser on localhost
      if (/Android|iPhone|iPad/i.test(navigator.userAgent)) return true
    }
  } catch {
    /* ignore */
  }
  return false
}

/** Already launched as installed app (APK, PWA, or desktop shell) */
export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false
  // Real Android APK / iOS package — never show the download installer
  if (isNativeCapacitorApp()) return true
  if (window.schoolieDesktop?.isDesktop) return true
  const mq = window.matchMedia('(display-mode: standalone)').matches
  const ios =
    'standalone' in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  const twa = document.referrer.includes('android-app://')
  return Boolean(mq || ios || twa)
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  return /android/i.test(navigator.userAgent)
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  return isAndroid() || isIos() || /mobile/i.test(navigator.userAgent)
}
