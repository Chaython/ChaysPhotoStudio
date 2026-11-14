'use client'
// GIMPressionist - GIMP's artistic brush engine
// Simulates traditional media: oil, watercolor, charcoal, pastel, etc.

import { createCanvas, ctx2d } from '../utils/canvas'

export interface ExpressionistBrush {
  name: string
  type: 'oil' | 'watercolor' | 'charcoal' | 'pastel' | 'pencil' | 'acrylic' | 'ink' | 'airbrush' | 'marker' | 'crayon'
  settings: ExpressionistSettings
}

export interface ExpressionistSettings {
  // Geometry
  size: number
  aspectRatio: number
  angle: number
  spacing: number

  // Media simulation
  pigmentDensity: number      // How much pigment per stroke
  binderStrength: number      // How well pigment binds (oil/acrylic)
  waterContent: number        // For watercolor - wetness
  paperRoughness: number      // Surface texture interaction
  bristleCount: number        // Number of virtual bristles
  bristleLength: number
  bristleStiffness: number

  // Dynamics
  pressureOpacity: boolean
  pressureSize: boolean
  pressureFlow: boolean
  tiltAngle: boolean
  tiltWidth: boolean
  velocityOpacity: boolean
  velocitySize: boolean

  // Texture
  canvasTexture: 'none' | 'fine' | 'medium' | 'coarse' | 'canvas' | 'watercolor'
  textureDepth: number
  textureContrast: number

  // Color
  colorJitter: number         // Random color variation
  hueJitter: number
  saturationJitter: number
  brightnessJitter: number

  // Smudging/blending
  smudgeLength: number        // How far paint gets dragged
  pickupColor: boolean        // Pick up color from canvas
  wetEdges: boolean           // Wet edge effect for watercolor
  granulation: number         // Pigment granulation (watercolor)
}

export const EXPRESSIONIST_PRESETS: Record<string, ExpressionistBrush> = {
  'oil-thick': {
    name: 'Oil Paint - Thick',
    type: 'oil',
    settings: {
      size: 40, aspectRatio: 1, angle: 0, spacing: 10,
      pigmentDensity: 0.9, binderStrength: 0.8, waterContent: 0, paperRoughness: 0.3,
      bristleCount: 24, bristleLength: 0.7, bristleStiffness: 0.6,
      pressureOpacity: true, pressureSize: true, pressureFlow: true,
      tiltAngle: true, tiltWidth: true,
      velocityOpacity: false, velocitySize: false,
      canvasTexture: 'canvas', textureDepth: 0.4, textureContrast: 0.3,
      colorJitter: 0.05, hueJitter: 0.02, saturationJitter: 0.05, brightnessJitter: 0.05,
      smudgeLength: 30, pickupColor: true, wetEdges: false, granulation: 0,
    },
  },
  'oil-thin': {
    name: 'Oil Paint - Thin Glaze',
    type: 'oil',
    settings: {
      size: 30, aspectRatio: 1, angle: 0, spacing: 8,
      pigmentDensity: 0.3, binderStrength: 0.9, waterContent: 0, paperRoughness: 0.1,
      bristleCount: 12, bristleLength: 0.5, bristleStiffness: 0.4,
      pressureOpacity: true, pressureSize: false, pressureFlow: true,
      tiltAngle: true, tiltWidth: false,
      velocityOpacity: false, velocitySize: false,
      canvasTexture: 'fine', textureDepth: 0.2, textureContrast: 0.1,
      colorJitter: 0.02, hueJitter: 0.01, saturationJitter: 0.02, brightnessJitter: 0.02,
      smudgeLength: 50, pickupColor: true, wetEdges: false, granulation: 0,
    },
  },
  'watercolor-wet': {
    name: 'Watercolor - Wet on Wet',
    type: 'watercolor',
    settings: {
      size: 50, aspectRatio: 1, angle: 0, spacing: 15,
      pigmentDensity: 0.4, binderStrength: 0.1, waterContent: 0.9, paperRoughness: 0.7,
      bristleCount: 8, bristleLength: 0.9, bristleStiffness: 0.2,
      pressureOpacity: true, pressureSize: true, pressureFlow: true,
      tiltAngle: false, tiltWidth: false,
      velocityOpacity: true, velocitySize: true,
      canvasTexture: 'watercolor', textureDepth: 0.6, textureContrast: 0.4,
      colorJitter: 0.1, hueJitter: 0.05, saturationJitter: 0.1, brightnessJitter: 0.1,
      smudgeLength: 80, pickupColor: true, wetEdges: true, granulation: 0.6,
    },
  },
  'watercolor-dry': {
    name: 'Watercolor - Dry Brush',
    type: 'watercolor',
    settings: {
      size: 30, aspectRatio: 1.5, angle: 15, spacing: 25,
      pigmentDensity: 0.6, binderStrength: 0.2, waterContent: 0.2, paperRoughness: 0.8,
      bristleCount: 16, bristleLength: 0.6, bristleStiffness: 0.5,
      pressureOpacity: true, pressureSize: true, pressureFlow: false,
      tiltAngle: true, tiltWidth: true,
      velocityOpacity: false, velocitySize: false,
      canvasTexture: 'watercolor', textureDepth: 0.7, textureContrast: 0.5,
      colorJitter: 0.15, hueJitter: 0.08, saturationJitter: 0.15, brightnessJitter: 0.1,
      smudgeLength: 20, pickupColor: false, wetEdges: false, granulation: 0.8,
    },
  },
  'charcoal-soft': {
    name: 'Charcoal - Soft',
    type: 'charcoal',
    settings: {
      size: 40, aspectRatio: 1, angle: 0, spacing: 5,
      pigmentDensity: 0.8, binderStrength: 0.05, waterContent: 0, paperRoughness: 0.9,
      bristleCount: 1, bristleLength: 0.3, bristleStiffness: 0.1,
      pressureOpacity: true, pressureSize: true, pressureFlow: false,
      tiltAngle: true, tiltWidth: true,
      velocityOpacity: true, velocitySize: true,
      canvasTexture: 'coarse', textureDepth: 0.8, textureContrast: 0.6,
      colorJitter: 0.2, hueJitter: 0.01, saturationJitter: 0.05, brightnessJitter: 0.2,
      smudgeLength: 100, pickupColor: false, wetEdges: false, granulation: 0,
    },
  },
  'charcoal-hard': {
    name: 'Charcoal - Hard Compressed',
    type: 'charcoal',
    settings: {
      size: 20, aspectRatio: 1, angle: 0, spacing: 3,
      pigmentDensity: 0.95, binderStrength: 0.1, waterContent: 0, paperRoughness: 0.5,
      bristleCount: 1, bristleLength: 0.2, bristleStiffness: 0.8,
      pressureOpacity: true, pressureSize: true, pressureFlow: false,
      tiltAngle: false, tiltWidth: false,
      velocityOpacity: false, velocitySize: false,
      canvasTexture: 'medium', textureDepth: 0.4, textureContrast: 0.3,
      colorJitter: 0.05, hueJitter: 0, saturationJitter: 0.02, brightnessJitter: 0.1,
      smudgeLength: 30, pickupColor: false, wetEdges: false, granulation: 0,
    },
  },
  'pastel-oil': {
    name: 'Pastel - Oil',
    type: 'pastel',
    settings: {
      size: 35, aspectRatio: 1, angle: 0, spacing: 8,
      pigmentDensity: 0.7, binderStrength: 0.4, waterContent: 0, paperRoughness: 0.6,
      bristleCount: 1, bristleLength: 0.4, bristleStiffness: 0.3,
      pressureOpacity: true, pressureSize: true, pressureFlow: true,
      tiltAngle: true, tiltWidth: true,
      velocityOpacity: false, velocitySize: false,
      canvasTexture: 'canvas', textureDepth: 0.5, textureContrast: 0.4,
      colorJitter: 0.1, hueJitter: 0.03, saturationJitter: 0.1, brightnessJitter: 0.05,
      smudgeLength: 60, pickupColor: true, wetEdges: false, granulation: 0.2,
    },
  },
  'pastel-chalk': {
    name: 'Pastel - Chalk',
    type: 'pastel',
    settings: {
      size: 30, aspectRatio: 1.2, angle: 0, spacing: 12,
      pigmentDensity: 0.5, binderStrength: 0.1, waterContent: 0, paperRoughness: 0.8,
      bristleCount: 1, bristleLength: 0.3, bristleStiffness: 0.2,
      pressureOpacity: true, pressureSize: true, pressureFlow: false,
      tiltAngle: true, tiltWidth: true,
      velocityOpacity: true, velocitySize: true,
      canvasTexture: 'coarse', textureDepth: 0.7, textureContrast: 0.5,
      colorJitter: 0.15, hueJitter: 0.02, saturationJitter: 0.08, brightnessJitter: 0.15,
      smudgeLength: 80, pickupColor: false, wetEdges: false, granulation: 0.3,
    },
  },
  'pencil-graphite': {
    name: 'Pencil - Graphite',
    type: 'pencil',
    settings: {
      size: 10, aspectRatio: 1, angle: 45, spacing: 2,
      pigmentDensity: 0.6, binderStrength: 0.8, waterContent: 0, paperRoughness: 0.4,
      bristleCount: 1, bristleLength: 0.1, bristleStiffness: 0.9,
      pressureOpacity: true, pressureSize: true, pressureFlow: false,
      tiltAngle: true, tiltWidth: true,
      velocityOpacity: false, velocitySize: false,
      canvasTexture: 'fine', textureDepth: 0.3, textureContrast: 0.2,
      colorJitter: 0.02, hueJitter: 0, saturationJitter: 0.01, brightnessJitter: 0.05,
      smudgeLength: 40, pickupColor: false, wetEdges: false, granulation: 0,
    },
  },
  'pencil-colored': {
    name: 'Pencil - Colored',
    type: 'pencil',
    settings: {
      size: 12, aspectRatio: 1, angle: 45, spacing: 3,
      pigmentDensity: 0.5, binderStrength: 0.6, waterContent: 0, paperRoughness: 0.3,
      bristleCount: 1, bristleLength: 0.15, bristleStiffness: 0.8,
      pressureOpacity: true, pressureSize: true, pressureFlow: false,
      tiltAngle: true, tiltWidth: true,
      velocityOpacity: false, velocitySize: false,
      canvasTexture: 'fine', textureDepth: 0.2, textureContrast: 0.15,
      colorJitter: 0.03, hueJitter: 0.02, saturationJitter: 0.05, brightnessJitter: 0.03,
      smudgeLength: 30, pickupColor: false, wetEdges: false, granulation: 0,
    },
  },
  'acrylic-heavy': {
    name: 'Acrylic - Heavy Body',
    type: 'acrylic',
    settings: {
      size: 45, aspectRatio: 1, angle: 0, spacing: 12,
      pigmentDensity: 0.85, binderStrength: 0.9, waterContent: 0.1, paperRoughness: 0.4,
      bristleCount: 20, bristleLength: 0.6, bristleStiffness: 0.7,
      pressureOpacity: true, pressureSize: true, pressureFlow: true,
      tiltAngle: true, tiltWidth: true,
      velocityOpacity: false, velocitySize: false,
      canvasTexture: 'canvas', textureDepth: 0.5, textureContrast: 0.35,
      colorJitter: 0.05, hueJitter: 0.02, saturationJitter: 0.05, brightnessJitter: 0.03,
      smudgeLength: 40, pickupColor: true, wetEdges: false, granulation: 0,
    },
  },
  'acrylic-fluid': {
    name: 'Acrylic - Fluid',
    type: 'acrylic',
    settings: {
      size: 30, aspectRatio: 1, angle: 0, spacing: 8,
      pigmentDensity: 0.5, binderStrength: 0.8, waterContent: 0.3, paperRoughness: 0.2,
      bristleCount: 12, bristleLength: 0.5, bristleStiffness: 0.4,
      pressureOpacity: true, pressureSize: true, pressureFlow: true,
      tiltAngle: true, tiltWidth: false,
      velocityOpacity: true, velocitySize: true,
      canvasTexture: 'fine', textureDepth: 0.2, textureContrast: 0.15,
      colorJitter: 0.03, hueJitter: 0.01, saturationJitter: 0.03, brightnessJitter: 0.02,
      smudgeLength: 60, pickupColor: true, wetEdges: false, granulation: 0,
    },
  },
  'ink-brush': {
    name: 'Ink - Sumi Brush',
    type: 'ink',
    settings: {
      size: 25, aspectRatio: 1, angle: 0, spacing: 5,
      pigmentDensity: 0.9, binderStrength: 0.05, waterContent: 0.5, paperRoughness: 0.3,
      bristleCount: 30, bristleLength: 0.8, bristleStiffness: 0.3,
      pressureOpacity: true, pressureSize: true, pressureFlow: true,
      tiltAngle: true, tiltWidth: true,
      velocityOpacity: true, velocitySize: true,
      canvasTexture: 'watercolor', textureDepth: 0.4, textureContrast: 0.3,
      colorJitter: 0.02, hueJitter: 0, saturationJitter: 0.02, brightnessJitter: 0.05,
      smudgeLength: 50, pickupColor: false, wetEdges: true, granulation: 0,
    },
  },
  'ink-pen': {
    name: 'Ink - Technical Pen',
    type: 'ink',
    settings: {
      size: 2, aspectRatio: 1, angle: 0, spacing: 1,
      pigmentDensity: 1.0, binderStrength: 0.95, waterContent: 0, paperRoughness: 0.1,
      bristleCount: 1, bristleLength: 0.05, bristleStiffness: 1.0,
      pressureOpacity: false, pressureSize: false, pressureFlow: false,
      tiltAngle: false, tiltWidth: false,
      velocityOpacity: false, velocitySize: false,
      canvasTexture: 'none', textureDepth: 0, textureContrast: 0,
      colorJitter: 0, hueJitter: 0, saturationJitter: 0, brightnessJitter: 0,
      smudgeLength: 0, pickupColor: false, wetEdges: false, granulation: 0,
    },
  },
  'airbrush-soft': {
    name: 'Airbrush - Soft',
    type: 'airbrush',
    settings: {
      size: 60, aspectRatio: 1, angle: 0, spacing: 20,
      pigmentDensity: 0.2, binderStrength: 0.1, waterContent: 0.1, paperRoughness: 0.1,
      bristleCount: 1, bristleLength: 0.5, bristleStiffness: 0.1,
      pressureOpacity: true, pressureSize: true, pressureFlow: true,
      tiltAngle: false, tiltWidth: false,
      velocityOpacity: true, velocitySize: true,
      canvasTexture: 'none', textureDepth: 0.1, textureContrast: 0.05,
      colorJitter: 0.01, hueJitter: 0, saturationJitter: 0.01, brightnessJitter: 0.01,
      smudgeLength: 0, pickupColor: false, wetEdges: false, granulation: 0,
    },
  },
  'marker-copic': {
    name: 'Marker - Alcohol (Copic style)',
    type: 'marker',
    settings: {
      size: 15, aspectRatio: 1.5, angle: -45, spacing: 4,
      pigmentDensity: 0.7, binderStrength: 0.2, waterContent: 0.1, paperRoughness: 0.2,
      bristleCount: 1, bristleLength: 0.2, bristleStiffness: 0.6,
      pressureOpacity: true, pressureSize: true, pressureFlow: true,
      tiltAngle: true, tiltWidth: true,
      velocityOpacity: false, velocitySize: false,
      canvasTexture: 'fine', textureDepth: 0.2, textureContrast: 0.15,
      colorJitter: 0.03, hueJitter: 0.01, saturationJitter: 0.05, brightnessJitter: 0.02,
      smudgeLength: 20, pickupColor: true, wetEdges: false, granulation: 0,
    },
  },
  'crayon-wax': {
    name: 'Crayon - Wax',
    type: 'crayon',
    settings: {
      size: 20, aspectRatio: 1, angle: 0, spacing: 6,
      pigmentDensity: 0.6, binderStrength: 0.7, waterContent: 0, paperRoughness: 0.7,
      bristleCount: 1, bristleLength: 0.3, bristleStiffness: 0.5,
      pressureOpacity: true, pressureSize: true, pressureFlow: false,
      tiltAngle: true, tiltWidth: true,
      velocityOpacity: false, velocitySize: false,
      canvasTexture: 'coarse', textureDepth: 0.6, textureContrast: 0.5,
      colorJitter: 0.1, hueJitter: 0.02, saturationJitter: 0.08, brightnessJitter: 0.08,
      smudgeLength: 30, pickupColor: false, wetEdges: false, granulation: 0.1,
    },
  },
}

/** Render a stroke using GIMPressionist simulation */
export async function renderExpressionistStroke(
  canvas: HTMLCanvasElement,
  points: Array<{ x: number; y: number; pressure: number; tiltX?: number; tiltY?: number; velocity?: number }>,
  brush: ExpressionistBrush,
  color: string
): Promise<HTMLCanvasElement> {
  const settings = brush.settings
  const ctx = ctx2d(canvas)
  const output = createCanvas(canvas.width, canvas.height)
  const outCtx = ctx2d(output)
  outCtx.drawImage(canvas, 0, 0)

  if (points.length < 2) return output

  // Parse color
  const parseColor = (c: string) => {
    const canvas = createCanvas(1, 1)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
    const data = ctx.getImageData(0, 0, 1, 1).data
    return { r: data[0], g: data[1], b: data[2], a: data[3] }
  }
  const baseColor = parseColor(color)

  // Generate paper texture if needed
  let paperTexture: HTMLCanvasElement | null = null
  if (settings.canvasTexture !== 'none') {
    paperTexture = generatePaperTexture(output.width, output.height, settings.canvasTexture, settings.textureDepth, settings.textureContrast)
  }

  // Render each segment
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1]
    const p1 = points[i]

    // Interpolate pressure, tilt, velocity
    const pressure = (p0.pressure + p1.pressure) / 2
    const tiltX = (p0.tiltX ?? 0 + p1.tiltX ?? 0) / 2
    const tiltY = (p0.tiltY ?? 0 + p1.tiltY ?? 0) / 2
    const velocity = (p0.velocity ?? 1 + p1.velocity ?? 1) / 2

    // Calculate brush size at this point
    let brushSize = settings.size * pressure
    if (settings.velocitySize) brushSize *= (0.5 + velocity * 0.5)

    // Calculate opacity
    let opacity = pressure
    if (settings.velocityOpacity) opacity *= (0.5 + velocity * 0.5)

    // Color jitter
    const hueShift = (Math.random() - 0.5) * settings.hueJitter * 360
    const satMult = 1 + (Math.random() - 0.5) * settings.saturationJitter * 2
    const briMult = 1 + (Math.random() - 0.5) * settings.brightnessJitter * 2

    // Draw bristles
    const bristleCount = Math.max(1, Math.round(settings.bristleCount * pressure))
    for (let b = 0; b < bristleCount; b++) {
      // Bristle offset
      const spread = brushSize * (1 - settings.bristleStiffness) * 0.5
      const bx = (Math.random() - 0.5) * spread
      const by = (Math.random() - 0.5) * spread

      // Bristle path
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x)
      const perpAngle = angle + Math.PI / 2
      const bristleAngle = angle + (Math.random() - 0.5) * 0.2

      // Draw bristle segment
      outCtx.save()
      outCtx.translate(p1.x + bx, p1.y + by)
      outCtx.rotate(bristleAngle)
      outCtx.scale(settings.aspectRatio, 1)

      // Brush shape based on type
      const bristleWidth = brushSize / bristleCount * 2
      const bristleLength = brushSize * settings.bristleLength

      const grad = outCtx.createLinearGradient(0, 0, 0, bristleLength)
      const pigmentAlpha = opacity * settings.pigmentDensity * (b / bristleCount + 0.5)
      grad.addColorStop(0, `rgba(${baseColor.r},${baseColor.g},${baseColor.b},${pigmentAlpha})`)
      grad.addColorStop(1, `rgba(${baseColor.r},${baseColor.g},${baseColor.b},0)`)

      outCtx.fillStyle = grad
      outCtx.globalCompositeOperation = settings.pickupColor && brush.type === 'watercolor' ? 'multiply' : 'source-over'

      if (brush.type === 'watercolor' && settings.wetEdges) {
        // Wet edge effect - darker edges
        outCtx.shadowColor = `rgba(${baseColor.r * 0.5},${baseColor.g * 0.5},${baseColor.b * 0.5},${pigmentAlpha * 0.5})`
        outCtx.shadowBlur = brushSize * 0.1
        outCtx.shadowOffsetX = 0
        outCtx.shadowOffsetY = 0
      }

      // Draw bristle as rounded rectangle
      outCtx.beginPath()
      outCtx.roundRect(-bristleWidth / 2, 0, bristleWidth, bristleLength, bristleWidth / 2)
      outCtx.fill()

      outCtx.restore()
    }

    // Smudging - drag existing pixels
    if (settings.smudgeLength > 0 && i > 1) {
      const smudgeCtx = ctx2d(output)
      const smudgeDist = Math.min(settings.smudgeLength * pressure, 50)
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x)
      smudgeCtx.save()
      smudgeCtx.translate(p1.x, p1.y)
      smudgeCtx.rotate(angle)
      smudgeCtx.drawImage(output, -smudgeDist, -brushSize / 2, smudgeDist * 2, brushSize, 0, -brushSize / 2, smudgeDist, brushSize)
      smudgeCtx.restore()
    }

    // Apply paper texture
    if (paperTexture) {
      outCtx.save()
      outCtx.globalCompositeOperation = 'multiply'
      outCtx.globalAlpha = settings.textureContrast * 0.3
      outCtx.drawImage(paperTexture, 0, 0)
      outCtx.restore()
    }
  }

  return output
}

function generatePaperTexture(width: number, height: number, type: string, depth: number, contrast: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)
  const img = ctx.createImageData(width, height)
  const data = img.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      let noise = 0

      if (type === 'canvas') {
        // Woven pattern
        const wx = Math.sin(x * 0.1) * Math.cos(y * 0.1)
        const wy = Math.sin(y * 0.15) * Math.cos(x * 0.15)
        noise = (wx + wy) * 0.5
      } else if (type === 'watercolor') {
        // Granulated
        noise = (Math.random() - 0.5) * 2
        // Add larger scale variation
        noise += Math.sin(x * 0.02) * Math.cos(y * 0.02) * 0.5
      } else if (type === 'fine') {
        noise = (Math.random() - 0.5) * 0.5
      } else if (type === 'medium') {
        noise = (Math.random() - 0.5) * 1
      } else if (type === 'coarse') {
        noise = (Math.random() - 0.5) * 2
        noise += (Math.random() - 0.5) * 1 // extra grit
      }

      const val = Math.round(128 + noise * 128 * depth * contrast)
      const clamped = Math.max(0, Math.min(255, val))
      data[idx] = clamped
      data[idx + 1] = clamped
      data[idx + 2] = clamped
      data[idx + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/** Blend two canvases with media-aware blending */
export function blendMedia(
  base: HTMLCanvasElement,
  overlay: HTMLCanvasElement,
  brush: ExpressionistBrush,
  opacity: number
): HTMLCanvasElement {
  const canvas = createCanvas(base.width, base.height)
  const ctx = ctx2d(canvas)
  ctx.drawImage(base, 0, 0)
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = getMediaBlendMode(brush.type)
  ctx.drawImage(overlay, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  return canvas
}

function getMediaBlendMode(type: ExpressionistBrush['type']): GlobalCompositeOperation {
  switch (type) {
    case 'watercolor': return 'multiply'
    case 'oil': return 'overlay'
    case 'acrylic': return 'source-over'
    case 'charcoal': return 'multiply'
    case 'pastel': return 'soft-light'
    case 'pencil': return 'multiply'
    case 'ink': return 'multiply'
    case 'airbrush': return 'source-over'
    case 'marker': return 'multiply'
    case 'crayon': return 'soft-light'
    default: return 'source-over'
  }
}

/** Create a new expressionist brush from settings */
export function createExpressionistBrush(name: string, type: ExpressionistBrush['type'], settings: Partial<ExpressionistSettings>): ExpressionistBrush {
  const preset = EXPRESSIONIST_PRESETS[`${type}-default`] ?? EXPRESSIONIST_PRESETS[`oil-thick`]
  return {
    name,
    type,
    settings: { ...preset.settings, ...settings },
  }
}