// ============================================================
// Chay's Photo Engine — the single facade API for tools, panels, dialogs, menus
// Owns: documents, layers, selection, history, strokes, actions, previews
// ============================================================
import type {
  AdjustmentType, AnimFrame, BlendIfSettings, DialogType, ExportOptions, FilterType, Layer, LayerFX, LayerKind,
  PsDocument, PsAction, ActionStep, Rect, SelectionCombine, SelectionState, SavedChannel, HistoryState, ShapeSpec, TextSpec, ImageMetadata, ProofSettings,
  ChannelView, BrushSettings, BlendMode, SavedPath, PathAnchor, LayerComp, LayerCompOptions, LayerCompLayerState, HistorySnapshot, HistorySnapshotAutoPolicy, TransformWarpSpec,
} from '../types'
import { TOOL_MAP, BLEND_GCO } from '../constants/tools'
import {
  createCanvas, ctx2d, cloneCanvas, uid, getImageData, putImageData,
  hexToRgb, rgbToHex, clamp, drawSoftDab, canvasToBlob, downloadBlob, getMaskAlpha,
  canvasProfile, canvasPixelCapabilities, setCanvasWorkingProfile, getProcessingPixelData, putProcessingPixelData,
  getFloat16ImageData, hdrFloat32ToPreviewCanvas, srgbToSceneLinear,
} from '../utils/canvas'
import {
  compositeDocument, getFlatComposite, invalidateFlat, newLayer,
  renderShapeCanvas, renderTextCanvas, prepareLayer,
} from './document'
import { gaussianBlurChannel } from '../image-ops/core'
import { defringe, removeMatte } from '../image-ops/matting'
import { autoTone, autoContrast, autoColor } from '../image-ops/auto'
import { runPixelOpAsync, runPixelOpFromCanvas, type PixelOpSpec } from './pixel-worker'
import { isGlEnabled, setGlEnabled, glInfo, glAvailable } from './gl/gl-core'
import { resampleCanvas } from '../utils/canvas'
import {
  combineSelection, selectionFromMask, maskCanvasFromAlpha, modifySelection,
  channelMaskFromComposite, computeBounds,
} from './selection'
import { getScriptApi } from './scripting-api'
import * as imageOps from '../image-ops'
import { isFloatPixelImage, type PixelImage } from '../image-ops/pixel-data'
import { homography, projectPoint, quadOutputSize, warpCanvasPerspective, type Point2 } from '../image-ops/perspective'
import {
  cloneWarpMesh, mapNormalizedPointThroughWarp, mapRectPointToQuad, regularWarpMesh,
  validateWarpMesh, warpCanvasToMesh, warpCanvasToQuad, warpMeshDestinationPoints,
} from '../image-ops/transform'
import { mapVectorMask, type VectorMaskOp } from './vector-mask'
import { embedRasterMetadata } from '../formats/metadata-write'
import { affineHdrPixels, cropHdrPixels, flipHdrPixels, resampleHdrPixels, rotateHdrPixels } from '../image-ops/hdr-geometry'
import { splitHdrSelectionPixels } from '../image-ops/selection-pixels'

export const MAX_HISTORY = 50

const HISTORY_SNAPSHOT_PREFS_KEY = 'zphoto-history-snapshot-prefs'
export interface HistorySnapshotPreferences {
  autoNewDocument: boolean
  autoOpenedDocument: boolean
}

function loadHistorySnapshotPreferences(): HistorySnapshotPreferences {
  const fallback = { autoNewDocument: true, autoOpenedDocument: true }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_SNAPSHOT_PREFS_KEY) || '{}')
    return {
      autoNewDocument: raw?.autoNewDocument !== false,
      autoOpenedDocument: raw?.autoOpenedDocument !== false,
    }
  } catch {
    return fallback
  }
}

function canvasDepthForDocument(depth: 8 | 16 | 32 | undefined): 8 | 16 {
  return depth === 8 ? 8 : 16
}

function canvasFloatSnapshot(canvas: HTMLCanvasElement): Float32Array {
  const hi = getFloat16ImageData(canvas)
  if (hi?.data) {
    const src = hi.data as ArrayLike<number>
    const out = new Float32Array(src.length)
    for (let i = 0; i < src.length; i++) out[i] = Number(src[i])
    return out
  }
  const d = getImageData(canvas).data
  const out = new Float32Array(d.length)
  for (let i = 0; i < d.length; i++) out[i] = d[i] / 255
  return out
}

function hdrPixelsFromCanvas(canvas: HTMLCanvasElement): Float32Array {
  const preview = canvasFloatSnapshot(canvas)
  const out = new Float32Array(preview.length)
  for (let i = 0; i < preview.length; i += 4) {
    out[i] = srgbToSceneLinear(preview[i])
    out[i + 1] = srgbToSceneLinear(preview[i + 1])
    out[i + 2] = srgbToSceneLinear(preview[i + 2])
    out[i + 3] = preview[i + 3]
  }
  return out
}

function hdrProcessingImage(layer: Layer): PixelImage | null {
  if (!layer.hdrPixels || !layer.canvas) return null
  const data = new Float32Array(layer.hdrPixels.length)
  for (let i = 0; i < data.length; i++) data[i] = layer.hdrPixels[i] * 255
  return {
    width: layer.canvas.width,
    height: layer.canvas.height,
    data,
    precision: 'float32',
    dynamicRange: 'scene-linear',
  }
}

function commitHdrProcessingImage(layer: Layer, img: PixelImage): boolean {
  if (!layer.hdrPixels || !layer.canvas || !isFloatPixelImage(img)) return false
  const expected = layer.canvas.width * layer.canvas.height * 4
  if (img.data.length !== expected) return false
  const hdr = new Float32Array(expected)
  for (let i = 0; i < expected; i++) hdr[i] = img.data[i] / 255
  layer.hdrPixels = hdr
  layer.hdrColorSpace = 'linear-srgb'
  layer.canvas = hdrFloat32ToPreviewCanvas(hdr, img.width, img.height, 'srgb')
  layer._hdrPreviewBefore = null
  return true
}

function processSelectionMaskRegion(
  mask: HTMLCanvasElement,
  bounds: Rect,
  feather: number,
  hardThreshold: boolean,
): void {
  const sigma = Math.max(0, feather)
  const pad = Math.max(2, sigma > 0 ? Math.ceil(sigma * 3) + 2 : 2)
  const x0 = Math.max(0, Math.floor(bounds.x) - pad)
  const y0 = Math.max(0, Math.floor(bounds.y) - pad)
  const x1 = Math.min(mask.width, Math.ceil(bounds.x + bounds.w) + pad)
  const y1 = Math.min(mask.height, Math.ceil(bounds.y + bounds.h) + pad)
  const w = x1 - x0, h = y1 - y0
  if (w <= 0 || h <= 0) return

  const mc = ctx2d(mask)
  const md = mc.getImageData(x0, y0, w, h)
  if (hardThreshold) {
    for (let i = 3; i < md.data.length; i += 4) md.data[i] = md.data[i] >= 128 ? 255 : 0
  }
  if (sigma > 0) {
    const alpha = new Float32Array(w * h)
    for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = md.data[j]
    const blurred = gaussianBlurChannel(alpha, w, h, sigma)
    for (let i = 0, j = 3; i < blurred.length; i++, j += 4) md.data[j] = blurred[i]
  }
  mc.putImageData(md, x0, y0)
}

type Listener = () => void

export type TransformMode = 'free' | 'scale' | 'rotate' | 'skew' | 'distort' | 'perspective' | 'warp'
export type TransformReference = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br'
export interface LayerTransformCommand {
  mode: TransformMode
  x?: number
  y?: number
  scaleX?: number
  scaleY?: number
  rotation?: number
  skewX?: number
  skewY?: number
  perspectiveX?: number
  perspectiveY?: number
  reference?: TransformReference
  cornerOffsets?: [Point2, Point2, Point2, Point2]
  warp?: TransformWarpSpec | null
}

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
  private lastTransformCommand: LayerTransformCommand | null = null
  /** Remember only successfully committed filters, scoped to the source document. */
  private lastAppliedFilters = new WeakMap<PsDocument, { type: FilterType; params: Record<string, any> }>()

  canRepeatLastFilter(): boolean {
    const doc = this.activeDoc
    const layer = this.activeLayer
    return !!doc && !!layer && !layer.locked && layer.kind !== 'adjustment'
      && this.lastAppliedFilters.has(doc)
  }

  async repeatLastFilter(): Promise<void> {
    if (!this.canRepeatLastFilter()) return
    const doc = this.activeDoc!
    const layer = this.activeLayer!
    const last = this.lastAppliedFilters.get(doc)!
    await this.applyFilterToLayerAsync(layer.id, last.type, structuredClone(last.params))
  }

  private rememberLastFilter(doc: PsDocument, type: FilterType, params: Record<string, any>): void {
    this.lastAppliedFilters.set(doc, { type, params: structuredClone(params) })
  }

  /** Photoshop Select > Reselect: document-scoped, detached last deselection. */
  private lastDeselectedSelections = new WeakMap<PsDocument, SelectionState>()

  private mergeHdrCanvasEdits(layer: Layer): void {
    if (!layer.hdrPixels || !layer.canvas || !layer._hdrPreviewBefore) return
    const before = layer._hdrPreviewBefore
    const now = canvasFloatSnapshot(layer.canvas)
    if (before.length !== now.length || layer.hdrPixels.length !== now.length) {
      layer.hdrPixels = hdrPixelsFromCanvas(layer.canvas)
      layer.hdrColorSpace = 'linear-srgb'
      layer._hdrPreviewBefore = null
      return
    }
    const hdr = layer.hdrPixels
    const eps = 1e-5
    for (let i = 0; i < now.length; i += 4) {
      if (
        Math.abs(now[i] - before[i]) <= eps &&
        Math.abs(now[i + 1] - before[i + 1]) <= eps &&
        Math.abs(now[i + 2] - before[i + 2]) <= eps &&
        Math.abs(now[i + 3] - before[i + 3]) <= eps
      ) continue
      hdr[i] = srgbToSceneLinear(now[i])
      hdr[i + 1] = srgbToSceneLinear(now[i + 1])
      hdr[i + 2] = srgbToSceneLinear(now[i + 2])
      hdr[i + 3] = now[i + 3]
    }
    layer._hdrPreviewBefore = null
  }

  private syncPendingHdrCanvasEdits(doc: PsDocument | null = this.activeDoc): void {
    if (!doc) return
    for (const layer of doc.layers) this.mergeHdrCanvasEdits(layer)
  }

  private processingPixelsForLayer(layer: Layer): PixelImage | null {
    if (!layer.canvas) return null
    return hdrProcessingImage(layer) ?? getProcessingPixelData(layer.canvas)
  }

  private commitProcessingPixelsForLayer(layer: Layer, img: PixelImage): void {
    if (commitHdrProcessingImage(layer, img)) return
    if (layer.canvas) putProcessingPixelData(layer.canvas, img)
    layer._hdrPreviewBefore = null
  }

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

  setProofSettings(settings: Partial<ProofSettings>) {
    const doc = this.activeDoc
    if (!doc) return
    const current: ProofSettings = {
      enabled: false,
      gamutWarning: false,
      profile: 'cmyk-swop',
      intent: 'relative',
      blackPointCompensation: true,
      simulatePaperColor: false,
      ...doc.proof,
    }
    doc.proof = { ...current, ...structuredClone(settings) }
    // Proof setup is view state: do not dirty the document or add History.
    this.emitView()
  }

  toggleProofColors() {
    const doc = this.activeDoc
    if (!doc) return
    this.setProofSettings({ enabled: !(doc.proof?.enabled ?? false) })
  }

  toggleGamutWarning() {
    const doc = this.activeDoc
    if (!doc) return
    this.setProofSettings({ gamutWarning: !(doc.proof?.gamutWarning ?? false) })
  }

  emit() {
    // Keep multi-layer selection coherent no matter which subsystem changed
    // activeLayerId. The active layer is always the primary member.
    const doc = this.activeDoc
    this.syncPendingHdrCanvasEdits(doc)
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

  /** Source surface matching Transform Warp's normalized 0..1 coordinate space.
   * Used by the Puppet Warp editor for a faithful preview without mutating the layer. */
  warpSourceCanvas(layerId: string): HTMLCanvasElement | null {
    const doc = this.activeDoc
    const layer = this.layerById(layerId)
    if (!doc || !layer || layer.kind === 'adjustment') return null
    if (layer.kind === 'raster' && layer.canvas) return cloneCanvas(layer.canvas)
    if (layer.kind === 'smart' && layer.source) return cloneCanvas(layer.source)
    const r = this.layerContentRect(layerId)
    if (!r || r.w < 1 || r.h < 1) return null
    const full = layer.kind === 'text' && layer.text
      ? renderTextCanvas(doc, layer.text)
      : layer.kind === 'shape' && layer.shape
        ? renderShapeCanvas(doc, layer.shape)
        : null
    if (!full) return null
    const out = createCanvas(Math.max(1, Math.ceil(r.w)), Math.max(1, Math.ceil(r.h)))
    ctx2d(out).drawImage(full, -r.x, -r.y)
    return out
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
    const c = createCanvas(doc.width, doc.height, {
      bitDepth: canvasDepthForDocument(doc.workingBitDepth),
      colorSpace: doc.workingColorSpace ?? 'srgb',
    })
    ctx2d(c).drawImage(l.canvas, ox, oy)
    if (l.hdrPixels) {
      const srcW = l.canvas.width, srcH = l.canvas.height
      const baked = new Float32Array(doc.width * doc.height * 4)
      for (let y = 0; y < srcH; y++) {
        const dy = y + Math.round(oy)
        if (dy < 0 || dy >= doc.height) continue
        for (let x = 0; x < srcW; x++) {
          const dx = x + Math.round(ox)
          if (dx < 0 || dx >= doc.width) continue
          const si = (y * srcW + x) * 4
          const di = (dy * doc.width + dx) * 4
          baked[di] = l.hdrPixels[si]
          baked[di + 1] = l.hdrPixels[si + 1]
          baked[di + 2] = l.hdrPixels[si + 2]
          baked[di + 3] = l.hdrPixels[si + 3]
        }
      }
      l.hdrPixels = baked
      l.hdrColorSpace = 'linear-srgb'
      l._hdrPreviewBefore = null
    }
    l.canvas = c
    l.offsetX = 0
    l.offsetY = 0
    l._v++
    invalidateFlat(doc)
    return l
  }

  // ================================================== document management
  newDocument(opts: {
    name?: string
    width: number
    height: number
    resolutionPpi?: number
    bitDepth?: 8 | 16 | 32
    colorSpace?: 'srgb' | 'display-p3'
    fill?: 'white' | 'transparent' | 'background' | string
  }): PsDocument {
    const { width, height } = opts
    const caps = canvasPixelCapabilities()
    const wantsHighDepth = (opts.bitDepth === 16 || opts.bitDepth === 32) && caps.float16Context && caps.float16ImageData
    const profile = setCanvasWorkingProfile({
      bitDepth: wantsHighDepth ? 16 : 8,
      colorSpace: opts.colorSpace === 'display-p3' && opts.bitDepth !== 32 && caps.displayP3 ? 'display-p3' : 'srgb',
    })
    const workingBitDepth: 8 | 16 | 32 = opts.bitDepth === 32 && wantsHighDepth ? 32 : profile.bitDepth
    const doc: PsDocument = {
      id: uid(), name: opts.name || `Untitled-${this.docs.length + 1}`,
      width, height,
      resolutionPpi: clamp(Number(opts.resolutionPpi) || 72, 1, 12000),
      workingBitDepth, sourceBitDepth: workingBitDepth, workingColorSpace: profile.colorSpace,
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
    if (workingBitDepth === 32 && bg.canvas) {
      bg.hdrPixels = hdrPixelsFromCanvas(bg.canvas)
      bg.hdrColorSpace = 'linear-srgb'
      bg.canvas = hdrFloat32ToPreviewCanvas(bg.hdrPixels, width, height, 'srgb')
    }
    doc.layers.push(bg)
    doc.activeLayerId = bg.id
    this.docs.push(doc)
    this._activeId = doc.id
    setCanvasWorkingProfile({ bitDepth: canvasDepthForDocument(doc.workingBitDepth), colorSpace: doc.workingColorSpace ?? 'srgb' })
    this.pushHistory('New Document', doc)
    this.maybeCreateAutomaticHistorySnapshot('new', doc)
    this.emit()
    return doc
  }

  addCanvasDocument(
    canvas: HTMLCanvasElement,
    name: string,
    meta: { sourceBitDepth?: number; workingBitDepth?: 8 | 16 | 32; workingColorSpace?: 'srgb' | 'display-p3'; resolutionPpi?: number; hdrPixels?: Float32Array; metadata?: ImageMetadata } = {},
  ): PsDocument {
    const incoming = canvasProfile(canvas)
    const requestedDepth = meta.workingBitDepth ?? incoming.bitDepth
    const profile = setCanvasWorkingProfile({
      bitDepth: requestedDepth === 8 ? 8 : 16,
      colorSpace: requestedDepth === 32 ? 'srgb' : (meta.workingColorSpace ?? incoming.colorSpace),
    })
    const workingBitDepth: 8 | 16 | 32 =
      requestedDepth === 32 && profile.bitDepth === 16 ? 32 : profile.bitDepth
    const doc: PsDocument = {
      id: uid(), name,
      width: canvas.width, height: canvas.height,
      resolutionPpi: clamp(Number(meta.resolutionPpi) || 72, 1, 12000),
      workingBitDepth,
      sourceBitDepth: meta.sourceBitDepth ?? workingBitDepth,
      workingColorSpace: profile.colorSpace,
      metadata: meta.metadata ? structuredClone(meta.metadata) : undefined,
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
    if (workingBitDepth === 32) {
      layer.hdrPixels = meta.hdrPixels && meta.hdrPixels.length === canvas.width * canvas.height * 4
        ? new Float32Array(meta.hdrPixels)
        : hdrPixelsFromCanvas(canvas)
      layer.hdrColorSpace = 'linear-srgb'
      layer.canvas = hdrFloat32ToPreviewCanvas(layer.hdrPixels, canvas.width, canvas.height, 'srgb')
    }
    doc.layers.push(layer)
    doc.activeLayerId = layer.id
    this.docs.push(doc)
    this._activeId = doc.id
    setCanvasWorkingProfile({ bitDepth: canvasDepthForDocument(doc.workingBitDepth), colorSpace: doc.workingColorSpace ?? 'srgb' })
    this.pushHistory('Open', doc)
    this.maybeCreateAutomaticHistorySnapshot('open', doc)
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
      const next = this.activeDoc
      setCanvasWorkingProfile({ bitDepth: canvasDepthForDocument(next?.workingBitDepth), colorSpace: next?.workingColorSpace ?? 'srgb' })
    }
    this.emit()
  }

  setActiveDocument(id: string) {
    const doc = this.docs.find(d => d.id === id)
    if (!doc) return
    this._activeId = id
    setCanvasWorkingProfile({ bitDepth: canvasDepthForDocument(doc.workingBitDepth), colorSpace: doc.workingColorSpace ?? 'srgb' })
    this.emit()
  }

  /** Photoshop-style Image > Duplicate. Make a fully editable document with
   * independent pixel buffers and fresh identities, rather than flattening the
   * source into a single 8-bit raster. The new document starts its own History. */
  duplicateDocument(): PsDocument | null {
    const src = this.activeDoc
    if (!src) return null
    this.syncPendingHdrCanvasEdits(src)

    const layerIds = new Map<string, string>()
    const layers = src.layers.map(layer => {
      const copy = this.cloneLayerForDuplicate(layer)
      // Keep the source name when duplicating the entire document.
      copy.name = layer.name
      layerIds.set(layer.id, copy.id)
      return copy
    })
    const remapLayerId = (id: string | null) => id ? layerIds.get(id) ?? null : null

    const compIds = new Map<string, string>()
    const layerComps = src.layerComps?.map(comp => {
      const copy = structuredClone(comp)
      copy.id = uid()
      compIds.set(comp.id, copy.id)
      copy.layers = Object.fromEntries(
        Object.entries(comp.layers)
          .filter(([id]) => layerIds.has(id))
          .map(([id, state]) => [layerIds.get(id)!, state]),
      )
      return copy
    })
    const frames = src.frames?.map(frame => ({
      ...structuredClone(frame),
      id: uid(),
      layers: Object.fromEntries(
        Object.entries(frame.layers)
          .filter(([id]) => layerIds.has(id))
          .map(([id, state]) => [layerIds.get(id)!, structuredClone(state)]),
      ),
    }))
    const doc: PsDocument = {
      id: uid(), name: `${src.name} copy`,
      width: src.width, height: src.height,
      resolutionPpi: src.resolutionPpi,
      workingBitDepth: src.workingBitDepth,
      sourceBitDepth: src.sourceBitDepth,
      workingColorSpace: src.workingColorSpace,
      psdImageResources: src.psdImageResources ? [...src.psdImageResources] : undefined,
      metadata: src.metadata ? structuredClone(src.metadata) : undefined,
      proof: src.proof ? structuredClone(src.proof) : undefined,
      layers,
      activeLayerId: remapLayerId(src.activeLayerId),
      selectedLayerIds: (src.selectedLayerIds ?? []).map(id => layerIds.get(id)).filter((id): id is string => !!id),
      selection: this.cloneHistorySelection(src.selection),
      channelView: src.channelView,
      savedChannels: this.cloneHistoryChannels(src.savedChannels).map(c => ({ ...c, id: uid() })),
      savedPaths: src.savedPaths?.map(path => ({ ...structuredClone(path), id: uid() })),
      guides: src.guides.map(guide => ({ ...guide, id: uid() })),
      colorSamplers: src.colorSamplers?.map(sampler => ({ ...sampler, id: uid() })),
      measurements: src.measurements?.map(measurement => ({ ...structuredClone(measurement), id: uid() })),
      frames,
      layerComps,
      activeLayerCompId: src.activeLayerCompId ? compIds.get(src.activeLayerCompId) ?? null : null,
      lastLayerCompState: null,
      view: structuredClone(src.view),
      history: { states: [], index: -1 },
      historyBrushSourceIndex: 0,
      historyBrushSnapshotId: null,
      historySnapshots: [],
      historySnapshotAutoPolicy: src.historySnapshotAutoPolicy ?? 'inherit',
      dirty: false,
      previewFilter: null, previewAdjustment: null,
      _epoch: 1, _stroke: null, _strokeLayerId: null,
      _strokeErase: false, _strokeOpacity: 1, _strokeBlendMode: 'normal',
      _strokeBbox: null, _strokeV: 0, _liveDrag: null,
    }
    this.docs.push(doc)
    this._activeId = doc.id
    setCanvasWorkingProfile({
      bitDepth: canvasDepthForDocument(doc.workingBitDepth),
      colorSpace: doc.workingColorSpace ?? 'srgb',
    })
    this.pushHistory('Duplicate Document', doc)
    this.maybeCreateAutomaticHistorySnapshot('new', doc)
    this.emit()
    return doc
  }

  // ================================================== history
  pushHistory(label: string, doc: PsDocument = this.activeDoc!) {
    if (!doc) return
    this.syncPendingHdrCanvasEdits(doc)
    const h = doc.history
    // Reuse immutable pixel snapshots of unchanged layers, not their live canvases.
    // This keeps the 50-step History buffer usable on multi-layer documents.
    const st = this.captureState(doc, label, h.states[h.index])
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
    if (!label.startsWith('Layer Comp:')) {
      doc.activeLayerCompId = null
      doc.lastLayerCompState = null
    }
    doc.dirty = true
  }

  /** History entries are immutable. Live layer canvases must never be retained
   * here: brush, fill, selection and mask tools edit their backing stores in-place.
   * Share pixels ONLY with another frozen history entry at the same version. */
  private cloneHistoryLayer(layer: Layer, previous?: Layer): Layer {
    const samePixels = !!previous && layer._v === previous._v &&
      layer.kind === previous.kind &&
      layer.canvas?.width === previous.canvas?.width &&
      layer.canvas?.height === previous.canvas?.height &&
      layer.source?.width === previous.source?.width &&
      layer.source?.height === previous.source?.height
    const sameMask = !!previous && layer._mv === previous._mv &&
      layer.mask?.width === previous.mask?.width &&
      layer.mask?.height === previous.mask?.height
    return {
      ...layer,
      canvas: samePixels ? previous!.canvas : (layer.canvas ? cloneCanvas(layer.canvas) : null),
      source: samePixels ? previous!.source : (layer.source ? cloneCanvas(layer.source) : null),
      hdrPixels: samePixels ? previous!.hdrPixels : (layer.hdrPixels ? new Float32Array(layer.hdrPixels) : layer.hdrPixels),
      _hdrPreviewBefore: null,
      mask: sameMask ? previous!.mask : (layer.mask ? cloneCanvas(layer.mask) : null),
      transform: layer.transform ? structuredClone(layer.transform) : null,
      smartFilters: layer.smartFilters.map(filter => structuredClone(filter)),
      vectorMask: layer.vectorMask ? structuredClone(layer.vectorMask) : layer.vectorMask,
      adjustment: layer.adjustment ? structuredClone(layer.adjustment) : null,
      text: layer.text ? structuredClone(layer.text) : null,
      shape: layer.shape ? structuredClone(layer.shape) : null,
      blendIf: layer.blendIf ? structuredClone(layer.blendIf) : null,
      fx: layer.fx ? structuredClone(layer.fx) : null,
      psdAdditionalInfo: layer.psdAdditionalInfo ? [...layer.psdAdditionalInfo] : layer.psdAdditionalInfo,
    }
  }

  private cloneHistorySelection(selection: SelectionState | null, previous?: SelectionState | null): SelectionState | null {
    if (!selection) return null
    const sameMask = !!previous && selection._v === previous._v &&
      selection.mask.width === previous.mask.width && selection.mask.height === previous.mask.height
    return {
      ...selection,
      bounds: { ...selection.bounds },
      mask: sameMask ? previous!.mask : cloneCanvas(selection.mask),
      // Path2D objects are derived from the selection alpha, never persistent state.
      _paths: null,
      _pathsV: -1,
    }
  }

  private cloneHistoryChannels(channels: SavedChannel[], previous?: SavedChannel[]): SavedChannel[] {
    return channels.map(channel => {
      const old = previous?.find(item => item.id === channel.id)
      const sameMask = !!old && old._v === channel._v &&
        old.mask.width === channel.mask.width && old.mask.height === channel.mask.height
      return {
        ...channel,
        mask: sameMask ? old!.mask : cloneCanvas(channel.mask),
      }
    })
  }

  private captureState(doc: PsDocument, label: string, previous?: HistoryState) : HistoryState {
    const previousLayers = new Map(previous?.layers.map(layer => [layer.id, layer]) ?? [])
    return {
      label, time: Date.now(),
      layers: doc.layers.map(layer => this.cloneHistoryLayer(layer, previousLayers.get(layer.id))),
      activeLayerId: doc.activeLayerId,
      selectedLayerIds: [...(doc.selectedLayerIds ?? (doc.activeLayerId ? [doc.activeLayerId] : []))],
      selection: this.cloneHistorySelection(doc.selection, previous?.selection),
      width: doc.width, height: doc.height,
      resolutionPpi: doc.resolutionPpi ?? 72,
      channelView: doc.channelView,
      savedChannels: this.cloneHistoryChannels(doc.savedChannels, previous?.savedChannels),
      savedPaths: (doc.savedPaths ?? []).map(path => structuredClone(path)),
      guides: (doc.guides ?? []).map(guide => ({ ...guide })),
      colorSamplers: doc.colorSamplers?.map(sampler => ({ ...sampler })),
      measurements: doc.measurements?.map(measurement => structuredClone(measurement)),
      frames: doc.frames?.map(frame => structuredClone(frame)),
    }
  }

  private restoreState(doc: PsDocument, st: HistoryState) {
    // Restore into separate live buffers. Undo/redo must not expose the frozen
    // snapshot's canvases to tools that draw into them in-place.
    doc.layers = st.layers.map(layer => this.cloneHistoryLayer(layer))
    doc.activeLayerId = st.activeLayerId
    doc.selectedLayerIds = (st.selectedLayerIds ?? (st.activeLayerId ? [st.activeLayerId] : []))
      .filter(id => doc.layers.some(layer => layer.id === id))
    doc.selection = this.cloneHistorySelection(st.selection)
    doc.width = st.width; doc.height = st.height
    doc.resolutionPpi = Number.isFinite(st.resolutionPpi) ? Math.max(1, Number(st.resolutionPpi)) : 72
    doc.channelView = st.channelView
    doc.savedChannels = this.cloneHistoryChannels(st.savedChannels)
    doc.savedPaths = Array.isArray(st.savedPaths) ? st.savedPaths.map(path => structuredClone(path)) : []
    // Older serialized snapshots lack these optional properties; preserve their
    // current values rather than wiping document metadata on Undo.
    if (st.guides) doc.guides = st.guides.map(guide => ({ ...guide }))
    if ('colorSamplers' in st) doc.colorSamplers = st.colorSamplers?.map(sampler => ({ ...sampler }))
    if ('measurements' in st) doc.measurements = st.measurements?.map(measurement => structuredClone(measurement))
    if ('frames' in st) doc.frames = st.frames?.map(frame => structuredClone(frame))
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

  getHistorySnapshotPreferences(): HistorySnapshotPreferences {
    return loadHistorySnapshotPreferences()
  }

  setHistorySnapshotPreferences(next: Partial<HistorySnapshotPreferences>): HistorySnapshotPreferences {
    const prefs = { ...loadHistorySnapshotPreferences(), ...next }
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(HISTORY_SNAPSHOT_PREFS_KEY, JSON.stringify(prefs)) } catch { /* noop */ }
    }
    this.emit()
    return prefs
  }

  private historySnapshotThumbnail(doc: PsDocument): string | undefined {
    try {
      const src = getFlatComposite(doc)
      const maxW = 96, maxH = 64
      const scale = Math.min(maxW / Math.max(1, src.width), maxH / Math.max(1, src.height), 1)
      const drawW = Math.max(1, Math.round(src.width * scale))
      const drawH = Math.max(1, Math.round(src.height * scale))
      const thumb = createCanvas(maxW, maxH, { bitDepth: 8, colorSpace: 'srgb' })
      const c = ctx2d(thumb)
      c.clearRect(0, 0, maxW, maxH)
      c.imageSmoothingQuality = 'high'
      c.drawImage(src, Math.round((maxW - drawW) / 2), Math.round((maxH - drawH) / 2), drawW, drawH)
      return thumb.toDataURL('image/webp', 0.78)
    } catch {
      return undefined
    }
  }

  createHistorySnapshot(
    name?: string,
    doc: PsDocument | null = this.activeDoc,
    opts: { markDirty?: boolean; note?: string } = {},
  ): HistorySnapshot | null {
    if (!doc) return null
    const snapshots = doc.historySnapshots ?? (doc.historySnapshots = [])
    const fallback = `Snapshot ${snapshots.length + 1}`
    const label = (name ?? fallback).trim().slice(0, 80) || fallback
    const note = typeof opts.note === 'string' ? opts.note.trim().slice(0, 2000) : ''
    const snap: HistorySnapshot = {
      id: uid(),
      name: label,
      note: note || undefined,
      time: Date.now(),
      state: this.captureState(doc, label),
      thumbnail: this.historySnapshotThumbnail(doc),
    }
    snapshots.push(snap)
    // Photoshop snapshots are durable within the document but should not grow
    // without bound in a browser session/project file.
    while (snapshots.length > 20) snapshots.shift()
    if (opts.markDirty !== false) doc.dirty = true
    this.emit()
    return snap
  }

  maybeCreateAutomaticHistorySnapshot(kind: 'new' | 'open', doc: PsDocument | null = this.activeDoc): HistorySnapshot | null {
    if (!doc || (doc.historySnapshots?.length ?? 0) > 0) return null
    const policy = doc.historySnapshotAutoPolicy ?? 'inherit'
    const prefs = loadHistorySnapshotPreferences()
    const globalEnabled = kind === 'new' ? prefs.autoNewDocument : prefs.autoOpenedDocument
    const enabled = policy === 'always' ? true : policy === 'never' ? false : globalEnabled
    if (!enabled) return null
    const wasDirty = doc.dirty
    const snap = this.createHistorySnapshot(kind === 'new' ? 'New Document' : doc.name, doc, { markDirty: false })
    doc.dirty = wasDirty
    return snap
  }

  setDocumentHistorySnapshotPolicy(policy: HistorySnapshotAutoPolicy) {
    const doc = this.activeDoc
    if (!doc || !['inherit', 'always', 'never'].includes(policy)) return
    if ((doc.historySnapshotAutoPolicy ?? 'inherit') === policy) return
    doc.historySnapshotAutoPolicy = policy
    doc.dirty = true
    if (policy === 'always' && !(doc.historySnapshots?.length ?? 0)) {
      this.createHistorySnapshot(doc.name || 'Current Document', doc, { markDirty: false })
    }
    this.emit()
  }

  renameHistorySnapshot(id: string, name: string) {
    const doc = this.activeDoc
    const snap = doc?.historySnapshots?.find(s => s.id === id)
    if (!doc || !snap) return
    const next = name.trim().slice(0, 80)
    if (!next || next === snap.name) return
    snap.name = next
    doc.dirty = true
    this.emit()
  }

  setHistorySnapshotNote(id: string, note: string) {
    const doc = this.activeDoc
    const snap = doc?.historySnapshots?.find(s => s.id === id)
    if (!doc || !snap) return
    const next = note.trim().slice(0, 2000)
    if ((snap.note ?? '') === next) return
    snap.note = next || undefined
    doc.dirty = true
    this.emit()
  }

  deleteHistorySnapshot(id: string) {
    const doc = this.activeDoc
    if (!doc?.historySnapshots) return
    const before = doc.historySnapshots.length
    doc.historySnapshots = doc.historySnapshots.filter(s => s.id !== id)
    if (doc.historySnapshots.length === before) return
    if (doc.historyBrushSnapshotId === id) doc.historyBrushSnapshotId = null
    doc.dirty = true
    this.emit()
  }

  applyHistorySnapshot(id: string) {
    const doc = this.activeDoc
    const snap = doc?.historySnapshots?.find(s => s.id === id)
    if (!doc || !snap) return
    this.restoreState(doc, snap.state)
    this.pushHistory(`Snapshot: ${snap.name}`, doc)
    this.emit()
  }

  setHistoryBrushSnapshot(id: string | null) {
    const doc = this.activeDoc
    if (!doc) return
    if (id && !doc.historySnapshots?.some(s => s.id === id)) return
    doc.historyBrushSnapshotId = id
    this.emit()
  }

  private captureLayerCompState(layer: Layer, options: LayerCompOptions): LayerCompLayerState {
    const state: LayerCompLayerState = {}
    if (options.visibility) state.visible = layer.visible
    if (options.position) {
      state.offsetX = layer.offsetX ?? 0
      state.offsetY = layer.offsetY ?? 0
      state.transform = layer.transform ? structuredClone(layer.transform) : null
    }
    if (options.appearance) {
      state.opacity = layer.opacity
      state.blendMode = layer.blendMode
      state.clipped = layer.clipped
      state.maskEnabled = layer.maskEnabled
      state.blendIf = layer.blendIf ? structuredClone(layer.blendIf) : null
      state.fx = layer.fx ? structuredClone(layer.fx) : null
    }
    return state
  }

  createLayerComp(
    name?: string,
    options: LayerCompOptions = { visibility: true, position: true, appearance: true },
    comment = '',
  ): LayerComp | null {
    const doc = this.activeDoc
    if (!doc) return null
    const comps = doc.layerComps ?? (doc.layerComps = [])
    const fallback = `Layer Comp ${comps.length + 1}`
    const now = Date.now()
    const comp: LayerComp = {
      id: uid(),
      name: (name ?? fallback).trim().slice(0, 80) || fallback,
      comment: comment.trim().slice(0, 240),
      createdAt: now,
      updatedAt: now,
      options: { ...options },
      layers: {},
    }
    for (const layer of doc.layers) comp.layers[layer.id] = this.captureLayerCompState(layer, comp.options)
    comps.push(comp)
    doc.activeLayerCompId = comp.id
    doc.dirty = true
    this.emit()
    return comp
  }

  updateLayerComp(id: string, options?: LayerCompOptions) {
    const doc = this.activeDoc
    const comp = doc?.layerComps?.find(c => c.id === id)
    if (!doc || !comp) return
    if (options) comp.options = { ...options }
    comp.layers = {}
    for (const layer of doc.layers) comp.layers[layer.id] = this.captureLayerCompState(layer, comp.options)
    comp.updatedAt = Date.now()
    doc.activeLayerCompId = comp.id
    doc.dirty = true
    this.emit()
  }

  renameLayerComp(id: string, name: string) {
    const doc = this.activeDoc
    const comp = doc?.layerComps?.find(c => c.id === id)
    if (!doc || !comp) return
    const next = name.trim().slice(0, 80)
    if (!next || next === comp.name) return
    comp.name = next
    comp.updatedAt = Date.now()
    doc.dirty = true
    this.emit()
  }

  duplicateLayerComp(id: string): LayerComp | null {
    const doc = this.activeDoc
    const comp = doc?.layerComps?.find(c => c.id === id)
    if (!doc || !comp) return null
    const copy: LayerComp = structuredClone(comp)
    copy.id = uid()
    copy.name = `${comp.name} copy`.slice(0, 80)
    copy.createdAt = copy.updatedAt = Date.now()
    ;(doc.layerComps ?? (doc.layerComps = [])).push(copy)
    doc.activeLayerCompId = copy.id
    doc.dirty = true
    this.emit()
    return copy
  }

  deleteLayerComp(id: string) {
    const doc = this.activeDoc
    if (!doc?.layerComps) return
    const before = doc.layerComps.length
    doc.layerComps = doc.layerComps.filter(c => c.id !== id)
    if (doc.layerComps.length === before) return
    if (doc.activeLayerCompId === id) doc.activeLayerCompId = null
    doc.dirty = true
    this.emit()
  }

  private applyLayerCompRecordedState(doc: PsDocument, comp: LayerComp) {
    for (const layer of doc.layers) {
      const state = comp.layers[layer.id]
      if (!state) continue
      if (comp.options.visibility && typeof state.visible === 'boolean') layer.visible = state.visible
      if (comp.options.position) {
        if (Number.isFinite(state.offsetX)) layer.offsetX = Number(state.offsetX)
        if (Number.isFinite(state.offsetY)) layer.offsetY = Number(state.offsetY)
        layer.transform = state.transform ? structuredClone(state.transform) : null
      }
      if (comp.options.appearance) {
        if (Number.isFinite(state.opacity)) layer.opacity = clamp(Number(state.opacity), 0, 100)
        if (state.blendMode) layer.blendMode = state.blendMode
        if (typeof state.clipped === 'boolean') layer.clipped = state.clipped
        if (typeof state.maskEnabled === 'boolean') layer.maskEnabled = state.maskEnabled
        layer.blendIf = state.blendIf ? structuredClone(state.blendIf) : null
        layer.fx = state.fx ? structuredClone(state.fx) : null
      }
      layer._v++
    }
    doc.activeLayerCompId = comp.id
    invalidateFlat(doc)
  }

  applyLayerComp(id: string) {
    const doc = this.activeDoc
    const comp = doc?.layerComps?.find(c => c.id === id)
    if (!doc || !comp) return
    // Preserve the non-comp state once, then let users cycle through comps
    // without losing Photoshop's "Last Document State" return point.
    if (!doc.lastLayerCompState) doc.lastLayerCompState = this.captureState(doc, 'Last Document State')
    this.applyLayerCompRecordedState(doc, comp)
    this.pushHistory(`Layer Comp: ${comp.name}`)
    this.emit()
  }

  /** Render one layer in isolation to a detached document-size canvas.
   * Uses the normal compositor so masks, vector masks, opacity, Blend-If and
   * Layer FX match the document renderer. The live document is restored exactly. */
  renderIsolatedLayer(id: string): HTMLCanvasElement | null {
    const doc = this.activeDoc
    const target = doc?.layers.find(layer => layer.id === id)
    if (!doc || !target || target.kind === 'adjustment') return null
    const saved = this.captureState(doc, 'Layer Export Restore')
    const savedActiveCompId = doc.activeLayerCompId ?? null
    const savedLastState = doc.lastLayerCompState ?? null
    const savedDirty = doc.dirty
    try {
      for (const layer of doc.layers) {
        layer.visible = layer.id === id
        if (layer.id === id) layer.clipped = false
        layer._v++
      }
      invalidateFlat(doc)
      return cloneCanvas(compositeDocument(doc))
    } finally {
      this.restoreState(doc, saved)
      doc.activeLayerCompId = savedActiveCompId
      doc.lastLayerCompState = savedLastState
      doc.dirty = savedDirty
    }
  }

  /** Render one Layer Comp to a detached canvas without changing the visible
   * document, History stack, dirty flag, active comp, or Last Document State. */
  renderLayerComp(id: string): HTMLCanvasElement | null {
    const doc = this.activeDoc
    const comp = doc?.layerComps?.find(c => c.id === id)
    if (!doc || !comp) return null
    const saved = this.captureState(doc, 'Layer Comp Export Restore')
    const savedActiveCompId = doc.activeLayerCompId ?? null
    const savedLastState = doc.lastLayerCompState ?? null
    const savedDirty = doc.dirty
    try {
      this.applyLayerCompRecordedState(doc, comp)
      return cloneCanvas(compositeDocument(doc))
    } finally {
      this.restoreState(doc, saved)
      doc.activeLayerCompId = savedActiveCompId
      doc.lastLayerCompState = savedLastState
      doc.dirty = savedDirty
    }
  }

  cycleLayerComp(dir: -1 | 1) {
    const doc = this.activeDoc
    const comps = doc?.layerComps ?? []
    if (!doc || !comps.length) return
    const current = comps.findIndex(c => c.id === doc.activeLayerCompId)
    const next = current < 0
      ? (dir > 0 ? 0 : comps.length - 1)
      : (current + dir + comps.length) % comps.length
    this.applyLayerComp(comps[next].id)
  }

  restoreLastLayerCompState() {
    const doc = this.activeDoc
    const state = doc?.lastLayerCompState
    if (!doc || !state) return
    this.restoreState(doc, state)
    doc.activeLayerCompId = null
    this.pushHistory('Restore Last Document State')
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
    this.mergeHdrCanvasEdits(l)
    if (l.canvas) l.canvas = cloneCanvas(l.canvas)
    if (l.hdrPixels && l.canvas) {
      l.hdrPixels = new Float32Array(l.hdrPixels)
      l._hdrPreviewBefore = canvasFloatSnapshot(l.canvas)
    }
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
  addRasterLayer(name?: string, opts?: { canvas?: HTMLCanvasElement; hdrPixels?: Float32Array }): Layer | null {
    const doc = this.activeDoc
    if (!doc) return null
    const layer = newLayer('raster', name || this.nextLayerName(), doc.width, doc.height)
    if (opts?.canvas) ctx2d(layer.canvas!).drawImage(opts.canvas, 0, 0)
    if (doc.workingBitDepth === 32 && layer.canvas) {
      layer.hdrPixels = opts?.hdrPixels && opts.hdrPixels.length === layer.canvas.width * layer.canvas.height * 4
        ? new Float32Array(opts.hdrPixels)
        : hdrPixelsFromCanvas(layer.canvas)
      layer.hdrColorSpace = 'linear-srgb'
      layer.canvas = hdrFloat32ToPreviewCanvas(layer.hdrPixels, layer.canvas.width, layer.canvas.height, 'srgb')
    }
    doc.layers.push(layer)
    doc.activeLayerId = layer.id
    this.pushHistory('New Layer')
    this.recordStep({ op: 'addLayer', args: { name: layer.name }, label: 'Add Layer' })
    this.emit()
    return layer
  }

  addLayerFromCanvas(canvas: HTMLCanvasElement, name?: string, opts?: { center?: boolean; hdrPixels?: Float32Array }): Layer | null {
    const doc = this.activeDoc
    if (!doc) return null
    const layer = newLayer('raster', name || this.nextLayerName(), doc.width, doc.height)
    if (opts?.center !== false && (canvas.width !== doc.width || canvas.height !== doc.height)) {
      // keep the pixels at native size, registered in the doc CENTER — nothing
      // is cropped and the layer can be moved/transformed losslessly afterwards
      const placed = createCanvas(canvas.width, canvas.height, {
        bitDepth: canvasDepthForDocument(doc.workingBitDepth),
        colorSpace: doc.workingColorSpace ?? 'srgb',
      })
      ctx2d(placed).drawImage(canvas, 0, 0)
      layer.canvas = placed
      layer.offsetX = Math.round((doc.width - canvas.width) / 2)
      layer.offsetY = Math.round((doc.height - canvas.height) / 2)
    } else {
      ctx2d(layer.canvas!).drawImage(canvas, 0, 0)
    }
    if (doc.workingBitDepth === 32 && layer.canvas) {
      layer.hdrPixels = hdrPixelsFromCanvas(layer.canvas)
      layer.hdrColorSpace = 'linear-srgb'
      layer.canvas = hdrFloat32ToPreviewCanvas(layer.hdrPixels, layer.canvas.width, layer.canvas.height, 'srgb')
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

  private cloneLayerForDuplicate(src: Layer): Layer {
    return {
      ...src,
      id: uid(),
      name: `${src.name} copy`,
      canvas: src.canvas ? cloneCanvas(src.canvas) : null,
      hdrPixels: src.hdrPixels ? new Float32Array(src.hdrPixels) : src.hdrPixels,
      _hdrPreviewBefore: src._hdrPreviewBefore ? new Float32Array(src._hdrPreviewBefore) : src._hdrPreviewBefore,
      source: src.source ? cloneCanvas(src.source) : null,
      transform: src.transform ? structuredClone(src.transform) : null,
      smartFilters: src.smartFilters.map(filter => ({ ...structuredClone(filter), id: uid() })),
      mask: src.mask ? cloneCanvas(src.mask) : null,
      vectorMask: src.vectorMask ? structuredClone(src.vectorMask) : src.vectorMask,
      adjustment: src.adjustment ? structuredClone(src.adjustment) : null,
      text: src.text ? structuredClone(src.text) : null,
      shape: src.shape ? structuredClone(src.shape) : null,
      blendIf: src.blendIf ? structuredClone(src.blendIf) : null,
      fx: src.fx ? structuredClone(src.fx) : null,
      psdAdditionalInfo: src.psdAdditionalInfo ? [...src.psdAdditionalInfo] : src.psdAdditionalInfo,
      _v: src._v + 1,
      _mv: src._mv + 1,
    }
  }

  /** Intersection of a selection with the raster backing store, in document
   * pixel coordinates. Avoid allocating the entire document for small copies. */
  private selectedPixelRegion(doc: PsDocument, layer: Layer): { x: number; y: number; w: number; h: number } | null {
    if (!doc.selection || doc.selection.bounds.w <= 0 || doc.selection.bounds.h <= 0) return null
    const b = doc.selection.bounds
    const ox = Math.round(layer.kind === 'raster' ? (layer.offsetX ?? 0) : 0)
    const oy = Math.round(layer.kind === 'raster' ? (layer.offsetY ?? 0) : 0)
    const layerW = layer.kind === 'raster' ? layer.canvas?.width ?? 0 : doc.width
    const layerH = layer.kind === 'raster' ? layer.canvas?.height ?? 0 : doc.height
    const x = Math.max(0, Math.floor(b.x), ox)
    const y = Math.max(0, Math.floor(b.y), oy)
    const x1 = Math.min(doc.width, Math.ceil(b.x + b.w), ox + layerW)
    const y1 = Math.min(doc.height, Math.ceil(b.y + b.h), oy + layerH)
    return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null
  }

  private selectionRegionAlpha(mask: HTMLCanvasElement, region: { x: number; y: number; w: number; h: number }): Uint8ClampedArray {
    const data = ctx2d(mask).getImageData(region.x, region.y, region.w, region.h).data
    const alpha = new Uint8ClampedArray(region.w * region.h)
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]
    return alpha
  }

  /** Photoshop's Layer via Copy / Cut lifts only the selected pixels from
   * the ACTIVE layer, retaining feathered mask edges and the source placement.
   * HDR layers are split directly in scene-linear Float32 precision. */
  layerViaSelection(mode: 'copy' | 'cut'): Layer | null {
    const doc = this.activeDoc
    const source = this.activeLayer
    if (!doc?.selection || !source || source.kind === 'adjustment') return null
    if (mode === 'cut' && (source.locked || source.kind !== 'raster')) {
      this.ui?.toast('Layer via Cut requires an unlocked raster layer', 'error')
      return null
    }
    const region = this.selectedPixelRegion(doc, source)
    if (!region) { this.ui?.toast('No selected pixels overlap the active layer', 'info'); return null }
    this.syncPendingHdrCanvasEdits(doc)
    const selected = this.selectionRegionAlpha(doc.selection.mask, region)
    if (!selected.some(a => a > 0)) return null
    const layerMaskAlpha = source.maskEnabled && source.mask &&
      source.mask.width === doc.width && source.mask.height === doc.height
      ? this.selectionRegionAlpha(source.mask, region) : undefined

    let output: HTMLCanvasElement
    let hdrPixels: Float32Array | null = null
    let remainder: Float32Array | null = null
    if (source.kind === 'raster' && source.canvas && source.hdrPixels) {
      const result = splitHdrSelectionPixels(source.hdrPixels, source.canvas.width, source.canvas.height,
        Math.round(source.offsetX ?? 0), Math.round(source.offsetY ?? 0),
        region, selected, mode === 'cut', layerMaskAlpha)
      if (!result.hasPixels) return null
      hdrPixels = result.pixels
      remainder = result.remaining
      output = hdrFloat32ToPreviewCanvas(hdrPixels, region.w, region.h, 'srgb')
    } else {
      const src = this.layerCanvasDocSpace(source.id)
      if (!src) return null
      output = createCanvas(region.w, region.h, canvasProfile(src))
      const ctx = ctx2d(output)
      ctx.drawImage(src, -region.x, -region.y)
      ctx.save()
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(doc.selection.mask, -region.x, -region.y)
      if (layerMaskAlpha) ctx.drawImage(source.mask!, -region.x, -region.y)
      ctx.restore()
      const data = getImageData(output).data
      if (!data.some((v, i) => i % 4 === 3 && v > 0)) return null
    }

    if (mode === 'cut') {
      const live = this.mutateLayerPixels(source.id)
      if (!live?.canvas) return null
      if (remainder) {
        live.hdrPixels = remainder
        live.canvas = hdrFloat32ToPreviewCanvas(remainder, live.canvas.width, live.canvas.height, 'srgb')
        live._hdrPreviewBefore = null
      } else {
        const ctx = ctx2d(live.canvas)
        ctx.save()
        ctx.globalCompositeOperation = 'destination-out'
        ctx.drawImage(doc.selection.mask, -Math.round(live.offsetX ?? 0), -Math.round(live.offsetY ?? 0))
        ctx.restore()
      }
    }

    const lifted = newLayer('raster', `${source.name} via ${mode === 'cut' ? 'Cut' : 'Copy'}`, doc.width, doc.height)
    lifted.canvas = output
    lifted.offsetX = region.x
    lifted.offsetY = region.y
    lifted.clipped = false
    if (hdrPixels) {
      lifted.hdrPixels = hdrPixels
      lifted.hdrColorSpace = 'linear-srgb'
      lifted._hdrPreviewBefore = null
    }
    const index = doc.layers.findIndex(layer => layer.id === source.id)
    doc.layers.splice(index + 1, 0, lifted)
    doc.activeLayerId = lifted.id
    doc.selectedLayerIds = [lifted.id]
    invalidateFlat(doc)
    this.pushHistory(mode === 'cut' ? 'Layer via Cut' : 'Layer via Copy', doc)
    this.emit()
    return lifted
  }

  /** The Photoshop Ctrl+J behavior: selected pixels become a new raster layer,
   * while no selection duplicates the whole editable layer. */
  duplicateLayerOrSelection(): Layer | null {
    return this.activeDoc?.selection ? this.layerViaSelection('copy') : this.duplicateLayer()
  }

  duplicateLayer(id?: string): Layer | null {
    const doc = this.activeDoc
    const src = id ? this.layerById(id) : this.activeLayer
    if (!doc || !src) return null
    const copy = this.cloneLayerForDuplicate(src)
    const idx = doc.layers.findIndex(l => l.id === src.id)
    doc.layers.splice(idx + 1, 0, copy)
    doc.activeLayerId = copy.id
    doc.selectedLayerIds = [copy.id]
    invalidateFlat(doc)
    this.pushHistory('Duplicate Layer')
    this.emit()
    return copy
  }

  /** Photoshop-style Layer > Duplicate Layer… destination workflow.
   * Preserves editable pixels, masks, vector masks, Smart Object source and
   * transforms, smart filters, Blend-If and Layer FX rather than flattening. */
  duplicateLayerToDocument(layerId: string, targetDocumentId: string, name?: string): Layer | null {
    const sourceDoc = this.activeDoc
    const source = sourceDoc?.layers.find(layer => layer.id === layerId)
    const target = this.docs.find(doc => doc.id === targetDocumentId)
    if (!sourceDoc || !source || !target) return null
    if (target.id === sourceDoc.id) return this.duplicateLayer(layerId)

    const copy = this.cloneLayerForDuplicate(source)
    const cleanName = name?.trim()
    if (cleanName) copy.name = cleanName.slice(0, 255)
    // A clipped layer cannot retain clipping semantics if its base was not
    // duplicated with it. Export the layer as independent editable artwork.
    copy.clipped = false
    target.layers.push(copy)
    target.activeLayerId = copy.id
    target.selectedLayerIds = [copy.id]
    invalidateFlat(target)
    this.pushHistory(`Duplicate “${source.name}” Into Document`, target)
    target.dirty = true
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
    const to = clamp(idx + Math.trunc(delta), 0, doc.layers.length - 1)
    if (idx === to) return
    const [l] = doc.layers.splice(idx, 1)
    doc.layers.splice(to, 0, l)
    // The flat-composite cache key omits layer IDs. Identical properties on
    // adjacent layers could otherwise reuse a composite with the OLD z-order.
    invalidateFlat(doc)
    this.pushHistory('Reorder Layer')
    this.emit()
  }

  reorderLayer(id: string, toIndex: number) {
    const doc = this.activeDoc
    if (!doc) return
    const idx = doc.layers.findIndex(l => l.id === id)
    if (idx < 0 || !Number.isFinite(toIndex)) return
    const to = clamp(Math.round(toIndex), 0, doc.layers.length - 1)
    if (to === idx) return
    const [l] = doc.layers.splice(idx, 1)
    doc.layers.splice(to, 0, l)
    invalidateFlat(doc)
    this.pushHistory('Reorder Layer')
    this.emit()
  }

  /** Lock or unlock all selected layers as one Photoshop-style History step.
   * Unlike selectedLayers(), this includes currently locked layers so the
   * Unlock command can actually unlock them. */
  canSetSelectedLayersLocked(locked: boolean): boolean {
    const doc = this.activeDoc
    if (!doc) return false
    const ids = doc.selectedLayerIds?.length ? doc.selectedLayerIds
      : (doc.activeLayerId ? [doc.activeLayerId] : [])
    const selected = new Set(ids)
    return doc.layers.some(layer => selected.has(layer.id) && layer.locked !== locked)
  }

  setSelectedLayersLocked(locked: boolean): void {
    const doc = this.activeDoc
    if (!doc || !this.canSetSelectedLayersLocked(locked)) return
    const ids = doc.selectedLayerIds?.length ? doc.selectedLayerIds
      : (doc.activeLayerId ? [doc.activeLayerId] : [])
    const selected = new Set(ids)
    for (const layer of doc.layers) if (selected.has(layer.id)) layer.locked = locked
    this.pushHistory(locked ? 'Lock Layers' : 'Unlock Layers', doc)
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

  rasterizeLayer(id?: string, opts: { history?: boolean; emit?: boolean } = {}) {
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
    if (opts.history !== false) this.pushHistory('Rasterize Layer')
    if (opts.emit !== false) this.emit()
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
    if (layer.locked) { this.ui?.toast('Layer is locked', 'error'); return }
    const l = this.mutateLayerPixels(id)
    if (!l?.canvas) return
    if (l.kind === 'raster' && l.hdrPixels) {
      l.hdrPixels = flipHdrPixels(l.hdrPixels, l.canvas.width, l.canvas.height, dir)
      l.canvas = hdrFloat32ToPreviewCanvas(l.hdrPixels, l.canvas.width, l.canvas.height, 'srgb')
      l._hdrPreviewBefore = null
    } else {
      const c = ctx2d(l.canvas)
      const tmp = cloneCanvas(l.canvas)
      c.save()
      c.clearRect(0, 0, l.canvas.width, l.canvas.height)
      c.translate(dir === 'horizontal' ? l.canvas.width : 0, dir === 'vertical' ? l.canvas.height : 0)
      c.scale(dir === 'horizontal' ? -1 : 1, dir === 'vertical' ? -1 : 1)
      c.drawImage(tmp, 0, 0)
      c.restore()
    }
    l._v++
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
      let quad: [Point2, Point2, Point2, Point2]
      if (t.quad?.length === 4) {
        quad = t.quad.map(p => ({ ...p })) as [Point2, Point2, Point2, Point2]
      } else {
        const hw = l.source.width * t.scale / 2, hh = l.source.height * t.scale / 2
        const cos = Math.cos(t.rotation), sin = Math.sin(t.rotation)
        const map = (x: number, y: number): Point2 => ({
          x: t.x + x * cos - y * sin,
          y: t.y + x * sin + y * cos,
        })
        quad = [map(-hw, -hh), map(hw, -hh), map(hw, hh), map(-hw, hh)]
      }
      const mesh = validateWarpMesh(t.warp)
      const pts = mesh ? warpMeshDestinationPoints(mesh, quad) : quad
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
      const x0 = Math.min(...xs), x1 = Math.max(...xs)
      const y0 = Math.min(...ys), y1 = Math.max(...ys)
      return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
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
      layer.transform = {
        ...layer.transform,
        x: layer.transform.x + dx,
        y: layer.transform.y + dy,
        quad: layer.transform.quad?.map(p => ({ x: p.x + dx, y: p.y + dy })) as typeof layer.transform.quad,
      }
    } else if (layer.kind === 'text' && layer.text) {
      layer.text = { ...layer.text, x: layer.text.x + dx, y: layer.text.y + dy }
    } else if (layer.kind === 'shape' && layer.shape) {
      if (layer.shape.shape === 'path' && layer.shape.pathAnchors?.length) {
        layer.shape = {
          ...layer.shape,
          x: layer.shape.x + dx,
          y: layer.shape.y + dy,
          pathAnchors: layer.shape.pathAnchors.map(a => ({ ...a, x: a.x + dx, y: a.y + dy })),
        }
      } else {
        layer.shape = { ...layer.shape, x: layer.shape.x + dx, y: layer.shape.y + dy }
      }
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
    this.syncPendingHdrCanvasEdits(doc)
    const src = target.canvas
    const hdr = target.hdrPixels
    const data = hdr ? null : getImageData(src).data
    let minX = src.width, minY = src.height, maxX = -1, maxY = -1
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const alpha = hdr ? hdr[(y * src.width + x) * 4 + 3] : data![(y * src.width + x) * 4 + 3]
        if (alpha <= 0) continue
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
    const newW = maxX - minX + 1, newH = maxY - minY + 1
    if (layer.hdrPixels) {
      layer.hdrPixels = cropHdrPixels(layer.hdrPixels, layer.canvas.width, layer.canvas.height, newW, newH, minX, minY)
      layer.canvas = hdrFloat32ToPreviewCanvas(layer.hdrPixels, newW, newH, 'srgb')
      layer._hdrPreviewBefore = null
    } else {
      const out = createCanvas(newW, newH, canvasProfile(layer.canvas))
      ctx2d(out).drawImage(layer.canvas, -minX, -minY)
      layer.canvas = out
    }
    layer.offsetX = (layer.offsetX ?? 0) + minX
    layer.offsetY = (layer.offsetY ?? 0) + minY
    layer._v++
    invalidateFlat(doc)
    this.pushHistory('Trim Layer to Content')
    this.emit()
    return true
  }

  private selectionAlphaForLayer(layer: Layer): Uint8ClampedArray | null {
    const doc = this.activeDoc
    if (!doc?.selection || !layer.canvas) return null
    const source = getMaskAlpha(doc.selection.mask)
    const out = new Uint8ClampedArray(layer.canvas.width * layer.canvas.height)
    const ox = Math.round(layer.offsetX ?? 0)
    const oy = Math.round(layer.offsetY ?? 0)
    for (let y = 0; y < layer.canvas.height; y++) {
      const dy = y + oy
      if (dy < 0 || dy >= doc.height) continue
      for (let x = 0; x < layer.canvas.width; x++) {
        const dx = x + ox
        if (dx < 0 || dx >= doc.width) continue
        out[y * layer.canvas.width + x] = source[dy * doc.width + dx]
      }
    }
    return out
  }

  private applyLayerMatting(
    id: string,
    operation: 'white' | 'black' | 'defringe',
    width = 1,
  ): boolean {
    const doc = this.activeDoc
    const target = this.layerById(id)
    if (!doc || !target) return false
    if (target.locked) { this.ui?.toast('Layer is locked', 'error'); return false }
    if (target.kind === 'adjustment') { this.ui?.toast('Adjustment layers have no pixels to matte', 'error'); return false }
    if (doc.workingBitDepth === 32) {
      this.ui?.toast('Layer Matting is disabled for 32-bit HDR until it can edit scene-linear Float32 pixels directly', 'info')
      return false
    }

    const wasRaster = target.kind === 'raster'
    const layer = this.mutateLayerPixels(target.id)
    if (!layer?.canvas) return false
    const selection = this.selectionAlphaForLayer(layer)
    const image = getProcessingPixelData(layer.canvas)
    if (operation === 'defringe') defringe(image, width, selection)
    else removeMatte(image, operation, selection)
    putProcessingPixelData(layer.canvas, image)
    layer._v++
    invalidateFlat(doc)
    const label =
      operation === 'white' ? 'Remove White Matte' :
      operation === 'black' ? 'Remove Black Matte' :
      `Defringe ${Math.max(1, Math.round(width))} px`
    this.pushHistory(label)
    this.emit()
    if (!wasRaster) this.ui?.toast('Layer rasterized for Matting', 'info')
    return true
  }

  removeLayerMatte(id: string, matte: 'white' | 'black'): boolean {
    return this.applyLayerMatting(id, matte)
  }

  defringeLayer(id: string, width = 1): boolean {
    return this.applyLayerMatting(id, 'defringe', Math.max(1, Math.min(64, Math.round(width) || 1)))
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
    this.syncPendingHdrCanvasEdits(doc)
    const s = Math.max(doc.width / r.w, doc.height / r.h)
    if (Math.abs(s - 1) < 0.001) { this.ui?.toast('Layer already covers the frame', 'info'); return null }
    // target rect: the scaled bounds, centered on the document
    const nw = r.w * s, nh = r.h * s
    const tx = (doc.width - nw) / 2, ty = (doc.height - nh) / 2
    if (layer.kind === 'raster' && layer.canvas) {
      const newW = Math.max(1, Math.round(layer.canvas.width * s))
      const newH = Math.max(1, Math.round(layer.canvas.height * s))
      if (layer.hdrPixels) {
        layer.hdrPixels = resampleHdrPixels(layer.hdrPixels, layer.canvas.width, layer.canvas.height, newW, newH)
        layer.canvas = hdrFloat32ToPreviewCanvas(layer.hdrPixels, newW, newH, 'srgb')
        layer._hdrPreviewBefore = null
      } else {
        layer.canvas = resampleCanvas(layer.canvas, newW, newH)
      }
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

  private copiedLayerStyle: LayerFX | null = null

  get canPasteLayerStyle(): boolean { return !!this.copiedLayerStyle }

  copyLayerStyle(id: string): boolean {
    const layer = this.layerById(id)
    if (!layer?.fx) {
      this.ui?.toast('Layer has no style to copy', 'info')
      return false
    }
    this.copiedLayerStyle = structuredClone(layer.fx)
    this.ui?.toast('Layer style copied', 'success')
    return true
  }

  pasteLayerStyle(id: string): boolean {
    const layer = this.layerById(id)
    if (!layer || !this.copiedLayerStyle) {
      if (!this.copiedLayerStyle) this.ui?.toast('Copy a layer style first', 'info')
      return false
    }
    if (layer.kind === 'adjustment') {
      this.ui?.toast('Adjustment layers cannot use layer styles', 'info')
      return false
    }
    this.setLayerFX(id, structuredClone(this.copiedLayerStyle), { label: 'Paste Layer Style' })
    return true
  }

  clearLayerStyle(id: string): boolean {
    const layer = this.layerById(id)
    if (!layer?.fx) return false
    this.setLayerFX(id, null, { label: 'Clear Layer Style' })
    return true
  }

  // ================================================== direct on-canvas transform

  /** shift a layer's registration by (dx, dy) — pure metadata, lossless for
   *  every layer kind. Shared by nudge + the clip-stack commit loop. */
  private shiftLayerBy(l: Layer, dx: number, dy: number) {
    if (l.kind === 'raster' && l.canvas) {
      l.offsetX = (l.offsetX ?? 0) + dx
      l.offsetY = (l.offsetY ?? 0) + dy
    } else if (l.kind === 'smart' && l.transform) {
      l.transform = {
        ...l.transform,
        x: l.transform.x + dx,
        y: l.transform.y + dy,
        quad: l.transform.quad?.map(p => ({ x: p.x + dx, y: p.y + dy })) as typeof l.transform.quad,
      }
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
  directTransformLayer(id: string, spec: { sx: number; sy: number; rotation: number; ax: number; ay: number }, opts?: { skipHistory?: boolean; silent?: boolean }) {
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

    if (baseKind === 'shape' && layer.shape?.shape === 'path' && layer.shape.pathAnchors?.length) {
      // Arbitrary path shapes remain vectors for every affine transform.
      const mapped = layer.shape.pathAnchors.map(a => {
        const [x, y] = map(a.x, a.y)
        const [ix, iy] = map(a.x + a.inX, a.y + a.inY)
        const [ox, oy] = map(a.x + a.outX, a.y + a.outY)
        return { ...a, x, y, inX: ix - x, inY: iy - y, outX: ox - x, outY: oy - y }
      })
      const pts = mapped.flatMap(a => [
        { x: a.x, y: a.y },
        { x: a.x + a.inX, y: a.y + a.inY },
        { x: a.x + a.outX, y: a.y + a.outY },
      ])
      const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x))
      const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y))
      layer.shape = {
        ...layer.shape,
        pathAnchors: mapped,
        x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY),
      }
      mutated = true
    } else if (baseKind === 'smart' && layer.source) {
      const s = Math.abs((sx + sy) / 2) || 0.01
      const t = layer.transform ?? { x: doc.width / 2, y: doc.height / 2, scale: 1, rotation: 0 }
      const [nx, ny] = map(t.x, t.y)
      if (t.quad || t.warp) {
        const currentQuad = this.layerTransformQuad(id)
        const nextQuad = currentQuad?.map(p => {
          const [x, y] = map(p.x, p.y)
          return { x, y }
        }) as typeof t.quad
        layer.transform = {
          ...t,
          x: nx,
          y: ny,
          quad: nextQuad,
        }
      } else {
        layer.transform = {
          ...t,
          x: nx, y: ny,
          scale: Math.max(0.01, t.scale * s),
          rotation: t.rotation + rot,
        }
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
        this.rasterizeLayer(id, { history: false, emit: false })
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

    // Layer masks are document-space assets. Transform them through the same
    // gesture map as the layer so masked edges stay attached to the content.
    if (layer.mask) {
      const maskOut = createCanvas(doc.width, doc.height)
      const mc = ctx2d(maskOut)
      mc.imageSmoothingEnabled = true
      mc.imageSmoothingQuality = 'high'
      mc.translate(ax, ay)
      mc.rotate(rot)
      mc.scale(sx, sy)
      mc.drawImage(layer.mask, -ax, -ay)
      layer.mask = maskOut
      layer._mv++
    }

    // Vector masks stay vector/editable; every compound component follows
    // the identical affine map.
    if (layer.vectorMask) {
      layer.vectorMask = mapVectorMask(layer.vectorMask, a => {
        const [x, y] = map(a.x, a.y)
        const [ix, iy] = map(a.x + a.inX, a.y + a.inY)
        const [ox, oy] = map(a.x + a.outX, a.y + a.outY)
        return { ...a, x, y, inX: ix - x, inY: iy - y, outX: ox - x, outY: oy - y }
      })
      layer._mv++
    }

    layer._v++
    invalidateFlat(doc)
    if (opts?.skipHistory) {
      if (!opts.silent) this.emit()
      else this.requestRender()
      return
    }
    this.pushHistory('Free Transform')
    if (!opts?.silent) this.emit()
    else this.requestRender()
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
        const ctx = ctx2d(canvas)
        ctx.drawImage(src, -x0, -y0)
        ctx.save()
        ctx.globalCompositeOperation = 'destination-in'
        ctx.drawImage(doc.selection.mask, -x0, -y0)
        if (l.maskEnabled && l.mask) ctx.drawImage(l.mask, -x0, -y0)
        ctx.restore()
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
    if (!doc || !l || l.locked) return false
    if (doc.selection && l.kind !== 'raster') {
      this.ui?.toast('Cutting selected pixels requires an unlocked raster layer', 'error')
      return false
    }
    if (!this.copyLayer(false)) return false
    if (l.kind === 'raster' && l.canvas) {
      const m = this.mutateLayerPixels(l.id)
      if (m?.canvas) {
        if (doc.selection) {
          const region = this.selectedPixelRegion(doc, m)
          if (!region) return false
          if (m.hdrPixels) {
            const selected = this.selectionRegionAlpha(doc.selection.mask, region)
            const split = splitHdrSelectionPixels(m.hdrPixels, m.canvas.width, m.canvas.height,
              Math.round(m.offsetX ?? 0), Math.round(m.offsetY ?? 0), region, selected, true)
            if (split.remaining) {
              m.hdrPixels = split.remaining
              m.canvas = hdrFloat32ToPreviewCanvas(split.remaining, m.canvas.width, m.canvas.height, 'srgb')
              m._hdrPreviewBefore = null
            }
          } else {
            const ctx = ctx2d(m.canvas)
            ctx.save()
            ctx.globalCompositeOperation = 'destination-out'
            ctx.drawImage(doc.selection.mask, -Math.round(m.offsetX ?? 0), -Math.round(m.offsetY ?? 0))
            ctx.restore()
          }
        } else if (m.hdrPixels) {
          m.hdrPixels = new Float32Array(m.hdrPixels.length)
          m.canvas = hdrFloat32ToPreviewCanvas(m.hdrPixels, m.canvas.width, m.canvas.height, 'srgb')
          m._hdrPreviewBefore = null
        } else {
          ctx2d(m.canvas).clearRect(0, 0, m.canvas.width, m.canvas.height)
        }
        invalidateFlat(doc)
        this.pushHistory('Cut')
        this.emit()
      }
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
    if (!doc || !layer || layer.locked || layer.kind === 'adjustment') return
    if (layer.kind !== 'smart') {
      this.applyFilterToLayer(id, type, params)
      return
    }
    layer.smartFilters.push({ id: uid(), type, params: structuredClone(params), enabled: true })
    layer._v++
    invalidateFlat(doc)
    this.pushHistory(`Smart Filter: ${filterLabel(type)}`, doc)
    this.rememberLastFilter(doc, type, params)
    this.recordStep({ op: 'applyFilter', args: { layerId: id, type, params: structuredClone(params) }, label: filterLabel(type) })
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

  // ================================================== paths
  addSavedPath(path: Omit<SavedPath, 'id'> & { id?: string }, label = 'New Path'): SavedPath | null {
    const doc = this.activeDoc
    if (!doc) return null
    const made: SavedPath = {
      id: path.id || uid(),
      name: path.name || `Path ${(doc.savedPaths?.length ?? 0) + 1}`,
      anchors: path.anchors.map((a: PathAnchor) => ({ ...a })),
      closed: !!path.closed,
      visible: path.visible !== false,
    }
    doc.savedPaths = [...(doc.savedPaths ?? []), made]
    this.pushHistory(label)
    this.emit()
    return made
  }

  updateSavedPath(id: string, patch: Partial<Omit<SavedPath, 'id' | 'anchors'>> & { anchors?: PathAnchor[] }, label = 'Edit Path') {
    const doc = this.activeDoc
    if (!doc) return
    const paths = doc.savedPaths ?? []
    const i = paths.findIndex(p => p.id === id)
    if (i < 0) return
    const next = paths.slice()
    next[i] = {
      ...next[i],
      ...patch,
      anchors: patch.anchors ? patch.anchors.map(a => ({ ...a })) : next[i].anchors.map(a => ({ ...a })),
    }
    doc.savedPaths = next
    this.pushHistory(label)
    this.emit()
  }

  duplicateSavedPath(id: string): SavedPath | null {
    const doc = this.activeDoc
    const src = doc?.savedPaths?.find(p => p.id === id)
    if (!doc || !src) return null
    return this.addSavedPath({
      name: `${src.name} copy`,
      anchors: src.anchors.map(a => ({ ...a })),
      closed: src.closed,
      visible: src.visible,
    }, 'Duplicate Path')
  }

  deleteSavedPath(id: string) {
    const doc = this.activeDoc
    if (!doc?.savedPaths?.some(p => p.id === id)) return
    doc.savedPaths = doc.savedPaths.filter(p => p.id !== id)
    this.pushHistory('Delete Path')
    this.emit()
  }

  savedPathToSelection(id: string, mode: SelectionCombine = 'new') {
    const doc = this.activeDoc
    const path = doc?.savedPaths?.find(p => p.id === id)
    if (!doc || !path || path.anchors.length < 2) return
    const mask = createCanvas(doc.width, doc.height)
    const c = ctx2d(mask)
    const a = path.anchors
    c.fillStyle = '#fff'
    c.beginPath()
    c.moveTo(a[0].x, a[0].y)
    for (let i = 1; i < a.length; i++) {
      const p0 = a[i - 1], p1 = a[i]
      c.bezierCurveTo(
        p0.x + p0.outX, p0.y + p0.outY,
        p1.x + p1.inX, p1.y + p1.inY,
        p1.x, p1.y,
      )
    }
    if (path.closed && a.length >= 2) {
      const p0 = a[a.length - 1], p1 = a[0]
      c.bezierCurveTo(
        p0.x + p0.outX, p0.y + p0.outY,
        p1.x + p1.inX, p1.y + p1.inY,
        p1.x, p1.y,
      )
      c.closePath()
    }
    c.fill()
    this.setSelectionMask(mask, mode, 'Path Selection')
  }

  savedPathToShapeLayer(
    pathId: string,
    style: { fill?: string | null; stroke?: string | null; strokeWidth?: number } = {},
  ): Layer | null {
    const doc = this.activeDoc
    const path = doc?.savedPaths?.find(p => p.id === pathId)
    if (!doc || !path || path.anchors.length < 2) return null
    const pts = path.anchors.flatMap(a => [
      { x: a.x, y: a.y },
      { x: a.x + a.inX, y: a.y + a.inY },
      { x: a.x + a.outX, y: a.y + a.outY },
    ])
    const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x))
    const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y))
    const layer = this.addShapeLayer({
      shape: 'path',
      x: minX, y: minY,
      w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY),
      radius: 0,
      fill: style.fill ?? (path.closed ? '#e8a33d' : null),
      fillOpacity: 100,
      stroke: style.stroke ?? '#ffffff',
      strokeWidth: style.strokeWidth ?? 2,
      strokeOpacity: 100,
      strokeAlign: 'center',
      lineCap: 'round',
      dash: 'solid',
      sides: 5,
      starInset: 45,
      pathAnchors: path.anchors.map(a => ({ ...a })),
      pathClosed: path.closed,
    })
    if (layer) layer.name = path.name
    return layer
  }

  addVectorMaskFromPath(
    layerId: string,
    pathId: string,
    operation: 'replace' | VectorMaskOp = 'replace',
  ) {
    const doc = this.activeDoc
    const layer = this.layerById(layerId)
    const path = doc?.savedPaths?.find(p => p.id === pathId)
    if (!doc || !layer || !path || layer.kind === 'adjustment') return

    const component = {
      anchors: path.anchors.map(a => ({ ...a })),
      closed: path.closed,
      op: (operation === 'replace' ? 'add' : operation) as VectorMaskOp,
    }

    if (operation === 'replace' || !layer.vectorMask) {
      layer.vectorMask = {
        anchors: component.anchors.map(a => ({ ...a })),
        closed: component.closed,
        enabled: true,
        paths: [component],
      }
    } else {
      const existing = layer.vectorMask.paths?.length
        ? layer.vectorMask.paths.map(p => ({ ...p, anchors: p.anchors.map(a => ({ ...a })) }))
        : [{
            anchors: layer.vectorMask.anchors.map(a => ({ ...a })),
            closed: layer.vectorMask.closed,
            op: 'add' as const,
          }]
      layer.vectorMask = {
        ...layer.vectorMask,
        enabled: true,
        paths: [...existing, component],
      }
    }
    layer._mv++
    invalidateFlat(doc)
    const labels: Record<'replace' | VectorMaskOp, string> = {
      replace: 'Replace Vector Mask',
      add: 'Add to Vector Mask',
      subtract: 'Subtract from Vector Mask',
      intersect: 'Intersect Vector Mask',
      exclude: 'Exclude Vector Mask',
    }
    this.pushHistory(labels[operation])
    this.emit()
  }

  toggleVectorMask(layerId: string, enabled?: boolean) {
    const doc = this.activeDoc
    const layer = this.layerById(layerId)
    if (!doc || !layer?.vectorMask) return
    layer.vectorMask = { ...layer.vectorMask, enabled: enabled ?? !layer.vectorMask.enabled }
    layer._mv++
    invalidateFlat(doc)
    this.pushHistory(layer.vectorMask.enabled ? 'Enable Vector Mask' : 'Disable Vector Mask')
    this.emit()
  }

  deleteVectorMask(layerId: string) {
    const doc = this.activeDoc
    const layer = this.layerById(layerId)
    if (!doc || !layer?.vectorMask) return
    layer.vectorMask = null
    layer._mv++
    invalidateFlat(doc)
    this.pushHistory('Delete Vector Mask')
    this.emit()
  }

  // ================================================== selection
  setSelectionMask(mask: HTMLCanvasElement | null, mode: SelectionCombine = 'new', label = 'Selection') {
    const doc = this.activeDoc
    if (!doc) return
    if (!mask) { doc.selection = null; this.emitOverlay(); return }
    const next = combineSelection(doc.selection, mask, mode)
    // Treat a fully erased/empty mask as a real deselection. This matters for
    // Selection Brush subtract strokes and also avoids carrying a 0×0-bounds
    // selection object through other selection commands.
    doc.selection = next && next.bounds.w > 0 && next.bounds.h > 0 ? next : null
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
    // Keep a detached copy: selection refinements and undo restoration must
    // never change the cached mask that Photoshop's Reselect will restore.
    const saved = this.cloneHistorySelection(doc.selection)
    if (saved) this.lastDeselectedSelections.set(doc, saved)
    doc.selection = null
    this.pushHistory('Deselect')
    this.emitOverlay()
  }

  canReselectSelection(): boolean {
    const doc = this.activeDoc
    if (!doc || doc.selection) return false
    const saved = this.lastDeselectedSelections.get(doc)
    // Never reapply masks with stale dimensions after crop / image resize.
    return !!saved && saved.mask.width === doc.width && saved.mask.height === doc.height
  }

  reselectSelection(): void {
    if (!this.canReselectSelection()) return
    const doc = this.activeDoc!
    const saved = this.lastDeselectedSelections.get(doc)!
    doc.selection = this.cloneHistorySelection(saved)
    this.lastDeselectedSelections.delete(doc)
    this.pushHistory('Reselect')
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
    // Invalid / zero-width selections must not silently round up to one pixel
    // or erase the user's selection and create a spurious History entry.
    if (op !== 'invert' && (!Number.isFinite(px) || px <= 0)) return
    const next = modifySelection(doc.selection, op, px)
    if (next === null && doc.selection.bounds.w <= 0) return
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
    if ((!antiAlias && kind === 'ellipse') || feather > 0) {
      processSelectionMaskRegion(mask, rect, feather, !antiAlias && kind === 'ellipse')
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
    let minX = points[0].x, minY = points[0].y, maxX = points[0].x, maxY = points[0].y
    for (let i = 1; i < points.length; i++) {
      const p = points[i]
      c.lineTo(p.x, p.y)
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
    }
    c.closePath()
    c.fill()
    if (!antiAlias || feather > 0) {
      processSelectionMaskRegion(
        mask,
        { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        feather,
        !antiAlias,
      )
    }
    this.setSelectionMask(mask, mode, 'Lasso Selection')
  }

  async magicWand(x: number, y: number, opts: {
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
  }): Promise<void> {
    const doc = this.activeDoc
    if (!doc) return
    const src = opts.sample === 'layer' && this.activeLayer ? this.layerCanvasDocSpace(this.activeLayer.id) : getFlatComposite(doc)
    if (!src) return
    const img = getImageData(src)
    const cx = clamp(Math.round(x), 0, doc.width - 1)
    const cy = clamp(Math.round(y), 0, doc.height - 1)

    let mask: Uint8ClampedArray
    try {
      const masked = await runPixelOpAsync(img, {
        kind: 'wand-mask',
        params: {
          x: cx,
          y: cy,
          tolerance: opts.tolerance,
          contiguous: opts.contiguous,
          antiAlias: opts.antiAlias,
          diagonal: opts.diagonal,
          sampleRadius: opts.sampleRadius,
          edgeAware: opts.edgeAware,
          adaptive: opts.adaptive,
          matchAlpha: opts.matchAlpha,
          exactPixels: opts.exactPixels,
        },
      })
      mask = new Uint8ClampedArray(doc.width * doc.height)
      for (let i = 0, j = 3; i < mask.length; i++, j += 4) mask[i] = masked.data[j]
    } catch (err) {
      this.ui?.toast(
        err instanceof Error ? `Magic Wand could not finish: ${err.message}` : 'Magic Wand could not finish',
        'error',
      )
      return
    }

    // A large worker job may finish after the user switched documents.
    if (this.activeDoc?.id !== doc.id || doc.width * doc.height !== mask.length) return

    if ((opts.smooth ?? 0) > 0 || (opts.feather ?? 0) > 0) {
      const temp = selectionFromMask(maskCanvasFromAlpha(mask, doc.width, doc.height))
      let refined = temp
      if ((opts.smooth ?? 0) > 0) refined = modifySelection(refined, 'smooth', opts.smooth ?? 0) ?? refined
      if ((opts.feather ?? 0) > 0) refined = modifySelection(refined, 'feather', opts.feather ?? 0) ?? refined
      this.setSelectionMask(refined.mask, opts.mode, 'Magic Wand')
      return
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
    this.saveAlphaChannel(getMaskAlpha(doc.selection.mask), name, 'Save Selection as Channel')
  }

  /** Save an arbitrary document-size 0..255 alpha mask without replacing the
   * active selection. Used by Photoshop-style Calculations and channel tools. */
  saveAlphaChannel(alpha: Uint8ClampedArray, name?: string, historyLabel = 'New Channel'): string | null {
    const doc = this.activeDoc
    if (!doc || alpha.length !== doc.width * doc.height) return null
    const chan = {
      id: uid(),
      name: name?.trim() || `Alpha ${doc.savedChannels.length + 1}`,
      mask: maskCanvasFromAlpha(alpha, doc.width, doc.height),
      _v: 1,
    }
    doc.savedChannels.push(chan)
    this.pushHistory(historyLabel)
    this.emit()
    return chan.id
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

  refineSelectionToMask(
    params: Record<string, any>,
    output: 'selection' | 'mask' | 'new-layer',
    sourceAlpha?: Uint8ClampedArray,
  ) {
    const doc = this.activeDoc
    if (!doc) return
    let alpha: Uint8ClampedArray
    if (sourceAlpha) {
      if (sourceAlpha.length !== doc.width * doc.height) {
        this.ui?.toast('Select and Mask preview no longer matches the document size', 'error')
        return
      }
      alpha = new Uint8ClampedArray(sourceAlpha)
    } else {
      if (!doc.selection) return
      const d = getImageData(doc.selection.mask)
      alpha = new Uint8ClampedArray(doc.width * doc.height)
      for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = d.data[j]
    }
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
    if (!doc?.selection || !layer) return
    if (layer.locked || layer.kind !== 'raster' || !layer.canvas) {
      this.ui?.toast('Clear Selected Pixels requires an unlocked raster layer', 'error')
      return
    }
    const region = this.selectedPixelRegion(doc, layer)
    if (!region) return
    this.syncPendingHdrCanvasEdits(doc)
    const selected = this.selectionRegionAlpha(doc.selection.mask, region)
    if (!selected.some(a => a > 0)) return
    // Do not destructively erase Float32 scene-linear pixels by round-tripping
    // them through the display canvas: feathered edges must retain highlights.
    let remaining: Float32Array | null = null
    if (layer.hdrPixels) {
      const split = splitHdrSelectionPixels(layer.hdrPixels, layer.canvas.width, layer.canvas.height,
        Math.round(layer.offsetX ?? 0), Math.round(layer.offsetY ?? 0), region, selected, true)
      if (!split.hasPixels) return
      remaining = split.remaining
    }
    const live = this.mutateLayerPixels(layer.id)
    if (!live?.canvas) return
    if (remaining) {
      live.hdrPixels = remaining
      live.canvas = hdrFloat32ToPreviewCanvas(remaining, live.canvas.width, live.canvas.height, 'srgb')
      live._hdrPreviewBefore = null
    } else {
      const c = ctx2d(live.canvas)
      c.save()
      c.globalCompositeOperation = 'destination-out'
      c.drawImage(doc.selection.mask, -Math.round(live.offsetX ?? 0), -Math.round(live.offsetY ?? 0))
      c.restore()
    }
    invalidateFlat(doc)
    this.pushHistory('Clear')
    this.emit()
  }

  applyAdjustmentToLayer(layerId: string, type: AdjustmentType, params: Record<string, any>) {
    const doc = this.activeDoc
    if (!doc) return
    const l = this.mutateLayerPixels(layerId)
    if (!l?.canvas) return
    const img = this.processingPixelsForLayer(l)
    if (!img) return
    imageOps.applyAdjustment(img, type, params)
    this.commitProcessingPixelsForLayer(l, img)
    invalidateFlat(doc)
    this.pushHistory(typeLabel(type))
    this.recordStep({ op: 'applyAdjustment', args: { layerId, type, params: { ...params } }, label: typeLabel(type) })
    this.emit()
  }

  applyFilterToLayer(layerId: string, type: FilterType, params: Record<string, any>) {
    const doc = this.activeDoc
    const layer = this.layerById(layerId)
    if (!doc || !layer || layer.locked || layer.kind === 'adjustment') return
    if (layer.kind === 'smart') {
      this.addSmartFilter(layerId, type, params)
      return
    }
    const l = this.mutateLayerPixels(layerId)
    if (!l?.canvas) return
    const img = this.processingPixelsForLayer(l)
    if (!img) return
    imageOps.applyFilter(img, type, params)
    this.commitProcessingPixelsForLayer(l, img)
    invalidateFlat(doc)
    this.pushHistory(filterLabel(type), doc)
    this.rememberLastFilter(doc, type, params)
    this.recordStep({ op: 'applyFilter', args: { layerId, type, params: structuredClone(params) }, label: filterLabel(type) })
    this.emit()
  }

  /** Content-Aware Fill using a document-space grayscale mask. The mask is
   * mapped into the active raster layer's own backing-canvas coordinates so
   * offset/off-canvas layers work correctly instead of assuming a doc-sized
   * raster backing store. */
  async contentAwareFillMask(
    docMask: Uint8ClampedArray | Uint8Array,
    onProgress?: (p: number) => void,
    label = 'Content-Aware Fill',
  ): Promise<void> {
    const doc = this.activeDoc
    const layer = this.activeLayer
    if (!doc || !layer) return
    if (docMask.length !== doc.width * doc.height) {
      this.ui?.toast('Content-Aware Fill mask does not match the document', 'error')
      return
    }

    const l = this.mutateLayerPixels(layer.id)
    if (!l?.canvas) return
    const img = getImageData(l.canvas)
    const ox = Math.round(l.offsetX ?? 0)
    const oy = Math.round(l.offsetY ?? 0)
    const localMask = new Uint8ClampedArray(img.width * img.height)
    let any = false

    for (let ly = 0; ly < img.height; ly++) {
      const gy = ly + oy
      if (gy < 0 || gy >= doc.height) continue
      for (let lx = 0; lx < img.width; lx++) {
        const gx = lx + ox
        if (gx < 0 || gx >= doc.width) continue
        const li = ly * img.width + lx
        const a = Math.min(docMask[gy * doc.width + gx] ?? 0, img.data[li * 4 + 3])
        localMask[li] = a
        if (a) any = true
      }
    }
    if (!any) {
      this.ui?.toast('Nothing opaque is available to fill in that region', 'info')
      return
    }

    await imageOps.inpaint(img, localMask, onProgress)
    putImageData(l.canvas, img)
    l._v++
    invalidateFlat(doc)
    this.pushHistory(label)
    // The existing action opcode means "fill the current selection". A direct
    // Bucket-generated mask is transient, so recording it as that opcode would
    // replay a different region later. Record only the selection workflow until
    // the action format has an explicit serializable region-mask operation.
    if (label === 'Content-Aware Fill') {
      this.recordStep({ op: 'contentAwareFill', args: {}, label })
    }
    this.emit()
  }

  async contentAwareFill(onProgress?: (p: number) => void): Promise<void> {
    const doc = this.activeDoc
    if (!doc) return
    if (!doc.selection) { this.ui?.toast('Make a selection first', 'error'); return }

    const d = getImageData(doc.selection.mask)
    const selAlpha = new Uint8ClampedArray(doc.width * doc.height)
    for (let i = 0, j = 3; i < selAlpha.length; i++, j += 4) selAlpha[i] = d.data[j]
    await this.contentAwareFillMask(selAlpha, onProgress)
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
    const hdrInput = hdrProcessingImage(l)
    const out = hdrInput
      ? await runPixelOpAsync(hdrInput, spec)
      : await runPixelOpFromCanvas(l.canvas, spec)
    this.commitProcessingPixelsForLayer(l, out)
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
    const spec: PixelOpSpec = { kind: 'adjustment', type, params }
    const hdrInput = hdrProcessingImage(l)
    const out = hdrInput
      ? await runPixelOpAsync(hdrInput, spec)
      : await runPixelOpFromCanvas(l.canvas, spec)
    this.commitProcessingPixelsForLayer(l, out)
    invalidateFlat(doc)
    this.pushHistory(typeLabel(type))
    this.recordStep({ op: 'applyAdjustment', args: { layerId, type, params: { ...params } }, label: typeLabel(type) })
    this.emit()
  }

  /** Async twin of applyFilterToLayer (dialog OK commits, menu filter commands) — pixel math in the worker. */
  async applyFilterToLayerAsync(layerId: string, type: FilterType, params: Record<string, any>): Promise<void> {
    const doc = this.activeDoc
    const layer = this.layerById(layerId)
    if (!doc || !layer || layer.locked || layer.kind === 'adjustment') return
    if (layer.kind === 'smart') {
      this.addSmartFilter(layerId, type, params)
      return
    }
    const l = this.mutateLayerPixels(layerId)
    if (!l?.canvas) return
    const layerVersion = l._v
    let out
    try {
      const spec: PixelOpSpec = { kind: 'filter', type, params }
      const hdrInput = hdrProcessingImage(l)
      out = hdrInput
        ? await runPixelOpAsync(hdrInput, spec)
        : await runPixelOpFromCanvas(l.canvas, spec)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.ui?.toast(`Filter not applied: ${message}`, 'error')
      console.error('[zphoto] filter worker failed safely', err)
      return
    }
    // The active tab or history state may have changed while the worker ran.
    // Never apply stale pixels to an undone/replaced/edited layer or push the
    // operation into another document's History.
    if (!this.docs.includes(doc) || !doc.layers.includes(l) || l._v !== layerVersion) return
    this.commitProcessingPixelsForLayer(l, out)
    invalidateFlat(doc)
    this.pushHistory(filterLabel(type), doc)
    this.rememberLastFilter(doc, type, params)
    this.recordStep({ op: 'applyFilter', args: { layerId, type, params: structuredClone(params) }, label: filterLabel(type) })
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

  // ================================================== color samplers / Info panel
  addColorSampler(x: number, y: number): string | null {
    const doc = this.activeDoc
    if (!doc) return null
    if (!doc.colorSamplers) doc.colorSamplers = []
    if (doc.colorSamplers.length >= 10) {
      this.ui?.toast('Color Sampler supports up to 10 points', 'info')
      return null
    }
    const id = uid()
    doc.colorSamplers.push({
      id,
      x: clamp(x, 0, Math.max(0, doc.width - 1)),
      y: clamp(y, 0, Math.max(0, doc.height - 1)),
    })
    doc.dirty = true
    this.emitOverlay()
    return id
  }

  moveColorSampler(id: string, x: number, y: number) {
    const doc = this.activeDoc
    const p = doc?.colorSamplers?.find(s => s.id === id)
    if (!doc || !p) return
    p.x = clamp(x, 0, Math.max(0, doc.width - 1))
    p.y = clamp(y, 0, Math.max(0, doc.height - 1))
    doc.dirty = true
    this.emitOverlay()
  }

  removeColorSampler(id: string) {
    const doc = this.activeDoc
    if (!doc?.colorSamplers?.some(s => s.id === id)) return
    doc.colorSamplers = doc.colorSamplers.filter(s => s.id !== id)
    doc.dirty = true
    this.emitOverlay()
  }

  clearColorSamplers() {
    const doc = this.activeDoc
    if (!doc?.colorSamplers?.length) return
    doc.colorSamplers = []
    doc.dirty = true
    this.emitOverlay()
  }

  addMeasurement(entry: {
    name?: string
    segments: { a: { x: number; y: number }; b: { x: number; y: number } }[]
    unit: 'px' | 'mm' | 'cm' | 'in'
    pixelsPerUnit: number
  }): string | null {
    const doc = this.activeDoc
    if (!doc || !entry.segments.length) return null
    if (!doc.measurements) doc.measurements = []
    const id = uid()
    const segments = entry.segments.map(s => ({ a: { ...s.a }, b: { ...s.b } }))
    const totalLengthPx = segments.reduce((sum, s) => sum + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), 0)
    doc.measurements.push({
      id,
      name: entry.name?.trim() || `Measurement ${doc.measurements.length + 1}`,
      segments,
      unit: entry.unit,
      pixelsPerUnit: Math.max(.001, entry.pixelsPerUnit || 1),
      totalLengthPx,
      createdAt: Date.now(),
    })
    doc.dirty = true
    this.emit()
    return id
  }

  renameMeasurement(id: string, name: string) {
    const doc = this.activeDoc
    const item = doc?.measurements?.find(m => m.id === id)
    if (!doc || !item || !name.trim()) return
    item.name = name.trim()
    doc.dirty = true
    this.emit()
  }

  removeMeasurement(id: string) {
    const doc = this.activeDoc
    if (!doc?.measurements?.some(m => m.id === id)) return
    doc.measurements = doc.measurements.filter(m => m.id !== id)
    doc.dirty = true
    this.emit()
  }

  clearMeasurements() {
    const doc = this.activeDoc
    if (!doc?.measurements?.length) return
    doc.measurements = []
    doc.dirty = true
    this.emit()
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
    const px = clamp(Math.round(x), 0, doc.width - 1)
    const py = clamp(Math.round(y), 0, doc.height - 1)
    const r = clamp(Math.floor(radius), 0, 32)
    const docX0 = clamp(px - r, 0, doc.width - 1)
    const docY0 = clamp(py - r, 0, doc.height - 1)
    const docX1 = clamp(px + r, 0, doc.width - 1)
    const docY1 = clamp(py + r, 0, doc.height - 1)

    let src: HTMLCanvasElement | null
    let srcX0 = docX0, srcY0 = docY0
    let srcX1 = docX1, srcY1 = docY1

    if (scope === 'layer' && this.activeLayer) {
      const layer = this.activeLayer
      src = this.layerCanvas(layer.id)
      if (!src) return null
      // Raster layers can retain pixels outside the document after Move. Sample
      // their backing canvas directly and translate the requested doc rectangle
      // instead of allocating a full document-sized registration copy per dab.
      if (layer.kind === 'raster') {
        const ox = layer.offsetX ?? 0
        const oy = layer.offsetY ?? 0
        srcX0 = Math.max(0, docX0 - ox)
        srcY0 = Math.max(0, docY0 - oy)
        srcX1 = Math.min(src.width - 1, docX1 - ox)
        srcY1 = Math.min(src.height - 1, docY1 - oy)
        if (srcX1 < srcX0 || srcY1 < srcY0) return null
      }
    } else {
      src = getFlatComposite(doc)
      if (!src) return null
    }

    const data = ctx2d(src).getImageData(
      Math.floor(srcX0), Math.floor(srcY0),
      Math.floor(srcX1 - srcX0 + 1), Math.floor(srcY1 - srcY0 + 1),
    ).data
    let rr = 0, gg = 0, bb = 0, weight = 0
    // Alpha-weighted average avoids transparent RGB garbage contaminating
    // large eyedropper / Mixer Brush samples around cut-out subjects.
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255
      if (a <= 0) continue
      rr += data[i] * a; gg += data[i + 1] * a; bb += data[i + 2] * a
      weight += a
    }
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
  /** Scale all document-space editable geometry and pixel assets together.
   *  Used by Image Size and Crop target-size output so paths, guides, masks,
   *  vector masks, samplers and layer registrations stay aligned. */
  private rescaleDocumentData(doc: PsDocument, w: number, h: number) {
    this.syncPendingHdrCanvasEdits(doc)
    w = Math.max(1, Math.round(w))
    h = Math.max(1, Math.round(h))
    const sx = w / Math.max(1, doc.width)
    const sy = h / Math.max(1, doc.height)
    const smin = Math.min(sx, sy)

    for (const l of doc.layers) {
      if (l.canvas) {
        const newW = Math.max(1, Math.round(l.canvas.width * sx))
        const newH = Math.max(1, Math.round(l.canvas.height * sy))
        if (l.kind === 'raster' && l.hdrPixels) {
          l.hdrPixels = resampleHdrPixels(l.hdrPixels, l.canvas.width, l.canvas.height, newW, newH)
          l.canvas = hdrFloat32ToPreviewCanvas(l.hdrPixels, newW, newH, 'srgb')
          l._hdrPreviewBefore = null
        } else {
          l.canvas = resampleCanvas(l.canvas, newW, newH)
        }
      }
      if (l.kind === 'raster') {
        l.offsetX = (l.offsetX ?? 0) * sx
        l.offsetY = (l.offsetY ?? 0) * sy
      }
      if (l.mask) l.mask = resampleCanvas(l.mask, w, h)
      if (l.source) l.source = resampleCanvas(l.source, Math.max(1, Math.round(l.source.width * sx)), Math.max(1, Math.round(l.source.height * sy)))
      if (l.transform) {
        l.transform = {
          ...l.transform,
          x: l.transform.x * sx,
          y: l.transform.y * sy,
          // The Smart Object SOURCE was resized above. Its display scale is
          // relative to that source; multiplying it again would enlarge twice.
          scale: l.transform.scale,
          quad: l.transform.quad?.map(p => ({ x: p.x * sx, y: p.y * sy })) as typeof l.transform.quad,
        }
      }
      if (l.text) {
        l.text.x *= sx
        l.text.y *= sy
        l.text.fontSize *= sy
        if (l.text.boxWidth) l.text.boxWidth *= sx
        if (l.text.boxHeight) l.text.boxHeight *= sy
      }
      if (l.shape) {
        l.shape.x *= sx
        l.shape.y *= sy
        l.shape.w *= sx
        l.shape.h *= sy
        if (l.shape.shape === 'path' && l.shape.pathAnchors?.length) {
          l.shape.pathAnchors = l.shape.pathAnchors.map(a => ({
            ...a, x: a.x * sx, y: a.y * sy,
            inX: a.inX * sx, inY: a.inY * sy,
            outX: a.outX * sx, outY: a.outY * sy,
          }))
        }
        l.shape.radius *= smin
        l.shape.strokeWidth *= smin
        if (l.shape.dashLength) l.shape.dashLength *= smin
        if (l.shape.gapLength) l.shape.gapLength *= smin
      }
      if (l.vectorMask) {
        l.vectorMask = mapVectorMask(l.vectorMask, a => ({
          ...a,
          x: a.x * sx,
          y: a.y * sy,
          inX: a.inX * sx,
          inY: a.inY * sy,
          outX: a.outX * sx,
          outY: a.outY * sy,
        }))
      }
      l._v++; l._mv++
    }

    if (doc.selection) {
      const mask = resampleCanvas(doc.selection.mask, w, h)
      doc.selection = { ...doc.selection, mask, _v: doc.selection._v + 1, _paths: null, _pathsV: 0 }
    }
    for (const ch of doc.savedChannels) {
      ch.mask = resampleCanvas(ch.mask, w, h)
      ch._v++
    }
    if (doc.colorSamplers?.length) {
      doc.colorSamplers = doc.colorSamplers.map(s => ({ ...s, x: s.x * sx, y: s.y * sy }))
    }
    if (doc.savedPaths?.length) {
      doc.savedPaths = doc.savedPaths.map(path => ({
        ...path,
        anchors: path.anchors.map(a => ({
          ...a,
          x: a.x * sx,
          y: a.y * sy,
          inX: a.inX * sx,
          inY: a.inY * sy,
          outX: a.outX * sx,
          outY: a.outY * sy,
        })),
      }))
    }
    if (doc.guides?.length) {
      doc.guides = doc.guides.map(g => ({ ...g, pos: g.pos * (g.orientation === 'v' ? sx : sy) }))
    }
    if (doc.measurements?.length) {
      doc.measurements = doc.measurements.map(m => {
        const segments = m.segments.map(seg => ({
          a: { x: seg.a.x * sx, y: seg.a.y * sy },
          b: { x: seg.b.x * sx, y: seg.b.y * sy },
        }))
        return { ...m, segments, totalLengthPx: segments.reduce(
          (sum, seg) => sum + Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y), 0) }
      })
    }
    if (doc.frames?.length) {
      doc.frames = doc.frames.map(frame => ({
        ...frame, layers: Object.fromEntries(Object.entries(frame.layers).map(([id, entry]) => [
          id, { ...entry, x: entry.x === undefined ? undefined : entry.x * sx,
            y: entry.y === undefined ? undefined : entry.y * sy },
        ])),
      }))
    }

    doc.width = w
    doc.height = h
    doc._epoch++
    invalidateFlat(doc)
  }

  /** Perspective Crop — map an arbitrary source quadrilateral into a
   * rectangular document while preserving layer separation. Pixel/vector/smart
   * layers are projectively resampled; adjustment layers remain live and have
   * their masks warped. Arbitrary projective geometry cannot remain editable as
   * text/shape/smart transforms, so those layer types rasterize individually
   * rather than flattening the whole document. */
  perspectiveCropTo(quad: Point2[], opts: { targetW?: number; targetH?: number; resolutionPpi?: number } = {}) {
    const doc = this.activeDoc
    if (!doc || quad.length !== 4) return
    if (doc.layers.some(l => l.kind === 'raster' && l.hdrPixels)) {
      this.ui?.toast('Perspective Crop is disabled for 32-bit HDR until scene-linear projective sampling is supported', 'info')
      return
    }
    const auto = quadOutputSize(quad)
    const outW = Math.max(1, Math.round(opts.targetW || auto.w))
    const outH = Math.max(1, Math.round(opts.targetH || auto.h))
    const dstQuad: Point2[] = [
      { x: 0, y: 0 }, { x: outW - 1, y: 0 },
      { x: outW - 1, y: outH - 1 }, { x: 0, y: outH - 1 },
    ]
    const forward = homography(quad, dstQuad)
    if (!forward) {
      this.ui?.toast('Perspective crop corners are degenerate', 'error')
      return
    }

    const mapAnchor = (a: any) => {
      const p = projectPoint(forward, { x: a.x, y: a.y })
      // Path handles are stored as offsets from the anchor, not absolute doc
      // coordinates. Transform their absolute endpoints, then convert back.
      const pin = projectPoint(forward, { x: a.x + a.inX, y: a.y + a.inY })
      const pout = projectPoint(forward, { x: a.x + a.outX, y: a.y + a.outY })
      return {
        ...a,
        x: p.x, y: p.y,
        inX: pin.x - p.x, inY: pin.y - p.y,
        outX: pout.x - p.x, outY: pout.y - p.y,
      }
    }

    for (const l of doc.layers) {
      if (l.kind === 'adjustment') {
        if (l.mask) l.mask = warpCanvasPerspective(l.mask, quad, outW, outH, true)
        if (l.vectorMask) l.vectorMask = mapVectorMask(l.vectorMask, mapAnchor)
        l._v++; l._mv++
        continue
      }

      let src: HTMLCanvasElement
      let baked = false
      if (l.kind === 'raster' && l.canvas) {
        src = createCanvas(doc.width, doc.height)
        ctx2d(src).drawImage(l.canvas, l.offsetX ?? 0, l.offsetY ?? 0)
      } else {
        const prepared = prepareLayer(doc, l)
        src = prepared ? cloneCanvas(prepared) : createCanvas(doc.width, doc.height)
        baked = true
      }

      l.canvas = warpCanvasPerspective(src, quad, outW, outH)
      l.kind = 'raster'
      l.offsetX = 0; l.offsetY = 0
      l.source = null; l.transform = null; l.smartFilters = []
      l.text = null; l.shape = null
      if (baked) {
        // prepareLayer already includes mask/fx/filter visual output.
        l.mask = null
        l.maskEnabled = false
        l.vectorMask = null
        l.fx = null
        l.blendIf = null
      } else {
        if (l.mask) l.mask = warpCanvasPerspective(l.mask, quad, outW, outH, true)
        if (l.vectorMask) l.vectorMask = mapVectorMask(l.vectorMask, mapAnchor)
      }
      l._v++; l._mv++
    }

    if (doc.selection) {
      const mask = warpCanvasPerspective(doc.selection.mask, quad, outW, outH, true)
      doc.selection = selectionFromMask(mask)
    }
    for (const ch of doc.savedChannels) {
      ch.mask = warpCanvasPerspective(ch.mask, quad, outW, outH, true)
      ch._v++
    }
    if (doc.savedPaths?.length) {
      doc.savedPaths = doc.savedPaths.map(path => ({
        ...path,
        anchors: path.anchors.map(mapAnchor),
      }))
    }
    if (doc.colorSamplers?.length) {
      doc.colorSamplers = doc.colorSamplers
        .map(s => ({ ...s, ...projectPoint(forward, s) }))
        .filter(s => s.x >= 0 && s.y >= 0 && s.x < outW && s.y < outH)
    }
    // Projective transforms do not in general preserve horizontal/vertical
    // guides, so retaining their old scalar positions would be misleading.
    doc.guides = []

    doc.width = outW
    doc.height = outH
    if (Number.isFinite(opts.resolutionPpi) && Number(opts.resolutionPpi) > 0) {
      doc.resolutionPpi = clamp(Number(opts.resolutionPpi), 1, 12000)
    }
    doc._epoch++
    invalidateFlat(doc)
    this.pushHistory('Perspective Crop')
    this.emit()
  }

  cropTo(rect: Rect, opts: { deletePixels?: boolean; targetW?: number; targetH?: number; resolutionPpi?: number; historyLabel?: string } = {}) {
    const doc = this.activeDoc
    if (!doc) return
    this.syncPendingHdrCanvasEdits(doc)
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
          if (l.hdrPixels) {
            const pixels = cropHdrPixels(l.hdrPixels, l.canvas.width, l.canvas.height,
              w, h, x - (l.offsetX ?? 0), y - (l.offsetY ?? 0))
            l.hdrPixels = pixels
            l.canvas = hdrFloat32ToPreviewCanvas(pixels, w, h, 'srgb')
            l._hdrPreviewBefore = null
          } else {
            const next = createCanvas(w, h, canvasProfile(l.canvas))
            ctx2d(next).drawImage(l.canvas, (l.offsetX ?? 0) - x, (l.offsetY ?? 0) - y)
            l.canvas = next
          }
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
      if (l.transform) {
        l.transform = {
          ...l.transform,
          x: l.transform.x - x,
          y: l.transform.y - y,
          quad: l.transform.quad?.map(p => ({ x: p.x - x, y: p.y - y })) as typeof l.transform.quad,
        }
      }
      if (l.text) { l.text.x -= x; l.text.y -= y }
      if (l.shape) {
        l.shape.x -= x; l.shape.y -= y
        if (l.shape.shape === 'path' && l.shape.pathAnchors?.length) {
          l.shape.pathAnchors = l.shape.pathAnchors.map(a => ({ ...a, x: a.x - x, y: a.y - y }))
        }
      }
      if (l.vectorMask) {
        l.vectorMask = mapVectorMask(l.vectorMask, a => ({ ...a, x: a.x - x, y: a.y - y }))
      }
      l._v++; l._mv++
    }
    if (doc.selection) {
      const next = createCanvas(w, h)
      ctx2d(next).drawImage(doc.selection.mask, -x, -y)
      doc.selection = selectionFromMask(next, doc.selection._v + 1)
    }
    for (const ch of doc.savedChannels) {
      const next = createCanvas(w, h)
      ctx2d(next).drawImage(ch.mask, -x, -y)
      ch.mask = next; ch._v++
    }
    if (doc.colorSamplers?.length) {
      doc.colorSamplers = doc.colorSamplers
        .map(s => ({ ...s, x: s.x - x, y: s.y - y }))
        .filter(s => s.x >= 0 && s.y >= 0 && s.x < w && s.y < h)
    }
    if (doc.savedPaths?.length) {
      doc.savedPaths = doc.savedPaths.map(path => ({
        ...path,
        anchors: path.anchors.map(a => ({ ...a, x: a.x - x, y: a.y - y })),
      }))
    }
    if (doc.guides?.length) {
      doc.guides = doc.guides
        .map(g => ({ ...g, pos: g.pos - (g.orientation === 'v' ? x : y) }))
        .filter(g => g.pos >= 0 && g.pos <= (g.orientation === 'v' ? w : h))
    }
    if (doc.measurements?.length) {
      doc.measurements = doc.measurements.map(measurement => ({
        ...measurement,
        segments: measurement.segments.map(seg => ({
          a: { x: seg.a.x - x, y: seg.a.y - y },
          b: { x: seg.b.x - x, y: seg.b.y - y },
        })),
      }))
    }
    if (doc.frames?.length) {
      doc.frames = doc.frames.map(frame => ({
        ...frame, layers: Object.fromEntries(Object.entries(frame.layers).map(([id, entry]) => [
          id, { ...entry, x: entry.x === undefined ? undefined : entry.x - x,
            y: entry.y === undefined ? undefined : entry.y - y },
        ])),
      }))
    }

    doc.width = w
    doc.height = h
    doc._epoch++
    invalidateFlat(doc)

    const targetW = opts.targetW && opts.targetW > 0 ? Math.round(opts.targetW) : w
    const targetH = opts.targetH && opts.targetH > 0 ? Math.round(opts.targetH) : h
    if (targetW !== w || targetH !== h) this.rescaleDocumentData(doc, targetW, targetH)

    const resized = targetW !== w || targetH !== h
    if (Number.isFinite(opts.resolutionPpi) && Number(opts.resolutionPpi) > 0) {
      doc.resolutionPpi = clamp(Number(opts.resolutionPpi), 1, 12000)
    }
    const cropLabel = resized
      ? (deletePixels ? 'Crop & Resize' : 'Crop & Resize (Preserve Pixels)')
      : (deletePixels ? 'Crop' : 'Crop (Preserve Pixels)')
    this.pushHistory(opts.historyLabel ?? cropLabel)
    this.recordStep({
      op: 'crop',
      args: { x, y, w, h, deletePixels, targetW: resized ? targetW : undefined, targetH: resized ? targetH : undefined, resolutionPpi: doc.resolutionPpi ?? 72 },
      label: opts.historyLabel ?? cropLabel,
    })
    this.emit()
  }

  /** Image > Reveal All: expand the frame to include visible off-canvas
   * content without destructively trimming any raster backing stores. */
  revealAll(): boolean {
    const doc = this.activeDoc
    if (!doc) return false
    this.syncPendingHdrCanvasEdits(doc)
    let left = 0, top = 0, right = doc.width, bottom = doc.height
    let found = false
    for (const layer of doc.layers) {
      if (!layer.visible || layer.kind === 'adjustment') continue
      let bounds: Rect | null = null
      if (layer.kind === 'raster' && layer.canvas) {
        const cw = layer.canvas.width, ch = layer.canvas.height
        const hdr = layer.hdrPixels
        const pixels = hdr ? null : getImageData(layer.canvas).data
        let minX = cw, minY = ch, maxX = -1, maxY = -1
        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) {
            const a = hdr ? hdr[(y * cw + x) * 4 + 3] : pixels![(y * cw + x) * 4 + 3]
            if (a <= 0) continue
            minX = Math.min(minX, x); minY = Math.min(minY, y)
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
          }
        }
        if (maxX >= minX && maxY >= minY) {
          bounds = { x: (layer.offsetX ?? 0) + minX, y: (layer.offsetY ?? 0) + minY,
            w: maxX - minX + 1, h: maxY - minY + 1 }
        }
      } else {
        bounds = this.layerContentRect(layer.id)
      }
      if (!bounds) continue
      found = true
      left = Math.min(left, Math.floor(bounds.x))
      top = Math.min(top, Math.floor(bounds.y))
      right = Math.max(right, Math.ceil(bounds.x + bounds.w))
      bottom = Math.max(bottom, Math.ceil(bounds.y + bounds.h))
    }
    if (!found || (left === 0 && top === 0 && right === doc.width && bottom === doc.height)) return false
    const width = right - left, height = bottom - top
    if (width > 32768 || height > 32768 || width * height > 80_000_000) {
      this.ui?.toast('Reveal All would create an excessively large canvas', 'error')
      return false
    }
    this.cropTo({ x: left, y: top, w: width, h: height },
      { deletePixels: false, historyLabel: 'Reveal All' })
    return true
  }

  resizeCanvas(opts: { w: number; h: number; anchor: 'center' | 'top-left' | 'top' | 'top-right' | 'left' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right' }) {
    const doc = this.activeDoc
    if (!doc) return
    const w = Math.max(1, Math.round(opts.w)), h = Math.max(1, Math.round(opts.h))
    if (w === doc.width && h === doc.height) return
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
      if (l.transform) {
        l.transform = {
          ...l.transform,
          x: l.transform.x + dx,
          y: l.transform.y + dy,
          quad: l.transform.quad?.map(p => ({ x: p.x + dx, y: p.y + dy })) as typeof l.transform.quad,
        }
      }
      if (l.text) { l.text.x += dx; l.text.y += dy }
      if (l.shape) {
        l.shape.x += dx; l.shape.y += dy
        if (l.shape.shape === 'path' && l.shape.pathAnchors?.length) {
          l.shape.pathAnchors = l.shape.pathAnchors.map(a => ({ ...a, x: a.x + dx, y: a.y + dy }))
        }
      }
      if (l.vectorMask) {
        l.vectorMask = mapVectorMask(l.vectorMask, a => ({ ...a, x: a.x + dx, y: a.y + dy }))
      }
      l._v++; l._mv++
    }
    // Canvas Size must translate all document-space masks and geometry, not
    // merely the visible layer canvases. Leaving old-size selection/channel
    // masks causes invalid bounds and misregistered subsequent edits.
    if (doc.selection) {
      const mask = createCanvas(w, h)
      ctx2d(mask).drawImage(doc.selection.mask, dx, dy)
      doc.selection = selectionFromMask(mask, doc.selection._v + 1)
    }
    for (const channel of doc.savedChannels) {
      const mask = createCanvas(w, h)
      ctx2d(mask).drawImage(channel.mask, dx, dy)
      channel.mask = mask
      channel._v++
    }
    if (doc.savedPaths?.length) {
      doc.savedPaths = doc.savedPaths.map(path => ({
        ...path, anchors: path.anchors.map(a => ({ ...a, x: a.x + dx, y: a.y + dy })),
      }))
    }
    if (doc.guides?.length) {
      doc.guides = doc.guides
        .map(g => ({ ...g, pos: g.pos + (g.orientation === 'v' ? dx : dy) }))
        .filter(g => g.pos >= 0 && g.pos <= (g.orientation === 'v' ? w : h))
    }
    if (doc.measurements?.length) {
      doc.measurements = doc.measurements.map(measurement => ({
        ...measurement,
        segments: measurement.segments.map(segment => ({
          a: { x: segment.a.x + dx, y: segment.a.y + dy },
          b: { x: segment.b.x + dx, y: segment.b.y + dy },
        })),
      }))
    }
    if (doc.frames?.length) {
      doc.frames = doc.frames.map(frame => ({
        ...frame,
        layers: Object.fromEntries(Object.entries(frame.layers).map(([id, entry]) => [
          id, {
            ...entry,
            x: entry.x === undefined ? undefined : entry.x + dx,
            y: entry.y === undefined ? undefined : entry.y + dy,
          },
        ])),
      }))
    }
    if (doc.colorSamplers?.length) {
      doc.colorSamplers = doc.colorSamplers
        .map(s => ({ ...s, x: s.x + dx, y: s.y + dy }))
        .filter(s => s.x >= 0 && s.y >= 0 && s.x < w && s.y < h)
    }
    doc.width = w; doc.height = h
    doc._epoch++
    invalidateFlat(doc)
    this.pushHistory('Canvas Size')
    this.emit()
  }

  resizeImage(opts: { w: number; h: number; resolutionPpi?: number; resample?: boolean }) {
    const doc = this.activeDoc
    if (!doc) return
    const w = Math.max(1, Math.round(opts.w))
    const h = Math.max(1, Math.round(opts.h))
    const ppi = clamp(Number(opts.resolutionPpi) || doc.resolutionPpi || 72, 1, 12000)
    const resample = opts.resample !== false
    const pixelsChanged = resample && (w !== doc.width || h !== doc.height)
    const resolutionChanged = Math.abs(ppi - (doc.resolutionPpi ?? 72)) > 1e-6
    if (!pixelsChanged && !resolutionChanged) return
    if (pixelsChanged) this.rescaleDocumentData(doc, w, h)
    doc.resolutionPpi = ppi
    this.pushHistory('Image Size')
    this.recordStep({
      op: 'resizeImage',
      args: { w: doc.width, h: doc.height, resolutionPpi: ppi, resample },
      label: 'Image Size',
    })
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
    if (doc.layers.some(l => l.kind === 'raster' && l.hdrPixels)) {
      this.ui?.toast('AI Upscale is disabled for 32-bit HDR until the Float32 upscaler is available', 'info')
      return false
    }
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
        if (l.transform) {
          l.transform = {
            ...l.transform,
            x: l.transform.x * sx,
            y: l.transform.y * sy,
            quad: l.transform.quad?.map(p => ({ x: p.x * sx, y: p.y * sy })) as typeof l.transform.quad,
          }
        }
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
    if (doc.colorSamplers?.length) {
      doc.colorSamplers = doc.colorSamplers.map(s => ({ ...s, x: s.x * sx, y: s.y * sy }))
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
    if (!Number.isFinite(deg)) return
    this.syncPendingHdrCanvasEdits(doc)
    const rad = (deg * Math.PI) / 180
    const rc = Math.cos(rad), rs = Math.sin(rad)
    const cos = Math.abs(rc), sin = Math.abs(rs)
    const w = Math.max(1, Math.round(doc.width * cos + doc.height * sin))
    const h = Math.max(1, Math.round(doc.width * sin + doc.height * cos))
    const exactTurn = Math.abs(deg / 90 - Math.round(deg / 90)) < 1e-8
    const hdrRotated = new Map<string, Float32Array>()
    for (const layer of doc.layers) {
      if (layer.kind !== 'raster' || !layer.canvas || !layer.hdrPixels) continue
      const source = cropHdrPixels(layer.hdrPixels, layer.canvas.width, layer.canvas.height,
        doc.width, doc.height, -(layer.offsetX ?? 0), -(layer.offsetY ?? 0))
      hdrRotated.set(layer.id, exactTurn
        ? rotateHdrPixels(source, doc.width, doc.height, Math.round(deg / 90) * 90)
        : affineHdrPixels(source, doc.width, doc.height, w, h, {
            sourceCenterX: doc.width / 2, sourceCenterY: doc.height / 2,
            rotationRadians: rad, scale: 1,
          }))
    }
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
      if (hdrRotated.has(l.id)) {
        l.hdrPixels = hdrRotated.get(l.id)!
        l.canvas = hdrFloat32ToPreviewCanvas(l.hdrPixels, w, h, 'srgb')
        l._hdrPreviewBefore = null
      }
      if (l.mask) l.mask = rotateCanvasPixels(l.mask)
      if (l.transform) {
        const t = l.transform
        const mapPoint = (p: Point2): Point2 => {
          const ox = p.x - doc.width / 2, oy = p.y - doc.height / 2
          return { x: w / 2 + ox * rc - oy * rs, y: h / 2 + ox * rs + oy * rc }
        }
        if (l.kind === 'smart' && l.source) {
          const quad = this.layerTransformQuad(l.id)
          const nextQuad = quad?.map(mapPoint) as typeof t.quad
          const center = mapPoint({ x: t.x, y: t.y })
          l.transform = { ...t, x: center.x, y: center.y, rotation: t.rotation + rad, quad: nextQuad }
          // Smart Object source pixels remain untouched; placement rotates.
        } else {
          const center = mapPoint({ x: t.x, y: t.y })
          l.transform = { ...t, x: center.x, y: center.y, rotation: t.rotation + rad }
        }
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
    if (doc.colorSamplers?.length) {
      doc.colorSamplers = doc.colorSamplers.map(s => {
        const ox = s.x - doc.width / 2, oy = s.y - doc.height / 2
        return { ...s, x: w / 2 + ox * rc - oy * rs, y: h / 2 + ox * rs + oy * rc }
      })
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
    this.syncPendingHdrCanvasEdits(doc)
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
      if (l.kind === 'raster' && l.canvas && l.hdrPixels) {
        l.hdrPixels = flipHdrPixels(l.hdrPixels, l.canvas.width, l.canvas.height, dir)
        l.canvas = hdrFloat32ToPreviewCanvas(l.hdrPixels, l.canvas.width, l.canvas.height, 'srgb')
        l._hdrPreviewBefore = null
      }
      if (l.mask) l.mask = flip(l.mask)
      if (l.source && l.kind !== 'smart') l.source = flip(l.source)
      if (l.kind === 'raster' && l.canvas) {
        // mirror the registration so the flipped pixels land at the mirrored doc rect
        if (dir === 'horizontal') l.offsetX = doc.width - (l.offsetX ?? 0) - l.canvas.width
        else l.offsetY = doc.height - (l.offsetY ?? 0) - l.canvas.height
      }
      if (l.transform) {
        const t = l.transform
        if (l.kind === 'smart' && l.source) {
          const quad = this.layerTransformQuad(l.id)
          const nextQuad = quad?.map(p => ({
            x: dir === 'horizontal' ? doc.width - p.x : p.x,
            y: dir === 'vertical' ? doc.height - p.y : p.y,
          })) as typeof t.quad
          l.transform = {
            ...t,
            x: dir === 'horizontal' ? doc.width - t.x : t.x,
            y: dir === 'vertical' ? doc.height - t.y : t.y,
            rotation: -t.rotation,
            quad: nextQuad,
          }
        } else {
          l.transform = {
            ...t,
            x: dir === 'horizontal' ? doc.width - t.x : t.x,
            y: dir === 'vertical' ? doc.height - t.y : t.y,
            rotation: -t.rotation,
          }
        }
      }
      l._v++; l._mv++
    }
    if (doc.selection) doc.selection = { ...doc.selection, mask: flip(doc.selection.mask), _v: doc.selection._v + 1 }
    if (doc.colorSamplers?.length) {
      doc.colorSamplers = doc.colorSamplers.map(s => ({
        ...s,
        x: dir === 'horizontal' ? doc.width - 1 - s.x : s.x,
        y: dir === 'vertical' ? doc.height - 1 - s.y : s.y,
      }))
    }
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
    // Merge pending Canvas2D painting edits before reading the authoritative
    // scene-linear Float32 pixels for a direct high-precision transform.
    if (layer.kind === 'raster' && layer.hdrPixels) this.syncPendingHdrCanvasEdits(doc)
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
    const hd = layer.kind === 'raster' ? layer.hdrPixels : null
    const d = hd ? null : getImageData(src).data
    let minX = src.width, minY = src.height, maxX = -1, maxY = -1
    for (let y = 0; y < src.height; y++) {
      const row = y * src.width
      for (let x = 0; x < src.width; x++) {
        if ((hd ? hd[(row + x) * 4 + 3] : d![(row + x) * 4 + 3]) > 0) {
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
    if (hd) {
      // Rotate+scale the true HDR buffer, preserving scene-linear values > 1.
      layer.hdrPixels = affineHdrPixels(hd, src.width, src.height, nw, nh, {
        sourceCenterX: minX + bw / 2,
        sourceCenterY: minY + bh / 2,
        rotationRadians: rot,
        scale: s,
      })
      layer.canvas = hdrFloat32ToPreviewCanvas(layer.hdrPixels, nw, nh, 'srgb')
      layer._hdrPreviewBefore = null
    } else {
      const out = createCanvas(nw, nh, canvasProfile(src))
      const c = ctx2d(out)
      c.imageSmoothingEnabled = true
      c.imageSmoothingQuality = 'high'
      c.translate(nw / 2, nh / 2)
      c.rotate(rot)
      c.scale(s, s)
      // Draw source around the content center; transparent margins are harmless.
      c.drawImage(src, -(minX + bw / 2), -(minY + bh / 2))
      layer.canvas = out
    }
    // re-register: content center fixed at (cxDoc, cyDoc)
    layer.offsetX = Math.round(cxDoc - nw / 2)
    layer.offsetY = Math.round(cyDoc - nh / 2)
    layer._v++
    invalidateFlat(doc)
    this.pushHistory('Free Transform')
    this.emit()
  }


  /** Current transform quad in document coordinates (TL, TR, BR, BL). */
  layerTransformQuad(id: string): [Point2, Point2, Point2, Point2] | null {
    const doc = this.activeDoc
    const layer = this.layerById(id)
    if (!doc || !layer) return null
    if (layer.kind === 'smart' && layer.source) {
      const t = layer.transform ?? { x: doc.width / 2, y: doc.height / 2, scale: 1, rotation: 0 }
      if (t.quad?.length === 4) return t.quad.map(p => ({ ...p })) as [Point2, Point2, Point2, Point2]
      const hw = layer.source.width * t.scale / 2
      const hh = layer.source.height * t.scale / 2
      const cos = Math.cos(t.rotation), sin = Math.sin(t.rotation)
      const map = (x: number, y: number): Point2 => ({
        x: t.x + x * cos - y * sin,
        y: t.y + x * sin + y * cos,
      })
      return [map(-hw, -hh), map(hw, -hh), map(hw, hh), map(-hw, hh)]
    }
    const r = this.layerContentRect(id)
    if (!r) return null
    return [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ]
  }

  layerWarpMesh(id: string, cols = 3, rows = 3): TransformWarpSpec {
    const layer = this.layerById(id)
    const existing = layer?.kind === 'smart' ? validateWarpMesh(layer.transform?.warp) : null
    return existing ? cloneWarpMesh(existing) : regularWarpMesh(cols, rows)
  }

  private transformReferencePoint(quad: Point2[], ref: TransformReference): Point2 {
    const xs = quad.map(p => p.x), ys = quad.map(p => p.y)
    const x0 = Math.min(...xs), x1 = Math.max(...xs)
    const y0 = Math.min(...ys), y1 = Math.max(...ys)
    const xf = ref.endsWith('l') ? 0 : ref.endsWith('r') ? 1 : .5
    const yf = ref.startsWith('t') ? 0 : ref.startsWith('b') ? 1 : .5
    return { x: x0 + (x1 - x0) * xf, y: y0 + (y1 - y0) * yf }
  }

  private transformedQuad(base: [Point2, Point2, Point2, Point2], cmd: LayerTransformCommand): [Point2, Point2, Point2, Point2] {
    const tx = Number(cmd.x) || 0, ty = Number(cmd.y) || 0
    if (cmd.mode === 'distort') {
      const o = cmd.cornerOffsets ?? [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]
      return base.map((p, i) => ({ x: p.x + (o[i]?.x || 0) + tx, y: p.y + (o[i]?.y || 0) + ty })) as [Point2, Point2, Point2, Point2]
    }
    if (cmd.mode === 'perspective') {
      const xs = base.map(p => p.x), ys = base.map(p => p.y)
      const w = Math.max(1, Math.max(...xs) - Math.min(...xs))
      const h = Math.max(1, Math.max(...ys) - Math.min(...ys))
      const px = clamp(Number(cmd.perspectiveX) || 0, -100, 100) / 200 * w
      const py = clamp(Number(cmd.perspectiveY) || 0, -100, 100) / 200 * h
      const out: [Point2, Point2, Point2, Point2] = base.map(p => ({ ...p })) as any
      // Horizontal: positive narrows the top / widens the bottom.
      out[0].x += px; out[1].x -= px; out[2].x += px; out[3].x -= px
      // Vertical: positive narrows the left / widens the right.
      out[0].y += py; out[3].y -= py; out[1].y -= py; out[2].y += py
      for (const p of out) { p.x += tx; p.y += ty }
      return out
    }

    const ref = this.transformReferencePoint(base, cmd.reference ?? 'mc')
    const sx = cmd.mode === 'rotate' || cmd.mode === 'skew' ? 1 : Math.max(.01, Number(cmd.scaleX) || 1)
    const sy = cmd.mode === 'rotate' || cmd.mode === 'skew' ? 1 : Math.max(.01, Number(cmd.scaleY) || 1)
    const skewX = cmd.mode === 'skew' ? Math.tan(clamp(Number(cmd.skewX) || 0, -80, 80) * Math.PI / 180) : 0
    const skewY = cmd.mode === 'skew' ? Math.tan(clamp(Number(cmd.skewY) || 0, -80, 80) * Math.PI / 180) : 0
    const rot = (cmd.mode === 'scale' || cmd.mode === 'skew' ? 0 : Number(cmd.rotation) || 0) * Math.PI / 180
    const cos = Math.cos(rot), sin = Math.sin(rot)
    return base.map(p => {
      const ox = p.x - ref.x, oy = p.y - ref.y
      const ax = ox * sx + oy * skewX
      const ay = oy * sy + ox * skewY
      return {
        x: ref.x + ax * cos - ay * sin + tx,
        y: ref.y + ax * sin + ay * cos + ty,
      }
    }) as [Point2, Point2, Point2, Point2]
  }

  private mapDocPointThroughWarp(
    point: Point2,
    sourceRect: Rect,
    mesh: TransformWarpSpec,
    quad: [Point2, Point2, Point2, Point2],
  ): Point2 {
    const normalized = {
      x: (point.x - sourceRect.x) / Math.max(1e-9, sourceRect.w),
      y: (point.y - sourceRect.y) / Math.max(1e-9, sourceRect.h),
    }
    const warped = mapNormalizedPointThroughWarp(normalized, mesh)
    return mapRectPointToQuad(warped, { x: 0, y: 0, w: 1, h: 1 }, quad)
  }

  private quadArea(q: Point2[]): number {
    let area = 0
    for (let i = 0; i < q.length; i++) {
      const a = q[i], b = q[(i + 1) % q.length]
      area += a.x * b.y - b.x * a.y
    }
    return Math.abs(area) / 2
  }

  /** Apply Photoshop-style Scale/Rotate/Skew/Distort/Perspective.
   * Smart Objects retain a projective quad; raster content is resampled once.
   * Text/shape layers remain editable for ordinary uniform Free Transform, but
   * advanced projective transforms rasterize them (with undo available). */
  transformLayer(id: string, cmd: LayerTransformCommand, remember = true) {
    const doc = this.activeDoc
    const layer = this.layerById(id)
    if (!doc || !layer) return
    if (layer.locked) { this.ui?.toast('Layer is locked', 'error'); return }
    if (layer.kind === 'adjustment') { this.ui?.toast('Adjustment layers have no pixels to transform', 'error'); return }
    if (layer.kind === 'raster' && layer.hdrPixels) {
      // Free/Scale/Rotate with uniform scaling can be computed exactly in
      // Float32. Perspective, shears and mesh warps still require dedicated
      // scene-linear inverse mapping; never round-trip them via the preview.
      const uniform = Math.abs((cmd.scaleX ?? 1) - (cmd.scaleY ?? 1)) < 1e-6
      if ((cmd.mode === 'free' || cmd.mode === 'scale' || cmd.mode === 'rotate') && uniform) {
        this.freeTransformLayer(id, {
          x: cmd.x ?? 0, y: cmd.y ?? 0,
          scale: cmd.mode === 'rotate' ? 1 : (cmd.scaleX ?? 1),
          rotation: cmd.mode === 'scale' ? 0 : (cmd.rotation ?? 0),
        })
        if (remember) this.lastTransformCommand = structuredClone(cmd)
      } else {
        this.ui?.toast('HDR raster warp, skew and nonuniform scaling require a dedicated Float32 transform', 'info')
      }
      return
    }

    const base = this.layerTransformQuad(id)
    if (!base) { this.ui?.toast('This layer has no transformable content', 'error'); return }

    if (cmd.mode === 'warp') {
      if (layer.kind === 'raster' && layer.hdrPixels) {
        this.ui?.toast('Warp is disabled for raster layers with 32-bit HDR pixels until mesh rasterization can preserve scene-linear Float32 data', 'info')
        return
      }
      const mesh = validateWarpMesh(cmd.warp)
      if (!mesh) { this.ui?.toast('Warp mesh is invalid', 'error'); return }

      if (layer.kind === 'smart' && layer.source) {
        const t = layer.transform ?? { x: doc.width / 2, y: doc.height / 2, scale: 1, rotation: 0 }
        layer.transform = { ...t, warp: cloneWarpMesh(mesh) }
        layer._v++
        invalidateFlat(doc)
        if (remember) this.lastTransformCommand = structuredClone(cmd)
        this.pushHistory('Transform Warp')
        this.emit()
        return
      }

      const r = this.layerContentRect(id)
      if (!r || r.w < 1 || r.h < 1) return
      let source: HTMLCanvasElement
      if (layer.kind === 'raster' && layer.canvas) {
        source = layer.canvas
      } else {
        const full = layer.kind === 'text' && layer.text
          ? renderTextCanvas(doc, layer.text)
          : layer.kind === 'shape' && layer.shape
            ? renderShapeCanvas(doc, layer.shape)
            : null
        if (!full) return
        source = createCanvas(Math.max(1, Math.ceil(r.w)), Math.max(1, Math.ceil(r.h)))
        ctx2d(source).drawImage(full, -r.x, -r.y)
      }

      const destination = warpMeshDestinationPoints(mesh, base)
      const warped = warpCanvasToMesh(source, mesh, destination)
      layer.kind = 'raster'
      layer.canvas = warped.canvas
      layer.offsetX = warped.offsetX
      layer.offsetY = warped.offsetY
      layer.source = null
      layer.transform = null
      layer.text = null
      layer.shape = null
      layer.smartFilters = []

      if (layer.mask) {
        const maskTile = createCanvas(source.width, source.height)
        ctx2d(maskTile).drawImage(layer.mask, -r.x, -r.y)
        const wm = warpCanvasToMesh(maskTile, mesh, destination)
        const docMask = createCanvas(doc.width, doc.height)
        ctx2d(docMask).drawImage(wm.canvas, wm.offsetX, wm.offsetY)
        layer.mask = docMask
        layer._mv++
      }
      if (layer.vectorMask) {
        const mapAnchor = (a: PathAnchor): PathAnchor => {
          const p = this.mapDocPointThroughWarp({ x: a.x, y: a.y }, r, mesh, base)
          const pin = this.mapDocPointThroughWarp({ x: a.x + a.inX, y: a.y + a.inY }, r, mesh, base)
          const pout = this.mapDocPointThroughWarp({ x: a.x + a.outX, y: a.y + a.outY }, r, mesh, base)
          return {
            ...a, x: p.x, y: p.y,
            inX: pin.x - p.x, inY: pin.y - p.y,
            outX: pout.x - p.x, outY: pout.y - p.y,
          }
        }
        layer.vectorMask = mapVectorMask(layer.vectorMask, mapAnchor)
      }

      layer._v++
      invalidateFlat(doc)
      if (remember) this.lastTransformCommand = structuredClone(cmd)
      this.pushHistory('Transform Warp')
      this.emit()
      return
    }

    const target = this.transformedQuad(base, cmd)
    if (this.quadArea(target) < 1) { this.ui?.toast('Transform would collapse the layer', 'error'); return }

    if (layer.kind === 'smart' && layer.source) {
      const t = layer.transform ?? { x: doc.width / 2, y: doc.height / 2, scale: 1, rotation: 0 }
      const cx = target.reduce((s, p) => s + p.x, 0) / 4
      const cy = target.reduce((s, p) => s + p.y, 0) / 4
      layer.transform = { ...t, x: cx, y: cy, quad: target }
      layer._v++
      invalidateFlat(doc)
      if (remember) this.lastTransformCommand = structuredClone(cmd)
      this.pushHistory(`Transform ${cmd.mode[0].toUpperCase() + cmd.mode.slice(1)}`)
      this.emit()
      return
    }

    // Preserve native editable text/shape for transformations representable by
    // the existing uniform scale/rotate model.
    if (
      (layer.kind === 'text' || layer.kind === 'shape') &&
      (cmd.mode === 'free' || cmd.mode === 'scale' || cmd.mode === 'rotate') &&
      Math.abs((cmd.scaleX ?? 1) - (cmd.scaleY ?? 1)) < 1e-6
    ) {
      this.freeTransformLayer(id, {
        x: cmd.x ?? 0,
        y: cmd.y ?? 0,
        scale: cmd.mode === 'rotate' ? 1 : (cmd.scaleX ?? 1),
        rotation: cmd.mode === 'scale' ? 0 : (cmd.rotation ?? 0),
      })
      if (remember) this.lastTransformCommand = structuredClone(cmd)
      return
    }

    const r = this.layerContentRect(id)
    if (!r || r.w < 1 || r.h < 1) return
    let source: HTMLCanvasElement
    if (layer.kind === 'raster' && layer.canvas) {
      source = layer.canvas
    } else {
      const full = layer.kind === 'text' && layer.text
        ? renderTextCanvas(doc, layer.text)
        : layer.kind === 'shape' && layer.shape
          ? renderShapeCanvas(doc, layer.shape)
          : null
      if (!full) return
      source = createCanvas(Math.max(1, Math.ceil(r.w)), Math.max(1, Math.ceil(r.h)))
      ctx2d(source).drawImage(full, -r.x, -r.y)
    }

    const warped = warpCanvasToQuad(source, target)
    // Advanced transforms rasterize text/shapes but preserve masks, vector
    // masks and Layer Styles as independent layer metadata.
    layer.kind = 'raster'
    layer.canvas = warped.canvas
    layer.offsetX = warped.offsetX
    layer.offsetY = warped.offsetY
    layer.source = null
    layer.transform = null
    layer.text = null
    layer.shape = null
    layer.smartFilters = []

    if (layer.mask) {
      const maskTile = createCanvas(source.width, source.height)
      ctx2d(maskTile).drawImage(layer.mask, -r.x, -r.y)
      const wm = warpCanvasToQuad(maskTile, target)
      const docMask = createCanvas(doc.width, doc.height)
      ctx2d(docMask).drawImage(wm.canvas, wm.offsetX, wm.offsetY)
      layer.mask = docMask
      layer._mv++
    }
    if (layer.vectorMask) {
      const mapAnchor = (a: PathAnchor): PathAnchor => {
        const p = mapRectPointToQuad({ x: a.x, y: a.y }, r, target)
        const pin = mapRectPointToQuad({ x: a.x + a.inX, y: a.y + a.inY }, r, target)
        const pout = mapRectPointToQuad({ x: a.x + a.outX, y: a.y + a.outY }, r, target)
        return {
          ...a, x: p.x, y: p.y,
          inX: pin.x - p.x, inY: pin.y - p.y,
          outX: pout.x - p.x, outY: pout.y - p.y,
        }
      }
      layer.vectorMask = mapVectorMask(layer.vectorMask, mapAnchor)
    }

    layer._v++
    invalidateFlat(doc)
    if (remember) this.lastTransformCommand = structuredClone(cmd)
    this.pushHistory(`Transform ${cmd.mode[0].toUpperCase() + cmd.mode.slice(1)}`)
    this.emit()
  }

  canRepeatTransform() { return !!this.lastTransformCommand }

  repeatLastTransform() {
    const layer = this.activeLayer
    if (!layer || !this.lastTransformCommand) return
    this.transformLayer(layer.id, structuredClone(this.lastTransformCommand), false)
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
      case 'crop': this.cropTo(
        { x: a.x, y: a.y, w: a.w, h: a.h },
        {
          deletePixels: a.deletePixels,
          targetW: a.targetW,
          targetH: a.targetH,
          resolutionPpi: a.resolutionPpi,
        },
      ); break
      case 'resizeImage': this.resizeImage({
        w: a.w,
        h: a.h,
        resolutionPpi: a.resolutionPpi,
        resample: a.resample,
      }); break
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
    const encoded = await canvasToBlob(out, type, opts.format === 'png' ? undefined : opts.quality / 100)
    const blob = await embedRasterMetadata(
      encoded,
      opts.format,
      opts.includeMetadata === false ? undefined : doc.metadata,
      {
        resolutionPpi: doc.resolutionPpi ?? 72,
        width: out.width,
        height: out.height,
      },
    )
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
