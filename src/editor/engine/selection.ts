// Selection state management — masks, combine modes, marching-ants contours
import type { Rect, SelectionCombine, SelectionState, PsDocument } from '../types'
import { createCanvas, ctx2d, cloneCanvas, getImageData, putImageData, combineMaskAlpha, getMaskAlpha, setMaskAlpha, uid } from '../utils/canvas'
import { gaussianBlurChannel } from '../image-ops/core'

export function maskCanvasFromAlpha(alpha: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = createCanvas(w, h)
  setMaskAlpha(c, alpha)
  return c
}

export function selectionFromMask(mask: HTMLCanvasElement, v = 1): SelectionState {
  const sel: SelectionState = { mask, bounds: computeBounds(mask), _v: v, _pathsV: -1, _paths: null }
  return sel
}

export function computeBounds(mask: HTMLCanvasElement): Rect {
  const { width: w, height: h } = mask
  const d = getImageData(mask).data
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export function combineSelection(
  existing: SelectionState | null, mask: HTMLCanvasElement, mode: SelectionCombine
): SelectionState | null {
  const w = mask.width, h = mask.height
  if (!existing || mode === 'new') {
    if (mode === 'new') return selectionFromMask(cloneCanvas(mask))
    return selectionFromMask(mask)
  }
  const a = getMaskAlpha(existing.mask)
  const b = getMaskAlpha(mask)
  if (a.length !== b.length) return selectionFromMask(cloneCanvas(mask))
  const combined = mode === 'add' ? combineMaskAlpha(a, b, 'add')
    : mode === 'subtract' ? combineMaskAlpha(a, b, 'subtract')
    : combineMaskAlpha(a, b, 'intersect')
  const has = combined.some(v => v > 0)
  if (!has) return null
  return selectionFromMask(maskCanvasFromAlpha(combined, w, h))
}

/** modify selection: grow/contract/feather/border/smooth/invert */
export function modifySelection(sel: SelectionState, op: 'grow' | 'contract' | 'feather' | 'border' | 'smooth' | 'invert', px: number): SelectionState | null {
  const w = sel.mask.width, h = sel.mask.height
  let alpha = getMaskAlpha(sel.mask)
  if (op === 'invert') {
    const out = new Uint8ClampedArray(alpha.length)
    for (let i = 0; i < alpha.length; i++) out[i] = 255 - alpha[i]
    alpha = out
  } else if (op === 'feather') {
    const f = new Float32Array(alpha.length)
    for (let i = 0; i < alpha.length; i++) f[i] = alpha[i]
    const b = gaussianBlurChannel(f, w, h, Math.max(0.5, px))
    alpha = new Uint8ClampedArray(b)
  } else if (op === 'grow' || op === 'contract') {
    // threshold then morph then restore soft edges roughly
    const bin = new Uint8ClampedArray(alpha.length)
    for (let i = 0; i < alpha.length; i++) bin[i] = alpha[i] >= 128 ? 255 : 0
    const r = Math.max(1, Math.round(px))
    // separable max/min filter
    const morph = (arr: Uint8ClampedArray, max: boolean) => {
      const tmp = new Uint8ClampedArray(arr.length)
      const outA = new Uint8ClampedArray(arr.length)
      const cmp = max ? Math.max : Math.min
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = max ? 0 : 255
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx))
          v = cmp(v, arr[y * w + xx])
        }
        tmp[y * w + x] = v
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = max ? 0 : 255
        for (let dy = -r; dy <= r; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy))
          v = cmp(v, tmp[yy * w + x])
        }
        outA[y * w + x] = v
      }
      return outA
    }
    const shifted = morph(bin, op === 'grow')
    const f = new Float32Array(shifted.length)
    for (let i = 0; i < shifted.length; i++) f[i] = shifted[i]
    const soft = gaussianBlurChannel(f, w, h, Math.max(0.5, r / 2))
    const out = new Uint8ClampedArray(alpha.length)
    for (let i = 0; i < out.length; i++) out[i] = clampLocal((soft[i] - 100) * 255 / 55, 0, 255)
    alpha = out
  } else if (op === 'border') {
    const inner = modifySelection(sel, 'contract', px)
    if (!inner) return null
    const innerA = getMaskAlpha(inner.mask)
    const out = new Uint8ClampedArray(alpha.length)
    for (let i = 0; i < alpha.length; i++) out[i] = Math.max(0, alpha[i] - innerA[i])
    alpha = out
  } else if (op === 'smooth') {
    const f = new Float32Array(alpha.length)
    for (let i = 0; i < alpha.length; i++) f[i] = alpha[i]
    const b = gaussianBlurChannel(f, w, h, Math.max(1, px))
    const out = new Uint8ClampedArray(alpha.length)
    for (let i = 0; i < out.length; i++) out[i] = clampLocal((b[i] - 96) * 255 / 63, 0, 255)
    alpha = out
  }
  const has = alpha.some(v => v > 0)
  if (!has) return null
  return selectionFromMask(maskCanvasFromAlpha(alpha, w, h))
}

function clampLocal(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v }

/** Trace marching-ants contours (Moore-neighbor boundary following).
 *
 * The old renderer emitted one Path2D line segment per boundary pixel. Large
 * ellipses, polygon selections and especially wand masks could therefore create
 * tens or hundreds of thousands of segments and stroke them twice every ants
 * frame. We now keep only direction changes, then apply a hard display-only
 * segment budget. The selection mask itself remains pixel-perfect.
 */
const MAX_ANTS_SEGMENTS = 4096
const MAX_CONTOUR_SEGMENTS = 1536

interface ContourPoint { x: number; y: number }

function pathFromContour(points: ContourPoint[], remainingBudget: number): { path: Path2D; segments: number } | null {
  if (points.length < 3 || remainingBudget < 3) return null
  const cap = Math.max(3, Math.min(MAX_CONTOUR_SEGMENTS, remainingBudget))
  const stride = Math.max(1, Math.ceil(points.length / cap))
  const path = new Path2D()
  path.moveTo(points[0].x + 0.5, points[0].y + 0.5)
  let segments = 0
  for (let i = stride; i < points.length && segments < cap; i += stride) {
    path.lineTo(points[i].x + 0.5, points[i].y + 0.5)
    segments++
  }
  path.closePath()
  return { path, segments: segments + 1 }
}

export function selectionContours(sel: SelectionState): Path2D[] {
  if (sel._paths && sel._pathsV === sel._v) return sel._paths
  const { width: w, height: h } = sel.mask
  const d = getImageData(sel.mask).data
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] >= 128
  const paths: Path2D[] = []
  const visited = new Uint8Array(w * h)
  const dirs = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]]
  let usedSegments = 0

  outer:
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (usedSegments >= MAX_ANTS_SEGMENTS) break outer
      if (!at(x, y) || visited[y * w + x]) continue

      let isBoundary = false
      for (const [dx, dy] of dirs) {
        if (!at(x + dx, y + dy)) { isBoundary = true; break }
      }
      if (!isBoundary) {
        visited[y * w + x] = 1
        continue
      }

      const points: ContourPoint[] = [{ x, y }]
      let cx = x, cy = y
      let dir = 0
      let lastDir = -1
      let guard = 0
      const maxGuard = Math.max((w + h) * 8, 4096)
      visited[cy * w + cx] = 1

      do {
        let found = false
        for (let k = 0; k < 8; k++) {
          const nd = (dir + 6 + k) % 8
          const nx = cx + dirs[nd][0]
          const ny = cy + dirs[nd][1]
          if (!at(nx, ny)) continue

          // Preserve the endpoint of each straight run instead of every pixel.
          if (lastDir !== -1 && nd !== lastDir) points.push({ x: cx, y: cy })
          lastDir = nd
          cx = nx
          cy = ny
          dir = nd
          found = true
          visited[cy * w + cx] = 1
          break
        }
        if (!found) break
        guard++
        if (guard > maxGuard) break
      } while (!(cx === x && cy === y))

      if (points.length > 2) {
        if (points[points.length - 1].x !== cx || points[points.length - 1].y !== cy) {
          points.push({ x: cx, y: cy })
        }
        const built = pathFromContour(points, MAX_ANTS_SEGMENTS - usedSegments)
        if (built) {
          paths.push(built.path)
          usedSegments += built.segments
        }
      }
    }
  }

  sel._paths = paths
  sel._pathsV = sel._v
  return paths
}

/** draw ants into an overlay ctx (screen space transform applied outside) */
export function drawAnts(ctx: CanvasRenderingContext2D, sel: SelectionState, zoom: number, offset: number) {
  const paths = selectionContours(sel)
  if (!paths.length) return
  ctx.save()
  ctx.lineWidth = Math.max(1, 1 / Math.max(zoom, 0.02))
  ctx.strokeStyle = '#000000'
  ctx.setLineDash([4 / Math.max(zoom, 0.02), 4 / Math.max(zoom, 0.02)])
  ctx.lineDashOffset = -offset / Math.max(zoom, 0.02)
  for (const p of paths) ctx.stroke(p)
  ctx.strokeStyle = '#ffffff'
  ctx.lineDashOffset = (-offset / Math.max(zoom, 0.02)) + 4 / Math.max(zoom, 0.02)
  for (const p of paths) ctx.stroke(p)
  ctx.restore()
}

// ---------- saved channels ----------
export function saveSelectionAsChannel(doc: PsDocument, name: string): SavedChannelRef {
  const chan: SavedChannelRef = {
    id: uid(), name, mask: doc.selection ? cloneCanvas(doc.selection.mask) : createCanvas(doc.width, doc.height),
    _v: 1,
  }
  return chan
}
export interface SavedChannelRef { id: string; name: string; mask: HTMLCanvasElement; _v: number }

/** build a channel/luminosity mask canvas from a flat composite */
export function channelMaskFromComposite(composite: HTMLCanvasElement, channel: 'r' | 'g' | 'b' | 'luminosity' | 'rgb'): HTMLCanvasElement {
  const w = composite.width, h = composite.height
  const src = ctx2d(composite).getImageData(0, 0, w, h)
  const out = new ImageData(w, h)
  const d = src.data, o = out.data
  for (let i = 0; i < d.length; i += 4) {
    let v: number
    if (channel === 'r') v = d[i]
    else if (channel === 'g') v = d[i + 1]
    else if (channel === 'b') v = d[i + 2]
    else v = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) // luminosity
    o[i] = 255; o[i + 1] = 255; o[i + 2] = 255; o[i + 3] = d[i + 3] > 0 ? v : 0
  }
  const c = createCanvas(w, h)
  putImageData(c, out)
  return c
}

/** draw a mask canvas as visible grayscale into a display canvas */
export function drawMaskPreview(mask: HTMLCanvasElement, target: HTMLCanvasElement, w: number, h: number) {
  const ctx = ctx2d(target)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, w, h)
  ctx.save()
  ctx.drawImage(mask, 0, 0, w, h)
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}
