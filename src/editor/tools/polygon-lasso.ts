// ============================================================
// Polygonal Lasso (Task 2-b polish)
//  · click adds points; moving shows the rubber band
//  · click near the first point (within 10 screen px) closes & commits
//  · double-click or Enter commits; Escape cancels; Backspace removes the
//    last point
//  · combine mode from options + shift/alt modifiers — a modifier press
//    while a polygon is active first finishes the current polygon, then
//    starts a fresh one
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, combineMode, drawCross } from './shared'

let pts: { x: number; y: number }[] = []
let hover: { x: number; y: number } | null = null
let lastShift = false
let lastAlt = false
let editingVertex: number | null = null

function nearestVertex(p: PointerInfo): number | null {
  const doc = engine.activeDoc
  if (!doc || !pts.length) return null
  const tol = 9 / Math.max(.02, doc.view.zoom)
  let best = -1, bestD = tol
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(p.docX - pts[i].x, p.docY - pts[i].y)
    if (d <= bestD) { best = i; bestD = d }
  }
  return best >= 0 ? best : null
}

function constrainedPoint(p: PointerInfo): { x: number; y: number } {
  if (!p.shift || !pts.length) return { x: p.docX, y: p.docY }
  const a = pts[pts.length - 1]
  const dx = p.docX - a.x, dy = p.docY - a.y
  const len = Math.hypot(dx, dy)
  if (len < .001) return { x: p.docX, y: p.docY }
  const deg = Math.max(1, Number(getOptions('polygon-lasso').angleSnap) || 45)
  const step = deg * Math.PI / 180
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len }
}

/** distance from the first vertex in SCREEN pixels (null if < 2 pts) */
function distToFirstScreen(p: PointerInfo): number | null {
  const doc = engine.activeDoc
  if (!doc || pts.length < 2) return null
  const first = pts[0]
  return Math.hypot(p.docX - first.x, p.docY - first.y) * doc.view.zoom
}

function commit(mode?: 'new' | 'add' | 'subtract' | 'intersect') {
  if (pts.length < 3) { pts = []; engine.pokeOverlay(); return }
  const opts = getOptions('polygon-lasso')
  engine.selectPolygon(pts, opts.feather ?? 0, mode ?? opts.mode ?? 'new', opts.antiAlias !== false)
  pts = []
  engine.pokeOverlay()
}

function cancel() {
  if (!pts.length) return
  pts = []
  engine.pokeOverlay()
}

export const polygonLassoTool: Tool = {
  id: 'polygon-lasso',
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    lastShift = p.shift
    lastAlt = p.alt
    const doc = engine.activeDoc
    if (!doc) return

    if ((p.ctrl || p.meta) && pts.length) {
      const hit = nearestVertex(p)
      if (hit !== null) {
        editingVertex = hit
        hover = null
        engine.pokeOverlay()
        return
      }
    }

    // close when clicking near the first vertex (10 screen px)
    const dFirst = distToFirstScreen(p)
    if (pts.length >= 3 && dFirst !== null && dFirst < 10) {
      commit(combineMode(p, getOptions('polygon-lasso').mode ?? 'new'))
      return
    }

    const mode = combineMode(p, 'new')
    if (pts.length && mode !== 'new') {
      // modifier while a polygon is active: finish the current one first,
      // then start the next with this click
      commit(mode)
      const q = constrainedPoint(p)
      pts = [{ x: q.x, y: q.y }]
      engine.pokeOverlay()
      return
    }

    const q = constrainedPoint(p)
    pts.push(q)
    engine.pokeOverlay()
  },

  onPointerMove(p: PointerInfo) {
    if (editingVertex !== null) {
      let q = { x: p.docX, y: p.docY }
      if (p.shift && pts.length > 1) {
        const ref = editingVertex > 0 ? pts[editingVertex - 1] : pts[1]
        const dx = q.x - ref.x, dy = q.y - ref.y
        const len = Math.hypot(dx, dy)
        if (len > .001) {
          const step = Math.max(1, Number(getOptions('polygon-lasso').angleSnap) || 45) * Math.PI / 180
          const a = Math.round(Math.atan2(dy, dx) / step) * step
          q = { x: ref.x + Math.cos(a) * len, y: ref.y + Math.sin(a) * len }
        }
      }
      pts[editingVertex] = q
      engine.pokeOverlay()
      return
    }
    hover = constrainedPoint(p)
    engine.pokeOverlay()
  },

  onPointerUp() {
    if (editingVertex !== null) {
      editingVertex = null
      engine.pokeOverlay()
    }
  },

  onDeactivate() {
    editingVertex = null
    hover = null
  },

  onDoubleClick() {
    if (pts.length) commit(combineMode({ shift: lastShift, alt: lastAlt }, getOptions('polygon-lasso').mode ?? 'new'))
  },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') { if (pts.length) { commit(); return true } }
    if (e.key === 'Escape') { if (pts.length) { cancel(); return true } }
    if (e.key === 'Backspace') {
      if (pts.length) {
        e.preventDefault()
        pts = pts.slice(0, -1)
        engine.pokeOverlay()
        return true
      }
    }
    return false
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    if (pts.length) {
      ctx.save()
      ctx.translate(view.panX, view.panY)
      ctx.scale(view.zoom, view.zoom)
      // rubber band (dual-stroke for contrast on any background)
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
      if (hover) ctx.lineTo(hover.x, hover.y)
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'
      ctx.lineWidth = 2 / view.zoom
      ctx.setLineDash([])
      ctx.stroke()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1 / view.zoom
      ctx.stroke()
      ctx.restore()

      // vertex markers
      ctx.save()
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        ctx.beginPath()
        ctx.arc(p.x * view.zoom + view.panX, p.y * view.zoom + view.panY, i === editingVertex ? 4.5 : 3, 0, Math.PI * 2)
        ctx.fillStyle = i === editingVertex ? '#e8a33d' : '#ffffff'
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,.75)'
        ctx.lineWidth = 1
        ctx.stroke()
      }
      ctx.restore()

      // first-vertex close indicator
      if (pts.length >= 3 && hover) {
        const d = Math.hypot(hover.x - pts[0].x, hover.y - pts[0].y) * view.zoom
        if (d < 10) {
          const fx = pts[0].x * view.zoom + view.panX
          const fy = pts[0].y * view.zoom + view.panY
          ctx.save()
          ctx.strokeStyle = '#e8a33d'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(fx, fy, 7, 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()
        }
      }
    } else drawCross(ctx, mouse)
  },
}
