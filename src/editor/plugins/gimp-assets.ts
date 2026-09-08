// GIMP asset import — binary .gbr (brush) and text .ggr (gradient) parsers.
// True GIMP *plugins* (Script-Fu / C / Python) and Photoshop .8bf filters are
// native binaries that cannot run in a browser; GIMP *assets* are open,
// documented formats we parse natively.
import { createCanvas, ctx2d } from '../utils/canvas'

const MAX_DIM = 8192

function readU32LE(v: DataView, off: number): number { return v.getUint32(off, true) }

/** parsed GIMP gradient (.ggr) — canonical stops in 0..1 space */
export interface GradientStop { pos: number; r: number; g: number; b: number; a: number }
export interface ParsedGgrGradient { name: string; stops: GradientStop[] }

/** parsed GIMP brush (.gbr) */
export interface ParsedBrush {
  name: string
  spacing: number
  width: number
  height: number
  canvas: HTMLCanvasElement
}

/** Parse a GIMP Brush (.gbr) — v2 (grayscale+mask, 2 bytes/px) and v3 (RGBA or 1-byte). */
export function parseGbr(buf: ArrayBuffer): ParsedBrush {
  const v = new DataView(buf)
  if (buf.byteLength < 28) throw new Error('Truncated brush file')
  const headerSize = readU32LE(v, 0)
  const version = readU32LE(v, 4)
  if (version !== 2 && version !== 3) throw new Error(`Unsupported GBR version ${version} (need 2 or 3)`)
  const width = readU32LE(v, 8)
  const height = readU32LE(v, 12)
  // bytes-per-pixel field at 16 (informational)
  const magic = String.fromCharCode(v.getUint8(20), v.getUint8(21), v.getUint8(22))
  if (magic !== 'GBR') throw new Error('Not a GIMP brush file (bad GBR magic)')
  const spacing = readU32LE(v, 24)
  if (width === 0 || height === 0 || width > MAX_DIM || height > MAX_DIM) {
    throw new Error(`Brush dimensions out of range (${width}×${height})`)
  }

  let off = 28
  if (headerSize > 28 && off < headerSize) off = headerSize

  // v3: color depth field (u32) before the name
  let colorDepth = 0
  if (version === 3) {
    if (off + 4 > buf.byteLength) throw new Error('Truncated brush header')
    colorDepth = readU32LE(v, off)
    off += 4
  }

  // name: u32 length + chars (pascal string), then body
  let name = 'GIMP Brush'
  if (off + 4 <= buf.byteLength) {
    const nameLen = readU32LE(v, off)
    off += 4
    if (nameLen > 0 && nameLen < 4096 && off + nameLen <= buf.byteLength) {
      name = new TextDecoder().decode(new Uint8Array(buf, off, nameLen)).replace(/\0[\s\S]*$/, '') || name
      off += nameLen
    }
  }

  const px = width * height
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)
  const img = ctx.createImageData(width, height)
  const d = img.data

  if (version === 2) {
    // 2 bytes per pixel: grayscale value + mask (alpha)
    if (off + px * 2 > buf.byteLength) throw new Error('Truncated brush body (v2 needs 2 bytes/px)')
    const u8 = new Uint8Array(buf)
    for (let i = 0; i < px; i++) {
      const g = u8[off + i * 2]
      const a = u8[off + i * 2 + 1]
      d[i * 4] = g; d[i * 4 + 1] = g; d[i * 4 + 2] = g; d[i * 4 + 3] = a
    }
  } else if (colorDepth === 4) {
    if (off + px * 4 > buf.byteLength) throw new Error('Truncated brush body (v3 RGBA)')
    d.set(new Uint8Array(buf, off, px * 4))
  } else if (colorDepth === 1) {
    if (off + px > buf.byteLength) throw new Error('Truncated brush body (v3 grayscale)')
    const u8 = new Uint8Array(buf)
    for (let i = 0; i < px; i++) {
      const g = u8[off + i]
      d[i * 4] = g; d[i * 4 + 1] = g; d[i * 4 + 2] = g; d[i * 4 + 3] = g
    }
  } else {
    throw new Error(`Unsupported brush color depth ${colorDepth}`)
  }
  ctx.putImageData(img, 0, 0)
  return { name, spacing, width, height, canvas }
}

/** Parse a GIMP Gradient (.ggr) — text format: 3 positions + left rgba + right rgba + type + coloring per segment. */
export function parseGgrGradient(text: string, fallbackName?: string): ParsedGgrGradient {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines[0]?.startsWith('GIMP Gradient')) throw new Error('Not a GIMP gradient file (missing "GIMP Gradient" header)')
  const name = lines[0].replace(/^GIMP Gradient\s*/, '') || fallbackName || 'GIMP Gradient'
  const segMatch = lines[1]?.match(/^Segments:\s*(\d+)/i)
  if (!segMatch) throw new Error('Missing "Segments:" line')
  const segCount = Number(segMatch[1])

  const stops: GradientStop[] = []
  const seen = new Set<number>()
  const push = (s: GradientStop) => {
    const key = Math.round(s.pos * 100000)
    if (!seen.has(key)) { seen.add(key); stops.push(s) }
  }

  for (let i = 0; i < segCount; i++) {
    const parts = lines[2 + i]?.split(/\s+/) ?? []
    if (parts.length < 13) continue
    // layout: left mid right + LEFT rgba (4) + RIGHT rgba (4) + type + coloring [+ file names]
    const f = parts.slice(0, 13).map(Number)
    if (f.some(n => !isFinite(n))) continue
    const [left, middle, right, lr, lg, lb, la, rr, rg, rb, ra] = f
    const segType = f[11]
    const coloring = f[12]
    if (segType >= 3) continue // shapeburst — file-based, unsupported
    if (coloring !== 0) continue // only RGB interpolation
    push({ pos: left, r: lr, g: lg, b: lb, a: la })
    if (middle > left && middle < right) {
      const t = (middle - left) / Math.max(1e-6, right - left)
      push({
        pos: middle,
        r: lr + (rr - lr) * t, g: lg + (rg - lg) * t, b: lb + (rb - lb) * t, a: la + (ra - la) * t,
      })
    }
    push({ pos: right, r: rr, g: rg, b: rb, a: ra })
  }
  if (stops.length < 2) throw new Error('Gradient has no usable segments')
  stops.sort((a, b) => a.pos - b.pos)
  return { name, stops: stops.map(s => ({ ...s, pos: Math.min(1, Math.max(0, s.pos)) })) }
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** convert parsed stops → gradient-map adjustment params ({ pos, color hex } stops) */
export function stopsToGradientMapParams(stops: GradientStop[]): { stops: { pos: number; color: string }[] } {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos)
  return {
    stops: sorted.map(s => ({ pos: s.pos, color: toHex(s.r, s.g, s.b) })),
  }
}

/** CSS gradient string for UI previews */
export function gradientCss(stops: GradientStop[]): string {
  const segs = stops.map(s => `rgba(${Math.round(s.r * 255)},${Math.round(s.g * 255)},${Math.round(s.b * 255)},${s.a.toFixed(3)}) ${(s.pos * 100).toFixed(1)}%`)
  return `linear-gradient(to right, ${segs.join(', ')})`
}
