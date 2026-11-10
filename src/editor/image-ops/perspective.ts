// Projective geometry helpers used by Perspective Crop.
// Homographies are represented row-major as 3x3 arrays.
export interface Point2 { x: number; y: number }

function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    if (Math.abs(m[pivot][col]) < 1e-12) return null
    if (pivot !== col) [m[pivot], m[col]] = [m[col], m[pivot]]
    const div = m[col][col]
    for (let c = col; c <= n; c++) m[col][c] /= div
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = m[r][col]
      if (Math.abs(f) < 1e-14) continue
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c]
    }
  }
  return m.map(row => row[n])
}

/** Return H such that to ≈ H(from), with h22 fixed to 1. */
export function homography(from: Point2[], to: Point2[]): number[] | null {
  if (from.length !== 4 || to.length !== 4) return null
  const a: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const x = from[i].x, y = from[i].y
    const u = to[i].x, v = to[i].y
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u)
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v)
  }
  const s = solveLinear(a, b)
  return s ? [...s, 1] : null
}

export function projectPoint(h: number[], p: Point2): Point2 {
  const d = h[6] * p.x + h[7] * p.y + h[8]
  if (Math.abs(d) < 1e-12) return { x: 0, y: 0 }
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / d,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / d,
  }
}

export function quadOutputSize(q: Point2[]): { w: number; h: number } {
  const dist = (a: Point2, b: Point2) => Math.hypot(b.x - a.x, b.y - a.y)
  const top = dist(q[0], q[1]), bottom = dist(q[3], q[2])
  const left = dist(q[0], q[3]), right = dist(q[1], q[2])
  return {
    w: Math.max(1, Math.round((top + bottom) / 2)),
    h: Math.max(1, Math.round((left + right) / 2)),
  }
}


/** Reject collapsed, self-crossing and non-finite plane quads before solving a homography. */
export function isValidPerspectiveQuad(quad: Point2[]): boolean {
  if (quad.length !== 4 || quad.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false
  let twiceArea = 0
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4], c = quad[(i + 2) % 4]
    twiceArea += a.x * b.y - b.x * a.y
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-6) return false
    const nextSign = Math.sign(cross)
    if (sign && nextSign !== sign) return false
    sign = nextSign
  }
  return Math.abs(twiceArea) > 1
}

function sampleBilinear(src: ImageData, x: number, y: number, out: Uint8ClampedArray, j: number) {
  if (x < -0.5 || y < -0.5 || x > src.width - 0.5 || y > src.height - 0.5) {
    out[j] = out[j + 1] = out[j + 2] = out[j + 3] = 0
    return
  }
  x = Math.max(0, Math.min(src.width - 1, x))
  y = Math.max(0, Math.min(src.height - 1, y))
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const x1 = Math.min(src.width - 1, x0 + 1), y1 = Math.min(src.height - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  const i00 = (y0 * src.width + x0) * 4
  const i10 = (y0 * src.width + x1) * 4
  const i01 = (y1 * src.width + x0) * 4
  const i11 = (y1 * src.width + x1) * 4
  for (let c = 0; c < 4; c++) {
    const a = src.data[i00 + c] * (1 - fx) + src.data[i10 + c] * fx
    const b = src.data[i01 + c] * (1 - fx) + src.data[i11 + c] * fx
    out[j + c] = a * (1 - fy) + b * fy
  }
}

/** Warp a document-space canvas from source quad into an output rectangle. */
export function warpCanvasPerspective(
  source: HTMLCanvasElement,
  quad: Point2[],
  outW: number,
  outH: number,
  nearest = false,
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(outW))
  out.height = Math.max(1, Math.round(outH))
  const sc = source.getContext('2d', { willReadFrequently: true })!
  const dc = out.getContext('2d')!
  const src = sc.getImageData(0, 0, source.width, source.height)
  const dst = dc.createImageData(out.width, out.height)
  const rect = [
    { x: 0, y: 0 },
    { x: out.width - 1, y: 0 },
    { x: out.width - 1, y: out.height - 1 },
    { x: 0, y: out.height - 1 },
  ]
  const inv = homography(rect, quad)
  if (!inv) return out
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const p = projectPoint(inv, { x, y })
      const j = (y * out.width + x) * 4
      if (nearest) {
        const sx = Math.round(p.x), sy = Math.round(p.y)
        if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue
        const i = (sy * src.width + sx) * 4
        dst.data[j] = src.data[i]
        dst.data[j + 1] = src.data[i + 1]
        dst.data[j + 2] = src.data[i + 2]
        dst.data[j + 3] = src.data[i + 3]
      } else sampleBilinear(src, p.x, p.y, dst.data, j)
    }
  }
  dc.putImageData(dst, 0, 0)
  return out
}


/** Map one source plane onto a destination quadrilateral without flattening
 *  the surrounding document. Pixels outside the destination plane stay
 *  transparent; callers can composite multiple planes in painter order. */
export function warpCanvasQuadToQuad(
  source: HTMLCanvasElement,
  sourceQuad: Point2[],
  destinationQuad: Point2[],
  outW: number,
  outH: number,
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(outW))
  out.height = Math.max(1, Math.round(outH))
  if (!isValidPerspectiveQuad(sourceQuad) || !isValidPerspectiveQuad(destinationQuad)) return out
  const inverse = homography(destinationQuad, sourceQuad)
  if (!inverse) return out

  const minX = Math.max(0, Math.floor(Math.min(...destinationQuad.map(p => p.x))))
  const minY = Math.max(0, Math.floor(Math.min(...destinationQuad.map(p => p.y))))
  const maxX = Math.min(out.width - 1, Math.ceil(Math.max(...destinationQuad.map(p => p.x))))
  const maxY = Math.min(out.height - 1, Math.ceil(Math.max(...destinationQuad.map(p => p.y))))
  if (maxX < minX || maxY < minY) return out

  const sc = source.getContext('2d', { willReadFrequently: true })
  const dc = out.getContext('2d')
  if (!sc || !dc) return out
  const src = sc.getImageData(0, 0, source.width, source.height)
  const dst = dc.createImageData(out.width, out.height)
  const inside = (p: Point2): boolean => {
    let hit = false
    for (let i = 0, j = 3; i < 4; j = i++) {
      const a = destinationQuad[i], b = destinationQuad[j]
      if (((a.y > p.y) !== (b.y > p.y)) &&
          p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
    }
    return hit
  }
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!inside({ x: x + 0.5, y: y + 0.5 })) continue
      const sample = projectPoint(inverse, { x: x + 0.5, y: y + 0.5 })
      sampleBilinear(src, sample.x, sample.y, dst.data, (y * out.width + x) * 4)
    }
  }
  dc.putImageData(dst, 0, 0)
  return out
}
