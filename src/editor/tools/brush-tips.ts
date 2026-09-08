// ============================================================
// brush-tips.ts — Procedural brush tip library (Task 1-A)
// ============================================================
// A registry of paintable tip shapes shared by the Brush and the
// Eraser. Each tip knows how to:
//   · drawDab(ctx, x, y, params) — stamp one dab on the stroke buffer
//     (doc space). Draw at FULL alpha inside; per-dab flow/opacity is
//     applied by the engine via ctx.globalAlpha BEFORE drawDab runs,
//     so never multiply the whole dab's alpha yourself — per-element
//     variation (bristles, spray dots) uses rgba() fill styles instead.
//   · preview(size) — small cached thumbnail for the tip picker.
//   · cursorShape(params) — outline points in tip-local space (unit
//     square -1..1, x = along the tip angle) for shape-accurate
//     cursors, or null when a plain circle is right.
//
// Performance:
//   round-soft / round-hard / flat / angled / wet keep a small LRU
//   stamp cache (≤64 canvases) keyed by
//   tip|size|hardness|roundness|color — per-dab work is a single
//   drawImage (translate/rotate/drawImage for rotatable tips).
//   noise / chalk / wet reuse those stamps through a module-level
//   scratch canvas + noise PATTERN applied with a per-dab random
//   offset+rotation (destination-in multiplies alphas) so the texture
//   never visibly repeats. bristle / spray / chalk / hair draw
//   directly — their per-dab randomness (rand()) IS the look.
//
// Dependency rule: this module is imported by constants/tools.ts
// (which the store imports at module-init time), so it must stay
// dependency-free except for utils/canvas, must not touch
// document/canvas at module scope (all tiles/stamps are lazy), and
// must never import engine/store/constants.
// ============================================================
import { createCanvas, ctx2d, clamp, hexToRgb, rgbToHsv, hsvToRgb, rgbToHex } from '../utils/canvas'

const RAD = Math.PI / 180

// ============================================================
// Public types
// ============================================================

/** Parameters for one dab. `rand` is supplied per call so tips with
 *  randomness vary naturally along a stroke (and per mirrored dab). */
export interface TipDrawParams {
  /** diameter in doc px */
  size: number
  /** 0..100 */
  hardness: number
  /** degrees — rotation of the tip (direction of travel when following) */
  angle: number
  /** 0..100 (100 = circular) */
  roundness: number
  /** hex color (erasers pass '#ffffff' — the pipeline erases by alpha) */
  color: string
  /** seeded or Math.random — fresh per dab */
  rand: () => number
}

/** Cursor outline in tip-local space: unit square -1..1, x along the
 *  tip angle, y perpendicular. `angle` rotates the whole polygon. */
export interface TipCursorShape {
  pts: { x: number; y: number }[]
  angle: number
  roundness: number
}

export interface TipDef {
  id: string
  label: string
  /** true when the tip rotates per-dab (calligraphy/flat/bristle) —
   *  angle options, angle-follow and shape cursors are relevant */
  rotatable: boolean
  /** default option overrides applied when the tip is selected
   *  (the picker writes spacing / hardness / flow / roundness / angle) */
  defaults: Record<string, any>
  /** draw one dab directly on the stroke ctx (doc space) */
  drawDab(ctx: CanvasRenderingContext2D, x: number, y: number, p: TipDrawParams): void
  /** small preview canvas for the picker UI (transparent bg, cached) */
  preview(size?: number): HTMLCanvasElement
  /** cursor outline points, or null = circle */
  cursorShape?: (p: TipDrawParams) => TipCursorShape | null
}

// ============================================================
// Small helpers
// ============================================================

/** deterministic RNG (mulberry32) — used for reproducible previews */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** rgba() fill string from a hex color + alpha (element-level alpha
 *  variation only — the engine still owns the per-dab flow) */
function rgba(color: string, a: number): string {
  const [r, g, b] = hexToRgb(color)
  return `rgba(${r},${g},${b},${a})`
}

// ============================================================
// Value-noise tiles (built lazily, once per session)
// ============================================================

const TILE = 64

/** tileable value noise on a `grid`×`grid` lattice, bilinear + smoothstep */
function valueNoise(size: number, grid: number, seed: number): Float32Array {
  const rand = mulberry32(seed)
  const lat = new Float32Array(grid * grid)
  for (let i = 0; i < lat.length; i++) lat[i] = rand()
  const out = new Float32Array(size * size)
  const sm = (t: number) => t * t * (3 - 2 * t)
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * grid
    const y0 = Math.floor(fy) % grid, ty = sm(fy - Math.floor(fy))
    const y1 = (y0 + 1) % grid
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * grid
      const x0 = Math.floor(fx) % grid, tx = sm(fx - Math.floor(fx))
      const x1 = (x0 + 1) % grid
      const a = lat[y0 * grid + x0]
      const b = lat[y0 * grid + x1]
      const c = lat[y1 * grid + x0]
      const d = lat[y1 * grid + x1]
      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
    }
  }
  return out
}

/** 4-octave tileable value noise, normalized to 0..1 */
function noiseField(size: number, seed: number): Float32Array {
  const out = new Float32Array(size * size)
  let total = 0
  const octaves: Array<[grid: number, weight: number]> = [[4, 1], [8, 0.6], [16, 0.35], [32, 0.2]]
  for (const [grid, weight] of octaves) {
    const layer = valueNoise(size, grid, seed + grid * 7)
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * weight
    total += weight
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

interface NoiseTiles {
  /** grunge — strong variance, keeps decent coverage */
  noise: HTMLCanvasElement
  /** wet media — subtle 0.86..1 variance */
  gentle: HTMLCanvasElement
  /** chalk — thresholded: solid core with ragged edges + holes */
  chalk: HTMLCanvasElement
}

let tiles: NoiseTiles | null = null

function getTiles(): NoiseTiles {
  if (tiles) return tiles
  const raw = noiseField(TILE, 0x9E3779B9)
  const mk = (fn: (v: number) => number): HTMLCanvasElement => {
    const cv = createCanvas(TILE, TILE)
    const c = ctx2d(cv)
    const img = c.createImageData(TILE, TILE)
    for (let i = 0; i < TILE * TILE; i++) {
      const a = clamp(fn(raw[i]), 0, 1)
      img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255
      img.data[i * 4 + 3] = Math.round(a * 255)
    }
    c.putImageData(img, 0, 0)
    return cv
  }
  tiles = {
    noise: mk(v => 0.22 + 0.78 * v),
    gentle: mk(v => 0.86 + 0.14 * v),
    chalk: mk(v => (v > 0.46 ? 1 : v < 0.34 ? 0 : (v - 0.34) / 0.12)),
  }
  return tiles
}

// ---- scratch canvas + patterns for noise-masked dabs ----

let scratch: HTMLCanvasElement | null = null
let scratchCtx: CanvasRenderingContext2D | null = null
const patternCache = new Map<HTMLCanvasElement, CanvasPattern>()

function getPattern(tile: HTMLCanvasElement): CanvasPattern | null {
  if (!scratch) { scratch = createCanvas(64, 64); scratchCtx = ctx2d(scratch) }
  let p = patternCache.get(tile)
  if (!p) {
    p = scratchCtx!.createPattern(tile, 'repeat') ?? undefined
    if (p) patternCache.set(tile, p)
  }
  return p ?? null
}

/**
 * Draw `base` (a stamp canvas) at (x, y) sized dw×dh with a noise mask:
 * the stamp's alpha is multiplied by the noise tile, drawn at a random
 * offset + rotation (from rand) so consecutive dabs never repeat the
 * same texture. Uses a module scratch canvas (engine.dab is sync, so
 * there is no re-entrancy concern).
 */
function drawNoiseMasked(
  ctx: CanvasRenderingContext2D, x: number, y: number, dw: number, dh: number,
  base: HTMLCanvasElement, tile: HTMLCanvasElement, rand: () => number
): void {
  const w = Math.max(2, Math.ceil(dw)), h = Math.max(2, Math.ceil(dh))
  if (!scratch || !scratchCtx) { scratch = createCanvas(64, 64); scratchCtx = ctx2d(scratch) }
  const sctx = scratchCtx
  if (scratch.width < w || scratch.height < h) {
    scratch.width = Math.max(scratch.width, w)
    scratch.height = Math.max(scratch.height, h)
  }
  sctx.save()
  sctx.clearRect(0, 0, w, h)
  sctx.drawImage(base, 0, 0, w, h)
  const pat = getPattern(tile)
  if (pat) {
    // destination-in multiplies destination alpha by source alpha
    sctx.globalCompositeOperation = 'destination-in'
    sctx.translate(w / 2, h / 2)
    sctx.rotate(rand() * Math.PI * 2)
    sctx.translate(-rand() * TILE, -rand() * TILE)
    const diag = Math.hypot(w, h) / 2 + TILE
    sctx.fillStyle = pat
    sctx.fillRect(-diag, -diag, diag * 2, diag * 2)
  }
  sctx.restore()
  ctx.drawImage(scratch, 0, 0, w, h, x - dw / 2, y - dh / 2, dw, dh)
}

// ============================================================
// Stamp cache (LRU, ≤64 entries)
// ============================================================

const MAX_STAMPS = 64
const stampCache = new Map<string, HTMLCanvasElement>()

/** cached stamp: hit re-inserts (LRU bump); overflow evicts the oldest */
function getStamp(key: string, build: () => HTMLCanvasElement): HTMLCanvasElement {
  let cv = stampCache.get(key)
  if (cv) {
    stampCache.delete(key); stampCache.set(key, cv)
    return cv
  }
  cv = build()
  stampCache.set(key, cv)
  if (stampCache.size > MAX_STAMPS) {
    const oldest = stampCache.keys().next().value
    if (oldest !== undefined) stampCache.delete(oldest)
  }
  return cv
}

/** quantized cache key params (size to 1px, hardness to 2, roundness to 5) */
function stampKey(id: string, p: TipDrawParams) {
  const size = Math.max(2, Math.round(p.size))
  const hardness = clamp(Math.round(p.hardness / 2) * 2, 0, 100)
  const roundness = clamp(Math.round(p.roundness / 5) * 5, 5, 100)
  return { key: `${id}|${size}|${hardness}|${roundness}|${p.color}`, size, hardness, roundness }
}

// ============================================================
// Stamp builders
// ============================================================

/**
 * Photoshop-style soft-round transfer curve: alpha = (1 - t)^gamma
 * between the hardness core and the tip edge. gamma widens smoothly
 * as hardness drops — 0.35 (crisp, near-AA edge) … 2.7 (gaussian-ish
 * airbrush) — so mid hardness values read like Photoshop instead of a
 * plasticky linear ramp. Sampled with 5 gradient stops.
 */
function softProfileGamma(hardness: number): number {
  const h = clamp(hardness, 0, 100) / 100
  return 0.35 + 2.35 * Math.pow(1 - h, 1.25)
}

function buildSoftStamp(size: number, hardness: number, color: string): HTMLCanvasElement {
  const cv = createCanvas(size, size)
  const c = ctx2d(cv)
  const r = size / 2
  const inner = clamp(hardness / 100, 0, 0.985) * r
  const gamma = softProfileGamma(hardness)
  const grad = c.createRadialGradient(r, r, inner, r, r, r)
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    grad.addColorStop(t, rgba(color, Math.pow(1 - t, gamma)))
  }
  c.fillStyle = grad
  c.beginPath()
  c.arc(r, r, r, 0, Math.PI * 2)
  c.fill()
  return cv
}

/** crisp circle — the 0.25px inset keeps the AA edge ≤ ~1.25px */
function buildHardStamp(size: number, color: string): HTMLCanvasElement {
  const cv = createCanvas(size, size)
  const c = ctx2d(cv)
  const r = Math.max(0.5, size / 2 - 0.25)
  c.fillStyle = rgba(color, 1)
  c.beginPath()
  c.arc(size / 2, size / 2, r, 0, Math.PI * 2)
  c.fill()
  return cv
}

function roundRectPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = clamp(r, 0, Math.min(w, h) / 2)
  c.beginPath()
  c.moveTo(x + rr, y)
  c.arcTo(x + w, y, x + w, y + h, rr)
  c.arcTo(x + w, y + h, x, y + h, rr)
  c.arcTo(x, y + h, x, y, rr)
  c.arcTo(x, y, x + w, y, rr)
  c.closePath()
}

/** marker: hard rounded square (corner radius ≈ 12% of size) */
function buildFlatStamp(size: number, hardness: number, color: string): HTMLCanvasElement {
  const cv = createCanvas(size, size)
  const c = ctx2d(cv)
  withSoftEdge(c, hardness, size, () => {
    roundRectPath(c, 0.5, 0.5, size - 1, size - 1, Math.max(1, size * 0.12))
    c.fillStyle = rgba(color, 1)
    c.fill()
  })
  return cv
}

/** calligraphy nib: ellipse squashed by roundness; hardness → subtle
 *  edge blur (cached, so the filter cost is amortized) */
function buildAngledStamp(size: number, roundness: number, hardness: number, color: string): HTMLCanvasElement {
  const cv = createCanvas(size, size)
  const c = ctx2d(cv)
  const rx = Math.max(0.5, size / 2 - 0.25)
  const ry = Math.max(0.6, (size / 2) * clamp(roundness, 5, 100) / 100)
  withSoftEdge(c, hardness, size, () => {
    c.fillStyle = rgba(color, 1)
    c.beginPath()
    c.ellipse(size / 2, size / 2, rx, ry, 0, 0, Math.PI * 2)
    c.fill()
  })
  return cv
}

/** wet media: alpha dips in the middle, peaks at ~80% radius (paint
 *  pooling at the edges) — the subtle noise is applied per-dab */
function buildWetStamp(size: number, color: string): HTMLCanvasElement {
  const cv = createCanvas(size, size)
  const c = ctx2d(cv)
  const r = size / 2
  const grad = c.createRadialGradient(r, r, 0, r, r, r)
  grad.addColorStop(0, rgba(color, 0.6))
  grad.addColorStop(0.3, rgba(color, 0.48))
  grad.addColorStop(0.62, rgba(color, 0.75))
  grad.addColorStop(0.8, rgba(color, 1))
  grad.addColorStop(0.92, rgba(color, 0.75))
  grad.addColorStop(1, rgba(color, 0))
  c.fillStyle = grad
  c.beginPath()
  c.arc(r, r, r, 0, Math.PI * 2)
  c.fill()
  return cv
}

/** optional soft edge for shape stamps (hardness < 100 → small blur;
 *  silently skipped where ctx.filter is unsupported) */
function withSoftEdge(c: CanvasRenderingContext2D, hardness: number, size: number, draw: () => void) {
  const blur = (1 - clamp(hardness, 0, 100) / 100) * size * 0.08
  const canFilter = blur >= 0.4
  if (canFilter) {
    try { c.filter = `blur(${blur.toFixed(1)}px)` } catch { /* unsupported */ }
  }
  draw()
  if (canFilter) {
    try { c.filter = 'none' } catch { /* unsupported */ }
  }
}

// ============================================================
// Direct-draw primitives (randomness is the point — never cached)
// ============================================================

/**
 * One tapered streak: a quadratic-curved lens from a full-width base
 * to a thin tip, filled at `alpha`. Shared by bristle fan + sketch
 * hair. `dirAngle` is the streak direction in radians; `bow` bends the
 * middle sideways.
 */
function taperedStreak(
  ctx: CanvasRenderingContext2D, cx: number, cy: number,
  dirAngle: number, len: number, w: number, bow: number, color: string, alpha: number
): void {
  const dx = Math.cos(dirAngle), dy = Math.sin(dirAngle)
  const px = -dy, py = dx
  const hx = len / 2
  const w1 = Math.max(0.22, w * 0.2) // tip half-width
  const sx = cx - dx * hx, sy = cy - dy * hx
  const ex = cx + dx * hx, ey = cy + dy * hx
  const mx = cx + px * bow, my = cy + py * bow
  ctx.fillStyle = rgba(color, alpha)
  ctx.beginPath()
  ctx.moveTo(sx + px * w, sy + py * w)
  ctx.quadraticCurveTo(mx + px * w * 0.55, my + py * w * 0.55, ex + px * w1, ey + py * w1)
  ctx.quadraticCurveTo(mx - px * w * 0.55, my - py * w * 0.55, sx - px * w, sy - py * w)
  ctx.closePath()
  ctx.fill()
}

// ============================================================
// Cursor geometry
// ============================================================

const SQUARE_PTS: { x: number; y: number }[] = [
  { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 },
]

/** bristle-fan hull (local x = travel, y = perpendicular) */
const FAN_PTS: { x: number; y: number }[] = [
  { x: 0, y: 0.78 }, { x: 0.75, y: 0.5 }, { x: 0.95, y: 0 },
  { x: 0.75, y: -0.5 }, { x: 0, y: -0.78 }, { x: -0.75, y: -0.5 },
  { x: -0.95, y: 0 }, { x: -0.75, y: 0.5 },
]

function ellipsePts(rx: number, ry: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2
    pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry })
  }
  return pts
}

// ============================================================
// Preview cache
// ============================================================

const previewCache = new Map<string, HTMLCanvasElement>()

/**
 * Build (and cache) a representative preview dab for `id` on a
 * transparent size×size canvas. Deterministic seeded rand so the
 * thumbnail is stable across renders.
 */
function previewOf(id: string, size: number, params: Partial<TipDrawParams>): HTMLCanvasElement {
  const key = `${id}:${size}`
  const hit = previewCache.get(key)
  if (hit) return hit
  const def = getTip(id)
  const cv = createCanvas(size, size)
  if (def) {
    const c = ctx2d(cv)
    def.drawDab(c, size / 2, size / 2, {
      size: Math.round(size * 0.72),
      hardness: 60,
      angle: 0,
      roundness: 100,
      color: '#e6e6e6',
      rand: mulberry32(hashString(id)),
      ...params,
    })
  }
  previewCache.set(key, cv)
  return cv
}

// ============================================================
// The tip library
// ============================================================

export const TIP_DEFS: TipDef[] = [

  // ---- Soft Round: the workhorse. Smooth pow(1-t,γ) hardness falloff ----
  {
    id: 'round-soft',
    label: 'Soft Round',
    rotatable: false,
    defaults: { spacing: 15, hardness: 80, flow: 100 },
    drawDab(ctx, x, y, p) {
      const q = stampKey('round-soft', p)
      const cv = getStamp(q.key, () => buildSoftStamp(q.size, q.hardness, p.color))
      ctx.drawImage(cv, x - p.size / 2, y - p.size / 2, p.size, p.size)
    },
    preview(size = 28) { return previewOf('round-soft', size, { hardness: 55 }) },
    cursorShape: () => null,
  },

  // ---- Hard Round: crisp, ≤1.25px AA edge ----
  {
    id: 'round-hard',
    label: 'Hard Round',
    rotatable: false,
    defaults: { spacing: 12, hardness: 100, flow: 100 },
    drawDab(ctx, x, y, p) {
      const q = stampKey('round-hard', p)
      const cv = getStamp(q.key, () => buildHardStamp(q.size, p.color))
      ctx.drawImage(cv, x - p.size / 2, y - p.size / 2, p.size, p.size)
    },
    preview(size = 28) { return previewOf('round-hard', size, {}) },
    cursorShape: () => null,
  },

  // ---- Flat / Marker: rotated rounded square ----
  {
    id: 'flat',
    label: 'Flat Marker',
    rotatable: true,
    defaults: { spacing: 6, hardness: 100, flow: 100 },
    drawDab(ctx, x, y, p) {
      const q = stampKey('flat', p)
      const cv = getStamp(q.key, () => buildFlatStamp(q.size, q.hardness, p.color))
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(p.angle * RAD)
      ctx.drawImage(cv, -p.size / 2, -p.size / 2, p.size, p.size)
      ctx.restore()
    },
    preview(size = 28) { return previewOf('flat', size, { angle: 24, size: Math.round(size * 0.78) }) },
    cursorShape: p => ({ pts: SQUARE_PTS, angle: p.angle, roundness: 100 }),
  },

  // ---- Chisel / Calligraphy: roundness-squashed ellipse nib ----
  {
    id: 'angled',
    label: 'Calligraphy',
    rotatable: true,
    defaults: { spacing: 8, hardness: 100, roundness: 35, angle: 30, flow: 100 },
    drawDab(ctx, x, y, p) {
      const q = stampKey('angled', p)
      const cv = getStamp(q.key, () => buildAngledStamp(q.size, q.roundness, q.hardness, p.color))
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(p.angle * RAD)
      ctx.drawImage(cv, -p.size / 2, -p.size / 2, p.size, p.size)
      ctx.restore()
    },
    preview(size = 28) { return previewOf('angled', size, { angle: 42, roundness: 34, size: Math.round(size * 0.86) }) },
    cursorShape: p => ({ pts: ellipsePts(1, Math.max(0.1, p.roundness / 100)), angle: p.angle, roundness: p.roundness }),
  },

  // ---- Bristle fan: dry-brush streaks fanned across the tip ----
  {
    id: 'bristle',
    label: 'Bristle Fan',
    rotatable: true,
    defaults: { spacing: 28, hardness: 100, flow: 90 },
    drawDab(ctx, x, y, p) {
      const a = p.angle * RAD
      const px = -Math.sin(a), py = Math.cos(a) // perpendicular of travel
      const n = 7 + Math.floor(p.rand() * 7) // 7..13 bristles
      const spread = p.size * 0.35
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) - 0.5 : 0
        const off = t * 2 * spread
        const len = p.size * (0.5 + p.rand() * 0.6)
        const bow = (p.rand() - 0.5) * p.size * 0.14
        const w = Math.max(0.5, p.size * (0.02 + p.rand() * 0.014))
        const alpha = 0.32 + p.rand() * 0.58
        taperedStreak(ctx, x + px * off, y + py * off, a, len, w, bow, p.color, alpha)
      }
    },
    preview(size = 28) { return previewOf('bristle', size, { size: Math.round(size * 0.95), hardness: 100 }) },
    cursorShape: p => ({ pts: FAN_PTS, angle: p.angle, roundness: 100 }),
  },

  // ---- Splatter: airbrush dots with center-weighted density ----
  {
    id: 'spray',
    label: 'Splatter',
    rotatable: false,
    defaults: { spacing: 45, hardness: 50, flow: 70 },
    drawDab(ctx, x, y, p) {
      const R = p.size / 2
      const n = 30 + Math.floor(p.rand() * 31) // 30..60 dots
      // keep dots visible on large brushes (0.5–2px at size ≤ 30)
      const dotScale = clamp(Math.sqrt(p.size / 30), 0.9, 4)
      const alphas = [0.45, 0.68, 0.95]
      const buckets: number[][] = [[], [], []]
      for (let i = 0; i < n; i++) {
        // radial CDF r = R·u^0.75 → density falls off toward the rim
        const rr = R * Math.pow(p.rand(), 0.75)
        const th = p.rand() * Math.PI * 2
        const dr = (0.5 + p.rand() * 1.5) * dotScale
        const b = buckets[Math.min(2, Math.floor(p.rand() * 3))]
        b.push(x + Math.cos(th) * rr, y + Math.sin(th) * rr, dr)
      }
      for (let bi = 0; bi < 3; bi++) {
        const b = buckets[bi]
        if (b.length === 0) continue
        ctx.fillStyle = rgba(p.color, alphas[bi])
        ctx.beginPath()
        for (let i = 0; i < b.length; i += 3) {
          ctx.moveTo(b[i] + b[i + 2], b[i + 1])
          ctx.arc(b[i], b[i + 1], b[i + 2], 0, Math.PI * 2)
        }
        ctx.fill()
      }
    },
    preview(size = 28) { return previewOf('spray', size, { size: Math.round(size * 0.86) }) },
    cursorShape: () => null,
  },

  // ---- Grunge: soft-round profile × value noise (per-dab offset) ----
  {
    id: 'noise',
    label: 'Grunge',
    rotatable: false,
    defaults: { spacing: 22, hardness: 70, flow: 100 },
    drawDab(ctx, x, y, p) {
      // reuse the round-soft stamp, multiply by the noise tile per dab
      const q = stampKey('round-soft', p)
      const base = getStamp(q.key, () => buildSoftStamp(q.size, q.hardness, p.color))
      drawNoiseMasked(ctx, x, y, p.size, p.size, base, getTiles().noise, p.rand)
    },
    preview(size = 28) { return previewOf('noise', size, { hardness: 55 }) },
    cursorShape: () => null,
  },

  // ---- Chalk: hard edge eroded by thresholded noise + ±0.5px scatter ----
  {
    id: 'chalk',
    label: 'Chalk',
    rotatable: false,
    defaults: { spacing: 16, hardness: 100, flow: 100 },
    drawDab(ctx, x, y, p) {
      const sx = x + (p.rand() - 0.5) // slight ±0.5px scatter of the whole dab
      const sy = y + (p.rand() - 0.5)
      const q = stampKey('round-hard', p)
      const base = getStamp(q.key, () => buildHardStamp(q.size, p.color))
      drawNoiseMasked(ctx, sx, sy, p.size, p.size, base, getTiles().chalk, p.rand)
    },
    preview(size = 28) { return previewOf('chalk', size, {}) },
    cursorShape: () => null,
  },

  // ---- Wet media: rim-boost profile + subtle noise ----
  {
    id: 'wet',
    label: 'Wet Media',
    rotatable: false,
    defaults: { spacing: 14, hardness: 60, flow: 80 },
    drawDab(ctx, x, y, p) {
      const q = stampKey('wet', p)
      const base = getStamp(q.key, () => buildWetStamp(q.size, p.color))
      drawNoiseMasked(ctx, x, y, p.size, p.size, base, getTiles().gentle, p.rand)
    },
    preview(size = 28) { return previewOf('wet', size, { size: Math.round(size * 0.82) }) },
    cursorShape: () => null,
  },

  // ---- Sketch hair: 1–2 thin tapered strokes per dab (great at high spacing) ----
  {
    id: 'hair',
    label: 'Sketch Hair',
    rotatable: true,
    defaults: { spacing: 90, hardness: 100, flow: 95 },
    drawDab(ctx, x, y, p) {
      const a = p.angle * RAD
      const n = p.rand() < 0.5 ? 1 : 2
      for (let i = 0; i < n; i++) {
        const ang = a + (p.rand() - 0.5) * 0.55 // ± ~15°
        const len = p.size * (0.8 + p.rand() * 0.6)
        const w = Math.max(0.45, p.size * 0.02 * (0.6 + p.rand() * 0.8))
        const bow = (p.rand() - 0.5) * p.size * 0.1
        const alpha = 0.75 + p.rand() * 0.25
        taperedStreak(ctx, x, y, ang, len, w, bow, p.color, alpha)
      }
    },
    preview(size = 28) { return previewOf('hair', size, { angle: -8, size: Math.round(size * 0.62) }) },
    cursorShape: p => ({ pts: ellipsePts(1, 0.16), angle: p.angle, roundness: 100 }),
  },
]

const TIP_MAP: Map<string, TipDef> = new Map(TIP_DEFS.map(t => [t.id, t]))

export function getTip(id: string): TipDef | undefined {
  return TIP_MAP.get(id)
}

export function tipIds(): string[] {
  return TIP_DEFS.map(t => t.id)
}

/** tips the eraser offers (procedural; the eraser has no image stamps) */
export const ERASER_TIP_IDS: readonly string[] = ['round-soft', 'round-hard', 'flat', 'angled', 'spray', 'noise']

/** conservative radius multiplier per tip — used by callers for the
 *  engine's stroke-bbox (too small clips the live preview of dabs) */
const TIP_EXTENT: Record<string, number> = {
  'round-soft': 1.02,
  'round-hard': 1.02,
  'flat': 1.45,
  'angled': 1.05,
  'bristle': 1.35,
  'spray': 1.15,
  'noise': 1.05,
  'chalk': 1.1,
  'wet': 1.02,
  'hair': 1.6,
}

export function tipExtentMul(id: string): number {
  return TIP_EXTENT[id] ?? 1.1
}

// ============================================================
// Color jitter palette
// ============================================================

/**
 * 6-color jittered palette around `base` for per-dab color variation:
 * hue ± jitter·0.9°, saturation/lightness ± jitter·0.15 points,
 * quantized to whole units so the stamp cache stays bounded (≤6
 * stamps per shape per stroke). Entry 0 is the exact base color.
 */
export function jitterPalette(base: string, jitter: number): string[] {
  const j = clamp(jitter, 0, 100)
  const [r, g, b] = hexToRgb(base)
  const [h, s, v] = rgbToHsv(r, g, b)
  const out: string[] = [rgbToHex(r, g, b)]
  for (let i = 1; i < 6; i++) {
    const hue = Math.round(h + (Math.random() * 2 - 1) * j * 0.9)
    const sat = clamp(Math.round(s + (Math.random() * 2 - 1) * j * 0.15), 0, 100)
    const val = clamp(Math.round(v + (Math.random() * 2 - 1) * j * 0.15), 0, 100)
    out.push(rgbToHex(...hsvToRgb(hue, sat, val)))
  }
  return out
}

// ============================================================
// Shape-aware brush cursor
// ============================================================

function tinyCrosshair(ctx: CanvasRenderingContext2D, mouse: { x: number; y: number }) {
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.shadowColor = 'rgba(0,0,0,0.9)'
  ctx.shadowBlur = 2
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(mouse.x - 7, mouse.y); ctx.lineTo(mouse.x + 7, mouse.y)
  ctx.moveTo(mouse.x, mouse.y - 7); ctx.lineTo(mouse.x, mouse.y + 7)
  ctx.stroke()
  ctx.restore()
}

function centerTick(ctx: CanvasRenderingContext2D, mouse: { x: number; y: number }) {
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(mouse.x - 4, mouse.y); ctx.lineTo(mouse.x + 4, mouse.y)
  ctx.moveTo(mouse.x, mouse.y - 4); ctx.lineTo(mouse.x, mouse.y + 4)
  ctx.stroke()
}

function circleCursor(ctx: CanvasRenderingContext2D, mouse: { x: number; y: number }, r: number) {
  ctx.save()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'
  ctx.beginPath(); ctx.arc(mouse.x, mouse.y, r, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath(); ctx.arc(mouse.x, mouse.y, r + 1, 0, Math.PI * 2); ctx.stroke()
  centerTick(ctx, mouse)
  ctx.restore()
}

/**
 * Shape-aware brush cursor (screen space). Rotatable tips draw their
 * actual outline (rotated ellipse / square / fan hull) at the current
 * angle; round tips keep the classic double-ring + center tick; tiny
 * brushes get the precise crosshair. Shared by brush.ts and eraser.ts.
 */
export function drawTipCursor(
  ctx: CanvasRenderingContext2D,
  mouse: { x: number; y: number } | null,
  size: number,
  zoom: number,
  tipId: string,
  angle: number,
  roundness: number
): void {
  if (!mouse) return
  const r = Math.max(2, (size / 2) * zoom)
  if (r < 4) { tinyCrosshair(ctx, mouse); return }
  const def = getTip(tipId)
  const shape = def?.cursorShape?.({ size, hardness: 100, angle, roundness, color: '#ffffff', rand: Math.random })
  if (!shape || shape.pts.length < 3) { circleCursor(ctx, mouse, r); return }
  ctx.save()
  ctx.translate(mouse.x, mouse.y)
  ctx.rotate(shape.angle * RAD)
  ctx.scale(r, r)
  ctx.beginPath()
  ctx.moveTo(shape.pts[0].x, shape.pts[0].y)
  for (let i = 1; i < shape.pts.length; i++) ctx.lineTo(shape.pts[i].x, shape.pts[i].y)
  ctx.closePath()
  // dark halo + light line — readable on any background
  ctx.lineWidth = 2.2 / r
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.stroke()
  ctx.lineWidth = 1 / r
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.stroke()
  ctx.restore()
  centerTick(ctx, mouse)
}
