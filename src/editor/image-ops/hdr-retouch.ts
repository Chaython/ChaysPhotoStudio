/**
 * Float32 scene-linear retouch dabs.
 *
 * This processor never reads a Canvas2D color buffer, quantizes to Uint8, or
 * clamps HDR intensities to SDR white. Selection coverage is the only byte
 * input; RGB and alpha remain in the authoritative Float32Array.
 */
export type HdrRetouchMode = 'dodge' | 'burn' | 'sponge'

export interface HdrSelectionRegion {
  x: number
  y: number
  width: number
  height: number
  /** RGBA selection bitmap, where alpha determines selection coverage. */
  data: Uint8ClampedArray
}

export interface HdrRetouchDab {
  pixels: Float32Array
  width: number
  height: number
  offsetX: number
  offsetY: number
  x: number
  y: number
  radius: number
  strength: number
  mode: HdrRetouchMode
  range?: string
  protectTones?: boolean
  saturate?: boolean
  vibrance?: boolean
  alpha: (dx: number, dy: number) => number
  selection?: HdrSelectionRegion
  /** An active selection whose bounding region has no overlapping coverage. */
  hasSelection?: boolean
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)) }
function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

function rangeWeight(luma: number, range?: string): number {
  const normalized = clamp01(luma)
  if (range === 'shadows') return 1 - smoothstep(0, 0.33, normalized)
  if (range === 'highlights') return smoothstep(0.66, 1, normalized)
  if (range === 'midtones') return smoothstep(0.16, 0.33, normalized) * (1 - smoothstep(0.66, 0.84, normalized))
  return 1
}

function selectionCoverage(sel: HdrSelectionRegion | undefined, docX: number, docY: number): number {
  if (!sel) return 1
  const x = docX - sel.x
  const y = docY - sel.y
  if (x < 0 || y < 0 || x >= sel.width || y >= sel.height) return 0
  return (sel.data[(y * sel.width + x) * 4 + 3] ?? 0) / 255
}

export function applyFloat32RetouchDab(dab: HdrRetouchDab): boolean {
  const {
    pixels, width, height, offsetX, offsetY, x, y,
    radius, mode, range, alpha, selection, hasSelection,
  } = dab
  if (![width, height, offsetX, offsetY, x, y, radius, dab.strength].every(Number.isFinite)) return false
  if (width < 1 || height < 1 || radius <= 0 || pixels.length !== width * height * 4) return false
  if (hasSelection && !selection) return false
  if (selection && (selection.width < 1 || selection.height < 1 || selection.data.length !== selection.width * selection.height * 4)) return false
  const power = clamp01(dab.strength)
  if (power <= 0) return false
  const x0 = Math.max(0, Math.floor(x - radius - offsetX))
  const y0 = Math.max(0, Math.floor(y - radius - offsetY))
  const x1 = Math.min(width, Math.ceil(x + radius - offsetX))
  const y1 = Math.min(height, Math.ceil(y + radius - offsetY))
  if (x0 >= x1 || y0 >= y1) return false
  let changed = false
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const docX = Math.floor(px + offsetX)
      const docY = Math.floor(py + offsetY)
      let f = alpha(px + offsetX - x, py + offsetY - y)
      if (!Number.isFinite(f) || f <= 0) continue
      f = clamp01(f) * power * selectionCoverage(selection, docX, docY)
      if (f <= 0) continue
      const i = (py * width + px) * 4
      const a = pixels[i + 3]
      if (!Number.isFinite(a) || a <= 0) continue
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
      if (![r, g, b].every(Number.isFinite)) continue
      const lum = Math.max(0, r * 0.2126 + g * 0.7152 + b * 0.0722)
      let nr = r, ng = g, nb = b
      if (mode === 'dodge' || mode === 'burn') {
        if (dab.protectTones !== false) {
          const weight = rangeWeight(lum, range)
          const factor = mode === 'burn' ? Math.max(0, 1 - f * weight) : 1 + f * weight
          nr *= factor; ng *= factor; nb *= factor
        } else {
          const factor = mode === 'burn' ? -f : f
          nr = Math.max(0, r * (1 + factor * rangeWeight(r, range)))
          ng = Math.max(0, g * (1 + factor * rangeWeight(g, range)))
          nb = Math.max(0, b * (1 + factor * rangeWeight(b, range)))
        }
      } else {
        // Saturation in scene-linear space without clipping values above 1.
        const max = Math.max(0, r, g, b)
        const min = Math.min(r, g, b)
        const saturation = max > 0 ? clamp01((max - min) / max) : 0
        const vibranceWeight = dab.vibrance && dab.saturate !== false ? 1 - saturation : 1
        const factor = dab.saturate === false
          ? Math.max(0, 1 - f * 1.6)
          : 1 + f * 1.6 * vibranceWeight
        nr = Math.max(0, lum + (r - lum) * factor)
        ng = Math.max(0, lum + (g - lum) * factor)
        nb = Math.max(0, lum + (b - lum) * factor)
      }
      if (nr !== r || ng !== g || nb !== b) {
        pixels[i] = nr; pixels[i + 1] = ng; pixels[i + 2] = nb
        changed = true
      }
    }
  }
  return changed
}
