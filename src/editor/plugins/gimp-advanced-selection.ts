'use client'
// GIMP Advanced Selection Tools
// Select Subject, Object Selection, Select and Mask, Refine Edge, Quick Mask enhancements

import { createCanvas, ctx2d } from '../utils/canvas'

export interface SelectSubjectOptions {
  /** Device to run inference on */
  device: 'cpu' | 'gpu' | 'wasm'
  /** Model size */
  modelSize: 'small' | 'medium' | 'large'
  /** Refine edges after detection */
  refineEdges: boolean
  /** Refine radius */
  refineRadius: number
  /** Output mode */
  output: 'selection' | 'mask' | 'layer-mask' | 'new-layer'
}

export interface ObjectSelectionOptions {
  /** Selection mode */
  mode: 'rectangle' | 'lasso' | 'click'
  /** Click search radius */
  clickSearchRadius: number // percentage
  /** Refinement level */
  refineLevel: 'fast' | 'balanced' | 'thorough'
  /** Detector backend */
  detector: 'builtin' | 'mediapipe' | 'sam' | 'custom'
  /** Custom model URL */
  customModelUrl?: string
  /** Sample */
  sample: 'all-layers' | 'current-layer'
  /** Output */
  output: 'selection' | 'mask' | 'layer-mask' | 'new-layer-with-mask'
}

export interface SelectAndMaskOptions {
  /** View mode */
  viewMode: 'onion-skin' | 'marching-ants' | 'overlay' | 'on-black' | 'on-white' | 'on-layers' | 'black-white'
  /** Opacity */
  opacity: number // 0-100
  /** Show original */
  showOriginal: boolean
  /** High quality preview */
  highQuality: boolean
  /** Edge detection */
  edgeDetection: {
    radius: number
    smartRadius: boolean
  }
  /** Global refinements */
  globalRefinements: {
    smooth: number
    feather: number
    contrast: number
    shiftEdge: number
  }
  /** Edge refinement brush */
  edgeRefinement: {
    size: number
    mode: 'add' | 'subtract'
  }
  /** Output settings */
  output: {
    decontaminateColors: boolean
    outputTo: 'selection' | 'layer-mask' | 'new-layer' | 'new-layer-with-mask' | 'new-document'
  }
}

export interface RefineEdgeOptions {
  /** View mode */
  view: 'standard' | 'quick-mask' | 'marching-ants' | 'overlay' | 'on-black' | 'on-white'
  /** Edge detection */
  edgeDetection: {
    radius: number
    smartRadius: boolean
  }
  /** Adjust edge */
  adjustEdge: {
    smooth: number
    feather: number
    contrast: number
    shiftEdge: number
  }
  /** Output */
  output: 'selection' | 'layer-mask' | 'new-layer' | 'new-document'
  /** Decontaminate colors */
  decontaminateColors: boolean
}

/** Select Subject - AI-powered automatic subject detection */
export async function selectSubject(
  canvas: HTMLCanvasElement,
  options: SelectSubjectOptions = {
    device: 'cpu',
    modelSize: 'medium',
    refineEdges: true,
    refineRadius: 10,
    output: 'selection',
  }
): Promise<HTMLCanvasElement> {
  const { width, height } = canvas

  // This would use a real ML model (MediaPipe Selfie Segmentation, SAM, etc.)
  // For now, return a mock selection based on center-weighted saliency

  const selection = createCanvas(width, height)
  const ctx = ctx2d(selection)

  // Simple center-weighted gradient as placeholder
  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, 0,
    width / 2, height / 2, Math.max(width, height) * 0.6
  )
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  // Apply threshold
  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data
  for (let i = 3; i < data.length; i += 4) {
    data[i] = data[i] > 128 ? 255 : 0
  }
  ctx.putImageData(img, 0, 0)

  // Refine edges if requested
  if (options.refineEdges) {
    return await refineEdges(selection, options.refineRadius)
  }

  return selection
}

/** Object Selection Tool */
export async function objectSelection(
  canvas: HTMLCanvasElement,
  region: { x: number; y: number; width: number; height: number } | { x: number; y: number },
  options: ObjectSelectionOptions = {
    mode: 'rectangle',
    clickSearchRadius: 35,
    refineLevel: 'balanced',
    detector: 'builtin',
    sample: 'all-layers',
    output: 'selection',
  }
): Promise<HTMLCanvasElement> {
  const { width, height } = canvas

  // This would use a real object detection model
  // Placeholder: create selection based on region

  const selection = createCanvas(width, height)
  const ctx = ctx2d(selection)

  if ('width' in region) {
    // Rectangle mode
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(region.x, region.y, region.width, region.height)
  } else {
    // Click mode - flood fill from click point
    // Simplified: create circular selection
    ctx.beginPath()
    ctx.arc(region.x, region.y, 50, 0, Math.PI * 2)
    ctx.fill()
  }

  return await refineEdges(selection, 10)
}

/** Select and Mask Workspace */
export class SelectAndMaskWorkspace {
  private canvas: HTMLCanvasElement
  private originalCanvas: HTMLCanvasElement
  private selectionMask: HTMLCanvasElement
  private options: SelectAndMaskOptions
  private refinementBrush: { x: number; y: number; size: number; mode: 'add' | 'subtract' } | null = null

  constructor(canvas: HTMLCanvasElement, initialMask: HTMLCanvasElement, options: SelectAndMaskOptions) {
    this.originalCanvas = canvas
    this.canvas = canvas
    this.selectionMask = initialMask
    this.options = options
  }

  /** Get current mask */
  getMask(): HTMLCanvasElement {
    return this.selectionMask
  }

  /** Set view mode */
  setViewMode(mode: SelectAndMaskOptions['viewMode']): void {
    this.options.viewMode = mode
  }

  /** Set edge detection */
  setEdgeDetection(radius: number, smartRadius: boolean): void {
    this.options.edgeDetection = { radius, smartRadius }
  }

  /** Set global refinements */
  setGlobalRefinements(refinements: SelectAndMaskOptions['globalRefinements']): void {
    this.options.globalRefinements = refinements
  }

  /** Apply edge refinement brush stroke */
  applyRefinementBrush(x: number, y: number, size: number, mode: 'add' | 'subtract'): void {
    const ctx = ctx2d(this.selectionMask)
    ctx.globalCompositeOperation = mode === 'add' ? 'source-over' : 'destination-out'
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()
  }

  /** Apply global refinements */
  async applyGlobalRefinements(): Promise<HTMLCanvasElement> {
    let mask = this.selectionMask

    // Smooth
    if (this.options.globalRefinements.smooth > 0) {
      mask = await smoothMask(mask, this.options.globalRefinements.smooth)
    }

    // Feather
    if (this.options.globalRefinements.feather > 0) {
      mask = await featherMask(mask, this.options.globalRefinements.feather)
    }

    // Contrast
    if (this.options.globalRefinements.contrast > 0) {
      mask = await contrastMask(mask, this.options.globalRefinements.contrast)
    }

    // Shift Edge
    if (this.options.globalRefinements.shiftEdge !== 0) {
      mask = await shiftEdge(mask, this.options.globalRefinements.shiftEdge)
    }

    // Decontaminate colors if enabled
    if (this.options.output.decontaminateColors) {
      // Would decontaminate edge colors
    }

    this.selectionMask = mask
    return mask
  }

  /** Get preview with current view mode */
  getPreview(): HTMLCanvasElement {
    const { width, height } = this.originalCanvas
    const preview = createCanvas(width, height)
    const ctx = ctx2d(preview)

    // Draw backdrop based on view mode
    switch (this.options.viewMode) {
      case 'onion-skin':
        ctx.globalAlpha = this.options.opacity / 100
        ctx.drawImage(this.originalCanvas, 0, 0)
        ctx.globalAlpha = 1
        // Draw mask as overlay
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = `rgba(255,0,0,${this.options.opacity / 100})`
        ctx.drawImage(this.selectionMask, 0, 0)
        break
      case 'marching-ants':
        ctx.drawImage(this.originalCanvas, 0, 0)
        // Draw marching ants
        drawMarchingAnts(ctx, this.selectionMask)
        break
      case 'overlay':
        ctx.drawImage(this.originalCanvas, 0, 0)
        ctx.globalCompositeOperation = 'multiply'
        ctx.drawImage(this.selectionMask, 0, 0)
        break
      case 'on-black':
        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, width, height)
        ctx.globalCompositeOperation = 'source-over'
        ctx.drawImage(this.originalCanvas, 0, 0)
        ctx.globalCompositeOperation = 'destination-in'
        ctx.drawImage(this.selectionMask, 0, 0)
        break
      case 'on-white':
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        ctx.globalCompositeOperation = 'source-over'
        ctx.drawImage(this.originalCanvas, 0, 0)
        ctx.globalCompositeOperation = 'destination-in'
        ctx.drawImage(this.selectionMask, 0, 0)
        break
      case 'on-layers':
        ctx.drawImage(this.originalCanvas, 0, 0)
        break
      case 'black-white':
        ctx.drawImage(this.selectionMask, 0, 0)
        break
    }

    return preview
  }

  /** Output final result */
  async output(): Promise<HTMLCanvasElement> {
    await this.applyGlobalRefinements()

    const outputMode = this.options.output.outputTo

    if (outputMode === 'selection') {
      return this.selectionMask
    } else if (outputMode === 'layer-mask') {
      // Return as layer mask (grayscale)
      return this.selectionMask
    } else if (outputMode === 'new-layer') {
      const output = createCanvas(this.originalCanvas.width, this.originalCanvas.height)
      const ctx = ctx2d(output)
      ctx.drawImage(this.originalCanvas, 0, 0)
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(this.selectionMask, 0, 0)
      return output
    } else if (outputMode === 'new-layer-with-mask') {
      // Would return object with layer and mask
      return this.selectionMask
    }

    return this.selectionMask
  }
}

/** Refine Edge Dialog */
export async function refineEdge(
  canvas: HTMLCanvasElement,
  initialMask: HTMLCanvasElement,
  options: RefineEdgeOptions = {
    view: 'standard',
    edgeDetection: { radius: 10, smartRadius: false },
    adjustEdge: { smooth: 0, feather: 0, contrast: 0, shiftEdge: 0 },
    output: 'selection',
    decontaminateColors: false,
  }
): Promise<HTMLCanvasElement> {
  let mask = initialMask

  // Edge Detection
  if (options.edgeDetection.radius > 0) {
    mask = await detectEdges(mask, options.edgeDetection.radius, options.edgeDetection.smartRadius)
  }

  // Adjust Edge
  mask = await applyEdgeAdjustments(mask, options.adjustEdge)

  // Decontaminate Colors
  if (options.decontaminateColors) {
    // Would sample colors from edge and remove color contamination
  }

  // Output
  return mask
}

/** Edge Detection */
async function detectEdges(
  mask: HTMLCanvasElement,
  radius: number,
  smartRadius: boolean
): Promise<HTMLCanvasElement> {
  const { width, height } = mask
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Find edges using Sobel
  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data
  const maskCtx = mask.getContext('2d')!
  const maskData = maskCtx.getImageData(0, 0, width, height).data

  // Sobel kernels
  const Gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
  const Gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1]

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4
          const val = maskData[idx] / 255
          const k = (ky + 1) * 3 + (kx + 1)
          gx += val * Gx[k]
          gy += val * Gy[k]
        }
      }
      const magnitude = Math.sqrt(gx * gx + gy * gy)
      const idx = (y * width + x) * 4
      const val = Math.min(255, magnitude * 255)
      data[idx] = data[idx + 1] = data[idx + 2] = magnitude > 0.1 ? 255 : 0
      data[idx + 3] = 255
    }
  }

  ctx.putImageData(img, 0, 0)

  // Dilate by radius
  if (radius > 0) {
    return dilateMask(output, radius)
  }

  return output
}

/** Apply edge adjustments */
async function applyEdgeAdjustments(
  mask: HTMLCanvasElement,
  adjustments: RefineEdgeOptions['adjustEdge']
): Promise<HTMLCanvasElement> {
  let result = mask

  if (adjustments.smooth > 0) {
    result = await smoothMask(result, adjustments.smooth)
  }
  if (adjustments.feather > 0) {
    result = await featherMask(result, adjustments.feather)
  }
  if (adjustments.contrast > 0) {
    result = await contrastMask(result, adjustments.contrast)
  }
  if (adjustments.shiftEdge !== 0) {
    result = await shiftEdge(result, adjustments.shiftEdge)
  }

  return result
}

/** Dilate mask */
async function dilateMask(mask: HTMLCanvasElement, radius: number): Promise<HTMLCanvasElement> {
  const { width, height } = mask
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)
  ctx.drawImage(mask, 0, 0)

  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data
  const inputData = mask.getContext('2d')!.getImageData(0, 0, width, height).data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      if (inputData[idx] === 0) {
        // Check neighbors
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy <= radius * radius) {
              const nx = x + dx, ny = y + dy
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nIdx = (ny * width + nx) * 4
                if (inputData[nIdx] > 128) {
                  data[idx] = data[idx + 1] = data[idx + 2] = 255
                  data[idx + 3] = 255
                  break
                }
              }
            }
          }
        }
      }
    }
  }

  ctx.putImageData(img, 0, 0)
  return output
}

/** Smooth mask */
async function smoothMask(mask: HTMLCanvasElement, radius: number): Promise<HTMLCanvasElement> {
  // Gaussian blur
  const output = createCanvas(mask.width, mask.height)
  const ctx = ctx2d(output)
  ctx.filter = `blur(${radius}px)`
  ctx.drawImage(mask, 0, 0)
  ctx.filter = 'none'

  // Threshold
  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data
  for (let i = 3; i < data.length; i += 4) {
    data[i] = data[i] > 128 ? 255 : 0
  }
  ctx.putImageData(img, 0, 0)

  return output
}

/** Feather mask */
async function featherMask(mask: HTMLCanvasElement, radius: number): Promise<HTMLCanvasElement> {
  const output = createCanvas(mask.width, mask.height)
  const ctx = ctx2d(output)
  ctx.filter = `blur(${radius}px)`
  ctx.drawImage(mask, 0, 0)
  ctx.filter = 'none'
  return output
}

/** Contrast mask */
async function contrastMask(mask: HTMLCanvasElement, amount: number): Promise<HTMLCanvasElement> {
  const output = createCanvas(mask.width, mask.height)
  const ctx = ctx2d(output)
  ctx.filter = `contrast(${1 + amount / 50})`
  ctx.drawImage(mask, 0, 0)
  ctx.filter = 'none'
  return output
}

/** Shift edge */
async function shiftEdge(mask: HTMLCanvasElement, amount: number): Promise<HTMLCanvasElement> {
  if (amount === 0) return mask

  const output = createCanvas(mask.width, mask.height)
  const ctx = ctx2d(output)
  ctx.drawImage(mask, 0, 0)

  if (amount > 0) {
    // Expand
    return dilateMask(mask, Math.abs(amount))
  } else {
    // Contract - erode
    return erodeMask(mask, Math.abs(amount))
  }
}

/** Erode mask */
async function erodeMask(mask: HTMLCanvasElement, radius: number): Promise<HTMLCanvasElement> {
  const { width, height } = mask
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)
  ctx.drawImage(mask, 0, 0)

  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data
  const inputData = mask.getContext('2d')!.getImageData(0, 0, width, height).data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      if (inputData[idx] > 128) {
        let keep = true
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy <= radius * radius) {
              const nx = x + dx, ny = y + dy
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nIdx = (ny * width + nx) * 4
                if (inputData[nIdx] === 0) {
                  keep = false
                  break
                }
              }
            }
          }
          if (!keep) break
        }
      }
      if (!keep) {
        data[idx] = data[idx + 1] = data[idx + 2] = 0
        data[idx + 3] = 0
      }
    }
  }

  ctx.putImageData(img, 0, 0)
  return output
}

/** Refine edges */
async function refineEdges(mask: HTMLCanvasElement, radius: number): Promise<HTMLCanvasElement> {
  let result = mask
  result = await featherMask(result, radius * 0.5)
  result = await contrastMask(result, 20)
  return result
}

/** Quick Mask Mode */
export class QuickMaskMode {
  private canvas: HTMLCanvasElement
  private mask: HTMLCanvasElement
  private color: string
  private opacity: number
  private listeners: Set<() => void> = new Set()

  constructor(canvas: HTMLCanvasElement, initialMask?: HTMLCanvasElement) {
    this.canvas = canvas
    this.mask = initialMask || createCanvas(canvas.width, canvas.height)
    this.color = '#ff0000'
    this.opacity = 50
  }

  getMask(): HTMLCanvasElement {
    return this.mask
  }

  setColor(color: string): void {
    this.color = color
    this.notify()
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity
    this.notify()
  }

  /** Paint on mask */
  paint(x: number, y: number, size: number, hardness: number, opacity: number, mode: 'add' | 'subtract'): void {
    const ctx = ctx2d(this.mask)
    ctx.globalCompositeOperation = mode === 'add' ? 'source-over' : 'destination-out'

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, size)
    gradient.addColorStop(0, `rgba(255,255,255,${opacity * (1 - hardness)})`)
    gradient.addColorStop(1, `rgba(255,255,255,0)`)

    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()

    this.notify()
  }

  /** Fill selection */
  fill(): void {
    const ctx = ctx2d(this.mask)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    this.notify()
  }

  /** Clear selection */
  clear(): void {
    const ctx = ctx2d(this.mask)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.notify()
  }

  /** Invert selection */
  invert(): void {
    const ctx = ctx2d(this.mask)
    const img = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
    const data = img.data
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i]
      data[i + 1] = 255 - data[i + 1]
      data[i + 2] = 255 - data[i + 2]
    }
    ctx.putImageData(img, 0, 0)
    this.notify()
  }

  /** Get preview with overlay */
  getPreview(): HTMLCanvasElement {
    const preview = createCanvas(this.canvas.width, this.canvas.height)
    const ctx = ctx2d(preview)
    ctx.drawImage(this.canvas, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 0.5
    ctx.fillStyle = this.color
    ctx.drawImage(this.mask, 0, 0)
    ctx.globalAlpha = 1
    return preview
  }

  /** Convert to selection */
  toSelection(): HTMLCanvasElement {
    return this.mask
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Selection to Path */
export async function selectionToPath(
  mask: HTMLCanvasElement,
  tolerance = 1.0
): Promise<Path2D> {
  const path = new Path2D()
  const { width, height } = mask
  const ctx = mask.getContext('2d')!
  const data = ctx.getImageData(0, 0, width, height).data

  // Marching squares algorithm
  const visited = new Uint8Array(width * height)

  function getPixel(x: number, y: number): number {
    if (x < 0 || x >= mask.width || y < 0 || y >= mask.height) return 0
    return ctx.getImageData(x, y, 1, 1).data[0]
  }

  // Find contours using marching squares
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = getPixel(x, y) > 128 ? 1 : 0
      const tr = getPixel(x + 1, y) > 128 ? 1 : 0
      const bl = getPixel(x, y + 1) > 128 ? 1 : 0
      const br = getPixel(x + 1, y + 1) > 128 ? 1 : 0

      const caseNum = (tl << 3) | (tr << 2) | (bl << 1) | br

      if (caseNum === 0 || caseNum === 15) continue

      // Marching squares cases - simplified
      // Would implement full marching squares lookup table
    }
  }

  return new Path2D()
}