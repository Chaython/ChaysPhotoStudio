// ============================================================
// Color-space math for the image-ops library.
// Pure functions — no DOM, no engine imports. Output is written
// into caller-provided arrays to keep hot loops allocation-free.
// ============================================================

import { clamp } from '../utils/canvas'

/** Rec.601 luma (matches core.ts histogram / legacy conventions) */
export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

// ---------------- HSV (h: 0..360, s: 0..1, v: 0..1) ----------------
export function rgbToHsv(r: number, g: number, b: number, out: number[]): void {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn)
  const d = mx - mn
  let h = 0
  if (d > 1e-6) {
    if (mx === rn) h = 60 * (((gn - bn) / d) % 6)
    else if (mx === gn) h = 60 * ((bn - rn) / d + 2)
    else h = 60 * ((rn - gn) / d + 4)
  }
  out[0] = (h + 360) % 360
  out[1] = mx > 1e-6 ? d / mx : 0
  out[2] = mx
}

export function hsvToRgb(h: number, s: number, v: number, out: number[]): void {
  h = ((h % 360) + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  out[0] = (r + m) * 255
  out[1] = (g + m) * 255
  out[2] = (b + m) * 255
}

// ---------------- HSL (h: 0..360, s: 0..1, l: 0..1) ----------------
export function rgbToHsl(r: number, g: number, b: number, out: number[]): void {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn)
  const l = (mx + mn) / 2
  const d = mx - mn
  let h = 0, s = 0
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    if (mx === rn) h = 60 * (((gn - bn) / d) % 6)
    else if (mx === gn) h = 60 * ((bn - rn) / d + 2)
    else h = 60 * ((rn - gn) / d + 4)
  }
  out[0] = (h + 360) % 360
  out[1] = s
  out[2] = l
}

export function hslToRgb(h: number, s: number, l: number, out: number[]): void {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  out[0] = (r + m) * 255
  out[1] = (g + m) * 255
  out[2] = (b + m) * 255
}

// ---------------- CIE Lab (D65) ----------------
// sRGB -> linear -> XYZ (D65) -> Lab. Used by colorRange, objectSelect,
// selectSubject (border color model) and color-balance.
const LAB_EPS = 216 / 24389   // 0.008856...
const LAB_K = 24389 / 27      // 903.296...

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055
  return c * 255
}

export function rgbToLab(r: number, g: number, b: number, out: number[]): void {
  const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b)
  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175
  const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) / 1.08883
  const fx = x > LAB_EPS ? Math.cbrt(x) : (LAB_K * x + 16) / 116
  const fy = y > LAB_EPS ? Math.cbrt(y) : (LAB_K * y + 16) / 116
  const fz = z > LAB_EPS ? Math.cbrt(z) : (LAB_K * z + 16) / 116
  out[0] = 116 * fy - 16
  out[1] = 500 * (fx - fy)
  out[2] = 200 * (fy - fz)
}

export function labToRgb(L: number, a: number, bb: number, out: number[]): void {
  const fy = (L + 16) / 116
  const fx = fy + a / 500
  const fz = fy - bb / 200
  const fx3 = fx * fx * fx, fz3 = fz * fz * fz
  const x = (fx3 > LAB_EPS ? fx3 : (116 * fx - 16) / LAB_K) * 0.95047
  const y = (L > LAB_K * LAB_EPS ? Math.pow((L + 16) / 116, 3) : L / LAB_K) * 1.0
  const z = (fz3 > LAB_EPS ? fz3 : (116 * fz - 16) / LAB_K) * 1.08883
  const rl = x * 3.2404542 + y * -1.5371385 + z * -0.4985314
  const gl = x * -0.969266 + y * 1.8760108 + z * 0.041556
  const bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252
  out[0] = clamp(linearToSrgb(rl), 0, 255)
  out[1] = clamp(linearToSrgb(gl), 0, 255)
  out[2] = clamp(linearToSrgb(bl), 0, 255)
}

// ---------------- misc ----------------
export function hexToRgbTriple(hex: string): [number, number, number] {
  let h = (hex ?? '').replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Hue family centers: red 0, yellow 60, green 120, cyan 180, blue 240, magenta 300 */
export const HUE_CENTERS = [0, 60, 120, 180, 240, 300]

/**
 * Soft membership of a hue in one of the 6 families.
 * Full weight within ±16° of the center, fades linearly to 0 at ±44° —
 * matches Photoshop's overlapping plate ranges (orange belongs partly to
 * reds and partly to yellows).
 */
export function hueFamilyWeight(h: number, center: number): number {
  let d = Math.abs(h - center)
  if (d > 180) d = 360 - d
  if (d <= 16) return 1
  if (d >= 44) return 0
  return 1 - (d - 16) / 28
}

/** Fast perceptual distance approximation between two RGB pixels (0..~735). */
export function rgbDist2(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rm = (r1 + r2) * 0.5
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db
}
