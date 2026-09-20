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
} from '../utils/canvas'
import { getFlatComposite, invalidateFlat, newLayer } from '../engine/document'
import { gaussianBlurChannel } from '../image-ops/core'
import { frequencyHeal } from './dab-utils'
import * as imageOps from '../image-ops'

type Phase = 'idle' | 'defining' | 'moving'
let phase: Phase = 'idle'
let points: { x: number; y: number }[] = []
let path: Path2D | null = null
let mask: HTMLCanvasElement | null = null
let bounds: Rect | null = null
let moveStart: { x: number; y: number } | null = null
let delta = { x: 0, y: 0 }
let committing = false

function reset() {
  phase = 'idle'
  points = []
  path = null
  mask = null
  bounds = null
  moveStart = null
  delta = { x: 0, y: 0 }
  committing = false
  engine.requestRender()
}

function polygonPath(pts: { x: number; y: number }[]) {
  const p = new Path2D()
  p.moveTo(pts[0].x, pts[0].y)
  for (const q of pts.slice(1)) p.lineTo(q.x, q.y)
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

  // Small AA feather; adaptation adds additional softness at commit time.
  const md = getImageData(m)
  const alpha = new Float32Array(doc.width * doc.height)
  for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = md.data[j]
  const aa = gaussianBlurChannel(alpha, doc.width, doc.height, .65)
  for (let i = 0, j = 3; i < aa.length; i++, j += 4) md.data[j] = aa[i]
  putImageData(m, md)
  mask = m
  phase = 'moving'
  moveStart = null
  delta = { x: 0, y: 0 }
  engine.ui?.toast('Drag the selected subject to its new location', 'info')
  engine.requestRender()
}

function maskAlpha(m: HTMLCanvasElement): Uint8ClampedArray {
  const d = getImageData(m).data
  const out = new Uint8ClampedArray(m.width * m.height)
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = d[j]
  return out
}

function softenedShiftedMask(
  source: HTMLCanvasElement,
  dx: number,
  dy: number,
  sigma: number,
): HTMLCanvasElement {
  const doc = engine.activeDoc!
  const out = createCanvas(doc.width, doc.height)
  ctx2d(out).drawImage(source, dx, dy)
  if (sigma <= .05) return out
  const d = getImageData(out)
  const a = new Float32Array(doc.width * doc.height)
  for (let i = 0, j = 3; i < a.length; i++, j += 4) a[i] = d.data[j]
  const b = gaussianBlurChannel(a, doc.width, doc.height, sigma)
  for (let i = 0, j = 3; i < b.length; i++, j += 4) d.data[j] = b[i]
  putImageData(out, d)
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
    engine.requestRender()
    return
  }

  committing = true
  try {
    const opts = getOptions('content-aware-move')
    const target0 = engine.layerCanvasDocSpace(layer.id)
    if (!target0) { reset(); return }
    const targetBefore = cloneCanvas(target0)
    const sampled = opts.sampleAllLayers === true ? cloneCanvas(getFlatComposite(doc)) : cloneCanvas(target0)

    // Respect an existing document selection as an outer constraint.
    const sourceMask = cloneCanvas(mask)
    if (doc.selection) {
      const smc = ctx2d(sourceMask)
      smc.globalCompositeOperation = 'destination-in'
      smc.drawImage(doc.selection.mask, 0, 0)
      smc.globalCompositeOperation = 'source-over'
    }

    const mode = opts.mode === 'extend' ? 'extend' : 'move'
    let base = cloneCanvas(targetBefore)

    if (mode === 'move') {
      const healed = getImageData(targetBefore)
      await imageOps.inpaint(healed, maskAlpha(sourceMask))
      base = createCanvas(doc.width, doc.height)
      putImageData(base, healed)
    }

    const structure = clamp(Number(opts.structure) || 5, 1, 7)
    const color = clamp(Number(opts.color) || 5, 0, 10)
    const edgeSigma = Math.max(.25, (8 - structure) * .42)
    const destinationMask = softenedShiftedMask(sourceMask, dx, dy, edgeSigma)

    // Move the sampled subject; the mask keeps only the lassoed pixels.
    const patch = createCanvas(doc.width, doc.height)
    const pc = ctx2d(patch)
    pc.drawImage(sampled, dx, dy)
    pc.globalCompositeOperation = 'destination-in'
    pc.drawImage(destinationMask, 0, 0)
    pc.globalCompositeOperation = 'source-over'

    const result = cloneCanvas(base)
    ctx2d(result).drawImage(patch, 0, 0)

    // Color adaptation: retain the moved high-frequency structure while
    // matching lower-frequency illumination/chroma to the destination.
    if (color > 0) {
      const destBounds = clampRect(
        { x: bounds.x + dx, y: bounds.y + dy, w: bounds.w, h: bounds.h },
        doc.width, doc.height,
      )
      const pad = Math.max(3, Math.round(Math.min(bounds.w, bounds.h) * .08))
      const region = clampRect(
        { x: destBounds.x - pad, y: destBounds.y - pad, w: destBounds.w + pad * 2, h: destBounds.h + pad * 2 },
        doc.width, doc.height,
      )
      if (region.w > 0 && region.h > 0) {
        const rc = ctx2d(result)
        const target = rc.getImageData(region.x, region.y, region.w, region.h)
        const baseData = ctx2d(base).getImageData(region.x, region.y, region.w, region.h)
        const md = ctx2d(destinationMask).getImageData(region.x, region.y, region.w, region.h).data
        const restrict = new Uint8ClampedArray(region.w * region.h)
        for (let i = 0, j = 3; i < restrict.length; i++, j += 4) restrict[i] = md[j]
        const lowR = Math.max(2, Math.round(Math.min(bounds.w, bounds.h) * (.025 + color * .012)))
        frequencyHeal(target, baseData, restrict, lowR)
        rc.putImageData(target, region.x, region.y)
      }
    }

    if (opts.output === 'new') {
      // Preserve the source layer intact. A full-document result layer takes
      // its place visually and inherits the source layer's blend/opacity;
      // hiding rather than deleting the original keeps the operation fully
      // reversible beyond ordinary history.
      const out = newLayer(
        'raster',
        mode === 'move' ? `${layer.name} — Content-Aware Move` : `${layer.name} — Content-Aware Extend`,
        doc.width,
        doc.height,
      )
      out.canvas = cloneCanvas(result)
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
    const lc = ctx2d(l.canvas)
    // Replace only the document-space rectangle, preserving pixels outside the
    // canvas in oversized raster backing stores.
    lc.save()
    lc.globalCompositeOperation = 'copy'
    lc.drawImage(result, -(l.offsetX ?? 0), -(l.offsetY ?? 0))
    lc.restore()
    l._v++
    invalidateFlat(doc)
    engine.pushHistory(mode === 'move' ? 'Content-Aware Move' : 'Content-Aware Extend')
    engine.emit()
    reset()
  } catch (err) {
    committing = false
    engine.ui?.toast(err instanceof Error ? err.message : 'Content-Aware Move failed', 'error')
    engine.requestRender()
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
      path = null
      mask = null
      bounds = null
      engine.requestRender()
    } else if (phase === 'moving') {
      moveStart = { x: p.docX, y: p.docY }
      delta = { x: 0, y: 0 }
    }
  },

  onPointerMove(p: PointerInfo) {
    if (committing) return
    if (phase === 'defining') {
      const last = points[points.length - 1]
      if (!last || Math.hypot(p.docX - last.x, p.docY - last.y) >= 1.5) {
        points.push({ x: p.docX, y: p.docY })
      }
      engine.requestRender()
    } else if (phase === 'moving' && moveStart) {
      let dx = p.docX - moveStart.x
      let dy = p.docY - moveStart.y
      if (p.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0
        else dx = 0
      }
      delta = { x: dx, y: dy }
      engine.requestRender()
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
      for (const p of points.slice(1)) ctx.lineTo(p.x, p.y)
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
      const src = opts.sampleAllLayers === true
        ? engine.activeDoc ? getFlatComposite(engine.activeDoc) : null
        : engine.activeLayer ? engine.layerCanvasDocSpace(engine.activeLayer.id) : null
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
