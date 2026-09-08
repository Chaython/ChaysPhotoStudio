// ============================================================
// Gradient & Paint Bucket (Task 2-b upgrade)
//  Gradient: live drag PREVIEW (temp canvas drawn in the overlay at 0.9),
//  all 4 modes (linear / radial / angle-conic / reflected mirrored from the
//  start point), Shift constrains the axis to 45°, Bayer dither on commit,
//  selection + opacity respected.
//  Bucket: contiguous/tolerance/opacity, 'sample all layers' via flat
//  composite, foreground color, selection mask, fill mask edge softened with
//  a 1px gaussian to avoid jaggies.
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, getFgColor, getBgColor, drawCross, newDrag } from './shared'
import { createCanvas, ctx2d, getImageData, putImageData, hexToRgb, clamp } from '../utils/canvas'
import { floodFillMask, gaussianBlurChannel } from '../image-ops/core'
import { ditherGradient } from './dab-utils'
import { getFlatComposite } from '../engine/document'

// ============================================================
// Gradient
// ============================================================
let drag = newDrag()
let gradLine: { x0: number; y0: number; x1: number; y1: number } | null = null
let gradPreview: HTMLCanvasElement | null = null

function buildStops(type: string, reverse: boolean): [number, string][] {
  const fg = getFgColor(), bg = getBgColor()
  let stops: [number, string][]
  if (type === 'fg-transparent') stops = [[0, fg], [1, `${fg.slice(0, 7)}00`]]
  else if (type === 'bw') stops = [[0, '#000000'], [1, '#ffffff']]
  else if (type === 'spectrum') stops = [[0, '#ff0000'], [0.17, '#ffff00'], [0.33, '#00ff00'], [0.5, '#00ffff'], [0.67, '#0000ff'], [0.83, '#ff00ff'], [1, '#ff0000']]
  else stops = [[0, fg], [1, bg]]
  return reverse ? stops.map(([p, c]) => [1 - p, c] as [number, string]).reverse() : stops
}

/** constrain the drag end point to 45° increments around the start */
function snapLine(l: { x0: number; y0: number; x1: number; y1: number }) {
  const dx = l.x1 - l.x0, dy = l.y1 - l.y0
  const dist = Math.hypot(dx, dy)
  if (dist < 0.5) return
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  l.x1 = l.x0 + Math.cos(angle) * dist
  l.y1 = l.y0 + Math.sin(angle) * dist
}

function applyStops(grad: CanvasGradient, stops: [number, string][]) {
  for (const [pos, color] of stops) grad.addColorStop(clamp(pos, 0, 1), color)
}

/** build the gradient fill for a canvas of w×h, line coords in that canvas' space */
function paintGradient(c: CanvasRenderingContext2D, w: number, h: number, x0: number, y0: number, x1: number, y1: number, opts: Record<string, any>) {
  const mode = opts.mode ?? 'linear'
  const stops = buildStops(opts.type ?? 'fg-bg', opts.reverse === true)
  const angle = Math.atan2(y1 - y0, x1 - x0)
  let grad: CanvasGradient
  if (mode === 'radial') {
    grad = c.createRadialGradient(x0, y0, 0, x0, y0, Math.max(1, Math.hypot(x1 - x0, y1 - y0)))
    applyStops(grad, stops)
  } else if (mode === 'angle') {
    // conic sweep around the START point (PS angle gradient)
    const conic = (c as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient
    if (conic) {
      grad = conic.call(c, angle, x0, y0)
      applyStops(grad, stops)
    } else {
      // fallback: radial approximation
      grad = c.createRadialGradient(x0, y0, 0, x0, y0, Math.max(1, Math.hypot(x1 - x0, y1 - y0)))
      applyStops(grad, stops)
    }
  } else if (mode === 'reflected') {
    // mirrored around the start point: axis spans (2*x0 - x1 … x1)
    grad = c.createLinearGradient(2 * x0 - x1, 2 * y0 - y1, x1, y1)
    // each stop p also appears mirrored at (1 - p)
    for (const [pos, color] of stops) {
      grad.addColorStop(clamp(0.5 + pos / 2, 0, 1), color)
      grad.addColorStop(clamp(0.5 - pos / 2, 0, 1), color)
    }
  } else {
    grad = c.createLinearGradient(x0, y0, x1, y1)
    applyStops(grad, stops)
  }
  c.fillStyle = grad
  c.fillRect(0, 0, w, h)
}

/** rebuild the live preview canvas (capped resolution — cheap on every move) */
function rebuildPreview() {
  const doc = engine.activeDoc
  if (!doc || !gradLine || !drag.active) { gradPreview = null; return }
  const scale = Math.min(1, 900 / Math.max(doc.width, doc.height))
  const pw = Math.max(2, Math.round(doc.width * scale))
  const ph = Math.max(2, Math.round(doc.height * scale))
  if (!gradPreview || gradPreview.width !== pw || gradPreview.height !== ph) {
    gradPreview = createCanvas(pw, ph)
  }
  const opts = getOptions('gradient')
  const c = ctx2d(gradPreview)
  c.clearRect(0, 0, pw, ph)
  paintGradient(c, pw, ph, gradLine.x0 * scale, gradLine.y0 * scale, gradLine.x1 * scale, gradLine.y1 * scale, opts)
}

export const gradientTool: Tool = {
  id: 'gradient',
  requiresLayer: true,
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    drag = { startX: p.docX, startY: p.docY, lastX: p.docX, lastY: p.docY, active: true }
    gradLine = { x0: p.docX, y0: p.docY, x1: p.docX, y1: p.docY }
    rebuildPreview()
    engine.requestRender()
  },

  onPointerMove(p: PointerInfo) {
    if (!drag.active || !gradLine) return
    gradLine.x1 = p.docX
    gradLine.y1 = p.docY
    if (p.shift) snapLine(gradLine)
    rebuildPreview()
    engine.requestRender()
  },

  onPointerUp() {
    if (!drag.active || !gradLine) return
    drag.active = false
    const layer = engine.activeLayer
    const doc = engine.activeDoc
    if (!layer || !doc) { gradLine = null; gradPreview = null; engine.requestRender(); return }
    const { x0, y0, x1, y1 } = gradLine
    const dist = Math.hypot(x1 - x0, y1 - y0)
    if (dist < 2) { gradLine = null; gradPreview = null; engine.requestRender(); return }
    const opts = getOptions('gradient')

    const l = engine.mutateLayerPixels(layer.id)
    if (!l?.canvas) { gradLine = null; gradPreview = null; return }

    // paint into a temp canvas so dither + selection apply cleanly
    const tmp = createCanvas(doc.width, doc.height)
    const tc = ctx2d(tmp)
    paintGradient(tc, doc.width, doc.height, x0, y0, x1, y1, opts)
    if (opts.dither !== false) {
      const img = getImageData(tmp)
      ditherGradient(img, 2)
      putImageData(tmp, img)
    }
    if (doc.selection) {
      tc.globalCompositeOperation = 'destination-in'
      tc.drawImage(doc.selection.mask, 0, 0)
      tc.globalCompositeOperation = 'source-over'
    }
    const c = ctx2d(l.canvas)
    c.save()
    c.globalAlpha = (opts.opacity ?? 100) / 100
    // tmp is doc-space — align to the layer's offset registration
    c.drawImage(tmp, -(l.offsetX ?? 0), -(l.offsetY ?? 0))
    c.restore()

    gradLine = null
    gradPreview = null
    engine.pushHistory('Gradient')
    engine.emit()
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    const doc = engine.activeDoc
    if (gradLine && drag.active) {
      // ---- live gradient preview ----
      if (gradPreview && doc) {
        ctx.save()
        ctx.globalAlpha = 0.9
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(gradPreview, view.panX, view.panY, doc.width * view.zoom, doc.height * view.zoom)
        ctx.restore()
      }
      // ---- gradient line + endpoints ----
      const x0 = gradLine.x0 * view.zoom + view.panX, y0 = gradLine.y0 * view.zoom + view.panY
      const x1 = gradLine.x1 * view.zoom + view.panX, y1 = gradLine.y1 * view.zoom + view.panY
      ctx.save()
      ctx.strokeStyle = '#e8a33d'
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 4])
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
      for (const [x, y] of [[x0, y0], [x1, y1]]) {
        ctx.setLineDash([])
        ctx.fillStyle = '#e8a33d'
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke()
      }
      ctx.restore()
    } else drawCross(ctx, mouse)
  },
}

// ============================================================
// Paint Bucket
// ============================================================
export const paintBucketTool: Tool = {
  id: 'paint-bucket',
  requiresLayer: true,
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const layer = engine.activeLayer
    const doc = engine.activeDoc
    if (!layer || !doc) return
    const opts = getOptions('paint-bucket')
    // sample in DOC space (offset raster layers get a doc-space copy)
    const src = opts.sample === 'composite' ? getFlatComposite(doc) : engine.layerCanvasDocSpace(layer.id)
    if (!src) return
    const img = getImageData(src)
    const cx = clamp(Math.round(p.docX), 0, doc.width - 1)
    const cy = clamp(Math.round(p.docY), 0, doc.height - 1)

    let fillMask = floodFillMask(img, cx, cy, { tolerance: opts.tolerance ?? 32, contiguous: opts.contiguous !== false })
    const has = fillMask.some(v => v > 0)
    if (!has) return

    // soften the fill mask edge ~1px (gaussian on the alpha) to avoid jaggies
    const f = new Float32Array(fillMask.length)
    for (let i = 0; i < fillMask.length; i++) f[i] = fillMask[i]
    const soft = gaussianBlurChannel(f, doc.width, doc.height, 0.6)
    fillMask = new Uint8ClampedArray(soft)

    const l = engine.mutateLayerPixels(layer.id)
    if (!l?.canvas) return

    // build fill layer: foreground color with the softened mask as alpha
    const [r, g, b] = hexToRgb(getFgColor())
    const id = new ImageData(doc.width, doc.height)
    for (let i = 0; i < fillMask.length; i++) {
      const a = fillMask[i]
      if (a <= 0) continue
      id.data[i * 4] = r; id.data[i * 4 + 1] = g; id.data[i * 4 + 2] = b
      id.data[i * 4 + 3] = a > 255 ? 255 : a
    }
    const tmp = createCanvas(doc.width, doc.height)
    putImageData(tmp, id)
    const tc = ctx2d(tmp)
    // respect the selection mask
    if (doc.selection) {
      tc.globalCompositeOperation = 'destination-in'
      tc.drawImage(doc.selection.mask, 0, 0)
      tc.globalCompositeOperation = 'source-over'
    }
    const c = ctx2d(l.canvas)
    c.save()
    c.globalAlpha = (opts.opacity ?? 100) / 100
    // tmp is doc-space — align to the layer's offset registration
    c.drawImage(tmp, -(l.offsetX ?? 0), -(l.offsetY ?? 0))
    c.restore()
    engine.pushHistory('Paint Bucket')
    engine.emit()
  },

  renderOverlay(ctx, view, w, h, mouse) { void view; void w; void h; drawCross(ctx, mouse) },
}
