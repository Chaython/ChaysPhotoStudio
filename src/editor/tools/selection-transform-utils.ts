import type { Rect } from '../types'

/** Resolve a transform reference point from normalized Tool Options percentages. */
export function selectionTransformPivot(bounds: Rect, xPercent: number, yPercent: number): { x: number; y: number } {
  const x = Number.isFinite(xPercent) ? Math.min(100, Math.max(0, xPercent)) : 50
  const y = Number.isFinite(yPercent) ? Math.min(100, Math.max(0, yPercent)) : 50
  return { x: bounds.x + bounds.w * x / 100, y: bounds.y + bounds.h * y / 100 }
}
