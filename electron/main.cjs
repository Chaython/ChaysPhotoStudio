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
const { app, BrowserWindow, Menu, shell, session, ipcMain } = require('electron')
const { spawn, execFile } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const DEV_URL = process.env.CHAYS_DEV_URL || 'http://localhost:3000'
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|tga|ico|psd)$/i
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.avif': 'image/avif', '.tga': 'image/x-tga', '.ico': 'image/x-icon', '.psd': 'image/vnd.adobe.photoshop',
  '.svg': 'image/svg+xml', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

let mainWindow = null
let serverProc = null
let gatewayServer = null
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

function safeResolve(root, relPath) {
  const base = path.resolve(root)
  const resolved = path.resolve(base, relPath)
  return resolved === base || resolved.startsWith(base + path.sep) ? resolved : null
}

function serveFile(req, res, filePath, cacheControl) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return false
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    })
    if (req.method === 'HEAD') res.end()
    else fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res)
    return true
  } catch {
    return false
  }
}

async function startPackagedGateway(upstreamUrl, appDir) {
  const staticRoot = path.join(appDir, '.next', 'static')
  const publicRoot = path.join(appDir, 'public')
  if (!fs.existsSync(staticRoot)) throw new Error(`packaged Next static assets not found: ${staticRoot}`)
  if (!fs.existsSync(publicRoot)) throw new Error(`packaged public assets not found: ${publicRoot}`)

  const port = await freePort()
  const upstream = new URL(upstreamUrl)
  gatewayServer = http.createServer((req, res) => {
    const rawUrl = req.url || '/'
    let pathname
    try { pathname = new URL(rawUrl, 'http://127.0.0.1').pathname }
    catch { res.writeHead(400); res.end('Bad request'); return }

    if (req.method === 'GET' || req.method === 'HEAD') {
      try {
        if (pathname.startsWith('/_next/static/')) {
          const rel = decodeURIComponent(pathname.slice('/_next/static/'.length))
          const file = safeResolve(staticRoot, rel)
          if (file && serveFile(req, res, file, 'public, max-age=31536000, immutable')) return
        }

        if (pathname !== '/' && !pathname.startsWith('/api/')) {
          const rel = decodeURIComponent(pathname.replace(/^\/+/, ''))
          const file = safeResolve(publicRoot, rel)
          if (file && serveFile(req, res, file, 'no-cache')) return
        }
      } catch {
        res.writeHead(400)
        res.end('Bad asset path')
        return
      }
    }

    const headers = { ...req.headers, host: upstream.host, connection: 'close' }
    const proxy = http.request({
      hostname: upstream.hostname,
      port: upstream.port,
      method: req.method,
      path: rawUrl,
      headers,
    }, (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers)
      upRes.pipe(res)
    })
    proxy.on('error', (err) => {
      console.error('[gateway] upstream request failed:', err.message)
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Embedded server unavailable')
    })
    req.pipe(proxy)
  })

  await new Promise((resolve, reject) => {
    gatewayServer.once('error', reject)
    gatewayServer.listen(port, '127.0.0.1', () => {
      gatewayServer.removeListener('error', reject)
      resolve()
    })
  })
  return `http://127.0.0.1:${port}`
}

async function startPackagedServer() {
  const appDir = path.join(process.resourcesPath, 'app')
  const serverJs = path.join(appDir, 'server.js')
  if (!fs.existsSync(serverJs)) {
    throw new Error(`packaged server not found: ${serverJs}`)
  }

  const port = await freePort()
  const upstreamUrl = `http://127.0.0.1:${port}`
  serverProc = spawn(process.execPath, [serverJs], {
    cwd: appDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      // Keep the traced standalone runtime outside a literal node_modules
      // directory so electron-builder cannot prune it during packaging.
      NODE_PATH: [
        path.join(appDir, 'server_modules'),
        process.env.NODE_PATH,
      ].filter(Boolean).join(path.delimiter),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  serverProc.stdout.on('data', (d) => console.log(`[server] ${String(d).trim()}`))
  serverProc.stderr.on('data', (d) => console.error(`[server] ${String(d).trim()}`))
  serverProc.on('exit', (code) => {
    if (!quitting) console.error(`[server] exited unexpectedly with code ${code}`)
  })

  await waitForServer(upstreamUrl)
  // Serve immutable _next/public files directly from the packaged payload and
  // proxy HTML/API requests to Next. This avoids a shell-specific static-route
  // failure leaving only the SSR loading fallback visible.
  return startPackagedGateway(upstreamUrl, appDir)
}

async function waitForEditorReady(win, timeoutMs = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (!win || win.isDestroyed()) return false
    try {
      const ready = await win.webContents.executeJavaScript(
        'Boolean(window.__zphotoEngine && window.__zphotoStore)',
        true,
      )
      if (ready) return true
    } catch { /* renderer still loading */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return false
}

// ---------- optional native filter bridge ----------
// G'MIC/GEGL are deliberately external optional dependencies. We never invoke
// a shell: renderer arguments are passed as argv to execFile, input/output are
// temporary PNG files, and only data:image payloads are accepted.
const NATIVE_TIMEOUT_MS = 5 * 60 * 1000
const MAX_NATIVE_IMAGE_BYTES = 256 * 1024 * 1024

function commandCandidates(kind) {
  if (kind === 'gmic') return [process.env.CHAYS_GMIC_PATH, 'gmic', process.platform === 'win32' ? 'gmic.exe' : null].filter(Boolean)
  return [process.env.CHAYS_GEGL_PATH, 'gegl', process.platform === 'win32' ? 'gegl.exe' : null].filter(Boolean)
}

function execFileP(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: NATIVE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err) }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

async function findNativeTool(kind) {
  for (const candidate of commandCandidates(kind)) {
    try {
      const args = kind === 'gmic' ? ['-version'] : ['--version']
      const r = await execFileP(candidate, args, { timeout: 10000 })
      const version = (r.stdout || r.stderr).split(/\r?\n/).find(Boolean) || candidate
      return { path: candidate, version: version.trim() }
    } catch { /* try next */ }
  }
  return null
}

function decodeDataImage(value) {
  if (typeof value !== 'string') throw new Error('Native filter input must be a data URL')
  const m = value.match(/^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\r\n]+)$/i)
  if (!m) throw new Error('Only base64 image data URLs are accepted')
  const buf = Buffer.from(m[1].replace(/\s/g, ''), 'base64')
  if (!buf.length || buf.length > MAX_NATIVE_IMAGE_BYTES) throw new Error('Native filter image is empty or too large')
  return buf
}

async function withNativeImage(imageDataUrl, fn) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chays-photo-native-'))
  const input = path.join(dir, 'input.png')
  const output = path.join(dir, 'output.png')
  try {
    await fs.promises.writeFile(input, decodeDataImage(imageDataUrl), { mode: 0o600 })
    const meta = await fn(input, output)
    const result = await fs.promises.readFile(output)
    if (!result.length || result.length > MAX_NATIVE_IMAGE_BYTES) throw new Error('Native filter returned an invalid image')
    return { image: `data:image/png;base64,${result.toString('base64')}`, stderr: meta?.stderr || '' }
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function cleanArgv(items, max = 128) {
  if (!Array.isArray(items)) return []
  return items.slice(0, max).map(v => String(v)).filter(v => v.length <= 4096 && !v.includes('\0'))
}

async function installNativeToolIpc() {
  let cached = null
  async function info(refresh = false) {
    if (!cached || refresh) {
      const [gmic, gegl] = await Promise.all([findNativeTool('gmic'), findNativeTool('gegl')])
      cached = { electron: true, gmic: !!gmic, gegl: !!gegl, gmicVersion: gmic?.version, geglVersion: gegl?.version, gmicPath: gmic?.path, geglPath: gegl?.path }
    }
    return cached
  }
  ipcMain.handle('chays:native-tools:info', () => info())
  ipcMain.handle('chays:native-tools:gmic', async (_event, payload) => {
    const state = await info()
    if (!state.gmicPath) throw new Error('G’MIC was not found. Install gmic or set CHAYS_GMIC_PATH.')
    const args = cleanArgv(payload?.args)
    return withNativeImage(payload?.image, async (input, output) => {
      // G'MIC accepts an image filename as input, followed by commands, then -o output.
      return execFileP(state.gmicPath, [input, ...args, '-o', output])
    })
  })
  ipcMain.handle('chays:native-tools:gegl', async (_event, payload) => {
    const state = await info()
    if (!state.geglPath) throw new Error('GEGL was not found. Install gegl or set CHAYS_GEGL_PATH.')
    const operation = String(payload?.operation || '').trim()
    if (!/^[a-z0-9][a-z0-9_.:-]*$/i.test(operation)) throw new Error('Invalid GEGL operation name')
    const args = cleanArgv(payload?.args, 64)
    // GEGL chain syntax: gegl input -o output -- operation property=value ...
    return withNativeImage(payload?.image, (input, output) => execFileP(state.geglPath, [input, '-o', output, '--', operation, ...args]))
  })
  return info(true)
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

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    console.error(`[renderer] load failed code=${code} main=${isMainFrame} url=${url}: ${description}`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] process gone:', details?.reason || details)
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
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    await installNativeToolIpc().catch(err => console.warn('[native-tools]', err?.message || err))

    buildMenu()
    createWindow()

    if (!app.isPackaged) {
      serverUrl = DEV_URL
      await mainWindow.loadURL(DEV_URL)
    } else {
      try {
        serverUrl = await startPackagedServer()
        await mainWindow.loadURL(serverUrl)

        if (process.env.CHAYS_SMOKE_TEST === '1') {
          const ready = await waitForEditorReady(mainWindow)
          if (!ready) {
            console.error('[smoke] editor did not finish hydrating within 30 seconds')
            app.exit(2)
            return
          }
          console.log('[smoke] editor hydrated successfully')
          app.exit(0)
          return
        }
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
    if (gatewayServer) {
      try { gatewayServer.close() } catch { /* already closed */ }
      gatewayServer = null
    }
    if (serverProc && serverProc.exitCode === null) {
      try { serverProc.kill() } catch { /* already gone */ }
    }
  })
}
