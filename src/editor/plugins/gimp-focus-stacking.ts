'use client'
// GIMP Focus Stacking
// Combine multiple images at different focus distances into single all-in-focus image

import { createCanvas, ctx2d } from '../utils/canvas'

export interface FocusStackingOptions {
  /** Input images at different focus distances */
  images: HTMLCanvasElement[]
  /** Focus distances for each image (meters) */
  focusDistances?: number[]
  /** Alignment method */
  alignment: 'auto' | 'feature' | 'eyes' | 'manual'
  /** Stacking method */
  method: 'weighted' | 'pyramid' | 'depth-map' | 'entropy' | 'contrast' | 'variance' | 'laplacian' | 'tenengrad' | 'brenner' | 'spatial-frequency'
  /** Quality threshold */
  qualityThreshold: number
  /** Smoothing radius */
  smoothingRadius: number
  /** Consistency check */
  consistencyCheck: boolean
  /** Output depth map */
  outputDepthMap: boolean
  /** Depth map scale */
  depthMapScale: number
  /** Edge preservation */
  edgePreservation: number
  /** Weight function for weighted average */
  weightFunction: 'gaussian' | 'laplacian' | 'gradient' | 'entropy' | 'custom'
  /** Custom weight function */
  customWeightFunction?: (patch: number[][][]) => number
  /** Smoothing iterations */
  smoothingIterations: number
  /** Pyramid levels for pyramid method */
  pyramidLevels: number
  /** Blend method for seams */
  seamBlendMethod: 'feather' | 'multiband' | 'optimal' | 'none'
  /** Output depth map format */
  depthMapFormat: 'grayscale' | 'color' | 'normalized' | 'raw'
  /** Confidence threshold */
  confidenceThreshold: number
  /** Sub-pixel alignment */
  subpixelAlignment: boolean
  /** Save intermediate results */
  saveIntermediates: boolean
}

export interface FocusStackingResult {
  /** Final stacked image */
  stackedImage: HTMLCanvasElement
  /** Depth map (0=near, 1=far) */
  depthMap?: HTMLCanvasElement
  /** Confidence map */
  confidenceMap?: HTMLCanvasElement
  /** Sharpness map per pixel */
  sharpnessMap?: HTMLCanvasElement
  /** Source image index per pixel */
  sourceMap?: HTMLCanvasElement
  /** Quality metrics */
  metrics: {
    averageSharpness: number
    coverage: number
    seamlessScore: number
    processingTime: number
  }
  /** Per-image statistics */
  imageStats: Array<{
    index: number
    sharpness: number
    coverage: number
    weight: number
  }>
}

export interface FocusMap {
  /** Sharpness value per pixel (0-1) */
  sharpness: Float32Array
  /** Source image index per pixel */
  sourceIndex: Uint16Array
  /** Confidence per pixel */
  confidence: Float32Array
  width: number
  height: number
}

/** Focus Stacking - Main entry point */
export async function focusStack(
  images: HTMLCanvasElement[],
  options: FocusStackingOptions = {
    alignment: 'auto',
    method: 'weighted',
    qualityThreshold: 0.1,
    smoothingRadius: 2,
    consistencyCheck: true,
    outputDepthMap: true,
    depthMapScale: 1,
    edgePreservation: 0.5,
    weightFunction: 'laplacian',
    smoothingIterations: 3,
    pyramidLevels: 5,
    seamBlendMethod: 'multiband',
    depthMapFormat: 'normalized',
    confidenceThreshold: 0.5,
    subpixelAlignment: true,
    saveIntermediates: false,
  }
): Promise<FocusStackingResult> {
  const startTime = performance.now()

  if (images.length < 2) {
    throw new Error('At least 2 images required for focus stacking')
  }

  // 1. Align images
  const alignedImages = await alignImagesForStacking(images, options.alignment)

  // 2. Compute focus measures for each image
  const focusMeasures = await computeFocusMeasures(alignedImages, options.method)

  // 3. Create focus map
  const focusMap = await createFocusMap(alignedImages, focusMeasures, options)

  // 4. Apply consistency check
  if (options.consistencyCheck) {
    await enforceConsistency(focusMap, options.smoothingRadius, options.smoothingIterations)
  }

  // 5. Blend images using focus map
  const stackedImage = await blendImagesWithFocusMap(images, focusMap, options)

  // 6. Generate depth map
  let depthMap: HTMLCanvasElement | undefined
  let confidenceMap: HTMLCanvasElement | undefined
  let sharpnessMap: HTMLCanvasElement | undefined
  let sourceMap: HTMLCanvasElement | undefined

  if (options.outputDepthMap) {
    const depthResult = await generateDepthMap(focusMap, images[0].width, images[0].height, options)
    depthMap = depthResult.depthMap
    confidenceMap = depthResult.confidenceMap
    sharpnessMap = depthResult.sharpnessMap
    sourceMap = depthResult.sourceMap
  }

  const metrics = calculateMetrics(focusMap, images.length)

  return {
    stackedImage: await blendImagesWithFocusMap(images, focusMap, options),
    depthMap,
    confidenceMap,
    sharpnessMap,
    sourceMap,
    metrics: {
      ...metrics,
      processingTime: performance.now() - startTime,
    },
    imageStats: calculateImageStats(focusMap, images.length),
  }
}

/** Align images for focus stacking */
async function alignImagesForStacking(
  images: HTMLCanvasElement[],
  method: 'auto' | 'feature' | 'eyes' | 'manual'
): Promise<HTMLCanvasElement[]> {
  if (images.length <= 1) return images

  // Use first image as reference
  const reference = images[0]
  const aligned = [reference]

  for (let i = 1; i < images.length; i++) {
    const aligned = await alignImagePairForStack(reference, images[i])
    aligned.push(aligned)
  }

  return aligned
}

async function alignImagePairForStack(
  reference: HTMLCanvasElement,
  target: HTMLCanvasElement
): Promise<HTMLCanvasElement> {
  // Would use ECC (Enhanced Correlation Coefficient) or feature matching
  // For now, return target as-is
  const output = createCanvas(target.width, target.height)
  const ctx = ctx2d(output)
  ctx.drawImage(target, 0, 0)
  return output
}

/** Compute focus measure for each image */
async function computeFocusMeasures(
  images: HTMLCanvasElement[],
  method: FocusStackingOptions['method']
): Promise<Float32Array[]> {
  const measures: Float32Array[] = []

  for (const img of images) {
    const measure = await computeFocusMeasure(img, method)
    measures.push(measure)
  }

  return measures
}

async function computeFocusMeasure(
  canvas: HTMLCanvasElement,
  method: FocusStackingOptions['method']
): Promise<Float32Array> {
  const { width, height } = canvas
  const ctx = canvas.getContext('2d')!
  const imgData = ctx.getImageData(0, 0, width, height)
  const data = imgData.data

  const measure = new Float32Array(width * height)

  // Convert to grayscale
  const gray = new Float32Array(width * height)
  for (let i = 0; i < data.length; i += 4) {
    gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }

  switch (method) {
    case 'laplacian':
      return computeLaplacianVariance(gray, width, height)
    case 'tenengrad':
      return computeTenengrad(gray, width, height)
    case 'brenner':
      return computeBrenner(gray, width, height)
    case 'variance':
      return computeLocalVariance(gray, width, height)
    case 'entropy':
      return computeEntropy(gray, width, height)
    case 'contrast':
      return computeLocalContrast(gray, width, height)
    case 'spatial-frequency':
      return computeSpatialFrequency(gray, width, height)
    case 'gradient':
      return computeGradientMagnitude(gray, width, height)
    case 'energy-laplace':
      return computeEnergyLaplace(gray, width, height)
    case 'sum-modified-laplace':
      return computeSumModifiedLaplace(gray, width, height)
    case 'weighted':
    default:
      return computeWeightedFocus(gray, width, height)
  }
}

function computeLaplacianVariance(gray: Float32Array, w: number, h: number): Float32Array {
  const measure = new Float32Array(w * h)
  const kernel = [0, 1, 0, 1, -4, 1, 0, 1, 0]

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sum = 0
      let idx = 0
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const val = gray[(y + ky) * w + (x + kx)]
          sum += val * kernel[idx++]
        }
      }
      measure[y * w + x] = sum * sum
    }
  }
  return measure
}

function computeTenengrad(gray: Float32Array, w: number, h: number): Float32Array {
  const measure = new Float32Array(w * h)
  // Sobel gradients
  const Gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
  const Gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1]

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let gx = 0, gy = 0
      let idx = 0
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const val = gray[(y + ky) * w + (x + kx)]
          gx += val * Gx[idx]
          gy += val * Gy[idx]
          idx++
        }
      }
      measure[y * w + x] = gx * gx + gy * gy
    }
  }
  return measure
}

function computeBrenner(gray: Float32Array, w: number, h: number): Float32Array {
  const measure = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 2; x < w - 2; x++) {
      const idx = y * w + x
      const diff = gray[idx + 2] - gray[idx - 2]
      measure[idx] = diff * diff
    }
  }
  return measure
}

function computeLocalVariance(gray: Float32Array, w: number, h: number, window = 5): Float32Array {
  const measure = new Float32Array(w * h)
  const half = Math.floor(window / 2)

  for (let y = half; y < h - half; y++) {
    for (let x = half; x < w - half; x++) {
      let sum = 0, sumSq = 0, count = 0
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          const val = gray[(y + ky) * w + (x + kx)]
          sum += val
          sumSq += val * val
          count++
        }
      }
      const mean = sum / count
      measure[y * w + x] = sumSq / count - mean * mean
    }
  }
  return measure
}

function computeEntropy(gray: Float32Array, w: number, h: number, window = 5): Float32Array {
  const measure = new Float32Array(w * h)
  const half = Math.floor(window / 2)

  for (let y = half; y < h - half; y++) {
    for (let x = half; x < w - half; x++) {
      const hist = new Array(256).fill(0)
      let count = 0
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          const val = Math.round(gray[(y + ky) * w + (x + kx)] * 255)
          hist[val]++
          count++
        }
      }
      let entropy = 0
      for (let i = 0; i < 256; i++) {
        if (hist[i] > 0) {
          const p = hist[i] / count
          entropy -= p * Math.log2(p)
        }
      }
      measure[y * w + x] = entropy
    }
  }
  return measure
}

function computeLocalContrast(gray: Float32Array, w: number, h: number, window = 5): Float32Array {
  const measure = new Float32Array(w * h)
  const half = Math.floor(window / 2)

  for (let y = half; y < h - half; y++) {
    for (let x = half; x < w - half; x++) {
      let min = 1, max = 0
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          const val = gray[(y + ky) * w + (x + kx)]
          min = Math.min(min, val)
          max = Math.max(max, val)
        }
      }
      measure[y * w + x] = max - min
    }
  }
  return measure
}

function computeSpatialFrequency(gray: Float32Array, w: number, h: number): Float32Array {
  const measure = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const dx = gray[y * w + x + 1] - gray[y * w + x - 1]
      const dy = gray[(y + 1) * w + x] - gray[(y - 1) * w + x]
      measure[y * w + x] = Math.sqrt(dx * dx + dy * dy)
    }
  }
  return measure
}

function computeGradientMagnitude(gray: Float32Array, w: number, h: number): Float32Array {
  const measure = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = (gray[y * w + x + 1] - gray[y * w + x - 1]) / 2
      const gy = (gray[(y + 1) * w + x] - gray[(y - 1) * w + x]) / 2
      measure[y * w + x] = Math.sqrt(gx * gx + gy * gy)
    }
  }
  return measure
}

function computeEnergyLaplace(gray: Float32Array, w: number, h: number): Float32Array {
  const measure = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const laplace = gray[(y - 1) * w + x] + gray[(y + 1) * w + x] + gray[y * w + x - 1] + gray[y * w + x + 1] - 4 * gray[y * w + x]
      measure[y * w + x] = laplace * laplace
    }
  }
  return measure
}

function computeSumModifiedLaplace(gray: Float32Array, w: number, h: number): Float32Array {
  const measure = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const ml = Math.abs(gray[y * w + x - 1] - 2 * gray[y * w + x] + gray[y * w + x + 1]) +
                 Math.abs(gray[(y - 1) * w + x] - 2 * gray[y * w + x] + gray[(y + 1) * w + x])
      measure[y * w + x] = ml
    }
  }
  return measure
}

function computeWeightedFocus(gray: Float32Array, w: number, h: number): Float32Array {
  // Combine multiple focus measures
  const laplacian = computeLaplacianVariance(gray, w, h)
  const tenengrad = computeTenengrad(gray, w, h)
  const gradient = computeGradientMagnitude(gray, w, h)

  const measure = new Float32Array(w * h)
  for (let i = 0; i < measure.length; i++) {
    measure[i] = (laplacian[i] + tenengrad[i] + gradient[i]) / 3
  }
  return measure
}

/** Create focus map from focus measures */
async function createFocusMap(
  images: HTMLCanvasElement[],
  measures: Float32Array[],
  options: FocusStackingOptions
): Promise<FocusMap> {
  const width = images[0].width
  const height = images[0].height
  const count = images.length

  const sharpness = new Float32Array(width * height)
  const sourceIndex = new Uint16Array(width * height)
  const confidence = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x

      // Find image with maximum focus measure
      let maxMeasure = -1
      let bestIdx = 0
      let secondBest = -1

      for (let i = 0; i < count; i++) {
        const measure = measures[i][y * width + x]
        if (measure > maxMeasure) {
          secondBest = maxMeasure
          maxMeasure = measure
          bestIdx = i
        } else if (measure > secondBest) {
          secondBest = measure
        }
      }

      // Confidence based on margin between best and second best
      const margin = maxMeasure - secondBest
      const maxPossible = Math.max(...measures.map(m => m[y * width + x]))
      const conf = maxPossible > 0 ? margin / maxPossible : 0

      sharpness[idx] = maxMeasure
      sourceIndex[idx] = bestIdx
      confidence[idx] = Math.max(options.confidenceThreshold, conf)
    }
  }

  // Apply weight function
  await applyWeightFunction(sharpness, sourceIndex, confidence, options.weightFunction, options.edgePreservation)

  return { sharpness, sourceIndex, confidence, width, height }
}

async function applyWeightFunction(
  sharpness: Float32Array,
  sourceIndex: Uint16Array,
  confidence: Float32Array,
  weightFunction: string,
  edgePreservation: number
): Promise<void> {
  // Apply Gaussian smoothing to weights
  // Would implement bilateral filtering or guided filtering
}

/** Enforce spatial consistency in focus map */
async function enforceConsistency(
  focusMap: FocusMap,
  radius: number,
  iterations: number
): Promise<void> {
  const { sharpness, sourceIndex, confidence, width, height } = focusMap

  for (let iter = 0; iter < iterations; iter++) {
    const newSharpness = new Float32Array(sharpness.length)
    const newSourceIndex = new Uint16Array(sourceIndex.length)
    const newConfidence = new Float32Array(confidence.length)

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x
        const currentIdx = sourceIndex[idx]

        // Collect neighbor votes
        const votes = new Map<number, { weight: number; sharpness: number }>()

        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx, ny = y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue

            const nIdx = ny * width + nx
            const nSourceIdx = sourceIndex[nIdx]
            const weight = confidence[nIdx] * Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius))

            if (!votes.has(nSourceIdx)) {
              votes.set(nSourceIdx, { weight: 0, sharpness: 0 })
            }
            const vote = votes.get(nSourceIdx)!
            vote.weight += weight
            vote.sharpness += sharpness[nIdx] * weight
          }
        }

        // Find majority vote
        let bestIdx = currentIdx
        let bestWeight = 0
        let bestSharpness = sharpness[idx]

        for (const [sourceIdx, vote] of votes) {
          if (vote.weight > bestWeight) {
            bestWeight = vote.weight
            bestIdx = sourceIdx
            bestSharpness = vote.sharpness / vote.weight
          }
        }

        newSourceIndex[idx] = bestIdx
        newSharpness[idx] = bestSharpness
        newConfidence[idx] = Math.min(1, bestWeight / (Math.PI * radius * radius))
      }
    }

    sharpness.set(newSharpness)
    sourceIndex.set(newSourceIndex)
    confidence.set(newConfidence)
  }
}

/** Blend images using focus map */
async function blendImagesWithFocusMap(
  images: HTMLCanvasElement[],
  focusMap: FocusMap,
  options: FocusStackingOptions
): Promise<HTMLCanvasElement> {
  const { width, height } = images[0]
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  const { sourceIndex, sharpness, confidence } = focusMap

  // For each pixel, blend from source images
  const outputData = ctx.createImageData(width, height)
  const data = outputData.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const srcIdx = sourceIndex[idx]

      if (srcIdx < images.length) {
        const srcCtx = images[srcIdx].getContext('2d')!
        const pixel = srcCtx.getImageData(x, y, 1, 1).data
        data[idx * 4] = pixel[0]
        data[idx * 4 + 1] = pixel[1]
        data[idx * 4 + 2] = pixel[2]
        data[idx * 4 + 3] = pixel[3]
      }
    }
  }

  ctx.putImageData(outputData, 0, 0)
  return output
}

/** Generate depth map from focus map */
async function generateDepthMap(
  focusMap: FocusMap,
  width: number,
  height: number,
  options: FocusStackingOptions
): Promise<{
  depthMap: HTMLCanvasElement
  confidenceMap: HTMLCanvasElement
  sharpnessMap: HTMLCanvasElement
  sourceMap: HTMLCanvasElement
}> {
  const { sourceIndex, sharpness, confidence } = focusMap

  const depthCanvas = createCanvas(width, height)
  const confCanvas = createCanvas(width, height)
  const sharpCanvas = createCanvas(width, height)
  const srcCanvas = createCanvas(width, height)

  const depthCtx = ctx2d(depthCanvas)
  const confCtx = ctx2d(confCanvas)
  const sharpCtx = ctx2d(sharpCanvas)
  const srcCtx = ctx2d(srcCanvas)

  const depthData = depthCtx.createImageData(width, height)
  const confData = confCtx.createImageData(width, height)
  const sharpData = sharpCtx.createImageData(width, height)
  const srcData = srcCtx.createImageData(width, height)

  const maxDepth = 255

  for (let i = 0; i < sourceIndex.length; i++) {
    const srcIdx = sourceIndex[i]
    const conf = confidence[i]
    const sharp = sharpness[i]

    // Depth: closer to camera = lower index (assuming images ordered near to far)
    const depth = Math.round((srcIdx / (images.length - 1)) * maxDepth)

    const idx = i * 4
    depthData[idx] = depth
    depthData[idx + 1] = depth
    depthData[idx + 2] = depth
    depthData[idx + 3] = 255

    confData[idx] = Math.round(conf * 255)
    confData[idx + 1] = Math.round(conf * 255)
    confData[idx + 2] = Math.round(conf * 255)
    confData[idx + 3] = 255

    const sharpVal = Math.round(Math.min(1, sharp) * 255)
    sharpData[idx] = sharpVal
    sharpData[idx + 1] = sharpVal
    sharpData[idx + 2] = sharpVal
    sharpData[idx + 3] = 255

    const srcColor = Math.round((srcIdx / (images.length - 1)) * 255)
    srcData[idx] = srcColor
    srcData[idx + 1] = srcColor
    srcData[idx + 2] = srcColor
    srcData[idx + 3] = 255
  }

  depthCtx.putImageData(depthData, 0, 0)
  confCtx.putImageData(confData, 0, 0)
  sharpCtx.putImageData(sharpData, 0, 0)
  srcCtx.putImageData(srcData, 0, 0)

  return {
    depthMap: depthCanvas,
    confidenceMap: confCanvas,
    sharpnessMap: sharpCanvas,
    sourceMap: srcCanvas,
  }
}

/** Calculate metrics */
function calculateMetrics(focusMap: FocusMap, imageCount: number): {
  averageSharpness: number
  coverage: number
  seamlessScore: number
} {
  let totalSharpness = 0
  let covered = 0
  let seamless = 0

  for (let i = 0; i < focusMap.sharpness.length; i++) {
    totalSharpness += focusMap.sharpness[i]
    if (focusMap.confidence[i] > 0.5) covered++
    if (focusMap.confidence[i] > 0.8) seamless++
  }

  return {
    averageSharpness: totalSharpness / focusMap.sharpness.length,
    coverage: covered / focusMap.sharpness.length,
    seamlessScore: seamless / focusMap.sharpness.length,
  }
}

function calculateImageStats(focusMap: FocusMap, imageCount: number): Array<{
  index: number
  sharpness: number
  coverage: number
  weight: number
}> {
  const stats: Array<{ index: number; sharpness: number; coverage: number; weight: number }> = []

  for (let i = 0; i < imageCount; i++) {
    let totalSharpness = 0
    let count = 0
    let coverage = 0

    for (let j = 0; j < focusMap.sourceIndex.length; j++) {
      if (focusMap.sourceIndex[j] === i) {
        totalSharpness += focusMap.sharpness[j]
        count++
        if (focusMap.confidence[j] > 0.5) coverage++
      }
    }

    stats.push({
      index: i,
      sharpness: count > 0 ? totalSharpness / count : 0,
      coverage: focusMap.sourceIndex.length > 0 ? coverage / focusMap.sourceIndex.length : 0,
      weight: count / focusMap.sourceIndex.length,
    })
  }

  return stats
}

/** Export focus stack as layered document */
export async function exportFocusStackAsLayers(
  result: FocusStackingResult,
  options: {
    includeDepthMap: boolean
    includeConfidenceMap: boolean
    includeSharpnessMap: boolean
    includeSourceMap: boolean
    format: 'psd' | 'tiff' | 'png'
  }
): Promise<Blob> {
  // Would create layered PSD/TIFF
  return new Blob()
}

/** Real-time focus stacking preview */
export class FocusStackingPreview {
  private images: HTMLCanvasElement[] = []
  private currentResult: FocusStackingResult | null = null
  private options: FocusStackingOptions

  constructor(options: FocusStackingOptions) {
    this.options = options
  }

  addImage(canvas: HTMLCanvasElement): void {
    this.images.push(canvas)
  }

  removeImage(index: number): void {
    this.images.splice(index, 1)
  }

  clear(): void {
    this.images = []
  }

  async updatePreview(): Promise<HTMLCanvasElement | null> {
    if (this.images.length < 2) return null

    this.currentResult = await focusStack(this.images, this.options)
    return this.currentResult.stackedImage
  }

  async getDepthMap(): Promise<HTMLCanvasElement | null> {
    return this.currentResult?.depthMap || null
  }

  getImageCount(): number {
    return this.images.length
  }

  setOptions(options: Partial<FocusStackingOptions>): void {
    this.options = { ...this.options, ...options }
  }
}

/** Helicon Focus compatibility */
export async function exportToHeliconFocus(
  images: HTMLCanvasElement[],
  outputPath: string
): Promise<void> {
  // Export images and depth maps in Helicon Focus format
  // Would write .hfc file format
}

/** Zerene Stacker compatibility */
export async function exportToZereneStacker(
  images: HTMLCanvasElement[],
  outputPath: string
): Promise<void> {
  // Export in Zerene Stacker format
}

/** Combine focus stacking with HDR */
export async function hdrFocusStack(
  bracketSets: Array<{ images: HTMLCanvasElement[]; exposures: number[] }>,
  options: FocusStackingOptions & { hdrOptions: any }
): Promise<FocusStackingResult> {
  // 1. Merge each bracket set to HDR
  const hdrImages = []
  for (const bracket of bracketSets) {
    // Would call HDR merge
    // hdrImages.push(await mergeHDR(bracket.images, bracket.exposures))
  }

  // 2. Focus stack the HDR images
  return focusStack([], { ...options })
}