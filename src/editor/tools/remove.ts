import type { Tool, PointerInfo, Rect } from '../types'
import { engine } from '../engine/engine'
import { getOptions, toolMaskCanvas, walkDabsEach } from './shared'
import { createCanvas, ctx2d, clamp } from '../utils/canvas'
import { dilateMask } from '../image-ops/core'
import * as imageOps from '../image-ops'
import { getFlatComposite, invalidateFlat, newLayer } from '../engine/document'
import { useEditorStore } from '../store'

let maskCanvas: HTMLCanvasElement | null = null
let active = false
let last: { x: number; y: number } | null = null
let bounds: Rect | null = null
let generation = 0

function mark(x: number, y: number) {
  if (!maskCanvas) return
  const opts = getOptions('remove')
  const radius = clamp(Number(opts.size) || 40, 1, 1000) / 2
  const ctx = ctx2d(maskCanvas)
  const inner = radius * clamp((Number(opts.hardness) ?? 75) / 100, 0, .98)
  const grad = ctx.createRadialGradient(x, y, inner, x, y, Math.max(.5, radius))
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, Math.max(.5, radius), 0, Math.PI * 2)
  ctx.fill()
  const pad = radius + 2
  const r = { x: x - pad, y: y - pad, w: pad * 2, h: pad * 2 }
  if (!bounds) bounds = r
  else {
    const x0 = Math.min(bounds.x, r.x), y0 = Math.min(bounds.y, r.y)
    const x1 = Math.max(bounds.x + bounds.w, r.x + r.w), y1 = Math.max(bounds.y + bounds.h, r.y + r.h)
    bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }
}

function resetPreview() {
  active = false
  last = null
  maskCanvas = null
  bounds = null
  engine.pokeOverlay()
}

export const removeTool: Tool = {
  id: 'remove',
  requiresLayer: true,
  cursor: 'none',
  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    const layer = engine.activeLayer
    if (!doc || !layer || layer.locked || layer.kind === 'adjustment') return
    if (doc.workingBitDepth === 32) {
      engine.ui?.toast('Remove Tool currently requires an 8-bit or 16-bit document. Convert the document before removing objects.', 'error')
      return
    }
    maskCanvas = toolMaskCanvas()
    bounds = null
    active = true
    last = { x: p.docX, y: p.docY }
    mark(p.docX, p.docY)
    engine.pokeOverlay()
  },
  onPointerMove(p: PointerInfo) {
    if (!active || !last) return
    const opts = getOptions('remove')
    const size = clamp(Number(opts.size) || 40, 1, 1000)
    const spacing = Math.max(1, size * clamp(Number(opts.spacing) || 15, 1, 200) / 100)
    const line = walkDabsEach(last.x, last.y, p.docX, p.docY, spacing, mark)
    if (line.count) last = { x: line.lastX, y: line.lastY }
    engine.pokeOverlay()
  },
  async onPointerUp() {
    if (!active || !maskCanvas || !bounds) { resetPreview(); return }
    active = false
    const doc = engine.activeDoc
    const layer = engine.activeLayer
    const docId = doc?.id
    const layerId = layer?.id
    const token = ++generation
    const mask = maskCanvas
    const rawBounds = bounds
    last = null
    maskCanvas = null
    bounds = null
    if (!doc || !layer || !docId || !layerId) { resetPreview(); return }

    const opts = getOptions('remove')
    const radius = clamp(Number(opts.size) || 40, 1, 1000)
    const expand = clamp(Number(opts.expand) || 4, 0, 64)
    const pad = Math.max(32, Math.ceil(radius * 1.75), expand * 4 + 12)
    const x = clamp(Math.floor(rawBounds.x - pad), 0, doc.width)
    const y = clamp(Math.floor(rawBounds.y - pad), 0, doc.height)
    const right = clamp(Math.ceil(rawBounds.x + rawBounds.w + pad), 0, doc.width)
    const bottom = clamp(Math.ceil(rawBounds.y + rawBounds.h + pad), 0, doc.height)
    const work = { x, y, w: right - x, h: bottom - y }
    if (work.w < 1 || work.h < 1) return

    const maskData = ctx2d(mask).getImageData(x, y, work.w, work.h).data
    const rawMask = new Uint8ClampedArray(work.w * work.h)
    for (let i = 0, j = 3; i < rawMask.length; i++, j += 4) rawMask[i] = maskData[j]
    const inpaintMask = dilateMask(rawMask, work.w, work.h, Math.round(expand))
    if (!inpaintMask.some(v => v > 0)) return

    const source = opts.sampleAllLayers === false
      ? engine.layerCanvasDocSpace(layerId)
      : getFlatComposite(doc)
    if (!source) return
    const pixels = ctx2d(source).getImageData(x, y, work.w, work.h)
    const result = new ImageData(work.w, work.h)
    result.data.set(pixels.data)
    const store = useEditorStore.getState()
    store.setProgress({ active: true, label: 'Remove Tool — reconstructing pixels', value: 0 })
    try {
      await imageOps.inpaint(result, inpaintMask, value => {
        if (generation === token) store.setProgress({ active: true, label: 'Remove Tool — reconstructing pixels', value })
      })
    } catch (err) {
      engine.ui?.toast(`Remove Tool failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
      return
    } finally {
      store.setProgress(null)
    }
    if (generation !== token || engine.activeDoc?.id !== docId) return

    const patch = createCanvas(work.w, work.h)
    const out = ctx2d(patch).createImageData(work.w, work.h)
    const feather = clamp(Number(opts.feather) || 0, 0, 32)
    let alpha = inpaintMask
    if (feather > 0) {
      // Feather only the patch edge; preserve the original painted mask as the
      // inner footprint and soften the dilated fringe.
      const featherCanvas = createCanvas(work.w, work.h)
      const fctx = ctx2d(featherCanvas)
      const md = fctx.createImageData(work.w, work.h)
      for (let i = 0, j = 3; i < alpha.length; i++, j += 4) md.data[j] = alpha[i]
      fctx.putImageData(md, 0, 0)
      fctx.filter = `blur(${feather}px)`
      fctx.drawImage(featherCanvas, 0, 0)
      const softened = fctx.getImageData(0, 0, work.w, work.h).data
      alpha = new Uint8ClampedArray(work.w * work.h)
      for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = Math.max(inpaintMask[i], softened[j])
    }
    const selection = doc.selection
    let selectionPixels: Uint8ClampedArray | null = null
    if (selection) {
      const sd = ctx2d(selection.mask).getImageData(x, y, work.w, work.h).data
      selectionPixels = new Uint8ClampedArray(work.w * work.h)
      for (let i = 0, j = 3; i < selectionPixels.length; i++, j += 4) selectionPixels[i] = sd[j]
    }
    for (let i = 0, j = 0; i < alpha.length; i++, j += 4) {
      const a = selectionPixels ? Math.round(alpha[i] * selectionPixels[i] / 255) : alpha[i]
      out.data[j] = result.data[j]
      out.data[j + 1] = result.data[j + 1]
      out.data[j + 2] = result.data[j + 2]
      out.data[j + 3] = a
    }
    ctx2d(patch).putImageData(out, 0, 0)
    const output = newLayer('raster', 'Remove Result', work.w, work.h)
    output.canvas = patch
    output.offsetX = x
    output.offsetY = y
    const insertion = opts.sampleAllLayers === false
      ? Math.max(0, doc.layers.findIndex(item => item.id === layerId) + 1)
      : doc.layers.length
    doc.layers.splice(insertion, 0, output)
    doc.activeLayerId = output.id
    doc.selectedLayerIds = [output.id]
    invalidateFlat(doc)
    engine.pushHistory('Remove Object')
    engine.emit()
    engine.ui?.toast('Object removed to a new editable layer', 'success')
  },
  onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return false
    generation++
    resetPreview()
    useEditorStore.getState().setProgress(null)
    return true
  },
  onDeactivate() {
    if (active) resetPreview()
    generation++
  },
  renderOverlay(ctx, view) {
    if (!maskCanvas || !active) return
    ctx.save()
    ctx.globalAlpha = .38
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(maskCanvas, view.panX, view.panY, maskCanvas.width * view.zoom, maskCanvas.height * view.zoom)
    ctx.restore()
  },
  renderCursor(ctx, view, _w, _h, mouse) {
    if (!mouse) return
    const size = (Number(getOptions('remove').size) || 40) * view.zoom
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,.95)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(mouse.x, mouse.y, Math.max(2, size / 2), 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(0,0,0,.75)'
    ctx.setLineDash([2, 2])
    ctx.stroke()
    ctx.restore()
  },
}
