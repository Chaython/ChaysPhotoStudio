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
import { clamp, createCanvas, ctx2d } from '../utils/canvas'
import {
  getOptions, brushSettingsFrom, walkDabs, pencilDab,
  symmetricPoints, drawSymmetryOverlay, ema,
} from './shared'
import { getTip, drawTipCursor, tipExtentMul, ERASER_TIP_IDS } from './brush-tips'

/** EMA weight for the smoothed travel direction (vector EMA — wrap-safe) */
const DIR_EMA = 0.35
const RAD = Math.PI / 180

let historyEraserScratch: HTMLCanvasElement | null = null

function getHistoryEraserScratch(side: number): HTMLCanvasElement {
  const s = Math.max(4, Math.ceil(side))
  if (!historyEraserScratch || historyEraserScratch.width !== s || historyEraserScratch.height !== s) {
    historyEraserScratch = createCanvas(s, s)
  } else {
    ctx2d(historyEraserScratch).clearRect(0, 0, s, s)
  }
  return historyEraserScratch
}

function makeEraser(): Tool {
  let active = false
  let last: { x: number; y: number } | null = null
  let eraseToHistory = false
  let historySource: HTMLCanvasElement | null = null
  let connectFrom: { x: number; y: number } | null = null
  let connectDocId: string | null = null
  let connectLayerId: string | null = null
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

  function resolveHistorySource(layerId: string): HTMLCanvasElement | null {
    const doc = engine.activeDoc
    if (!doc?.history.states.length) return null
    const i = Math.max(0, Math.min(doc.history.states.length - 1, doc.historyBrushSourceIndex ?? 0))
    const state = doc.history.states[i]
    const layer = state?.layers.find(l => l.id === layerId)
    if (!layer?.canvas || layer.kind !== 'raster') return null
    const out = createCanvas(doc.width, doc.height)
    ctx2d(out).drawImage(layer.canvas, layer.offsetX ?? 0, layer.offsetY ?? 0)
    return out
  }

  /** allowed eraser tip id (falls back to round-soft) */
  function tipFor(opts: Record<string, any>): string {
    const id = typeof opts.tip === 'string' ? opts.tip : 'round-soft'
    return ERASER_TIP_IDS.includes(id) && getTip(id) ? id : 'round-soft'
  }

  /** effective per-dab angle: angleFollow → EMA travel direction + offset */
  function dabAngle(opts: Record<string, any>, p?: PointerInfo | null): number {
    const offset = clamp(opts.angle ?? 0, -360, 720)
    if (p?.pointerType === 'pen') {
      if (opts.twistAngle === true && Math.abs(p.twist) > .01) return p.twist + offset
      if (opts.tiltAngle === true && Math.hypot(p.tiltX, p.tiltY) > 1) {
        return Math.atan2(p.tiltY, p.tiltX) / RAD + offset
      }
    }
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
      eraseToHistory = opts.eraseToHistory === true
      historySource = eraseToHistory ? resolveHistorySource(layer.id) : null
      if (eraseToHistory && !historySource) {
        engine.ui?.toast('The marked History source has no compatible raster pixels for this layer', 'error')
        eraseToHistory = false
        return
      }
      engine.beginStroke(layer.id, { opacity: opts.opacity ?? 100, erase: !eraseToHistory })
      active = true
      last = { x: p.docX, y: p.docY }
      lastDab = null
      dirX = 1; dirY = 0
      hasDir = false
      const canConnect = p.shift && connectFrom && connectDocId === doc.id && connectLayerId === layer.id
      if (canConnect && connectFrom) {
        const settings = brushSettingsFrom(opts)
        const spacing = Math.max(1, settings.size * settings.spacing)
        const points = walkDabs(connectFrom.x, connectFrom.y, p.docX, p.docY, spacing)
        for (const q of points) dab(q.x, q.y, p)
        const tail = points[points.length - 1]
        if (!tail || Math.hypot(tail.x - p.docX, tail.y - p.docY) > .25) dab(p.docX, p.docY, p)
      } else {
        dab(p.docX, p.docY, p)
      }
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
      const docId = engine.activeDoc?.id ?? null
      const activeLayerId = engine.activeLayer?.id ?? null
      if (last && docId && activeLayerId) {
        connectFrom = { ...last }
        connectDocId = docId
        connectLayerId = activeLayerId
      }
      active = false
      last = null
      lastDab = null
      hasDir = false
      engine.endStroke(eraseToHistory ? 'Erase to History' : 'Erase')
      eraseToHistory = false
      historySource = null
    },

    onDeactivate() {
      // tool switched mid-erase: commit cleanly so the stroke isn't dropped
      connectFrom = null
      connectDocId = null
      connectLayerId = null
      if (active) {
        active = false
        last = null
        lastDab = null
        hasDir = false
        engine.endStroke(eraseToHistory ? 'Erase to History' : 'Erase')
        eraseToHistory = false
        historySource = null
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
      // Pencil/Block modes use hard geometric cursors; Brush mode uses the selected tip.
      const mode = opts.mode ?? 'brush'
      drawTipCursor(ctx, mouse, opts.size ?? 40, view.zoom, mode === 'brush' ? tipFor(opts) : 'round-hard', dabAngle(opts), mode === 'block' ? 100 : clamp(opts.roundness ?? 100, 10, 100))
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

    const pressure = p?.pointerType === 'pen' ? clamp(p.pressure, 0, 1) : 1
    let radius = settings.size / 2
    if (p?.pointerType === 'pen' && opts.pressureSize === true) {
      const minDiameter = clamp(Number(opts.minDiameter ?? 25), 1, 100) / 100
      radius *= minDiameter + (1 - minDiameter) * pressure
    }
    const sizeJitter = clamp(Number(opts.sizeJitter ?? 0), 0, 100) / 100
    if (sizeJitter > 0) {
      const minDiameter = clamp(Number(opts.minDiameter ?? 25), 1, 100) / 100
      radius *= Math.max(minDiameter, 1 - Math.random() * sizeJitter)
    }

    // ---- flow (pen pressure + transfer jitter) ----
    let flow = clamp(settings.flow / 100, 0, 1)
    if (p?.pointerType === 'pen' && opts.pressure !== false) flow *= 0.3 + 0.7 * pressure
    const flowJitter = clamp(Number(opts.flowJitter ?? 0), 0, 100) / 100
    if (flowJitter > 0) flow *= 1 - Math.random() * flowJitter
    if (flow <= 0) return

    // ---- tip: erase dabs draw in WHITE (destination-out on commit) ----
    const tip = getTip(tipFor(opts))!
    let tipAngle = tip.rotatable ? dabAngle(opts, p) : 0
    if (tip.rotatable) {
      const angleJitter = clamp(Number(opts.angleJitter ?? 0), 0, 100) / 100
      if (angleJitter > 0) tipAngle += (Math.random() * 2 - 1) * 180 * angleJitter
    }
    let roundness = clamp(opts.roundness ?? 100, 10, 100)
    if (p?.pointerType === 'pen' && opts.tiltRoundness === true) {
      const tilt = clamp(Math.hypot(p.tiltX, p.tiltY) / 90, 0, 1)
      roundness = clamp(roundness * (1 - tilt * .72), 10, 100)
    }
    const roundnessJitter = clamp(Number(opts.roundnessJitter ?? 0), 0, 100) / 100
    if (roundnessJitter > 0) {
      const minRoundness = clamp(Number(opts.minRoundness ?? 25), 1, 100)
      roundness = Math.max(minRoundness, roundness * (1 - Math.random() * roundnessJitter))
    }
    const extent = tipExtentMul(tip.id)

    const mode = opts.mode ?? 'brush'
    const drawFn = (ctx: CanvasRenderingContext2D, dx: number, dy: number) => {
      if (mode === 'pencil') {
        pencilDab(ctx, dx, dy, radius, '#ffffff')
        return
      }
      if (mode === 'block') {
        const side = Math.max(1, Math.round(radius * 2))
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(Math.round(dx - side / 2), Math.round(dy - side / 2), side, side)
        return
      }
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
    for (const pt of pts) {
      if (eraseToHistory && historySource) {
        const side = Math.max(4, Math.ceil(radius * 2 * extent) + 6)
        const half = side / 2
        const patch = getHistoryEraserScratch(side)
        const pc = ctx2d(patch)
        pc.drawImage(
          historySource,
          pt.x - half, pt.y - half, side, side,
          0, 0, side, side,
        )
        pc.globalCompositeOperation = 'destination-in'
        drawFn(pc, half, half)
        pc.globalCompositeOperation = 'source-over'
        engine.dab(
          pt.x, pt.y,
          (ctx, dx, dy) => ctx.drawImage(patch, dx - half, dy - half),
          flow,
          Math.max(4, radius * extent),
        )
      } else {
        engine.dab(pt.x, pt.y, drawFn, flow, Math.max(4, radius * extent))
      }
    }
  }

  return tool
}

export const eraserTool: Tool = makeEraser()
