// ---------- Document model: layer factories, layer preparation (content/mask/filters), full composite ----------
import type { Layer, LayerKind, PsDocument, Rect, TextSpec, ShapeSpec, BlendIfSettings, AdjustmentType, FilterType, LiveLayerDrag } from '../types'
import { BLEND_GCO } from '../constants/tools'
import { createCanvas, ctx2d, cloneCanvas, uid, getImageData, putImageData, hexToRgb, clamp } from '../utils/canvas'
import * as imageOps from '../image-ops'
import { applyLayerFX, hasEnabledFX } from './layer-fx'
import { glCompositeDocument } from './gl/gl-composite'
import { traceShapePath } from './shape-path'

// ---------- factories ----------
export function newLayer(kind: LayerKind, name: string, w: number, h: number): Layer {
  return {
    id: uid(), name, kind, visible: true, opacity: 100, blendMode: 'normal',
    locked: false, clipped: false,
    canvas: kind === 'raster' ? createCanvas(w, h) : null,
    source: null, transform: null, smartFilters: [],
    mask: null, maskEnabled: true,
    adjustment: null, text: null, shape: null, blendIf: null, fx: null,
    _v: 1, _mv: 1,
  }
}

export function renderTextCanvas(doc: PsDocument, spec: TextSpec): HTMLCanvasElement {
  const c = createCanvas(doc.width, doc.height)
  const ctx = ctx2d(c)
  const weight = spec.bold ? '700' : '400'
  const style = spec.italic ? 'italic ' : ''
  ctx.font = `${style}${weight} ${spec.fontSize}px ${spec.fontFamily}`
  ctx.fillStyle = spec.color
  ctx.textBaseline = 'alphabetic'
  const lines = spec.content.split('\n')
  const lh = spec.fontSize * (spec.lineHeight || 1.2)
  const widths = lines.map(l => ctx.measureText(l).width + Math.max(0, l.length - 1) * (spec.tracking || 0))
  const maxW = Math.max(...widths, 1)
  const applyAlign = (x: number, lineW: number) => {
    if (spec.align === 'center') return x + (maxW - lineW) / 2
    if (spec.align === 'right') return x + (maxW - lineW)
    return x
  }
  if (spec.tracking) {
    // manual letter spacing
    lines.forEach((line, li) => {
      let x = applyAlign(spec.x, widths[li])
      const y = spec.y + spec.fontSize * 0.85 + li * lh
      for (let ci = 0; ci < line.length; ci++) {
        const ch = line[ci]
        ctx.fillText(ch, x, y)
        x += ctx.measureText(ch).width + (ci < line.length - 1 ? spec.tracking : 0)
      }
    })
  } else {
    lines.forEach((line, li) => {
      ctx.fillText(line, applyAlign(spec.x, widths[li]), spec.y + spec.fontSize * 0.85 + li * lh)
    })
  }

  // Character decorations stay editable metadata rather than being baked into
  // raster pixels. Positions are based on the same baseline/leading used above.
  if (spec.underline || spec.strikethrough) {
    ctx.save()
    ctx.strokeStyle = spec.color
    ctx.lineWidth = Math.max(1, spec.fontSize / 18)
    for (let li = 0; li < lines.length; li++) {
      if (!lines[li]) continue
      const x = applyAlign(spec.x, widths[li])
      const y = spec.y + spec.fontSize * 0.85 + li * lh
      if (spec.underline) {
        const uy = y + Math.max(1, spec.fontSize * 0.08)
        ctx.beginPath(); ctx.moveTo(x, uy); ctx.lineTo(x + widths[li], uy); ctx.stroke()
      }
      if (spec.strikethrough) {
        const sy = y - spec.fontSize * 0.30
        ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x + widths[li], sy); ctx.stroke()
      }
    }
    ctx.restore()
  }
  return c
}

function applyShapeDash(ctx: CanvasRenderingContext2D, spec: ShapeSpec) {
  if (spec.dash === 'dashed') ctx.setLineDash([Math.max(1, spec.strokeWidth) * 3, Math.max(1, spec.strokeWidth) * 2])
  else if (spec.dash === 'dotted') ctx.setLineDash([Math.max(1, spec.strokeWidth) * .25, Math.max(1, spec.strokeWidth) * 1.8])
  else ctx.setLineDash([])
}

function strokeLineArrows(ctx: CanvasRenderingContext2D, spec: ShapeSpec) {
  if (spec.shape !== 'line' || (!spec.arrowStart && !spec.arrowEnd)) return
  const x0 = spec.x, y0 = spec.y, x1 = spec.x + spec.w, y1 = spec.y + spec.h
  const angle = Math.atan2(y1 - y0, x1 - x0)
  const len = Math.max(8, (spec.strokeWidth || 2) * 4)
  const spread = Math.PI / 7
  const draw = (x: number, y: number, a: number) => {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x - Math.cos(a - spread) * len, y - Math.sin(a - spread) * len)
    ctx.moveTo(x, y)
    ctx.lineTo(x - Math.cos(a + spread) * len, y - Math.sin(a + spread) * len)
    ctx.stroke()
  }
  if (spec.arrowEnd) draw(x1, y1, angle)
  if (spec.arrowStart) draw(x0, y0, angle + Math.PI)
}

export function renderShapeCanvas(doc: PsDocument, spec: ShapeSpec): HTMLCanvasElement {
  const c = createCanvas(doc.width, doc.height)
  const ctx = ctx2d(c)
  const { shape } = spec
  traceShapePath(ctx, spec)
  if (shape === 'line') {
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, (spec.strokeOpacity ?? 100) / 100))
    ctx.strokeStyle = spec.stroke || spec.fill || '#ffffff'
    ctx.lineWidth = spec.strokeWidth || 2
    ctx.lineCap = spec.lineCap ?? 'round'
    applyShapeDash(ctx, spec)
    ctx.stroke()
    ctx.setLineDash([])
    strokeLineArrows(ctx, spec)
    ctx.restore()
  } else {
    if (spec.fill) {
      ctx.save()
      ctx.globalAlpha = Math.max(0, Math.min(1, (spec.fillOpacity ?? 100) / 100))
      ctx.fillStyle = spec.fill
      ctx.fill()
      ctx.restore()
    }
    if (spec.stroke && spec.strokeWidth > 0) {
      ctx.save()
      ctx.globalAlpha = Math.max(0, Math.min(1, (spec.strokeOpacity ?? 100) / 100))
      ctx.strokeStyle = spec.stroke
      ctx.lineWidth = spec.strokeWidth
      ctx.lineJoin = 'round'
      applyShapeDash(ctx, spec)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }
  }
  return c
}

// ---------- blend-if ----------
function blendIfFactor(settings: BlendIfSettings, layerVal: number, underVal: number): number {
  const f = (s: { lo: number; loSoft: number; hi: number; hiSoft: number }, v: number) => {
    let a = 1
    if (s.lo > 0 || s.loSoft > 0) {
      if (v < s.lo - s.loSoft) a = 0
      else if (v < s.lo) a = (v - (s.lo - s.loSoft)) / Math.max(1, s.loSoft)
    }
    if (s.hi < 255 || s.hiSoft > 0) {
      if (v > s.hi + s.hiSoft) a = 0
      else if (v > s.hi) a *= (s.hi + s.hiSoft - v) / Math.max(1, s.hiSoft)
    }
    return clamp(a, 0, 1)
  }
  const thisF = f(settings.thisLayer, layerVal)
  const underF = f(settings.underLayer, underVal)
  return thisF * underF
}

/** draw src onto target applying the layer's blend-if against the current accumulation */
function drawWithBlendIf(
  targetCtx: CanvasRenderingContext2D, src: HTMLCanvasElement, layer: Layer, acc: HTMLCanvasElement
) {
  const alpha = layer.opacity / 100
  const gco = BLEND_GCO[layer.blendMode] || 'source-over'
  if (!layer.blendIf) {
    targetCtx.save()
    targetCtx.globalAlpha = alpha
    try { targetCtx.globalCompositeOperation = gco } catch { /* fallback */ }
    targetCtx.drawImage(src, 0, 0)
    targetCtx.restore()
    return
  }
  const w = acc.width, h = acc.height
  const accData = getImageData(acc)
  const srcData = getImageData(src)
  const ad = accData.data, sd = srcData.data
  const b = layer.blendIf
  const chanIdx = b.channel === 'r' ? 0 : b.channel === 'g' ? 1 : b.channel === 'b' ? 2 : -1
  for (let i = 0; i < sd.length; i += 4) {
    if (sd[i + 3] === 0) continue
    const lv = chanIdx === -1
      ? Math.round(0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2])
      : sd[i + chanIdx]
    const uv = chanIdx === -1
      ? Math.round(0.299 * ad[i] + 0.587 * ad[i + 1] + 0.114 * ad[i + 2])
      : ad[i + chanIdx]
    const f = blendIfFactor(b, lv, uv)
    if (f < 1) sd[i + 3] = Math.round(sd[i + 3] * f)
  }
  const tmp = createCanvas(w, h)
  putImageData(tmp, srcData)
  targetCtx.save()
  targetCtx.globalAlpha = alpha
  try { targetCtx.globalCompositeOperation = gco } catch { /* fallback */ }
  targetCtx.drawImage(tmp, 0, 0)
  targetCtx.restore()
}

// ---------- adjustment layer application ----------
function applyAdjustmentToCanvas(src: HTMLCanvasElement, type: AdjustmentType, params: Record<string, any>): HTMLCanvasElement {
  const out = cloneCanvas(src)
  const img = getImageData(out)
  imageOps.applyAdjustment(img, type, params)
  putImageData(out, img)
  return out
}

function applyAdjustmentLayerOver(target: HTMLCanvasElement, layer: Layer) {
  const source = target
  if (!layer.adjustment) return
  let result = applyAdjustmentToCanvas(source, layer.adjustment.type, layer.adjustment.params)
  if (layer.maskEnabled && layer.mask) {
    const tmp = createCanvas(result.width, result.height)
    const tc = ctx2d(tmp)
    tc.drawImage(result, 0, 0)
    tc.globalCompositeOperation = 'destination-in'
    tc.drawImage(layer.mask, 0, 0)
    result = tmp
  }
  const ctx = ctx2d(target)
  ctx.save()
  ctx.globalAlpha = layer.opacity / 100
  try { ctx.globalCompositeOperation = BLEND_GCO[layer.blendMode] || 'source-over' } catch { /* noop */ }
  ctx.drawImage(result, 0, 0)
  ctx.restore()
}

// ---------- layer preparation (cached) ----------
export function prepareLayer(doc: PsDocument, layer: Layer): HTMLCanvasElement | null {
  const cacheKey = `${doc._epoch}|${layer._v}|${layer._mv}|${layer.maskEnabled ? 1 : 0}|${doc.previewFilter && doc.previewFilter.layerId === layer.id ? JSON.stringify(doc.previewFilter) : ''}|${doc._strokeLayerId === layer.id ? `st${doc._strokeV}` : ''}|${layer.fx ? 'fx' : ''}`
  const anyLayer = layer as any
  if (anyLayer._cacheKey === cacheKey && anyLayer._cache) return anyLayer._cache

  let content: HTMLCanvasElement | null = null
  let contentDX = 0, contentDY = 0 // doc-space registration of `content` (raster offset)
  if (layer.kind === 'raster' && layer.canvas) {
    content = layer.canvas
    contentDX = layer.offsetX ?? 0
    contentDY = layer.offsetY ?? 0
  }
  else if (layer.kind === 'text' && layer.text) content = renderTextCanvas(doc, layer.text)
  else if (layer.kind === 'shape' && layer.shape) content = renderShapeCanvas(doc, layer.shape)
  else if (layer.kind === 'smart' && layer.source) {
    const c = createCanvas(doc.width, doc.height)
    const ctx = ctx2d(c)
    const t = layer.transform || { x: doc.width / 2, y: doc.height / 2, scale: 1, rotation: 0 }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.save()
    ctx.translate(t.x, t.y)
    ctx.rotate(t.rotation)
    ctx.scale(t.scale, t.scale)
    ctx.drawImage(layer.source, -layer.source.width / 2, -layer.source.height / 2)
    ctx.restore()
    content = c
  }
  if (!content) return null

  // work on a copy
  const out = createCanvas(doc.width, doc.height)
  const ctx = ctx2d(out)
  ctx.drawImage(content, contentDX, contentDY)

  // smart filters (non-destructive chain)
  if (layer.kind === 'smart' && layer.smartFilters.length) {
    for (const sf of layer.smartFilters) {
      if (!sf.enabled) continue
      const img = getImageData(out)
      imageOps.applyFilter(img, sf.type, sf.params)
      putImageData(out, img)
    }
  }

  // dialog live-preview filter
  if (doc.previewFilter && doc.previewFilter.layerId === layer.id) {
    const img = getImageData(out)
    imageOps.applyFilter(img, doc.previewFilter.type, doc.previewFilter.params)
    putImageData(out, img)
  }

  // active stroke buffer
  if (doc._stroke && doc._strokeLayerId === layer.id) {
    if (doc._strokeErase) {
      ctx.save()
      ctx.globalAlpha = doc._strokeOpacity
      ctx.globalCompositeOperation = 'destination-out'
      ctx.drawImage(doc._stroke, 0, 0)
      ctx.restore()
    } else {
      ctx.save()
      ctx.globalAlpha = doc._strokeOpacity
      try { ctx.globalCompositeOperation = BLEND_GCO[doc._strokeBlendMode] || 'source-over' } catch { /* noop */ }
      ctx.drawImage(doc._stroke, 0, 0)
      ctx.restore()
    }
  }

  // layer mask
  if (layer.maskEnabled && layer.mask) {
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(layer.mask, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
  }

  // layer styles (fx) — computed from the POST-MASK silhouette (Photoshop
  // semantics); returns a new canvas (under-effects + content + over-effects)
  const fxv = layer.fx
  if (fxv && hasEnabledFX(fxv)) {
    const withFX = applyLayerFX(out, fxv)
    anyLayer._cache = withFX
    anyLayer._cacheKey = cacheKey
    return withFX
  }

  anyLayer._cache = out
  anyLayer._cacheKey = cacheKey
  return out
}

// ---------- full composite ----------

/** reusable full-size scratch canvas — compositeDocument used to allocate a
 *  fresh accumulator per call (heavy GC churn at multi-layer frame rates) */
let scratchAcc: HTMLCanvasElement | null = null
function getScratch(w: number, h: number): HTMLCanvasElement {
  if (!scratchAcc || scratchAcc.width !== w || scratchAcc.height !== h) {
    scratchAcc = createCanvas(w, h)
  }
  return scratchAcc
}

/** composite the layers [start, end) of doc into acc/accCtx (the exact
 *  pipeline logic: clipping stacks, adjustment layers, blend-if). Shared by
 *  compositeDocument and the live-drag split builder. */
function renderLayerRange(
  doc: PsDocument, start: number, end: number, acc: HTMLCanvasElement, accCtx: CanvasRenderingContext2D
) {
  const layers = doc.layers
  let i = start
  while (i < end) {
    const base = layers[i]
    // gather clipping stack
    let j = i + 1
    const stack: Layer[] = []
    while (j < layers.length && layers[j].clipped) { stack.push(layers[j]); j++ }

    if (!base.visible) { i = j; continue }

    if (base.kind === 'adjustment' && !base.clipped) {
      if (base.adjustment) applyAdjustmentLayerOver(acc, base)
      i = j
      continue
    }
    if (base.kind === 'adjustment') { i = j; continue }

    const basePrepared = prepareLayer(doc, base)
    if (!basePrepared) { i = j; continue }

    const stackCanvas = cloneCanvas(basePrepared)
    const stackCtx = ctx2d(stackCanvas)

    for (const cl of stack) {
      if (!cl.visible) continue
      if (cl.kind === 'adjustment') {
        if (cl.adjustment) applyAdjustmentLayerOver(stackCanvas, cl)
      } else {
        const c = prepareLayer(doc, cl)
        if (!c) continue
        // clip to accumulated stack alpha, then blend in
        const clipped = createCanvas(doc.width, doc.height)
        const cc = ctx2d(clipped)
        cc.drawImage(c, 0, 0)
        cc.globalCompositeOperation = 'destination-in'
        cc.drawImage(stackCanvas, 0, 0)
        stackCtx.save()
        stackCtx.globalAlpha = cl.opacity / 100
        try { stackCtx.globalCompositeOperation = BLEND_GCO[cl.blendMode] || 'source-over' } catch { /* noop */ }
        stackCtx.drawImage(clipped, 0, 0)
        stackCtx.restore()
      }
    }

    drawWithBlendIf(accCtx, stackCanvas, base, acc)
    i = j
  }
}

/** Build the cached split used for interactive layer dragging:
 *  below  = exact composite of everything beneath the layer (static),
 *  stack  = prepared pixels of the layer + its clipped children (static),
 *  above  = composite of everything above (static).
 *  While doc._liveDrag is set, compositeDocument renders this split in 3
 *  drawImage calls instead of the full pipeline — 60fps dragging. */
export function buildLiveDrag(doc: PsDocument, layerId: string): LiveLayerDrag | null {
  const idx = doc.layers.findIndex(l => l.id === layerId)
  if (idx < 0) return null
  const base = doc.layers[idx]
  if (base.kind === 'adjustment') return null

  const below = createCanvas(doc.width, doc.height)
  renderLayerRange(doc, 0, idx, below, ctx2d(below))

  let stack: HTMLCanvasElement
  let stackX = 0
  let stackY = 0
  let movingEnd: number
  let clipMask: HTMLCanvasElement | null = null
  if (base.clipped) {
    // dragging a clipped CHILD: its own pixels move; the clip-base's alpha
    // stays FIXED in doc space. The mask is applied at draw time in the
    // live path (translating content against a fixed mask — a statically
    // pre-clipped canvas would move its clip region WITH the drag and the
    // preview would not match the committed result: parts outside the
    // base were visible mid-drag and vanished on release).
    const p = prepareLayer(doc, base)
    if (!p) return null
    stack = p
    let bi = idx - 1
    while (bi >= 0 && doc.layers[bi].clipped) bi--
    if (bi >= 0) {
      const bp = doc.layers[bi]
      if (bp.kind !== 'adjustment') clipMask = prepareLayer(doc, bp)
    }
    movingEnd = idx + 1
  } else {
    // dragging a stack BASE: move the whole clipped group with it
    const basePrepared = prepareLayer(doc, base)
    if (!basePrepared) return null
    let j = idx + 1
    const children: Layer[] = []
    while (j < doc.layers.length && doc.layers[j].clipped) { children.push(doc.layers[j]); j++ }
    movingEnd = j
    if (children.length) {
      const stackCanvas = cloneCanvas(basePrepared)
      const stackCtx = ctx2d(stackCanvas)
      for (const cl of children) {
        if (!cl.visible) continue
        if (cl.kind === 'adjustment') {
          if (cl.adjustment) applyAdjustmentLayerOver(stackCanvas, cl)
          continue
        }
        const c = prepareLayer(doc, cl)
        if (!c) continue
        const clipped = createCanvas(doc.width, doc.height)
        const cc = ctx2d(clipped)
        cc.drawImage(c, 0, 0)
        cc.globalCompositeOperation = 'destination-in'
        cc.drawImage(stackCanvas, 0, 0)
        stackCtx.save()
        stackCtx.globalAlpha = cl.opacity / 100
        try { stackCtx.globalCompositeOperation = BLEND_GCO[cl.blendMode] || 'source-over' } catch { /* noop */ }
        stackCtx.drawImage(clipped, 0, 0)
        stackCtx.restore()
      }
      stack = stackCanvas
    } else {
      // A plain raster layer may be larger than the document and may already
      // sit partly outside it. prepareLayer() is document-sized, so using it
      // here clips those hidden pixels out of the live-drag cache. Point at
      // the original raster canvas instead whenever no document-space
      // effects/masks need baking; its registration is carried separately.
      const canUseFullRaster =
        base.kind === 'raster' && !!base.canvas &&
        !(base.maskEnabled && base.mask) &&
        !hasEnabledFX(base.fx) &&
        !(doc.previewFilter && doc.previewFilter.layerId === base.id) &&
        !(doc._stroke && doc._strokeLayerId === base.id)
      if (canUseFullRaster) {
        stack = base.canvas!
        stackX = base.offsetX ?? 0
        stackY = base.offsetY ?? 0
      } else {
        stack = basePrepared
      }
    }
  }

  const above = createCanvas(doc.width, doc.height)
  renderLayerRange(doc, movingEnd, doc.layers.length, above, ctx2d(above))

  return {
    layerId, dx: 0, dy: 0,
    below, stack, stackX, stackY, above, clipMask,
    blendMode: base.blendMode, opacity: base.opacity,
  }
}

export function compositeDocument(doc: PsDocument, target?: HTMLCanvasElement): HTMLCanvasElement {
  const out = target ?? createCanvas(doc.width, doc.height)
  if (out.width !== doc.width || out.height !== doc.height) { out.width = doc.width; out.height = doc.height }

  // LIVE LAYER-DRAG fast path: 3 drawImages from the cached split instead of
  // the full (allocation-heavy) pipeline — checked BEFORE the GL path because
  // it is faster on both software and hardware GL. Blend-if and preview
  // adjustments are skipped during the drag (restored exactly on commit).
  const ld = doc._liveDrag
  if (ld && doc.channelView === 'rgb' && !doc.previewAdjustment) {
    const outCtx = ctx2d(out)
    outCtx.clearRect(0, 0, out.width, out.height)
    outCtx.drawImage(ld.below, 0, 0)
    outCtx.save()
    outCtx.globalAlpha = ld.opacity / 100
    try { outCtx.globalCompositeOperation = BLEND_GCO[ld.blendMode] || 'source-over' } catch { /* noop */ }
    // live free-transform (scale/rotate about a doc-space anchor):
    // p → a + R·S·(p − a). Applied identically in the main canvas blit and
    // the off-canvas drag ghost so the preview matches the commit exactly.
    const lt = ld.liveTransform
    if (lt) {
      outCtx.translate(lt.ax, lt.ay)
      outCtx.rotate(lt.rotation)
      outCtx.scale(lt.sx, lt.sy)
      outCtx.translate(-lt.ax, -lt.ay)
    }
    if (ld.clipMask) {
      // clipped child: translate the content, THEN intersect with the fixed
      // doc-space clip mask — identical to the committed full-pipeline look
      const scratch = getScratch(doc.width, doc.height)
      const sctx = ctx2d(scratch)
      sctx.clearRect(0, 0, doc.width, doc.height)
      if (lt) {
        sctx.translate(lt.ax, lt.ay)
        sctx.rotate(lt.rotation)
        sctx.scale(lt.sx, lt.sy)
        sctx.translate(-lt.ax, -lt.ay)
      } else {
        sctx.translate(Math.round(ld.dx), Math.round(ld.dy))
      }
      sctx.drawImage(ld.stack, 0, 0)
      sctx.setTransform(1, 0, 0, 1, 0, 0)
      sctx.globalCompositeOperation = 'destination-in'
      sctx.drawImage(ld.clipMask, 0, 0)
      outCtx.drawImage(scratch, 0, 0)
    } else {
      outCtx.drawImage(
        ld.stack,
        Math.round((ld.stackX ?? 0) + ld.dx),
        Math.round((ld.stackY ?? 0) + ld.dy),
      )
    }
    outCtx.restore()
    outCtx.drawImage(ld.above, 0, 0)
    return out
  }

  // GPU fast path (WebGL2) — mirrors this exact pipeline; falls back to the
  // CPU path below for unsupported features (blend-if, unsupported adjustment
  // types, filter previews) or when GL is unavailable/disabled.
  if (glCompositeDocument(doc, out)) return out

  const outCtx = ctx2d(out)
  outCtx.clearRect(0, 0, doc.width, doc.height)

  const acc = getScratch(doc.width, doc.height)
  const accCtx = ctx2d(acc)
  accCtx.clearRect(0, 0, doc.width, doc.height)

  renderLayerRange(doc, 0, doc.layers.length, acc, accCtx)

  // channel view
  if (doc.channelView !== 'rgb') {
    const img = getImageData(acc)
    const d = img.data
    const ch = doc.channelView === 'r' ? 0 : doc.channelView === 'g' ? 1 : 2
    for (let k = 0; k < d.length; k += 4) {
      const v = d[k + ch]
      d[k] = v; d[k + 1] = v; d[k + 2] = v
    }
    putImageData(acc, img)
  }

  // dialog live-preview adjustment
  if (doc.previewAdjustment) {
    const img = getImageData(acc)
    imageOps.applyAdjustment(img, doc.previewAdjustment.type, doc.previewAdjustment.params)
    putImageData(acc, img)
  }

  outCtx.drawImage(acc, 0, 0)
  return out
}

/** flat composite cached for sampling/histogram/export */
export function getFlatComposite(doc: PsDocument): HTMLCanvasElement {
  const anyDoc = doc as any
  if (anyDoc._flatCacheKey === flatKey(doc) && anyDoc._flatCache) return anyDoc._flatCache
  const c = compositeDocument(doc)
  anyDoc._flatCache = c
  anyDoc._flatCacheKey = flatKey(doc)
  return c
}

function flatKey(doc: PsDocument): string {
  let k = `${doc._epoch}|${doc.channelView}|${doc.previewAdjustment ? JSON.stringify(doc.previewAdjustment) : ''}|${doc._strokeLayerId ?? ''}.${doc._strokeV ?? 0}|${doc.layers.map(l => `${l._v}.${l._mv}.${l.visible ? 1 : 0}.${l.opacity}.${l.blendMode}.${l.maskEnabled ? 1 : 0}${l.clipped ? 'c' : ''}`).join(',')}`
  return k
}

export function invalidateFlat(doc: PsDocument) {
  const anyDoc = doc as any
  anyDoc._flatCache = null
  anyDoc._flatCacheKey = null
}
