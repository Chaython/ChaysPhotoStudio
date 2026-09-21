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
import { getImageData, rectFromPoints, clamp, ctx2d } from '../utils/canvas'
import { gaussianBlurChannel } from '../image-ops/core'
import { getFlatComposite } from '../engine/document'
import { diskAverageColor, growDisk } from './dab-utils'
import * as imageOps from '../image-ops'

// ============================================================
// Object Selection
// ============================================================
let drag = newDrag()
let rect: Rect | null = null
let detecting = false
let detectRect: Rect | null = null

export const objectSelectTool: Tool = {
  id: 'object-select',
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    drag = { startX: p.docX, startY: p.docY, lastX: p.docX, lastY: p.docY, active: true }
    rect = null
    engine.pokeOverlay()
  },

  onPointerMove(p: PointerInfo) {
    if (!drag.active) return
    rect = rectFromPoints(drag.startX, drag.startY, p.docX, p.docY)
    engine.pokeOverlay()
  },

  onPointerUp(p: PointerInfo) {
    if (!drag.active) return
    drag.active = false
    const r = rect
    rect = null
    if (!r || r.w < 4 || r.h < 4) { engine.pokeOverlay(); return }
    const opts = getOptions('object-select')
    const mode = combineMode(p, opts.mode ?? 'new')
    // show the overlay FIRST (detection is synchronous — defer past the next
    // paint: rAF lets the overlay draw, then the timeout runs the work)
    detecting = true
    detectRect = r
    engine.pokeOverlay()
    requestAnimationFrame(() => setTimeout(() => {
      try {
        const doc = engine.activeDoc
        if (!doc) return
        const flat = getFlatComposite(doc)
        const img = getImageData(flat)
        let mask = imageOps.objectSelect(
          img,
          Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)
        )
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
        }
        engine.setSelectionAlpha(mask, mode, 'Object Selection')
      } finally {
        detecting = false
        detectRect = null
        engine.pokeOverlay()
      }
    }, 0))
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    const r = detecting ? detectRect : rect
    if (r && (drag.active || detecting)) {
      const x = r.x * view.zoom + view.panX
      const y = r.y * view.zoom + view.panY
      const rw = r.w * view.zoom, rh = r.h * view.zoom
      drawDashedRect(ctx, x, y, rw, rh)
      ctx.save()
      ctx.fillStyle = 'rgba(232,163,61,0.12)'
      ctx.fillRect(x, y, rw, rh)
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
let qsAlpha: Uint8ClampedArray | null = null
let lastDab: { x: number; y: number } | null = null
let qsCombineMode: 'new' | 'add' | 'subtract' | 'intersect' = 'new'

export const quickSelectTool: Tool = {
  id: 'quick-select',
  cursor: 'none',

  onPointerDown(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc || p.button !== 0) return
    const opts = getOptions('quick-select')
    // Cache the chosen sampling source once per stroke. Current-layer sampling
    // is useful for cut-out work; Composite matches Photoshop's Sample All Layers.
    const source = opts.sample === 'layer' && engine.activeLayer
      ? engine.layerCanvasDocSpace(engine.activeLayer.id)
      : getFlatComposite(doc)
    if (!source) return
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
    if (!qsActive || !qsAlpha) { qsActive = false; return }
    qsActive = false
    const alpha = qsAlpha
    const opts = getOptions('quick-select')
    let out = alpha
    const feather = opts.feather ?? 1
    if (feather > 0) {
      const f = new Float32Array(alpha.length)
      for (let i = 0; i < alpha.length; i++) f[i] = alpha[i]
      const doc = engine.activeDoc
      if (doc) {
        const b = gaussianBlurChannel(f, doc.width, doc.height, Math.max(0.6, feather / 2))
        out = new Uint8ClampedArray(b)
      }
    }
    if (opts.autoEnhance === true) {
      const doc = engine.activeDoc
      if (doc) out = imageOps.refineMask(out, doc.width, doc.height, { radius: 1.5, smooth: 2, contrast: 8, feather: .3, shiftEdge: -2 })
    }
    const has = out.some(v => v > 0)
    if (has) engine.setSelectionAlpha(out, qsCombineMode, 'Quick Selection')
    qsMask = null; qsImg = null; qsAlpha = null; lastDab = null
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h; void mouse
    if (qsMask && qsActive) {
      ctx.save()
      ctx.globalAlpha = 0.3
      ctx.drawImage(qsMask, view.panX, view.panY, qsMask.width * view.zoom, qsMask.height * view.zoom)
      ctx.restore()
    }
  },
  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    const opts = getOptions('quick-select')
    drawBrushCursor(ctx, mouse, opts.size ?? 40, view.zoom)
  },
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
