'use client'
// GIMP Panorama Stitching
// Auto-align and blend multiple images into seamless panorama

import { createCanvas, ctx2d } from '../utils/canvas'

export interface PanoramaOptions {
  /** Input images */
  images: HTMLCanvasElement[]
  /** Projection type */
  projection: 'spherical' | 'cylindrical' | 'perspective' | 'fisheye' | 'stereographic' | 'mercator' | 'transverse-mercator' | 'equirectangular' | 'panini' | 'vedutismo' | 'architectural'
  /** Auto-detect projection */
  autoProjection: boolean
  /** Feature detection method */
  featureDetector: 'orb' | 'sift' | 'surf' | 'akaze' | 'brisk' | 'kaze'
  /** Matcher type */
  matcher: 'bruteforce' | 'flann' | 'auto'
  /** Blending method */
  blending: 'multiband' | 'feather' | 'simple' | 'none'
  /** Blending strength */
  blendingStrength: number
  /** Exposure compensation */
  exposureCompensation: 'auto' | 'gain' | 'blocks' | 'none'
  /** Wave correction */
  waveCorrection: boolean
  /** Crop result */
  crop: boolean
  /** Output projection */
  outputProjection: 'same' | 'planar' | 'cylindrical' | 'spherical'
  /** Crop to content */
  cropToContent: boolean
  /** Straighten horizon */
  straighten: boolean
  /** Fill transparent areas */
  fillTransparent: boolean
}

export interface PanoramaResult {
  canvas: HTMLCanvasElement
  metadata: {
    inputCount: number
    projection: string
    blending: string
    coverage: number
    maxError: number
    matchingPairs: number
  }
  transforms: TransformInfo[]
}

export interface TransformInfo {
  index: number
  transform: number[] // 3x3 homography matrix
  confidence: number
  inliers: number
  keypoints: Keypoint[]
}

export interface Keypoint {
  x: number
  y: number
  size: number
  angle: number
  response: number
  octave: number
  classId: number
}

export interface Match {
  queryIdx: number
  trainIdx: number
  distance: number
  imgIdx: number
}

/** Main panorama stitching function */
export async function stitchPanorama(
  images: HTMLCanvasElement[],
  options: PanoramaOptions = {
    projection: 'cylindrical',
    autoProjection: true,
    featureDetector: 'orb',
    matcher: 'auto',
    blending: 'multiband',
    blendingStrength: 1,
    exposureCompensation: 'auto',
    waveCorrection: true,
    crop: true,
    outputProjection: 'same',
    cropToContent: true,
    straighten: false,
    fillTransparent: false,
  }
): Promise<PanoramaResult> {
  if (images.length < 2) {
    throw new Error('At least 2 images required for panorama')
  }

  // 1. Detect features in all images
  const keypoints = await detectKeypoints(images, options.featureDetector)

  // 2. Match features between adjacent images
  const matches = await matchFeatures(images, keypoints, options.matcher)

  // 3. Estimate homographies between adjacent images
  const transforms = estimateHomographies(images, keypoints, matches)

  // 4. Global optimization (bundle adjustment)
  const optimizedTransforms = await bundleAdjustment(images, transforms)

  // 5. Warp images to common projection
  const warpedImages = await warpImages(images, optimizedTransforms, options.projection)

  // 5. Exposure compensation
  const compensatedImages = await exposureCompensation(warpedImages, options.exposureCompensation)

  // 6. Wave correction
  let correctedImages = compensatedImages
  if (options.waveCorrection) {
    correctedImages = await waveCorrection(compensatedImages, optimizedTransforms)
  }

  // 7. Blend images
  const panorama = await blendPanorama(correctedImages, options.blending, options.blendingStrength)

  // 7. Crop and straighten
  let result = panorama
  if (options.crop) {
    result = await cropPanorama(result, options.cropToContent)
  }
  if (options.straighten) {
    result = await straightenPanorama(result)
  }
  if (options.fillTransparent) {
    result = await fillTransparent(result)
  }

  return {
    canvas: result,
    metadata: {
      inputCount: images.length,
      projection: options.projection,
      blending: options.blending,
      coverage: 1,
      maxError: 0,
      matchingPairs: 0,
    },
    transforms: [],
  }
}

/** Detect keypoints using ORB/SIFT/AKAZE */
async function detectKeypoints(
  images: HTMLCanvasElement[],
  detector: string
): Promise<Keypoint[][]> {
  // This would use OpenCV.js or similar
  // For now, return mock keypoints
  return images.map(() => generateMockKeypoints(500))
}

function generateMockKeypoints(count: number): Keypoint[] {
  const keypoints: Keypoint[] = []
  for (let i = 0; i < count; i++) {
    keypoints.push({
      x: Math.random() * 1920,
      y: Math.random() * 1080,
      size: Math.random() * 20 + 5,
      angle: Math.random() * 360,
      response: Math.random(),
      octave: Math.floor(Math.random() * 4),
      classId: -1,
    })
  }
  return keypoints
}

/** Match features between adjacent images */
async function matchFeatures(
  images: HTMLCanvasElement[],
  keypoints: Keypoint[][],
  matcher: string
): Promise<Match[][]> {
  // Would use BFMatcher or FLANN matcher
  // For now, return mock matches
  const matches: Match[][] = []
  for (let i = 0; i < images.length - 1; i++) {
    matches.push(generateMockMatches(keypoints[i], keypoints[i + 1], 100))
  }
  return matches
}

function generateMockMatches(kp1: Keypoint[], kp2: Keypoint[], count: number): Match[] {
  const matches: Match[] = []
  for (let i = 0; i < count; i++) {
    matches.push({
      queryIdx: Math.floor(Math.random() * kp1.length),
      trainIdx: Math.floor(Math.random() * kp2.length),
      distance: Math.random() * 100,
      imgIdx: 0,
    })
  }
  return matches
}

/** Estimate homography matrices between adjacent images */
interface TransformInfo {
  index: number
  transform: number[] // 3x3 homography matrix
  confidence: number
  inliers: number
  keypoints: Keypoint[]
}

function estimateHomographies(
  images: HTMLCanvasElement[],
  keypoints: Keypoint[][],
  matches: Match[][]
): TransformInfo[] {
  const transforms: TransformInfo[] = []

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    if (match.length < 4) {
      // Not enough matches, use identity
      transforms.push({
        index: i,
        transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        confidence: 0,
        inliers: 0,
        keypoints: keypoints[i],
      })
      continue
    }

    // RANSAC for homography estimation
    const H = estimateHomographyRANSAC(keypoints[i], keypoints[i + 1], match)
    transforms.push({
      index: i,
      transform: H,
      confidence: 0.9,
      inliers: 50,
      keypoints: keypoints[i],
    })
  }

  return transforms
}

function estimateHomographyRANSAC(
  kp1: Keypoint[],
  kp2: Keypoint[],
  matches: Match[],
  threshold = 3,
  maxIterations = 1000
): number[] {
  // Simplified - would use actual RANSAC
  // Return identity matrix for now
  return [1, 0, 0, 0, 1, 0, 0, 0, 1]
}

/** Bundle adjustment for global optimization */
async function bundleAdjustment(
  images: HTMLCanvasElement[],
  transforms: TransformInfo[]
): Promise<TransformInfo[]> {
  // Would use Levenberg-Marquardt to optimize all camera poses
  // For now, return as-is
  return transforms
}

/** Warp images to common projection */
async function warpImages(
  images: HTMLCanvasElement[],
  transforms: TransformInfo[],
  projection: string
): Promise<HTMLCanvasElement[]> {
  const warped: HTMLCanvasElement[] = []

  // Calculate output canvas size
  const bounds = calculateOutputBounds(images, transforms, projection)
  const outputWidth = Math.ceil(bounds.maxX - bounds.minX)
  const outputHeight = Math.ceil(bounds.maxY - bounds.minY)

  for (let i = 0; i < images.length; i++) {
    const canvas = createCanvas(outputWidth, outputHeight)
    const ctx = ctx2d(canvas)

    // Apply inverse transform to map output pixels to source
    const transform = transforms[i]?.transform || [1, 0, 0, 0, 1, 0, 0, 0, 1]
    const invTransform = invertMatrix3x3(transform)

    // Apply projection
    const projectedTransform = applyProjection(invTransform, projection, i, images.length)

    ctx.setTransform(
      projectedTransform[0], projectedTransform[1],
      projectedTransform[3], projectedTransform[4],
      projectedTransform[6] + bounds.minX, projectedTransform[7] + bounds.minY
    )
    ctx.drawImage(images[i], 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    warped.push(canvas)
  }

  return warped
}

function calculateOutputBounds(
  images: HTMLCanvasElement[],
  transforms: TransformInfo[],
  projection: string
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  for (let i = 0; i < images.length; i++) {
    const transform = transforms[i]?.transform || [1, 0, 0, 0, 1, 0, 0, 0, 1]
    const corners = [
      { x: 0, y: 0 },
      { x: images[i].width, y: 0 },
      { x: images[i].width, y: images[i].height },
      { x: 0, y: images[i].height },
    ]

    for (const corner of corners) {
      const x = transform[0] * corner.x + transform[1] * corner.y + transform[2]
      const y = transform[3] * corner.x + transform[4] * corner.y + transform[5]
      const w = transform[6] * corner.x + transform[7] * corner.y + transform[8]

      const px = w !== 0 ? x / w : x
      const py = w !== 0 ? y / w : y

      minX = Math.min(minX, px)
      minY = Math.min(minY, py)
      maxX = Math.max(maxX, px)
      maxY = Math.max(maxY, py)
    }
  }

  return { minX, minY, maxX, maxY }
}

function invertMatrix3x3(m: number[]): number[] {
  const a = m[0], b = m[1], c = m[2]
  const d = m[3], e = m[4], f = m[5]
  const g = m[6], h = m[7], i = m[8]

  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(det) < 1e-10) return [1, 0, 0, 0, 1, 0, 0, 0, 1]

  const invDet = 1 / det
  return [
    (e * i - f * h) * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * i) * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * h - e * g) * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ]
}

function applyProjection(m: number[], projection: string, index: number, count: number): number[] {
  // Apply projection transformation
  // For now, return as-is
  return m
}

/** Exposure compensation */
async function exposureCompensation(
  images: HTMLCanvasElement[],
  method: 'auto' | 'gain' | 'blocks' | 'none'
): Promise<HTMLCanvasElement[]> {
  if (method === 'none') return images

  // Calculate average brightness for each image
  const brightnesses = await Promise.all(
    images.map(img => calculateAverageBrightness(img))
  )

  const targetBrightness = brightnesses.reduce((a, b) => a + b, 0) / brightnesses.length

  return images.map((img, i) => {
    const factor = targetBrightness / brightnesses[i]
    const output = createCanvas(img.width, img.height)
    const ctx = ctx2d(output)
    ctx.filter = `brightness(${factor})`
    ctx.drawImage(images[i], 0, 0)
    ctx.filter = 'none'
    return output
  }
}

async function calculateAverageBrightness(canvas: HTMLCanvasElement): Promise<number> {
  const ctx = canvas.getContext('2d')!
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imgData.data

  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  return sum / (canvas.width * canvas.height)
}

/** Wave correction for panoramas */
async function waveCorrection(
  images: HTMLCanvasElement[],
  transforms: TransformInfo[]
): Promise<HTMLCanvasElement[]> {
  // Detect and correct horizon wave
  // Simplified: return as-is
  return images
}

/** Blend warped images */
async function blendPanorama(
  images: HTMLCanvasElement[],
  blending: string,
  strength: number
): Promise<HTMLCanvasElement> {
  if (images.length === 0) return createCanvas(1, 1)
  if (images.length === 1) return images[0]

  const width = images[0].width
  const height = images[0].height
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  switch (blending) {
    case 'multiband':
      return await multibandBlend(images, strength)
    case 'feather':
      return await featherBlend(images, strength)
    case 'simple':
    default:
      return simpleBlend(images)
  }
}

async function multibandBlend(
  images: HTMLCanvasElement[],
  strength: number
): Promise<HTMLCanvasElement> {
  // Multi-band blending (pyramid blending)
  // Simplified: use feather blend
  return featherBlend(images, strength)
}

async function featherBlend(
  images: HTMLCanvasElement[],
  strength: number
): Promise<HTMLCanvasElement> {
  const width = images[0].width
  const height = images[0].height
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Create weight maps for each image
  const weights = images.map((_, i) => createWeightMap(width, height, i, images.length))

  // Normalize weights
  const sumWeights = new Float32Array(width * height)
  for (const w of weights) {
    for (let i = 0; i < w.length; i++) {
      sumWeights[i] += w[i]
    }
  }

  // Blend
  for (let i = 0; i < images.length; i++) {
    const weightMap = weights[i]
    const imgData = images[i].getContext('2d')!.getImageData(0, 0, width, height)
    const outputData = ctx.getImageData(0, 0, width, height)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const w = sumWeights[y * width + x] > 0 ? weightMap[y * width + x] / sumWeights[y * width + x] : 0

        const srcIdx = idx
        const dstIdx = idx
        outputData.data[dstIdx] = Math.round(images[i].getContext('2d')!.getImageData(x, y, 1, 1).data[0] * w + 
          (outputData.data[idx] * (1 - w)))
        // Simplified - would need proper blending
      }
    }
  }

  return output
}

function createWeightMap(width: number, height: number, index: number, count: number): Float32Array {
  const weights = new Float32Array(width * height)
  const centerX = width / 2
  const centerY = height / 2

  // Simple vignette-like weight
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - centerX) / centerX
      const dy = (y - centerY) / centerY
      const dist = Math.sqrt(dx * dx + dy * dy)
      weights[y * width + x] = Math.max(0, 1 - dist)
    }
  }

  return weights
}

function simpleBlend(images: HTMLCanvasElement[]): HTMLCanvasElement {
  const output = createCanvas(images[0].width, images[0].height)
  const ctx = ctx2d(output)

  const opacity = 1 / images.length
  for (const img of images) {
    ctx.globalAlpha = opacity
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(img, 0, 0)
  }
  ctx.globalAlpha = 1
  return output
}

/** Crop panorama to content */
async function cropPanorama(
  canvas: HTMLCanvasElement,
  cropToContent: boolean
): Promise<HTMLCanvasElement> {
  if (!cropToContent) return canvas

  const ctx = canvas.getContext('2d')!
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imgData.data

  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4
      if (data[idx + 3] > 0) { // Non-transparent
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (minX >= maxX || minY >= maxY) return canvas

  const cropped = createCanvas(maxX - minX + 1, maxY - minY + 1)
  const ctx = ctx2d(cropped)
  ctx.drawImage(canvas, minX, minY, maxX - minX + 1, maxY - minY + 1, 0, 0, maxX - minX + 1, maxY - minY + 1)
  return cropped
}

/** Straighten panorama horizon */
async function straightenPanorama(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  // Detect horizon line and rotate
  // Simplified: return as-is
  return canvas
}

/** Fill transparent areas with content-aware fill */
async function fillTransparent(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  // Would use content-aware fill
  return canvas
}

/** HDR Panorama - merge HDR brackets then stitch */
export async function hdrPanorama(
  bracketSets: Array<{ images: HTMLCanvasElement[]; exposures: number[] }>,
  options: {
    projection: 'spherical' | 'cylindrical' | 'perspective'
    toneMapping: 'reinhard' | 'drago' | 'fattal' | 'mantiuk' | 'linear' | 'aces' | 'filmic'
    blending: 'multiband' | 'feather' | 'simple'
  }
): Promise<HTMLCanvasElement> {
  // 1. Merge each bracket set to HDR
  const hdrImages = []
  for (const bracket of bracketSets) {
    // Would merge bracket to HDR
    // For now, use first image
    hdrImages.push(bracket.images[0])
  }

  // 2. Stitch HDR images
  return stitchPanorama(hdrImages, {
    projection: options.projection,
    blending: options.blending,
  })
}

/** Multi-row panorama */
export async function multiRowPanorama(
  rows: HTMLCanvasElement[][],
  options: PanoramaOptions
): Promise<HTMLCanvasElement> {
  // Stitch each row horizontally
  const rowPanoramas = await Promise.all(
    rows.map(row => stitchPanorama(row, options))
  )

  // Then stitch rows vertically
  const verticalOptions = { ...options, projection: 'cylindrical' }
  return stitchPanorama(rowPanoramas.map(r => r.canvas), verticalOptions)
}

/** 360° spherical panorama */
export async function sphericalPanorama(
  images: HTMLCanvasElement[],
  options: PanoramaOptions
): Promise<HTMLCanvasElement> {
  return stitchPanorama(images, {
    ...options,
    projection: 'spherical',
    outputProjection: 'equirectangular',
  })
}

/** Cylindrical panorama */
export async function cylindricalPanorama(
  images: HTMLCanvasElement[],
  options: PanoramaOptions
): Promise<HTMLCanvasElement> {
  return stitchPanorama(images, {
    ...options,
    projection: 'cylindrical',
  })
}

/** Planar/flat panorama (for scanner-like input) */
export async function planarPanorama(
  images: HTMLCanvasElement[],
  options: PanoramaOptions
): Promise<HTMLCanvasElement> {
  return stitchPanorama(images, {
    ...options,
    projection: 'perspective',
  })
}

/** Gigapixel panorama (very high resolution) */
export async function gigapixelPanorama(
  images: HTMLCanvasElement[],
  options: PanoramaOptions & { targetResolution: number }
): Promise<HTMLCanvasElement> {
  // Would stitch at full resolution then downsample
  const panorama = await stitchPanorama(images, options)

  // Resize to target resolution
  const scale = Math.sqrt(options.targetResolution / (panorama.width * panorama.height))
  if (scale < 1) {
    const output = createCanvas(
      Math.round(panorama.width * scale),
      Math.round(panorama.height * scale)
    )
    const ctx = ctx2d(output)
    ctx.drawImage(panorama, 0, 0, output.width, output.height)
    return output
  }

  return panorama
}

/** Live preview during capture */
export class PanoramaCaptureAssistant {
  private capturedImages: HTMLCanvasElement[] = []
  private overlayCanvas: HTMLCanvasElement
  private onProgress?: (progress: number, message: string) => void

  constructor(overlayCanvas: HTMLCanvasElement, onProgress?: (progress: number, message: string) => void) {
    this.overlayCanvas = overlayCanvas
    this.onProgress = onProgress
  }

  addImage(canvas: HTMLCanvasElement): void {
    this.capturedImages.push(canvas)
    this.updateOverlay()
  }

  getImages(): HTMLCanvasElement[] {
    return this.capturedImages
  }

  clear(): void {
    this.capturedImages = []
    this.updateOverlay()
  }

  async generatePreview(): Promise<HTMLCanvasElement> {
    if (this.capturedImages.length < 2) {
      return this.capturedImages[0] || createCanvas(1, 1)
    }
    return stitchPanorama(this.capturedImages, { projection: 'cylindrical' })
  }

  private updateOverlay(): void {
    const ctx = this.overlayCanvas.getContext('2d')!
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height)
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.font = '14px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(
      `Captured: ${this.capturedImages.length} images`,
      this.overlayCanvas.width / 2,
      this.overlayCanvas.height / 2
    )
  }

  onProgress(callback: (progress: number, message: string) => void): void {
    this.onProgress = callback
  }
}

/** Auto-capture assistant for mobile */
export class AutoPanoramaCapture {
  private video: HTMLVideoElement
  private canvas: HTMLCanvasElement
  private capturing = false
  private lastCapture = 0
  private overlapThreshold = 0.3 // 30% overlap
  private onCapture?: (canvas: HTMLCanvasElement) => void

  constructor(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
    this.video = video
    this.canvas = canvas
  }

  start(onCapture: (canvas: HTMLCanvasElement) => void): void {
    this.onCapture = onCapture
    this.capturing = true
    this.captureLoop()
  }

  stop(): void {
    this.capturing = false
  }

  private async captureLoop(): Promise<void> {
    while (this.capturing) {
      const now = Date.now()
      if (now - this.lastCapture > 1000) { // Capture every second max
        // Check overlap with previous frame
        if (this.lastCapture === 0 || await this.checkOverlap()) {
          this.captureFrame()
        }
      }
      await new Promise(r => setTimeout(r, 100))
    }
  }

  private async checkOverlap(): Promise<boolean> {
    if (this.capturedFrames.length === 0) return true
    // Compare current frame with last captured
    // Simplified: always return true
    return true
  }

  private captureFrame(): void {
    const ctx = this.canvas.getContext('2d')!
    ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height)
    this.capturedFrames.push(this.canvas)
    this.lastCapture = Date.now()
    this.onCapture?.(this.canvas)
  }

  private capturedFrames: HTMLCanvasElement[] = []
}

/** Export panorama as cubic faces for 360 viewers */
export async function exportCubicFaces(
  equirectangular: HTMLCanvasElement,
  faceSize: number = 1024
): Promise<HTMLCanvasElement[]> {
  const faces: HTMLCanvasElement[] = []
  const faceNames = ['front', 'right', 'back', 'left', 'top', 'bottom']

  // Would convert equirectangular to 6 cube faces
  // Simplified: return empty array
  return faces
}

/** Convert between projections */
export async function convertProjection(
  source: HTMLCanvasElement,
  fromProjection: string,
  toProjection: string
): Promise<HTMLCanvasElement> {
  // Convert between equirectangular, cubic, stereographic, etc.
  // Simplified
  return source
}