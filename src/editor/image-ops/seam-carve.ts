// ============================================================
// Content-Aware Scale — classic seam carving (Avidan–Shamir 2007)
//
// Energy: Sobel gradient magnitude, weighted per channel (luma-ish
// R/G/B weights + full-weight alpha so transparency edges are kept),
// plus a protection penalty (protect/255 · 1e6) so protected pixels
// are carved last.
//
// Removal: dynamic-programming cumulative minimum-energy scan with an
// Int32Array backpointer grid, backtrack the minimal seam, shift pixels.
// Enlargement: the k minimal seams are found by SIMULATING k removals on
// a scratch copy, the recorded positions are remapped back to the
// block-start coordinate system, then inserted in one batched pass as
// neighbor-averaged duplicates (standard seam insertion — keeps the k
// seams distinct). Per-round growth is capped at 2× the current axis
// size; larger scale-ups are reached iteratively round by round.
// Horizontal and vertical seam ops alternate proportionally (~24 rounds)
// so content distorts evenly.
//
// Performance: typed arrays only; every buffer is allocated once and
// reused (no per-seam allocations); energy updates after each seam are
// incremental, restricted to a ±2px band around the changed columns;
// horizontal seams run on a tiled transpose of the grid; the loop
// cooperatively yields to the event loop every ~8 seams and reports
// progress (return false from onProgress to abort).
//
// Resolution cap: sources larger than 1600px on the long side are carved
// on a box-downscaled copy (≤1600px) and Lanczos-resampled back to the
// exact target size afterwards. Approximation: seam placement is decided
// at the capped resolution — this keeps the O((Δw + Δh) · w · h) DP
// tractable on multi-megapixel images while the exact target dimensions
// are still honored.
// ============================================================
import { downsampleImage } from './core'
import { lanczosResample } from './upscale'
import { createCanvas, ctx2d, putImageData, clamp } from '../utils/canvas'

export interface SeamCarveOptions {
  targetW: number
  targetH: number
  /** doc-space mask, 0..255, 255 = protected (length must equal width·height) */
  protect?: Uint8Array | null
  /** progress callback; return false to abort */
  onProgress?: (p: number) => boolean
}

export interface SeamCarveResult {
  imageData: ImageData
  aborted: boolean
}

const MAX_WORK_DIM = 1600
const SUB_BATCH = 256   // seams inserted per simulated batch
const ROUNDS = 24       // h/v alternation rounds
const YIELD_EVERY = 8   // seams between event-loop yields
const PROTECT_PENALTY = 1e6
// per-channel Sobel weights (alpha weighted fully — keep transparency edges)
const WR = 0.299, WG = 0.587, WB = 0.114, WA = 1

// ---------- energy ----------

/** weighted per-channel Sobel gradient magnitude at (x, y) */
function energyAt(data: Uint8ClampedArray, x: number, y: number, w: number, h: number, stride: number): number {
  const xl = x > 0 ? x - 1 : 0
  const xr = x < w - 1 ? x + 1 : w - 1
  const ym = y > 0 ? y - 1 : 0
  const yp = y < h - 1 ? y + 1 : h - 1
  const r0 = ym * stride, r1 = y * stride, r2 = yp * stride
  let e = 0
  for (let c = 0; c < 4; c++) {
    const wt = c === 0 ? WR : c === 1 ? WG : c === 2 ? WB : WA
    const a = data[(r0 + xl) * 4 + c], b = data[(r0 + x) * 4 + c], d = data[(r0 + xr) * 4 + c]
    const f = data[(r1 + xl) * 4 + c], g = data[(r1 + xr) * 4 + c]
    const i2 = data[(r2 + xl) * 4 + c], j2 = data[(r2 + x) * 4 + c], k2 = data[(r2 + xr) * 4 + c]
    const gx = (d + 2 * g + k2) - (a + 2 * f + i2)
    const gy = (i2 + 2 * j2 + k2) - (a + 2 * b + d)
    e += wt * (Math.abs(gx) + Math.abs(gy))
  }
  return e
}

/** energy + protection penalty for a single pixel (band updates reuse this) */
function updateEnergyAt(
  energy: Float32Array, data: Uint8ClampedArray, protect: Uint8Array | null,
  x: number, y: number, w: number, h: number, stride: number,
) {
  const i = y * stride + x
  energy[i] = energyAt(data, x, y, w, h, stride) + (protect ? (protect[i] / 255) * PROTECT_PENALTY : 0)
}

// ---------- DP seam search ----------

/**
 * Vertical-seam DP (one x per row). backpointer encoding at [y·stride + x]:
 * prev-row x = x + back − 1 ∈ {x−1, x, x+1}. `cost` is a 2-row rolling
 * Float64 buffer (length ≥ 2·stride); `seam` receives h positions.
 */
function findMinSeam(
  energy: Float32Array, w: number, h: number, stride: number,
  cost: Float64Array, back: Int32Array, seam: Int32Array,
) {
  // row 0
  for (let x = 0; x < w; x++) cost[x] = energy[x]
  for (let y = 1; y < h; y++) {
    const pOff = ((y - 1) & 1) * stride
    const cOff = (y & 1) * stride
    const eRow = y * stride
    // x = 0 — left edge: prev x ∈ {0, 1}
    let m = cost[pOff], d = 1
    if (w > 1 && cost[pOff + 1] < m) { m = cost[pOff + 1]; d = 2 }
    cost[cOff] = m + energy[eRow]
    back[eRow] = d
    // x = w−1 — right edge: prev x ∈ {w−2, w−1}
    if (w > 1) {
      const x = w - 1
      m = cost[pOff + x]; d = 1
      if (cost[pOff + x - 1] < m) { m = cost[pOff + x - 1]; d = 0 }
      cost[cOff + x] = m + energy[eRow + x]
      back[eRow + x] = d
    }
    // interior — 3-way min
    for (let x = 1; x < w - 1; x++) {
      const a = cost[pOff + x - 1], b = cost[pOff + x], c = cost[pOff + x + 1]
      let mm = b, dd = 1
      if (a < mm) { mm = a; dd = 0 }
      if (c < mm) { mm = c; dd = 2 }
      cost[cOff + x] = mm + energy[eRow + x]
      back[eRow + x] = dd
    }
  }
  // argmin on the last row
  const lastOff = ((h - 1) & 1) * stride
  let x = 0
  let best = cost[lastOff]
  for (let k = 1; k < w; k++) {
    const v = cost[lastOff + k]
    if (v < best) { best = v; x = k }
  }
  // backtrack bottom-up
  for (let y = h - 1; y >= 0; y--) {
    seam[y] = x
    if (y > 0) x += back[y * stride + x] - 1
  }
}

// ---------- seam removal ----------

/** remove one vertical seam (shift pixels left of nothing, band-update energy); returns the new width */
function removeSeamOnce(
  data: Uint8ClampedArray, energy: Float32Array, protect: Uint8Array | null,
  w: number, h: number, stride: number, seam: Int32Array,
): number {
  for (let y = 0; y < h; y++) {
    const xs = seam[y]
    if (xs < 0 || xs >= w) continue // defensive; DP guarantees [0, w−1]
    const row = y * stride
    const dbase = row * 4
    data.copyWithin(dbase + xs * 4, dbase + (xs + 1) * 4, dbase + w * 4)
    energy.copyWithin(row + xs, row + xs + 1, row + w)
    if (protect) protect.copyWithin(row + xs, row + xs + 1, row + w)
  }
  const nw = w - 1
  for (let y = 0; y < h; y++) {
    const xs = seam[y]
    if (xs < 0 || xs >= w) continue
    const x0 = Math.max(0, xs - 2)
    const x1 = Math.min(nw - 1, xs + 2)
    for (let x = x0; x <= x1; x++) updateEnergyAt(energy, data, protect, x, y, nw, h, stride)
  }
  return nw
}

// ---------- transposes (tiled for cache friendliness) ----------

function transposeQuads(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, srcStride: number, dstStride: number) {
  const T = 32
  for (let ty = 0; ty < h; ty += T) {
    const ymax = Math.min(ty + T, h)
    for (let tx = 0; tx < w; tx += T) {
      const xmax = Math.min(tx + T, w)
      for (let y = ty; y < ymax; y++) {
        for (let x = tx; x < xmax; x++) {
          const si = (y * srcStride + x) * 4
          const di = (x * dstStride + y) * 4
          const a = src[si], b = src[si + 1], c = src[si + 2], d = src[si + 3]
          dst[di] = a; dst[di + 1] = b; dst[di + 2] = c; dst[di + 3] = d
        }
      }
    }
  }
}

function transposeScalar(src: Float32Array | Uint8Array, dst: Float32Array | Uint8Array, w: number, h: number, srcStride: number, dstStride: number) {
  const T = 32
  for (let ty = 0; ty < h; ty += T) {
    const ymax = Math.min(ty + T, h)
    for (let tx = 0; tx < w; tx += T) {
      const xmax = Math.min(tx + T, w)
      for (let y = ty; y < ymax; y++) {
        for (let x = tx; x < xmax; x++) {
          dst[x * dstStride + y] = src[y * srcStride + x]
        }
      }
    }
  }
}

// ---------- mask helper ----------

/** box-average resample of a single-channel 0..255 mask (working-res cap + dialog previews) */
export function boxResampleMask(mask: Uint8Array, w: number, h: number, nw: number, nh: number): Uint8Array {
  if (w === nw && h === nh) return mask
  const out = new Uint8Array(nw * nh)
  const fx = w / nw, fy = h / nh
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.min(h, Math.floor((y + 1) * fy)))
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * fx)
      const x1 = Math.max(x0 + 1, Math.min(w, Math.floor((x + 1) * fx)))
      let acc = 0, n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) { acc += mask[yy * w + xx]; n++ }
      }
      out[y * nw + x] = n > 0 ? Math.round(acc / n) : 0
    }
  }
  return out
}

// ============================================================
// seamCarve — the public API
// ============================================================

export async function seamCarve(img: ImageData, opts: SeamCarveOptions): Promise<SeamCarveResult> {
  const srcW = img.width, srcH = img.height
  const targetW = Math.max(1, Math.round(Number(opts.targetW) || 0))
  const targetH = Math.max(1, Math.round(Number(opts.targetH) || 0))
  const onProgress = opts.onProgress
  const orig = (): ImageData => new ImageData(new Uint8ClampedArray(img.data), srcW, srcH)

  if (targetW === srcW && targetH === srcH) {
    onProgress?.(1)
    return { imageData: orig(), aborted: false }
  }

  // ---- working-resolution cap (see header comment) ----
  let work = img
  let capScale = 1
  const longSide = Math.max(srcW, srcH)
  if (longSide > MAX_WORK_DIM) {
    capScale = MAX_WORK_DIM / longSide
    work = downsampleImage(img, MAX_WORK_DIM)
  }
  const workW = work.width, workH = work.height
  const workTargetW = Math.max(1, Math.round(targetW * capScale))
  const workTargetH = Math.max(1, Math.round(targetH * capScale))
  let workProtect: Uint8Array | null = null
  if (opts.protect && opts.protect.length === srcW * srcH) {
    workProtect = capScale < 1
      ? boxResampleMask(opts.protect, srcW, srcH, workW, workH)
      : opts.protect
  }

  // ---- reusable buffers (capacity covers source AND target dims in both
  //      orientations: stride CAPW normal / CAPH transposed) ----
  const CAPW = Math.max(workW, workTargetW, 1)
  const CAPH = Math.max(workH, workTargetH, 1)
  const cells = CAPW * CAPH
  const hMax = Math.max(CAPW, CAPH)
  const mainData = new Uint8ClampedArray(cells * 4)
  const scratchData = new Uint8ClampedArray(cells * 4)   // transposed view
  const mainEnergy = new Float32Array(cells)
  const scratchEnergy = new Float32Array(cells)
  const mainProtect = workProtect ? new Uint8Array(cells) : null
  const scratchProtect = workProtect ? new Uint8Array(cells) : null
  const cost = new Float64Array(2 * hMax)                // 2-row rolling DP
  const back = new Int32Array(cells)                     // backpointers
  const seam = new Int32Array(hMax)                      // current seam path
  const seamPos = new Int32Array(SUB_BATCH * hMax)       // recorded seam positions
  const posRow = new Int32Array(SUB_BATCH)               // per-row sorted positions
  const newPos = new Int32Array(SUB_BATCH)               // inserted column indices
  const tempRowData = new Uint8ClampedArray(hMax * 4)
  const tempRowProtect = new Uint8Array(hMax)
  let simData: Uint8ClampedArray | null = null           // insertion simulation
  let simEnergy: Float32Array | null = null
  let simProtect: Uint8Array | null = null

  // fill the main grid (row stride CAPW)
  for (let y = 0; y < workH; y++) {
    mainData.set(work.data.subarray(y * workW * 4, (y + 1) * workW * 4), y * CAPW * 4)
    if (mainProtect) mainProtect.set(workProtect!.subarray(y * workW, (y + 1) * workW), y * CAPW)
  }
  // full initial energy pass
  for (let y = 0; y < workH; y++) {
    for (let x = 0; x < workW; x++) updateEnergyAt(mainEnergy, mainData, mainProtect, x, y, workW, workH, CAPW)
  }

  let curW = workW, curH = workH
  const dirV = workTargetW > workW ? 1 : -1
  const dirH = workTargetH > workH ? 1 : -1
  const totalV = Math.abs(workTargetW - workW) // seams per axis (constant)
  const totalH = Math.abs(workTargetH - workH)
  let remV = totalV, remH = totalH             // remaining seam counters
  let biV = 0, biH = 0                         // block indices per axis
  let doneUnits = 0
  const totalUnits = Math.max(1, remV + remH)

  const tick = async (): Promise<boolean> => {
    if (onProgress && !onProgress(clamp(doneUnits / totalUnits, 0, 1))) return false
    await new Promise<void>(r => setTimeout(r, 0))
    return true
  }

  // ---- batched seam insertion (see header) ----
  const insertSeamsBatch = (
    data: Uint8ClampedArray, energy: Float32Array, protect: Uint8Array | null,
    w: number, h: number, stride: number, k: number,
  ) => {
    if (k <= 0) return
    if (!simData || !simEnergy) {
      simData = new Uint8ClampedArray(cells * 4)
      simEnergy = new Float32Array(cells)
      if (mainProtect) simProtect = new Uint8Array(cells)
    }
    simData.set(data)
    simEnergy.set(energy)
    const simP = protect && simProtect ? simProtect : null
    if (simP && protect) simP.set(protect)

    // 1. simulate k removals on the scratch copy, recording seam positions
    //    (recorded in the coordinate system at the time of each removal)
    let sw = w
    for (let j = 0; j < k; j++) {
      findMinSeam(simEnergy, sw, h, stride, cost, back, seam)
      seamPos.set(seam.subarray(0, h), j * hMax)
      sw = removeSeamOnce(simData, simEnergy, simP, sw, h, stride, seam)
    }
    // 2. remap each recorded seam back to the block-start coordinate system:
    //    undoing removal m maps x → x + (x ≥ s_m ? 1 : 0); descending order
    //    keeps the still-needed recorded values intact.
    for (let j = k - 1; j >= 1; j--) {
      const off = j * hMax
      for (let y = 0; y < h; y++) {
        let x = seamPos[off + y]
        for (let m = j - 1; m >= 0; m--) {
          if (x >= seamPos[m * hMax + y]) x++
        }
        seamPos[off + y] = x
      }
    }
    // 3. batched rebuild: per row, insert averaged duplicates between each
    //    seam position and its right neighbor (all original columns survive)
    const nw = w + k
    for (let y = 0; y < h; y++) {
      const row = y * stride
      const dbase = row * 4
      for (let j = 0; j < k; j++) posRow[j] = seamPos[j * hMax + y]
      for (let a = 1; a < k; a++) { // insertion sort (k ≤ SUB_BATCH, typically ≪)
        const v = posRow[a]
        let b = a - 1
        while (b >= 0 && posRow[b] > v) { posRow[b + 1] = posRow[b]; b-- }
        posRow[b + 1] = v
      }
      let pi = 0
      let ox = 0
      const emitAvg = (p: number) => {
        const p2 = p + 1 < w ? p + 1 : w - 1
        const sA = dbase + p * 4, sB = dbase + p2 * 4
        for (let c = 0; c < 4; c++) tempRowData[ox + c] = (data[sA + c] + data[sB + c] + 1) >> 1
        if (protect) tempRowProtect[ox] = (protect[row + p] + protect[row + p2] + 1) >> 1
        newPos[pi] = ox >> 2
        pi++; ox += 4
      }
      for (let x = 0; x < w; x++) {
        while (pi < k && posRow[pi] < x) emitAvg(posRow[pi])
        const sA = dbase + x * 4
        for (let c = 0; c < 4; c++) tempRowData[ox + c] = data[sA + c]
        if (protect) tempRowProtect[ox] = protect[row + x]
        ox += 4
      }
      while (pi < k) emitAvg(posRow[pi])
      data.set(tempRowData.subarray(0, ox), dbase)
      if (protect) protect.set(tempRowProtect.subarray(0, nw), row)
      // 4. incremental energy update in the ±2px band around inserted columns
      let doneX = -1
      for (let j = 0; j < k; j++) {
        const np = newPos[j]
        const x0 = Math.max(np - 2, doneX + 1)
        const x1 = Math.min(np + 2, nw - 1)
        for (let x = x0; x <= x1; x++) updateEnergyAt(energy, data, protect, x, y, nw, h, stride)
        if (x1 > doneX) doneX = x1
      }
    }
  }

  // ---- one block of vertical seam ops (removal or insertion) ----
  const runBlock = async (
    data: Uint8ClampedArray, energy: Float32Array, protect: Uint8Array | null,
    w: number, h: number, stride: number, k: number, dir: number,
  ): Promise<{ w: number; ok: boolean }> => {
    if (dir < 0) {
      let cw = w
      for (let i = 0; i < k; i++) {
        findMinSeam(energy, cw, h, stride, cost, back, seam)
        cw = removeSeamOnce(data, energy, protect, cw, h, stride, seam)
        doneUnits++
        if (doneUnits % YIELD_EVERY === 0) {
          if (!(await tick())) return { w: cw, ok: false }
        }
      }
      return { w: cw, ok: true }
    }
    let cw = w
    let rem = k
    while (rem > 0) {
      const b = Math.min(rem, SUB_BATCH)
      insertSeamsBatch(data, energy, protect, cw, h, stride, b)
      cw += b
      rem -= b
      doneUnits += b
      if (!(await tick())) return { w: cw, ok: false }
    }
    return { w: cw, ok: true }
  }

  await tick() // initial yield — lets the UI paint progress before heavy work

  // ---- scheduler: alternate V/H blocks, evenly split over ≤ ROUNDS rounds ----
  // balanced decomposition: block i of R = ceil((i+1)·total/R) − ceil(i·total/R)
  // (sizes differ by ≤ 1, sum exactly to total — no geometric small-block tail)
  const blockAt = (total: number, i: number): number => {
    const R = Math.max(1, Math.min(ROUNDS, total))
    return Math.max(1, Math.min(Math.ceil(((i + 1) * total) / R) - Math.ceil((i * total) / R), total))
  }
  let ok = true
  while (ok && (remV > 0 || remH > 0)) {
    if (remV > 0) {
      let b = Math.min(blockAt(totalV, biV), remV)
      if (dirV > 0) b = Math.min(b, curW) // ≤ 2× growth per round
      const r = await runBlock(mainData, mainEnergy, mainProtect, curW, curH, CAPW, b, dirV)
      curW = r.w
      ok = r.ok
      remV -= b
      biV++
    }
    if (ok && remH > 0) {
      let b = Math.min(blockAt(totalH, biH), remH)
      if (dirH > 0) b = Math.min(b, curH) // ≤ 2× growth per round
      // horizontal seams = vertical seams on the transposed grid
      transposeQuads(mainData, scratchData, curW, curH, CAPW, CAPH)
      transposeScalar(mainEnergy, scratchEnergy, curW, curH, CAPW, CAPH)
      if (mainProtect) transposeScalar(mainProtect, scratchProtect!, curW, curH, CAPW, CAPH)
      const r = await runBlock(scratchData, scratchEnergy, mainProtect ? scratchProtect : null, curH, curW, CAPH, b, dirH)
      if (!r.ok) { ok = false; break }
      const tw = r.w
      transposeQuads(scratchData, mainData, tw, curW, CAPH, CAPW)
      transposeScalar(scratchEnergy, mainEnergy, tw, curW, CAPH, CAPW)
      if (mainProtect) transposeScalar(scratchProtect!, mainProtect, tw, curW, CAPH, CAPW)
      curH = tw
      remH -= b
      biH++
    }
  }

  if (!ok) return { imageData: orig(), aborted: true }

  // ---- compact the strided grid into a dense ImageData ----
  const compact = (w: number, h: number, stride: number, src: Uint8ClampedArray): ImageData => {
    const out = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) out.set(src.subarray(y * stride * 4, y * stride * 4 + w * 4), y * w * 4)
    return new ImageData(out, w, h)
  }
  let result = compact(curW, curH, CAPW, mainData)
  if (result.width !== targetW || result.height !== targetH) {
    // capped-resolution path (or a defensive exact-size fix): Lanczos back
    // to the requested target dimensions
    const c = createCanvas(result.width, result.height)
    putImageData(c, result)
    const up = await lanczosResample(c, targetW, targetH)
    result = ctx2d(up).getImageData(0, 0, up.width, up.height)
  }
  onProgress?.(1)
  return { imageData: result, aborted: false }
}
