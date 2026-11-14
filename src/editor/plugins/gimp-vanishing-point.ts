'use client'
// GIMP Vanishing Point
// Perspective plane editing with vanishing point grid

import { createCanvas, ctx2d } from '../utils/canvas'

export interface VanishingPointPlane {
  id: string
  name: string
  points: { x: number; y: number }[] // 4 corners in image space
  gridSize: number
  gridColor: string
  gridOpacity: number
  showGrid: boolean
  showHorizon: boolean
  showVanishingPoints: boolean
  color: string
}

export interface VanishingPointState {
  planes: Map<string, VanishingPointPlane>
  activePlaneId: string | null
  tool: 'create' | 'edit' | 'move' | 'rotate' | 'scale' | 'measure' | 'stamp' | 'text' | 'brush' | 'eraser'
  brushSize: number
  brushHardness: number
  brushOpacity: number
  brushColor: string
  showGrid: boolean
  snapToGrid: boolean
  gridSize: number
}

export interface VanishingPointResult {
  planes: VanishingPointPlane[]
  transformedCanvas: HTMLCanvasElement
  perspectiveMatrix: number[] // 3x3 matrix
}

/** Vanishing Point Manager */
export class VanishingPointManager {
  private state: VanishingPointState = {
    planes: new Map(),
    activePlaneId: null,
    tool: 'create',
    brushSize: 20,
    brushHardness: 50,
    brushOpacity: 100,
    brushColor: '#000000',
    showGrid: true,
    snapToGrid: false,
    gridSize: 20,
  }
  private listeners: Set<() => void> = new Set()
  private canvasSize: { width: number; height: number } = { width: 0, height: 0 }

  setCanvasSize(width: number, height: number): void {
    this.canvasSize = { width, height }
  }

  /** Create a new vanishing point plane */
  createPlane(
    points: { x: number; y: number }[],
    options: Partial<VanishingPointPlane> = {}
  ): VanishingPointPlane {
    if (points.length !== 4) {
      throw new Error('Vanishing point plane requires exactly 4 points')
    }

    const id = 'vp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
    const plane: VanishingPointPlane = {
      id,
      name: options.name || `Plane ${this.state.planes.size + 1}`,
      points,
      gridSize: options.gridSize || 50,
      gridColor: options.gridColor || '#00ffff',
      gridOpacity: options.gridOpacity || 0.5,
      showGrid: options.showGrid !== false,
      showHorizon: options.showHorizon !== false,
      showVanishingPoints: options.showVanishingPoints !== false,
      color: options.color || '#00ffff',
    }

    this.state.planes.set(id, plane)
    this.state.activePlaneId = id
    this.notify()
    return plane
  }

  /** Create plane from 4 clicked points */
  createPlaneFromCorners(
    topLeft: { x: number; y: number },
    topRight: { x: number; y: number },
    bottomRight: { x: number; y: number },
    bottomLeft: { x: number; y: number }
  ): VanishingPointPlane {
    return this.createPlane([topLeft, topRight, bottomRight, bottomLeft])
  }

  /** Create plane from horizon line and one vanishing point */
  createPlaneFromHorizon(
    horizonY: number,
    vanishingPoint: { x: number; y: number },
    height: number
  ): VanishingPointPlane {
    const { width, height } = this.canvasSize
    const vp = vanishingPoint

    // Calculate plane corners based on horizon and vanishing point
    const topY = horizonY - height * 0.3
    const bottomY = height

    const leftX = vp.x - (vp.x / (height - horizonY)) * (height - topY)
    const rightX = vp.x + ((width - vp.x) / (height - horizonY)) * (height - topY)

    return this.createPlane([
      { x: leftX, y: topY },
      { x: rightX, y: topY },
      { x: width, y: bottomY },
      { x: 0, y: bottomY },
    ])
  }

  /** Get plane by ID */
  getPlane(id: string): VanishingPointPlane | undefined {
    return this.state.planes.get(id)
  }

  /** Get active plane */
  getActivePlane(): VanishingPointPlane | null {
    return this.state.activePlaneId ? this.state.planes.get(this.state.activePlaneId) || null : null
  }

  /** Get all planes */
  getPlanes(): VanishingPointPlane[] {
    return Array.from(this.state.planes.values())
  }

  /** Set active plane */
  setActivePlane(id: string): boolean {
    if (this.state.planes.has(id)) {
      this.state.activePlaneId = id
      this.notify()
      return true
    }
    return false
  }

  /** Delete plane */
  deletePlane(id: string): boolean {
    const result = this.state.planes.delete(id)
    if (this.state.activePlaneId === id) {
      this.state.activePlaneId = this.state.planes.keys().next().value || null
    }
    if (result) this.notify()
    return result
  }

  /** Update plane properties */
  updatePlane(id: string, updates: Partial<VanishingPointPlane>): boolean {
    const plane = this.state.planes.get(id)
    if (!plane) return false
    Object.assign(plane, updates)
    this.notify()
    return true
  }

  /** Move plane point */
  movePoint(planeId: string, pointIndex: number, x: number, y: number): boolean {
    const plane = this.state.planes.get(planeId)
    if (!plane || pointIndex < 0 || pointIndex >= 4) return false

    plane.points[pointIndex] = { x, y }
    this.notify()
    return true
  }

  /** Move entire plane */
  movePlane(planeId: string, dx: number, dy: number): boolean {
    const plane = this.state.planes.get(planeId)
    if (!plane) return false

    plane.points = plane.points.map(p => ({ x: p.x + dx, y: p.y + dy }))
    this.notify()
    return true
  }

  /** Rotate plane */
  rotatePlane(planeId: string, angle: number, centerX?: number, centerY?: number): boolean {
    const plane = this.state.planes.get(planeId)
    if (!plane) return false

    const cx = centerX ?? this.canvasSize.width / 2
    const cy = centerY ?? this.canvasSize.height / 2
    const rad = angle * Math.PI / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)

    plane.points = plane.points.map(p => {
      const dx = p.x - (centerX ?? this.canvasSize.width / 2)
      const dy = p.y - (centerY ?? this.canvasSize.height / 2)
      return {
        x: dx * Math.cos(rad) - dy * Math.sin(rad) + cx,
        y: dx * Math.sin(rad) + dy * Math.cos(rad) + cy,
      }
    })

    this.notify()
    return true
  }

  /** Scale plane */
  scalePlane(planeId: string, scaleX: number, scaleY: number, centerX?: number, centerY?: number): boolean {
    const plane = this.state.planes.get(planeId)
    if (!plane) return false

    const cx = centerX ?? this.canvasSize.width / 2
    const cy = centerY ?? this.canvasSize.height / 2

    plane.points = plane.points.map(p => ({
      x: (p.x - cx) * scaleX + cx,
      y: (p.y - cy) * scaleY + cy,
    }))

    this.notify()
    return true
  }

  /** Get perspective transform matrix for plane */
  getPerspectiveMatrix(planeId: string): number[] | null {
    const plane = this.state.planes.get(planeId)
    if (!plane) return null

    const src = plane.points
    const dst = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]

    return computePerspectiveTransform(src, dst)
  }

  /** Render plane grid on canvas */
  renderPlaneGrid(ctx: CanvasRenderingContext2D, plane: VanishingPointPlane): void {
    if (!plane.showGrid) return

    ctx.save()
    ctx.strokeStyle = plane.gridColor
    ctx.globalAlpha = plane.gridOpacity
    ctx.lineWidth = 1
    ctx.setLineDash([5, 5])

    const { points } = plane
    const [tl, tr, br, bl] = points

    // Draw grid lines
    const divisions = 10
    for (let i = 0; i <= 10; i++) {
      const t = i / 10

      // Horizontal lines
      const x1 = lerp(tl.x, tr.x, t)
      const y1 = lerp(tl.y, tr.y, t)
      const x2 = lerp(bl.x, br.x, t)
      const y2 = lerp(bl.y, br.y, t)
      drawLine(ctx, x1, y1, x2, y2)

      // Vertical lines
      const x3 = lerp(tl.x, bl.x, t)
      const y3 = lerp(tl.y, bl.y, t)
      const x4 = lerp(tr.x, br.x, t)
      const y4 = lerp(tr.y, br.y, t)
      drawLine(ctx, x3, y3, x4, y4)
    }

    // Horizon line
    if (plane.showHorizon) {
      const vp1 = findVanishingPoint(points[0], points[1], points[2], points[3])
      const vp2 = findVanishingPoint(points[1], points[0], points[3], points[2])
      if (vp1 && vp2) {
        ctx.beginPath()
        ctx.moveTo(vp1.x, vp1.y)
        ctx.lineTo(vp2.x, vp2.y)
        ctx.strokeStyle = plane.gridColor
        ctx.globalAlpha = plane.gridOpacity * 0.5
        ctx.setLineDash([10, 10])
        ctx.stroke()
      }
    }

    // Vanishing points
    if (plane.showVanishingPoints) {
      const vp1 = findVanishingPoint(points[0], points[1], points[2], points[3])
      const vp2 = findVanishingPoint(points[1], points[0], points[3], points[2])
      if (vp1) drawVanishingPoint(ctx, vp1.x, vp1.y)
      if (vp2) drawVanishingPoint(ctx, vp2.x, vp2.y)
    }

    ctx.restore()
  }

  /** Render plane boundary */
  renderPlaneBoundary(ctx: CanvasRenderingContext2D, plane: VanishingPointPlane): void {
    ctx.save()
    ctx.strokeStyle = plane.color
    ctx.lineWidth = 2
    ctx.setLineDash([10, 5])

    ctx.beginPath()
    ctx.moveTo(plane.points[0].x, plane.points[0].y)
    ctx.lineTo(plane.points[1].x, plane.points[1].y)
    ctx.lineTo(plane.points[2].x, plane.points[2].y)
    ctx.lineTo(plane.points[3].x, plane.points[3].y)
    ctx.closePath()
    ctx.stroke()
    ctx.restore()
  }

  /** Render plane handles */
  renderPlaneHandles(ctx: CanvasRenderingContext2D, plane: VanishingPointPlane, activeIndex: number = -1): void {
    ctx.save()
    ctx.fillStyle = '#00ffff'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2

    plane.points.forEach((p, i) => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, i === activeIndex ? 8 : 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    })

    ctx.restore()
  }

  /** Set active tool */
  setTool(tool: VanishingPointState['tool']): void {
    this.state.tool = tool
    this.notify()
  }

  /** Get current tool */
  getTool(): VanishingPointState['tool'] {
    return this.state.tool
  }

  /** Set brush properties */
  setBrushProperties(props: { size?: number; hardness?: number; opacity?: number; color?: string }): void {
    if (props.size !== undefined) this.state.brushSize = props.size
    if (props.hardness !== undefined) this.state.brushHardness = props.hardness
    if (props.opacity !== undefined) this.state.brushOpacity = props.opacity
    if (props.color !== undefined) this.state.brushColor = props.color
    this.notify()
  }

  /** Toggle grid visibility */
  toggleGrid(): void {
    this.state.showGrid = !this.state.showGrid
    this.notify()
  }

  /** Toggle snap to grid */
  toggleSnapToGrid(): void {
    this.state.snapToGrid = !this.state.snapToGrid
    this.notify()
  }

  /** Set grid size */
  setGridSize(size: number): void {
    this.state.gridSize = Math.max(5, Math.min(200, size))
    this.notify()
  }

  /** Export plane data */
  exportPlane(planeId: string): string | null {
    const plane = this.state.planes.get(planeId)
    if (!plane) return null
    return JSON.stringify(plane, null, 2)
  }

  /** Import plane data */
  importPlane(json: string): VanishingPointPlane | null {
    try {
      const plane = JSON.parse(json)
      this.state.planes.set(plane.id, plane)
      this.notify()
      return plane
    } catch {
      return null
    }
  }

  /** Export all planes */
  exportAllPlanes(): string {
    const planes = Array.from(this.state.planes.values())
    return JSON.stringify(planes, null, 2)
  }

  /** Import all planes */
  importAllPlanes(json: string): number {
    try {
      const planes = JSON.parse(json)
      let count = 0
      for (const plane of planes) {
        this.state.planes.set(plane.id, plane)
        count++
      }
      this.notify()
      return count
    } catch {
      return 0
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

/** Compute perspective transform matrix (3x3) from 4 point correspondences */
function computePerspectiveTransform(
  src: { x: number; y: number }[],
  dst: { x: number; y: number }[]
): number[] {
  // Solve for 3x3 homography matrix using DLT (Direct Linear Transform)
  // src points -> dst points
  const A = []
  for (let i = 0; i < 4; i++) {
    const x = src[i].x
    const y = src[i].y
    const u = dst[i].x
    const v = dst[i].y

    A.push([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
    A.push([0, 0, 0, -x, -y, -1, v * x, v * y, v])
  }

  // Solve using SVD (simplified - would use proper SVD in production)
  // For now, return identity
  return [1, 0, 0, 0, 1, 0, 0, 0, 1]
}

/** Find vanishing point from two lines */
function findVanishingPoint(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number }
): { x: number; y: number } | null {
  // Line 1: p1 -> p2
  // Line 2: p3 -> p4
  const x1 = p1.x, y1 = p1.y
  const x2 = p2.x, y2 = p2.y
  const x3 = p3.x, y3 = p3.y
  const x4 = p4.x, y4 = p4.y

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denom) < 1e-10) return null

  const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom
  const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom

  return { x: px, y: py }
}

/** Draw vanishing point marker */
function drawVanishingPoint(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save()
  ctx.fillStyle = '#ff0000'
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2

  // Crosshair
  ctx.beginPath()
  ctx.moveTo(x - 10, y)
  ctx.lineTo(x + 10, y)
  ctx.moveTo(x, y - 10)
  ctx.lineTo(x, y + 10)
  ctx.stroke()

  // Circle
  ctx.beginPath()
  ctx.arc(x, y, 5, 0, Math.PI * 2)
  ctx.fillStyle = '#ff0000'
  ctx.fill()
  ctx.stroke()

  ctx.restore()
}

/** Draw line helper */
function drawLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Vanishing Point UI Component */
export function createVanishingPointUI(
  manager: VanishingPointManager,
  onChange: () => void
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'vanishing-point-ui'
  container.innerHTML = `
    <div class="vp-panel">
      <h3>Vanishing Point</h3>
      
      <div class="vp-tools">
        <button data-tool="create" class="active" title="Create Plane">➕</button>
        <button data-tool="edit" title="Edit Plane">✏️</button>
        <button data-tool="move" title="Move Plane">🖐️</button>
        <button data-tool="rotate" title="Rotate Plane">🔄</button>
        <button data-tool="scale" title="Scale Plane">📏</button>
        <button data-tool="measure" title="Measure">📐</button>
        <button data-tool="stamp" title="Clone Stamp">🖼️</button>
        <button data-tool="text" title="Add Text">📝</button>
        <button data-tool="brush" title="Brush">🖌️</button>
        <button data-tool="eraser" title="Eraser">🧽</button>
      </div>

      <div class="plane-list" id="plane-list"></div>

      <div class="plane-properties" id="plane-properties" style="display:none">
        <h4>Plane Properties</h4>
        <div class="prop-row">
          <label>Name: <input type="text" id="plane-name" placeholder="Plane name"></label>
        </div>
        <div class="prop-row">
          <label>Grid Size: <input type="range" id="grid-size" min="10" max="200" step="5" value="50"></label>
          <span id="grid-size-value">50</span>
        </div>
        <div class="prop-row">
          <label>Grid Color: <input type="color" id="grid-color" value="#00ffff"></label>
        </div>
        <div class="prop-row">
          <label>Grid Opacity: <input type="range" id="grid-opacity" min="0" max="100" step="5" value="50"></label>
          <span id="grid-opacity-value">50%</span>
        </div>
        <div class="prop-row">
          <label>Plane Color: <input type="color" id="plane-color" value="#00ffff"></label>
        </div>
        <div class="prop-row checkboxes">
          <label><input type="checkbox" id="show-grid" checked> Show Grid</label>
          <label><input type="checkbox" id="show-horizon" checked> Show Horizon</label>
          <label><input type="checkbox" id="show-vps" checked> Show Vanishing Points</label>
        </div>
        <div class="prop-row">
          <label>Snap to Grid: <input type="checkbox" id="snap-grid"></label>
        </div>
        <div class="prop-row">
          <label>Grid Size: <input type="range" id="vp-grid-size" min="5" max="100" step="5" value="20"></label>
          <span id="vp-grid-size-value">20px</span>
        </div>
      </div>

      <div class="plane-actions">
        <button id="duplicate-plane" title="Duplicate Plane">📋 Duplicate</button>
        <button id="delete-plane" class="danger" title="Delete Plane">🗑️ Delete</button>
        <button id="export-plane" title="Export Plane">💾 Export</button>
        <input type="file" id="import-plane-file" accept=".json" style="display:none">
        <button id="import-plane" title="Import Plane">📁 Import</button>
      </div>

      <div class="perspective-tools">
        <h4>Perspective Tools</h4>
        <div class="tool-row">
          <button id="tool-warp" title="Perspective Warp">⤡ Warp</button>
          <button id="tool-perspective" title="Perspective Transform">⤢ Transform</button>
          <button id="tool-measure" title="Measure in Perspective">📏 Measure</button>
        </div>
      </div>

      <div class="brush-settings" id="brush-settings" style="display:none">
        <h4>Brush Settings</h4>
        <div class="prop-row">
          <label>Size: <input type="range" id="brush-size" min="1" max="500" value="20"></label>
          <span id="brush-size-value">20</span>
        </div>
        <div class="prop-row">
          <label>Hardness: <input type="range" id="brush-hardness" min="0" max="100" value="50"></label>
          <span id="brush-hardness-value">50%</span>
        </div>
        <div class="prop-row">
          <label>Opacity: <input type="range" min="0" max="100" id="brush-opacity" value="100"></label>
          <span id="brush-opacity-value">100%</span>
        </div>
        <div class="prop-row">
          <label>Color: <input type="color" id="brush-color" value="#000000"></label>
        </div>
      </div>
    </div>
  `

  // Populate plane list
  const planeList = container.querySelector('#plane-list')!
  const propertiesPanel = container.querySelector('#plane-properties')!
  const planes = manager.getPlanes()

  function renderPlaneList(): void {
    const planes = manager.getPlanes()
    const activeId = manager.getActivePlane()?.id

    const listHtml = planes.map(plane => `
      <div class="plane-item ${plane.id === activeId ? 'active' : ''}" data-id="${plane.id}">
        <div class="plane-info">
          <span class="plane-color" style="background: ${plane.color}"></span>
          <span class="plane-name">${plane.name}</span>
          <span class="plane-points">${plane.points.length} pts</span>
        </div>
        <div class="plane-actions">
          <button class="btn-icon" data-action="edit" title="Edit">✏️</button>
          <button class="btn-icon" data-action="duplicate" title="Duplicate">📋</button>
          <button class="btn-icon" data-action="delete" title="Delete">🗑️</button>
        </div>
      </div>
    `).join('')

    planeList.innerHTML = listHtml || '<p class="no-planes">No planes. Click "Create Plane" to start.</p>'
  }

  renderPlaneList()

  // Plane list click handler
  planeList.addEventListener('click', (e) => {
    const item = e.target.closest('.plane-item')
    if (!item) return

    const planeId = item.dataset.id
    if (!planeId) return

    const action = (e.target as HTMLElement).dataset.action
    if (action === 'edit') {
      manager.setActivePlane(planeId)
      showPlaneProperties(planeId)
    } else if (action === 'duplicate') {
      duplicatePlane(planeId)
    } else if (action === 'delete') {
      if (confirm('Delete this plane?')) {
        manager.deletePlane(planeId)
        renderPlaneList()
      }
    } else {
      manager.setActivePlane(planeId)
      showPlaneProperties(planeId)
    }

    renderPlaneList()
  })

  function showPlaneProperties(planeId: string): void {
    const plane = manager.getPlane(planeId)
    if (!plane) return

    propertiesPanel.style.display = 'block'
    const props = container.querySelector('#plane-properties')

    ;(props.querySelector('#plane-name') as HTMLInputElement).value = plane.name
    ;(props.querySelector('#grid-size') as HTMLInputElement).value = String(plane.gridSize)
    ;(props.querySelector('#grid-size-value') as HTMLSpanElement).textContent = plane.gridSize
    ;(props.querySelector('#grid-color') as HTMLInputElement).value = plane.gridColor
    ;(props.querySelector('#grid-opacity') as HTMLInputElement).value = String(plane.gridOpacity)
    ;(props.querySelector('#grid-opacity-value') as HTMLSpanElement).textContent = plane.gridOpacity + '%'
    ;(props.querySelector('#plane-color') as HTMLInputElement).value = plane.color
    ;(props.querySelector('#show-grid') as HTMLInputElement).checked = plane.showGrid
    ;(props.querySelector('#show-horizon') as HTMLInputElement).checked = plane.showHorizon
    ;(props.querySelector('#show-vps') as HTMLInputElement).checked = plane.showVanishingPoints
    ;(props.querySelector('#snap-grid') as HTMLInputElement).checked = manager.getTool() === 'move' // placeholder
    ;(props.querySelector('#vp-grid-size') as HTMLInputElement).value = String(manager.getTool()) // placeholder
    ;(props.querySelector('#vp-grid-size-value') as HTMLSpanElement).textContent = manager.getTool() + 'px' // placeholder

    // Update input handlers
    setupPropertyInputs(plane)
  }

  function setupPropertyInputs(plane: VanishingPointPlane): void {
    const props = container.querySelector('#plane-properties')

    ;(props.querySelector('#plane-name') as HTMLInputElement).oninput = (e) => {
      manager.updatePlane(plane.id, { name: (e.target as HTMLInputElement).value })
    }
    ;(props.querySelector('#grid-size') as HTMLInputElement).oninput = (e) => {
      const val = parseInt((e.target as HTMLInputElement).value)
      manager.updatePlane(plane.id, { gridSize: val })
      ;(props.querySelector('#grid-size-value') as HTMLSpanElement).textContent = val
    }
    ;(props.querySelector('#grid-color') as HTMLInputElement).oninput = (e) => {
      manager.updatePlane(plane.id, { gridColor: (e.target as HTMLInputElement).value })
    }
    ;(props.querySelector('#grid-opacity') as HTMLInputElement).oninput = (e) => {
      const val = parseInt((e.target as HTMLInputElement).value)
      manager.updatePlane(plane.id, { gridOpacity: val })
      ;(props.querySelector('#grid-opacity-value') as HTMLSpanElement).textContent = val + '%'
    }
    ;(props.querySelector('#plane-color') as HTMLInputElement).oninput = (e) => {
      manager.updatePlane(plane.id, { color: (e.target as HTMLInputElement).value })
    }
    ;(props.querySelector('#show-grid') as HTMLInputElement).onchange = (e) => {
      manager.updatePlane(plane.id, { showGrid: (e.target as HTMLInputElement).checked })
    }
    ;(props.querySelector('#show-horizon') as HTMLInputElement).onchange = (e) => {
      manager.updatePlane(plane.id, { showHorizon: (e.target as HTMLInputElement).checked })
    }
    ;(props.querySelector('#show-vps') as HTMLInputElement).onchange = (e) => {
      manager.updatePlane(plane.id, { showVanishingPoints: (e.target as HTMLInputElement).checked })
    }
    ;(props.querySelector('#snap-grid') as HTMLInputElement).onchange = (e) => {
      // Would toggle snap to grid
    }
    ;(props.querySelector('#vp-grid-size') as HTMLInputElement).oninput = (e) => {
      const val = parseInt((e.target as HTMLInputElement).value)
      ;(props.querySelector('#vp-grid-size-value') as HTMLSpanElement).textContent = val + 'px'
    }
  }

  function duplicatePlane(planeId: string): void {
    const plane = manager.getPlane(planeId)
    if (!plane) return

    const newPlane = manager.createPlane(plane.points.map(p => ({ ...p })), {
      name: plane.name + ' copy',
      gridSize: plane.gridSize,
      gridColor: plane.gridColor,
      gridOpacity: plane.gridOpacity,
      showGrid: plane.showGrid,
      showHorizon: plane.showHorizon,
      showVanishingPoints: plane.showVanishingPoints,
      color: plane.color,
    })
    renderPlaneList()
    manager.setActivePlane(newPlane.id)
    showPlaneProperties(newPlane.id)
  }

  // Tool buttons
  container.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      manager.setTool(btn.dataset.tool as any)
    })
  }

  // Plane actions
  container.querySelector('#duplicate-plane')?.addEventListener('click', () => {
    const activeId = manager.getActivePlane()?.id
    if (activeId) duplicatePlane(activeId)
  })

  container.querySelector('#delete-plane')?.addEventListener('click', () => {
    const activeId = manager.getActivePlane()?.id
    if (activeId && confirm('Delete this plane?')) {
      manager.deletePlane(activeId)
      renderPlaneList()
      propertiesPanel.style.display = 'none'
    }
  })

  container.querySelector('#export-plane')?.addEventListener('click', () => {
    const activeId = manager.getActivePlane()?.id
    if (activeId) {
      const json = manager.exportPlane(activeId)
      if (json) {
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `vanishing-point-${Date.now()}.json`
        a.click()
        URL.revokeObjectURL(url)
      }
    }
  })

  container.querySelector('#import-plane')?.addEventListener('click', () => {
    const input = container.querySelector('#import-plane-file') as HTMLInputElement
    input.click()
  })

  const importInput = container.querySelector('#import-plane-file') as HTMLInputElement
  importInput.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const count = manager.importAllPlanes(e.target.result)
        alert(`Imported ${count} plane(s)`)
        renderPlaneList()
      }
      reader.readAsText(file)
    }
  })

  // Perspective tools
  container.querySelector('#tool-warp')?.addEventListener('click', () => {
    alert('Perspective Warp tool - would warp content to match plane perspective')
  })

  container.querySelector('#tool-perspective')?.addEventListener('click', () => {
    alert('Perspective Transform tool - would transform selection to match plane')
  })

  container.querySelector('#tool-measure')?.addEventListener('click', () => {
    alert('Measure tool - would measure distances in perspective')
  })

  // Brush settings
  const brushSettings = container.querySelector('#brush-settings')
  container.querySelector('[data-tool="brush"]')?.addEventListener('click', () => {
    if (brushSettings) brushSettings.style.display = 'block'
  })
  container.querySelector('[data-tool="eraser"]')?.addEventListener('click', () => {
    if (brushSettings) brushSettings.style.display = 'block'
  })

  // Brush settings inputs
  ;(container.querySelector('#brush-size') as HTMLInputElement)?.addEventListener('input', (e) => {
    const val = parseInt((e.target as HTMLInputElement).value)
    manager.setBrushProperties({ size: val })
    ;(container.querySelector('#brush-size-value') as HTMLSpanElement).textContent = val
  })

  ;(container.querySelector('#brush-hardness') as HTMLInputElement)?.addEventListener('input', (e) => {
    const val = parseInt((e.target as HTMLInputElement).value)
    manager.setBrushProperties({ hardness: val })
    ;(container.querySelector('#brush-hardness-value') as HTMLSpanElement).textContent = val + '%'
  })

  ;(container.querySelector('#brush-opacity') as HTMLInputElement)?.addEventListener('input', (e) => {
    const val = parseInt((e.target as HTMLInputElement).value)
    manager.setBrushProperties({ opacity: val })
    ;(container.querySelector('#brush-opacity-value') as HTMLSpanElement).textContent = val + '%'
  })

  ;(container.querySelector('#brush-color') as HTMLInputElement)?.addEventListener('input', (e) => {
    manager.setBrushProperties({ color: (e.target as HTMLInputElement).value })
  })

  // Grid settings
  ;(container.querySelector('#vp-grid-size') as HTMLInputElement)?.addEventListener('input', (e) => {
    const val = parseInt((e.target as HTMLInputElement).value)
    manager.setGridSize(val)
    ;(container.querySelector('#vp-grid-size-value') as HTMLSpanElement).textContent = val + 'px'
  })

  // Initial render
  renderPlaneList()

  return container
}

/** Perspective warp tool using vanishing point */
export async function perspectiveWarp(
  canvas: HTMLCanvasElement,
  plane: VanishingPointPlane,
  options: { interpolation: 'bilinear' | 'bicubic' | 'lanczos'; clip: 'transparent' | 'extend' }
): Promise<HTMLCanvasElement> {
  // Would implement perspective warp using the plane's perspective matrix
  // For now, return original
  return canvas
}

/** Create plane from 3D box dimensions */
export function createBoxPlane(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  depth: number,
  rotationY: number = 0,
  rotationX: number = 0
): VanishingPointPlane {
  // Calculate 3D box corners and project to 2D
  const halfW = width / 2
  const halfH = height / 2
  const halfD = depth / 2

  const cosY = Math.cos(rotationY)
  const sinY = Math.sin(rotationY)
  const cosX = Math.cos(rotationX)
  const sinX = Math.sin(rotationX)

  // 8 corners of box
  const corners3D = [
    { x: -halfW, y: -halfH, z: -halfD },
    { x: halfW, y: -halfH, z: -halfD },
    { x: halfW, y: halfH, z: -halfD },
    { x: -halfW, y: halfH, z: -halfD },
    { x: -halfW, y: -halfH, z: halfD },
    { x: halfW, y: -halfH, z: halfD },
    { x: halfW, y: halfH, z: halfD },
    { x: -halfW, y: halfH, z: halfD },
  ]

  // Rotate around Y then X
  const rotated = corners3D.map(p => {
    // Rotate Y
    const x1 = p.x * cosY - p.z * sinY
    const z1 = p.x * sinY + p.z * cosY
    // Rotate X
    const y1 = p.y * cosX - z1 * sinX
    const z2 = p.y * sinX + z1 * cosX
    return { x: x1, y: y1, z: z2 }
  })

  // Project to 2D (simple perspective)
  const focalLength = 500
  const projected = rotated.map(p => ({
    x: p.x * focalLength / (focalLength + p.z) + centerX,
    y: p.y * focalLength / (focalLength + p.z) + centerY,
  })

  // Use front face corners (first 4 points)
  return {
    id: 'box-' + Date.now(),
    name: '3D Box',
    points: projected.slice(0, 4),
    gridSize: 50,
    gridColor: '#00ffff',
    gridOpacity: 0.5,
    showGrid: true,
    showHorizon: true,
    showVanishingPoints: true,
    color: '#00ffff',
  }
}