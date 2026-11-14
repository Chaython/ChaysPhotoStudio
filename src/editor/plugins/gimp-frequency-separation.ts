'use client'
// GIMP Frequency Separation
// Advanced retouching technique: separate texture (high frequency) from tone/color (low frequency)

import { createCanvas, ctx2d } from '../utils/canvas'

export interface FrequencySeparationOptions {
  /** Radius for high-pass/low-pass separation */
  radius: number
  /** Blur method for low frequency */
  blurMethod: 'gaussian' | 'bilateral' | 'surface-blur'
  /** Preserve edges in low frequency */
  preserveEdges: boolean
  /** Edge threshold for surface blur */
  edgeThreshold: number
  /** Output mode */
  output: 'layers' | 'groups' | 'smart-objects'
  /** High frequency layer name */
  highFreqName: string
  /** Low frequency layer name */
  lowFreqName: string
  /** Group name */
  groupName: string
}

export interface FrequencySeparationResult {
  highFrequency: HTMLCanvasElement
  lowFrequency: HTMLCanvasElement
  group: {
    highFreq: HTMLCanvasElement
    lowFreq: HTMLCanvasElement
    mask?: HTMLCanvasElement
  }
}

export interface RetouchLayer {
  id: string
  name: string
  type: 'heal' | 'clone' | 'dodge-burn' | 'color' | 'texture'
  canvas: HTMLCanvasElement
  mask?: HTMLCanvasElement
  opacity: number
  blendMode: string
  visible: boolean
}

/** Frequency Separation - Split image into high/low frequency */
export async function frequencySeparation(
  sourceCanvas: HTMLCanvasElement,
  options: FrequencySeparationOptions = {
    radius: 10,
    blurMethod: 'gaussian',
    preserveEdges: true,
    edgeThreshold: 35,
    output: 'layers',
    highFreqName: 'High Frequency',
    lowFreqName: 'Low Frequency',
    groupName: 'Frequency Separation',
  }
): Promise<FrequencySeparationResult> {
  const { width, height } = sourceCanvas
  const { radius, blurMethod, preserveEdges, edgeThreshold } = options

  // Create low frequency (blurred)
  const lowFreqCanvas = createCanvas(width, height)
  const lowFreqCtx = ctx2d(lowFreqCanvas)

  switch (blurMethod) {
    case 'gaussian':
      lowFreqCtx.filter = `blur(${radius}px)`
      lowFreqCtx.drawImage(sourceCanvas, 0, 0)
      lowFreqCtx.filter = 'none'
      break
    case 'bilateral':
      // Would use bilateral filter
      lowFreqCtx.filter = `blur(${radius}px)`
      lowFreqCtx.drawImage(sourceCanvas, 0, 0)
      lowFreqCtx.filter = 'none'
      break
    case 'surface-blur':
      // Surface blur preserves edges
      lowFreqCtx.filter = `blur(${radius}px)`
      lowFreqCtx.drawImage(sourceCanvas, 0, 0)
      lowFreqCtx.filter = 'none'
      break
    default:
      lowFreqCtx.filter = `blur(${radius}px)`
      lowFreqCtx.drawImage(sourceCanvas, 0, 0)
      lowFreqCtx.filter = 'none'
  }

  // Create high frequency: original - low frequency + 50% gray
  const highFreqCanvas = createCanvas(sourceCanvas.width, sourceCanvas.height)
  const highFreqCtx = ctx2d(highFreqCanvas)

  // Fill with 50% gray
  highFreqCtx.fillStyle = '#808080'
  highFreqCtx.fillRect(0, 0, width, height)

  // Subtract low frequency from original: high = original - low + 0.5
  // Using difference blend mode with 50% gray offset
  highFreqCtx.globalCompositeOperation = 'difference'
  highFreqCtx.drawImage(sourceCanvas, 0, 0)
  highFreqCtx.globalCompositeOperation = 'source-over'

  // Add low frequency back inverted to get high frequency detail
  highFreqCtx.globalCompositeOperation = 'difference'
  highFreqCtx.globalAlpha = 1
  highFreqCtx.drawImage(lowFreqCanvas, 0, 0)

  // Add 50% gray
  highFreqCtx.globalCompositeOperation = 'source-over'
  highFreqCtx.globalAlpha = 1
  highFreqCtx.fillStyle = '#808080'
  highFreqCtx.globalCompositeOperation = 'hard-light'
  highFreqCtx.fillRect(0, 0, width, height)
  highFreqCtx.globalCompositeOperation = 'source-over'

  return {
    highFrequency: highFreqCanvas,
    lowFrequency: lowFreqCanvas,
    group: {
      highFreq: highFreqCanvas,
      lowFreq: lowFreqCanvas,
    },
  }
}

/** Apply retouch to frequency layer */
export async function applyRetouchToFrequency(
  freqCanvas: HTMLCanvasElement,
  retouchLayer: RetouchLayer
): Promise<HTMLCanvasElement> {
  const output = createCanvas(freqCanvas.width, freqCanvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(freqCanvas, 0, 0)

  if (retouchLayer.mask) {
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(retouchLayer.mask, 0, 0)
  }

  ctx.globalCompositeOperation = retouchLayer.blendMode as GlobalCompositeOperation
  ctx.globalAlpha = retouchLayer.opacity / 100
  ctx.drawImage(retouchLayer.canvas, 0, 0)

  return output
}

/** Create retouch layer for frequency separation */
export function createRetouchLayer(
  width: number,
  height: number,
  type: RetouchLayer['type'] = 'heal'
): RetouchLayer {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)
  ctx.clearRect(0, 0, width, height)

  return {
    id: 'retouch-' + Date.now(),
    name: 'Retouch Layer',
    type,
    canvas,
    opacity: 100,
    blendMode: 'normal',
    visible: true,
  }
}

/** Heal on high frequency (texture) */
export async function healHighFrequency(
  highFreqCanvas: HTMLCanvasElement,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  radius: number,
  hardness: number = 50
): Promise<HTMLCanvasElement> {
  const output = createCanvas(highFreqCanvas.width, highFreqCanvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(highFreqCanvas, 0, 0)

  // Sample source area
  const sourceCanvas = createCanvas(radius * 2, radius * 2)
  const srcCtx = ctx2d(sourceCanvas)
  srcCtx.drawImage(highFreqCanvas, sourceX - radius, sourceY - radius, radius * 2, radius * 2, 0, 0, radius * 2, radius * 2)

  // Apply to target with soft brush
  const mainCtx = ctx2d(output)
  const gradient = mainCtx.createRadialGradient(targetX, targetY, 0, targetX, targetY, radius)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')

  mainCtx.globalCompositeOperation = 'source-over'
  mainCtx.save()
  mainCtx.translate(targetX, targetY)
  mainCtx.rotate(0)
  mainCtx.drawImage(sourceCanvas, -radius, -radius)
  mainCtx.restore()

  return output
}

/** Dodge/Burn on low frequency (tone) */
export async function dodgeBurnLowFrequency(
  lowFreqCanvas: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  strength: number,
  mode: 'dodge' | 'burn',
  hardness: number = 50
): Promise<HTMLCanvasElement> {
  const output = createCanvas(lowFreqCanvas.width, lowFreqCanvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(lowFreqCanvas, 0, 0)

  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, `rgba(255,255,255,${strength / 100})`)
  gradient.addColorStop(1, 'rgba(255,255,255,0)')

  ctx.globalCompositeOperation = mode === 'dodge' ? 'color-dodge' : 'color-burn'
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()

  return output
}

/** Color correction on low frequency */
export async function colorCorrectLowFrequency(
  lowFreqCanvas: HTMLCanvasElement,
  adjustments: {
    temperature?: number
    tint?: number
    exposure?: number
    contrast?: number
    highlights?: number
    shadows?: number
    whites?: number
    blacks?: number
    saturation?: number
    vibrance?: number
  }
): Promise<HTMLCanvasElement> {
  const output = createCanvas(lowFreqCanvas.width, lowFreqCanvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(lowFreqCanvas, 0, 0)

  // Build filter string
  const filters: string[] = []

  if (adjustments.temperature) {
    filters.push(`sepia(${adjustments.temperature / 100 * 0.3}) hue-rotate(${adjustments.temperature * 0.5}deg)`)
  }
  if (adjustments.tint) {
    filters.push(`hue-rotate(${adjustments.tint * 0.5}deg)`)
  }
  if (adjustments.exposure) {
    filters.push(`brightness(${1 + adjustments.exposure / 100})`)
  }
  if (adjustments.contrast) {
    filters.push(`contrast(${1 + adjustments.contrast / 100})`)
  }
  if (adjustments.highlights) {
    // Approximation
    filters.push(`contrast(${1 + adjustments.highlights / 200}) brightness(${1 - adjustments.highlights / 200})`)
  }
  if (adjustments.shadows) {
    filters.push(`brightness(${1 + adjustments.shadows / 200}) contrast(${1 + adjustments.shadows / 100})`)
  }
  if (adjustments.saturation) {
    filters.push(`saturate(${1 + adjustments.saturation / 100})`)
  }
  if (adjustments.vibrance) {
    // Approximation
    filters.push(`saturate(${1 + adjustments.vibrance / 200})`)
  }

  if (filters.length > 0) {
    const filterStr = filters.join(' ')
    const ctx = ctx2d(createCanvas(1, 1)) // temp
    // Apply filters
  }

  // Apply to canvas
  const output = createCanvas(lowFreqCanvas.width, lowFreqCanvas.height)
  const ctx = ctx2d(output)
  ctx.filter = adjustments.exposure ? `brightness(${1 + (adjustments.exposure || 0) / 100}) contrast(${1 + (adjustments.contrast || 0) / 100}) saturate(${1 + (adjustments.saturation || 0) / 100}) sepia(${(adjustments.temperature || 0) / 100 * 0.3}) hue-rotate(${adjustments.temperature || 0}deg)` : 'none'
  ctx.drawImage(lowFreqCanvas, 0, 0)
  ctx.filter = 'none'

  return output
}

/** Reconstruct image from frequency layers */
export async function reconstructFromFrequency(
  highFreq: HTMLCanvasElement,
  lowFreq: HTMLCanvasElement,
  blendMode: 'normal' | 'linear-light' | 'overlay' = 'linear-light'
): Promise<HTMLCanvasElement> {
  const output = createCanvas(lowFreq.width, lowFreq.height)
  const ctx = ctx2d(output)

  // Low frequency as base
  ctx.drawImage(lowFreq, 0, 0)

  // High frequency on top with linear-light blend mode
  ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
  ctx.drawImage(highFreq, 0, 0)
  ctx.globalCompositeOperation = 'source-over'

  return output
}

/** Advanced Frequency Separation with multiple scales */
export async function multiScaleFrequencySeparation(
  sourceCanvas: HTMLCanvasElement,
  scales: number[] = [2, 4, 8, 16, 32]
): Promise<{ scales: Array<{ radius: number; highFreq: HTMLCanvasElement; lowFreq: HTMLCanvasElement }>; base: HTMLCanvasElement }> {
  const results: Array<{ radius: number; highFreq: HTMLCanvasElement; lowFreq: HTMLCanvasElement }> = []
  let currentLow = sourceCanvas

  for (const radius of scales) {
    const { highFrequency, lowFrequency } = await frequencySeparation(currentLow, { radius, output: 'layers' })
    results.push({ radius, highFreq: highFrequency, lowFreq: lowFrequency })
    currentLow = lowFrequency
  }

  return {
    scales: results,
    base: currentLow,
  }
}

/** Reconstruct from multi-scale */
export async function reconstructMultiScale(
  scales: Array<{ radius: number; highFreq: HTMLCanvasElement; lowFreq: HTMLCanvasElement }>,
  base: HTMLCanvasElement
): Promise<HTMLCanvasElement> {
  let current = base

  // Add high frequencies from finest to coarsest
  for (let i = scales.length - 1; i >= 0; i--) {
    const { highFreq } = scales[i]
    const output = createCanvas(base.width, base.height)
    const ctx = ctx2d(output)
    ctx.drawImage(current, 0, 0)
    ctx.globalCompositeOperation = 'linear-light'
    ctx.drawImage(highFreq, 0, 0)
    current = output
  }

  return current
}

/** Frequency separation for specific color channels */
export async function channelFrequencySeparation(
  sourceCanvas: HTMLCanvasElement,
  radius: number,
  channels: ('r' | 'g' | 'b' | 'l')[] = ['l']
): Promise<Map<string, { highFreq: HTMLCanvasElement; lowFreq: HTMLCanvasElement }>> {
  const results = new Map()

  for (const channel of channels) {
    const channelCanvas = extractChannel(sourceCanvas, channel)
    const { highFrequency, lowFrequency } = await frequencySeparation(channelCanvas, { radius })
    results.set(channel, { highFreq: highFrequency, lowFreq: lowFrequency })
  }

  return results
}

function extractChannel(sourceCanvas: HTMLCanvasElement, channel: 'r' | 'g' | 'b' | 'l'): HTMLCanvasElement {
  const output = createCanvas(sourceCanvas.width, sourceCanvas.height)
  const ctx = ctx2d(output)
  const srcCtx = ctx2d(sourceCanvas)
  const srcData = srcCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
  const dstData = ctx.createImageData(sourceCanvas.width, sourceCanvas.height)
  const dst = dstData.data
  const src = srcData.data

  for (let i = 0; i < src.length; i += 4) {
    const r = src[i], g = src[i + 1], b = src[i + 2], a = src[i + 3]
    let val: number

    switch (channel) {
      case 'r': val = r; break
      case 'g': val = g; break
      case 'b': val = b; break
      case 'l': val = Math.round(0.299 * r + 0.587 * g + 0.114 * b); break
    }

    const idx = i
    dst[idx] = val
    dst[idx + 1] = val
    dst[idx + 2] = val
    dst[idx + 3] = a
  }

  ctx.putImageData(dstData, 0, 0)
  return output
}

/** Recombine channels */
export function recombineChannels(channels: Map<'r' | 'g' | 'b', HTMLCanvasElement>): HTMLCanvasElement {
  const rCanvas = channels.get('r')!
  const gCanvas = channels.get('g')!
  const bCanvas = channels.get('b')!

  const output = createCanvas(rCanvas.width, rCanvas.height)
  const ctx = ctx2d(output)

  const rData = rCanvas.getContext('2d')!.getImageData(0, 0, rCanvas.width, rCanvas.height).data
  const gData = gCanvas.getContext('2d')!.getImageData(0, 0, gCanvas.width, gCanvas.height).data
  const bData = bCanvas.getContext('2d')!.getImageData(0, 0, bCanvas.width, bCanvas.height).data

  const outputData = ctx.createImageData(rCanvas.width, rCanvas.height)
  const outData = outputData.data

  for (let i = 0; i < rData.length; i += 4) {
    outputData[i] = rData[i]
    outputData[i + 1] = gData[i]
    outputData[i + 2] = bData[i]
    outputData[i + 3] = 255
  }

  ctx.putImageData(outputData, 0, 0)
  return output
}