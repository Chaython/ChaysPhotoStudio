'use client'
// GEGL (Generic Graphics Library) operation compatibility layer
// Implements common GEGL operations used by GIMP 3.0 filters
// GEGL ops are node-based image processing operations

import { createCanvas, ctx2d } from '../utils/canvas'

export interface GeglOperation {
  name: string
  title: string
  description: string
  categories: string[]
  properties: GeglProperty[]
}

export interface GeglProperty {
  name: string
  type: 'double' | 'int' | 'string' | 'boolean' | 'color' | 'curve' | 'matrix' | 'enum'
  label: string
  description: string
  default: any
  minimum?: number
  maximum?: number
  step?: number
  enumValues?: { value: string; label: string }[]
}

export interface GeglNode {
  operation: string
  properties: Record<string, any>
  inputs: Record<string, GeglNode>
  output?: string
}

// Common GEGL operations used by GIMP
export const GEGL_OPERATIONS = new Map<string, GeglOperation>([
  ['gegl:gaussian-blur', {
    name: 'gegl:gaussian-blur',
    title: 'Gaussian Blur',
    description: 'Blurs the input using a Gaussian kernel',
    categories: ['blur'],
    properties: [
      { name: 'std-dev-x', type: 'double', label: 'Horizontal radius', description: 'Standard deviation in X direction', default: 10, minimum: 0, maximum: 1000 },
      { name: 'std-dev-y', type: 'double', label: 'Vertical radius', description: 'Standard deviation in Y direction', default: 10, minimum: 0, maximum: 1000 },
      { name: 'blur-type', type: 'enum', label: 'Blur type', description: 'Blur algorithm', default: 'gaussian',
        enumValues: [{ value: 'gaussian', label: 'Gaussian (RLE)' }, { value: 'gaussian-iir', label: 'Gaussian (IIR)' }, { value: 'box', label: 'Box' }] },
    ],
  }],
  ['gegl:box-blur', {
    name: 'gegl:box-blur',
    title: 'Box Blur',
    description: 'Fast box blur approximation',
    categories: ['blur'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', description: 'Blur radius', default: 10, minimum: 0, maximum: 500 },
    ],
  }],
  ['gegl:motion-blur', {
    name: 'gegl:motion-blur',
    title: 'Motion Blur',
    description: 'Directional motion blur',
    categories: ['blur'],
    properties: [
      { name: 'length', type: 'double', label: 'Length', description: 'Blur length', default: 20, minimum: 0, maximum: 500 },
      { name: 'angle', type: 'double', label: 'Angle', description: 'Motion angle in degrees', default: 0, minimum: 0, maximum: 360 },
      { name: 'center', type: 'double', label: 'Center', description: 'Center of blur (0-1)', default: 0.5, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:lens-blur', {
    name: 'gegl:lens-blur',
    title: 'Lens Blur',
    description: 'Simulates camera lens bokeh',
    categories: ['blur'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', description: 'Blur radius', default: 10, minimum: 0, maximum: 200 },
      { name: 'blades', type: 'int', label: 'Blades', description: 'Number of aperture blades', default: 5, minimum: 3, maximum: 20 },
      { name: 'angle', type: 'double', label: 'Angle', description: 'Rotation angle', default: 0, minimum: 0, maximum: 360 },
      { name: 'curvature', type: 'double', label: 'Curvature', description: 'Blade curvature', default: 0, minimum: -1, maximum: 1 },
    ],
  }],
  ['gegl:unsharp-mask', {
    name: 'gegl:unsharp-mask',
    title: 'Unsharp Mask',
    description: 'Sharpens using unsharp masking',
    categories: ['enhance'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', description: 'Blur radius for unsharp mask', default: 5, minimum: 0, maximum: 200 },
      { name: 'amount', type: 'double', label: 'Amount', description: 'Sharpening amount', default: 1.0, minimum: 0, maximum: 10 },
      { name: 'threshold', type: 'double', label: 'Threshold', description: 'Threshold for edge detection', default: 0, minimum: 0, maximum: 255 },
    ],
  }],
  ['gegl:high-pass', {
    name: 'gegl:high-pass',
    title: 'High Pass',
    description: 'High-pass filter for edge enhancement',
    categories: ['enhance'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', description: 'Filter radius', default: 10, minimum: 0.1, maximum: 500 },
    ],
  }],
  ['gegl:noise-reduction', {
    name: 'gegl:noise-reduction',
    title: 'Noise Reduction',
    description: 'Reduces image noise while preserving edges',
    categories: ['enhance'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', description: 'Neighborhood radius', default: 3, minimum: 1, maximum: 20 },
      { name: 'strength', type: 'double', label: 'Strength', description: 'Denoising strength', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'preserve-edges', type: 'double', label: 'Preserve edges', description: 'Edge preservation factor', default: 0.5, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:bilateral-filter', {
    name: 'gegl:bilateral-filter',
    title: 'Bilateral Filter',
    description: 'Edge-preserving smoothing filter',
    categories: ['enhance'],
    properties: [
      { name: 'spatial-radius', type: 'double', label: 'Spatial radius', description: 'Spatial kernel radius', default: 5, minimum: 1, maximum: 50 },
      { name: 'color-radius', type: 'double', label: 'Color radius', description: 'Color similarity radius', default: 0.1, minimum: 0.01, maximum: 1 },
    ],
  }],
  ['gegl:color-temperature', {
    name: 'gegl:color-temperature',
    title: 'Color Temperature',
    description: 'Adjusts color temperature and tint',
    categories: ['color'],
    properties: [
      { name: 'temperature', type: 'double', label: 'Temperature', description: 'Color temperature (Kelvin)', default: 6500, minimum: 1000, maximum: 25000 },
      { name: 'tint', type: 'double', label: 'Tint', description: 'Green/Magenta tint', default: 0, minimum: -1, maximum: 1 },
      { name: 'preserve-luminance', type: 'boolean', label: 'Preserve luminance', description: 'Keep brightness constant', default: true },
    ],
  }],
  ['gegl:vibrance', {
    name: 'gegl:vibrance',
    title: 'Vibrance',
    description: 'Smart saturation adjustment',
    categories: ['color'],
    properties: [
      { name: 'vibrance', type: 'double', label: 'Vibrance', description: 'Vibrance amount', default: 0, minimum: -100, maximum: 100 },
      { name: 'saturation', type: 'double', label: 'Saturation', description: 'Global saturation', default: 0, minimum: -100, maximum: 100 },
    ],
  }],
  ['gegl:hue-saturation', {
    name: 'gegl:hue-saturation',
    title: 'Hue-Saturation',
    description: 'Adjusts hue, saturation, and lightness',
    categories: ['color'],
    properties: [
      { name: 'hue', type: 'double', label: 'Hue', description: 'Hue shift', default: 0, minimum: -180, maximum: 180 },
      { name: 'saturation', type: 'double', label: 'Saturation', description: 'Saturation multiplier', default: 1, minimum: 0, maximum: 3 },
      { name: 'lightness', type: 'double', label: 'Lightness', description: 'Lightness adjustment', default: 0, minimum: -1, maximum: 1 },
      { name: 'range', type: 'double', label: 'Range', description: 'Color range to affect', default: 1, minimum: 0, maximum: 1 },
      { name: 'overlap', type: 'double', label: 'Overlap', description: 'Range overlap', default: 0, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:color-balance', {
    name: 'gegl:color-balance',
    title: 'Color Balance',
    description: 'Adjusts color balance in shadows, midtones, highlights',
    categories: ['color'],
    properties: [
      { name: 'shadows-cyan-red', type: 'double', label: 'Shadows Cyan/Red', default: 0, minimum: -100, maximum: 100 },
      { name: 'shadows-magenta-green', type: 'double', label: 'Shadows Magenta/Green', default: 0, minimum: -100, maximum: 100 },
      { name: 'shadows-yellow-blue', type: 'double', label: 'Shadows Yellow/Blue', default: 0, minimum: -100, maximum: 100 },
      { name: 'midtones-cyan-red', type: 'double', label: 'Midtones Cyan/Red', default: 0, minimum: -100, maximum: 100 },
      { name: 'midtones-magenta-green', type: 'double', label: 'Midtones Magenta/Green', default: 0, minimum: -100, maximum: 100 },
      { name: 'midtones-yellow-blue', type: 'double', label: 'Midtones Yellow/Blue', default: 0, minimum: -100, maximum: 100 },
      { name: 'highlights-cyan-red', type: 'double', label: 'Highlights Cyan/Red', default: 0, minimum: -100, maximum: 100 },
      { name: 'highlights-magenta-green', type: 'double', label: 'Highlights Magenta/Green', default: 0, minimum: -100, maximum: 100 },
      { name: 'highlights-yellow-blue', type: 'double', label: 'Highlights Yellow/Blue', default: 0, minimum: -100, maximum: 100 },
      { name: 'preserve-luminosity', type: 'boolean', label: 'Preserve luminosity', default: true },
    ],
  }],
  ['gegl:levels', {
    name: 'gegl:levels',
    title: 'Levels',
    description: 'Adjusts input/output levels',
    categories: ['color'],
    properties: [
      { name: 'channel', type: 'enum', label: 'Channel', default: 'value',
        enumValues: [{ value: 'value', label: 'Value' }, { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' }, { value: 'alpha', label: 'Alpha' }] },
      { name: 'input-low', type: 'double', label: 'Input low', default: 0, minimum: 0, maximum: 255 },
      { name: 'input-high', type: 'double', label: 'Input high', default: 255, minimum: 0, maximum: 255 },
      { name: 'gamma', type: 'double', label: 'Gamma', default: 1, minimum: 0.1, maximum: 10 },
      { name: 'output-low', type: 'double', label: 'Output low', default: 0, minimum: 0, maximum: 255 },
      { name: 'output-high', type: 'double', label: 'Output high', default: 255, minimum: 0, maximum: 255 },
    ],
  }],
  ['gegl:curves', {
    name: 'gegl:curves',
    title: 'Curves',
    description: 'Adjusts tonal curves',
    categories: ['color'],
    properties: [
      { name: 'channel', type: 'enum', label: 'Channel', default: 'value',
        enumValues: [{ value: 'value', label: 'Value' }, { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' }, { value: 'alpha', label: 'Alpha' }] },
      { name: 'curve', type: 'curve', label: 'Curve', description: 'Control points', default: [[0, 0], [255, 255]] },
    ],
  }],
  ['gegl:exposure', {
    name: 'gegl:exposure',
    title: 'Exposure',
    description: 'Adjusts exposure, offset, and gamma',
    categories: ['color'],
    properties: [
      { name: 'exposure', type: 'double', label: 'Exposure', default: 0, minimum: -10, maximum: 10 },
      { name: 'offset', type: 'double', label: 'Offset', default: 0, minimum: -1, maximum: 1 },
      { name: 'gamma', type: 'double', label: 'Gamma', default: 1, minimum: 0.1, maximum: 10 },
      { name: 'black-level', type: 'double', label: 'Black level', default: 0, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:shadows-highlights', {
    name: 'gegl:shadows-highlights',
    title: 'Shadows/Highlights',
    description: 'Recovers detail in shadows and highlights',
    categories: ['color'],
    properties: [
      { name: 'shadows-strength', type: 'double', label: 'Shadows strength', default: 50, minimum: 0, maximum: 100 },
      { name: 'shadows-radius', type: 'double', label: 'Shadows radius', default: 50, minimum: 1, maximum: 500 },
      { name: 'highlights-strength', type: 'double', label: 'Highlights strength', default: 50, minimum: 0, maximum: 100 },
      { name: 'highlights-radius', type: 'double', label: 'Highlights radius', default: 50, minimum: 1, maximum: 500 },
      { name: 'midtones', type: 'double', label: 'Midtones', default: 0, minimum: -100, maximum: 100 },
    ],
  }],
  ['gegl:bloom', {
    name: 'gegl:bloom',
    title: 'Bloom',
    description: 'Adds glow to bright areas',
    categories: ['artistic'],
    properties: [
      { name: 'threshold', type: 'double', label: 'Threshold', default: 0.8, minimum: 0, maximum: 1 },
      { name: 'radius', type: 'double', label: 'Radius', default: 20, minimum: 0, maximum: 500 },
      { name: 'intensity', type: 'double', label: 'Intensity', default: 1, minimum: 0, maximum: 10 },
    ],
  }],
  ['gegl:vignette', {
    name: 'gegl:vignette',
    title: 'Vignette',
    description: 'Darkens or lightens image corners',
    categories: ['artistic'],
    properties: [
      { name: 'radius', type: 'double', label: 'Radius', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'softness', type: 'double', label: 'Softness', default: 0.5, minimum: 0, maximum: 1 },
      { name: 'amount', type: 'double', label: 'Amount', default: -0.5, minimum: -1, maximum: 1 },
      { name: 'shape', type: 'double', label: 'Shape', default: 0.5, minimum: 0, maximum: 1 },
    ],
  }],
  ['gegl:lens-distortion', {
    name: 'gegl:lens-distortion',
    title: 'Lens Distortion',
    description: 'Corrects or adds lens distortion',
    categories: ['transform'],
    properties: [
      { name: 'main', type: 'double', label: 'Main', default: 0, minimum: -100, maximum: 100 },
      { name: 'edge', type: 'double', label: 'Edge', default: 0, minimum: -100, maximum: 100 },
      { name: 'zoom', type: 'double', label: 'Zoom', default: 1, minimum: 0.1, maximum: 10 },
      { name: 'brighten', type: 'double', label: 'Brighten', default: 0, minimum: -1, maximum: 1 },
    ],
  }],
  ['gegl:perspective', {
    name: 'gegl:perspective',
    title: 'Perspective Transform',
    description: 'Applies perspective transformation',
    categories: ['transform'],
    properties: [
      { name: 'x0', type: 'double', label: 'Top-left X', default: 0 },
      { name: 'y0', type: 'double', label: 'Top-left Y', default: 0 },
      { name: 'x1', type: 'double', label: 'Top-right X', default: 1 },
      { name: 'y1', type: 'double', label: 'Top-right Y', default: 0 },
      { name: 'x2', type: 'double', label: 'Bottom-right X', default: 1 },
      { name: 'y2', type: 'double', label: 'Bottom-right Y', default: 1 },
      { name: 'x3', type: 'double', label: 'Bottom-left X', default: 0 },
      { name: 'y3', type: 'double', label: 'Bottom-left Y', default: 1 },
      { name: 'interpolation', type: 'enum', label: 'Interpolation', default: 'cubic',
        enumValues: [{ value: 'none', label: 'None' }, { value: 'linear', label: 'Linear' }, { value: 'cubic', label: 'Cubic' }, { value: 'lohalo', label: 'LoHalo' }, { value: 'nohalo', label: 'NoHalo' }] },
      { name: 'clip', type: 'enum', label: 'Clip', default: 'adjust',
        enumValues: [{ value: 'adjust', label: 'Adjust' }, { value: 'clip', label: 'Clip' }, { value: 'crop', label: 'Crop' }, { value: 'crop-with-aspect', label: 'Crop with aspect' }] },
    ],
  }],
  ['gegl:seamless-clone', {
    name: 'gegl:seamless-clone',
    title: 'Seamless Clone',
    description: 'Blends a source into destination seamlessly',
    categories: ['composite'],
    properties: [
      { name: 'x', type: 'double', label: 'X position', default: 0 },
      { name: 'y', type: 'double', label: 'Y position', default: 0 },
      { name: 'mode', type: 'enum', label: 'Mode', default: 'normal',
        enumValues: [{ value: 'normal', label: 'Normal' }, { value: 'max', label: 'Max' }, { value: 'min', label: 'Min' }] },
    ],
  }],
])

// GEGL graph processor
export class GeglGraph {
  private nodes: GeglNode[] = []

  addNode(op: string, properties: Record<string, any> = {}, inputs: Record<string, GeglNode> = {}): GeglNode {
    const node: GeglNode = { operation: op, properties, inputs }
    this.nodes.push(node)
    return node
  }

  // Process the graph - in a real implementation this would use GEGL
  // For now, we provide canvas-based fallbacks for common operations
  async process(input: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    let current = input
    for (const node of this.nodes) {
      current = await this.processNode(node, current)
    }
    return current
  }

  private async processNode(node: GeglNode, input: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    const op = GEGL_OPERATIONS.get(node.operation)
    if (!op) {
      console.warn(`Unknown GEGL operation: ${node.operation}`)
      return input
    }

    const props = { ...op.properties.reduce((acc, p) => { acc[p.name] = p.default; return acc }, {} as Record<string, any>), ...node.properties }

    switch (node.operation) {
      case 'gegl:gaussian-blur':
        return this.applyGaussianBlur(input, props['std-dev-x'], props['std-dev-y'])
      case 'gegl:box-blur':
        return this.applyBoxBlur(input, props['radius'])
      case 'gegl:unsharp-mask':
        return this.applyUnsharpMask(input, props['radius'], props['amount'], props['threshold'])
      case 'gegl:vibrance':
        return this.applyVibrance(input, props['vibrance'], props['saturation'])
      case 'gegl:hue-saturation':
        return this.applyHueSaturation(input, props['hue'], props['saturation'], props['lightness'])
      case 'gegl:color-balance':
        return this.applyColorBalance(input, props)
      case 'gegl:levels':
        return this.applyLevels(input, props)
      case 'gegl:curves':
        return this.applyCurves(input, props['curve'])
      case 'gegl:exposure':
        return this.applyExposure(input, props['exposure'], props['offset'], props['gamma'])
      case 'gegl:vignette':
        return this.applyVignette(input, props['radius'], props['softness'], props['amount'])
      default:
        console.warn(`GEGL operation ${node.operation} not implemented in fallback`)
        return input
    }
  }

  private async applyGaussianBlur(input: HTMLCanvasElement, rx: number, ry: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `blur(${(rx + ry) / 2}px)`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyBoxBlur(input: HTMLCanvasElement, radius: number): Promise<HTMLCanvasElement> {
    return this.applyGaussianBlur(input, radius, radius)
  }

  private async applyUnsharpMask(input: HTMLCanvasElement, radius: number, amount: number, threshold: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    // Simplified unsharp mask using canvas filters
    ctx.filter = `contrast(${1 + amount}) brightness(${1 + amount * 0.1})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyVibrance(input: HTMLCanvasElement, vibrance: number, saturation: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    const totalSat = saturation + vibrance * 0.5
    ctx.filter = `saturate(${1 + totalSat / 100})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyHueSaturation(input: HTMLCanvasElement, hue: number, saturation: number, lightness: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `hue-rotate(${hue}deg) saturate(${1 + saturation / 100}) brightness(${1 + lightness / 100})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyColorBalance(input: HTMLCanvasElement, props: Record<string, any>): Promise<HTMLCanvasElement> {
    // Simplified - would need pixel manipulation for true color balance
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    return canvas
  }

  private async applyLevels(input: HTMLCanvasElement, props: Record<string, any>): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    const gamma = props['gamma'] || 1
    const inputLow = props['input-low'] || 0
    const inputHigh = props['input-high'] || 255
    // Approximate with contrast/brightness
    ctx.filter = `brightness(${(inputLow / 255) * 0.5}) contrast(${(inputHigh / 255) * 2})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyCurves(input: HTMLCanvasElement, curve: number[][]): Promise<HTMLCanvasElement> {
    // Would need a LUT or pixel manipulation
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)
    return canvas
  }

  private async applyExposure(input: HTMLCanvasElement, exposure: number, offset: number, gamma: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.filter = `brightness(${1 + exposure}) contrast(${gamma})`
    ctx.drawImage(input, 0, 0)
    ctx.filter = 'none'
    return canvas
  }

  private async applyVignette(input: HTMLCanvasElement, radius: number, softness: number, amount: number): Promise<HTMLCanvasElement> {
    const canvas = createCanvas(input.width, input.height)
    const ctx = ctx2d(canvas)
    ctx.drawImage(input, 0, 0)

    // Draw vignette overlay
    const gradient = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, 0,
      canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * radius
    )
    gradient.addColorStop(0, 'rgba(0,0,0,0)')
    gradient.addColorStop(1, `rgba(0,0,0,${Math.abs(amount)})`)
    ctx.globalCompositeOperation = amount < 0 ? 'multiply' : 'screen'
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'source-over'
    return canvas
  }
}

// Helper: Create a GEGL graph for common GIMP filter pipelines
export function createGeglGraphForFilter(filterName: string, params: Record<string, any>): GeglGraph {
  const graph = new GeglGraph()
  const op = GEGL_OPERATIONS.get(filterName)
  if (op) {
    graph.addNode(filterName, params)
  }
  return graph
}

// Export operation list for UI
export function getGeglOperations(): GeglOperation[] {
  return Array.from(GEGL_OPERATIONS.values()).sort((a, b) => a.title.localeCompare(b.title))
}

export function getGeglOperation(name: string): GeglOperation | undefined {
  return GEGL_OPERATIONS.get(name)
}