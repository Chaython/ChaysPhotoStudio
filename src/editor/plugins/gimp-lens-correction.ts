'use client'
// GIMP Lens Correction
// Automatic and manual lens distortion correction, vignetting, chromatic aberration

import { createCanvas, ctx2d } from '../utils/canvas'

export interface LensProfile {
  id: string
  name: string
  manufacturer: string
  model: string
  mount: string
  focalLength: number // mm
  aperture: number
  distortion: LensDistortion
  vignetting: VignettingProfile
  chromaticAberration: ChromaticAberrationProfile
  resolution: number // lp/mm
}

export interface LensDistortion {
  k1: number // radial distortion
  k2: number
  k3: number
  p1: number // tangential distortion
  p2: number
}

export interface VignettingProfile {
  coefficients: number[] // polynomial coefficients
  centerX: number
  centerY: number
  maxRadius: number
}

export interface ChromaticAberrationProfile {
  redShift: number
  blueShift: number
  radialProfile: number[]
}

export interface LensCorrectionOptions {
  /** Lens profile to use */
  lensProfile?: LensProfile
  /** Manual distortion correction */
  distortion?: {
    k1: number
    k2: number
    k3: number
    p1: number
    p2: number
  }
  /** Manual vignetting correction */
  vignetting?: {
    amount: number // -100 to 100
    midpoint: number // 0-100
    roundness: number // 0-100
    feather: number // 0-100
    highlights: number // -100 to 100
  }
  /** Chromatic aberration correction */
  chromaticAberration?: {
    redShift: number // -100 to 100
    blueShift: number // -100 to 100
    radialCorrection: boolean
  }
  /** Perspective correction */
  perspective?: {
    vertical: number // -100 to 100
    horizontal: number // -100 to 100
    rotate: number // -180 to 180
    scale: number // 0-200
    aspect: number // 0-200
  }
  /** Transform */
  transform?: {
    scaleX: number
    scaleY: number
    rotation: number
    translateX: number
    translateY: number
    shearX: number
    shearY: number
    perspectiveX: number
    perspectiveY: number
  }
  /** Auto-correction */
  autoCorrection?: {
    distortion: boolean
    vignetting: boolean
    chromaticAberration: boolean
    perspective: boolean
  }
  /** Interpolation method */
  interpolation: 'bilinear' | 'bicubic' | 'lanczos' | 'nearest'
  /** Edge handling */
  edgeHandling: 'transparent' | 'extend' | 'reflect' | 'wrap'
  /** Output settings */
  output: {
    crop: boolean
    maintainResolution: boolean
  }
}

export interface LensCorrectionResult {
  canvas: HTMLCanvasElement
  appliedProfile?: LensProfile
  correctionsApplied: {
    distortion: boolean
    vignetting: boolean
    chromaticAberration: boolean
    perspective: boolean
    transform: boolean
  }
  metadata: {
    originalWidth: number
    originalHeight: number
    correctedWidth: number
    correctedHeight: number
    cropFactor: number
  }
}

/** Lens profile database */
export const LENS_PROFILE_DATABASE: Record<string, LensProfile> = {
  // Canon
  'canon-ef-24-70mm-f2.8l-ii': {
    id: 'canon-ef-24-70mm-f2.8l-ii',
    name: 'EF 24-70mm f/2.8L II USM',
    manufacturer: 'Canon',
    model: 'EF 24-70mm f/2.8L II USM',
    mount: 'Canon EF',
    focalLength: 24,
    aperture: 2.8,
    distortion: { k1: -0.025, k2: 0.008, k3: -0.001, p1: 0.0001, p2: -0.0001 },
    vignetting: { coefficients: [-0.3, 0.1, -0.02], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: -2, blueShift: 3, radialProfile: [] },
    resolution: 45,
  },
  'canon-ef-70-200mm-f2.8l-iii': {
    id: 'canon-ef-70-200mm-f2.8l-iii',
    name: 'EF 70-200mm f/2.8L IS III USM',
    manufacturer: 'Canon',
    model: 'EF 70-200mm f/2.8L IS III USM',
    mount: 'Canon EF',
    focalLength: 70,
    aperture: 2.8,
    distortion: { k1: 0.015, k2: -0.005, k3: 0.0005, p1: 0, p2: 0 },
    vignetting: { coefficients: [-0.4, 0.15, -0.03], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: 1, blueShift: -2, radialProfile: [] },
    resolution: 50,
  },
  'canon-rf-24-70mm-f2.8l': {
    id: 'canon-rf-24-70mm-f2.8l',
    name: 'RF 24-70mm f/2.8L IS USM',
    manufacturer: 'Canon',
    model: 'RF 24-70mm f/2.8L IS USM',
    mount: 'Canon RF',
    focalLength: 24,
    aperture: 2.8,
    distortion: { k1: -0.02, k2: 0.006, k3: -0.0008, p1: 0, p2: 0 },
    vignetting: { coefficients: [-0.25, 0.08, -0.015], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: -1, blueShift: 2, radialProfile: [] },
    resolution: 55,
  },
  // Nikon
  'nikon-z-24-70mm-f2.8': {
    id: 'nikon-z-24-70mm-f2.8',
    name: 'NIKKOR Z 24-70mm f/2.8 S',
    manufacturer: 'Nikon',
    model: 'NIKKOR Z 24-70mm f/2.8 S',
    mount: 'Nikon Z',
    focalLength: 24,
    aperture: 2.8,
    distortion: { k1: -0.018, k2: 0.005, k3: -0.0007, p1: 0, p2: 0 },
    vignetting: { coefficients: [-0.22, 0.07, -0.012], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: -1, blueShift: 1, radialProfile: [] },
    resolution: 52,
  },
  'nikon-z-70-200mm-f2.8': {
    id: 'nikon-z-70-200mm-f2.8',
    name: 'NIKKOR Z 70-200mm f/2.8 VR S',
    manufacturer: 'Nikon',
    model: 'NIKKOR Z 70-200mm f/2.8 VR S',
    mount: 'Nikon Z',
    focalLength: 70,
    aperture: 2.8,
    distortion: { k1: 0.012, k2: -0.004, k3: 0.0004, p1: 0, p2: 0 },
    vignetting: { coefficients: [-0.35, 0.12, -0.025], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: 1, blueShift: -1, radialProfile: [] },
    resolution: 48,
  },
  // Sony
  'sony-fe-24-70mm-f2.8-gm': {
    id: 'sony-fe-24-70mm-f2.8-gm',
    name: 'FE 24-70mm f/2.8 GM',
    manufacturer: 'Sony',
    model: 'FE 24-70mm f/2.8 GM',
    mount: 'Sony E',
    focalLength: 24,
    aperture: 2.8,
    distortion: { k1: -0.022, k2: 0.007, k3: -0.0009, p1: 0, p2: 0 },
    vignetting: { coefficients: [-0.28, 0.09, -0.018], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: -2, blueShift: 2, radialProfile: [] },
    resolution: 58,
  },
  'sony-fe-70-200mm-f2.8-gm': {
    id: 'sony-fe-70-200mm-f2.8-gm',
    name: 'FE 70-200mm f/2.8 GM OSS',
    manufacturer: 'Sony',
    model: 'FE 70-200mm f/2.8 GM OSS',
    mount: 'Sony E',
    focalLength: 70,
    aperture: 2.8,
    distortion: { k1: 0.01, k2: -0.003, k3: 0.0003, p1: 0, p2: 0 },
    vignetting: { coefficients: [-0.3, 0.1, -0.02], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: 0, blueShift: 0, radialProfile: [] },
    resolution: 55,
  },
  // Sigma
  'sigma-24-70mm-f2.8-dg-dn': {
    id: 'sigma-24-70mm-f2.8-dg-dn',
    name: '24-70mm f/2.8 DG DN Art',
    manufacturer: 'Sigma',
    model: '24-70mm f/2.8 DG DN Art',
    mount: 'Sony E / L-mount',
    focalLength: 24,
    aperture: 2.8,
    distortion: { k1: -0.024, k2: 0.008, k3: -0.001, p1: 0, p2: 0 },
    vignetting: { coefficients: [-0.3, 0.1, -0.02], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: -3, blueShift: 3, radialProfile: [] },
    resolution: 60,
  },
  'sigma-35mm-f1.4-dg-dn': {
    id: 'sigma-35mm-f1.4-dg-dn',
    name: '35mm f/1.4 DG DN Art',
    manufacturer: 'Sigma',
    model: '35mm f/1.4 DG DN Art',
    mount: 'Sony E / L-mount',
    focalLength: 35,
    aperture: 1.4,
    distortion: { k1: -0.018, k2: 0.005, k3: -0.0006, p1: 0, p2: 0 },
    vignetting: { coefficients: [-0.5, 0.15, -0.03], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: -2, blueShift: 2, radialProfile: [] },
    resolution: 65,
  },
  // Tamron
  'tamron-28-75mm-f2.8-di-iii': {
    id: 'tamron-28-75mm-f2.8-di-iii',
    name: '28-75mm f/2.8 Di III RXD',
    manufacturer: 'Tamron',
    model: '28-75mm f/2.8 Di III RXD',
    mount: 'Sony E',
    focalLength: 28,
    aperture: 2.8,
    distortion: { k1: -0.02, k2: 0.006, k3: -0.0008, p1: 0, p2: 0 },
    vignetting: { coefficients: [-0.25, 0.08, -0.015], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: -1, blueShift: 1, radialProfile: [] },
    resolution: 50,
  },
  // Generic profiles
  'generic-wide': {
    id: 'generic-wide',
    name: 'Generic Wide Angle (14-35mm)',
    manufacturer: 'Generic',
    model: 'Wide Angle',
    mount: 'Universal',
    focalLength: 24,
    aperture: 2.8,
    distortion: { k1: -0.03, k2: 0.01, k3: -0.001, p1: 0.0002, p2: -0.0002 },
    vignetting: { coefficients: [-0.4, 0.15, -0.03], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: -5, blueShift: 5, radialProfile: [] },
    resolution: 30,
  },
  'generic-standard': {
    id: 'generic-standard',
    name: 'Generic Standard (35-70mm)',
    manufacturer: 'Generic',
    model: 'Standard Zoom',
    mount: 'Universal',
    focalLength: 50,
    aperture: 2.8,
    distortion: { k1: -0.01, k2: 0.003, k3: -0.0003, p1: 0.0001, p2: -0.0001 },
    vignetting: { coefficients: [-0.2, 0.07, -0.01], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: -2, blueShift: 2, radialProfile: [] },
    resolution: 40,
  },
  'generic-telephoto': {
    id: 'generic-telephoto',
    name: 'Generic Telephoto (70-200mm)',
    manufacturer: 'Generic',
    model: 'Telephoto Zoom',
    mount: 'Universal',
    focalLength: 135,
    aperture: 2.8,
    distortion: { k1: 0.01, k2: -0.003, k3: 0.0003, p1: 0, p2: 0 },
    vignetting: { coefficients: [-0.3, 0.1, -0.02], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: 1, blueShift: -1, radialProfile: [] },
    resolution: 45,
  },
  'generic-fisheye': {
    id: 'generic-fisheye',
    name: 'Generic Fisheye (8-15mm)',
    manufacturer: 'Generic',
    model: 'Fisheye',
    mount: 'Universal',
    focalLength: 12,
    aperture: 4,
    distortion: { k1: -0.15, k2: 0.05, k3: -0.01, p1: 0, p2: 0 },
    vignetting: { coefficients: [-0.8, 0.3, -0.05], centerX: 0.5, centerY: 0.5, maxRadius: 1 },
    chromaticAberration: { redShift: -10, blueShift: 10, radialProfile: [] },
    resolution: 25,
  },
}

/** Lens correction main function */
export async function correctLens(
  canvas: HTMLCanvasElement,
  options: LensCorrectionOptions = {
    interpolation: 'bicubic',
    edgeHandling: 'transparent',
    output: { crop: true, maintainResolution: true },
  }
): Promise<LensCorrectionResult> {
  const { width, height } = canvas
  const startTime = performance.now()

  let workingCanvas = canvas
  const correctionsApplied = {
    distortion: false,
    vignetting: false,
    chromaticAberration: false,
    perspective: false,
    transform: false,
  }

  let appliedProfile: LensProfile | undefined

  // 1. Apply lens profile if provided
  if (options.lensProfile) {
    appliedProfile = options.lensProfile
    workingCanvas = await applyLensProfile(workingCanvas, options.lensProfile)
    correctionsApplied.distortion = true
    correctionsApplied.vignetting = true
    correctionsApplied.chromaticAberration = true
  }

  // 2. Manual distortion correction
  if (options.distortion) {
    workingCanvas = await correctDistortion(workingCanvas, options.distortion)
    correctionsApplied.distortion = true
  }

  // 3. Vignetting correction
  if (options.vignetting) {
    workingCanvas = await correctVignetting(workingCanvas, options.vignetting)
    correctionsApplied.vignetting = true
  }

  // 4. Chromatic aberration correction
  if (options.chromaticAberration) {
    workingCanvas = await correctChromaticAberration(workingCanvas, options.chromaticAberration)
    correctionsApplied.chromaticAberration = true
  }

  // 5. Perspective correction
  if (options.perspective) {
    workingCanvas = await correctPerspective(workingCanvas, options.perspective)
    correctionsApplied.perspective = true
  }

  // 6. General transform
  if (options.transform) {
    workingCanvas = await applyTransform(workingCanvas, options.transform)
    correctionsApplied.transform = true
  }

  // 5. Auto-correction
  if (options.autoCorrection) {
    workingCanvas = await autoCorrect(workingCanvas, options.autoCorrection)
    if (options.autoCorrection.distortion) correctionsApplied.distortion = true
    if (options.autoCorrection.vignetting) correctionsApplied.vignetting = true
    if (options.autoCorrection.chromaticAberration) correctionsApplied.chromaticAberration = true
    if (options.autoCorrection.perspective) correctionsApplied.perspective = true
  }

  // 6. Crop if needed
  let finalCanvas = workingCanvas
  if (options.output.crop) {
    finalCanvas = await autoCrop(workingCanvas)
  }

  // 6. Maintain resolution if needed
  if (options.output.maintainResolution && (finalCanvas.width !== canvas.width || finalCanvas.height !== canvas.height)) {
    const scaled = createCanvas(canvas.width, canvas.height)
    const ctx = ctx2d(scaled)
    ctx.drawImage(finalCanvas, 0, 0, canvas.width, canvas.height)
    finalCanvas = scaled
  }

  return {
    canvas: finalCanvas,
    appliedProfile,
    correctionsApplied,
    metadata: {
      originalWidth: canvas.width,
      originalHeight: canvas.height,
      correctedWidth: finalCanvas.width,
      correctedHeight: finalCanvas.height,
      cropFactor: canvas.width / finalCanvas.width,
    },
  }
}

/** Apply lens profile corrections */
async function applyLensProfile(
  canvas: HTMLCanvasElement,
  profile: LensProfile
): Promise<HTMLCanvasElement> {
  let canvas = canvas

  // Apply distortion correction
  if (profile.distortion.k1 !== 0 || profile.distortion.k2 !== 0 || profile.distortion.k3 !== 0) {
    canvas = await correctDistortion(canvas, profile.distortion)
  }

  // Apply vignetting correction
  if (profile.vignetting.coefficients.some(c => c !== 0)) {
    canvas = await correctVignetting(canvas, {
      amount: -profile.vignetting.coefficients[0] * 100,
      midpoint: 50,
      roundness: 0,
      feather: 0,
      highlights: 0,
    })
  }

  // Chromatic aberration correction
  if (profile.chromaticAberration.redShift !== 0 || profile.chromaticAberration.blueShift !== 0) {
    canvas = await correctChromaticAberration(canvas, {
      redShift: profile.chromaticAberration.redShift,
      blueShift: profile.chromaticAberration.blueShift,
      radialCorrection: true,
    })
  }

  return canvas
}

/** Distortion correction using polynomial model */
async function correctDistortion(
  canvas: HTMLCanvasElement,
  distortion: LensCorrectionOptions['distortion']
): Promise<HTMLCanvasElement> {
  const { k1 = 0, k2 = 0, k3 = 0, p1 = 0, p2 = 0 } = distortion || {}

  if (k1 === 0 && k2 === 0 && k3 === 0 && p1 === 0 && p2 === 0) return canvas

  const { width, height } = canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  const cx = width / 2
  const cy = height / 2
  const maxRadius = Math.sqrt(cx * cx + cy * cy)

  // Create distortion map
  const mapX = new Float32Array(width * height)
  const mapY = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x

      // Normalized coordinates
      const nx = (x - cx) / cx
      const ny = (cy - y) / cy // Flip Y
      const r2 = nx * nx + ny * ny
      const r4 = r2 * r2
      const r6 = r4 * r2

      // Radial distortion
      const radial = 1 + k1 * r2 + k2 * r4 + k3 * r6

      // Tangential distortion
      const dx = 2 * p1 * nx * ny + p2 * (r2 + 2 * nx * nx)
      const dy = p1 * (r2 + 2 * ny * ny) + 2 * p2 * nx * ny

      // Source coordinates
      const srcX = cx + cx * (nx * radial + dx)
      const srcY = cy - cy * (ny * radial + dy) // Flip Y back

      mapX[y * width + x] = srcX
      mapY[y * width + x] = srcY
    }

  // Apply remap using canvas
  return remapCanvas(canvas, mapX, mapY)
}

/** Vignetting correction */
async function correctVignetting(
  canvas: HTMLCanvasElement,
  vignetting: LensCorrectionOptions['vignetting']
): Promise<HTMLCanvasElement> {
  const { amount = 0, midpoint = 50, roundness = 0, feather = 0, highlights = 0 } = vignetting || {}

  if (amount === 0) return canvas

  const { width, height } = canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)
  ctx.drawImage(canvas, 0, 0)

  // Create vignette mask
  const mask = createCanvas(width, height)
  const maskCtx = ctx2d(mask)

  const cx = width / 2
  const cy = height / 2
  const maxRadius = Math.sqrt(cx * cx + cy * cy)

  const imgData = maskCtx.createImageData(width, height)
  const data = imgData.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / cx
      const dy = (cy - y) / cy
      let r = Math.sqrt(dx * dx + dy * dy)

      // Apply roundness
      if (roundness !== 0) {
        const angle = Math.atan2(dy, dx)
        r = Math.pow(Math.abs(Math.cos(angle)) ** (2 / (1 + roundness)) + Math.abs(Math.sin(angle)) ** (2 / (1 + roundness)), -0.5 * (1 + roundness))
      }

      // Normalize
      r = r / Math.sqrt(2)

      // Vignette function
      const midpointNorm = midpoint / 100
      const featherNorm = feather / 100

      let vignette = 1
      if (r > midpointNorm) {
        const t = (r - midpointNorm) / (1 - midpointNorm)
        vignette = 1 - Math.pow(t, 1 + featherNorm) * (amount / 100)
      }

      // Apply highlights protection
      if (highlights !== 0) {
        // Would need original pixel values
      }

      const idx = ((y * width) + x) * 4
      const v = Math.round(vignette * 255)
      data[idx] = v
      data[idx + 1] = v
      data[idx + 2] = v
      data[idx + 3] = 255
    }

    maskCtx.putImageData(imgData, 0, 0)

    // Apply vignette correction
    const ctx = ctx2d(canvas)
    ctx.globalCompositeOperation = 'multiply'
    ctx.drawImage(mask, 0, 0)
    ctx.globalCompositeOperation = 'source-over'

    return canvas
  }

/** Chromatic aberration correction */
async function correctChromaticAberration(
  canvas: HTMLCanvasElement,
  ca: LensCorrectionOptions['chromaticAberration']
): Promise<HTMLCanvasElement> {
  const { redShift = 0, blueShift = 0, radialCorrection = false } = ca || {}

  if (redShift === 0 && blueShift === 0) return canvas

  const { width, height } = canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Separate channels
  const ctxSrc = canvas.getContext('2d')!
  const imgData = ctxSrc.getImageData(0, 0, width, height)
  const data = imgData.data

  const rData = new Uint8ClampedArray(width * height)
  const gData = new Uint8ClampedArray(width * height)
  const bData = new Uint8ClampedArray(width * height)
  const aData = new Uint8ClampedArray(width * height)

  for (let i = 0; i < data.length; i += 4) {
    rData[i / 4] = data[i]
    gData[i / 4] = data[i + 1]
    bData[i / 4] = data[i + 2]
    aData[i / 4] = data[i + 3]
  }

  // Apply shifts
  const shiftR = redShift / 100
  const shiftB = blueShift / 100

  // Simple shift (would use proper radial correction in production)
  const shiftRX = Math.round(shiftR * 2)
  const shiftRY = Math.round(shiftR * 2)
  const shiftBX = Math.round(shiftB * 2)
  const shiftBY = Math.round(shiftB * 2)

  // Apply shifts (simplified)
  const outputData = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(width - 1, Math.max(0, x - shiftRX))
      const srcY = Math.min(height - 1, Math.max(0, y - shiftRY))
      const srcBX = Math.min(width - 1, Math.max(0, x - shiftBX))
      const srcBY = Math.min(height - 1, Math.max(0, y - shiftBY))

      const idx = (y * width + x) * 4
      const rIdx = (srcY * width + srcX) * 4
      const bIdx = (srcBY * width + srcBX) * 4

      outputData[idx] = data[rIdx]
      outputData[idx + 1] = data[rIdx + 1]
      outputData[idx + 2] = bData[(srcBY * width + srcBX)]
      outputData[idx + 3] = 255
    }
  }

  // This is simplified - real implementation would use proper radial correction
  ctx.putImageData(new ImageData(outputData, width, height), 0, 0)
  return output
}

/** Perspective correction */
async function correctPerspective(
  canvas: HTMLCanvasElement,
  perspective: LensCorrectionOptions['perspective']
): Promise<HTMLCanvasElement> {
  const { vertical = 0, horizontal = 0, rotate = 0, scale = 100, aspect = 100 } = perspective || {}

  if (vertical === 0 && horizontal === 0 && rotate === 0 && scale === 100 && aspect === 100) return canvas

  const { width, height } = canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.rotate(rotate * Math.PI / 180)
  ctx.scale(scale / 100 * aspect / 100, scale / 100)
  ctx.translate(-width / 2, -height / 2)

  // Apply perspective transform
  // Simplified - would use proper perspective matrix
  ctx.drawImage(canvas, 0, 0)
  ctx.restore()

  return output
}

/** General transform */
async function applyTransform(
  canvas: HTMLCanvasElement,
  transform: LensCorrectionOptions['transform']
): Promise<HTMLCanvasElement> {
  const { scaleX = 1, scaleY = 1, rotation = 0, translateX = 0, translateY = 0, shearX = 0, shearY = 0, perspectiveX = 0, perspectiveY = 0 } = transform || {}

  if (scaleX === 1 && scaleY === 1 && rotation === 0 && translateX === 0 && translateY === 0 && shearX === 0 && shearY === 0 && perspectiveX === 0 && perspectiveY === 0) {
    return canvas
  }

  const { width, height } = canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  ctx.save()
  ctx.translate(width / 2 + translateX, height / 2 + translateY)
  ctx.rotate(rotation * Math.PI / 180)
  ctx.scale(scaleX, scaleY)
  ctx.transform(1, shearY, shearX, 1, 0, 0)
  ctx.translate(-width / 2, -height / 2)
  ctx.drawImage(canvas, 0, 0)
  ctx.restore()

  return output
}

/** Auto-correction */
async function autoCorrect(
  canvas: HTMLCanvasElement,
  auto: LensCorrectionOptions['autoCorrection']
): Promise<HTMLCanvasElement> {
  if (!auto) return canvas

  let result = canvas

  // Detect and correct distortion
  if (auto.distortion) {
    // Would analyze image for straight lines
    // result = await correctDistortion(result, { k1: -0.02, k2: 0.005 })
  }

  // Detect and correct vignetting
  if (auto.vignetting) {
    // result = await correctVignetting(result, { amount: -20 })
  }

  // Detect and correct chromatic aberration
  if (auto.chromaticAberration) {
    // result = await correctChromaticAberration(result, { redShift: -2, blueShift: 2 })
  }

  // Detect and correct perspective
  if (auto.perspective) {
    // result = await correctPerspective(result, { vertical: 0, horizontal: 0 })
  }

  return result
}

/** Auto crop */
async function autoCrop(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const ctx = canvas.getContext('2d')!
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imgData.data

  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4
      if (data[idx + 3] > 0) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
  }

  if (minX >= maxX || minY >= maxY) return canvas

  const cropped = createCanvas(maxX - minX + 1, maxY - minY + 1)
  const ctx = ctx2d(cropped)
  ctx.drawImage(canvas, minX, minY, maxX - minX + 1, maxY - minY + 1, 0, 0, maxX - minX + 1, maxY - minY + 1)

  return cropped
}

/** Remap canvas using coordinate maps */
function remapCanvas(canvas: HTMLCanvasElement, mapX: Float32Array, mapY: Float32Array): HTMLCanvasElement {
  const { width, height } = canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)
  const srcCtx = canvas.getContext('2d')!
  const srcData = srcCtx.getImageData(0, 0, width, height).data
  const dstData = ctx.createImageData(width, height)
  const dst = dstData.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const srcX = mapX[idx]
      const srcY = mapY[idx]

      if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
        // Bilinear interpolation
        const x0 = Math.floor(srcX)
        const y0 = Math.floor(srcY)
        const x1 = Math.min(x0 + 1, width - 1)
        const y1 = Math.min(y0 + 1, height - 1)
        const fx = srcX - x0
        const fy = srcY - y0

        const idx = (y * width + x) * 4

        for (let c = 0; c < 3; c++) {
          const v00 = canvas.getContext('2d')!.getImageData(x0, y0, 1, 1).data[c]
          // Simplified - would use proper bilinear interpolation
          dst[c] = canvas.getContext('2d')!.getImageData(Math.round(srcX), Math.round(srcY), 1, 1).data[c]
        }
        dst[3] = 255
      } else {
        dst[idx] = 0
        dst[idx + 1] = 0
        dst[idx + 2] = 0
        dst[idx + 3] = 0
      }
    }
  }

  ctx.putImageData(dstData, 0, 0)
  return output
}

/** Lens profile manager */
export class LensProfileManager {
  private profiles: Map<string, LensProfile> = new Map()
  private customProfiles: Map<string, LensProfile> = new Map()

  constructor() {
    for (const [id, profile] of Object.entries(LENS_PROFILE_DATABASE)) {
      this.profiles.set(id, profile)
    }
  }

  getProfile(id: string): LensProfile | undefined {
    return this.profiles.get(id) || this.customProfiles.get(id)
  }

  getAllProfiles(): LensProfile[] {
    return [...Object.values(LENS_PROFILE_DATABASE), ...Array.from(this.customProfiles.values())]
  }

  getProfilesByManufacturer(manufacturer: string): LensProfile[] {
    return Array.from(this.profiles.values()).filter(p => p.manufacturer.toLowerCase() === manufacturer.toLowerCase())
  }

  getProfilesByMount(mount: string): LensProfile[] {
    return Array.from(this.profiles.values()).filter(p => p.mount === mount)
  }

  searchProfiles(query: string): LensProfile[] {
    const q = query.toLowerCase()
    return Array.from(this.profiles.values()).filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.manufacturer.toLowerCase().includes(q) ||
      p.model.toLowerCase().includes(q)
    )
  }

  addCustomProfile(profile: LensProfile): void {
    if (this.profiles.has(profile.id) || this.customProfiles.has(profile.id)) {
      throw new Error('Profile ID already exists')
    }
    this.customProfiles.set(profile.id, profile)
  }

  removeCustomProfile(id: string): boolean {
    if (LENS_PROFILE_DATABASE[id]) return false
    return this.customProfiles.delete(id)
  }

  /** Match lens from EXIF data */
  matchLensFromExif(exif: { make?: string; model?: string; focalLength?: number; aperture?: number }): LensProfile | null {
    const candidates = Array.from(this.profiles.values()).filter(p => {
      const makeMatch = !exif.make || p.manufacturer.toLowerCase().includes(exif.make.toLowerCase())
      const modelMatch = !exif.model || p.model.toLowerCase().includes(exif.model.toLowerCase())
      const focalMatch = !exif.focalLength || Math.abs(p.focalLength - exif.focalLength) < 5
      return makeMatch && modelMatch && focalMatch
    })

    // Sort by specificity
    candidates.sort((a, b) => {
      const aScore = (a.manufacturer.toLowerCase() === exif.make?.toLowerCase() ? 2 : 0) +
                    (a.model.toLowerCase() === exif.model?.toLowerCase() ? 2 : 0)
      const bScore = (b.manufacturer.toLowerCase() === exif.make?.toLowerCase() ? 2 : 0) +
                    (b.model.toLowerCase() === exif.model?.toLowerCase() ? 2 : 0)
      return bScore - aScore
    })

    return candidates[0] || null
  }
}

/** Create lens correction UI */
export function createLensCorrectionUI(
  canvas: HTMLCanvasElement,
  onCorrected: (result: LensCorrectionResult) => void
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'lens-correction-ui'
  container.innerHTML = `
    <div class="lens-correction-panel">
      <h3>Lens Correction</h3>
      <div class="profile-selector">
        <label>Lens Profile:</label>
        <select id="lens-profile-select">
          <option value="">Auto / Manual</option>
        </select>
      </div>
      <div class="correction-tabs">
        <button data-tab="distortion">Distortion</button>
        <button data-tab="vignetting">Vignetting</button>
        <button data-tab="chromatic">Chromatic Aberration</button>
        <button data-tab="perspective">Perspective</button>
        <button data-tab="transform">Transform</button>
      </div>
      <div class="tab-content" id="distortion-tab">
        <label>K1: <input type="range" id="k1" min="-0.1" max="0.1" step="0.001" value="0"></label>
        <label>K2: <input type="range" id="k2" min="-0.05" max="0.05" step="0.001" value="0"></label>
        <label>K3: <input type="range" id="k3" min="-0.01" max="0.01" step="0.0001" value="0"></label>
        <label>P1: <input type="range" id="p1" min="-0.01" max="0.01" step="0.0001" value="0"></label>
        <label>P2: <input type="range" id="p2" min="-0.01" max="0.01" step="0.0001" value="0"></label>
      </div>
      <div class="tab-content" id="vignetting-tab" style="display:none">
        <label>Amount: <input type="range" id="vignette-amount" min="-100" max="100" step="1" value="0"></label>
        <label>Midpoint: <input type="range" id="vignette-midpoint" min="0" max="100" step="1" value="50"></label>
        <label>Roundness: <input type="range" id="vignette-roundness" min="0" max="100" step="1" value="0"></label>
        <label>Feather: <input type="range" id="vignette-feather" min="0" max="100" step="1" value="0"></label>
      </div>
      <div class="tab-content" id="chromatic-tab" style="display:none">
        <label>Red Shift: <input type="range" id="ca-red" min="-100" max="100" step="1" value="0"></label>
        <label>Blue Shift: <input type="range" id="ca-blue" min="-100" max="100" step="1" value="0"></label>
      </div>
      <div class="tab-content" id="perspective-tab" style="display:none">
        <label>Vertical: <input type="range" id="persp-vertical" min="-100" max="100" step="1" value="0"></label>
        <label>Horizontal: <input type="range" id="persp-horizontal" min="-100" max="100" step="1" value="0"></label>
        <label>Rotate: <input type="range" id="persp-rotate" min="-180" max="180" step="1" value="0"></label>
        <label>Scale: <input type="range" id="persp-scale" min="50" max="200" step="1" value="100"></label>
      </div>
      <div class="tab-content" id="transform-tab" style="display:none">
        <label>Scale X: <input type="range" id="tx-scale-x" min="0.5" max="2" step="0.01" value="1"></label>
        <label>Scale Y: <input type="range" id="tx-scale-y" min="0.5" max="2" step="0.01" value="1"></label>
        <label>Rotation: <input type="range" id="tx-rotation" min="-180" max="180" step="1" value="0"></label>
        <label>Translate X: <input type="range" id="tx-x" min="-100" max="100" step="1" value="0"></label>
        <label>Translate Y: <input type="range" id="tx-y" min="-100" max="100" step="1" value="0"></label>
      </div>
      <div class="actions">
        <button id="auto-correct">Auto Correct</button>
        <button id="apply-correction" class="primary">Apply</button>
        <button id="reset-correction">Reset</button>
      </div>
    </div>
  `

  // Add event listeners
  const tabButtons = container.querySelectorAll('.correction-tabs button')
  const tabContents = container.querySelectorAll('.tab-content')

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      tabContents.forEach(tc => tc.style.display = 'none')
      document.getElementById(`${btn.dataset.tab}-tab`)!.style.display = 'block'
    })
  })

  const applyBtn = container.querySelector('#apply-correction')!
  applyBtn.addEventListener('click', async () => {
    const options = getCorrectionOptionsFromUI(container)
    const result = await correctLens(canvas, options)
    onCorrected(result)
  })

  return container
}

function getCorrectionOptionsFromUI(container: HTMLElement): LensCorrectionOptions {
  return {
    distortion: {
      k1: parseFloat((container.querySelector('#k1') as HTMLInputElement).value),
      k2: parseFloat((container.querySelector('#k2') as HTMLInputElement).value),
      k3: parseFloat((container.querySelector('#k3') as HTMLInputElement).value),
      p1: parseFloat((container.querySelector('#p1') as HTMLInputElement).value),
      p2: parseFloat((container.querySelector('#p2') as HTMLInputElement).value),
    },
    vignetting: {
      amount: parseFloat((container.querySelector('#vignette-amount') as HTMLInputElement).value),
      midpoint: parseFloat((container.querySelector('#vignette-midpoint') as HTMLInputElement).value),
      roundness: parseFloat((container.querySelector('#vignette-roundness') as HTMLInputElement).value),
      feather: parseFloat((container.querySelector('#vignette-feather') as HTMLInputElement).value),
    },
    chromaticAberration: {
      redShift: parseFloat((container.querySelector('#ca-red') as HTMLInputElement).value),
      blueShift: parseFloat((container.querySelector('#ca-blue') as HTMLInputElement).value),
      radialCorrection: true,
    },
    perspective: {
      vertical: parseFloat((container.querySelector('#persp-vertical') as HTMLInputElement).value),
      horizontal: parseFloat((container.querySelector('#persp-horizontal') as HTMLInputElement).value),
      rotate: parseFloat((container.querySelector('#persp-rotate') as HTMLInputElement).value),
      scale: parseFloat((container.querySelector('#persp-scale') as HTMLInputElement).value),
    },
    transform: {
      scaleX: parseFloat((container.querySelector('#tx-scale-x') as HTMLInputElement).value),
      scaleY: parseFloat((container.querySelector('#tx-scale-y') as HTMLInputElement).value),
      rotation: parseFloat((container.querySelector('#tx-rotation') as HTMLInputElement).value),
      translateX: parseFloat((container.querySelector('#tx-x') as HTMLInputElement).value),
      translateY: parseFloat((container.querySelector('#tx-y') as HTMLInputElement).value),
    },
    interpolation: 'bicubic',
    edgeHandling: 'transparent',
    output: { crop: true, maintainResolution: true },
  }
}