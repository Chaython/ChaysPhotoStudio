import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, combineMode, drawCross } from './shared'

type Pt = { x: number; y: number }
let pts: Pt[] = []
let active = false
let startMods = { shift: false, alt: false }

function pointLineDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y
  if (Math.abs(dx) + Math.abs(dy) < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// Douglas-Peucker path cleanup removes hand jitter without changing the
// overall contour. Smoothing 0 preserves every sampled point.
function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 3 || tolerance <= 0) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1; keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let best = 0, idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = pointLineDistance(points[i], points[a], points[b])
      if (d > best) { best = d; idx = i }
    }
    if (idx >= 0 && best > tolerance) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

function cancel() {
  active = false
  pts = []
  engine.pokeOverlay()
}

export const lassoTool: Tool = {
  id: 'lasso',
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    pts = [{ x: p.docX, y: p.docY }]
    startMods = { shift: p.shift, alt: p.alt }
    active = true
    engine.pokeOverlay()
  },

  onPointerMove(p: PointerInfo) {
    if (!active) return
    const last = pts[pts.length - 1]
    const step = 1.5 / Math.max(engine.activeDoc?.view.zoom ?? 1, .25)
    if (Math.hypot(p.docX - last.x, p.docY - last.y) > step) pts.push({ x: p.docX, y: p.docY })
    engine.pokeOverlay()
  },

  onPointerUp() {
    if (!active) return
    active = false
    const opts = getOptions('lasso')
    if (pts.length > 3) {
      const smoothing = Math.max(0, Number(opts.smoothing) || 0)
      const cleaned = simplify(pts, smoothing * .35)
      const mode = combineMode(startMods, opts.mode ?? 'new')
      engine.selectPolygon(cleaned, opts.feather ?? 0, mode, opts.antiAlias !== false)
    }
    pts = []
    engine.pokeOverlay()
  },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && active) { cancel(); return true }
    return false
  },

  onDeactivate() { if (active || pts.length) cancel() },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    if (active && pts.length > 1) {
      ctx.save()
      ctx.translate(view.panX, view.panY)
      ctx.scale(view.zoom, view.zoom)
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
      ctx.strokeStyle = 'rgba(0,0,0,.75)'
      ctx.lineWidth = 3 / view.zoom
      ctx.stroke()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1 / view.zoom
      ctx.stroke()
      ctx.restore()
    } else drawCross(ctx, mouse)
  },
}
