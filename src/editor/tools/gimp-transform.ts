// ============================================================
// GIMP-style transform tools
//
//  · Alignment      click an object to align it to a reference
//  · Rotate         drag around a pivot; live pixel preview
//  · Scale          drag from a pivot; live pixel preview
//  · Shear          drag horizontally/vertically; live pixel preview
//  · Perspective    drag the four corners of a projective quad
//  · Unified        combined move / scale / rotate transform box
//  · Handle         drag 4 or 8 control points through a warp mesh
//  · Flip           click to flip around the pointer (Shift toggles axis)
//  · Cage           drag a rows×cols deformation cage
//  · Warp           drag a regular warp grid
//
// Rotate/Scale/Shear/Unified use the existing live-drag fast path
// (`doc._liveDrag.liveTransform`) so the preview matches the committed
// pixels exactly. Mesh tools draw their control grid on the overlay and
// commit through the engine's warp/distort paths on release/Enter.
// ============================================================
import type { LiveLayerDrag, PointerInfo, Rect, Tool, ViewportState } from '../types'
import { engine } from '../engine/engine'
import { buildLiveDrag } from '../engine/document'
import { getOptions, pickLayerAt } from './shared'
import { clamp } from '../utils/canvas'
import { homography, projectPoint, isValidPerspectiveQuad, type Point2 } from '../image-ops/perspective'
import { useEditorStore } from '../store'

const RAD = Math.PI / 180
const UNIT_QUAD: Point2[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]

// ------------------------------------------------------------
// Shared target / geometry helpers
// ------------------------------------------------------------

interface TargetSet {
  ids: string[]
  id: string | null
}

function targets(): TargetSet {
  const doc = engine.activeDoc
  if (!doc) return { ids: [], id: null }
  const selected = (doc.selectedLayerIds ?? []).filter(layerId => {
    const layer = engine.layerById(layerId)
    return !!layer && !layer.locked && layer.kind !== 'adjustment'
  })
  if (selected.length > 1 && doc.activeLayerId && selected.includes(doc.activeLayerId)) {
    return { ids: selected, id: doc.activeLayerId }
  }
  const id = doc.activeLayerId
  if (!id) return { ids: [], id: null }
  const layer = engine.layerById(id)
  if (!layer || layer.locked || layer.kind === 'adjustment') return { ids: [], id: null }
  return { ids: [id], id }
}

function unionRects(rects: (Rect | null)[]): Rect | null {
  const valid = rects.filter((r): r is Rect => !!r && r.w > 0 && r.h > 0)
  if (!valid.length) return null
  const x0 = Math.min(...valid.map(r => r.x))
  const y0 = Math.min(...valid.map(r => r.y))
  const x1 = Math.max(...valid.map(r => r.x + r.w))
  const y1 = Math.max(...valid.map(r => r.y + r.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function targetBounds(ids: string[]): Rect | null {
  return unionRects(ids.map(id => engine.layerContentRect(id)))
}

function pivotFor(rect: Rect, opts: Record<string, any>): Point2 {
  return {
    x: rect.x + rect.w * clamp(Number(opts.centerX ?? 50), 0, 100) / 100,
    y: rect.y + rect.h * clamp(Number(opts.centerY ?? 50), 0, 100) / 100,
  }
}

function pointInRect(p: Point2, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function screen(view: ViewportState, p: Point2): Point2 {
  return { x: view.panX + p.x * view.zoom, y: view.panY + p.y * view.zoom }
}

function toast(message: string, type: 'info' | 'success' | 'error' = 'info') {
  useEditorStore.getState().pushToast(message, type)
}

// ------------------------------------------------------------
// Live affine preview helpers
// ------------------------------------------------------------

interface LiveTransform {
  sx: number
  sy: number
  rotation: number
  ax: number
  ay: number
  shearX?: number
  shearY?: number
}

function beginLive(id: string, pivot: Point2, transform = true): LiveLayerDrag | null {
  const doc = engine.activeDoc
  if (!doc) return null
  const ld = buildLiveDrag(doc, id)
  if (!ld) return null
  ld.dx = 0
  ld.dy = 0
  if (transform) {
    ld.liveTransform = { sx: 1, sy: 1, rotation: 0, ax: pivot.x, ay: pivot.y, shearX: 0, shearY: 0 }
  }
  doc._liveDrag = ld
  return ld
}

function setLive(ld: LiveLayerDrag | null, next: Partial<LiveTransform>) {
  if (!ld?.liveTransform) return
  Object.assign(ld.liveTransform, next)
  engine.requestRender()
}

function clearLive() {
  const doc = engine.activeDoc
  if (doc) doc._liveDrag = null
  engine.requestRender()
}

function commitAffine(ids: string[], id: string, spec: LiveTransform) {
  if (Math.abs(1 - (spec.shearX ?? 0) * (spec.shearY ?? 0)) < 1e-6) {
    toast('This transform would collapse the layer', 'error')
    return
  }
  const unique = [...new Set(ids)]
  if (unique.length > 1) {
    // Apply the identical gesture map to every selected layer. This keeps the
    // configured pivot (unlike transformSelectedLayers' union center) and
    // records exactly one history state for the whole group.
    const layers = unique.map(layerId => engine.layerById(layerId))
    if (layers.some(layer => !layer || layer.locked || layer.kind === 'adjustment')) {
      toast('Every selected layer must remain unlocked and transformable', 'error')
      return
    }
    const rects = unique.map(layerId => engine.layerContentRect(layerId))
    if (rects.some(r => !r || r.w < 1 || r.h < 1)) {
      toast('Every selected layer must contain transformable content', 'error')
      return
    }
    for (const layerId of unique) {
      engine.directTransformLayer(layerId, {
        sx: spec.sx,
        sy: spec.sy,
        rotation: spec.rotation,
        ax: spec.ax,
        ay: spec.ay,
        shearX: spec.shearX,
        shearY: spec.shearY,
      }, { skipHistory: true, silent: true })
    }
    engine.pushHistory(`Transform ${unique.length} Layers`)
    engine.emit()
    return
  }
  engine.directTransformLayer(id, {
    sx: spec.sx,
    sy: spec.sy,
    rotation: spec.rotation,
    ax: spec.ax,
    ay: spec.ay,
    shearX: spec.shearX,
    shearY: spec.shearY,
  })
}

function commitSkew(ids: string[], id: string, pivot: Point2, shearX: number, shearY: number) {
  if (Math.abs(1 - shearX * shearY) < 0.02) {
    toast('The shear would collapse the layer', 'error')
    return
  }
  commitAffine(ids, id, { sx: 1, sy: 1, rotation: 0, ax: pivot.x, ay: pivot.y, shearX, shearY })
}

function commitWarp(id: string, base: Point2[], u: number[], v: number[], dest: Point2[]): boolean {
  const inv = homography(base, UNIT_QUAD)
  if (!inv) {
    toast('This layer has no transformable content', 'error')
    return false
  }
  const points = dest.map(p => projectPoint(inv, p))
  engine.transformLayer(id, { mode: 'warp', warp: { u: [...u], v: [...v], points } })
  return true
}

function commitQuad(id: string, base: Point2[], dest: Point2[]): boolean {
  if (!isValidPerspectiveQuad(dest)) {
    toast('The perspective quad would collapse or self-intersect', 'error')
    return false
  }
  const cornerOffsets = dest.map((p, i) => ({ x: p.x - base[i].x, y: p.y - base[i].y })) as [Point2, Point2, Point2, Point2]
  engine.transformLayer(id, { mode: 'distort', cornerOffsets })
  return true
}

// ------------------------------------------------------------
// Overlay drawing
// ------------------------------------------------------------

function drawDualPolygon(ctx: CanvasRenderingContext2D, pts: Point2[], view: ViewportState, close = true, fill?: string) {
  if (pts.length < 2) return
  ctx.save()
  ctx.beginPath()
  const first = screen(view, pts[0])
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < pts.length; i++) {
    const p = screen(view, pts[i])
    ctx.lineTo(p.x, p.y)
  }
  if (close) ctx.closePath()
  if (fill) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.78)'
  ctx.lineWidth = 3
  ctx.setLineDash([])
  ctx.stroke()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.25
  ctx.stroke()
  ctx.restore()
}

function drawDashedRect(ctx: CanvasRenderingContext2D, rect: Rect, view: ViewportState, color: string) {
  ctx.save()
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  const p = screen(view, rect)
  ctx.strokeRect(p.x + 0.5, p.y + 0.5, rect.w * view.zoom, rect.h * view.zoom)
  ctx.restore()
}

function drawHandle(ctx: CanvasRenderingContext2D, p: Point2, active = false, locked = false) {
  ctx.save()
  const s = active ? 10 : 8
  ctx.fillStyle = locked ? 'rgba(120,120,126,0.75)' : active ? '#e8a33d' : '#ffffff'
  ctx.strokeStyle = 'rgba(15,15,17,0.92)'
  ctx.lineWidth = 1.5
  if (locked) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  } else {
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s)
    ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s)
  }
  ctx.restore()
}

function drawBadge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number) {
  ctx.save()
  ctx.font = '10px ui-monospace, SFMono-Regular, monospace'
  const tw = ctx.measureText(text).width
  const bx = clamp(x, 6, Math.max(6, w - tw - 16))
  const by = clamp(y, 6, Math.max(6, h - 23))
  ctx.fillStyle = 'rgba(15,15,17,0.9)'
  ctx.strokeStyle = 'rgba(232,163,61,0.65)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(bx, by, tw + 10, 17, 3)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#f4c47c'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, bx + 5, by + 8.5)
  ctx.restore()
}

function mapCorners(rect: Rect, lt: LiveTransform): Point2[] {
  const cos = Math.cos(lt.rotation)
  const sin = Math.sin(lt.rotation)
  const sx = lt.sx, sy = lt.sy, kx = lt.shearX ?? 0, ky = lt.shearY ?? 0
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ].map(p => {
    const ox = p.x - lt.ax
    const oy = p.y - lt.ay
    const ax = (ox + oy * kx) * sx
    const ay = (oy + ox * ky) * sy
    return {
      x: lt.ax + ax * cos - ay * sin,
      y: lt.ay + ax * sin + ay * cos,
    }
  })
}

// ============================================================
// Rotate
// ============================================================

interface RotateDrag {
  ids: string[]
  id: string
  rect: Rect
  pivot: Point2
  startAngle: number
  rotation: number
  live: LiveLayerDrag | null
  moved: boolean
}

let rotateDrag: RotateDrag | null = null

function applyRotateOption() {
  const target = targets()
  if (!target.id) return
  const rect = targetBounds(target.ids)
  if (!rect) return
  const opts = getOptions('rotate')
  const angle = clamp(Number(opts.angle ?? 0), -180, 180)
  if (Math.abs(angle) < 0.01) return
  const pivot = pivotFor(rect, opts)
  commitAffine(target.ids, target.id, { sx: 1, sy: 1, rotation: angle * RAD, ax: pivot.x, ay: pivot.y })
}

export const rotateTool: Tool = {
  id: 'rotate',
  requiresLayer: true,
  cursor: 'crosshair',

  onPointerDown(p) {
    if (p.button !== 0) return
    const target = targets()
    if (!target.id) return
    const rect = targetBounds(target.ids)
    if (!rect) return
    const pivot = pivotFor(rect, getOptions('rotate'))
    const live = target.ids.length === 1 ? beginLive(target.id, pivot) : null
    rotateDrag = {
      ids: target.ids,
      id: target.id,
      rect,
      pivot,
      startAngle: Math.atan2(p.docY - pivot.y, p.docX - pivot.x),
      rotation: 0,
      live,
      moved: false,
    }
    engine.requestRender()
  },

  onPointerMove(p) {
    const d = rotateDrag
    if (!d) return
    const angle = Math.atan2(p.docY - d.pivot.y, p.docX - d.pivot.x)
    let delta = normalizeAngle(angle - d.startAngle)
    if (p.shift) delta = Math.round(delta / (15 * RAD)) * 15 * RAD
    d.rotation = delta
    d.moved = Math.abs(delta) > 0.001
    setLive(d.live, { rotation: delta })
  },

  onPointerUp() {
    const d = rotateDrag
    if (!d) return
    rotateDrag = null
    clearLive()
    if (d.moved) {
      commitAffine(d.ids, d.id, { sx: 1, sy: 1, rotation: d.rotation, ax: d.pivot.x, ay: d.pivot.y })
    }
  },

  onDoubleClick() {
    applyRotateOption()
  },

  onKeyDown(e) {
    if (e.key === 'Escape' && rotateDrag) {
      rotateDrag = null
      clearLive()
      return true
    }
    if (e.key === 'Enter' && !rotateDrag) {
      applyRotateOption()
      return true
    }
    return false
  },

  onDeactivate() {
    rotateDrag = null
    clearLive()
  },

  renderOverlay(ctx, view, w, h) {
    const target = targets()
    if (!target.id) return
    const rect = targetBounds(target.ids)
    if (!rect) return
    const opts = getOptions('rotate')
    const pivot = rotateDrag?.pivot ?? pivotFor(rect, opts)
    const rotation = rotateDrag?.rotation ?? 0
    const corners = mapCorners(rect, { sx: 1, sy: 1, rotation, ax: pivot.x, ay: pivot.y })
    drawDualPolygon(ctx, corners, view, true, 'rgba(232,163,61,0.06)')
    drawDashedRect(ctx, rect, view, 'rgba(255,255,255,0.35)')
    const ps = screen(view, pivot)
    ctx.save()
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(ps.x, ps.y, 7, 0, Math.PI * 2); ctx.stroke()
    ctx.strokeStyle = '#e8a33d'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(ps.x, ps.y, 7, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(ps.x - 10, ps.y); ctx.lineTo(ps.x + 10, ps.y)
    ctx.moveTo(ps.x, ps.y - 10); ctx.lineTo(ps.x, ps.y + 10)
    ctx.stroke()
    ctx.restore()
    drawBadge(ctx, `${Math.round(rotation / RAD)}°  ·  drag to rotate`, ps.x + 16, ps.y - 28, w, h)
  },
}

// ============================================================
// Scale
// ============================================================

interface ScaleDrag {
  ids: string[]
  id: string
  rect: Rect
  pivot: Point2
  start: Point2
  startDist: number
  sx: number
  sy: number
  live: LiveLayerDrag | null
  moved: boolean
}

let scaleDrag: ScaleDrag | null = null

function applyScaleOption() {
  const target = targets()
  if (!target.id) return
  const rect = targetBounds(target.ids)
  if (!rect) return
  const opts = getOptions('scale')
  const sx = clamp(Number(opts.width ?? 100), 0.01, 1000) / 100
  const sy = clamp(Number(opts.height ?? 100), 0.01, 1000) / 100
  if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return
  const pivot = pivotFor(rect, opts)
  commitAffine(target.ids, target.id, { sx, sy, rotation: 0, ax: pivot.x, ay: pivot.y })
}

export const scaleTool: Tool = {
  id: 'scale',
  requiresLayer: true,
  cursor: 'crosshair',

  onPointerDown(p) {
    if (p.button !== 0) return
    const target = targets()
    if (!target.id) return
    const rect = targetBounds(target.ids)
    if (!rect) return
    const pivot = pivotFor(rect, getOptions('scale'))
    const start = { x: p.docX, y: p.docY }
    const startDist = Math.max(4, Math.hypot(start.x - pivot.x, start.y - pivot.y))
    scaleDrag = {
      ids: target.ids,
      id: target.id,
      rect,
      pivot,
      start,
      startDist,
      sx: 1,
      sy: 1,
      live: target.ids.length === 1 ? beginLive(target.id, pivot) : null,
      moved: false,
    }
    engine.requestRender()
  },

  onPointerMove(p) {
    const d = scaleDrag
    if (!d) return
    const opts = getOptions('scale')
    const dx = p.docX - d.pivot.x
    const dy = p.docY - d.pivot.y
    const baseX = d.start.x - d.pivot.x
    const baseY = d.start.y - d.pivot.y
    // Guard the axis the user clicked almost exactly on: dividing by a
    // near-zero offset would otherwise explode that axis immediately.
    let sx = Math.abs(baseX) > 1 ? dx / baseX : 1
    let sy = Math.abs(baseY) > 1 ? dy / baseY : 1
    const linked = opts.link !== false
    const uniform = p.shift ? !linked : linked
    if (uniform) {
      const dist = Math.hypot(dx, dy)
      const dot = dx * baseX + dy * baseY
      let s = dist / d.startDist
      if (dot < 0) s = -s
      sx = s
      sy = s
    }
    const clampScale = (v: number) => {
      const sign = v < 0 ? -1 : 1
      return sign * clamp(Math.abs(v), 0.02, 64)
    }
    d.sx = clampScale(sx)
    d.sy = clampScale(sy)
    d.moved = Math.abs(d.sx - 1) > 0.001 || Math.abs(d.sy - 1) > 0.001
    setLive(d.live, { sx: d.sx, sy: d.sy, rotation: 0 })
  },

  onPointerUp() {
    const d = scaleDrag
    if (!d) return
    scaleDrag = null
    clearLive()
    if (d.moved) commitAffine(d.ids, d.id, { sx: d.sx, sy: d.sy, rotation: 0, ax: d.pivot.x, ay: d.pivot.y })
  },

  onDoubleClick() {
    applyScaleOption()
  },

  onKeyDown(e) {
    if (e.key === 'Escape' && scaleDrag) {
      scaleDrag = null
      clearLive()
      return true
    }
    if (e.key === 'Enter' && !scaleDrag) {
      applyScaleOption()
      return true
    }
    return false
  },

  onDeactivate() {
    scaleDrag = null
    clearLive()
  },

  renderOverlay(ctx, view, w, h) {
    const target = targets()
    if (!target.id) return
    const rect = targetBounds(target.ids)
    if (!rect) return
    const opts = getOptions('scale')
    const pivot = scaleDrag?.pivot ?? pivotFor(rect, opts)
    const sx = scaleDrag?.sx ?? 1
    const sy = scaleDrag?.sy ?? 1
    const corners = mapCorners(rect, { sx, sy, rotation: 0, ax: pivot.x, ay: pivot.y })
    drawDualPolygon(ctx, corners, view, true, 'rgba(232,163,61,0.06)')
    drawDashedRect(ctx, rect, view, 'rgba(255,255,255,0.35)')
    const ps = screen(view, pivot)
    ctx.save()
    ctx.fillStyle = '#e8a33d'
    ctx.strokeStyle = 'rgba(15,15,17,0.9)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(ps.x, ps.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.restore()
    drawBadge(ctx, `${Math.round(sx * 100)}% × ${Math.round(sy * 100)}%  ·  drag to scale`, ps.x + 16, ps.y - 28, w, h)
  },
}

// ============================================================
// Shear
// ============================================================

interface ShearDrag {
  ids: string[]
  id: string
  rect: Rect
  pivot: Point2
  start: Point2
  shearX: number
  shearY: number
  live: LiveLayerDrag | null
  moved: boolean
}

let shearDrag: ShearDrag | null = null

function applyShearOption() {
  const target = targets()
  if (!target.id) return
  const rect = targetBounds(target.ids)
  if (!rect) return
  const opts = getOptions('shear')
  const ax = clamp(Number(opts.angleX ?? 0), -80, 80)
  const ay = clamp(Number(opts.angleY ?? 0), -80, 80)
  if (Math.abs(ax) < 0.01 && Math.abs(ay) < 0.01) return
  commitSkew(target.ids, target.id, pivotFor(rect, opts), Math.tan(ax * RAD), Math.tan(ay * RAD))
}

export const shearTool: Tool = {
  id: 'shear',
  requiresLayer: true,
  cursor: 'crosshair',

  onPointerDown(p) {
    if (p.button !== 0) return
    const target = targets()
    if (!target.id) return
    const rect = targetBounds(target.ids)
    if (!rect) return
    const pivot = pivotFor(rect, getOptions('shear'))
    shearDrag = {
      ids: target.ids,
      id: target.id,
      rect,
      pivot,
      start: { x: p.docX, y: p.docY },
      shearX: 0,
      shearY: 0,
      live: target.ids.length === 1 ? beginLive(target.id, pivot) : null,
      moved: false,
    }
    engine.requestRender()
  },

  onPointerMove(p) {
    const d = shearDrag
    if (!d) return
    const dx = p.docX - d.start.x
    const dy = p.docY - d.start.y
    let shearX = clamp(dx / Math.max(1, d.rect.h * 0.5), -4, 4)
    let shearY = clamp(dy / Math.max(1, d.rect.w * 0.5), -4, 4)
    if (p.shift) {
      if (Math.abs(dx) >= Math.abs(dy)) shearY = 0
      else shearX = 0
    }
    d.shearX = shearX
    d.shearY = shearY
    d.moved = Math.abs(shearX) > 0.001 || Math.abs(shearY) > 0.001
    setLive(d.live, { shearX, shearY, sx: 1, sy: 1, rotation: 0 })
  },

  onPointerUp() {
    const d = shearDrag
    if (!d) return
    shearDrag = null
    clearLive()
    if (d.moved) commitSkew(d.ids, d.id, d.pivot, d.shearX, d.shearY)
  },

  onDoubleClick() {
    applyShearOption()
  },

  onKeyDown(e) {
    if (e.key === 'Escape' && shearDrag) {
      shearDrag = null
      clearLive()
      return true
    }
    if (e.key === 'Enter' && !shearDrag) {
      applyShearOption()
      return true
    }
    return false
  },

  onDeactivate() {
    shearDrag = null
    clearLive()
  },

  renderOverlay(ctx, view, w, h) {
    const target = targets()
    if (!target.id) return
    const rect = targetBounds(target.ids)
    if (!rect) return
    const pivot = shearDrag?.pivot ?? pivotFor(rect, getOptions('shear'))
    const shearX = shearDrag?.shearX ?? 0
    const shearY = shearDrag?.shearY ?? 0
    const corners = mapCorners(rect, { sx: 1, sy: 1, rotation: 0, ax: pivot.x, ay: pivot.y, shearX, shearY })
    drawDualPolygon(ctx, corners, view, true, 'rgba(232,163,61,0.06)')
    drawDashedRect(ctx, rect, view, 'rgba(255,255,255,0.35)')
    const degX = Math.atan(shearX) / RAD
    const degY = Math.atan(shearY) / RAD
    drawBadge(ctx, `shear ${Math.round(degX)}° / ${Math.round(degY)}°  ·  drag to shear`, view.panX + rect.x * view.zoom, view.panY + rect.y * view.zoom - 24, w, h)
  },
}

// ============================================================
// Perspective (four-corner projective quad)
// ============================================================

interface PerspectiveDrag {
  id: string
  base: Point2[]
  quad: Point2[]
  index: number
  moved: boolean
}

let perspectiveDrag: PerspectiveDrag | null = null

function hitQuadCorner(quad: Point2[], p: PointerInfo, zoom: number): number {
  const tol = 12 / Math.max(0.02, zoom)
  let best = -1
  let bestD = tol
  for (let i = 0; i < quad.length; i++) {
    const d = Math.hypot(p.docX - quad[i].x, p.docY - quad[i].y)
    if (d <= bestD) { best = i; bestD = d }
  }
  return best
}

function commitPerspective(d: PerspectiveDrag): boolean {
  const layer = engine.layerById(d.id)
  if (!layer || layer.locked || layer.kind === 'adjustment') {
    toast('The transformed layer is no longer available', 'error')
    return false
  }
  return commitQuad(d.id, d.base, d.quad)
}

export const perspectiveTool: Tool = {
  id: 'perspective',
  requiresLayer: true,
  cursor: 'crosshair',

  onPointerDown(p) {
    if (p.button !== 0) return
    const target = targets()
    if (!target.id) return
    if (target.ids.length > 1) {
      toast('Perspective transform is a single-layer operation', 'info')
      return
    }
    const doc = engine.activeDoc
    if (!doc) return
    if (!perspectiveDrag || perspectiveDrag.id !== target.id) {
      const base = engine.layerTransformQuad(target.id)
      if (!base) return
      perspectiveDrag = { id: target.id, base: base.map(q => ({ ...q })), quad: base.map(q => ({ ...q })), index: -1, moved: false }
    }
    const d = perspectiveDrag
    d.index = hitQuadCorner(d.quad, p, doc.view.zoom)
    engine.pokeOverlay()
  },

  onPointerMove(p) {
    const d = perspectiveDrag
    if (!d || d.index < 0) return
    const next = d.quad.map(q => ({ ...q }))
    next[d.index] = { x: p.docX, y: p.docY }
    if (isValidPerspectiveQuad(next)) {
      d.quad = next
      d.moved = true
      engine.pokeOverlay()
    }
  },

  onPointerUp() {
    const d = perspectiveDrag
    if (!d) return
    if (d.index >= 0 && d.moved) {
      const committed = commitPerspective(d)
      if (committed) perspectiveDrag = null
    }
    if (d) d.index = -1
    engine.pokeOverlay()
  },

  onDoubleClick() {
    perspectiveDrag = null
    engine.pokeOverlay()
  },

  onKeyDown(e) {
    if (e.key === 'Escape' && perspectiveDrag) {
      perspectiveDrag = null
      engine.pokeOverlay()
      return true
    }
    if (e.key === 'Enter' && perspectiveDrag) {
      if (perspectiveDrag.moved) {
        const committed = commitPerspective(perspectiveDrag)
        if (committed) perspectiveDrag = null
      } else {
        perspectiveDrag = null
      }
      engine.pokeOverlay()
      return true
    }
    return false
  },

  onDeactivate() {
    perspectiveDrag = null
  },

  renderOverlay(ctx, view, w, h) {
    const target = targets()
    if (!target.id) return
    const d = perspectiveDrag
    const base = d?.base ?? engine.layerTransformQuad(target.id)
    if (!base) return
    const quad = d?.quad ?? base
    drawDashedRect(ctx, engine.layerContentRect(target.id) ?? { x: 0, y: 0, w: 0, h: 0 }, view, 'rgba(255,255,255,0.25)')
    drawDualPolygon(ctx, quad, view, true, 'rgba(232,163,61,0.06)')
    // 3×3 guide grid through the projective quad.
    ctx.save()
    ctx.strokeStyle = 'rgba(232,163,61,0.45)'
    ctx.lineWidth = 1
    const hom = homography(UNIT_QUAD, quad)
    if (hom) {
      for (let i = 1; i < 3; i++) {
        const t = i / 3
        const a = projectPoint(hom, { x: t, y: 0 }), b = projectPoint(hom, { x: t, y: 1 })
        const c = projectPoint(hom, { x: 0, y: t }), e = projectPoint(hom, { x: 1, y: t })
        const sa = screen(view, a), sb = screen(view, b), sc = screen(view, c), se = screen(view, e)
        ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(sc.x, sc.y); ctx.lineTo(se.x, se.y); ctx.stroke()
      }
    }
    ctx.restore()
    quad.forEach((p, i) => drawHandle(ctx, screen(view, p), d?.index === i))
    drawBadge(ctx, 'Drag corners · release applies · Esc cancels', view.panX + quad[0].x * view.zoom, view.panY + quad[0].y * view.zoom - 24, w, h)
  },
}

// ============================================================
// Unified Transform (move / scale / rotate box)
// ============================================================

type UnifiedHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'

interface UnifiedDrag {
  ids: string[]
  id: string
  rect: Rect
  pivot: Point2
  anchor: Point2
  handle: UnifiedHandle
  mode: 'scale' | 'rotate' | 'move'
  start: Point2
  startAngle: number
  startVec: Point2
  sx: number
  sy: number
  rotation: number
  dx: number
  dy: number
  live: LiveLayerDrag | null
  moved: boolean
}

let unifiedDrag: UnifiedDrag | null = null

function unifiedHandles(rect: Rect): { id: UnifiedHandle; p: Point2 }[] {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  return [
    { id: 'nw', p: { x: rect.x, y: rect.y } },
    { id: 'n', p: { x: cx, y: rect.y } },
    { id: 'ne', p: { x: rect.x + rect.w, y: rect.y } },
    { id: 'e', p: { x: rect.x + rect.w, y: cy } },
    { id: 'se', p: { x: rect.x + rect.w, y: rect.y + rect.h } },
    { id: 's', p: { x: cx, y: rect.y + rect.h } },
    { id: 'sw', p: { x: rect.x, y: rect.y + rect.h } },
    { id: 'w', p: { x: rect.x, y: cy } },
  ]
}

function hitUnifiedHandle(rect: Rect, p: PointerInfo, zoom: number): { id: UnifiedHandle; p: Point2 } | null {
  const tol = 11 / Math.max(0.02, zoom)
  let best: { id: UnifiedHandle; p: Point2 } | null = null
  let bestD = tol
  for (const h of unifiedHandles(rect)) {
    const d = Math.hypot(p.docX - h.p.x, p.docY - h.p.y)
    if (d <= bestD) { best = h; bestD = d }
  }
  return best
}

function oppositeHandle(id: UnifiedHandle): UnifiedHandle {
  const map: Record<UnifiedHandle, UnifiedHandle> = {
    nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e', rotate: 'rotate',
  }
  return map[id]
}

function applyUnifiedOptions() {
  const target = targets()
  if (!target.id) return
  if (target.ids.length > 1) {
    toast('Unified Transform options apply to a single layer', 'info')
    return
  }
  const rect = targetBounds(target.ids)
  const base = engine.layerTransformQuad(target.id)
  if (!rect || !base) return
  const opts = getOptions('unified-transform')
  const mode = String(opts.transform ?? 'combined')
  const cx = rect.x + rect.w * clamp(Number(opts.centerX ?? 50), 0, 100) / 100
  const cy = rect.y + rect.h * clamp(Number(opts.centerY ?? 50), 0, 100) / 100
  let sx = clamp(Number(opts.scaleX ?? 100), 0.01, 1000) / 100
  let sy = clamp(Number(opts.scaleY ?? 100), 0.01, 1000) / 100
  let shearX = Math.tan(clamp(Number(opts.shearX ?? 0), -80, 80) * RAD)
  let shearY = Math.tan(clamp(Number(opts.shearY ?? 0), -80, 80) * RAD)
  let rot = clamp(Number(opts.angle ?? 0), -180, 180) * RAD
  let px = clamp(Number(opts.perspectiveX ?? 0), -100, 100) / 200 * rect.w
  let py = clamp(Number(opts.perspectiveY ?? 0), -100, 100) / 200 * rect.h
  if (mode === 'scale') {
    shearX = 0; shearY = 0; rot = 0; px = 0; py = 0
  } else if (mode === 'rotate') {
    sx = 1; sy = 1; shearX = 0; shearY = 0; px = 0; py = 0
  } else if (mode === 'shear') {
    sx = 1; sy = 1; rot = 0; px = 0; py = 0
  } else if (mode === 'perspective') {
    sx = 1; sy = 1; shearX = 0; shearY = 0; rot = 0
  }
  if (sx === 1 && sy === 1 && shearX === 0 && shearY === 0 && rot === 0 && px === 0 && py === 0) return
  // Simple scale/rotate stays on the affine path so text and shape layers
  // remain editable; only shear/perspective need the projective quad.
  if (shearX === 0 && shearY === 0 && px === 0 && py === 0) {
    commitAffine([target.id], target.id, { sx, sy, rotation: rot, ax: cx, ay: cy })
    return
  }
  const cos = Math.cos(rot), sin = Math.sin(rot)
  const dest = base.map((p, i) => {
    const ox = p.x - cx
    const oy = p.y - cy
    const ax = (ox + oy * shearX) * sx
    const ay = (oy + ox * shearY) * sy
    let x = cx + ax * cos - ay * sin
    let y = cy + ax * sin + ay * cos
    // Perspective narrowing: TL/BR move one way, TR/BL the other.
    if (i === 0 || i === 3) x += px
    if (i === 1 || i === 2) x -= px
    if (i === 0 || i === 1) y += py
    if (i === 2 || i === 3) y -= py
    return { x, y }
  })
  commitQuad(target.id, base, dest)
}

export const unifiedTransformTool: Tool = {
  id: 'unified-transform',
  requiresLayer: true,
  cursor: 'crosshair',

  onPointerDown(p) {
    if (p.button !== 0) return
    const target = targets()
    if (!target.id) return
    const rect = targetBounds(target.ids)
    if (!rect) return
    const doc = engine.activeDoc
    if (!doc) return
    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
    const rotateAnchor = { x: center.x, y: rect.y - 28 / Math.max(0.02, doc.view.zoom) }
    const hitRotate = Math.hypot(p.docX - rotateAnchor.x, p.docY - rotateAnchor.y) <= 12 / Math.max(0.02, doc.view.zoom)
    const hit = hitUnifiedHandle(rect, p, doc.view.zoom)

    if (hitRotate) {
      const live = target.ids.length === 1 ? beginLive(target.id, center, true) : null
      unifiedDrag = {
        ids: target.ids, id: target.id, rect, pivot: center, anchor: center,
        handle: 'rotate', mode: 'rotate', start: { x: p.docX, y: p.docY },
        startAngle: Math.atan2(p.docY - center.y, p.docX - center.x),
        startVec: { x: p.docX - center.x, y: p.docY - center.y },
        sx: 1, sy: 1, rotation: 0, dx: 0, dy: 0, live, moved: false,
      }
      engine.requestRender()
      return
    }

    if (hit) {
      const anchor = p.alt ? center : (unifiedHandles(rect).find(h => h.id === oppositeHandle(hit.id))?.p ?? center)
      const live = target.ids.length === 1 ? beginLive(target.id, anchor, true) : null
      unifiedDrag = {
        ids: target.ids, id: target.id, rect, pivot: center, anchor,
        handle: hit.id, mode: 'scale', start: { x: p.docX, y: p.docY },
        startAngle: 0, startVec: { x: hit.p.x - anchor.x, y: hit.p.y - anchor.y },
        sx: 1, sy: 1, rotation: 0, dx: 0, dy: 0, live, moved: false,
      }
      engine.requestRender()
      return
    }

    if (pointInRect({ x: p.docX, y: p.docY }, rect)) {
      const live = target.ids.length === 1 ? beginLive(target.id, center, false) : null
      unifiedDrag = {
        ids: target.ids, id: target.id, rect, pivot: center, anchor: center,
        handle: 'n', mode: 'move', start: { x: p.docX, y: p.docY },
        startAngle: 0, startVec: { x: 0, y: 0 },
        sx: 1, sy: 1, rotation: 0, dx: 0, dy: 0, live, moved: false,
      }
      engine.requestRender()
      return
    }

    // Outside the box: rotate around the center.
    const live = target.ids.length === 1 ? beginLive(target.id, center, true) : null
    unifiedDrag = {
      ids: target.ids, id: target.id, rect, pivot: center, anchor: center,
      handle: 'rotate', mode: 'rotate', start: { x: p.docX, y: p.docY },
      startAngle: Math.atan2(p.docY - center.y, p.docX - center.x),
      startVec: { x: p.docX - center.x, y: p.docY - center.y },
      sx: 1, sy: 1, rotation: 0, dx: 0, dy: 0, live, moved: false,
    }
    engine.requestRender()
  },

  onPointerMove(p) {
    const d = unifiedDrag
    if (!d) return
    if (d.mode === 'move') {
      let dx = Math.round(p.docX - d.start.x)
      let dy = Math.round(p.docY - d.start.y)
      if (p.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0
        else dx = 0
      }
      d.dx = dx
      d.dy = dy
      d.moved = dx !== 0 || dy !== 0
      if (d.live) {
        d.live.dx = dx
        d.live.dy = dy
        engine.requestRender()
      }
      return
    }

    if (d.mode === 'rotate') {
      const angle = Math.atan2(p.docY - d.pivot.y, p.docX - d.pivot.x)
      let delta = normalizeAngle(angle - d.startAngle)
      if (p.shift) delta = Math.round(delta / (15 * RAD)) * 15 * RAD
      d.rotation = delta
      d.moved = Math.abs(delta) > 0.001
      setLive(d.live, { rotation: delta, sx: 1, sy: 1 })
      return
    }

    let sx = (p.docX - d.anchor.x) / (d.startVec.x || 1)
    let sy = (p.docY - d.anchor.y) / (d.startVec.y || 1)
    if (d.handle === 'n' || d.handle === 's') sx = 1
    else if (d.handle === 'e' || d.handle === 'w') sy = 1
    if (p.shift && d.handle.length === 2) {
      const vx = d.startVec.x, vy = d.startVec.y
      const len2 = vx * vx + vy * vy || 1
      const s = ((p.docX - d.anchor.x) * vx + (p.docY - d.anchor.y) * vy) / len2
      sx = s
      sy = s
    }
    const clampScale = (v: number) => {
      const sign = v < 0 ? -1 : 1
      return sign * clamp(Math.abs(v), 0.02, 64)
    }
    d.sx = clampScale(sx)
    d.sy = clampScale(sy)
    d.moved = Math.abs(d.sx - 1) > 0.001 || Math.abs(d.sy - 1) > 0.001
    setLive(d.live, { sx: d.sx, sy: d.sy, rotation: 0 })
  },

  onPointerUp() {
    const d = unifiedDrag
    if (!d) return
    unifiedDrag = null
    clearLive()
    if (!d.moved) return
    if (d.mode === 'move') {
      engine.translateLayers(d.ids, d.dx, d.dy, 'Unified Transform')
    } else if (d.mode === 'rotate') {
      commitAffine(d.ids, d.id, { sx: 1, sy: 1, rotation: d.rotation, ax: d.pivot.x, ay: d.pivot.y })
    } else {
      commitAffine(d.ids, d.id, { sx: d.sx, sy: d.sy, rotation: 0, ax: d.anchor.x, ay: d.anchor.y })
    }
  },

  onDoubleClick() {
    applyUnifiedOptions()
  },

  onKeyDown(e) {
    if (e.key === 'Escape' && unifiedDrag) {
      unifiedDrag = null
      clearLive()
      return true
    }
    if (e.key === 'Enter' && !unifiedDrag) {
      applyUnifiedOptions()
      return true
    }
    return false
  },

  onDeactivate() {
    unifiedDrag = null
    clearLive()
  },

  renderOverlay(ctx, view, w, h) {
    const target = targets()
    if (!target.id) return
    const rect = targetBounds(target.ids)
    if (!rect) return
    const d = unifiedDrag
    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
    const lt: LiveTransform = d
      ? { sx: d.sx, sy: d.sy, rotation: d.rotation, ax: d.mode === 'scale' ? d.anchor.x : center.x, ay: d.mode === 'scale' ? d.anchor.y : center.y }
      : { sx: 1, sy: 1, rotation: 0, ax: center.x, ay: center.y }
    const corners = mapCorners(rect, lt)
    drawDualPolygon(ctx, corners, view, true, 'rgba(232,163,61,0.05)')
    const scr = corners.map(p => screen(view, p))
    if (!d || d.mode !== 'scale') {
      for (const p of scr) drawHandle(ctx, p)
    }
    // Edge handles on the idle box.
    if (!d) {
      const mids: Point2[] = [
        { x: (scr[0].x + scr[1].x) / 2, y: (scr[0].y + scr[1].y) / 2 },
        { x: (scr[1].x + scr[2].x) / 2, y: (scr[1].y + scr[2].y) / 2 },
        { x: (scr[2].x + scr[3].x) / 2, y: (scr[2].y + scr[3].y) / 2 },
        { x: (scr[3].x + scr[0].x) / 2, y: (scr[3].y + scr[0].y) / 2 },
      ]
      for (const p of mids) drawHandle(ctx, p)
    }
    const topMid = { x: (scr[0].x + scr[1].x) / 2, y: (scr[0].y + scr[1].y) / 2 }
    const rotate = { x: topMid.x, y: topMid.y - 28 }
    ctx.save()
    ctx.strokeStyle = 'rgba(15,15,17,0.9)'
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(topMid.x, topMid.y); ctx.lineTo(rotate.x, rotate.y); ctx.stroke()
    ctx.strokeStyle = '#e8a33d'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(topMid.x, topMid.y); ctx.lineTo(rotate.x, rotate.y); ctx.stroke()
    ctx.beginPath(); ctx.arc(rotate.x, rotate.y, 6, 0, Math.PI * 2)
    ctx.fillStyle = d?.mode === 'rotate' ? '#e8a33d' : '#fff'
    ctx.strokeStyle = '#171719'
    ctx.fill(); ctx.stroke()
    ctx.restore()
    const pct = Math.round(Math.abs((lt.sx + lt.sy) / 2) * 100)
    const deg = Math.round(lt.rotation / RAD)
    drawBadge(ctx, `${pct}%${deg ? ` · ${deg}°` : ''}  ·  drag corners / rotate handle`, scr[0].x, scr[0].y - 24, w, h)
  },
}

// ============================================================
// Mesh tools: Handle / Cage / Warp
// ============================================================

type MeshToolId = 'handle-transform' | 'cage-transform' | 'warp-transform'

interface MeshState {
  toolId: MeshToolId
  id: string
  base: Point2[]
  u: number[]
  v: number[]
  dest: Point2[]
  drag: number | null
  moved: boolean
  locked: Set<number>
}

let meshState: MeshState | null = null

function meshGrid(toolId: MeshToolId): { cols: number; rows: number; locked: Set<number> } {
  const opts = getOptions(toolId)
  if (toolId === 'handle-transform') {
    const eight = Number(opts.handles ?? 4) >= 8
    const cols = eight ? 2 : 1
    const rows = eight ? 2 : 1
    const locked = new Set<number>()
    if (eight) locked.add(1 * (cols + 1) + 1)
    return { cols, rows, locked }
  }
  if (toolId === 'cage-transform') {
    return {
      cols: clamp(Math.round(Number(opts.cols ?? 4)), 1, 12),
      rows: clamp(Math.round(Number(opts.rows ?? 4)), 1, 12),
      locked: new Set(),
    }
  }
  const n = clamp(Math.round(Number(opts.gridSize ?? 4)), 1, 12)
  return { cols: n, rows: n, locked: new Set() }
}

function initMesh(toolId: MeshToolId, id: string): MeshState | null {
  const base = engine.layerTransformQuad(id)
  if (!base) return null
  const grid = meshGrid(toolId)
  const u = Array.from({ length: grid.cols + 1 }, (_, i) => i / grid.cols)
  const v = Array.from({ length: grid.rows + 1 }, (_, i) => i / grid.rows)
  const dest: Point2[] = []
  const h = homography(UNIT_QUAD, base)
  for (const vv of v) for (const uu of u) {
    dest.push(h ? projectPoint(h, { x: uu, y: vv }) : { x: base[0].x + (base[1].x - base[0].x) * uu, y: base[0].y + (base[3].y - base[0].y) * vv })
  }
  return { toolId, id, base: base.map(p => ({ ...p })), u, v, dest, drag: null, moved: false, locked: grid.locked }
}

function meshIndex(m: MeshState, col: number, row: number): number {
  return row * m.u.length + col
}

function commitMesh(m: MeshState): boolean {
  const layer = engine.layerById(m.id)
  if (!layer || layer.locked || layer.kind === 'adjustment') {
    toast('The transformed layer is no longer available', 'error')
    return false
  }
  return commitWarp(m.id, m.base, m.u, m.v, m.dest)
}

function makeMeshTool(toolId: MeshToolId, label: string): Tool {
  return {
    id: toolId,
    requiresLayer: true,
    cursor: 'crosshair',

    onPointerDown(p) {
      if (p.button !== 0) return
      const target = targets()
      if (!target.id) return
      if (target.ids.length > 1) {
        toast(`${label} is a single-layer operation`, 'info')
        return
      }
      const doc = engine.activeDoc
      if (!doc) return
      if (!meshState || meshState.id !== target.id || meshState.toolId !== toolId) {
        meshState = initMesh(toolId, target.id)
      }
      const m = meshState
      if (!m) return
      const tol = 12 / Math.max(0.02, doc.view.zoom)
      let best = -1
      let bestD = tol
      for (let i = 0; i < m.dest.length; i++) {
        if (m.locked.has(i)) continue
        const d = Math.hypot(p.docX - m.dest[i].x, p.docY - m.dest[i].y)
        if (d <= bestD) { best = i; bestD = d }
      }
      m.drag = best >= 0 ? best : null
      m.moved = false
      engine.pokeOverlay()
    },

    onPointerMove(p) {
      const m = meshState
      if (!m || m.drag === null) return
      const doc = engine.activeDoc
      if (!doc) return
      const limit = Math.max(doc.width, doc.height) * 2
      m.dest[m.drag] = {
        x: clamp(p.docX, -limit, doc.width + limit),
        y: clamp(p.docY, -limit, doc.height + limit),
      }
      m.moved = true
      engine.pokeOverlay()
    },

    onPointerUp() {
      const m = meshState
      if (!m) return
      const drag = m.drag
      m.drag = null
      if (drag !== null && m.moved) {
        const committed = commitMesh(m)
        if (committed) meshState = null
      }
      engine.pokeOverlay()
    },

    onDoubleClick() {
      meshState = null
      engine.pokeOverlay()
    },

    onKeyDown(e) {
      if (e.key === 'Escape' && meshState) {
        meshState = null
        engine.pokeOverlay()
        return true
      }
      if (e.key === 'Enter' && meshState) {
        const committed = commitMesh(meshState)
        if (committed) meshState = null
        engine.pokeOverlay()
        return true
      }
      return false
    },

    onDeactivate() {
      meshState = null
    },

    renderOverlay(ctx, view, w, h) {
      const target = targets()
      if (!target.id) return
      const m = meshState?.id === target.id && meshState.toolId === toolId
        ? meshState
        : null
      if (!m) {
        const rect = targetBounds(target.ids)
        if (!rect) return
        drawDashedRect(ctx, rect, view, 'rgba(255,255,255,0.35)')
        drawBadge(ctx, `${label} · click to place the mesh`, view.panX + rect.x * view.zoom, view.panY + rect.y * view.zoom - 24, w, h)
        return
      }

      const rows = m.v.length
      const cols = m.u.length
      // grid lines (horizontal + vertical)
      for (let r = 0; r < rows; r++) {
        const line: Point2[] = []
        for (let c = 0; c < cols; c++) line.push(m.dest[meshIndex(m, c, r)])
        drawDualPolygon(ctx, line, view, false)
      }
      for (let c = 0; c < cols; c++) {
        const line: Point2[] = []
        for (let r = 0; r < rows; r++) line.push(m.dest[meshIndex(m, c, r)])
        drawDualPolygon(ctx, line, view, false)
      }
      for (let i = 0; i < m.dest.length; i++) {
        drawHandle(ctx, screen(view, m.dest[i]), m.drag === i, m.locked.has(i))
      }
      const top = m.dest[0]
      drawBadge(ctx, `${label} · drag points · release applies · Esc cancels`, view.panX + top.x * view.zoom, view.panY + top.y * view.zoom - 24, w, h)
    },
  }
}

export const handleTransformTool = makeMeshTool('handle-transform', 'Handle Transform')
export const cageTransformTool = makeMeshTool('cage-transform', 'Cage Transform')
export const warpTransformTool = makeMeshTool('warp-transform', 'Warp Transform')

// ============================================================
// Alignment
// ============================================================

let alignHover: Point2 | null = null
let alignTargetId: string | null = null

function referenceRect(
  kind: string,
  targetId: string,
  point: Point2,
  activeLayerId: string | null = engine.activeDoc?.activeLayerId ?? null,
): Rect | null {
  const doc = engine.activeDoc
  if (!doc) return null
  if (kind === 'image') return { x: 0, y: 0, w: doc.width, h: doc.height }
  if (kind === 'selection') return doc.selection?.bounds ?? { x: 0, y: 0, w: doc.width, h: doc.height }
  if (kind === 'grid') {
    const gs = Math.max(1, Number(useEditorStore.getState().view.gridSize ?? 64))
    return {
      x: Math.floor(point.x / gs) * gs,
      y: Math.floor(point.y / gs) * gs,
      w: gs,
      h: gs,
    }
  }
  if (kind === 'layer' && activeLayerId && activeLayerId !== targetId) {
    return engine.layerContentRect(activeLayerId)
  }
  const selected = (doc.selectedLayerIds ?? []).find(id => id !== targetId)
  if (selected) {
    const r = engine.layerContentRect(selected)
    if (r) return r
  }
  for (const layer of doc.layers) {
    if (layer.id === targetId || !layer.visible || layer.kind === 'adjustment') continue
    const r = engine.layerContentRect(layer.id)
    if (r) return r
  }
  return { x: 0, y: 0, w: doc.width, h: doc.height }
}

interface AlignDelta {
  dx: number
  dy: number
  horizontal: 'left' | 'center' | 'right' | null
  vertical: 'top' | 'middle' | 'bottom' | null
}

function alignDelta(target: Rect, ref: Rect, point: Point2, shift: boolean, alt: boolean, offsetX: number, offsetY: number): AlignDelta {
  const rx = (point.x - target.x) / Math.max(1, target.w)
  const ry = (point.y - target.y) / Math.max(1, target.h)
  const horizontal = shift || !alt
  const vertical = alt || !shift
  let dx = 0
  let dy = 0
  let hAlign: AlignDelta['horizontal'] = null
  let vAlign: AlignDelta['vertical'] = null
  if (horizontal) {
    if (rx < 0.34) { dx = ref.x - target.x; hAlign = 'left' }
    else if (rx > 0.66) { dx = (ref.x + ref.w) - (target.x + target.w); hAlign = 'right' }
    else { dx = (ref.x + ref.w / 2) - (target.x + target.w / 2); hAlign = 'center' }
  }
  if (vertical) {
    if (ry < 0.34) { dy = ref.y - target.y; vAlign = 'top' }
    else if (ry > 0.66) { dy = (ref.y + ref.h) - (target.y + target.h); vAlign = 'bottom' }
    else { dy = (ref.y + ref.h / 2) - (target.y + target.h / 2); vAlign = 'middle' }
  }
  return { dx: dx + offsetX, dy: dy + offsetY, horizontal: hAlign, vertical: vAlign }
}

function alignAt(point: Point2, shift: boolean, alt: boolean): boolean {
  const doc = engine.activeDoc
  if (!doc) return false
  const opts = getOptions('alignment')
  const activeBefore = doc.activeLayerId
  const clickedId = pickLayerAt(point.x, point.y)
  const alignMode = String(opts.alignTo ?? 'first')
  const targetId = alignMode === 'layer' && activeBefore
    ? activeBefore
    : clickedId ?? activeBefore
  if (!targetId) return false
  const target = engine.layerContentRect(targetId)
  if (!target) return false
  const kind = String(opts.relativeTo ?? opts.alignTo ?? 'first')
  const ref = referenceRect(kind, targetId, point, activeBefore)
  if (!ref) return false
  const delta = alignDelta(
    target, ref, point, shift, alt,
    Number(opts.offsetX ?? 0), Number(opts.offsetY ?? 0),
  )
  if (Math.abs(delta.dx) < 0.01 && Math.abs(delta.dy) < 0.01) {
    toast('Already aligned', 'info')
    return false
  }
  engine.focusLayerFromContextMenu(targetId)
  engine.translateLayers([targetId], Math.round(delta.dx), Math.round(delta.dy), 'Align Layer')
  const parts = [delta.horizontal, delta.vertical].filter(Boolean).join(' + ')
  toast(`Aligned layer ${parts || 'to reference'}`, 'success')
  return true
}

export const alignmentTool: Tool = {
  id: 'alignment',
  requiresLayer: true,
  cursor: 'crosshair',

  onActivate() {
    toast('Alignment: click a layer edge to align it to the reference (Shift = horizontal, Alt = vertical)', 'info')
  },

  onPointerMove(p) {
    alignHover = { x: p.docX, y: p.docY }
    alignTargetId = pickLayerAt(p.docX, p.docY) ?? engine.activeDoc?.activeLayerId ?? null
    engine.pokeOverlay()
  },

  onPointerDown(p) {
    if (p.button !== 0) return
    alignHover = { x: p.docX, y: p.docY }
    alignAt(alignHover, p.shift, p.alt)
  },

  onDoubleClick(p) {
    alignAt({ x: p.docX, y: p.docY }, false, false)
  },

  onDeactivate() {
    alignHover = null
    alignTargetId = null
  },

  renderOverlay(ctx, view, w, h) {
    const doc = engine.activeDoc
    if (!doc) return
    const opts = getOptions('alignment')
    const targetId = String(opts.alignTo ?? 'first') === 'layer'
      ? doc.activeLayerId ?? alignTargetId
      : alignTargetId ?? doc.activeLayerId
    if (!targetId) return
    const target = engine.layerContentRect(targetId)
    if (!target) return
    drawDashedRect(ctx, target, view, 'rgba(232,163,61,0.9)')
    const point = alignHover
    if (!point) return
    const ref = referenceRect(
      String(opts.relativeTo ?? opts.alignTo ?? 'first'),
      targetId,
      point,
      doc.activeLayerId,
    )
    if (ref) drawDashedRect(ctx, ref, view, 'rgba(96,205,255,0.8)')
    const delta = ref ? alignDelta(target, ref, point, false, false, Number(opts.offsetX ?? 0), Number(opts.offsetY ?? 0)) : null
    const sp = screen(view, point)
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(sp.x - 9, sp.y); ctx.lineTo(sp.x + 9, sp.y)
    ctx.moveTo(sp.x, sp.y - 9); ctx.lineTo(sp.x, sp.y + 9)
    ctx.stroke()
    ctx.restore()
    const action = delta
      ? [delta.horizontal, delta.vertical].filter(Boolean).join(' + ') || 'aligned'
      : 'click to align'
    drawBadge(ctx, `Align ${action}  ·  Shift H / Alt V`, sp.x + 14, sp.y - 28, w, h)
  },
}

// ============================================================
// Flip
// ============================================================

let flipHover: Point2 | null = null

function applyFlip(point: Point2 | null, toggleAxis: boolean) {
  const target = targets()
  if (!target.id) return
  const rect = targetBounds(target.ids)
  if (!rect) return
  const opts = getOptions('flip')
  let direction = String(opts.direction ?? 'horizontal')
  if (toggleAxis) {
    direction = direction === 'horizontal' ? 'vertical' : 'horizontal'
    useEditorStore.getState().setToolOption('flip', 'direction', direction)
  }
  const pivot = point && pointInRect(point, rect, 0)
    ? point
    : {
        x: rect.x + rect.w * clamp(Number(opts.centerX ?? 50), 0, 100) / 100,
        y: rect.y + rect.h * clamp(Number(opts.centerY ?? 50), 0, 100) / 100,
      }
  const spec = {
    sx: direction === 'horizontal' ? -1 : 1,
    sy: direction === 'vertical' ? -1 : 1,
    rotation: 0,
    ax: pivot.x,
    ay: pivot.y,
  }
  if (target.ids.length > 1) {
    // Apply every member silently, then capture one history state for the
    // whole group so undo restores all flipped layers together.
    for (const id of target.ids) {
      engine.directTransformLayer(id, spec, { skipHistory: true, silent: true })
    }
    engine.pushHistory('Flip Layers')
    engine.emit()
  } else {
    engine.directTransformLayer(target.ids[0], spec, { silent: true })
  }
  toast(`Flipped ${direction}`, 'success')
}

export const flipTool: Tool = {
  id: 'flip',
  requiresLayer: true,
  cursor: 'crosshair',

  onActivate() {
    toast('Flip: click to flip around the pointer. Shift toggles horizontal/vertical.', 'info')
  },

  onPointerMove(p) {
    flipHover = { x: p.docX, y: p.docY }
    engine.pokeOverlay()
  },

  onPointerDown(p) {
    if (p.button !== 0) return
    flipHover = { x: p.docX, y: p.docY }
    applyFlip(flipHover, p.shift)
  },

  onDoubleClick() {
    applyFlip(null, false)
  },

  onDeactivate() {
    flipHover = null
  },

  renderOverlay(ctx, view, w, h) {
    const target = targets()
    if (!target.id) return
    const rect = targetBounds(target.ids)
    if (!rect) return
    const opts = getOptions('flip')
    const direction = String(opts.direction ?? 'horizontal')
    const point = flipHover
    const pivot = point && pointInRect(point, rect, 0)
      ? point
      : {
          x: rect.x + rect.w * clamp(Number(opts.centerX ?? 50), 0, 100) / 100,
          y: rect.y + rect.h * clamp(Number(opts.centerY ?? 50), 0, 100) / 100,
        }
    const sp = screen(view, pivot)
    ctx.save()
    ctx.strokeStyle = 'rgba(232,163,61,0.95)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    if (direction === 'horizontal') {
      ctx.beginPath(); ctx.moveTo(sp.x, 0); ctx.lineTo(sp.x, h); ctx.stroke()
    } else {
      ctx.beginPath(); ctx.moveTo(0, sp.y); ctx.lineTo(w, sp.y); ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.fillStyle = '#e8a33d'
    ctx.strokeStyle = '#171719'
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.restore()
    drawDashedRect(ctx, rect, view, 'rgba(255,255,255,0.45)')
    drawBadge(ctx, `Flip ${direction}  ·  Shift toggles axis`, sp.x + 14, sp.y - 28, w, h)
  },
}
