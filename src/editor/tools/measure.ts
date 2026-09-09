// ============================================================
// Measure Tool (Task 5-b) — GIMP-style ruler with angle readout
//
//  · drag to measure: amber line + endpoint crosshairs + a small
//    angle arc at the start (from horizontal) + label chip
//        L: 123.4 px  ∠ 36.2°  ΔX 100  ΔY 73
//  · Shift constrains the angle to 45° increments (length kept)
//  · the finished measurement stays visible until the next
//    measurement, Escape, or a tool switch (onDeactivate)
//  · live values are published on window.__zphotoMeasure
//    ({ length, angleDeg, dx, dy }) for the status bar
//  · pure overlay tool — no history, no layer changes
// ============================================================
import type { Tool, PointerInfo, ToolId, Vec } from '../types'
import { engine } from '../engine/engine'
import { drawCross } from './shared'
import { clamp } from '../utils/canvas'

// 'measure' is added to the ToolId union by the Lead when wiring
// registry.ts / TOOL_DEFS; the double-cast keeps this module compiling
// both before and after that lands.
const TOOL_ID = 'measure' as unknown as ToolId

const AMBER = '#e8a33d'

// ---------- state ----------
let start: Vec | null = null
let end: Vec | null = null
let dragging = false

/** publish the current measurement (or null) for the status bar */
function publish(): void {
  const g = window as any
  if (start && end) {
    const dx = end.x - start.x, dy = end.y - start.y
    g.__zphotoMeasure = {
      length: Math.hypot(dx, dy),
      angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
      dx, dy,
    }
  } else {
    g.__zphotoMeasure = null
  }
}

function clearMeasurement(): void {
  if (!start && !end) return
  start = null
  end = null
  dragging = false
  publish()
  engine.pokeOverlay()
}

/** snap the drag angle to 45° increments, preserving length */
function constrain45(s: Vec, raw: Vec): Vec {
  const dx = raw.x - s.x, dy = raw.y - s.y
  const len = Math.hypot(dx, dy)
  if (len < 0.001) return raw
  const step = Math.PI / 4
  const snapped = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: s.x + Math.cos(snapped) * len, y: s.y + Math.sin(snapped) * len }
}

// ---------- drawing helpers (screen space) ----------

/** small amber crosshair with a dark halo */
function endpointCross(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y)
  ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5)
  ctx.stroke()
  ctx.strokeStyle = AMBER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y)
  ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5)
  ctx.stroke()
}

/** rounded-rect path (manual — no roundRect lib dependency) */
function chipPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

// ---------- tool ----------

export const measureTool: Tool = {
  id: TOOL_ID,
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    start = { x: p.docX, y: p.docY }
    end = null
    dragging = true
    engine.pokeOverlay()
  },

  onPointerMove(p: PointerInfo) {
    if (!dragging || !start) return
    const raw = { x: p.docX, y: p.docY }
    end = p.shift ? constrain45(start, raw) : raw
    engine.pokeOverlay()
  },

  onPointerUp() {
    if (!dragging) return
    dragging = false
    // a click without a meaningful drag clears the previous measurement
    const len = start && end ? Math.hypot(end.x - start.x, end.y - start.y) : 0
    if (len < 0.5) {
      start = null
      end = null
    }
    publish()
    engine.pokeOverlay()
  },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (start || end) { clearMeasurement(); return true }
    }
    return false
  },

  onDeactivate() { clearMeasurement() },

  renderOverlay(ctx, view, w, h, mouse) {
    if (start && end) {
      drawMeasurement(ctx, view, w, h)
      return
    }
    drawCross(ctx, mouse)
    if (!start && !end) {
      // idle hint (crop-tool style bottom strip)
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(w / 2 - 156, h - 34, 312, 22)
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.font = '11px ui-sans-serif, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Drag to measure · Shift locks 45° · Esc clears', w / 2, h - 19)
      ctx.restore()
    }
  },
}

function drawMeasurement(ctx: CanvasRenderingContext2D, view: { zoom: number; panX: number; panY: number }, w: number, h: number): void {
  const s = start!, e = end!
  const ax = s.x * view.zoom + view.panX, ay = s.y * view.zoom + view.panY
  const bx = e.x * view.zoom + view.panX, by = e.y * view.zoom + view.panY
  const lenScreen = Math.hypot(bx - ax, by - ay)
  if (lenScreen < 1) return

  ctx.save()
  ctx.lineCap = 'round'

  // measurement line — amber over a soft dark underlay
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(bx, by)
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'
  ctx.lineWidth = 3.5
  ctx.stroke()
  ctx.strokeStyle = AMBER
  ctx.lineWidth = 1.5
  ctx.stroke()

  // endpoint crosshairs
  endpointCross(ctx, ax, ay)
  endpointCross(ctx, bx, by)

  // angle arc at the start + dashed horizontal reference
  const ang = Math.atan2(by - ay, bx - ax)
  const arcR = 16
  if (lenScreen > arcR + 12) {
    ctx.strokeStyle = 'rgba(232,163,61,0.55)'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax + arcR, ay)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = AMBER
    ctx.beginPath()
    // canvas y grows downward: negative angles need the anticlockwise sweep
    if (ang >= 0) ctx.arc(ax, ay, arcR, 0, ang, false)
    else ctx.arc(ax, ay, arcR, 0, ang, true)
    ctx.stroke()
  }

  // label chip near the midpoint (only once the line is readable)
  if (lenScreen > 12) {
    const dx = e.x - s.x, dy = e.y - s.y
    const len = Math.hypot(dx, dy)
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
    const label = `L: ${len.toFixed(1)} px  ∠ ${angleDeg.toFixed(1)}°  ΔX ${Math.round(dx)}  ΔY ${Math.round(dy)}`
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    const tw = ctx.measureText(label).width
    const padX = 6, chipH = 16
    const chipW = tw + padX * 2
    // midpoint, nudged to the visually upper side of the line
    let mx = (ax + bx) / 2, my = (ay + by) / 2
    let px = -(by - ay) / lenScreen, py = (bx - ax) / lenScreen
    if (py > 0) { px = -px; py = -py }
    mx += px * 18
    my += py * 18
    const cx = clamp(mx - chipW / 2, 4, Math.max(4, w - chipW - 4))
    const cy = clamp(my - chipH / 2, 4, Math.max(4, h - chipH - 4))
    ctx.fillStyle = 'rgba(12,12,14,0.85)'
    chipPath(ctx, cx, cy, chipW, chipH, 4)
    ctx.fill()
    ctx.strokeStyle = 'rgba(232,163,61,0.35)'
    ctx.lineWidth = 1
    chipPath(ctx, cx + 0.5, cy + 0.5, chipW - 1, chipH - 1, 3.5)
    ctx.stroke()
    ctx.fillStyle = AMBER
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, cx + padX, cy + chipH / 2 + 0.5)
  }

  ctx.restore()
}
