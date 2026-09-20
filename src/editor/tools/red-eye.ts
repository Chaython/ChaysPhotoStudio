// ============================================================
// Red Eye Tool — localized red-pupil correction.
//
// A short brush/click identifies red-dominant pixels inside the pupil-sized
// region, neutralizes excess red toward the green/blue luminance and applies
// configurable darkening. Selection masks are honored through regionProcess.
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, regionProcess, walkDabs, drawBrushCursor } from './shared'
import { clamp } from '../utils/canvas'

let active = false
let layerId: string | null = null
let last: { x: number; y: number } | null = null
let changed = false

function correct(x: number, y: number) {
  if (!active || !layerId) return
  const opts = getOptions('red-eye')
  const size = Math.max(8, Number(opts.size) || 60)
  const radius = size / 2
  const darken = clamp((Number(opts.darken) || 0) / 100, 0, 1)
  const threshold = clamp(Number(opts.threshold) || 0, 0, 100)

  regionProcess(layerId, x, y, radius, (region, falloff, rw, rh) => {
    const d = region.data
    for (let i = 0; i < rw * rh; i++) {
      const f = falloff[i]
      if (f <= .001) continue
      const j = i * 4
      const r = d[j], g = d[j + 1], b = d[j + 2]
      const base = Math.max(g, b)
      const redness = ((r - base) / 255) * 100
      if (redness < threshold || r < 45) continue

      // Neutralize the red channel but retain a natural warm pupil rather than
      // forcing grayscale. Darken all channels together after neutralization.
      const neutralR = base * .92
      const strength = clamp((redness - threshold) / Math.max(1, 100 - threshold), .2, 1) * f
      let rr = r * (1 - strength) + neutralR * strength
      let gg = g
      let bb = b
      const shade = 1 - darken * .65 * strength
      rr *= shade; gg *= shade; bb *= shade
      d[j] = clamp(rr, 0, 255)
      d[j + 1] = clamp(gg, 0, 255)
      d[j + 2] = clamp(bb, 0, 255)
      changed = true
    }
  }, 65)
  engine.requestRender()
}

function finish() {
  if (!active) return
  active = false
  last = null
  layerId = null
  if (changed) {
    changed = false
    engine.pushHistory('Red Eye Correction')
    engine.emit()
  } else engine.requestRender()
}

export const redEyeTool: Tool = {
  id: 'red-eye',
  requiresLayer: true,
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const layer = engine.activeLayer
    if (!layer || layer.locked || layer.kind === 'adjustment') return
    const l = engine.mutateLayerPixels(layer.id)
    if (!l?.canvas) return
    active = true
    changed = false
    layerId = l.id
    last = { x: p.docX, y: p.docY }
    correct(p.docX, p.docY)
  },

  onPointerMove(p: PointerInfo) {
    if (!active || !last) return
    const size = Math.max(8, Number(getOptions('red-eye').size) || 60)
    const spacing = Math.max(3, size * .3)
    for (const q of walkDabs(last.x, last.y, p.docX, p.docY, spacing)) correct(q.x, q.y)
    if (Math.hypot(p.docX - last.x, p.docY - last.y) >= spacing) last = { x: p.docX, y: p.docY }
  },

  onPointerUp() { finish() },
  onDeactivate() { finish() },

  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    drawBrushCursor(ctx, mouse, Number(getOptions('red-eye').size) || 60, view.zoom)
  },
}
