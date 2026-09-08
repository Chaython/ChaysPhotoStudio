// Scripting API exposed to the Scripting Console dialog
// Mirrors a pragmatic subset of the Photoshop UXP/ExtendScript object model
import type { Engine } from './engine'
import { compositeDocument } from './document'
import { getImageData, putImageData, ctx2d, createCanvas } from '../utils/canvas'
import * as imageOps from '../image-ops'
import type { AdjustmentType, FilterType } from '../types'

export interface ScriptLayerApi {
  name: string
  visible: boolean
  opacity: number
  blendMode: string
  kind: string
  setName(n: string): void
  setOpacity(o: number): void
  setVisible(v: boolean): void
  setBlendMode(m: string): void
  duplicate(): ScriptLayerApi | null
  remove(): void
  rasterize(): void
}

export function getScriptApi(engine: Engine) {
  const log: (...args: any[]) => void = (...args) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
    logSink?.(msg)
  }
  const layerApi = (id: string): ScriptLayerApi => ({
    get name() { return engine.layerById(id)?.name ?? '' },
    set name(v) { engine.setLayerProps(id, { name: v }, { silent: true }) },
    get visible() { return engine.layerById(id)?.visible ?? false },
    set visible(v) { engine.setLayerProps(id, { visible: v }, { silent: true }) },
    get opacity() { return engine.layerById(id)?.opacity ?? 100 },
    set opacity(v) { engine.setLayerProps(id, { opacity: Math.max(0, Math.min(100, v)) }, { silent: true }) },
    get blendMode() { return engine.layerById(id)?.blendMode ?? 'normal' },
    set blendMode(v: string) { engine.setLayerProps(id, { blendMode: v as any }, { silent: true }) },
    get kind() { return engine.layerById(id)?.kind ?? 'raster' },
    setName(n) { engine.setLayerProps(id, { name: n }) },
    setOpacity(o) { engine.setLayerProps(id, { opacity: o }) },
    setVisible(v) { engine.setLayerProps(id, { visible: v }) },
    setBlendMode(m: string) { engine.setLayerProps(id, { blendMode: m as any }) },
    duplicate() { const d = engine.duplicateLayer(id); return d ? layerApi(d.id) : null },
    remove() { engine.deleteLayer(id) },
    rasterize() { engine.rasterizeLayer(id) },
  })

  return {
    version: '1.0',
    log,
    // ---- app ----
    app: {
      get name() { return "Chay's Photo Studio" },
      get version() { return '1.0.0' },
      get documents() { return engine.docs.map(d => docApi(d.id)) },
      get activeDocument() { return engine.activeDoc ? docApi(engine.activeDoc.id) : null },
      open() { log('Use File > Open in the UI — scripts cannot browse files'); return null },
      foregroundColor: { get hex() { return fgHook?.() ?? '#ffffff' }, set hex(v: string) { fgHook?.(v) } },
      backgroundColor: { get hex() { return bgHook?.() ?? '#000000' }, set hex(v: string) { bgHook?.(v) } },
    },
  }

  function docApi(docId: string) {
    return {
      get name() { return engine.docs.find(d => d.id === docId)?.name ?? '' },
      get width() { return engine.docs.find(d => d.id === docId)?.width ?? 0 },
      get height() { return engine.docs.find(d => d.id === docId)?.height ?? 0 },
      get layers() {
        const doc = engine.docs.find(d => d.id === docId)
        return doc ? doc.layers.map(l => layerApi(l.id)) : []
      },
      get activeLayer() {
        const doc = engine.docs.find(d => d.id === docId)
        return doc?.activeLayerId ? layerApi(doc.activeLayerId) : null
      },
      setActiveLayer(id: string) {
        const doc = engine.docs.find(d => d.id === docId)
        if (doc?.layers.find(l => l.id === id)) { doc.activeLayerId = id; engine.emit() }
      },
      selection: {
        selectAll() { const prev = engine.activeDoc?.id; engine.setActiveDocument(docId); engine.selectAll(); if (prev) engine.setActiveDocument(prev) },
        deselect() { const prev = engine.activeDoc?.id; engine.setActiveDocument(docId); engine.deselect(); if (prev) engine.setActiveDocument(prev) },
        invert() { const prev = engine.activeDoc?.id; engine.setActiveDocument(docId); engine.invertSelection(); if (prev) engine.setActiveDocument(prev) },
        feather(px: number) { const prev = engine.activeDoc?.id; engine.setActiveDocument(docId); engine.selectionModify('feather', px); if (prev) engine.setActiveDocument(prev) },
      },
      addLayer(name?: string) { const prev = engine.activeDoc?.id; engine.setActiveDocument(docId); const l = engine.addRasterLayer(name); if (prev) engine.setActiveDocument(prev); return l ? layerApi(l.id) : null },
      applyFilter(type: FilterType, params: Record<string, any> = {}) {
        const prev = engine.activeDoc?.id
        engine.setActiveDocument(docId)
        const doc = engine.docs.find(d => d.id === docId)!
        // apply to composite as new layer (document-level filter)
        const flat = compositeDocument(doc)
        const img = getImageData(flat)
        imageOps.applyFilter(img, type, params)
        putImageData(flat, img)
        const layerName = `Script: ${type}`
        const c = createCanvas(doc.width, doc.height)
        ctx2d(c).drawImage(flat, 0, 0)
        engine.addLayerFromCanvas(c, layerName)
        if (prev) engine.setActiveDocument(prev)
      },
      applyAdjustment(type: AdjustmentType, params: Record<string, any> = {}) {
        const prev = engine.activeDoc?.id
        engine.setActiveDocument(docId)
        engine.addAdjustmentLayer(type, params)
        if (prev) engine.setActiveDocument(prev)
      },
      resize(w: number, h: number) { const prev = engine.activeDoc?.id; engine.setActiveDocument(docId); engine.resizeImage({ w, h }); if (prev) engine.setActiveDocument(prev) },
      /** AI upscaler handler — Lanczos + edge-adaptive detail engine (scale 0.25..4) */
      async aiUpscale(scale = 2, opts: { detail?: number; denoise?: number } = {}) {
        const prev = engine.activeDoc?.id
        engine.setActiveDocument(docId)
        const ok = await engine.aiUpscale({ scale, detail: opts.detail, denoise: opts.denoise })
        if (prev) engine.setActiveDocument(prev)
        return ok
      },
      /** cloud (neural) AI upscale — returns the new enhanced document's id (or null) */
      async aiUpscaleCloud(scale = 2, opts: { detail?: number } = {}) {
        const prev = engine.activeDoc?.id
        engine.setActiveDocument(docId)
        const nd = await engine.aiUpscaleCloud({ scale, detail: opts.detail })
        if (prev) engine.setActiveDocument(prev)
        return nd?.id ?? null
      },
      rotate(deg: number) { const prev = engine.activeDoc?.id; engine.setActiveDocument(docId); engine.rotateCanvas(deg); if (prev) engine.setActiveDocument(prev) },
      flip(dir: 'horizontal' | 'vertical') { const prev = engine.activeDoc?.id; engine.setActiveDocument(docId); engine.flipCanvas(dir); if (prev) engine.setActiveDocument(prev) },
      flatten() { const prev = engine.activeDoc?.id; engine.setActiveDocument(docId); engine.flatten(); if (prev) engine.setActiveDocument(prev) },
      async export(opts: { format?: 'png' | 'jpeg' | 'webp'; quality?: number; fileName?: string } = {}) {
        const prev = engine.activeDoc?.id
        engine.setActiveDocument(docId)
        const doc = engine.activeDoc!
        await engine.exportActive({ format: opts.format ?? 'png', quality: opts.quality ?? 92, scale: 1, fileName: opts.fileName ?? doc.name }, doc)
        if (prev) engine.setActiveDocument(prev)
      },
    }
  }
}

// hooks wired by the script console dialog
let logSink: ((msg: string) => void) | null = null
let fgHook: ((v?: string) => string | undefined) | null = null
let bgHook: ((v?: string) => string | undefined) | null = null

export function setScriptHooks(hooks: {
  log?: (msg: string) => void
  fg?: (v?: string) => string | undefined
  bg?: (v?: string) => string | undefined
}) {
  if (hooks.log) logSink = hooks.log
  if (hooks.fg) fgHook = hooks.fg
  if (hooks.bg) bgHook = hooks.bg
}
