// ============================================================
// Content-Aware Fill — pyramid diffusion + simplified PatchMatch
// texture synthesis.
//
// Pipeline:
//  1. hole bbox + margin -> work rect, capped at ~512px long side
//  2. image pyramid (up to 6 levels), hole mask per level
//  3. per level (coarse -> fine):
//       a. upsample previous result (+ offsets x2) when not coarsest
//       b. onion-peel diffusion pass (BFS-ordered) for structure
//       c. PatchMatch: 8×8 patches centered on hole pixels, candidates
//          from neighbor propagation + K random samples (K grows to 12
//          at fine levels), SSD over known pixels, search radius grows
//          with level
//       d. vote / average winning patch pixels into the hole
//  4. high-frequency noise injection from the surrounding ring variance
//  5. bilinear upscale + soft-mask blend back into the full image
//
// Inner loops are allocation-free; the RNG is seeded so results are
// deterministic across preview re-runs.
// ============================================================

import { clamp } from '../utils/canvas'
import { gaussianMaker, mulberry32 } from './interp'

const PATCH = 8       // 8×8 patches
const HALF = 4        // patch spans [center-4, center+3]
const MAX_WORK = 512  // patch-stage resolution cap (long side)

interface Level {
  w: number
  h: number
  data: Float32Array    // w·h·3
  hole: Uint8Array      // w·h, 1 = hole
  holeInt: Float64Array // (w+1)·(h+1) integral image of hole
  offX: Int16Array      // per-pixel best-match offset (hole pixels only)
  offY: Int16Array
  cost: Float32Array    // current SSD of the offset
  accR: Float32Array    // vote accumulators
  accG: Float32Array
  accB: Float32Array
  accW: Float32Array
}

function holeCount(int: Float64Array, w: number, x0: number, y0: number, x1: number, y1: number): number {
  // inclusive rect hole count from the integral image (int is (w+1) stride)
  const s = (w + 1)
  const a = int[y0 * s + x0]
  const b = int[y0 * s + x1 + 1]
  const c = int[(y1 + 1) * s + x0]
  const d = int[(y1 + 1) * s + x1 + 1]
  return d - c - b + a
}

/** build the pyramid level above (half resolution) via 2×2 box average */
function buildCoarser(lv: Level): Level {
  const nw = Math.max(1, (lv.w + 1) >> 1)
  const nh = Math.max(1, (lv.h + 1) >> 1)
  const data = new Float32Array(nw * nh * 3)
  const holeAvg = new Float32Array(nw * nh)
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, m = 0, cnt = 0
      for (let dy = 0; dy < 2; dy++) {
        const sy = Math.min(lv.h - 1, y * 2 + dy)
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(lv.w - 1, x * 2 + dx)
          const si = sy * lv.w + sx
          r += lv.data[si * 3]; g += lv.data[si * 3 + 1]; b += lv.data[si * 3 + 2]
          m += lv.hole[si]
          cnt++
        }
      }
      const o = y * nw + x
      data[o * 3] = r / cnt
      data[o * 3 + 1] = g / cnt
      data[o * 3 + 2] = b / cnt
      holeAvg[o] = m / cnt
    }
  }
  return makeLevel(nw, nh, data, holeAvg)
}

function makeLevel(w: number, h: number, data: Float32Array, holeAvg: Float32Array): Level {
  const n = w * h
  const hole = new Uint8Array(n)
  for (let i = 0; i < n; i++) hole[i] = holeAvg[i] > 0.3 ? 1 : 0
  const holeInt = new Float64Array((w + 1) * (h + 1))
  const s = w + 1
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += hole[y * w + x]
      holeInt[(y + 1) * s + x + 1] = holeInt[y * s + x + 1] + rowSum
    }
  }
  return {
    w, h, data, hole, holeInt,
    offX: new Int16Array(n), offY: new Int16Array(n),
    cost: new Float32Array(n),
    accR: new Float32Array(n), accG: new Float32Array(n), accB: new Float32Array(n), accW: new Float32Array(n),
  }
}

/** BFS-ordered onion peel: fill hole pixels layer by layer from the boundary */
function onionPeel(lv: Level, blend: number): void {
  const { w, h, data, hole } = lv
  const n = w * h
  const dist = new Int16Array(n).fill(-1)
  const queue = new Int32Array(n)
  let qh = 0
  let qt = 0
  // seed with known pixels
  for (let i = 0; i < n; i++) {
    if (!hole[i]) { dist[i] = 0; queue[qt++] = i }
  }
  // BFS: assign distances (FIFO == non-decreasing distance)
  while (qh < qt) {
    const p = queue[qh++]
    const px = p % w
    const py = (p / w) | 0
    const d = dist[p] + 1
    if (px > 0 && hole[p - 1] && dist[p - 1] < 0) { dist[p - 1] = d; queue[qt++] = p - 1 }
    if (px < w - 1 && hole[p + 1] && dist[p + 1] < 0) { dist[p + 1] = d; queue[qt++] = p + 1 }
    if (py > 0 && hole[p - w] && dist[p - w] < 0) { dist[p - w] = d; queue[qt++] = p - w }
    if (py < h - 1 && hole[p + w] && dist[p + w] < 0) { dist[p + w] = d; queue[qt++] = p + w }
  }
  // fill in BFS order from already-filled / known neighbors
  for (let qi = 0; qi < qt; qi++) {
    const p = queue[qi]
    if (!hole[p]) continue
    const px = p % w
    const py = (p / w) | 0
    let r = 0, g = 0, b = 0, wsum = 0
    for (let dy = -1; dy <= 1; dy++) {
      const yy = py + dy
      if (yy < 0 || yy >= h) continue
      for (let dx = -1; dx <= 1; dx++) {
        const xx = px + dx
        if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue
        const q = yy * w + xx
        if (dist[q] < 0 || dist[q] > dist[p]) continue
        // diagonals count a bit less
        const wt = (dx !== 0 && dy !== 0) ? 0.7 : 1
        r += data[q * 3] * wt
        g += data[q * 3 + 1] * wt
        b += data[q * 3 + 2] * wt
        wsum += wt
      }
    }
    if (wsum <= 0) continue
    const peelR = r / wsum, peelG = g / wsum, peelB = b / wsum
    if (blend >= 1) {
      data[p * 3] = peelR; data[p * 3 + 1] = peelG; data[p * 3 + 2] = peelB
    } else {
      data[p * 3] = data[p * 3] * (1 - blend) + peelR * blend
      data[p * 3 + 1] = data[p * 3 + 1] * (1 - blend) + peelG * blend
      data[p * 3 + 2] = data[p * 3 + 2] * (1 - blend) + peelB * blend
    }
  }
  // keep distances for the noise-falloff stage (stashed on the level)
  ;(lv as any)._dist = dist
}

/** a few Jacobi smoothing sweeps over the hole (used at the coarsest level) */
function jacobi(lv: Level, sweeps: number): void {
  const { w, h, data, hole } = lv
  for (let s = 0; s < sweeps; s++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (!hole[i]) continue
        let r = 0, g = 0, b = 0, cnt = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy))
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx))
            const q = yy * w + xx
            r += data[q * 3]; g += data[q * 3 + 1]; b += data[q * 3 + 2]; cnt++
          }
        }
        data[i * 3] = r / cnt
        data[i * 3 + 1] = g / cnt
        data[i * 3 + 2] = b / cnt
      }
    }
  }
}

/** SSD of target patch at (x,y) vs source patch at (x+ox, y+oy).
 *  Known target pixels weigh 1, synthesized hole pixels 0.35 (coherence);
 *  source pixels inside the hole are skipped. Returns normalized cost. */
function patchCost(lv: Level, x: number, y: number, ox: number, oy: number): number {
  const { w, h, data, hole } = lv
  let cost = 0
  let wsum = 0
  for (let dy = -HALF; dy < HALF; dy++) {
    const ty = y + dy
    if (ty < 0 || ty >= h) continue
    for (let dx = -HALF; dx < HALF; dx++) {
      const tx = x + dx
      if (tx < 0 || tx >= w) continue
      const sx = tx + ox
      const sy = ty + oy
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue
      if (hole[sy * w + sx]) continue // unknown source pixel
      const ti = (ty * w + tx) * 3
      const si = (sy * w + sx) * 3
      const wt = hole[ty * w + tx] ? 0.35 : 1
      const dr = data[ti] - data[si]
      const dg = data[ti + 1] - data[si + 1]
      const db = data[ti + 2] - data[si + 2]
      cost += wt * (dr * dr + dg * dg + db * db)
      wsum += wt
    }
  }
  if (wsum < 8) return Infinity // barely comparable — treat as invalid
  return cost / wsum
}

/** can a patch centered at (qx, qy) serve as a source? (≥87% known, in bounds) */
function sourceValid(lv: Level, qx: number, qy: number): boolean {
  const { w, h } = lv
  if (qx < HALF || qy < HALF || qx > w - 1 - (HALF - 1) || qy > h - 1 - (HALF - 1)) return false
  return holeCount(lv.holeInt, w, qx - HALF, qy - HALF, qx + HALF - 1, qy + HALF - 1) <= 8
}

/** one PatchMatch scan (forward or reverse): propagation + random search.
 *  Random search uses the canonical scheme — a few uniform candidates in
 *  the search disk, then exponentially shrinking windows around the current
 *  best match, which converges far faster than uniform sampling. */
function patchmatchScan(lv: Level, rand: () => number, searchR: number, forward: boolean): void {
  const { w, h, hole, offX, offY, cost } = lv
  const yStart = forward ? 0 : h - 1
  const yEnd = forward ? h : -1
  const yStep = forward ? 1 : -1
  for (let y = yStart; y !== yEnd; y += yStep) {
    const xStart = forward ? 0 : w - 1
    const xEnd = forward ? w : -1
    const xStep = forward ? 1 : -1
    for (let x = xStart; x !== xEnd; x += xStep) {
      const i = y * w + x
      if (!hole[i]) continue
      // current offset (re-scored — data changed since the last vote)
      let bx = offX[i]
      let by = offY[i]
      let bc = patchCost(lv, x, y, bx, by)
      // propagation from already-scanned neighbors
      const nx = forward ? x - 1 : x + 1
      const ny = forward ? y - 1 : y + 1
      if (nx >= 0 && nx < w) {
        const j = y * w + nx
        if (hole[j]) {
          const c = patchCost(lv, x, y, offX[j], offY[j])
          if (c < bc) { bc = c; bx = offX[j]; by = offY[j] }
        }
      }
      if (ny >= 0 && ny < h) {
        const j = ny * w + x
        if (hole[j]) {
          const c = patchCost(lv, x, y, offX[j], offY[j])
          if (c < bc) { bc = c; bx = offX[j]; by = offY[j] }
        }
      }
      // uniform candidates in the search disk (global exploration)
      for (let t = 0; t < 3; t++) {
        const rr = Math.sqrt(rand()) * searchR
        const ang = rand() * Math.PI * 2
        const qx = Math.round(x + rr * Math.cos(ang))
        const qy = Math.round(y + rr * Math.sin(ang))
        if (!sourceValid(lv, qx, qy)) continue
        const c = patchCost(lv, x, y, qx - x, qy - y)
        if (c < bc) { bc = c; bx = qx - x; by = qy - y }
      }
      // exponential shrinking windows around the current best match
      let sr = searchR * 0.5
      while (sr > 1) {
        const qx = Math.round(x + bx + (rand() * 2 - 1) * sr)
        const qy = Math.round(y + by + (rand() * 2 - 1) * sr)
        if (sourceValid(lv, qx, qy)) {
          const c = patchCost(lv, x, y, qx - x, qy - y)
          if (c < bc) { bc = c; bx = qx - x; by = qy - y }
        }
        sr *= 0.5
      }
      offX[i] = bx
      offY[i] = by
      cost[i] = bc
    }
  }
}

/** vote: average the winning source patches into the hole */
function vote(lv: Level): void {
  const { w, h, hole, data, offX, offY, accR, accG, accB, accW } = lv
  accR.fill(0); accG.fill(0); accB.fill(0); accW.fill(0)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!hole[i]) continue
      const ox = offX[i]
      const oy = offY[i]
      for (let dy = -HALF; dy < HALF; dy++) {
        const ty = y + dy
        if (ty < 0 || ty >= h) continue
        for (let dx = -HALF; dx < HALF; dx++) {
          const tx = x + dx
          if (tx < 0 || tx >= w) continue
          const t = ty * w + tx
          if (!hole[t]) continue
          const sx = tx + ox
          const sy = ty + oy
          if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue
          const si = (sy * w + sx) * 3
          accR[t] += data[si]
          accG[t] += data[si + 1]
          accB[t] += data[si + 2]
          accW[t] += 1
        }
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (!hole[i] || accW[i] <= 0) continue
    const inv = 1 / accW[i]
    data[i * 3] = accR[i] * inv
    data[i * 3 + 1] = accG[i] * inv
    data[i * 3 + 2] = accB[i] * inv
  }
}

/** high-frequency noise from the known ring variance so fills aren't mushy */
function injectNoise(lv: Level, rand: () => number): void {
  const { w, h, data, hole } = lv
  // HF = |pixel − 3×3 box mean| over known pixels
  const n = w * h
  const sigma = [0, 0, 0]
  let cnt = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (hole[i]) continue
      for (let c = 0; c < 3; c++) {
        let m = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) m += data[((y + dy) * w + x + dx) * 3 + c]
        }
        sigma[c] += Math.abs(data[i * 3 + c] - m / 9)
      }
      cnt++
    }
  }
  if (cnt === 0) return
  const dist = (lv as any)._dist as Int16Array | undefined
  const gauss = gaussianMaker(rand)
  const s0 = sigma[0] / cnt * 0.55
  const s1 = sigma[1] / cnt * 0.55
  const s2 = sigma[2] / cnt * 0.55
  for (let i = 0; i < n; i++) {
    if (!hole[i]) continue
    // fade noise in near the boundary to avoid a visible seam
    const d = dist ? dist[i] : 4
    const f = Math.min(1, d / 5)
    data[i * 3] += gauss() * s0 * f
    data[i * 3 + 1] += gauss() * s1 * f
    data[i * 3 + 2] += gauss() * s2 * f
  }
}

/** initialize every hole pixel's offset toward the nearest known pixel */
function initOffsets(lv: Level): void {
  const { w, h, hole, offX, offY } = lv
  const dist = (lv as any)._dist as Int16Array
  const n = w * h
  for (let i = 0; i < n; i++) {
    if (!hole[i]) continue
    const x = i % w
    const y = (i / w) | 0
    // walk downhill on the BFS distance toward a known pixel
    let cx = x
    let cy = y
    for (let step = 0; step < 64; step++) {
      const ci = cy * w + cx
      if (!hole[ci]) break
      const curD = dist[ci]
      let bestX = cx
      let bestY = cy
      let bestD = curD
      if (cx > 0) { const q = ci - 1; if (dist[q] >= 0 && dist[q] < bestD) { bestD = dist[q]; bestX = cx - 1 } }
      if (cx < w - 1) { const q = ci + 1; if (dist[q] >= 0 && dist[q] < bestD) { bestD = dist[q]; bestX = cx + 1 } }
      if (cy > 0) { const q = ci - w; if (dist[q] >= 0 && dist[q] < bestD) { bestD = dist[q]; bestY = cy - 1; bestX = cx } }
      if (cy < h - 1) { const q = ci + w; if (dist[q] >= 0 && dist[q] < bestD) { bestD = dist[q]; bestY = cy + 1; bestX = cx } }
      if (bestX === cx && bestY === cy) break
      cx = bestX
      cy = bestY
    }
    offX[i] = cx - x
    offY[i] = cy - y
  }
}

export async function inpaint(
  img: ImageData, mask: Uint8ClampedArray, onProgress?: (p: number) => void,
): Promise<void> {
  const W = img.width
  const H = img.height
  const data = img.data

  // ---- hole bbox ----
  let minX = -1, minY = -1, maxX = -1, maxY = -1
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      if (mask[row + x] > 127) {
        if (minX < 0 || x < minX) minX = x
        if (minY < 0 || y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (minX < 0) return
  const holeW = maxX - minX + 1
  const holeH = maxY - minY + 1

  // ---- work rect (hole + ring of surrounding texture) ----
  const margin = Math.max(24, Math.round(0.35 * Math.max(holeW, holeH)))
  const wx0 = Math.max(0, minX - margin)
  const wy0 = Math.max(0, minY - margin)
  const wx1 = Math.min(W - 1, maxX + margin)
  const wy1 = Math.min(H - 1, maxY + margin)
  const ww = wx1 - wx0 + 1
  const wh = wy1 - wy0 + 1

  // ---- working resolution cap ----
  const scale = Math.min(1, MAX_WORK / Math.max(ww, wh))
  const wn = Math.max(8, Math.round(ww * scale))
  const whn = Math.max(8, Math.round(wh * scale))

  // extract + box-downsample the work region (RGB + hole average)
  const workData = new Float32Array(wn * whn * 3)
  const holeAvg = new Float32Array(wn * whn)
  const fx = ww / wn
  const fy = wh / whn
  for (let y = 0; y < whn; y++) {
    const sy0 = wy0 + Math.floor(y * fy)
    const sy1 = Math.min(H, wy0 + Math.max(1, Math.floor((y + 1) * fy)))
    for (let x = 0; x < wn; x++) {
      const sx0 = wx0 + Math.floor(x * fx)
      const sx1 = Math.min(W, wx0 + Math.max(1, Math.floor((x + 1) * fx)))
      let r = 0, g = 0, b = 0, m = 0, cnt = 0
      for (let yy = sy0; yy < sy1; yy++) {
        for (let xx = sx0; xx < sx1; xx++) {
          const i = yy * W + xx
          r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2]
          m += mask[i] > 127 ? 1 : 0
          cnt++
        }
      }
      if (cnt === 0) cnt = 1
      const o = y * wn + x
      workData[o * 3] = r / cnt
      workData[o * 3 + 1] = g / cnt
      workData[o * 3 + 2] = b / cnt
      holeAvg[o] = m / cnt
    }
  }
  onProgress?.(0.03)

  // ---- fallback: nothing known around the hole ----
  let knownCount = 0
  for (let i = 0; i < wn * whn; i++) knownCount += holeAvg[i] > 0.3 ? 0 : 1
  if (knownCount < 8) {
    // fill with the average work color + noise
    let ar = 0, ag = 0, ab = 0, an = 0
    for (let i = 0; i < wn * whn; i++) { ar += workData[i * 3]; ag += workData[i * 3 + 1]; ab += workData[i * 3 + 2]; an++ }
    ar /= an; ag /= an; ab /= an
    const rand = mulberry32(0xcafe)
    for (let i = 0; i < wn * whn; i++) {
      if (holeAvg[i] <= 0.3) continue
      workData[i * 3] = ar + (rand() - 0.5) * 12
      workData[i * 3 + 1] = ag + (rand() - 0.5) * 12
      workData[i * 3 + 2] = ab + (rand() - 0.5) * 12
    }
    writeBackFrom(workData, wn, whn)
    onProgress?.(1)
    return
  }

  // ---- build the pyramid ----
  const levels: Level[] = [makeLevel(wn, whn, workData, holeAvg)]
  while (levels.length < 6) {
    const top = levels[levels.length - 1]
    if (Math.max(top.w, top.h) <= 32) break
    let hp = 0
    for (let i = 0; i < top.w * top.h; i++) hp += top.hole[i]
    if (hp < 16) break
    levels.push(buildCoarser(top))
  }
  const L = levels.length
  const rand = mulberry32(0x5eed ^ holeW ^ (holeH << 8))

  // ---- coarse -> fine ----
  for (let li = L - 1; li >= 0; li--) {
    const lv = levels[li]
    // search radius grows as levels get finer (more variety for detail)
    const searchR = Math.max(16, Math.max(lv.w, lv.h) * (0.35 + 0.65 * ((L - 1 - li) / Math.max(1, L - 1))))
    // two propagate+vote iterations at the two finest levels, one elsewhere
    const iterations = li <= 1 ? 2 : 1

    if (li === L - 1) {
      onionPeel(lv, 1)
      jacobi(lv, 3)
      initOffsets(lv)
    } else {
      // upsample the previous (coarser) level result + offsets
      const below = levels[li + 1]
      const rx = below.w / lv.w
      const ry = below.h / lv.h
      for (let y = 0; y < lv.h; y++) {
        for (let x = 0; x < lv.w; x++) {
          const i = y * lv.w + x
          if (!lv.hole[i]) continue
          const bx = clamp((x + 0.5) * rx - 0.5, 0, below.w - 1)
          const by = clamp((y + 0.5) * ry - 0.5, 0, below.h - 1)
          const x0 = Math.min(below.w - 1, bx | 0)
          const y0 = Math.min(below.h - 1, by | 0)
          const x1 = Math.min(below.w - 1, x0 + 1)
          const y1 = Math.min(below.h - 1, y0 + 1)
          const tx = bx - x0
          const ty = by - y0
          for (let c = 0; c < 3; c++) {
            const i00 = (y0 * below.w + x0) * 3 + c
            const i10 = (y0 * below.w + x1) * 3 + c
            const i01 = (y1 * below.w + x0) * 3 + c
            const i11 = (y1 * below.w + x1) * 3 + c
            const top = below.data[i00] * (1 - tx) + below.data[i10] * tx
            const bot = below.data[i01] * (1 - tx) + below.data[i11] * tx
            lv.data[i * 3 + c] = top * (1 - ty) + bot * ty
          }
          // offsets scale ×2 (nearest)
          const bIdx = y0 * below.w + x0
          lv.offX[i] = below.offX[bIdx] * 2
          lv.offY[i] = below.offY[bIdx] * 2
        }
      }
      // onion peel blended with the upsampled structure
      onionPeel(lv, 0.45)
    }

    // PatchMatch: propagate (forward + reverse) then vote, per iteration
    for (let it = 0; it < iterations; it++) {
      patchmatchScan(lv, rand, searchR, true)
      patchmatchScan(lv, rand, searchR, false)
      vote(lv)
    }

    onProgress?.(0.06 + 0.88 * ((L - li) / L))
    // let the UI breathe between levels
    await new Promise<void>(res => setTimeout(res, 0))
  }

  // ---- noise injection at the finest working level ----
  injectNoise(levels[0], rand)

  writeBackFrom(levels[0].data, levels[0].w, levels[0].h)
  onProgress?.(1)

  // ---- blend the synthesized content back at full resolution ----
  function writeBackFrom(src: Float32Array, sw: number, sh: number): void {
    const sxF = sw / ww
    const syF = sh / wh
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const p = y * W + x
        const m = mask[p] / 255
        if (m <= 0) continue
        // map the full-res pixel into work coordinates (pixel-center aligned)
        const ux = clamp((x - wx0 + 0.5) * sxF - 0.5, 0, sw - 1)
        const uy = clamp((y - wy0 + 0.5) * syF - 0.5, 0, sh - 1)
        const x0 = Math.min(sw - 1, ux | 0)
        const y0 = Math.min(sh - 1, uy | 0)
        const x1 = Math.min(sw - 1, x0 + 1)
        const y1 = Math.min(sh - 1, y0 + 1)
        const tx = ux - x0
        const ty = uy - y0
        for (let c = 0; c < 3; c++) {
          const i00 = (y0 * sw + x0) * 3 + c
          const i10 = (y0 * sw + x1) * 3 + c
          const i01 = (y1 * sw + x0) * 3 + c
          const i11 = (y1 * sw + x1) * 3 + c
          const top = src[i00] * (1 - tx) + src[i10] * tx
          const bot = src[i01] * (1 - tx) + src[i11] * tx
          const synth = top * (1 - ty) + bot * ty
          const k = Math.min(1, m * 1.02)
          data[p * 4 + c] = clamp(data[p * 4 + c] * (1 - k) + synth * k, 0, 255)
        }
      }
    }
  }
}
