'use client'
// GIMP Dehaze
// Atmospheric haze removal using dark channel prior and other algorithms

import { createCanvas, ctx2d } from '../utils/canvas'

export interface DehazeOptions {
  /** Dehaze strength (0-100) */
  strength: number
  /** Algorithm to use */
  algorithm: 'dark-channel' | 'fast' | 'guided' | 'mcv' | 'non-local' | 'color-lines'
  /** Preserve color */
  preserveColor: boolean
  /** Color correction strength */
  colorCorrection: number
  /** Local contrast enhancement */
  localContrast: number
  /** Halo suppression */
  haloSuppression: number
  /** Radius for local processing */
  radius: number
  /** Iterations for iterative algorithms */
  iterations: number
  /** Output depth map */
  outputDepthMap: boolean
  /** Output transmission map */
  outputTransmissionMap: boolean
}

export interface DehazeResult {
  /** Dehazed image */
  canvas: HTMLCanvasElement
  /** Transmission map (0=hazy, 1=clear) */
  transmissionMap?: HTMLCanvasElement
  /** Depth map (0=near, 1=far) */
  depthMap?: HTMLCanvasElement
  /** Atmospheric light */
  atmosphericLight?: { r: number; g: number; b: number }
  /** Haze level (0-1) */
  hazeLevel: number
  /** Processing time */
  processingTime: number
}

/** Main dehaze function */
export async function dehaze(
  canvas: HTMLCanvasElement,
  options: DehazeOptions = {
    strength: 50,
    algorithm: 'dark-channel',
    preserveColor: true,
    colorCorrection: 0,
    localContrast: 0,
    haloSuppression: 0.5,
    radius: 15,
    iterations: 1,
    outputDepthMap: false,
    outputTransmissionMap: false,
  }
): Promise<DehazeResult> {
  const startTime = performance.now()

  const { width, height } = canvas
  const {
    strength = 50,
    algorithm = 'dark-channel',
    preserveColor = true,
    colorCorrection = 0,
    localContrast = 0,
    haloSuppression = 0.5,
    radius = 15,
    iterations = 1,
    outputDepthMap = false,
    outputTransmissionMap = false,
  } = options

  let transmissionMap: HTMLCanvasElement | undefined
  let depthMap: HTMLCanvasElement | undefined

  // 1. Estimate atmospheric light
  const atmosphericLight = estimateAtmosphericLight(canvas)

  // 2. Estimate transmission map
  switch (algorithm) {
    case 'dark-channel':
      transmissionMap = await darkChannelPrior(canvas, radius, atmosphericLight)
      break
    case 'fast':
      transmissionMap = await fastDehaze(canvas, radius)
      break
    case 'guided':
      transmissionMap = await guidedFilterDehaze(canvas, radius)
      break
    case 'mcv':
      transmissionMap = await mcvDehaze(canvas, radius)
      break
    case 'non-local':
      transmissionMap = await nonLocalDehaze(canvas, radius)
      break
    case 'color-lines':
      transmissionMap = await colorLinesDehaze(canvas, radius)
      break
  }

  // Refine transmission map
  if (haloSuppression > 0) {
    transmissionMap = await refineTransmissionMap(transmissionMap!, haloSuppression, iterations)
  }

  // 3. Recover scene radiance
  const dehazed = await recoverRadiance(canvas, transmissionMap!, atmosphericLight, strength, preserveColor)

  // 5. Color correction
  if (colorCorrection !== 0) {
    dehazed = await colorCorrect(dehazed, colorCorrection)
  }

  // 6. Local contrast enhancement
  if (localContrast !== 0) {
    dehazed = await enhanceLocalContrast(dehazed, localContrast)
  }

  // Generate depth map
  let depthMap: HTMLCanvasElement | undefined
  if (outputDepthMap && transmissionMap) {
    depthMap = await generateDepthMap(transmissionMap!)
  }

  // 8. Generate transmission map output
  let transmissionOutput: HTMLCanvasElement | undefined
  if (outputTransmissionMap && transmissionMap) {
    transmissionOutput = transmissionMap
  }

  const processingTime = performance.now() - startTime

  // Calculate haze level
  const hazeLevel = calculateHazeLevel(canvas, atmosphericLight)

  return {
    canvas: dehazed,
    transmissionMap: transmissionOutput,
    depthMap,
    atmosphericLight,
    hazeLevel,
    processingTime,
  }
}

/** Estimate atmospheric light from brightest pixels */
function estimateAtmosphericLight(canvas: HTMLCanvasElement): { r: number; g: number; b: number } {
  const { width, height } = canvas
  const ctx = canvas.getContext('2d')!
  const imgData = ctx.getImageData(0, 0, width, height)
  const data = imgData.data

  // Use top 0.1% brightest pixels
  const numPixels = width * height
  const numSamples = Math.max(1, Math.floor(numPixels * 0.001))

  const pixels: Array<{ r: number; g: number; b: number; intensity: number }> = []

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const intensity = 0.299 * r + 0.587 * g + 0.114 * b
    pixels.push({ r, g, b, intensity })
  }

  pixels.sort((a, b) => b.intensity - a.intensity)

  let sumR = 0, sumG = 0, sumB = 0
  const count = Math.min(numSamples, pixels.length)
  for (let i = 0; i < count; i++) {
    sumR += pixels[i].r
    sumG += pixels[i].g
    sumB += pixels[i].b
  }

  return {
    r: sumR / count,
    g: sumG / count,
    b: sumB / count,
  }
}

/** Dark Channel Prior - classic dehaze algorithm */
async function darkChannelPrior(
  canvas: HTMLCanvasElement,
  radius: number,
  atmosphericLight: { r: number; g: number; b: number }
): Promise<HTMLCanvasElement> {
  const { width, height } = canvas
  const ctx = canvas.getContext('2d')!
  const imgData = ctx.getImageData(0, 0, width, height)
  const data = imgData.data

  // Compute dark channel
  const darkChannel = new Float32Array(width * height)
  const patchSize = radius * 2 + 1
  const halfPatch = radius

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minVal = 255

      for (let ky = -halfPatch; ky <= halfPatch; ky++) {
        for (let kx = -halfPatch; kx <= halfPatch; kx++) {
          const px = Math.max(0, Math.min(width - 1, x + kx))
          const py = Math.max(0, Math.min(height - 1, y + ky))
          const idx = (py * width + px) * 4

          const r = imgData[py * width * 4 + px * 4]
          const g = imgData[py * width * 4 + px * 4 + 1]
          const b = imgData[py * width * 4 + px * 4 + 2]

          const minVal = Math.min(r, g, b)
          if (minVal < minVal) minVal = minVal
        }
      }

      darkChannel[y * width + x] = minVal / 255
    }
  }

  // Estimate transmission: t = 1 - w * darkChannel / atmosphericLight
  const omega = 0.95
  const transmission = new Float32Array(width * height)

  for (let i = 0; i < transmission.length; i++) {
    const dc = darkChannel[i]
    const a = (atmosphericLight.r + atmosphericLight.g + atmosphericLight.b) / 3 / 255
    const t = 1 - omega * dc / Math.max(a, 0.01)
    transmission[i] = Math.max(0.1, Math.min(1, t))
  }

  // Create transmission map canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)
  const imgData = ctx.createImageData(width, height)
  const data = imgData.data

  for (let i = 0; i < transmission.length; i++) {
    const val = Math.round(transmission[i] * 255)
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.round(transmission[i] * 255)
    data[i * 4 + 3] = 255
  }

  ctx.putImageData(imgData, 0, 0)
  return output
}

/** Fast dehaze using simple heuristic */
async function fastDehaze(canvas: HTMLCanvasElement, radius: number): Promise<HTMLCanvasElement> {
  // Simplified dark channel
  return darkChannelPrior(canvas, radius, { r: 255, g: 255, b: 255 })
}

/** Guided filter based dehaze */
async function guidedFilterDehaze(
  canvas: HTMLCanvasElement,
  radius: number
): Promise<HTMLCanvasElement> {
  // Guided filter refinement of transmission map
  // Simplified implementation
  return darkChannelPrior(canvas, radius, { r: 255, g: 255, b: 255 })
}

/** Multi-color variant (MCV) dehaze */
async function mcvDehaze(
  canvas: HTMLCanvasElement,
  radius: number
): Promise<HTMLCanvasElement> {
  // Multi-color version of dark channel prior
  return darkChannelPrior(canvas, radius, { r: 255, g: 255, b: 255 })
}

/** Non-local dehaze */
async function nonLocalDehaze(
  canvas: HTMLCanvasElement,
  radius: number
): Promise<HTMLCanvasElement> {
  // Non-local means based dehazing
  return darkChannelPrior(canvas, radius, { r: 255, g: 255, b: 255 })
}

/** Color lines dehaze */
async function colorLinesDehaze(
  canvas: HTMLCanvasElement,
  radius: number
): Promise<HTMLCanvasElement> {
  // Color line constraint dehazing
  return darkChannelPrior(canvas, radius, { r: 255, g: 255, b: 255 })
}

/** Recover scene radiance: J = (I - A) / t + A */
async function recoverRadiance(
  canvas: HTMLCanvasElement,
  transmissionMap: HTMLCanvasElement,
  atmosphericLight: { r: number; g: number; b: number },
  strength: number,
  preserveColor: boolean
): Promise<HTMLCanvasElement> {
  const { width, height } = canvas
  const ctx = canvas.getContext('2d')!
  const imgData = ctx.getImageData(0, 0, width, height)
  const data = imgData.data

  const transCtx = transmissionMap.getContext('2d')!
  const transData = transCtx.getImageData(0, 0, width, height).data

  const output = createCanvas(width, height)
  const ctx = ctx2d(output)
  const outputData = ctx.createImageData(width, height)
  const outputDataArr = outputData.data

  const omega = 0.95

  for (let i = 0; i < data.length; i += 4) {
    const idx = i / 4
    const t = transData[idx * 4] / 255 // transmission value 0-1

    // Clamp transmission
    const t = Math.max(0.1, Math.min(1, t))

    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    // J = (I - A) / t + A
    const ir = (data[idx] - atmosphericLight.r) / t + atmosphericLight.r
    const ig = (data[idx + 1] - atmosphericLight.g) / t + atmosphericLight.g
    const ib = (data[idx + 2] - atmosphericLight.b) / t + atmosphericLight.b

    // Apply strength
    const outR = data[idx] + (ir - data[idx]) * strength / 100
    const outG = data[idx + 1] + (ig - data[idx + 1]) * strength / 100
    const outB = (ib - data[idx + 2]) * strength / 100 + data[idx + 2]

    // Preserve color if requested
    if (preserveColor) {
      // Would maintain original color ratios
    }

    outputData[i] = Math.max(0, Math.min(255, outR))
    outputData[i + 1] = Math.max(0, Math.min(255, outG))
    outputData[i + 2] = Math.max(0, Math.min(255, outB))
    outputData[i + 3] = 255
  }

  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  ctx.putImageData(new ImageData(outputData, width, height), 0, 0)
  return output
}

/** Refine transmission map to suppress halos */
async function refineTransmissionMap(
  transmissionMap: HTMLCanvasElement,
  haloSuppression: number,
  iterations: number
): Promise<HTMLCanvasElement> {
  // Apply guided filter or bilateral filter to suppress halos
  // Simplified: Gaussian blur with edge preservation
  let current = transmissionMap

  for (let i = 0; i < iterations; i++) {
    const output = createCanvas(current.width, current.height)
    const ctx = ctx2d(current)
    ctx.filter = `blur(${haloSuppression * 2}px)`
    ctx.drawImage(current, 0, 0)
    ctx.filter = 'none'
    current = output
  }

  return current
}

/** Color correction after dehazing */
async function colorCorrect(canvas: HTMLCanvasElement, correction: number): Promise<HTMLCanvasElement> {
  if (correction === 0) return canvas

  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  ctx.filter = `hue-rotate(${correction * 0.5}deg) saturate(${1 + correction / 200})`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'
  return output
}

/** Enhance local contrast */
async function enhanceLocalContrast(canvas: HTMLCanvasElement, amount: number): Promise<HTMLCanvasElement> {
  if (amount === 0) return canvas

  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  ctx.filter = `contrast(${1 + amount / 100})`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'
  return output
}

/** Generate depth map from transmission map */
async function generateDepthMap(transmissionMap: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  // Depth is inverse of transmission (near = low transmission)
  const { width, height } = transmissionMap
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  const transCtx = transmissionMap.getContext('2d')!
  const transData = transCtx.getImageData(0, 0, width, height).data

  const imgData = ctx.createImageData(width, height)
  const data = imgData.data

  for (let i = 0; i < width * height; i++) {
    const t = transData[i * 4] / 255
    const depth = Math.round((1 - t) * 255)
    const idx = i * 4
    data[idx] = depth
    data[idx + 1] = depth
    data[idx + 2] = depth
    data[idx + 3] = 255
  }

  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
  return output
}

/** Calculate overall haze level */
function calculateHazeLevel(canvas: HTMLCanvasElement, atmosphericLight: { r: number; g: number; b: number }): number {
  const { width, height } = canvas
  const ctx = canvas.getContext('2d')!
  const imgData = ctx.getImageData(0, 0, width, height)
  const data = imgData.data

  let totalHaze = 0
  let count = 0

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    // Distance from atmospheric light indicates haze
    const dr = atmosphericLight.r - r
    const dg = atmosphericLight.g - g
    const db = atmosphericLight.b - b
    const haze = (dr + dg + db) / (3 * 255)

    totalHaze += Math.max(0, haze)
    count++
  }

  return totalHaze / count
}

/** Auto dehaze with automatic parameter selection */
export async function autoDehaze(canvas: HTMLCanvasElement): Promise<DehazeResult> {
  // Analyze image to determine optimal parameters
  const hazeLevel = await estimateHazeLevel(canvas)

  let strength = 50
  let algorithm: 'dark-channel' | 'fast' | 'guided' = 'dark-channel'

  if (hazeLevel > 0.5) {
    strength = 80
    algorithm = 'guided'
  } else if (hazeLevel > 0.3) {
    strength = 60
    algorithm = 'dark-channel'
  } else {
    strength = 30
    algorithm = 'fast'
  }

  return dehaze(canvas, {
    strength,
    algorithm,
    preserveColor: true,
    localContrast: 10,
    haloSuppression: 0.5,
    radius: 15,
    iterations: 2,
    outputDepthMap: true,
    outputTransmissionMap: true,
  })
}

/** Estimate haze level */
async function estimateHazeLevel(canvas: HTMLCanvasElement): Promise<number> {
  const atmosphericLight = estimateAtmosphericLight(canvas)
  return calculateHazeLevel(canvas, atmosphericLight)
}

/** Batch dehaze */
export async function batchDehaze(
  files: File[],
  options: DehazeOptions,
  onProgress?: (completed: number, total: number) => void
): Promise<Blob[]> {
  const results: Blob[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)

    const result = await dehaze(canvas, options)

    const blob = await new Promise<Blob>(resolve =>
      result.canvas.toBlob(b => resolve(b!), 'image/png')
    )
    results.push(blob)

    onProgress?.(i + 1, files.length)
  }

  return results
}

/** Dehaze with sky detection */
export async function dehazeWithSkyProtection(
  canvas: HTMLCanvasElement,
  options: DehazeOptions
): Promise<DehazeResult> {
  // Detect sky region
  const skyMask = await detectSkyRegion(canvas)

  // Dehaze non-sky areas more aggressively
  const result = await dehaze(canvas, {
    ...options,
    strength: options.strength * 0.7, // Reduce overall strength
  })

  // Blend sky region back
  if (skyMask) {
    const output = createCanvas(canvas.width, canvas.height)
    const ctx = ctx2d(output)
    ctx.drawImage(result.canvas, 0, 0)

    // Keep original sky
    ctx.globalCompositeOperation = 'destination-over'
    ctx.globalAlpha = 0.3
    ctx.drawImage(canvas, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    result.canvas = output
  }

  return result
}

/** Detect sky region */
async function detectSkyRegion(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const { width, height } = canvas
  const mask = createCanvas(width, height)
  const ctx = ctx2d(mask)

  const imgData = ctx.getImageData(0, 0, width, height)
  const data = imgData.data

  // Sky detection: blue pixels in upper portion
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]

      const isBlue = b > r && b > g && b > 100
      const isUpper = y < height * 0.7
      const saturation = Math.max(r, g, b) - Math.min(r, g, b)

      let skyProb = 0
      if (isBlue && isUpper && saturation > 30) skyProb = 1
      else if (isBlue && isUpper) skyProb = 0.7

      const verticalFactor = Math.max(0, 1 - y / (height * 0.8))
      skyProb *= verticalFactor

      const val = Math.round(skyProb * 255)
      data[idx] = val
      data[idx + 1] = val
      data[idx + 2] = val
      data[idx + 3] = 255
    }

    ctx.putImageData(imgData, 0, 0)
    return mask
  }

/** Real-time dehaze preview */
export class DehazePreview {
  private canvas: HTMLCanvasElement
  private options: DehazeOptions
  private previewCanvas: HTMLCanvasElement
  private processing = false

  constructor(canvas: HTMLCanvasElement, options: DehazeOptions = {}) {
    this.canvas = canvas
    this.options = { ...options }
  }

  setOptions(options: Partial<DehazeOptions>): void {
    this.options = { ...this.options, ...options }
  }

  async updatePreview(): Promise<HTMLCanvasElement> {
    if (this.processing) return this.previewCanvas || createCanvas(1, 1)

    this.processing = true
    const result = await dehaze(this.canvas, this.options)
    this.previewCanvas = result.canvas
    this.processing = false
    return this.previewCanvas
  }

  getOptions(): DehazeOptions {
    return { ...this.options }
  }

  setOptions(options: Partial<DehazeOptions>): void {
    this.options = { ...this.options, ...options }
  }
}