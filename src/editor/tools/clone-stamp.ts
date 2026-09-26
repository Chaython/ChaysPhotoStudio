// ============================================================
// Clone Stamp — professional upgrade (Task 2-b)
//  · rotate / mirrored source sampling (transform-aware dabs)
//  · aligned on: offset persists across strokes; off: source resets to the
//    clone source at every stroke start (fixed vector from stroke START)
//  · soft-edge dabs: source drawn into a dab canvas, then destination-in
//    radial gradient mask honoring hardness (like PS)
//  · Alt+click sets source (layer snapshot, or flat composite when the
//    toolOptions say sample:'composite')
//  · overlay: source crosshair + ghost circle of the sampled source area
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, brushSettingsFrom, walkDabs, drawCross } from './shared'
import { buildSourceDab, sourcePointFor, pressureFlow } from './dab-utils'
import { cloneCanvas } from '../utils/canvas'
import { getSamplingComposite } from '../engine/document'
import { useEditorStore } from '../store'

interface ClonePoint { x: number; y: number; layerId: string | null }
interface CloneSlot {
  docId: string | null
  point: ClonePoint | null
  ref: { x: number; y: number } | null
  source: HTMLCanvasElement | null
}
interface CloneState {
  active: boolean
  last: { x: number; y: number } | null
  /** point where cursor maps exactly onto the clone source (aligned anchor) */
  ref: { x: number; y: number } | null
  /** snapshot of the canvas we sample from (taken at Alt+click) */
  source: HTMLCanvasElement | null
  point: ClonePoint | null
  loadedSlot: number
  loadedDocId: string | null
}
const st: CloneState = { active: false, last: null, ref: null, source: null, point: null, loadedSlot: 0, loadedDocId: null }
const sourceSlots: CloneSlot[] = Array.from({ length: 5 }, () => ({ docId: null, point: null, ref: null, source: null }))
let connectFrom: { x: number; y: number } | null = null
let connectDocId: string | null = null
let connectLayerId: string | null = null

export interface CloneSourceSlotInfo {
  index: number
  active: boolean
  hasSource: boolean
  point: { x: number; y: number } | null
  source: HTMLCanvasElement | null
}

export interface CloneSourcePreset {
  format: 'zphoto-clone-source'
  version: 1
  name?: string
  selectedSlot: number
  settings: {
    aligned: boolean
    sample: 'layer' | 'current-below' | 'composite'
    ignoreAdjustments: boolean
  }
  sourceTransforms: Record<string, Record<string, unknown>>
  slots: Array<{
    point: { x: number; y: number } | null
    sourcePng: string | null
  }>
}

function dataUrlToCanvas(url: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = Math.max(1, img.naturalWidth)
      c.height = Math.max(1, img.naturalHeight)
      const cx = c.getContext('2d')
      if (!cx) { reject(new Error('Canvas 2D unavailable')); return }
      cx.drawImage(img, 0, 0)
      resolve(c)
    }
    img.onerror = () => reject(new Error('Clone source image could not be decoded'))
    img.src = url
  })
}

export function exportCloneSourcePreset(name?: string): CloneSourcePreset {
  syncSourceSlot()
  saveLoadedSlot()
  const docId = engine.activeDoc?.id ?? null
  const opts = getOptions('clone-stamp')
  return {
    format: 'zphoto-clone-source',
    version: 1,
    name,
    selectedSlot: Math.max(1, Math.min(5, Math.round(Number(opts.sourceSlot) || 1))),
    settings: {
      aligned: opts.aligned !== false,
      sample: opts.sample === 'current-below' ? 'current-below' : opts.sample === 'composite' ? 'composite' : 'layer',
      ignoreAdjustments: opts.ignoreAdjustments === true,
    },
    sourceTransforms: structuredClone(opts.sourceTransforms ?? {}),
    slots: sourceSlots.map(slot => ({
      point: slot.docId === docId && slot.point ? { x: slot.point.x, y: slot.point.y } : null,
      sourcePng: slot.docId === docId && slot.source ? slot.source.toDataURL('image/png') : null,
    })),
  }
}

export async function importCloneSourcePreset(raw: unknown): Promise<number> {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid Clone Source preset')
  const preset = raw as Partial<CloneSourcePreset>
  if (preset.format !== 'zphoto-clone-source' || preset.version !== 1 || !Array.isArray(preset.slots)) {
    throw new Error('Unsupported Clone Source preset')
  }
  const docId = engine.activeDoc?.id
  if (!docId) throw new Error('Open a document before loading Clone Source presets')

  const decoded: CloneSlot[] = []
  let loaded = 0
  for (let i = 0; i < 5; i++) {
    const src = preset.slots[i]
    if (!src?.sourcePng || !src.point || !Number.isFinite(src.point.x) || !Number.isFinite(src.point.y)) {
      decoded.push({ docId, point: null, ref: null, source: null })
      continue
    }
    if (!src.sourcePng.startsWith('data:image/')) throw new Error(`Source #${i + 1} is not an embedded image`)
    const canvas = await dataUrlToCanvas(src.sourcePng)
    decoded.push({
      docId,
      point: { x: Number(src.point.x), y: Number(src.point.y), layerId: null },
      // Destination alignment is intentionally reset: a saved source image and
      // source point are portable, while the prior destination anchor belongs
      // to another document/session.
      ref: null,
      source: canvas,
    })
    loaded++
  }

  for (let i = 0; i < 5; i++) sourceSlots[i] = decoded[i]

  const current = useEditorStore.getState().toolOptions['clone-stamp'] ?? {}
  const selectedSlot = Math.max(1, Math.min(5, Math.round(Number(preset.selectedSlot) || 1)))
  const transforms = preset.sourceTransforms && typeof preset.sourceTransforms === 'object'
    ? preset.sourceTransforms
    : {}
  const selectedTransform = (transforms as Record<string, any>)[String(selectedSlot)] ?? {}
  useEditorStore.setState(s => ({
    toolOptions: {
      ...s.toolOptions,
      'clone-stamp': {
        ...current,
        aligned: preset.settings?.aligned !== false,
        sample: preset.settings?.sample === 'current-below' || preset.settings?.sample === 'composite'
          ? preset.settings.sample
          : 'layer',
        ignoreAdjustments: preset.settings?.ignoreAdjustments === true,
        sourceTransforms: transforms,
        sourceSlot: selectedSlot,
        rotate: Number(selectedTransform.rotate) || 0,
        scale: Number(selectedTransform.scale) || 100,
        mirrored: selectedTransform.mirrored === true,
        showOverlay: selectedTransform.showOverlay !== false,
        overlayOpacity: Number.isFinite(selectedTransform.overlayOpacity) ? selectedTransform.overlayOpacity : 50,
        overlayAutoHide: selectedTransform.overlayAutoHide !== false,
        overlayClipped: selectedTransform.overlayClipped !== false,
        overlayBlend: typeof selectedTransform.overlayBlend === 'string' ? selectedTransform.overlayBlend : 'normal',
        overlayInvert: selectedTransform.overlayInvert === true,
      },
    },
  }))

  st.loadedDocId = null
  syncSourceSlot()
  notifyCloneSourcePanel()
  engine.requestRender()
  return loaded
}

function notifyCloneSourcePanel() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('zphoto:clone-source'))
}

export function getCloneSourceSlots(): CloneSourceSlotInfo[] {
  syncSourceSlot()
  const docId = engine.activeDoc?.id ?? null
  return sourceSlots.map((slot, index) => ({
    index,
    active: index === st.loadedSlot,
    hasSource: !!slot.source && !!slot.point && slot.docId === docId,
    point: slot.docId === docId && slot.point ? { x: slot.point.x, y: slot.point.y } : null,
    source: slot.docId === docId ? slot.source : null,
  }))
}

export function clearCloneSourceSlot(index: number) {
  const i = Math.max(0, Math.min(4, Math.round(index)))
  const slot = sourceSlots[i]
  if (!slot) return
  slot.docId = engine.activeDoc?.id ?? null
  slot.point = null
  slot.ref = null
  slot.source = null
  if (i === st.loadedSlot) {
    st.point = null
    st.ref = null
    st.source = null
    engine.cloneSource = null
  }
  notifyCloneSourcePanel()
  engine.requestRender()
}

function requestedSlot(): number {
  return Math.max(0, Math.min(4, Math.round(Number(getOptions('clone-stamp').sourceSlot) || 1) - 1))
}

function saveLoadedSlot() {
  const slot = sourceSlots[st.loadedSlot]
  if (!slot) return
  slot.docId = st.loadedDocId
  slot.point = st.point ? { ...st.point } : null
  slot.ref = st.ref ? { ...st.ref } : null
  slot.source = st.source
}

function syncSourceSlot() {
  const next = requestedSlot()
  const docId = engine.activeDoc?.id ?? null
  if (next === st.loadedSlot && st.loadedDocId === docId) return
  saveLoadedSlot()
  st.loadedSlot = next
  st.loadedDocId = docId
  const slot = sourceSlots[next]
  if (slot?.docId === docId) {
    st.point = slot.point ? { ...slot.point } : null
    st.ref = slot.ref ? { ...slot.ref } : null
    st.source = slot.source
  } else {
    st.point = null
    st.ref = null
    st.source = null
  }
  engine.cloneSource = st.point ? { ...st.point } : null
}

/** snapshot of the sampling source: composite when requested, else the layer
 *  (doc-space so sampling at doc coordinates stays correct on offset layers) */
function resolveSourceCanvas(layerId: string): HTMLCanvasElement | null {
  const doc = engine.activeDoc
  if (!doc) return null
  const opts = getOptions('clone-stamp')
  const mode = opts.sample === 'current-below'
    ? 'current-below'
    : opts.sample === 'composite'
      ? 'all'
      : 'layer'
  return getSamplingComposite(doc, layerId, mode, opts.ignoreAdjustments === true)
}

function drawCloneCursor(
  ctx: CanvasRenderingContext2D,
  mouse: { x: number; y: number } | null,
  zoom: number,
  opts: Record<string, any>,
) {
  if (!mouse) return
  const rx = Math.max(2, (Number(opts.size) || 60) * .5 * zoom)
  const ry = Math.max(1, rx * Math.max(.05, Math.min(1, (Number(opts.brushRoundness) || 100) / 100)))
  ctx.save()
  ctx.translate(mouse.x, mouse.y)
  ctx.rotate(((Number(opts.brushAngle) || 0) * Math.PI) / 180)
  ctx.strokeStyle = 'rgba(255,255,255,.9)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(0,0,0,.7)'
  ctx.setLineDash([2, 2])
  ctx.stroke()
  ctx.restore()
}

function currentSourcePoint(docX: number, docY: number) {
  const src = st.point
  if (!src || !st.ref) return null
  const opts = getOptions('clone-stamp')
  const rot = ((opts.rotate ?? 0) * Math.PI) / 180
  const scale = Math.max(.25, Math.min(4, (Number(opts.scale) || 100) / 100))
  return sourcePointFor(docX, docY, st.ref.x, st.ref.y, src.x, src.y, rot, opts.mirrored === true, scale)
}

export const cloneStampTool: Tool = {
  id: 'clone-stamp',
  requiresLayer: true,
  cursor: 'none',

  onActivate() { syncSourceSlot() },

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    const layer = engine.activeLayer
    if (!doc || !layer) return
    syncSourceSlot()
    const opts = getOptions('clone-stamp')

    if (p.alt) {
      // ---- set clone source ----
      const src = resolveSourceCanvas(layer.id)
      if (!src) return
      st.point = { x: p.docX, y: p.docY, layerId: layer.id }
      engine.cloneSource = { ...st.point }
      st.source = src
      st.ref = null // next stroke re-establishes the offset anchor
      saveLoadedSlot()
      notifyCloneSourcePanel()
      engine.ui?.toast(`Clone source #${st.loadedSlot + 1} set`, 'info')
      engine.requestRender()
      return
    }

    if (!st.point || !st.source) {
      engine.ui?.toast('Alt+click to set a clone source first', 'info')
      return
    }

    engine.beginStroke(layer.id, { opacity: opts.opacity ?? 100, blendMode: opts.blendMode ?? 'normal' })
    st.active = true
    st.last = { x: p.docX, y: p.docY }
    // aligned: keep the persistent anchor (set once after the source is chosen);
    // non-aligned: source resets to the clone source at each stroke start
    if (opts.aligned === false || !st.ref) st.ref = { x: p.docX, y: p.docY }
    saveLoadedSlot()
    const canConnect = p.shift && connectFrom && connectDocId === doc.id && connectLayerId === layer.id
    if (canConnect && connectFrom) {
      const settings = brushSettingsFrom(opts)
      const spacing = Math.max(1, settings.size * settings.spacing)
      const points = walkDabs(connectFrom.x, connectFrom.y, p.docX, p.docY, spacing)
      for (const q of points) dab(q.x, q.y, p)
      const tail = points[points.length - 1]
      if (!tail || Math.hypot(tail.x - p.docX, tail.y - p.docY) > .25) dab(p.docX, p.docY, p)
    } else {
      dab(p.docX, p.docY, p)
    }
  },

  onPointerMove(p: PointerInfo) {
    if (!st.active || !st.last) return
    const opts = getOptions('clone-stamp')
    const settings = brushSettingsFrom(opts)
    const spacing = Math.max(1, settings.size * settings.spacing)
    for (const d of walkDabs(st.last.x, st.last.y, p.docX, p.docY, spacing)) dab(d.x, d.y, p)
    if (Math.hypot(p.docX - st.last.x, p.docY - st.last.y) >= spacing) st.last = { x: p.docX, y: p.docY }
  },

  onPointerUp() {
    if (!st.active) return
    const docId = engine.activeDoc?.id ?? null
    const activeLayerId = engine.activeLayer?.id ?? null
    if (st.last && docId && activeLayerId) {
      connectFrom = { ...st.last }
      connectDocId = docId
      connectLayerId = activeLayerId
    }
    st.active = false
    st.last = null
    engine.endStroke('Clone Stamp')
  },

  onDeactivate() {
    connectFrom = null
    connectDocId = null
    connectLayerId = null
    if (st.active) {
      st.active = false
      st.last = null
      engine.endStroke('Clone Stamp')
    }
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    syncSourceSlot()
    const opts = getOptions('clone-stamp')
    const size = opts.size ?? 60
    const src = st.point

    // ---- source crosshair marker ----
    if (src && st.source) {
      const sx = src.x * view.zoom + view.panX
      const sy = src.y * view.zoom + view.panY
      ctx.save()
      ctx.strokeStyle = '#e8a33d'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(sx - 8, sy); ctx.lineTo(sx + 8, sy)
      ctx.moveTo(sx, sy - 8); ctx.lineTo(sx, sy + 8)
      ctx.stroke()
      ctx.restore()
    }

    // ---- ghost preview of the area being sampled under the cursor ----
    if (src && mouse) {
      const docX = (mouse.x - view.panX) / view.zoom
      const docY = (mouse.y - view.panY) / view.zoom
      const sp = st.ref ? currentSourcePoint(docX, docY) : null
      if (sp) {
        const gx = sp.x * view.zoom + view.panX
        const gy = sp.y * view.zoom + view.panY
        const rDoc = Math.max(1, size / 2)
        const r = Math.max(2, rDoc * view.zoom)

        // Photoshop-style source overlay: preview the actual transformed sample
        // directly under the destination cursor before painting.
        if (opts.showOverlay !== false && !(opts.overlayAutoHide !== false && st.active) && st.source) {
          const rot = ((opts.rotate ?? 0) * Math.PI) / 180
          const mirrored = opts.mirrored === true
          const scale = Math.max(.25, Math.min(4, (Number(opts.scale) || 100) / 100))
          const brushRoundness = Math.max(.05, Math.min(1, (Number(opts.brushRoundness) || 100) / 100))
          const brushAngle = ((Number(opts.brushAngle) || 0) * Math.PI) / 180
          const preview = buildSourceDab(st.source, sp.x, sp.y, rDoc, 100, rot, mirrored, scale, brushRoundness, brushAngle)
          if (preview) {
            const dw = preview.width * view.zoom
            const dh = preview.height * view.zoom
            ctx.save()
            ctx.globalAlpha = Math.max(0, Math.min(1, (Number(opts.overlayOpacity) || 0) / 100))
            const overlayBlend = opts.overlayBlend === 'darken' || opts.overlayBlend === 'lighten' || opts.overlayBlend === 'difference'
              ? opts.overlayBlend
              : 'source-over'
            ctx.globalCompositeOperation = overlayBlend
            if (opts.overlayClipped !== false) {
              ctx.translate(mouse.x, mouse.y)
              ctx.rotate(brushAngle)
              ctx.scale(1, brushRoundness)
              ctx.beginPath()
              ctx.arc(0, 0, r, 0, Math.PI * 2)
              ctx.clip()
              ctx.setTransform(1, 0, 0, 1, 0, 0)
            }
            if (opts.overlayInvert === true) ctx.filter = 'invert(1)'
            ctx.drawImage(preview, mouse.x - dw / 2, mouse.y - dh / 2, dw, dh)
            ctx.restore()
          }
        }

        ctx.save()
        ctx.setLineDash([4, 3])
        ctx.strokeStyle = 'rgba(78,201,176,0.9)'
        ctx.lineWidth = 1.5
        ctx.save()
        ctx.translate(gx, gy)
        ctx.rotate(((Number(opts.brushAngle) || 0) * Math.PI) / 180)
        ctx.scale(1, Math.max(.05, Math.min(1, (Number(opts.brushRoundness) || 100) / 100)))
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
        // thin tether line from cursor to source ghost while stroking
        if (st.active) {
          ctx.setLineDash([2, 4])
          ctx.strokeStyle = 'rgba(78,201,176,0.35)'
          ctx.beginPath()
          ctx.moveTo(mouse.x, mouse.y)
          ctx.lineTo(gx, gy)
          ctx.stroke()
        }
        ctx.restore()
      }
    }
  },

  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    const opts = getOptions('clone-stamp')
    const size = opts.size ?? 60
    if (st.active || (st.point && st.source)) drawCloneCursor(ctx, mouse, view.zoom, opts)
    else drawCross(ctx, mouse)
  },
}

function dab(x: number, y: number, p: PointerInfo) {
  const doc = engine.activeDoc
  if (!doc || !st.source || !st.ref) return
  const opts = getOptions('clone-stamp')
  const settings = brushSettingsFrom(opts)
  const pressure = p.pointerType === 'pen' ? Math.max(0, Math.min(1, p.pressure)) : 1
  const sizeScale = p.pointerType === 'pen' && opts.pressureSize === true ? .25 + .75 * pressure : 1
  const r = settings.size * sizeScale / 2
  const rot = ((opts.rotate ?? 0) * Math.PI) / 180
  const mirrored = opts.mirrored === true
  const scale = Math.max(.25, Math.min(4, (Number(opts.scale) || 100) / 100))
  const brushRoundness = Math.max(.05, Math.min(1, (Number(opts.brushRoundness) || 100) / 100))
  const brushAngle = ((Number(opts.brushAngle) || 0) * Math.PI) / 180
  const src = st.point
  if (!src) return

  const sp = sourcePointFor(x, y, st.ref.x, st.ref.y, src.x, src.y, rot, mirrored, scale)
  const dabCanvas = buildSourceDab(st.source, sp.x, sp.y, r, settings.hardness, rot, mirrored, scale, brushRoundness, brushAngle)
  if (!dabCanvas) return
  const pressureAffectsOpacity = p.pointerType === 'pen' && opts.pressureOpacity !== false
  const flow = pressureFlow(p.pressure, pressureAffectsOpacity, settings.flow / 100)
  engine.dab(x, y, (ctx, dx, dy) => {
    ctx.drawImage(dabCanvas, dx - dabCanvas.width / 2, dy - dabCanvas.height / 2)
  }, flow)
}
