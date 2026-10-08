/** Maps 8-bit or scene-linear Float32 raster opacity to document coordinates.
 * Offset raster pixels outside the canvas are omitted; source RGB channels
 * are deliberately ignored so HDR values >1 do not affect selection alpha. */
export function rasterTransparencyAlpha(
  pixels: Uint8ClampedArray | Float32Array,
  sourceW: number, sourceH: number,
  documentW: number, documentH: number,
  offsetX: number, offsetY: number,
): Uint8ClampedArray {
  const dims = [sourceW, sourceH, documentW, documentH]
  if (dims.some(v => !Number.isSafeInteger(v) || v <= 0) ||
      !Number.isSafeInteger(offsetX) || !Number.isSafeInteger(offsetY) ||
      pixels.length !== sourceW * sourceH * 4 ||
      !Number.isSafeInteger(documentW * documentH)) {
    throw new Error('Invalid layer transparency geometry')
  }
  const out = new Uint8ClampedArray(documentW * documentH)
  const float = pixels instanceof Float32Array
  const xStart = Math.max(0, -offsetX)
  const xEnd = Math.min(sourceW, documentW - offsetX)
  const yStart = Math.max(0, -offsetY)
  const yEnd = Math.min(sourceH, documentH - offsetY)
  for (let y = yStart; y < yEnd; y++) {
    const dy = y + offsetY
    for (let x = xStart; x < xEnd; x++) {
      const value = pixels[(y * sourceW + x) * 4 + 3]
      const alpha = float ? value * 255 : value
      out[dy * documentW + x + offsetX] = Number.isFinite(alpha)
        ? Math.max(0, Math.min(255, Math.round(alpha))) : 0
    }
  }
  return out
}
