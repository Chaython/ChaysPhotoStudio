'use client'
// GIMP Clouds & Fibers
// Procedural noise generation: clouds, fibers, noise, procedural patterns

import { createCanvas, ctx2d } from '../utils/canvas'

export interface CloudsOptions {
  /** Cloud type */
  type: 'clouds' | 'difference-clouds' | 'solid-noise' | 'plasma' | 'turbulence' | 'ridge' | 'billow' | 'voronoi' | 'cellular' | 'worley'
  /** Size/scale */
  size: number // 1-100
  /** Detail level */
  detail: number // 1-10
  /** Contrast */
  contrast: number // 0-100
  /** Brightness */
  brightness: number // -100 to 100
  /** Color mode */
  colorMode: 'grayscale' | 'color' | 'gradient' | 'custom'
  /** Gradient for color mode */
  gradient?: { stops: Array<{ position: number; color: string }> }
  /** Seed for reproducibility */
  seed: number
  /** Octaves */
  octaves: number
  /** Persistence */
  persistence: number
  /** Lacunarity */
  lacunarity: number
  /** Color stops for gradient mode */
  colors?: Array<{ position: number; color: string }>
  /** Turbulence */
  turbulence: number
  /** Ridged multifractal */
  ridged: boolean
  /** Billow */
  billow: boolean
  /** Seed */
  seed: number
  /** Anisotropy */
  anisotropy: number
  /** Rotation */
  rotation: number
  /** Tileable */
  tileable: boolean
}

export interface FiberOptions {
  /** Fiber type */
  type: 'fibers' | 'woven' | 'brushed' | 'scratches' | 'hair' | 'fur' | 'grass' | 'lines' | 'grid' | 'crosshatch'
  /** Length */
  length: number // 1-1000
  /** Width */
  width: number // 0.1-10
  /** Density */
  density: number // 1-1000
  /** Variation */
  variation: number // 0-100
  /** Curvature */
  curvature: number // 0-100
  /** Taper */
  taper: number // 0-100
  /** Color */
  color: string
  /** Background color */
  backgroundColor: string
  /** Color variation */
  colorVariation: number // 0-100
  /** Transparency */
  transparency: number // 0-100
  /** Taper ends */
  taperEnds: boolean
  /** Overlap */
  overlap: number // 0-100
  /** Angle */
  angle: number // 0-360
  /** Angle variation */
  angleVariation: number // 0-100
  /** Seed */
  seed: number
  /** Layers */
  layers: number
  /** Blend mode */
  blendMode: string
  /** Opacity */
  opacity: number
}

/** Generate clouds */
export async function renderClouds(
  width: number,
  height: number,
  options: CloudsOptions = {
    type: 'clouds',
    size: 50,
    detail: 4,
    contrast: 50,
    brightness: 0,
    colorMode: 'grayscale',
    seed: Date.now(),
    octaves: 4,
    persistence: 0.5,
    lacunarity: 2,
    turbulence: 0,
    ridged: false,
    billow: false,
    anisotropy: 0,
    rotation: 0,
    tileable: false,
  }
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  const {
    type,
    size = 50,
    detail = 4,
    contrast = 50,
    brightness = 0,
    colorMode = 'grayscale',
    seed = Date.now(),
    octaves = 4,
    persistence = 0.5,
    lacunarity = 2,
    turbulence = 0,
    ridged = false,
    billow = false,
    anisotropy = 0,
    rotation = 0,
    tileable = false,
  } = options

  const seed = options.seed || Date.now()
  const rng = createRNG(seed)

  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  // Generate noise
  const noiseData = generateNoise(width, height, {
    octaves,
    persistence,
    lacunarity,
    seed,
    type: type,
    ridged,
    billow,
    turbulence,
    anisotropy,
    rotation,
    tileable,
    scale: options.size / 100,
    detail,
    rng,
  })

  // Apply contrast/brightness
  const imgData = ctx.createImageData(width, height)
  const data = imgData.data

  for (let i = 0; i < noiseData.length; i++) {
    let val = noiseData[i] * 255

    // Contrast
    const contrast = options.contrast / 100
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
    val = factor * (val - 128) + 128

    // Brightness
    val += brightness * 2.55

    val = Math.max(0, Math.min(255, val))

    // Apply color mode
    const idx = i * 4
    if (colorMode === 'grayscale') {
      data[idx] = data[idx + 1] = data[idx + 2] = val
    } else if (colorMode === 'color') {
      // Use gradient or random colors
      data[idx] = val
      data[idx + 1] = val
      data[idx + 2] = val
    } else if (colorMode === 'gradient' && gradient) {
      // Apply gradient
      const t = val / 255
      const color = interpolateGradient(gradient, t)
      data[idx] = color.r
      data[idx + 1] = color.g
      data[idx + 2] = color.b
    } else {
      data[idx] = data[idx + 1] = data[idx + 2] = val
    }
    data[idx + 3] = 255
  }

  const output = createCanvas(width, height)
  const ctx = ctx2d(canvas)
  ctx.putImageData(imgData, 0, 0)

  // Apply rotation
  if (rotation !== 0) {
    const rotated = createCanvas(width, height)
    const rotCtx = ctx2d(rotated)
    rotCtx.translate(width / 2, height / 2)
    rotCtx.rotate((rotation * Math.PI) / 180)
    rotCtx.drawImage(canvas, -width / 2, -height / 2)
    return rotated
  }

  return canvas
}

/** Generate fibers */
async function renderFibers(
  width: number,
  height: number,
  options: FiberOptions = {
    type: 'fibers',
    length: 100,
    width: 2,
    density: 100,
    variation: 20,
    curvature: 10,
    taper: 20,
    color: '#ffffff',
    backgroundColor: '#000000',
    colorVariation: 10,
    transparency: 0,
    taperEnds: true,
    overlap: 50,
    angle: 0,
    angleVariation: 10,
    seed: Date.now(),
    layers: 1,
    blendMode: 'normal',
    opacity: 100,
  }
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  const {
    type = 'fibers',
    length = 100,
    width: fiberWidth = 2,
    density = 100,
    variation = 20,
    curvature = 10,
    taper = 20,
    color = '#ffffff',
    backgroundColor = '#000000',
    colorVariation = 10,
    transparency = 0,
    taperEnds = true,
    overlap = 50,
    angle = 0,
    angleVariation = 10,
    seed = Date.now(),
    layers = 1,
    blendMode = 'normal',
    opacity = 100,
  } = options

  // Background
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, width, height)

  const seed = options.seed || Date.now()
  const rng = createRNG(seed)

  // Parse color
  const baseColor = parseColor(color)
  const baseBgColor = parseColor(backgroundColor)

  // Draw fibers
  const fiberCount = Math.round(density * (width * height) / 10000)

  for (let layer = 0; layer < layers; layer++) {
    const layerOpacity = opacity / 100 / layers

    for (let i = 0; i < fiberCount; i++) {
      // Random start position
      let x = rng() * width
      let y = rng() * height

      // Fiber direction
      const baseAngle = (angle * Math.PI) / 180
      const angleVar = (angleVariation / 100) * Math.PI
      const angle = baseAngle + (rng() - 0.5) * angleVar * 2

      // Fiber properties
      const fiberLength = length * (0.5 + rng() * variation / 100)
      const fiberWidth = width * (0.5 + rng() * 0.5)
      const curve = curvature / 100 * Math.PI * 2
      const taperAmount = taper / 100

      // Color variation
      const colorVar = colorVariation / 100
      const r = Math.min(255, Math.max(0, baseColor.r + (rng() - 0.5) * 2 * colorVar * 255))
      const g = Math.min(255, Math.max(0, baseColor.g + (rng() - 0.5) * 2 * colorVar * 255))
      const b = Math.min(255, Math.max(0, baseColor.b + (rng() - 0.5) * 2 * colorVar * 255))
      const a = Math.round((1 - transparency / 100) * opacity / 100 * 255)

      ctx.strokeStyle = `rgba(${r},${g},${b},${a / 255})`
      ctx.lineWidth = fiberWidth
      ctx.lineCap = taperEnds ? 'round' : 'butt'
      ctx.lineJoin = 'round'

      // Draw fiber
      ctx.beginPath()
      let cx = rng() * width
      let cy = rng() * height

      ctx.moveTo(cx, cy)

      const steps = 20
      const stepLength = length / steps
      let cx = rng() * width
      let cy = rng() * height
      let angle = baseAngle + (rng() - 0.5) * angleVar * 2

      for (let step = 0; step < steps; step++) {
        const progress = step / steps
        const taperFactor = taperEnds ? (1 - progress * taper / 100) : 1

        // Curvature
        angle += (rng() - 0.5) * curvature / 50 * Math.PI

        const stepX = Math.cos(angle) * stepLength
        const stepY = Math.sin(angle) * stepLength

        ctx.lineTo(cx + stepX, cy + stepY)
        ctx.lineWidth = fiberWidth * (1 - progress * taper / 100)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(cx, cy)
      }
      ctx.stroke()
    }
  }

  return canvas
}

/** Generate Perlin noise */
function generatePerlinNoise(
  width: number,
  height: number,
  options: {
    octaves: number
    persistence: number
    lacunarity: number
    seed: number
    scale: number
    type: string
    ridged: boolean
    billow: boolean
    turbulence: number
    anisotropy: number
    rotation: number
    tileable: boolean
  }
): Float32Array {
  const { octaves, persistence, lacunarity, seed, scale, type, ridged, billow, turbulence, anisotropy, rotation, tileable } = options
  const rng = createRNG(seed)

  // Create permutation table
  const perm = new Array(512)
  for (let i = 0; i < 256; i++) perm[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[perm[i], perm[j]] = [perm[j], perm[i]]
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i]

  // Gradient vectors
  const gradients = new Array(256)
  for (let i = 0; i < 256; i++) {
    const angle = rng() * Math.PI * 2
    gradients[i] = { x: Math.cos(angle), y: Math.sin(angle) }
  }

  const noise = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let nx = x / width
      let ny = y / height

      // Apply rotation
      if (rotation !== 0) {
        const cos = Math.cos(rotation)
        const sin = Math.sin(rotation)
        const cx = x - 0.5
        const cy = y - 0.5
        const rx = cx * Math.cos(rotation) - cy * Math.sin(rotation)
        const ry = cx * Math.sin(rotation) + cy * Math.cos(rotation)
        nx = rx + 0.5
        ny = ry + 0.5
      }

      // Apply anisotropy
      if (anisotropy > 0) {
        // Stretch coordinates
      }

      // Apply turbulence
      let tx = x
      let ty = y
      if (turbulence > 0) {
        // Add turbulence
      }

      let value = 0
      let amplitude = 1
      let frequency = scale

      for (let o = 0; o < octaves; o++) {
        const nx = x * frequency
        const ny = y * frequency

        let n = perlin2D(nx, ny, perm, gradients)

        if (ridged) {
          n = 1 - Math.abs(n)
          n = n * n
        }
        if (billow) {
          n = Math.abs(n)
        }

        value += n * amplitude
        amplitude *= persistence
        frequency *= lacunarity
      }

      // Turbulence
      if (turbulence > 0) {
        // Add turbulence distortion
      }

      noise[y * width + x] = value
    }
  }

  return noise
}

/** Simple 2D Perlin noise */
function perlin2D(x: number, y: number, perm: number[], gradients: { x: number; y: number }[]): number {
  const xi = Math.floor(x) & 255
  const yi = Math.floor(y) & 255
  const xf = x - Math.floor(x)
  const yf = y - Math.floor(y)

  const u = fade(xf)
  const v = fade(yf)

  const aa = perm[perm[xi] + yi] & 255
  const ab = perm[perm[xi] + yi + 1] & 255
  const ba = perm[perm[xi + 1] + yi] & 255
  const bb = perm[perm[xi + 1] + yi + 1] & 255

  const g00 = gradients[aa]
  const g01 = gradients[ab]
  const g10 = gradients[ba]
  const g11 = gradients[bb]

  const x1 = lerp(dot(g00, xf, yf), dot(g10, xf - 1, yf), u)
  const x2 = lerp(dot(g01, xf, yf - 1), dot(g11, xf - 1, yf - 1), u)

  return lerp(x1, x2, v)
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a)
}

function dot(g: { x: number; y: number }, x: number, y: number): number {
  return g.x * x + g.y * y
}

/** Create RNG with seed */
function createRNG(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/** Interpolate gradient */
function interpolateGradient(
  gradient: Array<{ position: number; color: string }>,
  t: number
): { r: number; g: number; b: number } {
  // Clamp
  t = Math.max(0, Math.min(1, t))

  // Find surrounding stops
  let i = 0
  while (i < gradient.length - 1 && gradient[i + 1].position < t) {
    i++
  }

  if (i === gradient.length - 1) {
    return parseColor(gradient[i].color)
  }

  const stop1 = gradient[i]
  const stop2 = gradient[i + 1]
  const localT = (t - stop1.position) / (stop2.position - stop1.position)

  const c1 = parseColor(stop1.color)
  const c2 = parseColor(stop2.color)

  return {
    r: lerp(c1.r, c2.r, t),
    g: lerp(c1.g, c2.g, t),
    b: lerp(c1.b, c2.b, t),
  }
}

function parseColor(color: string): { r: number; g: number; b: number } {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }
  }
  if (color.startsWith('rgb')) {
    const match = color.match(/\d+/g)
    return {
      r: parseInt(match[0]),
      g: parseInt(match[1]),
      b: parseInt(match[2]),
    }
  }
  return { r: 255, g: 255, b: 255 }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/** Generate clouds with specific algorithm */
export async function generateClouds(
  width: number,
  height: number,
  type: CloudsOptions['type'] = 'clouds',
  options: Partial<CloudsOptions> = {}
): Promise<HTMLCanvasElement> {
  return renderClouds(width, height, { type, ...options } as CloudsOptions)
}

/** Generate fibers */
export async function generateFibers(
  width: number,
  height: number,
  options: Partial<FiberOptions> = {}
): Promise<HTMLCanvasElement> {
  return renderFibers(width, height, options as FiberOptions)
}

/** Cloud presets */
export const CLOUD_PRESETS: Record<string, Partial<CloudsOptions>> = {
  'storm-clouds': { type: 'clouds', size: 80, detail: 6, contrast: 80, octaves: 6, persistence: 0.6, lacunarity: 2.2 },
  'fair-weather': { type: 'clouds', size: 40, detail: 3, contrast: 30, octaves: 3, persistence: 0.4, lacunarity: 1.8 },
  'cirrus': { type: 'clouds', size: 20, detail: 2, contrast: 20, octaves: 2, persistence: 0.3, lacunarity: 1.5 },
  'cumulus': { type: 'clouds', size: 60, detail: 5, contrast: 60, octaves: 5, persistence: 0.5, lacunarity: 2 },
  'stratus': { type: 'clouds', size: 70, detail: 4, contrast: 40, octaves: 4, persistence: 0.4, lacunarity: 1.9 },
  'plasma': { type: 'plasma', size: 50, detail: 4, contrast: 50, octaves: 5, persistence: 0.5, lacunarity: 2 },
  'turbulence': { type: 'turbulence', size: 50, detail: 5, turbulence: 50, octaves: 5 },
  'ridged': { type: 'clouds', size: 50, detail: 5, contrast: 70, ridged: true, octaves: 5 },
  'billow': { type: 'clouds', size: 50, detail: 4, contrast: 40, billow: true, octaves: 4 },
  'solid-noise': { type: 'solid-noise', size: 50, detail: 5, contrast: 50, octaves: 5 },
  'cellular': { type: 'cellular', size: 30, detail: 3, contrast: 60 },
  'worley': { type: 'worley', size: 40, detail: 4, contrast: 50 },
}

/** Fiber presets */
export const FIBER_PRESETS: Record<string, Partial<FiberOptions>> = {
  'fine-hair': { type: 'hair', length: 200, width: 0.5, density: 500, curvature: 30, taper: 50, color: '#8b4513', backgroundColor: '#f5f5f0', angle: 90, angleVariation: 30 },
  'fur': { type: 'fur', length: 50, width: 3, density: 300, curvature: 40, taper: 30, color: '#8b4513', backgroundColor: '#f5f5f0', colorVariation: 30, variation: 40, angle: 90, angleVariation: 40 },
  'grass': { type: 'grass', length: 80, width: 1, density: 800, curvature: 50, taper: 80, color: '#228b22', backgroundColor: '#8fbc8f', colorVariation: 40, angle: 90, angleVariation: 20, taperEnds: true },
  'brushed-metal': { type: 'brushed', length: 500, width: 0.5, density: 200, curvature: 5, color: '#c0c0c0', backgroundColor: '#808080', angle: 0, angleVariation: 2 },
  'brushed-vertical': { type: 'brushed', length: 500, width: 0.5, density: 200, curvature: 5, color: '#c0c0c0', backgroundColor: '#808080', angle: 90, angleVariation: 2 },
  'scratches': { type: 'scratches', length: 200, width: 0.5, density: 100, curvature: 20, taper: 50, color: '#ffffff', backgroundColor: '#333333', angleVariation: 45 },
  'crosshatch': { type: 'crosshatch', length: 100, width: 1, density: 200, angle: 45, angleVariation: 90, color: '#000000', backgroundColor: '#ffffff' },
  'fabric-weave': { type: 'woven', length: 100, width: 2, density: 300, curvature: 5, color: '#808080', backgroundColor: '#f0f0f0', angle: 45, angleVariation: 90 },
  'carbon-fiber': { type: 'woven', length: 50, width: 1, density: 500, curvature: 2, color: '#222222', backgroundColor: '#1a1a1a', angle: 45, angleVariation: 90 },
}