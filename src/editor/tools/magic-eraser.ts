// ============================================================
// Magic Eraser — Photoshop-style one-click color removal.
//
// Uses the same perceptual region matcher as Magic Wand so tolerance,
// anti-aliasing, edge protection and pixel-exact behavior remain consistent.
// "Sample All Layers" changes only the matching source; pixels are erased
// from the active raster layer only.
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, drawCross } from './shared'
import { createCanvas, ctx2d, getImageData, putImageData, clamp, cloneCanvas } from '../utils/canvas'
import { perceptualWandMask } from '../image-ops/wand'
import { getFlatComposite, invalidateFlat } from '../engine/document'

export const magicEraserTool: Tool = {
  id: 'magic-eraser',
  requiresLayer: true,
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    const layer = engine.activeLayer
    if (!doc || !layer || layer.locked || layer.kind === 'adjustment') return

    const opts = getOptions('magic-eraser')
    const sample = opts.sampleAllLayers === true
      ? getFlatComposite(doc)
      : engine.layerCanvasDocSpace(layer.id)
    if (!sample) return

    const cx = clamp(Math.round(p.docX), 0, doc.width - 1)
    const cy = clamp(Math.round(p.docY), 0, doc.height - 1)
    const img = getImageData(sample)
    const alpha = perceptualWandMask(img, cx, cy, {
      tolerance: Number(opts.tolerance) || 0,
      contiguous: opts.contiguous !== false,
      antiAlias: opts.antiAlias !== false,
      sampleRadius: clamp(Math.round(Number(opts.sampleRadius) || 0), 0, 2),
      edgeAware: clamp(Number(opts.edgeAware) || 0, 0, 100),
      adaptive: opts.exactPixels !== true,
      exactPixels: opts.exactPixels === true,
      matchAlpha: false,
    })

    let any = false
    const maskData = new ImageData(doc.width, doc.height)
    for (let i = 0, j = 0; i < alpha.length; i++, j += 4) {
      const a = alpha[i]
      if (!a) continue
      any = true
      maskData.data[j] = 255
      maskData.data[j + 1] = 255
      maskData.data[j + 2] = 255
      maskData.data[j + 3] = a
    }
    if (!any) return

    const mask = createCanvas(doc.width, doc.height)
    putImageData(mask, maskData)
    const mc = ctx2d(mask)
    if (doc.selection) {
      mc.globalCompositeOperation = 'destination-in'
      mc.drawImage(doc.selection.mask, 0, 0)
      mc.globalCompositeOperation = 'source-over'
    }

    const eraseOpacity = clamp((Number(opts.opacity) || 100) / 100, 0.01, 1)

    if (opts.output === 'mask') {
      // Non-destructive mode: hide the matched region in the layer mask while
      // leaving the source pixels untouched. Existing masks are preserved and
      // further reduced by this erase operation.
      if (layer.mask) layer.mask = cloneCanvas(layer.mask)
      else {
        layer.mask = createCanvas(doc.width, doc.height)
        const lc = ctx2d(layer.mask)
        lc.fillStyle = '#fff'
        lc.fillRect(0, 0, doc.width, doc.height)
      }
      layer.maskEnabled = true
      const lc = ctx2d(layer.mask)
      lc.save()
      lc.globalAlpha = eraseOpacity
      lc.globalCompositeOperation = 'destination-out'
      lc.drawImage(mask, 0, 0)
      lc.restore()
      layer._mv++
      invalidateFlat(doc)
      engine.pushHistory('Magic Eraser Mask')
      engine.emit()
      return
    }

    const target = engine.mutateLayerPixels(layer.id)
    if (!target?.canvas) return
    const tc = ctx2d(target.canvas)
    tc.save()
    tc.globalAlpha = eraseOpacity
    tc.globalCompositeOperation = 'destination-out'
    tc.drawImage(mask, -(target.offsetX ?? 0), -(target.offsetY ?? 0))
    tc.restore()

    engine.pushHistory('Magic Eraser')
    engine.emit()
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void view; void w; void h
    drawCross(ctx, mouse)
  },
}
