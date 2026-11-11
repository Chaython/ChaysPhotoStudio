export type BlurGalleryPreviewPoint = { x: number; y: number; width: number; height: number }
export type PreviewBounds = { left: number; top: number; width: number; height: number }

/** Maps a pointer into the letterboxed image area of the Blur Gallery preview.
 * During an active pointer-captured drag, clamp keeps the focus point attached
 * to the image edge instead of freezing when the pointer leaves the image.
 */
export function getBlurGalleryPreviewPoint(
  clientX: number,
  clientY: number,
  bounds: PreviewBounds,
  sourceWidth: number,
  sourceHeight: number,
  previewWidth: number,
  previewHeight: number,
  clamp = false,
): BlurGalleryPreviewPoint | null {
  if (![clientX, clientY, bounds.left, bounds.top, bounds.width, bounds.height, sourceWidth, sourceHeight, previewWidth, previewHeight].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0 || sourceWidth <= 0 || sourceHeight <= 0 || previewWidth <= 0 || previewHeight <= 0) return null
  const scale = Math.min(1, (previewWidth - 20) / sourceWidth, (previewHeight - 20) / sourceHeight)
  if (!Number.isFinite(scale) || scale <= 0) return null
  const width = sourceWidth * scale, height = sourceHeight * scale
  const offsetX = (previewWidth - width) / 2, offsetY = (previewHeight - height) / 2
  const px = (clientX - bounds.left) * previewWidth / bounds.width
  const py = (clientY - bounds.top) * previewHeight / bounds.height
  let x = (px - offsetX) / width, y = (py - offsetY) / height
  if (!clamp && (x < 0 || y < 0 || x > 1 || y > 1)) return null
  x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y))
  return { x, y, width, height }
}
