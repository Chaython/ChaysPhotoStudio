'use client'
// GIMP Measurement Tools Enhancement
// Advanced measurement tools: distance, angle, area, angle, sample points

import { createCanvas, ctx2d } from '../utils/canvas'

export interface MeasurementPoint {
  id: string
  x: number
  y: number
  label?: string
  color: string
}

export interface MeasurementResult {
  id: string
  type: 'distance' | 'angle' | 'area' | 'perimeter' | 'angle-between' | 'point'
  points: MeasurementPoint[]
  value: number
  unit: string
  label: string
  color: string
  visible: boolean
  timestamp: number
}

export interface MeasurementOptions {
  unit: 'px' | 'mm' | 'cm' | 'in' | 'pt' | 'pc'
  dpi: number
  precision: number
  snapToGrid: boolean
  snapToGuides: boolean
  snapToLayers: boolean
  showLabels: boolean
  showValues: boolean
  decimals: number
}

export interface SamplePoint {
  id: string
  x: number
  y: number
  color: { r: number; g: number; b: number; a: number }
  position: 'absolute' | 'relative'
  label?: string
  color: string
  size: number
  visible: boolean
  locked: boolean
}

export interface SamplePointOptions {
  maxPoints: number
  defaultColor: string
  defaultSize: number
  showCoordinates: boolean
  showColorValues: boolean
  showColorSample: boolean
  updateRealtime: boolean
}

/** Measurement Tool Manager */
export class MeasurementToolManager {
  private measurements: Map<string, MeasurementResult> = new Map()
  private samplePoints: Map<string, SamplePoint> = new Map()
  private options: MeasurementOptions
  private sampleOptions: SamplePointOptions
  private canvasSize: { width: number; height: number } = { width: 0, height: 0 }
  private dpi = 72
  private listeners: Set<() => void> = new Set()
  private unit = 'px'
  private scale = 1 // pixels per unit

  constructor() {
    this.options = {
      unit: 'px',
      dpi: 72,
      precision: 2,
      snapToGrid: true,
      snapToGuides: true,
      snapToLayers: true,
      showLabels: true,
      showValues: true,
      decimals: 2,
    }
    this.sampleOptions = {
      maxPoints: 10,
      defaultColor: '#ff0000',
      defaultSize: 10,
      showCoordinates: true,
      showColorValues: true,
      showColorSample: true,
      updateRealtime: true,
    }
  }

  setCanvasSize(width: number, height: number): void {
    this.canvasSize = { width, height }
  }

  setDpi(dpi: number): void {
    this.dpi = dpi
    this.updateScale()
  }

  setUnit(unit: 'px' | 'mm' | 'cm' | 'in' | 'pt' | 'pc'): void {
    this.unit = unit
    this.updateScale()
  }

  private updateScale(): void {
    switch (this.unit) {
      case 'px':
        this.scale = 1
        break
      case 'mm':
        this.scale = this.dpi / 25.4
        break
      case 'cm':
        this.scale = this.dpi / 2.54
        break
      case 'in':
        this.scale = this.dpi
        break
      case 'pt':
        this.scale = this.dpi / 72
        break
      case 'pc':
        this.scale = this.dpi / 6
        break
    }
  }

  /** Convert pixels to current unit */
  pixelsToUnit(px: number): number {
    return px / this.scale
  }

  /** Convert current unit to pixels */
  unitToPixels(unit: number): number {
    return unit * this.scale
  }

  /** Format value with unit */
  formatValue(value: number): string {
    const factor = this.unit === 'px' ? 1 : 1 / this.scale
    const scaled = value * (this.unit === 'px' ? 1 : 1 / this.scale)
    return `${scaled.toFixed(this.options.decimals)} ${this.unit}`
  }

  /** Format angle */
  formatAngle(rad: number): string {
    const deg = (rad * 180) / Math.PI
    return `${deg.toFixed(this.options.decimals)}°`
  }

  /** Measure distance between two points */
  measureDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): MeasurementResult {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const distancePx = Math.sqrt(dx * dx + dy * dy)
    const distance = this.pixelsToUnit(distancePx)
    const angle = Math.atan2(dy, dx)

    const result: MeasurementResult = {
      id: 'dist-' + Date.now(),
      type: 'distance',
      points: [
        { id: 'p1', x: p1.x, y: p1.y, color: '#00ffff' },
        { id: 'p2', x: p2.x, y: p2.y, color: '#ff00ff' },
      ],
      value: distance,
      unit: this.unit,
      label: `Distance: ${this.formatValue(distance)}`,
      color: '#00ffff',
      visible: true,
      timestamp: Date.now(),
    }

    this.measurements.set(result.id, result)
    this.notify()
    return result
  }

  /** Measure angle between three points */
  measureAngle(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }): MeasurementResult {
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y }
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y }

    const dot = v1.x * v2.x + v1.y * v2.y
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y)
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y)

    const cosAngle = dot / (mag1 * mag2)
    const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))))
    const angleDeg = (angleRad * 180) / Math.PI

    const result: MeasurementResult = {
      id: 'angle-' + Date.now(),
      type: 'angle',
      points: [
        { id: 'p1', x: p1.x, y: p1.y, color: '#00ffff' },
        { id: 'p2', x: p2.x, y: p2.y, color: '#ff00ff' },
        { id: 'p3', x: p3.x, y: p3.y, color: '#ffff00' },
      ],
      value: angleDeg,
      unit: 'deg',
      label: `Angle: ${angleDeg.toFixed(this.options.decimals)}°`,
      color: '#ffff00',
      visible: true,
      timestamp: Date.now(),
    }

    this.measurements.set(result.id, result)
    this.notify()
    return result
  }

  /** Measure area of polygon */
  measureArea(points: { x: number; y: number }[]): MeasurementResult {
    if (points.length < 3) {
      throw new Error('At least 3 points required for area measurement')
    }

    // Shoelace formula
    let area = 0
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length
      area += points[i].x * points[j].y - points[j].x * points[i].y
    }
    area = Math.abs(area) / 2

    const areaUnit = this.pixelsToUnit(Math.sqrt(area)) ** 2

    const result: MeasurementResult = {
      id: 'area-' + Date.now(),
      type: 'area',
      points: points.map((p, i) => ({ id: `p${i}`, x: p.x, y: p.y, color: '#00ff00' })),
      value: areaUnit,
      unit: this.unit + '²',
      label: `Area: ${this.formatValue(areaUnit)} ${this.unit}²`,
      color: '#00ff00',
      visible: true,
      timestamp: Date.now(),
    }

    this.measurements.set(result.id, result)
    this.notify()
    return result
  }

  /** Measure perimeter of polygon */
  measurePerimeter(points: { x: number; y: number }[]): MeasurementResult {
    if (points.length < 2) {
      throw new Error('At least 2 points required for perimeter measurement')
    }

    let perimeter = 0
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length
      const dx = points[j].x - points[i].x
      const dy = points[j].y - points[i].y
      perimeter += Math.sqrt(dx * dx + dy * dy)
    }

    const perimeterUnit = this.pixelsToUnit(perimeter)

    const result: MeasurementResult = {
      id: 'perimeter-' + Date.now(),
      type: 'perimeter',
      points: points.map((p, i) => ({ id: `p${i}`, x: p.x, y: p.y, color: '#ff8800' })),
      value: perimeterUnit,
      unit: this.unit,
      label: `Perimeter: ${this.formatValue(perimeterUnit)} ${this.unit}`,
      color: '#ff8800',
      visible: true,
      timestamp: Date.now(),
    }

    this.measurements.set(result.id, result)
    this.notify()
    return result
  }

  /** Measure angle between two lines */
  measureAngleBetween(
    line1: { p1: { x: number; y: number }; p2: { x: number; y: number } },
    line2: { p1: { x: number; y: number }; p2: { x: number; y: number } }
  ): MeasurementResult {
    const v1 = { x: line1.p2.x - line1.p1.x, y: line1.p2.y - line1.p1.y }
    const v2 = { x: line2.p2.x - line2.p1.x, y: line2.p2.y - line2.p1.y }

    const dot = v1.x * v2.x + v1.y * v2.y
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y)
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y)

    const cosAngle = dot / (mag1 * mag2)
    const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))))
    const angleDeg = (angleRad * 180) / Math.PI

    const result: MeasurementResult = {
      id: 'angle-between-' + Date.now(),
      type: 'angle-between',
      points: [
        { id: 'l1p1', x: line1.p1.x, y: line1.p1.y, color: '#00ffff' },
        { id: 'l1p2', x: line1.p2.x, y: line1.p2.y, color: '#00ffff' },
        { id: 'l2p1', x: line2.p1.x, y: line2.p1.y, color: '#ff00ff' },
        { id: 'l2p2', x: line2.p2.x, y: line2.p2.y, color: '#ff00ff' },
      ],
      value: angleDeg,
      unit: 'deg',
      label: `Angle: ${angleDeg.toFixed(this.options.decimals)}°`,
      color: '#ffff00',
      visible: true,
      timestamp: Date.now(),
    }

    this.measurements.set(result.id, result)
    this.notify()
    return result
  }

  /** Add measurement point */
  addPoint(x: number, y: number, label?: string, color = '#00ffff'): MeasurementPoint {
    return {
      id: 'pt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
      x,
      y,
      label,
      color,
    }
  }

  /** Get all measurements */
  getMeasurements(): MeasurementResult[] {
    return Array.from(this.measurements.values())
  }

  /** Get measurement by ID */
  getMeasurement(id: string): MeasurementResult | undefined {
    return this.measurements.get(id)
  }

  /** Delete measurement */
  deleteMeasurement(id: string): boolean {
    const result = this.measurements.delete(id)
    if (result) this.notify()
    return result
  }

  /** Clear all measurements */
  clearMeasurements(): void {
    this.measurements.clear()
    this.notify()
  }

  /** Sample Points Management */

  /** Add sample point */
  addSamplePoint(x: number, y: number, canvas: HTMLCanvasElement, options: Partial<SamplePoint> = {}): SamplePoint {
    const ctx = canvas.getContext('2d')!
    const imgData = ctx.getImageData(x, y, 1, 1)
    const data = imgData.data

    const point: SamplePoint = {
      id: 'sp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
      x,
      y,
      color: { r: data[0], g: data[1], b: data[2], a: data[3] },
      position: options.position || 'absolute',
      label: options.label,
      color: options.color || this.sampleOptions.defaultColor,
      size: options.size || this.sampleOptions.defaultSize,
      visible: true,
      locked: false,
    }

    this.samplePoints.set(point.id, point)
    this.notify()
    return point
  }

  /** Get sample point */
  getSamplePoint(id: string): SamplePoint | undefined {
    return this.samplePoints.get(id)
  }

  /** Get all sample points */
  getSamplePoints(): SamplePoint[] {
    return Array.from(this.samplePoints.values())
  }

  /** Update sample point */
  updateSamplePoint(id: string, updates: Partial<SamplePoint>): boolean {
    const point = this.samplePoints.get(id)
    if (!point) return false
    Object.assign(point, updates)
    this.notify()
    return true
  }

  /** Remove sample point */
  removeSamplePoint(id: string): boolean {
    const result = this.samplePoints.delete(id)
    if (result) this.notify()
    return result
  }

  /** Clear all sample points */
  clearSamplePoints(): void {
    this.samplePoints.clear()
    this.notify()
  }

  /** Update sample point color from canvas */
  updateSampleColors(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!
    for (const point of this.samplePoints.values()) {
      if (point.position === 'absolute') {
        const imgData = ctx.getImageData(point.x, point.y, 1, 1)
        point.color = { r: data[0], g: data[1], b: data[2], a: data[3] }
      }
    }
    this.notify()
  }

  /** Get sample point color info */
  getSamplePointInfo(point: SamplePoint): string {
    const { r, g, b, a } = point.color
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    return `RGB(${r}, ${g}, ${b}) | Hex: ${hex} | Alpha: ${Math.round(a / 255 * 100)}%`
  }

  /** Export measurements as JSON */
  exportMeasurements(): string {
    const data = {
      measurements: Array.from(this.measurements.values()),
      samplePoints: Array.from(this.samplePoints.values()),
      options: this.options,
      sampleOptions: this.sampleOptions,
      unit: this.unit,
      dpi: this.dpi,
    }
    return JSON.stringify(data, null, 2)
  }

  /** Import measurements from JSON */
  importMeasurements(json: string): boolean {
    try {
      const data = JSON.parse(json)
      this.measurements = new Map(data.measurements.map((m: MeasurementResult) => [m.id, m]))
      this.samplePoints = new Map(data.samplePoints.map((s: SamplePoint) => [s.id, s]))
      this.options = { ...this.options, ...data.options }
      this.sampleOptions = { ...this.sampleOptions, ...data.sampleOptions }
      this.unit = data.unit || 'px'
      this.dpi = data.dpi || 72
      this.updateScale()
      this.notify()
      return true
    } catch {
      return false
    }
  }

  /** Export measurements as CSV */
  exportCSV(): string {
    let csv = 'Type,Label,Value,Unit,Points\n'
    for (const m of this.measurements.values()) {
      const points = m.points.map(p => `(${p.x},${p.y})`).join('; ')
      csv += `"${m.type}","${m.label}",${m.value},"${m.unit}","${points}"\n`
    }
    return csv
  }

  /** Export sample points as CSV */
  exportSamplePointsCSV(): string {
    let csv = 'ID,X,Y,R,G,B,A,Label,Color,Locked\n'
    for (const p of this.samplePoints.values()) {
      csv += `${p.id},${p.x},${p.y},${p.color.r},${p.color.g},${p.color.b},${p.color.a},"${p.label || ''}",${p.color},${p.locked}\n`
    }
    return csv
  }

  /** Render measurements on canvas */
  renderMeasurements(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!
    ctx.save()

    for (const measurement of this.measurements.values()) {
      if (!measurement.visible) continue

      ctx.strokeStyle = measurement.color
      ctx.fillStyle = measurement.color
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])

      switch (measurement.type) {
        case 'distance':
          if (measurement.points.length >= 2) {
            const [p1, p2] = measurement.points
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.stroke()

            // Draw points
            ;[p1, p2].forEach(p => {
              ctx.beginPath()
              ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
              ctx.fillStyle = p.color
              ctx.fill()
            })

            // Label
            if (this.options.showLabels) {
              const midX = (measurement.points[0].x + measurement.points[1].x) / 2
              const midY = (measurement.points[0].y + measurement.points[1].y) / 2
              ctx.fillStyle = measurement.color
              ctx.font = '12px sans-serif'
              ctx.fillText(measurement.label, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2 - 10)
            }
          }
          break

        case 'angle':
          if (measurement.points.length >= 3) {
            const [p1, p2, p3] = measurement.points
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.lineTo(p3.x, p3.y)
            ctx.stroke()

            ;[p1, p2, p3].forEach(p => {
              ctx.beginPath()
              ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
              ctx.fillStyle = p.color
              ctx.fill()
            })

            // Arc for angle
            const cx = p2.x, cy = p2.y
            const r = 30
            const angle1 = Math.atan2(p1.y - cy, p1.x - cx)
            const angle2 = Math.atan2(p3.y - cy, p3.x - cx)
            ctx.beginPath()
            ctx.arc(cx, cy, 30, angle1, angle2)
            ctx.stroke()
          }
          break

        case 'area':
        case 'perimeter':
          if (measurement.points.length >= 3) {
            ctx.beginPath()
            ctx.moveTo(measurement.points[0].x, measurement.points[0].y)
            for (let i = 1; i < measurement.points.length; i++) {
              ctx.lineTo(measurement.points[i].x, measurement.points[i].y)
            }
            ctx.closePath()
            ctx.stroke()
            ctx.globalAlpha = 0.2
            ctx.fillStyle = measurement.color
            ctx.fill()
            ctx.globalAlpha = 1

            measurement.points.forEach(p => {
              ctx.beginPath()
              ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
              ctx.fillStyle = p.color
              ctx.fill()
            })
          }
          break
      }
    }

    // Draw sample points
    for (const point of this.samplePoints.values()) {
      if (!point.visible) continue

      ctx.save()
      ctx.translate(point.x, point.y)
      ctx.rotate(0)

      // Draw crosshair
      ctx.strokeStyle = point.color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(-point.size, 0)
      ctx.lineTo(point.size, 0)
      ctx.moveTo(0, -point.size)
      ctx.lineTo(0, point.size)
      ctx.stroke()

      // Center dot
      ctx.beginPath()
      ctx.arc(0, 0, 3, 0, Math.PI * 2)
      ctx.fillStyle = point.color
      ctx.fill()

      // Label
      if (this.sampleOptions.showCoordinates && point.label) {
        ctx.fillStyle = point.color
        ctx.font = '10px sans-serif'
        ctx.fillText(point.label, point.size + 2, -point.size - 2)
      }

      ctx.restore()
    }

    ctx.restore()
  }

  /** Snap point to nearest grid/guide/layer */
  snapPoint(x: number, y: number): { x: number; y: number } {
    let snappedX = x
    let snappedY = y

    // Would implement snapping to grid, guides, layers
    // This is a placeholder

    return { x: snappedX, y: snappedY }
  }

  /** Set options */
  setOptions(options: Partial<MeasurementOptions>): void {
    Object.assign(this.options, options)
    this.updateScale()
    this.notify()
  }

  /** Set sample point options */
  setSampleOptions(options: Partial<SamplePointOptions>): void {
    Object.assign(this.sampleOptions, options)
    this.notify()
  }

  /** Get options */
  getOptions(): MeasurementOptions {
    return { ...this.options }
  }

  /** Get sample options */
  getSampleOptions(): SamplePointOptions {
    return { ...this.sampleOptions }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Measurement UI Component */
export function createMeasurementUI(
  manager: MeasurementToolManager,
  onMeasure: (type: string, result: any) => void
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'measurement-ui'
  container.innerHTML = `
    <div class="measurement-panel">
      <h3>Measurement Tools</h3>
      
      <div class="tool-tabs">
        <button data-tool="distance" class="active">Distance</button>
        <button data-tool="angle">Angle</button>
        <button data-tool="area">Area</button>
        <button data-tool="perimeter">Perimeter</button>
        <button data-tool="angle-between">Angle Between</button>
        <button data-tool="sample">Sample Points</button>
      </div>

      <div class="tool-panels">
        <div id="distance-panel" class="tool-panel active">
          <button id="measure-distance" class="primary">Measure Distance</button>
          <p class="hint">Click two points to measure distance</p>
        </div>
        <div id="angle-panel" class="tool-panel">
          <button id="measure-angle" class="primary">Measure Angle</button>
          <p class="hint">Click three points (vertex in middle)</p>
        </div>
        <div id="area-panel" class="tool-panel">
          <button id="measure-area" class="primary">Measure Area</button>
          <p class="hint">Click to add vertices, double-click to finish</p>
        </div>
        <div id="perimeter-panel" class="tool-panel">
          <button id="measure-perimeter" class="primary">Measure Perimeter</button>
          <p class="hint">Click to add vertices, double-click to finish</p>
        </div>
        <div id="angle-between-panel" class="tool-panel">
          <button id="measure-angle-between" class="primary">Measure Angle Between</button>
          <p class="hint">Click two lines (4 points total)</p>
        </div>
        <div id="sample-panel" class="tool-panel">
          <div class="control-row">
            <button id="add-sample" class="primary">Add Sample Point</button>
            <button id="clear-samples">Clear All</button>
          </div>
          <div class="control-row">
            <label>Color: <input type="color" id="sample-color" value="#ff0000"></label>
          </div>
          <div class="control-row">
            <label>Size: <input type="range" id="sample-size" min="5" max="30" value="10"></label>
          </div>
          <div class="sample-list" id="sample-list"></div>
        </div>
      </div>

      <div class="measurement-results">
        <h4>Results</h4>
        <div id="results-list" class="results-list"></div>
        <button id="clear-all" class="danger">Clear All</button>
        <button id="export-csv" class="secondary">Export CSV</button>
        <button id="export-json">Export JSON</button>
      </div>

      <div class="options-panel">
        <h4>Options</h4>
        <div class="option-row">
          <label>Unit: <select id="measure-unit">
            <option value="px">Pixels</option>
            <option value="mm">Millimeters</option>
            <option value="cm">Centimeters</option>
            <option value="in">Inches</option>
            <option value="pt">Points</option>
            <option value="pc">Picas</option>
          </select></label>
        </div>
        <div class="option-row">
          <label>DPI: <input type="number" id="measure-dpi" value="72" min="1"></label>
        </div>
        <div class="option-row">
          <label>Decimals: <input type="number" id="measure-decimals" value="2" min="0" max="6"></label>
        </div>
        <div class="option-row">
          <label>
            <input type="checkbox" id="show-labels" checked> Show Labels
          </label>
          <label>
            <input type="checkbox" id="show-values" checked> Show Values
          </label>
        </div>
        <div class="option-row">
          <label>
            <input type="checkbox" id="snap-grid" checked> Snap to Grid
          </label>
          <label>
            <input type="checkbox" id="snap-guides" checked> Snap to Guides
          </label>
          <label>
            <input type="checkbox" id="snap-layers" checked> Snap to Layers
          </label>
        </div>
      </div>
    </div>
  `

  // Initialize state
  let currentTool = 'distance'
  let measuring = false
  let measurePoints: { x: number; y: number }[] = []
  let sampleMode = false

  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:1000;'
  document.body.appendChild(canvas)

  const toolButtons = container.querySelectorAll('[data-tool]')
  const panels = container.querySelectorAll('.tool-panel')
  const measureBtn = container.querySelector('#measure-distance') as HTMLButtonElement
  const angleBtn = container.querySelector('#measure-angle') as HTMLButtonElement
  const areaBtn = container.querySelector('#measure-area') as HTMLButtonElement
  const perimeterBtn = container.querySelector('#measure-perimeter') as HTMLButtonElement
  const angleBetweenBtn = container.querySelector('#measure-angle-between') as HTMLButtonElement
  const sampleBtn = container.querySelector('#add-sample') as HTMLButtonElement
  const clearSamplesBtn = container.querySelector('#clear-samples') as HTMLButtonElement
  const clearAllBtn = container.querySelector('#clear-all') as HTMLButtonElement
  const exportCsvBtn = container.querySelector('#export-csv') as HTMLButtonElement
  const exportJsonBtn = container.querySelector('#export-json') as HTMLButtonElement
  const resultsList = container.querySelector('#results-list') as HTMLDivElement
  const sampleList = container.querySelector('#sample-list') as HTMLDivElement
  const unitSelect = container.querySelector('#measure-unit') as HTMLSelectElement
  const dpiInput = container.querySelector('#measure-dpi') as HTMLInputElement
  const decimalsInput = container.querySelector('#measure-decimals') as HTMLInputElement
  const showLabelsCb = container.querySelector('#show-labels') as HTMLInputElement
  const showValuesCb = container.querySelector('#show-values') as HTMLInputElement
  const snapGridCb = container.querySelector('#snap-grid') as HTMLInputElement
  const snapGuidesCb = container.querySelector('#snap-guides') as HTMLInputElement
  const snapLayersCb = container.querySelector('#snap-layers') as HTMLInputElement
  const decimalsInput = container.querySelector('#measure-decimals') as HTMLInputElement
  const sampleColorInput = container.querySelector('#sample-color') as HTMLInputElement
  const sampleSizeInput = container.querySelector('#sample-size') as HTMLInputElement
  const sampleList = container.querySelector('#sample-list') as HTMLDivElement
  const resultsList = container.querySelector('#results-list') as HTMLDivElement

  const manager = new MeasurementToolManager()

  function updateUI(): void {
    // Update tool buttons
    toolButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === currentTool)
    })
    panels.forEach(panel => {
      panel.classList.toggle('active', panel.id === `${currentTool}-panel`)
    })

    // Update results list
    const measurements = manager.getMeasurements()
    resultsList.innerHTML = measurements.map(m => `
      <div class="result-item" data-id="${m.id}">
        <span class="result-type">${m.type}</span>
        <span class="result-label">${m.label}</span>
        <span class="result-value">${m.value.toFixed(manager.getOptions().decimals)} ${m.unit}</span>
        <button class="delete-btn" data-id="${m.id}" title="Delete">🗑️</button>
      </div>
    `).join('')

    // Update sample list
    const samples = manager.getSamplePoints()
    sampleList.innerHTML = samples.map(s => `
      <div class="sample-item" data-id="${s.id}">
        <span class="sample-color" style="background:${s.color};width:12px;height:12px;border-radius:50%;display:inline-block;margin-right:5px;"></span>
        <span>${s.label || `(${s.x}, ${s.y})`}</span>
        <span class="sample-coords">(${s.x}, ${s.y})</span>
        <button class="delete-btn" data-id="${s.id}" title="Delete">🗑️</button>
      </div>
    `).join('')

    // Update options
    unitSelect.value = manager.getOptions().unit
    dpiInput.value = String(manager.getOptions().dpi)
    decimalsInput.value = String(manager.getOptions().decimals)
    showLabelsCb.checked = manager.getOptions().showLabels
    showValuesCb.checked = manager.getOptions().showValues
    snapGridCb.checked = manager.getOptions().snapToGrid
    snapGuidesCb.checked = manager.getOptions().snapToGuides
    snapLayersCb.checked = manager.getOptions().snapToLayers
  }

  function updateCanvasSize(): void {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    manager.setCanvasSize(canvas.width, canvas.height)
  }

  updateCanvasSize()
  window.addEventListener('resize', updateCanvasSize)

  // Tool selection
  toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      currentTool = btn.dataset.tool!
      updateUI()
    })
  )

  // Measurement buttons
  measureBtn.addEventListener('click', () => {
    measuring = true
    measurePoints = []
    canvas.style.cursor = 'crosshair'
    canvas.style.pointerEvents = 'auto'
  })

  angleBtn.addEventListener('click', () => {
    measuring = true
    measurePoints = []
    canvas.style.cursor = 'crosshair'
    canvas.style.pointerEvents = 'auto'
  })

  areaBtn.addEventListener('click', () => {
    measuring = true
    measurePoints = []
    canvas.style.cursor = 'crosshair'
    canvas.style.pointerEvents = 'auto'
  })

  perimeterBtn.addEventListener('click', () => {
    measuring = true
    measurePoints = []
    canvas.style.cursor = 'crosshair'
    canvas.style.pointerEvents = 'auto'
  })

  angleBetweenBtn.addEventListener('click', () => {
    measuring = true
    measurePoints = []
    canvas.style.cursor = 'crosshair'
    canvas.style.pointerEvents = 'auto'
  })

  sampleBtn.addEventListener('click', () => {
    sampleMode = !sampleMode
    canvas.style.cursor = sampleMode ? 'crosshair' : 'default'
    canvas.style.pointerEvents = sampleMode ? 'auto' : 'none'
    sampleBtn.classList.toggle('active', sampleMode)
  })

  clearSamplesBtn.addEventListener('click', () => {
    manager.clearSamplePoints()
    updateUI()
  })

  clearAllBtn.addEventListener('click', () => {
    manager.clearMeasurements()
    updateUI()
  })

  exportCsvBtn.addEventListener('click', () => {
    const csv = manager.exportCSV()
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'measurements.csv'
    a.click()
    URL.revokeObjectURL(url)
  })

  exportJsonBtn.addEventListener('click', () => {
    const json = manager.exportMeasurements()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'measurements.json'
    a.click()
    URL.revokeObjectURL(url)
  })

  // Canvas click handler
  canvas.addEventListener('click', (e) => {
    if (!measuring && !sampleMode) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (sampleMode) {
      // Add sample point - would need actual canvas with image
      manager.addSamplePoint(x, y, createCanvas(1, 1), {
        color: (document.getElementById('sample-color') as HTMLInputElement).value,
        size: parseInt((document.getElementById('sample-size') as HTMLInputElement).value),
      })
      updateUI()
      return
    }

    measurePoints.push({ x, y })

    if (currentTool === 'distance' && measurePoints.length === 2) {
      const result = manager.measureDistance(measurePoints[0], measurePoints[1])
      onMeasure('distance', result)
      measuring = false
      measurePoints = []
      canvas.style.cursor = 'default'
      canvas.style.pointerEvents = 'none'
      updateUI()
    } else if (currentTool === 'angle' && measurePoints.length === 3) {
      const result = manager.measureAngle(measurePoints[0], measurePoints[1], measurePoints[2])
      onMeasure('angle', result)
      measuring = false
      measurePoints = []
      canvas.style.cursor = 'default'
      canvas.style.pointerEvents = 'none'
      updateUI()
    } else if (currentTool === 'area' && measurePoints.length >= 3) {
      // For area, we allow multiple clicks, finish on double-click or right-click
      // For simplicity, auto-complete after 3+ points
      if (measurePoints.length >= 3) {
        const result = manager.measureArea(measurePoints)
        onMeasure('area', result)
        measuring = false
        measurePoints = []
        canvas.style.cursor = 'default'
        canvas.style.pointerEvents = 'none'
        updateUI()
      }
    } else if (currentTool === 'perimeter' && measurePoints.length >= 2) {
      if (measurePoints.length >= 3) {
        const result = manager.measurePerimeter(measurePoints)
        onMeasure('perimeter', result)
        measuring = false
        measurePoints = []
        canvas.style.cursor = 'default'
        canvas.style.pointerEvents = 'none'
        updateUI()
      }
    } else if (currentTool === 'angle-between' && measurePoints.length === 4) {
      const result = manager.measureAngleBetween(
        { p1: measurePoints[0], p2: measurePoints[1] },
        { p1: measurePoints[2], p2: measurePoints[3] }
      )
      onMeasure('angle-between', result)
      measuring = false
      measurePoints = []
      canvas.style.cursor = 'default'
      canvas.style.pointerEvents = 'none'
      updateUI()
    }

    // Draw measurement preview
    drawMeasurementPreview()
  })

  canvas.addEventListener('mousemove', (e) => {
    if (!measuring) return
    drawMeasurementPreview()
  })

  function drawMeasurementPreview(): void {
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (measurePoints.length > 0) {
      ctx.strokeStyle = '#00ffff'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])

      if (currentTool === 'distance' || currentTool === 'angle-between') {
        if (measurePoints.length >= 2) {
          ctx.beginPath()
          ctx.moveTo(measurePoints[0].x, measurePoints[0].y)
          for (let i = 1; i < measurePoints.length; i++) {
            ctx.lineTo(measurePoints[i].x, measurePoints[i].y)
          }
          ctx.stroke()
        }
      } else if (currentTool === 'angle') {
        if (measurePoints.length === 2) {
          ctx.beginPath()
          ctx.moveTo(measurePoints[0].x, measurePoints[0].y)
          ctx.lineTo(measurePoints[1].x, measurePoints[1].y)
          ctx.stroke()
        }
      } else if (currentTool === 'area' || currentTool === 'perimeter') {
        if (measurePoints.length >= 2) {
          ctx.beginPath()
          ctx.moveTo(measurePoints[0].x, measurePoints[0].y)
          for (let i = 1; i < measurePoints.length; i++) {
            ctx.lineTo(measurePoints[i].x, measurePoints[i].y)
          }
          ctx.stroke()
        }
      }

      // Draw points
      ctx.fillStyle = '#00ffff'
      for (const pt of measurePoints) {
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  // Canvas right-click to finish polygon
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (measuring && (currentTool === 'area' || currentTool === 'perimeter') && measurePoints.length >= 3) {
      const result = currentTool === 'area'
        ? manager.measureArea(measurePoints)
        : manager.measurePerimeter(measurePoints)
      onMeasure(currentTool, result)
      measuring = false
      measurePoints = []
      canvas.style.cursor = 'default'
      canvas.style.pointerEvents = 'none'
      updateUI()
    }
  })

  // Options
  unitSelect.addEventListener('change', () => {
    manager.setOptions({ unit: unitSelect.value as any })
  })

  dpiInput.addEventListener('change', () => {
    manager.setDpi(parseInt(dpiInput.value) || 72)
  })

  decimalsInput.addEventListener('change', () => {
    manager.setOptions({ decimals: parseInt(decimalsInput.value) || 2 })
  })

  showLabelsCb.addEventListener('change', () => {
    manager.setOptions({ showLabels: showLabelsCb.checked })
  })

  showValuesCb.addEventListener('change', () => {
    manager.setOptions({ showValues: showValuesCb.checked })
  })

  snapGridCb.addEventListener('change', () => {
    manager.setOptions({ snapToGrid: snapGridCb.checked })
  })

  snapGuidesCb.addEventListener('change', () => {
    manager.setOptions({ snapToGuides: snapGuidesCb.checked })
  })

  snapLayersCb.addEventListener('change', () => {
    manager.setOptions({ snapToLayers: snapLayersCb.checked })
  })

  // Sample options
  sampleColorInput.addEventListener('input', () => {
    // Would update sample color
  })

  sampleSizeInput.addEventListener('input', () => {
    // Would update sample size
  })

  // Sample list click handlers
  sampleList.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.delete-btn')
    if (deleteBtn) {
      const id = deleteBtn.dataset.id
      if (id) {
        manager.removeSamplePoint(id)
        updateUI()
      }
    }
  })

  resultsList.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.delete-btn')
    if (deleteBtn) {
      const id = deleteBtn.dataset.id
      if (id) {
        manager.deleteMeasurement(id)
        updateUI()
      }
    }
  })

  // Export CSV
  exportCsvBtn.addEventListener('click', () => {
    const csv = manager.exportCSV()
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'measurements.csv'
    a.click()
    URL.revokeObjectURL(url)
  })

  // Export JSON
  exportJsonBtn.addEventListener('click', () => {
    const json = manager.exportMeasurements()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'measurements.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Initial UI update
  updateUI()
  updateCanvasSize()

  window.addEventListener('resize', updateCanvasSize)

  // Subscribe to manager updates
  manager.subscribe(updateUI)

  return container
}

/** Measurement presets */
export const MEASUREMENT_PRESETS: Record<string, Partial<MeasurementOptions>> = {
  'print': { unit: 'mm', dpi: 300, decimals: 2 },
  'web': { unit: 'px', dpi: 72, decimals: 0 },
  'print-cm': { unit: 'cm', dpi: 300, decimals: 1 },
  'architecture': { unit: 'mm', dpi: 300, decimals: 3 },
  'engineering': { unit: 'in', dpi: 300, decimals: 4 },
}