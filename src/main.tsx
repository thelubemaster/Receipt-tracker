import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { setupInstallCapture } from './installApp'
import { autoUpdateIfAvailable, notifyNativeAppReady } from './appUpdate'
import { applyTheme, getTheme, readCachedThemeId } from './themes'
import './index.css'

// Apply cached theme before first paint so boot isn’t flash-default
applyTheme(readCachedThemeId())

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
    const theme = getTheme(readCachedThemeId())
    await StatusBar.setBackgroundColor({ color: theme.statusBar })
    await StatusBar.setStyle({
      style: theme.mode === 'light' ? Style.Light : Style.Dark,
    })
  } catch {
    /* browser / plugin missing */
  }
}

// Native APK: status bar + Capgo ready + silent OTA (+ home-icon package if needed)
void (async () => {
  await setupNativeChrome()
  await notifyNativeAppReady()
  // Small delay so the UI mounts first
  setTimeout(() => {
    void autoUpdateIfAvailable((msg) => {
      console.info('[update]', msg)
    })
  }, 2000)
})()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
