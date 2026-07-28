/**
 * Schoolie Cost Tracker — standalone desktop shell (Electron).
 * System tray icon + app menu install. No browser tab required.
 */
const {
  app,
  BrowserWindow,
  shell,
  Menu,
  Tray,
  nativeImage,
} = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = !app.isPackaged && process.env.SCHOOLIE_DEV === '1'
const DEV_URL = process.env.SCHOOLIE_DEV_URL || 'http://127.0.0.1:5173'

const DEFAULT_W = 420
const DEFAULT_H = 860

/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {Tray | null} */
let tray = null
let isQuitting = false

function iconPath() {
  const candidates = [
    path.join(__dirname, '../public/pwa-512.png'),
    path.join(__dirname, '../public/pwa-192.png'),
    path.join(__dirname, '../dist/pwa-512.png'),
    path.join(process.resourcesPath || '', 'pwa-512.png'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return undefined
}

function loadAppIcon() {
  const p = iconPath()
  if (!p) return nativeImage.createEmpty()
  let img = nativeImage.createFromPath(p)
  if (img.isEmpty()) return img
  // Tray icons are small; resize for crisp tray / dock
  if (process.platform === 'darwin') {
    img = img.resize({ width: 22, height: 22 })
  } else {
    img = img.resize({ width: 32, height: 32 })
  }
  return img
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createWindow() {
  const fullIcon = iconPath()
  const win = new BrowserWindow({
    width: DEFAULT_W,
    height: DEFAULT_H,
    minWidth: 360,
    minHeight: 560,
    title: 'Schoolie Cost Tracker',
    backgroundColor: '#0c0e13',
    autoHideMenuBar: true,
    show: false,
    icon: fullIcon ? nativeImage.createFromPath(fullIcon) : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Close to tray (stay in app tray) instead of quitting
  win.on('close', (e) => {
    if (!isQuitting && tray && process.platform !== 'darwin') {
      e.preventDefault()
      win.hide()
    }
  })

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
      void win.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<body style="font-family:system-ui;background:#0c0e13;color:#eee;padding:2rem">
              <h1>Build missing</h1>
              <p>Run <code>npm run build</code> then launch Schoolie again.</p>
            </body>`,
          ),
      )
    } else {
      void win.loadFile(indexHtml)
    }
  }

  mainWindow = win
  return win
}

function createTray() {
  if (tray) return tray

  const icon = loadAppIcon()
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('Schoolie Cost Tracker')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Schoolie',
      click: () => showMainWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(contextMenu)

  // Left-click: show/hide window (common tray pattern)
  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      showMainWindow()
      return
    }
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      showMainWindow()
    }
  })

  tray.on('double-click', () => showMainWindow())

  return tray
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
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Hide to tray',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
          },
        },
        { type: 'separator' },
        isMac
          ? { role: 'close' }
          : {
              label: 'Quit',
              click: () => {
                isQuitting = true
                app.quit()
              },
            },
      ],
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

if (process.getuid && process.getuid() === 0) {
  app.commandLine.appendSwitch('no-sandbox')
}

// Single instance so tray doesn't duplicate
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(() => {
    buildMenu()
    createTray()
    createWindow()
    app.on('activate', () => {
      showMainWindow()
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  // Keep running in the tray on Linux/Windows
  if (process.platform === 'darwin') {
    /* mac uses dock */
  }
  // do not quit — tray keeps the app alive
})
