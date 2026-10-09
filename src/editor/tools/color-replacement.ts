// ============================================================
// Color Replacement Tool — Photoshop-style sampled-color painting.
//
// Replaces hue/saturation with the foreground swatch while preserving the
// target pixel's brightness. Sampling and Limits mirror Background Eraser so
// users get familiar Continuous / Once / Background Swatch behavior.
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import type { DeferredRegionStroke } from './shared'
import {
  getOptions, getBgColor, getFgColor, canUseByteRetouch, beginDeferredRegionStroke, deferredRegionProcess, deferredStrokePixel, walkDabs, drawBrushCursor,
} from './shared'
import { clamp, hexToRgb, rgbToHsv, hsvToRgb } from '../utils/canvas'
import { rgbToLab } from '../image-ops/color'

type RGB = [number, number, number]

let active = false
let layerId: string | null = null
let stroke: DeferredRegionStroke | null = null
let last: { x: number; y: number } | null = null
let lockedSample: RGB | null = null
let changed = false


function sampleForDab(id: string, x: number, y: number): RGB | null {
  void id
  const opts = getOptions('color-replacement')
  if (opts.sampling === 'background') return hexToRgb(getBgColor())
  if (opts.sampling === 'once') {
    if (!lockedSample) lockedSample = stroke ? deferredStrokePixel(stroke, x, y) : null
    return lockedSample
  }
  return stroke ? deferredStrokePixel(stroke, x, y) : null ?? lockedSample
}

function colorDistance(r: number, g: number, b: number, ref: RGB, perceptual: boolean): number {
  if (perceptual) {
    const a = [0, 0, 0], bb = [0, 0, 0]
    rgbToLab(r, g, b, a)
    rgbToLab(ref[0], ref[1], ref[2], bb)
    const dL = a[0] - bb[0], da = a[1] - bb[1], db = a[2] - bb[2]
    // Delta-E-ish 0..100 control space.
    return Math.min(100, Math.sqrt(dL * dL + da * da + db * db))
  }
  const dr = r - ref[0], dg = g - ref[1], db = b - ref[2]
  return Math.sqrt(dr * dr * .2126 + dg * dg * .7152 + db * db * .0722) / 2.55
}

function edgeStrength(d: Uint8ClampedArray, rw: number, rh: number, x: number, y: number): number {
  const i = (y * rw + x) * 4
  const l0 = d[i] * .2126 + d[i + 1] * .7152 + d[i + 2] * .0722
  let best = 0
  for (const [ox, oy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
    const xx = x + ox, yy = y + oy
    if (xx < 0 || yy < 0 || xx >= rw || yy >= rh) continue
    const j = (yy * rw + xx) * 4
    const l = d[j] * .2126 + d[j + 1] * .7152 + d[j + 2] * .0722
    best = Math.max(best, Math.abs(l - l0) / 2.55)
  }
  return best
}

function contiguousComponent(match: Uint8Array, rw: number, rh: number, falloff: Float32Array): Uint8Array {
  const out = new Uint8Array(match.length)
  let seed = Math.floor(rh / 2) * rw + Math.floor(rw / 2)
  if (!match[seed]) {
    let best = -1, bestF = -1
    for (let i = 0; i < match.length; i++) {
      if (match[i] && falloff[i] > bestF) { best = i; bestF = falloff[i] }
    }
    if (best < 0) return out
    seed = best
  }
  const q = new Int32Array(match.length)
  let head = 0, tail = 0
  q[tail++] = seed
  out[seed] = 1
  while (head < tail) {
    const i = q[head++]
    const x = i % rw, y = Math.floor(i / rw)
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x + 1 < rw ? i + 1 : -1,
      y > 0 ? i - rw : -1,
      y + 1 < rh ? i + rw : -1,
    ]
    for (const n of neighbors) {
      if (n >= 0 && match[n] && !out[n]) { out[n] = 1; q[tail++] = n }
    }
  }
  return out
}

function dab(x: number, y: number, p: PointerInfo) {
  if (!active || !layerId || !stroke) return
  const opts = getOptions('color-replacement')
  let size = Math.max(2, Number(opts.size) || 50)
  if (p.pointerType === 'pen' && opts.pressureSize === true) {
    size *= .25 + .75 * clamp(p.pressure, 0, 1)
  }
  const sample = sampleForDab(layerId, x, y)
  if (!sample) return
  if (!lockedSample) lockedSample = sample

  const [fr, fg, fb] = hexToRgb(getFgColor())
  const [fh, fs, fv] = rgbToHsv(fr, fg, fb)
  const mode = String(opts.mode ?? 'color')
  const perceptual = opts.perceptual !== false
  const tolerance = clamp(Number(opts.tolerance) || 0, 0, 100)
  const opacity = clamp((Number(opts.opacity) || 100) / 100, 0, 1)
  const limits = String(opts.limits ?? 'find-edges')
  const radius = size / 2

  const didChange = deferredRegionProcess(stroke, x, y, radius, (region, falloff, rw, rh) => {
    const d = region.data
    const match = new Uint8Array(rw * rh)
    for (let py = 0; py < rh; py++) {
      for (let px = 0; px < rw; px++) {
        const i = py * rw + px, j = i * 4
        if (!d[j + 3] || falloff[i] <= 0) continue
        let threshold = tolerance
        if (limits === 'find-edges') {
          const edge = edgeStrength(d, rw, rh, px, py)
          threshold *= 1 - Math.min(.6, edge / 100 * .6)
        }
        if (colorDistance(d[j], d[j + 1], d[j + 2], sample, perceptual) <= threshold) match[i] = 1
      }
    }
    const allowed = limits === 'contiguous' ? contiguousComponent(match, rw, rh, falloff) : match
    for (let i = 0; i < allowed.length; i++) {
      if (!allowed[i]) continue
      const j = i * 4
      const [oh, os, ov] = rgbToHsv(d[j], d[j + 1], d[j + 2])
      let nh = oh, ns = os, nv = ov
      if (mode === 'hue') nh = fh
      else if (mode === 'saturation') ns = fs
      else if (mode === 'luminosity') nv = fv
      else { nh = fh; ns = fs } // Color mode preserves original brightness.
      const [rr, gg, bb] = hsvToRgb(nh, ns, nv)
      const a = falloff[i] * opacity
      if (a <= .001) continue
      d[j] = d[j] * (1 - a) + rr * a
      d[j + 1] = d[j + 1] * (1 - a) + gg * a
      d[j + 2] = d[j + 2] * (1 - a) + bb * a
    }
  }, Number(opts.hardness) || 0)
  if (didChange) changed = true
  engine.requestRender()
}

function finish() {
  if (!active) return
  active = false
  last = null
  lockedSample = null
  layerId = null
  stroke = null
  if (changed) {
    changed = false
    engine.pushHistory('Color Replacement')
    engine.emit()
  } else engine.requestRender()
}

export const colorReplacementTool: Tool = {
  id: 'color-replacement',
  requiresLayer: true,
  cursor: 'none',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const layer = engine.activeLayer
    if (!layer || layer.locked || layer.kind === 'adjustment' || !canUseByteRetouch('Color Replacement')) return
    const nextStroke = beginDeferredRegionStroke(layer.id)
    if (!nextStroke) return
    active = true
    changed = false
    stroke = nextStroke
    layerId = layer.id
    last = { x: p.docX, y: p.docY }
    lockedSample = null
    dab(p.docX, p.docY, p)
  },

  onPointerMove(p: PointerInfo) {
    if (!active || !last) return
    const opts = getOptions('color-replacement')
    let size = Math.max(2, Number(opts.size) || 50)
    if (p.pointerType === 'pen' && opts.pressureSize === true) size *= .25 + .75 * clamp(p.pressure, 0, 1)
    const spacing = Math.max(1, size * clamp((Number(opts.spacing) || 15) / 100, .01, 2))
    for (const q of walkDabs(last.x, last.y, p.docX, p.docY, spacing)) dab(q.x, q.y, p)
    if (Math.hypot(p.docX - last.x, p.docY - last.y) >= spacing) last = { x: p.docX, y: p.docY }
  },

  onPointerUp() { finish() },
  onDeactivate() { finish() },

  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    drawBrushCursor(ctx, mouse, Number(getOptions('color-replacement').size) || 50, view.zoom)
  },
}
