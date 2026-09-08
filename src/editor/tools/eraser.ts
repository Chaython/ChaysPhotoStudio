// ============================================================
// Eraser — Symmetry Painting + procedural tip library (Task 1-A)
//  · symmetry: mirror-x / mirror-y / point / mandala (2N dabs)
//    — every dab position is expanded via symmetricPoints about the
//    document center; each symmetric position draws its own erase dab.
//  · TIP SUPPORT (Task 1-A): the erase dab shape comes from
//    tools/brush-tips.ts — allowed subset: round-soft, round-hard,
//    flat, angled, spray (splatter erase) and noise (grunge erase).
//    Erasing draws the tip in WHITE: the stroke pipeline commits with
//    destination-out, so any opaque color erases — white keeps the
//    stroke buffer legible.
//  · angle / roundness / angleFollow options for the rotatable tips
//    (angleFollow rotates the nib along the EMA-smoothed travel
//    direction — vector EMA, wrap-safe).
//  · pen pressure → opacity: flow *= 0.3+0.7·pressure (mouse/touch
//    gets full flow).
//  · scatter/fade intentionally NOT applied (paint-tool-only dynamics);
//    the eraser keeps its classic size/hardness/opacity/flow/spacing.
//  · shape-aware cursor via drawTipCursor (shared with the brush).
//  · state lives inside the factory closure (no module-level mutable
//    state); single beginStroke/endStroke with history label 'Erase'.
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { clamp } from '../utils/canvas'
import {
  getOptions, brushSettingsFrom, walkDabs,
  symmetricPoints, drawSymmetryOverlay, ema,
} from './shared'
import { getTip, drawTipCursor, tipExtentMul, ERASER_TIP_IDS } from './brush-tips'

/** EMA weight for the smoothed travel direction (vector EMA — wrap-safe) */
const DIR_EMA = 0.35
const RAD = Math.PI / 180

function makeEraser(): Tool {
  let active = false
  let last: { x: number; y: number } | null = null
  /** last dab position (doc space) — travel-direction measurement */
  let lastDab: { x: number; y: number } | null = null
  /** EMA-smoothed travel direction unit vector */
  let dirX = 1, dirY = 0
  let hasDir = false

  function symmetryConfig(opts: Record<string, any>, w: number, h: number) {
    return {
      mode: typeof opts.symmetry === 'string' ? opts.symmetry : 'off',
      count: clamp(Math.round(opts.mandalaCount ?? 6), 3, 16),
      w, h,
    }
  }

  /** allowed eraser tip id (falls back to round-soft) */
  function tipFor(opts: Record<string, any>): string {
    const id = typeof opts.tip === 'string' ? opts.tip : 'round-soft'
    return ERASER_TIP_IDS.includes(id) && getTip(id) ? id : 'round-soft'
  }

  /** effective per-dab angle: angleFollow → EMA travel direction + offset */
  function dabAngle(opts: Record<string, any>): number {
    const offset = clamp(opts.angle ?? 0, -360, 720)
    if (opts.angleFollow === true && hasDir) {
      return Math.atan2(dirY, dirX) / RAD + offset
    }
    return offset
  }

  const tool: Tool = {
    id: 'eraser',
    requiresLayer: true,

    onPointerDown(p: PointerInfo) {
      if (p.button !== 0) return
      const doc = engine.activeDoc
      const layer = engine.activeLayer
      if (!doc || !layer) return
      const opts = getOptions('eraser')
      engine.beginStroke(layer.id, { opacity: opts.opacity ?? 100, erase: true })
      active = true
      last = { x: p.docX, y: p.docY }
      lastDab = null
      dirX = 1; dirY = 0
      hasDir = false
      dab(p.docX, p.docY, p)
    },

    onPointerMove(p: PointerInfo) {
      if (!active || !last) return
      const opts = getOptions('eraser')
      const settings = brushSettingsFrom(opts)
      const spacing = Math.max(1, settings.size * settings.spacing)
      for (const d of walkDabs(last.x, last.y, p.docX, p.docY, spacing)) dab(d.x, d.y, p)
      if (Math.hypot(p.docX - last.x, p.docY - last.y) >= spacing) last = { x: p.docX, y: p.docY }
    },

    onPointerUp() {
      if (!active) return
      active = false
      last = null
      lastDab = null
      hasDir = false
      engine.endStroke('Erase')
    },

    onDeactivate() {
      // tool switched mid-erase: commit cleanly so the stroke isn't dropped
      if (active) {
        active = false
        last = null
        lastDab = null
        hasDir = false
        engine.endStroke('Erase')
      }
    },

    renderOverlay(ctx, view, w, h) {
      void w; void h
      const doc = engine.activeDoc
      if (!doc) return
      const opts = getOptions('eraser')
      if (!opts.symmetry || opts.symmetry === 'off') return
      drawSymmetryOverlay(ctx, view, symmetryConfig(opts, doc.width, doc.height))
    },

    renderCursor(ctx, view, w, h, mouse) {
      void w; void h
      const doc = engine.activeDoc
      const opts = getOptions('eraser')
      if (!mouse) return
      // shape-aware cursor for the current erase tip
      drawTipCursor(ctx, mouse, opts.size ?? 40, view.zoom, tipFor(opts), dabAngle(opts), clamp(opts.roundness ?? 100, 10, 100))
      // tiny amber dot at each symmetric cursor position
      if (!doc || !opts.symmetry || opts.symmetry === 'off') return
      const docX = (mouse.x - view.panX) / view.zoom
      const docY = (mouse.y - view.panY) / view.zoom
      const pts = symmetricPoints(docX, docY, symmetryConfig(opts, doc.width, doc.height))
      ctx.save()
      for (const pt of pts) {
        const sx = pt.x * view.zoom + view.panX
        const sy = pt.y * view.zoom + view.panY
        ctx.beginPath()
        ctx.arc(sx, sy, 3, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(232,163,61,0.95)'
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'
        ctx.lineWidth = 1
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    },
  }

  function dab(x: number, y: number, p: PointerInfo | null) {
    const doc = engine.activeDoc
    if (!doc || !active) return
    const opts = getOptions('eraser')
    const settings = brushSettingsFrom(opts)

    // ---- travel-direction EMA (wrap-safe vector average, per dab) ----
    if (lastDab) {
      const ddx = x - lastDab.x, ddy = y - lastDab.y
      const dd = Math.hypot(ddx, ddy)
      if (dd > 0.5) {
        dirX = ema(dirX, ddx / dd, DIR_EMA)
        dirY = ema(dirY, ddy / dd, DIR_EMA)
        hasDir = true
      }
    }
    lastDab = { x, y }

    const radius = settings.size / 2

    // ---- flow (pen pressure → opacity; mouse/touch full flow) ----
    let flow = clamp(settings.flow / 100, 0, 1)
    if (p && p.pointerType === 'pen') flow *= 0.3 + 0.7 * clamp(p.pressure, 0, 1)
    if (flow <= 0) return

    // ---- tip: erase dabs draw in WHITE (destination-out on commit) ----
    const tip = getTip(tipFor(opts))!
    const tipAngle = tip.rotatable ? dabAngle(opts) : 0
    const roundness = clamp(opts.roundness ?? 100, 10, 100)
    const extent = tipExtentMul(tip.id)

    const drawFn = (ctx: CanvasRenderingContext2D, dx: number, dy: number) => {
      tip.drawDab(ctx, dx, dy, {
        size: radius * 2,
        hardness: settings.hardness,
        angle: tipAngle,
        roundness,
        color: '#ffffff',
        rand: Math.random,
      })
    }

    const pts = symmetricPoints(x, y, symmetryConfig(opts, doc.width, doc.height))
    for (const pt of pts) engine.dab(pt.x, pt.y, drawFn, flow, Math.max(4, radius * extent))
  }

  return tool
}

export const eraserTool: Tool = makeEraser()
