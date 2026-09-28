// Precision-neutral pixel buffers for destructive CPU image operations.
//
// Values intentionally use the editor's historical 0..255 channel scale even
// when the storage array is Float32Array. That lets the existing filter math
// keep its Photoshop-style parameter semantics while retaining fractional
// values instead of quantizing at every operation.
export interface FloatPixelImage {
  width: number
  height: number
  data: Float32Array
  /** Marker used by the worker/canvas bridge; channel values are 0..255 floats. */
  precision: 'float32'
}

export type PixelImage = ImageData | FloatPixelImage
export type PixelArray = Uint8ClampedArray | Float32Array

export function isFloatPixelImage(img: PixelImage): img is FloatPixelImage {
  return img.data instanceof Float32Array
}

export function createPixelImage(width: number, height: number, float = false): PixelImage {
  if (float) {
    return { width, height, data: new Float32Array(width * height * 4), precision: 'float32' }
  }
  return new ImageData(width, height)
}

export function createPixelImageLike(img: PixelImage, width = img.width, height = img.height): PixelImage {
  return createPixelImage(width, height, isFloatPixelImage(img))
}

export function clonePixelImage<T extends PixelImage>(img: T): T {
  if (isFloatPixelImage(img)) {
    return {
      width: img.width,
      height: img.height,
      data: new Float32Array(img.data),
      precision: 'float32',
    } as T
  }
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height) as T
}

/** Interpolate a classic 256-entry LUT instead of integer-indexing it.
 * Uint8 inputs still hit exact entries; float inputs retain sub-8-bit detail. */
export function sampleLut256(lut: ArrayLike<number>, value: number): number {
  const v = Math.max(0, Math.min(255, value))
  const i0 = Math.floor(v)
  const i1 = Math.min(255, i0 + 1)
  const f = v - i0
  return Number(lut[i0]) + (Number(lut[i1]) - Number(lut[i0])) * f
}

/** Histogram bin for a potentially fractional 0..255 sample. */
export function histBin(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}
