// ============================================================
// High-quality blur / resampling primitives for image-ops.
//  - exact-equivalent box decomposition of a gaussian (Kovesi's
//    boxesForGauss) — 3 box passes whose sum matches the true
//    gaussian much better than 3 identical boxes
//  - bilinear sampling / upscaling for masks
// Pure math, no DOM.
// ============================================================

/** ideal box widths so that n box-blurs ≈ a gaussian of sigma */
function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1)
  let wl = Math.floor(wIdeal)
  if (wl % 2 === 0) wl--
  if (wl < 1) wl = 1
  const wu = wl + 2
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)
  const m = Math.round(mIdeal)
  const sizes: number[] = []
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu)
  return sizes
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (r + r + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let i = -r; i <= r; i++) acc += src[row + (i < 0 ? 0 : i > w - 1 ? w - 1 : i)]
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * norm
      const add = x + r + 1
      const sub = x - r
      acc += src[row + (add > w - 1 ? w - 1 : add)] - src[row + (sub < 0 ? 0 : sub)]
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (r + r + 1)
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let i = -r; i <= r; i++) acc += src[(i < 0 ? 0 : i > h - 1 ? h - 1 : i) * w + x]
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * norm
      const add = y + r + 1
      const sub = y - r
      acc += src[(add > h - 1 ? h - 1 : add) * w + x] - src[(sub < 0 ? 0 : sub) * w + x]
    }
  }
}

/**
 * Gaussian blur of a single-channel float buffer, in place-ish:
 * returns the (mutated) input buffer. sigma < 0.4 is a no-op.
 */
export function gaussianBlurFloat(buf: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (!(sigma >= 0.4)) return buf
  const boxes = boxesForGauss(sigma, 3)
  let a = buf
  let b = new Float32Array(buf.length)
  for (const size of boxes) {
    const r = (size - 1) >> 1
    if (r < 1) continue
    boxBlurH(a, b, w, h, r)
    boxBlurV(b, a, w, h, r)
  }
  return a
}

/** Gaussian blur of an ImageData's RGB channels in place (alpha preserved). */
export function blurImageData(img: ImageData, sigma: number): void {
  if (!(sigma >= 0.4)) return
  const { width: w, height: h, data } = img
  const n = w * h
  const ch = new Float32Array(n)
  for (let c = 0; c < 3; c++) {
    for (let i = 0, j = c; i < n; i++, j += 4) ch[i] = data[j]
    gaussianBlurFloat(ch, w, h, sigma)
    for (let i = 0, j = c; i < n; i++, j += 4) data[j] = ch[i]
  }
}

/**
 * Single box blur pass (H + V) of a float buffer — a true box kernel,
 * used by the Box Blur filter (distinct from the gaussian approximation).
 */
export function boxBlurFloat(buf: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return buf
  const tmp = new Float32Array(buf.length)
  boxBlurH(buf, tmp, w, h, r)
  boxBlurV(tmp, buf, w, h, r)
  return buf
}

/** Bilinear sample of a scalar field with clamped edges. */
export function bilinearSample(buf: Float32Array | Uint8ClampedArray | Uint8Array, w: number, h: number, x: number, y: number): number {
  if (x < 0) x = 0
  if (y < 0) y = 0
  if (x > w - 1) x = w - 1
  if (y > h - 1) y = h - 1
  const x0 = x | 0
  const y0 = y | 0
  const x1 = x0 + 1 < w ? x0 + 1 : x0
  const y1 = y0 + 1 < h ? y0 + 1 : y0
  const fx = x - x0
  const fy = y - y0
  const r0 = y0 * w
  const r1 = y1 * w
  const top = buf[r0 + x0] * (1 - fx) + buf[r0 + x1] * fx
  const bot = buf[r1 + x0] * (1 - fx) + buf[r1 + x1] * fx
  return top * (1 - fy) + bot * fy
}

/** Bilinear resample of a scalar field (Uint8ClampedArray in, out). */
export function resampleMask(src: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh)
  const fx = sw / dw
  const fy = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * fy - 0.5
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * fx - 0.5
      out[y * dw + x] = bilinearSample(src, sw, sh, sx, sy)
    }
  }
  return out
}

/** Convert a Uint8 mask to float 0..1 */
export function maskToFloat(mask: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] / 255
  return out
}

/** Sobel gradients of a scalar field; returns {gx, gy} as Float32Arrays. */
export function sobel(src: Float32Array, w: number, h: number): { gx: Float32Array; gy: Float32Array } {
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : 0) * w
    const yp = (y < h - 1 ? y + 1 : h - 1) * w
    const yc = y * w
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : 0
      const xr = x < w - 1 ? x + 1 : w - 1
      const a = src[ym + xl], b = src[ym + x], c = src[ym + xr]
      const d = src[yc + xl], f = src[yc + xr]
      const g = src[yp + xl], hh = src[yp + x], i = src[yp + xr]
      gx[yc + x] = (c + 2 * f + i) - (a + 2 * d + g)
      gy[yc + x] = (g + 2 * hh + i) - (a + 2 * b + c)
    }
  }
  return { gx, gy }
}
