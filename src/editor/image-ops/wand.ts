// ============================================================
// Perceptual Magic Wand / similarity selection engine.
//
// Unlike the legacy RGB max-channel flood fill, this engine samples an area
// around the click, compares in CIE Lab, optionally follows the running region
// mean, and can penalize crossings over strong local edges.  The same function
// supports contiguous Magic Wand and global "select similar" behaviour.
// ============================================================
import { clamp } from '../utils/canvas'
import { rgbToLab } from './color'

export interface PerceptualWandOptions {
  /** User-facing 0..100 perceptual tolerance. 0 = exact-ish, 100 = broad. */
  tolerance: number
  contiguous: boolean
  diagonal?: boolean
  antiAlias?: boolean
  /** 0=point, 1=3x3, 2=5x5, 3=7x7 */
  sampleRadius?: number
  /** Edge crossing resistance, 0..100. */
  edgeAware?: number
  /** Blend seed color with running accepted-region mean. */
  adaptive?: boolean
  /** Include alpha in similarity scoring. */
  matchAlpha?: boolean
  /** Pixel-art mode: compare raw channel values and produce hard edges. */
  exactPixels?: boolean
  /** Optional search bounds, in image coordinates. */
  bounds?: { x: number; y: number; w: number; h: number }
}

interface SeedModel { L: number; a: number; b: number; alpha: number }

function sampledSeed(img: ImageData, sx: number, sy: number, radius: number): SeedModel {
  const { width: w, height: h, data } = img
  const lab = [0, 0, 0]
  let L = 0, a = 0, b = 0, alpha = 0, count = 0
  const r = clamp(Math.round(radius), 0, 3)
  for (let yy = Math.max(0, sy - r); yy <= Math.min(h - 1, sy + r); yy++) {
    for (let xx = Math.max(0, sx - r); xx <= Math.min(w - 1, sx + r); xx++) {
      const i = (yy * w + xx) * 4
      // Transparent pixels contain arbitrary RGB in many files. Weight their
      // chroma contribution down while still preserving alpha as a signal.
      const aw = Math.max(0.05, data[i + 3] / 255)
      rgbToLab(data[i], data[i + 1], data[i + 2], lab)
      L += lab[0] * aw
      a += lab[1] * aw
      b += lab[2] * aw
      alpha += data[i + 3]
      count += aw
    }
  }
  const pxCount = Math.max(1, (Math.min(h - 1, sy + r) - Math.max(0, sy - r) + 1) * (Math.min(w - 1, sx + r) - Math.max(0, sx - r) + 1))
  return { L: L / Math.max(0.05, count), a: a / Math.max(0.05, count), b: b / Math.max(0.05, count), alpha: alpha / pxCount }
}

/** CIE76 is deliberately used here: it is cheap, monotonic and good enough
 * for an interactive selection tool when combined with adaptive region means. */
function labDistance(L1: number, a1: number, b1: number, L2: number, a2: number, b2: number): number {
  return Math.hypot(L1 - L2, a1 - a2, b1 - b2)
}

/** Local luminance/chroma jump used as an edge barrier. */
function neighborEdgePenalty(data: Uint8ClampedArray, w: number, p: number, q: number): number {
  const pi = p * 4, qi = q * 4
  // Fast perceptual-ish edge metric; avoids two Lab conversions for every edge.
  const dr = Math.abs(data[pi] - data[qi])
  const dg = Math.abs(data[pi + 1] - data[qi + 1])
  const db = Math.abs(data[pi + 2] - data[qi + 2])
  const da = Math.abs(data[pi + 3] - data[qi + 3])
  return (dr * 0.22 + dg * 0.58 + db * 0.20) / 2.55 + da / 5.1 // ~0..120
}

function maskSoftness(score: number, threshold: number, antiAlias: boolean): number {
  if (score <= threshold) return 255
  if (!antiAlias || threshold <= 0) return 0
  const softEnd = threshold + Math.max(2.5, threshold * 0.30)
  if (score >= softEnd) return 0
  const t = 1 - (score - threshold) / (softEnd - threshold)
  // smoothstep for stable, non-banded edges
  const s = t * t * (3 - 2 * t)
  return Math.max(1, Math.round(s * 254))
}

/**
 * High quality Magic Wand / Select Similar mask.
 *
 * The tolerance mapping intentionally does not expose raw Lab delta-E. A
 * tolerance of 32 (the historic default) maps to roughly deltaE 18, while 100
 * becomes a deliberately broad ~55. This makes existing user muscle-memory
 * feel familiar while improving hue/luminance consistency dramatically.
 */
export function perceptualWandMask(
  img: ImageData,
  sx: number,
  sy: number,
  options: PerceptualWandOptions,
): Uint8ClampedArray {
  const { width: w, height: h, data } = img
  const out = new Uint8ClampedArray(w * h)
  if (!w || !h) return out

  const x0 = clamp(Math.round(sx), 0, w - 1)
  const y0 = clamp(Math.round(sy), 0, h - 1)
  const b = options.bounds
  const bx = b ? clamp(Math.floor(b.x), 0, w) : 0
  const by = b ? clamp(Math.floor(b.y), 0, h) : 0
  const ex = b ? clamp(Math.ceil(b.x + b.w), 0, w) : w
  const ey = b ? clamp(Math.ceil(b.y + b.h), 0, h) : h
  if (x0 < bx || x0 >= ex || y0 < by || y0 >= ey || ex <= bx || ey <= by) return out

  const seed = sampledSeed(img, x0, y0, options.sampleRadius ?? 1)
  const exactPixels = options.exactPixels === true
  const threshold = exactPixels ? clamp(options.tolerance, 0, 100) * 2.55 : 1.5 + clamp(options.tolerance, 0, 100) * 0.535
  const edgeK = clamp(options.edgeAware ?? 35, 0, 100) / 100
  const adaptive = options.adaptive !== false
  const matchAlpha = options.matchAlpha === true
  const antiAlias = !exactPixels && options.antiAlias !== false
  const diagonal = options.diagonal === true
  const lab = [0, 0, 0]

  const seedIndex = (y0 * w + x0) * 4
  const scoreAt = (p: number, model: SeedModel) => {
    const i = p * 4
    if (exactPixels) {
      let d = Math.max(Math.abs(data[i] - data[seedIndex]), Math.abs(data[i + 1] - data[seedIndex + 1]), Math.abs(data[i + 2] - data[seedIndex + 2]))
      if (matchAlpha) d = Math.max(d, Math.abs(data[i + 3] - data[seedIndex + 3]))
      return d
    }
    rgbToLab(data[i], data[i + 1], data[i + 2], lab)
    let d = labDistance(lab[0], lab[1], lab[2], model.L, model.a, model.b)
    if (matchAlpha) d += Math.abs(data[i + 3] - model.alpha) / 255 * 24
    // Strongly reject invisible pixels when the sampled seed is opaque; this
    // stops wand leakage through transparent padding around cut-out layers.
    if (seed.alpha > 220 && data[i + 3] < 8) d += 30
    return d
  }

  if (!options.contiguous) {
    for (let y = by; y < ey; y++) {
      for (let x = bx; x < ex; x++) {
        const p = y * w + x
        out[p] = maskSoftness(scoreAt(p, seed), threshold, antiAlias)
      }
    }
    return out
  }

  // Pixel queue with a fixed typed-array backing avoids millions of temporary
  // arrays on large photos. seen=1 means queued/visited, not necessarily kept.
  const n = w * h
  const queue = new Int32Array(n)
  const seen = new Uint8Array(n)
  let qh = 0, qt = 0
  const start = y0 * w + x0
  queue[qt++] = start
  seen[start] = 1

  // Running model: starts at the sampled seed; accepted pixels update it with
  // a capped EMA. This lets gradual gradients remain connected without the
  // "chain reaction" leakage of a pure neighbor-based flood fill.
  const region: SeedModel = { ...seed }
  let accepted = 0
  const currentLab = [0, 0, 0]
  const dirs4 = [-1, 1, -w, w]
  const dirs8 = diagonal ? [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1] : dirs4

  while (qh < qt) {
    const p = queue[qh++]
    const x = p % w, y = (p / w) | 0
    const base = scoreAt(p, adaptive && accepted > 8 ? region : seed)
    // Blend seed and running-region scores. Seed remains dominant so gradual
    // adaptation cannot walk indefinitely into an unrelated area.
    const seedScore = adaptive && accepted > 8 ? scoreAt(p, seed) : base
    const colorScore = adaptive && accepted > 8 ? base * 0.42 + seedScore * 0.58 : base
    const alpha = maskSoftness(colorScore, threshold, antiAlias)
    if (alpha === 0) continue
    out[p] = alpha

    if (alpha >= 128 && adaptive) {
      const i = p * 4
      rgbToLab(data[i], data[i + 1], data[i + 2], currentLab)
      const rate = Math.min(0.025, 1 / Math.max(12, accepted + 1))
      region.L += (currentLab[0] - region.L) * rate
      region.a += (currentLab[1] - region.a) * rate
      region.b += (currentLab[2] - region.b) * rate
      region.alpha += (data[i + 3] - region.alpha) * rate
      accepted++
    }

    // Soft edge-band pixels should not propagate the flood: they render the
    // anti-aliased transition but don't become bridges into another region.
    if (alpha < 128) continue

    for (const d of dirs8) {
      const q = p + d
      if (q < 0 || q >= n || seen[q]) continue
      const qx = q % w, qy = (q / w) | 0
      if (qx < bx || qx >= ex || qy < by || qy >= ey) continue
      // Prevent row wrapping for +/-1 and diagonal offsets.
      if (Math.abs(qx - x) > 1 || Math.abs(qy - y) > 1) continue
      seen[q] = 1
      if (edgeK > 0) {
        const edge = neighborEdgePenalty(data, w, p, q)
        // Rather than fully blocking all edges, turn the barrier into a small
        // extra similarity test. Strong edge-aware settings stop crossing a
        // high-contrast border even when both sides happen to share a hue.
        const qScore = scoreAt(q, adaptive && accepted > 8 ? region : seed)
        if (qScore + edge * edgeK * 0.38 > threshold + Math.max(2.5, threshold * 0.30)) continue
      }
      queue[qt++] = q
    }
  }

  return out
}
