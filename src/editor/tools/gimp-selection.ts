// ============================================================
// GIMP-style selection tools
//
//  · Scissors Select — click a series of control nodes. Each click snaps
//    to the strongest nearby edge, and consecutive nodes are connected by
//    a bounded live-wire route over the image gradient. Click the first
//    node / double-click / Enter to close and commit the polygon.
//
//  · Foreground Select — drag a rough lasso around the subject, then paint
//    foreground and background scribbles. A small colour model classifies
//    pixels inside the lasso; Enter commits the refined mask.
//
// Both tools reuse the engine's polygon / alpha selection entry points, so
// feathering, combine modes, anti-aliasing and history behave exactly like
// the other selection tools.
// ============================================================
import type { PointerInfo, Rect, SelectionCombine, Tool, Vec } from '../types'
import { engine } from '../engine/engine'
import { getFlatComposite } from '../engine/document'
import { combineMode, drawBrushCursor, getOptions } from './shared'
import {
  clamp, createCanvas, ctx2d, getImageData, getMaskAlpha, hexToRgb, resampleCanvas,
} from '../utils/canvas'
import { gaussianBlurChannel } from '../image-ops/core'
import * as imageOps from '../image-ops'

const MAX_GRADIENT_PIXELS = 1_000_000
const MAX_POINTS = 12_000
const INTERP_STEP = 1.5
const MAX_ROUTE_CELLS = 60_000
const MAX_PREVIEW_SEGMENTS = 2400
const MAX_WORK_PIXELS = 1_000_000
const MAX_SAMPLES = 128

// ============================================================
// Shared helpers
// ============================================================

function clampRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = clamp(Math.floor(r.x), 0, w - 1)
  const y0 = clamp(Math.floor(r.y), 0, h - 1)
  const x1 = clamp(Math.ceil(r.x + r.w), x0 + 1, w)
  const y1 = clamp(Math.ceil(r.y + r.h), y0 + 1, h)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.save()
  ctx.font = '10px ui-monospace, SFMono-Regular, monospace'
  const tw = ctx.measureText(text).width
  const bx = clamp(x, 6, Math.max(6, w - tw - 16))
  const by = clamp(y, 6, Math.max(6, h - 23))
  ctx.fillStyle = 'rgba(15,15,17,0.9)'
  ctx.strokeStyle = 'rgba(232,163,61,0.65)'
  ctx.lineWidth = 1
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, tw + 10, 17, 3)
  else ctx.rect(bx, by, tw + 10, 17)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#f4c47c'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, bx + 5, by + 8.5)
  ctx.restore()
}

// ============================================================
// Scissors Select — edge map
// ============================================================

let grad: Float32Array | null = null
let gradW = 0
let gradH = 0
let gradScale = 1

function dropGradient() {
  grad = null
  gradW = 0
  gradH = 0
  gradScale = 1
}

function buildGradient() {
  dropGradient()
  const doc = engine.activeDoc
  if (!doc) return
  const source = getFlatComposite(doc)
  if (!source) return
  let work = source
  let scale = 1
  const pixels = doc.width * doc.height
  if (pixels > MAX_GRADIENT_PIXELS) {
    const k = Math.sqrt(pixels / MAX_GRADIENT_PIXELS)
    const w = Math.max(1, Math.round(doc.width / k))
    const h = Math.max(1, Math.round(doc.height / k))
    work = resampleCanvas(source, w, h)
    scale = doc.width / w
  }
  const img = getImageData(work)
  const w = img.width
  const h = img.height
  const d = img.data
  const lum = new Float32Array(w * h)
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) {
    lum[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]
  }
  const out = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const tl = lum[i - w - 1], tc = lum[i - w], tr = lum[i - w + 1]
      const ml = lum[i - 1], mr = lum[i + 1]
      const bl = lum[i + w - 1], bc = lum[i + w], br = lum[i + w + 1]
      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl)
      const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr)
      out[i] = Math.hypot(gx, gy)
    }
  }
  grad = out
  gradW = w
  gradH = h
  gradScale = scale
}

function gradAt(x: number, y: number): number {
  if (!grad) return 0
  const ix = Math.round(x / gradScale)
  const iy = Math.round(y / gradScale)
  if (ix < 0 || iy < 0 || ix >= gradW || iy >= gradH) return 0
  return grad[iy * gradW + ix]
}

/** Strongest gradient point inside a screen-sized disk around the click. */
function snapToEdge(x: number, y: number, zoom: number): Vec {
  if (!grad) return { x, y }
  const radius = clamp(13 / Math.max(0.02, zoom), 4, 40)
  const r2 = radius * radius
  let best: Vec | null = null
  let bestScore = 0
  const x0 = Math.floor(x - radius), x1 = Math.ceil(x + radius)
  const y0 = Math.floor(y - radius), y1 = Math.ceil(y + radius)
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const dx = cx - x, dy = cy - y
      const dd = dx * dx + dy * dy
      if (dd > r2) continue
      const mag = gradAt(cx, cy)
      if (mag <= 6) continue
      const score = mag * (1 - 0.45 * Math.sqrt(dd) / radius)
      if (score > bestScore) {
        bestScore = score
        best = { x: cx, y: cy }
      }
    }
  }
  return best ?? { x, y }
}

/** Bounded Dijkstra route that prefers strong edges and stays near the
 *  straight line between the two control nodes. */
function routeSegment(a: Vec, b: Vec): Vec[] | null {
  if (!grad || gradW < 2 || gradH < 2) return null
  const sx = clamp(Math.round(a.x / gradScale), 0, gradW - 1)
  const sy = clamp(Math.round(a.y / gradScale), 0, gradH - 1)
  const tx = clamp(Math.round(b.x / gradScale), 0, gradW - 1)
  const ty = clamp(Math.round(b.y / gradScale), 0, gradH - 1)
  if (sx === tx && sy === ty) return [a, b]

  const corridor = Math.max(5, Math.ceil(22 / Math.max(0.001, gradScale)))
  const x0 = Math.max(0, Math.min(sx, tx) - corridor)
  const y0 = Math.max(0, Math.min(sy, ty) - corridor)
  const x1 = Math.min(gradW - 1, Math.max(sx, tx) + corridor)
  const y1 = Math.min(gradH - 1, Math.max(sy, ty) + corridor)
  const rw = x1 - x0 + 1
  const rh = y1 - y0 + 1
  const cells = rw * rh
  if (cells <= 0 || cells > MAX_ROUTE_CELLS) return null

  let localMax = 1
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * gradW
    for (let xx = x0; xx <= x1; xx++) localMax = Math.max(localMax, grad[row + xx])
  }

  const local = (x: number, y: number) => (y - y0) * rw + (x - x0)
  const start = local(sx, sy)
  const goal = local(tx, ty)
  const dist = new Float32Array(cells)
  dist.fill(Number.POSITIVE_INFINITY)
  const prev = new Int32Array(cells)
  prev.fill(-1)
  const done = new Uint8Array(cells)

  const heapI: number[] = []
  const heapD: number[] = []
  const push = (idx: number, d: number) => {
    let i = heapI.length
    heapI.push(idx)
    heapD.push(d)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heapD[p] <= d) break
      heapI[i] = heapI[p]
      heapD[i] = heapD[p]
      i = p
    }
    heapI[i] = idx
    heapD[i] = d
  }
  const pop = (): [number, number] | null => {
    if (!heapI.length) return null
    const ri = heapI[0], rd = heapD[0]
    const li = heapI.pop()!, ld = heapD.pop()!
    if (heapI.length) {
      let i = 0
      while (true) {
        let child = i * 2 + 1
        if (child >= heapI.length) break
        if (child + 1 < heapI.length && heapD[child + 1] < heapD[child]) child++
        if (heapD[child] >= ld) break
        heapI[i] = heapI[child]
        heapD[i] = heapD[child]
        i = child
      }
      heapI[i] = li
      heapD[i] = ld
    }
    return [ri, rd]
  }

  const segDx = tx - sx
  const segDy = ty - sy
  const segLen2 = Math.max(1, segDx * segDx + segDy * segDy)
  const lineDistance = (x: number, y: number) => {
    const t = clamp(((x - sx) * segDx + (y - sy) * segDy) / segLen2, 0, 1)
    return Math.hypot(x - (sx + segDx * t), y - (sy + segDy * t))
  }

  dist[start] = 0
  push(start, 0)
  const dirs = [
    [-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2],
    [-1, 0, 1], [1, 0, 1],
    [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2],
  ] as const

  while (heapI.length) {
    const item = pop()!
    const [cur, curD] = item
    if (done[cur] || curD !== dist[cur]) continue
    done[cur] = 1
    if (cur === goal) break
    const cx = x0 + (cur % rw)
    const cy = y0 + Math.floor(cur / rw)
    for (const [ox, oy, step] of dirs) {
      const nx = cx + ox, ny = cy + oy
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue
      const ni = local(nx, ny)
      if (done[ni]) continue
      const mag = grad[ny * gradW + nx]
      const edge = 1 - clamp(mag / localMax, 0, 1)
      const linePenalty = lineDistance(nx, ny) / Math.max(2, corridor)
      const nd = curD + step * (0.12 + edge * 3.25 + linePenalty * 0.28)
      if (nd >= dist[ni]) continue
      dist[ni] = nd
      prev[ni] = cur
      push(ni, nd)
    }
  }

  if (prev[goal] < 0) return null
  const rev: Vec[] = []
  let cur = goal
  let guard = 0
  while (cur >= 0 && guard++ <= cells) {
    rev.push({
      x: (x0 + (cur % rw)) * gradScale,
      y: (y0 + Math.floor(cur / rw)) * gradScale,
    })
    if (cur === start) break
    cur = prev[cur]
  }
  if (!rev.length || cur !== start) return null
  rev.reverse()
  rev[0] = { ...a }
  rev[rev.length - 1] = { ...b }
  return rev
}

// ---------- scissors path state ----------

let anchors: Vec[] = []
let densePath: Vec[] = []
let hoverSnap: Vec | null = null
let lastShift = false
let lastAlt = false
let scissorsDocId: string | null = null

function pushSegment(a: Vec, b: Vec) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  if (d < 0.01) return
  const remaining = MAX_POINTS - densePath.length
  if (remaining <= 0) return
  const n = Math.min(remaining, Math.max(1, Math.ceil(d / INTERP_STEP)))
  for (let i = 1; i <= n; i++) {
    const t = i / n
    densePath.push({ x: a.x + dx * t, y: a.y + dy * t })
  }
}

function appendSegment(a: Vec, b: Vec) {
  const interactive = getOptions('scissors-select').interactive !== false
  const route = interactive ? routeSegment(a, b) : null
  if (!route || route.length < 2) {
    pushSegment(densePath[densePath.length - 1] ?? a, b)
    return
  }
  for (let i = 1; i < route.length && densePath.length < MAX_POINTS; i++) {
    pushSegment(densePath[densePath.length - 1] ?? route[i - 1], route[i])
  }
}

function rebuildDensePath() {
  if (!anchors.length) {
    densePath = []
    return
  }
  densePath = [{ ...anchors[0] }]
  for (let i = 1; i < anchors.length; i++) appendSegment(anchors[i - 1], anchors[i])
}

function appendAnchor(p: Vec) {
  if (!anchors.length) {
    anchors = [{ ...p }]
    densePath = [{ ...p }]
    return
  }
  const last = anchors[anchors.length - 1]
  appendSegment(last, p)
  anchors.push({ ...p })
}

function resetScissors() {
  anchors = []
  densePath = []
  hoverSnap = null
  scissorsDocId = null
  dropGradient()
}

function closeScissorsPath() {
  if (anchors.length < 3) return
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  appendSegment(last, first)
}

function commitScissors(p?: { shift: boolean; alt: boolean }) {
  if (densePath.length < 3) {
    resetScissors()
    engine.pokeOverlay()
    return
  }
  const opts = getOptions('scissors-select')
  const mode: SelectionCombine = combineMode(
    p ?? { shift: lastShift, alt: lastAlt },
    opts.mode ?? 'new',
  )
  engine.selectPolygon(densePath, Number(opts.feather ?? 0), mode, opts.antiAlias !== false)
  resetScissors()
  engine.pokeOverlay()
}

export const scissorsSelectTool: Tool = {
  id: 'scissors-select',
  cursor: 'crosshair',
  requiresLayer: true,

  onActivate() {
    engine.pokeOverlay()
  },

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    if (!doc) return
    lastShift = p.shift
    lastAlt = p.alt

    if (scissorsDocId && scissorsDocId !== doc.id) resetScissors()
    scissorsDocId = doc.id

    if (anchors.length >= 3) {
      const first = anchors[0]
      const closeDist = Math.hypot(p.docX - first.x, p.docY - first.y) * doc.view.zoom
      if (closeDist <= 11) {
        closeScissorsPath()
        commitScissors(p)
        return
      }
    }

    if (!grad) buildGradient()
    const snapped = snapToEdge(p.docX, p.docY, doc.view.zoom)
    appendAnchor(snapped)
    hoverSnap = snapped
    engine.pokeOverlay()
  },

  onPointerMove(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc || !anchors.length) return
    hoverSnap = snapToEdge(p.docX, p.docY, doc.view.zoom)
    engine.pokeOverlay()
  },

  onPointerUp(p: PointerInfo) {
    lastShift = p.shift
    lastAlt = p.alt
  },

  onDoubleClick(p: PointerInfo) {
    if (anchors.length < 3) return
    closeScissorsPath()
    commitScissors(p)
  },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && anchors.length >= 3) {
      closeScissorsPath()
      commitScissors()
      return true
    }
    if (e.key === 'Escape' && anchors.length) {
      resetScissors()
      engine.pokeOverlay()
      return true
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && anchors.length) {
      e.preventDefault()
      anchors.pop()
      rebuildDensePath()
      engine.pokeOverlay()
      return true
    }
    return false
  },

  onDeactivate() {
    resetScissors()
  },

  renderOverlay(ctx, view, w, h, mouse) {
    if (!anchors.length) return
    const doc = engine.activeDoc
    if (!doc || (scissorsDocId && scissorsDocId !== doc.id)) return
    const zoom = view.zoom

    if (densePath.length > 1) {
      ctx.save()
      ctx.translate(view.panX, view.panY)
      ctx.scale(zoom, zoom)
      ctx.beginPath()
      ctx.moveTo(densePath[0].x, densePath[0].y)
      const stride = Math.max(1, Math.ceil(densePath.length / MAX_PREVIEW_SEGMENTS))
      for (let i = stride; i < densePath.length; i += stride) ctx.lineTo(densePath[i].x, densePath[i].y)
      const tail = densePath[densePath.length - 1]
      if ((densePath.length - 1) % stride !== 0) ctx.lineTo(tail.x, tail.y)
      ctx.strokeStyle = 'rgba(0,0,0,0.78)'
      ctx.lineWidth = 2 / zoom
      ctx.setLineDash([])
      ctx.stroke()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1 / zoom
      ctx.setLineDash([6 / zoom, 4 / zoom])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    // rubber line from the last control node to the snapped cursor
    if (mouse) {
      const last = anchors[anchors.length - 1]
      const target = hoverSnap ?? {
        x: (mouse.x - view.panX) / zoom,
        y: (mouse.y - view.panY) / zoom,
      }
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(last.x * zoom + view.panX, last.y * zoom + view.panY)
      ctx.lineTo(target.x * zoom + view.panX, target.y * zoom + view.panY)
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    // control nodes
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]
      const sx = a.x * zoom + view.panX
      const sy = a.y * zoom + view.panY
      ctx.save()
      ctx.fillStyle = i === 0 ? '#e8a33d' : '#ffffff'
      ctx.strokeStyle = 'rgba(15,15,17,0.9)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(sx, sy, i === 0 ? 5.5 : 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }

    // close-zone hint around the first node
    if (anchors.length >= 3) {
      const first = anchors[0]
      ctx.save()
      ctx.strokeStyle = 'rgba(232,163,61,0.75)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.arc(first.x * zoom + view.panX, first.y * zoom + view.panY, 11, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    const tip = anchors.length >= 3
      ? 'Click the first node or Enter to close · Backspace removes a node'
      : 'Click along the object edge · Enter to close'
    drawBadge(ctx, tip, mouse ? mouse.x + 16 : 12, mouse ? mouse.y - 28 : 12, w, h)
  },
}

// ============================================================
// Foreground Select
// ============================================================

type FgPhase = 'idle' | 'lasso' | 'scribble'

interface Scribble {
  pts: Vec[]
  background: boolean
}

interface PreviewState {
  mask: Uint8ClampedArray
  width: number
  height: number
  bounds: Rect
  canvas: HTMLCanvasElement
}

let fgPhase: FgPhase = 'idle'
let fgLasso: Vec[] = []
let fgLassoBounds: Rect | null = null
let fgDraggingLasso = false
let fgScribbles: Scribble[] = []
let fgCurrent: Scribble | null = null
let fgSamples: number[][] = []
let bgSamples: number[][] = []
let fgPreview: PreviewState | null = null
let fgBusy = false
let fgPending = false
let fgDocId: string | null = null
let fgLastShift = false

function resetForeground() {
  fgPhase = 'idle'
  fgLasso = []
  fgLassoBounds = null
  fgDraggingLasso = false
  fgScribbles = []
  fgCurrent = null
  fgSamples = []
  bgSamples = []
  fgPreview = null
  fgBusy = false
  fgPending = false
  fgDocId = null
}

function updateLassoBounds(p: Vec) {
  if (!fgLassoBounds) {
    fgLassoBounds = { x: p.x, y: p.y, w: 0, h: 0 }
    return
  }
  const x0 = Math.min(fgLassoBounds.x, p.x)
  const y0 = Math.min(fgLassoBounds.y, p.y)
  const x1 = Math.max(fgLassoBounds.x + fgLassoBounds.w, p.x)
  const y1 = Math.max(fgLassoBounds.y + fgLassoBounds.h, p.y)
  fgLassoBounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function workImage(source: HTMLCanvasElement): { img: ImageData; sx: number; sy: number } {
  const W = source.width
  const H = source.height
  if (W * H <= MAX_WORK_PIXELS) {
    return { img: getImageData(source), sx: 1, sy: 1 }
  }
  const k = Math.sqrt((W * H) / MAX_WORK_PIXELS)
  const ww = Math.max(1, Math.round(W / k))
  const wh = Math.max(1, Math.round(H / k))
  const res = resampleCanvas(source, ww, wh)
  return { img: getImageData(res), sx: W / ww, sy: H / wh }
}

function nearestDistance(samples: number[][], r: number, g: number, b: number): number {
  let best = Infinity
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const dr = r - s[0]
    const dg = g - s[1]
    const db = b - s[2]
    const d = (dr * dr + dg * dg + db * db) / 195075
    if (d < best) best = d
  }
  return best
}

function fgTolerance(samples: number[][]): number {
  if (samples.length < 2) return 0.055
  let maxNearest = 0
  const limit = Math.min(samples.length, 48)
  for (let i = 0; i < limit; i++) {
    let best = Infinity
    for (let j = 0; j < limit; j++) {
      if (i === j) continue
      const a = samples[i], b = samples[j]
      const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]
      const d = (dr * dr + dg * dg + db * db) / 195075
      if (d < best) best = d
    }
    if (best !== Infinity) maxNearest = Math.max(maxNearest, best)
  }
  return clamp(maxNearest * 2 + 0.006, 0.012, 0.22)
}

function addSamples(stroke: Vec[], background: boolean) {
  const doc = engine.activeDoc
  if (!doc) return
  const source = getFlatComposite(doc)
  if (!source) return
  const { img, sx, sy } = workImage(source)
  const W = img.width
  const H = img.height
  const d = img.data
  const list = background ? bgSamples : fgSamples
  const radius = Math.max(1, Math.round(Number(getOptions('foreground-select').strokeWidth ?? 5) / 2))
  const step = Math.max(1, Math.floor(radius / 2))
  const seen = new Set<number>()
  for (const p of stroke) {
    const cx = Math.round(p.x / sx)
    const cy = Math.round(p.y / sy)
    for (let oy = -radius; oy <= radius; oy += step) {
      for (let ox = -radius; ox <= radius; ox += step) {
        if (ox * ox + oy * oy > radius * radius) continue
        const x = clamp(cx + ox, 0, W - 1)
        const y = clamp(cy + oy, 0, H - 1)
        const i = (y * W + x) * 4
        const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)
        if (seen.has(key)) continue
        seen.add(key)
        list.push([d[i], d[i + 1], d[i + 2]])
        if (list.length >= MAX_SAMPLES) return
      }
    }
  }
}

function rebuildSamples() {
  fgSamples = []
  bgSamples = []
  for (const s of fgScribbles) addSamples(s.pts, s.background)
}

function regionMaskLocal(
  bounds: Rect,
  sx: number,
  sy: number,
): Uint8ClampedArray {
  const cv = createCanvas(Math.max(1, bounds.w), Math.max(1, bounds.h))
  const c = ctx2d(cv)
  c.fillStyle = '#ffffff'
  c.beginPath()
  const p0 = fgLasso[0]
  c.moveTo(p0.x / sx - bounds.x, p0.y / sy - bounds.y)
  for (let i = 1; i < fgLasso.length; i++) {
    const p = fgLasso[i]
    c.lineTo(p.x / sx - bounds.x, p.y / sy - bounds.y)
  }
  c.closePath()
  c.fill()
  return getMaskAlpha(cv)
}

function makePreviewCanvas(mask: Uint8ClampedArray, w: number, h: number, color: string): HTMLCanvasElement {
  const cv = createCanvas(w, h)
  const c = ctx2d(cv)
  const img = c.createImageData(w, h)
  const [r, g, b] = hexToRgb(color)
  for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
    const a = mask[i]
    img.data[j] = r
    img.data[j + 1] = g
    img.data[j + 2] = b
    img.data[j + 3] = Math.round(a * 0.48)
  }
  c.putImageData(img, 0, 0)
  return cv
}

function computeForegroundPreview() {
  const doc = engine.activeDoc
  if (!doc || !fgLassoBounds || fgLasso.length < 3) return
  const source = getFlatComposite(doc)
  if (!source) return
  const { img, sx, sy } = workImage(source)
  const W = img.width
  const H = img.height
  const bounds = clampRect(
    {
      x: fgLassoBounds.x / sx,
      y: fgLassoBounds.y / sy,
      w: fgLassoBounds.w / sx,
      h: fgLassoBounds.h / sy,
    },
    W,
    H,
  )
  if (!bounds) return
  const bw = bounds.w
  const bh = bounds.h
  const region = regionMaskLocal(bounds, sx, sy)
  let out = new Uint8ClampedArray(bw * bh)

  if (!fgSamples.length) {
    const auto = imageOps.objectSelect(img, bounds.x, bounds.y, bw, bh)
    let selected = 0
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const li = y * bw + x
        if (!region[li]) continue
        const value = auto[(bounds.y + y) * W + bounds.x + x]
        out[li] = value
        if (value > 8) selected++
      }
    }
    // If the built-in detector finds nothing, keep the lasso as a useful
    // starting point instead of presenting an empty selection.
    if (selected < bw * bh * 0.005) {
      out = new Uint8ClampedArray(bw * bh)
      out.set(region)
    }
  } else {
    const tolerance = fgTolerance(fgSamples)
    const score = new Float32Array(bw * bh)
    const data = img.data
    const hasBackground = bgSamples.length > 0
    for (let y = 0; y < bh; y++) {
      const row = (bounds.y + y) * W
      for (let x = 0; x < bw; x++) {
        const li = y * bw + x
        if (!region[li]) continue
        const i = (row + bounds.x + x) * 4
        const r = data[i], g = data[i + 1], b = data[i + 2]
        const dF = nearestDistance(fgSamples, r, g, b)
        if (dF >= tolerance) continue
        if (!hasBackground) {
          score[li] = 1
          continue
        }
        const dB = nearestDistance(bgSamples, r, g, b)
        score[li] = dB / (dF + dB + 1e-6)
      }
    }
    const blurred = gaussianBlurChannel(score, bw, bh, 1.15)
    for (let i = 0; i < out.length; i++) out[i] = blurred[i] > 0.5 ? 255 : 0
    out.set(imageOps.refineMask(out, bw, bh, {
      radius: 1, smooth: 1, contrast: 6, feather: 0.35, shiftEdge: 0,
    }))
  }

  // Hard-clip to the user's lasso and apply the requested feather.
  for (let i = 0; i < out.length; i++) out[i] = Math.round(out[i] * region[i] / 255)
  const feather = Number(getOptions('foreground-select').feather ?? 0)
  if (feather > 0) {
    const f = new Float32Array(out.length)
    for (let i = 0; i < out.length; i++) f[i] = out[i]
    const sigma = Math.max(0.35, (feather / 2) / Math.max(sx, sy))
    const blurred = gaussianBlurChannel(f, bw, bh, sigma)
    out = new Uint8ClampedArray(blurred)
  }

  const color = String(getOptions('foreground-select').previewColor ?? '#ff0000')
  fgPreview = {
    mask: out,
    width: bw,
    height: bh,
    bounds: {
      x: bounds.x * sx,
      y: bounds.y * sy,
      w: bw * sx,
      h: bh * sy,
    },
    canvas: makePreviewCanvas(out, bw, bh, color),
  }
}

function scheduleForegroundPreview() {
  if (fgBusy) {
    fgPending = true
    return
  }
  fgBusy = true
  // Let the overlay paint the scribble / "Refining" state before the
  // synchronous segmentation work runs.
  requestAnimationFrame(() => setTimeout(() => {
    try {
      computeForegroundPreview()
    } finally {
      fgBusy = false
      engine.pokeOverlay()
      if (fgPending) {
        fgPending = false
        scheduleForegroundPreview()
      }
    }
  }, 0))
}

function commitForeground(p?: { shift: boolean; alt: boolean }) {
  const doc = engine.activeDoc
  const preview = fgPreview
  // Alt/Ctrl is reserved for background scribbles in this tool, so it must
  // not also flip the commit into subtract mode.
  const mode = combineMode({ shift: p?.shift ?? fgLastShift, alt: false }, getOptions('foreground-select').mode ?? 'new')
  if (!doc || !preview) {
    // No preview yet: fall back to the rough lasso so Enter still does
    // something useful immediately after drawing the boundary.
    if (fgLasso.length >= 3) {
      const opts = getOptions('foreground-select')
      engine.selectPolygon(fgLasso, Number(opts.feather ?? 0), mode)
    }
    resetForeground()
    engine.pokeOverlay()
    return
  }
  const maskCanvas = createCanvas(doc.width, doc.height)
  const local = createCanvas(preview.width, preview.height)
  const lc = ctx2d(local)
  const localData = lc.createImageData(preview.width, preview.height)
  for (let i = 0, j = 0; i < preview.mask.length; i++, j += 4) {
    localData.data[j] = 255
    localData.data[j + 1] = 255
    localData.data[j + 2] = 255
    localData.data[j + 3] = preview.mask[i]
  }
  lc.putImageData(localData, 0, 0)
  const c = ctx2d(maskCanvas)
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'
  c.drawImage(local, preview.bounds.x, preview.bounds.y, preview.bounds.w, preview.bounds.h)
  engine.setSelectionAlpha(getMaskAlpha(maskCanvas), mode, 'Foreground Select')
  resetForeground()
  engine.pokeOverlay()
}

export const foregroundSelectTool: Tool = {
  id: 'foreground-select',
  cursor: 'crosshair',
  requiresLayer: true,

  onActivate() {
    engine.pokeOverlay()
  },

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    if (!doc) return
    if (fgDocId && fgDocId !== doc.id) resetForeground()
    fgDocId = doc.id
    fgLastShift = p.shift

    if (fgPhase === 'idle') {
      fgPhase = 'lasso'
      fgLasso = [{ x: p.docX, y: p.docY }]
      fgLassoBounds = { x: p.docX, y: p.docY, w: 0, h: 0 }
      fgDraggingLasso = true
      fgScribbles = []
      fgSamples = []
      bgSamples = []
      fgPreview = null
      engine.pokeOverlay()
      return
    }

    if (fgPhase === 'scribble') {
      const background = p.alt || p.ctrl
      fgCurrent = {
        pts: [{ x: p.docX, y: p.docY }],
        background,
      }
      engine.pokeOverlay()
    }
  },

  onPointerMove(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc) return
    const step = 1.5 / Math.max(0.25, doc.view.zoom)
    if (fgDraggingLasso) {
      const last = fgLasso[fgLasso.length - 1]
      if (!last || Math.hypot(p.docX - last.x, p.docY - last.y) >= step) {
        fgLasso.push({ x: p.docX, y: p.docY })
        updateLassoBounds({ x: p.docX, y: p.docY })
        engine.pokeOverlay()
      }
      return
    }
    if (fgCurrent) {
      const last = fgCurrent.pts[fgCurrent.pts.length - 1]
      if (!last || Math.hypot(p.docX - last.x, p.docY - last.y) >= step) {
        fgCurrent.pts.push({ x: p.docX, y: p.docY })
        engine.pokeOverlay()
      }
    }
  },

  onPointerUp(p: PointerInfo) {
    fgLastShift = p.shift
    if (fgDraggingLasso) {
      fgDraggingLasso = false
      if (fgLasso.length >= 3 && fgLassoBounds && fgLassoBounds.w >= 4 && fgLassoBounds.h >= 4) {
        fgPhase = 'scribble'
        scheduleForegroundPreview()
      } else {
        resetForeground()
      }
      engine.pokeOverlay()
      return
    }
    if (fgCurrent) {
      if (fgCurrent.pts.length) {
        fgScribbles.push(fgCurrent)
        addSamples(fgCurrent.pts, fgCurrent.background)
      }
      fgCurrent = null
      scheduleForegroundPreview()
      engine.pokeOverlay()
    }
  },

  onDoubleClick(p: PointerInfo) {
    if (fgPhase === 'scribble') commitForeground(p)
  },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (fgPhase === 'scribble') {
        commitForeground()
        return true
      }
      if (fgPhase === 'lasso' && fgLasso.length >= 3) {
        fgPhase = 'scribble'
        scheduleForegroundPreview()
        return true
      }
    }
    if (e.key === 'Escape' && fgPhase !== 'idle') {
      resetForeground()
      engine.pokeOverlay()
      return true
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && fgPhase === 'scribble') {
      e.preventDefault()
      if (fgScribbles.length) {
        fgScribbles.pop()
        rebuildSamples()
        fgPreview = null
        scheduleForegroundPreview()
      } else {
        resetForeground()
      }
      engine.pokeOverlay()
      return true
    }
    return false
  },

  onDeactivate() {
    resetForeground()
  },

  renderOverlay(ctx, view, w, h, mouse) {
    if (!fgLasso.length) return
    const doc = engine.activeDoc
    if (!doc || (fgDocId && fgDocId !== doc.id)) return
    const zoom = view.zoom

    // live preview tint
    if (fgPreview) {
      ctx.save()
      ctx.translate(view.panX, view.panY)
      ctx.scale(zoom, zoom)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(
        fgPreview.canvas,
        fgPreview.bounds.x,
        fgPreview.bounds.y,
        fgPreview.bounds.w,
        fgPreview.bounds.h,
      )
      ctx.restore()
    }

    // lasso boundary
    ctx.save()
    ctx.translate(view.panX, view.panY)
    ctx.scale(zoom, zoom)
    ctx.beginPath()
    ctx.moveTo(fgLasso[0].x, fgLasso[0].y)
    const stride = Math.max(1, Math.ceil(fgLasso.length / MAX_PREVIEW_SEGMENTS))
    for (let i = stride; i < fgLasso.length; i += stride) ctx.lineTo(fgLasso[i].x, fgLasso[i].y)
    const tail = fgLasso[fgLasso.length - 1]
    if ((fgLasso.length - 1) % stride !== 0) ctx.lineTo(tail.x, tail.y)
    if (fgPhase === 'scribble') {
      ctx.closePath()
      ctx.fillStyle = 'rgba(232,163,61,0.06)'
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'
    ctx.lineWidth = 2 / zoom
    ctx.setLineDash([])
    ctx.stroke()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1 / zoom
    ctx.setLineDash([6 / zoom, 4 / zoom])
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()

    // scribbles
    const opts = getOptions('foreground-select')
    const previewColor = String(opts.previewColor ?? '#ff0000')
    const drawScribble = (pts: Vec[], color: string) => {
      if (pts.length < 2) return
      ctx.save()
      ctx.translate(view.panX, view.panY)
      ctx.scale(zoom, zoom)
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.lineWidth = Math.max(2, Number(opts.strokeWidth ?? 5) + 2) / zoom
      ctx.stroke()
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(1, Number(opts.strokeWidth ?? 5)) / zoom
      ctx.stroke()
      ctx.restore()
    }
    for (const s of fgScribbles) {
      if (s.background) {
        if (opts.drawBackground === true) drawScribble(s.pts, '#4fc3f7')
      } else if (opts.drawForeground !== false) {
        drawScribble(s.pts, previewColor)
      }
    }
    if (fgCurrent) {
      if (fgCurrent.background) {
        if (opts.drawBackground === true) drawScribble(fgCurrent.pts, '#4fc3f7')
      } else if (opts.drawForeground !== false) {
        drawScribble(fgCurrent.pts, previewColor)
      }
    }

    const tip = fgBusy
      ? 'Refining selection…'
      : fgPhase === 'lasso'
        ? 'Drag a rough lasso around the subject'
        : 'Paint foreground · Alt/Ctrl = background · Enter applies · Esc cancels'
    const b = fgLassoBounds
    const bx = b ? b.x * zoom + view.panX : 12
    const by = b ? b.y * zoom + view.panY - 24 : 12
    drawBadge(ctx, tip, mouse ? mouse.x + 16 : bx, mouse ? mouse.y - 28 : by, w, h)
  },

  renderCursor(ctx, view, w, h, mouse) {
    void w
    void h
    if (fgPhase !== 'scribble') return
    const opts = getOptions('foreground-select')
    drawBrushCursor(ctx, mouse, Math.max(6, Number(opts.strokeWidth ?? 5) * 2), view.zoom)
  },
}
