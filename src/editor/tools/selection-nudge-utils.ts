import type { Rect } from '../types'

/** Translate a selection's document-space bounds and clip them to the canvas. */
export function nudgeSelectionBounds(bounds: Rect, dx: number, dy: number, width: number, height: number): Rect {
  const x0 = Math.max(0, bounds.x + dx)
  const y0 = Math.max(0, bounds.y + dy)
  const x1 = Math.min(width, bounds.x + dx + bounds.w)
  const y1 = Math.min(height, bounds.y + dy + bounds.h)
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}
