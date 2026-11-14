'use client'
// GIMP Pattern Maker
// Create seamless repeating patterns with various algorithms

import { createCanvas, ctx2d } from '../utils/canvas'

export interface PatternOptions {
  /** Pattern type */
  type: 'grid' | 'brick' | 'hex' | 'diamond' | 'random' | 'scatter' | 'mirror' | 'kaleidoscope' | 'spiral' | 'wave' | 'fractal' | 'custom'
  /** Source image or pattern */
  source?: HTMLCanvasElement | HTMLImageElement
  /** Pattern dimensions */
  width: number
  height: number
  /** Tile size */
  tileWidth: number
  tileHeight: number
  /** Spacing between tiles */
  spacingX: number
  spacingY: number
  /** Offset */
  offsetX: number
  offsetY: number
  /** Rotation */
  rotation: number
  /** Scale */
  scale: number
  /** Symmetry */
  symmetry: 'none' | 'horizontal' | 'vertical' | 'quad' | 'radial' | 'kaleidoscope'
  /** Symmetry order */
  symmetryOrder: number
  /** Blend mode */
  blendMode: string
  /** Opacity */
  opacity: number
  /** Background */
  background: string
  /** Jitter */
  jitterX: number
  jitterY: number
  /** Random seed */
  seed: number
  /** Variation */
  variation: number
  /** Recursive */
  recursive: boolean
  /** Recursion depth */
  depth: number
  /** Scale factor per recursion */
  scaleFactor: number
  /** Rotation per recursion */
  rotationIncrement: number
  /** Color shift per recursion */
  hueShift: number
}

export interface PatternElement {
  /** Source element */
  source: HTMLCanvasElement | HTMLImageElement
  /** Position */
  x: number
  y: number
  /** Transform */
  scale: number
  rotation: number
  opacity: number
  blendMode: string
  /** Transform origin */
  originX: number
  originY: number
  /** Flip */
  flipX: boolean
  flipY: boolean
}

export interface PatternResult {
  canvas: HTMLCanvasElement
  tileCanvas: HTMLCanvasElement
  elements: PatternElement[]
  metadata: {
    width: number
    height: number
    tileWidth: number
    tileHeight: number
    elementCount: number
  }
}

/** Main pattern generation function */
export async function createPattern(
  options: PatternOptions = {
    type: 'grid',
    width: 512,
    height: 512,
    tileWidth: 256,
    tileHeight: 256,
    spacingX: 0,
    spacingY: 0,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    scale: 1,
    symmetry: 'none',
    symmetryOrder: 4,
    blendMode: 'normal',
    opacity: 100,
    background: 'transparent',
    jitterX: 0,
    jitterY: 0,
    seed: Date.now(),
    variation: 0,
    recursive: false,
    depth: 3,
    scaleFactor: 0.7,
    rotationIncrement: 15,
    hueShift: 0,
  }
): Promise<PatternResult> {
  const {
    type = 'grid',
    width = 512,
    height = 512,
    tileWidth = 256,
    tileHeight = 256,
    spacingX = 0,
    spacingY = 0,
    offsetX = 0,
    offsetY = 0,
    rotation = 0,
    scale = 1,
    symmetry = 'none',
    symmetryOrder = 4,
    blendMode = 'normal',
    opacity = 100,
    background = 'transparent',
    jitterX = 0,
    jitterY = 0,
    seed = Date.now(),
    variation = 0,
    recursive = false,
    depth = 3,
    scaleFactor = 0.7,
    rotationIncrement = 15,
    hueShift = 0,
  } = options

  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)
  const rng = createRNG(seed)

  // Background
  if (background !== 'transparent') {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
  }

  // Create or use source
  let sourceCanvas: HTMLCanvasElement
  if (options.source instanceof HTMLCanvasElement) {
    sourceCanvas = options.source
  } else if (options.source instanceof HTMLImageElement) {
    const temp = createCanvas(options.source.width, options.source.height)
    const ctx = ctx2d(temp)
    ctx.drawImage(options.source, 0, 0)
    sourceCanvas = temp
  } else {
    // Create default pattern element
    sourceCanvas = createDefaultElement(tileWidth, tileHeight)
  }

  // Scale source if needed
  if (scale !== 1) {
    const scaled = createCanvas(
      Math.round(tileWidth * scale),
      Math.round(tileHeight * scale)
    )
    const ctx = ctx2d(scaled)
    ctx.drawImage(sourceCanvas, 0, 0, tileWidth * scale, tileHeight * scale)
    sourceCanvas = scaled
    tileWidth = Math.round(tileWidth * scale)
    tileHeight = Math.round(tileHeight * scale)
  }

  const elements: PatternElement[] = []

  // Generate pattern based on type
  switch (type) {
    case 'grid':
      await generateGridPattern(ctx, sourceCanvas, {
        width, height, tileWidth, tileHeight,
        spacingX, spacingY, offsetX, offsetY,
        rotation, scale, blendMode, opacity,
        symmetry, symmetryOrder,
        jitterX, jitterY, variation, rng: createRNG(seed)
      })
      break

    case 'brick':
      await generateBrickPattern(ctx, sourceCanvas, {
        width, height, tileWidth, tileHeight,
        spacingX, spacingY, offsetX, offsetY,
        rotation, scale, blendMode, opacity,
        symmetry, symmetryOrder,
        jitterX, jitterY, variation, rng: createRNG(seed)
      })
      break

    case 'hex':
      await generateHexPattern(ctx, sourceCanvas, {
        width, height, tileWidth, tileHeight,
        spacingX, spacingY, offsetX, offsetY,
        rotation, scale, blendMode, opacity,
        symmetry, symmetryOrder,
        jitterX, jitterY, variation, rng: createRNG(seed)
      })
      break

    case 'diamond':
      await generateDiamondPattern(ctx, sourceCanvas, {
        width, height, tileWidth, tileHeight,
        spacingX, spacingY, offsetX, offsetY,
        rotation, scale, blendMode, opacity,
        symmetry, symmetryOrder,
        jitterX, jitterY, variation, rng: createRNG(seed)
      })
      break

    case 'random':
    case 'scatter':
      await generateScatterPattern(ctx, sourceCanvas, {
        width, height, tileWidth, tileHeight,
        spacingX, spacingY, offsetX, offsetY,
        rotation, scale, blendMode, opacity,
        jitterX, jitterY, variation, rng: createRNG(seed)
      })
      break

    case 'mirror':
      await generateMirrorPattern(ctx, sourceCanvas, {
        width, height, tileWidth, tileHeight,
        spacingX, spacingY, offsetX, offsetY,
        rotation, scale, blendMode, opacity,
        symmetry, symmetryOrder,
        jitterX, jitterY, variation, rng: createRNG(seed)
      })
      break

    case 'kaleidoscope':
      await generateKaleidoscopePattern(ctx, sourceCanvas, {
        width, height, tileWidth, tileHeight,
        rotation, scale, blendMode, opacity,
        symmetryOrder, rng: createRNG(seed)
      })
      break

    case 'spiral':
      await generateSpiralPattern(ctx, sourceCanvas, {
        width, height, tileWidth, tileHeight,
        rotation, scale, blendMode, opacity,
        rotationIncrement: 15, scaleFactor: 0.85,
        depth: 10, rng: createRNG(seed)
      })
      break

    case 'wave':
      await generateWavePattern(ctx, sourceCanvas, {
        width, height, tileWidth, tileHeight,
        rotation, scale, blendMode, opacity,
        waveAmplitude: 50, waveFrequency: 3,
        rng: createRNG(seed)
      })
      break

    case 'fractal':
      await generateFractalPattern(ctx, sourceCanvas, {
        width, height, tileWidth, tileHeight,
        rotation, scale, blendMode, opacity,
        depth: 5, scaleFactor: 0.6, rotationIncrement: 22.5,
        rng: createRNG(seed)
      })
      break

    default:
      await generateGridPattern(ctx, sourceCanvas, {
        width, height, tileWidth, tileHeight,
        spacingX, spacingY, offsetX, offsetY,
        rotation, scale, blendMode, opacity,
        symmetry, symmetryOrder,
        jitterX, jitterY, variation, rng: createRNG(seed)
      })
  }

  // Apply symmetry
  if (symmetry !== 'none') {
    await applySymmetry(ctx, width, height, symmetry, symmetryOrder)
  }

  // Create tile canvas (single tile)
  const tileCanvas = createCanvas(tileWidth, tileHeight)
  const tileCtx = ctx2d(tileCanvas)
  tileCtx.drawImage(sourceCanvas, 0, 0, tileWidth, tileHeight)

  // Collect elements
  const elements = collectElements(ctx, width, height, tileWidth, tileHeight)

  return {
    canvas,
    tileCanvas,
    elements,
    metadata: {
      width,
      height,
      tileWidth,
      tileHeight,
      elementCount: elements.length,
    },
  }
}

/** Grid pattern */
async function generateGridPattern(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  params: {
    width: number; height: number
    tileWidth: number; tileHeight: number
    spacingX: number; spacingY: number
    offsetX: number; offsetY: number
    rotation: number; scale: number
    blendMode: string; opacity: number
    symmetry: string; symmetryOrder: number
    jitterX: number; jitterY: number
    variation: number
    rng: () => number
  }
): Promise<void> {
  const {
    width, height, tileWidth, tileHeight,
    spacingX, spacingY, offsetX, offsetY,
    rotation, scale, blendMode, opacity,
    jitterX, jitterY, variation, rng
  } = params

  ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
  ctx.globalAlpha = opacity / 100

  const stepX = tileWidth + spacingX
  const stepY = tileHeight + spacingY

  const cols = Math.ceil((width + tileWidth) / stepX) + 2
  const rows = Math.ceil((height + tileHeight) / stepY) + 2

  for (let row = -1; row < rows; row++) {
    for (let col = -1; col < cols; col++) {
      let x = offsetX + col * stepX + spacingX / 2
      let y = offsetY + row * stepY + spacingY / 2

      // Jitter
      if (jitterX > 0) x += (Math.random() - 0.5) * jitterX * 2
      if (jitterY > 0) y += (Math.random() - 0.5) * jitterY * 2

      // Variation
      let scale = 1
      let rotation = 0
      if (variation > 0) {
        scale = 1 + (Math.random() - 0.5) * variation / 50
        rotation = (Math.random() - 0.5) * variation * Math.PI / 180
      }

      const x = col * stepX + offsetX
      const y = row * stepY + offsetY

      ctx.save()
      ctx.translate(x + tileWidth / 2, y + tileHeight / 2)
      ctx.rotate(rotation * Math.PI / 180)
      ctx.scale(scale, scale)
      ctx.globalAlpha = opacity / 100
      ctx.drawImage(source, -source.width / 2, -source.height / 2)
      ctx.restore()
    }
  }
}

/** Brick pattern */
async function generateBrickPattern(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  params: any
): Promise<void> {
  const { width, height, tileWidth, tileHeight, spacingX, spacingY, offsetX, offsetY, blendMode, opacity, rng } = params

  ctx.globalCompositeOperation = params.blendMode as GlobalCompositeOperation
  ctx.globalAlpha = opacity / 100

  const stepX = tileWidth + spacingX
  const stepY = tileHeight + spacingY

  const cols = Math.ceil((width + tileWidth) / stepX) + 2
  const rows = Math.ceil((height + tileHeight) / stepY) + 2

  for (let row = -1; row < rows; row++) {
    for (let col = -1; col < cols; col++) {
      let x = offsetX + col * stepX + spacingX / 2
      let y = offsetY + row * stepY + spacingY / 2

      // Brick offset - every other row offset by half tile
      if (row % 2 === 1) {
        x += stepX / 2
      }

      ctx.save()
      ctx.translate(x + tileWidth / 2, y + tileHeight / 2)
      ctx.globalAlpha = opacity / 100
      ctx.drawImage(source, -source.width / 2, -source.height / 2)
      ctx.restore()
    }
  }
}

/** Hexagonal pattern */
async function generateHexPattern(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  params: any
): Promise<void> {
  const { width, height, tileWidth, tileHeight, spacingX, spacingY, offsetX, offsetY, blendMode, opacity, rng } = params

  ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
  ctx.globalAlpha = opacity / 100

  const hexWidth = tileWidth + spacingX
  const hexHeight = tileHeight * 0.866 + spacingY // sqrt(3)/2

  const cols = Math.ceil(width / hexWidth) + 2
  const rows = Math.ceil(height / hexHeight) + 2

  for (let row = -1; row < rows; row++) {
    for (let col = -1; col < cols; col++) {
      let x = offsetX + col * hexWidth
      let y = offsetY + row * hexHeight

      // Offset every other column
      if (col % 2 === 1) {
        y += hexHeight / 2
      }

      ctx.save()
      ctx.translate(x + tileWidth / 2, y + tileHeight / 2)
      ctx.globalAlpha = opacity / 100
      ctx.drawImage(source, -source.width / 2, -source.height / 2)
      ctx.restore()
    }
  }
}

/** Diamond pattern */
async function generateDiamondPattern(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  params: any
): Promise<void> {
  const { width, height, tileWidth, tileHeight, spacingX, spacingY, offsetX, offsetY, blendMode, opacity, rng } = params

  ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
  ctx.globalAlpha = opacity / 100

  const diamondWidth = tileWidth + spacingX
  const diamondHeight = tileHeight + spacingY

  const cols = Math.ceil((width + diamondWidth) / diamondWidth) + 2
  const rows = Math.ceil((height + diamondHeight) / diamondHeight) + 2

  for (let row = -1; row < rows; row++) {
    for (let col = -1; col < cols; col++) {
      let x = offsetX + col * diamondWidth
      let y = offsetY + row * diamondHeight

      // Diamond offset
      if ((row + col) % 2 === 1) {
        x += diamondWidth / 2
      }

      ctx.save()
      ctx.translate(x + tileWidth / 2, y + tileHeight / 2)
      ctx.rotate(Math.PI / 4) // 45 degrees for diamond
      ctx.globalAlpha = opacity / 100
      ctx.drawImage(source, -source.width / 2, -source.height / 2)
      ctx.restore()
    }
  }
}

/** Scatter/Random pattern */
async function generateScatterPattern(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  params: any
): Promise<void> {
  const { width, height, tileWidth, tileHeight, spacingX, spacingY, offsetX, offsetY, blendMode, opacity, jitterX, jitterY, variation, rng } = params

  ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
  ctx.globalAlpha = opacity / 100

  const count = Math.ceil((width * height) / (tileWidth * tileHeight * 0.5))

  for (let i = 0; i < count; i++) {
    let x = offsetX + rng() * (width - tileWidth)
    let y = offsetY + rng() * (height - tileHeight)

    // Jitter
    x += (rng() - 0.5) * jitterX * 2
    y += (rng() - 0.5) * jitterY * 2

    // Variation
    let scale = 1
    let rotation = 0
    if (variation > 0) {
      scale = 1 + (rng() - 0.5) * variation / 50
      rotation = (rng() - 0.5) * variation * Math.PI / 180
    }

    ctx.save()
    ctx.translate(x + tileWidth / 2, y + tileHeight / 2)
    ctx.rotate(rotation)
    ctx.scale(1, 1)
    ctx.globalAlpha = opacity / 100
    ctx.drawImage(source, -source.width / 2, -source.height / 2)
    ctx.restore()
  }
}

/** Mirror pattern */
async function generateMirrorPattern(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  params: any
): Promise<void> {
  const { width, height, tileWidth, tileHeight, blendMode, opacity, symmetry, rng } = params

  ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
  ctx.globalAlpha = opacity / 100

  // Draw original
  ctx.drawImage(source, (width - source.width) / 2, (height - source.height) / 2)

  // Mirror based on symmetry type
  if (symmetry === 'horizontal' || symmetry === 'quad') {
    // Mirror horizontally
    ctx.save()
    ctx.translate(width, 0)
    ctx.scale(-1, 1)
    ctx.globalAlpha = opacity / 100
    ctx.drawImage(source, (width - source.width) / 2, (height - source.height) / 2)
    ctx.restore()
  }

  if (symmetry === 'vertical' || symmetry === 'quad') {
    // Mirror vertically
    ctx.save()
    ctx.translate(0, height)
    ctx.scale(1, -1)
    ctx.globalAlpha = opacity / 100
    ctx.drawImage(source, (width - source.width) / 2, (height - source.height) / 2)
    ctx.restore()
  }
}

/** Kaleidoscope pattern */
async function generateKaleidoscopePattern(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  params: any
): Promise<void> {
  const { width, height, tileWidth, tileHeight, rotation, scale, blendMode, opacity, symmetryOrder, rng } = params

  ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
  ctx.globalAlpha = opacity / 100

  const centerX = width / 2
  const centerY = height / 2
  const sliceAngle = (Math.PI * 2) / symmetryOrder

  for (let i = 0; i < symmetryOrder; i++) {
    const angle = i * (Math.PI * 2 / symmetryOrder)

    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.rotate(angle)
    ctx.scale(1, 1)
    ctx.globalAlpha = opacity / 100
    ctx.drawImage(source, -source.width / 2, -source.height / 2)
    ctx.restore()

    // Mirror
    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.rotate(angle)
    ctx.scale(-1, 1)
    ctx.globalAlpha = opacity / 100
    ctx.drawImage(source, -source.width / 2, -source.height / 2)
    ctx.restore()
  }
}

/** Spiral pattern */
async function generateSpiralPattern(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  params: any
): Promise<void> {
  const { width, height, tileWidth, tileHeight, rotation, scale, blendMode, opacity, rotationIncrement, scaleFactor, depth, rng } = params

  ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
  ctx.globalAlpha = opacity / 100

  const centerX = width / 2
  const centerY = height / 2
  let angle = rotation * Math.PI / 180
  let currentScale = scale

  for (let i = 0; i < depth; i++) {
    const radius = (width / 2) * (i / depth) * 1.5

    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.rotate(angle)
    ctx.scale(currentScale, currentScale)
    ctx.globalAlpha = opacity / 100 * (1 - i / depth * 0.5)
    ctx.drawImage(source, -source.width / 2, -source.height / 2)
    ctx.restore()

    angle += (rotationIncrement || 15) * Math.PI / 180
    currentScale *= (scaleFactor || 0.85)
  }
}

/** Wave pattern */
async function generateWavePattern(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  params: any
): Promise<void> {
  const { width, height, tileWidth, tileHeight, rotation, scale, blendMode, opacity, waveAmplitude, waveFrequency, rng } = params

  ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
  ctx.globalAlpha = opacity / 100

  const stepX = tileWidth * 1.2
  const stepY = tileHeight * 1.2

  const cols = Math.ceil(width / stepX) + 2
  const rows = Math.ceil(height / stepY) + 2

  for (let row = -1; row < rows; row++) {
    for (let col = -1; col < cols; col++) {
      const x = col * stepX + Math.sin(row * 0.5) * 50
      const y = row * stepY

      ctx.save()
      ctx.translate(x + tileWidth / 2, y + tileHeight / 2)
      ctx.globalAlpha = opacity / 100
      ctx.drawImage(source, -source.width / 2, -source.height / 2)
      ctx.restore()
    }
  }
}

/** Fractal pattern */
async function generateFractalPattern(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  params: any
): Promise<void> {
  const { width, height, tileWidth, tileHeight, rotation, scale, blendMode, opacity, depth, scaleFactor, rotationIncrement, rng } = params

  ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
  ctx.globalAlpha = opacity / 100

  function drawFractal(x: number, y: number, size: number, depthLevel: number, angle: number): void {
    if (depthLevel >= depth) return

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.scale(size / source.width, size / source.height)
    ctx.globalAlpha = opacity / 100 * Math.pow(0.8, depthLevel)
    ctx.drawImage(source, -source.width / 2, -source.height / 2)
    ctx.restore()

    // Recursive calls
    const newSize = size * (scaleFactor || 0.5)
    const angleInc = Math.PI / 4

    for (let i = 0; i < 4; i++) {
      const angle2 = angle + i * Math.PI / 2
      const nx = x + Math.cos(angle2) * size * 0.7
      const ny = y + Math.sin(angle2) * size * 0.7
      drawFractal(nx, ny, newSize, depthLevel + 1, angle + (Math.PI / 8))
    }
  }

  drawFractal(width / 2, height / 2, Math.min(width, height) * 0.4, 0, rotation * Math.PI / 180)
}

/** Apply symmetry */
async function applySymmetry(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  symmetry: string,
  order: number
): Promise<void> {
  if (symmetry === 'none') return

  // Would implement symmetry transformations
}

/** Collect elements for metadata */
function collectElements(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number
): PatternElement[] {
  // Would analyze canvas and extract elements
  return []
}

/** Create default pattern element */
function createDefaultElement(width: number, height: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  // Simple geometric shape
  ctx.fillStyle = '#333'
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, Math.min(width, height) / 3, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, Math.min(width, height) / 6, 0, Math.PI * 2)
  ctx.fill()

  return canvas
}

/** Create RNG */
function createRNG(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/** Pattern presets */
export const PATTERN_PRESETS: Record<string, Partial<PatternOptions>> = {
  'grid': { type: 'grid', spacingX: 0, spacingY: 0 },
  'grid-spaced': { type: 'grid', spacingX: 10, spacingY: 10 },
  'brick': { type: 'brick', spacingX: 0, spacingY: 0 },
  'brick-spaced': { type: 'brick', spacingX: 5, spacingY: 5 },
  'hex': { type: 'hex', spacingX: 0, spacingY: 0 },
  'hex-spaced': { type: 'hex', spacingX: 5, spacingY: 5 },
  'diamond': { type: 'diamond', spacingX: 0, spacingY: 0 },
  'diamond-spaced': { type: 'diamond', spacingX: 10, spacingY: 10 },
  'scatter': { type: 'scatter', jitterX: 20, jitterY: 20, variation: 30 },
  'scatter-rotated': { type: 'scatter', jitterX: 30, jitterY: 30, variation: 50, rotation: 15 },
  'mirror-h': { type: 'mirror', symmetry: 'horizontal' },
  'mirror-v': { type: 'mirror', symmetry: 'vertical' },
  'mirror-quad': { type: 'mirror', symmetry: 'quad' },
  'kaleidoscope-4': { type: 'kaleidoscope', symmetryOrder: 4 },
  'kaleidoscope-6': { type: 'kaleidoscope', symmetryOrder: 6 },
  'kaleidoscope-8': { type: 'kaleidoscope', symmetryOrder: 8 },
  'kaleidoscope-12': { type: 'kaleidoscope', symmetryOrder: 12 },
  'spiral': { type: 'spiral', depth: 8, scaleFactor: 0.8, rotationIncrement: 20 },
  'spiral-tight': { type: 'spiral', depth: 15, scaleFactor: 0.85, rotationIncrement: 10 },
  'wave': { type: 'wave', waveAmplitude: 30, waveFrequency: 3 },
  'fractal': { type: 'fractal', depth: 5, scaleFactor: 0.6, rotationIncrement: 22.5 },
  'fractal-deep': { type: 'fractal', depth: 8, scaleFactor: 0.5, rotationIncrement: 30 },
}

/** Export pattern as tileable image */
export async function exportPattern(
  pattern: PatternResult,
  format: 'png' | 'jpg' | 'webp' = 'png',
  quality = 1
): Promise<Blob> {
  return new Promise((resolve) => {
    pattern.tileCanvas.toBlob((blob) => {
      resolve(blob!)
    }, `image/${format}`, quality)
  })
}

/** Create pattern from image */
export async function createPatternFromImage(
  image: HTMLImageElement | HTMLCanvasElement,
  tileWidth: number,
  tileHeight: number,
  options: Partial<PatternOptions> = {}
): Promise<PatternResult> {
  const canvas = image instanceof HTMLCanvasElement ? image : (() => {
    const c = createCanvas(image.width, image.height)
    ctx2d(c).drawImage(image, 0, 0)
    return c
  })()

  return createPattern({
    ...options,
    source: canvas,
    tileWidth,
    tileHeight,
    width: tileWidth * 2,
    height: tileHeight * 2,
  })
}

/** Make pattern seamless */
export async function makeSeamless(
  canvas: HTMLCanvasElement,
  overlap: number = 50
): Promise<HTMLCanvasElement> {
  const { width, height } = canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Draw original
  ctx.drawImage(canvas, 0, 0)

  // Create seamless edges using cross-fade
  const overlap = Math.min(overlap, width / 2, height / 2)

  // Left-right seam
  const leftStrip = createCanvas(overlap, height)
  const rightStrip = createCanvas(overlap, height)
  const leftCtx = ctx2d(leftStrip)
  const rightCtx = ctx2d(rightStrip)
  leftCtx.drawImage(canvas, 0, 0, overlap, height, 0, 0, overlap, height)
  rightCtx.drawImage(canvas, width - overlap, 0, overlap, height, 0, 0, overlap, height)

  // Blend
  for (let x = 0; x < overlap; x++) {
    const alpha = x / overlap
    // Would blend left and right strips
  }

  // Top-bottom seam
  // Similar process

  return canvas
}