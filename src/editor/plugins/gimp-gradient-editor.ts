'use client'
// GIMP Gradient Editor
// Full-featured gradient editor with stops, transparency, noise, and segment editing

import { createCanvas, ctx2d } from '../utils/canvas'

export interface GradientStop {
  position: number // 0-1
  color: string
  opacity: number // 0-100
  midpoint: number // 0-100 (midpoint between this and next stop)
}

export interface GradientSegment {
  leftStop: GradientStop
  rightStop: GradientStop
  midpoint: number // 0-100
  type: 'linear' | 'curved' | 'sine' | 'increasing' | 'decreasing'
  coloring: 'rgb' | 'hsv' | 'hsl' | 'lab' | 'oklab'
}

export interface Gradient {
  id: string
  name: string
  segments: GradientSegment[]
  type: 'linear' | 'radial' | 'angular' | 'reflected' | 'diamond' | 'conical' | 'spiral' | 'square'
  // Linear specific
  angle?: number
  // Radial specific
  centerX?: number
  centerY?: number
  focalX?: number
  focalY?: number
  radius?: number
  // Angular/Conical
  startAngle?: number
  endAngle?: number
  // Spiral
  turns?: number
  // Square/Diamond
  cornerRadius?: number
  // Noise
  noise: number
  roughness: number
  colorSpace: 'rgb' | 'hsl' | 'hsv' | 'lab' | 'oklab' | 'oklch'
}

export interface GradientEditorState {
  gradient: Gradient
  selectedStopIndex: number | null
  selectedSegmentIndex: number | null
  showTransparency: boolean
  showOpacity: boolean
  previewSize: number
  showGrid: boolean
  snapToGrid: boolean
  gridSize: number
}

/** Gradient Editor Class */
export class GradientEditor {
  private state: GradientEditorState
  private listeners: Set<() => void> = new Set()
  private history: Array<Gradient> = []
  private historyIndex = -1

  constructor(initialGradient?: Gradient) {
    this.state = {
      gradient: initialGradient || this.createDefaultGradient(),
      selectedStopIndex: null,
      selectedSegmentIndex: null,
      showTransparency: true,
      showOpacity: true,
      previewSize: 200,
      showGrid: false,
      snapToGrid: true,
      gridSize: 10,
    }
    this.saveToHistory(this.state.gradient)
  }

  private createDefaultGradient(): Gradient {
    return {
      id: 'gradient-' + Date.now(),
      name: 'New Gradient',
      segments: [
        {
          leftStop: { position: 0, color: '#000000', opacity: 100, midpoint: 50 },
          rightStop: { position: 1, color: '#ffffff', opacity: 100, midpoint: 50 },
          midpoint: 50,
          type: 'linear',
          coloring: 'rgb',
        },
      ],
      type: 'linear',
      angle: 0,
      noise: 0,
      roughness: 0,
      colorSpace: 'oklab',
    }
  }

  getState(): GradientEditorState {
    return { ...this.state }
  }

  getGradient(): Gradient {
    return { ...this.state.gradient }
  }

  setGradient(gradient: Gradient): void {
    this.state.gradient = { ...gradient }
    this.saveToHistory(this.state.gradient)
    this.notify()
  }

  /** Add a new color stop */
  addStop(position: number, color: string, opacity = 100): number {
    const gradient = this.state.gradient
    const newStop: GradientStop = { position, color, opacity, midpoint: 50 }

    // Find insertion point
    let insertIndex = gradient.segments.length
    for (let i = 0; i < gradient.segments.length; i++) {
      if (position < gradient.segments[i].leftStop.position) {
        insertIndex = i
        break
      }
    }

    // Insert stop by splitting segment
    if (insertIndex === gradient.segments.length) {
      // Add at end
      const lastSegment = gradient.segments[gradient.segments.length - 1]
      gradient.segments.push({
        leftStop: { ...lastSegment.rightStop, position },
        rightStop: { position: 1, color: color, opacity: 100, midpoint: 50 },
        midpoint: 50,
        type: 'linear',
        coloring: 'rgb',
      })
    } else {
      // Split segment
      const segment = gradient.segments[insertIndex]
      const newLeftStop = { ...segment.leftStop, position }
      const newRightStop = { position: 1, color, opacity, midpoint: 50 }

      gradient.segments[insertIndex] = {
        ...segment,
        rightStop: { ...segment.leftStop, position },
        midpoint: (segment.leftStop.position + position) / 2,
      }
      gradient.segments.splice(insertIndex + 1, 0, {
        leftStop: newLeftStop,
        rightStop: newRightStop,
        midpoint: (position + segment.rightStop.position) / 2,
        type: segment.type,
        coloring: segment.coloring,
      })
    }

    this.saveToHistory(this.state.gradient)
    this.notify()
    return insertIndex
  }

  /** Remove a stop */
  removeStop(index: number): boolean {
    const gradient = this.state.gradient
    if (gradient.segments.length <= 1) return false // Need at least one segment

    if (index === 0) {
      // Remove first stop - merge with next segment
      gradient.segments[0] = {
        leftStop: gradient.segments[0].leftStop,
        rightStop: gradient.segments[1].rightStop,
        midpoint: gradient.segments[1].midpoint,
        type: gradient.segments[1].type,
        coloring: gradient.segments[1].coloring,
      }
      gradient.segments.splice(1, 1)
    } else if (index >= gradient.segments.length) {
      // Remove last stop - merge with previous segment
      const lastIdx = gradient.segments.length - 1
      gradient.segments[lastIdx] = {
        leftStop: gradient.segments[lastIdx - 1].leftStop,
        rightStop: gradient.segments[lastIdx].rightStop,
        midpoint: gradient.segments[lastIdx - 1].midpoint,
        type: gradient.segments[lastIdx - 1].type,
        coloring: gradient.segments[lastIdx - 1].coloring,
      }
      gradient.segments.pop()
    } else {
      // Remove middle stop - merge adjacent segments
      gradient.segments[index - 1] = {
        leftStop: gradient.segments[index - 1].leftStop,
        rightStop: gradient.segments[index].rightStop,
        midpoint: (gradient.segments[index - 1].leftStop.position + gradient.segments[index].rightStop.position) / 2,
        type: gradient.segments[index].type,
        coloring: gradient.segments[index].coloring,
      }
      gradient.segments.splice(index, 1)
    }

    this.saveToHistory(this.state.gradient)
    this.notify()
    return true
  }

  /** Update stop properties */
  updateStop(index: number, updates: Partial<GradientStop>): boolean {
    if (index < 0 || index >= this.state.gradient.segments.length + (this.state.gradient.segments.length > 1 ? 1 : 0)) {
      return false
    }

    // Determine which stop to update
    // This is complex because stops are shared between segments
    // For simplicity, we'll update the left stop of segment index, or right stop of last segment
    const gradient = this.state.gradient
    let stop: GradientStop | null = null

    if (index === gradient.segments.length) {
      // Last stop (right stop of last segment)
      stop = gradient.segments[gradient.segments.length - 1].rightStop
    } else {
      // Left stop of segment
      stop = gradient.segments[index].leftStop
    }

    if (stop) {
      Object.assign(stop, updates)
      // Ensure position stays valid
      if (updates.position !== undefined) {
        stop.position = Math.max(0, Math.min(1, updates.position))
      }
      if (updates.opacity !== undefined) {
        stop.opacity = Math.max(0, Math.min(100, updates.opacity))
      }
      if (updates.midpoint !== undefined) {
        stop.midpoint = Math.max(0, Math.min(100, updates.midpoint))
      }
      this.saveToHistory(this.state.gradient)
      this.notify()
      return true
    }
    return false
  }

  /** Update segment properties */
  updateSegment(index: number, updates: Partial<GradientSegment>): boolean {
    const gradient = this.state.gradient
    if (index < 0 || index >= gradient.segments.length) return false

    const segment = gradient.segments[index]
    Object.assign(segment, updates)

    // Clamp midpoint
    if (updates.midpoint !== undefined) {
      segment.midpoint = Math.max(0, Math.min(100, updates.midpoint))
    }

    this.saveToHistory(this.state.gradient)
    this.notify()
    return true
  }

  /** Move stop position */
  moveStop(index: number, newPosition: number): boolean {
    const gradient = this.state.gradient
    const clampedPosition = Math.max(0, Math.min(1, newPosition))

    if (index === 0) {
      // First stop - can only move right
      if (clampedPosition >= gradient.segments[0].rightStop.position) return false
      gradient.segments[0].leftStop.position = clampedPosition
    } else if (index >= gradient.segments.length) {
      // Last stop
      const lastSeg = this.state.gradient.segments[gradient.segments.length - 1]
      if (clampedPosition <= lastSeg.leftStop.position) return false
      lastSeg.rightStop.position = clampedPosition
    } else {
      // Middle stop
      const segment = gradient.segments[index]
      if (clampedPosition <= segment.leftStop.position || clampedPosition >= segment.rightStop.position) {
        return false
      }
      segment.leftStop.position = clampedPosition
      // Update midpoints of adjacent segments
      if (index > 0) {
        gradient.segments[index - 1].midpoint = (gradient.segments[index - 1].leftStop.position + clampedPosition) / 2
      }
      if (index < gradient.segments.length - 1) {
        gradient.segments[index].midpoint = (clampedPosition + gradient.segments[index + 1].rightStop.position) / 2
      }
      segment.leftStop.position = clampedPosition
    }

    this.saveToHistory(this.state.gradient)
    this.notify()
    return true
  }

  /** Reverse gradient */
  reverse(): void {
    const gradient = this.state.gradient
    gradient.segments.reverse()
    gradient.segments.forEach(seg => {
      const temp = seg.leftStop
      seg.leftStop = { ...seg.rightStop, position: 1 - seg.rightStop.position }
      seg.rightStop = { ...temp, position: 1 - temp.position }
      seg.midpoint = 100 - seg.midpoint
    })
    this.saveToHistory(gradient)
    this.notify()
  }

  /** Add noise to gradient */
  addNoise(amount: number, roughness: number): void {
    const gradient = this.state.gradient
    gradient.noise = Math.max(0, Math.min(100, amount))
    gradient.roughness = Math.max(0, Math.min(100, roughness))
    this.saveToHistory(gradient)
    this.notify()
  }

  /** Change gradient type */
  setType(type: Gradient['type']): void {
    const gradient = this.state.gradient
    gradient.type = type
    // Set defaults for new type
    if (type === 'radial') {
      gradient.centerX = 0.5
      gradient.centerY = 0.5
      gradient.focalX = 0.5
      gradient.focalY = 0.5
      gradient.radius = 0.5
    } else if (type === 'angular') {
      gradient.startAngle = 0
      gradient.endAngle = 360
    }
    this.saveToHistory(gradient)
    this.notify()
  }

  /** Set gradient angle (for linear) */
  setAngle(angle: number): void {
    this.state.gradient.angle = ((angle % 360) + 360) % 360
    this.notify()
  }

  /** Set radial center */
  setCenter(x: number, y: number): void {
    this.state.gradient.centerX = Math.max(0, Math.min(1, x))
    this.state.gradient.centerY = Math.max(0, Math.min(1, y))
    this.notify()
  }

  /** Set focal point (for radial) */
  setFocalPoint(x: number, y: number): void {
    this.state.gradient.focalX = Math.max(0, Math.min(1, x))
    this.state.gradient.focalY = Math.max(0, Math.min(1, y))
    this.notify()
  }

  /** Set radius (for radial) */
  setRadius(radius: number): void {
    this.state.gradient.radius = Math.max(0, Math.min(1, radius))
    this.notify()
  }

  /** Set color space */
  setColorSpace(cs: Gradient['colorSpace']): void {
    this.state.gradient.colorSpace = cs
    this.saveToHistory(this.state.gradient)
    this.notify()
  }

  /** Export gradient as CSS */
  exportCSS(): string {
    const gradient = this.state.gradient
    let css = ''

    switch (gradient.type) {
      case 'linear': {
        const angle = gradient.angle || 0
        const stops = gradient.segments.flatMap(seg => [
          `${this.stopToCSS(seg.leftStop)} ${seg.leftStop.position * 100}%`,
          `${this.stopToCSS(seg.rightStop)} ${seg.rightStop.position * 100}%`,
        ]).filter((v, i, arr) => arr.indexOf(v) === arr.indexOf(v)) // unique
        css = `linear-gradient(${angle}deg, ${stops.join(', ')})`
        break
      }
      case 'radial': {
        const cx = gradient.centerX || 0.5
        const cy = gradient.centerY || 0.5
        const fx = gradient.focalX ?? cx
        const fy = gradient.focalY ?? cy
        const r = gradient.radius || 0.5
        const stops = gradient.segments.flatMap(seg => [
          `${this.stopToCSS(seg.leftStop)} ${seg.leftStop.position * 100}%`,
          `${this.stopToCSS(seg.rightStop)} ${seg.rightStop.position * 100}%`,
        ]).filter((v, i, arr) => arr.indexOf(v) === arr.indexOf(v))
        css = `radial-gradient(circle at ${cx * 100}% ${cy * 100}%, ${stops.join(', ')})`
        break
      }
      case 'angular':
        css = `conic-gradient(from ${gradient.startAngle || 0}deg, ${gradient.segments.map(s => `${this.stopToCSS(s.leftStop)} ${s.leftStop.position * 100}%, ${this.stopToCSS(s.rightStop)} ${s.rightStop.position * 100}%`).join(', ')})`
        break
      default:
        css = 'linear-gradient(90deg, black, white)'
    }

    return css
  }

  private stopToCSS(stop: GradientStop): string {
    const alpha = stop.opacity / 100
    if (alpha < 1) {
      return `rgba(${this.hexToRgb(stop.color).join(', ')}, ${alpha})`
    }
    return stop.color
  }

  private hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace('#', '')
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ]
  }

  /** Import gradient from CSS */
  static importCSS(css: string): Gradient | null {
    // Simplified CSS gradient parser
    // Would need full CSS parser for production
    return null
  }

  /** Export gradient as JSON */
  exportJSON(): string {
    return JSON.stringify(this.state.gradient, null, 2)
  }

  /** Import gradient from JSON */
  importJSON(json: string): boolean {
    try {
      const gradient = JSON.parse(json)
      this.setGradient(gradient)
      return true
    } catch {
      return false
    }
  }

  /** Undo */
  undo(): boolean {
    if (this.historyIndex > 0) {
      this.historyIndex--
      this.state.gradient = this.history[this.historyIndex]
      this.notify()
      return true
    }
    return false
  }

  /** Redo */
  redo(): boolean {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++
      this.state.gradient = this.history[this.historyIndex]
      this.notify()
      return true
    }
    return false
  }

  canUndo(): boolean {
    return this.historyIndex > 0
  }

  canRedo(): boolean {
    return this.historyIndex < this.history.length - 1
  }

  private saveToHistory(gradient: Gradient): void {
    this.history = this.history.slice(0, this.historyIndex + 1)
    this.history.push(JSON.parse(JSON.stringify(gradient)))
    this.historyIndex = this.history.length - 1
    if (this.history.length > 50) {
      this.history.shift()
      this.historyIndex--
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

/** Gradient Presets */
export const GRADIENT_PRESETS: Record<string, Gradient> = {
  'black-white': {
    id: 'bw',
    name: 'Black to White',
    segments: [
      { leftStop: { position: 0, color: '#000000', opacity: 100, midpoint: 50 }, rightStop: { position: 1, color: '#ffffff', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
    ],
    type: 'linear',
    noise: 0,
    roughness: 0,
    colorSpace: 'oklab',
  },
  'rainbow': {
    id: 'rainbow',
    name: 'Rainbow',
    segments: [
      { leftStop: { position: 0, color: '#ff0000', opacity: 100, midpoint: 50 }, rightStop: { position: 0.166, color: '#ff7f00', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
      { leftStop: { position: 0.166, color: '#ff7f00', opacity: 100, midpoint: 50 }, rightStop: { position: 0.333, color: '#ffff00', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
      { leftStop: { position: 0.333, color: '#ffff00', opacity: 100, midpoint: 50 }, rightStop: { position: 0.5, color: '#00ff00', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
      { leftStop: { position: 0.5, color: '#00ff00', opacity: 100, midpoint: 50 }, rightStop: { position: 0.666, color: '#0000ff', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
      { leftStop: { position: 0.666, color: '#0000ff', opacity: 100, midpoint: 50 }, rightStop: { position: 0.833, color: '#4b0082', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
      { leftStop: { position: 0.833, color: '#4b0082', opacity: 100, midpoint: 50 }, rightStop: { position: 1, color: '#9400d3', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
    ],
    type: 'linear',
    noise: 0,
    roughness: 0,
    colorSpace: 'oklab',
  },
  'fire': {
    id: 'fire',
    name: 'Fire',
    segments: [
      { leftStop: { position: 0, color: '#000000', opacity: 100, midpoint: 50 }, rightStop: { position: 0.3, color: '#ff3300', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
      { leftStop: { position: 0.3, color: '#ff3300', opacity: 100, midpoint: 50 }, rightStop: { position: 0.6, color: '#ffaa00', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
      { leftStop: { position: 0.6, color: '#ffaa00', opacity: 100, midpoint: 50 }, rightStop: { position: 1, color: '#ffffff', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
    ],
    type: 'linear',
    noise: 10,
    roughness: 20,
    colorSpace: 'oklab',
  },
  'ocean': {
    id: 'ocean',
    name: 'Ocean',
    segments: [
      { leftStop: { position: 0, color: '#001133', opacity: 100, midpoint: 50 }, rightStop: { position: 0.5, color: '#0066cc', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
      { leftStop: { position: 0.5, color: '#0066cc', opacity: 100, midpoint: 50 }, rightStop: { position: 1, color: '#00ffff', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
    ],
    type: 'linear',
    noise: 0,
    roughness: 0,
    colorSpace: 'oklab',
  },
  'sunset': {
    id: 'sunset',
    name: 'Sunset',
    segments: [
      { leftStop: { position: 0, color: '#1a0033', opacity: 100, midpoint: 50 }, rightStop: { position: 0.3, color: '#ff0066', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
      { leftStop: { position: 0.3, color: '#ff0066', opacity: 100, midpoint: 50 }, rightStop: { position: 0.7, color: '#ff9900', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
      { leftStop: { position: 0.7, color: '#ffcc00', opacity: 100, midpoint: 50 }, rightStop: { position: 1, color: '#ffffff', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
    ],
    type: 'linear',
    noise: 0,
    roughness: 0,
    colorSpace: 'oklab',
  },
  'metallic': {
    id: 'metallic',
    name: 'Metallic',
    segments: [
      { leftStop: { position: 0, color: '#000000', opacity: 100, midpoint: 50 }, rightStop: { position: 0.5, color: '#888888', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
      { leftStop: { position: 0.5, color: '#888888', opacity: 100, midpoint: 50 }, rightStop: { position: 1, color: '#ffffff', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
    ],
    type: 'linear',
    noise: 10,
    roughness: 20,
    colorSpace: 'oklab',
  },
  'gold': {
    id: 'gold',
    name: 'Gold',
    segments: [
      { leftStop: { position: 0, color: '#1a1a00', opacity: 100, midpoint: 50 }, rightStop: { position: 0.3, color: '#8b6914', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
      { leftStop: { position: 0.3, color: '#8b6914', opacity: 100, midpoint: 50 }, rightStop: { position: 0.7, color: '#ffd700', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
      { leftStop: { position: 0.7, color: '#ffd700', opacity: 100, midpoint: 50 }, rightStop: { position: 1, color: '#ffffcc', opacity: 100, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
    ],
    type: 'linear',
    noise: 5,
    roughness: 10,
    colorSpace: 'oklab',
  },
  'transparent-fade': {
    id: 'transparent-fade',
    name: 'Transparent Fade',
    segments: [
      { leftStop: { position: 0, color: '#ffffff', opacity: 100, midpoint: 50 }, rightStop: { position: 1, color: '#ffffff', opacity: 0, midpoint: 50 }, midpoint: 50, type: 'linear', coloring: 'rgb' },
    ],
    type: 'linear',
    noise: 0,
    roughness: 0,
    colorSpace: 'oklab',
  },
}

/** Create Gradient Editor UI */
export function createGradientEditorUI(
  editor: GradientEditor,
  onChange: (gradient: Gradient) => void
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'gradient-editor-ui'
  container.innerHTML = `
    <div class="gradient-editor">
      <div class="gradient-toolbar">
        <select id="gradient-type">
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
          <option value="angular">Angular</option>
          <option value="reflected">Reflected</option>
          <option value="diamond">Diamond</option>
          <option value="conical">Conical</option>
          <option value="spiral">Spiral</option>
          <option value="square">Square</option>
        </select>
        <select id="color-space">
          <option value="oklab">OKLab</option>
          <option value="lab">Lab</option>
          <option value="rgb">RGB</option>
          <option value="hsl">HSL</option>
          <option value="hsv">HSV</option>
        </select>
        <button id="reverse-gradient" title="Reverse">⇅</button>
        <button id="randomize" title="Randomize">🎲</button>
      </div>
      
      <div class="gradient-preview" id="gradient-preview"></div>
      
      <div class="gradient-stops" id="gradient-stops"></div>
      
      <div class="stop-properties" id="stop-properties">
        <h4>Stop Properties</h4>
        <div class="property-row">
          <label>Position: <input type="range" id="stop-position" min="0" max="100" step="1" value="0"></label>
          <span id="stop-position-value">0%</span>
        </div>
        <div class="property-row">
          <label>Color: <input type="color" id="stop-color" value="#000000"></label>
        </div>
        <div class="property-row">
          <label>Opacity: <input type="range" id="stop-opacity" min="0" max="100" step="1" value="100"></label>
          <span id="stop-opacity-value">100%</span>
        </div>
        <div class="property-row">
          <label>Midpoint: <input type="range" id="stop-midpoint" min="0" max="100" step="1" value="50"></label>
          <span id="stop-midpoint-value">50%</span>
        </div>
        <button id="remove-stop" class="danger">Remove Stop</button>
        <button id="add-stop">Add Stop</button>
      </div>
      
      <div class="segment-properties" id="segment-properties" style="display:none">
        <h4>Segment Properties</h4>
        <div class="property-row">
          <label>Type: <select id="segment-type">
            <option value="linear">Linear</option>
            <option value="curved">Curved</option>
            <option value="sine">Sine</option>
            <option value="increasing">Increasing</option>
            <option value="decreasing">Decreasing</option>
          </select></label>
        </div>
        <div class="property-row">
          <label>Midpoint: <input type="range" id="seg-midpoint" min="0" max="100" step="1" value="50"></label>
          <span id="seg-midpoint-value">50%</span>
        </div>
        <div class="property-row">
          <label>Coloring: <select id="seg-coloring">
            <option value="rgb">RGB</option>
            <option value="hsv">HSV</option>
            <option value="hsl">HSL</option>
            <option value="lab">Lab</option>
            <option value="oklab">OKLab</option>
          </select></label>
        </div>
      </div>
      
      <div class="global-controls">
        <label>Noise: <input type="range" id="noise" min="0" max="100" step="1" value="0"></label>
        <label>Roughness: <input type="range" id="roughness" min="0" max="100" step="1" value="0"></label>
        <button id="reverse">Reverse</button>
        <button id="export-css">Export CSS</button>
        <button id="export-json">Export JSON</button>
        <input type="file" id="import-json" accept=".json" style="display:none">
        <button id="import-json-btn">Import JSON</button>
      </div>
      
      <div class="presets-panel">
        <h4>Presets</h4>
        <div class="preset-buttons" id="preset-buttons"></div>
      </div>
    </div>
  `

  // Initialize UI
  const preview = container.querySelector('#gradient-preview') as HTMLDivElement
  const stopsContainer = container.querySelector('#gradient-stops') as HTMLDivElement
  const stopProps = container.querySelector('#stop-properties') as HTMLDivElement
  const segProps = container.querySelector('#segment-properties') as HTMLDivElement
  const presetButtons = container.querySelector('#preset-buttons') as HTMLDivElement

  // Render preset buttons
  Object.entries(GRADIENT_PRESETS).forEach(([key, preset]) => {
    const btn = document.createElement('button')
    btn.className = 'preset-btn'
    btn.textContent = preset.name
    btn.onclick = () => {
      editor.setGradient({ ...preset })
      updateUI()
    }
    presetButtons.appendChild(btn)
  })

  // Render preset buttons
  function updateUI(): void {
    const state = editor.getState()
    const gradient = state.gradient

    // Update preview
    preview.style.background = editor.exportCSS()
    preview.style.width = '100%'
    preview.style.height = '100px'
    preview.style.border = '1px solid #ccc'
    preview.style.borderRadius = '4px'

    // Update type select
    ;(container.querySelector('#gradient-type') as HTMLSelectElement).value = gradient.type
    ;(container.querySelector('#color-space') as HTMLSelectElement).value = gradient.colorSpace

    // Render stops
    stopsContainer.innerHTML = ''
    gradient.segments.forEach((seg, segIdx) => {
      // Left stop
      addStopButton(stopsContainer, seg.leftStop, segIdx, 'left', gradient)
      // Right stop (only for last segment)
      if (segIdx === gradient.segments.length - 1) {
        addStopButton(stopsContainer, seg.rightStop, segIdx, 'right', gradient)
      }
    }

    // Update selected stop properties
    if (state.selectedStopIndex !== null) {
      stopProps.style.display = 'block'
      const stop = getStopByIndex(state)
      if (stop) {
        ;(container.querySelector('#stop-position') as HTMLInputElement).value = String(stop.position * 100)
        ;(container.querySelector('#stop-position-value') as HTMLSpanElement).textContent = `${Math.round(stop.position * 100)}%`
        ;(container.querySelector('#stop-color') as HTMLInputElement).value = stop.color
        ;(container.querySelector('#stop-opacity') as HTMLInputElement).value = String(stop.opacity)
        ;(container.querySelector('#stop-opacity-value') as HTMLSpanElement).textContent = `${stop.opacity}%`
        ;(container.querySelector('#stop-midpoint') as HTMLInputElement).value = String(stop.midpoint)
        ;(container.querySelector('#stop-midpoint-value') as HTMLSpanElement).textContent = `${stop.midpoint}%`
      }
    } else {
      stopProps.style.display = 'none'
    }

    // Segment properties
    if (state.selectedSegmentIndex !== null) {
      segProps.style.display = 'block'
      const seg = gradient.segments[state.selectedSegmentIndex]
      if (seg) {
        ;(container.querySelector('#segment-type') as HTMLSelectElement).value = seg.type
        ;(container.querySelector('#seg-midpoint') as HTMLInputElement).value = String(seg.midpoint)
        ;(container.querySelector('#seg-midpoint-value') as HTMLSpanElement).textContent = `${seg.midpoint}%`
        ;(container.querySelector('#seg-coloring') as HTMLSelectElement).value = seg.coloring
      }
    } else {
      segProps.style.display = 'none'
    }

    // Global controls
    ;(container.querySelector('#noise') as HTMLInputElement).value = String(gradient.noise)
    ;(container.querySelector('#roughness') as HTMLInputElement).value = String(gradient.roughness)
  }

  function addStopButton(container: HTMLElement, stop: GradientStop, segIdx: number, side: 'left' | 'right', gradient: Gradient): void {
    const btn = document.createElement('button')
    btn.className = 'stop-btn'
    btn.style.background = stop.color
    btn.style.opacity = String(stop.opacity / 100)
    btn.style.border = state.selectedStopIndex === (side === 'left' ? segIdx : gradient.segments.length - 1) ? '2px solid #007acc' : '1px solid #ccc'
    btn.style.width = `${stop.position * 100}%`
    btn.style.minWidth = '20px'
    btn.style.height = '20px'
    btn.style.borderRadius = '4px'
    btn.style.cursor = 'pointer'
    btn.title = `${side} stop at ${Math.round(stop.position * 100)}%`
    btn.onclick = () => {
      state.selectedStopIndex = side === 'left' ? segIdx : gradient.segments.length - 1
      state.selectedSegmentIndex = segIdx
      updateUI()
    }
    container.appendChild(btn)
  }

  function getStopByIndex(state: GradientEditorState): GradientStop | null {
    const gradient = state.gradient
    if (state.selectedStopIndex === null) return null
    if (state.selectedStopIndex === gradient.segments.length) {
      return gradient.segments[gradient.segments.length - 1].rightStop
    }
    return gradient.segments[state.selectedStopIndex].leftStop
  }

  let state = editor.getState()
  updateUI()

  // Event listeners
  container.querySelector('#gradient-type')?.addEventListener('change', (e) => {
    editor.setType((e.target as HTMLSelectElement).value as any)
    state = editor.getState()
    updateUI()
  })

  container.querySelector('#color-space')?.addEventListener('change', (e) => {
    editor.setColorSpace((e.target as HTMLSelectElement).value as any)
    state = editor.getState()
    updateUI()
  })

  container.querySelector('#reverse-gradient')?.addEventListener('click', () => {
    editor.reverse()
    state = editor.getState()
    updateUI()
  })

  container.querySelector('#randomize')?.addEventListener('click', () => {
    // Randomize gradient
    const gradient = editor.getGradient()
    gradient.segments.forEach(seg => {
      seg.leftStop.color = `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`
      seg.rightStop.color = `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`
    })
    editor.setGradient(gradient)
    state = editor.getState()
    updateUI()
  })

  container.querySelector('#stop-position')?.addEventListener('input', (e) => {
    const pos = parseFloat((e.target as HTMLInputElement).value) / 100
    if (state.selectedStopIndex !== null) {
      editor.moveStop(state.selectedStopIndex, pos)
      state = editor.getState()
      updateUI()
    }
  })

  container.querySelector('#stop-color')?.addEventListener('input', (e) => {
    if (state.selectedStopIndex !== null) {
      const stop = getStopByIndex(state)
      if (stop) {
        stop.color = (e.target as HTMLInputElement).value
        editor.updateStop(state.selectedStopIndex, { color: stop.color })
        state = editor.getState()
        updateUI()
      }
    }
  })

  container.querySelector('#stop-opacity')?.addEventListener('input', (e) => {
    if (state.selectedStopIndex !== null) {
      const opacity = parseFloat((e.target as HTMLInputElement).value)
      const stop = getStopByIndex(state)
      if (stop) {
        stop.opacity = opacity
        editor.updateStop(state.selectedStopIndex, { opacity })
        state = editor.getState()
        updateUI()
      }
    }
  })

  container.querySelector('#stop-midpoint')?.addEventListener('input', (e) => {
    if (state.selectedStopIndex !== null) {
      const midpoint = parseFloat((e.target as HTMLInputElement).value)
      const stop = getStopByIndex(state)
      if (stop) {
        stop.midpoint = midpoint
        editor.updateStop(state.selectedStopIndex, { midpoint })
        state = editor.getState()
        updateUI()
      }
    }
  })

  container.querySelector('#remove-stop')?.addEventListener('click', () => {
    if (state.selectedStopIndex !== null) {
      editor.removeStop(state.selectedStopIndex)
      state.selectedStopIndex = null
      state = editor.getState()
      updateUI()
    }
  })

  container.querySelector('#add-stop')?.addEventListener('click', () => {
    const gradient = state.gradient
    const pos = gradient.segments.length > 0 ? gradient.segments[gradient.segments.length - 1].rightStop.position : 0.5
    editor.addStop(pos, '#ffffff')
    state = editor.getState()
    updateUI()
  })

  container.querySelector('#seg-midpoint')?.addEventListener('input', (e) => {
    if (state.selectedSegmentIndex !== null) {
      const midpoint = parseFloat((e.target as HTMLInputElement).value)
      editor.updateSegment(state.selectedSegmentIndex, { midpoint })
      state = editor.getState()
      updateUI()
    }
  })

  ;(container.querySelector('#segment-type') as HTMLSelectElement)?.addEventListener('change', (e) => {
    if (state.selectedSegmentIndex !== null) {
      editor.updateSegment(state.selectedSegmentIndex, { type: (e.target as HTMLSelectElement).value as any })
      state = editor.getState()
      updateUI()
    }
  })

  ;(container.querySelector('#seg-coloring') as HTMLSelectElement)?.addEventListener('change', (e) => {
    if (state.selectedSegmentIndex !== null) {
      editor.updateSegment(state.selectedSegmentIndex, { coloring: (e.target as HTMLSelectElement).value as any })
      state = editor.getState()
      updateUI()
    }
  })

  container.querySelector('#noise')?.addEventListener('input', (e) => {
    const noise = parseFloat((e.target as HTMLInputElement).value)
    const gradient = editor.getGradient()
    gradient.noise = noise
    editor.setGradient(gradient)
    state = editor.getState()
    updateUI()
  })

  container.querySelector('#roughness')?.addEventListener('input', (e) => {
    const roughness = parseFloat((e.target as HTMLInputElement).value)
    const gradient = editor.getGradient()
    gradient.roughness = roughness
    editor.setGradient(gradient)
    state = editor.getState()
    updateUI()
  })

  container.querySelector('#reverse')?.addEventListener('click', () => {
    editor.reverse()
    state = editor.getState()
    updateUI()
  })

  container.querySelector('#export-css')?.addEventListener('click', () => {
    const css = editor.exportCSS()
    navigator.clipboard.writeText(css)
    alert('CSS copied to clipboard!')
  })

  container.querySelector('#export-json')?.addEventListener('click', () => {
    const json = editor.exportJSON()
    navigator.clipboard.writeText(json)
    alert('JSON copied to clipboard!')
  })

  container.querySelector('#import-json-btn')?.addEventListener('click', () => {
    ;(container.querySelector('#import-json') as HTMLInputElement).click()
  })

  container.querySelector('#import-json')?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        if (editor.importJSON(e.target.result)) {
          state = editor.getState()
          updateUI()
        }
      }
      reader.readAsText(file)
    }
  })

  // Preset buttons
  Object.entries(GRADIENT_PRESETS).forEach(([key, preset]) => {
    const btn = document.createElement('button')
    btn.className = 'preset-btn'
    btn.textContent = preset.name
    btn.onclick = () => {
      editor.setGradient({ ...preset })
      state = editor.getState()
      updateUI()
    }
    presetButtons.appendChild(btn)
  })

  return container
}