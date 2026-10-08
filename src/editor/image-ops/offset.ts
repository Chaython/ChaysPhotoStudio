// Photoshop Filter > Other > Offset.
// Supports 8-bit canvas pixels and HDR float pixel arrays without re-quantization.
import type { PixelImage } from './pixel-data'

export type OffsetEdgeMode = 'wrap' | 'repeat-edge' | 'transparent'
export interface OffsetOptions { horizontal: number; vertical: number; edgeMode: OffsetEdgeMode }

/** Pixel-exact signed translation. Positive X moves content right; positive
 * Y moves content down. All four RGBA channels move together.
 */
export function offsetPixels(img: PixelImage, options: OffsetOptions): void {
  const { width: w, height: h, data } = img
  const { horizontal, vertical, edgeMode } = options
  if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) {
    throw new Error('Offset values must be finite')
  }
  if (!['wrap', 'repeat-edge', 'transparent'].includes(edgeMode)) {
    throw new Error('Invalid offset edge mode')
  }
  if (!Number.isSafeInteger(w * h) || w < 0 || h < 0 || data.length !== w * h * 4) {
    throw new Error('Offset requires valid RGBA pixels')
  }
  if (w === 0 || h === 0) return
  const dx = Math.round(horizontal), dy = Math.round(vertical)
  if (dx === 0 && dy === 0) return
  const src = data.slice()
  const wrap = (p: number, size: number) => (p % size + size) % size
  for (let y = 0; y < h; y++) {
    const py = y - dy
    for (let x = 0; x < w; x++) {
      const px = x - dx
      const o = (y * w + x) * 4
      if (edgeMode === 'transparent' && (px < 0 || px >= w || py < 0 || py >= h)) {
        data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0
        continue
      }
      const sx = edgeMode === 'wrap' ? wrap(px, w) : Math.max(0, Math.min(w - 1, px))
      const sy = edgeMode === 'wrap' ? wrap(py, h) : Math.max(0, Math.min(h - 1, py))
      const i = (sy * w + sx) * 4
      data[o] = src[i]
      data[o + 1] = src[i + 1]
      data[o + 2] = src[i + 2]
      data[o + 3] = src[i + 3]
    }
  }
}
