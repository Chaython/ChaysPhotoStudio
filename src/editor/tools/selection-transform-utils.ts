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
  const axisScale = (current: number, initial: number, origin: number) => {
    const initialDistance = Math.abs(initial - origin)
    // A handle sitting on the pivot cannot scale along that axis.
    if (initialDistance < 0.001) return 1
    return Math.max(0.01, Math.abs(current - origin) / initialDistance)
  }
  let sx = horizontal ? axisScale(pointer.x, handleX, pivot.x) : 1
  let sy = vertical ? axisScale(pointer.y, handleY, pivot.y) : 1

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
