import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { setupInstallCapture } from './installApp'
import './index.css'

// Capture Chrome/Android install prompt before React mounts
setupInstallCapture()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
