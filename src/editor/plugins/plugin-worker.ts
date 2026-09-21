// Plugin sandbox worker — built from a Blob URL (bundler-independent).
// Supports the native `zphoto` API plus a deliberately small Photoshop UXP
// compatibility shim (entrypoints, action.batchPlay, executeAsModal).

export const PLUGIN_WORKER_SOURCE = String.raw`
'use strict'
let seq = 1
const pending = new Map()
const commands = new Map()
let pluginContext = null

function send(msg, transfer) { self.postMessage(msg, transfer || []) }
function rpc(method, args, transfer) {
  const id = seq++
  const pluginId = pluginContext && pluginContext.pluginId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    send({ kind: 'rpc', id, pluginId, method, args }, transfer)
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('RPC timeout: ' + method)) }
    }, 120000)
  })
}

async function guardedFetch(url, init) {
  const r = await rpc('network.fetch', [String(url), init || {}])
  const headers = new Map(r.headers || [])
  return {
    ok: r.ok, status: r.status, statusText: r.statusText, headers,
    text: async () => r.body,
    json: async () => JSON.parse(r.body),
    arrayBuffer: async () => new TextEncoder().encode(r.body).buffer,
  }
}
// Close worker-global network/module loading escape hatches. Native Chay and
// UXP plugin code must pass the host permission gate for every network request.
try { Object.defineProperty(self, 'fetch', { value: guardedFetch, configurable: false, writable: false }) } catch { try { self.fetch = guardedFetch } catch {} }
try { Object.defineProperty(self, 'importScripts', { value: () => { throw new Error('importScripts is disabled in the plugin sandbox') }, configurable: false, writable: false }) } catch {}
try { Object.defineProperty(self, 'WebSocket', { value: class { constructor() { throw new Error('WebSocket is disabled in the plugin sandbox') } }, configurable: false, writable: false }) } catch {}

function makeZphoto() {
  return {
    version: 2,
    document: { info: () => rpc('document.info', []) },
    layer: {
      info: () => rpc('layer.info', []),
      getPixels: async () => {
        const r = await rpc('layer.getPixels', [])
        return { rgba: r.rgba, width: r.width, height: r.height }
      },
      setPixels: (rgba, width, height) => {
        const isView = !!(rgba && rgba.buffer)
        const buf = isView ? rgba.buffer : rgba
        const view = isView ? rgba : new Uint8ClampedArray(buf)
        return rpc('layer.setPixels', [{ data: view, width, height }], [buf])
      },
      addPixels: (rgba, width, height, name) => {
        const isView = !!(rgba && rgba.buffer)
        const buf = isView ? rgba.buffer : rgba
        const view = isView ? rgba : new Uint8ClampedArray(buf)
        return rpc('layer.addPixels', [{ data: view, width, height }, name || 'Plugin Result'], [buf])
      },
    },
    selection: {
      getMask: async () => {
        const r = await rpc('selection.getMask', [])
        return { data: r.data, width: r.width, height: r.height }
      },
      setMask: (data, width, height, mode) => {
        const isView = !!(data && data.buffer)
        const buf = isView ? data.buffer : data
        const view = isView ? data : new Uint8ClampedArray(buf)
        return rpc('selection.setMask', [{ data: view, width, height }, mode || 'new'], [buf])
      },
    },
    applyFilter: (imgLike, type, params) => {
      const d = imgLike && imgLike.data ? new Uint8ClampedArray(imgLike.data) : imgLike.data
      return rpc('applyFilter', [{ data: d, width: imgLike.width, height: imgLike.height }, type, params || {}])
    },
    applyAdjustment: (imgLike, type, params) => {
      const d = imgLike && imgLike.data ? new Uint8ClampedArray(imgLike.data) : imgLike.data
      return rpc('applyAdjustment', [{ data: d, width: imgLike.width, height: imgLike.height }, type, params || {}])
    },
    storage: {
      get: (key) => rpc('storage.get', [String(key)]),
      set: (key, value) => rpc('storage.set', [String(key), value]),
      delete: (key) => rpc('storage.delete', [String(key)]),
      keys: () => rpc('storage.keys', []),
    },
    network: {
      fetch: guardedFetch,
    },
    native: {
      gmic: (imageDataUrl, args) => rpc('native.gmic', [String(imageDataUrl), Array.isArray(args) ? args : []]),
      gegl: (imageDataUrl, operation, args) => rpc('native.gegl', [String(imageDataUrl), String(operation), Array.isArray(args) ? args : []]),
    },
    toast: (message, type) => rpc('toast', [String(message), type || 'info']),
    log: (...args) => rpc('log', [args.map(a => { try { return typeof a === 'object' ? JSON.stringify(a) : String(a) } catch { return String(a) } }).join(' ')]),
    registerCommand: (id, label, fn) => {
      if (typeof id !== 'string' || typeof fn !== 'function') throw new Error('registerCommand(id, label, fn)')
      commands.set(id, { label: String(label || id), fn })
    },
  }
}

function makePluginDataFile(name, zphoto) {
  return {
    name, isFile: true,
    async read() { const v = await zphoto.storage.get(name); return v == null ? '' : String(v) },
    async write(value) { await zphoto.storage.set(name, String(value)); return true },
    async delete() { await zphoto.storage.delete(name) },
  }
}

function makeUxpRequire(zphoto) {
  const entrypoints = {
    setup(spec) {
      const defs = spec && spec.commands
      if (defs && typeof defs === 'object') {
        for (const [id, value] of Object.entries(defs)) {
          if (typeof value === 'function') zphoto.registerCommand(id, id, value)
          else if (value && typeof value.run === 'function') zphoto.registerCommand(id, value.label || id, value.run)
        }
      }
      // Panels are intentionally not mounted in the worker; setup still
      // succeeds so command-based plugins can run even when they also declare panels.
    },
  }
  const photoshop = {
    action: { batchPlay: (descriptors, _options) => rpc('uxp.batchPlay', [descriptors || []]) },
    core: { executeAsModal: (fn, _options) => Promise.resolve().then(() => fn({ hostControl: {} })) },
    app: {
      get activeDocument() {
        // UXP's real DOM is synchronous. We expose the subset as async methods
        // rather than lying about unavailable synchronous host objects.
        return {
          getInfo: () => zphoto.document.info(),
          getActiveLayer: () => zphoto.layer.info(),
        }
      },
    },
    constants: {
      BlendMode: { NORMAL: 'normal', MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay' },
      SaveOptions: { DONOTSAVECHANGES: 2, SAVECHANGES: 1 },
    },
  }
  const uxp = {
    entrypoints,
    shell: { openExternal: (_url) => Promise.reject(new Error('UXP shell.openExternal is disabled in the sandbox')) },
    storage: {
      localFileSystem: {
        async getDataFolder() {
          return {
            name: 'plugin-data', isFolder: true,
            async createFile(name) { return makePluginDataFile(String(name), zphoto) },
            async getEntry(name) { return makePluginDataFile(String(name), zphoto) },
            async getEntries() { const keys = await zphoto.storage.keys(); return Promise.all(keys.map(k => makePluginDataFile(k, zphoto))) },
          }
        },
      },
    },
  }
  return (name) => {
    if (name === 'photoshop') return photoshop
    if (name === 'uxp') return uxp
    throw new Error('UXP module not supported: ' + name)
  }
}

self.onmessage = async (ev) => {
  const msg = ev.data
  try {
    if (msg.kind === 'ping') { send({ kind: 'pong' }); return }
    if (msg.kind === 'rpc-result') {
      const p = pending.get(msg.id)
      if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result) }
      return
    }
    if (msg.kind === 'run') {
      pluginContext = { pluginId: msg.pluginId }
      commands.clear()
      const zphoto = makeZphoto()
      if (msg.format === 'uxp') {
        const uxpRequire = makeUxpRequire(zphoto)
        const safeFetch = (url, init) => zphoto.network.fetch(url, init)
        const fn = new Function('zphoto', 'require', 'module', 'exports', 'fetch', msg.code)
        const module = { exports: {} }
        await fn(zphoto, uxpRequire, module, module.exports, safeFetch)
      } else {
        const safeFetch = (url, init) => zphoto.network.fetch(url, init)
        const fn = new Function('zphoto', 'fetch', msg.code)
        await fn(zphoto, safeFetch)
      }
      let error = null
      if (msg.commandId != null) {
        const c = commands.get(msg.commandId)
        if (!c) error = 'Command not found: ' + msg.commandId
        else { try { await c.fn() } catch (err) { error = (err && err.message) || String(err) } }
      }
      send({ kind: 'run-done', pluginId: msg.pluginId, error, commands: [...commands.entries()].map(([id, c]) => ({ id, label: c.label })) })
      return
    }
  } catch (err) {
    send({ kind: 'run-done', pluginId: msg && msg.pluginId, error: (err && err.message) || String(err), commands: [] })
  }
}
send({ kind: 'ready' })
`

let cachedUrl: string | null = null
export function getPluginWorkerURL(): string {
  if (!cachedUrl) cachedUrl = URL.createObjectURL(new Blob([PLUGIN_WORKER_SOURCE], { type: 'text/javascript' }))
  return cachedUrl
}
