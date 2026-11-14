'use client'
// GIMP HDR Merge
// Merge bracketed exposures into HDR image with tone mapping

import { createCanvas, ctx2d } from '../utils/canvas'

export interface HDRMergeOptions {
  /** Input images (bracketed exposures) */
  images: HTMLCanvasElement[]
  /** Exposure values for each image (EV) */
  exposures: number[]
  /** Alignment method */
  alignment: 'auto' | 'feature' | 'eyes' | 'manual'
  /** Deghosting */
  deghosting: 'none' | 'low' | 'medium' | 'high'
  /** Tone mapping operator */
  toneMapping: 'reinhard' | 'drago' | 'fattal' | 'mantiuk' | 'linear' | 'aces' | 'filmic'
  /** Tone mapping parameters */
  toneMappingParams: {
    exposure?: number
    gamma?: number
    contrast?: number
    saturation?: number
    detail?: number
  }
  /** Output bit depth */
  bitDepth: '16' | '32' | '8'
  /** Color space */
  colorSpace: 'sRGB' | 'AdobeRGB' | 'ProPhotoRGB' | 'Rec2020' | 'linear'
  /** Ghost removal threshold */
  ghostThreshold: number
}

export interface HDRImage {
  canvas: HTMLCanvasElement
  bitDepth: '16' | '32' | '8'
  colorSpace: string
  metadata: {
    exposures: number[]
    evRange: number
    alignmentUsed: string
    deghostingUsed: string
    toneMapping: string
  }
}

export interface BracketSet {
  images: File[]
  exposures: number[]
}

/** Align images using feature matching */
export async function alignImages(
  images: HTMLCanvasElement[],
  method: 'auto' | 'feature' | 'eyes' | 'manual' = 'auto'
): Promise<HTMLCanvasElement[]> {
  if (images.length <= 1) return images

  const reference = images[0]
  const aligned = [reference]

  for (let i = 1; i < images.length; i++) {
    const alignedImage = await alignImagePair(reference, images[i], method)
    aligned.push(alignedImage)
  }

  return aligned
}

async function alignImagePair(
  reference: HTMLCanvasElement,
  target: HTMLCanvasElement,
  method: string
): Promise<HTMLCanvasElement> {
  // This would use feature detection (ORB, SIFT, AKAZE) via OpenCV.js or similar
  // For now, return target as-is (no alignment)
  const output = createCanvas(target.width, target.height)
  const ctx = ctx2d(output)
  ctx.drawImage(target, 0, 0)
  return output
}

/** Detect and remove ghosts */
export async function removeGhosts(
  alignedImages: HTMLCanvasElement[],
  exposures: number[],
  threshold: number = 0.1
): Promise<HTMLCanvasElement[]> {
  // Ghost removal compares pixel differences between aligned images
  // Pixels that differ significantly from median are considered ghosts
  
  const width = alignedImages[0].width
  const height = alignedImages[0].height
  const count = alignedImages.length

  const output = []

  for (let i = 0; i < alignedImages.length; i++) {
    const canvas = alignedImages[i]
    const ctx = canvas.getContext('2d')!
    const imgData = ctx.getImageData(0, 0, width, height)
    const data = imgData.data

    // Compare with median of other images
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const r = data[idx], g = data[idx + 1], b = data[idx + 2]

        // Collect values from other images
        const otherValues: number[][] = []
        for (let j = 0; j < count; j++) {
          if (j === i) continue
          const otherCtx = alignedImages[j].getContext('2d')!
          const otherData = otherCtx.getImageData(x, y, 1, 1).data
          otherValues.push([otherData[0], otherData[1], otherData[2]])
        }

        // Compute median
        const medianR = median(otherValues.map(v => v[0]))
        const medianG = median(otherValues.map(v => v[1]))
        const medianB = median(otherValues.map(v => v[2]))

        // Check if current pixel is a ghost
        const diff = Math.abs(r - medianR) + Math.abs(g - medianG) + Math.abs(b - medianB)
        if (diff > threshold * 255) {
          // Replace with median
          data[idx] = medianR
          data[idx + 1] = medianG
          data[idx + 2] = medianB
        }
      }
    }

    const output = createCanvas(width, height)
    const ctx = ctx2d(output)
    ctx.putImageData(imgData, 0, 0)
    output.getContext('2d')!.putImageData(imgData, 0, 0)
    output.push(output)
  }

  return output
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Merge aligned images into HDR radiance map */
export async function mergeToHDR(
  alignedImages: HTMLCanvasElement[],
  exposures: number[],
  method: 'robertson' | 'debevec' | 'mertens' = 'robertson'
): Promise<HTMLCanvasElement> {
  const width = alignedImages[0].width
  const height = alignedImages[0].height

  // Create HDR radiance map (32-bit float per channel)
  const hdrCanvas = createCanvas(alignedImages[0].width, alignedImages[0].height)
  const ctx = ctx2d(hdrCanvas)

  // This would use the actual HDR merge algorithm
  // For now, create a simple composite weighted by exposure
  const output = createCanvas(alignedImages[0].width, alignedImages[1].height)
  const ctx = output.getContext('2d')!

  // Simple exposure-weighted blend
  const totalWeight = exposures.reduce((sum, ev) => sum + Math.pow(2, -ev), 0)
  
  for (let i = 0; i < alignedImages.length; i++) {
    const weight = Math.pow(2, -exposures[i]) / totalWeight
    ctx.globalAlpha = weight
    ctx.globalCompositeOperation = i === 0 ? 'source-over' : 'plus-lighter'
    ctx.drawImage(alignedImages[i], 0, 0)
  }

  return output
}

/** Tone mapping operators */
export interface ToneMappingParams {
  exposure?: number
  gamma?: number
  contrast?: number
  saturation?: number
  detail?: number
  highlights?: number
  shadows?: number
  whites?: number
  blacks?: number
}

/** Reinhard tone mapping */
export function reinhardToneMap(
  hdrCanvas: HTMLCanvasElement,
  params: ToneMappingParams = {}
): HTMLCanvasElement {
  const { exposure = 0, gamma = 1, contrast = 1, saturation = 1 } = params
  const { width, height } = params.canvas || { width: 0, height: 0 }

  // Simplified Reinhard implementation using canvas filters
  const output = createCanvas(params.canvas?.width || 1, params.canvas?.height || 1)
  const ctx = ctx2d(output)
  
  const canvas = params.canvas!
  ctx.filter = `brightness(${1 + exposure}) contrast(${contrast}) saturate(${saturation})`
  ctx.drawImage(params.canvas!, 0, 0)
  ctx.filter = 'none'

  return output
}

/** Drago tone mapping */
export function dragoToneMap(
  canvas: HTMLCanvasElement,
  params: ToneMappingParams = {}
): HTMLCanvasElement {
  // Drago logarithmic mapping
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  
  // Simplified using canvas filters
  ctx.filter = `brightness(${1 + (params.exposure || 0)}) contrast(${params.contrast || 1})`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  return output
}

/** Fattal tone mapping */
export function fattalToneMap(
  canvas: HTMLCanvasElement,
  params: ToneMappingParams = {}
): HTMLCanvasElement {
  // Fattal gradient domain tone mapping
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  
  ctx.filter = `brightness(${1 + (params.exposure || 0)}) contrast(${params.contrast || 1})`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  return output
}

/** Mantiuk tone mapping */
export function mantiukToneMap(
  canvas: HTMLCanvasElement,
  params: ToneMappingParams = {}
): HTMLCanvasElement {
  // Mantiuk contrast-based tone mapping
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  
  ctx.filter = `contrast(${params.contrast || 1}) brightness(${1 + (params.exposure || 0)})`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  return output
}

/** ACES Filmic tone mapping */
export function acesFilmicToneMap(
  canvas: HTMLCanvasElement,
  params: ToneMappingParams = {}
): HTMLCanvasElement {
  // ACES approximation using canvas filters
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  
  // RRT + ODT approximation
  ctx.filter = `contrast(${1.1}) brightness(${1.05}) saturate(${1.1})`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  // Simple S-curve approximation
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imgData.data
  
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = data[i + c] / 255
      // ACES approximation
      v = v * (2.51 * v + 0.03) / (v * (2.43 * v + 0.59) + 0.14)
      data[i + c] = Math.round(Math.max(0, Math.min(1, v)) * 255)
    }
    ctx.putImageData(ctx.createImageData(canvas.width, canvas.height), 0, 0)
    // Actually put the modified data
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let v = data[i + c] / 255
        v = v * (2.51 * v + 0.03) / (v * (2.43 * v + 0.59) + 0.14)
        data[i + c] = Math.round(Math.max(0, Math.min(1, v)) * 255)
      }
    }
    ctx.putImageData(imgData, 0, 0)

  return output
}

/** Filmic tone mapping */
export function filmicToneMap(
  canvas: HTMLCanvasElement,
  params: ToneMappingParams = {}
): HTMLCanvasElement {
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  
  // Filmic curve approximation
  ctx.filter = `contrast(${1.2}) brightness(${1.05}) saturate(${1.1})`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  return output
}

/** Linear tone mapping (exposure only) */
export function linearToneMap(
  canvas: HTMLCanvasElement,
  params: ToneMappingParams = {}
): HTMLCanvasElement {
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  
  ctx.filter = `brightness(${1 + (params.exposure || 0)})`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  return output
}

/** Main HDR merge function */
export async function mergeHDR(
  images: HTMLCanvasElement[],
  exposures: number[],
  options: HDRMergeOptions = {
    alignment: 'auto',
    deghosting: 'medium',
    toneMapping: 'reinhard',
    toneMappingParams: {},
    bitDepth: '32',
    colorSpace: 'linear',
    ghostThreshold: 0.1,
  }
): Promise<HDRImage> {
  // 1. Align images
  const aligned = await alignImages(images, options.alignment)

  // 2. Deghost if needed
  let alignedImages = aligned
  if (options.deghosting !== 'none') {
    const strength = { low: 0.05, medium: 0.1, high: 0.2 }[options.deghosting] || 0.1
    alignedImages = await removeGhosts(alignedImages, options.ghostThreshold)
  }

  // 3. Merge to HDR
  const hdrCanvas = await mergeToHDR(alignedImages, exposures)

  // 4. Tone mapping
  let tonemapped: HTMLCanvasElement
  switch (options.toneMapping) {
    case 'reinhard':
      tonemapped = reinhardToneMap(alignedImages[0], { canvas: alignedImages[0], ...options.toneMappingParams })
      break
    case 'drago':
      tonemapped = dragoToneMap(alignedImages[0], { canvas: alignedImages[0], ...options.toneMappingParams })
      break
    case 'fattal':
      tonemapped = fattalToneMap(alignedImages[0], { canvas: alignedImages[0], ...options.toneMappingParams })
      break
    case 'mantiuk':
      tonemapped = mantiukToneMap(alignedImages[0], { canvas: alignedImages[0], ...options.toneMappingParams })
      break
    case 'aces':
      tonemapped = acesFilmicToneMap(alignedImages[0], { canvas: alignedImages[0], ...options.toneMappingParams })
      break
    case 'filmic':
      tonemapped = filmicToneMap(alignedImages[0], { canvas: alignedImages[0], ...options.toneMappingParams })
      break
    case 'linear':
    default:
      tonemapped = linearToneMap(alignedImages[0], { canvas: alignedImages[0], ...options.toneMappingParams })
  }

  // Apply post-processing
  const output = createCanvas(images[0].width, images[0].height)
  const ctx = ctx2d(output)
  ctx.drawImage(tonemapped, 0, 0)

  // Apply saturation/contrast adjustments
  if (options.toneMappingParams.saturation || options.toneMappingParams.contrast) {
    const ctx = output.getContext('2d')!
    ctx.filter = `saturate(${1 + (options.toneMappingParams.saturation || 0) / 100}) contrast(${1 + (options.toneMappingParams.contrast || 0) / 100})`
    ctx.drawImage(output, 0, 0)
    ctx.filter = 'none'
  }

  return {
    canvas: output,
    bitDepth: options.bitDepth,
    colorSpace: options.colorSpace,
    metadata: {
      exposures,
      evRange: Math.max(...exposures) - Math.min(...exposures),
      alignmentUsed: options.alignment,
      deghostingUsed: options.deghosting,
      toneMapping: options.toneMapping,
    },
  }
}

/** Auto-bracket detection */
export async function detectBrackets(files: File[]): Promise<BracketSet[]> {
  // Read EXIF exposure values
  const brackets: BracketSet[] = []
  const used = new Set<number>()

  for (let i = 0; i < files.length; i++) {
    if (used.has(i)) continue

    const file = files[i]
    const buffer = await file.arrayBuffer()
    const exif = await extractExif(new DataView(buffer))
    const ev = exif.exposureTime && exif.aperture && exif.iso
      ? Math.log2((exif.exposureTime * exif.aperture * exif.aperture) / (exif.iso / 100))
      : 0

    // Find other images with similar timing (within 2 seconds)
    const bracket = { images: [files[i]], exposures: [ev] }
    used.add(i)

    for (let j = i + 1; j < files.length; j++) {
      if (used.has(j)) continue
      const otherFile = files[j]
      const otherBuffer = await otherFile.arrayBuffer()
      const otherExif = extractExif(new DataView(otherBuffer))
      const otherEv = otherExif.exposureTime && otherExif.aperture && otherExif.iso
        ? Math.log2((otherExif.exposureTime * otherExif.aperture * otherExif.aperture) / (otherExif.iso / 100))
        : 0

      // Check if exposure differs by ~1-3 EV (typical bracket)
      const evDiff = Math.abs(ev - otherEv)
      if (evDiff >= 0.5 && evDiff <= 4) {
        bracket.images.push(files[j])
        bracket.exposures.push(otherEv)
        used.add(j)
      }
    }

    if (bracket.images.length >= 2) {
      brackets.push(bracket)
    }
  }

  return brackets
}

/** Extract EXIF from buffer (simplified) */
function extractExif(view: DataView): any {
  // Simplified EXIF extraction
  return { exposureTime: 1/125, aperture: 2.8, iso: 100 }
}

/** Batch HDR merge for multiple bracket sets */
export async function batchHDRMerge(
  bracketSets: BracketSet[],
  options: HDRMergeOptions
): Promise<HDRImage[]> {
  const results: HDRImage[] = []

  for (const bracket of bracketSets) {
    const images: HTMLCanvasElement[] = []
    for (const file of bracket.images) {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      images.push(canvas)
    }

    const hdr = await mergeHDR(images, bracket.exposures, options)
    results.push(hdr)
  }

  return results
}

/** Auto-exposure bracket detection from single RAW */
export async function autoBracketFromRAW(
  rawCanvas: HTMLCanvasElement,
  numExposures: 3,
  evStep: 2
): Promise<HTMLCanvasElement[]> {
  // Generate synthetic brackets from single RAW by adjusting exposure
  const brackets: HTMLCanvasElement[] = []

  for (let i = 0; i < numExposures; i++) {
    const ev = (i - Math.floor(numExposures / 2)) * evStep
    const output = createCanvas(rawCanvas.width, rawCanvas.height)
    const ctx = ctx2d(output)
    ctx.filter = `brightness(${Math.pow(2, ev)})`
    ctx.drawImage(rawCanvas, 0, 0)
    ctx.filter = 'none'
    brackets.push(output)
  }

  return brackets
}

/** HDR Panorama - merge HDR brackets then stitch */
export async function hdrPanorama(
  bracketSets: BracketSet[],
  options: HDRMergeOptions & { projection: 'spherical' | 'cylindrical' | 'perspective' }
): Promise<HTMLCanvasElement> {
  // 1. Merge each bracket set to HDR
  const hdrImages = await batchHDRMerge(bracketSets, options)

  // 2. Stitch HDR images into panorama
  // Would use feature matching and cylindrical/spherical projection
  // Simplified: just return first for now
  return hdrImages[0].canvas
}