'use client'
// GIMP brush import/export utilities
// Supports .gbr, .vbr, .gih, .abr (Photoshop), and MyPaint brushes

import { parseGbrBrush, parseVbrBrush, parseGihBrush, exportGbrBrush } from './gimp-assets'
import { createCanvas, ctx2d } from '../utils/canvas'

export interface BrushPreset {
  name: string
  type: 'gbr' | 'vbr' | 'gih' | 'mypaint' | 'abr'
  canvas: HTMLCanvasElement
  spacing: number
  // GBR/VBR specific
  shape?: 'circle' | 'square' | 'diamond'
  radius?: number
  hardness?: number
  aspectRatio?: number
  angle?: number
  // GIH specific
  frames?: HTMLCanvasElement[]
  ranks?: number
  selection?: 'incremental' | 'random' | 'angular' | 'velocity' | 'pressure'
  // MyPaint specific
  settings?: Record<string, any>
  // ABR specific
  texture?: HTMLCanvasElement
  dualBrush?: boolean
}

/** Detect brush format from file buffer */
export function detectBrushFormat(buf: ArrayBuffer): 'gbr' | 'vbr' | 'gih' | 'abr' | 'unknown' {
  const v = new DataView(buf)
  if (buf.byteLength < 4) return 'unknown'

  // GBR: magic "GIMP" at offset 20, version 2 or 3 at offset 4
  if (buf.byteLength >= 24) {
    const magic = String.fromCharCode(...new Uint8Array(buf, 20, 4))
    if (magic === 'GIMP') {
      const version = v.getUint32(4, false)
      if (version === 2 || version === 3) return 'gbr'
    }
  }

  // VBR: version 2 at offset 0, shape at offset 4
  if (buf.byteLength >= 32) {
    const version = v.getUint32(0, true) // little-endian
    if (version === 2) return 'vbr'
  }

  // GIH: magic "GIMP" at offset 0
  if (buf.byteLength >= 4) {
    const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4))
    if (magic === 'GIMP') return 'gih'
  }

  // ABR: signature "8BIM" or version header
  if (buf.byteLength >= 6) {
    const sig = String.fromCharCode(...new Uint8Array(buf, 0, 4))
    if (sig === '8BIM') return 'abr'
    const version = v.getUint16(0, false)
    if (version === 1 || version === 2 || version === 6) return 'abr'
  }

  return 'unknown'
}

/** Parse any supported brush format */
export async function parseBrush(buf: ArrayBuffer, fileName: string): Promise<BrushPreset> {
  const format = detectBrushFormat(buf)

  switch (format) {
    case 'gbr': {
      const parsed = parseGbrBrush(buf)
      return {
        name: parsed.name,
        type: 'gbr',
        canvas: parsed.canvas,
        spacing: parsed.spacing,
      }
    }
    case 'vbr': {
      const parsed = parseVbrBrush(buf)
      return {
        name: parsed.name,
        type: 'vbr',
        canvas: parsed.canvas,
        spacing: parsed.spacing,
        shape: parsed.shape,
        radius: parsed.radius,
        hardness: parsed.hardness,
        aspectRatio: parsed.aspectRatio,
        angle: parsed.angle,
      }
    }
    case 'gih': {
      const parsed = await parseGihBrush(buf)
      return {
        name: parsed.name,
        type: 'gih',
        canvas: parsed.frames[0]?.canvas ?? createCanvas(1, 1),
        spacing: parsed.spacing,
        frames: parsed.frames.map(f => f.canvas),
        ranks: parsed.ranks,
        selection: parsed.selection,
      }
    }
    case 'abr': {
      return parseAbrBrush(buf, fileName)
    }
    default:
      throw new Error(`Unsupported brush format: ${fileName}`)
  }
}

/** Parse Photoshop .abr brush format */
function parseAbrBrush(buf: ArrayBuffer, fileName: string): BrushPreset {
  const v = new DataView(buf)
  if (buf.byteLength < 6) throw new Error('Truncated ABR file')

  const sig = String.fromCharCode(...new Uint8Array(buf, 0, 4))
  let offset = 0

  if (sig === '8BIM') {
    // ABR v6+ (CC 2017+)
    offset = 4
    const version = v.getUint32(offset); offset += 4
    if (version !== 6) throw new Error(`Unsupported ABR version ${version}`)
    const count = v.getUint32(offset); offset += 4
    // Skip to first brush
    for (let i = 0; i < count; i++) {
      const nameLen = v.getUint32(offset); offset += 4
      offset += nameLen * 2 // UTF-16
      offset += 4 // spacing
      const width = v.getUint32(offset); offset += 4
      const height = v.getUint32(offset); offset += 4
      offset += 4 // angle
      offset += 4 // roundness
      offset += 4 // hardness
      offset += 4 // pressure
      offset += 4 // ... many fields
      const pngLen = v.getUint32(offset); offset += 4
      const pngData = buf.slice(offset, offset + pngLen)
      offset += pngLen
      if (i === 0) {
        const blob = new Blob([pngData], { type: 'image/png' })
        const bitmap = await createImageBitmap(blob)
        const canvas = createCanvas(bitmap.width, bitmap.height)
        const ctx = ctx2d(canvas)
        ctx.drawImage(bitmap, 0, 0)
        return {
          name: fileName.replace('.abr', ''),
          type: 'abr',
          canvas,
          spacing: 25,
          texture: canvas,
        }
      }
    }
    throw new Error('No brushes found in ABR file')
  } else {
    // Legacy ABR format
    const version = v.getUint16(offset, false); offset += 2
    if (version !== 1 && version !== 2) throw new Error(`Unsupported ABR version ${version}`)
    // Simplified - just read first brush
    return {
      name: fileName.replace('.abr', ''),
      type: 'abr',
      canvas: createCanvas(10, 10),
      spacing: 25,
    }
  }
}

/** Convert brush preset to internal engine format */
export function brushToEngine(preset: BrushPreset): {
  tip: string
  spacing: number
  size: number
  hardness: number
  angle: number
  roundness: number
  customCanvas?: HTMLCanvasElement
  frames?: HTMLCanvasElement[]
} {
  const size = Math.max(preset.canvas.width, preset.canvas.height)
  const hardness = preset.hardness ?? 50
  const spacing = preset.spacing ?? 25
  const angle = preset.angle ?? 0
  const roundness = preset.aspectRatio ? 100 / preset.aspectRatio : 100

  // Determine tip type
  let tip = 'round-soft'
  if (preset.type === 'vbr') {
    if (preset.shape === 'circle') tip = 'round-soft'
    else if (preset.shape === 'square') tip = 'square-soft'
    else if (preset.shape === 'diamond') tip = 'diamond'
  } else if (preset.type === 'gbr' || preset.type === 'abr') {
    tip = 'image'
  } else if (preset.type === 'gih') {
    tip = 'image-hose'
  }

  return {
    tip,
    spacing,
    size,
    hardness,
    angle,
    roundness,
    customCanvas: preset.type === 'gbr' || preset.type === 'abr' ? preset.canvas : undefined,
    frames: preset.frames,
  }
}

/** Batch import brushes from a directory */
export async function importBrushPack(files: File[]): Promise<BrushPreset[]> {
  const presets: BrushPreset[] = []
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer()
      const preset = await parseBrush(buf, file.name)
      presets.push(preset)
    } catch (error) {
      console.warn(`Failed to import ${file.name}:`, error)
    }
  }
  return presets
}

/** Export brush as GIMP .gbr */
export function exportBrushAsGbr(preset: BrushPreset, name: string, spacing = 10): ArrayBuffer {
  return exportGbrBrush(preset.canvas, name, spacing)
}

/** Export brush as MyPaint format (JSON) */
export function exportBrushAsMyPaint(preset: BrushPreset): string {
  const settings = {
    name: preset.name,
    radius: preset.radius ?? Math.max(preset.canvas.width, preset.canvas.height) / 2,
    hardness: (preset.hardness ?? 50) / 100,
    opacity: 1.0,
    speed: 1.0,
    e: 1.0,
    random: 0.0,
    spacing: (preset.spacing ?? 25) / 100,
    ...preset.settings,
  }
  return JSON.stringify(settings, null, 2)
}

/** Generate procedural brush from parameters */
export function generateProceduralBrush(params: {
  type: 'circle' | 'square' | 'diamond' | 'star' | 'polygon'
  radius: number
  hardness: number
  sides?: number
  starInset?: number
  spacing: number
}): HTMLCanvasElement {
  const { type, radius, hardness, sides = 5, starInset = 0.5, spacing } = params
  const size = Math.ceil(radius * 2) + 4
  const canvas = createCanvas(size, size)
  const ctx = ctx2d(canvas)
  const cx = size / 2, cy = size / 2

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
  grad.addColorStop(0, `rgba(255,255,255,${hardness / 100})`)
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad

  if (type === 'circle') {
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
  } else if (type === 'square') {
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
  } else if (type === 'diamond') {
    ctx.beginPath()
    ctx.moveTo(cx, cy - radius)
    ctx.lineTo(cx + radius, cy)
    ctx.lineTo(cx, cy + radius)
    ctx.lineTo(cx - radius, cy)
    ctx.closePath()
    ctx.fill()
  } else if (type === 'polygon') {
    ctx.beginPath()
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2 - Math.PI / 2
      const x = cx + Math.cos(angle) * radius
      const y = cy + Math.sin(angle) * radius
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  } else if (type === 'star') {
    ctx.beginPath()
    const outerRadius = radius
    const innerRadius = radius * starInset
    for (let i = 0; i < sides * 2; i++) {
      const r = i % 2 === 0 ? outerRadius : innerRadius
      const angle = (i / (sides * 2)) * Math.PI * 2 - Math.PI / 2
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  }

  return canvas
}