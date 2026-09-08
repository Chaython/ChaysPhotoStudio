// ============================================================
// FILTERS2 registry — Task 9-b: 11 additional Photoshop filters
// (average, diffuse-glow, glass, ocean-ripple, zigzag, pinch,
// shear, displace, fibers, difference-clouds, lens-correction).
//
// Same conventions as filters.ts: pure functions, ImageData
// mutated in place, controls schema + defaults power the generic
// dialog. Distortions use the two-pass source-lookup structure
// (displacement field computed first → bilinear resample from a
// copy — never nearest-neighbor). All randomized filters use the
// seeded mulberry32 RNG so dialog previews are deterministic.
// ============================================================

import type { FilterDef, FilterType } from '../types'
import { clamp } from '../utils/canvas'
import { luma, hexToRgbTriple } from './color'
import { mulberry32, smoothRamp } from './interp'
import { blurImageData, boxBlurFloat, gaussianBlurFloat } from './blur'

// ---------------------------------------------------------------- helpers
// (module-private twins of the filters.ts helpers — they are not exported there)

/** bilinear RGB sample from a raw RGBA buffer (clamped edges) */
function bilinearRGB(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: number[]): void {
  if (x < 0) x = 0
  if (y < 0) y = 0
  if (x > w - 1) x = w - 1
  if (y > h - 1) y = h - 1
  const x0 = x | 0, y0 = y | 0
  const x1 = x0 + 1 < w ? x0 + 1 : x0
  const y1 = y0 + 1 < h ? y0 + 1 : y0
  const fx = x - x0, fy = y - y0
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4
  const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4
  for (let c = 0; c < 3; c++) {
    const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx
    const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx
    out[c] = top * (1 - fy) + bot * fy
  }
}

/** bilinear sample of a single channel from a raw RGBA buffer */
function bilinearCh(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, c: number): number {
  if (x < 0) x = 0
  if (y < 0) y = 0
  if (x > w - 1) x = w - 1
  if (y > h - 1) y = h - 1
  const x0 = x | 0, y0 = y | 0
  const x1 = x0 + 1 < w ? x0 + 1 : x0
  const y1 = y0 + 1 < h ? y0 + 1 : y0
  const fx = x - x0, fy = y - y0
  const i00 = (y0 * w + x0) * 4 + c, i10 = (y0 * w + x1) * 4 + c
  const i01 = (y1 * w + x0) * 4 + c, i11 = (y1 * w + x1) * 4 + c
  const top = src[i00] * (1 - fx) + src[i10] * fx
  const bot = src[i01] * (1 - fx) + src[i11] * fx
  return top * (1 - fy) + bot * fy
}

/** luma field of an image as Float32 (0..255) */
function lumaField(img: ImageData): Float32Array {
  const { width: w, height: h, data } = img
  const out = new Float32Array(w * h)
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
  }
  return out
}

/**
 * Seeded 2D value noise: a (gw+1)×(gh+1) random lattice with smoothstep
 * bilinear evaluation. Deterministic per rand sequence → stable previews.
 */
function makeValueNoise(rand: () => number, gw: number, gh: number): (x: number, y: number) => number {
  const g = new Float32Array((gw + 1) * (gh + 1))
  for (let i = 0; i < g.length; i++) g[i] = rand()
  const stride = gw + 1
  return (x: number, y: number) => {
    if (x < 0) x = 0
    if (y < 0) y = 0
    if (x > gw) x = gw
    if (y > gh) y = gh
    const x0 = x | 0, y0 = y | 0
    const x1 = x0 + 1 <= gw ? x0 + 1 : gw
    const y1 = y0 + 1 <= gh ? y0 + 1 : gh
    const fx = x - x0, fy = y - y0
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
    const i00 = y0 * stride + x0
    const top = g[i00] * (1 - sx) + g[y0 * stride + x1] * sx
    const bot = g[y1 * stride + x0] * (1 - sx) + g[y1 * stride + x1] * sx
    return top * (1 - sy) + bot * sy
  }
}

/** triangle wave −1..1 of phase (radians) */
function triWave(phase: number): number {
  const t = (phase / (Math.PI * 2)) % 1
  return 4 * Math.abs(t - 0.5) - 1
}

// ---------------------------------------------------------------- registry

/** the 11 FilterType keys delivered by this module (merged into the
 *  exported FILTERS record by image-ops/index.ts) */
export type NewFilterType =
  | 'average' | 'diffuse-glow' | 'glass' | 'ocean-ripple' | 'zigzag' | 'pinch'
  | 'shear' | 'displace' | 'fibers' | 'difference-clouds' | 'lens-correction'

export const FILTERS2: Record<NewFilterType, FilterDef> = {

  // ---------------------------------------------------------------- blur

  'average': {
    type: 'average', label: 'Average', group: 'blur',
    controls: [],
    defaults: {},
    apply(img) {
      // single-pass mean → fill with the mean color (PS Average)
      const d = img.data
      let r = 0, g = 0, b = 0
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
      const n = d.length / 4
      r /= n; g /= n; b /= n
      for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b }
    },
  },

  // ---------------------------------------------------------------- stylize

  'diffuse-glow': {
    type: 'diffuse-glow', label: 'Diffuse Glow', group: 'stylize',
    controls: [
      { key: 'graininess', label: 'Graininess', type: 'slider', min: 0, max: 10, step: 1 },
      { key: 'glowAmount', label: 'Glow Amount', type: 'slider', min: 0, max: 20, step: 1 },
      { key: 'clearAmount', label: 'Clear Amount', type: 'slider', min: 0, max: 20, step: 1 },
    ],
    defaults: { graininess: 3, glowAmount: 8, clearAmount: 12 },
    apply(img, p) {
      const graininess = clamp(p.graininess ?? 3, 0, 10)
      const glowAmount = clamp(p.glowAmount ?? 8, 0, 20)
      const clearAmount = clamp(p.clearAmount ?? 12, 0, 20)
      if (glowAmount === 0 && graininess === 0) return
      const { width: w, height: h, data } = img
      // highlight threshold — "clear" lets more of the image through below the glow
      const th = 84 + (clearAmount / 20) * 136 // 84..220
      // grain: soft value-noise modulating the threshold so the glow
      // break-up clusters (diffusion) instead of uniform speckle
      const seed = 0x61a7 ^ Math.imul(Math.round(graininess * 65537), 2654435761) ^ Math.imul(glowAmount, 40503)
      const rand = mulberry32(seed)
      let grainField: Float32Array | null = null
      if (graininess > 0) {
        const cell = 3 + graininess * 1.6
        const gw = Math.max(2, Math.ceil(w / cell) + 1)
        const gh = Math.max(2, Math.ceil(h / cell) + 1)
        const noise = makeValueNoise(rand, gw, gh)
        grainField = new Float32Array(w * h)
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) grainField[y * w + x] = noise(x / cell, y / cell)
        }
        boxBlurFloat(grainField, w, h, 1)
      }
      // bright-pass → gaussian blur → screen composite (+ grain)
      const bright = new ImageData(w, h)
      const bd = bright.data
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          const l = luma(data[i], data[i + 1], data[i + 2])
          let t = th
          if (grainField) t += (grainField[y * w + x] - 0.5) * graininess * 26
          const k = l > t ? (l - t) / Math.max(1, 255 - t) : 0
          bd[i] = data[i] * k
          bd[i + 1] = data[i + 1] * k
          bd[i + 2] = data[i + 2] * k
          bd[i + 3] = 255
        }
      }
      blurImageData(bright, 2 + glowAmount * 1.1)
      const amt = 0.3 + (glowAmount / 20) * 0.7
      const speck = graininess * 7 / 255
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const s = data[i + c] / 255
          const gl = Math.min(1, (bd[i + c] / 255) * amt)
          let v = 1 - (1 - s) * (1 - gl) // screen
          if (speck > 0) v += (rand() - 0.5) * speck
          data[i + c] = v * 255
        }
      }
    },
  },

  // ---------------------------------------------------------------- distort

  'glass': {
    type: 'glass', label: 'Glass', group: 'distort',
    controls: [
      { key: 'distortion', label: 'Distortion', type: 'slider', min: 1, max: 20, step: 1 },
      { key: 'smoothness', label: 'Smoothness', type: 'slider', min: 1, max: 15, step: 1 },
      { key: 'scaling', label: 'Scaling', type: 'slider', min: 50, max: 300, step: 5, unit: '%' },
    ],
    defaults: { distortion: 5, smoothness: 4, scaling: 100 },
    apply(img, p) {
      const distortion = clamp(p.distortion ?? 5, 1, 20)
      const smoothness = clamp(p.smoothness ?? 4, 1, 15)
      const scaling = clamp(p.scaling ?? 100, 50, 300) / 100
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      // procedural displacement field: 2 octaves of seeded value noise per
      // axis; smoothness sets the lattice cell size (smoother = bigger cells)
      const seed = 0x51a55 ^ Math.imul(distortion, 2654435761) ^ Math.imul(smoothness, 40503) ^ Math.round(scaling * 997)
      const rand = mulberry32(seed)
      const cell = 5 + smoothness * 6
      const gw = Math.max(2, Math.ceil(w / cell) + 1)
      const gh = Math.max(2, Math.ceil(h / cell) + 1)
      const nx1 = makeValueNoise(rand, gw, gh)
      const nx2 = makeValueNoise(rand, gw * 2, gh * 2)
      const ny1 = makeValueNoise(rand, gw, gh)
      const ny2 = makeValueNoise(rand, gw * 2, gh * 2)
      const amp = distortion * 2.4
      const s = 1 / (cell * scaling)
      const rgb = [0, 0, 0]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const u = x * s, v = y * s
          const dx = (nx1(u, v) * 0.7 + nx2(u, v) * 0.3 - 0.5) * 2 * amp
          const dy = (ny1(u, v) * 0.7 + ny2(u, v) * 0.3 - 0.5) * 2 * amp
          const o = (y * w + x) * 4
          bilinearRGB(src, w, h, x + dx, y + dy, rgb)
          data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]
        }
      }
    },
  },

  'ocean-ripple': {
    type: 'ocean-ripple', label: 'Ocean Ripple', group: 'distort',
    controls: [
      { key: 'rippleSize', label: 'Ripple Size', type: 'slider', min: 1, max: 15, step: 1 },
      { key: 'rippleMagnitude', label: 'Ripple Magnitude', type: 'slider', min: 1, max: 20, step: 1 },
    ],
    defaults: { rippleSize: 6, rippleMagnitude: 9 },
    apply(img, p) {
      const size = clamp(p.rippleSize ?? 6, 1, 15)
      const mag = clamp(p.rippleMagnitude ?? 9, 1, 20)
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      // two oblique wave trains phase-modulated by low-frequency noise —
      // the interference reads as a water surface
      const seed = 0x0cea4 ^ Math.imul(size, 2246822519) ^ Math.imul(mag, 3266489917)
      const rand = mulberry32(seed)
      const cell = 40 + size * 8
      const gw = Math.max(2, Math.ceil(w / cell) + 1)
      const gh = Math.max(2, Math.ceil(h / cell) + 1)
      const phase = makeValueNoise(rand, gw, gh)
      const freq = (Math.PI * 2) / (size * 14 + 12) // rad/px along each train
      const a1 = (30 * Math.PI) / 180, a2 = (111 * Math.PI) / 180
      const ca1 = Math.cos(a1), sa1 = Math.sin(a1)
      const ca2 = Math.cos(a2), sa2 = Math.sin(a2)
      const amp = mag * 1.6
      const rgb = [0, 0, 0]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const ph = phase(x / cell, y / cell) * 5.2
          const dx = Math.sin((x * ca1 + y * sa1) * freq + ph) * amp
          const dy = Math.cos((x * ca2 + y * sa2) * freq * 0.83 + ph * 1.31) * amp
          const o = (y * w + x) * 4
          bilinearRGB(src, w, h, x + dx, y + dy, rgb)
          data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]
        }
      }
    },
  },

  'zigzag': {
    type: 'zigzag', label: 'Zigzag', group: 'distort',
    controls: [
      { key: 'amount', label: 'Amount', type: 'slider', min: 1, max: 100, step: 1, unit: '%' },
      { key: 'ridges', label: 'Ridges', type: 'slider', min: 1, max: 20, step: 1 },
      {
        key: 'style', label: 'Style', type: 'select',
        options: [
          { label: 'Pond Ripples', value: 'pond' },
          { label: 'Out From Center', value: 'out' },
          { label: 'Around Center', value: 'around' },
        ],
      },
    ],
    defaults: { amount: 20, ridges: 8, style: 'pond' },
    apply(img, p) {
      const amt = clamp(p.amount ?? 20, 1, 100) / 100
      const ridges = clamp(p.ridges ?? 8, 1, 20)
      const style = p.style ?? 'pond'
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      const cx = w / 2, cy = h / 2
      const R = Math.hypot(cx, cy)
      const k = (ridges * Math.PI * 2) / R // one full ridge per radial band
      const ampPx = amt * 26               // radial displacement at full amount
      const ampAng = amt * 1.05            // angular amplitude (around style)
      const rgb = [0, 0, 0]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = x - cx, dy = y - cy
          const r = Math.sqrt(dx * dx + dy * dy)
          let sx = x, sy = y
          if (r > 0.4) {
            const phase = r * k
            // pond: smooth sinusoid · out: hard triangular ridges
            const wave = style === 'out' ? triWave(phase) : Math.sin(phase)
            if (style === 'around') {
              const ang = Math.atan2(dy, dx) + wave * ampAng
              sx = cx + Math.cos(ang) * r
              sy = cy + Math.sin(ang) * r
            } else {
              const disp = wave * ampPx
              sx = x + (dx / r) * disp
              sy = y + (dy / r) * disp
            }
          }
          const o = (y * w + x) * 4
          bilinearRGB(src, w, h, sx, sy, rgb)
          data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]
        }
      }
    },
  },

  'pinch': {
    type: 'pinch', label: 'Pinch', group: 'distort',
    controls: [
      { key: 'amount', label: 'Amount', type: 'slider', min: -100, max: 100, step: 1, unit: '%' },
    ],
    defaults: { amount: 25 },
    apply(img, p) {
      const amt = clamp(p.amount ?? 25, -100, 100) / 100
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      const cx = w / 2, cy = h / 2
      const Rn = Math.hypot(cx, cy) // half-diagonal: whole frame inside the field
      // inverse map: source radius = r^(1+a) — positive pulls content toward
      // the center (pinch), negative pushes it out (bulge); exponent floored
      // so extreme bulge stays finite
      const exponent = Math.max(0.05, 1 + amt)
      const rgb = [0, 0, 0]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = x - cx, dy = y - cy
          const r = Math.sqrt(dx * dx + dy * dy)
          let sx: number, sy: number
          if (r < 1e-6) {
            sx = cx; sy = cy
          } else {
            const rn = r / Rn
            const rs = Math.pow(rn, exponent)
            sx = cx + (dx / r) * rs * Rn
            sy = cy + (dy / r) * rs * Rn
          }
          const o = (y * w + x) * 4
          bilinearRGB(src, w, h, sx, sy, rgb)
          data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]
        }
      }
    },
  },

  'shear': {
    type: 'shear', label: 'Shear', group: 'distort',
    controls: [
      { key: 'topShear', label: 'Top Shear', type: 'slider', min: -100, max: 100, step: 1, unit: '%' },
      { key: 'bottomShear', label: 'Bottom Shear', type: 'slider', min: -100, max: 100, step: 1, unit: '%' },
    ],
    defaults: { topShear: 0, bottomShear: 30 },
    apply(img, p) {
      const top = clamp(p.topShear ?? 0, -100, 100) / 100
      const bottom = clamp(p.bottomShear ?? 30, -100, 100) / 100
      if (top === 0 && bottom === 0) return
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      // horizontal shear ramp: 100% = half the image width; positive shifts
      // that edge's content to the right (sample from x − dx)
      const maxPx = w * 0.5
      const rgb = [0, 0, 0]
      for (let y = 0; y < h; y++) {
        const t = h > 1 ? y / (h - 1) : 0
        const dx = (top + (bottom - top) * t) * maxPx
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4
          bilinearRGB(src, w, h, x - dx, y, rgb)
          data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]
        }
      }
    },
  },

  'displace': {
    type: 'displace', label: 'Displace', group: 'distort',
    controls: [
      { key: 'hScale', label: 'Horizontal Scale', type: 'slider', min: -100, max: 100, step: 1, unit: '%' },
      { key: 'vScale', label: 'Vertical Scale', type: 'slider', min: -100, max: 100, step: 1, unit: '%' },
    ],
    defaults: { hScale: 30, vScale: 0 },
    apply(img, p) {
      const hS = clamp(p.hScale ?? 30, -100, 100)
      const vS = clamp(p.vScale ?? 0, -100, 100)
      if (hS === 0 && vS === 0) return
      const { width: w, height: h, data } = img
      // displacement map: blurred luminance of the image itself (self-
      // displace), centered at mid-gray — bright areas push one way, dark the other
      const field = gaussianBlurFloat(lumaField(img), w, h, 3)
      const src = new Uint8ClampedArray(data)
      const kx = (hS / 100) * w * 0.25
      const ky = (vS / 100) * h * 0.25
      const rgb = [0, 0, 0]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = (field[y * w + x] - 127.5) / 127.5 // −1..1
          const o = (y * w + x) * 4
          bilinearRGB(src, w, h, x + v * kx, y + v * ky, rgb)
          data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]
        }
      }
    },
  },

  // ---------------------------------------------------------------- render

  'fibers': {
    type: 'fibers', label: 'Fibers', group: 'render',
    controls: [
      { key: 'variance', label: 'Variance', type: 'slider', min: 1, max: 64, step: 1 },
      { key: 'strength', label: 'Strength', type: 'slider', min: 1, max: 100, step: 1, unit: '%' },
      { key: 'color', label: 'Foreground', type: 'color' },
      { key: 'color2', label: 'Background', type: 'color' },
    ],
    defaults: { variance: 16, strength: 50, color: '#e8a33d', color2: '#3a2f24' },
    apply(img, p) {
      const variance = clamp(p.variance ?? 16, 1, 64)
      const strength = clamp(p.strength ?? 50, 1, 100)
      const [fr, fg, fb] = hexToRgbTriple(p.color ?? '#e8a33d')
      const [br, bg, bb] = hexToRgbTriple(p.color2 ?? '#3a2f24')
      const { width: w, height: h, data } = img
      // strand field: mostly-vertical random walks, difference-accumulated —
      // overlapping strands cancel/invert each other, giving the woven
      // fg/bg tangle of PS Fibers
      const seed = 0xf1be8 ^ Math.imul(variance, 668265263) ^ Math.imul(strength, 374761393)
      const rand = mulberry32(seed)
      const field = new Float32Array(w * h)
      const strands = Math.round((strength / 100) * w * 2.2 + w * 0.25)
      const jitter = 0.5 + variance * 0.22 // horizontal wobble per step
      for (let s = 0; s < strands; s++) {
        let x = rand() * w
        let y = -2 - rand() * 4
        const len = h * (0.35 + rand() * 0.75)
        for (let step = 0; step < len; step++, y++) {
          x += (rand() - 0.5) * jitter
          // reflect the walk off the side borders (stays inside the canvas)
          if (x < 0) x = -x
          else if (x >= w) x = 2 * w - x - 1
          if (y < 0) continue
          if (y >= h) break
          const idx = y * w + (x | 0)
          field[idx] = Math.abs(field[idx] - 1) // difference blend
        }
      }
      // 1px soften so strands aren't razor-thin aliases
      boxBlurFloat(field, w, h, 1)
      for (let i = 0, j = 0; i < field.length; i++, j += 4) {
        const t = clamp(field[i], 0, 1)
        data[j] = br + (fr - br) * t
        data[j + 1] = bg + (fg - bg) * t
        data[j + 2] = bb + (fb - bb) * t
        data[j + 3] = 255
      }
    },
  },

  'difference-clouds': {
    type: 'difference-clouds', label: 'Difference Clouds', group: 'render',
    controls: [
      { key: 'size', label: 'Size', type: 'slider', min: 1, max: 100, step: 1, unit: '%' },
    ],
    defaults: { size: 50 },
    apply(img, p) {
      const size = clamp(p.size ?? 50, 1, 100)
      const { width: w, height: h, data } = img
      // seeded FBM value noise (5 octaves) — deterministic per params so
      // dialog previews are stable; differenced with the existing pixels
      const seed = 0xd1ffe ^ Math.imul(size, 2654435761)
      const rand = mulberry32(seed)
      const lambda = 32 + (size / 100) * 268 // base wavelength (bigger = larger clouds)
      const octaves = 5
      const noises: ((x: number, y: number) => number)[] = []
      const amps: number[] = []
      let ampSum = 0
      for (let o = 0; o < octaves; o++) {
        const wl = lambda / (1 << o)
        const gw = Math.max(2, Math.ceil(w / wl) + 1)
        const gh = Math.max(2, Math.ceil(h / wl) + 1)
        noises.push(makeValueNoise(rand, gw, gh))
        const a = Math.pow(0.55, o)
        amps.push(a)
        ampSum += a
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let v = 0
          for (let o = 0; o < octaves; o++) {
            const wl = lambda / (1 << o)
            v += noises[o](x / wl, y / wl) * amps[o]
          }
          const c = clamp((v / ampSum) * 1.42, 0, 1) * 255
          const i = (y * w + x) * 4
          data[i] = Math.abs(data[i] - c)
          data[i + 1] = Math.abs(data[i + 1] - c)
          data[i + 2] = Math.abs(data[i + 2] - c)
        }
      }
    },
  },

  // ---------------------------------------------------------------- other

  'lens-correction': {
    type: 'lens-correction', label: 'Lens Correction', group: 'other',
    controls: [
      { key: 'distortion', label: 'Distortion', type: 'slider', min: -100, max: 100, step: 1 },
      { key: 'vignette', label: 'Vignette', type: 'slider', min: -100, max: 100, step: 1 },
      { key: 'chromatic', label: 'Chromatic Fringe', type: 'slider', min: -20, max: 20, step: 1 },
      { key: 'scale', label: 'Scale', type: 'slider', min: 100, max: 120, step: 1, unit: '%' },
    ],
    defaults: { distortion: 0, vignette: 0, chromatic: 0, scale: 100 },
    apply(img, p) {
      const distortion = clamp(p.distortion ?? 0, -100, 100)
      const vignette = clamp(p.vignette ?? 0, -100, 100)
      const chromatic = clamp(p.chromatic ?? 0, -20, 20)
      const scale = clamp(p.scale ?? 100, 100, 120) / 100
      if (distortion === 0 && vignette === 0 && chromatic === 0 && scale === 1) return
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      const cx = w / 2, cy = h / 2
      const Rn = Math.hypot(cx, cy) // normalization radius (half-diagonal)
      // radial model: image radius r' = r·(1 + k1·r²) (source → image).
      // Inverse-mapped through a precomputed Newton LUT over quantized
      // output radii: r_out → r_src. |k1| ≤ 0.3 keeps the forward map
      // monotonic (1 + 3k1r² ≥ 0.1) so Newton always converges.
      const k1 = (distortion / 100) * 0.3
      const LUT_N = 2049
      const radLut = new Float32Array(LUT_N)
      for (let i = 0; i < LUT_N; i++) {
        const r = (i / (LUT_N - 1)) * 1.02
        let rs = r / (1 + k1 * r * r) // smart init
        for (let it = 0; it < 5; it++) {
          const f = rs * (1 + k1 * rs * rs) - r
          const fp = 1 + 3 * k1 * rs * rs
          rs -= f / Math.max(0.05, fp)
        }
        radLut[i] = clamp(rs, 0, 1.35)
      }
      // lateral chromatic aberration: R/B radii scaled against G by ±c·r²
      const cCh = (chromatic / 20) * 0.05
      const vigAmt = vignette / 100
      const rgb = [0, 0, 0]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = x - cx, dy = y - cy
          // scale > 1 magnifies (sample from a smaller region)
          const ux = dx / scale, uy = dy / scale
          const ur = Math.sqrt(ux * ux + uy * uy)
          const r = ur / Rn
          const o = (y * w + x) * 4
          if (ur >= 1e-6) {
            const idx = clamp(Math.round((r / 1.02) * (LUT_N - 1)), 0, LUT_N - 1)
            const rs = radLut[idx]
            const dirX = ux / ur, dirY = uy / ur
            if (cCh === 0) {
              bilinearRGB(src, w, h, cx + dirX * rs * Rn, cy + dirY * rs * Rn, rgb)
              data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]
            } else {
              const rR = rs * (1 - cCh * rs * rs)
              const rB = rs * (1 + cCh * rs * rs)
              data[o] = bilinearCh(src, w, h, cx + dirX * rR * Rn, cy + dirY * rR * Rn, 0)
              data[o + 1] = bilinearCh(src, w, h, cx + dirX * rs * Rn, cy + dirY * rs * Rn, 1)
              data[o + 2] = bilinearCh(src, w, h, cx + dirX * rB * Rn, cy + dirY * rB * Rn, 2)
            }
          } // center pixel: r = 0 → distortion/chromatic are the identity — leave it
          if (vigAmt !== 0) {
            // positive darkens toward the corners, negative brightens
            const f = 1 - vigAmt * smoothRamp(r, 0.55, 1.08) * 1.05
            data[o] *= f
            data[o + 1] *= f
            data[o + 2] *= f
          }
        }
      }
    },
  },
}
