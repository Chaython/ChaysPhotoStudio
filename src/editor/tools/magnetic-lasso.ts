// ============================================================
// Magnetic Lasso (Task 5-b) — edge-snapping selection
// Photoshop "Magnetic Lasso" / GIMP "Intelligent Scissors"
//
//  · stroke start snapshots the flat composite and builds a Sobel
//    gradient-magnitude map (Float32, cached in the closure; docs
//    > 12MP are downsampled to a ≤ 4MP work map — path points stay
//    in full doc space)
//  · the path follows the cursor: every `frequency` px of travel a
//    new anchor is chosen by searching a width/2 disk around the
//    straight-line projection for the best score
//        gradMag · contrastBoost · dirAlignment · (1 − 0.45·d/r)
//    (direction alignment keeps the path moving forward instead of
//    jumping to parallel edges). Intermediate vertices are
//    interpolated at ~1.5px so the committed polygon is smooth.
//    No candidate above the edge floor → projected point (freehand).
//  · Alt held = freehand straight segments (snapping disabled)
//  · close: click within 10 screen px of the start point (amber ring),
//    double-click, or Enter → engine.selectPolygon; Escape cancels
//  · options: mode, width (1–40), contrast (1–100%), frequency
//    (1–100), feather, antiAlias (engine polygon is already smooth)
// ============================================================
import type { Tool, PointerInfo, ToolId, SelectionCombine, Vec } from '../types'
import { engine } from '../engine/engine'
import { getFlatComposite } from '../engine/document'
import { getOptions, combineMode, drawBrushCursor } from './shared'
import { getImageData, clamp, resampleCanvas } from '../utils/canvas'

// 'magnetic-lasso' is added to the ToolId union by the Lead when wiring
// registry.ts / TOOL_DEFS; the double-cast keeps this module compiling
// both before and after that lands.
const TOOL_ID = 'magnetic-lasso' as unknown as ToolId

// ---------- option readers (defaults mirror the Lead's TOOL_DEFS) ----------
function optWidth(): number { return clamp(Number(getOptions(TOOL_ID).width) || 16, 1, 40) }
function optContrast(): number { return clamp(Number(getOptions(TOOL_ID).contrast) || 16, 1, 100) / 100 }
function optFrequency(): number { return clamp(Number(getOptions(TOOL_ID).frequency) || 57, 1, 100) }
function optFeather(): number { return Number(getOptions(TOOL_ID).feather ?? 0.8) }

// ---------- stroke state ----------
let points: Vec[] = []            // doc-space dense polyline (~1.5px spacing)
let dragging = false
let lastDir: Vec | null = null    // unit direction of the last committed step
let lastShift = false
let lastAlt = false

const INTERP_STEP = 1.5           // px between interpolated vertices
const MAX_POINTS = 12000          // ~18k px of path — runaway guard

// ---------- gradient work map (built once per stroke) ----------
let grad: Float32Array | null = null
let gradW = 0
let gradH = 0
let gradScale = 1                 // doc px per work-map px (1 when not downsampled)

function dropGradient(): void {
  grad = null; gradW = 0; gradH = 0; gradScale = 1
}

/** Sobel gradient magnitude of the flat composite; > 12MP docs are
 *  downsampled to a ≤ 4MP work map (coordinates scaled by gradScale). */
function buildGradient(): void {
  dropGradient()
  const doc = engine.activeDoc
  if (!doc) return
  const opts = getOptions(TOOL_ID)
  const sampled = opts.sample === 'layer' && engine.activeLayer
    ? engine.layerCanvasDocSpace(engine.activeLayer.id)
    : getFlatComposite(doc)
  if (!sampled) return
  let work = sampled
  let scale = 1
  const mp = doc.width * doc.height
  if (mp > 12_000_000) {
    const k = Math.sqrt(mp / 4_000_000)
    const w = Math.max(1, Math.round(doc.width / k))
    const h = Math.max(1, Math.round(doc.height / k))
    work = resampleCanvas(sampled, w, h)
    scale = doc.width / w
  }
  const img = getImageData(work)
  const w = img.width, h = img.height
  const d = img.data
  const lum = new Float32Array(w * h)
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) {
    lum[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]
  }
  const out = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const tl = lum[i - w - 1], tc = lum[i - w], tr = lum[i - w + 1]
      const ml = lum[i - 1], mr = lum[i + 1]
      const bl = lum[i + w - 1], bc = lum[i + w], br = lum[i + w + 1]
      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl)
      const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr)
      out[i] = Math.hypot(gx, gy)
    }
  }
  grad = out
  gradW = w
  gradH = h
  gradScale = scale
}

function gradAt(x: number, y: number): number {
  if (!grad) return 0
  const ix = Math.round(x / gradScale)
  const iy = Math.round(y / gradScale)
  if (ix < 0 || iy < 0 || ix >= gradW || iy >= gradH) return 0
  return grad[iy * gradW + ix]
}

// ---------- path following ----------

/** push vertices between a and b at ≤ INTERP_STEP spacing (b included) */
function pushSegment(a: Vec, b: Vec): void {
  const dx = b.x - a.x, dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  if (d < 0.01) return
  const n = Math.max(1, Math.ceil(d / INTERP_STEP))
  for (let i = 1; i <= n; i++) {
    const t = i / n
    points.push({ x: a.x + dx * t, y: a.y + dy * t })
  }
}

/** best edge point inside the width/2 disk around the projection */
function snapPoint(last: Vec, proj: Vec, dir: Vec): Vec {
  const radius = Math.max(1, optWidth() / 2)
  const contrast = optContrast()
  // contrast maps to both a score boost and an edge-pickiness floor:
  // low → snaps to weak edges, high → only strong edges qualify
  const boost = 0.5 + 1.5 * contrast
  const floor = 8 + 70 * contrast

  let best: Vec | null = null
  let bestScore = 0
  const r2 = radius * radius
  const x0 = Math.floor(proj.x - radius), x1 = Math.ceil(proj.x + radius)
  const y0 = Math.floor(proj.y - radius), y1 = Math.ceil(proj.y + radius)
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const ddx = cx - proj.x, ddy = cy - proj.y
      const dd = ddx * ddx + ddy * ddy
      if (dd > r2) continue
      const mag = gradAt(cx, cy)
      if (mag <= floor) continue
      // forward-motion alignment: cos similarity, clamped ≥ 0
      const adx = cx - last.x, ady = cy - last.y
      const al = Math.hypot(adx, ady)
      let align = 1
      if (al > 0.001) {
        align = (adx * dir.x + ady * dir.y) / al
        if (align < 0) align = 0
      }
      const dist = Math.sqrt(dd)
      const score = mag * boost * align * (1 - 0.45 * (dist / radius))
      if (score > bestScore) { bestScore = score; best = { x: cx, y: cy } }
    }
  }
  // freehand fallback when no credible edge is inside the disk
  return best ?? proj
}

/** advance the path toward the target, dropping anchors every `frequency` px */
function follow(target: Vec, freehand: boolean): void {
  const freq = optFrequency()
  let guard = 0
  while (points.length < MAX_POINTS && guard++ < 64) {
    const last = points[points.length - 1]
    const dx = target.x - last.x, dy = target.y - last.y
    const dist = Math.hypot(dx, dy)
    // commit a new anchor only once the cursor is a full step ahead
    if (dist < Math.max(freq, 2)) break
    const ux = dx / dist, uy = dy / dist
    const proj = { x: last.x + ux * freq, y: last.y + uy * freq }
    const next = freehand || !grad
      ? proj
      : snapPoint(last, proj, lastDir ?? { x: ux, y: uy })
    const stepLen = Math.hypot(next.x - last.x, next.y - last.y)
    if (stepLen < 0.5) break // snap re-selected the same point — wait for travel
    pushSegment(last, next)
    lastDir = { x: (next.x - last.x) / stepLen, y: (next.y - last.y) / stepLen }
  }
}

// ---------- commit / cancel ----------

function commit(modeArg?: SelectionCombine): void {
  const opts = getOptions(TOOL_ID)
  if (points.length >= 3) {
    const mode = modeArg ?? combineMode({ shift: lastShift, alt: lastAlt }, opts.mode ?? 'new')
    engine.selectPolygon(points, optFeather(), mode, opts.antiAlias !== false)
  }
  points = []
  lastDir = null
  dropGradient()
  engine.pokeOverlay()
}

function cancel(): void {
  if (!points.length && !grad) return
  points = []
  lastDir = null
  dropGradient()
  engine.pokeOverlay()
}

// ---------- tool ----------

export const magneticLassoTool: Tool = {
  id: TOOL_ID,
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    if (!doc) return
    lastShift = p.shift
    lastAlt = p.alt

    if (points.length) {
      // open path: close-zone click commits…
      const dStart = Math.hypot(p.docX - points[0].x, p.docY - points[0].y) * doc.view.zoom
      if (points.length >= 3 && dStart < 10) {
        dragging = false
        commit(combineMode(p, getOptions(TOOL_ID).mode ?? 'new'))
        return
      }
      // …otherwise seed a manual anchor at the click and keep tracing
      pushSegment(points[points.length - 1], { x: p.docX, y: p.docY })
    } else {
      // new stroke → snapshot the composite + build the gradient map
      points = [{ x: p.docX, y: p.docY }]
      lastDir = null
      buildGradient()
    }
    dragging = true
    engine.pokeOverlay()
  },

  onPointerMove(p: PointerInfo) {
    if (!dragging) {
      if (points.length) engine.pokeOverlay() // rubber line + close-zone ring
      return
    }
    // Alt temporarily disables snapping (freehand straight segments)
    follow({ x: p.docX, y: p.docY }, p.alt)
    engine.pokeOverlay()
  },

  onPointerUp(p: PointerInfo) {
    if (!dragging) return
    dragging = false
    lastShift = p.shift
    lastAlt = p.alt
    // path stays open: click near start / double-click / Enter to commit
    engine.pokeOverlay()
  },

  onDoubleClick(p: PointerInfo) {
    if (points.length) commit(combineMode(p, getOptions(TOOL_ID).mode ?? 'new'))
  },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') { if (points.length >= 3) { commit(); return true } }
    if (e.key === 'Escape') { if (points.length) { cancel(); return true } }
    if ((e.key === 'Backspace' || e.key === 'Delete') && points.length > 1) {
      // Magnetic Lasso stores a dense interpolated path, so remove roughly
      // one frequency step rather than a single invisible 1.5px vertex.
      e.preventDefault()
      const n = Math.max(2, Math.ceil(optFrequency() / INTERP_STEP))
      points.splice(Math.max(1, points.length - n))
      lastDir = null
      engine.pokeOverlay()
      return true
    }
    return false
  },

  onDeactivate() {
    // switching tools mid-path silently discards the open path
    if (points.length || grad) cancel()
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    if (!points.length) return
    const zoom = view.zoom

    // live path — black underlay + white dashed top (screen-space dashes)
    if (points.length > 1) {
      ctx.save()
      ctx.translate(view.panX, view.panY)
      ctx.scale(zoom, zoom)
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      ctx.strokeStyle = 'rgba(0,0,0,0.75)'
      ctx.lineWidth = 2 / zoom
      ctx.setLineDash([])
      ctx.stroke()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1 / zoom
      ctx.setLineDash([6 / zoom, 4 / zoom])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    // thin rubber line: last path point → cursor (dimmer while dragging)
    if (mouse) {
      const last = points[points.length - 1]
      ctx.save()
      ctx.globalAlpha = dragging ? 0.55 : 0.85
      ctx.beginPath()
      ctx.moveTo(last.x * zoom + view.panX, last.y * zoom + view.panY)
      ctx.lineTo(mouse.x, mouse.y)
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.stroke()
      ctx.restore()
    }

    // start point marker
    const fx = points[0].x * zoom + view.panX, fy = points[0].y * zoom + view.panY
    ctx.save()
    ctx.beginPath()
    ctx.arc(fx, fy, 3, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'
    ctx.stroke()
    ctx.restore()

    // amber close-zone ring when the cursor is near the start point
    if (points.length >= 3 && mouse) {
      if (Math.hypot(mouse.x - fx, mouse.y - fy) < 10) {
        ctx.save()
        ctx.strokeStyle = '#e8a33d'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(fx, fy, 7, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    }
  },

  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    // brush-style ring showing the snap width (dual ring + center tick)
    drawBrushCursor(ctx, mouse, optWidth(), view.zoom)
  },
}
