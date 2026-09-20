'use client'
// Plugin manager — native Chay plugin runtime + Photoshop UXP compatibility
// shim. All JS executes in a dedicated Worker. Every host-side RPC is checked
// against an explicit permission before touching documents or native helpers.
import { engine } from '../engine/engine'
import { useEditorStore } from '../store'
import { createCanvas, ctx2d, getImageData, getMaskAlpha, putImageData } from '../utils/canvas'
import { getFlatComposite, invalidateFlat } from '../engine/document'
import { getPluginWorkerURL } from './plugin-worker'
import { analyzeUxpCompatibility, uxpManifestToPlugin } from './compatibility'
import { runNativeGegl, runNativeGmic } from './native-host'
import type { StoredPlugin, PluginManifest, PluginCommand, PluginPermission, PluginSourceFormat } from './plugin-types'

const LS_KEY = 'zphoto-plugins'
const PLUGIN_DATA_PREFIX = 'zphoto-plugin-data:'
const listeners = new Set<() => void>()

const LEGACY_PERMS: PluginPermission[] = [
  'document.read', 'layer.read', 'layer.write', 'selection.read', 'selection.write', 'editor.commands', 'ui.toast',
]

let worker: Worker | null = null
let workerDead = false

function pluginPerms(p: StoredPlugin): PluginPermission[] {
  return p.grantedPermissions ?? p.manifest.permissions ?? LEGACY_PERMS
}
function requirePerm(pluginId: string, permission: PluginPermission) {
  const p = plugins.find(p => p.manifest.id === pluginId)
  if (!p) throw new Error('Plugin is no longer installed')
  if (!pluginPerms(p).includes(permission)) throw new Error(`Plugin permission denied: ${permission}`)
}

function ensureWorker(): Worker | null {
  if (workerDead) return null
  if (worker) return worker
  try {
    worker = new Worker(getPluginWorkerURL())
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data
      if (msg && msg.kind === 'rpc') {
        void handleRpc(String(msg.pluginId || ''), msg.method, msg.args).then(
          result => worker?.postMessage({ kind: 'rpc-result', id: msg.id, result }),
          err => worker?.postMessage({ kind: 'rpc-result', id: msg.id, error: err?.message ?? 'rpc error' }),
        )
        return
      }
      if (msg && msg.kind === 'run-done') {
        const p = plugins.find(p => p.manifest.id === msg.pluginId)
        if (p && Array.isArray(msg.commands)) p.commands = msg.commands as PluginCommand[]
        if (msg.error) useEditorStore.getState().pushToast(`Plugin error: ${msg.error}`, 'error')
        save(); notify()
      }
    }
    worker.onerror = () => { workerDead = true; worker = null }
    return worker
  } catch {
    workerDead = true
    return null
  }
}

function selectedLayerFromTarget(target: any[]): any {
  const doc = engine.activeDoc
  if (!doc) return null
  const t = Array.isArray(target) ? target.find(v => v?._ref === 'layer') : null
  if (t?._id != null) return doc.layers.find(l => l.id === String(t._id)) ?? engine.activeLayer
  if (typeof t?._name === 'string') return doc.layers.find(l => l.name === t._name) ?? engine.activeLayer
  return engine.activeLayer
}

async function runUxpBatchPlay(descriptors: any[]): Promise<any[]> {
  const doc = engine.activeDoc
  if (!doc) throw new Error('No active document')
  const out: any[] = []
  for (const d of descriptors ?? []) {
    const obj = String(d?._obj ?? '')
    const layer = selectedLayerFromTarget(d?._target)
    if (obj === 'get') {
      out.push(layer ? { name: layer.name, layerID: layer.id, opacity: layer.opacity, visible: layer.visible, mode: layer.blendMode } : {})
    } else if (obj === 'make' && Array.isArray(d?._target) && d._target.some((t: any) => t?._ref === 'layer')) {
      const made = engine.addRasterLayer(d?.using?.name || d?.name || 'Layer')
      out.push(made ? { layerID: made.id, name: made.name } : {})
    } else if (obj === 'duplicate') {
      const made = engine.duplicateLayer(layer?.id)
      out.push(made ? { layerID: made.id, name: made.name } : {})
    } else if (obj === 'delete') {
      if (layer) engine.deleteLayer(layer.id)
      out.push({})
    } else if (obj === 'select') {
      if (layer) { doc.activeLayerId = layer.id; engine.emit() }
      out.push({})
    } else if (obj === 'set') {
      if (!layer) { out.push({}); continue }
      const to = d?.to ?? d?.using ?? {}
      const patch: any = {}
      if (typeof to.name === 'string') patch.name = to.name
      if (typeof to.visible === 'boolean') patch.visible = to.visible
      if (typeof to.opacity === 'number') patch.opacity = to.opacity
      else if (typeof to.opacity?._value === 'number') patch.opacity = to.opacity._value
      const mode = to.mode?._value ?? to.blendMode?._value ?? to.mode ?? to.blendMode
      if (typeof mode === 'string') patch.blendMode = mode.toLowerCase().replace(/[^a-z-]/g, '')
      engine.setLayerProps(layer.id, patch, { label: 'UXP Plugin' })
      out.push({})
    } else if (obj === 'flattenImage') {
      engine.flatten(); out.push({})
    } else if (obj === 'mergeVisible') {
      engine.mergeVisible(); out.push({})
    } else if (obj === 'mergeLayersNew' || obj === 'mergeLayers') {
      engine.mergeDown(layer?.id); out.push({})
    } else if (obj === 'rasterizeLayer') {
      engine.rasterizeLayer(layer?.id); out.push({})
    } else if (obj === 'imageSize') {
      const n = (v: any) => typeof v === 'number' ? v : Number(v?._value ?? v?.value)
      const w = Math.round(n(d.width)), h = Math.round(n(d.height))
      if (w > 0 && h > 0) engine.resizeImage({ w, h })
      out.push({ width: doc.width, height: doc.height })
    } else if (obj === 'canvasSize') {
      const n = (v: any) => typeof v === 'number' ? v : Number(v?._value ?? v?.value)
      const w = Math.round(n(d.width)), h = Math.round(n(d.height))
      if (w > 0 && h > 0) engine.resizeCanvas({ w, h, anchor: 'center' })
      out.push({ width: doc.width, height: doc.height })
    } else if (obj === 'rotateEventEnum' || obj === 'rotate') {
      const deg = Number(d.angle?._value ?? d.angle ?? 0)
      if (Number.isFinite(deg)) engine.rotateCanvas(deg)
      out.push({})
    } else if (obj === 'flip') {
      const axis = String(d.axis?._value ?? d.axis ?? 'horizontal').toLowerCase()
      engine.flipCanvas(axis.includes('vertical') ? 'vertical' : 'horizontal'); out.push({})
    } else {
      throw new Error(`Unsupported UXP batchPlay action: ${obj || '(unknown)'}`)
    }
  }
  return out
}

function uxpDocCheck(options: any) {
  const doc = engine.activeDoc
  if (!doc) throw new Error('No active document')
  if (options?.documentID != null && String(options.documentID) !== String(doc.id)) {
    throw new Error('UXP imaging currently operates on the active document')
  }
  return doc
}

function uxpTargetLayer(options: any) {
  const doc = uxpDocCheck(options)
  if (options?.layerID == null || options.layerID === 0) return engine.activeLayer
  return doc.layers.find(l => String(l.id) === String(options.layerID)) ?? engine.activeLayer
}

function uxpBounds(options: any, width: number, height: number) {
  const b = options?.sourceBounds ?? options?.targetBounds ?? {}
  const left = Math.max(0, Math.min(width, Math.floor(Number(b.left ?? b.x ?? 0) || 0)))
  const top = Math.max(0, Math.min(height, Math.floor(Number(b.top ?? b.y ?? 0) || 0)))
  let right = Number(b.right)
  let bottom = Number(b.bottom)
  if (!Number.isFinite(right)) right = left + (Number(b.width) || width - left)
  if (!Number.isFinite(bottom)) bottom = top + (Number(b.height) || height - top)
  right = Math.max(left, Math.min(width, Math.ceil(right)))
  bottom = Math.max(top, Math.min(height, Math.ceil(bottom)))
  return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

function uxpReadCanvas(canvas: HTMLCanvasElement, options: any) {
  const bounds = uxpBounds(options, canvas.width, canvas.height)
  if (bounds.width < 1 || bounds.height < 1) throw new Error('UXP imaging sourceBounds is empty')
  const tw = Math.max(1, Math.round(Number(options?.targetSize?.width) || bounds.width))
  const th = Math.max(1, Math.round(Number(options?.targetSize?.height) || bounds.height))
  const out = createCanvas(tw, th)
  const oc = ctx2d(out)
  oc.imageSmoothingEnabled = true
  oc.imageSmoothingQuality = 'high'
  oc.drawImage(canvas, bounds.left, bounds.top, bounds.width, bounds.height, 0, 0, tw, th)
  const img = getImageData(out)
  if (options?.applyAlpha === false) {
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255
  }
  return {
    data: img.data.slice().buffer,
    width: tw,
    height: th,
    sourceBounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
  }
}

function uxpInputCanvas(image: any): HTMLCanvasElement {
  const w = Math.max(1, Number(image?.width) | 0)
  const h = Math.max(1, Number(image?.height) | 0)
  const data = new Uint8ClampedArray(image?.data ?? [])
  if (data.length < w * h * 4) throw new Error('UXP imaging input does not contain enough RGBA pixels')
  const canvas = createCanvas(w, h)
  putImageData(canvas, new ImageData(data.slice(0, w * h * 4), w, h))
  return canvas
}

// ---------- host RPC bridge ----------
async function handleRpc(pluginId: string, method: string, args: any[]): Promise<any> {
  const doc = engine.activeDoc
  const layer = engine.activeLayer
  switch (method) {
    case 'document.info':
      requirePerm(pluginId, 'document.read')
      return doc ? { id: doc.id, width: doc.width, height: doc.height, name: doc.name, layerCount: doc.layers.length } : null
    case 'layer.info':
      requirePerm(pluginId, 'layer.read')
      return layer ? { id: layer.id, name: layer.name, kind: layer.kind, opacity: layer.opacity, visible: layer.visible, blendMode: layer.blendMode } : null
    case 'layer.getPixels': {
      requirePerm(pluginId, 'layer.read')
      const canvas = layer ? engine.layerCanvas(layer.id) : null
      if (!doc || !canvas) throw new Error('No active pixel layer')
      const img = getImageData(canvas)
      return { rgba: img.data.slice().buffer, width: img.width, height: img.height }
    }
    case 'layer.setPixels': {
      requirePerm(pluginId, 'layer.write')
      if (!doc || !layer) throw new Error('No active layer')
      const [imgLike] = args
      const w = imgLike.width | 0, h = imgLike.height | 0
      if (w !== doc.width || h !== doc.height) throw new Error(`setPixels size mismatch (${w}×${h} vs doc ${doc.width}×${doc.height})`)
      const l = engine.mutateLayerPixels(layer.id)
      if (!l?.canvas) throw new Error('Layer has no pixels')
      putImageData(l.canvas, new ImageData(new Uint8ClampedArray(imgLike.data), w, h))
      invalidateFlat(doc)
      engine.pushHistory(`Plugin: ${layer.name}`)
      engine.emit()
      return true
    }
    case 'layer.addPixels': {
      requirePerm(pluginId, 'layer.write')
      if (!doc) throw new Error('No active document')
      const [imgLike, name] = args
      const w = imgLike.width | 0, h = imgLike.height | 0
      const c = createCanvas(w, h)
      putImageData(c, new ImageData(new Uint8ClampedArray(imgLike.data), w, h))
      const made = engine.addLayerFromCanvas(c, String(name || 'Plugin Result'))
      return made ? { id: made.id, name: made.name } : null
    }
    case 'selection.getMask': {
      requirePerm(pluginId, 'selection.read')
      if (!doc) throw new Error('No active document')
      const alpha = doc.selection ? getMaskAlpha(doc.selection.mask) : new Uint8ClampedArray(doc.width * doc.height)
      return { data: alpha.buffer, width: doc.width, height: doc.height }
    }
    case 'selection.setMask': {
      requirePerm(pluginId, 'selection.write')
      if (!doc) throw new Error('No active document')
      const [maskLike, mode] = args
      const data = new Uint8ClampedArray(maskLike.data)
      if (data.length !== doc.width * doc.height) throw new Error('Selection mask size mismatch')
      engine.setSelectionAlpha(data, ['new', 'add', 'subtract', 'intersect'].includes(mode) ? mode : 'new', 'Plugin Selection')
      return true
    }
    case 'applyFilter': {
      requirePerm(pluginId, 'editor.commands')
      const [imgLike, type, params] = args
      const img = new ImageData(new Uint8ClampedArray(imgLike.data), imgLike.width | 0, imgLike.height | 0)
      const ops = await import('../image-ops')
      ops.applyFilter(img, type, params)
      return { data: img.data.buffer, width: img.width, height: img.height }
    }
    case 'applyAdjustment': {
      requirePerm(pluginId, 'editor.commands')
      const [imgLike, type, params] = args
      const img = new ImageData(new Uint8ClampedArray(imgLike.data), imgLike.width | 0, imgLike.height | 0)
      const ops = await import('../image-ops')
      ops.applyAdjustment(img, type, params)
      return { data: img.data.buffer, width: img.width, height: img.height }
    }
    case 'uxp.batchPlay':
      requirePerm(pluginId, 'editor.commands')
      return runUxpBatchPlay(args[0] ?? [])
    case 'uxp.imaging.getPixels': {
      requirePerm(pluginId, 'layer.read')
      const [options = {}] = args
      const doc0 = uxpDocCheck(options)
      const merged = options?.layerID === -1 || options?.layerID === 'merged' || options?.source === 'merged'
      const target = merged ? null : uxpTargetLayer(options)
      const canvas = merged ? getFlatComposite(doc0) : target ? engine.layerCanvasDocSpace(target.id) : null
      if (!canvas) throw new Error('No readable pixel layer for photoshop.imaging.getPixels')
      return uxpReadCanvas(canvas, options)
    }
    case 'uxp.imaging.putPixels': {
      requirePerm(pluginId, 'layer.write')
      const [options = {}] = args
      const doc0 = uxpDocCheck(options)
      const target = uxpTargetLayer(options)
      if (!target || target.locked || target.kind === 'adjustment') throw new Error('No writable target layer')
      const image = options?.imageData
      const src = uxpInputCanvas(image)
      const left = Math.round(Number(options?.targetBounds?.left ?? options?.x ?? 0) || 0)
      const top = Math.round(Number(options?.targetBounds?.top ?? options?.y ?? 0) || 0)
      const rightRaw = Number(options?.targetBounds?.right)
      const bottomRaw = Number(options?.targetBounds?.bottom)
      const dw = Math.max(1, Math.round(Number.isFinite(rightRaw) ? rightRaw - left : (Number(options?.targetBounds?.width) || src.width)))
      const dh = Math.max(1, Math.round(Number.isFinite(bottomRaw) ? bottomRaw - top : (Number(options?.targetBounds?.height) || src.height)))
      const layer0 = engine.mutateLayerPixels(target.id)
      if (!layer0?.canvas) throw new Error('Target layer has no writable pixels')
      const lc = ctx2d(layer0.canvas)
      const lx = left - (layer0.offsetX ?? 0)
      const ly = top - (layer0.offsetY ?? 0)
      if (options?.replace === true) lc.clearRect(lx, ly, dw, dh)
      lc.save()
      lc.globalAlpha = Math.max(0, Math.min(1, Number(options?.opacity ?? 1)))
      lc.drawImage(src, 0, 0, src.width, src.height, lx, ly, dw, dh)
      lc.restore()
      layer0._v++
      invalidateFlat(doc0)
      engine.pushHistory('UXP Imaging Put Pixels')
      engine.emit()
      return { width: dw, height: dh, targetBounds: { left, top, right: left + dw, bottom: top + dh } }
    }
    case 'uxp.imaging.getSelection': {
      requirePerm(pluginId, 'selection.read')
      const [options = {}] = args
      const doc0 = uxpDocCheck(options)
      const mask = createCanvas(doc0.width, doc0.height)
      const img = ctx2d(mask).createImageData(doc0.width, doc0.height)
      const alpha = doc0.selection ? getMaskAlpha(doc0.selection.mask) : new Uint8ClampedArray(doc0.width * doc0.height)
      for (let i = 0; i < alpha.length; i++) {
        const j = i * 4, v = alpha[i]
        img.data[j] = v; img.data[j + 1] = v; img.data[j + 2] = v; img.data[j + 3] = 255
      }
      putImageData(mask, img)
      return uxpReadCanvas(mask, options)
    }
    case 'uxp.imaging.putSelection': {
      requirePerm(pluginId, 'selection.write')
      const [options = {}] = args
      const doc0 = uxpDocCheck(options)
      const src = uxpInputCanvas(options?.imageData)
      const left = Math.round(Number(options?.targetBounds?.left ?? options?.x ?? 0) || 0)
      const top = Math.round(Number(options?.targetBounds?.top ?? options?.y ?? 0) || 0)
      const rightRaw = Number(options?.targetBounds?.right)
      const bottomRaw = Number(options?.targetBounds?.bottom)
      const dw = Math.max(1, Math.round(Number.isFinite(rightRaw) ? rightRaw - left : (Number(options?.targetBounds?.width) || src.width)))
      const dh = Math.max(1, Math.round(Number.isFinite(bottomRaw) ? bottomRaw - top : (Number(options?.targetBounds?.height) || src.height)))
      const scaled = createCanvas(dw, dh)
      ctx2d(scaled).drawImage(src, 0, 0, dw, dh)
      const sd = getImageData(scaled).data
      const alpha = new Uint8ClampedArray(doc0.width * doc0.height)
      for (let y = 0; y < dh; y++) {
        const yy = top + y
        if (yy < 0 || yy >= doc0.height) continue
        for (let x = 0; x < dw; x++) {
          const xx = left + x
          if (xx < 0 || xx >= doc0.width) continue
          const si = (y * dw + x) * 4
          const v = Math.round(sd[si] * .299 + sd[si + 1] * .587 + sd[si + 2] * .114)
          alpha[yy * doc0.width + xx] = v
        }
      }
      const mode = ['new', 'add', 'subtract', 'intersect'].includes(options?.mode) ? options.mode : 'new'
      engine.setSelectionAlpha(alpha, mode, 'UXP Imaging Selection')
      return true
    }
    case 'storage.get': {
      requirePerm(pluginId, 'storage')
      const [key] = args
      const raw = localStorage.getItem(PLUGIN_DATA_PREFIX + pluginId)
      const obj = raw ? JSON.parse(raw) : {}
      return obj[String(key)] ?? null
    }
    case 'storage.set': {
      requirePerm(pluginId, 'storage')
      const [key, value] = args
      const storageKey = PLUGIN_DATA_PREFIX + pluginId
      const raw = localStorage.getItem(storageKey)
      const obj = raw ? JSON.parse(raw) : {}
      obj[String(key)] = value
      const encoded = JSON.stringify(obj)
      if (encoded.length > 1024 * 1024) throw new Error('Plugin storage quota exceeded (1 MiB)')
      localStorage.setItem(storageKey, encoded)
      return true
    }
    case 'storage.delete': {
      requirePerm(pluginId, 'storage')
      const [key] = args
      const storageKey = PLUGIN_DATA_PREFIX + pluginId
      const raw = localStorage.getItem(storageKey)
      const obj = raw ? JSON.parse(raw) : {}
      delete obj[String(key)]
      localStorage.setItem(storageKey, JSON.stringify(obj))
      return true
    }
    case 'storage.keys': {
      requirePerm(pluginId, 'storage')
      const raw = localStorage.getItem(PLUGIN_DATA_PREFIX + pluginId)
      return Object.keys(raw ? JSON.parse(raw) : {})
    }
    case 'network.fetch': {
      requirePerm(pluginId, 'network')
      const [url, init] = args
      const u = new URL(String(url), location.href)
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Plugins may only fetch http(s) URLs')
      const method = String(init?.method || 'GET').toUpperCase()
      if (!['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(method)) throw new Error('Unsupported network method')
      const headers = new Headers(init?.headers || {})
      headers.delete('cookie'); headers.delete('authorization')
      const res = await fetch(u.toString(), { method, headers, body: init?.body ?? undefined, credentials: 'omit', redirect: 'follow' })
      const body = await res.text()
      if (body.length > 8 * 1024 * 1024) throw new Error('Plugin network response exceeds 8 MiB')
      return { ok: res.ok, status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], body }
    }
    case 'native.gmic': {
      requirePerm(pluginId, 'native.process')
      const [image, gmicArgs] = args
      return { image: await runNativeGmic(String(image), Array.isArray(gmicArgs) ? gmicArgs.map(String) : []) }
    }
    case 'native.gegl': {
      requirePerm(pluginId, 'native.process')
      const [image, operation, opArgs] = args
      return { image: await runNativeGegl(String(image), String(operation), Array.isArray(opArgs) ? opArgs.map(String) : []) }
    }
    case 'toast':
      requirePerm(pluginId, 'ui.toast')
      useEditorStore.getState().pushToast(String(args[0]), (args[1] as any) || 'info')
      return true
    case 'log':
      console.log('[plugin]', ...(args[0] as string[]))
      return true
    default:
      throw new Error('Unknown RPC method: ' + method)
  }
}

let plugins: StoredPlugin[] = load()

function normalizePlugin(p: StoredPlugin): StoredPlugin {
  const sourceFormat: PluginSourceFormat = p.sourceFormat ?? 'legacy'
  return {
    ...p,
    sourceFormat,
    commands: Array.isArray(p.commands) ? p.commands : [],
    enabled: p.enabled !== false,
    grantedPermissions: p.grantedPermissions ?? p.manifest?.permissions ?? LEGACY_PERMS,
  }
}
function load(): StoredPlugin[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    return Array.isArray(raw) ? raw.map(normalizePlugin) : []
  } catch { return [] }
}
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(plugins)) } catch { /* quota */ } }
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
    if (m) { try { manifest = JSON.parse(m[1]) } catch { /* bad header json */ } }
  }
  if (!manifest) {
    manifest = {
      id: 'user-' + fallbackName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      name: fallbackName.replace(/\.[^.]+$/, ''), version: '1.0.0', description: 'User-installed plugin', apiVersion: 2,
      permissions: LEGACY_PERMS,
    }
  }
  if (!manifest.id) manifest.id = 'user-' + Date.now().toString(36)
  if (!manifest.name) manifest.name = manifest.id
  if (!manifest.permissions) manifest.permissions = LEGACY_PERMS
  return { manifest, code, enabled: true, commands: [], sourceFormat: 'zphoto', grantedPermissions: manifest.permissions }
}

function postDiscover(p: StoredPlugin) {
  const w = ensureWorker()
  if (w) w.postMessage({ kind: 'run', pluginId: p.manifest.id, commandId: null, code: p.code, format: p.sourceFormat ?? 'zphoto' })
}

export const pluginManager = {
  onChange(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) },
  list(): StoredPlugin[] { return plugins.map(p => ({ ...p, manifest: { ...p.manifest }, commands: [...p.commands] })) },

  async install(manifest: PluginManifest, code: string, opts?: { sourceFormat?: PluginSourceFormat; compatibility?: StoredPlugin['compatibility'] }): Promise<StoredPlugin | null> {
    if (plugins.some(p => p.manifest.id === manifest.id)) {
      useEditorStore.getState().pushToast(`Plugin "${manifest.name}" is already installed`, 'error'); return null
    }
    const plugin: StoredPlugin = {
      manifest: { ...manifest, permissions: manifest.permissions ?? LEGACY_PERMS }, code, enabled: true, commands: [],
      sourceFormat: opts?.sourceFormat ?? 'zphoto', compatibility: opts?.compatibility,
      grantedPermissions: manifest.permissions ?? LEGACY_PERMS,
    }
    plugins.push(plugin); save(); notify(); postDiscover(plugin)
    return plugin
  },

  async installFromFile(file: File): Promise<StoredPlugin | null> {
    const text = await file.text()
    const plugin = parsePluginSource(text, file.name)
    const installed = await pluginManager.install(plugin.manifest, plugin.code, { sourceFormat: plugin.sourceFormat, compatibility: plugin.compatibility })
    if (installed) useEditorStore.getState().pushToast(`Installed plugin "${installed.manifest.name}"`, 'success')
    return installed
  },

  /** Install an unpacked Photoshop UXP plugin. Callers pass manifest.json plus
   * the referenced entry JS file (or any main JS they selected). */
  async installUxp(manifestText: string, code: string, fallbackName = 'Photoshop UXP Plugin'): Promise<StoredPlugin | null> {
    let manifest: any
    try { manifest = JSON.parse(manifestText) } catch { throw new Error('UXP manifest.json is invalid JSON') }
    const candidate = uxpManifestToPlugin(manifest, code, fallbackName)
    return pluginManager.install(candidate.manifest, candidate.code, { sourceFormat: 'uxp', compatibility: candidate.compatibility ?? analyzeUxpCompatibility(manifest, code) })
  },

  async setEnabled(id: string, enabled: boolean): Promise<void> { const p = plugins.find(p => p.manifest.id === id); if (p) { p.enabled = enabled; save(); notify() } },
  async setPermissions(id: string, permissions: PluginPermission[]): Promise<void> { const p = plugins.find(p => p.manifest.id === id); if (p) { p.grantedPermissions = [...new Set(permissions)]; save(); notify() } },
  async uninstall(id: string): Promise<void> { plugins = plugins.filter(p => p.manifest.id !== id); try { localStorage.removeItem(PLUGIN_DATA_PREFIX + id) } catch {} save(); notify() },

  async runCommand(pluginId: string, commandId: string | null): Promise<void> {
    const p = plugins.find(p => p.manifest.id === pluginId)
    if (!p || !p.enabled) return
    const doc = engine.activeDoc, layer = engine.activeLayer
    if (!doc || !layer) { useEditorStore.getState().pushToast('Open a document with an active layer first', 'error'); return }
    if (layer.kind === 'adjustment') { useEditorStore.getState().pushToast('Plugin needs a pixel-capable layer', 'error'); return }
    if (layer.locked && pluginPerms(p).includes('layer.write')) { useEditorStore.getState().pushToast('Layer is locked', 'error'); return }
    const w = ensureWorker()
    if (!w) { useEditorStore.getState().pushToast('Plugin sandbox unavailable in this browser', 'error'); return }
    w.postMessage({ kind: 'run', pluginId, commandId, code: p.code, format: p.sourceFormat ?? 'zphoto' })
  },
}
