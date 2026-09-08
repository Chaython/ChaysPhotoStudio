'use client'
// Plugin manager — main-thread singleton. Owns the sandbox worker lifecycle,
// the installed-plugin registry (persisted) and the zphoto RPC bridge.
//
// Sandbox: plugins execute inside a dedicated Web Worker (Blob URL —
// bundler-independent) with a strict RPC surface (document/layer pixels,
// image-ops filter+adjustment execution, toasts). Pixel buffers move as
// TRANSFERABLE ArrayBuffers — plugin pixel math runs fully off the main
// thread. TRUST MODEL: the sandbox isolates capability (no DOM/engine), not
// intent — run only plugins you trust (same model as GIMP/PS script plugins).
import { engine } from '../engine/engine'
import { useEditorStore } from '../store'
import { getImageData, putImageData } from '../utils/canvas'
import { invalidateFlat } from '../engine/document'
import { getPluginWorkerURL } from './plugin-worker'
import type { StoredPlugin, PluginManifest, PluginCommand } from './plugin-types'

const LS_KEY = 'zphoto-plugins'
const listeners = new Set<() => void>()

let worker: Worker | null = null
let workerDead = false
let seq = 1
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

function ensureWorker(): Worker | null {
  if (workerDead) return null
  if (worker) return worker
  try {
    worker = new Worker(getPluginWorkerURL())
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data
      if (msg && msg.kind === 'rpc') {
        void handleRpc(msg.id, msg.method, msg.args).then(
          result => worker?.postMessage({ kind: 'rpc-result', id: msg.id, result }),
          err => worker?.postMessage({ kind: 'rpc-result', id: msg.id, error: err?.message ?? 'rpc error' })
        )
        return
      }
      if (msg && msg.kind === 'run-done') {
        const p = plugins.find(p => p.manifest.id === msg.pluginId)
        if (p && Array.isArray(msg.commands)) {
          p.commands = msg.commands as PluginCommand[]
        }
        if (msg.error) {
          useEditorStore.getState().pushToast(`Plugin error: ${msg.error}`, 'error')
        }
        save()
        notify()
      }
    }
    worker.onerror = () => { workerDead = true; worker = null }
    return worker
  } catch {
    workerDead = true
    return null
  }
}

// ---------- zphoto RPC bridge (main-thread implementation) ----------
async function handleRpc(_id: number, method: string, args: any[]): Promise<any> {
  const doc = engine.activeDoc
  const layer = engine.activeLayer
  switch (method) {
    case 'document.info':
      return doc ? { width: doc.width, height: doc.height, name: doc.name } : null
    case 'layer.getPixels': {
      const canvas = layer ? engine.layerCanvas(layer.id) : null
      if (!doc || !canvas) throw new Error('No active pixel layer')
      const img = getImageData(canvas)
      const copy = img.data.slice().buffer // plugin owns the copy (transferred)
      return { rgba: copy, width: img.width, height: img.height }
    }
    case 'layer.setPixels': {
      if (!doc || !layer) throw new Error('No active layer')
      const [imgLike] = args
      const w = imgLike.width | 0, h = imgLike.height | 0
      if (w !== doc.width || h !== doc.height) {
        throw new Error(`setPixels size mismatch (${w}×${h} vs doc ${doc.width}×${doc.height})`)
      }
      const l = engine.mutateLayerPixels(layer.id)
      if (!l?.canvas) throw new Error('Layer has no pixels')
      putImageData(l.canvas, new ImageData(new Uint8ClampedArray(imgLike.data), w, h))
      invalidateFlat(doc)
      engine.pushHistory(`Plugin: ${layer.name}`)
      engine.emit()
      return true
    }
    case 'applyFilter': {
      const [imgLike, type, params] = args
      const img = new ImageData(new Uint8ClampedArray(imgLike.data), imgLike.width | 0, imgLike.height | 0)
      const ops = await import('../image-ops')
      ops.applyFilter(img, type, params)
      return { data: img.data.buffer, width: img.width, height: img.height }
    }
    case 'applyAdjustment': {
      const [imgLike, type, params] = args
      const img = new ImageData(new Uint8ClampedArray(imgLike.data), imgLike.width | 0, imgLike.height | 0)
      const ops = await import('../image-ops')
      ops.applyAdjustment(img, type, params)
      return { data: img.data.buffer, width: img.width, height: img.height }
    }
    case 'toast': {
      useEditorStore.getState().pushToast(String(args[0]), (args[1] as any) || 'info')
      return true
    }
    case 'log': {
      console.log("[plugin]", ...(args[0] as string[]))
      return true
    }
    default:
      throw new Error('Unknown RPC method: ' + method)
  }
}

// ---------- registry ----------
let plugins: StoredPlugin[] = load()

function load(): StoredPlugin[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch { return [] }
}
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(plugins)) } catch { /* quota */ }
}
function notify() {
  for (const fn of listeners) { try { fn() } catch { /* never break callers */ } }
  try { useEditorStore.getState().bump() } catch { /* SSR */ }
}

/** parse a .zpplugin.json body, or a .js file with a /* @zphoto {...} *\/ header */
export function parsePluginSource(text: string, fallbackName: string): StoredPlugin {
  let manifest: PluginManifest | null = null
  let code = text
  let direct: any = null
  try { direct = JSON.parse(text) } catch { /* not json */ }
  if (direct && direct.manifest && typeof direct.code === 'string') {
    manifest = direct.manifest
    code = direct.code
  } else {
    const m = text.match(/\/\*\s*@zphoto\s+(\{[\s\S]*?\})\s*\*\//)
    if (m) {
      try { manifest = JSON.parse(m[1]) } catch { /* bad header json */ }
    }
  }
  if (!manifest) {
    manifest = {
      id: 'user-' + fallbackName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      name: fallbackName.replace(/\.[^.]+$/, ''),
      version: '1.0.0', description: 'User-installed plugin', apiVersion: 1,
    }
  }
  if (!manifest.id) manifest.id = 'user-' + Date.now().toString(36)
  if (!manifest.name) manifest.name = manifest.id
  return { manifest, code, enabled: true, commands: [] }
}

export const pluginManager = {
  onChange(cb: () => void): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },

  list(): StoredPlugin[] {
    return plugins.map(p => ({ ...p }))
  },

  async install(manifest: PluginManifest, code: string): Promise<StoredPlugin | null> {
    if (plugins.some(p => p.manifest.id === manifest.id)) {
      useEditorStore.getState().pushToast(`Plugin "${manifest.name}" is already installed`, 'error')
      return null
    }
    const plugin: StoredPlugin = { manifest, code, enabled: true, commands: [] }
    plugins.push(plugin)
    save()
    notify()
    // discover commands (runs the body with no command in the sandbox)
    const w = ensureWorker()
    if (w) w.postMessage({ kind: 'run', pluginId: manifest.id, commandId: null, code })
    return plugin
  },

  async installFromFile(file: File): Promise<StoredPlugin | null> {
    const text = await file.text()
    const plugin = parsePluginSource(text, file.name)
    const installed = await pluginManager.install(plugin.manifest, plugin.code)
    if (installed) {
      useEditorStore.getState().pushToast(`Installed plugin "${installed.manifest.name}"`, 'success')
    }
    return installed
  },

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const p = plugins.find(p => p.manifest.id === id)
    if (p) { p.enabled = enabled; save(); notify() }
  },

  async uninstall(id: string): Promise<void> {
    plugins = plugins.filter(p => p.manifest.id !== id)
    save()
    notify()
  },

  /** execute a plugin command (also re-discovers the command list) */
  async runCommand(pluginId: string, commandId: string | null): Promise<void> {
    const p = plugins.find(p => p.manifest.id === pluginId)
    if (!p || !p.enabled) return
    const doc = engine.activeDoc
    const layer = engine.activeLayer
    if (!doc || !layer) {
      useEditorStore.getState().pushToast('Open a document with an active layer first', 'error')
      return
    }
    if (layer.kind === 'adjustment') {
      useEditorStore.getState().pushToast('Plugin needs a pixel layer — adjustment layers have no pixels', 'error')
      return
    }
    if (layer.locked) {
      useEditorStore.getState().pushToast('Layer is locked', 'error')
      return
    }
    const w = ensureWorker()
    if (!w) {
      useEditorStore.getState().pushToast('Plugin sandbox unavailable in this browser', 'error')
      return
    }
    w.postMessage({ kind: 'run', pluginId, commandId, code: p.code })
  },
}
