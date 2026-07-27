import { registerSW } from 'virtual:pwa-register'

export type UpdateHandlers = {
  onNeedRefresh: (update: () => void) => void
  onOfflineReady?: () => void
}

/** Register service worker; call onNeedRefresh when a new build is waiting. */
export function setupPwaUpdates(handlers: UpdateHandlers): void {
  if (!('serviceWorker' in navigator)) return

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      handlers.onNeedRefresh(() => {
        void updateSW(true)
      })
    },
    onOfflineReady() {
      handlers.onOfflineReady?.()
    },
  })
}
