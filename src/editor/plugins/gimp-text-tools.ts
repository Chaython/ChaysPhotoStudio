'use client'
// GIMP Text Tool Enhancements
// Text along path, text on curve, text warp, glyph manipulation

import { createCanvas, ctx2d } from '../utils/canvas'

export interface TextOnPathOptions {
  text: string
  font: string
  fontSize: number
  fillColor: string
  strokeColor?: string
  strokeWidth?: number
  letterSpacing: number
  wordSpacing: number
  align: 'start' | 'center' | 'end' | 'justify'
  baseline: 'alphabetic' | 'hanging' | 'middle' | 'ideographic' | 'bottom' | 'top'
  pathOffset: number // distance from path
  pathSide: 'left' | 'right' | 'both' // which side of path
  flip: boolean
  startOffset: number // percentage along path
  lengthLimit?: number // max length to render
}

export interface GlyphInfo {
  char: string
  x: number
  y: number
  angle: number
  scale: number
  advanceWidth: number
}

export interface TextWarpOptions {
  type: 'arc' | 'arch' | 'bulge' | 'shell' | 'flag' | 'wave' | 'fish' | 'rise' | 'squeeze' | 'twist' | 'custom'
  bend: number // -100 to 100
  horizontalDistortion: number // -100 to 100
  verticalDistortion: number // -100 to 100
  orientation: 'horizontal' | 'vertical'
}

/** Render text along a path (SVG path or array of points) */
export async function renderTextOnPath(
  canvas: HTMLCanvasElement,
  path: SVGPathElement | Array<{ x: number; y: number }> | Path2D,
  options: TextOnPathOptions
): Promise<HTMLCanvasElement> {
  const ctx = ctx2d(canvas)
  const output = createCanvas(canvas.width, canvas.height)
  const outCtx = ctx2d(output)
  outCtx.drawImage(canvas, 0, 0)

  // Get path points
  let pathPoints: Array<{ x: number; y: number; angle: number }> = []

  if (path instanceof Path2D) {
    // Can't easily extract points from Path2D, approximate
    pathPoints = extractPathPoints(path)
  } else if (path instanceof SVGPathElement) {
    pathPoints = getSVGPathPoints(path)
  } else if (Array.isArray(path)) {
    pathPoints = calculatePathAngles(path)
  }

  if (pathPoints.length === 0) return output

  // Measure text
  outCtx.font = `${options.fontSize}px ${options.font}`
  const chars = options.text.split('')
  const charMetrics = chars.map(char => {
    const metrics = outCtx.measureText(char)
    return {
      char,
      width: metrics.width,
      advanceWidth: metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft,
    }
  })

  // Calculate total text width
  const totalWidth = charMetrics.reduce((sum, m) => sum + m.width, 0) + options.letterSpacing * (chars.length - 1)

  // Determine start position along path
  const pathLength = calculatePathLength(pathPoints)
  let currentDist = options.startOffset / 100 * pathLength

  // Apply length limit
  const maxDist = options.lengthLimit ? Math.min(pathLength, options.lengthLimit) : pathLength

  // Render each character
  outCtx.save()
  outCtx.font = `${options.fontSize}px ${options.font}`
  outCtx.fillStyle = options.fillColor
  outCtx.textBaseline = options.baseline

  if (options.strokeColor && options.strokeWidth) {
    outCtx.strokeStyle = options.strokeColor
    outCtx.lineWidth = options.strokeWidth
  }

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]
    const metric = charMetrics[i]

    // Find position on path
    const pos = getPointAtDistance(pathPoints, currentDist + metric.width / 2)
    if (!pos) break

    // Check if we've exceeded length limit
    if (currentDist > maxDist) break

    outCtx.save()
    outCtx.translate(pos.x, pos.y)
    outCtx.rotate(pos.angle + Math.PI / 2) // Perpendicular to path

    // Apply path side offset
    const sideOffset = options.pathSide === 'left' ? -options.pathOffset : options.pathSide === 'right' ? options.pathOffset : 0
    outCtx.translate(0, sideOffset)

    // Apply flip
    if (options.flip) {
      outCtx.scale(1, -1)
    }

    // Alignment offset
    let alignOffset = 0
    if (options.align === 'center') alignOffset = -metric.width / 2
    else if (options.align === 'end') alignOffset = -metric.width

    outCtx.fillText(char, alignOffset, 0)
    if (options.strokeColor && options.strokeWidth) {
      outCtx.strokeText(char, alignOffset, 0)
    }

    outCtx.restore()

    currentDist += metric.width + options.letterSpacing
  }

  outCtx.restore()
  return output
}

function extractPathPoints(path: Path2D): Array<{ x: number; y: number; angle: number }> {
  // Path2D doesn't expose points directly, return empty
  // In real implementation, would parse path commands
  return []
}

function getSVGPathPoints(path: SVGPathElement): Array<{ x: number; y: number; angle: number }> {
  const points: Array<{ x: number; y: number; angle: number }> = []
  const pathLength = path.getTotalLength()
  const numSamples = Math.max(100, Math.floor(pathLength / 5))

  for (let i = 0; i <= numSamples; i++) {
    const dist = (i / numSamples) * pathLength
    const point = path.getPointAtLength(dist)
    let angle = 0
    if (i < numSamples) {
      const nextPoint = path.getPointAtLength(dist + 1)
      angle = Math.atan2(nextPoint.y - point.y, nextPoint.x - point.x)
    } else if (points.length > 0) {
      const prevPoint = points[points.length - 1]
      angle = Math.atan2(point.y - prevPoint.y, point.x - prevPoint.x)
    }
    points.push({ x: point.x, y: point.y, angle })
  }
  return points
}

function calculatePathAngles(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number; angle: number }> {
  const result: Array<{ x: number; y: number; angle: number }> = []

  for (let i = 0; i < points.length; i++) {
    let angle = 0
    if (i < points.length - 1) {
      angle = Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x)
    } else if (i > 0) {
      angle = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x)
    }
    result.push({ ...points[i], angle })
  }
  return result
}

function calculatePathLength(points: Array<{ x: number; y: number }>): number {
  let length = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    length += Math.sqrt(dx * dx + dy * dy)
  }
  return length
}

function getPointAtDistance(points: Array<{ x: number; y: number; angle: number }>, distance: number): { x: number; y: number; angle: number } | null {
  if (points.length === 0) return null
  if (distance <= 0) return points[0]

  let accumulated = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const segmentLength = Math.sqrt(dx * dx + dy * dy)

    if (accumulated + segmentLength >= distance) {
      const t = (distance - accumulated) / segmentLength
      return {
        x: points[i - 1].x + dx * t,
        y: points[i - 1].y + dy * t,
        angle: points[i].angle,
      }
    }
    accumulated += segmentLength
  }

  // Beyond path length, return last point
  return points[points.length - 1]
}

/** Apply text warp transformation */
export function applyTextWarp(
  canvas: HTMLCanvasElement,
  options: TextWarpOptions
): HTMLCanvasElement {
  const ctx = ctx2d(canvas)
  const output = createCanvas(canvas.width, canvas.height)
  const outCtx = ctx2d(output)

  const { width, height } = canvas
  const cx = width / 2
  const cy = height / 2

  // Draw using pixel manipulation for warp
  const srcImg = ctx.getImageData(0, 0, width, height)
  const dstImg = outCtx.createImageData(width, height)
  const srcData = srcImg.data
  const dstData = dstImg.data

  const bend = options.bend / 100
  const hDist = options.horizontalDistortion / 100
  const vDist = options.verticalDistortion / 100

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x - cx) / cx
      const ny = (y - cy) / cy

      let sx = x
      let sy = y

      switch (options.type) {
        case 'arc':
          // Arc warp - bend horizontally
          const arcAngle = bend * Math.PI * nx
          const radius = height / (2 * Math.sin(arcAngle / 2)) || height / 2
          const cx2 = cx
          const cy2 = cy - radius * Math.cos(arcAngle / 2)
          const dx = x - cx2
          const dy = y - cy2
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > 0) {
            const angle = Math.atan2(dy, dx) + arcAngle
            sx = cx2 + dist * Math.cos(angle)
            sy = cy2 + dist * Math.sin(angle)
          }
          break

        case 'arch':
          // Arch warp - bend vertically
          const archAngle = bend * Math.PI * ny
          const archRadius = width / (2 * Math.sin(archAngle / 2)) || width / 2
          const cx3 = cx - archRadius * Math.cos(archAngle / 2)
          const cy3 = cy
          const dx2 = x - cx3
          const dy2 = y - cy3
          const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)
          if (dist2 > 0) {
            const angle2 = Math.atan2(dy2, dx2) + archAngle
            sx = cx3 + dist2 * Math.cos(angle2)
            sy = cy3 + dist2 * Math.sin(angle2)
          }
          break

        case 'bulge':
          // Bulge/pinch
          const bulgeDist = Math.sqrt(nx * nx + ny * ny)
          if (bulgeDist > 0) {
            const factor = 1 + bend * (1 - bulgeDist)
            sx = cx + nx * cx * factor
            sy = cy + ny * cy * factor
          }
          break

        case 'shell':
          // Shell lower/upper
          const shellFactor = 1 + bend * Math.sin(ny * Math.PI) * Math.cos(nx * Math.PI)
          sx = cx + nx * cx * shellFactor
          sy = cy + ny * cy * shellFactor
          break

        case 'flag':
          // Wave flag
          sx = cx + nx * cx + bend * cx * Math.sin(ny * Math.PI * 2)
          sy = cy + ny * cy + bend * cy * Math.cos(nx * Math.PI * 2)
          break

        case 'wave':
          // Sine wave
          sx = cx + nx * cx + hDist * cx * Math.sin(ny * Math.PI * 4)
          sy = cy + ny * cy + vDist * cy * Math.cos(nx * Math.PI * 4)
          break

        case 'fish':
          // Fisheye
          const fishDist = Math.sqrt(nx * nx + ny * ny)
          const fishFactor = fishDist > 0 ? Math.atan(bend * fishDist) / (fishDist * Math.atan(bend)) : 1
          sx = cx + nx * cx * fishFactor
          sy = cy + ny * cy * fishFactor
          break

        case 'rise':
          // Rise/arch
          sx = x
          sy = cy + ny * cy + bend * cy * (1 - Math.cos(nx * Math.PI))
          break

        case 'squeeze':
          // Squeeze horizontal/vertical
          sx = cx + nx * cx * (1 + hDist * ny * ny)
          sy = cy + ny * cy * (1 + vDist * nx * nx)
          break

        case 'twist':
          // Twist
          const twistAngle = bend * Math.PI * (ny + 1) / 2
          const cosT = Math.cos(twistAngle)
          const sinT = Math.sin(twistAngle)
          sx = cx + nx * cx * cosT - ny * cy * sinT
          sy = cy + nx * cx * sinT + ny * cy * cosT
          break

        default:
          sx = x
          sy = y
      }

      // Bilinear interpolation
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(x0 + 1, width - 1)
      const y1 = Math.min(y0 + 1, height - 1)
      const fx = sx - x0
      const fy = sy - y0

      if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
        const idx = (y * width + x) * 4
        const i00 = (y0 * width + x0) * 4
        const i01 = (y0 * width + x1) * 4
        const i10 = (y1 * width + x0) * 4
        const i11 = (y1 * width + x1) * 4

        for (let c = 0; c < 4; c++) {
          const v00 = srcData[i00 + c]
          const v01 = srcData[i01 + c]
          const v10 = srcData[i10 + c]
          const v11 = srcData[i11 + c]

          const v0 = v00 + (v01 - v00) * fx
          const v1 = v10 + (v11 - v10) * fx
          dstData[idx + c] = Math.round(v0 + (v1 - v0) * fy)
        }
      }
    }
  }

  outCtx.putImageData(dstImg, 0, 0)
  return output
}

/** Text on path presets (GIMP-style) */
export const TEXT_ON_PATH_PRESETS = [
  { name: 'Circle Top', path: 'circle', side: 'left', offset: 20, startOffset: 25 },
  { name: 'Circle Bottom', path: 'circle', side: 'right', offset: 20, startOffset: 25 },
  { name: 'Arc Up', path: 'arc', side: 'left', offset: 0, startOffset: 10 },
  { name: 'Arc Down', path: 'arc', side: 'right', offset: 0, startOffset: 10 },
  { name: 'Wave', path: 'wave', side: 'both', offset: 0, startOffset: 0 },
  { name: 'Spiral', path: 'spiral', side: 'left', offset: 5, startOffset: 0 },
] as const

/** Text warp presets (Photoshop/GIMP style) */
export const TEXT_WARP_PRESETS: Record<string, TextWarpOptions> = {
  'arc': { type: 'arc', bend: 50, horizontalDistortion: 0, verticalDistortion: 0, orientation: 'horizontal' },
  'arc-lower': { type: 'arc', bend: -50, horizontalDistortion: 0, verticalDistortion: 0, orientation: 'horizontal' },
  'arc-upper': { type: 'arc', bend: 50, horizontalDistortion: 0, verticalDistortion: 0, orientation: 'horizontal' },
  'arch': { type: 'arch', bend: 50, horizontalDistortion: 0, verticalDistortion: 0, orientation: 'horizontal' },
  'bulge': { type: 'bulge', bend: 50, horizontalDistortion: 0, verticalDistortion: 0, orientation: 'horizontal' },
  'shell-lower': { type: 'shell', bend: -50, horizontalDistortion: 0, verticalDistortion: 0, orientation: 'horizontal' },
  'shell-upper': { type: 'shell', bend: 50, horizontalDistortion: 0, verticalDistortion: 0, orientation: 'horizontal' },
  'flag': { type: 'flag', bend: 25, horizontalDistortion: 0, verticalDistortion: 0, orientation: 'horizontal' },
  'wave': { type: 'wave', bend: 0, horizontalDistortion: 50, verticalDistortion: 50, orientation: 'horizontal' },
  'fish': { type: 'fish', bend: 50, horizontalDistortion: 0, verticalDistortion: 0, orientation: 'horizontal' },
  'rise': { type: 'rise', bend: 50, horizontalDistortion: 0, verticalDistortion: 0, orientation: 'horizontal' },
  'squeeze': { type: 'squeeze', bend: 0, horizontalDistortion: 50, verticalDistortion: 50, orientation: 'horizontal' },
  'twist': { type: 'twist', bend: 50, horizontalDistortion: 0, verticalDistortion: 0, orientation: 'horizontal' },
}