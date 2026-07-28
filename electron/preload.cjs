/**
 * Minimal bridge: expose a flag so the UI knows it's the desktop app.
 * No Node APIs leak into the page.
 */
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('schoolieDesktop', {
  isDesktop: true,
  platform: process.platform,
})
