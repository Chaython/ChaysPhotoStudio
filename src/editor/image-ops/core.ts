// Core image processing primitives used by the engine itself (selection feather, wand, etc.)
// The full adjustment/filter library lives in image-ops/index.ts (registry).
// NOTE: owned by the lead agent — worker-safe, no DOM deps beyond ImageData.

import { clamp } from '../utils/canvas'

type Arr = Uint8ClampedArray | Uint16Array | Float32Array

// ---------- separable box blur helpers (on arbitrary numeric arrays) ----------
function boxBlurPassH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const norm = 1 / (r * 2 + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let i = -r; i <= r; i++) acc += src[row + clamp(i, 0, w - 1)]
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * norm
      acc += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)]
    }
  }
}

function boxBlurPassV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const norm = 1 / (r * 2 + 1)
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let i = -r; i <= r; i++) acc += src[clamp(i, 0, h - 1) * w + x]
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * norm
      acc += src[clamp(y + r + 1, 0, h - 1) * w + x] - src[clamp(y - r, 0, h - 1) * w + x]
    }
  }
}

/** Gaussian blur approximation (3 box passes) on a single-channel float buffer */
export function gaussianBlurChannel(buf: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius < 0.5) return buf
  const r = Math.max(1, Math.round(radius))
  let a = Float32Array.from(buf)
  let b = new Float32Array(buf.length)
  for (let p = 0; p < 3; p++) {
    boxBlurPassH(a, b, w, h, r); boxBlurPassV(b, a, w, h, r)
  }
  return a
}

/** Gaussian blur on an ImageData (alpha preserved, RGB blurred) */
export function gaussianBlurImage(img: ImageData, radius: number) {
  if (radius < 0.5) return
  const { width: w, height: h, data } = img
  const ch = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let c = 0; c < 3; c++) {
    for (let i = 0, j = c; i < ch.length; i++, j += 4) ch[i] = data[j]
    const blurred = gaussianBlurChannel(ch, w, h, radius)
    for (let i = 0, j = c; i < out.length; i++, j += 4) data[j] = blurred[i]
  }
}

// ---------- morphology (on alpha mask arrays) ----------
function morphPassH(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number, max: boolean) {
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let v = max ? 0 : 255
      const lo = Math.max(0, x - r), hi = Math.min(w - 1, x + r)
      for (let i = lo; i <= hi; i++) {
        const s = src[row + i]
        if (max ? s > v : s < v) v = s
      }
      dst[row + x] = v
    }
  }
}

function morphPassV(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number, max: boolean) {
  for (let y = 0; y < h; y++) {
    const lo = Math.max(0, y - r), hi = Math.min(h - 1, y + r)
    for (let x = 0; x < w; x++) {
      let v = max ? 0 : 255
      for (let i = lo; i <= hi; i++) {
        const s = src[i * w + x]
        if (max ? s > v : s < v) v = s
      }
      dst[y * w + x] = v
    }
  }
}

function morph(alpha: Uint8ClampedArray, w: number, h: number, r: number, max: boolean): Uint8ClampedArray {
  if (r < 1) return alpha
  const tmp = new Uint8ClampedArray(alpha.length)
  const out = new Uint8ClampedArray(alpha.length)
  morphPassH(alpha, tmp, w, h, r, max)
  morphPassV(tmp, out, w, h, r, max)
  return out
}

export const dilateMask = (a: Uint8ClampedArray, w: number, h: number, r: number) => morph(a, w, h, r, true)
export const erodeMask = (a: Uint8ClampedArray, w: number, h: number, r: number) => morph(a, w, h, r, false)

/** grow (+) / shrink (-) a mask by px with rounding */
export function shiftMask(alpha: Uint8ClampedArray, w: number, h: number, px: number): Uint8ClampedArray {
  if (px === 0) return alpha
  if (px > 0) return dilateMask(alpha, w, h, Math.round(px))
  return erodeMask(alpha, w, h, Math.round(-px))
}

/** smooth mask = blur then threshold at 128 */
export function smoothMask(alpha: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  const f = new Float32Array(alpha.length)
  for (let i = 0; i < alpha.length; i++) f[i] = alpha[i]
  const blurred = gaussianBlurChannel(f, w, h, radius)
  const out = new Uint8ClampedArray(alpha.length)
  for (let i = 0; i < alpha.length; i++) out[i] = clamp(Math.round((blurred[i] - 96) * 255 / 63), 0, 255)
  return out
}

// ---------- threshold helper (Otsu) ----------
export function otsuThreshold(hist: Uint32Array, total: number): number {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, maxVar = 0, threshold = 128
  for (let i = 0; i < 256; i++) {
    wB += hist[i]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += i * hist[i]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const v = wB * wF * (mB - mF) * (mB - mF)
    if (v > maxVar) { maxVar = v; threshold = i }
  }
  return threshold
}

// ---------- flood fill (magic wand core) ----------
export interface FloodOptions {
  tolerance: number      // 0..255 — Photoshop-style: max per-channel delta from the seed color
  contiguous: boolean
  antiAlias?: boolean    // 1px soft-edge band on selection edges (partial mask alpha)
  diagonal?: boolean     // contiguous only: 8-connected fill (includes diagonal neighbors)
}

/**
 * Flood fill powering the Magic Wand and the Paint Bucket.
 *
 * ACCURACY — Photoshop-style tolerance: a pixel is "inside" iff the MAXIMUM
 * per-channel difference from the SEED pixel's rgba is <= tolerance, so
 * "tolerance 32" ≈ ±32 per channel and 0 is an exact color match.
 *
 * SPEED — contiguous fills use a Heckbert scanline (span) fill: whole runs are
 * filled per step, only run-entry seeds are stacked, and the mask itself is the
 * visited map (no separate seen array). Several times faster than a per-pixel
 * 4-way stack on multi-megapixel images.
 *
 * ANTI-ALIAS — with opts.antiAlias (and tolerance > 0) one extra pass adds a
 * 1px transition band: pixels just outside the selection that touch it
 * (4-connected) and whose color distance to the seed is within 2× tolerance
 * get partial mask alpha, ramping 255 → 1 as the distance goes tol → 2·tol.
 * Tolerance 0 keeps hard edges.
 *
 * @returns a mask (w*h, 0..255, 255 = fully selected) of pixels similar to the
 * seed color, restricted to the optional bounds.
 */
export function floodFillMask(
  img: ImageData, sx: number, sy: number, opts: FloodOptions,
  bounds?: { x: number; y: number; w: number; h: number }
): Uint8ClampedArray {
  const { width: w, height: h, data } = img
  const mask = new Uint8ClampedArray(w * h)

  // effective region = bounds ∩ image (right/bottom edges exclusive)
  const bx = bounds ? Math.max(0, bounds.x) : 0
  const by = bounds ? Math.max(0, bounds.y) : 0
  const ex = bounds ? Math.min(w, bounds.x + bounds.w) : w
  const ey = bounds ? Math.min(h, bounds.y + bounds.h) : h
  if (ex <= bx || ey <= by) return mask

  // the seed must land inside the region, otherwise nothing is selectable
  const x0 = Math.round(sx), y0 = Math.round(sy)
  if (x0 < bx || x0 >= ex || y0 < by || y0 >= ey) return mask

  // seed color + tolerance hoisted into locals. The inside test is inlined at
  // every use site (no per-pixel closure calls) as:
  //   inside(i) ⟺ max(|data[i+c] - seed[c]|) <= tol
  // written as the short-circuiting comparisons  d > tol || d < -tol  per channel.
  const si = (y0 * w + x0) * 4
  const sr = data[si], sg = data[si + 1], sb = data[si + 2], sa = data[si + 3]
  let tol = opts.tolerance
  tol = tol > 0 ? (tol < 255 ? tol : 255) : 0 // also maps NaN → 0
  const diagonal = opts.diagonal === true

  // tight bbox of the base (255) mask, tracked while filling so the anti-alias
  // pass can skip the empty area entirely
  let mnX = ex, mxX = -1, mnY = ey, mxY = -1

  if (!opts.contiguous) {
    // ---- non-contiguous: single pass over the whole region ----
    for (let y = by; y < ey; y++) {
      const row = y * w
      let rMin = -1, rMax = -1
      for (let x = bx; x < ex; x++) {
        const i = (row + x) * 4
        const dr = data[i] - sr, dg = data[i + 1] - sg, db = data[i + 2] - sb, da = data[i + 3] - sa
        if (dr > tol || dr < -tol || dg > tol || dg < -tol || db > tol || db < -tol || da > tol || da < -tol) continue
        mask[row + x] = 255
        if (rMin < 0) rMin = x
        rMax = x
      }
      if (rMin >= 0) {
        if (rMin < mnX) mnX = rMin
        if (rMax > mxX) mxX = rMax
        if (y < mnY) mnY = y
        mxY = y
      }
    }
  } else {
    // ---- contiguous: Heckbert scanline span fill ----
    // Stack of (x, y) run-entry seeds. The mask doubles as the visited map:
    // mask[p] !== 0 means p's whole run was already filled, so duplicate seeds
    // are simply skipped. Runs are invariantly filled in full, so an unfilled
    // inside pixel can never sit next to a filled one on the same row.
    const stack: number[] = [x0, y0]
    while (stack.length) {
      const y = stack.pop()!, x = stack.pop()!
      const row = y * w
      if (mask[row + x] !== 0) continue
      // 1) expand the run left while inside
      let xL = x
      while (xL > bx) {
        const i = (row + xL - 1) * 4
        const dr = data[i] - sr, dg = data[i + 1] - sg, db = data[i + 2] - sb, da = data[i + 3] - sa
        if (dr > tol || dr < -tol || dg > tol || dg < -tol || db > tol || db < -tol || da > tol || da < -tol) break
        xL--
      }
      // 2) expand the run right while inside
      let xR = x
      while (xR + 1 < ex) {
        const i = (row + xR + 1) * 4
        const dr = data[i] - sr, dg = data[i + 1] - sg, db = data[i + 2] - sb, da = data[i + 3] - sa
        if (dr > tol || dr < -tol || dg > tol || dg < -tol || db > tol || db < -tol || da > tol || da < -tol) break
        xR++
      }
      // 3) fill the whole span
      for (let q = row + xL; q <= row + xR; q++) mask[q] = 255
      if (xL < mnX) mnX = xL
      if (xR > mxX) mxX = xR
      if (y < mnY) mnY = y
      if (y > mxY) mxY = y
      // 4) seed new runs on the rows above and below. 4-connected scans the
      //    run's own column span [xL, xR]; 8-connected (diagonal) widens it by
      //    one column on each side — seeding the x±1 run-boundary neighbors,
      //    the classic 8-connected scanline variant.
      const lo = diagonal ? (xL > bx ? xL - 1 : bx) : xL
      const hi = diagonal ? (xR + 1 < ex ? xR + 1 : ex - 1) : xR
      for (let dir = -1; dir <= 1; dir += 2) {
        const y2 = y + dir
        if (y2 < by || y2 >= ey) continue
        const row2 = y2 * w
        let xx = lo
        while (xx <= hi) {
          const q = row2 + xx
          if (mask[q] === 0) {
            const i = q * 4
            const dr = data[i] - sr, dg = data[i + 1] - sg, db = data[i + 2] - sb, da = data[i + 3] - sa
            if (!(dr > tol || dr < -tol || dg > tol || dg < -tol || db > tol || db < -tol || da > tol || da < -tol)) {
              stack.push(xx, y2)
              // skip the rest of this run so it is seeded only once
              xx++
              while (xx <= hi) {
                const j = (row2 + xx) * 4
                const dr2 = data[j] - sr, dg2 = data[j + 1] - sg, db2 = data[j + 2] - sb, da2 = data[j + 3] - sa
                if (dr2 > tol || dr2 < -tol || dg2 > tol || dg2 < -tol || db2 > tol || db2 < -tol || da2 > tol || da2 < -tol) break
                xx++
              }
              continue
            }
          }
          xx++
        }
      }
    }
  }

  // ---- anti-aliased soft edge: 1px partial-alpha band around the selection ----
  // Only pixels NOT selected that have a 4-neighbor at full 255 (the base mask
  // is pure 0/255 here — comparing against 255 keeps the band exactly 1px wide
  // instead of cascading through pixels softened by this very pass).
  if (opts.antiAlias === true && tol > 0 && mxX >= mnX) {
    const loX = Math.max(bx, mnX - 1), hiX = Math.min(ex - 1, mxX + 1)
    const loY = Math.max(by, mnY - 1), hiY = Math.min(ey - 1, mxY + 1)
    const tol2 = tol + tol
    const k = 255 / tol // alpha ramp: dist tol → 255, dist 2·tol → 0
    for (let y = loY; y <= hiY; y++) {
      const row = y * w
      for (let x = loX; x <= hiX; x++) {
        const p = row + x
        if (mask[p] !== 0) continue
        if ((x > 0 && mask[p - 1] === 255) || (x < w - 1 && mask[p + 1] === 255) ||
            (y > 0 && mask[p - w] === 255) || (y < h - 1 && mask[p + w] === 255)) {
          const i = p * 4
          const dr = Math.abs(data[i] - sr), dg = Math.abs(data[i + 1] - sg)
          const db = Math.abs(data[i + 2] - sb), da = Math.abs(data[i + 3] - sa)
          let dist = dr > dg ? dr : dg
          if (db > dist) dist = db
          if (da > dist) dist = da
          if (dist > tol2) continue
          // linear ramp over (tol, 2·tol]; dist <= tol cannot occur here (such
          // pixels are already inside the selection) but the clamp guards it
          let v = Math.round(255 - (dist - tol) * k)
          if (v < 1) v = 1
          else if (v > 254) v = 254
          mask[p] = v
        }
      }
    }
  }
  return mask
}

// ---------- convolution ----------
export function convolve3x3(img: ImageData, kernel: number[], divisor = 1, offset = 0) {
  const { width: w, height: h, data } = img
  const src = new Uint8ClampedArray(data)
  const side = 3, half = 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0
      for (let ky = 0; ky < side; ky++) {
        const yy = clamp(y + ky - half, 0, h - 1)
        for (let kx = 0; kx < side; kx++) {
          const xx = clamp(x + kx - half, 0, w - 1)
          const k = kernel[ky * side + kx]
          if (!k) continue
          const i = (yy * w + xx) * 4
          r += src[i] * k; g += src[i + 1] * k; b += src[i + 2] * k
        }
      }
      const o = (y * w + x) * 4
      data[o] = clamp(r / divisor + offset, 0, 255)
      data[o + 1] = clamp(g / divisor + offset, 0, 255)
      data[o + 2] = clamp(b / divisor + offset, 0, 255)
    }
  }
}

// ---------- histogram ----------
export interface Histogram { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array; total: number }
export function computeHistogram(img: ImageData): Histogram {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256)
  const d = img.data
  let total = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue
    r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++
    l[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++
    total++
  }
  return { r, g, b, l, total }
}

// ---------- downsample (box) for analysis ----------
export function downsampleImage(img: ImageData, maxDim: number): ImageData {
  const { width: w, height: h } = img
  const scale = Math.min(1, maxDim / Math.max(w, h))
  if (scale >= 1) return img
  const nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale))
  const out = new ImageData(nw, nh)
  const fx = w / nw, fy = h / nh
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.min(w, Math.floor((x + 1) * fx))
      const y0 = Math.floor(y * fy), y1 = Math.min(h, Math.floor((y + 1) * fy))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; a += img.data[i + 3]; n++
        }
      }
      if (n > 0) { r /= n; g /= n; b /= n; a /= n }
      const o = (y * nw + x) * 4
      out.data[o] = r; out.data[o + 1] = g; out.data[o + 2] = b; out.data[o + 3] = a
    }
  }
  return out
}

/** bilinear sample from ImageData */
export function sampleImage(img: ImageData, x: number, y: number, out: number[] = []): number[] {
  const { width: w, height: h, data } = img
  x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1)
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4
  for (let c = 0; c < 4; c++) {
    const top = data[i00 + c] * (1 - fx) + data[i10 + c] * fx
    const bot = data[i01 + c] * (1 - fx) + data[i11 + c] * fx
    out[c] = top * (1 - fy) + bot * fy
  }
  return out
}
