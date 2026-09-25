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

function decontaminateMagicEdge(
  canvas: HTMLCanvasElement,
  maskAlpha: Uint8ClampedArray,
  docWidth: number,
  docHeight: number,
  offsetX: number,
  offsetY: number,
  amountPct: number,
  maskBounds: { x: number; y: number; w: number; h: number },
) {
  const amount = clamp(amountPct / 100, 0, 1)
  if (amount <= 0) return
  const tc = ctx2d(canvas)
  const img = tc.getImageData(0, 0, canvas.width, canvas.height)
  const src = new Uint8ClampedArray(img.data)
  const around = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]] as const

  const lx0 = Math.max(0, Math.floor(maskBounds.x - offsetX))
  const ly0 = Math.max(0, Math.floor(maskBounds.y - offsetY))
  const lx1 = Math.min(canvas.width, Math.ceil(maskBounds.x + maskBounds.w - offsetX))
  const ly1 = Math.min(canvas.height, Math.ceil(maskBounds.y + maskBounds.h - offsetY))

  for (let ly = ly0; ly < ly1; ly++) {
    const dy = ly + offsetY
    if (dy < 0 || dy >= docHeight) continue
    for (let lx = lx0; lx < lx1; lx++) {
      const dx = lx + offsetX
      if (dx < 0 || dx >= docWidth) continue
      const mi = dy * docWidth + dx
      const ma = maskAlpha[mi]
      // Decontamination is for the soft boundary. Fully erased pixels are
      // invisible, while untouched pixels should retain their original color.
      if (ma <= 0 || ma >= 250) continue

      let rr = 0, gg = 0, bb = 0, n = 0
      for (const [ox, oy] of around) {
        const nx = lx + ox, ny = ly + oy
        const ndx = dx + ox, ndy = dy + oy
        if (nx < 0 || ny < 0 || nx >= canvas.width || ny >= canvas.height) continue
        if (ndx < 0 || ndy < 0 || ndx >= docWidth || ndy >= docHeight) continue
        const nmi = ndy * docWidth + ndx
        // Prefer pixels outside the erased region: they are our best estimate
        // of the true foreground edge color.
        if (maskAlpha[nmi] >= ma * .45) continue
        const ni = (ny * canvas.width + nx) * 4
        if (src[ni + 3] < 24) continue
        rr += src[ni]; gg += src[ni + 1]; bb += src[ni + 2]; n++
      }
      if (!n) continue
      const i = (ly * canvas.width + lx) * 4
      const strength = amount * clamp(ma / 255, 0, 1)
      img.data[i] = src[i] * (1 - strength) + (rr / n) * strength
      img.data[i + 1] = src[i + 1] * (1 - strength) + (gg / n) * strength
      img.data[i + 2] = src[i + 2] * (1 - strength) + (bb / n) * strength
    }
  }
  tc.putImageData(img, 0, 0)
}

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

    let minX = doc.width, minY = doc.height, maxX = -1, maxY = -1
    for (let i = 0; i < alpha.length; i++) {
      if (!alpha[i]) continue
      const x = i % doc.width
      const y = (i / doc.width) | 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    if (maxX < minX || maxY < minY) return

    const maskBounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    const maskData = new ImageData(maskBounds.w, maskBounds.h)
    for (let y = 0; y < maskBounds.h; y++) {
      const gy = minY + y
      for (let x = 0; x < maskBounds.w; x++) {
        const gx = minX + x
        const a = alpha[gy * doc.width + gx]
        if (!a) continue
        const j = (y * maskBounds.w + x) * 4
        maskData.data[j] = 255
        maskData.data[j + 1] = 255
        maskData.data[j + 2] = 255
        maskData.data[j + 3] = a
      }
    }

    const mask = createCanvas(maskBounds.w, maskBounds.h)
    putImageData(mask, maskData)
    const mc = ctx2d(mask)
    if (doc.selection) {
      mc.globalCompositeOperation = 'destination-in'
      mc.drawImage(doc.selection.mask, -maskBounds.x, -maskBounds.y)
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
      lc.drawImage(mask, maskBounds.x, maskBounds.y)
      lc.restore()
      layer._mv++
      invalidateFlat(doc)
      engine.pushHistory('Magic Eraser Mask')
      engine.emit()
      return
    }

    const target = engine.mutateLayerPixels(layer.id)
    if (!target?.canvas) return
    decontaminateMagicEdge(
      target.canvas,
      alpha,
      doc.width,
      doc.height,
      target.offsetX ?? 0,
      target.offsetY ?? 0,
      Number(opts.decontaminate) || 0,
      maskBounds,
    )
    const tc = ctx2d(target.canvas)
    tc.save()
    tc.globalAlpha = eraseOpacity
    tc.globalCompositeOperation = 'destination-out'
    tc.drawImage(
      mask,
      maskBounds.x - (target.offsetX ?? 0),
      maskBounds.y - (target.offsetY ?? 0),
    )
    tc.restore()

    engine.pushHistory('Magic Eraser')
    engine.emit()
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void view; void w; void h
    drawCross(ctx, mouse)
  },
}
