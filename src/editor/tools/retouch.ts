// ============================================================
// Blur / Sharpen / Smudge / Dodge / Burn / Sponge (Task 2-b upgrade)
//  · Blur: proper separable sliding-window box blur with strength falloff
//    (O(n) per dab — subsumes the stride-sampling optimization for radius > 8)
//  · Sharpen: unsharp-mask (blur copy, then add (v - blur) * amount)
//  · Smudge: multi-tap smear along the drag vector (a tap every ~2px, alpha
//    ramps with strength) — feels like PS
//  · Dodge/Burn: proper range weighting (shadows smoothstep 0-85, midtones
//    85-170 bell, highlights 170-255 ramp) applied per-channel
//  · Sponge: HSV saturation scaling with flow falloff
//  · All: single engine.mutateLayerPixels per stroke, history on pointerup
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, getFgColor, regionProcess, drawBrushCursor, walkDabs } from './shared'
import { smoothstep } from './dab-utils'
import { createCanvas, ctx2d, clamp, rgbToHsv, hsvToRgb, cloneCanvas, getImageData, putImageData } from '../utils/canvas'
import { getFlatComposite, newLayer, invalidateFlat } from '../engine/document'
import { getTip, tipExtentMul, drawTipCursor } from './brush-tips'

type RetouchId = 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge'
type RetouchOp = (x: number, y: number, p: PointerInfo) => void

interface RetouchContext {
  targetId: string
  sourceLayerId: string
  source: HTMLCanvasElement | null
  outputNew: boolean
}
let retouchContext: RetouchContext | null = null

interface RetouchTipMask {
  canvas: HTMLCanvasElement
  data: Uint8ClampedArray
  side: number
  center: number
  extent: number
}

const retouchTipMasks = new Map<string, RetouchTipMask>()
const MAX_RETOUCH_TIP_MASKS = 48
const RETOUCH_RAD = Math.PI / 180

function retouchTipAngle(opts: Record<string, any>, p?: PointerInfo | null): number {
  const base = Number(opts.angle) || 0
  if (p?.pointerType === 'pen') {
    if (opts.twistAngle === true && Math.abs(p.twist) > .01) return base + p.twist
    if (opts.tiltAngle === true && Math.hypot(p.tiltX, p.tiltY) > 1) {
      return base + Math.atan2(p.tiltY, p.tiltX) / RETOUCH_RAD
    }
  }
  return base
}

function retouchTipRoundness(opts: Record<string, any>, p?: PointerInfo | null): number {
  let roundness = clamp(Number(opts.roundness ?? 100), 10, 100)
  if (p?.pointerType === 'pen' && opts.tiltRoundness === true) {
    const tilt = clamp(Math.hypot(p.tiltX, p.tiltY) / 90, 0, 1)
    roundness = clamp(roundness * (1 - tilt * .72), 10, 100)
  }
  return roundness
}

function retouchTipSize(opts: Record<string, any>, p?: PointerInfo | null): number {
  let size = Math.max(2, Number(opts.size) || 60)
  if (p?.pointerType === 'pen' && opts.pressureSize === true) {
    size *= .25 + .75 * clamp(p.pressure, 0, 1)
  }
  return size
}

function retouchTipMask(opts: Record<string, any>, p?: PointerInfo | null): RetouchTipMask {
  const tipId = typeof opts.tip === 'string' && getTip(opts.tip) ? opts.tip : 'round-soft'
  const size = retouchTipSize(opts, p)
  const hardness = clamp(Number(opts.hardness ?? 60), 0, 100)
  const angle = retouchTipAngle(opts, p)
  const roundness = retouchTipRoundness(opts, p)
  const extent = tipExtentMul(tipId)
  const key = [
    tipId,
    Math.round(size * 2) / 2,
    Math.round(hardness),
    Math.round(angle * 2) / 2,
    Math.round(roundness),
  ].join(':')
  const hit = retouchTipMasks.get(key)
  if (hit) return hit

  const side = Math.max(8, Math.ceil(size * extent + 8))
  const canvas = createCanvas(side, side)
  const cc = ctx2d(canvas)
  const center = side / 2
  const tip = getTip(tipId) ?? getTip('round-soft')!
  // Fixed pseudo-random stream keeps textured retouch tips stable instead of
  // changing their footprint every time the same dab is recomputed.
  let seed = 0x9e3779b9
  const rand = () => {
    seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b)
    seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b)
    seed ^= seed >>> 16
    return (seed >>> 0) / 4294967296
  }
  tip.drawDab(cc, center, center, {
    size,
    hardness,
    angle,
    roundness,
    color: '#ffffff',
    rand,
  })
  const rgba = cc.getImageData(0, 0, side, side).data
  const data = new Uint8ClampedArray(side * side)
  for (let i = 0, j = 3; i < data.length; i++, j += 4) data[i] = rgba[j]
  const item = { canvas, data, side, center, extent }
  if (retouchTipMasks.size >= MAX_RETOUCH_TIP_MASKS) {
    const oldest = retouchTipMasks.keys().next().value
    if (oldest !== undefined) retouchTipMasks.delete(oldest)
  }
  retouchTipMasks.set(key, item)
  return item
}

function retouchBrushShape(opts: Record<string, any>, p?: PointerInfo | null) {
  const mask = retouchTipMask(opts, p)
  return {
    radius: retouchTipSize(opts, p) / 2,
    extent: mask.extent,
    alpha(dx: number, dy: number) {
      const x = Math.round(mask.center + dx)
      const y = Math.round(mask.center + dy)
      if (x < 0 || y < 0 || x >= mask.side || y >= mask.side) return 0
      return mask.data[y * mask.side + x] / 255
    },
    mask,
  }
}

function supportsNewLayerOutput(id: RetouchId): boolean {
  return id === 'blur' || id === 'sharpen' || id === 'smudge'
}

function makeRetouch(
  id: RetouchId, op: RetouchOp,
  onStart?: () => void, onEnd?: () => void
): Tool {
  // per-tool stroke state (closure — no cross-tool leakage)
  let active = false
  let last: { x: number; y: number } | null = null
  let airPos: { x: number; y: number } | null = null
  let airPointer: PointerInfo | null = null
  let airTimer: ReturnType<typeof setInterval> | null = null
  let mutated = false

  const stopAirbrush = () => {
    if (airTimer) clearInterval(airTimer)
    airTimer = null
    airPos = null
    airPointer = null
  }

  const startAirbrush = () => {
    const opts = getOptions(id)
    if (!(id === 'dodge' || id === 'burn' || id === 'sponge') || opts.airbrush !== true) return
    stopAirbrush()
    airTimer = setInterval(() => {
      if (!active || !airPos || !airPointer) return
      op(airPos.x, airPos.y, airPointer)
      const doc = engine.activeDoc
      if (doc) invalidateFlat(doc)
      engine.requestRender()
    }, 75)
  }
  const tool: Tool = {
    id,
    requiresLayer: true,
    onPointerDown(p: PointerInfo) {
      if (p.button !== 0) return
      const doc = engine.activeDoc
      const layer = engine.activeLayer
      if (!doc || !layer || layer.locked || layer.kind === 'adjustment') return
      const opts = getOptions(id)
      if (supportsNewLayerOutput(id) && opts.output === 'new') {
        const src0 = opts.sampleAllLayers === true ? getFlatComposite(doc) : engine.layerCanvasDocSpace(layer.id)
        if (!src0) return
        const out = newLayer('raster', `${id[0].toUpperCase()}${id.slice(1)} Retouch`, doc.width, doc.height)
        doc.layers.push(out)
        doc.activeLayerId = out.id
        doc.selectedLayerIds = [out.id]
        retouchContext = {
          targetId: out.id,
          sourceLayerId: layer.id,
          source: cloneCanvas(src0),
          outputNew: true,
        }
        invalidateFlat(doc)
      } else {
        const l = engine.mutateLayerPixels(layer.id)
        if (!l?.canvas) return
        retouchContext = { targetId: l.id, sourceLayerId: l.id, source: null, outputNew: false }
      }
      mutated = true
      active = true
      last = { x: p.docX, y: p.docY }
      airPos = { x: p.docX, y: p.docY }
      airPointer = p
      onStart?.()
      op(p.docX, p.docY, p)
      startAirbrush()
      invalidateFlat(doc)
      engine.requestRender()
    },
    onPointerMove(p: PointerInfo) {
      if (!active || !last) return
      const opts = getOptions(id)
      airPos = { x: p.docX, y: p.docY }
      airPointer = p
      const spacing = Math.max(2, (opts.size ?? 60) / 6)
      const dabs = walkDabs(last.x, last.y, p.docX, p.docY, spacing)
      if (!dabs.length) return
      for (const d of dabs) op(d.x, d.y, p)
      if (Math.hypot(p.docX - last.x, p.docY - last.y) >= spacing) last = { x: p.docX, y: p.docY }
      const doc = engine.activeDoc
      if (doc) invalidateFlat(doc)
      engine.requestRender()
    },
    onPointerUp() {
      if (!active) return
      active = false
      last = null
      stopAirbrush()
      onEnd?.()
      if (mutated) {
        engine.pushHistory(`${id[0].toUpperCase()}${id.slice(1)} Tool`)
        engine.emit()
        mutated = false
      }
      retouchContext = null
    },
    onDeactivate() {
      if (!active) { stopAirbrush(); retouchContext = null; return }
      active = false
      last = null
      stopAirbrush()
      onEnd?.()
      if (mutated) {
        engine.pushHistory(`${id[0].toUpperCase()}${id.slice(1)} Tool`)
        engine.emit()
        mutated = false
      }
      retouchContext = null
    },
    renderOverlay() { /* brush ring lives on the cursor layer */ },
    renderCursor(ctx, view, w, h, mouse) {
      void w; void h
      const opts = getOptions(id)
      const tipId = typeof opts.tip === 'string' && getTip(opts.tip) ? opts.tip : 'round-soft'
      drawTipCursor(
        ctx,
        mouse,
        retouchTipSize(opts),
        view.zoom,
        tipId,
        retouchTipAngle(opts),
        retouchTipRoundness(opts),
      )
    },
  }
  return tool
}

// ---------- shared: separable box blur of a region (3 channels) ----------
function boxBlurRegion(src: Uint8ClampedArray, rw: number, rh: number, rad: number): Float32Array[] {
  const n = rw * rh
  const chans: Float32Array[] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  const tmp = new Float32Array(n)
  const norm = 1 / (rad * 2 + 1)
  for (let c = 0; c < 3; c++) {
    // horizontal pass (sliding window)
    for (let y = 0; y < rh; y++) {
      const row = y * rw
      let acc = 0
      for (let i = -rad; i <= rad; i++) acc += src[(row + clamp(i, 0, rw - 1)) * 4 + c]
      for (let x = 0; x < rw; x++) {
        tmp[row + x] = acc * norm
        acc += src[(row + clamp(x + rad + 1, 0, rw - 1)) * 4 + c] - src[(row + clamp(x - rad, 0, rw - 1)) * 4 + c]
      }
    }
    // vertical pass (sliding window)
    const out = chans[c]
    for (let x = 0; x < rw; x++) {
      let acc = 0
      for (let i = -rad; i <= rad; i++) acc += tmp[clamp(i, 0, rh - 1) * rw + x]
      for (let y = 0; y < rh; y++) {
        out[y * rw + x] = acc * norm
        acc += tmp[clamp(y + rad + 1, 0, rh - 1) * rw + x] - tmp[clamp(y - rad, 0, rh - 1) * rw + x]
      }
    }
  }
  return chans
}

function localLuma(data: Uint8ClampedArray, w: number, h: number, x: number, y: number): number {
  const xx = clamp(Math.round(x), 0, w - 1)
  const yy = clamp(Math.round(y), 0, h - 1)
  const j = (yy * w + xx) * 4
  return data[j] * .2126 + data[j + 1] * .7152 + data[j + 2] * .0722
}

function localEdgeStrength(data: Uint8ClampedArray, w: number, h: number, x: number, y: number): number {
  const gx = localLuma(data, w, h, x + 1, y) - localLuma(data, w, h, x - 1, y)
  const gy = localLuma(data, w, h, x, y + 1) - localLuma(data, w, h, x, y - 1)
  return Math.min(255, Math.hypot(gx, gy) * .5)
}

function sharpenCorrection(
  detail: number,
  edge: number,
  amount: number,
  threshold: number,
  protectDetail: boolean,
  reduceNoise: number,
): number {
  const noiseFloor = threshold + clamp(reduceNoise, 0, 100) * .32
  if (Math.abs(detail) < noiseFloor) return 0
  const edgeWeight = protectDetail ? (.45 + .55 * smoothstep(3, 42, edge)) : 1
  const haloLimit = protectDetail ? 18 + edge * .75 : 255
  return clamp(detail * amount * edgeWeight, -haloLimit, haloLimit)
}

let sampledFilterPatchScratch: HTMLCanvasElement | null = null

function sampledFilterPatchCanvas(w: number, h: number): HTMLCanvasElement {
  if (!sampledFilterPatchScratch || sampledFilterPatchScratch.width !== w || sampledFilterPatchScratch.height !== h) {
    sampledFilterPatchScratch = createCanvas(w, h)
  } else {
    ctx2d(sampledFilterPatchScratch).clearRect(0, 0, w, h)
  }
  return sampledFilterPatchScratch
}

function sampledFilterDab(kind: 'blur' | 'sharpen', x: number, y: number, p: PointerInfo): boolean {
  const state = retouchContext
  const doc = engine.activeDoc
  if (!state?.outputNew || !state.source || !doc) return false
  const target = engine.layerById(state.targetId)
  if (!target?.canvas) return false
  const opts = getOptions(kind)
  const shape = retouchBrushShape(opts, p)
  const r = shape.radius
  const processR = r * shape.extent
  const strength = ((opts.strength ?? (kind === 'blur' ? 60 : 50)) / 100)
    * (p.pointerType === 'pen' && opts.pressure !== false ? (.25 + .75 * clamp(p.pressure, 0, 1)) : 1)
  const rad = kind === 'blur' ? clamp(Math.round(r / 4), 1, 60) : clamp(Math.round(r / 10), 1, 4)
  const x0 = clamp(Math.floor(x - processR), 0, doc.width)
  const y0 = clamp(Math.floor(y - processR), 0, doc.height)
  const x1 = clamp(Math.ceil(x + processR), 0, doc.width)
  const y1 = clamp(Math.ceil(y + processR), 0, doc.height)
  const rw = x1 - x0, rh = y1 - y0
  if (rw <= 0 || rh <= 0) return true

  const sx0 = clamp(x0 - rad - 1, 0, doc.width)
  const sy0 = clamp(y0 - rad - 1, 0, doc.height)
  const sx1 = clamp(x1 + rad + 1, 0, doc.width)
  const sy1 = clamp(y1 + rad + 1, 0, doc.height)
  const sw = sx1 - sx0, sh = sy1 - sy0
  const srcImg = ctx2d(state.source).getImageData(sx0, sy0, sw, sh)
  const [br, bg, bb] = boxBlurRegion(srcImg.data, sw, sh, rad)
  const out = new ImageData(rw, rh)
  const sel = doc.selection ? ctx2d(doc.selection.mask).getImageData(x0, y0, rw, rh).data : null
  const threshold = Math.max(0, Number(opts.threshold) || 0)
  const protectDetail = opts.protectDetail !== false
  const reduceNoise = Math.max(0, Number(opts.reduceNoise) || 0)
  const amount = 0.4 + strength * 1.8

  for (let py = 0; py < rh; py++) {
    for (let px = 0; px < rw; px++) {
      const dx = x0 + px - x, dy = y0 + py - y
      let falloff = shape.alpha(dx, dy)
      const oi = py * rw + px
      if (sel) falloff *= sel[oi * 4 + 3] / 255
      const f = falloff * strength
      if (f <= .005) continue

      const sx = x0 + px - sx0, sy = y0 + py - sy0
      const si = sy * sw + sx, sj = si * 4, oj = oi * 4
      const sa = srcImg.data[sj + 3] / 255
      if (sa <= 0) continue
      const edge = kind === 'sharpen' ? localEdgeStrength(srcImg.data, sw, sh, sx, sy) : 0
      for (let ch = 0; ch < 3; ch++) {
        const base = srcImg.data[sj + ch]
        const blur = ch === 0 ? br[si] : ch === 1 ? bg[si] : bb[si]
        let value = blur
        if (kind === 'sharpen') {
          const detail = base - blur
          const correction = sharpenCorrection(detail, edge, amount, threshold, protectDetail, reduceNoise)
          value = clamp(base + correction, 0, 255)
        }
        out.data[oj + ch] = value
      }
      out.data[oj + 3] = Math.round(255 * clamp(f * sa, 0, 1))
    }
  }

  const patch = sampledFilterPatchCanvas(rw, rh)
  putImageData(patch, out)
  ctx2d(target.canvas).drawImage(patch, x0, y0)
  target._v++
  invalidateFlat(doc)
  engine.requestRender()
  return true
}

// ---------- blur ----------
function blurOp(x: number, y: number, p: PointerInfo) {
  if (sampledFilterDab('blur', x, y, p)) return
  const layer = engine.activeLayer
  if (!layer) return
  const opts = getOptions('blur')
  const shape = retouchBrushShape(opts, p)
  const r = shape.radius
  const strength = ((opts.strength ?? 60) / 100) * (p.pointerType === 'pen' && opts.pressure !== false ? (.25 + .75 * clamp(p.pressure, 0, 1)) : 1)
  const protectEdges = clamp(Number(opts.protectEdges ?? 0), 0, 100) / 100
  // kernel radius scaled to brush; big brushes sample coarser windows via the
  // sliding window (equivalent to stride sampling but exact)
  const rad = clamp(Math.round(r / 4), 1, 60)
  regionProcess(layer.id, x, y, r, (region, falloff, rw, rh) => {
    const src = new Uint8ClampedArray(region.data)
    const d = region.data
    const [br, bg, bb] = boxBlurRegion(src, rw, rh, rad)
    for (let i = 0; i < rw * rh; i++) {
      const px = i % rw, py = Math.floor(i / rw)
      const edge = protectEdges > 0 ? localEdgeStrength(src, rw, rh, px, py) / 255 : 0
      // Strong edges keep progressively more of the source. Squaring the
      // normalized edge response preserves gentle texture while protecting
      // high-contrast boundaries.
      const edgeProtect = 1 - protectEdges * edge * edge
      const f = falloff[i] * strength * edgeProtect
      if (f <= 0.01) continue
      const j = i * 4
      d[j] = src[j] * (1 - f) + br[i] * f
      d[j + 1] = src[j + 1] * (1 - f) + bg[i] * f
      d[j + 2] = src[j + 2] * (1 - f) + bb[i] * f
    }
  }, opts.hardness ?? 60, shape)
}

// ---------- sharpen (unsharp mask) ----------
function sharpenOp(x: number, y: number, p: PointerInfo) {
  if (sampledFilterDab('sharpen', x, y, p)) return
  const layer = engine.activeLayer
  if (!layer) return
  const opts = getOptions('sharpen')
  const shape = retouchBrushShape(opts, p)
  const r = shape.radius
  const strength = ((opts.strength ?? 50) / 100) * (p.pointerType === 'pen' && opts.pressure !== false ? (.25 + .75 * clamp(p.pressure, 0, 1)) : 1)
  const threshold = Math.max(0, Number(opts.threshold) || 0)
  const protectDetail = opts.protectDetail !== false
  const reduceNoise = Math.max(0, Number(opts.reduceNoise) || 0)
  const rad = clamp(Math.round(r / 10), 1, 4)
  const amount = 0.4 + strength * 1.8
  regionProcess(layer.id, x, y, r, (region, falloff, rw, rh) => {
    const src = new Uint8ClampedArray(region.data)
    const d = region.data
    const [br, bg, bb] = boxBlurRegion(src, rw, rh, rad)
    for (let i = 0; i < rw * rh; i++) {
      const f = falloff[i] * strength
      if (f <= 0.01) continue
      const j = i * 4
      const px = i % rw, py = Math.floor(i / rw)
      const edge = localEdgeStrength(src, rw, rh, px, py)
      for (let c = 0; c < 3; c++) {
        const v = src[j + c]
        const blurC = c === 0 ? br[i] : c === 1 ? bg[i] : bb[i]
        const detail = v - blurC
        const correction = sharpenCorrection(detail, edge, amount, threshold, protectDetail, reduceNoise)
        if (correction === 0) continue
        const sharp = v + correction
        d[j + c] = v * (1 - f) + clamp(sharp, 0, 255) * f
      }
    }
  }, opts.hardness ?? 60, shape)
}

// ---------- smudge (multi-tap smear along the drag vector) ----------
let smudgeScratch: HTMLCanvasElement | null = null

function getSmudgeScratch(size: number): HTMLCanvasElement {
  const s = Math.max(4, Math.ceil(size))
  if (!smudgeScratch || smudgeScratch.width !== s || smudgeScratch.height !== s) {
    smudgeScratch = createCanvas(s, s)
  } else {
    ctx2d(smudgeScratch).clearRect(0, 0, s, s)
  }
  return smudgeScratch
}

function makeSmudgeTool(): Tool {
  let prev: { x: number; y: number } | null = null
  let stroking = false
  const tool = makeRetouch(
    'smudge',
    (x, y, p) => smudgeTap(x, y, p, () => prev, np => { prev = np }),
    () => { prev = null; stroking = true },     // reset the smear tracker at stroke start
    () => { stroking = false; prev = null }     // and at stroke end (pointermove also fires on hover)
  )
  // Fine interpolation is useful for small brushes, but a fixed 2px cadence
  // turns a 300-400px Smudge into hundreds of large temporary operations.
  // Span every pointer segment with a bounded number of size-aware taps.
  const origMove = tool.onPointerMove!
  tool.onPointerMove = (p: PointerInfo) => {
    if (!stroking) return
    if (!prev) return origMove(p)
    const opts = getOptions('smudge')
    const step = clamp((Number(opts.size) || 50) * 0.05, 2, 8)
    const start = { ...prev }
    const dx = p.docX - start.x, dy = p.docY - start.y
    const dist = Math.hypot(dx, dy)
    if (dist < 0.01) return
    const n = Math.min(48, Math.max(1, Math.ceil(dist / step)))
    let px = start.x, py = start.y
    for (let i = 1; i <= n; i++) {
      const t = i / n
      const nx = start.x + dx * t, ny = start.y + dy * t
      smudgeTap(nx, ny, p, () => ({ x: px, y: py }), () => {})
      px = nx; py = ny
    }
    prev = { x: p.docX, y: p.docY }
    const doc = engine.activeDoc
    if (doc) invalidateFlat(doc)
    engine.requestRender()
  }
  return tool
}

function smudgeTap(x: number, y: number, p: PointerInfo, getPrev: () => { x: number; y: number } | null, setPrev: (v: { x: number; y: number }) => void) {
  const layer = engine.activeLayer
  const doc = engine.activeDoc
  if (!layer || !doc) return
  const l = engine.layerById(layer.id)
  if (!l?.canvas) return
  const prev = getPrev()
  if (!prev) { setPrev({ x, y }); return }
  const opts = getOptions('smudge')
  const pressure = p.pointerType === 'pen' ? clamp(p.pressure, 0, 1) : 1
  const shape = retouchBrushShape(opts, p)
  const r = shape.radius
  let strength = clamp((opts.strength ?? 60) / 100, 0.05, 0.95)
  if (p.pointerType === 'pen' && opts.pressureStrength !== false) strength *= .2 + .8 * pressure
  const ctx = ctx2d(l.canvas)
  const size = shape.mask.side
  const tmp = getSmudgeScratch(size)
  const tctx = ctx2d(tmp)
  const c = size / 2
  // doc coords → canvas space (raster layers may be offset after a move)
  const ox = l.kind === 'raster' ? (l.offsetX ?? 0) : 0
  const oy = l.kind === 'raster' ? (l.offsetY ?? 0) : 0
  const px = x - ox, py = y - oy, ppx = prev.x - ox, ppy = prev.y - oy
  // pickup: Current Layer or a snapshot of the visible composite.
  const sourceAll = opts.sampleAllLayers === true
  const source = retouchContext?.outputNew && retouchContext.source
    ? retouchContext.source
    : sourceAll ? getFlatComposite(doc) : l.canvas
  const sx = sourceAll ? prev.x : ppx
  const sy = sourceAll ? prev.y : ppy
  tctx.drawImage(source, sx - c, sy - c, size, size, 0, 0, size, size)
  if (opts.fingerPainting === true) {
    // Finger Painting introduces foreground paint into the picked-up color.
    tctx.save()
    tctx.globalAlpha = .12 + strength * .18
    tctx.globalCompositeOperation = 'source-atop'
    tctx.fillStyle = getFgColor()
    tctx.fillRect(0, 0, size, size)
    tctx.restore()
  }
  // Use the same procedural brush-tip alpha as the cursor and other
  // retouch tools, instead of forcing Smudge to a circular falloff.
  tctx.globalCompositeOperation = 'destination-in'
  tctx.drawImage(
    shape.mask.canvas,
    c - shape.mask.center,
    c - shape.mask.center,
  )
  if (doc.selection) {
    // mask is doc-space — align to canvas space at the deposit position
    tctx.drawImage(doc.selection.mask, -(px - c), -(py - c))
  }
  tctx.globalCompositeOperation = 'source-over'
  // smear: deposit at the tap position, alpha ramps with strength
  ctx.save()
  ctx.globalAlpha = strength * 0.85
  ctx.drawImage(tmp, px - c, py - c)
  ctx.restore()
}

// ---------- dodge / burn ----------
function toneWeight(v: number, range: string): number {
  if (range === 'shadows') return 1 - smoothstep(0, 85, v)
  if (range === 'highlights') return smoothstep(170, 255, v)
  // midtones: bell anchored 85..170 with smooth shoulders
  return smoothstep(40, 85, v) * (1 - smoothstep(170, 215, v))
}

function toneOp(kind: 'dodge' | 'burn', x: number, y: number, p: PointerInfo) {
  const layer = engine.activeLayer
  if (!layer) return
  const opts = getOptions(kind)
  const shape = retouchBrushShape(opts, p)
  const r = shape.radius
  const exposure = ((opts.exposure ?? 30) / 100) * (p.pointerType === 'pen' && opts.pressure !== false ? (.25 + .75 * clamp(p.pressure, 0, 1)) : 1)
  const range = opts.range ?? 'midtones'
  // Photoshop muscle memory: Alt/Option temporarily swaps Dodge ↔ Burn
  // without forcing a tool switch or changing the configured range/exposure.
  const burn = p.alt ? kind === 'dodge' : kind === 'burn'
  const protectTones = opts.protectTones !== false
  regionProcess(layer.id, x, y, r, (region, falloff, rw, rh) => {
    const d = region.data
    for (let i = 0; i < rw * rh; i++) {
      const f = falloff[i] * exposure
      if (f <= 0.01) continue
      const j = i * 4
      if (protectTones) {
        const lum = d[j] * .2126 + d[j + 1] * .7152 + d[j + 2] * .0722
        const wgt = toneWeight(lum, range)
        if (wgt <= .001) continue
        const targetLum = burn ? lum - lum * f * wgt : lum + (255 - lum) * f * wgt
        const gain = targetLum / Math.max(1, lum)
        d[j] = clamp(d[j] * gain, 0, 255); d[j + 1] = clamp(d[j + 1] * gain, 0, 255); d[j + 2] = clamp(d[j + 2] * gain, 0, 255)
      } else {
        for (let c = 0; c < 3; c++) {
          const v = d[j + c], wgt = toneWeight(v, range)
          if (wgt <= 0.001) continue
          d[j + c] = clamp(burn ? v - v * f * wgt : v + (255 - v) * f * wgt, 0, 255)
        }
      }
    }
  }, opts.hardness ?? 60, shape)
}

// ---------- sponge (HSV saturation scaling with flow falloff) ----------
function spongeOp(x: number, y: number, p: PointerInfo) {
  const layer = engine.activeLayer
  if (!layer) return
  const opts = getOptions('sponge')
  const shape = retouchBrushShape(opts, p)
  const r = shape.radius
  const flow = ((opts.flow ?? 30) / 100) * (p.pointerType === 'pen' && opts.pressure !== false ? (.25 + .75 * clamp(p.pressure, 0, 1)) : 1)
  // Alt/Option temporarily reverses Saturate/Desaturate, mirroring the
  // modifier-driven workflow of the other tonal retouch tools.
  const saturate = p.alt ? opts.mode === 'desaturate' : opts.mode !== 'desaturate'
  const vibrance = opts.vibrance === true
  const k = 1.6
  regionProcess(layer.id, x, y, r, (region, falloff, rw, rh) => {
    const d = region.data
    for (let i = 0; i < rw * rh; i++) {
      const f = falloff[i] * flow
      if (f <= 0.01) continue
      const j = i * 4
      const [hh, ss, vv] = rgbToHsv(d[j], d[j + 1], d[j + 2])
      if (ss <= 0.01) continue
      const vf = vibrance && saturate ? f * (1 - ss / 100) : f
      const s2 = clamp(saturate ? ss * (1 + k * vf) : ss * (1 - k * f), 0, 100)
      const [r2, g2, b2] = hsvToRgb(hh, s2, vv)
      d[j] = d[j] * (1 - f) + r2 * f
      d[j + 1] = d[j + 1] * (1 - f) + g2 * f
      d[j + 2] = d[j + 2] * (1 - f) + b2 * f
    }
  }, opts.hardness ?? 60, shape)
}

export const blurTool: Tool = makeRetouch('blur', blurOp)
export const sharpenTool: Tool = makeRetouch('sharpen', sharpenOp)
export const smudgeTool: Tool = makeSmudgeTool()
export const dodgeTool: Tool = makeRetouch('dodge', (x, y, p) => toneOp('dodge', x, y, p))
export const burnTool: Tool = makeRetouch('burn', (x, y, p) => toneOp('burn', x, y, p))
export const spongeTool: Tool = makeRetouch('sponge', spongeOp)
