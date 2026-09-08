// ============================================================
// Guides & rulers — document guides, screen-space drawing, snapping
//
// Guides live on PsDocument.guides (view state, not undo-tracked).
// Rulers + guide lines are drawn on the viewport OVERLAY canvas in
// screen space. Pointer interactions (create from ruler, drag, delete
// by dragging back into the ruler) are routed by the Viewport.
// ============================================================
import type { Guide, PsDocument, ViewportState } from '../types'

export const RULER_W = 18 // screen px width of each ruler strip

/** doc-space position → screen px */
export function docToScreen(view: ViewportState, x: number, y: number): { x: number; y: number } {
  return { x: view.panX + x * view.zoom, y: view.panY + y * view.zoom }
}

/** find a guide near a screen point (within threshold px) — returns the guide + grab axis */
export function hitGuide(
  doc: PsDocument, view: ViewportState, sx: number, sy: number, threshold = 5
): Guide | null {
  if (!doc.guides?.length) return null
  let best: Guide | null = null
  let bestD = threshold
  for (const g of doc.guides) {
    const d = g.orientation === 'h'
      ? Math.abs(view.panY + g.pos * view.zoom - sy)
      : Math.abs(view.panX + g.pos * view.zoom - sx)
    if (d <= bestD) { bestD = d; best = g }
  }
  return best
}

/**
 * Snap a doc-space point to nearby guides.
 * Returns the snapped point and which axes snapped (for status display).
 */
export function snapToGuides(
  doc: PsDocument, view: ViewportState, x: number, y: number,
  screenThreshold = 6
): { x: number; y: number; snappedX: boolean; snappedY: boolean } {
  const out = { x, y, snappedX: false, snappedY: false }
  if (!doc.guides?.length) return out
  const thresholdDoc = screenThreshold / view.zoom
  let bestX = thresholdDoc, bestY = thresholdDoc
  for (const g of doc.guides) {
    if (g.orientation === 'v') {
      const d = Math.abs(g.pos - x)
      if (d <= bestX) { bestX = d; out.x = g.pos; out.snappedX = true }
    } else {
      const d = Math.abs(g.pos - y)
      if (d <= bestY) { bestY = d; out.y = g.pos; out.snappedY = true }
    }
  }
  return out
}

/** ruler measurement units (labels/UX only — docs stay in px) */
export type RulerUnit = 'px' | 'in' | 'cm' | 'mm'

/** doc px per 1 unit — CSS reference pixel standard: 96 px / inch */
const RULER_UNIT_PX: Record<RulerUnit, number> = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,   // ≈ 37.795
  mm: 96 / 25.4,    // ≈ 3.7795
}

/** nice MAJOR tick steps per unit, in UNIT space (not doc px) */
const RULER_UNIT_STEPS: Record<RulerUnit, number[]> = {
  px: [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000],
  in: [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 5, 10, 25, 50],
  cm: [0.1, 0.5, 1, 2, 5, 10, 25, 50],
  mm: [1, 5, 10, 25, 50, 100, 250],
}

/** minor-tick divisor: whichever splits the major step "integer-ish"
 *  (in = dyadic fractions → /4; cm/mm = decimal steps → /5; px = step-based) */
function rulerMinorDiv(unit: RulerUnit, step: number): number {
  if (unit === 'in') return 4
  if (unit === 'cm' || unit === 'mm') return 5
  return step >= 25 ? 5 : 4
}

/** format a tick label in unit space: px/mm integers, in ≤2 decimals, cm ≤1 decimal — trimmed */
function rulerLabel(u: number, unit: RulerUnit): string {
  if (unit === 'px' || unit === 'mm') return String(Math.round(u))
  if (unit === 'in') return u.toFixed(2).replace(/\.?0+$/, '')
  return u.toFixed(1).replace(/\.0$/, '')
}

/** draw both ruler strips + tick marks in the requested units; the unit symbol
 *  sits in the corner square and the mouse position is highlighted. Ticks span
 *  the full ruler length (not clamped to the doc) like real image editors. */
export function drawRulers(
  ctx: CanvasRenderingContext2D, doc: PsDocument, view: ViewportState,
  w: number, h: number, mouse: { x: number; y: number } | null,
  units: RulerUnit = 'px'
): void {
  const R = RULER_W
  if (w < R * 2 || h < R * 2) return
  ctx.save()
  // ruler background
  ctx.fillStyle = 'rgba(24,24,26,0.96)'
  ctx.fillRect(0, 0, w, R)
  ctx.fillRect(0, 0, R, h)
  // border lines
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, R + 0.5); ctx.lineTo(w, R + 0.5)
  ctx.moveTo(R + 0.5, 0); ctx.lineTo(R + 0.5, h)
  ctx.stroke()
  // corner square + unit symbol (affordance: which unit the ticks are in)
  ctx.fillStyle = 'rgba(30,30,32,1)'
  ctx.fillRect(0, 0, R, R)
  ctx.font = '8px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(160,160,166,0.85)'
  ctx.fillText(units, R / 2, R / 2 + 1)
  ctx.textAlign = 'left'

  // tick step in UNIT space: smallest nice step whose screen size ≥ 56 px
  const unitPx = RULER_UNIT_PX[units]
  const steps = RULER_UNIT_STEPS[units]
  const step = (() => {
    for (const s of steps) if (s * unitPx * view.zoom >= 56) return s
    return steps[steps.length - 1]
  })()
  const div = rulerMinorDiv(units, step)

  ctx.font = '8px ui-monospace, monospace'
  ctx.textBaseline = 'top'
  ctx.fillStyle = 'rgba(200,200,205,0.75)'
  ctx.strokeStyle = 'rgba(200,200,205,0.35)'

  // top ruler (horizontal doc axis) — ticks in unit space, spanning the ruler
  const iX0 = Math.floor(((-view.panX / view.zoom) / unitPx) / step)
  const iX1 = Math.ceil(((w - view.panX) / view.zoom / unitPx) / step)
  for (let i = iX0; i <= iX1; i++) {
    const u = i * step
    const sx = view.panX + u * unitPx * view.zoom
    if (sx < R || sx > w) continue
    ctx.beginPath()
    ctx.moveTo(sx + 0.5, R - 6); ctx.lineTo(sx + 0.5, R)
    ctx.stroke()
    ctx.fillText(rulerLabel(u, units), sx + 2, 3)
    // minor ticks
    for (let m = 1; m < div; m++) {
      const mu = (i + m / div) * step
      const msx = view.panX + mu * unitPx * view.zoom
      if (msx < R || msx > w) continue
      ctx.beginPath()
      ctx.moveTo(msx + 0.5, R - 3); ctx.lineTo(msx + 0.5, R)
      ctx.stroke()
    }
  }

  // left ruler (vertical doc axis)
  ctx.textBaseline = 'middle'
  const iY0 = Math.floor(((-view.panY / view.zoom) / unitPx) / step)
  const iY1 = Math.ceil(((h - view.panY) / view.zoom / unitPx) / step)
  for (let i = iY0; i <= iY1; i++) {
    const u = i * step
    const sy = view.panY + u * unitPx * view.zoom
    if (sy < R || sy > h) continue
    ctx.beginPath()
    ctx.moveTo(R - 6, sy + 0.5); ctx.lineTo(R, sy + 0.5)
    ctx.stroke()
    ctx.save()
    ctx.translate(4, sy - 3)
    ctx.rotate(-Math.PI / 2)
    ctx.textBaseline = 'top'
    ctx.fillText(rulerLabel(u, units), 0, 0)
    ctx.restore()
    for (let m = 1; m < div; m++) {
      const mu = (i + m / div) * step
      const msy = view.panY + mu * unitPx * view.zoom
      if (msy < R || msy > h) continue
      ctx.beginPath()
      ctx.moveTo(R - 3, msy + 0.5); ctx.lineTo(R, msy + 0.5)
      ctx.stroke()
    }
  }

  // mouse position markers
  if (mouse) {
    ctx.strokeStyle = 'rgba(232,163,61,0.9)'
    ctx.lineWidth = 1
    if (mouse.x > R && mouse.y > R) {
      ctx.beginPath()
      ctx.moveTo(mouse.x + 0.5, 0); ctx.lineTo(mouse.x + 0.5, R - 1)
      ctx.moveTo(0, mouse.y + 0.5); ctx.lineTo(R - 1, mouse.y + 0.5)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** draw guide lines over the canvas area (not over the rulers) */
export function drawGuides(
  ctx: CanvasRenderingContext2D, doc: PsDocument, view: ViewportState, w: number, h: number
): void {
  if (!doc.guides?.length) return
  const R = RULER_W
  ctx.save()
  ctx.beginPath()
  ctx.rect(R, R, w - R, h - R)
  ctx.clip()
  ctx.strokeStyle = 'rgba(105,204,255,0.85)'
  ctx.lineWidth = 1
  ctx.setLineDash([])
  for (const g of doc.guides) {
    ctx.beginPath()
    if (g.orientation === 'h') {
      const sy = Math.round(view.panY + g.pos * view.zoom) + 0.5
      ctx.moveTo(R, sy); ctx.lineTo(w, sy)
    } else {
      const sx = Math.round(view.panX + g.pos * view.zoom) + 0.5
      ctx.moveTo(sx, R); ctx.lineTo(sx, h)
    }
    ctx.stroke()
  }
  ctx.restore()
}

// ============================================================
// Pixel grid (View > Pixel Grid) — Task 15-d
//  · 1-doc-px cells, drawn only at zoom >= 4 AND while a bounded
//    number of visible doc pixels (<= 6000) is on screen, so the
//    overlay work stays cheap no matter the zoom/viewport
//  · lines at every doc-integer coordinate, device-pixel-snapped
//    (Math.round + 0.5, same as drawGrid), clipped to the doc rect
// ============================================================

/** 1-doc-px cell grid at high zoom — self-gating (zoom threshold + cell cap) */
export function drawPixelGrid(
  ctx: CanvasRenderingContext2D, doc: PsDocument, view: ViewportState,
  w: number, h: number
): void {
  if (view.zoom < 4) return
  const R = RULER_W
  // doc rect ∩ viewport in screen space, excluding the ruler strips
  const dx0 = view.panX, dy0 = view.panY
  const dx1 = view.panX + doc.width * view.zoom, dy1 = view.panY + doc.height * view.zoom
  const vx0 = Math.max(R, dx0), vy0 = Math.max(R, dy0)
  const vx1 = Math.min(w, dx1), vy1 = Math.min(h, dy1)
  if (vx1 <= vx0 || vy1 <= vy0) return
  // cap the LINE count (columns + rows) — canvas handles a few thousand
  // hairlines fine; the old 6000-CELL cap pushed the grid past 12× zoom,
  // while Photoshop shows it from ~400%
  const visW = (vx1 - vx0) / view.zoom
  const visH = (vy1 - vy0) / view.zoom
  if (visW + visH > 2400) return

  ctx.save()
  ctx.beginPath()
  ctx.rect(vx0, vy0, vx1 - vx0, vy1 - vy0)
  ctx.clip()
  ctx.strokeStyle = 'rgba(128,128,128,0.32)'
  ctx.lineWidth = 1
  ctx.beginPath()
  const docX0 = (vx0 - view.panX) / view.zoom, docX1 = (vx1 - view.panX) / view.zoom
  const docY0 = (vy0 - view.panY) / view.zoom, docY1 = (vy1 - view.panY) / view.zoom
  for (let x = Math.ceil(docX0); x <= Math.floor(docX1); x++) {
    const sx = Math.round(view.panX + x * view.zoom) + 0.5
    ctx.moveTo(sx, vy0); ctx.lineTo(sx, vy1)
  }
  for (let y = Math.ceil(docY0); y <= Math.floor(docY1); y++) {
    const sy = Math.round(view.panY + y * view.zoom) + 0.5
    ctx.moveTo(vx0, sy); ctx.lineTo(vx1, sy)
  }
  ctx.stroke()
  ctx.restore()
}

// ============================================================
// Measurement grid (View > Show Grid) — Task 11
//  · adaptive step by zoom when gridSize = 0 (auto), else fixed doc px
//  · minor + major lines, drawn only inside the document rect
//  · x/y measurements: coordinate labels on each major line (X along the
//    doc's top edge, Y along the left edge) + a live cursor badge showing
//    the exact doc-space position while the grid is visible
// ============================================================

const GRID_STEPS = [1, 2, 4, 5, 8, 10, 16, 20, 25, 32, 50, 64, 100, 125, 200, 250, 500, 1000]

/** resolve the grid step (major) in doc px: fixed pref or adaptive by zoom */
export function gridStep(view: ViewportState, gridSize: number): number {
  if (gridSize > 0) return gridSize
  for (const s of GRID_STEPS) if (s * view.zoom >= 64) return s
  return GRID_STEPS[GRID_STEPS.length - 1]
}

/** measurement grid: minor/major lines inside the doc rect, coordinate labels
 *  on major lines, and a live cursor-position badge (doc x/y). */
export function drawGrid(
  ctx: CanvasRenderingContext2D, doc: PsDocument, view: ViewportState,
  w: number, h: number, mouse: { x: number; y: number } | null,
  opts: { gridSize?: number; labels?: boolean } = {}
): void {
  const R = RULER_W
  const step = gridStep(view, opts.gridSize ?? 0)
  const minorDiv = step >= 25 ? 5 : 4
  const minor = step / minorDiv
  // doc rect in screen space
  const dx0 = view.panX, dy0 = view.panY
  const dx1 = view.panX + doc.width * view.zoom, dy1 = view.panY + doc.height * view.zoom
  const vx0 = Math.max(R, dx0), vy0 = Math.max(R, dy0)
  const vx1 = Math.min(w, dx1), vy1 = Math.min(h, dy1)
  if (vx1 <= vx0 || vy1 <= vy0 || step <= 0) return

  ctx.save()
  ctx.beginPath()
  ctx.rect(vx0, vy0, vx1 - vx0, vy1 - vy0)
  ctx.clip()

  // ---- minor lines ----
  const minorPx = minor * view.zoom
  if (minorPx >= 6) {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    ctx.beginPath()
    // integer-index iteration keeps the major/minor split exact under floats
    const minDocX = (vx0 - view.panX) / view.zoom, maxDocX = (vx1 - view.panX) / view.zoom
    const minDocY = (vy0 - view.panY) / view.zoom, maxDocY = (vy1 - view.panY) / view.zoom
    for (let i = Math.ceil(minDocX / minor); i * minor <= maxDocX; i++) {
      if (i % minorDiv === 0) continue // major line, drawn below
      const sx = Math.round(view.panX + i * minor * view.zoom) + 0.5
      ctx.moveTo(sx, vy0); ctx.lineTo(sx, vy1)
    }
    for (let i = Math.ceil(minDocY / minor); i * minor <= maxDocY; i++) {
      if (i % minorDiv === 0) continue
      const sy = Math.round(view.panY + i * minor * view.zoom) + 0.5
      ctx.moveTo(vx0, sy); ctx.lineTo(vx1, sy)
    }
    ctx.stroke()
  }

  // ---- major lines ----
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 1
  ctx.beginPath()
  const ax: number[] = [], ay: number[] = []
  const minDocX = (vx0 - view.panX) / view.zoom, maxDocX = (vx1 - view.panX) / view.zoom
  const minDocY = (vy0 - view.panY) / view.zoom, maxDocY = (vy1 - view.panY) / view.zoom
  for (let i = Math.ceil(minDocX / step); i * step <= maxDocX; i++) {
    const sx = Math.round(view.panX + i * step * view.zoom) + 0.5
    ax.push(sx)
    ctx.moveTo(sx, vy0); ctx.lineTo(sx, vy1)
  }
  for (let i = Math.ceil(minDocY / step); i * step <= maxDocY; i++) {
    const sy = Math.round(view.panY + i * step * view.zoom) + 0.5
    ay.push(sy)
    ctx.moveTo(vx0, sy); ctx.lineTo(vx1, sy)
  }
  ctx.stroke()

  // ---- x/y measurements: labels on every major line ----
  if (opts.labels !== false && step * view.zoom >= 34) {
    ctx.font = '9px ui-monospace, SFMono-Regular, monospace'
    ctx.textBaseline = 'top'
    const label = (t: string, x: number, y: number, bg = true) => {
      if (bg) {
        const tw = ctx.measureText(t).width
        ctx.fillStyle = 'rgba(20,20,22,0.62)'
        ctx.fillRect(x - 1, y - 1, tw + 4, 11)
      }
      ctx.fillStyle = 'rgba(232,163,61,0.95)'
      ctx.fillText(t, x + 1, y)
    }
    // X values along the doc's top edge (inside)
    for (let i = 0; i < ax.length; i++) {
      const gx = Math.round((ax[i] - view.panX) / view.zoom)
      const lx = ax[i] + 2, ly = Math.max(vy0 + 2, dy0 + 2)
      label(String(gx), lx, ly)
    }
    // Y values along the doc's left edge (inside)
    ctx.textBaseline = 'middle'
    for (let i = 0; i < ay.length; i++) {
      const gy = Math.round((ay[i] - view.panY) / view.zoom)
      const lx = Math.max(vx0 + 2, dx0 + 2), ly = ay[i] + 2
      label(String(gy), lx, ly)
    }
  }

  ctx.restore()

  // ---- live cursor badge: exact doc-space x/y while the grid is on ----
  if (mouse && mouse.x > R && mouse.y > R) {
    const docX = (mouse.x - view.panX) / view.zoom
    const docY = (mouse.y - view.panY) / view.zoom
    if (docX >= 0 && docY >= 0 && docX < doc.width && docY < doc.height) {
      const text = `${Math.round(docX)}, ${Math.round(docY)}`
      ctx.save()
      ctx.font = '10px ui-monospace, SFMono-Regular, monospace'
      const tw = ctx.measureText(text).width
      let bx = mouse.x + 14, by = mouse.y + 16
      if (bx + tw + 10 > w) bx = mouse.x - tw - 14
      if (by + 16 > h) by = mouse.y - 24
      ctx.fillStyle = 'rgba(15,15,17,0.82)'
      ctx.strokeStyle = 'rgba(232,163,61,0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(bx, by, tw + 10, 16, 3)
      ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#f4c47c'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, bx + 5, by + 8)
      ctx.restore()
    }
  }
}
