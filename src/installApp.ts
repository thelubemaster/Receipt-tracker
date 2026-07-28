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

/** Already launched as installed app (full screen, no browser chrome) */
export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false
  const mq = window.matchMedia('(display-mode: standalone)').matches
  const ios = 'standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone
  const twa = document.referrer.includes('android-app://')
  return Boolean(mq || ios || twa || window.schoolieDesktop?.isDesktop)
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
