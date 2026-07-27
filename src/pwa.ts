import { registerSW } from 'virtual:pwa-register'

export type UpdateHandlers = {
  onNeedRefresh: (update: () => void) => void
  onOfflineReady?: () => void
}

type UpdateSW = (reloadPage?: boolean) => Promise<void>

let updateSWFn: UpdateSW | null = null
let needRefreshHandler: ((update: () => void) => void) | null = null

/** Register service worker; call onNeedRefresh when a new build is waiting. */
export function setupPwaUpdates(handlers: UpdateHandlers): void {
  if (!('serviceWorker' in navigator)) return

  needRefreshHandler = handlers.onNeedRefresh

  updateSWFn = registerSW({
    immediate: true,
    onNeedRefresh() {
      handlers.onNeedRefresh(() => {
        void updateSWFn?.(true)
      })
    },
    onOfflineReady() {
      handlers.onOfflineReady?.()
    },
  })
}

/** Apply a waiting service worker update (reload into new build). */
export function applyWaitingUpdate(): void {
  if (updateSWFn) {
    void updateSWFn(true)
    return
  }
  window.location.reload()
}

/** Notify UI if a waiting worker already exists (e.g. after manual check). */
export function notifyIfWaitingUpdate(): void {
  if (!needRefreshHandler) return
  void navigator.serviceWorker?.getRegistration().then((reg) => {
    if (reg?.waiting) {
      needRefreshHandler?.(() => applyWaitingUpdate())
    }
  })
}
