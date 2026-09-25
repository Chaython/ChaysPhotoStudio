// Selection state management — masks, combine modes, marching-ants contours
import type { Rect, SelectionCombine, SelectionState, PsDocument } from '../types'
import { createCanvas, ctx2d, cloneCanvas, getImageData, putImageData, setMaskAlpha, uid, clampRectToSize, unionRect } from '../utils/canvas'
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
  const mc = ctx2d(mask)
  let minX = w, minY = h, maxX = -1, maxY = -1

  // Scan in strips to cap peak ImageData allocation on very large documents.
  const rowsPerStrip = Math.max(1, Math.min(256, Math.floor(4_000_000 / Math.max(1, w))))
  for (let y0 = 0; y0 < h; y0 += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, h - y0)
    const d = mc.getImageData(0, y0, w, rows).data
    for (let y = 0; y < rows; y++) {
      const gy = y0 + y
      const row = y * w
      for (let x = 0; x < w; x++) {
        if (d[(row + x) * 4 + 3] <= 0) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (gy < minY) minY = gy
        if (gy > maxY) maxY = gy
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
  if (existing.mask.width !== w || existing.mask.height !== h) return selectionFromMask(cloneCanvas(mask))

  const incomingBounds = computeBounds(mask)
  if (incomingBounds.w <= 0 || incomingBounds.h <= 0) {
    return mode === 'intersect' ? null : existing
  }

  const region = clampRectToSize(
    unionRect(existing.bounds, incomingBounds),
    w,
    h,
  )
  if (region.w <= 0 || region.h <= 0) return null

  const aData = ctx2d(existing.mask).getImageData(region.x, region.y, region.w, region.h).data
  const bData = ctx2d(mask).getImageData(region.x, region.y, region.w, region.h).data
  const combined = new Uint8ClampedArray(region.w * region.h)

  for (let i = 0, j = 3; i < combined.length; i++, j += 4) {
    const a = aData[j]
    const b = bData[j]
    combined[i] = mode === 'add'
      ? Math.max(a, b)
      : mode === 'subtract'
        ? Math.max(0, a - b)
        : Math.min(a, b)
  }

  return selectionFromLocalAlpha(combined, region, w, h, Math.max(existing._v + 1, 1))
}

/** Build a document-space selection from a local alpha buffer without ever
 * allocating document-sized ImageData/Float32 work buffers. */
function selectionFromLocalAlpha(
  alpha: Uint8ClampedArray,
  region: Rect,
  docW: number,
  docH: number,
  v: number,
): SelectionState | null {
  let minX = region.w, minY = region.h, maxX = -1, maxY = -1
  const local = new ImageData(region.w, region.h)
  for (let y = 0; y < region.h; y++) {
    for (let x = 0; x < region.w; x++) {
      const i = y * region.w + x
      const a = alpha[i]
      if (!a) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const j = i * 4
      local.data[j] = 255
      local.data[j + 1] = 255
      local.data[j + 2] = 255
      local.data[j + 3] = a
    }
  }
  if (maxX < minX || maxY < minY) return null

  const mask = createCanvas(docW, docH)
  ctx2d(mask).putImageData(local, region.x, region.y)
  return {
    mask,
    bounds: {
      x: region.x + minX,
      y: region.y + minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
    },
    _v: v,
    _pathsV: -1,
    _paths: null,
  }
}

function localSelectionAlpha(sel: SelectionState, region: Rect): Uint8ClampedArray {
  const d = ctx2d(sel.mask).getImageData(region.x, region.y, region.w, region.h).data
  const out = new Uint8ClampedArray(region.w * region.h)
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = d[j]
  return out
}

function morphLocal(
  arr: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  useMax: boolean,
): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(arr.length)
  const out = new Uint8ClampedArray(arr.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = useMax ? 0 : 255
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = Math.min(w - 1, Math.max(0, x + dx))
        v = useMax ? Math.max(v, arr[y * w + xx]) : Math.min(v, arr[y * w + xx])
      }
      tmp[y * w + x] = v
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = useMax ? 0 : 255
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy))
        v = useMax ? Math.max(v, tmp[yy * w + x]) : Math.min(v, tmp[yy * w + x])
      }
      out[y * w + x] = v
    }
  }
  return out
}

/** modify selection: grow/contract/feather/border/smooth/invert
 *
 * All neighborhood-based operations work only on a padded selection rectangle.
 * The mask canvas remains document-space for compatibility, but expensive
 * Float32/temporary arrays scale with the selected area rather than the photo.
 */
export function modifySelection(sel: SelectionState, op: 'grow' | 'contract' | 'feather' | 'border' | 'smooth' | 'invert', px: number): SelectionState | null {
  const w = sel.mask.width, h = sel.mask.height

  // Invert genuinely affects the entire document and therefore cannot be
  // region-limited without changing semantics.
  if (op === 'invert') {
    const d = ctx2d(sel.mask).getImageData(0, 0, w, h)
    for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255 - d.data[i]
    const out = createCanvas(w, h)
    putImageData(out, d)
    return selectionFromMask(out, sel._v + 1)
  }

  if (sel.bounds.w <= 0 || sel.bounds.h <= 0) return null
  const amount = Math.max(0, Number(px) || 0)
  const radius = Math.max(1, Math.round(amount))
  const sigma = op === 'smooth' ? Math.max(1, amount)
    : op === 'feather' ? Math.max(.5, amount)
    : Math.max(.5, radius / 2)
  const support = op === 'grow' || op === 'contract' || op === 'border'
    ? radius + Math.ceil(sigma * 4) + 2
    : Math.ceil(sigma * 4) + 2

  const region = clampRectToSize({
    x: sel.bounds.x - support,
    y: sel.bounds.y - support,
    w: sel.bounds.w + support * 2,
    h: sel.bounds.h + support * 2,
  }, w, h)
  if (region.w <= 0 || region.h <= 0) return null

  const alpha = localSelectionAlpha(sel, region)
  let result: Uint8ClampedArray

  if (op === 'feather' || op === 'smooth') {
    const f = new Float32Array(alpha.length)
    for (let i = 0; i < alpha.length; i++) f[i] = alpha[i]
    const b = gaussianBlurChannel(f, region.w, region.h, sigma)
    result = new Uint8ClampedArray(alpha.length)
    if (op === 'feather') {
      for (let i = 0; i < result.length; i++) result[i] = b[i]
    } else {
      for (let i = 0; i < result.length; i++) result[i] = clampLocal((b[i] - 96) * 255 / 63, 0, 255)
    }
  } else {
    const bin = new Uint8ClampedArray(alpha.length)
    for (let i = 0; i < alpha.length; i++) bin[i] = alpha[i] >= 128 ? 255 : 0
    const contracted = morphLocal(bin, region.w, region.h, radius, false)

    if (op === 'border') {
      result = new Uint8ClampedArray(alpha.length)
      for (let i = 0; i < result.length; i++) result[i] = Math.max(0, alpha[i] - contracted[i])
    } else {
      const shifted = op === 'grow'
        ? morphLocal(bin, region.w, region.h, radius, true)
        : contracted
      const f = new Float32Array(shifted.length)
      for (let i = 0; i < shifted.length; i++) f[i] = shifted[i]
      const soft = gaussianBlurChannel(f, region.w, region.h, sigma)
      result = new Uint8ClampedArray(alpha.length)
      for (let i = 0; i < result.length; i++) result[i] = clampLocal((soft[i] - 100) * 255 / 55, 0, 255)
    }
  }

  return selectionFromLocalAlpha(result, region, w, h, sel._v + 1)
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
  const bx0 = Math.max(0, Math.floor(sel.bounds.x))
  const by0 = Math.max(0, Math.floor(sel.bounds.y))
  const bx1 = Math.min(w - 1, Math.ceil(sel.bounds.x + sel.bounds.w))
  const by1 = Math.min(h - 1, Math.ceil(sel.bounds.y + sel.bounds.h))
  const bw = Math.max(1, bx1 - bx0 + 1)
  const bh = Math.max(1, by1 - by0 + 1)
  const visited = new Uint8Array(bw * bh)
  const visitIndex = (x: number, y: number) => (y - by0) * bw + (x - bx0)
  const dirs = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]]
  let usedSegments = 0

  outer:
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      if (usedSegments >= MAX_ANTS_SEGMENTS) break outer
      if (!at(x, y) || visited[visitIndex(x, y)]) continue

      let isBoundary = false
      for (const [dx, dy] of dirs) {
        if (!at(x + dx, y + dy)) { isBoundary = true; break }
      }
      if (!isBoundary) {
        visited[visitIndex(x, y)] = 1
        continue
      }

      const points: ContourPoint[] = [{ x, y }]
      let cx = x, cy = y
      let dir = 0
      let lastDir = -1
      let guard = 0
      const maxGuard = Math.max((w + h) * 8, 4096)
      visited[visitIndex(cx, cy)] = 1

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
          visited[visitIndex(cx, cy)] = 1
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
