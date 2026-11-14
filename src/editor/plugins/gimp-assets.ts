// GIMP asset import — .gbr brushes, .pat patterns, .gpl palettes and .ggr gradients.
// True GIMP *plugins* (Script-Fu / C / Python) and Photoshop .8bf filters are
// native binaries that cannot run in a browser; GIMP *assets* are open,
// documented formats we parse natively.
import { createCanvas, ctx2d } from '../utils/canvas'

const MAX_DIM = 8192

function readU32BE(v: DataView, off: number): number { return v.getUint32(off, false) }
const MAX_PIXELS = 16_777_216


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

/** GIMP .gbr uses *big-endian* integers, a 'GIMP' magic and a NUL-terminated
 * UTF-8 name within header_size. v2 accepts gray mask (1 byte) and RGBA (4).
 * CinePaint v3 uses pixel format 18 (gray half float). */
export function parseGbr(buf: ArrayBuffer): ParsedBrush {
  const v = new DataView(buf)
  if (buf.byteLength < 29) throw new Error('Truncated GIMP brush header')
  const headerSize = readU32BE(v, 0)
  const version = readU32BE(v, 4)
  const width = readU32BE(v, 8)
  const height = readU32BE(v, 12)
  const depth = readU32BE(v, 16)
  const magic = String.fromCharCode(...new Uint8Array(buf, 20, 4))
  const spacing = readU32BE(v, 24)
  if (magic !== 'GIMP' || (version !== 2 && version !== 3)) throw new Error('Unsupported GIMP brush header/version')
  if (headerSize < 29 || headerSize > Math.min(buf.byteLength, 4096)) throw new Error('Invalid GIMP brush header size')
  if (!width || !height || width > MAX_DIM || height > MAX_DIM || width * height > MAX_PIXELS) throw new Error('GIMP brush dimensions exceed safety limits')
  const bytes = version === 3 && depth === 18 ? 2 : depth
  if ((version === 3 && depth !== 18) || (version === 2 && depth !== 1 && depth !== 4)) {
    throw new Error(`Unsupported GIMP brush pixel format ${depth}`)
  }
  const px = width * height
  if (px * bytes > buf.byteLength - headerSize) throw new Error('Truncated GIMP brush pixels')
  const nameBytes = new Uint8Array(buf, 28, headerSize - 28)
  const terminator = nameBytes.indexOf(0)
  const name = new TextDecoder().decode(nameBytes.subarray(0, terminator < 0 ? nameBytes.length : terminator)) || 'GIMP Brush'
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)
  const img = ctx.createImageData(width, height)
  const d = img.data
  const src = new Uint8Array(buf, headerSize, px * bytes)
  for (let i = 0; i < px; i++) {
    const at = i * 4
    if (depth === 4 && version === 2) {
      d[at] = src[at]; d[at + 1] = src[at + 1]; d[at + 2] = src[at + 2]; d[at + 3] = src[at + 3]
    } else {
      let alpha: number
      if (version === 3) {
        const h = v.getUint16(headerSize + i * 2, false)
        const exponent = (h >>> 10) & 31
        const fraction = h & 1023
        const value = exponent === 31 ? 0 : exponent === 0
          ? fraction * 2 ** -24
          : (1 + fraction / 1024) * 2 ** (exponent - 15)
        alpha = Math.round(Math.max(0, Math.min(1, (h & 0x8000) ? -value : value)) * 255)
      } else {
        alpha = src[i]
      }
      d[at] = 255; d[at + 1] = 255; d[at + 2] = 255; d[at + 3] = alpha
    }
  }
  ctx.putImageData(img, 0, 0)
  return { name, spacing, width, height, canvas }
}

export interface ParsedGimpPattern { name: string; width: number; height: number; canvas: HTMLCanvasElement }

/** Parse genuine GIMP .pat tiles (not Photoshop's unrelated .pat format). */
export function parseGimpPattern(buf: ArrayBuffer): ParsedGimpPattern {
  const v = new DataView(buf)
  if (buf.byteLength < 25) throw new Error('Truncated GIMP pattern')
  const headerSize = readU32BE(v, 0)
  const version = readU32BE(v, 4)
  const width = readU32BE(v, 8)
  const height = readU32BE(v, 12)
  const bpp = readU32BE(v, 16)
  const magic = String.fromCharCode(...new Uint8Array(buf, 20, 4))
  if (version !== 1 || magic !== 'GPAT') throw new Error('Not a supported GIMP .pat pattern')
  if (headerSize < 25 || headerSize > Math.min(buf.byteLength, 4096)) throw new Error('Invalid GIMP pattern header')
  if (!width || !height || width > MAX_DIM || height > MAX_DIM || width * height > MAX_PIXELS) throw new Error('GIMP pattern dimensions exceed safety limits')
  if (![1, 2, 3, 4].includes(bpp)) throw new Error('Unsupported GIMP pattern color depth')
  const count = width * height
  if (count * bpp > buf.byteLength - headerSize) throw new Error('Truncated GIMP pattern pixels')
  const nameBytes = new Uint8Array(buf, 24, headerSize - 24)
  const nul = nameBytes.indexOf(0)
  const name = new TextDecoder().decode(nameBytes.subarray(0, nul < 0 ? nameBytes.length : nul)) || 'GIMP Pattern'
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)
  const img = ctx.createImageData(width, height)
  const data = img.data
  const pixels = new Uint8Array(buf, headerSize, count * bpp)
  for (let i = 0; i < count; i++) {
    const at = i * 4, src = i * bpp
    if (bpp <= 2) {
      data[at] = pixels[src]; data[at + 1] = pixels[src]; data[at + 2] = pixels[src]
      data[at + 3] = bpp === 2 ? pixels[src + 1] : 255
    } else {
      data[at] = pixels[src]; data[at + 1] = pixels[src + 1]; data[at + 2] = pixels[src + 2]
      data[at + 3] = bpp === 4 ? pixels[src + 3] : 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return { name, width, height, canvas }
}

export interface GimpPaletteColor { name: string; hex: string }
export interface ParsedGimpPalette { name: string; columns: number; colors: GimpPaletteColor[] }

/** Parse both classic and version 2 GIMP .gpl RGB palettes. */
export function parseGimpPalette(text: string, fallbackName = 'GIMP Palette'): ParsedGimpPalette {
  if (text.length > 2_000_000) throw new Error('GIMP palette exceeds size limit')
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== 'GIMP Palette') throw new Error('Not a GIMP .gpl palette')
  let name = fallbackName, columns = 0
  const colors: GimpPaletteColor[] = []
  for (const raw of lines.slice(1)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (/^Name:\s*/i.test(line) && colors.length === 0) { name = line.replace(/^Name:\s*/i, '').trim() || fallbackName; continue }
    if (/^Columns:\s*/i.test(line) && colors.length === 0) {
      const value = line.replace(/^Columns:\s*/i, '').trim()
      if (!/^\d+$/.test(value) || Number(value) > 255) throw new Error('Invalid GIMP palette column count')
      columns = Number(value)
      continue
    }
    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)(?:\s+(.*))?$/)
    if (!match) throw new Error('Malformed GIMP palette color: ' + line.slice(0, 80))
    const nums = match.slice(1, 4).map(Number)
    if (nums.some(n => n > 255)) throw new Error('GIMP palette colors must be 0–255')
    const hex = '#' + nums.map(n => n.toString(16).padStart(2, '0')).join('')
    colors.push({ hex, name: match[4]?.trim() || hex })
    if (colors.length > 4096) throw new Error('GIMP palette has too many colors')
  }
  if (colors.length === 0) throw new Error('GIMP palette has no colors')
  return { name, columns, colors }
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

// ============================================================
// GIMP .vbr (Vector Brush) format — parametric brushes defined
// by geometric shapes (circle, square, diamond) with radius,
// hardness, aspect ratio, angle, and spacing.
// ============================================================
export interface ParsedVbrBrush {
  name: string
  shape: 'circle' | 'square' | 'diamond'
  radius: number
  hardness: number
  aspectRatio: number
  angle: number
  spacing: number
  canvas: HTMLCanvasElement
}

function readU16LE(v: DataView, off: number): number { return v.getUint16(off, true) }
function readU32LE(v: DataView, off: number): number { return v.getUint32(off, true) }
function readF32LE(v: DataView, off: number): number { return v.getFloat32(off, true) }

export function parseVbrBrush(buf: ArrayBuffer): ParsedVbrBrush {
  const v = new DataView(buf)
  if (buf.byteLength < 32) throw new Error('Truncated GIMP vector brush')
  const version = readU32LE(v, 0)
  if (version !== 2) throw new Error(`Unsupported GIMP .vbr version ${version}`)
  const shape = readU32LE(v, 4)
  const radius = readF32LE(v, 8)
  const hardness = readF32LE(v, 12)
  const aspectRatio = readF32LE(v, 16)
  const angle = readF32LE(v, 20)
  const spacing = readF32LE(v, 24)
  const nameLen = readU32LE(v, 28)
  const nameBytes = new Uint8Array(buf, 32, nameLen)
  const name = new TextDecoder().decode(nameBytes).replace(/\0.*$/, '') || 'GIMP Vector Brush'

  const shapeNames = ['circle', 'square', 'diamond'] as const
  const shapeName = shapeNames[shape] ?? 'circle'

  // Render parametric brush to canvas
  const size = Math.ceil(radius * 2 * Math.max(1, aspectRatio)) + 4
  const canvas = createCanvas(size, size)
  const ctx = ctx2d(canvas)
  const cx = size / 2, cy = size / 2

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((angle * Math.PI) / 180)
  ctx.scale(aspectRatio, 1)

  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
  grad.addColorStop(0, `rgba(255,255,255,${hardness})`)
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad

  if (shapeName === 'circle') {
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.fill()
  } else if (shapeName === 'square') {
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2)
  } else if (shapeName === 'diamond') {
    ctx.beginPath()
    ctx.moveTo(0, -radius)
    ctx.lineTo(radius, 0)
    ctx.lineTo(0, radius)
    ctx.lineTo(-radius, 0)
    ctx.closePath()
    ctx.fill()
  }

  ctx.restore()
  return { name, shape: shapeName, radius, hardness, aspectRatio, angle, spacing, canvas }
}

// ============================================================
// GIMP .gih (Image Hose / Animated Brush) format — multi-frame
// brushes with rank-based selection (pressure, random, angular,
// velocity, incremental). Each frame is a PNG.
// ============================================================
export interface GihFrame { canvas: HTMLCanvasElement; width: number; height: number }
export interface ParsedGihBrush {
  name: string
  spacing: number
  ranks: number
  selection: 'incremental' | 'random' | 'angular' | 'velocity' | 'pressure'
  frames: GihFrame[]
  defaultFrame: number
}

export async function parseGihBrush(buf: ArrayBuffer): Promise<ParsedGihBrush> {
  const v = new DataView(buf)
  if (buf.byteLength < 20) throw new Error('Truncated GIMP image hose')
  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4))
  if (magic !== 'GIMP') throw new Error('Not a GIMP .gih image hose')
  const version = readU32LE(v, 4)
  if (version !== 2 && version !== 3) throw new Error(`Unsupported GIMP .gih version ${version}`)
  const spacing = readU32LE(v, 8)
  const ranks = readU32LE(v, 12)
  const selection = readU32LE(v, 16)
  const selNames = ['incremental', 'random', 'angular', 'velocity', 'pressure'] as const
  const selectionName = selNames[selection] ?? 'incremental'

  let offset = 20
  const frames: GihFrame[] = []
  for (let r = 0; r < ranks; r++) {
    if (offset + 4 > buf.byteLength) throw new Error('Truncated GIMP .gih frame count')
    const frameCount = readU32LE(v, offset)
    offset += 4
    for (let f = 0; f < frameCount; f++) {
      if (offset + 8 > buf.byteLength) throw new Error('Truncated GIMP .gih frame header')
      const frameSize = readU32LE(v, offset)
      const frameWidth = readU32LE(v, offset + 4)
      const frameHeight = readU32LE(v, offset + 8)
      offset += 12
      const pngData = buf.slice(offset, offset + frameSize)
      offset += frameSize
      // Decode PNG to canvas
      const blob = new Blob([pngData], { type: 'image/png' })
      const bitmap = await createImageBitmap(blob)
      const canvas = createCanvas(frameWidth, frameHeight)
      const ctx = ctx2d(canvas)
      ctx.drawImage(bitmap, 0, 0)
      frames.push({ canvas, width: frameWidth, height: frameHeight })
    }
  }

  const nameBytes = new Uint8Array(buf, offset)
  const nul = nameBytes.indexOf(0)
  const name = new TextDecoder().decode(nameBytes.subarray(0, nul < 0 ? nameBytes.length : nul)) || 'GIMP Image Hose'

  return { name, spacing, ranks, selection: selectionName, frames, defaultFrame: 0 }
}

// ============================================================
// Export helpers — serialize editor assets to GIMP formats
// ============================================================

/** Export a canvas as GIMP .gbr brush (grayscale + alpha) */
export function exportGbrBrush(canvas: HTMLCanvasElement, name: string, spacing = 10): ArrayBuffer {
  const { width, height } = canvas
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, width, height)
  const headerSize = 28 + name.length + 1
  const alignedHeader = (headerSize + 3) & ~3
  const buf = new ArrayBuffer(alignedHeader + width * height * 4)
  const v = new DataView(buf)
  v.setUint32(0, alignedHeader, false)
  v.setUint32(4, 2, false)
  v.setUint32(8, width, false)
  v.setUint32(12, height, false)
  v.setUint32(16, 4, false)
  new Uint8Array(buf, 20, 4).set([0x47, 0x49, 0x4d, 0x50]) // GIMP
  v.setUint32(24, spacing, false)
  new Uint8Array(buf, 28, name.length).set(new TextEncoder().encode(name))
  // Write RGBA pixels (grayscale + alpha in single channel for mask brushes)
  const px = new Uint8Array(buf, alignedHeader)
  for (let i = 0; i < width * height; i++) {
    const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2], a = img.data[i * 4 + 3]
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    px[i * 4] = gray
    px[i * 4 + 1] = gray
    px[i * 4 + 2] = gray
    px[i * 4 + 3] = a
  }
  return buf
}

/** Export palette as GIMP .gpl */
export function exportGplPalette(colors: { name: string; hex: string }[], name = 'Palette', columns = 16): string {
  const lines = ['GIMP Palette', `Name: ${name}`, `Columns: ${columns}`, '#']
  for (const c of colors) {
    const r = parseInt(c.hex.slice(1, 3), 16)
    const g = parseInt(c.hex.slice(3, 5), 16)
    const b = parseInt(c.hex.slice(5, 7), 16)
    lines.push(`${r} ${g} ${b} ${c.name}`)
  }
  return lines.join('\n') + '\n'
}

/** Export gradient as GIMP .ggr */
export function exportGgrGradient(stops: GradientStop[], name = 'Gradient'): string {
  const lines = [`GIMP Gradient ${name}`, `Segments: ${Math.max(1, stops.length - 1)}`]
  for (let i = 0; i < stops.length - 1; i++) {
    const L = stops[i], R = stops[i + 1]
    const mid = (L.pos + R.pos) / 2
    lines.push(`${L.pos.toFixed(6)} ${mid.toFixed(6)} ${R.pos.toFixed(6)} ` +
      `${(L.r * 255).toFixed(0)} ${(L.g * 255).toFixed(0)} ${(L.b * 255).toFixed(0)} ${(L.a * 255).toFixed(0)} ` +
      `${(R.r * 255).toFixed(0)} ${(R.g * 255).toFixed(0)} ${(R.b * 255).toFixed(0)} ${(R.a * 255).toFixed(0)} ` +
      `0 0`)
  }
  return lines.join('\n') + '\n'
}
