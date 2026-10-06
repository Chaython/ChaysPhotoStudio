import type { PixelImage } from './pixel-data'

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

/** Remove color contamination caused by compositing straight-alpha artwork
 * against a known white or black matte, while preserving alpha. */
export function removeMatte(
  image: PixelImage,
  matte: 'white' | 'black',
  selection?: Uint8ClampedArray | null,
): PixelImage {
  const d = image.data
  const m = matte === 'white' ? 255 : 0
  for (let p = 0, i = 0; i < d.length; p++, i += 4) {
    const alpha = d[i + 3] / 255
    if (alpha <= 0 || alpha >= 0.99999) continue
    const weight = selection ? selection[p] / 255 : 1
    if (weight <= 0) continue
    for (let c = 0; c < 3; c++) {
      const original = d[i + c]
      const corrected = clamp255((original - (1 - alpha) * m) / alpha)
      d[i + c] = original + (corrected - original) * weight
    }
  }
  return image
}

/** Replace anti-aliased fringe RGB with colors propagated outward from opaque
 * interior pixels. Alpha is never changed. Each iteration grows the trusted
 * interior by one pixel, approximating Photoshop's Defringe width. */
export function defringe(
  image: PixelImage,
  width: number,
  selection?: Uint8ClampedArray | null,
): PixelImage {
  const w = image.width
  const h = image.height
  const d = image.data
  const count = w * h
  const radius = Math.max(1, Math.min(64, Math.round(width) || 1))
  const known = new Uint8Array(count)
  const pending = new Uint8Array(count)

  for (let p = 0, i = 0; p < count; p++, i += 4) {
    // Near-opaque pixels are stable interior color samples; a small tolerance
    // keeps high-depth antialiasing from preventing any seed pixels.
    if (d[i + 3] >= 250) known[p] = 1
  }

  for (let pass = 0; pass < radius; pass++) {
    let pendingCount = 0

    // Mark only the next one-pixel frontier. Do not promote it yet, otherwise
    // scan order could propagate multiple pixels in a single width step.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (known[p]) continue
        const alpha = d[p * 4 + 3]
        if (alpha <= 0 || alpha >= 250) continue
        if (selection && selection[p] === 0) continue

        const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1)
        const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1)
        let touchesInterior = false
        for (let yy = y0; yy <= y1 && !touchesInterior; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            if (xx === x && yy === y) continue
            if (known[yy * w + xx]) { touchesInterior = true; break }
          }
        }
        if (!touchesInterior) continue
        pending[p] = 1
        pendingCount++
      }
    }

    if (!pendingCount) break

    // Compute every pending pixel from the PREVIOUS frontier only. RGB can be
    // updated in-place because pending pixels are still excluded from known.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (!pending[p]) continue
        let sr = 0, sg = 0, sb = 0, n = 0
        const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1)
        const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1)
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            if (xx === x && yy === y) continue
            const q = yy * w + xx
            if (!known[q]) continue
            const qi = q * 4
            sr += d[qi]
            sg += d[qi + 1]
            sb += d[qi + 2]
            n++
          }
        }
        if (!n) continue
        const i = p * 4
        const weight = selection ? selection[p] / 255 : 1
        d[i] += (sr / n - d[i]) * weight
        d[i + 1] += (sg / n - d[i + 1]) * weight
        d[i + 2] += (sb / n - d[i + 2]) * weight
      }
    }

    // Promote the completed frontier for the next width step.
    for (let p = 0; p < count; p++) {
      if (!pending[p]) continue
      pending[p] = 0
      known[p] = 1
    }
  }

  return image
}
