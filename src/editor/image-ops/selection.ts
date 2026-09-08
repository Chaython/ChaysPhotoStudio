// ============================================================
// AI / analysis selections: Select Subject, Object Selection,
// Quick Selection, Color Range, Focus Area, Select & Mask
// refinement and color decontamination.
// Pure functions — no DOM / engine imports.
// ============================================================

import { clamp } from '../utils/canvas'
import {
  dilateMask, downsampleImage, erodeMask, gaussianBlurChannel, otsuThreshold,
} from './core'
import { hueFamilyWeight, luma, rgbToHsv, rgbToLab } from './color'
import { mulberry32, smoothRamp } from './interp'
import { maskToFloat, resampleMask, sobel } from './blur'

// ---------------------------------------------------------------- shared

interface KMeansResult { centers: Float32Array; counts: Float32Array }

/** k-means over Lab samples (data = n*3 floats), k-means++ style seeding */
function kmeans3(data: Float32Array, n: number, k: number, iters: number, seed: number): KMeansResult {
  const centers = new Float32Array(k * 3)
  const counts = new Float32Array(k)
  if (n === 0) return { centers, counts }
  const rand = mulberry32(seed)
  k = Math.min(k, n)
  // spread seeding
  const first = Math.floor(rand() * n) % n
  const chosen = [first]
  while (chosen.length < k) {
    let bestI = -1
    let bestD = -1
    for (let t = 0; t < 24; t++) {
      const i = Math.floor(rand() * n) % n
      let dmin = Infinity
      for (const c of chosen) {
        const dx = data[i * 3] - data[c * 3]
        const dy = data[i * 3 + 1] - data[c * 3 + 1]
        const dz = data[i * 3 + 2] - data[c * 3 + 2]
        const d = dx * dx + dy * dy + dz * dz
        if (d < dmin) dmin = d
      }
      if (dmin > bestD) { bestD = dmin; bestI = i }
    }
    if (bestI < 0) bestI = Math.floor(rand() * n) % n
    chosen.push(bestI)
  }
  for (let c = 0; c < k; c++) {
    centers[c * 3] = data[chosen[c] * 3]
    centers[c * 3 + 1] = data[chosen[c] * 3 + 1]
    centers[c * 3 + 2] = data[chosen[c] * 3 + 2]
  }
  const assign = new Int32Array(n)
  const sums = new Float64Array(k * 3)
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < k; c++) {
        const dx = data[i * 3] - centers[c * 3]
        const dy = data[i * 3 + 1] - centers[c * 3 + 1]
        const dz = data[i * 3 + 2] - centers[c * 3 + 2]
        const d = dx * dx + dy * dy + dz * dz
        if (d < bestD) { bestD = d; best = c }
      }
      assign[i] = best
    }
    sums.fill(0)
    counts.fill(0)
    for (let i = 0; i < n; i++) {
      const a = assign[i] * 3
      sums[a] += data[i * 3]
      sums[a + 1] += data[i * 3 + 1]
      sums[a + 2] += data[i * 3 + 2]
      counts[assign[i]]++
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centers[c * 3] = sums[c * 3] / counts[c]
        centers[c * 3 + 1] = sums[c * 3 + 1] / counts[c]
        centers[c * 3 + 2] = sums[c * 3 + 2] / counts[c]
      } else {
        const i = Math.floor(rand() * n) % n
        centers[c * 3] = data[i * 3]
        centers[c * 3 + 1] = data[i * 3 + 1]
        centers[c * 3 + 2] = data[i * 3 + 2]
      }
    }
  }
  return { centers, counts }
}

/**
 * Keep connected components (4-connectivity) that are large enough and near
 * the image center; returns the filtered binary mask.
 */
function filterComponents(bin: Uint8Array, w: number, h: number, minArea: number, centerFrac: number): Uint8Array {
  const n = w * h
  const labels = new Int32Array(n).fill(-1)
  const stack = new Int32Array(n)
  const keepFlag: boolean[] = []
  let compId = 0
  let largest = -1
  let largestArea = 0
  for (let start = 0; start < n; start++) {
    if (!bin[start] || labels[start] >= 0) continue
    let sp = 0
    stack[sp++] = start
    labels[start] = compId
    let area = 0
    let sx = 0
    let sy = 0
    while (sp > 0) {
      const p = stack[--sp]
      const px = p % w
      const py = (p / w) | 0
      area++
      sx += px
      sy += py
      if (px > 0 && bin[p - 1] && labels[p - 1] < 0) { labels[p - 1] = compId; stack[sp++] = p - 1 }
      if (px < w - 1 && bin[p + 1] && labels[p + 1] < 0) { labels[p + 1] = compId; stack[sp++] = p + 1 }
      if (py > 0 && bin[p - w] && labels[p - w] < 0) { labels[p - w] = compId; stack[sp++] = p - w }
      if (py < h - 1 && bin[p + w] && labels[p + w] < 0) { labels[p + w] = compId; stack[sp++] = p + w }
    }
    const cx = sx / area / w
    const cy = sy / area / h
    const m = (1 - centerFrac) / 2
    const ok = area >= minArea && cx >= m && cx <= 1 - m && cy >= m && cy <= 1 - m
    keepFlag.push(ok)
    if (area > largestArea) { largestArea = area; largest = compId }
    compId++
  }
  // if nothing survived the center/area test, keep the largest component
  if (!keepFlag.some(Boolean) && largest >= 0) keepFlag[largest] = true
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (bin[i] && labels[i] >= 0 && keepFlag[labels[i]]) out[i] = 1
  }
  return out
}

/** fill interior holes of a binary mask (background regions not touching the border) */
function fillHoles(bin: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h
  const outside = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0
  const push = (p: number) => {
    if (!outside[p] && !bin[p]) { outside[p] = 1; stack[sp++] = p }
  }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (sp > 0) {
    const p = stack[--sp]
    const px = p % w
    const py = (p / w) | 0
    if (px > 0) push(p - 1)
    if (px < w - 1) push(p + 1)
    if (py > 0) push(p - w)
    if (py < h - 1) push(p + w)
  }
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = bin[i] || !outside[i] ? 1 : 0
  return out
}

/** gaussian feather of a mask (in 0..255), returns new array */
function featherMask(mask: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  if (radius < 0.5) return mask
  const f = maskToFloat(mask)
  const blurred = gaussianBlurChannel(f, w, h, radius)
  const out = new Uint8ClampedArray(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = blurred[i] * 255
  return out
}

// ================================================================ Select Subject

/**
 * Saliency-based subject selection:
 *  (a) edge density (Sobel magnitude, blurred)
 *  (b) color distinctness from a border-ring k-means color model
 *  (c) center prior
 * combined, blurred, Otsu-thresholded, cleaned with open/close + hole fill,
 * component-filtered (>2% area, near center), upsampled bilinearly and
 * feathered ~1.5px.
 */
export function selectSubject(img: ImageData): Uint8ClampedArray {
  const small = downsampleImage(img, 200)
  const { width: w, height: h, data } = small
  const n = w * h

  // ---- (a) edge density ----
  const lum = new Float32Array(n)
  for (let i = 0; i < n; i++) lum[i] = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
  const { gx, gy } = sobel(lum, w, h)
  const edges = new Float32Array(n)
  let eSum = 0
  for (let i = 0; i < n; i++) {
    edges[i] = Math.abs(gx[i]) + Math.abs(gy[i])
    eSum += edges[i]
  }
  const blurredEdges = gaussianBlurChannel(edges, w, h, Math.max(1.5, Math.min(w, h) / 45))
  const eMean = eSum / n + 1e-3
  const eNorm = 1 / (eMean * 2.6)

  // ---- (b) border-ring color model (k-means, k=5, in Lab) ----
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.07))
  let ringCount = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x += 2) {
      if (x < band || y < band || x >= w - band || y >= h - band) ringCount++
    }
  }
  const samples = new Float32Array(Math.max(1, ringCount) * 3)
  const labT = [0, 0, 0]
  {
    let si = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x += 2) {
        if (x < band || y < band || x >= w - band || y >= h - band) {
          const i = (y * w + x) * 4
          rgbToLab(data[i], data[i + 1], data[i + 2], labT)
          samples[si++] = labT[0]
          samples[si++] = labT[1]
          samples[si++] = labT[2]
        }
      }
    }
    ringCount = si / 3
  }
  const { centers, counts } = kmeans3(samples, ringCount, 5, 8, 0x51ab)
  const KC = Math.min(5, Math.max(1, ringCount))
  // per-cluster sigma for Mahalanobis-ish distance
  const sig2 = new Float32Array(KC)
  {
    const acc = new Float32Array(KC)
    for (let s = 0; s < ringCount; s++) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < KC; c++) {
        const dx = samples[s * 3] - centers[c * 3]
        const dy = samples[s * 3 + 1] - centers[c * 3 + 1]
        const dz = samples[s * 3 + 2] - centers[c * 3 + 2]
        const d = dx * dx + dy * dy + dz * dz
        if (d < bestD) { bestD = d; best = c }
      }
      acc[best] += bestD
    }
    for (let c = 0; c < KC; c++) {
      const varC = counts[c] > 1 ? acc[c] / counts[c] : 400
      sig2[c] = Math.max(120, varC)
    }
  }

  // ---- (c) center prior ----
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const sig2c = Math.pow(Math.min(w, h) * 0.42, 2)

  // ---- combine (edge density + normalized distinctness + center prior) ----
  const sal = new Float32Array(n)
  const distinct = new Float32Array(n)
  let dSum = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const i4 = i * 4
      rgbToLab(data[i4], data[i4 + 1], data[i4 + 2], labT)
      let bestD = Infinity
      for (let c = 0; c < KC; c++) {
        const dx = labT[0] - centers[c * 3]
        const dy = labT[1] - centers[c * 3 + 1]
        const dz = labT[2] - centers[c * 3 + 2]
        const d = (dx * dx + dy * dy + dz * dz) / sig2[c]
        if (d < bestD) bestD = d
      }
      distinct[i] = Math.sqrt(bestD)
      dSum += distinct[i]
    }
  }
  const dMean = dSum / n + 1e-3
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const en = Math.min(1, blurredEdges[i] * eNorm)
      const dn = Math.min(1, distinct[i] / (dMean * 1.9))
      const dxc = x - cx
      const dyc = y - cy
      const cp = Math.exp(-(dxc * dxc + dyc * dyc) / (2 * sig2c))
      sal[i] = en * 0.42 + dn * 0.38 + cp * 0.2
    }
  }

  // ---- smooth + Otsu threshold ----
  const salB = gaussianBlurChannel(sal, w, h, Math.max(1.2, Math.min(w, h) / 60))
  const hist = new Uint32Array(256)
  let sMax = 1e-3
  for (let i = 0; i < n; i++) if (salB[i] > sMax) sMax = salB[i]
  for (let i = 0; i < n; i++) {
    hist[Math.min(255, Math.round(salB[i] / sMax * 255)) | 0]++
  }
  const thr = otsuThreshold(hist, n) / 255 * sMax

  const bin = new Uint8Array(n)
  for (let i = 0; i < n; i++) bin[i] = salB[i] > thr ? 1 : 0

  // ---- morphology: open (remove speckle), close (solidify), fill holes ----
  const bin255 = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) bin255[i] = bin[i] * 255
  let m = erodeMask(bin255, w, h, 1)
  m = dilateMask(m, w, h, 1)        // open
  m = dilateMask(m, w, h, 2)
  m = erodeMask(m, w, h, 2)          // close
  const m2 = new Uint8Array(n)
  for (let i = 0; i < n; i++) m2[i] = m[i] > 127 ? 1 : 0
  const filled = fillHoles(m2, w, h)

  // ---- component filtering: >2% area and near center ----
  const kept = filterComponents(filled, w, h, Math.max(12, n * 0.02), 0.7)
  const kept255 = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) kept255[i] = kept[i] * 255

  // ---- upsample to full resolution + feather ----
  const up = resampleMask(kept255, w, h, img.width, img.height)
  return featherMask(up, img.width, img.height, 1.5)
}

// ================================================================ Object Selection

/**
 * GrabCut-lite: k-means (k=5) color models in Lab for foreground (center
 * ellipse) and background (border ring), 4 rounds of assignment with 3×3
 * majority smoothing between rounds, soft output mask with 1px feather.
 */
export function objectSelect(img: ImageData, x: number, y: number, w: number, h: number): Uint8ClampedArray {
  const W = img.width
  const H = img.height
  const out = new Uint8ClampedArray(W * H)
  const bx = Math.max(0, Math.floor(x))
  const by = Math.max(0, Math.floor(y))
  const bw = Math.min(W, Math.ceil(x + w)) - bx
  const bh = Math.min(H, Math.ceil(y + h)) - by
  if (bw < 8 || bh < 8) return out
  const n = bw * bh
  const data = img.data

  // region pixels in Lab (computed once, reused by every round)
  const lab = new Float32Array(n * 3)
  {
    const t = [0, 0, 0]
    let si = 0
    for (let yy = 0; yy < bh; yy++) {
      for (let xx = 0; xx < bw; xx++) {
        const i = ((by + yy) * W + bx + xx) * 4
        rgbToLab(data[i], data[i + 1], data[i + 2], t)
        lab[si++] = t[0]; lab[si++] = t[1]; lab[si++] = t[2]
      }
    }
  }

  // foreground seeds: center ellipse (radii ~32% of the box)
  // background seeds: border ring (14% margin)
  const ecx = bw / 2
  const ecy = bh / 2
  const erx = Math.max(2, bw * 0.32)
  const ery = Math.max(2, bh * 0.32)
  const margin = Math.max(3, Math.round(Math.min(bw, bh) * 0.14))

  const cap = 4000
  const fgSamples = new Float32Array(n * 3)
  const bgSamples = new Float32Array(n * 3)
  let nFg = 0
  let nBg = 0
  const stride = Math.max(1, Math.floor(Math.sqrt(n / cap)))
  for (let yy = 0; yy < bh; yy += stride) {
    for (let xx = 0; xx < bw; xx += stride) {
      const i = yy * bw + xx
      const inEllipse = ((xx - ecx) / erx) ** 2 + ((yy - ecy) / ery) ** 2 <= 1
      const inRing = xx < margin || yy < margin || xx >= bw - margin || yy >= bh - margin
      if (inEllipse && !inRing) {
        fgSamples[nFg * 3] = lab[i * 3]; fgSamples[nFg * 3 + 1] = lab[i * 3 + 1]; fgSamples[nFg * 3 + 2] = lab[i * 3 + 2]
        nFg++
      } else if (inRing) {
        bgSamples[nBg * 3] = lab[i * 3]; bgSamples[nBg * 3 + 1] = lab[i * 3 + 1]; bgSamples[nBg * 3 + 2] = lab[i * 3 + 2]
        nBg++
      }
    }
  }
  if (nFg === 0 || nBg === 0) return out

  const K = 5
  let fg = kmeans3(fgSamples, nFg, K, 8, 0x1234)
  let bg = kmeans3(bgSamples, nBg, K, 8, 0x5678)

  let labels = new Uint8Array(n)
  const soft = new Float32Array(n)

  const evalRound = () => {
    // nearest-cluster squared distances -> soft label
    for (let i = 0; i < n; i++) {
      let dfg = Infinity
      let dbg = Infinity
      for (let c = 0; c < K; c++) {
        const dx = lab[i * 3] - fg.centers[c * 3]
        const dy = lab[i * 3 + 1] - fg.centers[c * 3 + 1]
        const dz = lab[i * 3 + 2] - fg.centers[c * 3 + 2]
        const d = dx * dx + dy * dy + dz * dz
        if (d < dfg) dfg = d
        const dx2 = lab[i * 3] - bg.centers[c * 3]
        const dy2 = lab[i * 3 + 1] - bg.centers[c * 3 + 1]
        const dz2 = lab[i * 3 + 2] - bg.centers[c * 3 + 2]
        const d2 = dx2 * dx2 + dy2 * dy2 + dz2 * dz2
        if (d2 < dbg) dbg = d2
      }
      // scale by cluster size (GMM-ish prior)
      const ratio = (dbg - dfg) / (0.5 * (dbg + dfg) + 60)
      soft[i] = clamp(0.5 + ratio * 1.15, 0, 1)
      labels[i] = soft[i] > 0.5 ? 1 : 0
    }
  }

  for (let round = 0; round < 4; round++) {
    evalRound()
    // spatial smoothing: 3×3 majority vote
    const smoothed = new Uint8Array(n)
    for (let yy = 0; yy < bh; yy++) {
      for (let xx = 0; xx < bw; xx++) {
        const i = yy * bw + xx
        let cnt = 0
        for (let dy = -1; dy <= 1; dy++) {
          const ny = yy + dy
          if (ny < 0 || ny >= bh) continue
          for (let dx = -1; dx <= 1; dx++) {
            const nx = xx + dx
            if (nx < 0 || nx >= bw) continue
            cnt += labels[ny * bw + nx]
          }
        }
        smoothed[i] = cnt >= 5 ? 1 : 0
      }
    }
    labels = smoothed
    // re-estimate color models from the (smoothed) labels
    if (round < 3) {
      let cf = 0
      let cb = 0
      for (let i = 0; i < n; i += stride) {
        const s = labels[i] ? fgSamples : bgSamples
        const cnt = labels[i] ? cf : cb
        s[cnt * 3] = lab[i * 3]; s[cnt * 3 + 1] = lab[i * 3 + 1]; s[cnt * 3 + 2] = lab[i * 3 + 2]
        if (labels[i]) cf++
        else cb++
      }
      if (cf >= K) fg = kmeans3(fgSamples, cf, K, 6, 0x9a + round)
      if (cb >= K) bg = kmeans3(bgSamples, cb, K, 6, 0xb3 + round)
    }
  }
  // final soft assignment (centers may have moved after the last smoothing)
  evalRound()

  // write into the full-size mask + 1px feather
  const regionMask = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) regionMask[i] = soft[i] * 255
  const softFeathered = featherMask(regionMask, bw, bh, 1)
  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      out[(by + yy) * W + bx + xx] = softFeathered[yy * bw + xx]
    }
  }
  return out
}

// ================================================================ Quick Selection

/**
 * Samples the average color under a small disk at (x, y), region-grows
 * (BFS, 4-connectivity) within the brush radius with the given tolerance,
 * unions with the previous mask and feathers 1px.
 */
export function quickSelectRegion(
  img: ImageData, x: number, y: number, radius: number, tolerance: number,
  prevMask?: Uint8ClampedArray | null,
): Uint8ClampedArray {
  const W = img.width
  const H = img.height
  const data = img.data
  const cx = clamp(Math.round(x), 0, W - 1)
  const cy = clamp(Math.round(y), 0, H - 1)
  const r = Math.max(3, Math.round(radius))

  // average color under a small disk
  const dr = clamp(Math.round(radius / 3), 2, 14)
  let ar = 0, ag = 0, ab = 0, an = 0
  for (let dy = -dr; dy <= dr; dy++) {
    for (let dx = -dr; dx <= dr; dx++) {
      if (dx * dx + dy * dy > dr * dr) continue
      const xx = clamp(cx + dx, 0, W - 1)
      const yy = clamp(cy + dy, 0, H - 1)
      const i = (yy * W + xx) * 4
      ar += data[i]; ag += data[i + 1]; ab += data[i + 2]; an++
    }
  }
  ar /= an; ag /= an; ab /= an

  // BFS region grow within the brush circle (each pixel is pushed at most
  // once: seen is set at push time, so the stack can never overflow)
  const mask = new Uint8ClampedArray(W * H)
  if (prevMask) mask.set(prevMask)
  const tol2 = Math.pow((tolerance + 1) * 1.9, 2)
  const r2 = r * r
  const stack = new Int32Array(W * H)
  const seen = new Uint8Array(W * H)
  let sp = 0
  const tryPush = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= W || py >= H) return
    const p = py * W + px
    if (seen[p]) return
    const dxc = px - cx
    const dyc = py - cy
    if (dxc * dxc + dyc * dyc > r2) return
    seen[p] = 1
    stack[sp++] = p
  }
  tryPush(cx, cy)
  while (sp > 0) {
    const p = stack[--sp]
    const i = p * 4
    const drC = data[i] - ar
    const dgC = data[i + 1] - ag
    const dbC = data[i + 2] - ab
    if (drC * drC + dgC * dgC + dbC * dbC > tol2) continue
    mask[p] = 255
    const px = p % W
    const py = (p / W) | 0
    tryPush(px + 1, py)
    tryPush(px - 1, py)
    tryPush(px, py + 1)
    tryPush(px, py - 1)
  }

  // 1px feather (only softens; union preserved by starting from max)
  return featherMask(mask, W, H, 1)
}

// ================================================================ Color Range

/** Color Range: sampled colors (Lab gaussian falloff), 6 hue families,
 *  luminance ranges, out-of-focus delegation and localized clusters. */
export function colorRange(img: ImageData, params: Record<string, any>): Uint8ClampedArray {
  const W = img.width
  const H = img.height
  const d = img.data
  const n = W * H
  const out = new Uint8ClampedArray(n)
  const range: string = params.range ?? 'sampled'
  const fuzz = params.fuzziness ?? 40

  if (range === 'out-of-focus') {
    return focusArea(img, { threshold: params.threshold ?? 6 })
  }

  if (range === 'highlights' || range === 'midtones' || range === 'shadows') {
    // luminance bands with fuzziness-controlled soft edges
    const wd = 30 + fuzz * 0.5
    for (let p = 0; p < n; p++) {
      const i = p * 4
      const l = luma(d[i], d[i + 1], d[i + 2])
      let v = 0
      if (range === 'highlights') v = smoothRamp(l, 200 - wd, 236)
      else if (range === 'shadows') v = 1 - smoothRamp(l, 20, 50 + wd)
      else v = clamp(1 - Math.abs(l - 128) / (wd * 1.5 + 40), 0, 1)
      out[p] = v * 255
    }
    return out
  }

  const hueCenters: Record<string, number> = {
    reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300,
  }
  const isHueFamily = hueCenters[range] !== undefined
  const localized = params.localized === true && Array.isArray(params.points) && (params.points as number[][]).length > 0

  // sampled color targets in Lab
  const colors: number[][] = (params.colors ?? []).map((c: number[]) => [c[0] || 0, c[1] || 0, c[2] || 0])
  const targets: number[][] = colors.map(c => {
    const t = [0, 0, 0]
    rgbToLab(c[0], c[1], c[2], t)
    return t
  })
  const sigma = 6 + fuzz * 0.42
  const inv2s2 = 1 / (2 * sigma * sigma)

  const points: number[][] = localized ? params.points : []
  const localR = params.localRadius ?? 90
  const localR2 = localR * localR

  const labT = [0, 0, 0]
  const hsvT = [0, 0, 0]
  for (let p = 0; p < n; p++) {
    const i = p * 4
    const r = d[i], g = d[i + 1], b = d[i + 2]
    let v = 0
    if (isHueFamily) {
      rgbToHsv(r, g, b, hsvT)
      const sat = hsvT[1]
      const w = hueFamilyWeight(hsvT[0], hueCenters[range]) * smoothRamp(sat, 0.06, 0.28)
      // fuzziness softens the falloff
      v = Math.pow(w, 1 / (1 + fuzz / 150))
    } else if (localized) {
      // per-pixel comparison to the paired sample color, within radius of
      // the sample points only
      const px = p % W
      const py = (p / W) | 0
      for (let k = 0; k < points.length; k++) {
        const dx = px - points[k][0]
        const dy = py - points[k][1]
        const dist2 = dx * dx + dy * dy
        if (dist2 > localR2) continue
        const spatial = 1 - Math.sqrt(dist2) / localR
        let tv: number
        if (k < targets.length) {
          rgbToLab(r, g, b, labT)
          const d0 = labT[0] - targets[k][0]
          const d1 = labT[1] - targets[k][1]
          const d2 = labT[2] - targets[k][2]
          tv = Math.exp(-(d0 * d0 + d1 * d1 + d2 * d2) * inv2s2)
        } else {
          tv = 1
        }
        const vv = spatial * tv
        if (vv > v) v = vv
      }
    } else {
      // sampled (global): gaussian falloff on Lab distance to nearest target
      if (targets.length === 0) {
        v = 0
      } else {
        rgbToLab(r, g, b, labT)
        let best = Infinity
        for (const t of targets) {
          const d0 = labT[0] - t[0]
          const d1 = labT[1] - t[1]
          const d2 = labT[2] - t[2]
          const dist2 = d0 * d0 + d1 * d1 + d2 * d2
          if (dist2 < best) best = dist2
        }
        v = Math.exp(-best * inv2s2)
      }
    }
    out[p] = v * 255
  }
  return out
}

// ================================================================ Focus Area

/** Local sharpness: Laplacian magnitude on a downsampled luma field,
 *  blurred, normalized by a robust percentile, thresholded by the slider
 *  (sensitivity), upsampled + feathered. */
export function focusArea(img: ImageData, params: Record<string, any>): Uint8ClampedArray {
  const small = downsampleImage(img, 320)
  const { width: w, height: h, data } = small
  const n = w * h
  const lum = new Float32Array(n)
  for (let i = 0; i < n; i++) lum[i] = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])

  // Laplacian magnitude (4-neighbor)
  const lap = new Float32Array(n)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      lap[i] = Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w])
    }
  }
  const blurred = gaussianBlurChannel(lap, w, h, 2.5)

  // robust normalization: the 96th percentile (quantized scale) marks
  // "fully sharp", outliers clamp at 255
  const hist = new Uint32Array(256)
  let lmax = 1e-3
  for (let i = 0; i < n; i++) if (blurred[i] > lmax) lmax = blurred[i]
  for (let i = 0; i < n; i++) hist[Math.min(255, Math.round(blurred[i] / lmax * 255)) | 0]++
  let acc = 0
  let p96 = 255
  const target = n * 0.96
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= target) { p96 = v; break }
  }
  const norm = p96 / lmax

  // threshold slider maps to sensitivity: low threshold -> more selected
  const thr = params.threshold ?? 6
  const lo = 0.05 + thr * 0.03
  const mask = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) {
    const v = clamp(blurred[i] * norm, 0, 255)
    mask[i] = smoothRamp(v, lo * 255, (lo + 0.38) * 255) * 255
  }

  const up = resampleMask(mask, w, h, img.width, img.height)
  return featherMask(up, img.width, img.height, 1)
}

// ================================================================ Refine Mask

/** Select & Mask refinement: radius (blur + contrast), contrast S-curve,
 *  feather (pure blur), shift edge (morph + re-blend softness), smooth. */
export function refineMask(mask: Uint8ClampedArray, w: number, h: number, params: Record<string, any>): Uint8ClampedArray {
  let out: Uint8ClampedArray = new Uint8ClampedArray(mask.length)
  out.set(mask)
  const radius = params.radius ?? 0
  const contrast = params.contrast ?? 0
  const feather = params.feather ?? 0
  const shiftEdge = params.shiftEdge ?? 0
  const smooth = params.smooth ?? 0

  const blurTo = (src: Uint8ClampedArray, sigma: number): Uint8ClampedArray => {
    const f = maskToFloat(src)
    const blurred = gaussianBlurChannel(f, w, h, sigma)
    const res = new Uint8ClampedArray(src.length)
    for (let i = 0; i < src.length; i++) res[i] = blurred[i] * 255
    return res
  }

  if (radius > 0) {
    // blur + contrast re-threshold: smooths micro-jaggies, holds the edge
    const blurred = blurTo(out, Math.max(0.6, radius))
    const k = 1 + contrast / 30
    for (let i = 0; i < out.length; i++) {
      const t = clamp((blurred[i] / 255 - 0.5) * k + 0.5, 0, 1)
      out[i] = t * t * (3 - 2 * t) * 255
    }
  } else if (contrast > 0) {
    const k = 1 + contrast / 30
    for (let i = 0; i < out.length; i++) {
      const t = clamp((out[i] / 255 - 0.5) * k + 0.5, 0, 1)
      out[i] = t * t * (3 - 2 * t) * 255
    }
  }

  if (smooth > 0) {
    // blur + threshold with a soft knee: removes speckles without hard edges
    const blurred = blurTo(out, Math.max(0.8, smooth))
    for (let i = 0; i < out.length; i++) {
      out[i] = smoothRamp(blurred[i], 96, 176) * 255
    }
  }

  if (shiftEdge !== 0) {
    // morph the binarized edge, then restore ~1px of softness
    const binary = new Uint8ClampedArray(out.length)
    for (let i = 0; i < out.length; i++) binary[i] = out[i] >= 128 ? 255 : 0
    const px = clamp(Math.round(shiftEdge * 0.2), -20, 20)
    const shifted = px > 0
      ? dilateMask(binary, w, h, px)
      : erodeMask(binary, w, h, -px)
    out = blurTo(shifted, 1.2)
  }

  if (feather > 0) {
    out = blurTo(out, feather)
  }
  return out
}

// ================================================================ Decontaminate

/** Push edge-pixel colors toward the local interior color (weighted blur),
 *  so semi-transparent edge fringes stop contaminating the cut-out. */
export function decontaminateColors(img: ImageData, mask: Uint8ClampedArray, amount: number): void {
  if (amount <= 0) return
  const { width: w, height: h, data } = img
  const n = w * h
  const f = maskToFloat(mask)

  // weighted local color average: blur(mask·color) / blur(mask)
  const wSum = gaussianBlurChannel(Float32Array.from(f), w, h, 6)
  const chans: Float32Array[] = []
  for (let c = 0; c < 3; c++) {
    const buf = new Float32Array(n)
    for (let i = 0; i < n; i++) buf[i] = f[i] * data[i * 4 + c]
    chans.push(gaussianBlurChannel(buf, w, h, 6))
  }
  // edge band: inside the mask but the neighborhood leaks outside
  const blurF = gaussianBlurChannel(Float32Array.from(f), w, h, 5)
  const kAmt = amount / 100
  for (let i = 0; i < n; i++) {
    const band = clamp((f[i] - blurF[i]) * 3.5, 0, 1)
    if (band <= 0.01) continue
    const wS = Math.max(0.15, wSum[i])
    const k = band * kAmt
    for (let c = 0; c < 3; c++) {
      const inner = chans[c][i] / wS
      data[i * 4 + c] = clamp(data[i * 4 + c] * (1 - k) + inner * k, 0, 255)
    }
  }
}
