import { createPixelImageLike, type PixelImage } from './pixel-data'
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

// ---------------------------------------------------------------- scratch

/**
 * The transposed column pass works on a strip of columns that has to
 * stay cache-resident, so the scratch buffers are sized for a strip
 * rather than for the whole image and are reused between calls. The
 * blur runs are synchronous, so one pair of buffers is enough.
 */
const STRIP_BYTES = 64 * 1024

/** the RGB kernel carries three channels per column, so its scratch
 *  holds three times as many floats per column — the budget is the
 *  same, which means a narrower strip */
const STRIP_BYTES_RGB = 64 * 1024

let scratchABuf: Float32Array | null = null
let scratchBBuf: Float32Array | null = null

function scratchA(n: number): Float32Array {
  if (!scratchABuf || scratchABuf.length < n) scratchABuf = new Float32Array(n)
  return scratchABuf
}

function scratchB(n: number): Float32Array {
  if (!scratchBBuf || scratchBBuf.length < n) scratchBBuf = new Float32Array(n)
  return scratchBBuf
}

/**
 * Horizontal box blur of one float plane.
 *
 * The running sum is split into three regions. The left edge clamps
 * the first `r` taps and the right edge clamps the last `r` taps, but
 * the middle of a line needs no clamping at all — so the interior runs
 * without a bounds test per sample, while the two ends keep the exact
 * edge behaviour.
 *
 * The accumulation order is unchanged, so the result is bit-identical
 * to a uniformly clamped walk.
 */
function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (r + r + 1)
  const last = w - 1
  // x < headEnd  -> the left tap is clamped
  // x >= tailStart -> the right tap is clamped
  // headEnd <= tailStart keeps the three regions in order, so a radius
  // wider than the line simply leaves the middle empty
  const headEnd = Math.min(r, w)
  const tailStart = Math.max(headEnd, w - 1 - r)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let i = -r; i <= r; i++) acc += src[row + (i < 0 ? 0 : i > last ? last : i)]
    for (let x = 0; x < headEnd; x++) {
      dst[row + x] = acc * norm
      const add = x + r + 1
      const sub = x - r
      acc += src[row + (add > last ? last : add)] - src[row + (sub < 0 ? 0 : sub)]
    }
    for (let x = headEnd; x < tailStart; x++) {
      dst[row + x] = acc * norm
      acc += src[row + x + r + 1] - src[row + x - r]
    }
    for (let x = tailStart; x < w; x++) {
      dst[row + x] = acc * norm
      const add = x + r + 1
      const sub = x - r
      acc += src[row + (add > last ? last : add)] - src[row + (sub < 0 ? 0 : sub)]
    }
  }
}

/**
 * Vertical box blur of one float plane.
 *
 * Walking one column at a time means every sample sits `w` floats
 * apart, so each 64-byte cache line fetched delivers four useful
 * bytes. Instead a strip of neighbouring columns is gathered into a
 * transposed scratch first: the gather reads each source line once for
 * the whole strip, and the running sum then walks contiguous memory.
 *
 * The scratch is sized to stay cache-resident; a strip narrower than
 * two columns falls back to the plain strided walk, where the gather
 * would cost more than it saves.
 */
function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (r + r + 1)
  const lastY = h - 1
  const strip = Math.max(1, Math.min(w, Math.floor(STRIP_BYTES / (4 * Math.max(1, h)))))
  if (strip < 2) {
    // narrow images: the strided walk is fine
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -r; i <= r; i++) acc += src[(i < 0 ? 0 : i > lastY ? lastY : i) * w + x]
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = acc * norm
        const add = y + r + 1
        const sub = y - r
        acc += src[(add > lastY ? lastY : add) * w + x] - src[(sub < 0 ? 0 : sub) * w + x]
      }
    }
    return
  }
  const need = strip * h
  const gathered = scratchA(need)
  const summed = scratchB(need)
  for (let x0 = 0; x0 < w; x0 += strip) {
    const cols = Math.min(strip, w - x0)
    // gather: one contiguous read per row for the whole strip
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let c = 0; c < cols; c++) gathered[c * h + y] = src[row + x0 + c]
    }
    // running sum over contiguous runs of the scratch
    for (let c = 0; c < cols; c++) {
      const base = c * h
      let acc = 0
      for (let i = -r; i <= r; i++) acc += gathered[base + (i < 0 ? 0 : i > lastY ? lastY : i)]
      for (let y = 0; y < h; y++) {
        summed[base + y] = acc * norm
        const add = y + r + 1
        const sub = y - r
        acc += gathered[base + (add > lastY ? lastY : add)] - gathered[base + (sub < 0 ? 0 : sub)]
      }
    }
    // write back
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let c = 0; c < cols; c++) dst[row + x0 + c] = summed[c * h + y]
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

/**
 * Horizontal box blur of an interleaved RGB float plane.
 *
 * Same running sum as the single-channel kernel, but the three colour
 * accumulators advance together: the plane is walked once instead of
 * three times, and the three taps of a pixel sit next to each other in
 * memory.
 */
function boxBlurHRgb(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (r + r + 1)
  const last = w - 1
  const headEnd = Math.min(r, w)
  const tailStart = Math.max(headEnd, w - 1 - r)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let ar = 0
    let ag = 0
    let ab = 0
    for (let i = -r; i <= r; i++) {
      const p = (row + (i < 0 ? 0 : i > last ? last : i)) * 3
      ar += src[p]
      ag += src[p + 1]
      ab += src[p + 2]
    }
    for (let x = 0; x < headEnd; x++) {
      const o = (row + x) * 3
      dst[o] = ar * norm
      dst[o + 1] = ag * norm
      dst[o + 2] = ab * norm
      const add = (x + r + 1) > last ? last : x + r + 1
      const sub = (x - r) < 0 ? 0 : x - r
      const pa = (row + add) * 3
      const ps = (row + sub) * 3
      ar += src[pa] - src[ps]
      ag += src[pa + 1] - src[ps + 1]
      ab += src[pa + 2] - src[ps + 2]
    }
    for (let x = headEnd; x < tailStart; x++) {
      const o = (row + x) * 3
      dst[o] = ar * norm
      dst[o + 1] = ag * norm
      dst[o + 2] = ab * norm
      const pa = (row + x + r + 1) * 3
      const ps = (row + x - r) * 3
      ar += src[pa] - src[ps]
      ag += src[pa + 1] - src[ps + 1]
      ab += src[pa + 2] - src[ps + 2]
    }
    for (let x = tailStart; x < w; x++) {
      const o = (row + x) * 3
      dst[o] = ar * norm
      dst[o + 1] = ag * norm
      dst[o + 2] = ab * norm
      const add = (x + r + 1) > last ? last : x + r + 1
      const sub = (x - r) < 0 ? 0 : x - r
      const pa = (row + add) * 3
      const ps = (row + sub) * 3
      ar += src[pa] - src[ps]
      ag += src[pa + 1] - src[ps + 1]
      ab += src[pa + 2] - src[ps + 2]
    }
  }
}

/**
 * Vertical box blur of an interleaved RGB float plane, with the same
 * transposed-strip gather as the single-channel kernel. The scratch
 * holds one contiguous run per (column, channel).
 */
function boxBlurVRgb(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (r + r + 1)
  const lastY = h - 1
  const strip = Math.max(1, Math.min(w, Math.floor(STRIP_BYTES_RGB / (12 * Math.max(1, h)))))
  if (strip < 2) {
    for (let x = 0; x < w; x++) {
      const p0 = x * 3
      let ar = 0
      let ag = 0
      let ab = 0
      for (let i = -r; i <= r; i++) {
        const p = (i < 0 ? 0 : i > lastY ? lastY : i) * w * 3 + p0
        ar += src[p]
        ag += src[p + 1]
        ab += src[p + 2]
      }
      for (let y = 0; y < h; y++) {
        const o = (y * w + x) * 3
        dst[o] = ar * norm
        dst[o + 1] = ag * norm
        dst[o + 2] = ab * norm
        const add = (y + r + 1) > lastY ? lastY : y + r + 1
        const sub = (y - r) < 0 ? 0 : y - r
        const pa = (add * w + x) * 3
        const ps = (sub * w + x) * 3
        ar += src[pa] - src[ps]
        ag += src[pa + 1] - src[ps + 1]
        ab += src[pa + 2] - src[ps + 2]
      }
    }
    return
  }
  const need = strip * 3 * h
  const gathered = scratchA(need)
  const summed = scratchB(need)
  for (let x0 = 0; x0 < w; x0 += strip) {
    const cols = Math.min(strip, w - x0)
    // gather: one contiguous read per row for the whole strip
    for (let y = 0; y < h; y++) {
      const row = y * w * 3
      for (let c = 0; c < cols; c++) {
        const s = (row + (x0 + c) * 3)
        const g = c * 3 * h + y
        gathered[g] = src[s]
        gathered[g + h] = src[s + 1]
        gathered[g + 2 * h] = src[s + 2]
      }
    }
    // running sum over contiguous runs of the scratch
    for (let c = 0; c < cols; c++) {
      for (let ch = 0; ch < 3; ch++) {
        const base = c * 3 * h + ch * h
        let acc = 0
        for (let i = -r; i <= r; i++) acc += gathered[base + (i < 0 ? 0 : i > lastY ? lastY : i)]
        for (let y = 0; y < h; y++) {
          summed[base + y] = acc * norm
          const add = (y + r + 1) > lastY ? lastY : y + r + 1
          const sub = (y - r) < 0 ? 0 : y - r
          acc += gathered[base + add] - gathered[base + sub]
        }
      }
    }
    // write back
    for (let y = 0; y < h; y++) {
      const row = y * w * 3
      for (let c = 0; c < cols; c++) {
        const d = row + (x0 + c) * 3
        const g = c * 3 * h + y
        dst[d] = summed[g]
        dst[d + 1] = summed[g + h]
        dst[d + 2] = summed[g + 2 * h]
      }
    }
  }
}

/**
 * Gaussian blur of an interleaved RGB float plane, in place.
 * sigma < 0.4 is a no-op.
 */
function gaussianBlurRgbFloat(plane: Float32Array, w: number, h: number, sigma: number): void {
  if (!(sigma >= 0.4)) return
  const boxes = boxesForGauss(sigma, 3)
  const tmp = new Float32Array(plane.length)
  for (const size of boxes) {
    const r = (size - 1) >> 1
    if (r < 1) continue
    boxBlurHRgb(plane, tmp, w, h, r)
    boxBlurVRgb(tmp, plane, w, h, r)
  }
}

/** Exact full-resolution RGB blur used for small images/radii. */
function blurImageDataExact(img: PixelImage, sigma: number): void {
  const { width: w, height: h, data } = img
  const n = w * h
  // one interleaved plane for the three colour channels, so the blur
  // walks the image once instead of once per channel
  const plane = new Float32Array(n * 3)
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    plane[i * 3] = data[j]
    plane[i * 3 + 1] = data[j + 1]
    plane[i * 3 + 2] = data[j + 2]
  }
  gaussianBlurRgbFloat(plane, w, h, sigma)
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    data[j] = plane[i * 3]
    data[j + 1] = plane[i * 3 + 1]
    data[j + 2] = plane[i * 3 + 2]
  }
}

/**
 * Choose a conservative power-of-two proxy scale for large Gaussian blurs.
 * A broad blur does not need every source pixel to be processed at full
 * resolution. Keeping the low-resolution sigma >= ~2 px avoids visible
 * blockiness while cutting the expensive box passes by 4-64x.
 */
function blurProxyScale(w: number, h: number, sigma: number): number {
  const pixels = w * h
  if (pixels < 4_000_000 || sigma < 3.5) return 1
  const maxBySigma = sigma >= 32 ? 8 : sigma >= 14 ? 4 : 2
  let scale = 1
  while (
    scale < maxBySigma &&
    scale < 8 &&
    pixels / (scale * scale) > 4_000_000
  ) scale *= 2
  return scale
}

/** Area-average RGB downsample. Alpha is intentionally ignored: final alpha
 * is preserved from the original ImageData exactly, matching the old blur. */
function downsampleBlurProxy(img: PixelImage, scale: number): PixelImage {
  const sw = img.width, sh = img.height
  const dw = Math.max(1, Math.ceil(sw / scale))
  const dh = Math.max(1, Math.ceil(sh / scale))
  const out = createPixelImageLike(img, dw, dh)
  const src = img.data, dst = out.data
  for (let y = 0; y < dh; y++) {
    const y0 = y * scale
    const y1 = Math.min(sh, y0 + scale)
    for (let x = 0; x < dw; x++) {
      const x0 = x * scale
      const x1 = Math.min(sw, x0 + scale)
      let r = 0, g = 0, b = 0, count = 0
      for (let sy = y0; sy < y1; sy++) {
        let i = (sy * sw + x0) * 4
        for (let sx = x0; sx < x1; sx++, i += 4) {
          r += src[i]; g += src[i + 1]; b += src[i + 2]; count++
        }
      }
      const o = (y * dw + x) * 4
      const inv = count ? 1 / count : 1
      dst[o] = r * inv
      dst[o + 1] = g * inv
      dst[o + 2] = b * inv
      dst[o + 3] = 255
    }
  }
  return out
}

/** Bilinear RGB upsample back into the original image; alpha is untouched. */
function upsampleBlurProxy(proxy: PixelImage, target: PixelImage): void {
  const sw = proxy.width, sh = proxy.height
  const dw = target.width, dh = target.height
  const src = proxy.data, dst = target.data
  const sxScale = sw / dw
  const syScale = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = Math.max(0, Math.min(sh - 1, (y + 0.5) * syScale - 0.5))
    const y0 = sy | 0
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = Math.max(0, Math.min(sw - 1, (x + 0.5) * sxScale - 0.5))
      const x0 = sx | 0
      const x1 = Math.min(sw - 1, x0 + 1)
      const fx = sx - x0
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      const o = (y * dw + x) * 4
      for (let ch = 0; ch < 3; ch++) {
        const top = src[i00 + ch] + (src[i10 + ch] - src[i00 + ch]) * fx
        const bot = src[i01 + ch] + (src[i11 + ch] - src[i01 + ch]) * fx
        dst[o + ch] = top + (bot - top) * fy
      }
    }
  }
}

/**
 * Gaussian blur of an ImageData's RGB channels in place (alpha preserved).
 * Large/broad blurs use a conservative downsampled proxy so a 20-50 MP image
 * cannot turn into hundreds of millions of JS pixel operations.
 */
export function blurImageData(img: PixelImage, sigma: number): void {
  if (!(sigma >= 0.4)) return
  const scale = blurProxyScale(img.width, img.height, sigma)
  if (scale === 1) {
    blurImageDataExact(img, sigma)
    return
  }
  const proxy = downsampleBlurProxy(img, scale)
  blurImageDataExact(proxy, sigma / scale)
  upsampleBlurProxy(proxy, img)
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
