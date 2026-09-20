import { createCanvas, ctx2d, clamp } from '../utils/canvas'

export type BuiltinPattern = 'checker' | 'diagonal' | 'dots' | 'grid'

export interface PatternPaintOptions {
  kind?: BuiltinPattern | string
  scale?: number
  offsetX?: number
  offsetY?: number
  fg: string
  bg: string
  /** Document-space coordinate represented by target canvas pixel (0,0). */
  originX?: number
  originY?: number
}

export function builtinPatternTile(
  kind: BuiltinPattern | string,
  scale: number,
  fg: string,
  bg: string,
): HTMLCanvasElement {
  const s = clamp(Number(scale) || 1, .25, 4)
  const tileSize = Math.max(4, Math.round(16 * s))
  const tile = createCanvas(tileSize, tileSize)
  const tc = ctx2d(tile)
  tc.fillStyle = bg
  tc.fillRect(0, 0, tileSize, tileSize)

  if (kind === 'checker') {
    const half = tileSize / 2
    tc.fillStyle = fg
    tc.fillRect(0, 0, half, half)
    tc.fillRect(half, half, tileSize - half, tileSize - half)
  } else if (kind === 'diagonal') {
    tc.strokeStyle = fg
    tc.lineWidth = Math.max(1, tileSize * .22)
    tc.lineCap = 'square'
    for (let x = -tileSize; x <= tileSize * 2; x += tileSize / 2) {
      tc.beginPath()
      tc.moveTo(x, tileSize)
      tc.lineTo(x + tileSize, 0)
      tc.stroke()
    }
  } else if (kind === 'dots') {
    tc.fillStyle = fg
    const rr = Math.max(1, tileSize * .16)
    for (const [x, y] of [[tileSize * .25, tileSize * .25], [tileSize * .75, tileSize * .75]]) {
      tc.beginPath()
      tc.arc(x, y, rr, 0, Math.PI * 2)
      tc.fill()
    }
  } else {
    tc.strokeStyle = fg
    tc.lineWidth = Math.max(1, tileSize * .10)
    tc.beginPath()
    tc.moveTo(0, 0); tc.lineTo(tileSize, 0)
    tc.moveTo(0, 0); tc.lineTo(0, tileSize)
    tc.stroke()
  }
  return tile
}

function mod(v: number, n: number) {
  return ((v % n) + n) % n
}

/** Paint a built-in pattern into a target canvas while keeping its phase
 * anchored in document space. Region canvases therefore line up with full
 * document fills and with each other. */
export function paintBuiltinPattern(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: PatternPaintOptions,
) {
  const tile = builtinPatternTile(opts.kind ?? 'checker', opts.scale ?? 1, opts.fg, opts.bg)
  const ox = Number(opts.offsetX) || 0
  const oy = Number(opts.offsetY) || 0
  const originX = Number(opts.originX) || 0
  const originY = Number(opts.originY) || 0
  const startX = -mod(originX - ox, tile.width)
  const startY = -mod(originY - oy, tile.height)

  for (let y = startY; y < height; y += tile.height) {
    for (let x = startX; x < width; x += tile.width) ctx.drawImage(tile, x, y)
  }
}
