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
import { getOptions, brushSettingsFrom, walkDabs, drawBrushCursor, drawCross } from './shared'
import { buildSourceDab, sourcePointFor, pressureFlow } from './dab-utils'
import { cloneCanvas } from '../utils/canvas'
import { getFlatComposite } from '../engine/document'

interface CloneState {
  active: boolean
  last: { x: number; y: number } | null
  /** point where cursor maps exactly onto the clone source (aligned anchor) */
  ref: { x: number; y: number } | null
  /** snapshot of the canvas we sample from (taken at Alt+click) */
  source: HTMLCanvasElement | null
}
const st: CloneState = { active: false, last: null, ref: null, source: null }

/** snapshot of the sampling source: composite when requested, else the layer
 *  (doc-space so sampling at doc coordinates stays correct on offset layers) */
function resolveSourceCanvas(layerId: string): HTMLCanvasElement | null {
  const doc = engine.activeDoc
  if (!doc) return null
  const opts = getOptions('clone-stamp')
  if (opts.sample === 'composite') return cloneCanvas(getFlatComposite(doc))
  const c = engine.layerCanvasDocSpace(layerId)
  return c ? cloneCanvas(c) : null
}

function currentSourcePoint(docX: number, docY: number) {
  const src = engine.cloneSource
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

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    const layer = engine.activeLayer
    if (!doc || !layer) return
    const opts = getOptions('clone-stamp')

    if (p.alt) {
      // ---- set clone source ----
      const src = resolveSourceCanvas(layer.id)
      if (!src) return
      engine.cloneSource = { x: p.docX, y: p.docY, layerId: layer.id }
      st.source = src
      st.ref = null // next stroke re-establishes the offset anchor
      engine.ui?.toast('Clone source set', 'info')
      engine.requestRender()
      return
    }

    if (!engine.cloneSource || !st.source) {
      engine.ui?.toast('Alt+click to set a clone source first', 'info')
      return
    }

    engine.beginStroke(layer.id, { opacity: opts.opacity ?? 100, blendMode: opts.blendMode ?? 'normal' })
    st.active = true
    st.last = { x: p.docX, y: p.docY }
    // aligned: keep the persistent anchor (set once after the source is chosen);
    // non-aligned: source resets to the clone source at each stroke start
    if (opts.aligned === false || !st.ref) st.ref = { x: p.docX, y: p.docY }
    dab(p.docX, p.docY, p)
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
    st.active = false
    st.last = null
    engine.endStroke('Clone Stamp')
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    const opts = getOptions('clone-stamp')
    const size = opts.size ?? 60
    const src = engine.cloneSource

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
        const r = Math.max(2, (size / 2) * view.zoom)
        ctx.save()
        ctx.setLineDash([4, 3])
        ctx.strokeStyle = 'rgba(78,201,176,0.9)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(gx, gy, r, 0, Math.PI * 2)
        ctx.stroke()
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
    if (st.active) drawBrushCursor(ctx, mouse, size, view.zoom)
    else if (engine.cloneSource && st.source) drawBrushCursor(ctx, mouse, size, view.zoom)
    else drawCross(ctx, mouse)
  },
}

function dab(x: number, y: number, p: PointerInfo) {
  const doc = engine.activeDoc
  if (!doc || !st.source || !st.ref) return
  const opts = getOptions('clone-stamp')
  const settings = brushSettingsFrom(opts)
  const r = settings.size / 2
  const rot = ((opts.rotate ?? 0) * Math.PI) / 180
  const mirrored = opts.mirrored === true
  const scale = Math.max(.25, Math.min(4, (Number(opts.scale) || 100) / 100))
  const src = engine.cloneSource
  if (!src) return

  const sp = sourcePointFor(x, y, st.ref.x, st.ref.y, src.x, src.y, rot, mirrored, scale)
  const dabCanvas = buildSourceDab(st.source, sp.x, sp.y, r, settings.hardness, rot, mirrored, scale)
  if (!dabCanvas) return
  const flow = pressureFlow(p.pressure, p.pointerType === 'pen', settings.flow / 100)
  engine.dab(x, y, (ctx, dx, dy) => {
    ctx.drawImage(dabCanvas, dx - dabCanvas.width / 2, dy - dabCanvas.height / 2)
  }, flow)
}
