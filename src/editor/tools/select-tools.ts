// ============================================================
// Object Selection & Quick Selection (Task 2-b upgrade)
//  Object Select: rect drag; on release the detection runs inside a
//  setTimeout(0) so the "Detecting object…" overlay paints first. Respects
//  the mode option (new/add/subtract/intersect) and feather.
//  Quick Select: composite ImageData cached per stroke; the grow region is
//  recomputed ONCE per pointermove — a disk of average color is sampled under
//  the cursor and flood-grown with tolerance bounded to the brush radius; the
//  result is unioned into the accumulated mask (live tint preview).
// ============================================================
import type { Tool, PointerInfo, Rect } from '../types'
import { engine } from '../engine/engine'
import { newDrag, getOptions, combineMode, drawDashedRect, drawCross, drawBrushCursor, toolMaskCanvas } from './shared'
import { getImageData, rectFromPoints, clamp, ctx2d, createCanvas, getMaskAlpha } from '../utils/canvas'
import { gaussianBlurChannel } from '../image-ops/core'
import { getFlatComposite } from '../engine/document'
import { diskAverageColor, growDisk } from './dab-utils'
import * as imageOps from '../image-ops'
import { loadComfyConfig, runComfyWorkflow } from '../ai/providers'

// ============================================================
// Object Selection
// ============================================================
let drag = newDrag()
let rect: Rect | null = null
let objectLasso: { x: number; y: number }[] = []
let objectClick: { x: number; y: number } | null = null
let detecting = false
let detectRect: Rect | null = null
let detectLasso: { x: number; y: number }[] | null = null
let detectClick: { x: number; y: number } | null = null

async function comfySegmentationMask(
  source: HTMLCanvasElement,
  regionMask: HTMLCanvasElement,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  const cfg = loadComfyConfig()
  const result = await runComfyWorkflow(cfg, {
    capability: 'select-subject',
    prompt: 'Segment the foreground object inside the provided region. Return a white/opaque subject on black/transparent background.',
    imageDataUrl: source.toDataURL('image/png'),
    maskDataUrl: regionMask.toDataURL('image/png'),
  })
  const canvas = await imageOps.dataUrlToCanvas(result.image)
  const normalized = canvas.width === width && canvas.height === height
    ? canvas
    : (() => {
        const out = createCanvas(width, height)
        const oc = ctx2d(out)
        oc.imageSmoothingEnabled = true
        oc.imageSmoothingQuality = 'high'
        oc.drawImage(canvas, 0, 0, width, height)
        return out
      })()
  const d = getImageData(normalized).data
  let alphaPixels = 0
  for (let j = 3; j < d.length; j += 4) {
    if (d[j] < 250) { alphaPixels++; if (alphaPixels > 16) break }
  }
  const useAlpha = alphaPixels > 16
  const mask = new Uint8ClampedArray(width * height)
  for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
    mask[i] = useAlpha
      ? d[j + 3]
      : Math.round(d[j] * .2126 + d[j + 1] * .7152 + d[j + 2] * .0722)
  }
  return mask
}

function objectRegionMask(docW: number, docH: number, r: Rect, lasso: { x: number; y: number }[] | null): HTMLCanvasElement {
  const out = createCanvas(docW, docH)
  const oc = ctx2d(out)
  oc.fillStyle = '#fff'
  if (lasso?.length && lasso.length >= 3) {
    oc.beginPath()
    oc.moveTo(lasso[0].x, lasso[0].y)
    for (const q of lasso.slice(1)) oc.lineTo(q.x, q.y)
    oc.closePath()
    oc.fill()
  } else {
    oc.fillRect(r.x, r.y, r.w, r.h)
  }
  return out
}

function clickSearchRect(x: number, y: number): Rect {
  const doc = engine.activeDoc
  if (!doc) return { x, y, w: 1, h: 1 }
  const pct = clamp((Number(getOptions('object-select').clickSearch) || 35) / 100, .1, 1)
  const side = Math.max(48, Math.min(Math.max(doc.width, doc.height), Math.min(doc.width, doc.height) * pct))
  return {
    x: clamp(x - side / 2, 0, Math.max(0, doc.width - side)),
    y: clamp(y - side / 2, 0, Math.max(0, doc.height - side)),
    w: Math.min(side, doc.width),
    h: Math.min(side, doc.height),
  }
}

function keepConnectedNearest(mask: Uint8ClampedArray, w: number, h: number, x: number, y: number): Uint8ClampedArray {
  let seed = -1
  let best = Infinity
  const cx = clamp(Math.round(x), 0, w - 1)
  const cy = clamp(Math.round(y), 0, h - 1)
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx
      if (mask[i] < 24) continue
      const d = (xx - cx) * (xx - cx) + (yy - cy) * (yy - cy)
      if (d < best) { best = d; seed = i }
    }
  }
  if (seed < 0) return mask

  const out = new Uint8ClampedArray(mask.length)
  const seen = new Uint8Array(mask.length)
  const q = new Int32Array(mask.length)
  let head = 0, tail = 0
  q[tail++] = seed
  seen[seed] = 1
  while (head < tail) {
    const i = q[head++]
    out[i] = mask[i]
    const px = i % w, py = Math.floor(i / w)
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue
      const nx = px + ox, ny = py + oy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const ni = ny * w + nx
      if (seen[ni] || mask[ni] < 24) continue
      seen[ni] = 1
      q[tail++] = ni
    }
  }
  return out
}

export const objectSelectTool: Tool = {
  id: 'object-select',
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    drag = { startX: p.docX, startY: p.docY, lastX: p.docX, lastY: p.docY, active: true }
    const geometry = getOptions('object-select').geometry
    objectClick = geometry === 'click' ? { x: p.docX, y: p.docY } : null
    rect = geometry === 'click' ? clickSearchRect(p.docX, p.docY) : null
    objectLasso = geometry === 'lasso' ? [{ x: p.docX, y: p.docY }] : []
    engine.pokeOverlay()
  },

  onPointerMove(p: PointerInfo) {
    if (!drag.active) return
    const geometry = getOptions('object-select').geometry
    if (geometry === 'lasso') {
      const last = objectLasso[objectLasso.length - 1]
      const step = 1.5 / Math.max(engine.activeDoc?.view.zoom ?? 1, .25)
      if (!last || Math.hypot(p.docX - last.x, p.docY - last.y) >= step) objectLasso.push({ x: p.docX, y: p.docY })
      if (objectLasso.length) {
        const xs = objectLasso.map(q => q.x), ys = objectLasso.map(q => q.y)
        rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
      }
    } else if (geometry === 'click') {
      objectClick = { x: p.docX, y: p.docY }
      rect = clickSearchRect(p.docX, p.docY)
    } else {
      rect = rectFromPoints(drag.startX, drag.startY, p.docX, p.docY)
    }
    engine.pokeOverlay()
  },

  onPointerUp(p: PointerInfo) {
    if (!drag.active) return
    drag.active = false
    const r = rect
    const lasso = objectLasso.length >= 3 ? objectLasso.slice() : null
    const click = objectClick ? { ...objectClick } : null
    rect = null
    objectLasso = []
    objectClick = null
    if (!r || r.w < 4 || r.h < 4) { engine.pokeOverlay(); return }
    const opts = getOptions('object-select')
    const mode = combineMode(p, opts.mode ?? 'new')
    // show the overlay FIRST (detection is synchronous — defer past the next
    // paint: rAF lets the overlay draw, then the timeout runs the work)
    detecting = true
    detectRect = r
    detectLasso = lasso
    detectClick = click
    engine.pokeOverlay()
    requestAnimationFrame(() => setTimeout(async () => {
      try {
        const doc = engine.activeDoc
        if (!doc) return
        const source = opts.sample === 'layer' && engine.activeLayer
          ? engine.layerCanvasDocSpace(engine.activeLayer.id)
          : getFlatComposite(doc)
        if (!source) return
        const regionMask = objectRegionMask(doc.width, doc.height, r, lasso)
        const allowed = getMaskAlpha(regionMask)
        let mask: Uint8ClampedArray

        if (opts.detector === 'comfyui') {
          try {
            mask = await comfySegmentationMask(source, regionMask, doc.width, doc.height)
          } catch (err) {
            engine.ui?.toast(
              `ComfyUI segmentation unavailable — using built-in detector${err instanceof Error && err.message ? `: ${err.message}` : ''}`,
              'info',
            )
            const img = getImageData(source)
            mask = imageOps.objectSelect(img, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h))
          }
        } else {
          const img = getImageData(source)
          mask = imageOps.objectSelect(img, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h))
        }

        // Provider output is always constrained by the rectangle/lasso the
        // user actually supplied, so an over-eager segmentation workflow
        // cannot unexpectedly select unrelated objects elsewhere.
        for (let i = 0; i < mask.length; i++) if (!allowed[i]) mask[i] = 0
        if (click) mask = keepConnectedNearest(mask, doc.width, doc.height, click.x, click.y)
        const level = opts.level ?? 'balanced'
        if (level !== 'fast') {
          mask = imageOps.refineMask(mask, doc.width, doc.height, level === 'thorough'
            ? { radius: 2, smooth: 3, contrast: 10, feather: 0.4, shiftEdge: 0 }
            : { radius: 1, smooth: 1, contrast: 5, feather: 0.2, shiftEdge: 0 })
        }
        const feather = opts.feather ?? 1
        if (feather > 0) {
          const f = new Float32Array(mask.length)
          for (let i = 0; i < mask.length; i++) f[i] = mask[i]
          const b = gaussianBlurChannel(f, doc.width, doc.height, Math.max(0.6, feather / 2))
          mask = new Uint8ClampedArray(b)
        } else if (opts.antiAlias === false) {
          // Hard-edge mode for pixel art / UI captures.
          for (let i = 0; i < mask.length; i++) mask[i] = mask[i] >= 128 ? 255 : 0
        }
        engine.setSelectionAlpha(mask, mode, 'Object Selection')
      } finally {
        detecting = false
        detectRect = null
        detectLasso = null
        detectClick = null
        engine.pokeOverlay()
      }
    }, 0))
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    const r = detecting ? detectRect : rect
    const poly = detecting ? detectLasso : objectLasso
    if (r && (drag.active || detecting)) {
      const x = r.x * view.zoom + view.panX
      const y = r.y * view.zoom + view.panY
      const rw = r.w * view.zoom, rh = r.h * view.zoom
      if (poly && poly.length >= 2) {
        ctx.save()
        ctx.translate(view.panX, view.panY)
        ctx.scale(view.zoom, view.zoom)
        ctx.beginPath()
        ctx.moveTo(poly[0].x, poly[0].y)
        for (const q of poly.slice(1)) ctx.lineTo(q.x, q.y)
        if (detecting && poly.length >= 3) ctx.closePath()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1 / view.zoom
        ctx.stroke()
        ctx.fillStyle = 'rgba(232,163,61,0.12)'
        if (poly.length >= 3) ctx.fill()
        ctx.restore()
      } else {
        drawDashedRect(ctx, x, y, rw, rh)
      }
      ctx.save()
      if (!(poly && poly.length >= 3)) {
        ctx.fillStyle = 'rgba(232,163,61,0.12)'
        ctx.fillRect(x, y, rw, rh)
      }
      const clickPoint = detecting ? detectClick : objectClick
      if (clickPoint) {
        const sx = clickPoint.x * view.zoom + view.panX
        const sy = clickPoint.y * view.zoom + view.panY
        ctx.strokeStyle = '#e8a33d'
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(sx - 9, sy); ctx.lineTo(sx + 9, sy); ctx.moveTo(sx, sy - 9); ctx.lineTo(sx, sy + 9); ctx.stroke()
      }
      if (detecting) {
        ctx.font = '12px ui-sans-serif, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillStyle = 'rgba(0,0,0,0.75)'
        ctx.fillText('Detecting object…', x + rw / 2 + 1, y + rh / 2 + 1)
        ctx.fillStyle = '#e8a33d'
        ctx.fillText('Detecting object…', x + rw / 2, y + rh / 2)
      }
      ctx.restore()
    } else drawCross(ctx, mouse)
  },
}

// ============================================================
// Quick Selection
// ============================================================
let qsActive = false
let qsMask: HTMLCanvasElement | null = null
let qsImg: ImageData | null = null
let qsSource: HTMLCanvasElement | null = null
let qsAlpha: Uint8ClampedArray | null = null
let qsRefining = false
let lastDab: { x: number; y: number } | null = null
let qsCombineMode: 'new' | 'add' | 'subtract' | 'intersect' = 'new'

export const quickSelectTool: Tool = {
  id: 'quick-select',
  cursor: 'none',

  onPointerDown(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc || p.button !== 0 || qsRefining) return
    const opts = getOptions('quick-select')
    // Cache the chosen sampling source once per stroke. Current-layer sampling
    // is useful for cut-out work; Composite matches Photoshop's Sample All Layers.
    const source = opts.sample === 'layer' && engine.activeLayer
      ? engine.layerCanvasDocSpace(engine.activeLayer.id)
      : getFlatComposite(doc)
    if (!source) return
    qsSource = source
    qsImg = getImageData(source)
    qsMask = toolMaskCanvas()
    qsAlpha = new Uint8ClampedArray(doc.width * doc.height)
    qsCombineMode = combineMode(p, opts.mode ?? 'new')
    qsActive = true
    lastDab = { x: p.docX, y: p.docY }
    qsGrow(p.docX, p.docY)
  },

  onPointerMove(p: PointerInfo) {
    if (!qsActive || !qsImg || !qsAlpha) return
    // recompute the grow region ONCE per pointermove event (not per dab)
    if (!lastDab || Math.hypot(p.docX - lastDab.x, p.docY - lastDab.y) > 1) {
      qsGrow(p.docX, p.docY)
      lastDab = { x: p.docX, y: p.docY }
    }
  },

  onPointerUp() {
    void finishQuickSelection()
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h; void mouse
    if (qsMask && (qsActive || qsRefining)) {
      ctx.save()
      ctx.globalAlpha = qsRefining ? 0.18 : 0.3
      ctx.drawImage(qsMask, view.panX, view.panY, qsMask.width * view.zoom, qsMask.height * view.zoom)
      if (qsRefining) {
        ctx.font = '12px ui-sans-serif, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillStyle = 'rgba(0,0,0,.75)'
        ctx.fillText('Refining selection…', w / 2 + 1, h / 2 + 1)
        ctx.fillStyle = '#e8a33d'
        ctx.fillText('Refining selection…', w / 2, h / 2)
      }
      ctx.restore()
    }
  },
  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    const opts = getOptions('quick-select')
    drawBrushCursor(ctx, mouse, opts.size ?? 40, view.zoom)
  },
}

async function finishQuickSelection() {
  if (!qsActive || !qsAlpha) { qsActive = false; return }
  qsActive = false
  qsRefining = true
  const doc = engine.activeDoc
  const alpha = new Uint8ClampedArray(qsAlpha)
  const source = qsSource
  const roughMask = qsMask
  const opts = getOptions('quick-select')
  let out: Uint8ClampedArray = alpha

  try {
    if (doc && opts.autoEnhance === true && opts.refineProvider === 'comfyui' && source && roughMask) {
      try {
        out = await comfySegmentationMask(source, roughMask, doc.width, doc.height)
      } catch (err) {
        engine.ui?.toast(
          `ComfyUI Quick Selection refinement unavailable — using local refinement${err instanceof Error && err.message ? `: ${err.message}` : ''}`,
          'info',
        )
        out = alpha
      }
    }

    if (doc && opts.autoEnhance === true) {
      out = imageOps.refineMask(out, doc.width, doc.height, {
        radius: opts.refineProvider === 'comfyui' ? 1 : 1.5,
        smooth: 2,
        contrast: 8,
        feather: .3,
        shiftEdge: -2,
      })
    }

    const feather = opts.feather ?? 1
    if (doc && feather > 0) {
      const f = new Float32Array(out.length)
      for (let i = 0; i < out.length; i++) f[i] = out[i]
      const b = gaussianBlurChannel(f, doc.width, doc.height, Math.max(0.6, feather / 2))
      out = new Uint8ClampedArray(b)
    }

    if (out.some(v => v > 0)) engine.setSelectionAlpha(out, qsCombineMode, 'Quick Selection')
  } finally {
    qsMask = null
    qsImg = null
    qsSource = null
    qsAlpha = null
    lastDab = null
    qsRefining = false
    engine.pokeOverlay()
  }
}

/** sample a disk of average color under the cursor, flood-grow with tolerance
 *  bounded to the brush radius, union into the accumulated mask; only the
 *  disk's sub-rectangle is written back to the preview canvas */
function qsGrow(cx: number, cy: number) {
  const doc = engine.activeDoc
  if (!doc || !qsImg || !qsAlpha || !qsMask) return
  const opts = getOptions('quick-select')
  const size = opts.size ?? 40
  const r = size / 2
  const tol = clamp((opts.tolerance ?? 30) * 2.4, 1, 255)
  const ref = diskAverageColor(qsImg, cx, cy, r)
  const grow = growDisk(qsImg, cx, cy, r, ref, tol)

  const cur = qsAlpha
  const x0 = clamp(Math.floor(cx - r) - 1, 0, doc.width - 1)
  const y0 = clamp(Math.floor(cy - r) - 1, 0, doc.height - 1)
  const x1 = clamp(Math.ceil(cx + r) + 1, 0, doc.width)
  const y1 = clamp(Math.ceil(cy + r) + 1, 0, doc.height)
  const rw = x1 - x0, rh = y1 - y0
  if (rw <= 0 || rh <= 0) return
  // union the grow into the accumulated mask + write only the dirty sub-rect
  const sub = new ImageData(rw, rh)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const gi = (y0 + y) * doc.width + (x0 + x)
      const v = grow[gi] > cur[gi] ? grow[gi] : cur[gi]
      cur[gi] = v
      const j = (y * rw + x) * 4
      sub.data[j] = 255; sub.data[j + 1] = 255; sub.data[j + 2] = 255
      sub.data[j + 3] = v
    }
  }
  ctx2d(qsMask).putImageData(sub, x0, y0)
  engine.pokeOverlay()
}
