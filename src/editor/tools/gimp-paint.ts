// ============================================================
// GIMP-style paint tools
//
//  · Airbrush  — holds down and keeps spraying: movement lays dabs along the
//    path while a timer keeps adding paint at the current position. Rate,
//    flow, pressure and spacing all feed the build-up.
//
//  · Ink       — calligraphic nib. The ellipse is squashed (tilt), rotated
//    with pressure when enabled, and thinned by fast travel / low pressure.
//
//  · MyPaint   — soft procedural brush with hardness, opacity, speed and a
//    random jitter control. Dabs are interpolated tightly enough to read as
//    one continuous stroke.
//
// Every tool uses the shared engine stroke buffer (beginStroke / dab /
// endStroke), so selections, layer masks, blending and history behave the
// same as the Brush tool.
// ============================================================
import type { PointerInfo, Tool, Vec } from '../types'
import { engine } from '../engine/engine'
import { clamp, hexToRgb } from '../utils/canvas'
import {
  drawBrushCursor, getFgColor, getOptions, softDab, walkDabsEach,
} from './shared'
import { drawTipCursor, getTip, tipExtentMul } from './brush-tips'
import { useEditorStore } from '../store'

const RAD = Math.PI / 180
const AIRBRUSH_INTERVAL_MS = 32
const SPEED_EMA = 0.3

function pressureOf(p: PointerInfo | null): number {
  return p?.pointerType === 'pen' ? clamp(p.pressure, 0, 1) : 1
}

function tipIdFor(opts: Record<string, any>): string {
  const id = typeof opts.tip === 'string' ? opts.tip : 'round-soft'
  return getTip(id) ? id : 'round-soft'
}

function drawProceduralDab(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tipId: string,
  size: number,
  hardness: number,
  angle: number,
  roundness: number,
  color: string,
) {
  const tip = getTip(tipId)
  if (tip) {
    tip.drawDab(ctx, x, y, {
      size,
      hardness,
      angle,
      roundness,
      color,
      rand: Math.random,
    })
  } else {
    softDab(ctx, x, y, Math.max(0.5, size / 2), hardness, color)
  }
}

function rgba(color: string, alpha: number): string {
  const [r, g, b] = hexToRgb(color)
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`
}

// ============================================================
// Airbrush
// ============================================================

interface AirState {
  active: boolean
  docId: string | null
  layerId: string | null
  pos: Vec | null
  last: Vec | null
  pointer: PointerInfo | null
  timer: ReturnType<typeof setInterval> | null
  color: string
}

const air: AirState = {
  active: false,
  docId: null,
  layerId: null,
  pos: null,
  last: null,
  pointer: null,
  timer: null,
  color: '#000000',
}

function stopAirTimer() {
  if (air.timer !== null) {
    clearInterval(air.timer)
    air.timer = null
  }
}

function stampAir(x: number, y: number, p: PointerInfo | null, flowScale: number) {
  const doc = engine.activeDoc
  if (!doc || !air.active || !doc._stroke) return
  const opts = getOptions('airbrush')
  const pressure = pressureOf(p)
  const pressureOn = p?.pointerType === 'pen' && opts.pressure !== false
  const size = clamp(Number(opts.size ?? 40), 1, 500) * (pressureOn ? 0.45 + 0.55 * pressure : 1)
  const hardness = clamp(Number(opts.hardness ?? 70), 0, 100)
  const flow = clamp(Number(opts.flow ?? 50), 1, 100) / 100
  const pressureFlow = pressureOn ? 0.25 + 0.75 * pressure : 1
  const effective = clamp(flow * flowScale * pressureFlow, 0, 1)
  if (effective <= 0) return
  const tipId = tipIdFor(opts)
  const angle = Number(opts.angle ?? 0)
  const roundness = clamp(Number(opts.roundness ?? 100), 10, 100)
  engine.dab(
    x,
    y,
    (ctx, dx, dy) => drawProceduralDab(
      ctx, dx, dy, tipId, size, hardness, angle, roundness, air.color,
    ),
    effective,
    Math.max(4, (size / 2) * tipExtentMul(tipId)),
    true,
  )
}

function startAirTimer() {
  stopAirTimer()
  air.timer = setInterval(() => {
    const doc = engine.activeDoc
    if (!air.active || !air.pos || !doc || doc.id !== air.docId) {
      stopAirTimer()
      return
    }
    const opts = getOptions('airbrush')
    const rate = clamp(Number(opts.rate ?? 50), 1, 100) / 100
    stampAir(air.pos.x, air.pos.y, air.pointer, 0.14 * rate)
    engine.requestRender()
  }, AIRBRUSH_INTERVAL_MS)
}

function endAirbrush() {
  stopAirTimer()
  if (!air.active) return
  air.active = false
  air.pos = null
  air.last = null
  air.pointer = null
  air.docId = null
  air.layerId = null
  engine.endStroke('Airbrush Stroke')
}

export const airbrushTool: Tool = {
  id: 'airbrush',
  cursor: 'none',
  requiresLayer: true,

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    const layer = engine.activeLayer
    if (!doc || !layer) return

    if (p.alt) {
      const hex = engine.sampleColor(p.docX, p.docY, 'composite', 0)
      if (hex) useEditorStore.getState().setFgColor(hex)
      engine.pokeOverlay()
      return
    }

    const opts = getOptions('airbrush')
    engine.beginStroke(layer.id, {
      opacity: clamp(Number(opts.opacity ?? 100), 1, 100),
      blendMode: 'normal',
    })
    if (!doc._stroke) return

    air.active = true
    air.docId = doc.id
    air.layerId = layer.id
    air.pos = { x: p.docX, y: p.docY }
    air.last = { x: p.docX, y: p.docY }
    air.pointer = p
    air.color = getFgColor()
    stampAir(p.docX, p.docY, p, 0.55)
    engine.requestRender()
    startAirTimer()
  },

  onPointerMove(p: PointerInfo) {
    if (!air.active || !air.last) return
    const opts = getOptions('airbrush')
    const size = clamp(Number(opts.size ?? 40), 1, 500)
    const spacing = Math.max(0.75, (size * clamp(Number(opts.spacing ?? 15), 1, 200)) / 100)
    const dist = Math.hypot(p.docX - air.last.x, p.docY - air.last.y)
    if (dist > 0.01) {
      const walked = walkDabsEach(air.last.x, air.last.y, p.docX, p.docY, spacing, (x, y) => {
        stampAir(x, y, p, 0.32)
      })
      // Keep the anchor until a full spacing step has accumulated, otherwise
      // slow pointer streams would advance past unpainted gaps. When dabs do
      // fire, resume from the last one so leftover travel is not discarded.
      if (walked.count) {
        air.last = { x: walked.lastX, y: walked.lastY }
        engine.requestRender()
      }
    }
    air.pos = { x: p.docX, y: p.docY }
    air.pointer = p
    engine.requestRender()
  },

  onPointerUp() {
    endAirbrush()
  },

  onDeactivate() {
    endAirbrush()
  },

  renderCursor(ctx, view, w, h, mouse) {
    void w
    void h
    const opts = getOptions('airbrush')
    const tipId = tipIdFor(opts)
    drawTipCursor(
      ctx,
      mouse,
      clamp(Number(opts.size ?? 40), 1, 500),
      view.zoom,
      tipId,
      Number(opts.angle ?? 0),
      clamp(Number(opts.roundness ?? 100), 10, 100),
    )
  },
}

// ============================================================
// Ink
// ============================================================

interface InkState {
  active: boolean
  last: Vec | null
  prevRaw: Vec | null
  lastT: number
  speed: number
  color: string
}

const ink: InkState = {
  active: false,
  last: null,
  prevRaw: null,
  lastT: 0,
  speed: 0,
  color: '#000000',
}

function drawInkDab(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  ratio: number,
  angle: number,
  color: string,
) {
  const rx = Math.max(0.35, width / 2)
  const ry = Math.max(0.25, rx * ratio)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2)
  ctx.fill()
}

function stampInk(x: number, y: number, p: PointerInfo) {
  const doc = engine.activeDoc
  if (!doc || !ink.active || !doc._stroke) return
  const opts = getOptions('ink')
  const baseSize = clamp(Number(opts.size ?? 20), 1, 200)
  const sensitivity = clamp(Number(opts.sensitivity ?? 0.5), 0, 2)
  const pressure = pressureOf(p)
  const pen = p.pointerType === 'pen'

  let width = baseSize
  if (pen && opts.pressureSize !== false) {
    width *= 1 - sensitivity * 0.65 * (1 - pressure)
  }
  // Velocity taper: fast travel produces a thinner stroke.
  const speedK = clamp(1 - (ink.speed / Math.max(4, baseSize * 0.9)) * 0.7, 0.35, 1)
  width *= speedK
  width = Math.max(0.7, width)

  let angle = Number(opts.angle ?? 0) * RAD
  if (pen && opts.pressureAngle === true) {
    angle += (pressure - 0.5) * 90 * RAD * Math.max(0.2, sensitivity)
  }
  if (pen && (Math.abs(p.tiltX) > 1 || Math.abs(p.tiltY) > 1)) {
    angle += Math.atan2(p.tiltY, p.tiltX)
  }
  const tilt = clamp(Number(opts.tilt ?? 0), 0, 90)
  const ratio = 0.12 + 0.38 * (1 - tilt / 90)
  engine.dab(
    x,
    y,
    (ctx, dx, dy) => drawInkDab(ctx, dx, dy, width, ratio, angle, ink.color),
    1,
    Math.max(4, width / 2 + 2),
    true,
  )
}

function endInk() {
  if (!ink.active) return
  ink.active = false
  ink.last = null
  ink.prevRaw = null
  engine.endStroke('Ink Stroke')
}

export const inkTool: Tool = {
  id: 'ink',
  cursor: 'none',
  requiresLayer: true,

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    const layer = engine.activeLayer
    if (!doc || !layer) return

    if (p.alt) {
      const hex = engine.sampleColor(p.docX, p.docY, 'composite', 0)
      if (hex) useEditorStore.getState().setFgColor(hex)
      engine.pokeOverlay()
      return
    }

    engine.beginStroke(layer.id, { opacity: 100, blendMode: 'normal' })
    if (!doc._stroke) return
    ink.active = true
    ink.last = { x: p.docX, y: p.docY }
    ink.prevRaw = { x: p.docX, y: p.docY }
    ink.lastT = performance.now()
    ink.speed = 0
    ink.color = getFgColor()
    stampInk(p.docX, p.docY, p)
    engine.requestRender()
  },

  onPointerMove(p: PointerInfo) {
    if (!ink.active || !ink.last) return
    const now = performance.now()
    if (ink.prevRaw && now - ink.lastT > 0.5) {
      const inst = Math.hypot(p.docX - ink.prevRaw.x, p.docY - ink.prevRaw.y)
        / Math.max(1, now - ink.lastT)
      ink.speed += (inst - ink.speed) * SPEED_EMA
      ink.lastT = now
    }
    if (ink.prevRaw) {
      ink.prevRaw.x = p.docX
      ink.prevRaw.y = p.docY
    } else {
      ink.prevRaw = { x: p.docX, y: p.docY }
    }

    const opts = getOptions('ink')
    const size = clamp(Number(opts.size ?? 20), 1, 200)
    const spacing = Math.max(0.6, size * 0.11)
    const dist = Math.hypot(p.docX - ink.last.x, p.docY - ink.last.y)
    if (dist > 0.01) {
      const walked = walkDabsEach(ink.last.x, ink.last.y, p.docX, p.docY, spacing, (x, y) => {
        stampInk(x, y, p)
      })
      if (walked.count) {
        ink.last = { x: walked.lastX, y: walked.lastY }
        engine.requestRender()
      }
    }
  },

  onPointerUp() {
    endInk()
  },

  onDeactivate() {
    endInk()
  },

  renderCursor(ctx, view, w, h, mouse) {
    void w
    void h
    if (!mouse) return
    const opts = getOptions('ink')
    const size = clamp(Number(opts.size ?? 20), 1, 200)
    const angle = Number(opts.angle ?? 0) * RAD
    const tilt = clamp(Number(opts.tilt ?? 0), 0, 90)
    const ratio = 0.12 + 0.38 * (1 - tilt / 90)
    const rx = Math.max(2, (size / 2) * view.zoom)
    const ry = Math.max(1.5, rx * ratio)
    ctx.save()
    ctx.translate(mouse.x, mouse.y)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(mouse.x - 4, mouse.y)
    ctx.lineTo(mouse.x + 4, mouse.y)
    ctx.moveTo(mouse.x, mouse.y - 4)
    ctx.lineTo(mouse.x, mouse.y + 4)
    ctx.stroke()
    ctx.restore()
  },
}

// ============================================================
// MyPaint Brush
// ============================================================

interface MpState {
  active: boolean
  last: Vec | null
  prevRaw: Vec | null
  lastT: number
  speed: number
  color: string
}

const mp: MpState = {
  active: false,
  last: null,
  prevRaw: null,
  lastT: 0,
  speed: 0,
  color: '#000000',
}

function stampMyPaint(x: number, y: number, p: PointerInfo) {
  const doc = engine.activeDoc
  if (!doc || !mp.active || !doc._stroke) return
  const opts = getOptions('mypaint-brush')
  const pressure = pressureOf(p)
  const pen = p.pointerType === 'pen'
  const radius = clamp(Number(opts.radius ?? 20), 1, 500)
  const hardness = clamp(Number(opts.hardness ?? 0.5), 0, 1)
  const random = clamp(Number(opts.random ?? 0), 0, 1)
  const exponent = clamp(Number(opts.e ?? 1), 0.1, 5)

  let size = radius
  if (pen) size *= 0.35 + 0.65 * pressure
  // Final stroke opacity is applied by beginStroke(); per-dab flow only
  // carries pressure so the build-up stays predictable.
  let flow = pen ? 0.4 + 0.6 * pressure : 1
  let cx = x
  let cy = y
  if (random > 0) {
    const angle = Math.random() * Math.PI * 2
    const jitter = radius * random * 0.35 * Math.sqrt(Math.random())
    cx += Math.cos(angle) * jitter
    cy += Math.sin(angle) * jitter
    size *= 1 - random * 0.4 * Math.random()
    flow *= 1 - random * 0.35 * Math.random()
  }
  flow = clamp(flow, 0, 1)
  size = Math.max(0.6, size)
  // `e` shapes the falloff: larger values keep a smaller solid core, so the
  // edge reads softer.
  const inner = clamp(Math.pow(hardness, exponent), 0, 0.96)
  engine.dab(
    cx,
    cy,
    (ctx, dx, dy) => {
      const grad = ctx.createRadialGradient(dx, dy, size * inner, dx, dy, size)
      grad.addColorStop(0, rgba(mp.color, 1))
      grad.addColorStop(0.55, rgba(mp.color, 0.72))
      grad.addColorStop(1, rgba(mp.color, 0))
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(dx, dy, size, 0, Math.PI * 2)
      ctx.fill()
    },
    flow,
    Math.max(4, size + 2),
    true,
  )
}

function endMyPaint() {
  if (!mp.active) return
  mp.active = false
  mp.last = null
  mp.prevRaw = null
  engine.endStroke('MyPaint Stroke')
}

export const mypaintBrushTool: Tool = {
  id: 'mypaint-brush',
  cursor: 'none',
  requiresLayer: true,

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    const layer = engine.activeLayer
    if (!doc || !layer) return

    if (p.alt) {
      const hex = engine.sampleColor(p.docX, p.docY, 'composite', 0)
      if (hex) useEditorStore.getState().setFgColor(hex)
      engine.pokeOverlay()
      return
    }

    const opts = getOptions('mypaint-brush')
    engine.beginStroke(layer.id, {
      opacity: clamp(Math.round(Number(opts.opacity ?? 1) * 100), 1, 100),
      blendMode: 'normal',
    })
    if (!doc._stroke) return
    mp.active = true
    mp.last = { x: p.docX, y: p.docY }
    mp.prevRaw = { x: p.docX, y: p.docY }
    mp.lastT = performance.now()
    mp.speed = 0
    mp.color = getFgColor()
    stampMyPaint(p.docX, p.docY, p)
    engine.requestRender()
  },

  onPointerMove(p: PointerInfo) {
    if (!mp.active || !mp.last) return
    const now = performance.now()
    if (mp.prevRaw && now - mp.lastT > 0.5) {
      const inst = Math.hypot(p.docX - mp.prevRaw.x, p.docY - mp.prevRaw.y)
        / Math.max(1, now - mp.lastT)
      mp.speed += (inst - mp.speed) * SPEED_EMA
      mp.lastT = now
    }
    if (mp.prevRaw) {
      mp.prevRaw.x = p.docX
      mp.prevRaw.y = p.docY
    } else {
      mp.prevRaw = { x: p.docX, y: p.docY }
    }

    const opts = getOptions('mypaint-brush')
    const radius = clamp(Number(opts.radius ?? 20), 1, 500)
    const speed = clamp(Number(opts.speed ?? 1), 0.1, 5)
    // Faster brush settings → wider dab spacing (lighter, streakier).
    const spacing = Math.max(0.5, (radius * 0.16) / speed)
    const dist = Math.hypot(p.docX - mp.last.x, p.docY - mp.last.y)
    if (dist > 0.01) {
      const walked = walkDabsEach(mp.last.x, mp.last.y, p.docX, p.docY, spacing, (x, y) => {
        stampMyPaint(x, y, p)
      })
      if (walked.count) {
        mp.last = { x: walked.lastX, y: walked.lastY }
        engine.requestRender()
      }
    }
  },

  onPointerUp() {
    endMyPaint()
  },

  onDeactivate() {
    endMyPaint()
  },

  renderCursor(ctx, view, w, h, mouse) {
    void w
    void h
    const opts = getOptions('mypaint-brush')
    drawBrushCursor(ctx, mouse, clamp(Number(opts.radius ?? 20), 1, 500) * 2, view.zoom)
  },
}
