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
        if (selectedId === hit) selectedId = null
      }
      return
    }

    if (hit) {
      draggingId = hit
      selectedId = hit
      return
    }

    const id = engine.addColorSampler(p.docX, p.docY)
    if (id) {
      draggingId = id
      selectedId = id
    }
  },

  onPointerMove(p: PointerInfo) {
    if (!draggingId) return
    engine.moveColorSampler(draggingId, p.docX, p.docY)
  },

  onPointerUp() { draggingId = null },

  onKeyDown(e: KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      engine.removeColorSampler(selectedId)
      selectedId = null
      return true
    }
    if (e.key === 'Escape' && draggingId) {
      draggingId = null
      return true
    }
    return false
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
      const selected = p.id === selectedId
      const hex = engine.sampleColor(p.x, p.y, scope, radius) ?? '#000000'

      ctx.strokeStyle = selected ? '#e8a33d' : '#ffffff'
      ctx.lineWidth = selected ? 2 : 1.25
      ctx.beginPath()
      ctx.arc(sx, sy, 7, 0, Math.PI * 2)
      ctx.moveTo(sx - 11, sy); ctx.lineTo(sx + 11, sy)
      ctx.moveTo(sx, sy - 11); ctx.lineTo(sx, sy + 11)
      ctx.stroke()

      ctx.fillStyle = 'rgba(0,0,0,.82)'
      const label = opts.showLabels === false ? String(i + 1) : `${i + 1}  ${hex.toUpperCase()}`
      const tw = ctx.measureText(label).width + 9
      ctx.fillRect(sx + 10, sy - 8, tw, 16)
      ctx.fillStyle = hex
      ctx.fillRect(sx + 12, sy - 5, 6, 10)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, sx + (opts.showLabels === false ? 14 : 21), sy)
    }
    ctx.restore()
    drawCross(ctx, mouse)
  },
}
