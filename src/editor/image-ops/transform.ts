import { createCanvas, ctx2d } from '../utils/canvas'
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
