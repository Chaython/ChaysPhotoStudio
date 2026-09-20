// ============================================================
// Chay's Photo Engine — the single facade API for tools, panels, dialogs, menus
// Owns: documents, layers, selection, history, strokes, actions, previews
// ============================================================
import type {
  AdjustmentType, AnimFrame, BlendIfSettings, DialogType, ExportOptions, FilterType, Layer, LayerFX, LayerKind,
  PsDocument, PsAction, ActionStep, Rect, SelectionCombine, SelectionState, ShapeSpec, TextSpec,
  ChannelView, BrushSettings, BlendMode,
} from '../types'
import { TOOL_MAP, BLEND_GCO } from '../constants/tools'
import {
  createCanvas, ctx2d, cloneCanvas, uid, getImageData, putImageData,
  hexToRgb, rgbToHex, clamp, drawSoftDab, canvasToBlob, downloadBlob, getMaskAlpha,
} from '../utils/canvas'
import {
  compositeDocument, getFlatComposite, invalidateFlat, newLayer,
  renderShapeCanvas, renderTextCanvas, prepareLayer,
} from './document'
import { gaussianBlurChannel } from '../image-ops/core'
import { autoTone, autoContrast, autoColor } from '../image-ops/auto'
import { runPixelOpFromCanvas, type PixelOpSpec } from './pixel-worker'
import { isGlEnabled, setGlEnabled, glInfo, glAvailable } from './gl/gl-core'
import { resampleCanvas } from '../utils/canvas'
import {
  combineSelection, selectionFromMask, maskCanvasFromAlpha, modifySelection,
  channelMaskFromComposite, computeBounds,
} from './selection'
import { getScriptApi } from './scripting-api'
import * as imageOps from '../image-ops'

export const MAX_HISTORY = 50

type Listener = () => void

/** 1×1 scratch context for measuring text (layerContentRect) — measureText
 *  only needs the font state, never the backing store size */
let _textCtx: CanvasRenderingContext2D | null = null
function textMeasureCtx(): CanvasRenderingContext2D {
  if (!_textCtx) {
    const c = document.createElement('canvas')
    c.width = 1; c.height = 1
    _textCtx = c.getContext('2d')!
  }
  return _textCtx
}

export interface UIBridge {
  openDialog(type: DialogType, props?: Record<string, any>): void
  toast(msg: string, type?: 'info' | 'success' | 'error'): void
}

export class Engine {
  docs: PsDocument[] = []
  private _activeId: string | null = null
  private listeners = new Set<Listener>()
  private renderer: { requestRender(): void } | null = null
  ui: UIBridge | null = null

  // clone stamp source
  cloneSource: { x: number; y: number; layerId: string | null } | null = null

  // actions recorder
  actions: PsAction[] = []
  private recordingAction: PsAction | null = null

  onChange(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  setRenderer(r: { requestRender(): void; pokeOverlay?(): void; viewChanged?(): void }) { this.renderer = r }
  requestRender() { this.renderer?.requestRender() }
  /** overlay-only repaint (selection previews, paths, marching ants) — no composite */
  pokeOverlay() { (this.renderer as any)?.pokeOverlay?.() }
  /** view-only repaint (pan/zoom re-blit of the cached composite) — no composite */
  viewChanged() { (this.renderer as any)?.viewChanged?.() }
  emit() {
    // Keep multi-layer selection coherent no matter which subsystem changed
    // activeLayerId. The active layer is always the primary member.
    const doc = this.activeDoc
    if (doc) {
      const valid = (doc.selectedLayerIds ?? []).filter(id => doc.layers.some(l => l.id === id))
      if (doc.activeLayerId) {
        doc.selectedLayerIds = valid.includes(doc.activeLayerId) ? valid : [doc.activeLayerId]
      } else {
        doc.selectedLayerIds = []
      }
    }
    this.requestRender()
    for (const l of this.listeners) l()
  }
  /** selection-only change: listeners + overlay repaint, main canvas untouched */
  emitOverlay() {
    this.pokeOverlay()
    for (const l of this.listeners) l()
  }
  /** view-only change (pan/zoom): listeners (zoom readout) + re-blit, no composite */
  emitView() {
    this.viewChanged()
    for (const l of this.listeners) l()
  }

  get activeDoc(): PsDocument | null {
    return this.docs.find(d => d.id === this._activeId) ?? null
  }
  get doc(): PsDocument | null { return this.activeDoc }
  get activeLayer(): Layer | null {
    const d = this.activeDoc
    if (!d) return null
    return d.layers.find(l => l.id === d.activeLayerId) ?? null
  }
  layerById(id: string): Layer | null {
    const d = this.activeDoc
    return d ? d.layers.find(l => l.id === id) ?? null : null
  }
  layerCanvas(layerId: string): HTMLCanvasElement | null {
    const l = this.layerById(layerId)
    if (!l) return null
    if (l.kind === 'raster') return l.canvas
    if (l.kind === 'smart' || l.kind === 'text' || l.kind === 'shape') return prepareLayer(this.activeDoc!, l)
    return null
  }

  /** layer pixels registered in DOC space (for sampling at doc coordinates):
   *  smart/text/shape render doc-space; a raster layer with an offset gets a
   *  doc-space COPY (non-destructive — the layer keeps its off-canvas pixels). */
  layerCanvasDocSpace(layerId: string): HTMLCanvasElement | null {
    const l = this.layerById(layerId)
    const doc = this.activeDoc
    if (!l || !doc) return null
    if (l.kind === 'raster') {
      if (!l.canvas) return null
      const ox = l.offsetX ?? 0, oy = l.offsetY ?? 0
      if (!ox && !oy && l.canvas.width === doc.width && l.canvas.height === doc.height) return l.canvas
      const c = createCanvas(doc.width, doc.height)
      ctx2d(c).drawImage(l.canvas, ox, oy)
      return c
    }
    return this.layerCanvas(layerId)
  }

  /** BAKE a raster layer's offset into doc-space pixels (offset → 0).
   *  Used before ops that assume canvas == doc space (Liquify, canvas rotate).
   *  Off-canvas pixels beyond the doc rect are dropped — call only when needed. */
  bakeRasterLayer(layerId: string): Layer | null {
    const l = this.layerById(layerId)
    const doc = this.activeDoc
    if (!l || !doc || l.kind !== 'raster' || !l.canvas) return l ?? null
    const ox = l.offsetX ?? 0, oy = l.offsetY ?? 0
    if (!ox && !oy) return l
    const c = createCanvas(doc.width, doc.height)
    ctx2d(c).drawImage(l.canvas, ox, oy)
    l.canvas = c
    l.offsetX = 0
    l.offsetY = 0
    l._v++
    invalidateFlat(doc)
    return l
  }

  // ================================================== document management
  newDocument(opts: { name?: string; width: number; height: number; fill?: 'white' | 'transparent' | 'background' | string }): PsDocument {
    const { width, height } = opts
    const doc: PsDocument = {
      id: uid(), name: opts.name || `Untitled-${this.docs.length + 1}`,
      width, height,
      layers: [], activeLayerId: null,
      selection: null, channelView: 'rgb', savedChannels: [],
      view: { zoom: 1, panX: 0, panY: 0 },
      history: { states: [], index: -1 },
      dirty: false,
      previewFilter: null, previewAdjustment: null,
      _epoch: 1, guides: [], _stroke: null, _strokeLayerId: null, _strokeErase: false, _strokeOpacity: 1, _strokeBlendMode: 'normal', _strokeBbox: null, _strokeV: 0, _liveDrag: null,
    }
    const bg = newLayer('raster', 'Background', width, height)
    if (opts.fill && opts.fill !== 'transparent') {
      const c = ctx2d(bg.canvas!)
      if (opts.fill === 'white') { c.fillStyle = '#ffffff'; c.fillRect(0, 0, width, height) }
      else if (opts.fill === 'background') { /* transparent — placeholder */ }
      else { c.fillStyle = opts.fill; c.fillRect(0, 0, width, height) }
    } else {
      bg.name = 'Layer 1'
    }
    doc.layers.push(bg)
    doc.activeLayerId = bg.id
    this.docs.push(doc)
    this._activeId = doc.id
    this.pushHistory('New Document', doc)
    this.emit()
    return doc
  }

  addCanvasDocument(canvas: HTMLCanvasElement, name: string): PsDocument {
    const doc: PsDocument = {
      id: uid(), name,
      width: canvas.width, height: canvas.height,
      layers: [], activeLayerId: null,
      selection: null, channelView: 'rgb', savedChannels: [],
      view: { zoom: 1, panX: 0, panY: 0 },
      history: { states: [], index: -1 },
      dirty: false,
      previewFilter: null, previewAdjustment: null,
      _epoch: 1, guides: [], _stroke: null, _strokeLayerId: null, _strokeErase: false, _strokeOpacity: 1, _strokeBlendMode: 'normal', _strokeBbox: null, _strokeV: 0, _liveDrag: null,
    }
    const layer = newLayer('raster', name.replace(/\.[^.]+$/, ''), canvas.width, canvas.height)
    ctx2d(layer.canvas!).drawImage(canvas, 0, 0)
    doc.layers.push(layer)
    doc.activeLayerId = layer.id
    this.docs.push(doc)
    this._activeId = doc.id
    this.pushHistory('Open', doc)
    this.emit()
    return doc
  }

  closeDocument(id: string, force = false) {
    const idx = this.docs.findIndex(d => d.id === id)
    if (idx < 0) return
    const doc = this.docs[idx]
    if (!force && doc.dirty && typeof window !== 'undefined') {
      const ok = window.confirm(`Close “${doc.name}” without saving?\n\nAn autosave recovery snapshot may exist, but you should save important work explicitly.`)
      if (!ok) return
    }
    this.docs.splice(idx, 1)
    if (this._activeId === id) {
      this._activeId = this.docs[Math.min(idx, this.docs.length - 1)]?.id ?? null
    }
    this.emit()
  }

  setActiveDocument(id: string) {
    if (!this.docs.find(d => d.id === id)) return
    this._activeId = id
    this.emit()
  }

  duplicateDocument(): PsDocument | null {
    const src = this.activeDoc
    if (!src) return null
    const flat = compositeDocument(src)
    const doc = this.addCanvasDocument(flat, `${src.name} copy`)
    return doc
  }

  // ================================================== history
  pushHistory(label: string, doc: PsDocument = this.activeDoc!) {
    if (!doc) return
    const st = this.captureState(doc, label)
    const h = doc.history
    h.states = h.states.slice(0, h.index + 1)
    h.states.push(st)
    while (h.states.length > MAX_HISTORY) {
      h.states.shift()
      if (typeof doc.historyBrushSourceIndex === 'number') doc.historyBrushSourceIndex--
    }
    h.index = h.states.length - 1
    if (typeof doc.historyBrushSourceIndex === 'number') {
      doc.historyBrushSourceIndex = clamp(doc.historyBrushSourceIndex, 0, Math.max(0, h.states.length - 1))
    }
    doc.dirty = true
  }

  private captureState(doc: PsDocument, label: string) {
    return {
      label, time: Date.now(),
      layers: doc.layers.map(l => ({ ...l })),
      activeLayerId: doc.activeLayerId,
      selection: doc.selection ? { ...doc.selection } : null,
      width: doc.width, height: doc.height,
      channelView: doc.channelView,
      savedChannels: doc.savedChannels.map(c => ({ ...c })),
    }
  }

  private restoreState(doc: PsDocument, st: any) {
    doc.layers = st.layers.map((l: any) => ({ ...l }))
    doc.activeLayerId = st.activeLayerId
    doc.selection = st.selection ? { ...st.selection } : null
    doc.width = st.width; doc.height = st.height
    doc.channelView = st.channelView
    doc.savedChannels = st.savedChannels.map((c: any) => ({ ...c }))
    doc._stroke = null; doc._strokeLayerId = null; doc._strokeBlendMode = 'normal'; doc._strokeBbox = null
    doc.previewFilter = null; doc.previewAdjustment = null
    doc._epoch++
    invalidateFlat(doc)
  }

  undo() {
    const doc = this.activeDoc
    if (!doc || doc.history.index <= 0) return
    doc.history.index--
    this.restoreState(doc, doc.history.states[doc.history.index])
    this.emit()
  }

  redo() {
    const doc = this.activeDoc
    const h = doc?.history
    if (!doc || !h || h.index >= h.states.length - 1) return
    h.index++
    this.restoreState(doc, h.states[h.index])
    this.emit()
  }

  jumpHistory(i: number) {
    const doc = this.activeDoc
    if (!doc) return
    const h = doc.history
    const idx = clamp(i, 0, h.states.length - 1)
    if (idx === h.index) return
    h.index = idx
    this.restoreState(doc, h.states[idx])
    this.emit()
  }

  setHistoryBrushSource(i: number) {
    const doc = this.activeDoc
    if (!doc?.history.states.length) return
    doc.historyBrushSourceIndex = clamp(Math.round(i), 0, doc.history.states.length - 1)
    this.emit()
  }

  // ================================================== COW mutation helpers
  /** Call BEFORE mutating a layer's pixels — clones canvas so history stays intact. */
  mutateLayerPixels(layerId: string): Layer | null {
    const doc = this.activeDoc
    const layer = this.layerById(layerId)
    if (!doc || !layer) return null
    if (layer.kind === 'adjustment') { this.ui?.toast('Adjustment layers have no pixels — rasterize first', 'error'); return null }
    if (layer.kind !== 'raster') this.rasterizeLayer(layer.id)
    const l = this.layerById(layerId)!
    if (l.canvas) l.canvas = cloneCanvas(l.canvas)
    l._v++
    invalidateFlat(doc)
    return l
  }

  mutateLayerMask(layerId: string): Layer | null {
    const doc = this.activeDoc
    const layer = this.layerById(layerId)
    if (!doc || !layer) return null
    if (!layer.mask) return null
    layer.mask = cloneCanvas(layer.mask)
    layer._mv++
    invalidateFlat(doc)
    return layer
  }

  mutateSelection(): SelectionState | null {
    const doc = this.activeDoc
    if (!doc || !doc.selection) return null
    doc.selection = { ...doc.selection, mask: cloneCanvas(doc.selection.mask), _v: doc.selection._v + 1, _paths: null, _pathsV: -1 }
    return doc.selection
  }

  // ================================================== layers
  addRasterLayer(name?: string, opts?: { canvas?: HTMLCanvasElement }): Layer | null {
    const doc = this.activeDoc
    if (!doc) return null
    const layer = newLayer('raster', name || this.nextLayerName(), doc.width, doc.height)
    if (opts?.canvas) ctx2d(layer.canvas!).drawImage(opts.canvas, 0, 0)
    doc.layers.push(layer)
    doc.activeLayerId = layer.id
    this.pushHistory('New Layer')
    this.recordStep({ op: 'addLayer', args: { name: layer.name }, label: 'Add Layer' })
    this.emit()
    return layer
  }

  addLayerFromCanvas(canvas: HTMLCanvasElement, name?: string, opts?: { center?: boolean }): Layer | null {
    const doc = this.activeDoc
    if (!doc) return null
    const layer = newLayer('raster', name || this.nextLayerName(), doc.width, doc.height)
    if (opts?.center !== false && (canvas.width !== doc.width || canvas.height !== doc.height)) {
      // keep the pixels at native size, registered in the doc CENTER — nothing
      // is cropped and the layer can be moved/transformed losslessly afterwards
      layer.canvas = cloneCanvas(canvas)
      layer.offsetX = Math.round((doc.width - canvas.width) / 2)
      layer.offsetY = Math.round((doc.height - canvas.height) / 2)
    } else {
      ctx2d(layer.canvas!).drawImage(canvas, 0, 0)
    }
    doc.layers.push(layer)
    doc.activeLayerId = layer.id
    this.pushHistory('Place Layer')
    this.emit()
    return layer
  }

  /** Photoshop-style "Layer via Copy" for AI-detected object boxes: lifts the
   *  doc-space region out of the FLATTENED composite (so an object spanning
   *  several layers comes out whole) into a new raster layer. The layer keeps
   *  native pixel size and is registered at the region origin via offsets —
   *  no resampling, fully movable/transformable afterwards, and the original
   *  pixels below stay untouched (non-destructive copy, like Ctrl+J). */
  addObjectLayer(rect: { x: number; y: number; w: number; h: number }, name?: string): Layer | null {
    const doc = this.activeDoc
    if (!doc) return null
    // clamp to doc space (ints; boxes arrive as fractions × doc size)
    const x = Math.round(clamp(rect.x, 0, doc.width - 1))
    const y = Math.round(clamp(rect.y, 0, doc.height - 1))
    const w = Math.round(clamp(rect.w, 1, doc.width - x))
    const h = Math.round(clamp(rect.h, 1, doc.height - y))
    if (w < 1 || h < 1) return null
    const flat = getFlatComposite(doc) // full-resolution, pre-add composite
    const region = createCanvas(w, h)
    ctx2d(region).drawImage(flat, -x, -y)
    const label = (name || 'Object').trim().slice(0, 32) || 'Object'
    const layerName = label.charAt(0).toUpperCase() + label.slice(1)
    const layer = newLayer('raster', layerName, doc.width, doc.height)
    layer.canvas = region
    layer.offsetX = x
    layer.offsetY = y
    layer.origin = 'detect'
    doc.layers.push(layer)
    doc.activeLayerId = layer.id
    this.pushHistory(`Layer from “${layerName}”`)
    this.emit()
    return layer
  }

  placeSmartLayer(canvas: HTMLCanvasElement, name?: string): Layer | null {
    const doc = this.activeDoc
    if (!doc) return null
    const layer = newLayer('smart', name || this.nextLayerName(), doc.width, doc.height)
    layer.source = canvas
    layer.transform = { x: doc.width / 2, y: doc.height / 2, scale: Math.min(1, Math.min(doc.width / canvas.width, doc.height / canvas.height)), rotation: 0 }
    layer.canvas = null
    doc.layers.push(layer)
    doc.activeLayerId = layer.id
    this.pushHistory('Place Smart Object')
    this.emit()
    return layer
  }

  addAdjustmentLayer(type: AdjustmentType, params?: Record<string, any>): Layer | null {
    const doc = this.activeDoc
    if (!doc) return null
    const layer = newLayer('adjustment', `${typeLabel(type)} 1`, doc.width, doc.height)
    layer.canvas = null
    layer.adjustment = { type, params: params ?? structuredClone(imageOps.ADJUSTMENTS[type]?.defaults ?? {}) }
    doc.layers.push(layer)
    doc.activeLayerId = layer.id
    this.pushHistory('New Adjustment Layer')
    this.recordStep({ op: 'addAdjustmentLayer', args: { type, params: layer.adjustment.params }, label: 'Add Adjustment' })
    this.emit()
    return layer
  }

  addTextLayer(spec: Partial<TextSpec>): Layer | null {
    const doc = this.activeDoc
    if (!doc) return null
    const layer = newLayer('text', spec.content?.split('\n')[0]?.slice(0, 24) || 'Type Layer', doc.width, doc.height)
    layer.text = {
      content: 'Type here', fontFamily: 'Georgia, serif', fontSize: 48, color: '#ffffff',
      bold: false, italic: false, underline: false, strikethrough: false,
      align: 'left', lineHeight: 1.2, tracking: 0,
      x: 40, y: 40, ...spec,
    }
    layer.canvas = null
    doc.layers.push(layer)
    doc.activeLayerId = layer.id
    this.pushHistory('New Text Layer')
    this.emit()
    return layer
  }

  addShapeLayer(spec: Partial<ShapeSpec>): Layer | null {
    const doc = this.activeDoc
    if (!doc) return null
    const layer = newLayer('shape', 'Shape Layer', doc.width, doc.height)
    layer.shape = {
      shape: 'rect', x: 0, y: 0, w: 100, h: 100, radius: 12,
      fill: '#e8a33d', fillOpacity: 100, stroke: null, strokeWidth: 4, strokeOpacity: 100,
      lineCap: 'round', dash: 'solid', arrowStart: false, arrowEnd: false,
      sides: 5, starInset: 45, ...spec,
    }
    layer.canvas = null
    doc.layers.push(layer)
    doc.activeLayerId = layer.id
    this.pushHistory('New Shape Layer')
    this.emit()
    return layer
  }

  duplicateLayer(id?: string): Layer | null {
    const doc = this.activeDoc
    const src = id ? this.layerById(id) : this.activeLayer
    if (!doc || !src) return null
    const copy: Layer = { ...src, id: uid(), name: `${src.name} copy`, _v: src._v + 1 }
    if (src.canvas) copy.canvas = cloneCanvas(src.canvas)
    if (src.mask) copy.mask = cloneCanvas(src.mask)
    if (src.source) copy.source = cloneCanvas(src.source)
    copy.smartFilters = src.smartFilters.map(f => ({ ...f, id: uid() }))
    if (src.adjustment) copy.adjustment = { ...src.adjustment, params: { ...src.adjustment.params } }
    if (src.text) copy.text = { ...src.text }
    if (src.shape) copy.shape = { ...src.shape }
    const idx = doc.layers.findIndex(l => l.id === src.id)
    doc.layers.splice(idx + 1, 0, copy)
    doc.activeLayerId = copy.id
    this.pushHistory('Duplicate Layer')
    this.emit()
    return copy
  }

  deleteLayer(id?: string) {
    const doc = this.activeDoc
    const layer = id ? this.layerById(id) : this.activeLayer
    if (!doc || !layer) return
    if (doc.layers.length <= 1) { this.ui?.toast('Cannot delete the last layer', 'error'); return }
    doc.layers = doc.layers.filter(l => l.id !== layer.id)
    if (doc.activeLayerId === layer.id) {
      doc.activeLayerId = doc.layers[Math.min(doc.layers.length - 1, doc.layers.findIndex(l => l.id === layer.id))]?.id ?? doc.layers[doc.layers.length - 1].id
    }
    this.pushHistory('Delete Layer')
    this.emit()
  }

  moveLayerBy(id: string, delta: number) {
    const doc = this.activeDoc
    if (!doc) return
    const idx = doc.layers.findIndex(l => l.id === id)
    if (idx < 0) return
    const to = clamp(idx + delta, 0, doc.layers.length - 1)
    const [l] = doc.layers.splice(idx, 1)
    doc.layers.splice(to, 0, l)
    this.pushHistory('Reorder Layer')
    this.emit()
  }

  reorderLayer(id: string, toIndex: number) {
    const doc = this.activeDoc
    if (!doc) return
    const idx = doc.layers.findIndex(l => l.id === id)
    if (idx < 0 || toIndex === idx) return
    const [l] = doc.layers.splice(idx, 1)
    doc.layers.splice(clamp(toIndex, 0, doc.layers.length), 0, l)
    this.pushHistory('Reorder Layer')
    this.emit()
  }

  setLayerProps(id: string, patch: Partial<Layer>, opts?: { history?: boolean; label?: string; silent?: boolean }) {
    const doc = this.activeDoc
    const layer = this.layerById(id)
    if (!doc || !layer) return
    Object.assign(layer, patch)
    // keep the active animation frame in sync (Task 9-c) — defensive, no-op
    // when the document has no frame animation
    if (this.timelineActive && doc.frames?.length) {
      const fr = doc.frames[this.activeFrameIndex]
      if (fr) {
        const rec = fr.layers[id] ?? {}
        if ('visible' in patch) rec.visible = patch.visible
        if ('opacity' in patch) rec.opacity = patch.opacity
        if ('x' in patch) rec.x = patch.x as number | undefined
        if ('y' in patch) rec.y = patch.y as number | undefined
        if (patch.offsetX !== undefined) rec.x = patch.offsetX
        if (patch.offsetY !== undefined) rec.y = patch.offsetY
        if (patch.transform) { rec.x = patch.transform.x; rec.y = patch.transform.y }
        if (patch.text) { rec.x = patch.text.x; rec.y = patch.text.y }
        if (patch.shape) { rec.x = patch.shape.x; rec.y = patch.shape.y }
        fr.layers[id] = rec
      }
    }
    layer._v++
    if (layer.kind === 'adjustment' && patch.adjustment) layer._v++
    invalidateFlat(doc)
    if (opts?.history !== false) this.pushHistory(opts?.label || 'Layer Properties')
    if (!opts?.silent) this.emit()
  }

  setLayerAdjustment(id: string, type: AdjustmentType, params: Record<string, any>) {
    const layer = this.layerById(id)
    const doc = this.activeDoc
    if (!layer || !doc || layer.kind !== 'adjustment') return
    layer.adjustment = { type, params: { ...params } }
    layer._v++
    invalidateFlat(doc)
    this.pushHistory(`${typeLabel(type)} (edited)`)
    this.recordStep({ op: 'setAdjustmentParams', args: { id, type, params: { ...params } }, label: 'Edit Adjustment' })
    this.emit()
  }

  rasterizeLayer(id?: string) {
    const doc = this.activeDoc
    const layer = id ? this.layerById(id) : this.activeLayer
    if (!doc || !layer || layer.kind === 'raster') return
    if (layer.kind === 'adjustment') {
      // flatten adjustment onto new raster of composite below? PS rasterizes adjustment into pixel equivalent of its effect over composite. Simplified: apply to flat composite.
      const flat = compositeDocument(doc)
      // remove layer, add raster on top
      const raster = newLayer('raster', layer.name, doc.width, doc.height)
      ctx2d(raster.canvas!).drawImage(flat, 0, 0)
      const idx = doc.layers.findIndex(l => l.id === layer.id)
      doc.layers.splice(idx, 1)
      doc.layers.push(raster)
      doc.activeLayerId = raster.id
    } else {
      const prepared = prepareLayer(doc, layer)
      layer.canvas = prepared ? cloneCanvas(prepared) : createCanvas(doc.width, doc.height)
      layer.kind = 'raster'
      layer.offsetX = 0 // prepared is doc-space
      layer.offsetY = 0
      layer.source = null; layer.transform = null; layer.smartFilters = []
      layer.text = null; layer.shape = null
      layer._v++
    }
    invalidateFlat(doc)
    this.pushHistory('Rasterize Layer')
    this.emit()
  }

  mergeDown(id?: string) {
    const doc = this.activeDoc
    const layer = id ? this.layerById(id) : this.activeLayer
    if (!doc || !layer) return
    const idx = doc.layers.findIndex(l => l.id === layer.id)
    if (idx <= 0) { this.ui?.toast('No layer below to merge into', 'error'); return }
    // composite just the two (plus clip stack of the upper) onto the lower
    const lower = doc.layers[idx - 1]
    if (lower.kind === 'adjustment' || layer.kind === 'adjustment') { this.flatten(); return }
    const merged = newLayer('raster', lower.name, doc.width, doc.height)
    const mCtx = ctx2d(merged.canvas!)
    const lowerPrep = prepareLayer(doc, lower)
    if (lowerPrep) mCtx.drawImage(lowerPrep, 0, 0)
    const upperPrep = prepareLayer(doc, layer)
    if (upperPrep) {
      mCtx.save()
      mCtx.globalAlpha = layer.opacity / 100
      mCtx.drawImage(upperPrep, 0, 0)
      mCtx.restore()
    }
    // keep lower's mask/props on merged
    merged.mask = lower.mask ? cloneCanvas(lower.mask) : null
    merged.blendMode = lower.blendMode
    merged.opacity = lower.opacity
    const replaceIdx = idx - 1
    doc.layers.splice(replaceIdx, 2, merged)
    doc.activeLayerId = merged.id
    this.pushHistory('Merge Down')
    this.emit()
  }

  flatten() {
    const doc = this.activeDoc
    if (!doc) return
    const flat = compositeDocument(doc)
    const layer = newLayer('raster', 'Background', doc.width, doc.height)
    ctx2d(layer.canvas!).drawImage(flat, 0, 0)
    doc.layers = [layer]
    doc.activeLayerId = layer.id
    invalidateFlat(doc)
    this.pushHistory('Flatten Image')
    this.emit()
  }

  mergeVisible() {
    const doc = this.activeDoc
    if (!doc) return
    const flat = compositeDocument(doc)
    doc.layers = doc.layers.filter(l => !l.visible)
    const layer = newLayer('raster', 'Merged Visible', doc.width, doc.height)
    ctx2d(layer.canvas!).drawImage(flat, 0, 0)
    doc.layers.push(layer)
    doc.activeLayerId = layer.id
    invalidateFlat(doc)
    this.pushHistory('Merge Visible')
    this.emit()
  }

  moveLayerPixels(id: string, dx: number, dy: number) {
    const doc = this.activeDoc
    const layer = this.layerById(id)
    if (!doc || !layer) return
    if (layer.kind === 'smart' && layer.transform) {
      layer.transform.x += dx; layer.transform.y += dy
      layer._v++
    } else if (layer.kind === 'adjustment') {
      // move mask instead
      if (layer.mask) {
        const l = this.mutateLayerMask(id)
        if (l?.mask) {
          const c = createCanvas(doc.width, doc.height)
          ctx2d(c).drawImage(l.mask, dx, dy)
          l.mask = c
          l._mv++
        }
      }
    } else {
      // raster: non-destructive — just shift the registration; off-canvas
      // pixels survive (moving back restores them, Photoshop-style)
      if (!layer.canvas) return
      layer.offsetX = (layer.offsetX ?? 0) + dx
      layer.offsetY = (layer.offsetY ?? 0) + dy
      layer._v++
    }
    invalidateFlat(doc)
    this.pushHistory('Move Layer')
    this.emit()
  }

  flipLayer(id: string, dir: 'horizontal' | 'vertical') {
    const doc = this.activeDoc
    const layer = this.layerById(id)
    if (!doc || !layer) return
    const l = this.mutateLayerPixels(id)
    if (!l?.canvas) return
    const c = ctx2d(l.canvas)
    const tmp = cloneCanvas(l.canvas)
    c.save()
    c.clearRect(0, 0, l.canvas!.width, l.canvas!.height)
    c.translate(dir === 'horizontal' ? l.canvas!.width : 0, dir === 'vertical' ? l.canvas!.height : 0)
    c.scale(dir === 'horizontal' ? -1 : 1, dir === 'vertical' ? -1 : 1)
    c.drawImage(tmp, 0, 0)
    c.restore()
    invalidateFlat(doc)
    this.pushHistory('Flip Layer')
    this.emit()
  }

  // ================================================== layer geometry (Task 12)

  /** full doc-space bounding rect of a layer — the REGISTRATION (where its
   *  pixels live), not the opaque-content box: raster canvas rect at its
   *  offset, the smart source rect through its transform (rotation-aware
   *  AABB), the shape spec rect, text measured with a memoized font metrics
   *  pass. Used by the move-tool highlight and Expand-to-Frame. */
  layerContentRect(id: string): Rect | null {
    const doc = this.activeDoc
    const l = this.layerById(id)
    if (!doc || !l) return null
    if (l.kind === 'raster' && l.canvas) {
      return { x: l.offsetX ?? 0, y: l.offsetY ?? 0, w: l.canvas.width, h: l.canvas.height }
    }
    if (l.kind === 'smart' && l.source) {
      const t = l.transform ?? { x: doc.width / 2, y: doc.height / 2, scale: 1, rotation: 0 }
      const sw = l.source.width * t.scale, sh = l.source.height * t.scale
      if (!t.rotation) return { x: t.x - sw / 2, y: t.y - sh / 2, w: sw, h: sh }
      // rotated AABB of the scaled source rect about its center
      const cos = Math.abs(Math.cos(t.rotation)), sin = Math.abs(Math.sin(t.rotation))
      const w = sw * cos + sh * sin, h = sw * sin + sh * cos
      return { x: t.x - w / 2, y: t.y - h / 2, w, h }
    }
    if (l.kind === 'shape' && l.shape) {
      const s = l.shape
      const x = Math.min(s.x, s.x + s.w), y = Math.min(s.y, s.y + s.h)
      return { x, y, w: Math.abs(s.w), h: Math.abs(s.h) }
    }
    if (l.kind === 'text' && l.text) {
      const t = l.text
      // memoize the metrics on the layer — keyed by every spec field that
      // affects measurement (font, size, tracking, content, line height)
      if (t.boxWidth) {
        return {
          x: t.x, y: t.y,
          w: Math.max(1, t.boxWidth),
          h: Math.max(t.fontSize * (t.lineHeight || 1.2), t.boxHeight ?? t.fontSize * (t.lineHeight || 1.2)),
        }
      }
      const key = `${t.content}|${t.fontSize}|${t.fontFamily}|${t.bold ? 1 : 0}|${t.italic ? 1 : 0}|${t.tracking}|${t.lineHeight}`
      const any = l as any
      if (any._textMetricsKey !== key) {
        const ctx = textMeasureCtx()
        ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? 700 : 400} ${t.fontSize}px ${t.fontFamily}`
        const lines = t.content.split('\n')
        let maxW = 1
        for (const ln of lines) {
          const w = ctx.measureText(ln).width + (t.tracking ? t.tracking * Math.max(0, ln.length - 1) : 0)
          if (w > maxW) maxW = w
        }
        any._textMetricsKey = key
        any._textMetrics = { w: maxW, h: lines.length * t.fontSize * (t.lineHeight || 1.2) }
      }
      return { x: t.x, y: t.y, w: any._textMetrics.w, h: any._textMetrics.h }
    }
    return null
  }

  /** Current transformable multi-layer selection, primary layer first. */
  selectedLayers(): Layer[] {
    const doc = this.activeDoc
    if (!doc) return []
    const ids = doc.selectedLayerIds?.length
      ? doc.selectedLayerIds
      : (doc.activeLayerId ? [doc.activeLayerId] : [])
    const set = new Set(ids)
    const out = doc.layers.filter(l => set.has(l.id) && !l.locked && l.kind !== 'adjustment')
    const primary = doc.activeLayerId ? out.find(l => l.id === doc.activeLayerId) : undefined
    return primary ? [primary, ...out.filter(l => l.id !== primary.id)] : out
  }

  private translateLayerGeometry(layer: Layer, dx: number, dy: number) {
    if (!dx && !dy) return
    if (layer.kind === 'raster' && layer.canvas) {
      layer.offsetX = (layer.offsetX ?? 0) + dx
      layer.offsetY = (layer.offsetY ?? 0) + dy
    } else if (layer.kind === 'smart' && layer.transform) {
      layer.transform = { ...layer.transform, x: layer.transform.x + dx, y: layer.transform.y + dy }
    } else if (layer.kind === 'text' && layer.text) {
      layer.text = { ...layer.text, x: layer.text.x + dx, y: layer.text.y + dy }
    } else if (layer.kind === 'shape' && layer.shape) {
      layer.shape = { ...layer.shape, x: layer.shape.x + dx, y: layer.shape.y + dy }
    } else return
    layer._v++
  }

  /** Live multi-layer translation used by the Move tool. No history entry or
   * listener churn; caller commits one history state on pointer-up. */
  translateLayersPreview(ids: string[], dx: number, dy: number) {
    const doc = this.activeDoc
    if (!doc || (!dx && !dy)) return
    let changed = false
    for (const id of ids) {
      const l = this.layerById(id)
      if (!l || l.locked || l.kind === 'adjustment') continue
      this.translateLayerGeometry(l, dx, dy)
      changed = true
    }
    if (changed) {
      invalidateFlat(doc)
      this.requestRender()
    }
  }

  /** Translate several layers as one edit/history step. */
  translateLayers(ids: string[], dx: number, dy: number, label = 'Move Layers') {
    const doc = this.activeDoc
    if (!doc || (!dx && !dy)) return
    let changed = false
    for (const id of ids) {
      const l = this.layerById(id)
      if (!l || l.locked || l.kind === 'adjustment') continue
      this.translateLayerGeometry(l, dx, dy)
      changed = true
    }
    if (!changed) return
    invalidateFlat(doc)
    this.pushHistory(label)
    this.emit()
  }

  /** Align selected layers to their collective bounds, canvas, or primary layer. */
  alignSelected(
    kind: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom',
    reference: 'selection' | 'canvas' | 'primary' = 'selection',
  ) {
    const doc = this.activeDoc
    const layers = this.selectedLayers()
    if (!doc || !layers.length) return
    const items = layers
      .map(layer => ({ layer, rect: this.layerContentRect(layer.id) }))
      .filter((x): x is { layer: Layer; rect: Rect } => !!x.rect)
    if (!items.length) return
    if (reference !== 'canvas' && items.length < 2) return

    let ref: Rect
    if (reference === 'canvas') ref = { x: 0, y: 0, w: doc.width, h: doc.height }
    else if (reference === 'primary') ref = items.find(x => x.layer.id === doc.activeLayerId)?.rect ?? items[0].rect
    else {
      const x0 = Math.min(...items.map(x => x.rect.x))
      const y0 = Math.min(...items.map(x => x.rect.y))
      const x1 = Math.max(...items.map(x => x.rect.x + x.rect.w))
      const y1 = Math.max(...items.map(x => x.rect.y + x.rect.h))
      ref = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    }

    let changed = false
    for (const { layer, rect } of items) {
      if (reference === 'primary' && layer.id === doc.activeLayerId) continue
      let dx = 0, dy = 0
      if (kind === 'left') dx = ref.x - rect.x
      else if (kind === 'hcenter') dx = (ref.x + ref.w / 2) - (rect.x + rect.w / 2)
      else if (kind === 'right') dx = (ref.x + ref.w) - (rect.x + rect.w)
      else if (kind === 'top') dy = ref.y - rect.y
      else if (kind === 'vcenter') dy = (ref.y + ref.h / 2) - (rect.y + rect.h / 2)
      else if (kind === 'bottom') dy = (ref.y + ref.h) - (rect.y + rect.h)
      if (Math.abs(dx) > .001 || Math.abs(dy) > .001) {
        this.translateLayerGeometry(layer, dx, dy)
        changed = true
      }
    }
    if (!changed) return
    invalidateFlat(doc)
    this.pushHistory('Align Layers')
    this.emit()
  }

  /** Evenly distribute selected layer centers between the outermost layers. */
  distributeSelected(axis: 'horizontal' | 'vertical') {
    const doc = this.activeDoc
    const items = this.selectedLayers()
      .map(layer => ({ layer, rect: this.layerContentRect(layer.id) }))
      .filter((x): x is { layer: Layer; rect: Rect } => !!x.rect)
    if (!doc || items.length < 3) return
    const center = (r: Rect) => axis === 'horizontal' ? r.x + r.w / 2 : r.y + r.h / 2
    items.sort((a, b) => center(a.rect) - center(b.rect))
    const first = center(items[0].rect)
    const last = center(items[items.length - 1].rect)
    const step = (last - first) / (items.length - 1)
    let changed = false
    for (let i = 1; i < items.length - 1; i++) {
      const delta = first + step * i - center(items[i].rect)
      if (Math.abs(delta) <= .001) continue
      this.translateLayerGeometry(items[i].layer, axis === 'horizontal' ? delta : 0, axis === 'vertical' ? delta : 0)
      changed = true
    }
    if (!changed) return
    invalidateFlat(doc)
    this.pushHistory(axis === 'horizontal' ? 'Distribute Layers Horizontally' : 'Distribute Layers Vertically')
    this.emit()
  }

  /** Evenly distribute the gaps BETWEEN selected layer bounds. The outermost
   * layers stay fixed, matching Photoshop's "Distribute Spacing" behavior. */
  distributeSelectedSpacing(axis: 'horizontal' | 'vertical') {
    const doc = this.activeDoc
    const items = this.selectedLayers()
      .map(layer => ({ layer, rect: this.layerContentRect(layer.id) }))
      .filter((x): x is { layer: Layer; rect: Rect } => !!x.rect)
    if (!doc || items.length < 3) return
    const pos = (r: Rect) => axis === 'horizontal' ? r.x : r.y
    const size = (r: Rect) => axis === 'horizontal' ? r.w : r.h
    items.sort((a, b) => pos(a.rect) - pos(b.rect))
    const firstStart = pos(items[0].rect)
    const lastEnd = pos(items[items.length - 1].rect) + size(items[items.length - 1].rect)
    const totalSize = items.reduce((sum, x) => sum + size(x.rect), 0)
    const gap = (lastEnd - firstStart - totalSize) / (items.length - 1)
    let cursor = firstStart + size(items[0].rect) + gap
    let changed = false
    for (let i = 1; i < items.length - 1; i++) {
      const current = pos(items[i].rect)
      const delta = cursor - current
      if (Math.abs(delta) > .001) {
        this.translateLayerGeometry(items[i].layer, axis === 'horizontal' ? delta : 0, axis === 'vertical' ? delta : 0)
        changed = true
      }
      cursor += size(items[i].rect) + gap
    }
    if (!changed) return
    invalidateFlat(doc)
    this.pushHistory(axis === 'horizontal' ? 'Distribute Horizontal Spacing' : 'Distribute Vertical Spacing')
    this.emit()
  }

  /** Crop transparent padding from a raster layer without changing its document-space position. */
  trimLayerToContent(id?: string): boolean {
    const doc = this.activeDoc
    const target = id ? this.layerById(id) : this.activeLayer
    if (!doc || !target) return false
    if (target.kind !== 'raster' || !target.canvas) {
      this.ui?.toast('Trim Layer works on raster layers — rasterize first', 'info')
      return false
    }
    const src = target.canvas
    const data = getImageData(src).data
    let minX = src.width, minY = src.height, maxX = -1, maxY = -1
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        if (data[(y * src.width + x) * 4 + 3] === 0) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (maxX < 0) { this.ui?.toast('Layer is fully transparent', 'info'); return false }
    if (minX === 0 && minY === 0 && maxX === src.width - 1 && maxY === src.height - 1) {
      this.ui?.toast('Layer is already trimmed', 'info')
      return false
    }
    const layer = this.mutateLayerPixels(target.id)
    if (!layer?.canvas) return false
    const out = createCanvas(maxX - minX + 1, maxY - minY + 1)
    ctx2d(out).drawImage(layer.canvas, -minX, -minY)
    layer.canvas = out
    layer.offsetX = (layer.offsetX ?? 0) + minX
    layer.offsetY = (layer.offsetY ?? 0) + minY
    layer._v++
    invalidateFlat(doc)
    this.pushHistory('Trim Layer to Content')
    this.emit()
    return true
  }

  /** "Expand to Fill Frame" / smart-fill the empty space around a layer:
   *  scale the layer's own bounds so it COVERS the whole document — aspect
   *  ratio preserved (CSS background-size: cover semantics), centered on the
   *  frame; the parts that overflow hang off-canvas like any moved layer.
   *  Smart layers scale non-destructively (transform.scale); raster layers
   *  resample once (registration offset recentered — history restores the
   *  original); text/shape scale their specs. Returns the applied scale. */
  expandLayerToFrame(id?: string): number | null {
    const doc = this.activeDoc
    const layer = id ? this.layerById(id) : this.activeLayer
    if (!doc || !layer) { this.ui?.toast('No active layer', 'error'); return null }
    if (layer.kind === 'adjustment') { this.ui?.toast('Adjustment layers have no pixels to expand', 'error'); return null }
    const r = this.layerContentRect(layer.id)
    if (!r || r.w < 1 || r.h < 1) { this.ui?.toast('This layer has no expandable content', 'error'); return null }
    const s = Math.max(doc.width / r.w, doc.height / r.h)
    if (Math.abs(s - 1) < 0.001) { this.ui?.toast('Layer already covers the frame', 'info'); return null }
    // target rect: the scaled bounds, centered on the document
    const nw = r.w * s, nh = r.h * s
    const tx = (doc.width - nw) / 2, ty = (doc.height - nh) / 2
    if (layer.kind === 'raster' && layer.canvas) {
      layer.canvas = resampleCanvas(layer.canvas, Math.max(1, Math.round(layer.canvas.width * s)), Math.max(1, Math.round(layer.canvas.height * s)))
      layer.offsetX = Math.round(tx)
      layer.offsetY = Math.round(ty)
    } else if (layer.kind === 'smart' && layer.source) {
      const t = layer.transform ?? { x: doc.width / 2, y: doc.height / 2, scale: 1, rotation: 0 }
      layer.transform = { ...t, scale: t.scale * s, x: doc.width / 2, y: doc.height / 2 }
    } else if (layer.kind === 'text' && layer.text) {
      layer.text = { ...layer.text, fontSize: Math.max(1, layer.text.fontSize * s), x: tx, y: ty }
    } else if (layer.kind === 'shape' && layer.shape) {
      layer.shape = { ...layer.shape, x: tx, y: ty, w: layer.shape.w * s, h: layer.shape.h * s }
    }
    layer._v++
    invalidateFlat(doc)
    this.pushHistory('Expand to Fill Frame')
    this.emit()
    this.ui?.toast(`Layer expanded ×${s.toFixed(2).replace(/\.?0+$/, '')} — now covers the whole frame`, 'success')
    return s
  }

  // layer masks
  addLayerMask(id: string, fromSelection = true) {
    const doc = this.activeDoc
    const layer = this.layerById(id)
    if (!doc || !layer) return
    const mask = createCanvas(doc.width, doc.height)
    const mCtx = ctx2d(mask)
    mCtx.fillStyle = '#ffffff'
    mCtx.fillRect(0, 0, doc.width, doc.height)
    if (fromSelection && doc.selection) {
      mCtx.globalCompositeOperation = 'destination-in'
      mCtx.drawImage(doc.selection.mask, 0, 0)
      mCtx.globalCompositeOperation = 'source-over'
    }
    layer.mask = mask
    layer.maskEnabled = true
    layer._mv++
    invalidateFlat(doc)
    this.pushHistory('Add Layer Mask')
    this.emit()
  }

  deleteLayerMask(id: string, apply = false) {
    const doc = this.activeDoc
    const layer = this.layerById(id)
    if (!doc || !layer || !layer.mask) return
    if (apply) {
      // bake mask into pixels
      const l = this.mutateLayerPixels(id)
      if (l?.canvas && l.mask) {
        const c = ctx2d(l.canvas)
        c.save()
        c.globalCompositeOperation = 'destination-in'
        // masks are doc-space — align to the layer's offset registration
        c.translate(-(l.offsetX ?? 0), -(l.offsetY ?? 0))
        c.drawImage(l.mask, 0, 0)
        c.restore()
      }
    }
    layer.mask = null
    layer._mv++
    invalidateFlat(doc)
    this.pushHistory(apply ? 'Apply Layer Mask' : 'Delete Layer Mask')
    this.emit()
  }

  setLayerMaskEnabled(id: string, enabled: boolean) {
    const layer = this.layerById(id)
    if (!layer?.mask) return
    layer.maskEnabled = enabled
    layer._mv++
    invalidateFlat(this.activeDoc!)
    this.pushHistory(enabled ? 'Enable Layer Mask' : 'Disable Layer Mask')
    this.emit()
  }

  toggleClipping(id: string) {
    const doc = this.activeDoc
    const layer = this.layerById(id)
    if (!doc || !layer) return
    const idx = doc.layers.findIndex(l => l.id === id)
    if (idx === 0) { this.ui?.toast('Bottom layer cannot clip', 'error'); return }
    layer.clipped = !layer.clipped
    layer._v++
    invalidateFlat(doc)
    this.pushHistory('Toggle Clipping Mask')
    this.emit()
  }

  setBlendIf(id: string, settings: BlendIfSettings | null) {
    const doc = this.activeDoc
    const layer = this.layerById(id)
    if (!doc || !layer) return
    layer.blendIf = settings
    layer._v++
    invalidateFlat(doc)
    this.pushHistory('Advanced Blending')
    this.emit()
  }

  // ================================================== layer styles (fx)

  /** set the non-destructive layer styles — history + cache invalidation flow
   *  through setLayerProps (_v bump rebuilds the prepareLayer fx cache) */
  setLayerFX(id: string, fx: LayerFX | null, opts?: { history?: boolean; silent?: boolean; label?: string }) {
    this.setLayerProps(id, { fx }, { history: opts?.history, silent: opts?.silent, label: opts?.label ?? 'Layer Style' })
  }

  // ================================================== direct on-canvas transform

  /** shift a layer's registration by (dx, dy) — pure metadata, lossless for
   *  every layer kind. Shared by nudge + the clip-stack commit loop. */
  private shiftLayerBy(l: Layer, dx: number, dy: number) {
    if (l.kind === 'raster' && l.canvas) {
      l.offsetX = (l.offsetX ?? 0) + dx
      l.offsetY = (l.offsetY ?? 0) + dy
    } else if (l.kind === 'smart' && l.transform) {
      l.transform = { ...l.transform, x: l.transform.x + dx, y: l.transform.y + dy }
    } else if (l.kind === 'text' && l.text) {
      l.text = { ...l.text, x: l.text.x + dx, y: l.text.y + dy }
    } else if (l.kind === 'shape' && l.shape) {
      l.shape = { ...l.shape, x: l.shape.x + dx, y: l.shape.y + dy }
    } else return
    l._v++
  }

  /** arrow-key nudge of the active layer (1px, Shift = 10px like Photoshop).
   *  A clip-stack base carries its clipped children. Rapid repeats coalesce
   *  into ONE undo step (the last state is replaced while the burst lasts). */
  nudgeActiveLayer(dx: number, dy: number) {
    const doc = this.activeDoc
    const l = this.activeLayer
    if (!doc || !l || l.locked || l.kind === 'adjustment') return
    const idx = doc.layers.findIndex(x => x.id === l.id)
    this.shiftLayerBy(l, dx, dy)
    let j = idx + 1
    while (j < doc.layers.length && doc.layers[j].clipped) {
      if (!doc.layers[j].locked && doc.layers[j].kind !== 'adjustment') this.shiftLayerBy(doc.layers[j], dx, dy)
      j++
    }
    invalidateFlat(doc)
    const h = doc.history
    const last = h.states[h.index]
    if (last && last.label === 'Move Layer' && Date.now() - last.time < 400 && h.index === h.states.length - 1) {
      h.states[h.index] = this.captureState(doc, 'Move Layer')
    } else {
      this.pushHistory('Move Layer')
    }
    this.emit()
  }

  /** Commit an on-canvas free-transform drag: scale (sx, sy — negative = flip)
   *  + rotation (radians, delta) about the doc-space anchor (ax, ay) that
   *  stayed fixed during the gesture — p → a + R·S·(p − a), the exact map the
   *  live preview rendered. Raster bakes once into a rotation-aware AABB
   *  canvas (content center re-registered); smart layers scale
   *  non-destructively (uniform — the tool only offers uniform for smart);
   *  text/shape scale their specs (any rotation or flip rasterizes first). */
  directTransformLayer(id: string, spec: { sx: number; sy: number; rotation: number; ax: number; ay: number }, opts?: { skipHistory?: boolean }) {
    const doc = this.activeDoc
    if (!doc) return
    const layer = this.layerById(id)
    if (!layer) return
    if (layer.kind === 'adjustment') { this.ui?.toast('Adjustment layers have no pixels to transform', 'error'); return }
    if (layer.locked) { this.ui?.toast('Layer is locked', 'error'); return }
    const sx = Math.abs(spec.sx) < 0.02 ? (spec.sx < 0 ? -0.02 : 0.02) : spec.sx
    const sy = Math.abs(spec.sy) < 0.02 ? (spec.sy < 0 ? -0.02 : 0.02) : spec.sy
    const rot = spec.rotation
    const ax = spec.ax, ay = spec.ay
    const cos = Math.cos(rot), sin = Math.sin(rot)
    /** doc-space linear map p → a + M(p − a) */
    const map = (px: number, py: number): [number, number] => {
      const dx = px - ax, dy = py - ay
      return [ax + dx * sx * cos - dy * sy * sin, ay + dx * sx * sin + dy * sy * cos]
    }
    const r = this.layerContentRect(id)
    if (!r || r.w < 1 || r.h < 1) { this.ui?.toast('This layer has no content to transform', 'error'); return }

    let mutated = false
    const baseKind = layer.kind

    if (baseKind === 'smart' && layer.source) {
      // non-destructive: uniform scale (corner-handle semantics), rotation
      // composes onto the existing transform (no flip — TransformSpec scale
      // is positive; flipping a smart layer rasterizes it instead)
      const s = Math.abs((sx + sy) / 2) || 0.01
      const t = layer.transform ?? { x: doc.width / 2, y: doc.height / 2, scale: 1, rotation: 0 }
      const [nx, ny] = map(t.x, t.y)
      layer.transform = {
        x: nx, y: ny,
        scale: Math.max(0.01, t.scale * s),
        rotation: t.rotation + rot,
      }
      mutated = true
    } else if ((baseKind === 'text' || baseKind === 'shape') && Math.abs(rot) < 0.002 && sx > 0 && sy > 0) {
      // spec scaling without rotation/flip: linear rect mapping
      const [nx, ny] = map(r.x, r.y)
      if (baseKind === 'text' && layer.text) {
        layer.text = { ...layer.text, fontSize: Math.max(1, layer.text.fontSize * sy), x: Math.round(nx), y: Math.round(ny) }
      } else if (baseKind === 'shape' && layer.shape) {
        layer.shape = { ...layer.shape, x: Math.round(nx), y: Math.round(ny), w: r.w * sx, h: r.h * sy }
      }
      mutated = true
    } else {
      // raster bake (also the path for rotated/flipped text & shape after
      // rasterizing — specs carry no rotation field)
      if ((baseKind === 'text' || baseKind === 'shape') && (Math.abs(rot) >= 0.002 || sx < 0 || sy < 0)) {
        this.rasterizeLayer(id)
      }
      const l = this.layerById(id)!
      if (l.kind === 'raster' && l.canvas) {
        const src = l.canvas
        // full alpha-bounds scan (content may be smaller than the canvas)
        const d = getImageData(src).data
        let minX = src.width, minY = src.height, maxX = -1, maxY = -1
        for (let y = 0; y < src.height; y++) {
          const row = y * src.width
          for (let x = 0; x < src.width; x++) {
            if (d[(row + x) * 4 + 3] > 0) {
              if (x < minX) minX = x; if (x > maxX) maxX = x
              if (y < minY) minY = y; if (y > maxY) maxY = y
            }
          }
        }
        if (maxX >= minX) {
          const bw = maxX - minX + 1, bh = maxY - minY + 1
          const bcx = minX + bw / 2, bcy = minY + bh / 2
          const ox = l.offsetX ?? 0, oy = l.offsetY ?? 0
          // content center in doc space → through the gesture map
          const [ncx, ncy] = map(ox + bcx, oy + bcy)
          // transformed content AABB (rotation-aware), 2px AA margin
          const nw = Math.max(1, Math.ceil(Math.abs(bw * sx * cos) + Math.abs(bh * sy * sin)) + 2)
          const nh = Math.max(1, Math.ceil(Math.abs(bw * sx * sin) + Math.abs(bh * sy * cos)) + 2)
          const out = createCanvas(nw, nh)
          const c = ctx2d(out)
          c.imageSmoothingEnabled = true
          c.imageSmoothingQuality = 'high'
          c.translate(nw / 2, nh / 2)
          c.rotate(rot)
          c.scale(sx, sy)
          c.drawImage(src, -bcx, -bcy)
          l.canvas = out
          l.offsetX = Math.round(ncx - nw / 2)
          l.offsetY = Math.round(ncy - nh / 2)
          mutated = true
        }
      }
    }

    if (!mutated) return
    layer._v++
    invalidateFlat(doc)
    if (opts?.skipHistory) { this.emit(); return }
    this.pushHistory('Free Transform')
    this.emit()
    const pct = Math.round((Math.abs((sx + sy) / 2)) * 100)
    const deg = Math.round((rot * 180) / Math.PI)
    this.ui?.toast(`Scaled to ${pct}%${deg ? ` · rotated ${deg}°` : ''}`, 'info')
  }

  // ================================================== clipboard (internal + system interop)

  private _clip: { canvas: HTMLCanvasElement; offsetX: number; offsetY: number; name: string } | null = null

  /** Copy the active layer (or the merged composite with merged=true) to the
   *  internal clipboard AND the system clipboard (PNG). With an active
   *  selection, copies the selection region position-preserving so a paste
   *  lands exactly where it was. Raster layers keep their full canvas incl.
   *  off-canvas pixels. */
  copyLayer(merged = false): boolean {
    const doc = this.activeDoc
    if (!doc) { this.ui?.toast('No document open', 'error'); return false }
    let canvas: HTMLCanvasElement
    let ox = 0, oy = 0, name = 'Layer'
    if (merged) {
      canvas = cloneCanvas(compositeDocument(doc))
      name = doc.name
    } else {
      const l = this.activeLayer
      if (!l || l.kind === 'adjustment') { this.ui?.toast('No pixel layer to copy — use Copy Merged (Ctrl+Shift+C)', 'error'); return false }
      if (doc.selection) {
        const b = doc.selection.bounds
        const x0 = clamp(Math.floor(b.x), 0, doc.width), y0 = clamp(Math.floor(b.y), 0, doc.height)
        const x1 = clamp(Math.ceil(b.x + b.w), 0, doc.width), y1 = clamp(Math.ceil(b.y + b.h), 0, doc.height)
        if (x1 - x0 < 1 || y1 - y0 < 1) { this.ui?.toast('The selection is empty', 'error'); return false }
        const src = this.layerCanvasDocSpace(l.id)
        if (!src) return false
        canvas = createCanvas(x1 - x0, y1 - y0)
        ctx2d(canvas).drawImage(src, -x0, -y0)
        ox = x0; oy = y0
        name = l.name
      } else if (l.kind === 'raster' && l.canvas) {
        canvas = cloneCanvas(l.canvas)
        ox = l.offsetX ?? 0; oy = l.offsetY ?? 0
        name = l.name
      } else {
        const p = prepareLayer(doc, l)
        if (!p) return false
        canvas = cloneCanvas(p)
        name = l.name
      }
    }
    this._clip = { canvas, offsetX: ox, offsetY: oy, name }
    void this.writeSystemClipboard(canvas)
    return true
  }

  /** best-effort PNG export to the OS clipboard (needs a secure context +
   *  user gesture; failures are silent — the internal clipboard still works) */
  private async writeSystemClipboard(c: HTMLCanvasElement) {
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return
      const blob = await canvasToBlob(c, 'image/png')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } catch { /* not permitted — fine */ }
  }

  /** Copy + remove: with a selection the region is cut; without one a raster
   *  layer's pixels are cleared, non-raster layers are removed (content was
   *  copied and can be pasted back as a raster layer). */
  cutLayer(): boolean {
    const doc = this.activeDoc
    const l = this.activeLayer
    if (!doc || !l) return false
    if (!this.copyLayer(false)) return false
    if (l.kind === 'raster' && l.canvas) {
      const m = this.mutateLayerPixels(l.id)
      if (m?.canvas) {
        ctx2d(m.canvas).clearRect(0, 0, m.canvas.width, m.canvas.height)
        m._v++
        invalidateFlat(doc)
        this.pushHistory('Cut')
        this.emit()
      }
    } else if (doc.selection) {
      this.deleteSelectionPixels()
    } else {
      this.ui?.toast(`${l.name} cut to clipboard (paste restores it as a raster layer)`, 'info')
      this.deleteLayer(l.id)
    }
    return true
  }

  /** Paste the internal clipboard as a new raster layer ABOVE the active one,
   *  at its original position (raster clipboards keep off-canvas pixels).
   *  Empty internal clipboard → falls back to reading the system clipboard. */
  pasteLayer(): boolean {
    const doc = this.activeDoc
    if (!doc) { this.ui?.toast('Open or create a document first', 'error'); return false }
    const clip = this._clip
    if (!clip) { void this.pasteFromSystemClipboard(); return false }
    const layer = newLayer('raster', `${clip.name} copy`, doc.width, doc.height)
    layer.canvas = cloneCanvas(clip.canvas)
    layer.offsetX = clip.offsetX
    layer.offsetY = clip.offsetY
    const idx = doc.layers.findIndex(x => x.id === doc.activeLayerId)
    doc.layers.splice(idx + 1, 0, layer)
    doc.activeLayerId = layer.id
    this.pushHistory('Paste')
    this.emit()
    return true
  }

  /** read an image from the OS clipboard (e.g. copied in another app) and
   *  paste it as a new centered raster layer */
  async pasteFromSystemClipboard(): Promise<boolean> {
    try {
      if (!navigator.clipboard?.read) { this.ui?.toast('The clipboard is empty', 'info'); return false }
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = item.types.find(t => t.startsWith('image/'))
        if (!type) continue
        const blob = await item.getType(type)
        const img = await createImageBitmap(blob)
        const c = createCanvas(img.width, img.height)
        ctx2d(c).drawImage(img, 0, 0)
        img.close()
        this.addLayerFromCanvas(c, 'Pasted Image')
        this.ui?.toast('Pasted from system clipboard', 'success')
        return true
      }
      this.ui?.toast('The clipboard has no image', 'info')
    } catch {
      this.ui?.toast('Could not read the clipboard (permission denied)', 'error')
    }
    return false
  }

  // smart filters
  addSmartFilter(id: string, type: FilterType, params: Record<string, any>) {
    const doc = this.activeDoc
    const layer = this.layerById(id)
    if (!doc || !layer) return
    if (layer.kind !== 'smart') {
      // convert filter application to raster behavior instead
      this.applyFilterToLayer(id, type, params)
      return
    }
    layer.smartFilters.push({ id: uid(), type, params: { ...params }, enabled: true })
    layer._v++
    invalidateFlat(doc)
    this.pushHistory(`Smart Filter: ${filterLabel(type)}`)
    this.emit()
  }

  updateSmartFilter(layerId: string, filterId: string, params: Record<string, any>) {
    const doc = this.activeDoc
    const layer = this.layerById(layerId)
    if (!doc || !layer) return
    const sf = layer.smartFilters.find(f => f.id === filterId)
    if (!sf) return
    sf.params = { ...params }
    layer._v++
    invalidateFlat(doc)
    this.emit() // no history spam while dragging; commit via dialog OK
  }

  removeSmartFilter(layerId: string, filterId: string) {
    const doc = this.activeDoc
    const layer = this.layerById(layerId)
    if (!doc || !layer) return
    layer.smartFilters = layer.smartFilters.filter(f => f.id !== filterId)
    layer._v++
    invalidateFlat(doc)
    this.pushHistory('Delete Smart Filter')
    this.emit()
  }

  toggleSmartFilter(layerId: string, filterId: string) {
    const doc = this.activeDoc
    const layer = this.layerById(layerId)
    if (!doc || !layer) return
    const sf = layer.smartFilters.find(f => f.id === filterId)
    if (!sf) return
    sf.enabled = !sf.enabled
    layer._v++
    invalidateFlat(doc)
    this.pushHistory('Toggle Smart Filter')
    this.emit()
  }

  // ================================================== selection
  setSelectionMask(mask: HTMLCanvasElement | null, mode: SelectionCombine = 'new', label = 'Selection') {
    const doc = this.activeDoc
    if (!doc) return
    if (!mask) { doc.selection = null; this.emitOverlay(); return }
    doc.selection = combineSelection(doc.selection, mask, mode)
    this.pushHistory(label)
    // selection renders on the overlay only (marching ants) — the composite
    // is untouched, so skip the recomposite (huge win on large documents)
    this.emitOverlay()
  }

  setSelectionAlpha(alpha: Uint8ClampedArray, mode: SelectionCombine = 'new', label = 'Selection') {
    const doc = this.activeDoc
    if (!doc) return
    const mask = maskCanvasFromAlpha(alpha, doc.width, doc.height)
    this.setSelectionMask(mask, mode, label)
  }

  selectAll() {
    const doc = this.activeDoc
    if (!doc) return
    const mask = createCanvas(doc.width, doc.height)
    ctx2d(mask).fillRect(0, 0, doc.width, doc.height)
    doc.selection = selectionFromMask(mask)
    this.pushHistory('Select All')
    this.emitOverlay()
  }

  deselect() {
    const doc = this.activeDoc
    if (!doc || !doc.selection) return
    doc.selection = null
    this.pushHistory('Deselect')
    this.emitOverlay()
  }

  invertSelection() {
    const doc = this.activeDoc
    if (!doc?.selection) return
    const sel = this.mutateSelection()
    if (!sel) return
    const d = getImageData(sel.mask)
    for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255 - d.data[i]
    putImageData(sel.mask, d)
    sel._v++
    sel.bounds = computeBounds(sel.mask)
    this.pushHistory('Inverse Selection')
    this.emitOverlay()
  }

  selectionModify(op: 'grow' | 'contract' | 'feather' | 'border' | 'smooth' | 'invert', px: number) {
    const doc = this.activeDoc
    if (!doc?.selection) { this.ui?.toast('No active selection', 'error'); return }
    const next = modifySelection(doc.selection, op, px)
    doc.selection = next
    this.pushHistory(op === 'invert' ? 'Inverse' : `${op[0].toUpperCase()}${op.slice(1)} Selection`)
    this.emitOverlay()
  }

  selectShape(rect: Rect, kind: 'rect' | 'ellipse', feather: number, mode: SelectionCombine, antiAlias = true) {
    const doc = this.activeDoc
    if (!doc) return
    const mask = createCanvas(doc.width, doc.height)
    const c = ctx2d(mask)
    c.fillStyle = '#ffffff'
    if (kind === 'rect') c.fillRect(rect.x, rect.y, rect.w, rect.h)
    else {
      c.beginPath()
      c.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.abs(rect.w / 2), Math.abs(rect.h / 2), 0, 0, Math.PI * 2)
      c.fill()
    }
    if (!antiAlias && kind === 'ellipse') {
      const md = getImageData(mask)
      for (let i = 3; i < md.data.length; i += 4) md.data[i] = md.data[i] >= 128 ? 255 : 0
      putImageData(mask, md)
    }
    if (feather > 0) {
      const f = new Float32Array(doc.width * doc.height)
      const md = getImageData(mask)
      for (let i = 0, j = 3; i < f.length; i++, j += 4) f[i] = md.data[j]
      const b = gaussianBlurChannel(f, doc.width, doc.height, feather)
      const out = new Uint8ClampedArray(b)
      for (let i = 0, j = 3; i < out.length; i++, j += 4) md.data[j] = out[i]
      putImageData(mask, md)
    }
    this.setSelectionMask(mask, mode, 'Marquee Selection')
  }

  selectPolygon(points: { x: number; y: number }[], feather: number, mode: SelectionCombine, antiAlias = true) {
    const doc = this.activeDoc
    if (!doc || points.length < 3) return
    const mask = createCanvas(doc.width, doc.height)
    const c = ctx2d(mask)
    c.fillStyle = '#ffffff'
    c.beginPath()
    c.moveTo(points[0].x, points[0].y)
    for (const p of points.slice(1)) c.lineTo(p.x, p.y)
    c.closePath()
    c.fill()
    if (!antiAlias) {
      const md = getImageData(mask)
      for (let i = 3; i < md.data.length; i += 4) md.data[i] = md.data[i] >= 128 ? 255 : 0
      putImageData(mask, md)
    }
    if (feather > 0) {
      const f = new Float32Array(doc.width * doc.height)
      const md = getImageData(mask)
      for (let i = 0, j = 3; i < f.length; i++, j += 4) f[i] = md.data[j]
      const b = gaussianBlurChannel(f, doc.width, doc.height, feather)
      const out = new Uint8ClampedArray(b)
      for (let i = 0, j = 3; i < out.length; i++, j += 4) md.data[j] = out[i]
      putImageData(mask, md)
    }
    this.setSelectionMask(mask, mode, 'Lasso Selection')
  }

  magicWand(x: number, y: number, opts: {
    tolerance: number
    contiguous: boolean
    sample: 'composite' | 'layer'
    mode: SelectionCombine
    antiAlias?: boolean
    diagonal?: boolean
    sampleRadius?: number
    edgeAware?: number
    adaptive?: boolean
    matchAlpha?: boolean
    exactPixels?: boolean
    feather?: number
    smooth?: number
  }) {
    const doc = this.activeDoc
    if (!doc) return
    const src = opts.sample === 'layer' && this.activeLayer ? this.layerCanvasDocSpace(this.activeLayer.id) : getFlatComposite(doc)
    if (!src) return
    const img = getImageData(src)
    const cx = clamp(Math.round(x), 0, doc.width - 1)
    const cy = clamp(Math.round(y), 0, doc.height - 1)
    let mask = imageOps.perceptualWandMask(img, cx, cy, {
      tolerance: opts.tolerance,
      contiguous: opts.contiguous,
      antiAlias: opts.antiAlias,
      diagonal: opts.diagonal,
      sampleRadius: opts.sampleRadius,
      edgeAware: opts.edgeAware,
      adaptive: opts.adaptive,
      matchAlpha: opts.matchAlpha,
      exactPixels: opts.exactPixels,
    })
    if ((opts.smooth ?? 0) > 0 || (opts.feather ?? 0) > 0) {
      const temp = selectionFromMask(maskCanvasFromAlpha(mask, doc.width, doc.height))
      let refined = temp
      if ((opts.smooth ?? 0) > 0) refined = modifySelection(refined, 'smooth', opts.smooth ?? 0) ?? refined
      if ((opts.feather ?? 0) > 0) refined = modifySelection(refined, 'feather', opts.feather ?? 0) ?? refined
      mask = getMaskAlpha(refined.mask)
    }
    this.setSelectionAlpha(mask, opts.mode, 'Magic Wand')
  }

  loadChannelAsSelection(channel: 'r' | 'g' | 'b' | 'luminosity' | 'rgb' | string) {
    const doc = this.activeDoc
    if (!doc) return
    let mask: HTMLCanvasElement
    if (channel === 'r' || channel === 'g' || channel === 'b' || channel === 'luminosity' || channel === 'rgb') {
      const flat = getFlatComposite(doc)
      mask = channelMaskFromComposite(flat, channel as any)
    } else {
      const saved = doc.savedChannels.find(c => c.id === channel)
      if (!saved) return
      mask = cloneCanvas(saved.mask)
    }
    doc.selection = selectionFromMask(mask)
    this.pushHistory('Load Channel as Selection')
    this.emitOverlay()
  }

  saveSelectionChannel(name?: string) {
    const doc = this.activeDoc
    if (!doc) return
    if (!doc.selection) { this.ui?.toast('No selection to save', 'error'); return }
    const chan = { id: uid(), name: name || `Alpha ${doc.savedChannels.length + 1}`, mask: cloneCanvas(doc.selection.mask), _v: 1 }
    doc.savedChannels.push(chan)
    this.pushHistory('Save Selection as Channel')
    this.emit()
  }

  deleteSavedChannel(id: string) {
    const doc = this.activeDoc
    if (!doc) return
    doc.savedChannels = doc.savedChannels.filter(c => c.id !== id)
    this.pushHistory('Delete Channel')
    this.emit()
  }

  colorRangeSelect(params: Record<string, any>) {
    const doc = this.activeDoc
    if (!doc) return
    const flat = getFlatComposite(doc)
    const img = getImageData(flat)
    const mask = imageOps.colorRange(img, params)
    this.setSelectionAlpha(mask, params.mode ?? 'new', 'Color Range')
  }

  selectSubject() {
    const doc = this.activeDoc
    if (!doc) return
    const flat = getFlatComposite(doc)
    const img = getImageData(flat)
    const mask = imageOps.selectSubject(img)
    this.setSelectionAlpha(mask, 'new', 'Select Subject')
    this.ui?.toast('Subject selected (AI saliency)', 'success')
  }

  objectSelect(rect: Rect) {
    const doc = this.activeDoc
    if (!doc) return
    const flat = getFlatComposite(doc)
    const img = getImageData(flat)
    const mask = imageOps.objectSelect(img, rect.x, rect.y, rect.w, rect.h)
    this.setSelectionAlpha(mask, 'new', 'Object Selection')
  }

  focusAreaSelect(params: Record<string, any>) {
    const doc = this.activeDoc
    if (!doc) return
    const flat = getFlatComposite(doc)
    const img = getImageData(flat)
    const mask = imageOps.focusArea(img, params)
    this.setSelectionAlpha(mask, 'new', 'Focus Area')
  }

  refineSelectionToMask(params: Record<string, any>, output: 'selection' | 'mask' | 'new-layer') {
    const doc = this.activeDoc
    if (!doc?.selection) return
    const alpha = (() => {
      const d = getImageData(doc.selection.mask)
      const out = new Uint8ClampedArray(doc.width * doc.height)
      for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = d.data[j]
      return out
    })()
    const refined = imageOps.refineMask(alpha, doc.width, doc.height, params)
    const mask = maskCanvasFromAlpha(refined, doc.width, doc.height)
    if (output === 'selection') {
      doc.selection = selectionFromMask(mask)
      this.pushHistory('Select and Mask')
    } else if (output === 'mask') {
      const layer = this.activeLayer
      if (layer) {
        layer.mask = mask
        layer._mv++
      }
      this.pushHistory('Select and Mask → Layer Mask')
    } else {
      // new layer with decontaminated colors
      const layer = this.activeLayer
      if (layer) {
        const dup = this.duplicateLayer(layer.id)
        if (dup) {
          const src = this.layerCanvas(dup.id)
          if (src) {
            const l2 = this.mutateLayerPixels(dup.id)
            if (l2?.canvas) {
              const img = getImageData(l2.canvas)
              imageOps.decontaminateColors(img, refined, params.decontaminate ?? 0)
              putImageData(l2.canvas, img)
            }
          }
          dup.mask = mask
          dup._mv++
        }
      }
      this.pushHistory('Select and Mask → New Layer')
    }
    this.emit()
  }

  // ================================================== pixel operations
  fillSelection(color: string) {
    const doc = this.activeDoc
    const layer = this.activeLayer
    if (!doc || !layer) return
    const l = this.mutateLayerPixels(layer.id)
    if (!l?.canvas) return
    const c = ctx2d(l.canvas)
    const sx = -(l.offsetX ?? 0), sy = -(l.offsetY ?? 0)
    c.save()
    if (doc.selection) {
      const tmp = createCanvas(doc.width, doc.height)
      const tc = ctx2d(tmp)
      tc.fillStyle = color
      tc.fillRect(0, 0, doc.width, doc.height)
      tc.globalCompositeOperation = 'destination-in'
      tc.drawImage(doc.selection.mask, 0, 0)
      c.drawImage(tmp, sx, sy)
    } else {
      c.fillStyle = color
      c.fillRect(sx, sy, doc.width, doc.height)
    }
    c.restore()
    invalidateFlat(doc)
    this.pushHistory('Fill')
    this.recordStep({ op: 'fill', args: { color }, label: 'Fill' })
    this.emit()
  }

  deleteSelectionPixels() {
    const doc = this.activeDoc
    const layer = this.activeLayer
    if (!doc || !layer || !doc.selection) return
    const l = this.mutateLayerPixels(layer.id)
    if (!l?.canvas) return
    const c = ctx2d(l.canvas)
    c.save()
    c.globalCompositeOperation = 'destination-out'
    c.translate(-(l.offsetX ?? 0), -(l.offsetY ?? 0))
    c.drawImage(doc.selection.mask, 0, 0)
    c.restore()
    invalidateFlat(doc)
    this.pushHistory('Clear')
    this.emit()
  }

  applyAdjustmentToLayer(layerId: string, type: AdjustmentType, params: Record<string, any>) {
    const doc = this.activeDoc
    if (!doc) return
    const l = this.mutateLayerPixels(layerId)
    if (!l?.canvas) return
    const img = getImageData(l.canvas)
    imageOps.applyAdjustment(img, type, params)
    putImageData(l.canvas, img)
    invalidateFlat(doc)
    this.pushHistory(typeLabel(type))
    this.recordStep({ op: 'applyAdjustment', args: { layerId, type, params: { ...params } }, label: typeLabel(type) })
    this.emit()
  }

  applyFilterToLayer(layerId: string, type: FilterType, params: Record<string, any>) {
    const doc = this.activeDoc
    const layer = this.layerById(layerId)
    if (!doc || !layer) return
    if (layer.kind === 'smart') {
      this.addSmartFilter(layerId, type, params)
      return
    }
    const l = this.mutateLayerPixels(layerId)
    if (!l?.canvas) return
    const img = getImageData(l.canvas)
    imageOps.applyFilter(img, type, params)
    putImageData(l.canvas, img)
    invalidateFlat(doc)
    this.pushHistory(filterLabel(type))
    this.recordStep({ op: 'applyFilter', args: { layerId, type, params: { ...params } }, label: filterLabel(type) })
    this.emit()
  }

  async contentAwareFill(onProgress?: (p: number) => void): Promise<void> {
    const doc = this.activeDoc
    const layer = this.activeLayer
    if (!doc || !layer) return
    if (!doc.selection) { this.ui?.toast('Make a selection first', 'error'); return }
    const l = this.mutateLayerPixels(layer.id)
    if (!l?.canvas) return
    // compute overlap of selection alpha
    const selAlpha = (() => {
      const d = getImageData(doc.selection.mask)
      const out = new Uint8ClampedArray(doc.width * doc.height)
      for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = d.data[j]
      return out
    })()
    const img = getImageData(l.canvas)
    // mask = selection AND layer alpha
    const combined = new Uint8ClampedArray(selAlpha.length)
    for (let i = 0; i < selAlpha.length; i++) {
      combined[i] = Math.min(selAlpha[i], img.data[i * 4 + 3])
    }
    await imageOps.inpaint(img, combined, onProgress)
    putImageData(l.canvas, img)
    invalidateFlat(doc)
    this.pushHistory('Content-Aware Fill')
    this.recordStep({ op: 'contentAwareFill', args: {}, label: 'Content-Aware Fill' })
    this.emit()
  }

  /** generic region CPU op with history (dodge/burn/blur tools etc.) */
  applyRegionOp(layerId: string, op: (img: ImageData) => void, label: string) {
    const doc = this.activeDoc
    if (!doc) return
    const l = this.mutateLayerPixels(layerId)
    if (!l?.canvas) return
    const img = getImageData(l.canvas)
    op(img)
    putImageData(l.canvas, img)
    invalidateFlat(doc)
    this.pushHistory(label)
    this.emit()
  }

  // ================================================== auto corrections (PS Image menu)
  autoCorrect(kind: 'tone' | 'contrast' | 'color') {
    const layer = this.activeLayer
    if (!layer) { this.ui?.toast('No active layer', 'error'); return }
    const fn = kind === 'tone' ? autoTone : kind === 'contrast' ? autoContrast : autoColor
    const label = kind === 'tone' ? 'Auto Tone' : kind === 'contrast' ? 'Auto Contrast' : 'Auto Color'
    this.applyRegionOp(layer.id, fn, label)
    this.recordStep({ op: 'autoCorrect', args: { kind }, label })
    this.ui?.toast(label + ' applied', 'success')
  }

  // ================================================== async pixel-op offload (worker pool — Task 7-b)
  // Async twins of the one-shot commit paths. EXACT same flow/order as the sync
  // versions (mutateLayerPixels → getImageData → op → putImageData → invalidateFlat
  // → pushHistory → recordStep → emit); only the pixel math runs in the pixel-op
  // worker pool (src/editor/workers/pixel-op.worker.ts). The sync methods stay
  // untouched for callers that must remain synchronous (actions playback, scripting
  // api, invert shortcut). Small images (< 0.3 MP) and any worker failure run sync
  // automatically inside the wrapper — identical observable behavior.

  /** Async variant of applyRegionOp for worker-capable op descriptors (PixelOpSpec —
   *  closures cannot cross the worker boundary). Sync applyRegionOp stays for tools. */
  async applyRegionOpAsync(layerId: string, spec: PixelOpSpec, label: string): Promise<void> {
    const doc = this.activeDoc
    if (!doc) return
    const l = this.mutateLayerPixels(layerId)
    if (!l?.canvas) return
    // getImageData inside is fresh + disposable → zero-copy transfer to the worker;
    // on an unrecoverable worker failure it re-fetches and runs synchronously
    const out = await runPixelOpFromCanvas(l.canvas, spec)
    putImageData(l.canvas, out)
    invalidateFlat(doc)
    this.pushHistory(label)
    this.emit()
  }

  /** Async twin of applyAdjustmentToLayer (dialog OK commits) — pixel math in the worker. */
  async applyAdjustmentToLayerAsync(layerId: string, type: AdjustmentType, params: Record<string, any>): Promise<void> {
    const doc = this.activeDoc
    if (!doc) return
    const l = this.mutateLayerPixels(layerId)
    if (!l?.canvas) return
    const out = await runPixelOpFromCanvas(l.canvas, { kind: 'adjustment', type, params })
    putImageData(l.canvas, out)
    invalidateFlat(doc)
    this.pushHistory(typeLabel(type))
    this.recordStep({ op: 'applyAdjustment', args: { layerId, type, params: { ...params } }, label: typeLabel(type) })
    this.emit()
  }

  /** Async twin of applyFilterToLayer (dialog OK commits, menu filter commands) — pixel math in the worker. */
  async applyFilterToLayerAsync(layerId: string, type: FilterType, params: Record<string, any>): Promise<void> {
    const doc = this.activeDoc
    const layer = this.layerById(layerId)
    if (!doc || !layer) return
    if (layer.kind === 'smart') {
      this.addSmartFilter(layerId, type, params)
      return
    }
    const l = this.mutateLayerPixels(layerId)
    if (!l?.canvas) return
    const out = await runPixelOpFromCanvas(l.canvas, { kind: 'filter', type, params })
    putImageData(l.canvas, out)
    invalidateFlat(doc)
    this.pushHistory(filterLabel(type))
    this.recordStep({ op: 'applyFilter', args: { layerId, type, params: { ...params } }, label: filterLabel(type) })
    this.emit()
  }

  /** Async auto-correction (Image menu / shortcuts) — autoTone/autoContrast/autoColor in the worker. */
  async autoCorrectAsync(kind: 'tone' | 'contrast' | 'color'): Promise<void> {
    const layer = this.activeLayer
    if (!layer) { this.ui?.toast('No active layer', 'error'); return }
    const spec: PixelOpSpec = kind === 'tone' ? { kind: 'auto-tone' } : kind === 'contrast' ? { kind: 'auto-contrast' } : { kind: 'auto-color' }
    const label = kind === 'tone' ? 'Auto Tone' : kind === 'contrast' ? 'Auto Contrast' : 'Auto Color'
    await this.applyRegionOpAsync(layer.id, spec, label)
    this.recordStep({ op: 'autoCorrect', args: { kind }, label })
    this.ui?.toast(label + ' applied', 'success')
  }

  // ================================================== guides & rulers
  addGuide(orientation: 'h' | 'v', pos: number) {
    const doc = this.activeDoc
    if (!doc) return
    if (!doc.guides) doc.guides = []
    doc.guides.push({ id: uid(), orientation, pos: Math.round(clamp(pos, 0, orientation === 'h' ? doc.height : doc.width)) })
    this.requestRender()
  }
  removeGuide(id: string) {
    const doc = this.activeDoc
    if (!doc?.guides) return
    doc.guides = doc.guides.filter(g => g.id !== id)
    this.requestRender()
  }
  moveGuide(id: string, pos: number) {
    const doc = this.activeDoc
    const g = doc?.guides?.find(g => g.id === id)
    if (!doc || !g) return
    g.pos = Math.round(pos)
    this.requestRender()
  }
  clearGuides() {
    const doc = this.activeDoc
    if (!doc?.guides?.length) return
    doc.guides = []
    this.requestRender()
    this.ui?.toast('Guides cleared', 'info')
  }

  // ================================================== GPU acceleration state
  isGpuEnabled(): boolean { return isGlEnabled() }
  isGpuActive(): boolean { return glAvailable() }
  setGpuAccelerated(on: boolean) {
    setGlEnabled(on)
    this.emit()
    this.ui?.toast(on ? 'GPU acceleration on' : 'GPU acceleration off (CPU compositing)', 'info')
  }
  gpuInfo() { return glInfo() }

  /** debug/test bridge: current flat composite (recomputed, uncached) */
  flatComposite(): HTMLCanvasElement | null {
    const doc = this.activeDoc
    if (!doc) return null
    invalidateFlat(doc)
    return getFlatComposite(doc)
  }

  sampleColor(
    x: number, y: number,
    scope: 'composite' | 'layer' = 'composite',
    radius = 0,
  ): string | null {
    const doc = this.activeDoc
    if (!doc) return null
    // Layer sampling must be in DOCUMENT space; sampling layer.canvas directly
    // was wrong as soon as a raster layer had a non-zero move offset.
    const src = scope === 'layer' && this.activeLayer
      ? this.layerCanvasDocSpace(this.activeLayer.id)
      : getFlatComposite(doc)
    if (!src) return null
    const px = clamp(Math.round(x), 0, doc.width - 1)
    const py = clamp(Math.round(y), 0, doc.height - 1)
    const r = clamp(Math.floor(radius), 0, 32)
    const x0 = clamp(px - r, 0, doc.width - 1)
    const y0 = clamp(py - r, 0, doc.height - 1)
    const x1 = clamp(px + r, 0, doc.width - 1)
    const y1 = clamp(py + r, 0, doc.height - 1)
    const data = ctx2d(src).getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data
    let rr = 0, gg = 0, bb = 0, aa = 0, weight = 0
    // Alpha-weighted average avoids transparent RGB garbage contaminating
    // large eyedropper samples around cut-out subjects.
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255
      if (a <= 0) continue
      rr += data[i] * a; gg += data[i + 1] * a; bb += data[i + 2] * a
      aa += data[i + 3]; weight += a
    }
    void aa
    if (weight <= 0) return null
    return rgbToHex(rr / weight, gg / weight, bb / weight)
  }

  // ================================================== stroke engine (brush/eraser/clone/heal)
  beginStroke(layerId: string, opts: { opacity?: number; erase?: boolean; blendMode?: BlendMode | string } = {}) {
    const doc = this.activeDoc
    if (!doc) return
    let layer = this.layerById(layerId)
    if (!layer) return
    if (layer.kind === 'adjustment') { this.ui?.toast('Cannot paint on an adjustment layer', 'error'); return }
    if (layer.kind !== 'raster') {
      this.rasterizeLayer(layerId)
      layer = this.layerById(layerId)
      if (!layer) return
    }
    doc._stroke = createCanvas(doc.width, doc.height)
    doc._strokeLayerId = layerId
    doc._strokeErase = !!opts.erase
    doc._strokeOpacity = (opts.opacity ?? 100) / 100
    doc._strokeBlendMode = (opts.blendMode && BLEND_GCO[opts.blendMode as BlendMode] ? opts.blendMode : 'normal') as BlendMode
    doc._strokeBbox = null
    doc._strokeV = (doc._strokeV || 0) + 1
    this.requestRender()
  }

  dab(x: number, y: number, draw: (ctx: CanvasRenderingContext2D, x: number, y: number) => void, flow = 1, radius = 64) {
    const doc = this.activeDoc
    if (!doc?._stroke) return
    const ctx = ctx2d(doc._stroke)
    ctx.save()
    ctx.globalAlpha = flow
    draw(ctx, x, y)
    ctx.restore()
    const r = Math.max(4, radius)
    const b = doc._strokeBbox
    const box = { x: x - r, y: y - r, w: r * 2, h: r * 2 }
    if (!b) doc._strokeBbox = box
    else {
      const x0 = Math.min(b.x, box.x), y0 = Math.min(b.y, box.y)
      const x1 = Math.max(b.x + b.w, box.x + box.w), y1 = Math.max(b.y + b.h, box.y + box.h)
      doc._strokeBbox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    }
    // bump the stroke version so prepareLayer/flat cache keys pick up new dabs
    doc._strokeV = (doc._strokeV || 0) + 1
    this.requestRender()
  }

  endStroke(label = 'Brush Stroke') {
    const doc = this.activeDoc
    if (!doc?._stroke || !doc._strokeLayerId) { this._clearStroke(); return }
    const layerId = doc._strokeLayerId
    const l = this.mutateLayerPixels(layerId)
    if (l?.canvas) {
      const c = ctx2d(l.canvas)
      // the stroke buffer is DOC-space; the layer canvas may be offset
      const sx = -(l.offsetX ?? 0), sy = -(l.offsetY ?? 0)
      let stroke = doc._stroke
      if (doc.selection) {
        const tmp = cloneCanvas(doc._stroke)
        const tc = ctx2d(tmp)
        tc.globalCompositeOperation = 'destination-in'
        tc.drawImage(doc.selection.mask, 0, 0)
        stroke = tmp
      }
      c.save()
      c.globalAlpha = doc._strokeOpacity
      if (doc._strokeErase) c.globalCompositeOperation = 'destination-out'
      else {
        try { c.globalCompositeOperation = BLEND_GCO[doc._strokeBlendMode] || 'source-over' } catch { /* noop */ }
      }
      c.drawImage(stroke, sx, sy)
      c.restore()
    }
    this._clearStroke()
    this.pushHistory(label)
    this.emit()
  }

  private _clearStroke() {
    const doc = this.activeDoc
    if (!doc) return
    doc._stroke = null; doc._strokeLayerId = null; doc._strokeBbox = null
    doc._strokeV = (doc._strokeV || 0) + 1
    this.requestRender()
  }

  /** painting convenience: soft round dab with current tool settings */
  paintDab(x: number, y: number, brush: BrushSettings, color: string) {
    this.dab(x, y, (ctx, dx, dy) => {
      drawSoftDab(ctx, dx, dy, brush.size / 2, brush.hardness, color, 1)
    }, brush.flow / 100)
  }

  // ================================================== transforms
  cropTo(rect: Rect, opts: { deletePixels?: boolean } = {}) {
    const doc = this.activeDoc
    if (!doc) return
    // Photoshop-style crop can extend beyond the current canvas. Negative
    // origins / oversized crops add transparent canvas instead of being
    // silently clamped back into the old document.
    const x = Math.round(rect.x)
    const y = Math.round(rect.y)
    const w = Math.max(1, Math.round(rect.w))
    const h = Math.max(1, Math.round(rect.h))
    const deletePixels = opts.deletePixels !== false

    for (const l of doc.layers) {
      if (l.canvas && l.kind === 'raster') {
        if (deletePixels) {
          // destructive crop: discard raster pixels outside the new frame
          const next = createCanvas(w, h)
          ctx2d(next).drawImage(l.canvas, (l.offsetX ?? 0) - x, (l.offsetY ?? 0) - y)
          l.canvas = next
          l.offsetX = 0
          l.offsetY = 0
        } else {
          // non-destructive crop: preserve the full raster backing store and
          // only change its registration relative to the new document frame.
          l.offsetX = (l.offsetX ?? 0) - x
          l.offsetY = (l.offsetY ?? 0) - y
        }
      } else if (l.canvas) {
        // derived/cache canvases are rebuilt in the new document space.
        const next = createCanvas(w, h)
        ctx2d(next).drawImage(l.canvas, -x, -y)
        l.canvas = next
      }
      if (l.mask) {
        const next = createCanvas(w, h)
        ctx2d(next).drawImage(l.mask, -x, -y)
        l.mask = next
      }
      if (l.transform) { l.transform.x -= x; l.transform.y -= y }
      if (l.text) { l.text.x -= x; l.text.y -= y }
      if (l.shape) { l.shape.x -= x; l.shape.y -= y }
      l._v++; l._mv++
    }
    if (doc.selection) {
      const next = createCanvas(w, h)
      ctx2d(next).drawImage(doc.selection.mask, -x, -y)
      doc.selection = { ...doc.selection, mask: next, _v: doc.selection._v + 1 }
    }
    for (const ch of doc.savedChannels) {
      const next = createCanvas(w, h)
      ctx2d(next).drawImage(ch.mask, -x, -y)
      ch.mask = next; ch._v++
    }
    doc.width = w; doc.height = h
    doc._epoch++
    invalidateFlat(doc)
    this.pushHistory(deletePixels ? 'Crop' : 'Crop (Preserve Pixels)')
    this.recordStep({ op: 'crop', args: { x, y, w, h, deletePixels }, label: 'Crop' })
    this.emit()
  }

  resizeCanvas(opts: { w: number; h: number; anchor: 'center' | 'top-left' | 'top' | 'top-right' | 'left' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right' }) {
    const doc = this.activeDoc
    if (!doc) return
    const { w, h } = opts
    let dx = 0, dy = 0
    const dw = w - doc.width, dh = h - doc.height
    if (opts.anchor.includes('left')) dx = 0
    else if (opts.anchor.includes('right')) dx = dw
    else dx = dw / 2
    if (opts.anchor.includes('top')) dy = 0
    else if (opts.anchor.includes('bottom')) dy = dh
    else dy = dh / 2
    for (const l of doc.layers) {
      if (l.canvas && l.kind === 'raster') {
        // shift the registration — the pixels themselves don't need to move
        l.offsetX = (l.offsetX ?? 0) + dx
        l.offsetY = (l.offsetY ?? 0) + dy
      } else if (l.canvas) {
        const c = createCanvas(w, h)
        ctx2d(c).drawImage(l.canvas, dx, dy)
        l.canvas = c
      }
      if (l.mask) {
        const c = createCanvas(w, h)
        ctx2d(c).drawImage(l.mask, dx, dy)
        l.mask = c
      }
      if (l.transform) { l.transform.x += dx; l.transform.y += dy }
      if (l.text) { l.text.x += dx; l.text.y += dy }
      if (l.shape) { l.shape.x += dx; l.shape.y += dy }
      l._v++; l._mv++
    }
    doc.width = w; doc.height = h
    doc._epoch++
    invalidateFlat(doc)
    this.pushHistory('Canvas Size')
    this.emit()
  }

  resizeImage(opts: { w: number; h: number }) {
    const doc = this.activeDoc
    if (!doc) return
    const { w, h } = opts
    const sx = w / doc.width, sy = h / doc.height
    for (const l of doc.layers) {
      if (l.canvas) l.canvas = resampleCanvas(l.canvas, Math.round(l.canvas.width * sx), Math.round(l.canvas.height * sy))
      if (l.kind === 'raster') { l.offsetX = (l.offsetX ?? 0) * sx; l.offsetY = (l.offsetY ?? 0) * sy }
      if (l.mask) l.mask = resampleCanvas(l.mask, Math.round(l.mask.width * sx), Math.round(l.mask.height * sy))
      if (l.source) l.source = resampleCanvas(l.source, Math.round(l.source.width * sx), Math.round(l.source.height * sy))
      if (l.transform) { l.transform.x *= sx; l.transform.y *= sy; l.transform.scale *= Math.min(sx, sy) }
      if (l.text) { l.text.x *= sx; l.text.y *= sy; l.text.fontSize *= sy }
      if (l.shape) {
        l.shape.x *= sx; l.shape.y *= sy; l.shape.w *= sx; l.shape.h *= sy
        l.shape.radius *= Math.min(sx, sy); l.shape.strokeWidth *= Math.min(sx, sy)
      }
      l._v++; l._mv++
    }
    if (doc.selection) {
      const c = resampleCanvas(doc.selection.mask, w, h)
      doc.selection = { ...doc.selection, mask: c, _v: doc.selection._v + 1 }
    }
    for (const ch of doc.savedChannels) {
      ch.mask = resampleCanvas(ch.mask, w, h); ch._v++
    }
    doc.width = Math.round(w); doc.height = Math.round(h)
    doc._epoch++
    invalidateFlat(doc)
    this.pushHistory('Image Size')
    this.recordStep({ op: 'resizeImage', args: { w: doc.width, h: doc.height }, label: 'Image Size' })
    this.emit()
  }

  // ================================================== AI upscaler
  /**
   * AI Upscale — Lanczos-3 resampling with edge-adaptive detail enhancement
   * and a pre-pass denoise. Scales the whole document in place, preserving
   * layer structure: raster canvases get the full smart pipeline, masks and
   * smart-object sources get clean Lanczos, text/shape layers re-render
   * crisply from their (scaled) specs. History + action-recorded.
   */
  async aiUpscale(opts: {
    scale?: number; detail?: number; denoise?: number
    onProgress?: (p: number) => void
  }): Promise<boolean> {
    const doc = this.activeDoc
    if (!doc) { this.ui?.toast('No active document', 'error'); return false }
    const scale = clamp(opts.scale ?? 2, 0.25, 4)
    const w = Math.max(1, Math.round(doc.width * scale))
    const h = Math.max(1, Math.round(doc.height * scale))
    if (w * h > 40_000_000) {
      this.ui?.toast('Result would exceed 40 MP — pick a smaller scale', 'error')
      return false
    }
    const sx = w / doc.width, sy = h / doc.height
    const detail = opts.detail ?? 55
    const denoise = opts.denoise ?? 20
    const onProgress = opts.onProgress
    const layers = doc.layers
    const per = 1 / Math.max(1, layers.length)
    let done = 0

    for (const l of layers) {
      if (l.kind === 'raster' && l.canvas) {
        // full smart pipeline on pixel layers
        const src = cloneCanvas(l.canvas)
        l.canvas = await imageOps.upscaleSmart(src, {
          scale, detail, denoise,
          onProgress: p => onProgress?.(clamp(done * per + p * per, 0, 1)),
        })
        l.offsetX = (l.offsetX ?? 0) * sx
        l.offsetY = (l.offsetY ?? 0) * sy
      } else if (l.canvas) {
        // text/shape cache canvases — plain Lanczos (spec re-render stays crisp)
        l.canvas = await imageOps.lanczosResample(l.canvas, Math.round(l.canvas.width * sx), Math.round(l.canvas.height * sy))
      }
      if (l.mask) l.mask = await imageOps.lanczosResample(l.mask, Math.round(l.mask.width * sx), Math.round(l.mask.height * sy))
      if (l.source) {
        // smart-object source: clean Lanczos only (filters re-apply after).
        // NOTE: transform.scale is applied to the source at render time
        // (prepareLayer: ctx.scale(t.scale) over the source bitmap), and the
        // source is already resized by sx/sy here — so transform.scale must
        // stay UNCHANGED or the layer would render at sx² (double-scale).
        l.source = await imageOps.lanczosResample(l.source, Math.round(l.source.width * sx), Math.round(l.source.height * sy))
        if (l.transform) { l.transform.x *= sx; l.transform.y *= sy }
      }
      if (l.text) { l.text.x *= sx; l.text.y *= sy; l.text.fontSize *= sy }
      if (l.shape) {
        l.shape.x *= sx; l.shape.y *= sy; l.shape.w *= sx; l.shape.h *= sy
        l.shape.radius *= Math.min(sx, sy); l.shape.strokeWidth *= Math.min(sx, sy)
      }
      l._v++; l._mv++
      done++
      onProgress?.(done * per)
    }
    if (doc.selection) {
      const c = await imageOps.lanczosResample(doc.selection.mask, w, h)
      doc.selection = { ...doc.selection, mask: c, _v: doc.selection._v + 1, _paths: null, _pathsV: 0 }
    }
    for (const ch of doc.savedChannels) {
      ch.mask = await imageOps.lanczosResample(ch.mask, w, h)
      ch._v++
    }
    doc.width = w; doc.height = h
    doc._epoch++
    invalidateFlat(doc)
    // keep the CURRENT zoom (Photoshop behavior): the bigger document now
    // shows more pixels on screen at the same zoom — the extra resolution is
    // immediately visible instead of being re-fit to the same screen size.
    this.pushHistory(`AI Upscale ×${scale.toFixed(2).replace(/\.?0+$/, '')}`)
    this.recordStep({ op: 'aiUpscale', args: { scale, detail, denoise }, label: 'AI Upscale' })
    this.emit()
    onProgress?.(1)
    this.ui?.toast(`AI Upscale ×${scale.toFixed(2).replace(/\.?0+$/, '')} — ${w} × ${h} px. Zoom in (Ctrl+) to inspect the detail; Ctrl+0 re-fits.`, 'success')
    return true
  }

  rotateCanvas(deg: number) {
    const doc = this.activeDoc
    if (!doc) return
    const rad = (deg * Math.PI) / 180
    const rc = Math.cos(rad), rs = Math.sin(rad)
    const cos = Math.abs(rc), sin = Math.abs(rs)
    const w = Math.round(doc.width * cos + doc.height * sin)
    const h = Math.round(doc.width * sin + doc.height * cos)
    const rotateCanvasPixels = (src: HTMLCanvasElement): HTMLCanvasElement => {
      const c = createCanvas(w, h)
      const ctx = ctx2d(c)
      ctx.translate(w / 2, h / 2)
      ctx.rotate(rad)
      ctx.drawImage(src, -doc.width / 2, -doc.height / 2)
      return c
    }
    // offset raster layers: bake to doc-space first (the rotation math above
    // assumes layer canvases are doc-registered)
    for (const l of doc.layers) {
      if (l.kind === 'raster' && l.canvas && (l.offsetX || l.offsetY)) {
        const baked = createCanvas(doc.width, doc.height)
        ctx2d(baked).drawImage(l.canvas, l.offsetX ?? 0, l.offsetY ?? 0)
        l.canvas = baked
        l.offsetX = 0
        l.offsetY = 0
      }
    }
    for (const l of doc.layers) {
      if (l.canvas) l.canvas = rotateCanvasPixels(l.canvas)
      if (l.mask) l.mask = rotateCanvasPixels(l.mask)
      if (l.source) {
        // bake transform into source-space: simpler: keep source, wrap in smart rotate via transform math
        l.source = rotateCanvasPixels(l.source)
      }
      if (l.transform) {
        // rotate anchor point around old center
        const t = l.transform
        const ox = t.x - doc.width / 2, oy = t.y - doc.height / 2
        t.x = w / 2 + ox * rc - oy * rs
        t.y = h / 2 + ox * rs + oy * rc
        t.rotation += rad
      }
      if (l.text) {
        const ox = l.text.x - doc.width / 2, oy = l.text.y - doc.height / 2
        l.text.x = w / 2 + ox * rc - oy * rs
        l.text.y = h / 2 + ox * rs + oy * rc
      }
      if (l.shape) {
        const ox = l.shape.x - doc.width / 2, oy = l.shape.y - doc.height / 2
        l.shape.x = w / 2 + ox * rc - oy * rs
        l.shape.y = h / 2 + ox * rs + oy * rc
      }
      l._v++; l._mv++
    }
    if (doc.selection) {
      doc.selection = { ...doc.selection, mask: rotateCanvasPixels(doc.selection.mask), _v: doc.selection._v + 1 }
    }
    doc.width = w; doc.height = h
    doc._epoch++
    invalidateFlat(doc)
    this.pushHistory(`Rotate Canvas ${deg}°`)
    this.emit()
  }

  flipCanvas(dir: 'horizontal' | 'vertical') {
    const doc = this.activeDoc
    if (!doc) return
    const flip = (src: HTMLCanvasElement): HTMLCanvasElement => {
      const c = createCanvas(src.width, src.height)
      const ctx = ctx2d(c)
      ctx.translate(dir === 'horizontal' ? src.width : 0, dir === 'vertical' ? src.height : 0)
      ctx.scale(dir === 'horizontal' ? -1 : 1, dir === 'vertical' ? -1 : 1)
      ctx.drawImage(src, 0, 0)
      return c
    }
    for (const l of doc.layers) {
      if (l.canvas) l.canvas = flip(l.canvas)
      if (l.mask) l.mask = flip(l.mask)
      if (l.source) l.source = flip(l.source)
      if (l.kind === 'raster' && l.canvas) {
        // mirror the registration so the flipped pixels land at the mirrored doc rect
        if (dir === 'horizontal') l.offsetX = doc.width - (l.offsetX ?? 0) - l.canvas.width
        else l.offsetY = doc.height - (l.offsetY ?? 0) - l.canvas.height
      }
      if (l.transform) {
        if (dir === 'horizontal') l.transform.x = doc.width - l.transform.x
        else l.transform.y = doc.height - l.transform.y
        l.transform.rotation = -l.transform.rotation
      }
      l._v++; l._mv++
    }
    if (doc.selection) doc.selection = { ...doc.selection, mask: flip(doc.selection.mask), _v: doc.selection._v + 1 }
    doc._epoch++
    invalidateFlat(doc)
    this.pushHistory(`Flip Canvas ${dir}`)
    this.emit()
  }

  /** Free Transform — scale/rotate around the layer's CONTENT center, then
   *  translate by (x,y) doc px.
   *  · opts.x / opts.y are TRANSLATIONS in document pixels (matching the
   *    Transform dialog's "Offset X/Y (px)" fields) — NOT absolute
   *    positions. (The old code treated them as absolute for smart layers,
   *    so the dialog's default 0/0 teleported the layer's center to the
   *    doc's top-left corner → "layer turned invisible".)
   *  · opts.scale is an absolute scale factor (1 = unchanged) applied about
   *    the content center; opts.rotation absolute degrees.
   *  · Smart layers: pure transform fields (non-destructive, re-editable).
   *  · Raster layers: ONE high-quality resample into a rotation-AABB-sized
   *    canvas, re-registered so the content center stays fixed in doc space
   *    (off-canvas pixels hang off like any moved layer — Photoshop parity).
   *    The old code cropped to the FIRST opaque row (broken early-exit
   *    bounds scan), collapsing the layer to a sliver → invisible.
   *  · Text/shape layers: spec fields scaled about the content center. */
  freeTransformLayer(id: string, opts: { x?: number; y?: number; scale?: number; rotation?: number }) {
    const doc = this.activeDoc
    const layer = this.layerById(id)
    if (!doc || !layer) return
    if (layer.kind === 'adjustment') { this.ui?.toast('Adjustment layers have no pixels to transform', 'error'); return }
    if (layer.locked) { this.ui?.toast('Layer is locked', 'error'); return }
    const s = Math.max(0.01, opts.scale ?? 1)
    const rot = ((opts.rotation ?? 0) * Math.PI) / 180
    const tx = opts.x ?? 0, ty = opts.y ?? 0

    if (layer.kind === 'smart') {
      if (!layer.transform) layer.transform = { x: doc.width / 2, y: doc.height / 2, scale: 1, rotation: 0 }
      const t = layer.transform
      layer.transform = {
        x: t.x + tx, y: t.y + ty,
        scale: s, rotation: rot,
      }
      layer._v++
      invalidateFlat(doc)
      this.pushHistory('Free Transform')
      this.emit()
      return
    }

    const r = this.layerContentRect(id)
    if (!r || r.w < 1 || r.h < 1) { this.ui?.toast('This layer has no content to transform', 'error'); return }
    // content center in doc space (pre-transform) + translation
    const cxDoc = r.x + r.w / 2 + tx
    const cyDoc = r.y + r.h / 2 + ty

    if (layer.kind === 'text' && layer.text) {
      const t = layer.text
      layer.text = {
        ...t,
        fontSize: Math.max(1, t.fontSize * s),
        x: Math.round(cxDoc - (r.w * s) / 2),
        y: Math.round(cyDoc - (r.h * s) / 2),
      }
      layer._v++
      invalidateFlat(doc)
      this.pushHistory('Free Transform')
      this.emit()
      return
    }
    if (layer.kind === 'shape' && layer.shape) {
      const sp = layer.shape
      layer.shape = {
        ...sp,
        w: sp.w * s, h: sp.h * s,
        x: Math.round(cxDoc - (r.w * s) / 2),
        y: Math.round(cyDoc - (r.h * s) / 2),
      }
      layer._v++
      invalidateFlat(doc)
      this.pushHistory('Free Transform')
      this.emit()
      return
    }

    // raster: bake once around the content center
    if (!layer.canvas) return
    const src = layer.canvas
    // FULL content-bounds scan (the old early-exit scan found only the first
    // opaque row — everything below was discarded)
    const d = getImageData(src).data
    let minX = src.width, minY = src.height, maxX = -1, maxY = -1
    for (let y = 0; y < src.height; y++) {
      const row = y * src.width
      for (let x = 0; x < src.width; x++) {
        if (d[(row + x) * 4 + 3] > 0) {
          if (x < minX) minX = x; if (x > maxX) maxX = x
          if (y < minY) minY = y; if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < minX || maxY < minY) { this.ui?.toast('This layer has no content to transform', 'error'); return }
    const bw = maxX - minX + 1, bh = maxY - minY + 1
    // transformed content AABB (rotation-aware), 2px margin for AA edges
    const cos = Math.abs(Math.cos(rot)), sin = Math.abs(Math.sin(rot))
    const nw = Math.max(1, Math.ceil(bw * s * cos + bh * s * sin) + 2)
    const nh = Math.max(1, Math.ceil(bw * s * sin + bh * s * cos) + 2)
    const out = createCanvas(nw, nh)
    const c = ctx2d(out)
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    c.translate(nw / 2, nh / 2)
    c.rotate(rot)
    c.scale(s, s)
    // draw the source centered on the content center (transparent margins are
    // harmless and keep the mapping exact)
    c.drawImage(src, -(minX + bw / 2), -(minY + bh / 2))
    // re-register: content center fixed at (cxDoc, cyDoc)
    layer.canvas = out
    layer.offsetX = Math.round(cxDoc - nw / 2)
    layer.offsetY = Math.round(cyDoc - nh / 2)
    layer._v++
    invalidateFlat(doc)
    this.pushHistory('Free Transform')
    this.emit()
  }

  // ================================================== view
  setChannelView(v: ChannelView) {
    const doc = this.activeDoc
    if (!doc) return
    doc.channelView = v
    invalidateFlat(doc)
    this.emit()
  }

  setZoom(z: number) {
    const doc = this.activeDoc
    if (!doc) return
    doc.view.zoom = clamp(z, 0.02, 32)
    doc.view.autoFit = false // user-specified zoom → view is now sticky per-doc
    this.emitView()
  }

  zoomBy(factor: number) {
    const doc = this.activeDoc
    if (!doc) return
    this.setZoom(doc.view.zoom * factor)
  }

  fitToScreen(viewW: number, viewH: number) {
    const doc = this.activeDoc
    if (!doc) return
    const z = Math.min((viewW - 80) / doc.width, (viewH - 80) / doc.height, 8)
    doc.view.zoom = clamp(z, 0.02, 32)
    doc.view.panX = (viewW - doc.width * doc.view.zoom) / 2
    doc.view.panY = (viewH - doc.height * doc.view.zoom) / 2
    doc.view.autoFit = false // concrete view assigned → sticky from now on
    this.emit()
  }

  /** union of every VISIBLE layer's opaque-content bounds in doc space
   *  (transparent margins ignored). A bottom layer that covers the whole
   *  document (an opaque Background/backdrop) is EXCLUDED when other layers
   *  contribute content, so "fit content" zooms to the subject, not the
   *  blank background around it. Returns null when the doc is empty. */
  contentBounds(): Rect | null {
    const doc = this.activeDoc
    if (!doc) return null
    type Found = { layerName: string; r: Rect; area: number }
    const found: Found[] = []
    const absorb = (list: Found[]): Rect | null => {
      if (!list.length) return null
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const f of list) {
        x0 = Math.min(x0, f.r.x); y0 = Math.min(y0, f.r.y)
        x1 = Math.max(x1, f.r.x + f.r.w); y1 = Math.max(y1, f.r.y + f.r.h)
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    }
    for (const l of doc.layers) {
      if (!l.visible || l.kind === 'adjustment') continue
      const prepared = prepareLayer(doc, l)
      if (!prepared) continue
      const d = getImageData(prepared).data
      const W = prepared.width, H = prepared.height
      // stride scan (every 4th row/col) for speed; ±2px precision is plenty
      // for a view-fit target
      const stride = 4
      let minX = W, minY = H, maxX = -1, maxY = -1
      for (let y = 0; y < H; y += stride) {
        const row = y * W
        for (let x = 0; x < W; x += stride) {
          if (d[(row + x) * 4 + 3] > 8) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (maxX >= minX) {
        found.push({ layerName: l.name, r: { x: minX, y: minY, w: maxX - minX + stride, h: maxY - minY + stride }, area: (maxX - minX + stride) * (maxY - minY + stride) })
      }
    }
    if (!found.length) return null
    // backdrop exclusion: the BOTTOM layer when its bounds cover ~the whole doc
    const docArea = doc.width * doc.height
    const bottom = found[0]
    const isBackdrop = bottom.area >= docArea * 0.95
    const subject = isBackdrop && found.length > 1 ? found.slice(1) : found
    const b = (absorb(subject) ?? absorb(found)) as Rect | null
    return b && b.w > 0 && b.h > 0 ? b : null
  }

  /** "Fit blank space": zoom so the layer CONTENT (not the transparent /
   *  background margins around it) fills the view. Falls back to a page fit
   *  for empty documents. */
  fitToContent(viewW: number, viewH: number) {
    const doc = this.activeDoc
    if (!doc) return
    const b = this.contentBounds()
    if (!b) { this.fitToScreen(viewW, viewH); return null }
    const margin = 48
    const z = clamp(Math.min((viewW - margin) / b.w, (viewH - margin) / b.h, 16), 0.02, 32)
    doc.view.zoom = z
    doc.view.panX = (viewW - b.w * z) / 2 - b.x * z
    doc.view.panY = (viewH - b.h * z) / 2 - b.y * z
    doc.view.autoFit = false
    this.emit()
    return b
  }

  // ================================================== previews (dialogs)
  setPreviewFilter(layerId: string, type: FilterType, params: Record<string, any>) {
    const doc = this.activeDoc
    if (!doc) return
    doc.previewFilter = { layerId, type, params: { ...params } }
    this.requestRender()
    for (const l of this.listeners) l()
  }

  clearPreviewFilter() {
    const doc = this.activeDoc
    if (!doc) return
    doc.previewFilter = null
    this.requestRender()
    for (const l of this.listeners) l()
  }

  setPreviewAdjustment(type: AdjustmentType, params: Record<string, any>) {
    const doc = this.activeDoc
    if (!doc) return
    doc.previewAdjustment = { type, params: { ...params } }
    this.requestRender()
    for (const l of this.listeners) l()
  }

  clearPreviewAdjustment() {
    const doc = this.activeDoc
    if (!doc) return
    doc.previewAdjustment = null
    this.requestRender()
    for (const l of this.listeners) l()
  }

  // ================================================== actions recorder
  startRecording() {
    this.recordingAction = { id: uid(), name: `Action ${this.actions.length + 1}`, steps: [], created: Date.now() }
    this.emit()
  }

  stopRecording(): PsAction | null {
    const a = this.recordingAction
    this.recordingAction = null
    if (a && a.steps.length) {
      this.actions.push(a)
      this.persistActions()
    }
    this.emit()
    return a
  }

  get isRecording(): boolean { return !!this.recordingAction }

  private recordStep(step: ActionStep) {
    if (this.recordingAction) this.recordingAction.steps.push(step)
  }

  playAction(action: PsAction, doc: PsDocument | null = this.activeDoc): void {
    if (!doc) return
    for (const step of action.steps) {
      try { this.playStep(step) } catch { /* continue */ }
    }
    this.emit()
  }

  private playStep(step: ActionStep) {
    const a = step.args
    const layerId = a.layerId && this.layerById(a.layerId) ? a.layerId : this.activeLayer?.id
    switch (step.op) {
      case 'applyFilter': if (layerId) this.applyFilterToLayer(layerId, a.type, a.params); break
      case 'applyAdjustment': if (layerId) this.applyAdjustmentToLayer(layerId, a.type, a.params); break
      case 'fill': this.fillSelection(a.color); break
      case 'crop': this.cropTo({ x: a.x, y: a.y, w: a.w, h: a.h }); break
      case 'resizeImage': this.resizeImage({ w: a.w, h: a.h }); break
      case 'aiUpscale': void this.aiUpscale({ scale: a.scale, detail: a.detail, denoise: a.denoise }); break
      case 'addAdjustmentLayer': this.addAdjustmentLayer(a.type, a.params); break
      case 'setAdjustmentParams': if (this.layerById(a.id)) this.setLayerAdjustment(a.id, a.type, a.params); break
      case 'contentAwareFill': this.contentAwareFill(); break
      case 'addLayer': this.addRasterLayer(a.name); break
      case 'flatten': this.flatten(); break
      case 'rotate': this.rotateCanvas(a.deg); break
      case 'flipCanvas': this.flipCanvas(a.dir); break
      case 'invertAdjust': if (layerId) this.applyAdjustmentToLayer(layerId, 'invert', {}); break
      case 'applyFilterComposite': {
        const doc = this.activeDoc
        if (doc) {
          const flat = compositeDocument(doc)
          const img = getImageData(flat)
          imageOps.applyFilter(img, a.type, a.params)
          putImageData(flat, img)
          const layer = newLayer('raster', 'Filtered', doc.width, doc.height)
          ctx2d(layer.canvas!).drawImage(flat, 0, 0)
          doc.layers.push(layer)
          doc.activeLayerId = layer.id
          this.pushHistory('Batch Filter')
        }
        break
      }
    }
  }

  deleteAction(id: string) {
    this.actions = this.actions.filter(a => a.id !== id)
    this.persistActions()
    this.emit()
  }

  private persistActions() {
    try { localStorage.setItem('zphoto-actions', JSON.stringify(this.actions)) } catch { /* ignore */ }
  }

  loadPersistedActions() {
    try {
      const raw = localStorage.getItem('zphoto-actions')
      if (raw) this.actions = JSON.parse(raw)
    } catch { /* ignore */ }
  }

  // ================================================== export / io
  async exportActive(opts: ExportOptions, doc: PsDocument = this.activeDoc!): Promise<void> {
    if (!doc) return
    const flat = compositeDocument(doc)
    let out = flat
    if (opts.scale !== 1) {
      const w = Math.round(doc.width * opts.scale), h = Math.round(doc.height * opts.scale)
      out = createCanvas(w, h)
      const c = ctx2d(out)
      c.imageSmoothingQuality = 'high'
      c.drawImage(flat, 0, 0, w, h)
    }
    const type = opts.format === 'jpeg' ? 'image/jpeg' : opts.format === 'webp' ? 'image/webp' : 'image/png'
    const blob = await canvasToBlob(out, type, opts.format === 'png' ? undefined : opts.quality / 100)
    downloadBlob(blob, `${opts.fileName || doc.name}.${opts.format}`)
  }

  get scriptApi() { return getScriptApi(this) }

  // helpers
  nextLayerName(): string {
    const doc = this.activeDoc
    if (!doc) return 'Layer'
    let n = doc.layers.length + 1
    while (doc.layers.find(l => l.name === `Layer ${n}`)) n++
    return `Layer ${n}`
  }

  // ================================================== Frame Animation (Task 9-c)
  // Frame records store per-layer overrides (visible/opacity/x/y). While
  // timelineActive, every setLayerProps call mirrors visible/opacity/position
  // into the ACTIVE frame record (see the hook above), and the timeline panel
  // additionally syncs on store ticks — so live edits land in the frame.

  /** true while the timeline owns the document (frames exist) */
  timelineActive = false
  /** index of the frame currently applied to the real layers */
  activeFrameIndex = 0

  get frames(): AnimFrame[] {
    return this.activeDoc?.frames ?? []
  }

  /** frame-layer record for the layer's CURRENT state (position maps to
   *  offsetX/offsetY for raster, transform/text/shape for the others) */
  private snapshotLayerRec(l: Layer): AnimFrame['layers'][string] {
    const rec: AnimFrame['layers'][string] = { visible: l.visible, opacity: l.opacity }
    if (l.kind === 'raster') { rec.x = l.offsetX ?? 0; rec.y = l.offsetY ?? 0 }
    else if (l.kind === 'smart' && l.transform) { rec.x = l.transform.x; rec.y = l.transform.y }
    else if (l.kind === 'text' && l.text) { rec.x = l.text.x; rec.y = l.text.y }
    else if (l.kind === 'shape' && l.shape) { rec.x = l.shape.x; rec.y = l.shape.y }
    return rec
  }

  /** setLayerProps patch that moves layer `l` to the frame-record position */
  private framePosPatch(l: Layer, rec: AnimFrame['layers'][string]): Partial<Layer> | null {
    if (rec.x === undefined && rec.y === undefined) return null
    const { x, y } = rec
    if (l.kind === 'raster') {
      return { offsetX: x ?? l.offsetX ?? 0, offsetY: y ?? l.offsetY ?? 0 }
    }
    if (l.kind === 'smart' && l.transform) {
      return { transform: { ...l.transform, x: x ?? l.transform.x, y: y ?? l.transform.y } }
    }
    if (l.kind === 'text' && l.text) {
      return { text: { ...l.text, x: x ?? l.text.x, y: y ?? l.text.y } }
    }
    if (l.kind === 'shape' && l.shape) {
      return { shape: { ...l.shape, x: x ?? l.shape.x, y: y ?? l.shape.y } }
    }
    return null
  }

  /** create the frame animation if missing — frame 0 snapshots the current
   *  layer state; commits history 'Create Frame Animation' */
  ensureFrames(): AnimFrame[] {
    const doc = this.activeDoc
    if (!doc) return []
    if (doc.frames?.length) {
      this.timelineActive = true
      if (this.activeFrameIndex >= doc.frames.length) this.activeFrameIndex = doc.frames.length - 1
      this.emit()
      return doc.frames
    }
    const f: AnimFrame = { id: uid(), name: 'Frame 1', delayMs: 100, layers: {} }
    doc.frames = [f]
    this.timelineActive = true
    this.activeFrameIndex = 0
    this.syncFrameFromLayers(0)
    this.pushHistory('Create Frame Animation')
    this.emit()
    return doc.frames
  }

  /** append a frame after the active one; 'duplicate' snapshots the CURRENT
   *  layer state, 'empty' hides all layers. Applies the new frame, commits
   *  history 'Add Frame', returns the new frame index. */
  addFrame(mode: 'empty' | 'duplicate' = 'duplicate'): number {
    const doc = this.activeDoc
    const frames = doc?.frames
    if (!doc || !frames?.length) return -1
    const cur = frames[this.activeFrameIndex] ?? frames[frames.length - 1]
    const layers: AnimFrame['layers'] = {}
    for (const l of doc.layers) {
      if (mode === 'duplicate') layers[l.id] = this.snapshotLayerRec(l)
      else layers[l.id] = { ...this.snapshotLayerRec(l), visible: false }
    }
    const f: AnimFrame = { id: uid(), name: `Frame ${frames.length + 1}`, delayMs: cur?.delayMs ?? 100, layers }
    const at = clamp(this.activeFrameIndex + 1, 0, frames.length)
    frames.splice(at, 0, f)
    this.applyFrameToLayers(at, { silent: true })
    this.pushHistory('Add Frame')
    this.emit()
    return at
  }

  /** delete frame i — the only remaining frame is blocked with a toast */
  deleteFrame(i: number): void {
    const doc = this.activeDoc
    const frames = doc?.frames
    if (!doc || !frames?.length) return
    if (frames.length <= 1) {
      this.ui?.toast('Cannot delete the only frame — the animation needs at least one', 'error')
      return
    }
    const idx = clamp(i, 0, frames.length - 1)
    frames.splice(idx, 1)
    let next = this.activeFrameIndex
    if (idx < next) next--
    next = clamp(next, 0, frames.length - 1)
    this.activeFrameIndex = next
    this.applyFrameToLayers(next, { silent: true })
    this.pushHistory('Delete Frame')
    this.emit()
  }

  duplicateFrame(i: number): number {
    const doc = this.activeDoc
    const frames = doc?.frames
    if (!doc || !frames?.length) return -1
    const idx = clamp(i, 0, frames.length - 1)
    const src = frames[idx]
    const copy: AnimFrame = {
      id: uid(),
      name: `${src.name} copy`,
      delayMs: src.delayMs,
      layers: Object.fromEntries(Object.entries(src.layers).map(([k, v]) => [k, { ...v }])),
    }
    frames.splice(idx + 1, 0, copy)
    this.applyFrameToLayers(idx + 1, { silent: true })
    this.pushHistory('Duplicate Frame')
    this.emit()
    return idx + 1
  }

  moveFrame(from: number, to: number): void {
    const doc = this.activeDoc
    const frames = doc?.frames
    if (!doc || !frames || frames.length < 2) return
    const f = clamp(from, 0, frames.length - 1)
    const t = clamp(to, 0, frames.length - 1)
    if (t === f) return
    const activeFr = frames[this.activeFrameIndex] ?? null
    const [fr] = frames.splice(f, 1)
    frames.splice(t, 0, fr)
    this.activeFrameIndex = activeFr ? Math.max(0, frames.indexOf(activeFr)) : clamp(this.activeFrameIndex, 0, frames.length - 1)
    this.pushHistory('Move Frame')
    this.emit()
  }

  setFrameDelay(i: number, delayMs: number): void {
    const doc = this.activeDoc
    const frames = doc?.frames
    if (!doc || !frames?.length) return
    const idx = clamp(i, 0, frames.length - 1)
    const v = Math.round(clamp(delayMs, 10, 60000))
    if (frames[idx].delayMs === v) return
    frames[idx].delayMs = v
    this.pushHistory('Frame Delay')
    this.emit()
  }

  setFrameName(i: number, name: string): void {
    const doc = this.activeDoc
    const frames = doc?.frames
    if (!doc || !frames?.length) return
    const idx = clamp(i, 0, frames.length - 1)
    const trimmed = name.trim() || `Frame ${idx + 1}`
    if (frames[idx].name === trimmed) return
    frames[idx].name = trimmed
    this.emit() // silent — no history for a rename
  }

  /** SILENT batch: write frame i's layer overrides into the real layers via
   *  setLayerProps (history:false, silent) — then emit (unless opts.silent).
   *  Diff-checked so re-applying the active frame is a true no-op. */
  applyFrameToLayers(i: number, opts?: { history?: boolean; silent?: boolean }): void {
    const doc = this.activeDoc
    const frames = doc?.frames
    if (!doc || !frames?.length) return
    const idx = clamp(i, 0, frames.length - 1)
    this.activeFrameIndex = idx
    const fr = frames[idx]
    for (const l of doc.layers) {
      const rec = fr.layers[l.id]
      if (!rec) continue
      const patch: Partial<Layer> = {}
      if (rec.visible !== undefined && rec.visible !== l.visible) patch.visible = rec.visible
      if (rec.opacity !== undefined && rec.opacity !== l.opacity) patch.opacity = rec.opacity
      const pos = this.framePosPatch(l, rec)
      if (pos) Object.assign(patch, pos)
      if (Object.keys(patch).length) this.setLayerProps(l.id, patch, { history: false, silent: true })
    }
    if (opts?.history) this.pushHistory(`Apply Frame ${idx + 1}`)
    if (!opts?.silent) this.emit()
  }

  /** write the CURRENT layer state back into frame i's record (and backfill
   *  records for layers missing from other frames — new layers appear in all
   *  frames, like Photoshop's default). Fully silent. */
  syncFrameFromLayers(i: number): void {
    const doc = this.activeDoc
    const frames = doc?.frames
    if (!doc || !frames?.length) return
    const idx = clamp(i, 0, frames.length - 1)
    const fr = frames[idx]
    for (const l of doc.layers) fr.layers[l.id] = this.snapshotLayerRec(l)
    if (frames.length > 1) {
      const liveIds = new Set(doc.layers.map(l => l.id))
      for (const other of frames) {
        if (other === fr) continue
        for (const l of doc.layers) {
          if (!other.layers[l.id]) other.layers[l.id] = this.snapshotLayerRec(l)
        }
        // prune records of deleted layers
        for (const id of Object.keys(other.layers)) {
          if (!liveIds.has(id)) delete other.layers[id]
        }
      }
      for (const id of Object.keys(fr.layers)) {
        if (!liveIds.has(id)) delete fr.layers[id]
      }
    }
  }

  /** composite of frame i WITHOUT disturbing the live document: layer
   *  overrides are applied directly (bumped _v so the prepareLayer cache
   *  stays honest), the frame is composited fresh, then the exact previous
   *  state — including the original _v counters — is restored. Used for
   *  timeline thumbnails and animation export. */
  getFrameComposite(i: number): HTMLCanvasElement | null {
    const doc = this.activeDoc
    const frames = doc?.frames
    if (!doc || !frames?.length) return null
    // capture any pending live edits into the active frame record first
    this.syncFrameFromLayers(this.activeFrameIndex)
    const idx = clamp(i, 0, frames.length - 1)
    const fr = frames[idx]
    interface Saved {
      l: Layer; visible: boolean; opacity: number; v: number
      offsetX?: number; offsetY?: number
      transform: Layer['transform']; text: Layer['text']; shape: Layer['shape']
    }
    const touched: Saved[] = []
    for (const l of doc.layers) {
      const rec = fr.layers[l.id]
      if (!rec) continue
      touched.push({
        l, visible: l.visible, opacity: l.opacity, v: l._v,
        offsetX: l.offsetX, offsetY: l.offsetY,
        transform: l.transform, text: l.text, shape: l.shape,
      })
      if (rec.visible !== undefined) l.visible = rec.visible
      if (rec.opacity !== undefined) l.opacity = rec.opacity
      if (rec.x !== undefined || rec.y !== undefined) {
        const { x, y } = rec
        if (l.kind === 'raster') {
          l.offsetX = x ?? l.offsetX ?? 0
          l.offsetY = y ?? l.offsetY ?? 0
          l._v++
        } else if (l.kind === 'smart' && l.transform) {
          l.transform = { ...l.transform, x: x ?? l.transform.x, y: y ?? l.transform.y }
          l._v++
        } else if (l.kind === 'text' && l.text) {
          l.text = { ...l.text, x: x ?? l.text.x, y: y ?? l.text.y }
          l._v++
        } else if (l.kind === 'shape' && l.shape) {
          l.shape = { ...l.shape, x: x ?? l.shape.x, y: y ?? l.shape.y }
          l._v++
        }
      }
    }
    const flat = compositeDocument(doc)
    for (const s of touched) {
      s.l.visible = s.visible
      s.l.opacity = s.opacity
      s.l._v = s.v
      s.l.offsetX = s.offsetX
      s.l.offsetY = s.offsetY
      s.l.transform = s.transform
      s.l.text = s.text
      s.l.shape = s.shape
    }
    return flat
  }
}

function typeLabel(type: AdjustmentType): string {
  return imageOps.ADJUSTMENTS[type]?.label ?? type
}
function filterLabel(type: FilterType): string {
  return imageOps.FILTERS[type]?.label ?? type
}
export const engine = new Engine()
