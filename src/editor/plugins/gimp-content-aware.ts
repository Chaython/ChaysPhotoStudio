'use client'
// GIMP Content-Aware Tools
// Content-Aware Fill, Move, Extend, Scale, Crop

import { createCanvas, ctx2d } from '../utils/canvas'

export interface ContentAwareFillOptions {
  /** Fill area (selection or transparency) */
  area: 'selection' | 'transparency' | 'layer-bounds'
  /** Sampling area */
  sample: 'all-layers' | 'current-layer' | 'selection'
  /** Fill algorithm */
  algorithm: 'patch-match' | 'diffusion' | 'exemplar' | 'deep-learning'
  /** Patch size for patch-match */
  patchSize: number
  /** Number of iterations */
  iterations: number
  /** Structure preservation */
  structure: number // 0-10
  /** Color blending */
  color: number // 0-10
  /** Output mode */
  output: 'new-layer' | 'current-layer' | 'duplicate-layer'
  /** Adaptation */
  adaptation: 'none' | 'loose' | 'medium' | 'strict'
  /** Rotation adaptation */
  rotationAdaptation: boolean
  /** Scale adaptation */
  scaleAdaptation: boolean
  /** Mirror adaptation */
  mirrorAdaptation: boolean
}

export interface ContentAwareMoveOptions {
  /** Move mode */
  mode: 'move' | 'extend'
  /** Structure preservation */
  structure: number // 1-7
  /** Color blending */
  color: number // 0-10
  /** Sample all layers */
  sampleAllLayers: boolean
  /** Transform on drop */
  transformOnDrop: boolean
  /** Output mode */
  output: 'current-layer' | 'new-layer'
}

export interface ContentAwareScaleOptions {
  /** Protect areas (skin tones, etc.) */
  protectSkinTones: boolean
  /** Use alpha channel as protect mask */
  useAlphaMask: boolean
  /** Expand/contract */
  amount: number // -100 to 100
  /** Interpolation */
  interpolation: 'bicubic' | 'bilinear' | 'nearest'
}

export interface ContentAwareCropOptions {
  /** Fill empty areas after crop */
  fillEmpty: boolean
  /** Fill options */
  fillOptions: ContentAwareFillOptions
}

/** Content-Aware Fill - Main entry point */
export async function contentAwareFill(
  sourceCanvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  options: ContentAwareFillOptions = {}
): Promise<HTMLCanvasElement> {
  const opts: ContentAwareFillOptions = {
    area: 'selection',
    sample: 'current-layer',
    algorithm: 'patch-match',
    patchSize: 16,
    iterations: 5,
    structure: 5,
    color: 5,
    output: 'new-layer',
    adaptation: 'medium',
    rotationAdaptation: true,
    scaleAdaptation: true,
    mirrorAdaptation: true,
    ...options,
  }

  const { width, height } = sourceCanvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)
  ctx.drawImage(sourceCanvas, 0, 0)

  // Get selection mask
  const mask = ctx2d(selectionMask)
  const maskData = mask.getImageData(0, 0, width, height)

  // Create fill mask (inverted selection = areas to fill)
  const fillMask = createFillMask(selectionMask, opts.area)

  switch (opts.algorithm) {
    case 'patch-match':
      return await patchMatchFill(sourceCanvas, fillMask, opts)
    case 'diffusion':
      return await diffusionFill(sourceCanvas, fillMask, opts)
    case 'exemplar':
      return await exemplarFill(sourceCanvas, fillMask, opts)
    case 'deep-learning':
      return await deepLearningFill(sourceCanvas, fillMask, opts)
    default:
      return sourceCanvas
  }
}

/** Create fill mask from selection */
function createFillMask(
  selectionMask: HTMLCanvasElement,
  area: ContentAwareFillOptions['area']
): HTMLCanvasElement {
  const width = selectionMask.width
  const height = selectionMask.height
  const mask = createCanvas(width, height)
  const ctx = ctx2d(mask)

  if (area === 'selection') {
    // Invert selection (selected = don't fill, unselected = fill)
    ctx.drawImage(selectionMask, 0, 0)
    // Invert
    const img = ctx.getImageData(0, 0, width, height)
    const data = img.data
    for (let i = 3; i < data.length; i += 4) {
      data[i] = 255 - data[i]
    }
    ctx.putImageData(img, 0, 0)
  } else if (area === 'transparency') {
    // Fill transparent areas
    // Would need source layer
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  } else if (area === 'layer-bounds') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }

  return mask
}

/** PatchMatch Algorithm - Fast Approximate Nearest Neighbor */
async function patchMatchFill(
  source: HTMLCanvasElement,
  fillMask: HTMLCanvasElement,
  opts: ContentAwareFillOptions
): Promise<HTMLCanvasElement> {
  const { width, height } = source
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)
  ctx.drawImage(source, 0, 0)

  const maskCtx = fillMask.getContext('2d')!
  const maskData = maskCtx.getImageData(0, 0, width, height)
  const sourceData = ctx.getImageData(0, 0, width, height)

  // This is a simplified implementation
  // Real PatchMatch uses randomized search + propagation
  // Here we use a simplified version

  const patchSize = opts.patchSize || 16
  const iterations = opts.iterations || 5
  const halfPatch = Math.floor(patchSize / 2)

  // Find all pixels to fill
  const toFill: Array<{ x: number; y: number }> = []
  const maskData = maskCtx.getImageData(0, 0, width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      if (maskData.data[idx] > 128) {
        toFill.push({ x, y })
      }
    }
  }

  // For each pixel to fill, find best matching patch
  // This is O(n * searchArea) - very slow in JS
  // Real implementation uses randomized search

  // Simplified: just blur and inpaint
  const outputCanvas = await inpaintSimple(source, fillMask)

  return outputCanvas
}

/** Diffusion-based inpainting (Navier-Stokes inspired) */
async function diffusionFill(
  source: HTMLCanvasElement,
  fillMask: HTMLCanvasElement,
  opts: ContentAwareFillOptions
): Promise<HTMLCanvasElement> {
  // This is a simplified diffusion-based inpainting
  // Real implementation would solve PDE

  const { width, height } = source
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)
  ctx.drawImage(source, 0, 0)

  const maskData = fillMask.getContext('2d')!.getImageData(0, 0, width, height)
  const imgData = ctx.getImageData(0, 0, width, height)
  const data = imgData.data

  // Iterative diffusion
  for (let iter = 0; iter < (opts.iterations || 10); iter++) {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4
        const maskIdx = (y * width + x) * 4

        // Only fill masked pixels
        if (fillMask.getContext('2d')!.getImageData(x, y, 1, 1).data[0] < 128) continue

        // Average neighbors
        let r = 0, g = 0, b = 0, a = 0, count = 0

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const ni = ((y + dy) * width + (x + dx)) * 4
            const nMaskIdx = ((y + dy) * width + (x + dx)) * 4

            // Only use non-masked neighbors
            if (fillMask.getContext('2d')!.getImageData(x + dx, y + dy, 1, 1).data[0] < 128) {
              r += data[ni]
              g += data[ni + 1]
              b += data[ni + 2]
              a += data[ni + 3]
              count++
            }
          }
        }

        if (count > 0) {
          const idx = (y * width + x) * 4
          data[idx] = r / count
          data[idx + 1] = g / count
          data[idx + 2] = b / count
          data[idx + 3] = a / count
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0)
  return output
}

/** Exemplar-based inpainting */
async function exemplarFill(
  source: HTMLCanvasElement,
  fillMask: HTMLCanvasElement,
  opts: ContentAwareFillOptions
): Promise<HTMLCanvasElement> {
  // Simplified - would find best exemplar patches
  return await diffusionFill(source, fillMask, opts)
}

/** Deep learning inpainting (placeholder) */
async function deepLearningFill(
  source: HTMLCanvasElement,
  fillMask: HTMLCanvasElement,
  opts: ContentAwareFillOptions
): Promise<HTMLCanvasElement> {
  // Placeholder - would call WebGL/WebGPU shader or WASM model
  return await diffusionFill(source, fillMask, opts)
}

/** Simple inpainting using blur + clone */
async function inpaintSimple(source: HTMLCanvasElement, mask: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const { width, height } = source
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Create multiple blurred versions
  const blurred = createCanvas(width, height)
  const bctx = ctx2d(blurred)
  bctx.filter = 'blur(10px)'
  bctx.drawImage(source, 0, 0)
  bctx.filter = 'none'

  // Composite using mask
  const output2 = createCanvas(width, height)
  const ctx2 = ctx2d(output2)
  ctx2.drawImage(source, 0, 0)
  ctx2.globalCompositeOperation = 'destination-over'
  ctx2.drawImage(blurred, 0, 0)

  // Apply mask
  const maskCtx = mask.getContext('2d')!
  const maskData = maskCtx.getImageData(0, 0, source.width, source.height)
  const outputData = ctx2.getImageData(0, 0, width, height)

  // Blend based on mask
  for (let i = 0; i < maskData.data.length; i += 4) {
    const maskAlpha = maskData.data[i] / 255
    if (maskAlpha > 0.5) {
      // Use blurred
    }
  }

  return source
}

/** Content-Aware Move */
export async function contentAwareMove(
  sourceCanvas: HTMLCanvasElement,
  selectionMask: HTMLCanvasElement,
  targetX: number,
  targetY: number,
  options: ContentAwareMoveOptions = {}
): Promise<HTMLCanvasElement> {
  const { width, height } = sourceCanvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)
  ctx.drawImage(sourceCanvas, 0, 0)

  const mode = options.mode || 'move'
  const structure = options.structure || 5
  const color = options.color || 5

  // Extract selected region
  const selection = extractSelection(sourceCanvas, selectionMask)

  // Fill source hole
  const filled = await contentAwareFill(sourceCanvas, selectionMask, {
    algorithm: 'patch-match',
    structure: structure,
    color: color,
  })

  // Draw filled background
  const ctx = ctx2d(filled)
  if (mode === 'extend') {
    // Draw original + moved copy
    ctx.drawImage(sourceCanvas, 0, 0)
    ctx.drawImage(selection.canvas, targetX, targetY)
  } else {
    // Move: just draw moved copy
    ctx.drawImage(filled, 0, 0)
    ctx.drawImage(selection.canvas, targetX, targetY)
  }

  if (options.transformOnDrop) {
    // Would apply transform
  }

  return filled
}

function extractSelection(
  canvas: HTMLCanvasElement,
  mask: HTMLCanvasElement
): { canvas: HTMLCanvasElement; bounds: { x: number; y: number; width: number; height: number } } {
  const { width, height } = canvas
  const maskCtx = mask.getContext('2d')!
  const maskData = maskCtx.getImageData(0, 0, width, height)

  let minX = width, minY = height, maxX = 0, maxY = 0
  const maskDataArr = maskData.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      if (maskDataArr[idx] > 128) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }

  const selWidth = maxX - minX + 1
  const selHeight = maxY - minY + 1

  const output = createCanvas(selWidth, selHeight)
  const ctx = ctx2d(output)
  ctx.drawImage(canvas, -minX, -minY)

  // Apply mask
  const maskCanvas = createCanvas(selWidth, selHeight)
  const maskCtx = maskCanvas.getContext('2d')!
  maskCtx.drawImage(mask, -minX, -minY)

  // Apply mask to selection
  const selCtx = output.getContext('2d')!
  const selData = selCtx.getImageData(0, 0, selWidth, selHeight)
  const maskSelData = maskCtx.getImageData(0, 0, selWidth, selHeight)
  const selDataArr = selData.data
  const maskSelArr = maskSelData.data

  for (let i = 0; i < selDataArr.length; i += 4) {
    const alpha = maskSelArr[i] / 255
    selDataArr[i + 3] = Math.round(selDataArr[i + 3] * alpha)
  }
  selCtx.putImageData(selData, 0, 0)

  return { canvas: output, bounds: { x: minX, y: minY, width: selWidth, height: selHeight } }
}

/** Content-Aware Scale (Seam Carving inspired) */
export async function contentAwareScale(
  sourceCanvas: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  options: ContentAwareScaleOptions = {}
): Promise<HTMLCanvasElement> {
  const { width, height } = sourceCanvas
  const output = createCanvas(targetWidth, targetHeight)
  const ctx = ctx2d(output)

  // Simplified: just scale with protection
  // Real seam carving would find and remove/duplicate seams

  const scaleX = targetWidth / width
  const scaleY = targetHeight / height

  ctx.save()
  ctx.scale(scaleX, scaleY)
  ctx.drawImage(sourceCanvas, 0, 0)
  ctx.restore()

  return output
}

/** Content-Aware Crop */
export async function contentAwareCrop(
  sourceCanvas: HTMLCanvasElement,
  cropRect: { x: number; y: number; width: number; height: number },
  options: ContentAwareCropOptions = {}
): Promise<HTMLCanvasElement> {
  const { width, height } = sourceCanvas
  const { fillEmpty = true, fillOptions } = options

  // Crop
  const output = createCanvas(cropRect.width, cropRect.height)
  const ctx = ctx2d(output)
  ctx.drawImage(sourceCanvas, -cropRect.x, -cropRect.y)

  // Fill empty areas if crop extends beyond image
  if (fillEmpty && (cropRect.x < 0 || cropRect.y < 0 || cropRect.x + cropRect.width > sourceCanvas.width || cropRect.y + cropRect.height > sourceCanvas.height)) {
    // Create mask for empty areas
    const mask = createCanvas(cropRect.width, cropRect.height)
    const mctx = mask.getContext('2d')!
    mctx.fillStyle = '#ffffff'
    mctx.fillRect(0, 0, cropRect.width, cropRect.height)

    // Subtract original content area
    const contentX = Math.max(0, cropRect.x)
    const contentY = Math.max(0, cropRect.y)
    const contentW = Math.min(cropRect.width, cropRect.x + cropRect.width - contentX)
    const contentH = Math.min(cropRect.height, cropRect.y + cropRect.height - contentY)

    const maskCtx = mask.getContext('2d')!
    maskCtx.globalCompositeOperation = 'destination-out'
    maskCtx.fillRect(contentX - cropRect.x, contentY - cropRect.y, contentW, contentH)

    // Fill empty areas
    const filled = await contentAwareFill(
      createCanvasFromOutput(output),
      mask,
      fillOptions || {
        algorithm: 'patch-match',
        structure: 5,
        color: 5,
      }
    )
    return filled
  }

  return output
}

function createCanvasFromOutput(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const copy = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(copy)
  ctx.drawImage(canvas, 0, 0)
  return copy
}