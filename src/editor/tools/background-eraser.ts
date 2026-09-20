// ============================================================
// Background Eraser — Photoshop-style sampled-color erasing.
//
// Sampling:
//   continuous       resamples the color under the brush center per dab
//   once             locks the first sampled color for the whole stroke
//   background       uses the current background swatch
//
// Limits:
//   contiguous       erases only the matching component connected to the
//                    brush center inside each dab
//   discontiguous    erases every matching pixel inside the brush
//   find-edges       discontiguous matching with extra resistance at strong
//                    local luminance/color edges
//
// The tool edits one COW raster surface per stroke, is selection-aware via
// regionProcess(), and pushes one history state on release/deactivation.
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import {
  getOptions, getBgColor, getFgColor, regionProcess, walkDabs, drawBrushCursor,
} from './shared'
import { clamp, ctx2d, hexToRgb } from '../utils/canvas'

type RGB = [number, number, number]

let active = false
let layerId: string | null = null
let last: { x: number; y: number } | null = null
let lockedSample: RGB | null = null
let changed = false

function pixelAtDoc(id: string, x: number, y: number): RGB | null {
  const l = engine.layerById(id)
  if (!l?.canvas) return null
  const ox = l.kind === 'raster' ? (l.offsetX ?? 0) : 0
  const oy = l.kind === 'raster' ? (l.offsetY ?? 0) : 0
  const px = Math.round(x - ox), py = Math.round(y - oy)
  if (px < 0 || py < 0 || px >= l.canvas.width || py >= l.canvas.height) return null
  const d = ctx2d(l.canvas).getImageData(px, py, 1, 1).data
  if (d[3] <= 0) return null
  return [d[0], d[1], d[2]]
}

function sampleForDab(id: string, x: number, y: number): RGB | null {
  const opts = getOptions('background-eraser')
  if (opts.sampling === 'background') return hexToRgb(getBgColor())
  if (opts.sampling === 'once') {
    if (!lockedSample) lockedSample = pixelAtDoc(id, x, y)
    return lockedSample
  }
  return pixelAtDoc(id, x, y) ?? lockedSample
}

function colorDistance(r: number, g: number, b: number, ref: RGB): number {
  // Perceptual-ish weighted RGB distance normalized to roughly 0..100.
  const dr = r - ref[0], dg = g - ref[1], db = b - ref[2]
  return Math.sqrt(dr * dr * .2126 + dg * dg * .7152 + db * db * .0722) / 2.55
}

function edgeStrength(d: Uint8ClampedArray, rw: number, rh: number, x: number, y: number): number {
  const i = (y * rw + x) * 4
  const l0 = d[i] * .2126 + d[i + 1] * .7152 + d[i + 2] * .0722
  let best = 0
  const around = [[1,0],[-1,0],[0,1],[0,-1]]
  for (const [ox, oy] of around) {
    const xx = x + ox, yy = y + oy
    if (xx < 0 || yy < 0 || xx >= rw || yy >= rh) continue
    const j = (yy * rw + xx) * 4
    const l = d[j] * .2126 + d[j + 1] * .7152 + d[j + 2] * .0722
    best = Math.max(best, Math.abs(l - l0) / 2.55)
  }
  return best
}

function decontaminateFringe(
  d: Uint8ClampedArray,
  rw: number,
  rh: number,
  allowed: Uint8Array,
  falloff: Float32Array,
  sample: RGB,
  amountPct: number,
  tolerance: number,
) {
  const amount = clamp(amountPct / 100, 0, 1)
  if (amount <= 0) return
  const src = new Uint8ClampedArray(d)
  const around = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]] as const
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x
      if (!allowed[i] || falloff[i] <= 0) continue
      const j = i * 4
      const surviving = 1 - falloff[i]
      // Fully erased pixels don't need color cleanup. Concentrate on the
      // anti-aliased/fringe band that remains visible after the alpha cut.
      if (surviving <= .01) continue
      let rr = 0, gg = 0, bb = 0, n = 0
      for (const [ox, oy] of around) {
        const xx = x + ox, yy = y + oy
        if (xx < 0 || yy < 0 || xx >= rw || yy >= rh) continue
        const ni = yy * rw + xx
        if (allowed[ni]) continue
        const nj = ni * 4
        if (src[nj + 3] < 24) continue
        // Prefer neighbors that are demonstrably foreground rather than a
        // second anti-aliased sample of the background being removed.
        if (colorDistance(src[nj], src[nj + 1], src[nj + 2], sample) <= Math.max(3, tolerance * .65)) continue
        rr += src[nj]; gg += src[nj + 1]; bb += src[nj + 2]; n++
      }
      if (!n) continue
      const strength = amount * clamp(falloff[i] * 1.4, 0, 1)
      d[j] = src[j] * (1 - strength) + (rr / n) * strength
      d[j + 1] = src[j + 1] * (1 - strength) + (gg / n) * strength
      d[j + 2] = src[j + 2] * (1 - strength) + (bb / n) * strength
    }
  }
}

function contiguousComponent(match: Uint8Array, rw: number, rh: number, falloff: Float32Array): Uint8Array {
  const out = new Uint8Array(match.length)
  let sx = clamp(Math.floor(rw / 2), 0, rw - 1)
  let sy = clamp(Math.floor(rh / 2), 0, rh - 1)
  let seed = sy * rw + sx

  // Near a clipped canvas edge, the geometric center of the subregion may not
  // be the actual dab center. Prefer the strongest-falloff matching pixel.
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
    if (x > 0) {
      const n = i - 1
      if (match[n] && !out[n]) { out[n] = 1; q[tail++] = n }
    }
    if (x + 1 < rw) {
      const n = i + 1
      if (match[n] && !out[n]) { out[n] = 1; q[tail++] = n }
    }
    if (y > 0) {
      const n = i - rw
      if (match[n] && !out[n]) { out[n] = 1; q[tail++] = n }
    }
    if (y + 1 < rh) {
      const n = i + rw
      if (match[n] && !out[n]) { out[n] = 1; q[tail++] = n }
    }
  }
  return out
}

function dab(x: number, y: number, p: PointerInfo) {
  if (!active || !layerId) return
  const opts = getOptions('background-eraser')
  let size = Math.max(4, Number(opts.size) || 50)
  if (p.pointerType === 'pen' && opts.pressureSize === true) {
    size *= .25 + .75 * clamp(p.pressure, 0, 1)
  }
  const radius = size / 2
  const sample = sampleForDab(layerId, x, y)
  if (!sample) return
  if (!lockedSample) lockedSample = sample

  const tolerance = clamp(Number(opts.tolerance) || 0, 0, 100)
  const limits = String(opts.limits ?? 'find-edges')
  const protect = opts.protectForeground === true ? hexToRgb(getFgColor()) : null

  regionProcess(layerId, x, y, radius, (region, falloff, rw, rh) => {
    const d = region.data
    const match = new Uint8Array(rw * rh)
    for (let py = 0; py < rh; py++) {
      for (let px = 0; px < rw; px++) {
        const i = py * rw + px, j = i * 4
        if (d[j + 3] <= 0 || falloff[i] <= 0) continue
        let threshold = tolerance
        if (limits === 'find-edges') {
          const edge = edgeStrength(d, rw, rh, px, py)
          threshold *= 1 - Math.min(.55, edge / 100 * .55)
        }
        if (colorDistance(d[j], d[j + 1], d[j + 2], sample) > threshold) continue
        if (protect && colorDistance(d[j], d[j + 1], d[j + 2], protect) <= Math.max(4, tolerance * .35)) continue
        match[i] = 1
      }
    }

    const allowed = limits === 'contiguous' ? contiguousComponent(match, rw, rh, falloff) : match
    decontaminateFringe(
      d, rw, rh, allowed, falloff, sample,
      Number(opts.decontaminate) || 0,
      tolerance,
    )
    let localChanged = false
    for (let i = 0; i < allowed.length; i++) {
      if (!allowed[i]) continue
      const j = i * 4
      const a = d[j + 3]
      const next = Math.max(0, Math.round(a * (1 - falloff[i])))
      if (next !== a) {
        d[j + 3] = next
        localChanged = true
      }
    }
    if (localChanged) changed = true
  }, Number(opts.hardness) || 0)

  engine.requestRender()
}

function finish() {
  if (!active) return
  active = false
  last = null
  lockedSample = null
  layerId = null
  if (changed) {
    changed = false
    engine.pushHistory('Background Eraser')
    engine.emit()
  } else {
    engine.requestRender()
  }
}

export const backgroundEraserTool: Tool = {
  id: 'background-eraser',
  requiresLayer: true,
  cursor: 'none',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const layer = engine.activeLayer
    if (!layer || layer.locked || layer.kind === 'adjustment') return
    const l = engine.mutateLayerPixels(layer.id)
    if (!l?.canvas) return
    active = true
    changed = false
    layerId = l.id
    last = { x: p.docX, y: p.docY }
    lockedSample = null
    dab(p.docX, p.docY, p)
  },

  onPointerMove(p: PointerInfo) {
    if (!active || !last) return
    const opts = getOptions('background-eraser')
    let size = Math.max(4, Number(opts.size) || 50)
    if (p.pointerType === 'pen' && opts.pressureSize === true) {
      size *= .25 + .75 * clamp(p.pressure, 0, 1)
    }
    const spacing = Math.max(1, size * clamp((Number(opts.spacing) || 18) / 100, .01, 2))
    for (const q of walkDabs(last.x, last.y, p.docX, p.docY, spacing)) dab(q.x, q.y, p)
    if (Math.hypot(p.docX - last.x, p.docY - last.y) >= spacing) last = { x: p.docX, y: p.docY }
  },

  onPointerUp() { finish() },
  onDeactivate() { finish() },

  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    const opts = getOptions('background-eraser')
    drawBrushCursor(ctx, mouse, Number(opts.size) || 50, view.zoom)
    if (!mouse) return
    // Small center cross communicates the sampling hotspot.
    ctx.save()
    ctx.strokeStyle = 'rgba(232,163,61,.95)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(mouse.x - 4, mouse.y); ctx.lineTo(mouse.x + 4, mouse.y)
    ctx.moveTo(mouse.x, mouse.y - 4); ctx.lineTo(mouse.x, mouse.y + 4)
    ctx.stroke()
    ctx.restore()
  },
}
