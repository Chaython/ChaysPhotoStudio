import { createCanvas, ctx2d, clamp } from '../utils/canvas'

export type BuiltinPattern = 'checker' | 'diagonal' | 'dots' | 'grid'

export interface UserPattern {
  id: string
  name: string
  dataUrl: string
  width: number
  height: number
}

const USER_PATTERN_KEY = 'chays-photo-user-patterns-v1'
const userPatternCache = new Map<string, HTMLCanvasElement>()
let hydrationStarted = false

function readStoredPatterns(): UserPattern[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(USER_PATTERN_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(p => p && typeof p.id === 'string' && typeof p.dataUrl === 'string')
      .slice(0, 20)
      .map(p => ({
        id: p.id,
        name: typeof p.name === 'string' && p.name ? p.name : 'Imported Pattern',
        dataUrl: p.dataUrl,
        width: Math.max(1, Number(p.width) || 1),
        height: Math.max(1, Number(p.height) || 1),
      }))
  } catch { return [] }
}

function writeStoredPatterns(patterns: UserPattern[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(USER_PATTERN_KEY, JSON.stringify(patterns.slice(0, 20)))
  window.dispatchEvent(new CustomEvent('zphoto:patterns'))
}

export function listUserPatterns(): UserPattern[] {
  return readStoredPatterns()
}

async function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const out = createCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height)
  ctx2d(out).drawImage(img, 0, 0)
  return out
}

export async function hydrateUserPatterns() {
  if (typeof window === 'undefined' || hydrationStarted) return
  hydrationStarted = true
  for (const pattern of readStoredPatterns()) {
    try { userPatternCache.set(pattern.id, await dataUrlToCanvas(pattern.dataUrl)) } catch { /* ignore bad saved tile */ }
  }
  window.dispatchEvent(new CustomEvent('zphoto:patterns'))
}

export async function importPatternFile(file: File): Promise<UserPattern> {
  const source = await createImageBitmap(file)
  const maxSide = 256
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
  const w = Math.max(1, Math.round(source.width * scale))
  const h = Math.max(1, Math.round(source.height * scale))
  const canvas = createCanvas(w, h)
  const cc = ctx2d(canvas)
  cc.imageSmoothingEnabled = true
  cc.imageSmoothingQuality = 'high'
  cc.drawImage(source, 0, 0, w, h)
  source.close()
  const id = `user:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const name = file.name.replace(/\.[^.]+$/, '') || 'Imported Pattern'
  const item: UserPattern = { id, name, dataUrl: canvas.toDataURL('image/png'), width: w, height: h }
  const next = [item, ...readStoredPatterns().filter(p => p.id !== id)].slice(0, 20)
  try {
    writeStoredPatterns(next)
  } catch {
    throw new Error('Pattern library storage is full. Remove an imported pattern and try again.')
  }
  userPatternCache.set(id, canvas)
  return item
}

export function removeUserPattern(id: string) {
  userPatternCache.delete(id)
  writeStoredPatterns(readStoredPatterns().filter(p => p.id !== id))
}

if (typeof window !== 'undefined') void hydrateUserPatterns()

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
  if (String(kind).startsWith('user:')) {
    const source = userPatternCache.get(String(kind))
    if (source) {
      const w = Math.max(1, Math.round(source.width * s))
      const h = Math.max(1, Math.round(source.height * s))
      const out = createCanvas(w, h)
      const oc = ctx2d(out)
      oc.imageSmoothingEnabled = true
      oc.imageSmoothingQuality = 'high'
      oc.drawImage(source, 0, 0, w, h)
      return out
    }
  }
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
