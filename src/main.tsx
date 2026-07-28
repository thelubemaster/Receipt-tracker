import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { setupInstallCapture } from './installApp'
import { autoUpdateIfAvailable, notifyNativeAppReady } from './appUpdate'
import './index.css'

// Capture Chrome/Android install prompt before React mounts
setupInstallCapture()

// Native APK: tell Capgo the UI is healthy + optional silent OTA
void (async () => {
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
