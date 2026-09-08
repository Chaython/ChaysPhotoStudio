// ============================================================
// Interpolation & numeric helpers for image-ops:
//  - Monotone cubic (Fritsch–Carlson) curve interpolation for Curves
//  - smoothstep ramps used by tone ops / masks
//  - deterministic seeded RNG (mulberry32) for crystallize, clouds,
//    inpaint noise — same seed => same result across previews
// Pure math, no DOM.
// ============================================================

import { clamp } from '../utils/canvas'

export interface CurvePoint { x: number; y: number }

/**
 * Build a 256-entry LUT from curve control points using monotone cubic
 * Hermite interpolation (Fritsch–Carlson). Unlike smoothstep chains this
 * produces natural Photoshop-style curves: C1 continuous, no overshoot,
 * and exactly monotone when the user's points are monotone — so a
 * flat section stays flat and an S-curve bends like a real tone curve.
 *
 * Points outside [first.x, last.x] are clamped to the endpoint values.
 */
export function buildCurveLUT(points: CurvePoint[] | null | undefined): Uint8ClampedArray | null {
  if (!points || points.length < 2) return null
  const sorted = [...points].sort((a, b) => a.x - b.x)

  // de-duplicate x coordinates (later point wins)
  const xs: number[] = []
  const ys: number[] = []
  for (const p of sorted) {
    if (xs.length > 0 && Math.abs(xs[xs.length - 1] - p.x) < 0.5) ys[ys.length - 1] = p.y
    else { xs.push(clamp(p.x, 0, 255)); ys.push(clamp(p.y, 0, 255)) }
  }
  const n = xs.length
  if (n < 2) return null

  // segment slopes + initial knot tangents (Catmull-Rom-ish average)
  const delta = new Float64Array(Math.max(1, n - 1))
  for (let i = 0; i < n - 1; i++) {
    const h = Math.max(1e-6, xs[i + 1] - xs[i])
    delta[i] = (ys[i + 1] - ys[i]) / h
  }
  const m = new Float64Array(n)
  m[0] = delta[0]
  m[n - 1] = delta[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = (delta[i - 1] + delta[i]) * 0.5

  // Fritsch–Carlson monotonicity limiter: if the two tangents around a
  // segment are too aggressive the cubic overshoots, so scale both back
  // while keeping the sign (preserves local extremum shape).
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / delta[i]
    const b = m[i + 1] / delta[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * delta[i]
      m[i + 1] = t * b * delta[i]
    }
  }

  const lut = new Uint8ClampedArray(256)
  let seg = 0
  for (let x = 0; x < 256; x++) {
    const xv = x
    if (xv <= xs[0]) { lut[x] = ys[0]; continue }
    if (xv >= xs[n - 1]) { lut[x] = ys[n - 1]; continue }
    while (seg < n - 2 && xs[seg + 1] < xv) seg++
    while (seg > 0 && xs[seg] > xv) seg--
    const h = Math.max(1e-6, xs[seg + 1] - xs[seg])
    const t = (xv - xs[seg]) / h
    const t2 = t * t
    const t3 = t2 * t
    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2
    const y = h00 * ys[seg] + h10 * h * m[seg] + h01 * ys[seg + 1] + h11 * h * m[seg + 1]
    lut[x] = clamp(y, 0, 255)
  }
  return lut
}

/** Hermite-smooth ramp between edges (e in [0,1]) */
export const smoothstep01 = (e: number): number => e * e * (3 - 2 * e)

/** Map v through a smooth ramp from a→b (clamped); returns 0..1 */
export const smoothRamp = (v: number, a: number, b: number): number => {
  if (b === a) return v >= b ? 1 : 0
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Deterministic PRNG (mulberry32) — returns a () => float in [0,1) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box–Muller gaussian sampler on top of any uniform RNG */
export function gaussianMaker(rand: () => number): () => number {
  return () => {
    let u = 0, v = 0
    while (u <= 1e-7) u = rand()
    while (v <= 1e-7) v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}
