/**
 * Extract a feathered document-space selection from an unpremultiplied,
 * scene-linear Float32 raster (HDR values can exceed 1). Selection and optional
 * layer masks are 0..255 alpha, sampled from the output rectangle in doc space.
 * For a cut, only the SELECTION affects source alpha; the layer mask affects
 * the copied layer's visible pixels, not the original mask.
 */
export function splitHdrSelectionPixels(
  source: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  offsetX: number,
  offsetY: number,
  region: { x: number; y: number; w: number; h: number },
  selectionAlpha: Uint8Array | Uint8ClampedArray,
  cut = false,
  layerMaskAlpha?: Uint8Array | Uint8ClampedArray,
): { pixels: Float32Array; remaining: Float32Array | null; hasPixels: boolean } {
  const { x, y, w, h } = region
  if (!Number.isSafeInteger(sourceWidth) || sourceWidth < 1 ||
      !Number.isSafeInteger(sourceHeight) || sourceHeight < 1 ||
      source.length !== sourceWidth * sourceHeight * 4 ||
      !Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
      !Number.isSafeInteger(w) || w < 1 || !Number.isSafeInteger(h) || h < 1 ||
      !Number.isSafeInteger(offsetX) || !Number.isSafeInteger(offsetY) ||
      selectionAlpha.length !== w * h ||
      (layerMaskAlpha !== undefined && layerMaskAlpha.length !== w * h)) {
    throw new Error('Invalid HDR selection buffers or geometry')
  }
  const pixels = new Float32Array(w * h * 4)
  const remaining = cut ? new Float32Array(source) : null
  let hasPixels = false
  for (let py = 0; py < h; py++) {
    const sy = y + py - offsetY
    if (sy < 0 || sy >= sourceHeight) continue
    for (let px = 0; px < w; px++) {
      const sx = x + px - offsetX
      if (sx < 0 || sx >= sourceWidth) continue
      const m = (py * w + px)
      const selected = selectionAlpha[m] / 255
      if (selected <= 0) continue
      const sourceIndex = (sy * sourceWidth + sx) * 4
      const originalAlpha = source[sourceIndex + 3]
      if (originalAlpha <= 0) continue
      const targetIndex = m * 4
      pixels[targetIndex] = source[sourceIndex]
      pixels[targetIndex + 1] = source[sourceIndex + 1]
      pixels[targetIndex + 2] = source[sourceIndex + 2]
      pixels[targetIndex + 3] = originalAlpha * selected *
        (layerMaskAlpha ? layerMaskAlpha[m] / 255 : 1)
      if (remaining) remaining[sourceIndex + 3] = originalAlpha * (1 - selected)
      if (pixels[targetIndex + 3] > 0) hasPixels = true
    }
  }
  return { pixels, remaining, hasPixels }
}
