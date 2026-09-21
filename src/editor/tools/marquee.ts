import type { Tool, PointerInfo, Rect } from '../types'
import { engine } from '../engine/engine'
import { newDrag, getOptions, combineMode, drawDashedRect, drawCross } from './shared'
import { rectFromPoints } from '../utils/canvas'
import { snapToGuides } from '../engine/guides'
import { useEditorStore } from '../store'

function snapPoint(x: number, y: number): { x: number; y: number } {
  const doc = engine.activeDoc
  if (!doc) return { x, y }
  const prefs = useEditorStore.getState().view
  if (!prefs.snapGuides || !doc.guides?.length) return { x, y }
  return snapToGuides(doc, doc.view, x, y)
}

let drag = newDrag()
let current: Rect | null = null
let startMods = { shift: false, alt: false }

function ratioFrom(opts: Record<string, any>): number {
  return Math.max(0.001, (Number(opts.ratioW) || 1) / Math.max(0.001, Number(opts.ratioH) || 1))
}

function geometry(kind: 'rect' | 'ellipse', p: PointerInfo, opts: Record<string, any>): Rect {
  const s = snapPoint(p.docX, p.docY)
  const style = opts.style ?? 'normal'
  if (style === 'fixed') {
    const w = Math.max(1, Number(opts.fixedW) || 100)
    const h = Math.max(1, Number(opts.fixedH) || 100)
    return p.alt
      ? { x: s.x - w / 2, y: s.y - h / 2, w, h }
      : { x: s.x, y: s.y, w, h }
  }

  let dx = s.x - drag.startX, dy = s.y - drag.startY
  const forcedRatio = style === 'ratio' ? ratioFrom(opts) : (p.shift ? 1 : null)
  if (forcedRatio) {
    if (Math.abs(dx) / Math.max(.001, Math.abs(dy)) > forcedRatio) {
      dy = Math.sign(dy || 1) * Math.abs(dx) / forcedRatio
    } else {
      dx = Math.sign(dx || 1) * Math.abs(dy) * forcedRatio
    }
  }

  // Alt/Option grows from the initial click as the center. This also fixes
  // the old Shift-square bug where dragging up/left could jump quadrants.
  if (p.alt) {
    return {
      x: drag.startX - Math.abs(dx),
      y: drag.startY - Math.abs(dy),
      w: Math.abs(dx) * 2,
      h: Math.abs(dy) * 2,
    }
  }
  return rectFromPoints(drag.startX, drag.startY, drag.startX + dx, drag.startY + dy)
}

function make(kind: 'rect' | 'ellipse'): Tool {
  const id = kind === 'rect' ? 'marquee-rect' : 'marquee-ellipse'
  return {
    id,
    cursor: 'crosshair',

    onPointerDown(p: PointerInfo) {
      if (p.button !== 0) return
      const s = snapPoint(p.docX, p.docY)
      drag = { startX: s.x, startY: s.y, lastX: s.x, lastY: s.y, active: true }
      startMods = { shift: p.shift, alt: p.alt }
      const opts = getOptions(id)
      current = opts.style === 'fixed' ? geometry(kind, p, opts) : null
      engine.pokeOverlay()
    },

    onPointerMove(p: PointerInfo) {
      if (!drag.active) return
      current = geometry(kind, p, getOptions(id))
      engine.pokeOverlay()
    },

    onPointerUp(p: PointerInfo) {
      if (!drag.active) return
      drag.active = false
      const opts = getOptions(id)
      const rect = current ?? geometry(kind, p, opts)
      current = null
      if (rect.w < 1 || rect.h < 1) { engine.pokeOverlay(); return }
      // Combine modifiers are determined by the gesture start, so releasing
      // Shift after using it to constrain geometry cannot accidentally change
      // Add/Subtract semantics at commit.
      const mode = combineMode(startMods, opts.mode ?? 'new')
      engine.selectShape(
        { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
        kind, opts.feather ?? 0, mode, opts.antiAlias !== false,
      )
      engine.pokeOverlay()
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && drag.active) {
        drag.active = false; current = null; engine.pokeOverlay(); return true
      }
      return false
    },

    onDeactivate() {
      drag.active = false
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
        ctx.save()
        const label = `${Math.round(current.w)} × ${Math.round(current.h)}`
        ctx.font = '11px monospace'
        const tw = ctx.measureText(label).width + 12
        ctx.fillStyle = 'rgba(0,0,0,0.72)'
        ctx.fillRect(x + rw + 6, y - 20, tw, 16)
        ctx.fillStyle = '#fff'
        ctx.fillText(label, x + rw + 12, y - 8)
        ctx.restore()
      } else drawCross(ctx, mouse)
    },
  }
}

export const marqueeRectTool: Tool = make('rect')
export const marqueeEllipseTool: Tool = make('ellipse')
