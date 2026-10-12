// ============================================================
// Color Sampler — persistent numbered sampling points for the Info panel.
//
// Click to add, drag an existing point to move it, Alt/Option-click to remove.
// Points live in document coordinates, survive tool switches/project saves and
// update their readouts as the underlying image changes.
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, drawCross } from './shared'

let draggingId: string | null = null
let selectedId: string | null = null
let selectedDocId: string | null = null

function currentSelection(): string | null {
  return selectedDocId === engine.activeDoc?.id ? selectedId : null
}

function sampleRadius(): number {
  const size = Math.max(1, Number(getOptions('color-sampler').radius) || 1)
  return Math.max(0, Math.floor((size - 1) / 2))
}

function hitSampler(x: number, y: number): string | null {
  const doc = engine.activeDoc
  if (!doc?.colorSamplers?.length) return null
  const tol = 10 / Math.max(.05, doc.view.zoom)
  let best: { id: string; d: number } | null = null
  for (const p of doc.colorSamplers) {
    const d = Math.hypot(x - p.x, y - p.y)
    if (d <= tol && (!best || d < best.d)) best = { id: p.id, d }
  }
  return best?.id ?? null
}

export const colorSamplerTool: Tool = {
  id: 'color-sampler',
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const hit = hitSampler(p.docX, p.docY)
    if (p.alt) {
      if (hit) {
        engine.removeColorSampler(hit)
        if (currentSelection() === hit) selectedId = null
      }
      return
    }

    if (hit) {
      draggingId = hit
      selectedId = hit
      selectedDocId = engine.activeDoc?.id ?? null
      return
    }

    const id = engine.addColorSampler(p.docX, p.docY)
    if (id) {
      draggingId = id
      selectedId = id
      selectedDocId = engine.activeDoc?.id ?? null
    }
  },

  onPointerMove(p: PointerInfo) {
    if (!draggingId) return
    engine.moveColorSampler(draggingId, p.docX, p.docY)
  },

  onPointerUp() { draggingId = null },

  onKeyDown(e: KeyboardEvent) {
    const id = currentSelection()
    if (e.key === 'Escape') {
      if (!draggingId && !id) return false
      draggingId = null
      selectedId = null
      engine.pokeOverlay()
      return true
    }
    if (!id || e.ctrlKey || e.altKey || e.metaKey) return false
    if (e.key === 'Delete' || e.key === 'Backspace') {
      engine.removeColorSampler(id)
      selectedId = null
      return true
    }
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }
    const direction = delta[e.key]
    const point = engine.activeDoc?.colorSamplers?.find(sample => sample.id === id)
    if (!direction || !point) return false
    const step = e.shiftKey ? 10 : 1
    engine.moveColorSampler(id, point.x + direction[0] * step, point.y + direction[1] * step)
    return true
  },

  onDeactivate() { draggingId = null },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    const doc = engine.activeDoc
    const pts = doc?.colorSamplers ?? []
    const opts = getOptions('color-sampler')
    const scope = opts.sample === 'layer' ? 'layer' : 'composite'
    const radius = sampleRadius()

    ctx.save()
    ctx.font = '10px ui-monospace, monospace'
    ctx.textBaseline = 'middle'
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const sx = view.panX + p.x * view.zoom
      const sy = view.panY + p.y * view.zoom
      const selected = p.id === currentSelection()
      const hex = engine.sampleColor(p.x, p.y, scope, radius)

      ctx.strokeStyle = selected ? '#e8a33d' : '#ffffff'
      ctx.lineWidth = selected ? 2 : 1.25
      ctx.beginPath()
      ctx.arc(sx, sy, 7, 0, Math.PI * 2)
      ctx.moveTo(sx - 11, sy); ctx.lineTo(sx + 11, sy)
      ctx.moveTo(sx, sy - 11); ctx.lineTo(sx, sy + 11)
      ctx.stroke()

      const showColor = opts.showLabels !== false
      const label = showColor ? `${i + 1}  ${hex?.toUpperCase() ?? 'Transparent'}` : String(i + 1)
      const boxWidth = ctx.measureText(label).width + (showColor ? 33 : 12)
      const lx = Math.max(2, Math.min(sx + 12, w - boxWidth - 2))
      const ly = Math.max(2, Math.min(sy - 8, h - 18))
      ctx.fillStyle = 'rgba(0,0,0,.82)'
      ctx.fillRect(lx, ly, boxWidth, 16)
      if (showColor) {
        ctx.fillStyle = hex ?? '#555555'
        ctx.fillRect(lx + 3, ly + 3, 7, 10)
      }
      ctx.fillStyle = '#fff'
      ctx.fillText(label, lx + (showColor ? 14 : 6), ly + 8)
    }
    ctx.restore()
    drawCross(ctx, mouse)
  },
}
