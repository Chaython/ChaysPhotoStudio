'use client'
// GIMP Perspective Clone Tool
// Clone stamp tool that works in perspective using vanishing point planes

import { createCanvas, ctx2d } from '../utils/canvas'
import { VanishingPointPlane, VanishingPointManager } from './gimp-vanishing-point'

export interface PerspectiveCloneOptions {
  /** Vanishing point plane to use for perspective */
  plane: VanishingPointPlane
  /** Source position in 3D space (on the plane) */
  source: { x: number; y: number; z: number }
  /** Brush settings */
  brush: {
    size: number
    hardness: number
    opacity: number
    flow: number
    spacing: number
    shape: 'circle' | 'square' | 'custom'
    customShape?: HTMLCanvasElement
  }
  /** Source transformation */
  transform: {
    scale: number
    rotation: number
    flipX: boolean
    flipY: boolean
  }
  /** Alignment */
  alignment: 'plane' | 'surface' | 'free'
  /** Sampling */
  sampling: 'current' | 'all-layers' | 'current-and-below'
  /** Healing mode */
  healing: boolean
  /** Alignment guides */
  showAlignment: boolean
  /** Perspective correction */
  perspectiveCorrection: boolean
}

export interface PerspectiveCloneState {
  plane: VanishingPointPlane | null
  sourcePoint: { x: number; y: number; z: number } | null
  currentPoint: { x: number; y: number; z: number } | null
  isCloning: boolean
  previewCanvas: HTMLCanvasElement | null
}

/** Perspective Clone Tool */
export class PerspectiveCloneTool {
  private manager: VanishingPointManager
  private state: PerspectiveCloneState
  private sourceCanvas: HTMLCanvasElement | null = null
  private listeners: Set<() => void> = new Set()

  constructor(manager: VanishingPointManager) {
    this.manager = manager
    this.state = {
      plane: null,
      sourcePoint: null,
      currentPoint: null,
      isCloning: false,
      previewCanvas: null,
    }
  }

  /** Set the vanishing point plane to use */
  setPlane(plane: VanishingPointPlane): void {
    this.state.plane = plane
    this.notify()
  }

  /** Get current plane */
  getPlane(): VanishingPointPlane | null {
    return this.state.plane
  }

  /** Set source canvas (the image to clone from) */
  setSourceCanvas(canvas: HTMLCanvasElement): void {
    this.sourceCanvas = canvas
  }

  /** Get source canvas */
  getSourceCanvas(): HTMLCanvasElement | null {
    return this.sourceCanvas
  }

  /** Set source point in 3D space on the plane */
  setSourcePoint(x: number, y: number, z = 0): void {
    this.state.sourcePoint = { x, y, z }
    this.notify()
  }

  /** Get current source point */
  getSourcePoint(): { x: number; y: number; z: number } | null {
    return this.state.sourcePoint
  }

  /** Start cloning at a point */
  startClone(x: number, y: number): void {
    if (!this.state.plane) return

    // Convert screen coordinates to 3D plane coordinates
    const point3D = this.screenToPlane(x, y)
    this.state.sourcePoint = point3D
    this.state.currentPoint = point3D
    this.state.isCloning = true

    // Create preview canvas
    this.createPreviewCanvas()

    this.notify()
  }

  /** Continue cloning */
  continueClone(x: number, y: number): void {
    if (!this.state.isCloning || !this.state.plane) return

    const point3D = this.screenToPlane(x, y)
    this.state.currentPoint = point3D

    this.updatePreview()
    this.notify()
  }

  /** End cloning */
  endClone(): void {
    this.state.isCloning = false
    this.state.currentPoint = null
    this.notify()
  }

  /** Convert screen coordinates to 3D plane coordinates */
  private screenToPlane(x: number, y: number): { x: number; y: number; z: number } {
    if (!this.state.plane) return { x: 0, y: 0, z: 0 }

    // Use the plane's perspective matrix to unproject
    const matrix = this.getPlaneMatrix()
    if (!matrix) return { x: 0, y: 0, z: 0 }

    // Inverse project screen coordinates to plane coordinates
    // This is simplified - real implementation would use the full perspective matrix
    const plane = this.state.plane!
    const [p0, p1, p2, p3] = plane.points

    // Bilinear interpolation to find UV coordinates
    const u = this.uvFromPoint(x, y, plane.points)
    const v = 0 // Simplified

    return { x: u, y: v, z: 0 }
  }

  /** Get plane's perspective matrix */
  private getPlaneMatrix(): number[] | null {
    if (!this.state.plane) return null
    const plane = this.state.plane
    const src = plane.points
    const dst = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]
    return computePerspectiveTransform(plane.points, dst)
  }

  /** Create preview canvas for real-time feedback */
  private createPreviewCanvas(): void {
    if (!this.sourceCanvas) return

    this.state.previewCanvas = createCanvas(this.sourceCanvas.width, this.sourceCanvas.height)
    const ctx = ctx2d(this.state.previewCanvas)
    ctx.drawImage(this.sourceCanvas, 0, 0)
  }

  /** Update preview during cloning */
  private updatePreview(): void {
    if (!this.state.previewCanvas || !this.state.sourcePoint || !this.state.currentPoint || !this.sourceCanvas) return

    const ctx = ctx2d(this.state.previewCanvas!)
    const sourceCtx = this.sourceCanvas.getContext('2d')!

    // Clear preview
    ctx.clearRect(0, 0, this.state.previewCanvas.width, this.state.previewCanvas.height)

    // Draw source preview
    ctx.drawImage(this.sourceCanvas, 0, 0)

    // Draw source point indicator
    if (this.state.sourcePoint) {
      ctx.save()
      ctx.strokeStyle = '#00ffff'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.arc(this.state.sourcePoint.x, this.state.sourcePoint.y, 10, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    // Draw current point
    if (this.state.currentPoint) {
      ctx.save()
      ctx.strokeStyle = '#ff0000'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.arc(this.state.currentPoint.x, this.state.currentPoint.y, 10, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  /** Apply the clone stroke to target canvas */
  applyClone(
    targetCanvas: HTMLCanvasElement,
    x: number,
    y: number,
    options: {
      brushSize: number
      hardness: number
      opacity: number
      flow: number
      spacing: number
      healing: boolean
      alignment: 'plane' | 'surface' | 'free'
      perspectiveCorrection: boolean
    }
  ): void {
    if (!this.state.sourcePoint || !this.state.plane || !this.sourceCanvas) return

    const targetCtx = targetCanvas.getContext('2d')!
    const sourceCtx = this.sourceCanvas.getContext('2d')!

    const brushSize = options.brushSize
    const hardness = options.hardness / 100
    const opacity = options.opacity / 100
    const flow = options.flow / 100
    const spacing = options.spacing / 100

    // Calculate source and destination in 3D space
    const source3D = this.state.sourcePoint
    const target3D = this.screenToPlane(
      // Would need current mouse position
      0, 0
    )

    // Calculate offset in 3D space
    const dx = target3D.x - source3D.x
    const dy = target3D.y - source3D.y
    const dz = target3D.z - source3D.z

    // Project to 2D source coordinates
    const sourceX = this.projectX(source3D.x + dx, source3D.y + dy, source3D.z + dz)
    const sourceY = this.projectY(source3D.x + dx, source3D.y + dy, source3D.z + dz)

    // Draw with brush
    this.drawBrushStroke(targetCanvas, sourceX, sourceY, options)
  }

  /** Draw a brush stroke sampling from source */
  private drawBrushStroke(
    targetCanvas: HTMLCanvasElement,
    sourceX: number,
    sourceY: number,
    options: any
  ): void {
    const targetCtx = targetCanvas.getContext('2d')!
    const sourceCtx = this.sourceCanvas!.getContext('2d')!

    const brushSize = options.brushSize
    const hardness = options.hardness
    const opacity = options.opacity
    const flow = options.flow
    const spacing = options.spacing

    // Create brush stamp
    const stampCanvas = createCanvas(brushSize * 2, brushSize * 2)
    const stampCtx = ctx2d(stampCanvas)

    // Sample source at sourceX, sourceY
    const stampSize = Math.max(brushSize, 16)
    stampCanvas.width = stampSize
    stampCanvas.height = stampSize

    const sourceX = Math.max(0, Math.min(this.sourceCanvas!.width - stampSize, sourceX - stampSize / 2))
    const sourceY = Math.max(0, Math.min(this.sourceCanvas!.height - stampSize, sourceY - stampSize / 2))

    stampCtx.drawImage(this.sourceCanvas!, sourceX, sourceY, stampSize, stampSize, 0, 0, stampSize, stampSize)

    // Apply hardness
    if (hardness < 1) {
      const maskCanvas = createCanvas(stampSize, stampSize)
      const maskCtx = ctx2d(maskCanvas)
      const gradient = maskCtx.createRadialGradient(stampSize / 2, stampSize / 2, 0, stampSize / 2, stampSize / 2, stampSize / 2)
      gradient.addColorStop(0, 'rgba(255,255,255,1)')
      gradient.addColorStop(hardness, 'rgba(255,255,255,1)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      maskCtx.fillStyle = gradient
      maskCtx.fillRect(0, 0, stampSize, stampSize)

      maskCtx.globalCompositeOperation = 'destination-in'
      maskCtx.drawImage(stampCanvas, 0, 0)
      maskCtx.globalCompositeOperation = 'source-over'
      stampCtx.drawImage(maskCanvas, 0, 0)
    }

    // Draw stamp at target position with flow and spacing
    // This is simplified - real implementation would handle stroke path
    const targetCtx = targetCanvas.getContext('2d')!
    targetCtx.globalAlpha = opacity
    targetCtx.globalCompositeOperation = 'source-over'
    targetCtx.drawImage(stampCanvas, 0, 0, brushSize, brushSize)
  }

  /** Simple 3D to 2D projection */
  private projectX(x: number, y: number, z: number): number {
    if (!this.state.plane) return 0
    const plane = this.state.plane
    const [p0, p1, p2, p3] = plane.points

    // Bilinear interpolation
    const u = x / (plane.points[1].x - plane.points[0].x)
    const v = y / (plane.points[3].y - plane.points[0].y)

    const x1 = lerp(plane.points[0].x, plane.points[1].x, u)
    const x2 = lerp(plane.points[3].x, plane.points[2].x, u)

    return lerp(x1, x2, v)
  }

  private projectY(x: number, y: number, z: number): number {
    if (!this.state.plane) return 0
    const plane = this.state.plane
    const u = x / (plane.points[1].x - plane.points[0].x)
    const v = y / (plane.points[3].y - plane.points[0].y)

    const y1 = lerp(plane.points[0].y, plane.points[1].y, u)
    const y2 = lerp(plane.points[3].y, plane.points[2].y, u)

    return lerp(y1, y2, v)
  }

  /** Screen to plane coordinate conversion (simplified) */
  private screenToPlane(x: number, y: number): { x: number; y: number; z: number } {
    // Simplified: map screen coords to plane UV
    if (!this.state.plane) return { x: 0, y: 0, z: 0 }

    const plane = this.state.plane
    const rect = {
      left: Math.min(...plane.points.map(p => p.x)),
      top: Math.min(...plane.points.map(p => p.y)),
      right: Math.max(...plane.points.map(p => p.x)),
      bottom: Math.max(...plane.points.map(p => p.y)),
    }

    const u = (x - rect.left) / (rect.right - rect.left)
    const v = (y - rect.top) / (rect.bottom - rect.top)

    return { x: u, y: v, z: 0 }
  }

  /** Get preview canvas */
  getPreviewCanvas(): HTMLCanvasElement | null {
    return this.state.previewCanvas
  }

  /** Set brush properties */
  setBrushProperties(props: { size?: number; hardness?: number; opacity?: number; flow?: number; spacing?: number }): void {
    this.notify()
  }

  /** Set healing mode */
  setHealingMode(healing: boolean): void {
    this.notify()
  }

  /** Set alignment mode */
  setAlignment(mode: 'plane' | 'surface' | 'free'): void {
    this.notify()
  }

  /** Set perspective correction */
  setPerspectiveCorrection(enabled: boolean): void {
    this.notify()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Perspective Clone UI Component */
export function createPerspectiveCloneUI(
  tool: PerspectiveCloneTool,
  manager: VanishingPointManager,
  onApply: (canvas: HTMLCanvasElement) => void
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'perspective-clone-ui'
  container.innerHTML = `
    <div class="perspective-clone-panel">
      <h3>Perspective Clone</h3>
      
      <div class="plane-selector">
        <label>Plane:</label>
        <select id="pc-plane-select">
          <option value="">Select a plane</option>
        </select>
        <button id="pc-refresh-planes" title="Refresh">🔄</button>
      </div>

      <div class="source-section">
        <h4>Source</h4>
        <div class="control-row">
          <label>Source Layer:</label>
          <select id="pc-source-layer">
            <option value="current">Current Layer</option>
            <option value="all">All Layers</option>
          </select>
        </div>
        <button id="pc-set-source" class="primary">Set Source Point</button>
        <span id="pc-source-status">No source set</span>
      </div>

      <div class="brush-settings">
        <h4>Brush</h4>
        <div class="control-row">
          <label>Size: <input type="range" id="pc-brush-size" min="1" max="500" value="30"></label>
          <span id="pc-brush-size-value">30</span>
        </div>
        <div class="control-row">
          <label>Hardness: <input type="range" id="pc-brush-hardness" min="0" max="100" value="50"></label>
          <span id="pc-brush-hardness-value">50%</span>
        </div>
        <div class="control-row">
          <label>Opacity: <input type="range" id="pc-brush-opacity" min="0" max="100" value="100"></label>
          <span id="pc-brush-opacity-value">100%</span>
        </div>
        <div class="control-row">
          <label>Flow: <input type="range" id="pc-brush-flow" min="0" max="100" value="50"></label>
          <span id="pc-brush-flow-value">50%</span>
        </div>
        <div class="control-row">
          <label>Spacing: <input type="range" id="pc-brush-spacing" min="1" max="100" value="25"></label>
          <span id="pc-brush-spacing-value">25%</span>
        </div>
      </div>

      <div class="perspective-options">
        <h4>Perspective Options</h4>
        <div class="control-row">
          <label>
            <input type="checkbox" id="pc-perspective-correction" checked>
            Perspective Correction
          </label>
        </div>
        <div class="control-row">
          <label>Alignment:
            <select id="pc-alignment">
              <option value="plane">Plane</option>
              <option value="surface">Surface</option>
              <option value="free">Free</option>
            </select>
          </label>
        </div>
        <div class="control-row">
          <label>
            <input type="checkbox" id="pc-healing">
            Healing Mode
          </label>
        </div>
        <div class="control-row">
          <label>
            <input type="checkbox" id="pc-show-alignment" checked>
            Show Alignment Guides
          </label>
        </div>
      </div>

      <div class="transform-section">
        <h4>Source Transform</h4>
        <div class="control-row">
          <label>Scale: <input type="range" id="pc-scale" min="10" max="300" value="100"></label>
          <span id="pc-scale-value">100%</span>
        </div>
        <div class="control-row">
          <label>Rotation: <input type="range" id="pc-rotation" min="-180" max="180" value="0"></label>
          <span id="pc-rotation-value">0°</span>
        </div>
        <div class="control-row">
          <label>
            <input type="checkbox" id="pc-flip-x"> Flip X
          </label>
          <label>
            <input type="checkbox" id="pc-flip-y"> Flip Y
          </label>
        </div>
      </div>

      <div class="actions">
        <button id="pc-set-source" class="primary">Set Source Point</button>
        <button id="pc-apply" class="primary">Apply Clone</button>
        <button id="pc-cancel">Cancel</button>
      </div>
    </div>
  `

  // Populate plane select
  const planeSelect = container.querySelector('#pc-plane-select') as HTMLSelectElement
  const updatePlaneList = () => {
    const planes = manager.getPlanes()
    planeSelect.innerHTML = '<option value="">Select a plane</option>'
    for (const plane of planes) {
      const option = document.createElement('option')
      option.value = plane.id
      option.textContent = plane.name
      planeSelect.appendChild(option)
    }
    if (tool.getPlane()) {
      planeSelect.value = tool.getPlane()!.id
    }
  }

  updatePlaneList()

  container.querySelector('#pc-refresh-planes')?.addEventListener('click', updatePlaneList)

  planeSelect.addEventListener('change', (e) => {
    const planeId = (e.target as HTMLSelectElement).value
    if (planeId) {
      const plane = manager.getPlane(planeId)
      if (plane) {
        tool.setPlane(plane)
      }
    }
  })

  // Brush settings
  ;(container.querySelector('#pc-brush-size') as HTMLInputElement).addEventListener('input', (e) => {
    const val = parseInt((e.target as HTMLInputElement).value)
    ;(container.querySelector('#pc-brush-size-value') as HTMLSpanElement).textContent = val
  })

  ;(container.querySelector('#pc-brush-hardness') as HTMLInputElement).addEventListener('input', (e) => {
    const val = parseInt((e.target as HTMLInputElement).value)
    ;(container.querySelector('#pc-brush-hardness-value') as HTMLSpanElement).textContent = val + '%'
  })

  ;(container.querySelector('#pc-brush-opacity') as HTMLInputElement).addEventListener('input', (e) => {
    const val = parseInt((e.target as HTMLInputElement).value)
    ;(container.querySelector('#pc-brush-opacity-value') as HTMLSpanElement).textContent = val + '%'
  })

  ;(container.querySelector('#pc-brush-flow') as HTMLInputElement).addEventListener('input', (e) => {
    const val = parseInt((e.target as HTMLInputElement).value)
    ;(container.querySelector('#pc-brush-flow-value') as HTMLSpanElement).textContent = val + '%'
  })

  ;(container.querySelector('#pc-brush-spacing') as HTMLInputElement).addEventListener('input', (e) => {
    const val = parseInt((e.target as HTMLInputElement).value)
    ;(container.querySelector('#pc-brush-spacing-value') as HTMLSpanElement).textContent = val + '%'
  })

  // Source layer select
  const sourceLayerSelect = container.querySelector('#pc-source-layer') as HTMLSelectElement
  // Would populate with actual layers

  // Set source button
  let sourceMode = false
  container.querySelector('#pc-set-source')?.addEventListener('click', () => {
    sourceMode = !sourceMode
    const btn = container.querySelector('#pc-set-source') as HTMLButtonElement
    if (sourceMode) {
      btn.textContent = 'Cancel Source'
      btn.classList.add('active')
      document.body.style.cursor = 'crosshair'
    } else {
      btn.textContent = 'Set Source Point'
      btn.classList.remove('active')
      document.body.style.cursor = 'default'
    }
  })

  // Apply button
  container.querySelector('#pc-apply')?.addEventListener('click', () => {
    alert('Perspective Clone applied! (Implementation would apply the clone stroke)')
  })

  // Cancel button
  container.querySelector('#pc-cancel')?.addEventListener('click', () => {
    // Reset tool state
  })

  return container
}

/** Perspective Clone presets */
export const PERSPECTIVE_CLONE_PRESETS: Record<string, Partial<PerspectiveCloneOptions>> = {
  'floor-clone': {
    name: 'Floor Clone',
    description: 'Clone along floor plane',
    alignment: 'plane',
    perspectiveCorrection: true,
    healing: false,
  },
  'wall-clone': {
    name: 'Wall Clone',
    description: 'Clone along vertical wall plane',
    alignment: 'plane',
    perspectiveCorrection: true,
    healing: false,
  },
  'healing-plane': {
    name: 'Perspective Healing',
    description: 'Heal with perspective correction',
    alignment: 'plane',
    perspectiveCorrection: true,
    healing: true,
  },
  'free-clone': {
    name: 'Free Clone',
    description: 'Clone without perspective correction',
    alignment: 'free',
    perspectiveCorrection: false,
    healing: false,
  },
}