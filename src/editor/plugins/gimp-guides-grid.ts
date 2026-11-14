'use client'
// GIMP Guides, Grid, and Snapping System
// Guide management, grid configuration, snap-to-guide/grid

import { createCanvas, ctx2d } from '../utils/canvas'

export interface Guide {
  id: string
  orientation: 'horizontal' | 'vertical'
  position: number // pixels from top/left
  color: string
  locked: boolean
  visible: boolean
  label?: string
}

export interface GridConfig {
  visible: boolean
  snapToGrid: boolean
  spacingX: number
  spacingY: number
  offsetX: number
  offsetY: number
  color: string
  opacity: number
  subdivisions: number
  style: 'lines' | 'dots' | 'crosses'
}

export interface SnapTarget {
  type: 'guide' | 'grid' | 'canvas-edge' | 'layer-edge' | 'layer-center'
  position: { x: number; y: number }
  orientation?: 'horizontal' | 'vertical'
  priority: number
}

export interface SnapResult {
  snapped: boolean
  x: number
  y: number
  target?: SnapTarget
}

export class GuideManager {
  private guides: Map<string, Guide> = new Map()
  private grid: GridConfig = {
    visible: true,
    snapToGrid: true,
    spacingX: 50,
    spacingY: 50,
    offsetX: 0,
    offsetY: 0,
    color: '#888888',
    opacity: 0.5,
    subdivisions: 4,
    style: 'lines',
  }
  private canvasSize: { width: number; height: number } = { width: 0, height: 0 }
  private snapThreshold = 8 // pixels
  private listeners: Set<() => void> = new Set()

  setCanvasSize(width: number, height: number): void {
    this.canvasSize = { width, height }
  }

  // Guide operations
  addGuide(orientation: 'horizontal' | 'vertical', position: number, options: Partial<Guide> = {}): Guide {
    const id = 'guide-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
    const guide: Guide = {
      id,
      orientation,
      position: Math.max(0, Math.min(orientation === 'horizontal' ? this.canvasSize.height : this.canvasSize.width, position)),
      color: options.color || '#00ffff',
      locked: options.locked || false,
      visible: options.visible ?? true,
      label: options.label,
    }
    this.guides.set(id, guide)
    this.notify()
    return guide
  }

  removeGuide(id: string): boolean {
    const result = this.guides.delete(id)
    if (result) this.notify()
    return result
  }

  moveGuide(id: string, newPosition: number): boolean {
    const guide = this.guides.get(id)
    if (!guide || guide.locked) return false

    const max = guide.orientation === 'horizontal' ? this.canvasSize.height : this.canvasSize.width
    guide.position = Math.max(0, Math.min(max, newPosition))
    this.notify()
    return true
  }

  setGuideVisibility(id: string, visible: boolean): boolean {
    const guide = this.guides.get(id)
    if (!guide) return false
    guide.visible = visible
    this.notify()
    return true
  }

  setGuideLock(id: string, locked: boolean): boolean {
    const guide = this.guides.get(id)
    if (!guide) return false
    guide.locked = locked
    this.notify()
    return true
  }

  getGuides(): Guide[] {
    return Array.from(this.guides.values())
  }

  getVisibleGuides(): Guide[] {
    return Array.from(this.guides.values()).filter(g => g.visible)
  }

  clearGuides(): void {
    this.guides.clear()
    this.notify()
  }

  // Grid operations
  setGrid(config: Partial<GridConfig>): void {
    this.grid = { ...this.grid, ...config }
    this.notify()
  }

  getGrid(): GridConfig {
    return { ...this.grid }
  }

  // Snap calculations
  findSnapTargets(x: number, y: number, elementBounds?: { x: number; y: number; width: number; height: number }, layers?: Array<{ id: string; x: number; y: number; width: number; height: number }>): SnapTarget[] {
    const targets: SnapTarget[] = []

    // Canvas edges
    targets.push(
      { type: 'canvas-edge', position: { x: 0, y: 0 }, priority: 10 },
      { type: 'canvas-edge', position: { x: this.canvasSize.width, y: 0 }, priority: 10 },
      { type: 'canvas-edge', position: { x: 0, y: this.canvasSize.height }, priority: 10 },
      { type: 'canvas-edge', position: { x: this.canvasSize.width, y: this.canvasSize.height }, priority: 10 },
      { type: 'canvas-edge', position: { x: this.canvasSize.width / 2, y: 0 }, priority: 5 },
      { type: 'canvas-edge', position: { x: this.canvasSize.width / 2, y: this.canvasSize.height }, priority: 5 },
      { type: 'canvas-edge', position: { x: 0, y: this.canvasSize.height / 2 }, priority: 5 },
      { type: 'canvas-edge', position: { x: this.canvasSize.width, y: this.canvasSize.height / 2 }, priority: 5 },
    )

    // Guides
    for (const guide of this.getVisibleGuides()) {
      if (guide.orientation === 'horizontal') {
        targets.push({
          type: 'guide',
          position: { x: 0, y: guide.position },
          orientation: 'horizontal',
          priority: 20,
        })
      } else {
        targets.push({
          type: 'guide',
          position: { x: guide.position, y: 0 },
          orientation: 'vertical',
          priority: 20,
        })
      }
    }

    // Grid
    if (this.grid.visible && this.grid.snapToGrid) {
      const cols = Math.ceil(this.canvasSize.width / this.grid.spacingX)
      const rows = Math.ceil(this.canvasSize.height / this.grid.spacingY)

      for (let i = 0; i <= cols; i++) {
        const x = this.grid.offsetX + i * this.grid.spacingX
        if (x >= 0 && x <= this.canvasSize.width) {
          targets.push({ type: 'grid', position: { x, y: 0 }, orientation: 'vertical', priority: 15 })
        }
      }
      for (let j = 0; j <= rows; j++) {
        const y = this.grid.offsetY + j * this.grid.spacingY
        if (y >= 0 && y <= this.canvasSize.height) {
          targets.push({ type: 'grid', position: { x: 0, y }, orientation: 'horizontal', priority: 15 })
        }
      }

      // Subdivisions
      if (this.grid.subdivisions > 1) {
        const subX = this.grid.spacingX / this.grid.subdivisions
        const subY = this.grid.spacingY / this.grid.subdivisions
        const subCols = Math.ceil(this.canvasSize.width / subX)
        const subRows = Math.ceil(this.canvasSize.height / subY)

        for (let i = 0; i <= subCols; i++) {
          const x = this.grid.offsetX + i * subX
          if (x >= 0 && x <= this.canvasSize.width) {
            targets.push({ type: 'grid', position: { x, y: 0 }, orientation: 'vertical', priority: 5 })
          }
        }
        for (let j = 0; j <= subRows; j++) {
          const y = this.grid.offsetY + j * subY
          if (y >= 0 && y <= this.canvasSize.height) {
            targets.push({ type: 'grid', position: { x: 0, y }, orientation: 'horizontal', priority: 5 })
          }
        }
      }
    }

    // Layer edges and centers
    if (layers) {
      for (const layer of layers) {
        if (!layer) continue
        targets.push(
          { type: 'layer-edge', position: { x: layer.x, y: layer.y }, priority: 25 },
          { type: 'layer-edge', position: { x: layer.x + layer.width, y: layer.y }, priority: 25 },
          { type: 'layer-edge', position: { x: layer.x, y: layer.y + layer.height }, priority: 25 },
          { type: 'layer-edge', position: { x: layer.x + layer.width, y: layer.y + layer.height }, priority: 25 },
          { type: 'layer-center', position: { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 }, priority: 30 },
        )
      }
    }

    // Element bounds (for active selection/transform)
    if (elementBounds) {
      const { x, y, width, height } = elementBounds
      targets.push(
        { type: 'layer-edge', position: { x, y }, priority: 30 },
        { type: 'layer-edge', position: { x: x + width, y }, priority: 30 },
        { type: 'layer-edge', position: { x, y: y + height }, priority: 30 },
        { type: 'layer-edge', position: { x: x + width, y: y + height }, priority: 30 },
        { type: 'layer-center', position: { x: x + width / 2, y: y + height / 2 }, priority: 35 },
      )
    }

    return targets
  }

  snapPoint(x: number, y: number, elementBounds?: { x: number; y: number; width: number; height: number }, layers?: Array<{ id: string; x: number; y: number; width: number; height: number }>): SnapResult {
    const targets = this.findSnapTargets(x, y, elementBounds, layers)
    let bestTarget: SnapTarget | null = null
    let bestDistance = this.snapThreshold
    let snappedX = x
    let snappedY = y

    for (const target of targets) {
      let dx = 0, dy = 0

      if (target.orientation === 'horizontal') {
        dy = target.position.y - y
        if (Math.abs(dy) < bestDistance) {
          bestDistance = Math.abs(dy)
          bestTarget = target
          snappedY = target.position.y
        }
      } else if (target.orientation === 'vertical') {
        dx = target.position.x - x
        if (Math.abs(dx) < bestDistance) {
          bestDistance = Math.abs(dx)
          bestTarget = target
          snappedX = target.position.x
        }
      } else {
        // Point target (canvas edge, layer center, etc.)
        dx = target.position.x - x
        dy = target.position.y - y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < bestDistance) {
          bestDistance = dist
          bestTarget = target
          snappedX = target.position.x
          snappedY = target.position.y
        }
      }
    }

    return {
      snapped: bestTarget !== null,
      x: snappedX,
      y: snappedY,
      target: bestTarget || undefined,
    }
  }

  snapBounds(bounds: { x: number; y: number; width: number; height: number }, layers?: Array<{ id: string; x: number; y: number; width: number; height: number }>): { x: number; y: number; width: number; height: number; snapped: boolean } {
    const corners = [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    ]

    let snappedX = bounds.x
    let snappedY = bounds.y
    let anySnapped = false
    let minDistX = this.snapThreshold
    let minDistY = this.snapThreshold

    for (const corner of corners) {
      const result = this.snapPoint(corner.x, corner.y, bounds, layers)
      if (result.snapped) {
        anySnapped = true
        const dx = result.x - corner.x
        const dy = result.y - corner.y
        if (Math.abs(dx) < Math.abs(minDistX)) minDistX = dx
        if (Math.abs(dy) < Math.abs(minDistY)) minDistY = dy
      }
    }

    return {
      x: bounds.x + minDistX,
      y: bounds.y + minDistY,
      width: bounds.width,
      height: bounds.height,
      snapped: anySnapped,
    }
  }

  setSnapThreshold(threshold: number): void {
    this.snapThreshold = Math.max(1, Math.min(50, threshold))
  }

  // Rendering
  renderGuidesAndGrid(ctx: CanvasRenderingContext2D): void {
    if (!this.grid.visible && this.guides.size === 0) return

    const { width, height } = this.canvasSize

    // Grid
    if (this.grid.visible) {
      ctx.save()
      ctx.strokeStyle = this.grid.color
      ctx.globalAlpha = this.grid.opacity
      ctx.lineWidth = 1

      const cols = Math.ceil(width / this.grid.spacingX)
      const rows = Math.ceil(height / this.grid.spacingY)

      // Main grid lines
      for (let i = 0; i <= cols; i++) {
        const x = this.grid.offsetX + i * this.grid.spacingX
        if (x >= 0 && x <= width) {
          if (this.grid.style === 'lines') {
            ctx.beginPath()
            ctx.moveTo(x, 0)
            ctx.lineTo(x, height)
            ctx.stroke()
          } else if (this.grid.style === 'dots') {
            for (let j = 0; j <= rows; j++) {
              const y = this.grid.offsetY + j * this.grid.spacingY
              ctx.beginPath()
              ctx.arc(x, y, 1, 0, Math.PI * 2)
              ctx.fill()
            }
          } else if (this.grid.style === 'crosses') {
            for (let j = 0; j <= rows; j++) {
              const y = this.grid.offsetY + j * this.grid.spacingY
              ctx.beginPath()
              ctx.moveTo(x - 3, y)
              ctx.lineTo(x + 3, y)
              ctx.moveTo(x, y - 3)
              ctx.lineTo(x, y + 3)
              ctx.stroke()
            }
          }
        }

      for (let j = 0; j <= rows; j++) {
        const y = this.grid.offsetY + j * this.grid.spacingY
        if (y >= 0 && y <= height) {
          if (this.grid.style === 'lines') {
            ctx.beginPath()
            ctx.moveTo(0, y)
            ctx.lineTo(width, y)
            ctx.stroke()
          }
        }
      }

      // Subdivisions
      if (this.grid.subdivisions > 1) {
        ctx.globalAlpha = this.grid.opacity * 0.5
        ctx.lineWidth = 0.5
        const subX = this.grid.spacingX / this.grid.subdivisions
        const subY = this.grid.spacingY / this.grid.subdivisions
        const subCols = Math.ceil(width / subX)
        const subRows = Math.ceil(height / subY)

        for (let i = 0; i <= subCols; i++) {
          const x = this.grid.offsetX + i * subX
          if (x >= 0 && x <= width) {
            ctx.beginPath()
            ctx.moveTo(x, 0)
            ctx.lineTo(x, height)
            ctx.stroke()
          }
        }
        for (let j = 0; j <= subRows; j++) {
          const y = this.grid.offsetY + j * subY
          if (y >= 0 && y <= height) {
            ctx.beginPath()
            ctx.moveTo(0, y)
            ctx.lineTo(width, y)
            ctx.stroke()
          }
        }
      }

      ctx.restore()
    }

    // Guides
    for (const guide of this.getVisibleGuides()) {
      ctx.save()
      ctx.strokeStyle = guide.color
      ctx.lineWidth = guide.locked ? 2 : 1
      ctx.setLineDash(guide.locked ? [] : [4, 4])
      ctx.globalAlpha = 0.8

      if (guide.orientation === 'horizontal') {
        ctx.beginPath()
        ctx.moveTo(0, guide.position)
        ctx.lineTo(width, guide.position)
        ctx.stroke()

        // Label
        if (guide.label) {
          ctx.fillStyle = guide.color
          ctx.font = '10px monospace'
          ctx.fillText(guide.label, 5, guide.position - 2)
        }
      } else {
        ctx.beginPath()
        ctx.moveTo(guide.position, 0)
        ctx.lineTo(guide.position, height)
        ctx.stroke()

        if (guide.label) {
          ctx.fillStyle = guide.color
          ctx.font = '10px monospace'
          ctx.fillText(guide.label, guide.position + 5, 12)
        }
      }

      ctx.restore()
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Create guide from canvas edge/center */
export function createGuidesFromSelection(
  manager: GuideManager,
  bounds: { x: number; y: number; width: number; height: number },
  options: { edges?: boolean; center?: boolean } = {}
): Guide[] {
  const guides: Guide[] = []

  if (options.edges !== false) {
    guides.push(
      manager.addGuide('vertical', bounds.x, { color: '#ff6600', label: 'Left' }),
      manager.addGuide('vertical', bounds.x + bounds.width, { color: '#ff6600', label: 'Right' }),
      manager.addGuide('horizontal', bounds.y, { color: '#ff6600', label: 'Top' }),
      manager.addGuide('horizontal', bounds.y + bounds.height, { color: '#ff6600', label: 'Bottom' }),
    )
  }

  if (options.center) {
    guides.push(
      manager.addGuide('vertical', bounds.x + bounds.width / 2, { color: '#00ff88', label: 'Center X', locked: true }),
      manager.addGuide('horizontal', bounds.y + bounds.height / 2, { color: '#00ff88', label: 'Center Y', locked: true }),
    )
  }

  return guides
}

/** Create guides from image content (auto-detect edges) */
export async function createGuidesFromImage(
  manager: GuideManager,
  canvas: HTMLCanvasElement,
  options: { threshold?: number; maxGuides?: number } = {}
): Promise<Guide[]> {
  const { threshold = 30, maxGuides = 10 } = options
  const ctx = ctx2d(canvas)
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data

  // Simple edge detection - find strong vertical/horizontal edges
  const verticalEdges: number[] = []
  const horizontalEdges: number[] = []

  // Scan for vertical edges
  for (let x = 1; x < width - 1; x += 2) {
    let edgeStrength = 0
    for (let y = 0; y < height; y += 4) {
      const idx = (y * width + x) * 4
      const idxL = (y * width + x - 1) * 4
      const idxR = (y * width + x + 1) * 4

      const l = 0.299 * data[idxL] + 0.587 * data[idxL + 1] + 0.114 * data[idxL + 2]
      const r = 0.299 * data[idxR] + 0.587 * data[idxR + 1] + 0.114 * data[idxR + 2]
      edgeStrength += Math.abs(l - r)
    }
    if (edgeStrength / height > threshold) {
      verticalEdges.push(x)
    }
  }

  // Scan for horizontal edges
  for (let y = 1; y < height - 1; y += 2) {
    let edgeStrength = 0
    for (let x = 0; x < width; x += 4) {
      const idx = (y * width + x) * 4
      const idxT = ((y - 1) * width + x) * 4
      const idxB = ((y + 1) * width + x) * 4

      const t = 0.299 * data[idxT] + 0.587 * data[idxT + 1] + 0.114 * data[idxT + 2]
      const b = 0.299 * data[idxB] + 0.587 * data[idxB + 1] + 0.114 * data[idxB + 2]
      edgeStrength += Math.abs(t - b)
    }
    if (edgeStrength / width > threshold) {
      horizontalEdges.push(y)
    }
  }

  // Cluster nearby edges and pick strongest
  const guides: Guide[] = []

  // Cluster vertical edges
  verticalEdges.sort((a, b) => a - b)
  const vClusters: number[][] = []
  for (const x of verticalEdges) {
    const last = vClusters[vClusters.length - 1]
    if (last && x - last[last.length - 1] < 10) {
      last.push(x)
    } else {
      vClusters.push([x])
    }
  }

  for (const cluster of vClusters.slice(0, maxGuides / 2)) {
    const avgX = cluster.reduce((a, b) => a + b, 0) / cluster.length
    guides.push(manager.addGuide('vertical', avgX, { color: '#ffaa00', label: `Edge ${Math.round(avgX)}` }))
  }

  // Cluster horizontal edges
  horizontalEdges.sort((a, b) => a - b)
  const hClusters: number[][] = []
  for (const y of horizontalEdges) {
    const last = hClusters[hClusters.length - 1]
    if (last && y - last[last.length - 1] < 10) {
      last.push(y)
    } else {
      hClusters.push([y])
    }
  }

  for (const cluster of hClusters.slice(0, maxGuides / 2)) {
    const avgY = cluster.reduce((a, b) => a + b, 0) / cluster.length
    guides.push(manager.addGuide('horizontal', avgY, { color: '#ffaa00', label: `Edge ${Math.round(avgY)}` }))
  }

  return guides
}

/** Golden ratio guides */
export function createGoldenRatioGuides(manager: GuideManager): Guide[] {
  const { width, height } = (manager as any).canvasSize || { width: 1920, height: 1080 }
  const phi = 1.618033988749895
  const guides: Guide[] = []

  // Vertical golden ratio lines
  guides.push(
    manager.addGuide('vertical', width / phi, { color: '#ffd700', label: 'φ Right', locked: true }),
    manager.addGuide('vertical', width - width / phi, { color: '#ffd700', label: 'φ Left', locked: true }),
    manager.addGuide('vertical', width / (phi * phi), { color: '#ffd700', label: 'φ² Right', locked: true }),
    manager.addGuide('vertical', width - width / (phi * phi), { color: '#ffd700', label: 'φ² Left', locked: true }),
  )

  // Horizontal golden ratio lines
  guides.push(
    manager.addGuide('horizontal', height / phi, { color: '#ffd700', label: 'φ Bottom', locked: true }),
    manager.addGuide('horizontal', height - height / phi, { color: '#ffd700', label: 'φ Top', locked: true }),
    manager.addGuide('horizontal', height / (phi * phi), { color: '#ffd700', label: 'φ² Bottom', locked: true }),
    manager.addGuide('horizontal', height - height / (phi * phi), { color: '#ffd700', label: 'φ² Top', locked: true }),
  )

  return guides
}

/** Rule of thirds guides */
export function createRuleOfThirdsGuides(manager: GuideManager): Guide[] {
  const { width, height } = (manager as any).canvasSize || { width: 1920, height: 1080 }
  const guides: Guide[] = []

  guides.push(
    manager.addGuide('vertical', width / 3, { color: '#ffff00', label: '⅓ Right', locked: true }),
    manager.addGuide('vertical', 2 * width / 3, { color: '#ffff00', label: '⅔ Right', locked: true }),
    manager.addGuide('horizontal', height / 3, { color: '#ffff00', label: '⅓ Bottom', locked: true }),
    manager.addGuide('horizontal', 2 * height / 3, { color: '#ffff00', label: '⅔ Bottom', locked: true }),
  )

  return guides
}

/** Center guides */
export function createCenterGuides(manager: GuideManager): Guide[] {
  const { width, height } = (manager as any).canvasSize || { width: 1920, height: 1080 }
  return [
    manager.addGuide('vertical', width / 2, { color: '#00ffff', label: 'Center X', locked: true }),
    manager.addGuide('horizontal', height / 2, { color: '#00ffff', label: 'Center Y', locked: true }),
  ]
}