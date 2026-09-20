// ============================================================
// History Brush — paint pixels back from an earlier history state.
//
// The source is resolved once at stroke start so painting cannot recursively
// sample the stroke being created. Current implementation intentionally
// targets raster layers: vector/text/smart layers should be rasterized before
// pixel-history restoration, matching the destructive nature of this tool.
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, walkDabs, drawBrushCursor } from './shared'
import { createCanvas, ctx2d, clamp } from '../utils/canvas'

let active = false
let last: { x: number; y: number } | null = null
let source: HTMLCanvasElement | null = null

function sourceCanvas(layerId: string): HTMLCanvasElement | null {
  const doc = engine.activeDoc
  if (!doc) return null
  const opts = getOptions('history-brush')
  const states = doc.history.states
  if (!states.length) return null
  const index = opts.source === 'original'
    ? 0
    : Math.max(0, doc.history.index - 1)
  const state = states[index]
  const layer = state?.layers.find(l => l.id === layerId)
  if (!layer?.canvas || layer.kind !== 'raster') return null

  const out = createCanvas(doc.width, doc.height)
  ctx2d(out).drawImage(layer.canvas, layer.offsetX ?? 0, layer.offsetY ?? 0)
  return out
}

function historyDab(x: number, y: number, p: PointerInfo) {
  if (!active || !source) return
  const opts = getOptions('history-brush')
  const pressure = p.pointerType === 'pen' ? clamp(p.pressure, 0, 1) : 1
  let size = Math.max(1, Number(opts.size) || 45)
  if (p.pointerType === 'pen' && opts.pressureSize === true) size *= .25 + .75 * pressure
  const r = size / 2
  let flow = clamp((Number(opts.flow) || 100) / 100, .01, 1)
  if (p.pointerType === 'pen' && opts.pressureFlow !== false) flow *= .25 + .75 * pressure
  const hardness = clamp((Number(opts.hardness) || 0) / 100, 0, .98)

  const side = Math.max(3, Math.ceil(size) + 4)
  const center = side / 2
  const patch = createCanvas(side, side)
  const pc = ctx2d(patch)
  pc.drawImage(source, x - center, y - center, side, side, 0, 0, side, side)
  pc.globalCompositeOperation = 'destination-in'
  const grad = pc.createRadialGradient(center, center, r * hardness, center, center, Math.max(r, .5))
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  pc.fillStyle = grad
  pc.beginPath()
  pc.arc(center, center, Math.max(r, .5), 0, Math.PI * 2)
  pc.fill()
  pc.globalCompositeOperation = 'source-over'

  engine.dab(
    x, y,
    (ctx, dx, dy) => ctx.drawImage(patch, dx - center, dy - center),
    flow,
    r + 3,
  )
}

function finish() {
  if (!active) return
  active = false
  last = null
  source = null
  engine.endStroke('History Brush')
}

export const historyBrushTool: Tool = {
  id: 'history-brush',
  requiresLayer: true,
  cursor: 'none',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const layer = engine.activeLayer
    if (!layer || layer.locked || layer.kind === 'adjustment') return
    if (layer.kind !== 'raster' || !layer.canvas) {
      engine.ui?.toast('History Brush paints raster layers — rasterize this layer first', 'info')
      return
    }
    const src = sourceCanvas(layer.id)
    if (!src) {
      engine.ui?.toast('No compatible raster pixels exist in the selected history source', 'error')
      return
    }
    source = src
    const opts = getOptions('history-brush')
    engine.beginStroke(layer.id, { opacity: opts.opacity ?? 100 })
    active = true
    last = { x: p.docX, y: p.docY }
    historyDab(p.docX, p.docY, p)
  },

  onPointerMove(p: PointerInfo) {
    if (!active || !last) return
    const opts = getOptions('history-brush')
    const size = Math.max(1, Number(opts.size) || 45)
    const spacing = Math.max(1, size * clamp((Number(opts.spacing) || 15) / 100, .01, 2))
    for (const q of walkDabs(last.x, last.y, p.docX, p.docY, spacing)) historyDab(q.x, q.y, p)
    if (Math.hypot(p.docX - last.x, p.docY - last.y) >= spacing) last = { x: p.docX, y: p.docY }
  },

  onPointerUp() { finish() },
  onDeactivate() { finish() },

  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    drawBrushCursor(ctx, mouse, Number(getOptions('history-brush').size) || 45, view.zoom)
  },
}
