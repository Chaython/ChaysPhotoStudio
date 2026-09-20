import type { ShapeSpec } from '../types'

/** Trace the vector geometry for a shape layer. The caller controls fill/stroke. */
export function traceShapePath(ctx: CanvasRenderingContext2D, spec: ShapeSpec) {
  const { x, y, w, h, shape } = spec
  ctx.beginPath()
  if (shape === 'path' && spec.pathAnchors?.length) {
    const a = spec.pathAnchors
    ctx.moveTo(a[0].x, a[0].y)
    for (let i = 1; i < a.length; i++) {
      const p0 = a[i - 1], p1 = a[i]
      ctx.bezierCurveTo(
        p0.x + p0.outX, p0.y + p0.outY,
        p1.x + p1.inX, p1.y + p1.inY,
        p1.x, p1.y,
      )
    }
    if (spec.pathClosed && a.length >= 2) {
      const p0 = a[a.length - 1], p1 = a[0]
      ctx.bezierCurveTo(
        p0.x + p0.outX, p0.y + p0.outY,
        p1.x + p1.inX, p1.y + p1.inY,
        p1.x, p1.y,
      )
      ctx.closePath()
    }
    return
  }
  if (shape === 'ellipse') {
    ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2)
    return
  }
  if (shape === 'line') {
    ctx.moveTo(x, y)
    ctx.lineTo(x + w, y + h)
    return
  }
  if (shape === 'rounded-rect') {
    const r = Math.min(Math.max(0, spec.radius), Math.abs(w) / 2, Math.abs(h) / 2)
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
    return
  }
  if (shape === 'triangle' || shape === 'polygon' || shape === 'star') {
    const cx = x + w / 2
    const cy = y + h / 2
    const rx = Math.abs(w) / 2
    const ry = Math.abs(h) / 2
    const sides = shape === 'triangle' ? 3 : Math.max(3, Math.min(32, Math.round(spec.sides || 5)))
    const star = shape === 'star'
    const points = star ? sides * 2 : sides
    const inset = Math.max(0.05, Math.min(0.95, (spec.starInset || 45) / 100))
    for (let i = 0; i < points; i++) {
      const outer = !star || i % 2 === 0
      const rr = outer ? 1 : inset
      const a = -Math.PI / 2 + (i * Math.PI * 2) / points
      const px = cx + Math.cos(a) * rx * rr
      const py = cy + Math.sin(a) * ry * rr
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    return
  }
  ctx.rect(x, y, w, h)
}
