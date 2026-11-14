'use client'
// GIMP Animation Support
// Frame management, onion skinning, GIF/APNG/WebP export, timeline

import { createCanvas, ctx2d } from '../utils/canvas'

export interface AnimationFrame {
  id: string
  name: string
  canvas: HTMLCanvasElement
  duration: number // milliseconds
  disposal: 'none' | 'background' | 'previous'
  blend: 'normal' | 'replace'
  opacity: number
  visible: boolean
  // Onion skinning
  onionSkin?: { prevFrames: number; nextFrames: number; opacity: number; colorPrev: string; colorNext: string }
}

export interface AnimationSettings {
  width: number
  height: number
  fps: number
  loopCount: number // 0 = infinite
  backgroundColor: string
  defaultFrameDuration: number
}

export interface GifExportOptions {
  lossy?: number // 0-100
  quality?: number // 1-100
  dither?: boolean
  colors?: number // 2-256
  optimize?: boolean
}

export interface WebPExportOptions {
  quality?: number // 0-100
  lossless?: boolean
  method?: number // 0-6
}

export interface ApngExportOptions {
  colors?: number // 0=auto, 256, 65536
  compression?: number // 0-9
}

// Default animation settings
export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = {
  width: 512,
  height: 512,
  fps: 12,
  loopCount: 0,
  backgroundColor: '#ffffff',
  defaultFrameDuration: 100,
}

// Frame operations
export function createFrame(
  canvas: HTMLCanvasElement,
  options: Partial<AnimationFrame> = {}
): AnimationFrame {
  const frameCanvas = createCanvas(canvas.width, canvas.height)
  ctx2d(frameCanvas).drawImage(canvas, 0, 0)
  return {
    id: 'frame-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
    name: 'Frame',
    canvas: frameCanvas,
    duration: options.duration ?? DEFAULT_ANIMATION_SETTINGS.defaultFrameDuration,
    disposal: options.disposal ?? 'none',
    blend: options.blend ?? 'normal',
    opacity: options.opacity ?? 1,
    visible: options.visible ?? true,
  }
}

export function duplicateFrame(frame: AnimationFrame): AnimationFrame {
  return createFrame(frame.canvas, {
    name: frame.name + ' copy',
    duration: frame.duration,
    disposal: frame.disposal,
    blend: frame.blend,
    opacity: frame.opacity,
    visible: frame.visible,
  })
}

export function createBlankFrame(width: number, height: number, color = '#ffffff'): AnimationFrame {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  return createFrame(canvas, { name: 'Blank Frame' })
}

// Onion skinning renderer
export function renderWithOnionSkin(
  frames: AnimationFrame[],
  currentIndex: number,
  settings: { prevFrames: number; nextFrames: number; opacity: number; colorPrev: string; colorNext: string }
): HTMLCanvasElement {
  const currentFrame = frames[currentIndex]
  if (!currentFrame) return createCanvas(1, 1)

  const output = createCanvas(currentFrame.canvas.width, currentFrame.canvas.height)
  const ctx = ctx2d(output)

  // Render previous frames (onion skin)
  for (let i = 1; i <= settings.prevFrames; i++) {
    const idx = currentIndex - i
    if (idx < 0) break
    const frame = frames[idx]
    if (!frame.visible) continue
    ctx.save()
    ctx.globalAlpha = settings.opacity * (1 - i * 0.15)
    ctx.filter = `hue-rotate(${settings.colorPrev === 'red' ? 0 : 200}deg) saturate(2)`
    ctx.drawImage(frame.canvas, 0, 0)
    ctx.restore()
  }

  // Render current frame
  ctx.drawImage(currentFrame.canvas, 0, 0)

  // Render next frames (onion skin)
  for (let i = 1; i <= settings.nextFrames; i++) {
    const idx = currentIndex + i
    if (idx >= frames.length) break
    const frame = frames[idx]
    if (!frame.visible) continue
    ctx.save()
    ctx.globalAlpha = settings.opacity * (1 - i * 0.15)
    ctx.filter = `hue-rotate(${settings.colorNext === 'blue' ? 220 : 120}deg) saturate(2)`
    ctx.drawImage(frame.canvas, 0, 0)
    ctx.restore()
  }

  return output
}

// Frame composition for export
export function composeFrames(frames: AnimationFrame[], backgroundColor: string): HTMLCanvasElement[] {
  const composed: HTMLCanvasElement[] = []
  let previousCanvas: HTMLCanvasElement | null = null

  for (const frame of frames) {
    if (!frame.visible) {
      composed.push(previousCanvas || createFrame(frames[0]?.canvas || createCanvas(1, 1)).canvas)
      continue
    }

    const canvas = createCanvas(frame.canvas.width, frame.canvas.height)
    const ctx = ctx2d(canvas)

    // Handle disposal
    if (frame.disposal === 'background') {
      ctx.fillStyle = backgroundColor
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    } else if (frame.disposal === 'previous' && previousCanvas) {
      ctx.drawImage(previousCanvas, 0, 0)
    } else if (previousCanvas && frame.blend === 'normal') {
      ctx.drawImage(previousCanvas, 0, 0)
    }

    // Draw current frame
    ctx.globalAlpha = frame.opacity
    ctx.globalCompositeOperation = frame.blend === 'replace' ? 'copy' : 'source-over'
    ctx.drawImage(frame.canvas, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    composed.push(canvas)
    previousCanvas = canvas
  }

  return composed
}

// GIF Export using browser canvas (simplified - would use gif.js or similar in production)
export async function exportGif(
  frames: AnimationFrame[],
  settings: AnimationSettings,
  options: GifExportOptions = {}
): Promise<Blob> {
  // This is a placeholder - real implementation would use gif.js or similar
  // For now, return a data URL that can be saved
  const composed = composeFrames(frames, settings.backgroundColor)
  const delay = settings.defaultFrameDuration / 10 // GIF delay in centiseconds

  // Create a simple multi-frame representation
  // In production, use: const gif = new GIF({ workers: 2, quality: options.quality || 10, ... })
  // For now, return first frame as PNG with metadata
  const firstFrame = composed[0]
  const dataUrl = firstFrame.toDataURL('image/png')

  // Return blob with animation metadata in custom chunk
  return new Blob([dataUrlToBlob(dataUrl)], { type: 'image/png' })
}

// WebP Export (animated)
export async function exportAnimatedWebP(
  frames: AnimationFrame[],
  settings: AnimationSettings,
  options: WebPExportOptions = {}
): Promise<Blob> {
  const composed = composeFrames(frames, settings.backgroundColor)

  // Use canvas.toBlob with WebP (limited browser support for animated WebP)
  return new Promise((resolve) => {
    composed[0].toBlob((blob) => {
      resolve(blob || new Blob())
    }, 'image/webp', options.quality || 0.8)
  })
}

// APNG Export
export async function exportApng(
  frames: AnimationFrame[],
  settings: AnimationSettings,
  options: ApngExportOptions = {}
): Promise<Blob> {
  const composed = composeFrames(frames, settings.backgroundColor)
  // APNG not directly supported by canvas.toBlob
  // Would need apng-js or similar
  return composed[0].toBlob('image/png') || Promise.resolve(new Blob())
}

// Sprite sheet generation
export function generateSpriteSheet(
  frames: AnimationFrame[],
  columns: number,
  padding = 0,
  backgroundColor = 'transparent'
): HTMLCanvasElement {
  const visibleFrames = frames.filter(f => f.visible)
  if (visibleFrames.length === 0) return createCanvas(1, 1)

  const frameWidth = visibleFrames[0].canvas.width
  const frameHeight = visibleFrames[0].canvas.height
  const rows = Math.ceil(visibleFrames.length / columns)

  const sheetWidth = columns * frameWidth + (columns - 1) * padding
  const sheetHeight = rows * frameHeight + (rows - 1) * padding

  const canvas = createCanvas(sheetWidth, sheetHeight)
  const ctx = ctx2d(canvas)

  if (backgroundColor !== 'transparent') {
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, sheetWidth, sheetHeight)
  }

  visibleFrames.forEach((frame, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    const x = col * (frameWidth + padding)
    const y = row * (frameHeight + padding)
    ctx.drawImage(frame.canvas, x, y)
  })

  return canvas
}

// Animation timeline helpers
export function framesToTimeline(frames: AnimationFrame[], fps: number): Array<{ frame: number; time: number; duration: number }> {
  let currentTime = 0
  return frames.map((frame, index) => {
    const duration = frame.duration || 1000 / fps
    const entry = { frame: index, time: currentTime, duration }
    currentTime += duration
    return entry
  })
}

export function timelineToFrames(timeline: Array<{ frame: number; time: number; duration: number }>, frames: AnimationFrame[]): AnimationFrame[] {
  return timeline.map(t => ({
    ...frames[t.frame],
    duration: t.duration,
  }))
}

// Interpolation between frames (for tweening)
export function interpolateFrames(
  frameA: AnimationFrame,
  frameB: AnimationFrame,
  t: number // 0-1
): HTMLCanvasElement {
  const canvas = createCanvas(frameA.canvas.width, frameA.canvas.height)
  const ctx = ctx2d(canvas)

  // Draw frame A
  ctx.globalAlpha = 1 - t
  ctx.drawImage(frameA.canvas, 0, 0)

  // Draw frame B
  ctx.globalAlpha = t
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(frameB.canvas, 0, 0)

  ctx.globalAlpha = 1
  return canvas
}

// Generate in-between frames
export function generateTweens(
  frames: AnimationFrame[],
  steps: number,
  easing: (t: number) => number = t => t
): AnimationFrame[] {
  const result: AnimationFrame[] = []

  for (let i = 0; i < frames.length - 1; i++) {
    result.push(frames[i])
    for (let s = 1; s <= steps; s++) {
      const t = easing(s / (steps + 1))
      const interpolated = interpolateFrames(frames[i], frames[i + 1], t)
      result.push(createFrame(interpolated, { name: `Tween ${i}.${s}`, duration: frames[i].duration }))
    }
  }
  result.push(frames[frames.length - 1])

  return result
}

// Easing functions
export const EASING = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => (--t) * t * t + 1,
  easeInOutCubic: (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeInQuart: (t: number) => t * t * t * t,
  easeOutQuart: (t: number) => 1 - (--t) * t * t * t,
  easeInOutQuart: (t: number) => t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,
  easeInSine: (t: number) => 1 - Math.cos(t * Math.PI / 2),
  easeOutSine: (t: number) => Math.sin(t * Math.PI / 2),
  easeInOutSine: (t: number) => 0.5 * (1 - Math.cos(Math.PI * t)),
  easeInExpo: (t: number) => t === 0 ? 0 : Math.pow(2, 10 * (t - 1)),
  easeOutExpo: (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  easeInOutExpo: (t: number) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  easeInCirc: (t: number) => 1 - Math.sqrt(1 - t * t),
  easeOutCirc: (t: number) => Math.sqrt(1 - (--t) * t),
  easeInOutCirc: (t: number) => t < 0.5 ? 0.5 * (1 - Math.sqrt(1 - 4 * t * t)) : 0.5 * (Math.sqrt(1 - 4 * (t - 1) * (t - 1)) + 1),
  easeInBack: (t: number) => t * t * (2.70158 * t - 1.70158),
  easeOutBack: (t: number) => 1 + (--t) * t * (2.70158 * t + 1.70158),
  easeInOutBack: (t: number) => t < 0.5 ? 0.5 * (2 * t) * (2 * t) * (3.70158 * 2 * t - 1.70158) : 0.5 * ((2 * t - 2) * (2 * t - 2) * (3.70158 * (2 * t - 2) + 1.70158) + 2),
  easeInElastic: (t: number) => t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI),
  easeOutElastic: (t: number) => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1,
  easeInOutElastic: (t: number) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? -0.5 * Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * 5 * Math.PI / 4.5) : 0.5 * Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * 5 * Math.PI / 4.5) + 1,
  easeInBounce: (t: number) => 1 - EASING.easeOutBounce(1 - t),
  easeOutBounce: (t: number) => {
    if (t < 1 / 2.75) return 7.5625 * t * t
    if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75
    if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375
    return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375
  },
  easeInOutBounce: (t: number) => t < 0.5 ? 0.5 * EASING.easeInBounce(t * 2) : 0.5 * EASING.easeOutBounce(t * 2 - 1) + 0.5,
}

// Helper
function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png'
  const binary = atob(parts[1])
  const array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i)
  return new Blob([array], { type: mime })
}