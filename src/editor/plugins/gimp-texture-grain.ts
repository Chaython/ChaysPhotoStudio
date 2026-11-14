'use client'
// GIMP Texture & Grain
// Procedural textures, film grain, paper textures, and artistic surfaces

import { createCanvas, ctx2d } from '../utils/canvas'

export interface TextureOptions {
  /** Texture type */
  type: 'grain' | 'paper' | 'canvas' | 'fabric' | 'wood' | 'stone' | 'metal' | 'watercolor' | 'pastel' | 'chalk' | 'custom'
  /** Intensity */
  amount: number // 0-100
  /** Scale */
  scale: number // 10-500%
  /** Contrast */
  contrast: number // 0-100
  /** Brightness */
  brightness: number // -100 to 100
  /** Color mode */
  colorMode: 'luminosity' | 'color' | 'multiply' | 'overlay' | 'soft-light' | 'hard-light' | 'color-dodge' | 'color-burn'
  /** Seed for reproducibility */
  seed: number
  /** Anisotropy */
  anisotropy: number // 0-100
  /** Rotation */
  rotation: number // 0-360
  /** Custom pattern */
  customPattern?: HTMLCanvasElement
  /** Blend mode */
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'hard-light' | 'color-dodge' | 'color-burn' | 'difference' | 'exclusion' | 'luminosity'
  /** Opacity */
  opacity: number // 0-100
  /** Monochrome */
  monochrome: boolean
  /** Colored grain */
  colored: boolean
  /** Grain type for grain texture */
  grainType: 'gaussian' | 'poisson' | 'uniform' | 'film' | 'kodak' | 'fuji' | 'ilford'
  /** Paper type for paper texture */
  paperType: 'fine' | 'medium' | 'rough' | 'cold-press' | 'hot-press' | 'handmade' | 'vellum' | 'newsprint'
  /** Canvas type */
  canvasType: 'linen' | 'cotton' | 'jute' | 'burlap' | 'custom-weave'
  /** Fabric type */
  fabricType: 'cotton' | 'silk' | 'wool' | 'denim' | 'canvas' | 'burlap' | 'velvet' | 'satin'
  /** Wood type */
  woodType: 'oak' | 'pine' | 'mahogany' | 'walnut' | 'cherry' | 'maple' | 'cedar' | 'bamboo'
  /** Stone type */
  stoneType: 'marble' | 'granite' | 'slate' | 'sandstone' | 'limestone' | 'travertine' | 'concrete'
  /** Metal type */
  metalType: 'brushed' | 'polished' | 'hammered' | 'corrugated' | 'diamond-plate' | 'rusted' | 'oxidized'
}

export interface GrainOptions extends TextureOptions {
  type: 'grain'
  grainType: 'gaussian' | 'poisson' | 'uniform' | 'film' | 'kodak' | 'fuji' | 'ilford'
  iso: number
  pushPull: number
  colorCoupling: boolean
}

export interface PaperTextureOptions extends TextureOptions {
  type: 'paper'
  paperType: 'fine' | 'medium' | 'rough' | 'cold-press' | 'hot-press' | 'handmade' | 'vellum' | 'newsprint'
  fibers: number
  sizing: number
}

export interface CanvasTextureOptions extends TextureOptions {
  type: 'canvas'
  canvasType: 'linen' | 'cotton' | 'jute' | 'burlap' | 'custom-weave'
  weaveSize: number
  weaveAngle: number
  weaveDepth: number
}

export interface WoodTextureOptions extends TextureOptions {
  type: 'wood'
  woodType: 'oak' | 'pine' | 'mahogany' | 'walnut' | 'cherry' | 'maple' | 'cedar' | 'bamboo'
  grainDirection: number
  knotDensity: number
  ringSpacing: number
  colorVariation: number
}

export interface StoneTextureOptions extends TextureOptions {
  type: 'stone'
  stoneType: 'marble' | 'granite' | 'slate' | 'sandstone' | 'limestone' | 'travertine' | 'concrete'
  veinContrast: number
  veinScale: number
  porosity: number
}

export interface MetalTextureOptions extends TextureOptions {
  type: 'metal'
  metalType: 'brushed' | 'polished' | 'hammered' | 'corrugated' | 'diamond-plate' | 'rusted' | 'oxidized'
  reflectivity: number
  scratchDensity: number
  patina: number
}

/** Main texture application */
export async function applyTexture(
  canvas: HTMLCanvasElement,
  options: TextureOptions = {
    type: 'grain',
    amount: 50,
    scale: 100,
    contrast: 50,
    brightness: 0,
    colorMode: 'luminosity',
    seed: Date.now(),
    anisotropy: 0,
    rotation: 0,
    blendMode: 'overlay',
    opacity: 50,
    monochrome: true,
    colored: false,
  }
): Promise<HTMLCanvasElement> {
  const { width, height } = canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Generate texture
  const textureCanvas = await generateTexture(width, height, options)

  // Apply texture
  ctx.drawImage(canvas, 0, 0)
  ctx.globalCompositeOperation = options.blendMode as GlobalCompositeOperation
  ctx.globalAlpha = options.opacity / 100
  ctx.drawImage(textureCanvas, 0, 0)

  return output
}

/** Generate procedural texture */
async function generateTexture(
  width: number,
  height: number,
  options: TextureOptions
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  const seed = options.seed || Date.now()
  const rng = createRNG(seed)

  switch (options.type) {
    case 'grain':
      return generateGrain(width, height, options, rng)
    case 'paper':
      return generatePaperTexture(width, height, options, rng)
    case 'canvas':
      return generateCanvasTexture(width, height, options, rng)
    case 'fabric':
      return generateFabricTexture(width, height, options, rng)
    case 'wood':
      return generateWoodTexture(width, height, options, rng)
    case 'stone':
      return generateStoneTexture(width, height, options, rng)
    case 'metal':
      return generateMetalTexture(width, height, options, rng)
    case 'watercolor':
      return generateWatercolorTexture(width, height, options, rng)
    case 'pastel':
      return generatePastelTexture(width, height, options, rng)
    case 'chalk':
      return generateChalkTexture(width, height, options, rng)
    case 'custom':
      return options.customPattern ? options.customPattern : createCanvas(1, 1)
    default:
      return generateGrain(width, height, options, rng)
  }
}

/** Generate film grain */
async function generateGrain(
  width: number,
  height: number,
  options: TextureOptions,
  rng: () => number
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  const amount = options.amount / 100
  const scale = options.scale / 100
  const contrast = options.contrast / 100
  const brightness = options.brightness / 100

  // Create grain at different scales
  const layers = options.grainType === 'film' ? 3 : 1

  for (let layer = 0; layer < layers; layer++) {
    const layerScale = scale * (1 + layer * 0.5)
    const layerAmount = amount / (layer + 1)

    const grainCanvas = createCanvas(width, height)
    const grainCtx = ctx2d(grainCanvas)

    // Generate noise
    const imgData = grainCtx.createImageData(width, height)
    const data = imgData.data

    const noiseScale = scale * (layer + 1)
    const noiseFreq = 1 / noiseScale

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4

        // Generate noise based on type
        let noise: number
        switch (options.grainType || 'gaussian') {
          case 'gaussian':
            noise = gaussianNoise(rng) * 2 - 1
            break
          case 'poisson':
            noise = poissonNoise(rng) - 1
            break
          case 'uniform':
            noise = rng() * 2 - 1
            break
          case 'film':
            noise = filmGrainNoise(x, y, noiseFreq, rng) * 2 - 1
            break
          case 'kodak':
            noise = kodakGrainNoise(x, y, noiseFreq, rng) * 2 - 1
            break
          case 'fuji':
            noise = fujiGrainNoise(x, y, noiseFreq, rng) * 2 - 1
            break
          case 'ilford':
            noise = ilfordGrainNoise(x, y, noiseFreq, rng) * 2 - 1
            break
          default:
            noise = gaussianNoise(rng) * 2 - 1
        }

        // Apply contrast
        const contrastVal = Math.sign(noise) * Math.pow(Math.abs(noise), contrast) * amount
        const brightnessVal = brightness / 100

        const val = Math.round((contrastVal + brightnessVal) * 127.5 + 127.5)

        if (options.monochrome) {
          data[idx] = data[idx + 1] = data[idx + 2] = Math.max(0, Math.min(255, val))
        } else if (options.colored) {
          // Colored grain
          const rNoise = (rng() - 0.5) * 2
          const gNoise = (rng() - 0.5) * 2
          const bNoise = (rng() - 0.5) * 2
          data[idx] = Math.max(0, Math.min(255, 128 + contrastVal * 127 * rNoise))
          data[idx + 1] = Math.max(0, Math.min(255, 128 + contrastVal * 127 * gNoise))
          data[idx + 2] = Math.max(0, Math.min(255, 128 + contrastVal * 127 * bNoise))
        } else {
          data[idx] = data[idx + 1] = data[idx + 2] = Math.max(0, Math.min(255, val))
        }
        data[idx + 3] = 255
      }
    }

    grainCtx.putImageData(imgData, 0, 0)

    // Apply scale
    if (scale !== 1) {
      const scaledCanvas = createCanvas(width, height)
      const scaledCtx = ctx2d(scaledCanvas)
      scaledCtx.scale(scale, scale)
      scaledCtx.drawImage(grainCanvas, 0, 0)
      grainCanvas = scaledCanvas
    }

    // Apply rotation
    if (options.rotation !== 0) {
      const rotatedCanvas = createCanvas(width, height)
      const rotCtx = ctx2d(rotatedCanvas)
      rotCtx.translate(width / 2, height / 2)
      rotCtx.rotate((options.rotation * Math.PI) / 180)
      rotCtx.drawImage(grainCanvas, -width / 2, -height / 2)
      grainCanvas = rotatedCanvas
    }

    // Apply anisotropy
    if (options.anisotropy > 0) {
      // Stretch horizontally
      const anisCanvas = createCanvas(width, height)
      const anisCtx = ctx2d(anisCanvas)
      anisCtx.scale(1 + options.anisotropy / 100, 1)
      anisCtx.drawImage(grainCanvas, 0, 0)
      grainCanvas = anisCanvas
    }

    // Blend mode
    ctx.globalCompositeOperation = 'normal'
    ctx.globalAlpha = 1 / (layer + 1)
    ctx.drawImage(grainCanvas, 0, 0)
  }

  // Apply brightness/contrast
  if (brightness !== 0 || contrast !== 1) {
    ctx.filter = `brightness(${1 + brightness}) contrast(${contrast})`
    ctx.drawImage(canvas, 0, 0)
    ctx.filter = 'none'
  }

  // Apply monochrome
  if (options.monochrome) {
    ctx.filter = 'grayscale(1)'
    ctx.drawImage(canvas, 0, 0)
    ctx.filter = 'none'
  }

  return canvas
}

/** Generate paper texture */
async function generatePaperTexture(
  width: number,
  height: number,
  options: TextureOptions,
  rng: () => number
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  // Base paper color
  ctx.fillStyle = '#f5f0e8'
  ctx.fillRect(0, 0, width, height)

  // Paper fibers
  const fibers = options.paperType === 'handmade' ? 5000 : options.paperType === 'newsprint' ? 2000 : 1000
  ctx.fillStyle = 'rgba(0,0,0,0.02)'

  for (let i = 0; i < fibers; i++) {
    const x = rng() * width
    const y = rng() * height
    const length = rng() * 20 + 5
    const angle = rng() * Math.PI * 2
    const width_ = rng() * 2 + 0.5

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.fillRect(-length / 2, -width_ / 2, length, width_)
    ctx.restore()
  }

  // Paper texture (bump mapping simulation)
  const sizing = options.sizing || 50
  if (sizing > 0) {
    // Add subtle texture
    ctx.filter = 'blur(1px)'
    ctx.globalAlpha = 0.05
    ctx.drawImage(canvas, 0, 0)
    ctx.filter = 'none'
    ctx.globalAlpha = 1
  }

  return canvas
}

/** Generate canvas texture */
async function generateCanvasTexture(
  width: number,
  height: number,
  options: TextureOptions,
  rng: () => number
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  // Base color
  ctx.fillStyle = '#fdf5e6'
  ctx.fillRect(0, 0, width, height)

  // Weave pattern
  const weaveSize = options.weaveSize || 4
  const weaveAngle = (options.weaveAngle || 0) * Math.PI / 180
  const weaveDepth = options.weaveDepth || 20

  ctx.fillStyle = 'rgba(0,0,0,0.03)'

  for (let y = 0; y < height; y += weaveSize) {
    for (let x = 0; x < width; x += weaveSize) {
      // Horizontal threads
      if ((Math.floor(y / weaveSize) + Math.floor(x / weaveSize)) % 2 === 0) {
        ctx.fillRect(x, y, weaveSize, 1)
      }
      // Vertical threads
      if ((Math.floor(y / weaveSize) + Math.floor(x / weaveSize) + 1) % 2 === 0) {
        ctx.fillRect(x, y, 1, weaveSize)
      }
    }

  // Weave depth
  if (weaveDepth > 0) {
    ctx.filter = 'blur(0.5px)'
    ctx.globalAlpha = weaveDepth / 100
    ctx.drawImage(canvas, 0, 0)
    ctx.filter = 'none'
    ctx.globalAlpha = 1
  }

  return canvas
}

/** Generate fabric texture */
async function generateFabricTexture(
  width: number,
  height: number,
  options: TextureOptions,
  rng: () => number
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  // Base fabric color
  const fabricColors: Record<string, string> = {
    cotton: '#f5f5f0',
    silk: '#faf0e6',
    wool: '#e8e4d9',
    denim: '#2b4b8a',
    canvas: '#d4c4a8',
    burlap: '#c9b896',
    velvet: '#3d1a4e',
    satin: '#f0e6f0',
  }

  ctx.fillStyle = fabricColors[options.fabricType || 'cotton'] || '#f5f5f0'
  ctx.fillRect(0, 0, width, height)

  // Fabric weave
  const weaveScale = 8
  ctx.fillStyle = 'rgba(0,0,0,0.02)'

  for (let y = 0; y < height; y += weaveScale) {
    for (let x = 0; x < width; x += weaveScale) {
      if ((Math.floor(x / weaveScale) + Math.floor(y / weaveScale)) % 2 === 0) {
        ctx.fillRect(x, y, weaveScale, weaveScale / 2)
      }
    }

  // Fabric texture
  ctx.filter = 'blur(0.5px)'
  ctx.globalAlpha = 0.1
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'
  ctx.globalAlpha = 1

  return canvas
}

/** Generate wood texture */
async function generateWoodTexture(
  width: number,
  height: number,
  options: TextureOptions,
  rng: () => number
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  // Wood colors
  const woodColors: Record<string, { base: string; dark: string; light: string }> = {
    oak: { base: '#8b5a2b', dark: '#5d3a1a', light: '#c49a6c' },
    pine: { base: '#deb887', dark: '#b8860b', light: '#f5deb3' },
    mahogany: { base: '#c04000', dark: '#800000', light: '#cd5c5c' },
    walnut: { base: '#5c3a21', dark: '#3d2114', light: '#8b5a2b' },
    cherry: { base: '#c34a2c', dark: '#8b2500', light: '#e06d4a' },
    maple: { base: '#e8d5b7', dark: '#c9b896', light: '#f5e6c8' },
    cedar: { base: '#c99443', dark: '#8b6914', light: '#e8c473' },
    bamboo: { base: '#d4a843', dark: '#9e8023', light: '#f0e68c' },
  }

  const wood = woodColors[options.woodType || 'oak'] || woodColors.oak

  // Base color
  ctx.fillStyle = wood.base
  ctx.fillRect(0, 0, width, height)

  // Wood grain lines
  const grainDirection = (options.grainDirection || 0) * Math.PI / 180
  const ringSpacing = options.ringSpacing || 20
  const colorVariation = options.colorVariation || 30

  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.rotate(grainDirection)
  ctx.translate(-width / 2, -height / 2)

  ctx.strokeStyle = wood.dark
  ctx.lineWidth = 1

  for (let y = -height; y < height * 2; y += ringSpacing) {
    const variation = (rng() - 0.5) * colorVariation / 255
    ctx.strokeStyle = `rgba(${parseInt(wood.dark.slice(1,3),16)},${parseInt(wood.dark.slice(3,5),16)},${parseInt(wood.dark.slice(5,7),16)},0.3)`
    ctx.beginPath()
    ctx.moveTo(-width, y)
    // Wavy grain
    for (let x = 0; x <= width; x += 10) {
      const wave = Math.sin((x + y) * 0.02) * 5
      ctx.lineTo(x, y + wave + (rng() - 0.5) * 3)
    }
    ctx.stroke()
  }

  ctx.restore()

  // Knots
  const knotDensity = options.knotDensity || 5
  for (let i = 0; i < knotDensity * (width * height / 10000); i++) {
    const x = rng() * width
    const y = rng() * height
    const radius = rng() * 15 + 5

    ctx.fillStyle = wood.dark
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // Light variation
  ctx.fillStyle = wood.light
  ctx.globalAlpha = 0.1
  ctx.fillRect(0, 0, width, height)
  ctx.globalAlpha = 1

  return canvas
}

/** Generate stone texture */
async function generateStoneTexture(
  width: number,
  height: number,
  options: TextureOptions,
  rng: () => number
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  // Stone base colors
  const stoneColors: Record<string, string> = {
    marble: '#f5f5f0',
    granite: '#808080',
    slate: '#2f2f2f',
    sandstone: '#c2b280',
    limestone: '#e8e4d9',
    travertine: '#e8dcc8',
    concrete: '#999999',
  }

  const baseColor = stoneColors[options.stoneType || 'marble'] || stoneColors.marble
  ctx.fillStyle = baseColor
  ctx.fillRect(0, 0, width, height)

  // Veins
  const veinContrast = options.veinContrast || 50
  const veinScale = options.veinScale || 0.01

  for (let i = 0; i < 50; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${rng() * 0.1})`
    ctx.lineWidth = rng() * 2 + 0.5
    ctx.beginPath()
    ctx.moveTo(rng() * width, rng() * height)

    let x = rng() * width
    let y = rng() * height

    for (let j = 0; j < 20; j++) {
      const angle = rng() * Math.PI * 2
      const length = rng() * 50 + 20
      x += Math.cos(angle) * length
      y += Math.sin(angle) * length
      ctx.lineTo(x, y)

      // Branch
      if (rng() < 0.1) {
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x, y)
      }
    }
    ctx.stroke()
  }

  // Porosity
  const porosity = options.porosity || 0.1
  if (porosity > 0) {
    const poreCount = width * height * porosity / 100
    ctx.fillStyle = 'rgba(0,0,0,0.05)'

    for (let i = 0; i < poreCount; i++) {
      const x = rng() * width
      const y = rng() * height
      const r = rng() * 2 + 0.5
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  return canvas
}

/** Generate metal texture */
async function generateMetalTexture(
  width: number,
  height: number,
  options: TextureOptions,
  rng: () => number
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  // Metal base colors
  const metalColors: Record<string, string> = {
    brushed: '#c0c0c0',
    polished: '#e8e8e8',
    hammered: '#a0a0a0',
    corrugated: '#b0b0b0',
    'diamond-plate': '#808080',
    rusted: '#8b4513',
    oxidized: '#6b8e23',
  }

  const baseColor = metalColors[options.metalType || 'brushed'] || metalColors.brushed
  ctx.fillStyle = baseColor
  ctx.fillRect(0, 0, width, height)

  // Metal texture based on type
  switch (options.metalType) {
    case 'brushed':
      // Brushed metal lines
      ctx.strokeStyle = 'rgba(0,0,0,0.1)'
      ctx.lineWidth = 0.5
      for (let y = 0; y < height; y += 2) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }
      break

    case 'polished':
      // Reflective highlights
      const gradient = ctx.createLinearGradient(0, 0, width, height)
      gradient.addColorStop(0, 'rgba(255,255,255,0.3)')
      gradient.addColorStop(0.5, 'rgba(255,255,255,0)')
      gradient.addColorStop(1, 'rgba(0,0,0,0.3)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
      break

    case 'hammered':
      // Hammered texture
      for (let i = 0; i < 200; i++) {
        ctx.beginPath()
        ctx.arc(rng() * width, rng() * height, rng() * 5 + 2, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${rng() * 0.1})`
        ctx.fill()
      }
      break

    case 'corrugated':
      // Corrugated pattern
      for (let y = 0; y < height; y += 10) {
        const wave = Math.sin(y * 0.2) * 5
        ctx.fillStyle = 'rgba(0,0,0,0.05)'
        ctx.fillRect(0, y + wave, width, 5)
      }
      break

    case 'diamond-plate':
      // Diamond plate pattern
      const diamondSize = 20
      ctx.strokeStyle = 'rgba(0,0,0,0.2)'
      ctx.lineWidth = 1
      for (let y = 0; y < height; y += diamondSize) {
        for (let x = 0; x < width; x += diamondSize) {
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + diamondSize, y + diamondSize)
          ctx.moveTo(x + diamondSize, y)
          ctx.lineTo(x, y + diamondSize)
          ctx.stroke()
        }
      }
      break

    case 'rusted':
      // Rust texture
      for (let i = 0; i < 1000; i++) {
        ctx.fillStyle = `rgba(${139 + rng() * 50},${69 + rng() * 30},${19 + rng() * 20},${rng() * 0.3})`
        ctx.beginPath()
        ctx.arc(rng() * width, rng() * height, rng() * 10 + 1, 0, Math.PI * 2)
        ctx.fill()
      }
      break

    case 'oxidized':
      // Oxidation patina
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = `rgba(${100 + rng() * 50},${140 + rng() * 50},${60 + rng() * 30},${rng() * 0.2})`
        ctx.beginPath()
        ctx.arc(rng() * width, rng() * height, rng() * 15 + 2, 0, Math.PI * 2)
        ctx.fill()
      }
      break
  }

  // Scratches
  const scratchDensity = options.scratchDensity || 0
  if (scratchDensity > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 0.5
    for (let i = 0; i < scratchDensity * 10; i++) {
      ctx.beginPath()
      ctx.moveTo(rng() * width, rng() * height)
      ctx.lineTo(rng() * width, rng() * height)
      ctx.stroke()
    }
  }

  // Patina
  const patina = options.patina || 0
  if (patina > 0) {
    ctx.fillStyle = `rgba(100,150,80,${patina / 100 * 0.1})`
    ctx.fillRect(0, 0, width, height)
  }

  // Reflectivity
  const reflectivity = options.reflectivity || 50
  if (reflectivity > 50) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, 'rgba(255,255,255,0.2)')
    gradient.addColorStop(0.5, 'rgba(255,255,255,0)')
    gradient.addColorStop(1, 'rgba(0,0,0,0.1)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }

  return canvas
}

/** Generate watercolor paper texture */
async function generateWatercolorTexture(
  width: number,
  height: number,
  options: TextureOptions,
  rng: () => number
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  // Paper base
  ctx.fillStyle = '#faf8f0'
  ctx.fillRect(0, 0, width, height)

  // Paper texture
  const textureScale = 4
  ctx.fillStyle = 'rgba(0,0,0,0.015)'

  for (let y = 0; y < height; y += textureScale) {
    for (let x = 0; x < width; x += textureScale) {
      const noise = rng() - 0.5
      if (noise > 0.3) {
        ctx.fillRect(x, y, textureScale, textureScale)
      }
    }
  }

  // Granulation
  ctx.filter = 'blur(1px)'
  ctx.globalAlpha = 0.3
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'
  ctx.globalAlpha = 1

  // Sizing (watercolor paper sizing)
  const sizing = 50
  ctx.globalAlpha = sizing / 100 * 0.1
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.globalAlpha = 1

  return canvas
}

/** Generate pastel paper texture */
async function generatePastelTexture(
  width: number,
  height: number,
  options: TextureOptions,
  rng: () => number
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  // Pastel paper base
  ctx.fillStyle = '#f5f0e8'
  ctx.fillRect(0, 0, width, height)

  // Tooth texture
  const toothScale = 3
  ctx.fillStyle = 'rgba(100,100,100,0.02)'

  for (let y = 0; y < height; y += toothScale) {
    for (let x = 0; x < width; x += toothScale) {
      if (rng() > 0.7) {
        ctx.fillRect(x, y, toothScale, toothScale)
      }
    }
  }

  // Soft texture
  ctx.filter = 'blur(0.5px)'
  ctx.globalAlpha = 0.5
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'
  ctx.globalAlpha = 1

  return canvas
}

/** Generate chalk texture */
async function generateChalkTexture(
  width: number,
  height: number,
  options: TextureOptions,
  rng: () => number
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  // Chalkboard base
  ctx.fillStyle = '#2a3a2a'
  ctx.fillRect(0, 0, width, height)

  // Chalk dust texture
  const dustCount = 5000
  for (let i = 0; i < dustCount; i++) {
    const x = rng() * width
    const y = rng() * height
    const r = rng() * 2 + 0.5
    const alpha = rng() * 0.1 + 0.02

    ctx.fillStyle = `rgba(255,255,255,${alpha})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Chalk strokes
  const strokeCount = 100
  for (let i = 0; i < strokeCount; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${rng() * 0.3 + 0.1})`
    ctx.lineWidth = rng() * 3 + 1
    ctx.lineCap = 'round'

    ctx.beginPath()
    ctx.moveTo(rng() * width, rng() * height)
    for (let j = 0; j < 10; j++) {
      ctx.lineTo(rng() * width, rng() * height)
    }
    ctx.stroke()
  }

  return canvas
}

/** Create RNG with seed */
function createRNG(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/** Gaussian noise */
function gaussianNoise(rng: () => number): number {
  // Box-Muller transform
  const u1 = rng()
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** Poisson noise approximation */
function poissonNoise(rng: () => number): number {
  const lambda = 1
  let k = 0
  let p = 1
  const L = Math.exp(-1)

  do {
    k++
    p *= rng()
  } while (p > Math.exp(-1))

  return k - 1
}

/** Film grain noise */
function filmGrainNoise(x: number, y: number, freq: number, rng: () => number): number {
  // Simulated film grain with spatial correlation
  return (rng() + Math.sin(x * freq) * 0.1 + Math.cos(y * freq) * 0.1) / 1.2
}

/** Kodak grain simulation */
function kodakGrainNoise(x: number, y: number, freq: number, rng: () => number): number {
  // Kodak-like grain with characteristic clumping
  const base = rng()
  const clump = Math.sin(x * 0.1) * Math.cos(y * 0.1) * 0.3
  return Math.min(1, Math.max(0, base + clump))
}

/** Fuji grain simulation */
function fujiGrainNoise(x: number, y: number, freq: number, rng: () => number): number {
  // Fuji-like fine grain
  return (rng() + Math.sin(x * 0.05) * 0.05) / 1.05
}

/** Ilford grain simulation */
function ilfordGrainNoise(x: number, y: number, freq: number, rng: () => number): number {
  // Ilford HP5-like grain
  const base = rng()
  const texture = Math.sin(x * 0.07) * Math.cos(y * 0.07) * 0.2
  return Math.min(1, Math.max(0, base + texture))
}

/** Texture Presets */
export const TEXTURE_PRESETS: Record<string, Partial<TextureOptions>> = {
  'fine-grain': { type: 'grain', amount: 15, scale: 50, contrast: 30, grainType: 'film', monochrome: true },
  'medium-grain': { type: 'grain', amount: 35, scale: 100, contrast: 50, grainType: 'film', monochrome: true },
  'coarse-grain': { type: 'grain', amount: 60, scale: 150, contrast: 70, grainType: 'kodak', monochrome: true },
  'kodak-portra': { type: 'grain', amount: 40, scale: 120, contrast: 40, grainType: 'kodak', colored: true, monochrome: false },
  'fuji-velvia': { type: 'grain', amount: 20, scale: 80, contrast: 25, grainType: 'fuji', colored: true, monochrome: false },
  'ilford-hp5': { type: 'grain', amount: 50, scale: 100, contrast: 60, grainType: 'ilford', monochrome: true },
  'push-process': { type: 'grain', amount: 80, scale: 200, contrast: 80, grainType: 'film', monochrome: true },
  'cross-process': { type: 'grain', amount: 40, scale: 100, contrast: 50, grainType: 'film', colored: true, monochrome: false },

  'watercolor-paper': { type: 'watercolor', amount: 30, scale: 100, contrast: 40, monochrome: false },
  'rough-paper': { type: 'paper', paperType: 'rough', amount: 40, scale: 100, contrast: 50 },
  'cold-press': { type: 'paper', paperType: 'cold-press', amount: 25, scale: 100, contrast: 30 },
  'hot-press': { type: 'paper', paperType: 'hot-press', amount: 15, scale: 100, contrast: 20 },
  'handmade-paper': { type: 'paper', paperType: 'handmade', amount: 50, scale: 120, contrast: 60, fibers: 5000 },
  'newsprint': { type: 'paper', paperType: 'newsprint', amount: 60, scale: 150, contrast: 70 },

  'linen-canvas': { type: 'canvas', canvasType: 'linen', weaveSize: 4, weaveDepth: 30 },
  'cotton-canvas': { type: 'canvas', canvasType: 'cotton', weaveSize: 6, weaveDepth: 20 },
  'burlap': { type: 'canvas', canvasType: 'burlap', weaveSize: 10, weaveDepth: 50 },

  'oak-wood': { type: 'wood', woodType: 'oak', grainDirection: 0, ringSpacing: 25, knotDensity: 5, colorVariation: 30 },
  'pine-wood': { type: 'wood', woodType: 'pine', grainDirection: 15, ringSpacing: 30, knotDensity: 10, colorVariation: 20 },
  'mahogany': { type: 'wood', woodType: 'mahogany', grainDirection: 0, ringSpacing: 20, knotDensity: 2, colorVariation: 40 },
  'walnut-wood': { type: 'wood', woodType: 'walnut', grainDirection: 0, ringSpacing: 18, knotDensity: 3, colorVariation: 35 },

  'marble-stone': { type: 'stone', stoneType: 'marble', veinContrast: 30, veinScale: 0.01, porosity: 0.05 },
  'granite': { type: 'stone', stoneType: 'granite', veinContrast: 60, veinScale: 0.02, porosity: 0.15 },
  'slate': { type: 'stone', stoneType: 'slate', veinContrast: 20, veinScale: 0.005, porosity: 0.02 },
  'sandstone': { type: 'stone', stoneType: 'sandstone', veinContrast: 40, veinScale: 0.015, porosity: 0.2 },
  'concrete': { type: 'stone', stoneType: 'concrete', veinContrast: 10, veinScale: 0.005, porosity: 0.3 },

  'brushed-metal': { type: 'metal', metalType: 'brushed', reflectivity: 40, scratchDensity: 5 },
  'polished-metal': { type: 'metal', metalType: 'polished', reflectivity: 90 },
  'hammered-metal': { type: 'metal', metalType: 'hammered', scratchDensity: 20 },
  'corrugated-metal': { type: 'metal', metalType: 'corrugated' },
  'diamond-plate': { type: 'metal', metalType: 'diamond-plate' },
  'rusted-metal': { type: 'metal', metalType: 'rusted', patina: 30, scratchDensity: 15 },
  'oxidized-metal': { type: 'metal', metalType: 'oxidized', patina: 50 },

  'watercolor-paper': { type: 'watercolor', amount: 30, scale: 100, monochrome: false },
  'pastel-paper': { type: 'pastel', amount: 40, scale: 100, monochrome: false },
  'chalkboard': { type: 'chalk', amount: 50, scale: 100 },
}