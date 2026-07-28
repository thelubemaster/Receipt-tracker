/**
 * Schoolie Cost Tracker — standalone desktop shell (Electron).
 * Loads the built Vite app from dist/ — no browser tab required.
 * All OCR / storage stays on-device (Chromium inside this app window only).
 */
const { app, BrowserWindow, shell, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = !app.isPackaged && process.env.SCHOOLIE_DEV === '1'
const DEV_URL = process.env.SCHOOLIE_DEV_URL || 'http://127.0.0.1:5173'

/** Phone-like portrait window by default */
const DEFAULT_W = 420
const DEFAULT_H = 860

function iconPath() {
  const candidates = [
    path.join(__dirname, '../public/pwa-512.png'),
    path.join(__dirname, '../dist/pwa-512.png'),
    path.join(process.resourcesPath || '', 'pwa-512.png'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return undefined
}

function createWindow() {
  const icon = iconPath()
  const win = new BrowserWindow({
    width: DEFAULT_W,
    height: DEFAULT_H,
    minWidth: 360,
    minHeight: 560,
    title: 'Schoolie Cost Tracker',
    backgroundColor: '#0c0e13',
    autoHideMenuBar: true,
    show: false,
    icon: icon ? nativeImage.createFromPath(icon) : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Required for some WASM OCR paths
      webSecurity: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // External links open in the OS browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (isDev) {
    void win.loadURL(DEV_URL)
  } else {
    const indexHtml = path.join(__dirname, '../dist/index.html')
    if (!fs.existsSync(indexHtml)) {
      win.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<body style="font-family:system-ui;background:#0c0e13;color:#eee;padding:2rem">
              <h1>Build missing</h1>
              <p>Run <code>npm run build</code> then <code>npm run app</code>.</p>
            </body>`,
          ),
      )
      return win
    }
    void win.loadFile(indexHtml)
  }

  return win
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev || process.env.SCHOOLIE_DEBUG
          ? [{ type: 'separator' }, { role: 'toggleDevTools' }]
          : []),
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
