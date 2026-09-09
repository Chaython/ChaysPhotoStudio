import type { Tool, PointerInfo, Rect } from '../types'
import { engine } from '../engine/engine'
import { newDrag, getOptions, combineMode, drawDashedRect, drawCross } from './shared'
import { rectFromPoints, clamp } from '../utils/canvas'
import { snapToGuides } from '../engine/guides'
import { useEditorStore } from '../store'

/** guide-snap a doc point when snapping is enabled */
function snapPoint(x: number, y: number): { x: number; y: number } {
  const doc = engine.activeDoc
  if (!doc) return { x, y }
  const prefs = useEditorStore.getState().view
  if (!prefs.snapGuides || !doc.guides?.length) return { x, y }
  return snapToGuides(doc, doc.view, x, y)
}

let drag = newDrag()
let current: Rect | null = null

function make(kind: 'rect' | 'ellipse'): Tool {
  return {
    id: kind === 'rect' ? 'marquee-rect' : 'marquee-ellipse',
    cursor: 'crosshair',
    onPointerDown(p: PointerInfo) {
      const opts = getOptions(kind === 'rect' ? 'marquee-rect' : 'marquee-ellipse')
      void opts
      const s = snapPoint(p.docX, p.docY)
      drag = { startX: s.x, startY: s.y, lastX: s.x, lastY: s.y, active: true }
      current = null
    },
    onPointerMove(p: PointerInfo) {
      if (!drag.active) return
      const s = snapPoint(p.docX, p.docY)
      let rect = rectFromPoints(drag.startX, drag.startY, s.x, s.y)
      const opts = getOptions(kind === 'rect' ? 'marquee-rect' : 'marquee-ellipse')
      if (p.shift) {
        const sq = Math.max(rect.w, rect.h)
        rect = { ...rect, w: sq, h: sq }
      }
      if (opts.style === 'ratio' && opts.ratioValue) { /* fixed ratio handled at commit */ }
      current = rect
      engine.pokeOverlay()
    },
    onPointerUp(p: PointerInfo) {
      if (!drag.active) return
      drag.active = false
      const opts = getOptions(kind === 'rect' ? 'marquee-rect' : 'marquee-ellipse')
      let rect = current ?? rectFromPoints(drag.startX, drag.startY, p.docX, p.docY)
      if (p.shift) { const s = Math.max(rect.w, rect.h); rect = { ...rect, w: s, h: s } }
      if (rect.w < 1 || rect.h < 1) { current = null; engine.pokeOverlay(); return }
      if (opts.style === 'fixed') {
        rect = { ...rect, w: Number(opts.fixedW) || rect.w, h: Number(opts.fixedH) || rect.h }
      }
      const mode = combineMode(p, opts.mode ?? 'new')
      engine.selectShape(
        { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
        kind, opts.feather ?? 0, mode
      )
      current = null
    },
    renderOverlay(ctx, view, w, h, mouse) {
      void w; void h
      if (current && drag.active) {
        const x = current.x * view.zoom + view.panX
        const y = current.y * view.zoom + view.panY
        const rw = current.w * view.zoom
        const rh = current.h * view.zoom
        ctx.save()
        ctx.fillStyle = 'rgba(255,255,255,0.08)'
        if (kind === 'ellipse') {
          ctx.beginPath()
          ctx.ellipse(x + rw / 2, y + rh / 2, Math.abs(rw / 2), Math.abs(rh / 2), 0, 0, Math.PI * 2)
          ctx.fill()
        } else ctx.fillRect(x, y, rw, rh)
        ctx.restore()
        drawDashedRect(ctx, x, y, rw, rh)
        // size readout
        ctx.save()
        ctx.fillStyle = 'rgba(0,0,0,0.7)'
        ctx.fillRect(x + rw + 6, y - 20, 90, 16)
        ctx.fillStyle = '#fff'
        ctx.font = '11px monospace'
        ctx.fillText(`${Math.round(current.w)} × ${Math.round(current.h)}`, x + rw + 10, y - 8)
        ctx.restore()
      }
      if (!drag.active) drawCross(ctx, mouse)
      void clamp
    },
  }
}

export const marqueeRectTool: Tool = make('rect')
export const marqueeEllipseTool: Tool = make('ellipse')
