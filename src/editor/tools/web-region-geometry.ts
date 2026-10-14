import type { WebRegion } from '../web-assets'

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
export function findWebRegion(regions: readonly WebRegion[], x: number, y: number): WebRegion | null {
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i]
    if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return r
  }
  return null
}
