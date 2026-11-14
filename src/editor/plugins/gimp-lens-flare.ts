'use client'
// GIMP Lens Flare
// Realistic lens flare simulation with multiple elements

import { createCanvas, ctx2d } from '../utils/canvas'

export interface LensFlareElement {
  type: 'ring' | 'disk' | 'polygon' | 'star' | 'streak' | 'glow' | 'ring-sequence' | 'anamorphic'
  position: number // 0-1 along flare axis
  size: number // relative to image diagonal
  color: string
  opacity: number
  rotation: number
  scale: number
  blendMode: string
  // Ring specific
  innerRadius?: number
  outerRadius?: number
  ringCount?: number
  // Disk specific
  feather?: number
  // Polygon specific
  sides?: number
  // Star specific
  spikes?: number
  spikeLength?: number
  // Streak specific
  length?: number
  width?: number
  angle?: number
  // Glow specific
  spread?: number
  falloff?: number
  // Anamorphic specific
  squeeze?: number
  curve?: number
}

export interface LensFlareOptions {
  /** Flare center position (0-1) */
  centerX: number
  centerY: number
  /** Overall scale */
  scale: number
  /** Global rotation */
  rotation: number
  /** Global opacity */
  opacity: number
  /** Flare elements */
  elements: LensFlareElement[]
  /** Lens type preset */
  lensPreset?: '50mm' | '35mm' | '24mm' | '85mm' | 'anamorphic' | 'vintage' | 'cinematic' | 'custom'
  /** Light source color */
  lightColor: string
  /** Light intensity */
  intensity: number
  /** Lens type */
  lensType: 'prime' | 'zoom' | 'anamorphic' | 'vintage' | 'modern'
  /** Aperture shape */
  apertureShape: 'circular' | 'hexagonal' | 'octagonal' | 'heart' | 'star' | 'custom'
  /** Aperture blades */
  apertureBlades: number
  /** Aperture rotation */
  apertureRotation: number
  /** Chromatic aberration */
  chromaticAberration: number
  /** Dirt/scratches on lens */
  dirtAmount: number
  /** Lens coating color */
  coatingColor: string
  /** Vignetting */
  vignetteAmount: number
  /** Output quality */
  quality: 'draft' | 'normal' | 'high' | 'ultra'
}

export interface LensFlarePreset {
  name: string
  elements: LensFlareElement[]
  lensType: LensFlareOptions['lensType']
  apertureShape: LensFlareOptions['apertureShape']
  apertureBlades: number
}

export const LENS_FLARE_PRESETS: Record<string, LensFlarePreset> = {
  '50mm-prime': {
    name: '50mm Prime',
    lensType: 'prime',
    apertureShape: 'circular',
    apertureBlades: 8,
    elements: [
      { type: 'ring', position: 0.1, size: 0.05, color: '#ffcc00', opacity: 0.8, rotation: 0, scale: 1, blendMode: 'screen', innerRadius: 0.3, outerRadius: 1, ringCount: 3 },
      { type: 'disk', position: 0.3, size: 0.15, color: '#fff8cc', opacity: 0.6, rotation: 0, scale: 1, blendMode: 'screen', feather: 0.5 },
      { type: 'polygon', position: 0.5, size: 0.08, color: '#ffaa00', opacity: 0.5, rotation: 15, scale: 1, blendMode: 'screen', sides: 8 },
      { type: 'ring', position: 0.7, size: 0.12, color: '#ff8800', opacity: 0.4, rotation: -30, scale: 1, blendMode: 'screen', innerRadius: 0.2, outerRadius: 1, ringCount: 2 },
      { type: 'disk', position: 0.9, size: 0.05, color: '#ff6600', opacity: 0.3, rotation: 45, scale: 1, blendMode: 'screen', feather: 0.8 },
    ],
  },
  '35mm-wide': {
    name: '35mm Wide',
    lensType: 'prime',
    apertureShape: 'circular',
    apertureBlades: 9,
    elements: [
      { type: 'ring-sequence', position: 0.05, size: 0.03, color: '#ffffff', opacity: 0.9, rotation: 0, scale: 1, blendMode: 'screen', ringCount: 5 },
      { type: 'disk', position: 0.2, size: 0.2, color: '#ffffee', opacity: 0.7, rotation: 0, scale: 1, blendMode: 'screen', feather: 0.3 },
      { type: 'polygon', position: 0.4, size: 0.12, color: '#fff0aa', opacity: 0.6, rotation: 0, scale: 1, blendMode: 'screen', sides: 9 },
      { type: 'streak', position: 0.6, size: 0.3, color: '#ffdd88', opacity: 0.4, rotation: 15, scale: 1, blendMode: 'screen', length: 0.5, width: 0.02, angle: 0 },
      { type: 'anamorphic', position: 0.8, size: 0.15, color: '#ffcc44', opacity: 0.3, rotation: 0, scale: 1, blendMode: 'screen', squeeze: 2.5, curve: 0.3 },
    ],
  },
  '24mm-wide': {
    name: '24mm Ultra Wide',
    lensType: 'prime',
    apertureShape: 'circular',
    apertureBlades: 7,
    elements: [
      { type: 'glow', position: 0, size: 0.3, color: '#ffffff', opacity: 0.5, rotation: 0, scale: 1, blendMode: 'screen', spread: 0.5, falloff: 2 },
      { type: 'ring', position: 0.15, size: 0.08, color: '#ffddaa', opacity: 0.8, rotation: 0, scale: 1, blendMode: 'screen', innerRadius: 0.2, outerRadius: 1, ringCount: 4 },
      { type: 'polygon', position: 0.3, size: 0.15, color: '#ffeedd', opacity: 0.5, rotation: 30, scale: 1, blendMode: 'screen', sides: 7 },
      { type: 'streak', position: 0.5, size: 0.4, color: '#ffffaa', opacity: 0.3, rotation: 0, scale: 1, blendMode: 'screen', length: 0.8, width: 0.01, angle: 90 },
      { type: 'disk', position: 0.75, size: 0.1, color: '#ffcc88', opacity: 0.2, rotation: 45, scale: 1, blendMode: 'screen', feather: 0.9 },
    ],
  },
  '85mm-portrait': {
    name: '85mm Portrait',
    lensType: 'prime',
    apertureShape: 'circular',
    apertureBlades: 9,
    elements: [
      { type: 'disk', position: 0.1, size: 0.12, color: '#fffef0', opacity: 0.9, rotation: 0, scale: 1, blendMode: 'screen', feather: 0.2 },
      { type: 'ring', position: 0.25, size: 0.08, color: '#ffeedd', opacity: 0.7, rotation: 0, scale: 1, blendMode: 'screen', innerRadius: 0.1, outerRadius: 1, ringCount: 3 },
      { type: 'polygon', position: 0.4, size: 0.06, color: '#fff8cc', opacity: 0.6, rotation: 0, scale: 1, blendMode: 'screen', sides: 9 },
      { type: 'star', position: 0.6, size: 0.08, color: '#ffffee', opacity: 0.7, rotation: 0, scale: 1, blendMode: 'screen', spikes: 8, spikeLength: 2 },
      { type: 'anamorphic', position: 0.8, size: 0.1, color: '#ffeedd', opacity: 0.2, rotation: 0, scale: 1, blendMode: 'screen', squeeze: 1.5, curve: 0.1 },
    ],
  },
  'anamorphic-cinema': {
    name: 'Anamorphic Cinema',
    lensType: 'anamorphic',
    apertureShape: 'anamorphic',
    apertureBlades: 0,
    elements: [
      { type: 'anamorphic', position: 0, size: 0.5, color: '#ffcc88', opacity: 0.6, rotation: 0, scale: 1, blendMode: 'screen', squeeze: 2.39, curve: 0.5 },
      { type: 'streak', position: 0.2, size: 0.6, color: '#ffeedd', opacity: 0.5, rotation: 0, scale: 1, blendMode: 'screen', length: 1, width: 0.005, angle: 0 },
      { type: 'streak', position: 0.4, size: 0.4, color: '#ffeedd', opacity: 0.4, rotation: 0, scale: 1, blendMode: 'screen', length: 0.8, width: 0.008, angle: 0 },
      { type: 'anamorphic', position: 0.6, size: 0.3, color: '#ffccaa', opacity: 0.4, rotation: 0, scale: 1, blendMode: 'screen', squeeze: 2.39, curve: -0.3 },
      { type: 'streak', position: 0.8, size: 0.3, color: '#ffcc88', opacity: 0.3, rotation: 0, scale: 1, blendMode: 'screen', length: 0.6, width: 0.01, angle: 0 },
      { type: 'disk', position: 0.95, size: 0.08, color: '#ffaa44', opacity: 0.2, rotation: 0, scale: 1, blendMode: 'screen', feather: 0.9 },
    ],
  },
  'vintage-lens': {
    name: 'Vintage Lens',
    lensType: 'vintage',
    apertureShape: 'hexagonal',
    apertureBlades: 6,
    elements: [
      { type: 'ring', position: 0.1, size: 0.1, color: '#ffaa55', opacity: 0.7, rotation: 0, scale: 1, blendMode: 'screen', innerRadius: 0.3, outerRadius: 1, ringCount: 2 },
      { type: 'disk', position: 0.3, size: 0.15, color: '#ffcc88', opacity: 0.5, rotation: 15, scale: 1, blendMode: 'screen', feather: 0.4 },
      { type: 'polygon', position: 0.5, size: 0.1, color: '#ffcc88', opacity: 0.4, rotation: 30, scale: 1, blendMode: 'screen', sides: 6 },
      { type: 'disk', position: 0.75, size: 0.08, color: '#ffaa44', opacity: 0.3, rotation: 45, scale: 1, blendMode: 'screen', feather: 0.7 },
      { type: 'glow', position: 0.9, size: 0.2, color: '#ffaa33', opacity: 0.3, rotation: 0, scale: 1, blendMode: 'screen', spread: 0.3, falloff: 1.5 },
    ],
  },
  'cinematic': {
    name: 'Cinematic',
    lensType: 'cinematic',
    apertureShape: 'circular',
    apertureBlades: 11,
    elements: [
      { type: 'glow', position: 0, size: 0.25, color: '#ffffff', opacity: 0.4, rotation: 0, scale: 1, blendMode: 'screen', spread: 0.4, falloff: 1.5 },
      { type: 'ring-sequence', position: 0.1, size: 0.04, color: '#ffffff', opacity: 0.8, rotation: 0, scale: 1, blendMode: 'screen', ringCount: 6 },
      { type: 'disk', position: 0.25, size: 0.18, color: '#ffffee', opacity: 0.6, rotation: 0, scale: 1, blendMode: 'screen', feather: 0.3 },
      { type: 'polygon', position: 0.45, size: 0.12, color: '#ffeedd', opacity: 0.5, rotation: 10, scale: 1, blendMode: 'screen', sides: 11 },
      { type: 'star', position: 0.65, size: 0.1, color: '#ffffff', opacity: 0.8, rotation: 0, scale: 1, blendMode: 'screen', spikes: 8, spikeLength: 3 },
      { type: 'anamorphic', position: 0.8, size: 0.15, color: '#ffeebb', opacity: 0.3, rotation: 0, scale: 1, blendMode: 'screen', squeeze: 1.8, curve: 0.2 },
    ],
  },
  'vintage': {
    name: 'Vintage Lens',
    lensType: 'vintage',
    apertureShape: 'octagonal',
    apertureBlades: 8,
    elements: [
      { type: 'ring', position: 0.05, size: 0.06, color: '#ffbb66', opacity: 0.6, rotation: 0, scale: 1, blendMode: 'screen', innerRadius: 0.2, outerRadius: 1, ringCount: 2 },
      { type: 'disk', position: 0.25, size: 0.12, color: '#ffdd99', opacity: 0.4, rotation: 0, scale: 1, blendMode: 'screen', feather: 0.3 },
      { type: 'polygon', position: 0.5, size: 0.08, color: '#ffeebb', opacity: 0.3, rotation: 22.5, scale: 1, blendMode: 'screen', sides: 8 },
      { type: 'disk', position: 0.8, size: 0.05, color: '#ffcc88', opacity: 0.2, rotation: 45, scale: 1, blendMode: 'screen', feather: 0.8 },
    ],
  },
}

/** Main lens flare function */
export async function addLensFlare(
  canvas: HTMLCanvasElement,
  options: LensFlareOptions = {
    centerX: 0.5,
    centerY: 0.5,
    scale: 1,
    rotation: 0,
    opacity: 1,
    elements: LENS_FLARE_PRESETS['cinematic'].elements,
    lensPreset: 'cinematic',
    lightColor: '#fff8e8',
    intensity: 1,
    lensType: 'modern',
    apertureShape: 'circular',
    apertureBlades: 8,
    apertureRotation: 0,
    chromaticAberration: 0,
    dirtAmount: 0,
    coatingColor: '#ff8822',
    vignetteAmount: 0,
    quality: 'high',
  }
): Promise<HTMLCanvasElement> {
  const startTime = performance.now()
  const { width, height } = canvas

  // Apply preset if specified
  const presets = LENS_FLARE_PRESETS
  const preset = options.lensPreset ? presets[options.lensPreset] : null

  const elements = options.elements || (preset ? preset.elements : presets['cinematic'].elements)
  const lensType = options.lensType || (preset ? preset.lensType : 'modern')
  const apertureShape = options.apertureShape || (preset ? preset.apertureShape : 'circular')
  const apertureBlades = options.apertureBlades || (preset ? preset.apertureBlades : 8)
  const apertureRotation = options.apertureRotation || (preset ? preset.apertureRotation : 0)
  const chromaticAberration = options.chromaticAberration ?? 0
  const dirtAmount = options.dirtAmount ?? 0
  const coatingColor = options.coatingColor || '#ff8822'
  const vignetteAmount = options.vignetteAmount ?? 0

  const { width, height } = canvas
  const diagonal = Math.sqrt(width * width + height * height)

  // Create flare canvas
  const flareCanvas = createCanvas(width, height)
  const ctx = ctx2d(flareCanvas)

  // Calculate flare center
  const centerX = width * options.centerX
  const centerY = height * options.centerY

  // Apply global transform
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.rotate((options.rotation || 0) * Math.PI / 180)
  ctx.scale(options.scale || 1, options.scale || 1)
  ctx.translate(-width / 2, -height / 2)

  // Render each flare element
  for (const element of elements) {
    await renderFlareElement(ctx, element, {
      centerX,
      centerY,
      diagonal: Math.sqrt(width * width + height * height),
      lightColor: options.lightColor,
      intensity: options.intensity,
      lensType,
      apertureShape,
      apertureBlades,
      apertureRotation,
      chromaticAberration,
      coatingColor,
    })
  }

  ctx.restore()

  // Apply chromatic aberration
  if (chromaticAberration !== 0) {
    // Would apply CA to flare
  }

  // Apply lens dirt/scratches
  if (dirtAmount > 0) {
    addLensDirt(ctx, width, height, dirtAmount)
  }

  // Apply lens coating reflection
  if (coatingColor) {
    addLensCoating(ctx, width, height, coatingColor)
  }

  // Apply vignette
  if (vignetteAmount !== 0) {
    addVignette(ctx, width, height, vignetteAmount)
  }

  // Composite flare onto original
  const output = createCanvas(width, height)
  const outCtx = ctx2d(output)
  outCtx.drawImage(canvas, 0, 0)
  outCtx.globalCompositeOperation = 'screen'
  outCtx.globalAlpha = options.opacity || 1
  outCtx.drawImage(flareCanvas, 0, 0)
  outCtx.globalAlpha = 1
  outCtx.globalCompositeOperation = 'source-over'

  return output
}

/** Render individual flare element */
async function renderFlareElement(
  ctx: CanvasRenderingContext2D,
  element: LensFlareElement,
  context: {
    centerX: number
    centerY: number
    diagonal: number
    lightColor: string
    intensity: number
    lensType: string
    apertureShape: string
    apertureBlades: number
    apertureRotation: number
    chromaticAberration: number
    coatingColor: string
  }
): Promise<void> {
  const { centerX, centerY, diagonal, lightColor, intensity } = context

  // Calculate element position along flare axis
  const angle = -45 * Math.PI / 180 // Default flare angle
  const distance = element.position * context.diagonal * 0.8
  const x = context.centerX + Math.cos(angle) * distance
  const y = context.centerY + Math.sin(angle) * distance

  const size = element.size * context.diagonal
  const opacity = element.opacity * (context.intensity || 1)
  const color = element.color || context.lightColor

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate((element.rotation || 0) * Math.PI / 180)
  ctx.scale(element.scale || 1, element.scale || 1)
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = element.blendMode as GlobalCompositeOperation

  const size = element.size * context.diagonal

  switch (element.type) {
    case 'ring':
      renderRing(ctx, size, element)
      break
    case 'disk':
      renderDisk(ctx, size, element)
      break
    case 'polygon':
      renderPolygon(ctx, size, element)
      break
    case 'star':
      renderStar(ctx, size, element)
      break
    case 'streak':
      renderStreak(ctx, size, element)
      break
    case 'glow':
      renderGlow(ctx, size, element)
      break
    case 'ring-sequence':
      renderRingSequence(ctx, size, element)
      break
    case 'anamorphic':
      renderAnamorphic(ctx, size, element)
      break
  }

  ctx.restore()
}

function renderRing(
  ctx: CanvasRenderingContext2D,
  size: number,
  element: LensFlareElement
): void {
  const innerRadius = (element.innerRadius || 0.3) * size
  const outerRadius = (element.outerRadius || 1) * size
  const ringCount = element.ringCount || 1
  const color = element.color
  const opacity = element.opacity

  for (let i = 0; i < ringCount; i++) {
    const progress = i / Math.max(1, ringCount - 1)
    const radius = innerRadius + (outerRadius - innerRadius) * progress
    const opacity = (1 - progress * 0.5) * element.opacity

    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.globalAlpha = opacity * (1 - progress * 0.3)
    ctx.lineWidth = size * 0.02
    ctx.stroke()
  }
}

function renderDisk(
  ctx: CanvasRenderingContext2D,
  size: number,
  element: LensFlareElement
): void {
  const radius = size
  const feather = element.feather || 0.3
  const color = element.color
  const opacity = element.opacity

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size)
  gradient.addColorStop(0, color)
  gradient.addColorStop(1 - feather, color)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')

  ctx.beginPath()
  ctx.arc(0, 0, size, 0, Math.PI * 2)
  ctx.fillStyle = gradient
  ctx.globalAlpha = element.opacity
  ctx.fill()
}

function renderPolygon(
  ctx: CanvasRenderingContext2D,
  size: number,
  element: LensFlareElement
): void {
  const sides = element.sides || 6
  const radius = size
  const color = element.color
  const opacity = element.opacity

  ctx.beginPath()
  for (let i = 0; i <= sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2
    const x = Math.cos(angle) * size
    const y = Math.sin(angle) * size
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size)
  gradient.addColorStop(0, element.color)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.globalAlpha = element.opacity
  ctx.fill()
}

function renderStar(
  ctx: CanvasRenderingContext2D,
  size: number,
  element: LensFlareElement
): void {
  const spikes = element.spikes || 8
  const spikeLength = (element.spikeLength || 2) * size
  const color = element.color
  const opacity = element.opacity

  ctx.beginPath()
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i / (spikes * 2)) * Math.PI * 2
    const radius = i % 2 === 0 ? size : spikeLength
    const x = Math.cos(angle) * (i % 2 === 0 ? size : spikeLength)
    const y = Math.sin(angle) * (i % 2 === 0 ? size : spikeLength)

    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 2)
  gradient.addColorStop(0, element.color)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.globalAlpha = element.opacity
  ctx.fill()
}

function renderStreak(
  ctx: CanvasRenderingContext2D,
  size: number,
  element: LensFlareElement
): void {
  const length = (element.length || 0.5) * size * 10
  const width = (element.width || 0.01) * size
  const angle = (element.angle || 0) * Math.PI / 180
  const color = element.color
  const opacity = element.opacity

  ctx.save()
  ctx.rotate(angle)

  const gradient = ctx.createLinearGradient(-length / 2, 0, length / 2, 0)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(0.5, color)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')

  ctx.fillStyle = gradient
  ctx.globalAlpha = opacity
  ctx.fillRect(-length / 2, -width / 2, length, width)

  ctx.restore()
}

function renderGlow(
  ctx: CanvasRenderingContext2D,
  size: number,
  element: LensFlareElement
): void {
  const spread = element.spread || 0.5
  const falloff = element.falloff || 1
  const color = element.color
  const opacity = element.opacity

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size * spread)
  gradient.addColorStop(0, color)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')

  ctx.beginPath()
  ctx.arc(0, 0, size * spread, 0, Math.PI * 2)
  ctx.fillStyle = gradient
  ctx.globalAlpha = opacity
  ctx.fill()
}

function renderRingSequence(
  ctx: CanvasRenderingContext2D,
  size: number,
  element: LensFlareElement
): void {
  const ringCount = element.ringCount || 5
  const baseSize = size
  const color = element.color
  const opacity = element.opacity

  for (let i = 0; i < ringCount; i++) {
    const progress = i / (ringCount - 1)
    const ringSize = baseSize * (0.3 + progress * 0.7)
    const ringOpacity = opacity * (1 - progress * 0.4)

    const gradient = ctx.createRadialGradient(0, 0, ringSize * 0.3, 0, 0, ringSize)
    gradient.addColorStop(0, color)
    gradient.addColorStop(1, 'rgba(0,0,0,0)')

    ctx.beginPath()
    ctx.arc(0, 0, ringSize, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.globalAlpha = ringOpacity
    ctx.fill()
  }
}

function renderAnamorphic(
  ctx: CanvasRenderingContext2D,
  size: number,
  element: LensFlareElement
): void {
  const squeeze = element.squeeze || 2.39
  const curve = element.curve || 0
  const color = element.color
  const opacity = element.opacity

  // Anamorphic flare is a horizontal streak with slight curve
  const length = size * 10
  const width = size / squeeze

  ctx.save()
  ctx.scale(squeeze, 1)

  // Main streak
  const gradient = ctx.createLinearGradient(-length / 2, 0, length / 2, 0)
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(0.3, element.color)
  gradient.addColorStop(0.5, element.color)
  gradient.addColorStop(0.7, element.color)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')

  ctx.fillStyle = gradient
  ctx.globalAlpha = element.opacity

  // Curved streak
  ctx.beginPath()
  ctx.moveTo(-length / 2, 0)
  for (let x = -length / 2; x <= length / 2; x += 5) {
    const y = Math.sin((x / length + 0.5) * Math.PI) * curve * size * 0.1
    if (x === -length / 2) {
      ctx.moveTo(x, 0)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.lineTo(length / 2, 0)
  ctx.lineTo(length / 2, 0)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

/** Add lens dirt and scratches */
function addLensDirt(ctx: CanvasRenderingContext2D, width: number, height: number, amount: number): void {
  const count = Math.floor(amount * 100)
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = 0.5

  for (let i = 0; i < count; i++) {
    ctx.beginPath()
    ctx.moveTo(Math.random() * width, Math.random() * height)
    ctx.lineTo(Math.random() * width, Math.random() * height)
    ctx.stroke()
  }

  // Scratches
  ctx.strokeStyle = 'rgba(255,255,255,0.03)'
  ctx.lineWidth = 1
  for (let i = 0; i < amount * 20; i++) {
    ctx.beginPath()
    ctx.moveTo(Math.random() * width, Math.random() * height)
    ctx.lineTo(Math.random() * width, Math.random() * height)
    ctx.stroke()
  }

  // Dust spots
  ctx.fillStyle = 'rgba(0,0,0,0.05)'
  for (let i = 0; i < amount * 50; i++) {
    const x = Math.random() * 800
    const y = Math.random() * 600
    const r = Math.random() * 3 + 0.5
    ctx.beginPath()
    ctx.arc(Math.random() * 800, Math.random() * 600, Math.random() * 3 + 1, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Add lens coating reflection */
function addLensCoating(ctx: CanvasRenderingContext2D, width: number, height: number, color: string): void {
  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, 0,
    width / 2, height / 2, Math.max(width, height) / 2
  )
  gradient.addColorStop(0, color)
  gradient.addColorStop(0.7, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')

  ctx.globalCompositeOperation = 'screen'
  ctx.globalAlpha = 0.1
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 800, 600)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

/** Add vignette */
function addVignette(ctx: CanvasRenderingContext2D, width: number, height: number, amount: number): void {
  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, 0,
    width / 2, height / 2, Math.max(width, height) / 2
  )

  if (amount > 0) {
    gradient.addColorStop(0, 'rgba(0,0,0,0)')
    gradient.addColorStop(1, `rgba(0,0,0,${amount / 100})`)
  } else {
    gradient.addColorStop(0, `rgba(255,255,255,${Math.abs(amount) / 100})`)
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
  }

  ctx.globalCompositeOperation = amount > 0 ? 'multiply' : 'screen'
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  ctx.globalCompositeOperation = 'source-over'
}

/** Create lens flare UI */
export function createLensFlareUI(
  canvas: HTMLCanvasElement,
  onApply: (result: HTMLCanvasElement) => void
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'lens-flare-ui'
  container.innerHTML = `
    <div class="lens-flare-panel">
      <h3>Lens Flare</h3>
      <div class="preset-selector">
        <label>Preset:</label>
        <select id="flare-preset">
          <option value="custom">Custom</option>
          <option value="50mm-prime">50mm Prime</option>
          <option value="35mm-wide">35mm Wide</option>
          <option value="24mm-wide">24mm Ultra Wide</option>
          <option value="85mm-portrait">85mm Portrait</option>
          <option value="anamorphic-cinema">Anamorphic Cinema</option>
          <option value="vintage-lens">Vintage Lens</option>
          <option value="cinematic">Cinematic</option>
        </select>
      </div>
      <div class="flare-controls">
        <div class="control-row">
          <label>Position X: <input type="range" id="flare-x" min="0" max="1" step="0.01" value="0.5"></label>
          <label>Position Y: <input type="range" id="flare-y" min="0" max="1" step="0.01" value="0.5"></label>
        </div>
        <div class="control-row">
          <label>Scale: <input type="range" id="flare-scale" min="0.1" max="3" step="0.1" value="1"></label>
          <label>Rotation: <input type="range" id="flare-rotation" min="-180" max="180" step="1" value="0"></label>
        </div>
        <div class="control-row">
          <label>Intensity: <input type="range" id="flare-intensity" min="0" max="2" step="0.1" value="1"></label>
          <label>Opacity: <input type="range" id="flare-opacity" min="0" max="1" step="0.01" value="1"></label>
        </div>
        <div class="control-row">
          <label>Light Color: <input type="color" id="flare-color" value="#fff8e8"></label>
        </div>
        <div class="control-row">
          <label>Lens Type: <select id="flare-lens-type">
            <option value="prime">Prime</option>
            <option value="zoom">Zoom</option>
            <option value="anamorphic">Anamorphic</option>
            <option value="vintage">Vintage</option>
            <option value="modern">Modern</option>
          </select></label>
          <label>Aperture: <select id="flare-aperture">
            <option value="circular">Circular</option>
            <option value="hexagonal">Hexagonal</option>
            <option value="octagonal">Octagonal</option>
          </select></label>
        </div>
        <div class="control-row">
          <label>Blades: <input type="range" id="flare-blades" min="3" max="16" step="1" value="8"></label>
          <label>Rotation: <input type="range" id="flare-aperture-rot" min="0" max="360" step="1" value="0"></label>
        </div>
        <div class="control-row">
          <label>CA: <input type="range" id="flare-ca" min="0" max="10" step="0.1" value="0"></label>
          <label>Dirt: <input type="range" id="flare-dirt" min="0" max="1" step="0.01" value="0"></label>
        </div>
        <div class="control-row">
          <label>Coating: <input type="color" id="flare-coating" value="#ff8822"></label>
          <label>Vignette: <input type="range" id="flare-vignette" min="-50" max="50" step="1" value="0"></label>
        </div>
        <div class="quality-select">
          <label>Quality: <select id="flare-quality">
            <option value="draft">Draft</option>
            <option value="normal" selected>Normal</option>
            <option value="high">High</option>
            <option value="ultra">Ultra</option>
          </select></label>
        </div>
      </div>
      <div class="elements-panel">
        <h4>Flare Elements</h4>
        <div id="elements-list"></div>
        <button id="add-element">Add Element</button>
      </div>
      <div class="actions">
        <button id="apply-flare" class="primary">Apply Flare</button>
        <button id="reset-flare">Reset</button>
      </div>
    </div>
  `

  // Populate preset select
  const presetSelect = container.querySelector('#flare-preset') as HTMLSelectElement
  Object.keys(LENS_FLARE_PRESETS).forEach(key => {
    const option = document.createElement('option')
    option.value = key
    option.textContent = LENS_FLARE_PRESETS[key].name
    presetSelect.appendChild(option)
  }

  // Preset change handler
  presetSelect.addEventListener('change', () => {
    const preset = LENS_FLARE_PRESETS[presetSelect.value]
    if (preset) {
      // Update UI with preset values
      // Would populate elements list
    }
  })

  // Apply button
  const applyBtn = container.querySelector('#apply-flare')!
  applyBtn.addEventListener('click', async () => {
    const options = getFlareOptionsFromUI(container)
    const result = await addLensFlare(canvas, options)
    onApply(result)
  })

  return container
}

function getFlareOptionsFromUI(container: HTMLElement): LensFlareOptions {
  return {
    centerX: parseFloat((container.querySelector('#flare-x') as HTMLInputElement).value),
    centerY: parseFloat((container.querySelector('#flare-y') as HTMLInputElement).value),
    scale: parseFloat((container.querySelector('#flare-scale') as HTMLInputElement).value),
    rotation: parseFloat((container.querySelector('#flare-rotation') as HTMLInputElement).value),
    opacity: parseFloat((container.querySelector('#flare-opacity') as HTMLInputElement).value),
    intensity: parseFloat((container.querySelector('#flare-intensity') as HTMLInputElement).value),
    lightColor: (container.querySelector('#flare-color') as HTMLInputElement).value,
    lensType: (container.querySelector('#flare-lens-type') as HTMLSelectElement).value as any,
    apertureShape: (container.querySelector('#flare-aperture') as HTMLSelectElement).value as any,
    apertureBlades: parseInt((container.querySelector('#flare-blades') as HTMLInputElement).value),
    apertureRotation: parseFloat((container.querySelector('#flare-aperture-rot') as HTMLInputElement).value),
    chromaticAberration: parseFloat((container.querySelector('#flare-ca') as HTMLInputElement).value),
    dirtAmount: parseFloat((container.querySelector('#flare-dirt') as HTMLInputElement).value),
    coatingColor: (container.querySelector('#flare-coating') as HTMLInputElement).value,
    vignetteAmount: parseFloat((container.querySelector('#flare-vignette') as HTMLInputElement).value),
    quality: (container.querySelector('#flare-quality') as HTMLSelectElement).value as any,
    elements: [], // Would read from elements list
  }
}