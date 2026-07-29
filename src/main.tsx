import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { setupInstallCapture } from './installApp'
import { autoUpdateIfAvailable, notifyNativeAppReady } from './appUpdate'
import './index.css'

// Capture Chrome/Android install prompt before React mounts
setupInstallCapture()

/** Keep status bar from covering the app chrome (Android APK). */
async function setupNativeChrome() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    // Push web content below the system status bar instead of drawing under it
    await StatusBar.setOverlaysWebView({ overlay: false })
    await StatusBar.setBackgroundColor({ color: '#0c0e13' })
    await StatusBar.setStyle({ style: Style.Dark })
  } catch {
    /* browser / plugin missing */
  }
}

// Native APK: status bar + Capgo ready + silent OTA
void (async () => {
  await setupNativeChrome()
  await notifyNativeAppReady()
  // Small delay so the UI mounts first
  setTimeout(() => {
    void autoUpdateIfAvailable()
  }, 2500)
})()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
