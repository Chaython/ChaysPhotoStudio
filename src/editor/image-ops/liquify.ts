// ============================================================
// Liquify — mesh-based image warp engine (Filter > Liquify)
//
// Model: a coarse grid of nodes laid over the document. Each node
// stores a displacement (dx, dy) in doc pixels. The warp of a
// destination pixel p samples the source at p − d(p), where d is
// the bilinear interpolation of the 4 surrounding node offsets —
// the exact inverse-mesh scheme Photoshop's Liquify uses.
//
//  - createMesh        — grid sized ≈ targetCells across the long
//                        side, cells clamped ≥ 8 px, node count capped
//  - meshAt            — bilinear displacement lookup (doc space)
//  - applyLiquifyDab   — brush stamp for one tool at one position:
//                        forward / pucker / bloat / twirl-cw /
//                        twirl-ccw / reconstruct, followed by a
//                        localized smoothing pass (kills grid ridges)
//  - meshDirtyBounds   — doc-space bbox of non-zero displacement
//                        (bilinear reach = one cell) — lets the CPU
//                        commit warp only the touched region
//  - warpCanvas        — full-resolution CPU commit: per destination
//                        pixel, bilinear sample of the source at
//                        (x − dx, y − dy), straight RGBA, rAF
//                        yielding + progress
// The GPU live preview (dialog) mirrors this math 1:1 in a shader.
// ============================================================
import { createCanvas, ctx2d, clamp } from '../utils/canvas'

// ---------- mesh ----------

export interface LiquifyMesh {
  cols: number
  rows: number
  cellW: number
  cellH: number
  /** (cols*rows*2) doc-space px offsets: dx,dy at each grid node */
  disp: Float32Array
}

export function createMesh(docW: number, docH: number, targetCells = 96): LiquifyMesh {
  const long = Math.max(docW, docH)
  // spacing ≈ long/targetCells, cells never smaller than 8 px, node
  // count capped (~224 on the long side) so huge docs stay sane
  const spacing = Math.max(long / targetCells, 8, long / 224)
  const cols = Math.ceil(docW / spacing) + 1
  const rows = Math.ceil(docH / spacing) + 1
  return { cols, rows, cellW: spacing, cellH: spacing, disp: new Float32Array(cols * rows * 2) }
}

function smoothstep01(t: number): number {
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return t * t * (3 - 2 * t)
}

/** Bilinear interpolation of the grid displacement at a doc-space position (grid is clamped at the edges). */
export function meshAt(mesh: LiquifyMesh, x: number, y: number): { dx: number; dy: number } {
  const out = { dx: 0, dy: 0 }
  meshAtOut(mesh, x, y, out)
  return out
}

/** Allocation-free variant used by the tight CPU loops. */
export function meshAtOut(mesh: LiquifyMesh, x: number, y: number, out: { dx: number; dy: number }): void {
  const { cols, rows, cellW, cellH, disp } = mesh
  const gx = clamp(x / cellW, 0, cols - 1)
  const gy = clamp(y / cellH, 0, rows - 1)
  const c0 = Math.min(Math.floor(gx), Math.max(0, cols - 2))
  const r0 = Math.min(Math.floor(gy), Math.max(0, rows - 2))
  const tx = clamp(gx - c0, 0, 1)
  const ty = clamp(gy - r0, 0, 1)
  const c1 = c0 + 1
  const r1 = r0 + 1
  const i00 = (r0 * cols + c0) * 2
  const i10 = (r0 * cols + c1) * 2
  const i01 = (r1 * cols + c0) * 2
  const i11 = (r1 * cols + c1) * 2
  const w0 = (1 - tx)
  const w1 = tx
  const h0 = (1 - ty)
  const h1 = ty
  out.dx = (disp[i00] * w0 + disp[i10] * w1) * h0 + (disp[i01] * w0 + disp[i11] * w1) * h1
  out.dy = (disp[i00 + 1] * w0 + disp[i10 + 1] * w1) * h0 + (disp[i01 + 1] * w0 + disp[i11 + 1] * w1) * h1
}

// ---------- brush ----------

export interface LiquifyBrushOptions {
  size: number
  /** strength 0..100 */
  density: number
  /** 0..100, scales density */
  pressure: number
}

export type LiquifyToolId = 'forward' | 'pucker' | 'bloat' | 'twirl-cw' | 'twirl-ccw' | 'reconstruct'

/**
 * Stamp one brush dab onto the mesh (mutates mesh.disp).
 *
 *  dt   — for 'forward': pointer-delta magnitude in doc px (push length,
 *         capped at size/4 so speed limits the smear). For the hold tools
 *         it is "frame ticks" (≈1 per 16.7 ms) scaling the per-tick rate.
 *  dirX/dirY — normalized drag direction (forward warp).
 */
export function applyLiquifyDab(
  mesh: LiquifyMesh,
  tool: LiquifyToolId,
  x: number,
  y: number,
  opts: LiquifyBrushOptions,
  dt: number,
  dirX = 0,
  dirY = 0,
): void {
  const R = Math.max(2, opts.size / 2)
  const density = clamp(opts.density, 0, 100) / 100
  const pressure = clamp(opts.pressure, 0, 100) / 100
  const k = density * pressure
  if (k <= 0 && tool !== 'reconstruct') return
  const { cols, rows, cellW, cellH, disp } = mesh
  const c0 = Math.max(0, Math.floor((x - R) / cellW))
  const c1 = Math.min(cols - 1, Math.ceil((x + R) / cellW))
  const r0 = Math.max(0, Math.floor((y - R) / cellH))
  const r1 = Math.min(rows - 1, Math.ceil((y + R) / cellH))
  if (c1 < c0 || r1 < r0) return

  // per-tool strengths
  const tick = clamp(dt, 0, 4)                                  // hold-tool ticks this dab
  const forwardM = k * clamp(dt, 0, R / 2)                      // drag px, speed-capped at size/4
  const radialS = 0.03 * k * tick                               // pucker/bloat radial scale per tick
  const twirlW = 0.03 * k * tick                                // twirl radians per tick
  const reconstructK = clamp(0.05 + 0.1 * k, 0.05, 0.9) * clamp(tick, 0.5, 2)
  // runaway guard only — generous enough never to limit normal warps
  const cap = tool === 'forward'
    ? Math.hypot(cols * cellW, rows * cellH)                    // drag-follow: effectively uncapped
    : 3 * R

  for (let r = r0; r <= r1; r++) {
    const ny = r * cellH
    for (let c = c0; c <= c1; c++) {
      const nx = c * cellW
      const ddx = nx - x     // node − center
      const ddy = ny - y
      const dist = Math.sqrt(ddx * ddx + ddy * ddy)
      if (dist >= R) continue
      const f = smoothstep01(1 - dist / R)
      const i = (r * cols + c) * 2
      switch (tool) {
        case 'forward':
          disp[i] += dirX * forwardM * f
          disp[i + 1] += dirY * forwardM * f
          break
        case 'pucker':
          // pull nodes toward the brush center
          disp[i] -= ddx * radialS * f
          disp[i + 1] -= ddy * radialS * f
          break
        case 'bloat':
          // push nodes radially outward from the center
          disp[i] += ddx * radialS * f
          disp[i + 1] += ddy * radialS * f
          break
        case 'twirl-cw':
        case 'twirl-ccw': {
          // tangential rotation around the center; +1 = screen-clockwise (y-down)
          const sgn = tool === 'twirl-cw' ? 1 : -1
          disp[i] += sgn * twirlW * (-ddy) * f
          disp[i + 1] += sgn * twirlW * ddx * f
          break
        }
        case 'reconstruct':
          // local undo: pull displacement toward 0
          disp[i] *= 1 - Math.min(0.95, reconstructK * f)
          disp[i + 1] *= 1 - Math.min(0.95, reconstructK * f)
          break
      }
      if (tool !== 'reconstruct') {
        const m = Math.sqrt(disp[i] * disp[i] + disp[i + 1] * disp[i + 1])
        if (m > cap) {
          const s = cap / m
          disp[i] *= s
          disp[i + 1] *= s
        }
      }
    }
  }

  // localized smoothing — averages neighbouring nodes inside the disk so
  // single dabs don't carve ridges into the grid (reconstruct needs none)
  if (tool !== 'reconstruct') {
    smoothDisk(mesh, x, y, R, c0, c1, r0, r1, tool === 'forward' ? 1 : 2)
  }
}

/** 1–2 Laplacian averaging passes over the nodes inside the brush disk. */
function smoothDisk(
  mesh: LiquifyMesh, x: number, y: number, R: number,
  c0: number, c1: number, r0: number, r1: number, passes: number,
): void {
  const { cols, rows, cellW, cellH, disp } = mesh
  const bc0 = Math.max(0, c0 - 1), bc1 = Math.min(cols - 1, c1 + 1)
  const br0 = Math.max(0, r0 - 1), br1 = Math.min(rows - 1, r1 + 1)
  const bw = bc1 - bc0 + 1, bh = br1 - br0 + 1
  let snap = new Float32Array(bw * bh * 2)
  for (let r = 0; r < bh; r++) {
    const srcRow = (br0 + r) * cols + bc0
    for (let c = 0; c < bw; c++) {
      const s = (srcRow + c) * 2, t = (r * bw + c) * 2
      snap[t] = disp[s]
      snap[t + 1] = disp[s + 1]
    }
  }
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(snap.length)
    for (let r = 0; r < bh; r++) {
      const nodeY = (br0 + r) * cellH
      for (let c = 0; c < bw; c++) {
        const nodeX = (bc0 + c) * cellW
        const t = (r * bw + c) * 2
        const d = Math.sqrt((nodeX - x) ** 2 + (nodeY - y) ** 2)
        if (d >= R) { // outside the disk: untouched
          next[t] = snap[t]
          next[t + 1] = snap[t + 1]
          continue
        }
        const a = 0.4 * smoothstep01(1 - d / R)
        const left = c > 0 ? t - 2 : t
        const right = c < bw - 1 ? t + 2 : t
        const up = r > 0 ? t - bw * 2 : t
        const down = r < bh - 1 ? t + bw * 2 : t
        for (let ch = 0; ch < 2; ch++) {
          const avg = (snap[left + ch] + snap[right + ch] + snap[up + ch] + snap[down + ch]) / 4
          next[t + ch] = snap[t + ch] * (1 - a) + avg * a
        }
      }
    }
    snap = next
  }
  for (let r = 0; r < bh; r++) {
    const dstRow = (br0 + r) * cols + bc0
    for (let c = 0; c < bw; c++) {
      const d = (dstRow + c) * 2, t = (r * bw + c) * 2
      disp[d] = snap[t]
      disp[d + 1] = snap[t + 1]
    }
  }
}

// ---------- dirty region ----------

/**
 * Doc-space bbox covering every pixel whose warp differs from identity
 * (nodes with non-zero displacement, inflated by one cell = bilinear
 * reach, + 1 px). null when the mesh is pristine.
 */
export function meshDirtyBounds(mesh: LiquifyMesh): { x: number; y: number; w: number; h: number } | null {
  const { cols, rows, cellW, cellH, disp } = mesh
  let minC = cols, maxC = -1, minR = rows, maxR = -1
  for (let r = 0; r < rows; r++) {
    const row = r * cols
    for (let c = 0; c < cols; c++) {
      const i = (row + c) * 2
      if (disp[i] !== 0 || disp[i + 1] !== 0) {
        if (c < minC) minC = c
        if (c > maxC) maxC = c
        if (r < minR) minR = r
        if (r > maxR) maxR = r
      }
    }
  }
  if (maxC < 0) return null
  const x = Math.max(0, (minC - 1) * cellW - 1)
  const y = Math.max(0, (minR - 1) * cellH - 1)
  const x2 = (maxC + 1) * cellW + 1
  const y2 = (maxR + 1) * cellH + 1
  return { x, y, w: x2 - x, h: y2 - y }
}

// ---------- CPU commit warp ----------

const nextFrame = () => new Promise<void>(res => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => res())
  else setTimeout(res, 0)
})

/**
 * Full-resolution CPU warp: for each destination pixel, source position
 * = (x − dx, y − dy) with dx,dy from meshAt, bilinear sample (straight
 * RGBA, clamped edges). Pixels outside the mesh's dirty bounds are
 * copied identity, so untouched areas are pixel-exact and instant.
 * Yields to rAF every ~16 rows with progress. Returns a NEW canvas.
 */
export async function warpCanvas(
  source: HTMLCanvasElement,
  mesh: LiquifyMesh,
  onProgress?: (p: number) => void,
): Promise<HTMLCanvasElement> {
  const w = source.width
  const h = source.height
  const dst = createCanvas(w, h)
  const outCtx = ctx2d(dst)
  const bounds = meshDirtyBounds(mesh)
  if (!bounds) {
    outCtx.drawImage(source, 0, 0)
    onProgress?.(1)
    return dst
  }
  const bx = Math.max(0, Math.floor(bounds.x))
  const by = Math.max(0, Math.floor(bounds.y))
  const bw = Math.min(w, Math.ceil(bounds.x + bounds.w)) - bx
  const bh = Math.min(h, Math.ceil(bounds.y + bounds.h)) - by
  if (bw <= 0 || bh <= 0) {
    onProgress?.(1)
    return dst
  }
  // identity outside the dirty region (exact — displacement there is 0)
  outCtx.drawImage(source, 0, 0)
  const sd = ctx2d(source).getImageData(0, 0, w, h).data
  const region = new ImageData(bw, bh)
  const od = region.data
  const { cols, rows, cellW, cellH, disp } = mesh
  const colLimit = Math.max(0, cols - 2)
  const rowLimit = Math.max(0, rows - 2)
  let lastYield = performance.now()
  for (let y = 0; y < bh; y++) {
    const docY = by + y
    const gy = clamp(docY / cellH, 0, rows - 1)
    const gr = Math.min(Math.floor(gy), rowLimit)
    const ty = clamp(gy - gr, 0, 1)
    const row0 = gr * cols
    const row1 = (gr + 1) * cols
    const h0 = 1 - ty, h1 = ty
    for (let x = 0; x < bw; x++) {
      const docX = bx + x
      const gx = clamp(docX / cellW, 0, cols - 1)
      const gc = Math.min(Math.floor(gx), colLimit)
      const tx = clamp(gx - gc, 0, 1)
      const i00 = (row0 + gc) * 2
      const i10 = (row0 + gc + 1) * 2
      const i01 = (row1 + gc) * 2
      const i11 = (row1 + gc + 1) * 2
      const w0 = 1 - tx, w1 = tx
      const dx = (disp[i00] * w0 + disp[i10] * w1) * h0 + (disp[i01] * w0 + disp[i11] * w1) * h1
      const dy = (disp[i00 + 1] * w0 + disp[i10 + 1] * w1) * h0 + (disp[i01 + 1] * w0 + disp[i11 + 1] * w1) * h1
      const sx = docX - dx
      const sy = docY - dy
      // bilinear sample with clamped edges (straight RGBA)
      const fx = sx - Math.floor(sx)
      const fy = sy - Math.floor(sy)
      const ix = Math.floor(sx)
      const iy = Math.floor(sy)
      const xa = Math.min(Math.max(ix, 0), w - 1)
      const xb = Math.min(Math.max(ix + 1, 0), w - 1)
      const ya = Math.min(Math.max(iy, 0), h - 1)
      const yb = Math.min(Math.max(iy + 1, 0), h - 1)
      const p00 = (ya * w + xa) << 2
      const p10 = (ya * w + xb) << 2
      const p01 = (yb * w + xa) << 2
      const p11 = (yb * w + xb) << 2
      const o = (y * bw + x) << 2
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy
      od[o] = sd[p00] * w00 + sd[p10] * w10 + sd[p01] * w01 + sd[p11] * w11
      od[o + 1] = sd[p00 + 1] * w00 + sd[p10 + 1] * w10 + sd[p01 + 1] * w01 + sd[p11 + 1] * w11
      od[o + 2] = sd[p00 + 2] * w00 + sd[p10 + 2] * w10 + sd[p01 + 2] * w01 + sd[p11 + 2] * w11
      od[o + 3] = sd[p00 + 3] * w00 + sd[p10 + 3] * w10 + sd[p01 + 3] * w01 + sd[p11 + 3] * w11
    }
    if ((y & 15) === 15 || y === bh - 1) {
      onProgress?.((y + 1) / bh)
      if (performance.now() - lastYield > 8) {
        await nextFrame()
        lastYield = performance.now()
      }
    }
  }
  outCtx.putImageData(region, bx, by)
  onProgress?.(1)
  return dst
}
