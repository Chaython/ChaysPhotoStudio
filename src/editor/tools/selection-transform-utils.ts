import type { Rect } from '../types'

/** Resolve a transform reference point from normalized Tool Options percentages. */
export function selectionTransformPivot(bounds: Rect, xPercent: number, yPercent: number): { x: number; y: number } {
  const x = Number.isFinite(xPercent) ? Math.min(100, Math.max(0, xPercent)) : 50
  const y = Number.isFinite(yPercent) ? Math.min(100, Math.max(0, yPercent)) : 50
  return { x: bounds.x + bounds.w * x / 100, y: bounds.y + bounds.h * y / 100 }
}

/** Scale a selection rectangle while keeping its configured reference point fixed. */
export function scaleRectAroundPivot(
  start: Rect,
  handle: string,
  pointer: { x: number; y: number },
  pivot: { x: number; y: number },
  constrainProportions = false,
): Rect {
  const horizontal = handle.includes('w') || handle.includes('e')
  const vertical = handle.includes('n') || handle.includes('s')
  const handleX = handle.includes('w') ? start.x : start.x + start.w
  const handleY = handle.includes('n') ? start.y : start.y + start.h
  const safeRatio = (current: number, origin: number) => Math.max(0.01, Math.abs(current - origin) / Math.max(0.001, Math.abs(origin)))
  let sx = horizontal ? safeRatio(pointer.x, pivot.x) / safeRatio(handleX, pivot.x) : 1
  let sy = vertical ? safeRatio(pointer.y, pivot.y) / safeRatio(handleY, pivot.y) : 1

  if (constrainProportions && horizontal && vertical) {
    const scale = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy
    sx = scale
    sy = scale
  }

  return {
    x: pivot.x + (start.x - pivot.x) * sx,
    y: pivot.y + (start.y - pivot.y) * sy,
    w: start.w * sx,
    h: start.h * sy,
  }
}
