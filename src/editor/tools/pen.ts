// ============================================================
// Pen tool — Photoshop-style vector bezier paths (Task 15-a)
//  · click = corner anchor · click+drag = smooth anchor (out handle
//    follows the pointer, in handle mirrored)
//  · Shift while dragging a handle = constrain to 45° increments
//  · Alt while dragging the out handle = break the in/out pairing
//    (independent handles — "corner-ish" anchor)
//  · click near the FIRST anchor (≤10 screen px, ≥2 anchors) closes
//    the path — a ring affordance shows when it's closeable
//  · click a closed path's empty space = start a fresh working path
//  · drag an existing anchor (≤6 screen px) = move it with its handles;
//    drag a visible handle point = adjust that handle only
//  · Ctrl/Cmd+click an anchor = toggle corner ↔ smooth (smooth handles
//    auto-generated along the neighbor segments, ~1/3 of their length)
//  · Enter commits per the `action` option (Make Selection / Stroke
//    Path / Fill Path) · Escape cancels · Backspace deletes the last
//    anchor (dispatched from render.ts onKeyDown routing)
//  · new anchor placement snaps to the grid when Snap-to-Grid is on
//    with a fixed grid size
// Doc-space path model; overlay drawn in screen space every frame.
// ============================================================
import type { Tool, PointerInfo, PathAnchor, SavedPath } from '../types'
import { engine } from '../engine/engine'
import { getOptions, getFgColor, hardDab, pencilDab } from './shared'
import { useEditorStore } from '../store'
import { createCanvas, ctx2d, getImageData, putImageData, clamp } from '../utils/canvas'
import { gaussianBlurChannel } from '../image-ops/core'

type Pt = { x: number; y: number }

/** One path anchor: doc-space position + bezier handle offsets (doc px,
 *  relative to the anchor). A corner anchor has all-zero handles; a smooth
 *  anchor has paired handles (in = −out) until Alt breaks the pairing. */
type Anchor = PathAnchor

/** cubic segment between two anchors: p0/p3 = anchors, p1 = prev.out, p2 = cur.in */
interface Seg { p0: Pt; p1: Pt; p2: Pt; p3: Pt }

type Drag =
  | { kind: 'new' }                                                    // placing a new anchor, dragging its out handle
  | { kind: 'anchor'; index: number; grabDX: number; grabDY: number }  // moving an existing anchor (+ handles)
  | { kind: 'handle'; index: number; which: 'in' | 'out' }             // adjusting one handle only

// ---------------- module state (single working path) ----------------
let anchors: Anchor[] = []
let closed = false
/** last placed/edited anchor — its handles stay visible (Photoshop behavior) */
let activeAnchor = -1
let drag: Drag | null = null

const CLOSE_PX = 10 // click near the first anchor closes the path (screen px)
const HIT_PX = 6    // anchor / handle hit radius (screen px)

// ---------------- small helpers ----------------

function toast(msg: string, type: 'info' | 'error' | 'success' = 'error') {
  useEditorStore.getState().pushToast(msg, type)
}

function hasHandles(a: Anchor): boolean {
  return !!(a.inX || a.inY || a.outX || a.outY)
}

/** grid-snap a NEW anchor placement (fixed grid only, like tools/move.ts) */
function snapNew(x: number, y: number): Pt {
  const prefs = useEditorStore.getState().view
  const gs = prefs.snapGrid ? (prefs.gridSize ?? 0) : 0
  if (gs > 0) return { x: Math.round(x / gs) * gs, y: Math.round(y / gs) * gs }
  return { x, y }
}

/** constrain a handle vector to 45° increments (Shift) */
function constrain45(dx: number, dy: number): Pt {
  const len = Math.hypot(dx, dy)
  if (len < 0.01) return { x: dx, y: dy }
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: Math.cos(ang) * len, y: Math.sin(ang) * len }
}

function resetPath() {
  anchors = []
  closed = false
  activeAnchor = -1
  drag = null
  engine.pokeOverlay()
}

export function loadSavedPathIntoPen(path: SavedPath) {
  anchors = path.anchors.map(a => ({ ...a }))
  closed = !!path.closed
  activeAnchor = anchors.length ? anchors.length - 1 : -1
  drag = null
  engine.pokeOverlay()
}

// ---------------- path geometry ----------------

function segBetween(prev: Anchor, cur: Anchor): Seg {
  return {
    p0: { x: prev.x, y: prev.y },
    p1: { x: prev.x + prev.outX, y: prev.y + prev.outY },
    p2: { x: cur.x + cur.inX, y: cur.y + cur.inY },
    p3: { x: cur.x, y: cur.y },
  }
}

/** all segments of the path (the closing segment included when closed) */
function segments(): Seg[] {
  const out: Seg[] = []
  for (let i = 1; i < anchors.length; i++) out.push(segBetween(anchors[i - 1], anchors[i]))
  if (closed && anchors.length >= 2) out.push(segBetween(anchors[anchors.length - 1], anchors[0]))
  return out
}

function cubicAt(s: Seg, t: number): Pt {
  const u = 1 - t
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
  return {
    x: a * s.p0.x + b * s.p1.x + c * s.p2.x + d * s.p3.x,
    y: a * s.p0.y + b * s.p1.y + c * s.p2.y + d * s.p3.y,
  }
}

/** sample the whole path at ~step doc px spacing (open paths do NOT close) */
function samplePath(step: number): Pt[] {
  const out: Pt[] = []
  for (const s of segments()) {
    // control-polygon length ≈ arc length (upper bound → fine spacing)
    const poly =
      Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y) +
      Math.hypot(s.p2.x - s.p1.x, s.p2.y - s.p1.y) +
      Math.hypot(s.p3.x - s.p2.x, s.p3.y - s.p2.y)
    const n = Math.max(2, Math.ceil(poly / Math.max(1, step)))
    for (let i = 0; i <= n; i++) out.push(cubicAt(s, i / n))
  }
  return out
}

/** trace the path into a 2d context (doc space). close=true adds the closing
 *  bezier segment + closePath (canvas fill() closes open subpaths implicitly,
 *  so this stays correct for open-path selections too). */
function tracePath(c: CanvasRenderingContext2D, close: boolean) {
  const n = anchors.length
  if (!n) return
  c.moveTo(anchors[0].x, anchors[0].y)
  for (let i = 1; i < n; i++) {
    const prev = anchors[i - 1], cur = anchors[i]
    c.bezierCurveTo(prev.x + prev.outX, prev.y + prev.outY, cur.x + cur.inX, cur.y + cur.inY, cur.x, cur.y)
  }
  if (close && n >= 2) {
    const last = anchors[n - 1], first = anchors[0]
    c.bezierCurveTo(last.x + last.outX, last.y + last.outY, first.x + first.inX, first.y + first.inY, first.x, first.y)
    c.closePath()
  }
}

// ---------------- hit testing (screen-px radii) ----------------

/** nearest anchor within HIT_PX (screen) of the pointer, else -1 */
function hitAnchor(p: PointerInfo, zoom: number): number {
  let best = -1, bestD = HIT_PX
  for (let i = 0; i < anchors.length; i++) {
    const d = Math.hypot(p.docX - anchors[i].x, p.docY - anchors[i].y) * zoom
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

/** grabbable handle of an anchor whose handles are VISIBLE (the active or the
 *  hovered anchor) — matches what the overlay draws. */
function hitHandle(p: PointerInfo, zoom: number): { index: number; which: 'in' | 'out' } | null {
  const candidates = new Set<number>()
  if (activeAnchor >= 0 && activeAnchor < anchors.length) candidates.add(activeAnchor)
  const hov = hitAnchor(p, zoom)
  if (hov >= 0) candidates.add(hov)
  let best: { index: number; which: 'in' | 'out' } | null = null
  let bestD = HIT_PX
  for (const i of candidates) {
    const a = anchors[i]
    for (const which of ['in', 'out'] as const) {
      const hx = a.x + (which === 'in' ? a.inX : a.outX)
      const hy = a.y + (which === 'in' ? a.inY : a.outY)
      if (hx === a.x && hy === a.y) continue // zero-length handle — nothing to grab
      const d = Math.hypot(p.docX - hx, p.docY - hy) * zoom
      if (d < bestD) { bestD = d; best = { index: i, which } }
    }
  }
  return best
}

/** nearest segment to a doc point (sampled), within 6 screen px — for the
 *  white hover highlight. -1 when nothing is close / while dragging. */
function hitSegment(segs: Seg[], pt: Pt, zoom: number): number {
  if (drag) return -1
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    for (let k = 0; k <= 12; k++) {
      const q = cubicAt(s, k / 12)
      if (Math.hypot(q.x - pt.x, q.y - pt.y) * zoom < HIT_PX) return i
    }
  }
  return -1
}

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function hitSegmentPoint(pt: Pt, zoom: number): { index: number; t: number } | null {
  const segs = segments()
  let best: { index: number; t: number; d: number } | null = null
  for (let i = 0; i < segs.length; i++) {
    for (let k = 1; k < 32; k++) {
      const t = k / 32
      const q = cubicAt(segs[i], t)
      const d = Math.hypot(q.x - pt.x, q.y - pt.y) * zoom
      if (d <= HIT_PX && (!best || d < best.d)) best = { index: i, t, d }
    }
  }
  return best ? { index: best.index, t: best.t } : null
}

function insertAnchorOnSegment(segIndex: number, t: number): boolean {
  const n = anchors.length
  if (n < 2) return false
  const nextIndex = (segIndex + 1) % n
  if (nextIndex === 0 && !closed) return false
  const prev = anchors[segIndex]
  const next = anchors[nextIndex]
  if (!prev || !next) return false
  const s = segBetween(prev, next)
  const p01 = lerpPt(s.p0, s.p1, t)
  const p12 = lerpPt(s.p1, s.p2, t)
  const p23 = lerpPt(s.p2, s.p3, t)
  const p012 = lerpPt(p01, p12, t)
  const p123 = lerpPt(p12, p23, t)
  const mid = lerpPt(p012, p123, t)

  prev.outX = p01.x - prev.x; prev.outY = p01.y - prev.y
  next.inX = p23.x - next.x; next.inY = p23.y - next.y
  const made: Anchor = {
    x: mid.x, y: mid.y,
    inX: p012.x - mid.x, inY: p012.y - mid.y,
    outX: p123.x - mid.x, outY: p123.y - mid.y,
    pair: false,
  }
  const insertAt = nextIndex === 0 ? anchors.length : nextIndex
  anchors.splice(insertAt, 0, made)
  activeAnchor = insertAt
  engine.pokeOverlay()
  return true
}

// ---------------- anchor editing ----------------

/** Ctrl/Cmd+click: toggle corner ↔ smooth. Smooth handles are auto-generated
 *  along the neighbor direction, ~1/3 of each neighbor segment's length. */
function toggleAnchorType(i: number) {
  const a = anchors[i]
  if (!a) return
  if (hasHandles(a)) {
    // smooth/broken → corner: clear the handles
    a.inX = 0; a.inY = 0; a.outX = 0; a.outY = 0
    a.pair = false
  } else {
    // corner → smooth: handles aligned with the neighbors
    const prev = anchors[i - 1], next = anchors[i + 1]
    let dx: number, dy: number
    if (prev && next) { dx = next.x - prev.x; dy = next.y - prev.y }
    else if (next) { dx = next.x - a.x; dy = next.y - a.y }
    else if (prev) { dx = a.x - prev.x; dy = a.y - prev.y }
    else { dx = 1; dy = 0 }
    const len = Math.hypot(dx, dy) || 1
    dx /= len; dy /= len
    const inLen = prev ? Math.hypot(a.x - prev.x, a.y - prev.y) / 3 : 30
    const outLen = next ? Math.hypot(next.x - a.x, next.y - a.y) / 3 : 30
    a.inX = -dx * inLen; a.inY = -dy * inLen
    a.outX = dx * outLen; a.outY = dy * outLen
    a.pair = true
  }
  activeAnchor = i
  engine.pokeOverlay()
}

// ---------------- commit actions (options read FRESH at commit) ----------------

/** threshold a canvas' alpha channel to 0/255 (antiAlias = false) */
function thresholdAlpha(c: HTMLCanvasElement) {
  const img = getImageData(c)
  const d = img.data
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0
  putImageData(c, img)
}

/** layer guard shared by stroke + fill: active, raster-capable, unlocked */
function guardPaintLayer(): boolean {
  const layer = engine.activeLayer
  if (!layer) { toast('No active layer — select a pixel layer first'); return false }
  if (layer.kind === 'adjustment') { toast('Adjustment layers have no pixels — rasterize or pick another layer'); return false }
  if (layer.locked) { toast('Layer is locked'); return false }
  return true
}

/** action = 'selection': filled Path2D → (optional threshold + feather) → setSelectionMask */
function commitSelection(opts: Record<string, any>): boolean {
  const doc = engine.activeDoc
  if (!doc) return false
  const mask = createCanvas(doc.width, doc.height)
  const c = ctx2d(mask)
  c.fillStyle = '#ffffff'
  c.beginPath()
  tracePath(c, true) // open paths close implicitly for a selection
  c.fill()
  const feather = clamp(Number(opts.feather ?? 0) || 0, 0, 250)
  if (opts.antiAlias === false) thresholdAlpha(mask)
  if (feather > 0) {
    // same feather pattern as engine.selectPolygon: gaussian blur of the alpha
    const f = new Float32Array(doc.width * doc.height)
    const md = getImageData(mask)
    for (let i = 0, j = 3; i < f.length; i++, j += 4) f[i] = md.data[j]
    const b = gaussianBlurChannel(f, doc.width, doc.height, feather)
    const out = new Uint8ClampedArray(b)
    for (let i = 0, j = 3; i < out.length; i++, j += 4) md.data[j] = out[i]
    putImageData(mask, md)
  }
  engine.setSelectionMask(mask, opts.mode ?? 'new', 'Pen Path')
  return true
}

/** action = 'stroke': sample the bezier finely, dab hard round dots through the
 *  engine stroke buffer (respects the active selection + layer offset). */
function commitStroke(opts: Record<string, any>): boolean {
  const doc = engine.activeDoc
  if (!doc) return false
  if (!guardPaintLayer()) return false
  const layer = engine.activeLayer!
  const size = clamp(Number(opts.strokeSize ?? 8) || 8, 1, 200)
  const opacity = clamp(Number(opts.strokeOpacity ?? 100) || 100, 1, 100)
  const color = getFgColor()
  const radius = size / 2
  const drawFn = opts.antiAlias === false
    ? (ctx: CanvasRenderingContext2D, dx: number, dy: number) => pencilDab(ctx, dx, dy, radius, color)
    : (ctx: CanvasRenderingContext2D, dx: number, dy: number) => hardDab(ctx, dx, dy, radius, color)
  engine.beginStroke(layer.id, { opacity })
  if (!doc._stroke) return false // beginStroke bailed (guard raced a layer change)
  // fine spacing: ~max(1, strokeSize·0.15) doc px per sample
  const step = Math.max(1, size * 0.15)
  for (const pt of samplePath(step)) engine.dab(pt.x, pt.y, drawFn, 1, size)
  engine.endStroke('Stroke Path')
  return true
}

/** action = 'fill': fill the path region with the fg color onto the active
 *  raster layer — fill.ts (paint bucket) pattern: doc-space temp canvas,
 *  selection intersected via destination-in, committed offset-aware. */
function commitFill(opts: Record<string, any>): boolean {
  const doc = engine.activeDoc
  if (!doc) return false
  if (!guardPaintLayer()) return false
  const layer = engine.activeLayer!

  const tmp = createCanvas(doc.width, doc.height)
  const tc = ctx2d(tmp)
  tc.fillStyle = getFgColor()
  tc.beginPath()
  tracePath(tc, true)
  tc.fill()
  if (opts.antiAlias === false) thresholdAlpha(tmp)
  // respect the active selection mask
  if (doc.selection) {
    tc.globalCompositeOperation = 'destination-in'
    tc.drawImage(doc.selection.mask, 0, 0)
    tc.globalCompositeOperation = 'source-over'
  }
  const l = engine.mutateLayerPixels(layer.id)
  if (!l?.canvas) return false
  const c = ctx2d(l.canvas)
  c.save()
  // tmp is doc-space — align to the layer's offset registration
  c.drawImage(tmp, -(l.offsetX ?? 0), -(l.offsetY ?? 0))
  c.restore()
  engine.pushHistory('Fill Path')
  engine.emit()
  return true
}

function commitPath() {
  if (anchors.length < 2) return // a single anchor can't select/stroke/fill
  const opts = getOptions('pen')
  const action = opts.action ?? 'selection'
  let ok = false
  if (action === 'path') {
    ok = !!engine.addSavedPath({
      name: `Work Path ${(engine.activeDoc?.savedPaths?.length ?? 0) + 1}`,
      anchors: anchors.map(a => ({ ...a })),
      closed,
      visible: true,
    }, 'Save Path')
  } else if (action === 'stroke') ok = commitStroke(opts)
  else if (action === 'fill') ok = commitFill(opts)
  else ok = commitSelection(opts)
  if (ok) resetPath()
}

// ---------------- the tool ----------------

export const penTool: Tool = {
  id: 'pen',
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    if (!doc || drag) return
    const zoom = doc.view.zoom

    // 1) click near the FIRST anchor → close the path (stop adding)
    if (!closed && anchors.length >= 2) {
      const d = Math.hypot(p.docX - anchors[0].x, p.docY - anchors[0].y) * zoom
      if (d < CLOSE_PX) {
        closed = true
        activeAnchor = -1
        engine.pokeOverlay()
        return
      }
    }

    // 2) Ctrl/Cmd+click: toggle an anchor, or add one on a segment while
    // preserving the exact Bezier curve via De Casteljau splitting.
    if (p.ctrl || p.meta) {
      const i = hitAnchor(p, zoom)
      if (i >= 0) { toggleAnchorType(i); return }
      const hit = hitSegmentPoint({ x: p.docX, y: p.docY }, zoom)
      if (hit && insertAnchorOnSegment(hit.index, hit.t)) return
    }

    // 3) grab a visible handle point (active / hovered anchor)
    const hh = hitHandle(p, zoom)
    if (hh) {
      drag = { kind: 'handle', index: hh.index, which: hh.which }
      activeAnchor = hh.index
      engine.pokeOverlay()
      return
    }

    // 4) drag an existing anchor (moves with its handles)
    const ai = hitAnchor(p, zoom)
    if (ai >= 0) {
      const a = anchors[ai]
      drag = { kind: 'anchor', index: ai, grabDX: p.docX - a.x, grabDY: p.docY - a.y }
      activeAnchor = ai
      engine.pokeOverlay()
      return
    }

    // 5) closed path + click in empty space → start a fresh working path
    if (closed) {
      anchors = []
      closed = false
      activeAnchor = -1
    }

    // 6) add a NEW anchor (grid-snapped when enabled); drag pulls its out handle
    const pos = snapNew(p.docX, p.docY)
    anchors.push({ x: pos.x, y: pos.y, inX: 0, inY: 0, outX: 0, outY: 0, pair: true })
    activeAnchor = anchors.length - 1
    drag = { kind: 'new' }
    engine.pokeOverlay()
  },

  onPointerMove(p: PointerInfo) {
    if (!drag) return
    const doc = engine.activeDoc
    if (!doc) { drag = null; return }
    const idx = drag.kind === 'new' ? anchors.length - 1 : drag.index
    const a = anchors[idx]
    if (!a) { drag = null; return }

    if (drag.kind === 'new' || drag.kind === 'handle') {
      // the handle follows the pointer (relative to its anchor)
      let dx = p.docX - a.x, dy = p.docY - a.y
      if (p.shift) { const c = constrain45(dx, dy); dx = c.x; dy = c.y }
      if (p.alt) a.pair = false // Alt breaks the in/out pairing
      if (drag.kind === 'new' || drag.which === 'out') {
        a.outX = dx; a.outY = dy
        if (a.pair) { a.inX = -a.outX; a.inY = -a.outY }
      } else {
        a.inX = dx; a.inY = dy
        if (a.pair) { a.outX = -a.inX; a.outY = -a.inY }
      }
    } else {
      // move the anchor; handles ride along (they are relative offsets)
      a.x = p.docX - drag.grabDX
      a.y = p.docY - drag.grabDY
    }
    engine.pokeOverlay()
  },

  onPointerUp(p: PointerInfo) {
    if (!drag) return
    const wasNew = drag.kind === 'new'
    const doc = engine.activeDoc
    drag = null
    if (!doc || !wasNew) return
    // click (no meaningful drag) → the new anchor stays a CORNER anchor
    const a = anchors[anchors.length - 1]
    if (a) {
      const moved = Math.hypot(p.docX - a.x, p.docY - a.y) * doc.view.zoom
      if (moved < 3) { a.inX = 0; a.inY = 0; a.outX = 0; a.outY = 0; a.pair = false }
    }
    engine.pokeOverlay()
  },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (anchors.length >= 2) { commitPath(); return true }
      return false
    }
    if (e.key === 'Escape') {
      if (anchors.length || drag) { resetPath(); return true }
      return false
    }
    if (e.key === 'Backspace') {
      if (anchors.length) {
        e.preventDefault()
        anchors.pop()
        if (activeAnchor >= anchors.length) activeAnchor = -1
        engine.pokeOverlay()
        return true
      }
      return false
    }
    return false
  },

  onDeactivate() {
    // tool switched mid-path: cancel quietly — no history side effects
    if (anchors.length || drag) resetPath()
  },

  renderOverlay(ctx, view, w, h, mouse) {
    const doc = engine.activeDoc
    if (!doc || !anchors.length) return
    const zoom = view.zoom
    const n = anchors.length
    const sx = (x: number) => x * zoom + view.panX
    const sy = (y: number) => y * zoom + view.panY

    // hover info (doc space) from the overlay mouse position
    const hoverDoc = mouse ? { x: (mouse.x - view.panX) / zoom, y: (mouse.y - view.panY) / zoom } : null
    let hoverAnchor = -1
    if (hoverDoc && !drag) {
      let best = HIT_PX
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(hoverDoc.x - anchors[i].x, hoverDoc.y - anchors[i].y) * zoom
        if (d < best) { best = d; hoverAnchor = i }
      }
    }

    // ---- the path (amber 1.5px through the bezier segments; dark halo
    //      underneath for contrast on any background) ----
    const segs = segments()
    if (segs.length) {
      ctx.save()
      ctx.setLineDash([])
      for (const pass of [{ c: 'rgba(0,0,0,0.55)', lw: 3.5 }, { c: '#e8a33d', lw: 1.5 }]) {
        ctx.beginPath()
        ctx.moveTo(sx(segs[0].p0.x), sy(segs[0].p0.y))
        for (const s of segs) {
          ctx.bezierCurveTo(sx(s.p1.x), sy(s.p1.y), sx(s.p2.x), sy(s.p2.y), sx(s.p3.x), sy(s.p3.y))
        }
        if (closed) ctx.closePath()
        ctx.strokeStyle = pass.c
        ctx.lineWidth = pass.lw
        ctx.stroke()
      }
      // hovered segment → white highlight
      if (hoverDoc) {
        const hi = hitSegment(segs, hoverDoc, zoom)
        if (hi >= 0) {
          const s = segs[hi]
          ctx.beginPath()
          ctx.moveTo(sx(s.p0.x), sy(s.p0.y))
          ctx.bezierCurveTo(sx(s.p1.x), sy(s.p1.y), sx(s.p2.x), sy(s.p2.y), sx(s.p3.x), sy(s.p3.y))
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    // ---- rubber band: dashed preview from the last anchor to the cursor
    //      (open path, not mid-drag — while dragging the live trace itself
    //      previews the segment through the current handles) ----
    if (!closed && !drag && hoverDoc) {
      const last = anchors[n - 1]
      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = 'rgba(232,163,61,0.8)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(sx(last.x), sy(last.y))
      ctx.bezierCurveTo(
        sx(last.x + last.outX), sy(last.y + last.outY),
        sx(hoverDoc.x), sy(hoverDoc.y),
        sx(hoverDoc.x), sy(hoverDoc.y),
      )
      ctx.stroke()
      ctx.restore()
    }

    // ---- handle lines + points for the active / hovered / dragged anchor ----
    const showIdx = new Set<number>()
    if (activeAnchor >= 0 && activeAnchor < n) showIdx.add(activeAnchor)
    if (hoverAnchor >= 0) showIdx.add(hoverAnchor)
    if (drag) showIdx.add(drag.kind === 'new' ? n - 1 : drag.index)
    for (const i of showIdx) {
      const a = anchors[i]
      for (const which of ['in', 'out'] as const) {
        const hx = a.x + (which === 'in' ? a.inX : a.outX)
        const hy = a.y + (which === 'in' ? a.inY : a.outY)
        if (hx === a.x && hy === a.y) continue
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'
        ctx.lineWidth = 1
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(sx(a.x), sy(a.y))
        ctx.lineTo(sx(hx), sy(hy))
        ctx.stroke()
        ctx.fillStyle = '#e8a33d'
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'
        ctx.beginPath()
        ctx.arc(sx(hx), sy(hy), 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      }
    }

    // ---- anchor markers: 7px squares — hollow = corner, filled = smooth,
    //      white when active/hovered ----
    for (let i = 0; i < n; i++) {
      const a = anchors[i]
      const x = sx(a.x), y = sy(a.y)
      const isActive = i === activeAnchor || i === hoverAnchor
      ctx.save()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(0,0,0,0.55)' // dark backing for contrast
      ctx.fillRect(x - 4.5, y - 4.5, 9, 9)
      if (hasHandles(a)) {
        ctx.fillStyle = isActive ? '#ffffff' : '#e8a33d'
        ctx.fillRect(x - 3.5, y - 3.5, 7, 7)
      } else {
        ctx.strokeStyle = isActive ? '#ffffff' : '#e8a33d'
        ctx.lineWidth = 1.5
        ctx.strokeRect(x - 3.5, y - 3.5, 7, 7)
      }
      ctx.restore()
    }

    // ---- close affordance: ring around the first anchor when the cursor is
    //      near it (≥3 anchors, open path) ----
    if (!closed && n >= 3 && hoverDoc) {
      const d = Math.hypot(hoverDoc.x - anchors[0].x, hoverDoc.y - anchors[0].y) * zoom
      if (d < CLOSE_PX) {
        ctx.save()
        ctx.strokeStyle = '#e8a33d'
        ctx.lineWidth = 2
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.arc(sx(anchors[0].x), sy(anchors[0].y), 10, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    }

    // ---- anchor-count badge near the cursor (pill style from guides.drawGrid) ----
    if (mouse) {
      const text = `${n} anchor${n === 1 ? '' : 's'}${closed ? ' · closed' : ''}`
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
  },

  renderCursor(ctx, view, w, h, mouse) {
    void view; void w; void h
    if (!mouse) return
    // small precise crosshair (5px arms, white with a dark shadow)
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 2
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(mouse.x - 5, mouse.y); ctx.lineTo(mouse.x + 5, mouse.y)
    ctx.moveTo(mouse.x, mouse.y - 5); ctx.lineTo(mouse.x, mouse.y + 5)
    ctx.stroke()
    ctx.restore()
  },
}
