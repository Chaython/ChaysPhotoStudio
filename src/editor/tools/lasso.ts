import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { newDrag, getOptions, combineMode, drawCross } from './shared'

let pts: { x: number; y: number }[] = []
let active = false

export const lassoTool: Tool = {
  id: 'lasso',
  cursor: 'crosshair',
  onPointerDown(p: PointerInfo) {
    pts = [{ x: p.docX, y: p.docY }]
    active = true
  },
  onPointerMove(p: PointerInfo) {
    if (!active) return
    const last = pts[pts.length - 1]
    if (Math.hypot(p.docX - last.x, p.docY - last.y) > 1.5) pts.push({ x: p.docX, y: p.docY })
    engine.requestRender()
  },
  onPointerUp() {
    if (!active) return
    active = false
    const opts = getOptions('lasso')
    if (pts.length > 3) {
      const mode = combineMode({ shift: lastShift, alt: lastAlt }, opts.mode ?? 'new')
      engine.selectPolygon(pts, opts.feather ?? 0, mode)
    }
    pts = []
    engine.requestRender()
  },
  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    if (active && pts.length > 1) {
      ctx.save()
      ctx.translate(view.panX, view.panY)
      ctx.scale(view.zoom, view.zoom)
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5 / view.zoom
      ctx.setLineDash([])
      ctx.stroke()
      ctx.restore()
    }
    if (!active) drawCross(ctx, mouse)
  },
}

let lastShift = false
let lastAlt = false
const origDown = lassoTool.onPointerDown!
lassoTool.onPointerDown = (p: PointerInfo) => { lastShift = p.shift; lastAlt = p.alt; origDown(p) }
