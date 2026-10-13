import type { HdrSelectionRegion } from './hdr-retouch'

/**
 * Scene-linear Float32 Smudge, using a translated pickup from the prior pen
 * location and source-over deposition at the current location. Alpha and RGB
 * remain floating-point; Canvas2D never samples or quantizes the colors.
 */
export interface Float32SmudgeDab {
  pixels: Float32Array
  width: number
  height: number
  offsetX: number
  offsetY: number
  x: number
  y: number
  previousX: number
  previousY: number
  radius: number
  strength: number
  alpha(dx: number, dy: number): number
  selection?: HdrSelectionRegion
  hasSelection?: boolean
  /** Linear-sRGB foreground mixed into the picked-up color, without changing
   * the pickup alpha. This mirrors 8-bit source-atop Finger Painting. */
  fingerPainting?: { color: readonly [number, number, number]; opacity: number }
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

export function applyFloat32SmudgeDab(d: Float32SmudgeDab): boolean {
  const { pixels, width, height, offsetX, offsetY, x, y, previousX, previousY, radius, selection } = d
  if (![width, height, offsetX, offsetY, x, y, previousX, previousY, radius, d.strength].every(Number.isFinite)
    || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || pixels.length !== width * height * 4 || radius <= 0 || d.strength <= 0
    || (x === previousX && y === previousY)) return false
  if (d.fingerPainting && (
    !Number.isFinite(d.fingerPainting.opacity)
    || !d.fingerPainting.color.every(Number.isFinite)
    || d.fingerPainting.color.some(n => n < 0)
  )) return false
  if (d.hasSelection && !selection) return false
  if (selection && (!Number.isInteger(selection.width) || !Number.isInteger(selection.height)
    || selection.width < 1 || selection.height < 1
    || selection.data.length !== selection.width * selection.height * 4)) return false

  const x0 = Math.max(0, Math.floor(x - radius - offsetX))
  const y0 = Math.max(0, Math.floor(y - radius - offsetY))
  const x1 = Math.min(width, Math.ceil(x + radius - offsetX))
  const y1 = Math.min(height, Math.ceil(y + radius - offsetY))
  if (x0 >= x1 || y0 >= y1) return false
  const w = x1 - x0, h = y1 - y0
  // Sparse bounded staging: source pixels cannot be overwritten by an earlier
  // pixel of the same dab, and there is no whole-document snapshot.
  const staged = new Float32Array(w * h * 4)
  const written = new Uint8Array(w * h)
  const deposit = clamp01(d.strength) * 0.85

  /** Bilinear sample in layer-local coordinates, with alpha-weighted RGB. */
  const pickup = (sx: number, sy: number): [number, number, number, number] => {
    const ix = Math.floor(sx), iy = Math.floor(sy)
    const fx = sx - ix, fy = sy - iy
    let a = 0, r = 0, g = 0, b = 0
    for (let ky = 0; ky <= 1; ky++) for (let kx = 0; kx <= 1; kx++) {
      const px = ix + kx, py = iy + ky
      if (px < 0 || py < 0 || px >= width || py >= height) continue
      const factor = (kx ? fx : 1 - fx) * (ky ? fy : 1 - fy)
      if (factor <= 0) continue
      const i = (py * width + px) * 4
      const alpha = pixels[i + 3]
      if (!Number.isFinite(alpha) || alpha <= 0) continue
      const cr = pixels[i], cg = pixels[i + 1], cb = pixels[i + 2]
      if (![cr, cg, cb].every(Number.isFinite)) continue
      const wa = factor * clamp01(alpha)
      a += wa
      r += cr * wa
      g += cg * wa
      b += cb * wa
    }
    return [r, g, b, a]
  }

  let changed = false
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
    const docX = px + offsetX, docY = py + offsetY
    const brushAlpha = d.alpha(docX - x, docY - y)
    if (!Number.isFinite(brushAlpha) || brushAlpha <= 0) continue
    let opacity = deposit * clamp01(brushAlpha)
    if (selection) {
      const sx = Math.floor(docX) - selection.x, sy = Math.floor(docY) - selection.y
      if (sx < 0 || sy < 0 || sx >= selection.width || sy >= selection.height) continue
      opacity *= (selection.data[(sy * selection.width + sx) * 4 + 3] ?? 0) / 255
    }
    if (opacity <= 0) continue

    const si = (py * width + px) * 4
    const da = pixels[si + 3]
    const dr = pixels[si], dg = pixels[si + 1], db = pixels[si + 2]
    if (![da, dr, dg, db].every(Number.isFinite) || da < 0) continue
    let [pr, pg, pb, sa] = pickup(px + previousX - x, py + previousY - y)
    if (sa <= 0) continue
    if (d.fingerPainting) {
      // Mix in scene-linear RGB only where pickup alpha already exists.
      // 8-bit source-atop Finger Painting does not paint from an empty pickup.
      const f = clamp01(d.fingerPainting.opacity)
      const [fr, fg, fb] = d.fingerPainting.color
      pr = pr * (1 - f) + fr * sa * f
      pg = pg * (1 - f) + fg * sa * f
      pb = pb * (1 - f) + fb * sa * f
    }
    const srcOpacity = sa * opacity
    const remain = 1 - srcOpacity
    const dstA = clamp01(da)
    const outA = srcOpacity + dstA * remain
    if (outA <= 0) continue
    const nr = (pr * opacity + dr * dstA * remain) / outA
    const ng = (pg * opacity + dg * dstA * remain) / outA
    const nb = (pb * opacity + db * dstA * remain) / outA
    if (![nr, ng, nb].every(Number.isFinite)) continue
    if (Math.abs(nr - dr) <= Math.max(1, Math.abs(dr)) * 1e-7
      && Math.abs(ng - dg) <= Math.max(1, Math.abs(dg)) * 1e-7
      && Math.abs(nb - db) <= Math.max(1, Math.abs(db)) * 1e-7
      && Math.abs(outA - da) <= 1e-7) continue
    const oi = ((py - y0) * w + px - x0) * 4
    staged[oi] = nr
    staged[oi + 1] = ng
    staged[oi + 2] = nb
    staged[oi + 3] = outA
    written[(py - y0) * w + px - x0] = 1
    changed = true
  }

  if (!changed) return false
  for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
    if (!written[row * w + col]) continue
    const from = (row * w + col) * 4
    const to = ((y0 + row) * width + x0 + col) * 4
    pixels[to] = staged[from]
    pixels[to + 1] = staged[from + 1]
    pixels[to + 2] = staged[from + 2]
    pixels[to + 3] = staged[from + 3]
  }
  return true
}
