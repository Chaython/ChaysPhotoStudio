'use client'
// GIMP Non-Destructive Adjustment Layers
// Editable adjustment layers with masks, blending, and non-destructive editing

import { createCanvas, ctx2d } from '../utils/canvas'

export type AdjustmentLayerType =
  | 'levels'
  | 'curves'
  | 'brightness-contrast'
  | 'exposure'
  | 'vibrance'
  | 'hue-saturation'
  | 'color-balance'
  | 'black-white'
  | 'photo-filter'
  | 'channel-mixer'
  | 'selective-color'
  | 'gradient-map'
  | 'posterize'
  | 'threshold'
  | 'invert'
  | 'camera-raw'
  | 'shadow-highlight'
  | 'color-lookup'
  | 'equalize'
  | 'desaturate'
  | 'hdr-toning'

export interface AdjustmentLayer {
  id: string
  name: string
  type: AdjustmentLayerType
  enabled: boolean
  visible: boolean
  opacity: number // 0-100
  blendMode: string
  params: Record<string, any>
  mask?: LayerMask
  clipped: boolean // clip to layer below
}

export interface LayerMask {
  id: string
  canvas: HTMLCanvasElement
  density: number // 0-100
  feather: number // pixels
  invert: boolean
  backgroundColor: string // for mask display
}

export interface AdjustmentLayerGroup {
  id: string
  name: string
  layers: AdjustmentLayer[]
  expanded: boolean
}

export const ADJUSTMENT_DEFAULTS: Record<AdjustmentLayerType, Record<string, any>> = {
  'levels': {
    channel: 'rgb',
    inputLow: 0,
    inputHigh: 255,
    gamma: 1.0,
    outputLow: 0,
    outputHigh: 255,
  },
  'curves': {
    channel: 'rgb',
    points: [[0, 0], [255, 255]],
  },
  'brightness-contrast': {
    brightness: 0,
    contrast: 0,
    useLegacy: false,
  },
  'exposure': {
    exposure: 0,
    offset: 0,
    gamma: 1.0,
  },
  'vibrance': {
    vibrance: 0,
    saturation: 0,
  },
  'hue-saturation': {
    channel: 'master',
    hue: 0,
    saturation: 0,
    lightness: 0,
    colorize: false,
    colorizeHue: 0,
    colorizeSaturation: 0,
  },
  'color-balance': {
    shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
    midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
    highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
    preserveLuminosity: true,
  },
  'black-white': {
    red: 40,
    yellow: 60,
    green: 40,
    cyan: 60,
    blue: 20,
    magenta: 80,
    tint: false,
    tintHue: 0,
    tintSaturation: 0,
  },
  'photo-filter': {
    filter: 'warming-85',
    color: '#ff9933',
    density: 25,
    preserveLuminosity: true,
  },
  'channel-mixer': {
    outputChannel: 'red',
    red: { red: 100, green: 0, blue: 0, constant: 0 },
    green: { red: 0, green: 100, blue: 0, constant: 0 },
    blue: { red: 0, green: 0, blue: 100, constant: 0 },
    monochrome: false,
  },
  'selective-color': {
    method: 'relative',
    colors: {
      reds: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      yellows: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      greens: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      cyans: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      blues: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      magentas: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      whites: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      neutrals: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
      blacks: { cyan: 0, magenta: 0, yellow: 0, black: 0 },
    },
  },
  'gradient-map': {
    gradient: 'foreground-background',
    dither: true,
    reverse: false,
  },
  'posterize': {
    levels: 4,
  },
  'threshold': {
    level: 128,
  },
  'invert': {},
  'camera-raw': {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    clarity: 0,
    vibrance: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
  },
  'shadow-highlight': {
    shadowsAmount: 35,
    shadowsTonalWidth: 50,
    shadowsRadius: 30,
    highlightsAmount: 0,
    highlightsTonalWidth: 50,
    highlightsRadius: 30,
    colorCorrection: 0,
    midtoneContrast: 0,
    blackClip: 0.01,
    whiteClip: 0.01,
  },
  'color-lookup': {
    lut3D: null,
    lutAbstract: null,
    lutDevice: null,
    opacity: 100,
  },
  'equalize': {},
  'desaturate': {},
  'hdr-toning': {
    method: 'local-adaptation',
    exposure: 0,
    gamma: 1.0,
    detail: 0,
    shadow: 0,
    highlight: 0,
    vibrance: 0,
    saturation: 0,
    edgeGlow: 0,
    radius: 100,
    strength: 1.5,
    smoothing: 1,
  },
}

export class AdjustmentLayerManager {
  private layers: Map<string, AdjustmentLayer> = new Map()
  private layerOrder: string[] = []
  private listeners: Set<() => void> = new Set()
  private canvasSize: { width: number; height: number } = { width: 0, height: 0 }

  setCanvasSize(width: number, height: number): void {
    this.canvasSize = { width, height }
  }

  createLayer(type: AdjustmentLayerType, name?: string): AdjustmentLayer {
    const id = 'adj-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
    const layer: AdjustmentLayer = {
      id,
      name: name || type,
      type,
      enabled: true,
      visible: true,
      opacity: 100,
      blendMode: 'normal',
      params: { ...ADJUSTMENT_DEFAULTS[type] },
      mask: this.createDefaultMask(),
      clipped: false,
    }
    this.layers.set(id, layer)
    this.layerOrder.push(id)
    this.notify()
    return layer
  }

  private createDefaultMask(): LayerMask {
    const canvas = document.createElement('canvas')
    canvas.width = this.canvasSize.width || 1
    canvas.height = this.canvasSize.height || 1
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    return {
      id: 'mask-' + Date.now(),
      canvas,
      density: 100,
      feather: 0,
      invert: false,
      backgroundColor: '#ffffff',
    }
  }

  getLayer(id: string): AdjustmentLayer | undefined {
    return this.layers.get(id)
  }

  getLayers(): AdjustmentLayer[] {
    return this.layerOrder.map(id => this.layers.get(id)!).filter(Boolean)
  }

  getVisibleLayers(): AdjustmentLayer[] {
    return this.getLayers().filter(l => l.visible && l.enabled)
  }

  setLayerParams(id: string, params: Record<string, any>): boolean {
    const layer = this.layers.get(id)
    if (!layer) return false
    layer.params = { ...layer.params, ...params }
    this.notify()
    return true
  }

  setLayerEnabled(id: string, enabled: boolean): boolean {
    const layer = this.layers.get(id)
    if (!layer) return false
    layer.enabled = enabled
    this.notify()
    return true
  }

  setLayerVisible(id: string, visible: boolean): boolean {
    const layer = this.layers.get(id)
    if (!layer) return false
    layer.visible = visible
    this.notify()
    return true
  }

  setLayerOpacity(id: string, opacity: number): boolean {
    const layer = this.layers.get(id)
    if (!layer) return false
    layer.opacity = Math.max(0, Math.min(100, opacity))
    this.notify()
    return true
  }

  setLayerBlendMode(id: string, blendMode: string): boolean {
    const layer = this.layers.get(id)
    if (!layer) return false
    layer.blendMode = blendMode
    this.notify()
    return true
  }

  setLayerClipped(id: string, clipped: boolean): boolean {
    const layer = this.layers.get(id)
    if (!layer) return false
    layer.clipped = clipped
    this.notify()
    return true
  }

  moveLayer(id: string, newIndex: number): boolean {
    const idx = this.layerOrder.indexOf(id)
    if (idx < 0) return false
    this.layerOrder.splice(idx, 1)
    this.layerOrder.splice(Math.max(0, Math.min(newIndex, this.layerOrder.length)), 0, id)
    this.notify()
    return true
  }

  deleteLayer(id: string): boolean {
    const result = this.layers.delete(id)
    if (result) {
      this.layerOrder = this.layerOrder.filter(o => o !== id)
      this.notify()
    }
    return result
  }

  duplicateLayer(id: string): AdjustmentLayer | null {
    const layer = this.layers.get(id)
    if (!layer) return null

    const newLayer = this.createLayer(layer.type, layer.name + ' copy')
    newLayer.enabled = layer.enabled
    newLayer.visible = layer.visible
    newLayer.opacity = layer.opacity
    newLayer.blendMode = layer.blendMode
    newLayer.params = { ...layer.params }
    newLayer.clipped = layer.clipped

    if (layer.mask) {
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = layer.mask.canvas.width
      maskCanvas.height = layer.mask.canvas.height
      const ctx = maskCanvas.getContext('2d')!
      ctx.drawImage(layer.mask.canvas, 0, 0)
      newLayer.mask = { ...layer.mask, id: 'mask-' + Date.now(), canvas: maskCanvas }
    }

    return newLayer
  }

  /** Apply all adjustment layers to a source canvas */
  async applyAdjustments(sourceCanvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    const layers = this.getVisibleLayers()
    if (layers.length === 0) return sourceCanvas

    let currentCanvas = sourceCanvas

    for (const layer of layers) {
      if (!layer.enabled) continue

      const adjusted = await this.applySingleAdjustment(currentCanvas, layer)
      currentCanvas = adjusted
    }

    return currentCanvas
  }

  private async applySingleAdjustment(
    canvas: HTMLCanvasElement,
    layer: AdjustmentLayer
  ): Promise<HTMLCanvasElement> {
    const output = createCanvas(canvas.width, canvas.height)
    const ctx = ctx2d(output)

    // Apply mask if present
    if (layer.mask) {
      // Create masked version
      const masked = await this.applyMask(canvas, layer.mask)
      const adjusted = await this.applyAdjustmentType(masked, layer.type, layer.params)
      return this.blendWithMask(canvas, adjusted, layer.mask, layer.opacity, layer.blendMode)
    } else {
      const adjusted = await this.applyAdjustmentType(canvas, layer.type, layer.params)
      return this.blendLayers(canvas, adjusted, layer.opacity, layer.blendMode)
    }
  }

  private async applyAdjustmentType(
    canvas: HTMLCanvasElement,
    type: AdjustmentLayerType,
    params: Record<string, any>
  ): Promise<HTMLCanvasElement> {
    const output = createCanvas(canvas.width, canvas.height)
    const ctx = ctx2d(output)

    // This is a simplified implementation - real version would use GPU shaders
    ctx.filter = this.getFilterForAdjustment(type, params)
    ctx.drawImage(canvas, 0, 0)
    ctx.filter = 'none'

    return output
  }

  private getFilterForAdjustment(type: AdjustmentLayerType, params: Record<string, any>): string {
    switch (type) {
      case 'brightness-contrast':
        return `brightness(${1 + (params.brightness || 0) / 100}) contrast(${1 + (params.contrast || 0) / 100})`
      case 'exposure':
        return `brightness(${1 + (params.exposure || 0) / 2})`
      case 'vibrance':
        return `saturate(${1 + (params.vibrance || 0) / 100})`
      case 'hue-saturation':
        if (params.colorize) {
          return `hue-rotate(${params.colorizeHue || 0}deg) saturate(${1 + (params.colorizeSaturation || 0) / 100})`
        }
        return `hue-rotate(${params.hue || 0}deg) saturate(${1 + (params.saturation || 0) / 100}) brightness(${1 + (params.lightness || 0) / 100})`
      case 'color-balance':
        // Simplified - would need per-channel adjustments
        return 'none'
      case 'black-white':
        return 'grayscale(1)'
      case 'photo-filter':
        return 'sepia(0.3)'
      case 'invert':
        return 'invert(1)'
      case 'posterize':
        return 'contrast(2)' // approximation
      case 'threshold':
        return 'contrast(100)'
      case 'desaturate':
        return 'grayscale(1)'
      case 'color-lookup':
        return 'none' // would need LUT
      default:
        return 'none'
    }
  }

  private async applyMask(canvas: HTMLCanvasElement, mask: LayerMask): Promise<HTMLCanvasElement> {
    const output = createCanvas(canvas.width, canvas.height)
    const ctx = ctx2d(output)

    // Draw canvas
    ctx.drawImage(canvas, 0, 0)

    // Apply mask
    ctx.globalCompositeOperation = 'destination-in'
    const maskCtx = mask.canvas.getContext('2d')!
    let maskData = maskCtx.getImageData(0, 0, mask.canvas.width, mask.canvas.height)

    // Apply density, feather, invert
    if (mask.feather > 0) {
      // Would apply feather
    }
    if (mask.invert) {
      // Would invert
    }

    ctx.globalAlpha = mask.density / 100
    ctx.drawImage(mask.canvas, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    return output
  }

  private blendLayers(
    base: HTMLCanvasElement,
    top: HTMLCanvasElement,
    opacity: number,
    blendMode: string
  ): HTMLCanvasElement {
    const output = createCanvas(base.width, base.height)
    const ctx = ctx2d(output)

    ctx.drawImage(base, 0, 0)
    ctx.globalAlpha = opacity / 100
    ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
    ctx.drawImage(top, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    return output
  }

  private blendWithMask(
    base: HTMLCanvasElement,
    adjusted: HTMLCanvasElement,
    mask: LayerMask,
    opacity: number,
    blendMode: string
  ): HTMLCanvasElement {
    const output = createCanvas(base.width, base.height)
    const ctx = ctx2d(output)

    ctx.drawImage(base, 0, 0)

    // Apply mask to adjusted layer
    const maskedAdjusted = createCanvas(adjusted.width, adjusted.height)
    const maskCtx = maskedAdjusted.getContext('2d')!
    maskCtx.drawImage(adjusted, 0, 0)
    maskCtx.globalCompositeOperation = 'destination-in'
    maskCtx.globalAlpha = mask.density / 100
    maskCtx.drawImage(mask.canvas, 0, 0)

    // Blend
    ctx.globalAlpha = opacity / 100
    ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
    ctx.drawImage(maskedAdjusted, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    return output
  }

  notify(): void {
    for (const listener of this.listeners) listener()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

/** LUT (Look-Up Table) Support */
export interface Lut3D {
  size: number // 16, 32, 64
  data: Float32Array // size^3 * 4 (RGBA)
  domainMin: [number, number, number]
  domainMax: [number, number, number]
}

export async function loadLut3D(file: File): Promise<Lut3D> {
  const text = await file.text()

  // Parse .cube format
  if (file.name.endsWith('.cube')) {
    return parseCubeFile(text)
  }

  // Parse .3dl format
  if (file.name.endsWith('.3dl')) {
    return parse3dlFile(text)
  }

  throw new Error('Unsupported LUT format')
}

function parseCubeFile(text: string): Lut3D {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  let size = 32
  let domainMin: [number, number, number] = [0, 0, 0]
  let domainMax: [number, number, number] = [1, 1, 1]
  const data: number[] = []

  for (const line of lines) {
    if (line.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(' ')[1])
    } else if (line.startsWith('DOMAIN_MIN')) {
      domainMin = line.split(' ').slice(1).map(Number) as [number, number, number]
    } else if (line.startsWith('DOMAIN_MAX')) {
      domainMax = line.split(' ').slice(1).map(Number) as [number, number, number]
    } else {
      const vals = line.split(' ').map(Number)
      if (vals.length >= 3) {
        data.push(...vals.slice(0, 3))
      }
    }
  }

  // Convert to RGBA (add alpha = 1)
  const rgba = new Float32Array(size * size * size * 4)
  for (let i = 0; i < data.length; i += 3) {
    const idx = (i / 3) * 4
    rgba[idx] = data[i]
    rgba[idx + 1] = data[i + 1]
    rgba[idx + 2] = data[i + 2]
    rgba[idx + 3] = 1.0
  }

  return { size, data: rgba, domainMin, domainMax }
}

function parse3dlFile(text: string): Lut3D {
  // 3DL format parser (simplified)
  const lines = text.split('\n').filter(l => l.trim())
  const size = parseInt(lines[0].trim())
  const data: number[] = []

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].trim().split(/\s+/).map(Number)
    if (vals.length >= 3) {
      data.push(...vals.slice(0, 3))
    }
  }

  const rgba = new Float32Array(size * size * size * 4)
  for (let i = 0; i < data.length; i += 3) {
    const idx = (i / 3) * 4
    rgba[idx] = data[i]
    rgba[idx + 1] = data[i + 1]
    rgba[idx + 2] = data[i + 2]
    rgba[idx + 3] = 1.0
  }

  return {
    size,
    data: rgba,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
  }
}

/** Apply 3D LUT to canvas */
export async function applyLut3D(
  canvas: HTMLCanvasElement,
  lut: Lut3D,
  intensity = 1.0
): Promise<HTMLCanvasElement> {
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(canvas, 0, 0)

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = img.data
  const { size, data: lutData, domainMin, domainMax } = lut

  // Trilinear interpolation
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255

    // Map to LUT domain
    const nr = (r - domainMin[0]) / (domainMax[0] - domainMin[0]) * (lut.size - 1)
    const ng = (g - domainMin[1]) / (domainMax[1] - domainMin[1]) * (lut.size - 1)
    const nb = (b - domainMin[2]) / (domainMax[2] - domainMin[2]) * (lut.size - 1)

    // Trilinear interpolation
    const r0 = Math.floor(nr), r1 = Math.min(r0 + 1, lut.size - 1)
    const ng0 = Math.floor(ng), ng1 = Math.min(ng0 + 1, lut.size - 1)
    const nb0 = Math.floor(nb), nb1 = Math.min(nb0 + 1, lut.size - 1)

    const fr = nr - r0, fg = ng - ng0, fb = nb - nb0

    // 8 corners
    const idx = (x: number, y: number, z: number) => (x * lut.size * lut.size + y * lut.size + z) * 4
    const c000 = lut.data.slice(idx(r0, ng0, nb0), idx(r0, ng0, nb0) + 4)
    const c001 = lut.data.slice(idx(r0, ng0, nb1), idx(r0, ng0, nb1) + 4)
    const c010 = lut.data.slice(idx(r0, ng1, nb0), idx(r0, ng1, nb0) + 4)
    const c011 = lut.data.slice(idx(r0, ng1, nb1), idx(r0, ng1, nb1) + 4)
    const c100 = lut.data.slice(idx(r1, ng0, nb0), idx(r1, ng0, nb0) + 4)
    const c101 = lut.data.slice(idx(r1, ng0, nb1), idx(r1, ng0, nb1) + 4)
    const c110 = lut.data.slice(idx(r1, ng1, nb0), idx(r1, ng1, nb0) + 4)
    const c111 = lut.data.slice(idx(r1, ng1, nb1), idx(r1, ng1, nb1) + 4)

    // Interpolate
    let rOut = 0, gOut = 0, bOut = 0
    // Simplified - would need full trilinear
    // ...

    // Apply intensity
    // data[i] = Math.round(lerp(r, rOut, intensity) * 255)
    // ...
  }

  ctx.putImageData(img, 0, 0)
  return output
}