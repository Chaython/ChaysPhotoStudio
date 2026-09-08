// ============================================================
// PS Image-menu auto corrections + Match Color
//
//   autoTone      — per-channel histogram clip (0.1% / 99.9%),
//                   each channel remapped to full 0..255
//                   (neutralizes color casts — PS Auto Tone)
//   autoContrast  — composite LUMA histogram clip, all channels
//                   remapped by the same scale (hue preserved)
//   autoColor     — gray-world neutralization (blended at 60%,
//                   gains clamped to 0.8–1.25) + luma clip
//   matchColor    — Reinhard-style per-channel mean/std stats
//                   transfer from a source image (PS Match Color)
//
// Pure math — every function mutates the ImageData in place.
// ============================================================
import { computeHistogram } from './core'
import { clamp } from '../utils/canvas'

const CLIP_LO = 0.001 // 0.1%
const CLIP_HI = 0.999 // 99.9%

/** find the lo/hi histogram values enclosing [loPct, hiPct] of the total mass */
function clipBounds(hist: Uint32Array, total: number): [number, number] {
  if (total <= 0) return [0, 255]
  let acc = 0
  let lo = 0
  const loTarget = total * CLIP_LO
  for (let i = 0; i < 256; i++) {
    acc += hist[i]
    if (acc >= loTarget) { lo = i; break }
  }
  acc = 0
  let hi = 255
  const hiTarget = total * CLIP_HI
  for (let i = 0; i < 256; i++) {
    acc += hist[i]
    if (acc >= hiTarget) { hi = i; break }
  }
  if (hi < lo) hi = lo
  return [lo, hi]
}

/** 256-entry remap LUT stretching [lo, hi] to [0, 255]; null when flat */
function remapLUT(lo: number, hi: number): Uint8ClampedArray | null {
  if (hi - lo < 1) return null
  const lut = new Uint8ClampedArray(256)
  const scale = 255 / (hi - lo)
  for (let v = 0; v < 256; v++) lut[v] = clamp((v - lo) * scale, 0, 255)
  return lut
}

// ------------------------------------------------------------
// Auto Tone — each channel independently (kills color casts)
// ------------------------------------------------------------
export function autoTone(img: ImageData): void {
  const h = computeHistogram(img) // skips alpha < 8 (near-transparent)
  const d = img.data
  const luts: (Uint8ClampedArray | null)[] = [
    remapLUT(...clipBounds(h.r, h.total)),
    remapLUT(...clipBounds(h.g, h.total)),
    remapLUT(...clipBounds(h.b, h.total)),
  ]
  if (!luts[0] && !luts[1] && !luts[2]) return
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const lut = luts[c]
      if (lut) d[i + c] = lut[d[i + c]]
    }
  }
}

// ------------------------------------------------------------
// Auto Contrast — single luma histogram, same remap for R/G/B
// ------------------------------------------------------------
export function autoContrast(img: ImageData): void {
  const h = computeHistogram(img)
  const [lo, hi] = clipBounds(h.l, h.total)
  const lut = remapLUT(lo, hi)
  if (!lut) return
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue
    d[i] = lut[d[i]]
    d[i + 1] = lut[d[i + 1]]
    d[i + 2] = lut[d[i + 2]]
  }
}

// ------------------------------------------------------------
// Auto Color — gentle gray-world neutralization + luma clip
// ------------------------------------------------------------
export function autoColor(img: ImageData): void {
  const d = img.data
  // 1. gray-world: scale each channel toward the (weighted) luma mean,
  //    clamped and blended at 60% so it stays gentle
  const means = [0, 0, 0]
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue
    n++
    means[0] += d[i]; means[1] += d[i + 1]; means[2] += d[i + 2]
  }
  if (n > 0) {
    for (let c = 0; c < 3; c++) means[c] /= n
    const lumaMean = 0.299 * means[0] + 0.587 * means[1] + 0.114 * means[2]
    for (let c = 0; c < 3; c++) {
      if (means[c] < 1) continue // black channel — nothing to scale
      const scale = clamp(lumaMean / means[c], 0.8, 1.25)
      const blended = 1 + 0.6 * (scale - 1)
      for (let i = c; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue
        d[i] = d[i] * blended
      }
    }
  }
  // 2. clip extremes with the composite-luma remap
  autoContrast(img)
}

// ------------------------------------------------------------
// Match Color — PS Image > Adjustments > Match Color
// ------------------------------------------------------------
export interface MatchColorOptions {
  /** 0..100 — how far the target's mean luma moves toward the source's (default 100) */
  luminance: number
  /** 0..100 — blend the result back toward the original (default 0) */
  fade: number
  /** gray-balance the target before matching (default false) */
  neutralize: boolean
  /** 0..100 — strength of the chroma + per-channel contrast transfer (default 100) */
  intensity?: number
}

interface ChanStats { mean: [number, number, number]; std: [number, number, number] }

/** per-channel mean + std, weighted by alpha > 0 */
function channelStats(data: Uint8ClampedArray): ChanStats | null {
  let n = 0
  const sum = [0, 0, 0]
  const sq = [0, 0, 0]
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 8) continue
    n++
    const r = data[i], g = data[i + 1], b = data[i + 2]
    sum[0] += r; sum[1] += g; sum[2] += b
    sq[0] += r * r; sq[1] += g * g; sq[2] += b * b
  }
  if (n < 1) return null
  const mean: [number, number, number] = [sum[0] / n, sum[1] / n, sum[2] / n]
  const std: [number, number, number] = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    std[c] = Math.sqrt(Math.max(0, sq[c] / n - mean[c] * mean[c]))
  }
  return { mean, std }
}

export function matchColor(img: ImageData, source: ImageData, opts: MatchColorOptions): void {
  const lum = clamp((opts.luminance ?? 100) / 100, 0, 1)
  const inten = clamp((opts.intensity ?? 100) / 100, 0, 1)
  const mix = 1 - clamp((opts.fade ?? 0) / 100, 0, 1)
  if (mix <= 0) return
  const d = img.data

  // optional pre-pass: gray-balance the target (full strength)
  if (opts.neutralize) {
    const st = channelStats(d)
    if (st) {
      const lumaT = 0.299 * st.mean[0] + 0.587 * st.mean[1] + 0.114 * st.mean[2]
      for (let c = 0; c < 3; c++) {
        if (st.mean[c] < 1) continue
        const g = clamp(lumaT / st.mean[c], 0.5, 2)
        for (let i = c; i < d.length; i += 4) d[i] = d[i] * g
      }
    }
  }

  const t = channelStats(d) // target stats (post-neutralize)
  const s = channelStats(source.data)
  if (!t || !s) return

  const lumaT = 0.299 * t.mean[0] + 0.587 * t.mean[1] + 0.114 * t.mean[2]
  const lumaS = 0.299 * s.mean[0] + 0.587 * s.mean[1] + 0.114 * s.mean[2]
  // the target's mean luma only moves by the fraction `lum` (preserve
  // overall brightness feel); chroma deviations transfer with `inten`
  const targetLuma = lumaT + (lumaS - lumaT) * lum

  // per-channel affine map: v' = (v − meanT) · k + meanT + shift
  const shift: [number, number, number] = [0, 0, 0]
  const kk: [number, number, number] = [1, 1, 1]
  for (let c = 0; c < 3; c++) {
    const devT = t.mean[c] - lumaT // target chroma deviation
    const devS = s.mean[c] - lumaS // source chroma deviation
    shift[c] = targetLuma - lumaT + (devS - devT) * inten
    const kRaw = t.std[c] > 0.5 ? clamp(s.std[c] / t.std[c], 0.5, 2) : 1
    kk[c] = 1 + (kRaw - 1) * inten
  }
  // sanity: with luminance = intensity = 100, fade = 0 this reduces to the
  // classic Reinhard transfer v' = (v − mT)·(sS/sT) + mS

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 8) continue
    for (let c = 0; c < 3; c++) {
      const v = d[i + c]
      const mapped = (v - t.mean[c]) * kk[c] + t.mean[c] + shift[c]
      d[i + c] = v + mix * (mapped - v)
    }
  }
}
