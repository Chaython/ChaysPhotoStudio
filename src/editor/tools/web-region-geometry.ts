import { circleMetrics, regionShape, type WebRegion } from '../web-assets'

export type RegionRect = Pick<WebRegion, 'x' | 'y' | 'width' | 'height'>
export type RegionPoint = { x: number; y: number }
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
export function regionPoint(x: number, y: number, width: number, height: number): RegionPoint {
  return { x: clamp(Number.isFinite(x) ? Math.round(x) : 0, 0, Math.max(0, width - 1)),
    y: clamp(Number.isFinite(y) ? Math.round(y) : 0, 0, Math.max(0, height - 1)) }
}
export function regionFromDrag(a: RegionPoint, b: RegionPoint, docW: number, docH: number, square = false): RegionRect {
  const start = regionPoint(a.x, a.y, docW, docH)
  const end = regionPoint(b.x, b.y, docW, docH)
  let dx = end.x - start.x, dy = end.y - start.y
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * side
    dy = Math.sign(dy || 1) * side
  }
  const bx = clamp(start.x + dx, 0, docW - 1), by = clamp(start.y + dy, 0, docH - 1)
  const x = Math.min(start.x, bx), y = Math.min(start.y, by)
  return { x, y, width: Math.abs(bx - start.x) + 1, height: Math.abs(by - start.y) + 1 }
}
export function moveRegionRect(rect: RegionRect, dx: number, dy: number, docW: number, docH: number): RegionRect {
  return { ...rect,
    x: clamp(rect.x + Math.round(dx), 0, Math.max(0, docW - rect.width)),
    y: clamp(rect.y + Math.round(dy), 0, Math.max(0, docH - rect.height)) }
}
export function resizeRegionRect(rect: RegionRect, end: RegionPoint, docW: number, docH: number, square = false): RegionRect {
  const b = regionPoint(end.x, end.y, docW, docH)
  const w = Math.max(1, b.x - rect.x + 1), h = Math.max(1, b.y - rect.y + 1)
  const size = Math.max(w, h)
  return { ...rect,
    width: Math.min(docW - rect.x, square ? size : w),
    height: Math.min(docH - rect.y, square ? size : h) }
}
export function rectChanged(a: RegionRect, b: RegionRect): boolean {
  return a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height
}

/** Even-odd ray casting; boundary points count as inside for stable clicking. */
export function pointInPolygon(points: readonly number[], x: number, y: number): boolean {
  if (points.length < 6 || points.length % 2 !== 0) return false
  let inside = false
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const xi = points[i], yi = points[i + 1], xj = points[j], yj = points[j + 1]
    // Exact boundary hit keeps thin polygon edges clickable.
    const onSegment = (yi === yj && y === yi && x >= Math.min(xi, xj) && x <= Math.max(xi, xj))
      || (xi === xj && x === xi && y >= Math.min(yi, yj) && y <= Math.max(yi, yj))
    if (onSegment) return true
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Shape-aware containment test used for selection, Alt-delete and dialog picks. */
export function regionContains(r: WebRegion, x: number, y: number): boolean {
  const shape = regionShape(r)
  if (shape === 'circle') {
    const c = circleMetrics(r)
    return Math.hypot(x - c.cx, y - c.cy) <= c.radius
  }
  if (shape === 'poly' && r.points && r.points.length >= 6) {
    return pointInPolygon(r.points, x, y)
  }
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height
}

export function findWebRegion(regions: readonly WebRegion[], x: number, y: number): WebRegion | null {
  for (let i = regions.length - 1; i >= 0; i--) {
    if (regionContains(regions[i], x, y)) return regions[i]
  }
  return null
}

/** Bounding box of a region's geometry (polygon points win when present). */
export function regionBounds(points: readonly number[]): RegionRect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i])
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1])
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/**
 * Move a whole region by (dx, dy). Polygon vertices shift with the bounding box,
 * which stays clamped inside the document.
 */
export function moveRegion(r: WebRegion, dx: number, dy: number, docW: number, docH: number): WebRegion {
  const moved = moveRegionRect(r, dx, dy, docW, docH)
  if (regionShape(r) !== 'poly' || !r.points) return { ...r, ...moved }
  const sx = moved.x - r.x, sy = moved.y - r.y
  const points = r.points.slice()
  for (let i = 0; i + 1 < points.length; i += 2) { points[i] += sx; points[i + 1] += sy }
  return { ...r, ...moved, points }
}

/**
 * Scale polygon vertices from the current bounding box into a new one.
 * Rounding keeps vertices on integer document pixels; the returned region
 * carries the recomputed bounding box.
 */
export function scaleRegionPoints(r: WebRegion, target: RegionRect, docW: number, docH: number): WebRegion {
  if (regionShape(r) !== 'poly' || !r.points || r.points.length < 6) return r
  const src = regionBounds(r.points)
  const sx = src.width > 1 ? (target.width - 1) / (src.width - 1) : 1
  const sy = src.height > 1 ? (target.height - 1) / (src.height - 1) : 1
  const points = r.points.map((n, i) => i % 2 === 0
    ? clamp(Math.round(target.x + (n - src.x) * sx), 0, Math.max(0, docW - 1))
    : clamp(Math.round(target.y + (n - src.y) * sy), 0, Math.max(0, docH - 1)))
  return { ...r, points, ...regionBounds(points) }
}

/** Move one polygon vertex; returns a new region with a recomputed bbox. */
export function moveRegionVertex(r: WebRegion, index: number, p: RegionPoint, docW: number, docH: number): WebRegion {
  if (regionShape(r) !== 'poly' || !r.points || index < 0 || index * 2 + 1 >= r.points.length) return r
  const q = regionPoint(p.x, p.y, docW, docH)
  const points = r.points.slice()
  points[index * 2] = q.x
  points[index * 2 + 1] = q.y
  return { ...r, points, ...regionBounds(points) }
}

/** Nearest polygon vertex index within `tol` document pixels, or -1. */
export function findRegionVertex(r: WebRegion, x: number, y: number, tol: number): number {
  if (regionShape(r) !== 'poly' || !r.points) return -1
  let best = -1, bestDist = tol
  for (let i = 0; i + 1 < r.points.length; i += 2) {
    const d = Math.hypot(x - r.points[i], y - r.points[i + 1])
    if (d <= bestDist) { best = i / 2; bestDist = d }
  }
  return best
}

/** Shape-aware change detection covering vertices, not just the bounding box. */
export function regionChanged(a: WebRegion, b: WebRegion): boolean {
  if (rectChanged(a, b) || regionShape(a) !== regionShape(b)) return true
  if (regionShape(a) === 'poly') {
    const pa = a.points ?? [], pb = b.points ?? []
    if (pa.length !== pb.length) return true
    return pa.some((n, i) => n !== pb[i])
  }
  return false
}
