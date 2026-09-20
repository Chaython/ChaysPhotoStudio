// ============================================================
// Healing Brush / Spot Healing / Patch — professional upgrade (Task 2-b)
//
//  Healing Brush: frequency-separation healing. Source dabs accumulate into
//  the stroke canvas (baseline), but before committing we compute the target
//  low-frequency (gaussian ≈ size/3) of the ORIGINAL layer pixels and the
//  source low-frequency of the stroke canvas; healed = stroke + (targetLow -
//  sourceLow) restricted to stroke alpha — matches luminance/ambient light of
//  the surroundings like PS.
//
//  Spot Healing: stroke-mask approach; content-aware runs imageOps.inpaint on
//  the layer ImageData with a hardness-aware, 1px-dilated mask. 'proximity'
//  mode fills each blob with a heavy blur of the surrounding ring.
//
//  Patch: two-phase UX — (1) freehand lasso the region, (2) drag the region
//  ghost to a source location and release to commit. 'texture' = plain copy,
//  'content-aware' = frequency-matched heal. The lasso IS the region (local
//  mask canvas, engine.mutateLayerPixels, no selection restriction).
// ============================================================
import type { Tool, PointerInfo, Rect } from '../types'
import { engine } from '../engine/engine'
import { getOptions, getFgColor, getBgColor, brushSettingsFrom, walkDabs, drawBrushCursor, drawCross, toolMaskCanvas, softDab } from './shared'
import { buildSourceDab, sourcePointFor, frequencyHeal, pressureFlow } from './dab-utils'
import { createCanvas, ctx2d, getImageData, putImageData, cloneCanvas, clamp, getMaskAlpha } from '../utils/canvas'
import { dilateMask, gaussianBlurChannel } from '../image-ops/core'
import { useEditorStore } from '../store'
import * as imageOps from '../image-ops'
import { getFlatComposite } from '../engine/document'
import { paintBuiltinPattern } from './patterns'

/** rect clamped to doc bounds */
function clampedRect(r: Rect, w: number, h: number): Rect {
  const x0 = clamp(Math.floor(r.x), 0, w)
  const y0 = clamp(Math.floor(r.y), 0, h)
  const x1 = clamp(Math.ceil(r.x + r.w), 0, w)
  const y1 = clamp(Math.ceil(r.y + r.h), 0, h)
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

// ============================================================
// Healing Brush
// ============================================================
interface HealState {
  active: boolean
  last: { x: number; y: number } | null
  ref: { x: number; y: number } | null         // aligned anchor (cursor == source)
  source: HTMLCanvasElement | null             // snapshot of source canvas
  orig: HTMLCanvasElement | null               // pre-stroke layer snapshot
  dabs: { x: number; y: number }[]
}
const hst: HealState = { active: false, last: null, ref: null, source: null, orig: null, dabs: [] }

function buildHealingPatternDab(x: number, y: number, radius: number, hardness: number, opts: Record<string, any>) {
  const side = Math.max(4, Math.ceil(radius * 2) + 4)
  const center = side / 2
  const out = createCanvas(side, side)
  const oc = ctx2d(out)
  paintBuiltinPattern(oc, side, side, {
    kind: String(opts.pattern ?? 'checker'),
    scale: clamp((Number(opts.patternScale) || 100) / 100, .25, 4),
    offsetX: Number(opts.patternOffsetX) || 0,
    offsetY: Number(opts.patternOffsetY) || 0,
    fg: getFgColor(),
    bg: getBgColor(),
    originX: x - center,
    originY: y - center,
  })
  oc.globalCompositeOperation = 'destination-in'
  const inner = radius * clamp(hardness / 100, 0, .98)
  const grad = oc.createRadialGradient(center, center, inner, center, center, Math.max(radius, .5))
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  oc.fillStyle = grad
  oc.beginPath()
  oc.arc(center, center, Math.max(radius, .5), 0, Math.PI * 2)
  oc.fill()
  oc.globalCompositeOperation = 'source-over'
  return out
}

export const healingBrushTool: Tool = {
  id: 'healing-brush',
  requiresLayer: true,
  cursor: 'none',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    const layer = engine.activeLayer
    if (!doc || !layer) return
    const opts = getOptions('healing-brush')

    const patternMode = opts.sample === 'pattern'
    if (p.alt && !patternMode) {
      // ---- set healing source (layer snapshot, doc-space) ----
      const c = opts.sample === 'composite' ? getFlatComposite(doc) : engine.layerCanvasDocSpace(layer.id)
      if (!c) return
      engine.cloneSource = { x: p.docX, y: p.docY, layerId: layer.id }
      hst.source = cloneCanvas(c)
      hst.ref = null
      engine.ui?.toast('Healing source set', 'info')
      engine.requestRender()
      return
    }

    if (!patternMode && (!engine.cloneSource || !hst.source)) {
      engine.ui?.toast('Alt+click to set a healing source first, or choose Pattern as the source', 'info')
      return
    }

    engine.beginStroke(layer.id, { opacity: opts.opacity ?? 100, blendMode: opts.blendMode ?? 'normal' })
    // snapshot the pre-stroke layer AFTER beginStroke (it rasterizes if needed)
    const pre = engine.layerCanvasDocSpace(layer.id)
    hst.orig = pre ? cloneCanvas(pre) : null
    hst.active = true
    hst.last = { x: p.docX, y: p.docY }
    hst.dabs = [{ x: p.docX, y: p.docY }]
    if (!patternMode && (opts.aligned === false || !hst.ref)) hst.ref = { x: p.docX, y: p.docY }
    healDab(p.docX, p.docY, p)
  },

  onPointerMove(p: PointerInfo) {
    if (!hst.active || !hst.last) return
    const opts = getOptions('healing-brush')
    const settings = brushSettingsFrom(opts)
    const spacing = Math.max(1, settings.size * settings.spacing)
    let stepped = false
    for (const d of walkDabs(hst.last.x, hst.last.y, p.docX, p.docY, spacing)) {
      healDab(d.x, d.y, p)
      hst.dabs.push(d)
      stepped = true
    }
    if (stepped || Math.hypot(p.docX - hst.last.x, p.docY - hst.last.y) >= spacing) {
      hst.last = { x: p.docX, y: p.docY }
    }
  },

  onPointerUp() {
    if (!hst.active) return
    hst.active = false
    hst.last = null
    commitHeal()
  },

  onDeactivate() {
    if (!hst.active) return
    hst.active = false
    hst.last = null
    commitHeal()
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    const opts = getOptions('healing-brush')
    const size = opts.size ?? 40
    const src = engine.cloneSource
    const patternMode = opts.sample === 'pattern'

    // source marker
    if (!patternMode && src && hst.source) {
      const sx = src.x * view.zoom + view.panX
      const sy = src.y * view.zoom + view.panY
      ctx.save()
      ctx.strokeStyle = '#4ec9b0'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(sx - 8, sy); ctx.lineTo(sx + 8, sy)
      ctx.moveTo(sx, sy - 8); ctx.lineTo(sx, sy + 8)
      ctx.stroke()
      ctx.restore()
    }

    // ghost of sampled source area under cursor
    if (!patternMode && src && mouse && hst.ref) {
      const docX = (mouse.x - view.panX) / view.zoom
      const docY = (mouse.y - view.panY) / view.zoom
      const rot = ((Number(opts.rotate) || 0) * Math.PI) / 180
      const scale = Math.max(.25, Math.min(4, (Number(opts.scale) || 100) / 100))
      const sp = sourcePointFor(docX, docY, hst.ref.x, hst.ref.y, src.x, src.y, rot, opts.mirrored === true, scale)
      const gx = sp.x * view.zoom + view.panX
      const gy = sp.y * view.zoom + view.panY
      const r = Math.max(2, (size / 2) * view.zoom)
      ctx.save()
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = 'rgba(78,201,176,0.8)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(gx, gy, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  },

  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    const opts = getOptions('healing-brush')
    const size = opts.size ?? 40
    if (hst.active || opts.sample === 'pattern') drawBrushCursor(ctx, mouse, size, view.zoom)
    else if (engine.cloneSource && hst.source) drawBrushCursor(ctx, mouse, size, view.zoom)
    else drawCross(ctx, mouse)
  },
}

function healDab(x: number, y: number, p: PointerInfo) {
  const doc = engine.activeDoc
  if (!doc) return
  const opts = getOptions('healing-brush')
  const settings = brushSettingsFrom(opts)
  const r = settings.size / 2
  let dabCanvas: HTMLCanvasElement | null = null

  if (opts.sample === 'pattern') {
    dabCanvas = buildHealingPatternDab(x, y, r, settings.hardness, opts)
  } else {
    if (!hst.source || !hst.ref) return
    const src = engine.cloneSource
    if (!src) return
    const rot = ((Number(opts.rotate) || 0) * Math.PI) / 180
    const scale = Math.max(.25, Math.min(4, (Number(opts.scale) || 100) / 100))
    const mirrored = opts.mirrored === true
    const sp = sourcePointFor(x, y, hst.ref.x, hst.ref.y, src.x, src.y, rot, mirrored, scale)
    dabCanvas = buildSourceDab(hst.source, sp.x, sp.y, r, settings.hardness, rot, mirrored, scale)
  }

  if (!dabCanvas) return
  const flow = pressureFlow(p.pressure, p.pointerType === 'pen' && opts.pressure !== false, settings.flow / 100)
  engine.dab(x, y, (ctx, dx, dy) => {
    ctx.drawImage(dabCanvas!, dx - dabCanvas!.width / 2, dy - dabCanvas!.height / 2)
  }, flow)
}

/** frequency-separation commit: replace the raw stroke with the healed result */
function commitHeal() {
  const doc = engine.activeDoc
  try {
    if (doc?._stroke && hst.orig && hst.dabs.length) {
      const opts = getOptions('healing-brush')
      const settings = brushSettingsFrom(opts)
      const r = settings.size / 2
      const diffusion = clamp(Number(opts.diffusion) || 5, 1, 7)
      const lowR = Math.max(2, Math.round(settings.size * (0.10 + diffusion * 0.045)))

      // stroke bbox padded by brush radius + blur radius
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const d of hst.dabs) {
        if (d.x < minX) minX = d.x
        if (d.y < minY) minY = d.y
        if (d.x > maxX) maxX = d.x
        if (d.y > maxY) maxY = d.y
      }
      const pad = r + lowR + 2
      const region = clampedRect(
        { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 },
        doc.width, doc.height
      )
      if (region.w > 0 && region.h > 0) {
        // composited result = original + stroke over it
        const result = cloneCanvas(hst.orig)
        const rc = ctx2d(result)
        rc.drawImage(doc._stroke, 0, 0)

        const target = rc.getImageData(region.x, region.y, region.w, region.h)
        const base = ctx2d(hst.orig).getImageData(region.x, region.y, region.w, region.h)
        const strokeRegion = ctx2d(doc._stroke).getImageData(region.x, region.y, region.w, region.h)
        const restrict = new Uint8ClampedArray(region.w * region.h)
        for (let i = 0, j = 3; i < restrict.length; i++, j += 4) restrict[i] = strokeRegion.data[j]

        frequencyHeal(target, base, restrict, lowR)
        rc.putImageData(target, region.x, region.y)

        // commit the healed stroke through the engine (selection + opacity +
        // COW history handled by endStroke)
        doc._stroke = result
      }
    }
    engine.endStroke('Healing Brush')
  } finally {
    // keep the source snapshot for the next stroke (aligned workflow), drop
    // the per-stroke state
    if (!engine.cloneSource) hst.source = null
    hst.orig = null
    hst.dabs = []
  }
}

// ============================================================
// Spot Healing (content-aware brush)
// ============================================================
let spotMask: HTMLCanvasElement | null = null
let spotActive = false
let spotLast: { x: number; y: number } | null = null

export const spotHealingTool: Tool = {
  id: 'spot-healing',
  requiresLayer: true,
  cursor: 'none',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    const layer = engine.activeLayer
    if (!doc || !layer) return
    spotMask = toolMaskCanvas()
    spotActive = true
    spotLast = { x: p.docX, y: p.docY }
    spotMark(p.docX, p.docY)
  },

  onPointerMove(p: PointerInfo) {
    if (!spotActive || !spotLast || !spotMask) return
    const opts = getOptions('spot-healing')
    const spacing = Math.max(2, (opts.size ?? 40) / 3)
    for (const d of walkDabs(spotLast.x, spotLast.y, p.docX, p.docY, spacing)) spotMark(d.x, d.y)
    if (Math.hypot(p.docX - spotLast.x, p.docY - spotLast.y) >= spacing) spotLast = { x: p.docX, y: p.docY }
    engine.requestRender()
  },

  async onPointerUp() {
    if (!spotActive || !spotMask) { spotActive = false; return }
    spotActive = false
    spotLast = null
    const layer = engine.activeLayer
    const doc = engine.activeDoc
    if (!layer || !doc) { spotMask = null; return }
    const opts = getOptions('spot-healing')
    const mask = spotMask
    spotMask = null

    const outputNew = opts.output === 'new'
    const sourceLayer = engine.layerCanvasDocSpace(layer.id)
    if (!sourceLayer) return
    // Heal in DOC space. Sample All Layers controls only the source pixels;
    // the final healed patch is masked before it reaches the destination, so
    // sampling the composite never flattens unrelated layers into this one.
    const work = opts.sampleAllLayers === true
      ? cloneCanvas(getFlatComposite(doc))
      : cloneCanvas(sourceLayer)
    const img = getImageData(work)
    const original = new ImageData(img.width, img.height)
    original.data.set(img.data)

    // Structure controls how tightly we preserve the painted footprint.
    // Lower structure values synthesize a slightly wider neighborhood.
    const structure = clamp(Number(opts.structure) || 5, 1, 7)
    let m = getMaskAlpha(mask)
    const dilation = Math.max(1, Math.round((8 - structure) / 2))
    m = dilateMask(m, doc.width, doc.height, dilation)
    const hasMask = m.some(v => v > 0)
    if (!hasMask) return

    const store = useEditorStore.getState()
    if (opts.type === 'proximity') {
      // cheap proximity match: fill each blob with a blur of the surrounding ring
      store.setProgress({ active: true, label: 'Spot Healing (Proximity)', value: 0.5 })
      const blurred = new ImageData(doc.width, doc.height)
      blurred.data.set(img.data)
      frequencyHealProximity(blurred, m, Math.max(6, (opts.size ?? 40) / 2))
      // copy masked pixels back
      for (let i = 0; i < m.length; i++) {
        const a = m[i] / 255
        if (a <= 0) continue
        const j = i * 4
        for (let c = 0; c < 3; c++) img.data[j + c] = img.data[j + c] * (1 - a) + blurred.data[j + c] * a
      }
      store.setProgress(null)
    } else {
      store.setProgress({ active: true, label: 'Content-Aware Spot Healing', value: 0 })
      await imageOps.inpaint(img, m, v => store.setProgress({ active: true, label: 'Content-Aware Spot Healing', value: v }))
      store.setProgress(null)
    }

    // Photoshop-style Color adaptation: match the healed low-frequency tone
    // to a local proximity reconstruction while retaining synthesized detail.
    const colorAdapt = clamp(Number(opts.color) || 0, 0, 10)
    if (colorAdapt > 0) {
      const localTone = new ImageData(original.width, original.height)
      localTone.data.set(original.data)
      frequencyHealProximity(localTone, m, Math.max(6, (opts.size ?? 40) * (.35 + colorAdapt * .04)))
      const lowR = Math.max(2, Math.round((opts.size ?? 40) * (.04 + colorAdapt * .018)))
      frequencyHeal(img, localTone, m, lowR)
    }

    // Isolate ONLY the healed footprint. This is critical when Sample All
    // Layers is enabled: the composite is a sampling source, never a flatten.
    const patch = createCanvas(doc.width, doc.height)
    putImageData(patch, img)
    const alphaMask = createCanvas(doc.width, doc.height)
    const amd = new ImageData(doc.width, doc.height)
    for (let i = 0, j = 3; i < m.length; i++, j += 4) {
      amd.data[j] = m[i]
    }
    putImageData(alphaMask, amd)
    const pc = ctx2d(patch)
    pc.globalCompositeOperation = 'destination-in'
    pc.drawImage(alphaMask, 0, 0)
    if (doc.selection) pc.drawImage(doc.selection.mask, 0, 0)
    pc.globalCompositeOperation = 'source-over'

    if (outputNew) {
      engine.addRasterLayer('Spot Healing', { canvas: patch })
    } else {
      const l = engine.mutateLayerPixels(layer.id)
      if (!l?.canvas) return
      ctx2d(l.canvas).drawImage(patch, -(l.offsetX ?? 0), -(l.offsetY ?? 0))
      engine.pushHistory('Spot Healing')
      engine.emit()
    }
  },

    renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    if (spotMask && spotActive) {
      ctx.save()
      ctx.globalAlpha = 0.3
      ctx.drawImage(spotMask, view.panX, view.panY, spotMask.width * view.zoom, spotMask.height * view.zoom)
      ctx.restore()
    }
  },
  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    const opts = getOptions('spot-healing')
    drawBrushCursor(ctx, mouse, opts.size ?? 40, view.zoom)
  },
}

/** replace masked pixels with a diffusion of the surrounding ring color (proximity match) */
function frequencyHealProximity(img: ImageData, mask: Uint8ClampedArray, radius: number) {
  const { width: w, height: h, data } = img
  // bound all work to the mask bbox (spot strokes are small)
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return
  const rad = Math.max(2, Math.round(radius / 3))
  const pad = rad * 4 + 4
  const x0 = Math.max(0, minX - pad), x1 = Math.min(w - 1, maxX + pad)
  const y0 = Math.max(0, minY - pad), y1 = Math.min(h - 1, maxY + pad)
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1
  const bn = bw * bh

  // seed known (unmasked) colors; masked pixels start unknown
  let kr = new Float32Array(bn), kg = new Float32Array(bn), kb = new Float32Array(bn)
  const kn = new Float32Array(bn)
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const gi = (y + y0) * w + (x + x0)
      const li = y * bw + x
      if (mask[gi] > 0) continue
      kn[li] = 1
      kr[li] = data[gi * 4]; kg[li] = data[gi * 4 + 1]; kb[li] = data[gi * 4 + 2]
    }
  }

  // iterative diffusion: each unknown pixel pulls the average of known ring samples
  const step = Math.max(1, Math.round(rad / 2))
  for (let pass = 0; pass < 4; pass++) {
    const nr = new Float32Array(bn), ng = new Float32Array(bn), nb = new Float32Array(bn), nn = new Float32Array(bn)
    let unknown = 0
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const li = y * bw + x
        if (kn[li] > 0) { nr[li] = kr[li]; ng[li] = kg[li]; nb[li] = kb[li]; nn[li] = 1; continue }
        let ar = 0, ag = 0, ab = 0, an = 0
        for (let oy = -rad; oy <= rad; oy += step) {
          for (let ox = -rad; ox <= rad; ox += step) {
            if (!ox && !oy) continue
            const yy = clamp(y + oy, 0, bh - 1), xx = clamp(x + ox, 0, bw - 1)
            const lj = yy * bw + xx
            if (kn[lj] > 0) { ar += kr[lj]; ag += kg[lj]; ab += kb[lj]; an++ }
          }
        }
        if (an > 0) { nr[li] = ar / an; ng[li] = ag / an; nb[li] = ab / an; nn[li] = 1 }
        else unknown++
      }
    }
    kr = nr; kg = ng; kb = nb
    for (let i = 0; i < bn; i++) kn[i] = nn[i]
    if (unknown === 0) break
  }

  // write back + 1-tap local smoothing so the fill blends with the ring
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const li = y * bw + x
      const gi = (y + y0) * w + (x + x0)
      if (mask[gi] <= 0 || kn[li] <= 0) continue
      let r = kr[li], g = kg[li], b = kb[li], n = 1
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const yy = clamp(y + oy, 0, bh - 1), xx = clamp(x + ox, 0, bw - 1)
        const lj = yy * bw + xx
        if (kn[lj] > 0) { r += kr[lj]; g += kg[lj]; b += kb[lj]; n++ }
      }
      data[gi * 4] = r / n; data[gi * 4 + 1] = g / n; data[gi * 4 + 2] = b / n
    }
  }
}

function spotMark(x: number, y: number) {
  if (!spotMask) return
  const opts = getOptions('spot-healing')
  softDab(ctx2d(spotMask), x, y, (opts.size ?? 40) / 2, opts.hardness ?? 60, '#ffffff')
}

// ============================================================
// Patch Tool — freehand lasso, then drag to source, release to commit
// ============================================================
type PatchPhase = 'idle' | 'defining' | 'moving'
let patchPhase: PatchPhase = 'idle'
let lassoPts: { x: number; y: number }[] = []
let lassoMask: HTMLCanvasElement | null = null    // full-size soft lasso mask
let lassoPath: Path2D | null = null
let lassoBBox: Rect | null = null
let moveStart: { x: number; y: number } | null = null
let moveDelta: { x: number; y: number } = { x: 0, y: 0 }

function resetPatch() {
  patchPhase = 'idle'
  lassoPts = []
  lassoMask = null
  lassoPath = null
  lassoBBox = null
  moveStart = null
  moveDelta = { x: 0, y: 0 }
  engine.requestRender()
}

function lassoPolygonPath(pts: { x: number; y: number }[]): Path2D {
  const path = new Path2D()
  path.moveTo(pts[0].x, pts[0].y)
  for (const p of pts.slice(1)) path.lineTo(p.x, p.y)
  path.closePath()
  return path
}

/** build the lasso mask canvas (slightly blurred for anti-aliased edges) */
function finalizeLasso() {
  const doc = engine.activeDoc
  if (!doc || lassoPts.length < 3) { resetPatch(); return }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of lassoPts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  lassoBBox = clampedRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, doc.width, doc.height)
  if (lassoBBox.w < 4 || lassoBBox.h < 4) { resetPatch(); return }

  const mask = createCanvas(doc.width, doc.height)
  const mc = ctx2d(mask)
  mc.fillStyle = '#ffffff'
  lassoPath = lassoPolygonPath(lassoPts)
  mc.fill(lassoPath)
  // 1px soft edge
  const md = getImageData(mask)
  const f = new Float32Array(doc.width * doc.height)
  for (let i = 0, j = 3; i < f.length; i++, j += 4) f[i] = md.data[j]
  const b = gaussianBlurChannel(f, doc.width, doc.height, 0.8)
  for (let i = 0, j = 3; i < b.length; i++, j += 4) md.data[j] = b[i]
  putImageData(mask, md)
  lassoMask = mask
  patchPhase = 'moving'
  moveDelta = { x: 0, y: 0 }
  const direction = getOptions('patch').direction ?? 'source'
  engine.ui?.toast(direction === 'destination'
    ? 'Now drag the selected good pixels over the destination and release'
    : 'Now drag the patch to a source area and release', 'info')
  engine.requestRender()
}

export const patchTool: Tool = {
  id: 'patch',
  requiresLayer: true,
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    const layer = engine.activeLayer
    const doc = engine.activeDoc
    if (!layer || !doc || p.button !== 0) return
    if (patchPhase === 'idle' || patchPhase === 'defining') {
      // (re)start freehand lasso
      patchPhase = 'defining'
      lassoPts = [{ x: p.docX, y: p.docY }]
      lassoMask = null
      lassoPath = null
      engine.requestRender()
    } else if (patchPhase === 'moving') {
      moveStart = { x: p.docX, y: p.docY }
      moveDelta = { x: 0, y: 0 }
    }
  },

  onPointerMove(p: PointerInfo) {
    if (patchPhase === 'defining') {
      const last = lassoPts[lassoPts.length - 1]
      if (!last || Math.hypot(p.docX - last.x, p.docY - last.y) > 1.5) lassoPts.push({ x: p.docX, y: p.docY })
      engine.requestRender()
    } else if (patchPhase === 'moving' && moveStart) {
      moveDelta = { x: p.docX - moveStart.x, y: p.docY - moveStart.y }
      engine.requestRender()
    }
  },

  onPointerUp() {
    if (patchPhase === 'defining') {
      finalizeLasso()
    } else if (patchPhase === 'moving') {
      if (moveStart) commitPatch()
      else resetPatch()
    }
  },

  onDoubleClick() {
    if (patchPhase === 'defining') finalizeLasso()
    else if (patchPhase === 'moving') commitPatch()
  },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (patchPhase !== 'idle') { resetPatch(); return true }
    }
    if (e.key === 'Enter' && patchPhase === 'moving') { commitPatch(); return true }
    return false
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    if (patchPhase === 'defining' && lassoPts.length > 1) {
      ctx.save()
      ctx.translate(view.panX, view.panY)
      ctx.scale(view.zoom, view.zoom)
      ctx.beginPath()
      ctx.moveTo(lassoPts[0].x, lassoPts[0].y)
      for (const p of lassoPts.slice(1)) ctx.lineTo(p.x, p.y)
      if (mouse) ctx.lineTo((mouse.x - view.panX) / view.zoom, (mouse.y - view.panY) / view.zoom)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5 / view.zoom
      ctx.setLineDash([])
      ctx.stroke()
      ctx.restore()
      drawCross(ctx, mouse)
    } else if (patchPhase === 'moving' && lassoPath && lassoBBox) {
      const dx = moveDelta.x, dy = moveDelta.y
      ctx.save()
      ctx.translate(view.panX, view.panY)
      ctx.scale(view.zoom, view.zoom)
      // faint original region
      ctx.fillStyle = 'rgba(78,201,176,0.10)'
      ctx.fill(lassoPath)
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 1 / view.zoom
      ctx.setLineDash([4 / view.zoom, 3 / view.zoom])
      ctx.stroke(lassoPath)
      // Ghost preview mirrors the actual commit direction.
      // Source mode: moved outline samples the pixels UNDER the moved outline.
      // Destination mode: the originally selected pixels travel with the outline.
      const ghostLayer = engine.activeLayer
      const layerCv = ghostLayer ? engine.layerCanvas(ghostLayer.id) : null
      if (layerCv && ghostLayer) {
        const gox = ghostLayer.kind === 'raster' ? (ghostLayer.offsetX ?? 0) : 0
        const goy = ghostLayer.kind === 'raster' ? (ghostLayer.offsetY ?? 0) : 0
        const direction = getOptions('patch').direction ?? 'source'
        ctx.save()
        ctx.translate(dx, dy)
        ctx.clip(lassoPath)
        ctx.globalAlpha = 0.55
        if (direction === 'source') {
          // Keep image coordinates stationary while only the clip path moves.
          ctx.translate(-dx, -dy)
          ctx.drawImage(layerCv, gox, goy)
        } else {
          // Carry the selected source pixels with the dragged patch.
          ctx.drawImage(layerCv, gox, goy)
        }
        ctx.restore()
      }
      ctx.save()
      ctx.translate(dx, dy)
      ctx.strokeStyle = '#4ec9b0'
      ctx.lineWidth = 1.5 / view.zoom
      ctx.setLineDash([])
      ctx.stroke(lassoPath)
      ctx.restore()
      ctx.restore()
      // status hint
      const hx = (lassoBBox.x + dx + lassoBBox.w / 2) * view.zoom + view.panX
      const hy = (lassoBBox.y + dy + lassoBBox.h / 2) * view.zoom + view.panY
      ctx.save()
      ctx.font = '11px ui-sans-serif, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(0,0,0,0.75)'
      const hint = (getOptions('patch').direction ?? 'source') === 'destination'
        ? 'drag to destination · release to apply · Esc cancels'
        : 'drag to source · release to apply · Esc cancels'
      ctx.fillText(hint, hx + 1, hy + 1)
      ctx.fillStyle = '#4ec9b0'
      ctx.fillText(hint, hx, hy)
      ctx.restore()
    } else {
      drawCross(ctx, mouse)
    }
  },
}

function commitPatch() {
  const doc = engine.activeDoc
  const layer = engine.activeLayer
  if (!doc || !layer || !lassoMask || !lassoBBox || !lassoPath) { resetPatch(); return }
  const opts = getOptions('patch')
  const direction = opts.direction === 'destination' ? 'destination' : 'source'

  // Sampling source and output destination are deliberately separate. When
  // Sample All Layers is enabled we sample the flattened composite, but write
  // only the healed patch into the active layer — never flatten other layers.
  const activeBefore = engine.layerCanvasDocSpace(layer.id)
  const sampled = opts.sampleAllLayers === true ? getFlatComposite(doc) : activeBefore
  if (!activeBefore || !sampled) { resetPatch(); return }
  const targetBefore = cloneCanvas(activeBefore)
  const sourceBefore = cloneCanvas(sampled)

  const l = engine.mutateLayerPixels(layer.id)
  if (!l?.canvas) { resetPatch(); return }

  const dx = Math.round(moveDelta.x), dy = Math.round(moveDelta.y)
  if (Math.abs(dx) + Math.abs(dy) < 1) {
    moveStart = null
    moveDelta = { x: 0, y: 0 }
    engine.requestRender()
    return
  }

  const targetMask = direction === 'source'
    ? cloneCanvas(lassoMask)
    : (() => {
        const m = createCanvas(doc.width, doc.height)
        ctx2d(m).drawImage(lassoMask!, dx, dy)
        return m
      })()

  // Build only the patch pixels. Source mode samples from the dragged-to area
  // and writes back into the original lasso. Destination mode carries the
  // originally selected good pixels to the dragged destination.
  const tmp = createCanvas(doc.width, doc.height)
  const tc = ctx2d(tmp)
  if (direction === 'source') tc.drawImage(sourceBefore, -dx, -dy)
  else tc.drawImage(sourceBefore, dx, dy)
  tc.globalCompositeOperation = 'destination-in'
  tc.drawImage(targetMask, 0, 0)
  tc.globalCompositeOperation = 'source-over'

  const result = cloneCanvas(targetBefore)
  const rc = ctx2d(result)
  rc.drawImage(tmp, 0, 0)

  const targetBBox: Rect = direction === 'source'
    ? { ...lassoBBox }
    : { x: lassoBBox.x + dx, y: lassoBBox.y + dy, w: lassoBBox.w, h: lassoBBox.h }

  if (opts.heal !== 'texture') {
    // Match low-frequency color/lighting to the destination while retaining
    // the sampled high-frequency texture.
    const pad = Math.max(4, Math.round(Math.min(lassoBBox.w, lassoBBox.h) / 6))
    const region = clampedRect(
      { x: targetBBox.x - pad, y: targetBBox.y - pad, w: targetBBox.w + pad * 2, h: targetBBox.h + pad * 2 },
      doc.width, doc.height
    )
    if (region.w > 0 && region.h > 0) {
      const target = rc.getImageData(region.x, region.y, region.w, region.h)
      const base = ctx2d(targetBefore).getImageData(region.x, region.y, region.w, region.h)
      const maskRegion = ctx2d(targetMask).getImageData(region.x, region.y, region.w, region.h)
      const restrict = new Uint8ClampedArray(region.w * region.h)
      for (let i = 0, j = 3; i < restrict.length; i++, j += 4) restrict[i] = maskRegion.data[j]
      const diffusion = clamp(Number(opts.diffusion) || 5, 1, 7)
      const lowR = Math.max(2, Math.round(Math.min(lassoBBox.w, lassoBBox.h) * (0.04 + diffusion * 0.012)))
      frequencyHeal(target, base, restrict, lowR)
      rc.putImageData(target, region.x, region.y)
    }
  }

  // Respect any active selection in addition to the patch lasso.
  if (doc.selection) {
    const diff = createCanvas(doc.width, doc.height)
    const dc = ctx2d(diff)
    dc.drawImage(result, 0, 0)
    dc.globalCompositeOperation = 'destination-in'
    dc.drawImage(doc.selection.mask, 0, 0)
    dc.globalCompositeOperation = 'source-over'
    const final = cloneCanvas(targetBefore)
    ctx2d(final).drawImage(diff, 0, 0)
    // Only overwrite the document-space area; preserve raster pixels hanging
    // outside the canvas so moving the layer back can still reveal them.
    ctx2d(l.canvas).drawImage(final, -(l.offsetX ?? 0), -(l.offsetY ?? 0))
  } else {
    ctx2d(l.canvas).drawImage(result, -(l.offsetX ?? 0), -(l.offsetY ?? 0))
  }

  resetPatch()
  engine.pushHistory(direction === 'destination' ? 'Patch Destination' : 'Patch Source')
  engine.emit()
}
