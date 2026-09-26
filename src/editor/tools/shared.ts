// Shared tool helpers: options, combine modes, dab interpolation, cursors
import { useEditorStore } from '../store'
import { engine } from '../engine/engine'
import type { SelectionCombine, ToolId, BrushSettings, PointerInfo } from '../types'
import { createCanvas, ctx2d, clamp, hexToRgb } from '../utils/canvas'

export function getOptions(tool: ToolId): Record<string, any> {
  const opts = useEditorStore.getState().toolOptions[tool]
  return opts ?? {}
}

export function getFgColor(): string { return useEditorStore.getState().fgColor }
export function getBgColor(): string { return useEditorStore.getState().bgColor }

export function combineMode(p: { shift: boolean; alt: boolean }, baseMode: SelectionCombine = 'new'): SelectionCombine {
  if (p.shift && p.alt) return 'intersect'
  if (p.shift) return 'add'
  if (p.alt) return 'subtract'
  return baseMode
}

export function brushSettingsFrom(opts: Record<string, any>, color?: string): BrushSettings {
  return {
    size: opts.size ?? 40,
    hardness: opts.hardness ?? 80,
    opacity: opts.opacity ?? 100,
    flow: opts.flow ?? 100,
    spacing: (opts.spacing ?? 15) / 100,
    color,
  }
}

const MAX_DABS_PER_POINTER_EVENT = 256

/** Walk dab positions between two points honoring spacing.
 *
 * Pointer streams can occasionally coalesce into a very large jump. Never
 * create hundreds or thousands of dabs in one JS turn: once the safety budget is reached,
 * distribute the capped dabs across the whole segment so the stroke still
 * reaches the current pointer without an apparent gap.
 */
export function walkDabs(x0: number, y0: number, x1: number, y1: number, spacingPx: number): { x: number; y: number }[] {
  const dx = x1 - x0, dy = y1 - y0
  const dist = Math.hypot(dx, dy)
  const step = Math.max(0.5, spacingPx)
  if (dist < 0.01) return []
  const ideal = Math.floor(dist / step)
  if (ideal <= 0) return []
  const n = Math.min(MAX_DABS_PER_POINTER_EVENT, ideal)
  const capped = ideal > n
  const out: { x: number; y: number }[] = new Array(n)
  for (let i = 1; i <= n; i++) {
    const t = capped ? i / n : (i * step) / dist
    out[i - 1] = { x: x0 + dx * t, y: y0 + dy * t }
  }
  return out
}

/** draw soft round dab with the given color at full alpha (for direct painting) */
export function softDab(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, hardness: number, color: string) {
  if (radius < 0.5) return
  const [r, g, b] = hexToRgb(color)
  const inner = clamp(hardness / 100, 0, 0.96)
  const grad = ctx.createRadialGradient(x, y, radius * inner, x, y, radius)
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}

/** hard round dab (anti-aliased arc — brush "hard" tip) */
export function hardDab(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}

// ============================================================
// TRUE aliased pencil nib (Task 15-a) — pixel-perfect hard dabs
// ============================================================

/** cached thresholded nibs, keyed `${diameter}|${color}` (evict oldest past 128) */
const pencilNibCache = new Map<string, HTMLCanvasElement>()

/** build the aliased nib: filled circle → alpha threshold (>=128 → opaque) with
 *  flat RGB → putImageData. The nib is drawn 1:1 at integer coords so the
 *  thresholded pixels land exactly on the canvas pixel grid. */
function buildPencilNib(d: number, color: string): HTMLCanvasElement {
  const size = Math.ceil(d) + 2
  const nib = createCanvas(size, size)
  const c = ctx2d(nib)
  const [r, g, b] = hexToRgb(color)
  c.fillStyle = color
  c.beginPath()
  c.arc(size / 2, size / 2, d / 2, 0, Math.PI * 2)
  c.fill()
  const img = c.getImageData(0, 0, size, size)
  const dd = img.data
  for (let i = 0; i < dd.length; i += 4) {
    dd[i] = r; dd[i + 1] = g; dd[i + 2] = b
    dd[i + 3] = dd[i + 3] >= 128 ? 255 : 0
  }
  c.putImageData(img, 0, 0)
  return nib
}

/** TRUE aliased pencil dab: a hard round nib with NO anti-aliasing — the alpha
 *  is thresholded to 0/255 and the RGB is the flat color. Cached per
 *  (diameter, color). Drawn with image smoothing disabled at integer coords. */
export function pencilDab(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  const d = Math.max(1, Math.round(radius * 2))
  const key = `${d}|${color}`
  let nib = pencilNibCache.get(key)
  if (!nib) {
    if (pencilNibCache.size >= 128) {
      // evict the oldest entry (Map preserves insertion order)
      const oldest = pencilNibCache.keys().next().value
      if (oldest !== undefined) pencilNibCache.delete(oldest)
    }
    nib = buildPencilNib(d, color)
    pencilNibCache.set(key, nib)
  }
  const half = nib.width / 2
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(nib, Math.round(x - half), Math.round(y - half))
  ctx.restore()
}

/** brush cursor circle for the cursor layer (screen space) — precise crosshair when tiny */
export function drawBrushCursor(ctx: CanvasRenderingContext2D, mouse: { x: number; y: number } | null, size: number, zoom: number) {
  if (!mouse) return
  const r = Math.max(2, (size / 2) * zoom)
  ctx.save()
  ctx.lineWidth = 1
  if (r < 4) {
    // tiny brush → precise crosshair only (Photoshop behavior)
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 2
    ctx.beginPath()
    ctx.moveTo(mouse.x - 7, mouse.y); ctx.lineTo(mouse.x + 7, mouse.y)
    ctx.moveTo(mouse.x, mouse.y - 7); ctx.lineTo(mouse.x, mouse.y + 7)
    ctx.stroke()
    ctx.restore()
    return
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'
  ctx.beginPath(); ctx.arc(mouse.x, mouse.y, r, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath(); ctx.arc(mouse.x, mouse.y, r + 1, 0, Math.PI * 2); ctx.stroke()
  // center tick
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.beginPath()
  ctx.moveTo(mouse.x - 4, mouse.y); ctx.lineTo(mouse.x + 4, mouse.y)
  ctx.moveTo(mouse.x, mouse.y - 4); ctx.lineTo(mouse.x, mouse.y + 4)
  ctx.stroke()
  ctx.restore()
}

/** crosshair cursor mark */
export function drawCross(ctx: CanvasRenderingContext2D, mouse: { x: number; y: number } | null) {
  if (!mouse) return
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(mouse.x - 10, mouse.y); ctx.lineTo(mouse.x + 10, mouse.y)
  ctx.moveTo(mouse.x, mouse.y - 10); ctx.lineTo(mouse.x, mouse.y + 10)
  ctx.stroke()
  ctx.restore()
}

export function drawDashedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save()
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, w, h)
  ctx.strokeStyle = '#000000'
  ctx.setLineDash([5, 4])
  ctx.lineDashOffset = 5
  ctx.strokeRect(x, y, w, h)
  ctx.restore()
}

/** hit test: topmost layer with alpha at point (doc coords) */
export function pickLayerAt(docX: number, docY: number): string | null {
  const doc = engine.activeDoc
  if (!doc) return null
  const x = Math.round(docX), y = Math.round(docY)
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i]
    if (!l.visible || l.kind === 'adjustment') continue
    const c = engine.layerCanvas(l.id)
    if (!c) continue
    // raster canvases may be offset (moved layers) — sample in canvas space
    const ox = l.kind === 'raster' ? (l.offsetX ?? 0) : 0
    const oy = l.kind === 'raster' ? (l.offsetY ?? 0) : 0
    const cx = x - ox, cy = y - oy
    if (cx < 0 || cy < 0 || cx >= c.width || cy >= c.height) continue
    const d = ctx2d(c).getImageData(cx, cy, 1, 1).data
    if (d[3] > 8) return l.id
  }
  return null
}

let regionFalloffScratch = new Float32Array(0)
let regionFalloffBusy = false

function borrowRegionFalloff(length: number): Float32Array {
  // All current region processors are synchronous. Keep a reusable buffer for
  // the normal path, but remain safe if a callback ever nests regionProcess.
  if (!regionFalloffBusy) {
    if (regionFalloffScratch.length < length) {
      let capacity = Math.max(1024, regionFalloffScratch.length || 1024)
      while (capacity < length) capacity *= 2
      regionFalloffScratch = new Float32Array(capacity)
    }
    regionFalloffBusy = true
    return regionFalloffScratch.subarray(0, length)
  }
  return new Float32Array(length)
}

/** apply region-based pixel processing with soft falloff (used by blur/dodge/etc.)
 *  cx/cy are DOC coordinates — translated into the layer's canvas space. */
export function regionProcess(
  layerId: string, cx: number, cy: number, radius: number,
  fn: (region: ImageData, falloff: Float32Array, rw: number, rh: number) => void,
  hardness = 55,
  brushShape?: { extent?: number; alpha: (dx: number, dy: number) => number },
) {
  const layer = engine.layerById(layerId)
  const doc = engine.activeDoc
  if (!layer?.canvas || !doc) return
  const baseR = Math.max(1, radius)
  const extent = Math.max(1, Number(brushShape?.extent) || 1)
  const r = Math.max(1, Math.ceil(baseR * extent))
  const ox = layer.kind === 'raster' ? (layer.offsetX ?? 0) : 0
  const oy = layer.kind === 'raster' ? (layer.offsetY ?? 0) : 0
  const ccx = cx - ox, ccy = cy - oy
  const x0 = clamp(Math.floor(ccx - r), 0, layer.canvas.width - 1)
  const y0 = clamp(Math.floor(ccy - r), 0, layer.canvas.height - 1)
  const x1 = clamp(Math.ceil(ccx + r), 0, layer.canvas.width)
  const y1 = clamp(Math.ceil(ccy + r), 0, layer.canvas.height)
  const rw = x1 - x0, rh = y1 - y0
  if (rw <= 0 || rh <= 0) return
  const c = ctx2d(layer.canvas)
  const region = c.getImageData(x0, y0, rw, rh)
  const falloff = borrowRegionFalloff(rw * rh)
  const ownsScratch = falloff.buffer === regionFalloffScratch.buffer
  const inner = clamp(hardness / 100, 0, 0.98)
  const invSoft = 1 / Math.max(0.02, 1 - inner)
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const dx = x0 + x - ccx, dy = y0 + y - ccy
      if (brushShape) {
        falloff[y * rw + x] = clamp(brushShape.alpha(dx, dy), 0, 1)
      } else {
        const d = Math.hypot(dx, dy) / baseR
        falloff[y * rw + x] = d <= inner ? 1 : clamp(1 - (d - inner) * invSoft, 0, 1)
      }
    }
  }

  // Selection mask is document-space while raster backing stores may be
  // offset and extend outside the document. The previous code clipped the
  // source rectangle but always multiplied from falloff[0], shifting the
  // selection restriction whenever the layer crossed the top/left canvas edge.
  if (doc.selection) {
    const docLeft = x0 + ox
    const docTop = y0 + oy
    const sx0 = Math.max(0, docLeft)
    const sy0 = Math.max(0, docTop)
    const sx1 = Math.min(doc.width, docLeft + rw)
    const sy1 = Math.min(doc.height, docTop + rh)
    const dstX = sx0 - docLeft
    const dstY = sy0 - docTop
    const sw = Math.max(0, sx1 - sx0)
    const sh = Math.max(0, sy1 - sy0)

    // Everything outside document space is outside the active selection.
    if (dstY > 0) falloff.fill(0, 0, dstY * rw)
    if (dstY + sh < rh) falloff.fill(0, (dstY + sh) * rw, rw * rh)
    for (let y = dstY; y < dstY + sh; y++) {
      const row = y * rw
      if (dstX > 0) falloff.fill(0, row, row + dstX)
      if (dstX + sw < rw) falloff.fill(0, row + dstX + sw, row + rw)
    }

    if (sw > 0 && sh > 0) {
      const sd = ctx2d(doc.selection.mask).getImageData(sx0, sy0, sw, sh)
      for (let y = 0; y < sh; y++) {
        const dstRow = (dstY + y) * rw + dstX
        const srcRow = y * sw
        for (let x = 0; x < sw; x++) {
          falloff[dstRow + x] *= sd.data[(srcRow + x) * 4 + 3] / 255
        }
      }
    }
  }

  try {
    fn(region, falloff, rw, rh)
    c.putImageData(region, x0, y0)
  } finally {
    if (ownsScratch) regionFalloffBusy = false
  }
}

/** create a canvas for accumulating tool masks */
export function toolMaskCanvas(): HTMLCanvasElement {
  const doc = engine.activeDoc!
  return createCanvas(doc.width, doc.height)
}

/** state holder for drag tools */
export interface DragState { startX: number; startY: number; lastX: number; lastY: number; active: boolean }
export function newDrag(): DragState { return { startX: 0, startY: 0, lastX: 0, lastY: 0, active: false } }

export function pointerDoc(p: PointerInfo) { return { x: p.docX, y: p.docY } }

// ============================================================
// Symmetry painting (GIMP-style mirror / mandala) — Task 5-d
// ============================================================

/** symmetry configuration: mode + mandala sector count + document dims */
export interface SymmetryConfig {
  /** 'off' | 'mirror-x' | 'mirror-y' | 'point' | 'mandala' */
  mode: string
  /** sector count for mandala (3..16) */
  count: number
  /** document width in px */
  w: number
  /** document height in px */
  h: number
}

/**
 * ALL dab positions (including the original) for the configured symmetry,
 * mirrored about the document center (cx = w/2, cy = h/2).
 *  · 'off'      → [original]
 *  · 'mirror-x' → [original, (w-x, y)]
 *  · 'mirror-y' → [original, (x, h-y)]
 *  · 'point'    → [original, (w-x,y), (x,h-y), (w-x,h-y)]
 *  · 'mandala'  → original + N-1 rotations around the doc center (2πk/N)
 *                 plus the vertical-axis mirror of every rotated point
 *                 (dihedral group Dₙ) → 2N dabs total.
 * Points may fall outside the canvas — dabs simply clip, so no early-out.
 */
export function symmetricPoints(x: number, y: number, cfg: SymmetryConfig): { x: number; y: number }[] {
  const { mode, w, h } = cfg
  if (!mode || mode === 'off') return [{ x, y }]
  const out: { x: number; y: number }[] = [{ x, y }]
  if (mode === 'mirror-x') {
    out.push({ x: w - x, y })
  } else if (mode === 'mirror-y') {
    out.push({ x, y: h - y })
  } else if (mode === 'point') {
    out.push({ x: w - x, y }, { x, y: h - y }, { x: w - x, y: h - y })
  } else if (mode === 'mandala') {
    const n = Math.max(3, Math.round(cfg.count) || 6)
    const cx = w / 2, cy = h / 2
    const dx = x - cx, dy = y - cy
    // mirror of the original (k = 0 counterpart)
    out.push({ x: w - x, y })
    for (let k = 1; k < n; k++) {
      const a = (Math.PI * 2 * k) / n
      const cos = Math.cos(a), sin = Math.sin(a)
      // rotate the offset by 2πk/N around the document center
      const rx = cx + dx * cos - dy * sin
      const ry = cy + dx * sin + dy * cos
      out.push({ x: rx, y: ry })
      // mirrored counterpart across the vertical axis (2cx - rx)
      out.push({ x: 2 * cx - rx, y: ry })
    }
  }
  return out
}

/**
 * Draw the symmetry axes / sector guides in SCREEN space (call from a tool's
 * renderOverlay). Amber dashed vertical/horizontal center lines for the mirror
 * modes; N faint dashed radii from the doc center for mandala.
 */
export function drawSymmetryOverlay(
  ctx: CanvasRenderingContext2D, view: { zoom: number; panX: number; panY: number }, cfg: SymmetryConfig
) {
  const { mode } = cfg
  if (!mode || mode === 'off') return
  const x0 = view.panX, y0 = view.panY
  const wScr = cfg.w * view.zoom, hScr = cfg.h * view.zoom
  const cx = x0 + wScr / 2, cy = y0 + hScr / 2
  ctx.save()
  ctx.lineWidth = 1
  ctx.setLineDash([6, 4])
  if (mode === 'mirror-x' || mode === 'point') {
    ctx.strokeStyle = 'rgba(232,163,61,0.8)'
    ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y0 + hScr); ctx.stroke()
  }
  if (mode === 'mirror-y' || mode === 'point') {
    ctx.strokeStyle = 'rgba(232,163,61,0.8)'
    ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x0 + wScr, cy); ctx.stroke()
  }
  if (mode === 'mandala') {
    const n = Math.max(3, Math.round(cfg.count) || 6)
    ctx.strokeStyle = 'rgba(232,163,61,0.35)'
    const r = Math.hypot(wScr, hScr) / 2 // reach the doc corners
    for (let k = 0; k < n; k++) {
      const a = (Math.PI * 2 * k) / n
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** exponential moving average step — small helper for smoothing values */
export function ema(current: number, target: number, alpha: number): number {
  const a = clamp(alpha, 0, 1)
  return current + (target - current) * a
}
