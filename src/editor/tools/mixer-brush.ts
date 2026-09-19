// ============================================================
// Mixer Brush — wet paint / loaded reservoir painting.
//
// A persistent RGB reservoir is mixed with sampled canvas color per dab.
// Alt/Option-click loads the reservoir from the image without painting.
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, getFgColor, walkDabs, drawBrushCursor, softDab } from './shared'
import { clamp, hexToRgb, rgbToHex } from '../utils/canvas'

type RGB = [number, number, number]

let active = false
let last: { x: number; y: number } | null = null
let reservoir: RGB | null = null

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  const k = clamp(t, 0, 1)
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ]
}

function sampleAt(x: number, y: number, radius: number): RGB | null {
  const opts = getOptions('mixer-brush')
  const hex = engine.sampleColor(x, y, opts.sampleAllLayers !== false ? 'composite' : 'layer', radius)
  return hex ? hexToRgb(hex) : null
}

function resetReservoir() {
  reservoir = hexToRgb(getFgColor())
}

function mixerDab(x: number, y: number, p: PointerInfo) {
  if (!active) return
  const opts = getOptions('mixer-brush')
  const size = Math.max(2, Number(opts.size) || 55)
  const radius = size / 2
  const hardness = clamp(Number(opts.hardness) || 0, 0, 100)
  const wet = clamp((Number(opts.wet) || 0) / 100, 0, 1)
  const load = clamp((Number(opts.load) || 0) / 100, 0, 1)
  const mix = clamp((Number(opts.mix) || 0) / 100, 0, 1)
  let flow = clamp((Number(opts.flow) || 60) / 100, 0, 1)
  if (p.pointerType === 'pen' && opts.pressureFlow !== false) {
    flow *= .2 + .8 * clamp(p.pressure, 0, 1)
  }

  if (!reservoir) resetReservoir()
  const picked = sampleAt(x, y, Math.max(0, Math.round(size * .06)))
  if (picked) {
    // Wet controls how quickly the brush drinks the underlying image.
    reservoir = lerpRGB(reservoir!, picked, wet * (.35 + .65 * (1 - load)))
  }

  const sampled = picked ?? reservoir!
  // Mix controls the contribution of the underlying sampled color to the
  // deposited paint. Load makes the current reservoir persist longer.
  const paint = lerpRGB(reservoir!, sampled, mix)
  const keepLoaded = .25 + .75 * load
  reservoir = lerpRGB(sampled, reservoir!, keepLoaded)

  const color = rgbToHex(paint[0], paint[1], paint[2])
  engine.dab(
    x, y,
    (ctx, dx, dy) => softDab(ctx, dx, dy, radius, hardness, color),
    flow,
    Math.max(4, radius),
  )
}

function finish() {
  if (!active) return
  active = false
  last = null
  engine.endStroke('Mixer Brush Stroke')
  if (getOptions('mixer-brush').autoClean === true) resetReservoir()
}

export const mixerBrushTool: Tool = {
  id: 'mixer-brush',
  requiresLayer: true,
  cursor: 'none',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const layer = engine.activeLayer
    if (!layer || layer.locked || layer.kind === 'adjustment') return
    const opts = getOptions('mixer-brush')

    if (p.alt) {
      const sampled = sampleAt(p.docX, p.docY, Math.max(0, Math.round((Number(opts.size) || 55) * .06)))
      if (sampled) {
        reservoir = sampled
        engine.ui?.toast('Mixer Brush loaded from image', 'info')
        engine.requestRender()
      }
      return
    }

    if (!reservoir || opts.autoClean === true) resetReservoir()
    engine.beginStroke(layer.id, { opacity: 100 })
    active = true
    last = { x: p.docX, y: p.docY }
    mixerDab(p.docX, p.docY, p)
  },

  onPointerMove(p: PointerInfo) {
    if (!active || !last) return
    const opts = getOptions('mixer-brush')
    const size = Math.max(2, Number(opts.size) || 55)
    const spacing = Math.max(1, size * clamp((Number(opts.spacing) || 12) / 100, .01, 1))
    for (const q of walkDabs(last.x, last.y, p.docX, p.docY, spacing)) mixerDab(q.x, q.y, p)
    if (Math.hypot(p.docX - last.x, p.docY - last.y) >= spacing) last = { x: p.docX, y: p.docY }
  },

  onPointerUp() { finish() },
  onDeactivate() { finish() },

  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    drawBrushCursor(ctx, mouse, Number(getOptions('mixer-brush').size) || 55, view.zoom)
  },
}
