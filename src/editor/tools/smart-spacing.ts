export interface SpacingRect {
  x: number
  y: number
  w: number
  h: number
}

type Axis = 'x' | 'y'
type Side = 'before' | 'after'

/**
 * Infer a repeated edge gap from the two nearest stationary neighbors on one
 * side of a moving rectangle. Returns the required movement on the selected
 * axis only when the correction is within the screen-space snap tolerance.
 */
export function inferOneSidedSpacing(
  moving: SpacingRect,
  others: SpacingRect[],
  axis: Axis,
  side: Side,
  tolerance: number,
): number | null {
  const horizontal = axis === 'x'
  const start = horizontal ? moving.x : moving.y
  const size = horizontal ? moving.w : moving.h
  const crossStart = horizontal ? moving.y : moving.x
  const crossSize = horizontal ? moving.h : moving.w
  const end = start + size

  const candidates = others.filter(other => {
    const otherStart = horizontal ? other.x : other.y
    const otherSize = horizontal ? other.w : other.h
    const otherCrossStart = horizontal ? other.y : other.x
    const otherCrossSize = horizontal ? other.h : other.w
    const overlaps = Math.min(crossStart + crossSize, otherCrossStart + otherCrossSize)
      > Math.max(crossStart, otherCrossStart)
    return overlaps && (side === 'before'
      ? otherStart + otherSize <= start
      : otherStart >= end)
  }).sort((a, b) => {
    const aStart = horizontal ? a.x : a.y
    const aEnd = aStart + (horizontal ? a.w : a.h)
    const bStart = horizontal ? b.x : b.y
    const bEnd = bStart + (horizontal ? b.w : b.h)
    return side === 'before' ? bEnd - aEnd : aStart - bStart
  })

  if (candidates.length < 2) return null
  const nearest = candidates[0]
  const farther = candidates[1]
  const nearestStart = horizontal ? nearest.x : nearest.y
  const nearestSize = horizontal ? nearest.w : nearest.h
  const fartherStart = horizontal ? farther.x : farther.y
  const fartherSize = horizontal ? farther.w : farther.h
  const gap = side === 'before'
    ? nearestStart - (fartherStart + fartherSize)
    : fartherStart - (nearestStart + nearestSize)
  if (!Number.isFinite(gap) || gap < 0) return null

  const targetStart = side === 'before'
    ? nearestStart + nearestSize + gap
    : nearestStart - gap - size
  const correction = targetStart - start
  return Math.abs(correction) <= tolerance ? correction : null
}
