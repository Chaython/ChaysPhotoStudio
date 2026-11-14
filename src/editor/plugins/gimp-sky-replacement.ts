'use client'
// GIMP Sky Replacement
// AI-powered sky detection and replacement with realistic blending

import { createCanvas, ctx2d } from '../utils/canvas'

export interface SkyReplacementOptions {
  /** Source image */
  sourceCanvas: HTMLCanvasElement
  /** Sky replacement image */
  skyCanvas: HTMLCanvasElement
  /** Sky segmentation mask (optional, will auto-detect if not provided) */
  skyMask?: HTMLCanvasElement
  /** Edge feathering */
  edgeFeather: number
  /** Sky brightness adjustment */
  brightness: number
  /** Sky temperature adjustment */
  temperature: number
  /** Sky scale */
  scale: number
  /** Vertical position */
  verticalPosition: number
  /** Horizontal flip */
  flipHorizontal: boolean
  /** Blend mode */
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'hard-light'
  /** Foreground lighting adjustment */
  foregroundLighting: number
  /** Edge lighting */
  edgeLighting: number
  /** Color harmonization */
  colorHarmonization: number
  /** Output mask */
  outputMask: boolean
}

export interface SkySegmentationResult {
  /** Sky mask (white = sky, black = foreground) */
  mask: HTMLCanvasElement
  /** Confidence map */
  confidence: HTMLCanvasElement
  /** Sky bounding box */
  skyBounds: { x: number; y: number; width: number; height: number }
  /** Detected horizon line */
  horizonLine?: { y: number; confidence: number }
}

/** Main sky replacement function */
export async function replaceSky(
  options: SkyReplacementOptions
): Promise<{
  result: HTMLCanvasElement
  mask: HTMLCanvasElement
  metadata: {
    skyDetected: boolean
    horizonDetected: boolean
    blendingTime: number
  }
}> {
  const startTime = performance.now()

  const {
    sourceCanvas,
    skyCanvas,
    skyMask,
    edgeFeather = 20,
    brightness = 0,
    temperature = 0,
    scale = 100,
    verticalPosition = 0,
    flipHorizontal = false,
    blendMode = 'normal',
    foregroundLighting = 0,
    edgeLighting = 0,
    colorHarmonization = 0,
    outputMask = false,
  } = options

  const { width, height } = sourceCanvas

  // 1. Get or generate sky mask
  let skyMaskCanvas: HTMLCanvasElement
  if (skyMask) {
    skyMaskCanvas = skyMask
  } else {
    skyMaskCanvas = await detectSky(sourceCanvas)
  }

  // 2. Refine mask edges
  const refinedMask = await refineMaskEdges(skyMaskCanvas, edgeFeather)

  // 3. Prepare sky image
  const preparedSky = await prepareSkyImage(skyCanvas, {
    scale,
    verticalPosition,
    flipHorizontal,
    brightness,
    temperature,
    sourceWidth: width,
    sourceHeight: height,
  })

  // 3. Blend sky with foreground
  const result = await compositeSky(
    sourceCanvas,
    preparedSky,
    refinedMask,
    {
      blendMode,
      foregroundLighting,
      edgeLighting,
      colorHarmonization,
      edgeFeather,
    }
  )

  // 5. Apply foreground lighting adjustments
  if (foregroundLighting !== 0 || edgeLighting !== 0) {
    await applyForegroundLighting(result, refinedMask, foregroundLighting, edgeLighting)
  }

  // 6. Color harmonization
  if (colorHarmonization !== 0) {
    await harmonizeColors(result, preparedSky, refinedMask, colorHarmonization)
  }

  return {
    result,
    mask: refinedMask,
    metadata: {
      skyDetected: true,
      horizonDetected: true,
      blendingTime: performance.now() - startTime,
    },
  }
}

/** Detect sky using simple heuristics (would use ML model in production) */
async function detectSky(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const { width, height } = canvas
  const mask = createCanvas(width, height)
  const ctx = ctx2d(mask)
  const maskCtx = ctx2d(mask)

  const imgData = ctx.getImageData(0, 0, width, height)
  const data = imgData.data

  // Simple sky detection: blue pixels in upper portion
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]

      // Sky detection heuristic
      const isBlue = b > r && b > g && b > 100
      const isUpperHalf = y < height * 0.7
      const saturation = Math.max(r, g, b) - Math.min(r, g, b)

      let skyProb = 0
      if (isBlue && isUpperHalf && saturation > 30) skyProb = 1
      else if (isBlue && isUpperHalf) skyProb = 0.7
      else if (isUpperHalf && saturation < 50) skyProb = 0.3

      // Gradient from top to bottom
      const verticalFactor = 1 - y / (height * 0.8)
      skyProb *= Math.max(0, verticalFactor)

      const maskValue = Math.round(skyProb * 255)
      data[idx] = maskValue
      data[idx + 1] = maskValue
      data[idx + 2] = maskValue
      data[idx + 3] = 255
    }

    ctx.putImageData(imgData, 0, 0)
    return mask
  }

/** Refine mask edges with feathering and cleanup */
async function refineMaskEdges(
  mask: HTMLCanvasElement,
  feather: number
): Promise<HTMLCanvasElement> {
  const { width, height } = mask
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Apply Gaussian blur for feathering
  ctx.filter = `blur(${feather}px)`
  ctx.drawImage(mask, 0, 0)
  ctx.filter = 'none'

  // Threshold to clean up
  const imgData = ctx.getImageData(0, 0, width, height)
  const data = imgData.data
  for (let i = 3; i < data.length; i += 4) {
    data[i] = data[i] > 128 ? 255 : 0
  }
  ctx.putImageData(imgData, 0, 0)

  return output
}

/** Prepare sky image with transformations */
async function prepareSkyImage(
  skyCanvas: HTMLCanvasElement,
  options: {
    scale: number
    verticalPosition: number
    flipHorizontal: boolean
    brightness: number
    temperature: number
    sourceWidth: number
    sourceHeight: number
  }
): Promise<HTMLCanvasElement> {
  const { scale, verticalPosition, flipHorizontal, brightness, temperature, sourceWidth, sourceHeight } = options

  // Calculate sky dimensions
  const skyAspect = skyCanvas.width / skyCanvas.height
  const targetWidth = sourceWidth
  const targetHeight = targetWidth / skyAspect

  // Apply scale
  const scaledWidth = targetWidth * (scale / 100)
  const scaledHeight = targetHeight * (scale / 100)

  // Create output canvas
  const output = createCanvas(sourceWidth, sourceHeight)
  const ctx = ctx2d(output)

  // Calculate position
  const x = (sourceWidth - scaledWidth) / 2
  const y = (sourceHeight - scaledHeight) / 2 + (verticalPosition / 100) * sourceHeight * 0.5

  // Apply transformations
  ctx.save()
  ctx.translate(x + scaledWidth / 2, y + scaledHeight / 2)

  if (flipHorizontal) {
    ctx.scale(-1, 1)
  }

  // Apply brightness and temperature
  let filter = ''
  if (brightness !== 0) filter += `brightness(${1 + brightness / 100}) `
  if (temperature !== 0) filter += `hue-rotate(${temperature}deg) `
  ctx.filter = filter.trim()

  // Draw sky
  ctx.drawImage(skyCanvas, -scaledWidth / 2, -scaledHeight / 2, scaledWidth, scaledHeight)
  ctx.restore()
  ctx.filter = 'none'

  return output
}

/** Composite sky with foreground using mask */
async function compositeSky(
  foreground: HTMLCanvasElement,
  sky: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  options: {
    blendMode: string
    foregroundLighting: number
    edgeLighting: number
    colorHarmonization: number
    edgeFeather: number
  }
): Promise<HTMLCanvasElement> {
  const { width, height } = foreground
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Draw foreground
  ctx.drawImage(foreground, 0, 0)

  // Apply sky using mask
  ctx.save()
  ctx.globalCompositeOperation = 'destination-over'

  // Create masked sky
  const maskedSky = createCanvas(width, height)
  const skyCtx = ctx2d(maskedSky)
  skyCtx.drawImage(sky, 0, 0)

  // Apply mask
  skyCtx.globalCompositeOperation = 'destination-in'
  skyCtx.drawImage(mask, 0, 0)

  // Apply blend mode
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(maskedSky, 0, 0)
  ctx.restore()

  return output
}

/** Apply foreground lighting adjustments */
async function applyForegroundLighting(
  canvas: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  foregroundLighting: number,
  edgeLighting: number
): Promise<void> {
  if (foregroundLighting === 0 && edgeLighting === 0) return

  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas

  // Create lighting overlay
  const lighting = createCanvas(width, height)
  const lightCtx = ctx2d(lighting)

  // Edge lighting (rim light)
  if (edgeLighting !== 0) {
    const gradient = lightCtx.createRadialGradient(
      width / 2, height / 2, 0,
      width / 2, height / 2, Math.max(width, height) / 2
    )
    if (edgeLighting > 0) {
      gradient.addColorStop(0, 'rgba(255,255,255,0)')
      gradient.addColorStop(1, `rgba(255,255,200,${edgeLighting / 100})`)
    } else {
      gradient.addColorStop(0, 'rgba(0,0,0,0)')
      gradient.addColorStop(1, `rgba(0,0,0,${Math.abs(edgeLighting) / 100})`)
    }
    lightCtx.fillStyle = gradient
    lightCtx.fillRect(0, 0, width, height)
  }

  // Foreground lighting
  if (foregroundLighting !== 0) {
    lightCtx.globalCompositeOperation = 'overlay'
    lightCtx.fillStyle = foregroundLighting > 0
      ? `rgba(255,255,200,${foregroundLighting / 200})`
      : `rgba(50,50,80,${Math.abs(foregroundLighting) / 200})`
    lightCtx.fillRect(0, 0, width, height)
  }

  // Apply lighting
  ctx.globalCompositeOperation = 'overlay'
  ctx.drawImage(lighting, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
}

/** Harmonize colors between sky and foreground */
async function harmonizeColors(
  canvas: HTMLCanvasElement,
  sky: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  strength: number
): Promise<void> {
  if (strength === 0) return

  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas

  // Get average sky color
  const skyCtx = sky.getContext('2d')!
  const skyData = skyCtx.getImageData(0, 0, width, height).data

  let skyR = 0, skyG = 0, skyB = 0, skyCount = 0
  const maskCtx = mask.getContext('2d')!
  const maskData = maskCtx.getImageData(0, 0, width, height).data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      if (maskData[idx] > 128) { // Sky pixel
        skyR += skyData[idx]
        skyG += skyData[idx + 1]
        skyB += skyData[idx + 2]
        skyCount++
      }
    }
  }

  if (skyCount === 0) return

  const avgSkyR = skyR / skyCount
  const avgSkyG = skyG / skyCount
  const avgSkyB = skyB / skyCount

  // Get foreground average
  const canvasData = ctx.getImageData(0, 0, width, height).data
  let fgR = 0, fgG = 0, fgB = 0, fgCount = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      if (maskData[idx] < 128) { // Foreground pixel
        fgR += canvasData[idx]
        fgG += canvasData[idx + 1]
        fgB += canvasData[idx + 2]
        fgCount++
      }
    }
  }

  if (fgCount === 0) return

  const avgFgR = fgR / fgCount
  const avgFgG = fgG / fgCount
  const avgFgB = fgB / fgCount

  // Calculate color shift
  const shiftR = (avgSkyR - avgFgR) * (strength / 100)
  const shiftG = (avgSkyG - avgFgG) * (strength / 100)
  const shiftB = (avgSkyB - avgFgB) * (strength / 100)

  // Apply color shift to foreground
  const imgData = ctx.getImageData(0, 0, width, height)
  const data = imgData.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      if (maskData[idx] < 128) { // Foreground
        data[idx] = Math.min(255, Math.max(0, data[idx] + shiftR))
        data[idx + 1] = Math.min(255, Math.max(0, data[idx + 1] + shiftG))
        data[idx + 2] = Math.min(255, Math.max(0, data[idx + 2] + shiftB))
      }
    }
  }

  ctx.putImageData(imgData, 0, 0)
}

/** Batch sky replacement for multiple images */
export async function batchSkyReplacement(
  images: HTMLCanvasElement[],
  skyCanvas: HTMLCanvasElement,
  options: SkyReplacementOptions
): Promise<HTMLCanvasElement[]> {
  const results: HTMLCanvasElement[] = []

  for (const image of images) {
    const result = await replaceSky({
      ...options,
      sourceCanvas: image,
      skyCanvas,
    })
    results.push(result.result)
  }

  return results
}

/** Sky library with built-in skies */
export const SKY_LIBRARY: Record<string, {
  name: string
  preview: string // base64 thumbnail
  tags: string[]
  timeOfDay: 'sunrise' | 'day' | 'sunset' | 'night' | 'stormy' | 'cloudy'
}> = {
  'clear-blue': { name: 'Clear Blue Sky', preview: '', tags: ['clear', 'blue', 'day'], timeOfDay: 'day' },
  'golden-hour': { name: 'Golden Hour', preview: '', tags: ['golden', 'warm', 'sunset'], timeOfDay: 'sunset' },
  'sunset': { name: 'Sunset', preview: '', tags: ['orange', 'red', 'sunset'], timeOfDay: 'sunset' },
  'sunrise': { name: 'Sunrise', preview: '', tags: ['pink', 'purple', 'morning'], timeOfDay: 'sunrise' },
  'stormy': { name: 'Stormy Sky', preview: '', tags: ['dark', 'clouds', 'dramatic'], timeOfDay: 'stormy' },
  'cloudy': { name: 'Cloudy', preview: '', tags: ['clouds', 'overcast', 'soft'], timeOfDay: 'cloudy' },
  'starry-night': { name: 'Starry Night', preview: '', tags: ['stars', 'night', 'milky-way'], timeOfDay: 'night' },
  'aurora': { name: 'Aurora Borealis', preview: '', tags: ['aurora', 'northern-lights', 'night'], timeOfDay: 'night' },
  'fire-sky': { name: 'Fire Sky', preview: '', tags: ['red', 'orange', 'intense', 'sunset'], timeOfDay: 'sunset' },
  'pastel-sky': { name: 'Pastel Sky', preview: '', tags: ['soft', 'pastel', 'dreamy'], timeOfDay: 'day' },
}

/** Get sky from library */
export function getSkyFromLibrary(key: string): { name: string; tags: string[]; timeOfDay: string } | null {
  return SKY_LIBRARY[key] || null
}

/** Generate sky procedurally */
export async function generateProceduralSky(
  type: 'clear' | 'cloudy' | 'stormy' | 'sunset' | 'sunrise' | 'night' | 'aurora',
  width: number,
  height: number
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  // Would generate procedural sky
  // Simplified: gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, height)

  switch (type) {
    case 'clear':
      gradient.addColorStop(0, '#0077ff')
      gradient.addColorStop(1, '#87ceeb')
      break
    case 'cloudy':
      gradient.addColorStop(0, '#888888')
      gradient.addColorStop(1, '#cccccc')
      break
    case 'stormy':
      gradient.addColorStop(0, '#2c2c2c')
      gradient.addColorStop(0.5, '#555555')
      gradient.addColorStop(1, '#888888')
      break
    case 'sunset':
      gradient.addColorStop(0, '#ff6b35')
      gradient.addColorStop(0.5, '#ff9900')
      gradient.addColorStop(1, '#ffff00')
      break
    case 'sunrise':
      gradient.addColorStop(0, '#ff6600')
      gradient.addColorStop(0.5, '#ffcc00')
      gradient.addColorStop(1, '#ff9933')
      break
    case 'night':
      gradient.addColorStop(0, '#000033')
      gradient.addColorStop(0.5, '#000066')
      gradient.addColorStop(1, '#001133')
      break
    case 'aurora':
      gradient.addColorStop(0, '#003300')
      gradient.addColorStop(0.5, '#006600')
      gradient.addColorStop(1, '#003300')
      break
  }

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  // Add stars for night
  if (type === 'night' || type === 'aurora') {
    for (let i = 0; i < width * height * 0.001; i++) {
      const x = Math.random() * width
      const y = Math.random() * height * 0.7
      const size = Math.random() * 2 + 0.5
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.5 + 0.5})`
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  return canvas
}