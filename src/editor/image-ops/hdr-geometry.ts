/**
 * Lossless (in value precision) transforms for scene-linear Float32 raster data.
 * RGBA values are not clamped to SDR white. Every operation returns a new buffer.
 */
function check(pixels: Float32Array, width: number, height: number) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1 ||
      pixels.length !== width * height * 4) {
    throw new Error('Invalid HDR geometry or pixel buffer')
  }
}

export function cropHdrPixels(
  src: Float32Array, sw: number, sh: number,
  w: number, h: number, sourceX: number, sourceY: number,
): Float32Array {
  check(src, sw, sh)
  const out = new Float32Array(w * h * 4)
  const ox = Math.round(sourceX), oy = Math.round(sourceY)
  for (let y = 0; y < h; y++) {
    const sy = y + oy
    if (sy < 0 || sy >= sh) continue
    const start = Math.max(0, -ox)
    const end = Math.min(w, sw - ox)
    if (end <= start) continue
    const offset = (sy * sw + ox + start) * 4
    out.set(src.subarray(offset, offset + (end - start) * 4), (y * w + start) * 4)
  }
  return out
}

export function flipHdrPixels(src: Float32Array, w: number, h: number, axis: 'horizontal' | 'vertical'): Float32Array {
  check(src, w, h)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = axis === 'horizontal' ? w - 1 - x : x
    const sy = axis === 'vertical' ? h - 1 - y : y
    out.set(src.subarray((sy * w + sx) * 4, (sy * w + sx + 1) * 4), (y * w + x) * 4)
  }
  return out
}

/** Quarter turns use exact index permutations: no interpolation or HDR loss. */
export function rotateHdrPixels(src: Float32Array, w: number, h: number, degrees: number): Float32Array {
  check(src, w, h)
  const turn = ((degrees % 360) + 360) % 360
  if (turn !== 0 && turn !== 90 && turn !== 180 && turn !== 270) {
    throw new Error('Only quarter turns preserve HDR pixels without resampling')
  }
  const outW = turn % 180 ? h : w
  const outH = turn % 180 ? w : h
  const out = new Float32Array(src.length)
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const sx = turn === 90 ? y : turn === 180 ? w - 1 - x : turn === 270 ? w - 1 - y : x
    const sy = turn === 90 ? h - 1 - x : turn === 180 ? h - 1 - y : turn === 270 ? x : y
    out.set(src.subarray((sy * w + sx) * 4, (sy * w + sx + 1) * 4), (y * outW + x) * 4)
  }
  return out
}

/** Bilinear scene-linear resampling with premultiplied-alpha interpolation.
 * Keeps HDR channels >1 and avoids color halos on transparent boundaries. */
export function resampleHdrPixels(src: Float32Array, sw: number, sh: number, w: number, h: number): Float32Array {
  check(src, sw, sh)
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) throw new Error('Invalid HDR output size')
  if (w === sw && h === sh) return new Float32Array(src)
  const out = new Float32Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(sh - 1, (y + .5) * sh / h - .5))
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(sw - 1, (x + .5) * sw / w - .5))
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0
      const indices = [(y0 * sw + x0) * 4, (y0 * sw + x1) * 4, (y1 * sw + x0) * 4, (y1 * sw + x1) * 4]
      const weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty]
      const outIndex = (y * w + x) * 4
      let alpha = 0
      for (let j = 0; j < 4; j++) alpha += src[indices[j] + 3] * weights[j]
      out[outIndex + 3] = alpha
      if (alpha <= 1e-12) continue
      for (let channel = 0; channel < 3; channel++) {
        let value = 0
        for (let j = 0; j < 4; j++) value += src[indices[j] + channel] * src[indices[j] + 3] * weights[j]
        out[outIndex + channel] = value / alpha
      }
    }
  }
  return out
}

/** Canvas2D-compatible affine resampling directly in scene-linear Float32 RGBA.
 * Centers are measured in source pixel EDGE coordinates (0..width). Positive
 * rotation is clockwise in the editor's y-down coordinate system. Destination
 * is centered in its own dimensions. Sampling occurs at pixel centers.
 * Out-of-image pixels are transparent (NOT edge-clamped), and interpolation
 * is premultiplied-alpha to prevent halos around rotated transparent edges.
 */
export function affineHdrPixels(
  src: Float32Array, sw: number, sh: number, dw: number, dh: number,
  opts: { sourceCenterX: number; sourceCenterY: number; rotationRadians: number; scale: number },
): Float32Array {
  check(src, sw, sh)
  if (!Number.isSafeInteger(dw) || dw < 1 || !Number.isSafeInteger(dh) || dh < 1 ||
      !Number.isFinite(opts.sourceCenterX) || !Number.isFinite(opts.sourceCenterY) ||
      !Number.isFinite(opts.rotationRadians) || !Number.isFinite(opts.scale) || opts.scale <= 0) {
    throw new Error('Invalid HDR affine transform')
  }
  const dst = new Float32Array(dw * dh * 4)
  const cos = Math.cos(opts.rotationRadians), sin = Math.sin(opts.rotationRadians)
  const inv = 1 / opts.scale
  for (let y = 0; y < dh; y++) {
    const cy = y + .5 - dh / 2
    for (let x = 0; x < dw; x++) {
      const cx = x + .5 - dw / 2
      // Back-project the CENTER of the destination pixel into source index space.
      const sx = opts.sourceCenterX + (cx * cos + cy * sin) * inv - .5
      const sy = opts.sourceCenterY + (-cx * sin + cy * cos) * inv - .5
      const x0 = Math.floor(sx), y0 = Math.floor(sy)
      const tx = sx - x0, ty = sy - y0
      const weights = [(1-tx)*(1-ty), tx*(1-ty), (1-tx)*ty, tx*ty]
      const indices = [x0, x0+1, x0, x0+1]
      const ys = [y0, y0, y0+1, y0+1]
      const di = (y * dw + x) * 4
      let alpha = 0, r = 0, g = 0, b = 0
      for (let k = 0; k < 4; k++) {
        const ix = indices[k], iy = ys[k]
        if (ix < 0 || ix >= sw || iy < 0 || iy >= sh) continue
        const si = (iy * sw + ix) * 4
        const a = src[si + 3] * weights[k]
        alpha += a
        r += src[si] * a
        g += src[si + 1] * a
        b += src[si + 2] * a
      }
      dst[di + 3] = alpha
      if (alpha > 1e-12) {
        dst[di] = r / alpha
        dst[di + 1] = g / alpha
        dst[di + 2] = b / alpha
      }
    }
  }
  return dst
}
