/** Document-space layer mask pixel operations. Float32 RGB is scene-linear
 * and deliberately never clamped or resampled through a preview canvas. */
export type LayerMaskCreationMode = 'reveal-all' | 'hide-all' | 'reveal-selection' | 'hide-selection'

export function createLayerMaskAlpha(
  width: number, height: number, mode: LayerMaskCreationMode,
  selection?: Uint8Array | Uint8ClampedArray,
): Uint8ClampedArray {
  if (!Number.isSafeInteger(width) || width < 1 ||
      !Number.isSafeInteger(height) || height < 1 ||
      !Number.isSafeInteger(width * height)) throw new Error('Invalid layer mask dimensions')
  const size = width * height
  const usesSelection = mode === 'reveal-selection' || mode === 'hide-selection'
  if (usesSelection && (!selection || selection.length !== size)) {
    throw new Error('Layer mask requires a document-sized selection')
  }
  const alpha = new Uint8ClampedArray(size)
  if (mode === 'reveal-all') alpha.fill(255)
  if (mode === 'hide-all') return alpha
  if (usesSelection) for (let i = 0; i < size; i++) {
    alpha[i] = mode === 'hide-selection' ? 255 - selection![i] : selection![i]
  }
  return alpha
}

export function applyHdrRasterMask(
  pixels: Float32Array, rasterWidth: number, rasterHeight: number,
  offsetX: number, offsetY: number,
  maskAlpha: Uint8Array | Uint8ClampedArray,
  documentWidth: number, documentHeight: number,
): Float32Array {
  if (![rasterWidth, rasterHeight, documentWidth, documentHeight].every(
    n => Number.isSafeInteger(n) && n > 0
  ) || !Number.isSafeInteger(offsetX) || !Number.isSafeInteger(offsetY) ||
      !Number.isSafeInteger(rasterWidth * rasterHeight * 4) ||
      !Number.isSafeInteger(documentWidth * documentHeight) ||
      pixels.length !== rasterWidth * rasterHeight * 4 ||
      maskAlpha.length !== documentWidth * documentHeight) {
    throw new Error('Invalid HDR layer mask geometry')
  }
  const result = new Float32Array(pixels)
  for (let y = 0; y < rasterHeight; y++) {
    const dy = y + offsetY
    for (let x = 0; x < rasterWidth; x++) {
      const dx = x + offsetX
      const alpha = (dx >= 0 && dx < documentWidth && dy >= 0 && dy < documentHeight)
        ? maskAlpha[dy * documentWidth + dx] / 255 : 0
      const i = (y * rasterWidth + x) * 4 + 3
      result[i] = pixels[i] * alpha
    }
  }
  return result
}
