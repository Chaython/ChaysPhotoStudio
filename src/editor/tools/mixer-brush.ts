// ============================================================
// Mixer Brush — wet paint / loaded reservoir painting.
//
// A persistent RGB reservoir is mixed with sampled canvas color per dab.
// Alt/Option-click loads the reservoir from the image without painting.
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, getFgColor, walkDabs } from './shared'
import { clamp, hexToRgb, rgbToHex } from '../utils/canvas'
import { getTip, drawTipCursor, tipExtentMul } from './brush-tips'

type RGB = [number, number, number]

let active = false
let last: { x: number; y: number } | null = null
let reservoir: RGB | null = null
let bristlePrev: { x: number; y: number } | null = null

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

function loadForegroundReservoir() {
  reservoir = hexToRgb(getFgColor())
}

export function loadMixerBrushFromForeground(showToast = true) {
  loadForegroundReservoir()
  if (showToast) engine.ui?.toast('Mixer Brush loaded with foreground color', 'info')
  engine.requestRender()
}

export function cleanMixerBrush(showToast = true) {
  reservoir = null
  bristlePrev = null
  if (showToast) engine.ui?.toast('Mixer Brush cleaned', 'info')
  engine.requestRender()
}

function mixerDab(x: number, y: number, p: PointerInfo) {
  if (!active) return
  const opts = getOptions('mixer-brush')
  let size = Math.max(2, Number(opts.size) || 55)
  const pressure = p.pointerType === 'pen' ? clamp(p.pressure, 0, 1) : 1
  if (p.pointerType === 'pen' && opts.pressureSize === true) size *= .25 + .75 * pressure
  const radius = size / 2
  const hardness = clamp(Number(opts.hardness) || 0, 0, 100)
  const wet = clamp((Number(opts.wet) || 0) / 100, 0, 1)
  const load = clamp((Number(opts.load) || 0) / 100, 0, 1)
  const mix = clamp((Number(opts.mix) || 0) / 100, 0, 1)
  let flow = clamp((Number(opts.flow) || 60) / 100, 0, 1)
  if (p.pointerType === 'pen' && opts.pressureFlow !== false) {
    flow *= .2 + .8 * pressure
  }

  const picked = sampleAt(x, y, Math.max(0, Math.round(size * .06)))
  // A cleaned brush starts by picking up the image instead of silently
  // reloading foreground paint. Explicit Load Brush fills it with FG.
  if (!reservoir) reservoir = picked ? [...picked] as RGB : hexToRgb(getFgColor())
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
  if (opts.bristle === true) {
    const count = clamp(Math.round(Number(opts.bristleCount) || 18), 3, 64)
    const length = size * clamp((Number(opts.bristleLength) || 70) / 100, .1, 1.8)
    const stiffness = clamp((Number(opts.bristleStiffness) || 65) / 100, 0, 1)

    let angle = 0
    if (p.pointerType === 'pen' && opts.twistBristles === true && Math.abs(p.twist) > .01) {
      angle = p.twist * Math.PI / 180
    } else if (p.pointerType === 'pen' && opts.tiltBristles !== false && Math.hypot(p.tiltX, p.tiltY) > 1) {
      angle = Math.atan2(p.tiltY, p.tiltX)
    } else if (bristlePrev) {
      const dx = x - bristlePrev.x, dy = y - bristlePrev.y
      if (Math.hypot(dx, dy) > .1) angle = Math.atan2(dy, dx)
    }
    bristlePrev = { x, y }

    engine.dab(
      x, y,
      (ctx, dx, dy) => {
        ctx.save()
        ctx.strokeStyle = color
        ctx.lineCap = 'round'
        const nx = -Math.sin(angle), ny = Math.cos(angle)
        const dirX = Math.cos(angle), dirY = Math.sin(angle)
        for (let i = 0; i < count; i++) {
          const u = count <= 1 ? 0 : i / (count - 1) - .5
          const across = u * size * .82 + (Math.random() - .5) * size * .04
          const flex = (1 - stiffness) * (Math.random() - .5) * .9
          const a = angle + flex
          const bx = dx + nx * across
          const by = dy + ny * across
          const bristleLen = length * (.65 + Math.random() * .7)
          const ex = bx + Math.cos(a) * bristleLen
          const ey = by + Math.sin(a) * bristleLen
          ctx.globalAlpha = .45 + .55 * (1 - Math.abs(u))
          ctx.lineWidth = Math.max(.5, size / Math.max(8, count) * (.45 + Math.random() * .6))
          ctx.beginPath()
          ctx.moveTo(bx - dirX * bristleLen * .2, by - dirY * bristleLen * .2)
          ctx.quadraticCurveTo(
            bx + Math.cos(a) * bristleLen * .35,
            by + Math.sin(a) * bristleLen * .35,
            ex, ey,
          )
          ctx.stroke()
        }
        ctx.restore()
      },
      flow,
      Math.max(4, radius + length),
    )
  } else {
    const tipId = typeof opts.tip === 'string' && getTip(opts.tip) ? opts.tip : 'round-soft'
    const tip = getTip(tipId) ?? getTip('round-soft')!
    let angleDeg = Number(opts.angle) || 0
    if (p.pointerType === 'pen' && opts.twistAngle === true && Math.abs(p.twist) > .01) {
      angleDeg += p.twist
    } else if (p.pointerType === 'pen' && opts.tiltAngle === true && Math.hypot(p.tiltX, p.tiltY) > 1) {
      angleDeg += Math.atan2(p.tiltY, p.tiltX) * 180 / Math.PI
    } else if (opts.angleFollow === true && bristlePrev) {
      const dx = x - bristlePrev.x, dy = y - bristlePrev.y
      if (Math.hypot(dx, dy) > .1) angleDeg += Math.atan2(dy, dx) * 180 / Math.PI
    }

    let roundness = clamp(Number(opts.roundness ?? 100), 10, 100)
    if (p.pointerType === 'pen' && opts.tiltRoundness === true) {
      const tilt = clamp(Math.hypot(p.tiltX, p.tiltY) / 90, 0, 1)
      roundness = clamp(roundness * (1 - tilt * .72), 10, 100)
    }
    bristlePrev = { x, y }
    const extent = tipExtentMul(tipId)
    engine.dab(
      x, y,
      (ctx, dx, dy) => tip.drawDab(ctx, dx, dy, {
        size,
        hardness,
        angle: angleDeg,
        roundness,
        color,
        rand: Math.random,
      }),
      flow,
      Math.max(4, radius * extent),
    )
  }
}

function finish() {
  if (!active) return
  active = false
  last = null
  bristlePrev = null
  engine.endStroke('Mixer Brush Stroke')
  if (getOptions('mixer-brush').autoClean === true) cleanMixerBrush(false)
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

    engine.beginStroke(layer.id, { opacity: 100 })
    active = true
    last = { x: p.docX, y: p.docY }
    bristlePrev = null
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
    const opts = getOptions('mixer-brush')
    if (opts.bristle === true) {
      drawTipCursor(ctx, mouse, Number(opts.size) || 55, view.zoom, 'flat', 0, 65)
      return
    }
    const tipId = typeof opts.tip === 'string' && getTip(opts.tip) ? opts.tip : 'round-soft'
    drawTipCursor(
      ctx,
      mouse,
      Number(opts.size) || 55,
      view.zoom,
      tipId,
      Number(opts.angle) || 0,
      clamp(Number(opts.roundness ?? 100), 10, 100),
    )
  },
}
