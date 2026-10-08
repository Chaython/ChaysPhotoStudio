// Source-over Fill for authoritative scene-linear Float32 pixels.
import { hexToRgb, srgbToSceneLinear } from '../utils/canvas'

/** True when document-space Fill intersects at least one selected layer pixel. */
export function hasHdrFillCoverage(w: number, h: number, ox: number, oy: number,
  dw: number, dh: number, mask: Uint8ClampedArray | null): boolean {
  if (![w, h, dw, dh].every(v => Number.isSafeInteger(v) && v > 0)
      || !Number.isFinite(ox) || !Number.isFinite(oy)
      || (mask !== null && mask.length !== dw * dh)) throw new Error('Invalid HDR Fill geometry')
  const x0 = Math.max(0, -Math.round(ox)), y0 = Math.max(0, -Math.round(oy))
  const x1 = Math.min(w, dw - Math.round(ox)), y1 = Math.min(h, dh - Math.round(oy))
  if (x1 <= x0 || y1 <= y0) return false
  if (!mask) return true
  const px = Math.round(ox), py = Math.round(oy)
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (mask[(y + py) * dw + x + px] > 0) return true
  return false
}

/** Straight-alpha HDR source-over. Unselected >1.0 highlights stay untouched.
 * Source RGB is converted from UI sRGB to scene-linear before compositing.
 */
export function paintHdrRasterFill(pixels: Float32Array, w: number, h: number,
  ox: number, oy: number, dw: number, dh: number,
  mask: Uint8ClampedArray | null, color: string): boolean {
  if (pixels.length !== w * h * 4 || !Number.isSafeInteger(w * h))
    throw new Error('HDR Fill pixel dimensions mismatch')
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color))
    throw new Error('HDR Fill requires a hexadecimal color')
  if (!hasHdrFillCoverage(w, h, ox, oy, dw, dh, mask)) return false
  const [red, green, blue] = hexToRgb(color)
  const rgb = [red, green, blue].map(v => srgbToSceneLinear(v / 255))
  const px = Math.round(ox), py = Math.round(oy)
  const x0 = Math.max(0, -px), y0 = Math.max(0, -py)
  const x1 = Math.min(w, dw - px), y1 = Math.min(h, dh - py)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const sa = mask ? mask[(y + py) * dw + x + px] / 255 : 1
    if (sa <= 0) continue
    const i = (y * w + x) * 4
    const da = Math.max(0, Math.min(1, pixels[i + 3]))
    const remaining = da * (1 - sa), outA = sa + remaining
    if (outA > 0)
      for (let c = 0; c < 3; c++)
        pixels[i + c] = (rgb[c] * sa + pixels[i + c] * remaining) / outA
    pixels[i + 3] = outA
  }
  return true
}
