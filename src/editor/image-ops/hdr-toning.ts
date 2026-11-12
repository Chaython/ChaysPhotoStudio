// ============================================================
// HDR Toning — a base/detail tone mapper for high dynamic range
// scenes.
//
// The operation works in linear light: an SDR document is decoded
// from sRGB first, a scene-linear 32-bit document already holds
// linear values and is used as-is.
//
// Two methods are offered:
//
//  * exposure-gamma — a straight exposure and gamma curve, applied
//    per channel. At its neutral settings it changes nothing, which
//    makes it the safe default.
//
//  * local-adaptation — the scene's luminance is split into a "base"
//    layer (a heavily blurred log-luminance field, which carries the
//    overall shape of the scene) and "detail" (the difference). The
//    base is compressed toward its own mean, the detail is boosted,
//    and the scene is re-keyed to the middle-grey level that its own
//    geometric mean luminance defines.
//
// The base/detail split is what makes the second method different
// from a plain exposure curve: a bright window and a dark room can
// end up at similar display levels without the room turning to mud.
//
// The result is deliberately a display-range image: HDR Toning is a
// tone mapper, so highlights above display white are compressed
// rather than preserved.
//
// Pure math — no DOM / engine imports.
// ============================================================

import { clamp } from '../utils/canvas'
import { gaussianBlurFloat } from './blur'
import { isSceneLinearHdr, type PixelImage } from './pixel-data'

export interface HdrToningOptions {
  method: 'local-adaptation' | 'exposure-gamma'
  /** -5..5 stops */
  exposure: number
  /** 0.1..4 — lower means more contrast */
  gamma: number
  /** base-layer radius in pixels (local adaptation) */
  radius: number
  /** base-layer compression (local adaptation) */
  strength: number
  /** -100..300 % */
  detail: number
  /** -100..100 */
  shadow: number
  /** -100..100 */
  highlight: number
  /** -100..100 */
  saturation: number
  /** -100..100 */
  vibrance: number
}

export const HDR_TONING_DEFAULTS: HdrToningOptions = {
  method: 'exposure-gamma',
  exposure: 0,
  gamma: 1,
  radius: 30,
  strength: 0.5,
  detail: 30,
  shadow: 0,
  highlight: 0,
  saturation: 20,
  vibrance: 0,
}

/** keeps the logarithm finite for black pixels */
const EPS = 1e-4

/** Rec.709 luminance of a linear-light triple. */
function linearLuma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** sRGB (0..255) → linear light (0..1). */
function decodeSrgb(v: number): number {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** linear light (0..1) → sRGB (0..255). */
function encodeSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055
  return c * 255
}

/**
 * Apply the tone map to a pixel buffer in place.
 *
 * The buffer is the editor's precision-neutral 0..255 channel scale;
 * a scene-linear 32-bit buffer may hold values above 255, which the
 * tone map compresses into the display range.
 */
export function applyHdrToning(img: PixelImage, opts: HdrToningOptions): void {
  const w = img.width
  const h = img.height
  const n = w * h
  if (!n) return
  const d = img.data
  const sceneLinear = isSceneLinearHdr(img)

  const exposure = Math.pow(2, opts.exposure)
  const invGamma = 1 / clamp(opts.gamma, 0.1, 4)
  const satBase = 1 + opts.saturation / 100
  const vibBase = opts.vibrance / 100

  // ---- read into linear light -------------------------------------
  const lin = new Float32Array(n * 3)
  const logL = new Float32Array(n)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = sceneLinear ? d[i] / 255 : decodeSrgb(d[i])
    const g = sceneLinear ? d[i + 1] / 255 : decodeSrgb(d[i + 1])
    const b = sceneLinear ? d[i + 2] / 255 : decodeSrgb(d[i + 2])
    lin[p * 3] = r
    lin[p * 3 + 1] = g
    lin[p * 3 + 2] = b
    logL[p] = Math.log(Math.max(0, linearLuma(r, g, b)) + EPS)
  }

  // ---- the two methods --------------------------------------------
  let base: Float32Array | null = null
  let mean = 0
  let compress = 1
  const detailGain = 1 + opts.detail / 100

  if (opts.method === 'local-adaptation') {
    base = new Float32Array(logL)
    gaussianBlurFloat(base, w, h, Math.max(0.5, opts.radius / 2))
    let sum = 0
    let count = 0
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      if (d[i + 3] <= 0) continue
      sum += base[p]
      count++
    }
    mean = count ? sum / count : 0
    compress = 1 / (1 + Math.max(0, opts.strength))
  }

  const shadowLift = opts.shadow / 100
  const highlightPull = opts.highlight / 100

  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (d[i + 3] <= 0) continue
    const r = lin[p * 3]
    const g = lin[p * 3 + 1]
    const b = lin[p * 3 + 2]

    let or: number
    let og: number
    let ob: number

    if (base) {
      // base/detail reconstruction in log luminance
      const l0 = Math.max(0, linearLuma(r, g, b)) + EPS
      const newLog = mean + (base[p] - mean) * compress + (logL[p] - base[p]) * detailGain
      let l1 = Math.pow(Math.max(0, Math.exp(newLog) * exposure), invGamma)
      // shadow lift and highlight roll-off, both eased so the ends
      // of the range are touched gently
      l1 += shadowLift * Math.pow(Math.max(0, 1 - l1), 3) * 0.5
      l1 -= highlightPull * Math.pow(Math.max(0, l1), 3) * 0.5
      l1 = clamp(l1, 0, 1)
      const ratio = l1 / l0
      or = r * ratio
      og = g * ratio
      ob = b * ratio
    } else {
      or = Math.pow(Math.max(0, r * exposure), invGamma)
      og = Math.pow(Math.max(0, g * exposure), invGamma)
      ob = Math.pow(Math.max(0, b * exposure), invGamma)
      const l1 = clamp(Math.max(or, og, ob), 0, 1)
      if (l1 !== Math.max(or, og, ob)) {
        // keep the relationship between the channels when the curve
        // pushes the brightest one past display white
        const k = l1 / Math.max(or, og, ob)
        or *= k; og *= k; ob *= k
      }
    }

    // saturation, then vibrance (less saturated colours move more)
    const lNew = linearLuma(or, og, ob)
    const mx = Math.max(or, og, ob)
    const mn = Math.min(or, og, ob)
    const satNow = mx > 0 ? (mx - mn) / mx : 0
    const s = Math.max(0, satBase + vibBase * (1 - satNow))
    or = lNew + (or - lNew) * s
    og = lNew + (og - lNew) * s
    ob = lNew + (ob - lNew) * s

    if (sceneLinear) {
      d[i] = clamp(or * 255, 0, 255)
      d[i + 1] = clamp(og * 255, 0, 255)
      d[i + 2] = clamp(ob * 255, 0, 255)
    } else {
      d[i] = clamp(encodeSrgb(or), 0, 255)
      d[i + 1] = clamp(encodeSrgb(og), 0, 255)
      d[i + 2] = clamp(encodeSrgb(ob), 0, 255)
    }
  }
}
