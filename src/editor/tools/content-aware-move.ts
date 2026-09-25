// ============================================================
// Content-Aware Move — lasso a subject, then move/extend it while locally
// synthesizing the vacated source and adapting the moved patch to its target.
//
// This is fully local and reuses the editor's inpaint + frequency-heal engines.
// Sample All Layers is sampling-only: only the active layer is ever modified.
// ============================================================
import type { Tool, PointerInfo, Rect } from '../types'
import { engine } from '../engine/engine'
import { getOptions, drawCross } from './shared'
import {
  createCanvas, ctx2d, cloneCanvas, getImageData, putImageData, clamp,
  clampRectToSize, cropCanvasRegion, inflateRect, unionRect,
} from '../utils/canvas'
import { getFlatComposite, invalidateFlat, newLayer } from '../engine/document'
import { gaussianBlurChannel } from '../image-ops/core'
import { frequencyHeal } from './dab-utils'
import * as imageOps from '../image-ops'

type Phase = 'idle' | 'defining' | 'moving' | 'transforming'
type TransformHandle = 'move' | 'rotate' | 'nw' | 'ne' | 'se' | 'sw'
interface TransformState { sx: number; sy: number; rotation: number }
interface TransformDrag {
  kind: TransformHandle
  startX: number
  startY: number
  startDeltaX: number
  startDeltaY: number
  startRotation: number
  startAngle: number
}

let phase: Phase = 'idle'
let points: { x: number; y: number }[] = []
let samplingMul = 1
const MAX_CONTENT_AWARE_POINTS = 8192
let path: Path2D | null = null
let mask: HTMLCanvasElement | null = null
let bounds: Rect | null = null
let moveStart: { x: number; y: number } | null = null
let delta = { x: 0, y: 0 }
let transform: TransformState = { sx: 1, sy: 1, rotation: 0 }
let transformDrag: TransformDrag | null = null
let committing = false
let previewSource: HTMLCanvasElement | null = null

function reset() {
  phase = 'idle'
  points = []
  samplingMul = 1
  path = null
  mask = null
  bounds = null
  moveStart = null
  delta = { x: 0, y: 0 }
  transform = { sx: 1, sy: 1, rotation: 0 }
  transformDrag = null
  committing = false
  previewSource = null
  engine.pokeOverlay()
}

function polygonPath(pts: { x: number; y: number }[]) {
  const p = new Path2D()
  p.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y)
  p.closePath()
  return p
}

function clampRect(r: Rect, w: number, h: number): Rect {
  const x0 = clamp(Math.floor(r.x), 0, w)
  const y0 = clamp(Math.floor(r.y), 0, h)
  const x1 = clamp(Math.ceil(r.x + r.w), 0, w)
  const y1 = clamp(Math.ceil(r.y + r.h), 0, h)
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

function sourceCenter() {
  if (!bounds) return { x: 0, y: 0 }
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
}

function destinationCenter(dx = delta.x, dy = delta.y) {
  const c = sourceCenter()
  return { x: c.x + dx, y: c.y + dy }
}

function transformPoint(
  x: number,
  y: number,
  dx = delta.x,
  dy = delta.y,
  t: TransformState = transform,
) {
  const sc = sourceCenter()
  const dc = { x: sc.x + dx, y: sc.y + dy }
  const ux = (x - sc.x) * t.sx
  const uy = (y - sc.y) * t.sy
  const cos = Math.cos(t.rotation), sin = Math.sin(t.rotation)
  return {
    x: dc.x + ux * cos - uy * sin,
    y: dc.y + ux * sin + uy * cos,
  }
}

function transformedCorners(
  dx = delta.x,
  dy = delta.y,
  t: TransformState = transform,
) {
  if (!bounds) return [] as { x: number; y: number; id: 'nw' | 'ne' | 'se' | 'sw' }[]
  return [
    { ...transformPoint(bounds.x, bounds.y, dx, dy, t), id: 'nw' as const },
    { ...transformPoint(bounds.x + bounds.w, bounds.y, dx, dy, t), id: 'ne' as const },
    { ...transformPoint(bounds.x + bounds.w, bounds.y + bounds.h, dx, dy, t), id: 'se' as const },
    { ...transformPoint(bounds.x, bounds.y + bounds.h, dx, dy, t), id: 'sw' as const },
  ]
}

function transformedBounds(
  dx = delta.x,
  dy = delta.y,
  t: TransformState = transform,
): Rect {
  const corners = transformedCorners(dx, dy, t)
  if (!corners.length) return { x: 0, y: 0, w: 0, h: 0 }
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y)
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const y0 = Math.min(...ys), y1 = Math.max(...ys)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function inverseTransformPoint(x: number, y: number) {
  if (!bounds) return { x: 0, y: 0 }
  const dc = destinationCenter()
  const dx = x - dc.x, dy = y - dc.y
  const cos = Math.cos(-transform.rotation), sin = Math.sin(-transform.rotation)
  const rx = dx * cos - dy * sin
  const ry = dx * sin + dy * cos
  return {
    x: rx / Math.max(.0001, transform.sx),
    y: ry / Math.max(.0001, transform.sy),
  }
}

function rotationHandlePoint(zoom = 1) {
  if (!bounds) return { x: 0, y: 0 }
  const top = transformPoint(bounds.x + bounds.w / 2, bounds.y)
  const center = destinationCenter()
  let vx = top.x - center.x, vy = top.y - center.y
  const len = Math.hypot(vx, vy) || 1
  vx /= len; vy /= len
  const distance = 26 / Math.max(.02, zoom)
  return { x: top.x + vx * distance, y: top.y + vy * distance }
}

function transformHandleAt(p: PointerInfo): TransformHandle | null {
  if (!bounds) return null
  const zoom = Math.max(engine.activeDoc?.view.zoom ?? 1, .02)
  const hit = 9 / zoom
  const rotate = rotationHandlePoint(zoom)
  if (Math.hypot(p.docX - rotate.x, p.docY - rotate.y) <= hit) return 'rotate'

  for (const corner of transformedCorners()) {
    if (Math.hypot(p.docX - corner.x, p.docY - corner.y) <= hit) return corner.id
  }

  const local = inverseTransformPoint(p.docX, p.docY)
  if (Math.abs(local.x) <= bounds.w / 2 && Math.abs(local.y) <= bounds.h / 2) return 'move'
  return null
}

function beginTransformDrag(p: PointerInfo): boolean {
  const handle = transformHandleAt(p)
  if (!handle) return false
  const center = destinationCenter()
  transformDrag = {
    kind: handle,
    startX: p.docX,
    startY: p.docY,
    startDeltaX: delta.x,
    startDeltaY: delta.y,
    startRotation: transform.rotation,
    startAngle: Math.atan2(p.docY - center.y, p.docX - center.x),
  }
  return true
}

function updateTransformDrag(p: PointerInfo) {
  if (!bounds || !transformDrag) return
  const drag = transformDrag
  if (drag.kind === 'move') {
    delta = {
      x: drag.startDeltaX + p.docX - drag.startX,
      y: drag.startDeltaY + p.docY - drag.startY,
    }
    return
  }

  const center = destinationCenter()
  if (drag.kind === 'rotate') {
    const angle = Math.atan2(p.docY - center.y, p.docX - center.x)
    let rotation = drag.startRotation + angle - drag.startAngle
    if (p.shift) {
      const step = Math.PI / 12
      rotation = Math.round(rotation / step) * step
    }
    transform = { ...transform, rotation }
    return
  }

  // Corner handles scale around the destination center. Pointer movement is
  // measured in the subject's unrotated axes; Shift constrains proportions.
  const dx = p.docX - center.x, dy = p.docY - center.y
  const cos = Math.cos(-transform.rotation), sin = Math.sin(-transform.rotation)
  const rx = dx * cos - dy * sin
  const ry = dx * sin + dy * cos
  let sx = Math.max(.05, Math.abs(rx) / Math.max(.5, bounds.w / 2))
  let sy = Math.max(.05, Math.abs(ry) / Math.max(.5, bounds.h / 2))
  if (p.shift) {
    const s = Math.max(sx, sy)
    sx = s; sy = s
  }
  transform = { ...transform, sx: Math.min(20, sx), sy: Math.min(20, sy) }
}

function enterTransformStage() {
  phase = 'transforming'
  transform = { sx: 1, sy: 1, rotation: 0 }
  transformDrag = null
  engine.ui?.toast('Transform On Drop: drag inside to move, corners to scale, circle to rotate. Enter applies; Escape cancels.', 'info')
  engine.pokeOverlay()
}

function finalizeLasso() {
  const doc = engine.activeDoc
  if (!doc || points.length < 3) { reset(); return }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of points) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y)
  }
  bounds = clampRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, doc.width, doc.height)
  if (bounds.w < 3 || bounds.h < 3) { reset(); return }

  path = polygonPath(points)
  const m = createCanvas(doc.width, doc.height)
  const mc = ctx2d(m)
  mc.fillStyle = '#fff'
  mc.fill(path)

  // Small AA feather; only the padded lasso rectangle needs processing.
  const pad = 4
  const ax = Math.max(0, bounds.x - pad)
  const ay = Math.max(0, bounds.y - pad)
  const ax1 = Math.min(doc.width, bounds.x + bounds.w + pad)
  const ay1 = Math.min(doc.height, bounds.y + bounds.h + pad)
  const aw = Math.max(1, ax1 - ax), ah = Math.max(1, ay1 - ay)
  const md = mc.getImageData(ax, ay, aw, ah)
  const alpha = new Float32Array(aw * ah)
  for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = md.data[j]
  const aa = gaussianBlurChannel(alpha, aw, ah, .65)
  for (let i = 0, j = 3; i < aa.length; i++, j += 4) md.data[j] = aa[i]
  mc.putImageData(md, ax, ay)
  mask = m
  phase = 'moving'
  const active = engine.activeLayer
  previewSource = getOptions('content-aware-move').sampleAllLayers === true
    ? getFlatComposite(doc)
    : active ? engine.layerCanvasDocSpace(active.id) : null
  moveStart = null
  delta = { x: 0, y: 0 }
  transform = { sx: 1, sy: 1, rotation: 0 }
  transformDrag = null
  engine.ui?.toast('Drag the selected subject to its new location', 'info')
  engine.pokeOverlay()
}

function maskAlpha(m: HTMLCanvasElement): Uint8ClampedArray {
  const d = getImageData(m).data
  const out = new Uint8ClampedArray(m.width * m.height)
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = d[j]
  return out
}

function transformedSoftMaskLocal(
  source: HTMLCanvasElement,
  sourceCx: number,
  sourceCy: number,
  dx: number,
  dy: number,
  t: TransformState,
  sigma: number,
): HTMLCanvasElement {
  const out = createCanvas(source.width, source.height)
  const oc = ctx2d(out)
  oc.save()
  oc.translate(sourceCx + dx, sourceCy + dy)
  oc.rotate(t.rotation)
  oc.scale(t.sx, t.sy)
  oc.translate(-sourceCx, -sourceCy)
  oc.drawImage(source, 0, 0)
  oc.restore()
  if (sigma <= .05) return out

  const d = oc.getImageData(0, 0, out.width, out.height)
  const a = new Float32Array(out.width * out.height)
  for (let i = 0, j = 3; i < a.length; i++, j += 4) a[i] = d.data[j]
  const b = gaussianBlurChannel(a, out.width, out.height, sigma)
  for (let i = 0, j = 3; i < b.length; i++, j += 4) d.data[j] = b[i]
  oc.putImageData(d, 0, 0)
  return out
}

async function commitMove() {
  if (committing) return
  const doc = engine.activeDoc
  const layer = engine.activeLayer
  if (!doc || !layer || !mask || !bounds) { reset(); return }

  const dx = Math.round(delta.x), dy = Math.round(delta.y)
  if (Math.abs(dx) + Math.abs(dy) < 1) {
    moveStart = null
    delta = { x: 0, y: 0 }
    engine.pokeOverlay()
    return
  }

  committing = true
  try {
    const opts = getOptions('content-aware-move')
    const target0 = engine.layerCanvasDocSpace(layer.id)
    if (!target0) { reset(); return }

    const structure = clamp(Number(opts.structure) || 5, 1, 7)
    const color = clamp(Number(opts.color) || 5, 0, 10)
    const edgeSigma = Math.max(.25, (8 - structure) * .42)
    const edgePad = Math.max(3, Math.ceil(edgeSigma * 4) + 2)
    const colorPad = Math.max(3, Math.round(Math.min(bounds.w, bounds.h) * .08))
    const inpaintPad = Math.max(24, Math.ceil(Math.min(bounds.w, bounds.h) * .35))
    const pad = Math.max(edgePad, colorPad, inpaintPad)

    const destRect = { x: bounds.x + dx, y: bounds.y + dy, w: bounds.w, h: bounds.h }
    const workRect = clampRectToSize(
      inflateRect(unionRect(bounds, destRect), pad),
      doc.width,
      doc.height,
    )
    if (workRect.w <= 0 || workRect.h <= 0) { reset(); return }

    // Crop all expensive source/base/mask work to one affected neighborhood.
    const targetBefore = cropCanvasRegion(target0, workRect)
    const sampleSource = opts.sampleAllLayers === true ? getFlatComposite(doc) : target0
    const sampled = cropCanvasRegion(sampleSource, workRect)

    const sourceMask = createCanvas(workRect.w, workRect.h)
    const smc = ctx2d(sourceMask)
    smc.drawImage(mask, -workRect.x, -workRect.y)
    if (doc.selection) {
      smc.globalCompositeOperation = 'destination-in'
      smc.drawImage(doc.selection.mask, -workRect.x, -workRect.y)
      smc.globalCompositeOperation = 'source-over'
    }

    const mode = opts.mode === 'extend' ? 'extend' : 'move'
    let base = cloneCanvas(targetBefore)

    if (mode === 'move') {
      const healed = getImageData(targetBefore)
      await imageOps.inpaint(healed, maskAlpha(sourceMask))
      base = createCanvas(workRect.w, workRect.h)
      putImageData(base, healed)
    }

    const destinationMask = softenedShiftedMaskLocal(sourceMask, dx, dy, edgeSigma)

    // The cropped sampled image and mask share the same local registration, so
    // the document-space move delta is also the correct local shift.
    const patch = createCanvas(workRect.w, workRect.h)
    const pc = ctx2d(patch)
    pc.drawImage(sampled, dx, dy)
    pc.globalCompositeOperation = 'destination-in'
    pc.drawImage(destinationMask, 0, 0)
    pc.globalCompositeOperation = 'source-over'

    const result = cloneCanvas(base)
    ctx2d(result).drawImage(patch, 0, 0)

    // Color adaptation remains local to the moved destination.
    if (color > 0) {
      const localDest = clampRect(
        {
          x: bounds.x + dx - workRect.x - colorPad,
          y: bounds.y + dy - workRect.y - colorPad,
          w: bounds.w + colorPad * 2,
          h: bounds.h + colorPad * 2,
        },
        workRect.w,
        workRect.h,
      )
      if (localDest.w > 0 && localDest.h > 0) {
        const rc = ctx2d(result)
        const target = rc.getImageData(localDest.x, localDest.y, localDest.w, localDest.h)
        const baseData = ctx2d(base).getImageData(localDest.x, localDest.y, localDest.w, localDest.h)
        const md = ctx2d(destinationMask).getImageData(localDest.x, localDest.y, localDest.w, localDest.h).data
        const restrict = new Uint8ClampedArray(localDest.w * localDest.h)
        for (let i = 0, j = 3; i < restrict.length; i++, j += 4) restrict[i] = md[j]
        const lowR = Math.max(2, Math.round(Math.min(bounds.w, bounds.h) * (.025 + color * .012)))
        frequencyHeal(target, baseData, restrict, lowR)
        rc.putImageData(target, localDest.x, localDest.y)
      }
    }

    if (opts.output === 'new') {
      // A separate output must still contain unchanged pixels outside the work
      // region, but this is now the only full layer copy in the operation.
      const outCanvas = cloneCanvas(target0)
      const oc = ctx2d(outCanvas)
      oc.clearRect(workRect.x, workRect.y, workRect.w, workRect.h)
      oc.drawImage(result, workRect.x, workRect.y)

      const out = newLayer(
        'raster',
        mode === 'move' ? `${layer.name} — Content-Aware Move` : `${layer.name} — Content-Aware Extend`,
        doc.width,
        doc.height,
      )
      out.canvas = outCanvas
      out.opacity = layer.opacity
      out.blendMode = layer.blendMode
      out.clipped = layer.clipped
      out.origin = layer.origin
      const sourceIndex = doc.layers.findIndex(l => l.id === layer.id)
      doc.layers.splice(Math.max(0, sourceIndex + 1), 0, out)
      layer.visible = false
      layer._v++
      doc.activeLayerId = out.id
      doc.selectedLayerIds = [out.id]
      invalidateFlat(doc)
      engine.pushHistory(mode === 'move' ? 'Content-Aware Move to New Layer' : 'Content-Aware Extend to New Layer')
      engine.emit()
      reset()
      return
    }

    const l = engine.mutateLayerPixels(layer.id)
    if (!l?.canvas) { reset(); return }
    const lx = workRect.x - (l.offsetX ?? 0)
    const ly = workRect.y - (l.offsetY ?? 0)
    const lc = ctx2d(l.canvas)
    lc.clearRect(lx, ly, workRect.w, workRect.h)
    lc.drawImage(result, lx, ly)
    l._v++
    invalidateFlat(doc)
    engine.pushHistory(mode === 'move' ? 'Content-Aware Move' : 'Content-Aware Extend')
    engine.emit()
    reset()
  } catch (err) {
    committing = false
    engine.ui?.toast(err instanceof Error ? err.message : 'Content-Aware Move failed', 'error')
    engine.pokeOverlay()
  }
}

export const contentAwareMoveTool: Tool = {
  id: 'content-aware-move',
  requiresLayer: true,
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0 || committing) return
    const layer = engine.activeLayer
    if (!layer || layer.locked || layer.kind === 'adjustment') return
    if (phase === 'idle' || phase === 'defining') {
      phase = 'defining'
      points = [{ x: p.docX, y: p.docY }]
      samplingMul = 1
      path = null
      mask = null
      bounds = null
      engine.pokeOverlay()
    } else if (phase === 'moving') {
      moveStart = { x: p.docX, y: p.docY }
      delta = { x: 0, y: 0 }
    }
  },

  onPointerMove(p: PointerInfo) {
    if (committing) return
    if (phase === 'defining') {
      const last = points[points.length - 1]
      const step = (1.5 * samplingMul) / Math.max(engine.activeDoc?.view.zoom ?? 1, .25)
      if (last && Math.hypot(p.docX - last.x, p.docY - last.y) < step) return
      points.push({ x: p.docX, y: p.docY })
      if (points.length >= MAX_CONTENT_AWARE_POINTS) {
        const tail = points[points.length - 1]
        points = points.filter((_, i) => i === 0 || (i & 1) === 0)
        if (points[points.length - 1] !== tail) points.push(tail)
        samplingMul *= 2
      }
      engine.pokeOverlay()
    } else if (phase === 'moving' && moveStart) {
      let dx = p.docX - moveStart.x
      let dy = p.docY - moveStart.y
      if (p.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0
        else dx = 0
      }
      delta = { x: dx, y: dy }
      engine.pokeOverlay()
    }
  },

  onPointerUp() {
    if (committing) return
    if (phase === 'defining') finalizeLasso()
    else if (phase === 'moving' && moveStart) {
      moveStart = null
      void commitMove()
    }
  },

  onDoubleClick() {
    if (phase === 'defining' && !committing) finalizeLasso()
  },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && phase !== 'idle') {
      reset()
      return true
    }
    if (e.key === 'Enter' && phase === 'moving' && !committing) {
      void commitMove()
      return true
    }
    return false
  },

  onDeactivate() {
    if (!committing) reset()
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    if (phase === 'defining' && points.length > 1) {
      ctx.save()
      ctx.translate(view.panX, view.panY)
      ctx.scale(view.zoom, view.zoom)
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      const stride = Math.max(1, Math.ceil(points.length / 2048))
      for (let i = stride; i < points.length; i += stride) ctx.lineTo(points[i].x, points[i].y)
      const tail = points[points.length - 1]
      if ((points.length - 1) % stride !== 0) ctx.lineTo(tail.x, tail.y)
      if (mouse) ctx.lineTo((mouse.x - view.panX) / view.zoom, (mouse.y - view.panY) / view.zoom)
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5 / view.zoom
      ctx.stroke()
      ctx.restore()
      drawCross(ctx, mouse)
      return
    }

    if (phase === 'moving' && path && bounds) {
      const opts = getOptions('content-aware-move')
      const src = previewSource
      ctx.save()
      ctx.translate(view.panX, view.panY)
      ctx.scale(view.zoom, view.zoom)

      // Original source outline.
      ctx.strokeStyle = 'rgba(255,255,255,.7)'
      ctx.lineWidth = 1 / view.zoom
      ctx.setLineDash([4 / view.zoom, 3 / view.zoom])
      ctx.stroke(path)

      // Moved subject ghost.
      ctx.save()
      ctx.translate(delta.x, delta.y)
      ctx.clip(path)
      ctx.globalAlpha = .62
      if (src) ctx.drawImage(src, 0, 0)
      ctx.restore()

      ctx.save()
      ctx.translate(delta.x, delta.y)
      ctx.strokeStyle = '#4ec9b0'
      ctx.lineWidth = 1.5 / view.zoom
      ctx.setLineDash([])
      ctx.stroke(path)
      ctx.restore()
      ctx.restore()

      const hx = (bounds.x + delta.x + bounds.w / 2) * view.zoom + view.panX
      const hy = (bounds.y + delta.y + bounds.h / 2) * view.zoom + view.panY
      const label = opts.mode === 'extend' ? 'Extend · release to blend' : 'Move · release to heal + blend'
      ctx.save()
      ctx.font = '11px ui-sans-serif, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(0,0,0,.78)'
      ctx.fillText(label, hx + 1, hy + 1)
      ctx.fillStyle = '#4ec9b0'
      ctx.fillText(label, hx, hy)
      ctx.restore()
      return
    }
    drawCross(ctx, mouse)
  },
}
