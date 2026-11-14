'use client'
// GIMP Pattern (.pat) and Gradient (.ggr) handling
// Also supports Photoshop .pat and .grd formats

import { createCanvas, ctx2d } from '../utils/canvas'
import { parseGimpPattern, parseGimpPalette, parseGgrGradient, type ParsedGimpPattern, type ParsedGimpPalette, type ParsedGgrGradient, type GradientStop } from './gimp-assets'

export interface PatternPreset {
  name: string
  canvas: HTMLCanvasElement
  width: number
  height: number
  source: 'gimp' | 'photoshop' | 'custom'
}

export interface GradientPreset {
  name: string
  stops: GradientStop[]
  source: 'gimp' | 'photoshop' | 'custom'
}

export interface PalettePreset {
  name: string
  colors: { name: string; hex: string }[]
  columns: number
  source: 'gimp' | 'photoshop' | 'custom' | 'ase' | 'aco'
}

// ============================================================
// Pattern handling
// ============================================================

/** Detect pattern format from file buffer */
export function detectPatternFormat(buf: ArrayBuffer): 'gimp' | 'photoshop' | 'unknown' {
  const data = new DataView(buf)
  if (buf.byteLength < 4) return 'unknown'

  // GIMP .pat: version 1 at offset 4, magic "GPAT" at offset 20
  if (buf.byteLength >= 24) {
    const version = data.getUint32(4, false)
    const magic = String.fromCharCode(...new Uint8Array(buf, 20, 4))
    if (version === 1 && magic === 'GPAT') return 'gimp'
  }

  // Photoshop .pat: "8BIM" signature or version 1/2
  if (buf.byteLength >= 6) {
    const sig = String.fromCharCode(...new Uint8Array(buf, 0, 4))
    if (sig === '8BIM') return 'photoshop'
    const version = data.getUint16(0, false)
    if (version === 1 || version === 2) return 'photoshop'
  }

  return 'unknown'
}

/** Parse any supported pattern format */
export async function parsePattern(buf: ArrayBuffer, fileName: string): Promise<PatternPreset> {
  const format = detectPatternFormat(buf)

  if (format === 'gimp') {
    const parsed = parseGimpPattern(buf)
    return {
      name: parsed.name,
      canvas: parsed.canvas,
      width: parsed.width,
      height: parsed.height,
      source: 'gimp',
    }
  }

  if (format === 'photoshop') {
    return parsePhotoshopPattern(buf, fileName)
  }

  throw new Error(`Unsupported pattern format: ${fileName}`)
}

/** Parse Photoshop .pat format */
async function parsePhotoshopPattern(buf: ArrayBuffer, fileName: string): Promise<PatternPreset> {
  const data = new DataView(buf)
  let offset = 0

  const sig = String.fromCharCode(...new Uint8Array(buf, 0, 4))
  if (sig === '8BIM') {
    // Photoshop 6+ .pat format
    offset = 4
    const version = data.getUint16(offset); offset += 2
    if (version !== 1 && version !== 2) throw new Error(`Unsupported Photoshop pattern version ${version}`)
    const count = data.getUint16(offset); offset += 2

    // Parse first pattern
    for (let i = 0; i < count; i++) {
      const nameLen = data.getUint16(offset); offset += 2
      const name = String.fromCharCode(...new Uint8Array(buf, offset, nameLen * 2)) // UTF-16
      offset += nameLen * 2

      // Skip pattern data for now - would need full parser
      if (i === 0) {
        // Create placeholder
        const canvas = createCanvas(64, 64)
        const ctx = ctx2d(canvas)
        ctx.fillStyle = '#888'
        ctx.fillRect(0, 0, 64, 64)
        return { name: name || fileName.replace('.pat', ''), canvas, width: 64, height: 64, source: 'photoshop' }
      }
    }
  } else {
    // Legacy Photoshop pattern
    const version = data.getUint16(offset, false); offset += 2
    if (version !== 1 && version !== 2) throw new Error(`Unsupported Photoshop pattern version ${version}`)
  }

  // Fallback
  const canvas = createCanvas(64, 64)
  const ctx = ctx2d(canvas)
  ctx.fillStyle = '#888'
  ctx.fillRect(0, 0, 64, 64)
  return { name: fileName.replace('.pat', ''), canvas, width: 64, height: 64, source: 'photoshop' }
}

/** Export pattern as GIMP .pat */
export function exportPatternAsGimpPat(preset: PatternPreset): ArrayBuffer {
  const { canvas, name } = preset
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { width, height } = canvas

  // GIMP .pat header: 4 bytes version + 4 bytes width + 4 bytes height + 4 bytes bpp + 4 bytes magic + 4 bytes name length
  const headerSize = 24 + name.length + 1
  const alignedHeader = (headerSize + 3) & ~3
  const pixelData = new Uint8Array(width * height * 4)
  const data = img.data

  // Convert to RGBA (GIMP uses 4 bytes per pixel for v1)
  for (let i = 0; i < width * height; i++) {
    pixelData[i * 4] = data[i * 4]
    pixelData[i * 4 + 1] = data[i * 4 + 1]
    pixelData[i * 4 + 2] = data[i * 4 + 2]
    pixelData[i * 4 + 3] = data[i * 4 + 3]
  }

  const buf = new ArrayBuffer(alignedHeader + pixelData.length)
  const view = new DataView(buf)
  view.setUint32(0, alignedHeader, false)
  view.setUint32(4, 1, false) // version
  view.setUint32(8, width, false)
  view.setUint32(12, height, false)
  view.setUint32(16, 4, false) // bytes per pixel (RGBA)
  new Uint8Array(buf, 20, 4).set([0x47, 0x50, 0x41, 0x54]) // GPAT
  new Uint8Array(buf, 24, name.length).set(new TextEncoder().encode(name))
  new Uint8Array(buf, alignedHeader).set(pixelData)

  return buf
}

/** Generate procedural patterns */
export function generateProceduralPattern(type: 'checker' | 'grid' | 'dots' | 'stripes' | 'noise' | 'fibers' | 'weave' | 'hexagon', params: { size: number; color1: string; color2: string; density?: number; angle?: number }): HTMLCanvasElement {
  const { size, color1, color2, density = 0.5, angle = 0 } = params
  const canvas = createCanvas(size, size)
  const ctx = ctx2d(canvas)

  const parseColor = (c: string) => {
    const canvas = createCanvas(1, 1)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
    return ctx.getImageData(0, 0, 1, 1).data
  }
  const c1 = parseColor(color1)
  const c2 = parseColor(color2)

  ctx.fillStyle = color1
  ctx.fillRect(0, 0, size, size)

  if (type === 'checker') {
    const squareSize = Math.max(1, Math.floor(size * (1 - density) * 0.5))
    for (let y = 0; y < size; y += squareSize * 2) {
      for (let x = 0; x < size; x += squareSize * 2) {
        ctx.fillStyle = color2
        ctx.fillRect(x, y, squareSize, squareSize)
        ctx.fillRect(x + squareSize, y + squareSize, squareSize, squareSize)
      }
    }
  } else if (type === 'grid') {
    const lineWidth = Math.max(1, Math.floor(size * 0.02))
    const spacing = Math.max(lineWidth * 2, Math.floor(size * density * 0.3))
    ctx.strokeStyle = color2
    ctx.lineWidth = lineWidth
    for (let x = 0; x < size; x += spacing) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, size)
      ctx.stroke()
    }
    for (let y = 0; y < size; y += spacing) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(size, y)
      ctx.stroke()
    }
  } else if (type === 'dots') {
    const radius = Math.max(1, Math.floor(size * density * 0.1))
    const spacing = radius * 3
    ctx.fillStyle = color2
    for (let y = radius; y < size; y += spacing) {
      for (let x = radius; x < size; x += spacing) {
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  } else if (type === 'stripes') {
    const stripeWidth = Math.max(1, Math.floor(size * density * 0.2))
    ctx.fillStyle = color2
    for (let x = 0; x < size; x += stripeWidth * 2) {
      ctx.fillRect(x, 0, stripeWidth, size)
    }
  } else if (type === 'noise') {
    const img = ctx.getImageData(0, 0, size, size)
    const data = img.data
    for (let i = 0; i < data.length; i += 4) {
      const noise = Math.random()
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * noise)
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * noise)
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * noise)
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  } else if (type === 'fibers') {
    // Simplified fibers
    ctx.strokeStyle = color2
    ctx.lineWidth = 1
    for (let x = 0; x < size; x++) {
      const variance = (Math.random() - 0.5) * size * 0.1
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + variance, size)
      ctx.stroke()
    }
  } else if (type === 'weave') {
    const threadSize = Math.max(1, Math.floor(size * density * 0.05))
    ctx.strokeStyle = color2
    ctx.lineWidth = threadSize
    for (let i = 0; i < size; i += threadSize * 2) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(size, i)
      ctx.stroke()
    }
  } else if (type === 'hexagon') {
    const radius = Math.max(5, Math.floor(size * density * 0.15))
    const hexHeight = radius * 2
    const hexWidth = Math.sqrt(3) * radius
    ctx.fillStyle = color2
    for (let row = 0; row < size / hexHeight + 1; row++) {
      for (let col = 0; col < size / hexWidth + 1; col++) {
        const x = col * hexWidth + (row % 2) * (hexWidth / 2)
        const y = row * hexHeight * 0.75
        ctx.beginPath()
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2 - Math.PI / 6
          const hx = x + Math.cos(angle) * radius
          const hy = y + Math.sin(angle) * radius
          if (i === 0) ctx.moveTo(hx, hy)
          else ctx.lineTo(hx, hy)
        }
        ctx.closePath()
        ctx.fill()
      }
    }
  }

  return canvas
}

// ============================================================
// Gradient handling
// ============================================================

/** Detect gradient format */
export function detectGradientFormat(buf: ArrayBuffer): 'gimp' | 'photoshop' | 'unknown' {
  if (buf.byteLength < 4) return 'unknown'
  const text = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(100, buf.byteLength)))
  if (text.startsWith('GIMP Gradient')) return 'gimp'
  // Photoshop .grd - would check for 8BIM signature
  return 'unknown'
}

/** Parse gradient from buffer */
export async function parseGradient(buf: ArrayBuffer, fileName: string): Promise<GradientPreset> {
  const format = detectGradientFormat(buf)
  if (format === 'gimp') {
    const parsed = parseGgrGradient(new TextDecoder().decode(buf))
    return { name: parsed.name, stops: parsed.stops, source: 'gimp' }
  }
  throw new Error(`Unsupported gradient format: ${fileName}`)
}

/** Export gradient as GIMP .ggr */
export function exportGradientAsGgr(preset: GradientPreset): string {
  const lines = [`GIMP Gradient ${preset.name}`, `Segments: ${Math.max(1, preset.stops.length - 1)}`]
  for (let i = 0; i < preset.stops.length - 1; i++) {
    const L = preset.stops[i]
    const R = preset.stops[i + 1]
    const mid = (L.pos + R.pos) / 2
    lines.push(`${L.pos.toFixed(6)} ${mid.toFixed(6)} ${R.pos.toFixed(6)} ` +
      `${Math.round(L.r * 255)} ${Math.round(L.g * 255)} ${Math.round(L.b * 255)} ${Math.round(L.a * 255)} ` +
      `${Math.round(R.r * 255)} ${Math.round(R.g * 255)} ${Math.round(R.b * 255)} ${Math.round(R.a * 255)} ` +
      `0 0`)
  }
  return lines.join('\n') + '\n'
}

/** Generate CSS gradient string */
export function gradientToCss(preset: GradientPreset): string {
  const stops = preset.stops.map(s =>
    `rgba(${Math.round(s.r * 255)},${Math.round(s.g * 255)},${Math.round(s.b * 255)},${s.a.toFixed(3)}) ${(s.pos * 100).toFixed(1)}%`
  ).join(', ')
  return `linear-gradient(to right, ${stops})`
}

// ============================================================
// Palette handling
// ============================================================

/** Detect palette format */
export function detectPaletteFormat(buf: ArrayBuffer): 'gimp' | 'photoshop-aco' | 'photoshop-ase' | 'json' | 'unknown' {
  if (buf.byteLength < 4) return 'unknown'

  // GIMP .gpl: text format starting with "GIMP Palette"
  const text = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(100, buf.byteLength)))
  if (text.startsWith('GIMP Palette')) return 'gimp'

  // Adobe .aco: version 1 or 2
  const data = new DataView(buf)
  const version = data.getUint16(0, false)
  if (version === 1 || version === 2) return 'photoshop-aco'

  // Adobe .ase: "ASEF" signature
  if (buf.byteLength >= 4) {
    const sig = String.fromCharCode(...new Uint8Array(buf, 0, 4))
    if (sig === 'ASEF') return 'photoshop-ase'
  }

  // JSON
  try {
    JSON.parse(text)
    return 'json'
  } catch {}

  return 'unknown'
}

/** Parse palette from buffer */
export async function parsePalette(buf: ArrayBuffer, fileName: string): Promise<PalettePreset> {
  const format = detectPaletteFormat(buf)

  if (format === 'gimp') {
    const parsed = parseGimpPalette(new TextDecoder().decode(buf))
    return { name: parsed.name, colors: parsed.colors, columns: parsed.columns, source: 'gimp' }
  }

  if (format === 'photoshop-aco') {
    return parseAcoPalette(buf, fileName)
  }

  if (format === 'photoshop-ase') {
    return parseAsePalette(buf, fileName)
  }

  if (format === 'json') {
    const json = JSON.parse(new TextDecoder().decode(buf))
    return { name: json.name || fileName.replace(/\.[^.]+$/, ''), colors: json.colors || [], columns: json.columns || 16, source: 'custom' }
  }

  throw new Error(`Unsupported palette format: ${fileName}`)
}

/** Parse Adobe .aco palette */
function parseAcoPalette(buf: ArrayBuffer, fileName: string): PalettePreset {
  const data = new DataView(buf)
  let offset = 0
  const version = data.getUint16(offset, false); offset += 2
  const count = data.getUint16(offset, false); offset += 2

  const colors: { name: string; hex: string }[] = []
  for (let i = 0; i < count; i++) {
    const colorSpace = data.getUint16(offset, false); offset += 2
    if (colorSpace === 0) { // RGB
      const r = data.getUint16(offset, false); offset += 2
      const g = data.getUint16(offset, false); offset += 2
      const b = data.getUint16(offset, false); offset += 2
      offset += 2 // padding
      const hex = '#' + [r, g, b].map(v => Math.round(v / 65535 * 255).toString(16).padStart(2, '0')).join('')
      colors.push({ name: `Color ${i + 1}`, hex })
    } else if (colorSpace === 1) { // HSB
      offset += 8 // skip
    } else if (colorSpace === 2) { // CMYK
      offset += 10 // skip
    } else if (colorSpace === 7) { // Lab
      offset += 8 // skip
    } else if (colorSpace === 8) { // Grayscale
      offset += 4 // skip
    }
  }

  return { name: fileName.replace('.aco', ''), colors, columns: 16, source: 'photoshop-aco' }
}

/** Parse Adobe .ase palette (Swatch Exchange) */
function parseAsePalette(buf: ArrayBuffer, fileName: string): PalettePreset {
  const data = new DataView(buf)
  let offset = 4 // skip "ASEF"
  const versionMajor = data.getUint16(offset, false); offset += 2
  const versionMinor = data.getUint16(offset, false); offset += 2
  const blockCount = data.getUint32(offset, false); offset += 4

  const colors: { name: string; hex: string }[] = []

  for (let i = 0; i < blockCount; i++) {
    const blockType = data.getUint16(offset, false); offset += 2
    const blockLength = data.getUint32(offset, false); offset += 4

    if (blockType === 0x0001) { // Color block
      const nameLength = data.getUint16(offset, false); offset += 2
      const nameBytes = new Uint8Array(buf, offset, nameLength * 2)
      const name = new TextDecoder('utf-16be').decode(nameBytes)
      offset += nameLength * 2

      const colorModel = String.fromCharCode(...new Uint8Array(buf, offset, 4))
      offset += 4

      if (colorModel === 'RGB ') {
        const r = data.getFloat32(offset, false); offset += 4
        const g = data.getFloat32(offset, false); offset += 4
        const b = data.getFloat32(offset, false); offset += 4
        const hex = '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
        colors.push({ name, hex })
      } else if (colorModel === 'CMYK') {
        offset += 16
      } else if (colorModel === 'LAB ') {
        offset += 12
      } else if (colorModel === 'Gray') {
        offset += 4
      }

      const colorType = data.getUint16(offset, false); offset += 2 // global/spot/normal
    } else {
      offset += blockLength - 6 // skip other block types
    }
  }

  return { name: fileName.replace('.ase', ''), colors, columns: 16, source: 'photoshop-ase' }
}

/** Export palette as GIMP .gpl */
export function exportPaletteAsGpl(preset: PalettePreset): string {
  const lines = ['GIMP Palette', `Name: ${preset.name}`, `Columns: ${preset.columns}`, '#']
  for (const c of preset.colors) {
    const r = parseInt(c.hex.slice(1, 3), 16)
    const g = parseInt(c.hex.slice(3, 5), 16)
    const b = parseInt(c.hex.slice(5, 7), 16)
    lines.push(`${r} ${g} ${b} ${c.name}`)
  }
  return lines.join('\n') + '\n'
}

/** Export palette as Adobe .aco */
export function exportPaletteAsAco(preset: PalettePreset): ArrayBuffer {
  const count = preset.colors.length
  const buf = new ArrayBuffer(4 + count * 10)
  const view = new DataView(buf)
  view.setUint16(0, 1, false) // version 1
  view.setUint16(2, count, false)

  let offset = 4
  for (const c of preset.colors) {
    view.setUint16(offset, 0, false); offset += 2 // RGB color space
    const r = parseInt(c.hex.slice(1, 3), 16)
    const g = parseInt(c.hex.slice(3, 5), 16)
    const b = parseInt(c.hex.slice(5, 7), 16)
    view.setUint16(offset, Math.round(r / 255 * 65535), false); offset += 2
    view.setUint16(offset, Math.round(g / 255 * 65535), false); offset += 2
    view.setUint16(offset, Math.round(b / 255 * 65535), false); offset += 2
    view.setUint16(offset, 0, false); offset += 2 // padding
  }
  return buf
}

/** Generate palette from image (color quantization) */
export async function generatePaletteFromImage(canvas: HTMLCanvasElement, colorCount = 16): Promise<PalettePreset> {
  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data

  // Simple color quantization using k-means (simplified)
  const colorMap = new Map<string, number>()
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
    if (a < 128) continue
    const key = `${r >> 3},${g >> 3},${b >> 3}` // Quantize to 32 levels per channel
    colorMap.set(key, (colorMap.get(key) || 0) + 1)
  }

  const sorted = Array.from(colorMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, colorCount)
  const colors = sorted.map(([key]) => {
    const [r, g, b] = key.split(',').map(v => parseInt(v) << 3)
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    return { name: '', hex }
  })

  return { name: 'Generated Palette', colors, columns: 16, source: 'custom' }
}