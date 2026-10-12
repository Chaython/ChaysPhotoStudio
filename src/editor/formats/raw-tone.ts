// Lightroom-style global photographic tone and color adjustments for developed camera RAW.
// Applied to 16-bit LibRaw samples before canvas conversion. RAW originals are not modified.
// These are display-referred controls, not sensor-space exposure or camera color calibration.
import type { RawImage } from './decoders'

export interface RawToneSettings {
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  vibrance: number
  saturation: number
  temperature: number
  tint: number
}

export const DEFAULT_RAW_TONE: RawToneSettings = {
  contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  vibrance: 0, saturation: 0, temperature: 0, tint: 0,
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const limit = (value: unknown): number => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? clamp(number, -100, 100) : 0
}
export function normalizeRawTone(value: Partial<RawToneSettings> | null | undefined): RawToneSettings {
  return {
    contrast: limit(value?.contrast),
    highlights: limit(value?.highlights),
    shadows: limit(value?.shadows),
    whites: limit(value?.whites),
    blacks: limit(value?.blacks),
    vibrance: limit(value?.vibrance),
    saturation: limit(value?.saturation),
    temperature: limit(value?.temperature),
    tint: limit(value?.tint),
  }
}
const smooth = (t: number) => {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}
function toneCurve(x: number, settings: RawToneSettings): number {
  // Multipliers fade at black/white to prevent discontinuities and unexpected
  // clipping of the existing sensor dynamic range.
  const hi = smooth((x - 0.45) / 0.55)
  const shadow = 1 - smooth((x - 0.05) / 0.5)
  const white = smooth((x - 0.72) / 0.28)
  const black = 1 - smooth(x / 0.28)
  const result = x +
    (settings.highlights / 100) * 0.55 * hi * (1 - x) +
    (settings.shadows / 100) * 0.65 * shadow * x +
    (settings.whites / 100) * 0.35 * white * (1 - x) +
    (settings.blacks / 100) * 0.45 * black * x +
    (settings.contrast / 100) * 0.9 * (x - 0.5) * 4 * x * (1 - x)
  return clamp(result, 0, 1)
}

/** Post-demosaic tone develop for sRGB camera samples. Returns a new image and
 * preserves 16-bit integer samples; never changes the original input buffers.
 * Float/scene-linear imagery is intentionally excluded from this RAW-only stage. */
export function applyRawTone(image: RawImage, input: Partial<RawToneSettings> | undefined): RawImage {
  const settings = normalizeRawTone(input)
  if (Object.values(settings).every(value => value === 0)) return image
  if (image.rgbaFloat || image.sourceColorSpace === 'linear-srgb') return image
  const src = image.rgba16 ?? image.rgba
  const high = !!image.rgba16
  const pixels = image.width * image.height
  if (!Number.isSafeInteger(pixels) || pixels < 1 || src.length !== pixels * 4) return image
  const scale = high ? 65535 : 255
  const lut = new Float32Array(scale + 1)
  for (let i = 0; i <= scale; i++) lut[i] = toneCurve(i / scale, settings)
  const dst16 = high ? new Uint16Array(src.length) : undefined
  const dst8 = new Uint8ClampedArray(src.length)
  const warm = settings.temperature / 100
  const magenta = settings.tint / 100
  const rGain = 1 + warm * 0.15 + magenta * 0.06
  const gGain = 1 - magenta * 0.12
  const bGain = 1 - warm * 0.15 + magenta * 0.06
  const saturation = settings.saturation / 100
  const vibrance = settings.vibrance / 100
  for (let i = 0; i < src.length; i += 4) {
    let r = clamp(lut[src[i]] * rGain, 0, 1)
    let g = clamp(lut[src[i + 1]] * gGain, 0, 1)
    let b = clamp(lut[src[i + 2]] * bGain, 0, 1)
    if (saturation !== 0 || vibrance !== 0) {
      const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b)
      const chroma = maximum > 0 ? (maximum - minimum) / maximum : 0
      const factor = clamp(1 + saturation + vibrance * (1 - chroma), 0, 3)
      const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722
      r = clamp(luminance + (r - luminance) * factor, 0, 1)
      g = clamp(luminance + (g - luminance) * factor, 0, 1)
      b = clamp(luminance + (b - luminance) * factor, 0, 1)
    }
    if (dst16) {
      dst16[i] = Math.round(r * 65535)
      dst16[i + 1] = Math.round(g * 65535)
      dst16[i + 2] = Math.round(b * 65535)
      // Opacity is not a color channel and must not receive tone/WB changes.
      dst16[i + 3] = src[i + 3]
      dst8[i] = Math.round(dst16[i] / 257)
      dst8[i + 1] = Math.round(dst16[i + 1] / 257)
      dst8[i + 2] = Math.round(dst16[i + 2] / 257)
      dst8[i + 3] = Math.round(dst16[i + 3] / 257)
    } else {
      dst8[i] = Math.round(r * 255)
      dst8[i + 1] = Math.round(g * 255)
      dst8[i + 2] = Math.round(b * 255)
      dst8[i + 3] = src[i + 3]
    }
  }
  return { ...image, rgba: dst8 as Uint8ClampedArray<ArrayBuffer>, rgba16: dst16 }
}
