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
import { perceptualWandMask } from '../image-ops/wand'
import { ditherGradient } from './dab-utils'
import { getFlatComposite } from '../engine/document'
import { BLEND_GCO } from '../constants/tools'
import { paintBuiltinPattern } from './patterns'

// ============================================================
// Gradient
// ============================================================
let drag = newDrag()
let gradLine: { x0: number; y0: number; x1: number; y1: number } | null = null
let gradPreview: HTMLCanvasElement | null = null

function colorWithOpacity(color: string, opacity: number, transparency: boolean): string {
  let h = String(color || '#000000').replace('#', '').trim()
  if (h.length === 3) h = h.split('').map(ch => ch + ch).join('')
  h = (h.slice(0, 6) || '000000').padEnd(6, '0')
  if (!transparency) return `#${h}`
  const a = clamp(Math.round(clamp(opacity, 0, 100) * 2.55), 0, 255)
  return `#${h}${a.toString(16).padStart(2, '0')}`
}

interface GradientStopRGBA {
  p: number
  r: number
  g: number
  b: number
  a: number
  h: number
  s: number
  l: number
}

function rgbToHslLocal(r: number, g: number, b: number): [number, number, number] {
  let rr = r / 255, gg = g / 255, bb = b / 255
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  const d = max - min
  if (d < 1e-9) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rr) h = 60 * (((gg - bb) / d) % 6)
  else if (max === gg) h = 60 * (((bb - rr) / d) + 2)
  else h = 60 * (((rr - gg) / d) + 4)
  if (h < 0) h += 360
  return [h, s, l]
}

function hslToRgbLocal(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rr = 0, gg = 0, bb = 0
  if (h < 60) [rr, gg] = [c, x]
  else if (h < 120) [rr, gg] = [x, c]
  else if (h < 180) [gg, bb] = [c, x]
  else if (h < 240) [gg, bb] = [x, c]
  else if (h < 300) [rr, bb] = [x, c]
  else [rr, bb] = [c, x]
  return [(rr + m) * 255, (gg + m) * 255, (bb + m) * 255]
}

function parsedStops(stops: [number, string][]): GradientStopRGBA[] {
  return stops.map(([p, color]) => {
    const mm = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color)
    const hex = mm?.[1] ?? '000000'
    const ah = mm?.[2] ?? 'ff'
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const [h, s, l] = rgbToHslLocal(r, g, b)
    return { p, r, g, b, a: parseInt(ah, 16), h, s, l }
  }).sort((a, b) => a.p - b.p)
}

function interpolateGradientStop(stops: GradientStopRGBA[], t: number, hsl: boolean): [number, number, number, number] {
  t = clamp(t, 0, 1)
  let a = stops[0], b = stops[stops.length - 1]
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k].p) { a = stops[k - 1]; b = stops[k]; break }
  }
  const q = b.p === a.p ? 0 : clamp((t - a.p) / (b.p - a.p), 0, 1)
  if (!hsl) {
    return [
      a.r + (b.r - a.r) * q,
      a.g + (b.g - a.g) * q,
      a.b + (b.b - a.b) * q,
      a.a + (b.a - a.a) * q,
    ]
  }
  const dh = ((b.h - a.h + 540) % 360) - 180
  const hh = a.h + dh * q
  const ss = a.s + (b.s - a.s) * q
  const ll = a.l + (b.l - a.l) * q
  const [r, g, bl] = hslToRgbLocal(hh, ss, ll)
  return [r, g, bl, a.a + (b.a - a.a) * q]
}

function paintManualGradient(
  c: CanvasRenderingContext2D,
  w: number, h: number,
  x0: number, y0: number, x1: number, y1: number,
  mode: string,
  stops: [number, string][],
  hsl: boolean,
) {
  const parsed = parsedStops(stops)
  const dx = x1 - x0, dy = y1 - y0
  const dist = Math.max(1, Math.hypot(dx, dy))
  const dist2 = Math.max(1, dx * dx + dy * dy)
  const ca = dx / dist, sa = dy / dist
  const baseAngle = Math.atan2(dy, dx)
  const img = c.createImageData(w, h)
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const rx = xx - x0, ry = yy - y0
      let t: number
      if (mode === 'radial') t = Math.hypot(rx, ry) / dist
      else if (mode === 'angle') {
        const a = Math.atan2(ry, rx)
        t = ((a - baseAngle) / (Math.PI * 2) + 1) % 1
      } else if (mode === 'reflected') {
        t = Math.abs((rx * dx + ry * dy) / dist2)
      } else if (mode === 'diamond') {
        const u = (rx * ca + ry * sa) / dist
        const v = (-rx * sa + ry * ca) / dist
        t = Math.abs(u) + Math.abs(v)
      } else {
        t = (rx * dx + ry * dy) / dist2
      }
      const [r, g, b, a] = interpolateGradientStop(parsed, t, hsl)
      const j = (yy * w + xx) * 4
      img.data[j] = r
      img.data[j + 1] = g
      img.data[j + 2] = b
      img.data[j + 3] = a
    }
  }
  c.putImageData(img, 0, 0)
}

function buildStops(type: string, reverse: boolean, transparency = true, opts?: Record<string, any>): [number, string][] {
  const fg = getFgColor(), bg = getBgColor()
  let stops: [number, string][]
  if (type === 'fg-transparent') stops = [[0, fg], [1, transparency ? `${fg.slice(0, 7)}00` : fg]]
  else if (type === 'bw') stops = [[0, '#000000'], [1, '#ffffff']]
  else if (type === 'spectrum') stops = [[0, '#ff0000'], [0.17, '#ffff00'], [0.33, '#00ff00'], [0.5, '#00ffff'], [0.67, '#0000ff'], [0.83, '#ff00ff'], [1, '#ff0000']]
  else if (type === 'custom') {
    const mid = clamp((Number(opts?.customMidpoint) || 50) / 100, .01, .99)
    stops = [
      [0, colorWithOpacity(String(opts?.customStart || '#000000'), Number(opts?.customStartOpacity ?? 100), transparency)],
      [mid, colorWithOpacity(String(opts?.customMid || '#808080'), Number(opts?.customMidOpacity ?? 100), transparency)],
      [1, colorWithOpacity(String(opts?.customEnd || '#ffffff'), Number(opts?.customEndOpacity ?? 100), transparency)],
    ]
  } else stops = [[0, fg], [1, bg]]
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
  const stops = buildStops(opts.type ?? 'fg-bg', opts.reverse === true, opts.transparency !== false, opts)
  const angle = Math.atan2(y1 - y0, x1 - x0)
  if (opts.interpolation === 'hsl') {
    paintManualGradient(c, w, h, x0, y0, x1, y1, mode, stops, true)
    return
  }
  let grad: CanvasGradient
  if (mode === 'diamond') {
    const dist = Math.max(1, Math.hypot(x1 - x0, y1 - y0))
    const ca = (x1 - x0) / dist, sa = (y1 - y0) / dist
    const parsed = stops.map(([p, color]) => {
      const mm = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color)
      const hex = mm?.[1] ?? '000000', ah = mm?.[2] ?? 'ff'
      return { p, r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: parseInt(ah, 16) }
    }).sort((a, b) => a.p - b.p)
    const img = c.createImageData(w, h)
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const rx = xx - x0, ry = yy - y0
      const u = (rx * ca + ry * sa) / dist
      const v = (-rx * sa + ry * ca) / dist
      const t = clamp(Math.abs(u) + Math.abs(v), 0, 1)
      let a = parsed[0], b = parsed[parsed.length - 1]
      for (let k = 1; k < parsed.length; k++) if (t <= parsed[k].p) { a = parsed[k - 1]; b = parsed[k]; break }
      const q = b.p === a.p ? 0 : clamp((t - a.p) / (b.p - a.p), 0, 1)
      const j = (yy * w + xx) * 4
      img.data[j] = a.r + (b.r - a.r) * q
      img.data[j + 1] = a.g + (b.g - a.g) * q
      img.data[j + 2] = a.b + (b.b - a.b) * q
      img.data[j + 3] = a.a + (b.a - a.a) * q
    }
    c.putImageData(img, 0, 0)
    return
  } else if (mode === 'radial') {
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
    try { c.globalCompositeOperation = BLEND_GCO[opts.blendMode] || 'source-over' } catch { /* noop */ }
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

function paintBucketPattern(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: Record<string, any>,
  swapColors: boolean,
) {
  paintBuiltinPattern(ctx, w, h, {
    kind: String(opts.pattern ?? 'checker'),
    scale: clamp((Number(opts.patternScale) || 100) / 100, .25, 4),
    offsetX: Number(opts.patternOffsetX) || 0,
    offsetY: Number(opts.patternOffsetY) || 0,
    fg: swapColors ? getBgColor() : getFgColor(),
    bg: swapColors ? getFgColor() : getBgColor(),
  })
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

    let fillMask = opts.perceptual !== false
      ? perceptualWandMask(img, cx, cy, {
          tolerance: opts.tolerance ?? 32,
          contiguous: opts.contiguous !== false,
          diagonal: opts.diagonal === true,
          antiAlias: opts.antiAlias !== false,
          sampleRadius: 1,
          edgeAware: 20,
          adaptive: true,
        })
      : floodFillMask(img, cx, cy, {
          // Legacy raw RGB matcher retained for pixel-art / exact workflows.
          tolerance: Math.round((opts.tolerance ?? 32) * 2.55),
          contiguous: opts.contiguous !== false,
        })
    const has = fillMask.some(v => v > 0)
    if (!has) return

    // Optional post-smoothing is intentionally separate from anti-aliasing:
    // AA softens only the boundary; Smooth removes tiny one-pixel stair steps.
    const smooth = Math.max(0, Number(opts.smooth) || 0)
    if (smooth > 0 || (opts.perceptual === false && opts.antiAlias !== false)) {
      const f = new Float32Array(fillMask.length)
      for (let i = 0; i < fillMask.length; i++) f[i] = fillMask[i]
      const soft = gaussianBlurChannel(f, doc.width, doc.height, smooth > 0 ? Math.max(.6, smooth * .65) : .6)
      fillMask = new Uint8ClampedArray(soft)
    }

    const l = engine.mutateLayerPixels(layer.id)
    if (!l?.canvas) return

    // Build the fill content independently from the region mask. Pattern mode
    // uses foreground/background swatches and keeps scale/offset in document
    // space so repeated fills line up consistently.
    const tmp = createCanvas(doc.width, doc.height)
    const tc = ctx2d(tmp)
    if (opts.fill === 'pattern') {
      paintBucketPattern(tc, doc.width, doc.height, opts, p.alt)
      const maskCanvas = createCanvas(doc.width, doc.height)
      const maskData = new ImageData(doc.width, doc.height)
      for (let i = 0; i < fillMask.length; i++) maskData.data[i * 4 + 3] = Math.min(255, fillMask[i])
      putImageData(maskCanvas, maskData)
      tc.globalCompositeOperation = 'destination-in'
      tc.drawImage(maskCanvas, 0, 0)
      tc.globalCompositeOperation = 'source-over'
    } else {
      const fillColor = p.alt || opts.fill === 'background' ? getBgColor() : getFgColor()
      const [r, g, b] = hexToRgb(fillColor)
      const id = new ImageData(doc.width, doc.height)
      for (let i = 0; i < fillMask.length; i++) {
        const a = fillMask[i]
        if (a <= 0) continue
        id.data[i * 4] = r; id.data[i * 4 + 1] = g; id.data[i * 4 + 2] = b
        id.data[i * 4 + 3] = a > 255 ? 255 : a
      }
      putImageData(tmp, id)
    }
    // respect the selection mask
    if (doc.selection) {
      tc.globalCompositeOperation = 'destination-in'
      tc.drawImage(doc.selection.mask, 0, 0)
      tc.globalCompositeOperation = 'source-over'
    }
    const c = ctx2d(l.canvas)
    c.save()
    c.globalAlpha = (opts.opacity ?? 100) / 100
    try { c.globalCompositeOperation = BLEND_GCO[opts.blendMode] || 'source-over' } catch { /* noop */ }
    // tmp is doc-space — align to the layer's offset registration
    c.drawImage(tmp, -(l.offsetX ?? 0), -(l.offsetY ?? 0))
    c.restore()
    engine.pushHistory(opts.fill === 'pattern' ? 'Pattern Fill' : 'Paint Bucket')
    engine.emit()
  },

  renderOverlay(ctx, view, w, h, mouse) { void view; void w; void h; drawCross(ctx, mouse) },
}
