// Plugin sandbox worker — built from a Blob URL (bundler-independent).
//
// Plugins are evaluated with `new Function('zphoto', code)` INSIDE this worker:
// no DOM, no engine references — only the RPC surface below. Pixel-heavy plugin
// math runs fully off the main thread; layer pixels move as transferable
// ArrayBuffers (zero-copy). applyFilter/applyAdjustment requests are forwarded
// to the main thread where the image-ops library lives.
//
// TRUST MODEL: the sandbox isolates *capability* (no DOM/engine access), not
// *intent* — run only plugins you trust, exactly like GIMP/PS script plugins.

export const PLUGIN_WORKER_SOURCE = String.raw`
'use strict'
let seq = 1
const pending = new Map()          // callId → { resolve, reject }
const commands = new Map()         // commandId → fn
let pluginContext = null           // { pluginId }

function send(msg, transfer) {
  self.postMessage(msg, transfer || [])
}
function rpc(method, args, transfer) {
  const id = seq++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    send({ kind: 'rpc', id, method, args }, transfer)
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error('RPC timeout: ' + method))
      }
    }, 30000)
  })
}

function imageDataLikeFrom(rgba, w, h) {
  // normalize any array-ish into { data, width, height } for main-thread ops
  if (rgba && rgba.data && rgba.width) return rgba
  return { data: rgba, width: w, height: h }
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
      const zphoto = {
        version: 1,
        document: {
          info: () => rpc('document.info', []),
        },
        layer: {
          getPixels: async () => {
            const r = await rpc('layer.getPixels', [])
            return { rgba: r.rgba, width: r.width, height: r.height }
          },
          setPixels: (rgba, width, height) => {
            // accept both a typed-array view and a raw ArrayBuffer
            const isView = !!(rgba && rgba.buffer)
            const buf = isView ? rgba.buffer : rgba
            const view = isView ? rgba : new Uint8ClampedArray(buf)
            return rpc('layer.setPixels', [{ data: view, width, height }], [buf])
          },
        },
        applyFilter: (imgLike, type, params) => {
          const t = imgLike && imgLike.data && imgLike.data.buffer
          return rpc('applyFilter', [{ data: t ? new Uint8ClampedArray(imgLike.data) : imgLike.data, width: imgLike.width, height: imgLike.height }, type, params || {}])
        },
        applyAdjustment: (imgLike, type, params) => {
          const t = imgLike && imgLike.data && imgLike.data.buffer
          return rpc('applyAdjustment', [{ data: t ? new Uint8ClampedArray(imgLike.data) : imgLike.data, width: imgLike.width, height: imgLike.height }, type, params || {}])
        },
        toast: (message, type) => rpc('toast', [String(message), type || 'info']),
        log: (...args) => rpc('log', [args.map(a => { try { return typeof a === 'object' ? JSON.stringify(a) : String(a) } catch { return String(a) } }).join(' ')]),
        registerCommand: (id, label, fn) => {
          if (typeof id !== 'string' || typeof fn !== 'function') throw new Error('registerCommand(id, label, fn)')
          commands.set(id, { label: String(label || id), fn })
        },
      }
      // run the plugin body (registers commands)
      const fn = new Function('zphoto', msg.code)
      await fn(zphoto)
      // execute the requested command if given
      let error = null
      if (msg.commandId != null) {
        const c = commands.get(msg.commandId)
        if (!c) error = 'Command not found: ' + msg.commandId
        else {
          try { await c.fn() } catch (err) { error = (err && err.message) || String(err) }
        }
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
  if (!cachedUrl) {
    cachedUrl = URL.createObjectURL(new Blob([PLUGIN_WORKER_SOURCE], { type: 'text/javascript' }))
  }
  return cachedUrl
}
