// ============================================================
// On-device object detection — classic computer vision, zero
// network. Analyzes a downscaled composite in four stages:
//
//   1. background model — mean color of the border ring (the
//      frame around the subject; transparent frames count as a
//      color too, so cut-out PNGs detect their subject)
//   2. saliency map — per-pixel color distance from the
//      background model, boosted by local edge energy
//   3. adaptive threshold + morphological close (dilate then
//      erode) to consolidate fragmented regions
//   4. connected components → bounding boxes, filtered by area,
//      merged on overlap, sorted by size
//
// Boxes are returned as fractions of the image (0..1), matching
// the layer-extraction contract used by the Detect Objects
// dialog. Runs in well under 100 ms for typical photos.
// ============================================================
import { createCanvas, ctx2d } from '../utils/canvas'

export interface DetectedObject {
  label: string
  x: number // 0..1 — left edge, fraction of image width
  y: number // 0..1 — top edge, fraction of image height
  w: number // 0..1 — box width as a fraction of image width
  h: number // 0..1 — box height as a fraction of image height
}

const MAX_ANALYSIS_EDGE = 384 // analysis resolution (long edge)
const MAX_OBJECTS = 24
const MIN_AREA = 0.003 // smallest kept box (0.3% of the image)
const MAX_AREA = 0.60 // largest kept box (60% — above ≈ background)
const MERGE_IOU = 0.35 // boxes overlapping more than this merge
const BOX_MARGIN = 0.015 // box padding (fraction of image)

/** Detect salient object regions in a canvas. Returns [] when the
 *  image is visually flat (an honest "no clear objects" answer). */
export function detectObjects(src: HTMLCanvasElement): DetectedObject[] {
  const long = Math.max(src.width, src.height)
  const k = long > MAX_ANALYSIS_EDGE ? MAX_ANALYSIS_EDGE / long : 1
  const w = Math.max(2, Math.round(src.width * k))
  const h = Math.max(2, Math.round(src.height * k))
  const work = createCanvas(w, h)
  const wc = ctx2d(work)
  wc.imageSmoothingQuality = 'high'
  wc.drawImage(src, 0, 0, w, h)
  const d = ctx2d(work).getImageData(0, 0, w, h).data
  const n = w * h

  // ---- 1. background model: mean color (RGBA) of the border ring ----
  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.02))
  let br = 0, bg = 0, bb = 0, ba = 0, bn = 0
  const borderPixel = (x: number, y: number) => {
    const i = (y * w + x) * 4
    br += d[i]; bg += d[i + 1]; bb += d[i + 2]; ba += d[i + 3]; bn++
  }
  for (let x = 0; x < w; x++) {
    for (let t = 0; t < ring; t++) { borderPixel(x, t); borderPixel(x, h - 1 - t) }
  }
  for (let y = ring; y < h - ring; y++) {
    for (let t = 0; t < ring; t++) { borderPixel(t, y); borderPixel(w - 1 - t, y) }
  }
  br /= bn; bg /= bn; bb /= bn; ba /= bn

  // ---- 2. saliency: color distance from background + edge energy ----
  const sal = new Float32Array(n)
  let mean = 0
  for (let i = 0; i < n; i++) {
    const p = i * 4
    const dist =
      (Math.abs(d[p] - br) + Math.abs(d[p + 1] - bg) + Math.abs(d[p + 2] - bb) + Math.abs(d[p + 3] - ba)) / 1020
    sal[i] = dist
    mean += dist
  }
  mean /= n
  let variance = 0
  for (let i = 0; i < n; i++) variance += (sal[i] - mean) ** 2
  const std = Math.sqrt(variance / n)

  // Sobel-ish edge energy on the green channel, folded in at 35%
  const edge = (x: number, y: number) => {
    const c = d[(y * w + x) * 4 + 1]
    const l = x > 0 ? d[(y * w + x - 1) * 4 + 1] : c
    const r = x < w - 1 ? d[(y * w + x + 1) * 4 + 1] : c
    const u = y > 0 ? d[((y - 1) * w + x) * 4 + 1] : c
    const dn = y < h - 1 ? d[((y + 1) * w + x) * 4 + 1] : c
    return Math.min(1, (Math.abs(l - r) + Math.abs(u - dn)) / 160)
  }

  // ---- 3. adaptive threshold + morphological close ----
  const threshold = Math.min(0.5, Math.max(0.12, mean + 0.8 * std))
  const mask = new Uint8Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      mask[i] = sal[i] + 0.35 * edge(x, y) > threshold ? 1 : 0
    }
  }
  morphDilate(mask, w, h, 2)
  morphErode(mask, w, h, 2)

  // ---- 4. connected components (4-connectivity flood fill) ----
  const visited = new Uint8Array(n)
  const stack = new Int32Array(n)
  type Box = { x0: number; y0: number; x1: number; y1: number; area: number }
  const boxes: Box[] = []
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const start = sy * w + sx
      if (!mask[start] || visited[start]) continue
      let sp = 0
      stack[sp++] = start
      visited[start] = 1
      let x0 = sx, y0 = sy, x1 = sx, y1 = sy, area = 0
      while (sp > 0) {
        const idx = stack[--sp]
        const x = idx % w, y = (idx - x) / w
        area++
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
        if (x > 0 && mask[idx - 1] && !visited[idx - 1]) { visited[idx - 1] = 1; stack[sp++] = idx - 1 }
        if (x < w - 1 && mask[idx + 1] && !visited[idx + 1]) { visited[idx + 1] = 1; stack[sp++] = idx + 1 }
        if (y > 0 && mask[idx - w] && !visited[idx - w]) { visited[idx - w] = 1; stack[sp++] = idx - w }
        if (y < h - 1 && mask[idx + w] && !visited[idx + w]) { visited[idx + w] = 1; stack[sp++] = idx + w }
      }
      const frac = area / n
      if (frac >= MIN_AREA && frac <= MAX_AREA) boxes.push({ x0, y0, x1, y1, area })
    }
  }
  if (boxes.length === 0) return []

  // merge heavily overlapping boxes (single pass, largest first)
  boxes.sort((a, b) => b.area - a.area)
  const kept: Box[] = []
  for (const b of boxes) {
    let absorbed = false
    for (const kbox of kept) {
      const ix0 = Math.max(b.x0, kbox.x0), iy0 = Math.max(b.y0, kbox.y0)
      const ix1 = Math.min(b.x1, kbox.x1), iy1 = Math.min(b.y1, kbox.y1)
      if (ix1 > ix0 && iy1 > iy0) {
        const inter = (ix1 - ix0) * (iy1 - iy0)
        const union = b.area + kbox.area - inter
        const iou = union > 0 ? inter / union : 0
        const smaller = Math.min(b.area, kbox.area)
        if (inter / smaller > MERGE_IOU || iou > 0.45) {
          kbox.x0 = Math.min(kbox.x0, b.x0); kbox.y0 = Math.min(kbox.y0, b.y0)
          kbox.x1 = Math.max(kbox.x1, b.x1); kbox.y1 = Math.max(kbox.y1, b.y1)
          kbox.area += b.area
          absorbed = true
          break
        }
      }
    }
    if (!absorbed) kept.push(b)
    if (kept.length >= MAX_OBJECTS) break
  }

  // to fractions (with margin), sorted by area, labeled
  return kept.slice(0, MAX_OBJECTS).map((b, i) => {
    let x = b.x0 / w - BOX_MARGIN, y = b.y0 / h - BOX_MARGIN
    let bw = (b.x1 - b.x0 + 1) / w + BOX_MARGIN * 2, bh = (b.y1 - b.y0 + 1) / h + BOX_MARGIN * 2
    x = Math.max(0, x); y = Math.max(0, y)
    if (x + bw > 1) bw = 1 - x
    if (y + bh > 1) bh = 1 - y
    return { label: `Object ${i + 1}`, x, y, w: bw, h: bh }
  })
}

// ---- binary morphology (in-place, box structuring element) ----

function morphDilate(mask: Uint8Array, w: number, h: number, r: number) {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0
      for (let t = -r; t <= r && !on; t++) {
        const xx = x + t
        if (xx >= 0 && xx < w && mask[y * w + xx]) on = 1
      }
      out[y * w + x] = on
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0
      for (let t = -r; t <= r && !on; t++) {
        const yy = y + t
        if (yy >= 0 && yy < h && out[yy * w + x]) on = 1
      }
      mask[y * w + x] = on
    }
  }
}

function morphErode(mask: Uint8Array, w: number, h: number, r: number) {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 1
      for (let t = -r; t <= r && on; t++) {
        const xx = x + t
        if (xx < 0 || xx >= w || !mask[y * w + xx]) on = 0
      }
      out[y * w + x] = on
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 1
      for (let t = -r; t <= r && on; t++) {
        const yy = y + t
        if (yy < 0 || yy >= h || !out[yy * w + x]) on = 0
      }
      mask[y * w + x] = on
    }
  }
}
