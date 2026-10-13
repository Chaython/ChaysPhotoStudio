import { applyFloat32RetouchDab, type HdrRetouchDab } from './hdr-retouch'
import { canvasProfile, ctx2d, sceneLinearToSrgb, srgbToSceneLinear } from '../utils/canvas'

/**
 * Native 16-bit Canvas2D tonal edits.
 *
 * Reject unsupported readback rather than inadvertently using Uint8 ImageData.
 * Expand only the dab into Float32 to evaluate the same scene-linear controls
 * as HDR; write back ONLY changed RGB channels to the original Float16 ImageData.
 * Untouched values and every alpha channel keep their exact native half bits.
 */
export interface NativeFloat16ToneDab extends Omit<HdrRetouchDab, 'pixels' | 'width' | 'height' | 'offsetX' | 'offsetY'> {
  canvas: HTMLCanvasElement
  offsetX: number
  offsetY: number
}

export function applyNativeFloat16ToneDab(d: NativeFloat16ToneDab): boolean {
  const { canvas, x, y, radius, offsetX, offsetY } = d
  if (![x, y, radius, offsetX, offsetY].every(Number.isFinite) || radius <= 0) return false
  const profile = canvasProfile(canvas)
  if (profile.bitDepth !== 16 || profile.colorSpace !== 'srgb') {
    throw new Error('Native 16-bit tonal retouch requires a Float16 sRGB raster')
  }
  const left = Math.max(0, Math.floor(x - radius - offsetX))
  const top = Math.max(0, Math.floor(y - radius - offsetY))
  const right = Math.min(canvas.width, Math.ceil(x + radius - offsetX))
  const bottom = Math.min(canvas.height, Math.ceil(y + radius - offsetY))
  const width = right - left, height = bottom - top
  if (!Number.isSafeInteger(width * height * 4) || width <= 0 || height <= 0) return false

  const context = ctx2d(canvas) as CanvasRenderingContext2D & {
    getImageData: (...args: any[]) => ImageData
  }
  let image: ImageData
  try {
    image = context.getImageData(left, top, width, height, {
      pixelFormat: 'rgba-float16', colorSpace: 'srgb',
    })
  } catch {
    throw new Error('Native Float16 pixel readback is unavailable; no pixels changed')
  }
  const pixels = image?.data as unknown as ArrayLike<number> & { constructor?: { name?: string } }
  // Some browsers ignore the pixelFormat request and silently return Uint8.
  if (!pixels || pixels.length !== width * height * 4 ||
      pixels.constructor?.name !== 'Float16Array') {
    throw new Error('Browser returned non-Float16 pixel data; refusing lossy retouch')
  }
  const original = new Float32Array(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      const value = Number(pixels[i + c])
      if (!Number.isFinite(value)) throw new Error('Invalid Float16 pixel component')
      original[i + c] = c === 3 ? value : srgbToSceneLinear(value)
    }
  }
  const working = new Float32Array(original)
  const changed = applyFloat32RetouchDab({
    ...d,
    pixels: working, width, height,
    offsetX: offsetX + left, offsetY: offsetY + top,
  })
  if (!changed) return false

  // Validate all write values before touching the ImageData, then commit.
  // No-op channels are left untouched to avoid unnecessary half rounding.
  const indices: number[] = []
  const encoded: number[] = []
  for (let i = 0; i < working.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const index = i + c
      if (working[index] === original[index]) continue
      const value = sceneLinearToSrgb(working[index])
      if (!Number.isFinite(value) || Math.abs(value) > 65504) {
        throw new Error('Edited pixel exceeds the representable Float16 range')
      }
      indices.push(index)
      encoded.push(value)
    }
  }
  if (!indices.length) return false
  const writable = image.data as unknown as { [index: number]: number }
  for (let i = 0; i < indices.length; i++) writable[indices[i]] = encoded[i]
  try {
    context.putImageData(image, left, top)
  } catch {
    throw new Error('Native Float16 pixel writeback failed; no 8-bit fallback used')
  }
  return true
}
