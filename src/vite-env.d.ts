/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Set by Electron preload when running as desktop app */
interface SchoolieDesktop {
  isDesktop: true
  platform: string
}

interface Window {
  schoolieDesktop?: SchoolieDesktop
}
/// <reference types="vite-plugin-pwa/client" />
