// ============================================================
// Shared dab helpers for stroke-based retouch tools (Task 2-b)
// clone-stamp / healing / spot healing / quick select / patch
// ============================================================
import type { Rect, TextSpec } from '../types'
import { createCanvas, ctx2d, clamp } from '../utils/canvas'
import { gaussianBlurImage } from '../image-ops/core'

// ---------- source-sampling dabs (clone stamp / healing brush) ----------

/**
 * Map a cursor position to the source position that feeds it, honoring a
 * persistent reference point (where cursor == clone source), an optional
 * rotation (radians) and a horizontal mirror of the sampled source.
 * The dab transform is M = R(θ)·F, so the source point moves by M⁻¹·Δcursor.
 */
export function sourcePointFor(
  x: number, y: number, refX: number, refY: number, srcX: number, srcY: number,
  rotateRad: number, mirrored: boolean, sourceScale = 1
): { x: number; y: number } {
  const scale = Math.max(0.01, Math.abs(sourceScale) || 1)
  let dx = (x - refX) / scale, dy = (y - refY) / scale
  if (rotateRad) {
    const cos = Math.cos(rotateRad), sin = Math.sin(rotateRad)
    const nx = dx * cos + dy * sin
    const ny = -dx * sin + dy * cos
    dx = nx; dy = ny
  }
  if (mirrored) dx = -dx
  return { x: srcX + dx, y: srcY + dy }
}

/**
 * Build a soft-edged dab canvas sampling `source` around (sx, sy) with the
 * brush hardness applied as a radial alpha mask (destination-in), so hardness
 * works like PS. Rotation flips/rotates the sampled region around its center.
 * The returned canvas is centered on the source point — draw it centered on
 * the dab position. Must be applied with plain source-over (engine.dab flow).
 */
export function buildSourceDab(
  source: HTMLCanvasElement, sx: number, sy: number, radius: number, hardness: number,
  rotateRad = 0, mirrored = false, sourceScale = 1
): HTMLCanvasElement | null {
  const r = Math.max(1, radius)
  if (r < 0.5) return null
  const size = Math.ceil(r * 2) + 2
  const dab = createCanvas(size, size)
  const ctx = ctx2d(dab)
  const c = size / 2
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(c, c)
  if (rotateRad) ctx.rotate(rotateRad)
  if (mirrored) ctx.scale(-1, 1)
  const scale = Math.max(0.01, Math.abs(sourceScale) || 1)
  ctx.scale(scale, scale)
  ctx.drawImage(source, -sx, -sy)
  ctx.restore()
  // radial alpha mask honoring hardness (soft edges like PS clone stamp)
  const inner = clamp(hardness / 100, 0, 0.96)
  ctx.globalCompositeOperation = 'destination-in'
  const grad = ctx.createRadialGradient(c, c, r * inner, c, c, r)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(c, c, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  return dab
}

// ---------- math helpers ----------

export function smoothstep(lo: number, hi: number, v: number): number {
  if (hi <= lo) return v >= hi ? 1 : 0
  const t = clamp((v - lo) / (hi - lo), 0, 1)
  return t * t * (3 - 2 * t)
}

/** pen pressure → flow ramp (mouse/touch gets full flow) */
export function pressureFlow(pressure: number, isPen: boolean, flow: number): number {
  if (!isPen) return flow
  return flow * (0.35 + 0.65 * clamp(pressure, 0, 1))
}

// ---------- frequency separation (healing brush / patch) ----------

/** copy of an ImageData blurred by `radius` (RGB only, alpha preserved) */
export function blurredCopy(img: ImageData, radius: number): ImageData {
  const out = new ImageData(img.width, img.height)
  out.data.set(img.data)
  gaussianBlurImage(out, radius)
  return out
}

/**
 * Frequency-separation heal: adjust `target` so its LOW frequency matches the
 * low frequency of `base` (the original pixels) — the texture/detail comes
 * from target while luminance & ambient shading come from the surroundings.
 * Mutates target in place. `restrict` (optional, 0..255) limits the correction.
 */
export function frequencyHeal(
  target: ImageData, base: ImageData, restrict: Uint8ClampedArray | null, lowRadius: number
) {
  if (lowRadius < 0.5) return
  const lowBase = blurredCopy(base, lowRadius)
  const lowTgt = blurredCopy(target, lowRadius)
  const t = target.data, lb = lowBase.data, lt = lowTgt.data
  for (let i = 0, p = 0; i < t.length; i += 4, p++) {
    if (restrict && restrict[p] < 4) continue
    for (let c = 0; c < 3; c++) {
      const v = t[i + c] + (lb[i + c] - lt[i + c])
      t[i + c] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }
}

// ---------- quick-select helpers ----------

/** average opaque color inside a disk (reference color for flood grow) */
export function diskAverageColor(img: ImageData, cx: number, cy: number, radius: number): [number, number, number] | null {
  const { width: w, height: h, data } = img
  const r = Math.max(1, radius)
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r))
  let ar = 0, ag = 0, ab = 0, n = 0
  const r2 = r * r
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy
      if (dx * dx + dy * dy > r2) continue
      const i = (y * w + x) * 4
      if (data[i + 3] < 8) continue
      ar += data[i]; ag += data[i + 1]; ab += data[i + 2]; n++
    }
  }
  if (!n) return null
  return [ar / n, ag / n, ab / n]
}

export interface DiskGrowRegion {
  x: number
  y: number
  w: number
  h: number
  data: Uint8ClampedArray
}

/**
 * Flood-grow only the brush-local rectangle instead of allocating three
 * document-sized arrays for every Quick Selection pointer event.
 */
export function growDiskRegion(
  img: ImageData, cx: number, cy: number, radius: number,
  ref: [number, number, number] | null, tol: number,
): DiskGrowRegion {
  const { width: w, height: h, data } = img
  const r = Math.max(2, radius)
  const x0 = Math.max(0, Math.floor(cx - r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const x1 = Math.min(w - 1, Math.ceil(cx + r))
  const y1 = Math.min(h - 1, Math.ceil(cy + r))
  const rw = Math.max(1, x1 - x0 + 1)
  const rh = Math.max(1, y1 - y0 + 1)
  const mask = new Uint8ClampedArray(rw * rh)
  const seen = new Uint8Array(rw * rh)
  const queue = new Int32Array(rw * rh)

  const seedX = clamp(Math.round(cx), x0, x1)
  const seedY = clamp(Math.round(cy), y0, y1)
  const seedGlobal = seedY * w + seedX
  const [rr, rg, rb] = ref ?? [
    data[seedGlobal * 4],
    data[seedGlobal * 4 + 1],
    data[seedGlobal * 4 + 2],
  ]
  const r2 = r * r
  const tol2 = (tol + 1) * (tol + 1) * 3
  let head = 0, tail = 0
  const seedLocal = (seedY - y0) * rw + (seedX - x0)
  queue[tail++] = seedLocal
  seen[seedLocal] = 1

  while (head < tail) {
    const li = queue[head++]
    const lx = li % rw
    const ly = Math.floor(li / rw)
    const x = x0 + lx
    const y = y0 + ly
    const dx = x - cx, dy = y - cy
    if (dx * dx + dy * dy > r2) continue

    const gi = y * w + x
    const i = gi * 4
    const dr = data[i] - rr, dg = data[i + 1] - rg, db = data[i + 2] - rb
    if ((dr * dr + dg * dg + db * db) * 0.34 > tol2) continue
    mask[li] = 255

    if (lx + 1 < rw) {
      const n = li + 1
      if (!seen[n]) { seen[n] = 1; queue[tail++] = n }
    }
    if (lx > 0) {
      const n = li - 1
      if (!seen[n]) { seen[n] = 1; queue[tail++] = n }
    }
    if (ly + 1 < rh) {
      const n = li + rw
      if (!seen[n]) { seen[n] = 1; queue[tail++] = n }
    }
    if (ly > 0) {
      const n = li - rw
      if (!seen[n]) { seen[n] = 1; queue[tail++] = n }
    }
  }
  return { x: x0, y: y0, w: rw, h: rh, data: mask }
}

/** Backward-compatible full-size form for callers that explicitly need one. */
export function growDisk(
  img: ImageData, cx: number, cy: number, radius: number,
  ref: [number, number, number] | null, tol: number,
): Uint8ClampedArray {
  const region = growDiskRegion(img, cx, cy, radius, ref, tol)
  const out = new Uint8ClampedArray(img.width * img.height)
  for (let y = 0; y < region.h; y++) {
    out.set(
      region.data.subarray(y * region.w, (y + 1) * region.w),
      (region.y + y) * img.width + region.x,
    )
  }
  return out
}

// ---------- gradient dithering ----------

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/** ordered (Bayer 4×4) dither to prevent banding in gradient fills */
export function ditherGradient(img: ImageData, amount = 2) {
  const { width: w, height: h, data } = img
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * amount
      const i = (y * w + x) * 4
      data[i] = clamp(data[i] + n, 0, 255)
      data[i + 1] = clamp(data[i + 1] + n, 0, 255)
      data[i + 2] = clamp(data[i + 2] + n, 0, 255)
    }
  }
}

// ---------- text measurement (hit testing for the type tool) ----------

let scratchCtx: CanvasRenderingContext2D | null = null

/** approximate on-canvas bounds of a text layer's glyphs (matches renderTextCanvas metrics) */
export function measureTextSpecBounds(spec: TextSpec): Rect {
  if (!scratchCtx) scratchCtx = ctx2d(createCanvas(8, 8))
  const ctx = scratchCtx
  const weight = spec.bold ? '700' : '400'
  const style = spec.italic ? 'italic ' : ''
  ctx.font = `${style}${weight} ${spec.fontSize}px ${spec.fontFamily}`
  ;(ctx as any).fontKerning = spec.kerning === false ? 'none' : 'normal'
  const lines = (spec.content || '').split('\n')
  const lh = spec.fontSize * (spec.lineHeight || 1.2)
  const padX = spec.fontSize * 0.25
  const padY = spec.fontSize * 0.25
  if (spec.boxWidth) {
    // Paragraph layers use their editable frame for hit testing; text may be
    // clipped or wrapped inside it, so glyph-only bounds would make empty
    // parts of the text box impossible to reactivate.
    return {
      x: spec.x - padX,
      y: spec.y - padY,
      w: Math.max(1, spec.boxWidth) + padX * 2,
      h: Math.max(lh, spec.boxHeight ?? lh * Math.max(1, lines.length)) + padY * 2,
    }
  }
  if (spec.direction === 'vertical') {
    const tracking = Number(spec.tracking) || 0
    const maxChars = Math.max(1, ...lines.map(v => v.length))
    return {
      x: spec.x - padX,
      y: spec.y - padY,
      w: Math.max(spec.fontSize, lines.length * lh) + padX * 2,
      h: Math.max(spec.fontSize, maxChars * lh + Math.max(0, maxChars - 1) * tracking) + padY * 2,
    }
  }

  let maxW = spec.fontSize * 0.5
  for (const line of lines) {
    const tracking = (spec.tracking || 0) * Math.max(0, line.length - 1)
    maxW = Math.max(maxW, ctx.measureText(line || ' ').width + tracking)
  }
  return {
    x: spec.x - padX,
    y: spec.y - padY,
    w: maxW + padX * 2,
    h: lh * lines.length + padY * 2,
  }
}
