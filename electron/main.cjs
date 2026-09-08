'use strict'
// ============================================================
// Chay's Photo Studio — Electron main process
// Two modes:
//  * dev (`electron .` from the repo): loads the Next dev server
//    (CHAYS_DEV_URL, default http://localhost:3000)
//  * packaged: spawns the Next standalone server (bundled at
//    resources/app) on a free localhost port with Electron's own
//    Node runtime (ELECTRON_RUN_AS_NODE), then loads it.
// Also relays image files launched via file association / "Open
// with" / macOS open-file to the renderer over IPC.
// ============================================================
const { app, BrowserWindow, Menu, shell, session } = require('electron')
const { spawn } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const DEV_URL = process.env.CHAYS_DEV_URL || 'http://localhost:3000'
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|tga|ico|psd)$/i
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.avif': 'image/avif', '.tga': 'image/x-tga', '.ico': 'image/x-icon', '.psd': 'image/vnd.adobe.photoshop',
}

let mainWindow = null
let serverProc = null
let serverUrl = null
let quitting = false
const pendingFiles = []

// ---------- helpers ----------
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

function probe(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(res.statusCode ? res.statusCode < 500 : false)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false) })
  })
}

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (serverProc && serverProc.exitCode !== null) throw new Error('server exited during startup')
    if (await probe(url)) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`server not ready after ${timeoutMs}ms (${url})`)
}

function startPackagedServer() {
  const appDir = path.join(process.resourcesPath, 'app')
  const serverJs = path.join(appDir, 'server.js')
  if (!fs.existsSync(serverJs)) {
    throw new Error(`packaged server not found: ${serverJs}`)
  }
  return freePort().then((port) => {
    const url = `http://127.0.0.1:${port}`
    serverProc = spawn(process.execPath, [serverJs], {
      cwd: appDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    serverProc.stdout.on('data', (d) => console.log(`[server] ${String(d).trim()}`))
    serverProc.stderr.on('data', (d) => console.error(`[server] ${String(d).trim()}`))
    serverProc.on('exit', (code) => {
      if (!quitting) console.error(`[server] exited unexpectedly with code ${code}`)
    })
    return waitForServer(url).then(() => url)
  })
}

// ---------- file-open relay ----------
function filePathsFromArgv(argv) {
  return argv.filter((a) => IMAGE_EXT.test(a) && !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isFile())
}

function sendOpenFile(win, filePath) {
  try {
    const data = fs.readFileSync(filePath)
    const name = path.basename(filePath)
    const type = MIME[path.extname(filePath).toLowerCase()] || 'image/png'
    if (win && !win.isDestroyed()) win.webContents.send('chays:open-file', { name, type, data })
  } catch (err) {
    console.error(`[open-file] failed to read ${filePath}:`, err.message)
  }
}

function flushPendingFiles() {
  while (pendingFiles.length && mainWindow && !mainWindow.isDestroyed()) {
    sendOpenFile(mainWindow, pendingFiles.shift())
  }
}

// ---------- window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    backgroundColor: '#1c1c1c',
    title: "Chay's Photo Studio",
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs require('electron') only — keep sandbox off for IPC stability
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    flushPendingFiles()
  })

  // security: no new windows from the web app; external links → browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // keep the app inside its own origin (127.0.0.1 / localhost / dev URL)
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const own = new URL(serverUrl || DEV_URL).host
    try {
      const target = new URL(url)
      if (!['127.0.0.1', 'localhost', own].includes(target.host)) {
        e.preventDefault()
        void shell.openExternal(url)
      }
    } catch { e.preventDefault() }
  })

  mainWindow.on('closed', () => { mainWindow = null })

  return mainWindow
}

function buildMenu() {
  const send = (channel, payload) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload) }
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Image…', accelerator: 'CmdOrCtrl+O', click: () => send('chays:menu-command', 'open') },
        { type: 'separator' },
        ...(process.platform === 'win32' ? [{ label: 'Exit', click: () => app.quit() }] : [{ role: 'close' }]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About & License',
          click: () => {
            const detail = 'Chay’s Photo Studio © Chaython Meredith.\nFree for consumer and education use; commercial use requires a license — chaython@live.ca.\nSupport development: https://github.com/sponsors/Chaython'
            const { dialog } = require('electron')
            dialog.showMessageBox(mainWindow, { type: 'info', title: 'Chay’s Photo Studio', message: 'Chay’s Photo Studio', detail, buttons: ['OK'] })
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------- lifecycle ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      for (const f of filePathsFromArgv(argv)) sendOpenFile(mainWindow, f)
    }
  })

  app.on('open-file', (e, filePath) => {
    e.preventDefault()
    pendingFiles.push(filePath)
    flushPendingFiles()
  })

  // files passed on the command line at launch (win/linux "Open with")
  for (const f of filePathsFromArgv(process.argv)) pendingFiles.push(f)

  // deny all permission prompts (camera/geolocation/etc.) — an editor needs none
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler(_wc => false)

    buildMenu()
    createWindow()

    if (!app.isPackaged) {
      serverUrl = DEV_URL
      await mainWindow.loadURL(DEV_URL)
    } else {
      try {
        serverUrl = await startPackagedServer()
        await mainWindow.loadURL(serverUrl)
      } catch (err) {
        console.error('[fatal]', err)
        const { dialog } = require('electron')
        dialog.showErrorBox("Chay's Photo Studio", `The embedded server failed to start.\n\n${err.message}`)
        app.quit()
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else if (mainWindow) mainWindow.show()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    if (serverProc && serverProc.exitCode === null) {
      try { serverProc.kill() } catch { /* already gone */ }
    }
  })
}
