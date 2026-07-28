import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
// @ts-expect-error plain JS middleware helper
import { attachDebugReportMiddleware } from './scripts/debug-report-middleware.mjs'
// @ts-expect-error plain JS middleware helper
import { attachWebLookupMiddleware } from './scripts/web-lookup-middleware.mjs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string
}

function versionJsonPlugin(): Plugin {
  const payload = () =>
    JSON.stringify(
      {
        version: pkg.version,
        name: 'schoolie-tracker',
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    )

  return {
    name: 'schoolie-version-json',
    // Dev server: always serve current APP_VERSION
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/version.json')) {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(payload())
          return
        }
        next()
      })
    },
    // Production build: emit into dist
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: payload(),
      })
    },
  }
}

/** Lets the coding agent inspect bad scans saved from the phone/browser. */
function debugReportPlugin(): Plugin {
  return {
    name: 'schoolie-debug-reports',
    configureServer(server) {
      attachDebugReportMiddleware(server.middlewares)
    },
    configurePreviewServer(server) {
      attachDebugReportMiddleware(server.middlewares)
    },
  }
}

/** Free internet lookup for Seeker agent (DuckDuckGo + Wikipedia, no API key). */
function webLookupPlugin(): Plugin {
  return {
    name: 'schoolie-web-lookup',
    configureServer(server) {
      attachWebLookupMiddleware(server.middlewares)
    },
    configurePreviewServer(server) {
      attachWebLookupMiddleware(server.middlewares)
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    versionJsonPlugin(),
    debugReportPlugin(),
    webLookupPlugin(),
    VitePWA({
      // Prompt so we can show “new version ready” instead of silent swap only
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'version.json'],
      manifest: {
        name: 'Schoolie Cost Tracker',
        short_name: 'Schoolie',
        description: 'Track purchases and receipts for your school bus conversion',
        theme_color: '#0c0e13',
        background_color: '#0c0e13',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,json}'],
        // Always revalidate version.json so "Check for updates" sees the host
        runtimeCaching: [
          {
            urlPattern: /\/version\.json$/i,
            handler: 'NetworkOnly',
            options: {
              cacheName: 'schoolie-version',
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4190,
    strictPort: true,
  },
})
