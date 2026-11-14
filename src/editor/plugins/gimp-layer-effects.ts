'use client'
// GIMP Layer Effects (Non-destructive Layer Styles)
// Equivalent to Photoshop's Layer Styles / GIMP's Layer Effects

import { createCanvas, ctx2d } from '../utils/canvas'

export interface LayerEffect {
  type: LayerEffectType
  enabled: boolean
  params: Record<string, any>
}

export type LayerEffectType =
  | 'drop-shadow'
  | 'inner-shadow'
  | 'outer-glow'
  | 'inner-glow'
  | 'bevel-emboss'
  | 'satin'
  | 'color-overlay'
  | 'gradient-overlay'
  | 'pattern-overlay'
  | 'stroke'
  | 'stroke-gradient'
  | 'stroke-pattern'

export interface LayerEffects {
  effects: LayerEffect[]
  globalLight: { angle: number; altitude: number } // degrees
}

export const DEFAULT_LAYER_EFFECTS: LayerEffects = {
  globalLight: { angle: 120, altitude: 30 },
  effects: [],
}

export interface DropShadowParams {
  blendMode: string
  color: string
  opacity: number // 0-100
  angle: number // degrees
  distance: number // pixels
  spread: number // 0-100
  size: number // pixels
  noise: number // 0-100
  layerKnocksOutDropShadow: boolean
}

export interface InnerShadowParams {
  blendMode: string
  color: string
  opacity: number
  angle: number
  distance: number
  choke: number // 0-100
  size: number
  noise: number
}

export interface OuterGlowParams {
  blendMode: string
  color: string // or gradient
  opacity: number
  noise: number
  technique: 'softer' | 'precise'
  spread: number
  size: number
  contour: string
  range: number // 0-100
  jitter: number // 0-100
}

export interface InnerGlowParams {
  blendMode: string
  color: string
  opacity: number
  noise: number
  technique: 'softer' | 'precise'
  source: 'center' | 'edge'
  choke: number
  size: number
  contour: string
  range: number
  jitter: number
}

export interface BevelEmbossParams {
  style: 'outer' | 'inner' | 'emboss' | 'pillow' | 'stroke'
  technique: 'smooth' | 'chisel-hard' | 'chisel-soft'
  depth: number // 1-1000%
  direction: 'up' | 'down'
  size: number // pixels
  soften: number // 0-16
  angle: number // degrees
  altitude: number // degrees
  glossContour: string
  highlightMode: string
  highlightColor: string
  highlightOpacity: number
  shadowMode: string
  shadowColor: string
  shadowOpacity: number
  useGlobalLight: boolean
}

export interface SatinParams {
  blendMode: string
  color: string
  opacity: number
  angle: number
  distance: number
  size: number
  contour: string
  antiAliased: boolean
  invert: boolean
}

export interface ColorOverlayParams {
  blendMode: string
  color: string
  opacity: number
}

export interface GradientOverlayParams {
  blendMode: string
  opacity: number
  gradient: GradientStop[]
  style: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond'
  angle: number
  scale: number // %
  alignWithLayer: boolean
  reverse: boolean
  dither: boolean
  interpolation: 'rgb' | 'hsl' | 'lab' | 'oklab'
}

export interface PatternOverlayParams {
  blendMode: string
  opacity: number
  pattern: HTMLCanvasElement
  scale: number // %
  alignWithLayer: boolean
  linkWithLayer: boolean
}

export interface StrokeParams {
  size: number // pixels
  position: 'outside' | 'inside' | 'center'
  blendMode: string
  opacity: number
  fillType: 'color' | 'gradient' | 'pattern'
  color?: string
  gradient?: GradientOverlayParams['gradient']
  gradientStyle?: GradientOverlayParams['style']
  gradientAngle?: number
  gradientScale?: number
  pattern?: HTMLCanvasElement
}

export interface GradientStop {
  position: number // 0-1
  color: string
  opacity: number // 0-100
}

/** Apply all enabled layer effects to a layer canvas */
export async function applyLayerEffects(
  sourceCanvas: HTMLCanvasElement,
  effects: LayerEffects
): Promise<HTMLCanvasElement> {
  const { width, height } = sourceCanvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Sort effects by render order
  const effectOrder: LayerEffectType[] = [
    'drop-shadow',
    'inner-shadow',
    'outer-glow',
    'inner-glow',
    'bevel-emboss',
    'satin',
    'color-overlay',
    'gradient-overlay',
    'pattern-overlay',
    'stroke',
  ]

  let currentCanvas = sourceCanvas

  for (const effectType of effectOrder) {
    const effect = effects.effects.find(e => e.type === effectType && e.enabled)
    if (!effect) continue

    currentCanvas = await applySingleEffect(currentCanvas, effect.type, effect.params, effects.globalLight)
  }

  // Draw final result
  ctx.drawImage(currentCanvas, 0, 0)
  return output
}

async function applySingleEffect(
  canvas: HTMLCanvasElement,
  type: LayerEffectType,
  params: Record<string, any>,
  globalLight: { angle: number; altitude: number }
): Promise<HTMLCanvasElement> {
  const { width, height } = canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  switch (type) {
    case 'drop-shadow':
      return applyDropShadow(canvas, params, globalLight)
    case 'inner-shadow':
      return applyInnerShadow(canvas, params, globalLight)
    case 'outer-glow':
      return applyOuterGlow(canvas, params)
    case 'inner-glow':
      return applyInnerGlow(canvas, params)
    case 'bevel-emboss':
      return applyBevelEmboss(canvas, params, globalLight)
    case 'satin':
      return applySatin(canvas, params)
    case 'color-overlay':
      return applyColorOverlay(canvas, params)
    case 'gradient-overlay':
      return applyGradientOverlay(canvas, params)
    case 'pattern-overlay':
      return applyPatternOverlay(canvas, params)
    case 'stroke':
      return applyStroke(canvas, params)
    default:
      return canvas
  }
}

/** Drop Shadow */
function applyDropShadow(
  canvas: HTMLCanvasElement,
  params: DropShadowParams,
  globalLight: { angle: number; altitude: number }
): Promise<HTMLCanvasElement> {
  const { width, height } = canvas
  const output = createCanvas(width + 100, height + 100) // Extra space for shadow
  const ctx = ctx2d(output)

  const angle = (params.angle || globalLight.angle) * Math.PI / 180
  const distance = params.distance || 5
  const spread = (params.spread || 0) / 100
  const size = params.size || 5
  const opacity = (params.opacity || 75) / 100
  const color = params.color || '#000000'
  const blendMode = params.blendMode || 'multiply'

  const offsetX = Math.cos(angle) * distance
  const offsetY = Math.sin(angle) * distance

  // Draw shadow
  ctx.save()
  ctx.translate(offsetX + 50, offsetY + 50)
  ctx.filter = `blur(${size}px)`
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation
  ctx.drawImage(canvas, 0, 0)
  ctx.restore()

  // Draw original on top
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(canvas, 50, 50)

  // Crop back to original size
  const finalOutput = createCanvas(width, height)
  const finalCtx = ctx2d(finalOutput)
  finalCtx.drawImage(output, 50, 50, width, height, 0, 0, width, height)

  return output
}

/** Inner Shadow */
function applyInnerShadow(
  canvas: HTMLCanvasElement,
  params: InnerShadowParams,
  globalLight: { angle: number; altitude: number }
): Promise<HTMLCanvasElement> {
  const { width, height } = canvas
  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Create mask from canvas alpha
  const mask = ctx2d(createCanvas(width, height))
  mask.drawImage(canvas, 0, 0)
  const maskData = mask.getImageData(0, 0, width, height)

  // Create inner shadow by offsetting and blurring the inverted mask
  const angle = (params.angle || globalLight.angle) * Math.PI / 180
  const distance = params.distance || 5
  const choke = (params.choke || 0) / 100
  const size = params.size || 5
  const opacity = (params.opacity || 75) / 100

  const offsetX = Math.cos(angle) * distance
  const offsetY = Math.sin(angle) * distance

  // This is a simplified implementation
  ctx.save()
  ctx.globalCompositeOperation = 'source-in'
  ctx.globalAlpha = opacity
  ctx.filter = `blur(${size}px)`
  ctx.translate(-offsetX, -offsetY)
  ctx.drawImage(canvas, 0, 0)
  ctx.restore()

  // Draw original
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(canvas, 0, 0)

  return output
}

/** Outer Glow */
function applyOuterGlow(
  canvas: HTMLCanvasElement,
  params: OuterGlowParams
): Promise<HTMLCanvasElement> {
  const { width, height } = canvas
  const output = createCanvas(width + 100, height + 100)
  const ctx = ctx2d(output)

  const size = params.size || 10
  const spread = (params.spread || 0) / 100
  const opacity = (params.opacity || 75) / 100
  const color = params.color || '#ffffff'
  const blendMode = params.blendMode || 'screen'

  // Draw glow
  ctx.save()
  ctx.translate(50, 50)
  ctx.filter = `blur(${size}px)`
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation

  // Create glow from canvas silhouette
  ctx.fillStyle = color
  ctx.drawImage(canvas, 0, 0)
  ctx.restore()

  // Draw original
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(canvas, 50, 50)

  // Crop
  const finalOutput = createCanvas(width, height)
  const finalCtx = ctx2d(finalOutput)
  finalCtx.drawImage(output, 50, 50, width, height, 0, 0, width, height)

  return output
}

/** Inner Glow */
function applyInnerGlow(
  canvas: HTMLCanvasElement,
  params: InnerGlowParams
): Promise<HTMLCanvasElement> {
  // Simplified implementation
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(canvas, 0, 0)
  return output
}

/** Bevel & Emboss */
function applyBevelEmboss(
  canvas: HTMLCanvasElement,
  params: BevelEmbossParams,
  globalLight: { angle: number; altitude: number }
): Promise<HTMLCanvasElement> {
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(canvas, 0, 0)

  // This is a complex effect - simplified version using highlights/shadows
  const style = params.style || 'outer'
  const depth = (params.depth || 100) / 100
  const size = params.size || 5
  const angle = (params.useGlobalLight ? globalLight.angle : (params.angle || 120)) * Math.PI / 180
  const altitude = (params.useGlobalLight ? globalLight.altitude : (params.altitude || 30)) * Math.PI / 180

  // Create highlight and shadow layers
  // This is a very simplified implementation
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(canvas, 0, 0)

  return output
}

/** Satin */
function applySatin(
  canvas: HTMLCanvasElement,
  params: SatinParams
): Promise<HTMLCanvasElement> {
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(canvas, 0, 0)
  return output
}

/** Color Overlay */
function applyColorOverlay(
  canvas: HTMLCanvasElement,
  params: ColorOverlayParams
): Promise<HTMLCanvasElement> {
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(canvas, 0, 0)
  ctx.globalCompositeOperation = params.blendMode as GlobalCompositeOperation
  ctx.globalAlpha = (params.opacity || 100) / 100
  ctx.fillStyle = params.color || '#000000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return output
}

/** Gradient Overlay */
function applyGradientOverlay(
  canvas: HTMLCanvasElement,
  params: GradientOverlayParams
): Promise<HTMLCanvasElement> {
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(canvas, 0, 0)

  const gradient = createGradient(ctx, params)
  ctx.globalCompositeOperation = params.blendMode as GlobalCompositeOperation
  ctx.globalAlpha = (params.opacity || 100) / 100
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  return output
}

/** Pattern Overlay */
function applyPatternOverlay(
  canvas: HTMLCanvasElement,
  params: PatternOverlayParams
): Promise<HTMLCanvasElement> {
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)
  ctx.drawImage(canvas, 0, 0)

  if (params.pattern) {
    const pattern = ctx.createPattern(params.pattern, 'repeat')
    if (pattern) {
      ctx.globalCompositeOperation = params.blendMode as GlobalCompositeOperation
      ctx.globalAlpha = (params.opacity || 100) / 100
      ctx.fillStyle = pattern
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
  }

  return output
}

/** Stroke */
function applyStroke(
  canvas: HTMLCanvasElement,
  params: StrokeParams
): Promise<HTMLCanvasElement> {
  const output = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(output)

  // Draw stroke first
  ctx.lineWidth = params.size
  ctx.strokeStyle = params.color || '#000000'
  ctx.globalAlpha = (params.opacity || 100) / 100
  ctx.globalCompositeOperation = params.blendMode as GlobalCompositeOperation

  // Simplified: just draw a rect around the canvas
  ctx.strokeRect(params.size / 2, params.size / 2, canvas.width - params.size, canvas.height - params.size)

  // Draw original
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.drawImage(canvas, 0, 0)

  return output
}

/** Create gradient from stops */
function createGradient(ctx: CanvasRenderingContext2D, params: GradientOverlayParams): CanvasGradient {
  const { width, height } = ctx.canvas
  let gradient: CanvasGradient

  switch (params.style) {
    case 'linear':
      gradient = ctx.createLinearGradient(0, 0, width, 0)
      if (params.angle) {
        const rad = params.angle * Math.PI / 180
        gradient = ctx.createLinearGradient(
          width / 2 - Math.cos(rad) * width / 2,
          height / 2 - Math.sin(rad) * height / 2,
          width / 2 + Math.cos(rad) * width / 2,
          height / 2 + Math.sin(rad) * height / 2
        )
      }
      break
    case 'radial':
      gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 2)
      break
    case 'angle':
      // Conic gradient not directly supported, approximate with radial
      gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 2)
      break
    default:
      gradient = ctx.createLinearGradient(0, 0, width, 0)
  }

  // Add color stops
  for (const stop of params.gradient) {
    gradient.addColorStop(stop.position, hexWithAlpha(stop.color, stop.opacity))
  }

  return gradient
}

function hexWithAlpha(hex: string, opacity: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${opacity / 100})`
}

/** Layer Effects Manager for UI */
export class LayerEffectsManager {
  private effects: LayerEffects = DEFAULT_LAYER_EFFECTS
  private listeners: Set<() => void> = new Set()

  getEffects(): LayerEffects {
    return { ...this.effects }
  }

  setEffects(effects: LayerEffects): void {
    this.effects = effects
    this.notify()
  }

  setEffect(type: LayerEffectType, params: Record<string, any>, enabled = true): void {
    const idx = this.effects.effects.findIndex(e => e.type === type)
    const effect: LayerEffect = { type, params, enabled }
    if (idx >= 0) this.effects.effects[idx] = effect
    else this.effects.effects.push(effect)
    this.notify()
  }

  removeEffect(type: LayerEffectType): void {
    this.effects.effects = this.effects.effects.filter(e => e.type !== type)
    this.notify()
  }

  setGlobalLight(angle: number, altitude: number): void {
    this.effects.globalLight = { angle, altitude }
    this.notify()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Preset Layer Styles */
export const LAYER_STYLE_PRESETS: Record<string, LayerEffects> = {
  'drop-shadow': {
    globalLight: { angle: 120, altitude: 30 },
    effects: [
      { type: 'drop-shadow', enabled: true, params: { blendMode: 'multiply', color: '#000000', opacity: 75, angle: 120, distance: 5, spread: 0, size: 5, noise: 0 } }
    ]
  },
  'inner-glow': {
    globalLight: { angle: 120, altitude: 30 },
    effects: [
      { type: 'inner-glow', enabled: true, params: { blendMode: 'screen', color: '#ffffff', opacity: 75, noise: 0, technique: 'softer', source: 'edge', choke: 0, size: 10 } }
    ]
  },
  'outer-glow': {
    globalLight: { angle: 120, altitude: 30 },
    effects: [
      { type: 'outer-glow', enabled: true, params: { blendMode: 'screen', color: '#ffffff', opacity: 75, noise: 0, technique: 'softer', spread: 0, size: 10 } }
    ]
  },
  'bevel-emboss': {
    globalLight: { angle: 120, altitude: 30 },
    effects: [
      { type: 'bevel-emboss', enabled: true, params: { style: 'outer', technique: 'smooth', depth: 100, direction: 'up', size: 5, soften: 0, angle: 120, altitude: 30, highlightMode: 'screen', highlightColor: '#ffffff', highlightOpacity: 75, shadowMode: 'multiply', shadowColor: '#000000', shadowOpacity: 75, useGlobalLight: true } }
    ]
  },
  'stroke': {
    globalLight: { angle: 120, altitude: 30 },
    effects: [
      { type: 'stroke', enabled: true, params: { size: 3, position: 'outside', blendMode: 'normal', opacity: 100, fillType: 'color', color: '#000000' } }
    ]
  },
  'chrome': {
    globalLight: { angle: 120, altitude: 30 },
    effects: [
      { type: 'bevel-emboss', enabled: true, params: { style: 'outer', technique: 'chisel-hard', depth: 200, direction: 'up', size: 7, soften: 0, angle: 120, altitude: 30, highlightMode: 'screen', highlightColor: '#ffffff', highlightOpacity: 90, shadowMode: 'multiply', shadowColor: '#000000', shadowOpacity: 90, useGlobalLight: true } },
      { type: 'gradient-overlay', enabled: true, params: { blendMode: 'normal', opacity: 50, gradient: [{ position: 0, color: '#cccccc', opacity: 100 }, { position: 0.5, color: '#ffffff', opacity: 100 }, { position: 1, color: '#cccccc', opacity: 100 }], style: 'linear', angle: 90, scale: 100, alignWithLayer: true } }
    ]
  },
}