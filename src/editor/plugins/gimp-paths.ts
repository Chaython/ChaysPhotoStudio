'use client'
// GIMP Paths/Vectors Tool
// Path creation, editing, stroke/fill, path-to-selection, import/export SVG

import { createCanvas, ctx2d } from '../utils/canvas'

export interface PathPoint {
  x: number
  y: number
  type: 'corner' | 'smooth' | 'symmetric'
  handleIn?: { x: number; y: number }
  handleOut?: { x: number; y: number }
}

export interface Path {
  id: string
  name: string
  points: PathPoint[]
  closed: boolean
  visible: boolean
  strokeColor?: string
  strokeWidth: number
  fillColor?: string
  strokeStyle?: 'solid' | 'dashed' | 'dotted'
  dashPattern?: number[]
}

export interface PathOperation {
  type: 'selection' | 'stroke' | 'fill' | 'stroke-path' | 'export'
  options: {
    // For selection
    feather?: number
    antiAlias?: boolean
    operation?: 'replace' | 'add' | 'subtract' | 'intersect'
    // For stroke
    strokeWidth?: number
    strokeColor?: string
    strokeStyle?: 'solid' | 'dashed' | 'dotted'
    dashPattern?: number[]
    lineCap?: 'butt' | 'round' | 'square'
    lineJoin?: 'miter' | 'round' | 'bevel'
    // For fill
    fillColor?: string
    fillRule?: 'nonzero' | 'evenodd'
  }
}

export class PathManager {
  private paths: Map<string, Path> = new Map()
  private activePathId: string | null = null
  private listeners: Set<() => void> = new Set()
  private canvasSize: { width: number; height: number } = { width: 0, height: 0 }

  setCanvasSize(width: number, height: number): void {
    this.canvasSize = { width, height }
  }

  createPath(name: string, points: PathPoint[] = [], closed = false): Path {
    const id = 'path-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
    const path: Path = {
      id,
      name,
      points,
      closed,
      visible: true,
      strokeWidth: 2,
    }
    this.paths.set(id, path)
    this.activePathId = id
    this.notify()
    return path
  }

  getPath(id: string): Path | undefined {
    return this.paths.get(id)
  }

  getActivePath(): Path | null {
    return this.activePathId ? this.paths.get(this.activePathId) || null : null
  }

  setActivePath(id: string): boolean {
    if (this.paths.has(id)) {
      this.activePathId = id
      this.notify()
      return true
    }
    return false
  }

  getPaths(): Path[] {
    return Array.from(this.paths.values())
  }

  deletePath(id: string): boolean {
    const result = this.paths.delete(id)
    if (this.activePathId === id) this.activePathId = null
    if (result) this.notify()
    return result
  }

  updatePath(id: string, updates: Partial<Path>): boolean {
    const path = this.paths.get(id)
    if (!path) return false
    Object.assign(path, updates)
    this.notify()
    return true
  }

  addPoint(pathId: string, point: PathPoint, index?: number): boolean {
    const path = this.paths.get(pathId)
    if (!path) return false
    if (index !== undefined && index >= 0 && index <= path.points.length) {
      path.points.splice(index, 0, point)
    } else {
      path.points.push(point)
    }
    this.notify()
    return true
  }

  removePoint(pathId: string, index: number): boolean {
    const path = this.paths.get(pathId)
    if (!path || index < 0 || index >= path.points.length) return false
    path.points.splice(index, 1)
    this.notify()
    return true
  }

  movePoint(pathId: string, index: number, x: number, y: number): boolean {
    const path = this.paths.get(pathId)
    if (!path || index < 0 || index >= path.points.length) return false
    path.points[index] = { ...path.points[index], x, y }
    this.notify()
    return true
  }

  setPointType(pathId: string, index: number, type: PathPoint['type']): boolean {
    const path = this.paths.get(pathId)
    if (!path || index < 0 || index >= path.points.length) return false
    path.points[index].type = type
    this.notify()
    return true
  }

  setHandle(pathId: string, index: number, handle: 'in' | 'out', x: number, y: number): boolean {
    const path = this.paths.get(pathId)
    if (!path || index < 0 || index >= path.points.length) return false
    if (handle === 'in') path.points[index].handleIn = { x, y }
    else path.points[index].handleOut = { x, y }
    this.notify()
    return true
  }

  toggleClosed(pathId: string): boolean {
    const path = this.paths.get(pathId)
    if (!path) return false
    path.closed = !path.closed
    this.notify()
    return true
  }

  duplicatePath(pathId: string): Path | null {
    const path = this.paths.get(pathId)
    if (!path) return null
    const newPath = this.createPath(path.name + ' copy', path.points.map(p => ({ ...p })), path.closed)
    newPath.strokeColor = path.strokeColor
    newPath.strokeWidth = path.strokeWidth
    newPath.fillColor = path.fillColor
    return newPath
  }

  // Convert path to SVG Path2D
  toPath2D(path: Path): Path2D {
    const path2d = new Path2D()
    if (path.points.length === 0) return path2d

    const p = path.points[0]
    path2d.moveTo(p.x, p.y)

    for (let i = 1; i < path.points.length; i++) {
      const prev = path.points[i - 1]
      const curr = path.points[i]

      if (prev.handleOut && curr.handleIn) {
        // Cubic Bezier
        path2d.bezierCurveTo(
          prev.handleOut.x, prev.handleOut.y,
          curr.handleIn.x, curr.handleIn.y,
          curr.x, curr.y
        )
      } else {
        // Line or quadratic
        path2d.lineTo(curr.x, curr.y)
      }
    }

    if (path.closed) {
      path2d.closePath()
    }

    return path2d
  }

  // Render path to canvas
  renderPath(ctx: CanvasRenderingContext2D, path: Path, transform?: { scale: number; offsetX: number; offsetY: number }): void {
    if (!path.visible || path.points.length === 0) return

    const s = transform?.scale || 1
    const ox = transform?.offsetX || 0
    const oy = transform?.offsetY || 0

    ctx.save()
    ctx.scale(s, s)
    ctx.translate(ox, oy)

    const path2d = this.toPath2D(path)

    if (path.fillColor) {
      ctx.fillStyle = path.fillColor
      ctx.fill(path2d, path.closed ? 'nonzero' : 'evenodd')
    }

    if (path.strokeColor) {
      ctx.strokeStyle = path.strokeColor
      ctx.lineWidth = path.strokeWidth
      if (path.strokeStyle === 'dashed' && path.dashPattern) {
        ctx.setLineDash(path.dashPattern)
      } else if (path.strokeStyle === 'dotted') {
        ctx.setLineDash([path.strokeWidth, path.strokeWidth * 2])
      }
      ctx.stroke(path2d)
    }

    // Draw control points for active path
    if (this.activePathId === path.id) {
      ctx.fillStyle = '#00ffff'
      ctx.strokeStyle = '#000000'
      ctx.lineWidth = 1 / s

      for (const point of path.points) {
        // Main point
        ctx.beginPath()
        ctx.arc(point.x, point.y, 4 / s, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()

        // Handles
        if (point.handleIn) {
          ctx.beginPath()
          ctx.moveTo(point.x, point.y)
          ctx.lineTo(point.handleIn.x, point.handleIn.y)
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(point.handleIn.x, point.handleIn.y, 3 / s, 0, Math.PI * 2)
          ctx.fill()
        }
        if (point.handleOut) {
          ctx.beginPath()
          ctx.moveTo(point.x, point.y)
          ctx.lineTo(point.handleOut.x, point.handleOut.y)
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(point.handleOut.x, point.handleOut.y, 3 / s, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    ctx.restore()
  }

  // Path operations
  async pathToSelection(path: Path, options: PathOperation['options'] = {}): Promise<ImageData | null> {
    // Create mask from path
    const canvas = createCanvas(this.canvasSize.width, this.canvasSize.height)
    const ctx = ctx2d(canvas)
    const path2d = this.toPath2D(path)

    ctx.fillStyle = '#ffffff'
    ctx.fill(path2d)

    const mask = ctx.getImageData(0, 0, this.canvasSize.width, this.canvasSize.height)

    // Apply feather if requested
    if (options.feather && options.feather > 0) {
      // Simple blur for feather
      const featherCanvas = createCanvas(this.canvasSize.width, this.canvasSize.height)
      const featherCtx = ctx2d(featherCanvas)
      featherCtx.filter = `blur(${options.feather}px)`
      featherCtx.drawImage(canvas, 0, 0)
      return featherCtx.getImageData(0, 0, this.canvasSize.width, this.canvasSize.height)
    }

    return mask
  }

  async strokePath(path: Path, options: PathOperation['options'] = {}): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(this.canvasSize.width, this.canvasSize.height)
    const ctx = ctx2d(canvas)

    ctx.strokeStyle = options.strokeColor || path.strokeColor || '#000000'
    ctx.lineWidth = options.strokeWidth || path.strokeWidth
    ctx.lineCap = options.lineCap || 'round'
    ctx.lineJoin = options.lineJoin || 'round'

    if (options.strokeStyle === 'dashed' && options.dashPattern) {
      ctx.setLineDash(options.dashPattern)
    } else if (options.strokeStyle === 'dotted') {
      ctx.setLineDash([options.strokeWidth || path.strokeWidth, (options.strokeWidth || path.strokeWidth) * 2])
    }

    const path2d = this.toPath2D(path)
    ctx.stroke(path2d)

    return canvas
  }

  async fillPath(path: Path, options: PathOperation['options'] = {}): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(this.canvasSize.width, this.canvasSize.height)
    const ctx = ctx2d(canvas)

    ctx.fillStyle = options.fillColor || path.fillColor || '#000000'
    const path2d = this.toPath2D(path)
    ctx.fill(path2d, options.fillRule || 'nonzero')

    return canvas
  }

  // Export to SVG
  exportSVG(path: Path): string {
    const path2d = this.toPath2D(path)
    // Path2D doesn't expose SVG string directly, construct manually
    let svgPath = ''
    const points = path.points

    if (points.length === 0) return ''

    svgPath += `M ${points[0].x} ${points[0].y}`

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const curr = points[i]

      if (prev.handleOut && curr.handleIn) {
        svgPath += ` C ${prev.handleOut.x} ${prev.handleOut.y} ${curr.handleIn.x} ${curr.handleIn.y} ${curr.x} ${curr.y}`
      } else {
        svgPath += ` L ${curr.x} ${curr.y}`
      }
    }

    if (path.closed) svgPath += ' Z'

    const attrs = []
    if (path.fillColor) attrs.push(`fill="${path.fillColor}"`)
    else attrs.push('fill="none"')
    if (path.strokeColor) attrs.push(`stroke="${path.strokeColor}"`)
    else attrs.push('stroke="none"')
    attrs.push(`stroke-width="${path.strokeWidth}"`)

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.canvasSize.width}" height="${this.canvasSize.height}" viewBox="0 0 ${this.canvasSize.width} ${this.canvasSize.height}">
  <path d="${svgPath}" ${attrs.join(' ')} />
</svg>`
  }

  // Import from SVG path string
  importSVG(svgPath: string, name = 'Imported Path'): Path {
    // Simple SVG path parser (subset)
    const commands = svgPath.match(/[MLHVCSQTAZmlhvcsqtaz][^MLHVCSQTAZmlhvcsqtaz]*/g) || []
    const points: PathPoint[] = []
    let currentX = 0, currentY = 0
    let startX = 0, startY = 0
    let lastControlX = 0, lastControlY = 0
    let closed = false

    for (const cmd of commands) {
      const type = cmd[0]
      const args = cmd.slice(1).trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n))

      switch (type.toUpperCase()) {
        case 'M': // Move to
          for (let i = 0; i < args.length; i += 2) {
            currentX = args[i]
            currentY = args[i + 1]
            if (points.length === 0) { startX = currentX; startY = currentY }
            points.push({ x: currentX, y: currentY, type: 'corner' })
          }
          break
        case 'L': // Line to
          for (let i = 0; i < args.length; i += 2) {
            currentX = args[i]
            currentY = args[i + 1]
            points.push({ x: currentX, y: currentY, type: 'corner' })
          }
          break
        case 'H': // Horizontal line
          for (const x of args) {
            currentX = x
            points.push({ x: currentX, y: currentY, type: 'corner' })
          }
          break
        case 'V': // Vertical line
          for (const y of args) {
            currentY = y
            points.push({ x: currentX, y: currentY, type: 'corner' })
          }
          break
        case 'C': // Cubic Bezier
          for (let i = 0; i < args.length; i += 6) {
            const c1x = args[i], c1y = args[i + 1]
            const c2x = args[i + 2], c2y = args[i + 3]
            const x = args[i + 4], y = args[i + 5]

            // Update previous point's handleOut
            if (points.length > 0) {
              points[points.length - 1].handleOut = { x: c1x, y: c1y }
            }
            // Add new point with handleIn
            points.push({
              x, y,
              type: 'smooth',
              handleIn: { x: c2x, y: c2y },
            })
            currentX = x
            currentY = y
            lastControlX = c2x
            lastControlY = c2y
          }
          break
        case 'S': // Smooth cubic Bezier
          for (let i = 0; i < args.length; i += 4) {
            const c2x = args[i], c2y = args[i + 1]
            const x = args[i + 2], y = args[i + 3]

            // First control is reflection of previous
            const prev = points[points.length - 1]
            const c1x = prev.handleOut
              ? 2 * prev.x - prev.handleOut.x
              : prev.x
            const c1y = prev.handleOut
              ? 2 * prev.y - prev.handleOut.y
              : prev.y

            if (prev) prev.handleOut = { x: c1x, y: c1y }

            points.push({
              x, y,
              type: 'smooth',
              handleIn: { x: c2x, y: c2y },
            })
            currentX = x
            currentY = y
            lastControlX = c2x
            lastControlY = c2y
          }
          break
        case 'Q': // Quadratic Bezier
          for (let i = 0; i < args.length; i += 4) {
            const cx = args[i], cy = args[i + 1]
            const x = args[i + 2], y = args[i + 3]

            if (points.length > 0) {
              points[points.length - 1].handleOut = { x: cx, y: cy }
            }
            points.push({
              x, y,
              type: 'smooth',
              handleIn: { x: cx, y: cy }, // Approximate
            })
            currentX = x
            currentY = y
          }
          break
        case 'T': // Smooth quadratic
          // Simplified - treat as corner
          for (let i = 0; i < args.length; i += 2) {
            currentX = args[i]
            currentY = args[i + 1]
            points.push({ x: currentX, y: currentY, type: 'corner' })
          }
          break
        case 'A': // Elliptical arc - approximate with points
          // Simplified: just add endpoint
          for (let i = 0; i < args.length; i += 7) {
            currentX = args[i + 5]
            currentY = args[i + 6]
            points.push({ x: currentX, y: currentY, type: 'corner' })
          }
          break
        case 'Z': // Close path
          closed = true
          break
      }
    }

    return this.createPath(name, points, closed)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Create path from selection */
export async function createPathFromSelection(
  manager: PathManager,
  mask: ImageData,
  options: { threshold?: number; simplify?: number } = {}
): Promise<Path> {
  const { threshold = 128, simplify = 1 } = options
  const { width, height } = mask

  // Find contours using marching squares (simplified)
  const points: PathPoint[] = []
  const visited = new Uint8Array(width * height)

  function getPixel(x: number, y: number): number {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0
    return mask.data[(y * width + x) * 4 + 3] // Alpha channel
  }

  // Find starting point
  let startX = -1, startY = -1
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (getPixel(x, y) >= threshold) {
        startX = x
        startY = y
        break outer
      }
    }
  }

  if (startX === -1) return manager.createPath('Empty Path')

  // Marching squares contour tracing
  let x = startX
  let y = startY
  let dir = 0 // 0=right, 1=down, 2=left, 3=up
  const dx = [1, 0, -1, 0]
  const dy = [0, 1, 0, -1]

  do {
    points.push({ x, y, type: 'corner' })
    visited[y * width + x] = 1

    // Find next boundary pixel
    let found = false
    for (let i = 0; i < 4; i++) {
      const ndir = (dir + 3 + i) % 4 // Turn left first
      const nx = x + dx[ndir]
      const ny = y + dy[ndir]
      if (getPixel(nx, ny) >= threshold) {
        x = nx
        y = ny
        dir = ndir
        found = true
        break
      }
    }
    if (!found) break
  } while (x !== startX || y !== startY)

  // Simplify using Douglas-Peucker
  const simplified = simplifyPath(points, simplify)

  return manager.createPath('Selection Path', simplified, true)
}

function simplifyPath(points: PathPoint[], tolerance: number): PathPoint[] {
  if (points.length <= 2 || tolerance <= 0) return points

  // Douglas-Peucker algorithm
  function perpendicularDistance(pt: PathPoint, lineStart: PathPoint, lineEnd: PathPoint): number {
    const dx = lineEnd.x - lineStart.x
    const dy = lineEnd.y - lineStart.y
    if (dx === 0 && dy === 0) return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y)

    const t = ((pt.x - lineStart.x) * dx + (pt.y - lineStart.y) * dy) / (dx * dx + dy * dy)
    if (t < 0) return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y)
    if (t > 1) return Math.hypot(pt.x - lineEnd.x, pt.y - lineEnd.y)

    const projX = lineStart.x + t * dx
    const projY = lineStart.y + t * dy
    return Math.hypot(pt.x - projX, pt.y - projY)
  }

  function douglasPeucker(pts: PathPoint[], start: number, end: number, tol: number): PathPoint[] {
    if (end - start <= 1) return [pts[start]]

    let maxDist = 0
    let maxIdx = start

    for (let i = start + 1; i < end; i++) {
      const dist = perpendicularDistance(pts[i], pts[start], pts[end])
      if (dist > maxDist) {
        maxDist = dist
        maxIdx = i
      }
    }

    if (maxDist > tol) {
      const left = douglasPeucker(pts, start, maxIdx, tol)
      const right = douglasPeucker(pts, maxIdx, end, tol)
      return [...left.slice(0, -1), ...right]
    }

    return [pts[start]]
  }

  const result = douglasPeucker(points, 0, points.length - 1, tolerance)
  if (points.length > 0) result.push(points[points.length - 1])
  return result
}

/** Path presets (shapes) */
export const PATH_PRESETS: Record<string, PathPoint[]> = {
  rectangle: [
    { x: 100, y: 100, type: 'corner' },
    { x: 300, y: 100, type: 'corner' },
    { x: 300, y: 200, type: 'corner' },
    { x: 100, y: 200, type: 'corner' },
  ],
  ellipse: [
    { x: 200, y: 100, type: 'smooth', handleIn: { x: 150, y: 100 }, handleOut: { x: 250, y: 100 } },
    { x: 300, y: 150, type: 'smooth', handleIn: { x: 300, y: 100 }, handleOut: { x: 300, y: 200 } },
    { x: 200, y: 200, type: 'smooth', handleIn: { x: 250, y: 200 }, handleOut: { x: 150, y: 200 } },
    { x: 100, y: 150, type: 'smooth', handleIn: { x: 100, y: 200 }, handleOut: { x: 100, y: 100 } },
  ],
  triangle: [
    { x: 200, y: 50, type: 'corner' },
    { x: 350, y: 250, type: 'corner' },
    { x: 50, y: 250, type: 'corner' },
  ],
  star: [
    { x: 200, y: 50, type: 'corner' },
    { x: 220, y: 150, type: 'corner' },
    { x: 350, y: 150, type: 'corner' },
    { x: 250, y: 200, type: 'corner' },
    { x: 280, y: 300, type: 'corner' },
    { x: 200, y: 250, type: 'corner' },
    { x: 120, y: 300, type: 'corner' },
    { x: 150, y: 200, type: 'corner' },
    { x: 50, y: 150, type: 'corner' },
    { x: 180, y: 150, type: 'corner' },
  ],
  heart: [
    { x: 200, y: 300, type: 'smooth', handleIn: { x: 150, y: 280 }, handleOut: { x: 250, y: 280 } },
    { x: 100, y: 150, type: 'smooth', handleIn: { x: 100, y: 200 }, handleOut: { x: 100, y: 100 } },
    { x: 200, y: 50, type: 'smooth', handleIn: { x: 150, y: 50 }, handleOut: { x: 250, y: 50 } },
    { x: 300, y: 150, type: 'smooth', handleIn: { x: 300, y: 100 }, handleOut: { x: 300, y: 200 } },
  ],
}