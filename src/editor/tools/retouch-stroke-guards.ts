/** Guards for long-running retouch strokes, independent of Canvas2D. */
export interface RetouchTarget {
  docId: string
  targetId: string
}
export interface RetouchCanvasBounds {
  x: number
  y: number
  width: number
  height: number
}

export function sameRetouchTarget(
  target: RetouchTarget | null,
  activeDocId: string | null,
  activeLayerId: string | null,
): boolean {
  return !!target && target.docId === activeDocId && target.targetId === activeLayerId
}

/**
 * Exclude off-document/off-layer dabs before allocating a raster layer or
 * cloning its history pixels. Partially intersecting brush tips remain valid.
 */
export function retouchDabIntersectsCanvas(
  x: number, y: number, radius: number,
  docWidth: number, docHeight: number,
  bounds: RetouchCanvasBounds,
): boolean {
  if (![x, y, radius, docWidth, docHeight, bounds.x, bounds.y, bounds.width, bounds.height]
      .every(Number.isFinite)) return false
  if (radius <= 0 || docWidth <= 0 || docHeight <= 0 || bounds.width <= 0 || bounds.height <= 0) return false
  const left = Math.max(0, bounds.x)
  const top = Math.max(0, bounds.y)
  const right = Math.min(docWidth, bounds.x + bounds.width)
  const bottom = Math.min(docHeight, bounds.y + bounds.height)
  return right > left && bottom > top
    && x + radius > left && y + radius > top
    && x - radius < right && y - radius < bottom
}
