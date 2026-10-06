import type { TransformWarpSpec } from '../types'
import { createCanvas, ctx2d, clamp } from '../utils/canvas'
import { homography, projectPoint, type Point2 } from './perspective'

function sampleBilinear(src: ImageData, x: number, y: number, out: Uint8ClampedArray, j: number) {
  if (x < -0.5 || y < -0.5 || x > src.width - 0.5 || y > src.height - 0.5) return
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

/**
 * Project a source canvas into an arbitrary document-space quad.
 * Returns a tightly bounded output canvas plus its document-space registration.
 * Corners are TL, TR, BR, BL.
 */
export function warpCanvasToQuad(
  source: HTMLCanvasElement,
  quad: Point2[],
): { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } {
  if (quad.length !== 4 || source.width < 1 || source.height < 1) {
    return { canvas: createCanvas(1, 1), offsetX: 0, offsetY: 0 }
  }

  const minX = Math.floor(Math.min(...quad.map(p => p.x))) - 2
  const minY = Math.floor(Math.min(...quad.map(p => p.y))) - 2
  const maxX = Math.ceil(Math.max(...quad.map(p => p.x))) + 2
  const maxY = Math.ceil(Math.max(...quad.map(p => p.y))) + 2
  const width = Math.max(1, maxX - minX + 1)
  const height = Math.max(1, maxY - minY + 1)
  const localQuad = quad.map(p => ({ x: p.x - minX, y: p.y - minY }))

  const srcRect = [
    { x: 0, y: 0 },
    { x: source.width - 1, y: 0 },
    { x: source.width - 1, y: source.height - 1 },
    { x: 0, y: source.height - 1 },
  ]
  // Destination-local -> source mapping used for inverse rasterization.
  const inv = homography(localQuad, srcRect)
  const out = createCanvas(width, height)
  if (!inv) return { canvas: out, offsetX: minX, offsetY: minY }

  const src = ctx2d(source).getImageData(0, 0, source.width, source.height)
  const dc = ctx2d(out)
  const dst = dc.createImageData(width, height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = projectPoint(inv, { x, y })
      sampleBilinear(src, p.x, p.y, dst.data, (y * width + x) * 4)
    }
  }
  dc.putImageData(dst, 0, 0)
  return { canvas: out, offsetX: minX, offsetY: minY }
}

/** Project a point from a source rectangle into a document-space quad. */
export function mapRectPointToQuad(
  point: Point2,
  rect: { x: number; y: number; w: number; h: number },
  quad: Point2[],
): Point2 {
  const src = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ]
  const h = homography(src, quad)
  return h ? projectPoint(h, point) : { ...point }
}


export interface PuppetWarpPin {
  id: string
  /** Original/source pin position, normalized 0..1. */
  x: number
  y: number
  /** Current destination pin position, normalized source coordinates. */
  targetX: number
  targetY: number
  /** Local pin rotation in degrees. */
  rotation: number
  /** Higher values win more strongly where pin influences overlap. */
  depth: number
}

function puppetAxis(divisions: number, pinValues: number[]): number[] {
  const fixed = Array.from(new Set([0, 1, ...pinValues.map(v => clamp(v, 0, 1))]))
    .sort((a,b)=>a-b)
  const max = 13
  if (fixed.length >= max) return fixed.slice(0,max-1).concat(1)
  const regular = Array.from({length:Math.max(1,Math.min(12,Math.round(divisions)))+1},(_,i)=>i/Math.max(1,Math.min(12,Math.round(divisions))))
  const candidates = regular
    .filter(v=>!fixed.some(f=>Math.abs(f-v)<1e-5))
    .sort((a,b)=>{
      const da=Math.min(...fixed.map(f=>Math.abs(f-a)))
      const db=Math.min(...fixed.map(f=>Math.abs(f-b)))
      return db-da
    })
  const out=[...fixed]
  for(const v of candidates){
    if(out.length>=max)break
    out.push(v)
  }
  return out.sort((a,b)=>a-b)
}

/** Build a Photoshop-style Puppet Warp deformation mesh from pins.
 * Pin coordinates are inserted as real split intersections so dragged pins
 * land exactly on their targets instead of only approximately influencing a
 * coarse regular grid. Rigidity controls how broadly each pin moves the mesh. */
export function puppetWarpMesh(
  pins: PuppetWarpPin[],
  divisions = 6,
  rigidity = 50,
  aspect = 1,
): TransformWarpSpec {
  const safePins=pins.slice(0,10).map(pin=>({
    ...pin,
    x:clamp(Number(pin.x)||0,0,1),
    y:clamp(Number(pin.y)||0,0,1),
    targetX:Number.isFinite(pin.targetX)?pin.targetX:pin.x,
    targetY:Number.isFinite(pin.targetY)?pin.targetY:pin.y,
    rotation:clamp(Number(pin.rotation)||0,-180,180),
    depth:clamp(Math.round(Number(pin.depth)||0),-20,20),
  }))
  const u=puppetAxis(divisions,safePins.map(p=>p.x))
  const v=puppetAxis(divisions,safePins.map(p=>p.y))
  const a=Math.max(.05,Math.min(20,aspect||1))
  const power=4.5-3*clamp(rigidity,0,100)/100
  const points=v.flatMap(y=>u.map(x=>{
    const exact=safePins.find(p=>Math.abs(p.x-x)<1e-6&&Math.abs(p.y-y)<1e-6)
    if(exact)return {x:exact.targetX,y:exact.targetY}
    if(!safePins.length)return {x,y}
    let sx=0,sy=0,sw=0
    for(const pin of safePins){
      const dx=(x-pin.x)*a
      const dy=y-pin.y
      const dist=Math.max(1e-4,Math.hypot(dx,dy))
      const priority=Math.pow(1.18,pin.depth)
      const w=priority/Math.pow(dist,power)
      const rad=pin.rotation*Math.PI/180
      const lx=x-pin.x,ly=y-pin.y
      const rx=lx*Math.cos(rad)-ly*Math.sin(rad)
      const ry=lx*Math.sin(rad)+ly*Math.cos(rad)
      const ddx=(pin.targetX-pin.x)+(rx-lx)
      const ddy=(pin.targetY-pin.y)+(ry-ly)
      sx+=ddx*w;sy+=ddy*w;sw+=w
    }
    return {x:x+sx/Math.max(1e-9,sw),y:y+sy/Math.max(1e-9,sw)}
  }))
  return {u,v,points}
}

export function regularWarpMesh(cols: number, rows: number): TransformWarpSpec {
  const c = Math.max(1, Math.min(12, Math.round(cols)))
  const r = Math.max(1, Math.min(12, Math.round(rows)))
  const u = Array.from({ length: c + 1 }, (_, i) => i / c)
  const v = Array.from({ length: r + 1 }, (_, i) => i / r)
  const points = v.flatMap(y => u.map(x => ({ x, y })))
  return { u, v, points }
}

export function cloneWarpMesh(mesh: TransformWarpSpec): TransformWarpSpec {
  return {
    u: [...mesh.u],
    v: [...mesh.v],
    points: mesh.points.map(p => ({ x: p.x, y: p.y })),
  }
}

export function validateWarpMesh(mesh: TransformWarpSpec | null | undefined): TransformWarpSpec | null {
  if (!mesh || !Array.isArray(mesh.u) || !Array.isArray(mesh.v) || !Array.isArray(mesh.points)) return null
  if (mesh.u.length < 2 || mesh.v.length < 2 || mesh.u.length > 13 || mesh.v.length > 13) return null
  if (mesh.points.length !== mesh.u.length * mesh.v.length) return null
  const u = mesh.u.map(Number), v = mesh.v.map(Number)
  if (!u.every(Number.isFinite) || !v.every(Number.isFinite)) return null
  for (let i = 1; i < u.length; i++) if (u[i] <= u[i - 1]) return null
  for (let i = 1; i < v.length; i++) if (v[i] <= v[i - 1]) return null
  if (Math.abs(u[0]) > 1e-6 || Math.abs(u[u.length - 1] - 1) > 1e-6) return null
  if (Math.abs(v[0]) > 1e-6 || Math.abs(v[v.length - 1] - 1) > 1e-6) return null
  const points = mesh.points.map(p => ({ x: Number(p.x), y: Number(p.y) }))
  if (!points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return null
  return { u, v, points }
}

function meshIndex(mesh: TransformWarpSpec, col: number, row: number) {
  return row * mesh.u.length + col
}

/**
 * Evaluate the mesh in normalized destination coordinates for a normalized
 * source-space coordinate. Each split cell uses bilinear interpolation.
 */
export function mapNormalizedPointThroughWarp(
  p: Point2,
  mesh: TransformWarpSpec,
): Point2 {
  const m = validateWarpMesh(mesh)
  if (!m) return { ...p }
  const uu = clamp(p.x, 0, 1), vv = clamp(p.y, 0, 1)
  let ci = m.u.length - 2, ri = m.v.length - 2
  for (let i = 0; i < m.u.length - 1; i++) {
    if (uu <= m.u[i + 1] + 1e-9) { ci = i; break }
  }
  for (let i = 0; i < m.v.length - 1; i++) {
    if (vv <= m.v[i + 1] + 1e-9) { ri = i; break }
  }
  const u0 = m.u[ci], u1 = m.u[ci + 1], v0 = m.v[ri], v1 = m.v[ri + 1]
  const tx = (uu - u0) / Math.max(1e-9, u1 - u0)
  const ty = (vv - v0) / Math.max(1e-9, v1 - v0)
  const p00 = m.points[meshIndex(m, ci, ri)]
  const p10 = m.points[meshIndex(m, ci + 1, ri)]
  const p11 = m.points[meshIndex(m, ci + 1, ri + 1)]
  const p01 = m.points[meshIndex(m, ci, ri + 1)]
  return {
    x: p00.x * (1 - tx) * (1 - ty) + p10.x * tx * (1 - ty) + p11.x * tx * ty + p01.x * (1 - tx) * ty,
    y: p00.y * (1 - tx) * (1 - ty) + p10.y * tx * (1 - ty) + p11.y * tx * ty + p01.y * (1 - tx) * ty,
  }
}

/** Insert an arbitrary Photoshop-style Split Warp line and interpolate the
 * newly created control points from the current mesh so the image does not
 * jump when the split is added. */
export function splitWarpMesh(
  mesh: TransformWarpSpec,
  axis: 'u' | 'v',
  position: number,
): TransformWarpSpec {
  const m = validateWarpMesh(mesh) ?? regularWarpMesh(3, 3)
  const pos = clamp(position, .01, .99)
  const lines = axis === 'u' ? m.u : m.v
  if (lines.some(v => Math.abs(v - pos) < .005)) return cloneWarpMesh(m)

  const nextLines = [...lines, pos].sort((a, b) => a - b)
  const next: TransformWarpSpec = axis === 'u'
    ? { u: nextLines, v: [...m.v], points: [] }
    : { u: [...m.u], v: nextLines, points: [] }
  next.points = next.v.flatMap(v => next.u.map(u => mapNormalizedPointThroughWarp({ x: u, y: v }, m)))
  return next
}

export function removeWarpSplit(
  mesh: TransformWarpSpec,
  axis: 'u' | 'v',
  lineIndex: number,
): TransformWarpSpec {
  const m = validateWarpMesh(mesh)
  if (!m) return regularWarpMesh(3, 3)
  const lines = axis === 'u' ? m.u : m.v
  if (lineIndex <= 0 || lineIndex >= lines.length - 1) return cloneWarpMesh(m)
  if ((axis === 'u' ? m.u.length : m.v.length) <= 2) return cloneWarpMesh(m)

  const next: TransformWarpSpec = axis === 'u'
    ? { u: m.u.filter((_, i) => i !== lineIndex), v: [...m.v], points: [] }
    : { u: [...m.u], v: m.v.filter((_, i) => i !== lineIndex), points: [] }

  if (axis === 'u') {
    for (let row = 0; row < m.v.length; row++) {
      for (let col = 0; col < m.u.length; col++) {
        if (col === lineIndex) continue
        next.points.push({ ...m.points[meshIndex(m, col, row)] })
      }
    }
  } else {
    for (let row = 0; row < m.v.length; row++) {
      if (row === lineIndex) continue
      for (let col = 0; col < m.u.length; col++) {
        next.points.push({ ...m.points[meshIndex(m, col, row)] })
      }
    }
  }
  return next
}

export function resampleWarpMesh(mesh: TransformWarpSpec, cols: number, rows: number): TransformWarpSpec {
  const m = validateWarpMesh(mesh) ?? regularWarpMesh(cols, rows)
  const next = regularWarpMesh(cols, rows)
  next.points = next.v.flatMap(v => next.u.map(u => mapNormalizedPointThroughWarp({ x: u, y: v }, m)))
  return next
}

export type WarpPreset = 'custom' | 'arc' | 'arch' | 'bulge' | 'flag' | 'wave'

export function warpMeshDestinationPoints(
  mesh: TransformWarpSpec,
  quad: Point2[],
): Point2[] {
  const m = validateWarpMesh(mesh)
  if (!m || quad.length !== 4) return []
  const unit = [
    { x: 0, y: 0 }, { x: 1, y: 0 },
    { x: 1, y: 1 }, { x: 0, y: 1 },
  ]
  const h = homography(unit, quad)
  if (!h) return []
  return m.points.map(p => projectPoint(h, p))
}

/** Photoshop-style preset warp generator. Bend/H/V are percentages. */
export function presetWarpMesh(
  cols: number,
  rows: number,
  preset: WarpPreset,
  bend = 0,
  horizontal = 0,
  vertical = 0,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
): TransformWarpSpec {
  const mesh = regularWarpMesh(cols, rows)
  if (preset === 'custom') return mesh
  const b = clamp(bend, -100, 100) / 100
  const hd = clamp(horizontal, -100, 100) / 100
  const vd = clamp(vertical, -100, 100) / 100
  mesh.points = mesh.points.map(p => {
    const px = orientation === 'vertical' ? p.y : p.x
    const py = orientation === 'vertical' ? p.x : p.y
    const x0 = px, y0 = py
    const u = x0 * 2 - 1, v = y0 * 2 - 1
    let x = x0, y = y0
    if (preset === 'arc') {
      y += -b * .35 * (1 - u * u)
    } else if (preset === 'arch') {
      y += -b * .32 * (1 - Math.abs(u))
    } else if (preset === 'bulge') {
      const k = 1 + b * .42 * (1 - Math.min(1, u * u + v * v))
      x = .5 + (x - .5) * k
      y = .5 + (y - .5) * k
    } else if (preset === 'flag') {
      y += b * .22 * Math.sin(x0 * Math.PI * 2)
    } else if (preset === 'wave') {
      y += b * .18 * Math.sin(x0 * Math.PI * 4)
    }
    // Photoshop's H/V fields are directional cross-axis distortion controls.
    x += hd * (y0 - .5) * .28
    y += vd * (x0 - .5) * .28
    return orientation === 'vertical' ? { x: y, y: x } : { x, y }
  })
  return mesh
}

function drawAffineTriangle(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  offsetX: number,
  offsetY: number,
  sa: Point2, sb: Point2, sc: Point2,
  da: Point2, db: Point2, dc: Point2,
) {
  const den = sa.x * (sb.y - sc.y) + sb.x * (sc.y - sa.y) + sc.x * (sa.y - sb.y)
  if (Math.abs(den) < 1e-9) return

  const solve = (a: number, b: number, c: number) => ({
    x: (a * (sb.y - sc.y) + b * (sc.y - sa.y) + c * (sa.y - sb.y)) / den,
    y: (a * (sc.x - sb.x) + b * (sa.x - sc.x) + c * (sb.x - sa.x)) / den,
    z: (
      a * (sb.x * sc.y - sc.x * sb.y) +
      b * (sc.x * sa.y - sa.x * sc.y) +
      c * (sa.x * sb.y - sb.x * sa.y)
    ) / den,
  })
  const X = solve(da.x, db.x, dc.x)
  const Y = solve(da.y, db.y, dc.y)

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.beginPath()
  ctx.moveTo(da.x - offsetX, da.y - offsetY)
  ctx.lineTo(db.x - offsetX, db.y - offsetY)
  ctx.lineTo(dc.x - offsetX, dc.y - offsetY)
  ctx.closePath()
  ctx.clip()
  ctx.setTransform(X.x, Y.x, X.y, Y.y, X.z - offsetX, Y.z - offsetY)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0)
  ctx.restore()
}

/**
 * Warp source pixels through an arbitrary split mesh whose destination points
 * are in document coordinates. Source split lines are normalized 0..1.
 */
export function warpCanvasToMesh(
  source: HTMLCanvasElement,
  mesh: TransformWarpSpec,
  destinationPoints: Point2[],
): { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } {
  const m = validateWarpMesh(mesh)
  if (!m || destinationPoints.length !== m.points.length || source.width < 1 || source.height < 1) {
    return { canvas: createCanvas(1, 1), offsetX: 0, offsetY: 0 }
  }
  const minX = Math.floor(Math.min(...destinationPoints.map(p => p.x))) - 2
  const minY = Math.floor(Math.min(...destinationPoints.map(p => p.y))) - 2
  const maxX = Math.ceil(Math.max(...destinationPoints.map(p => p.x))) + 2
  const maxY = Math.ceil(Math.max(...destinationPoints.map(p => p.y))) + 2
  const out = createCanvas(Math.max(1, maxX - minX + 1), Math.max(1, maxY - minY + 1))
  const dc = ctx2d(out)

  for (let row = 0; row < m.v.length - 1; row++) {
    for (let col = 0; col < m.u.length - 1; col++) {
      const i00 = meshIndex(m, col, row)
      const i10 = meshIndex(m, col + 1, row)
      const i11 = meshIndex(m, col + 1, row + 1)
      const i01 = meshIndex(m, col, row + 1)
      const d00 = destinationPoints[i00], d10 = destinationPoints[i10]
      const d11 = destinationPoints[i11], d01 = destinationPoints[i01]
      const s00 = { x: m.u[col] * source.width, y: m.v[row] * source.height }
      const s10 = { x: m.u[col + 1] * source.width, y: m.v[row] * source.height }
      const s11 = { x: m.u[col + 1] * source.width, y: m.v[row + 1] * source.height }
      const s01 = { x: m.u[col] * source.width, y: m.v[row + 1] * source.height }
      drawAffineTriangle(dc, source, minX, minY, s00, s10, s11, d00, d10, d11)
      drawAffineTriangle(dc, source, minX, minY, s00, s11, s01, d00, d11, d01)
    }
  }
  return { canvas: out, offsetX: minX, offsetY: minY }
}
