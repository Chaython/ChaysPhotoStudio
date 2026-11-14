'use client'
// GIMP Paint Dynamics & Advanced Brush Engine
// Extended brush dynamics, MyPaint-style brush engine, brush preview

import { createCanvas, ctx2d } from '../utils/canvas'

export interface PaintDynamics {
  // Size dynamics
  size: DynamicsParams
  opacity: DynamicsParams
  flow: DynamicsParams
  hardness: DynamicsParams
  angle: DynamicsParams
  roundness: DynamicsParams
  spacing: DynamicsParams
  scatter: DynamicsParams
  jitter: DynamicsParams
}

export interface DynamicsParams {
  pressure: number // 0-1
  velocity: number // 0-1
  direction: number // 0-1
  tilt: number // 0-1
  rotation: number // 0-1
  random: number // 0-1
  fade: number // 0-1
  curve: number[] // [x, y] pairs 0-1
}

export interface BrushDab {
  x: number
  y: number
  pressure: number
  tiltX: number
  tiltY: number
  rotation: number
  velocity: number
  timestamp: number
}

export interface AdvancedBrushSettings {
  // Base settings
  radius: number
  hardness: number
  opacity: number
  flow: number
  spacing: number
  angle: number
  roundness: number

  // Dab shape
  dabShape: 'circle' | 'square' | 'diamond' | 'custom'
  customDab?: HTMLCanvasElement

  // Dynamics
  dynamics: PaintDynamics

  // Texture
  texture: {
    enabled: boolean
    canvas: HTMLCanvasElement
    mode: 'multiply' | 'overlay' | 'subtract' | 'add'
    scale: number
    depth: number
    jitter: number
  }

  // Color dynamics
  color: {
    hueJitter: number
    saturationJitter: number
    brightnessJitter: number
    purityJitter: number
    foregroundBackground: number
    gradientMap?: HTMLCanvasElement
  }

  // Smudge/blend
  smudge: {
    enabled: boolean
    length: number
    strength: number
  }

  // Eraser mode
  eraser: {
    mode: 'normal' | 'eraser' | 'color-erase' | 'behind'
    opacity: number
  }

  // Symmetry
  symmetry: {
    type: 'none' | 'mirror-x' | 'mirror-y' | 'radial' | 'mandala' | 'tiling'
    centerX: number
    centerY: number
    segments: number
  }

  // Post-processing
  postProcess: {
    filter: 'none' | 'blur' | 'sharpen' | 'emboss' | 'edge-detect'
    strength: number
  }
}

export interface MyPaintBrushSettings {
  // MyPaint brush format compatibility
  radius: number
  hardness: number
  opacity: number
  speed: number
  e: number
  random: number

  // Advanced
  radius_log: number
  hardness_log: number
  opacity_log: number
  speed_log: number
  e_log: number
  random_log: number

  // Smudge
  smudge_length: number
  smudge_strength: number
  smudge_color: number

  // Eraser
  eraser: boolean

  // Color
  color_hue: number
  color_saturation: number
  color_value: number

  // Dab
  dab_shape: 'circle' | 'square' | 'diamond' | 'custom'
  dab_custom: HTMLCanvasElement | null

  // Symmetry
  symmetry_mode: 'none' | 'mirror_x' | 'mirror_y' | 'radial' | 'mandala' | 'tiling'
  symmetry_center_x: number
  symmetry_center_y: number
  symmetry_segments: number

  // Color dynamics
  color_hue_jitter: number
  color_saturation_jitter: number
  color_value_jitter: number
  color_purity_jitter: number
  color_fg_bg_jitter: number
}

export const DEFAULT_MYPAINT_SETTINGS: MyPaintBrushSettings = {
  radius: 10.0,
  hardness: 0.5,
  opacity: 1.0,
  speed: 1.0,
  e: 1.0,
  random: 0.0,
  radius_log: 1.0,
  hardness_log: 0.0,
  opacity_log: 0.0,
  speed_log: 0.0,
  e_log: 0.0,
  random_log: 0.0,
  smudge_length: 0.0,
  smudge_strength: 0.0,
  smudge_color: 0.0,
  eraser: false,
  color_hue: 0.0,
  color_saturation: 1.0,
  color_value: 1.0,
  dab_shape: 'circle',
  dab_custom: null,
  symmetry_mode: 'none',
  symmetry_center_x: 0.5,
  symmetry_center_y: 0.5,
  symmetry_segments: 6,
  color_hue_jitter: 0.0,
  color_saturation_jitter: 0.0,
  color_value_jitter: 0.0,
  color_purity_jitter: 0.0,
  color_fg_bg_jitter: 0.0,
}

/** Brush Stroke Engine */
export class BrushStrokeEngine {
  private dabs: BrushDab[] = []
  private settings: AdvancedBrushSettings
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private symmetryCanvas: HTMLCanvasElement | null = null

  constructor(canvas: HTMLCanvasElement, settings: Partial<AdvancedBrushSettings> = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.settings = this.getDefaultSettings()
    Object.assign(this.settings, settings)
  }

  private getDefaultSettings(): AdvancedBrushSettings {
    return {
      radius: 20,
      hardness: 0.5,
      opacity: 1.0,
      flow: 1.0,
      spacing: 0.15,
      angle: 0,
      roundness: 1.0,
      dabShape: 'circle',
      dynamics: {
        size: { pressure: 1, velocity: 0, direction: 0, tilt: 0, rotation: 0, random: 0, fade: 0, curve: [[0, 0], [1, 1]] },
        opacity: { pressure: 0.5, velocity: 0, direction: 0, tilt: 0, rotation: 0, random: 0.1, fade: 0, curve: [[0, 0], [1, 1]] },
        flow: { pressure: 1, velocity: 0, direction: 0, tilt: 0, rotation: 0, random: 0, fade: 0, curve: [[0, 0], [1, 1]] },
        hardness: { pressure: 0, velocity: 0, direction: 0, tilt: 0.5, rotation: 0, random: 0, fade: 0, curve: [[0, 0], [1, 1]] },
        angle: { pressure: 0, velocity: 0, direction: 1, tilt: 0.5, rotation: 0.5, random: 0, fade: 0, curve: [[0, 0], [1, 1]] },
        roundness: { pressure: 0, velocity: 0, direction: 0, tilt: 0.5, rotation: 0, random: 0, fade: 0, curve: [[0, 0], [1, 1]] },
        spacing: { pressure: 0, velocity: 1, direction: 0, tilt: 0, rotation: 0, random: 0.1, fade: 0, curve: [[0, 0], [1, 1]] },
        scatter: { pressure: 0, velocity: 0, direction: 0, tilt: 0, rotation: 0, random: 1, fade: 0, curve: [[0, 0], [1, 1]] },
        jitter: { pressure: 0, velocity: 0, direction: 0, tilt: 0, rotation: 0, random: 0.5, fade: 0, curve: [[0, 0], [1, 1]] },
      },
      texture: { enabled: false, canvas: null!, mode: 'multiply', scale: 1, depth: 0.5, jitter: 0 },
      color: { hueJitter: 0, saturationJitter: 0, brightnessJitter: 0, purityJitter: 0, foregroundBackground: 0 },
      smudge: { enabled: false, length: 0.5, strength: 0.5 },
      eraser: { mode: 'normal', opacity: 1 },
      symmetry: { type: 'none', centerX: 0.5, centerY: 0.5, segments: 6 },
      postProcess: { filter: 'none', strength: 0 },
    }
  }

  /** Start a new stroke */
  beginStroke(dab: BrushDab): void {
    this.dabs = [dab]
    this.renderDab(dab)
  }

  /** Continue stroke */
  continueStroke(dab: BrushDab): void {
    this.dabs.push(dab)
    this.renderDab(dab)
  }

  /** End stroke */
  endStroke(): void {
    this.dabs = []
  }

  /** Render a single dab */
  private renderDab(dab: BrushDab): void {
    const s = this.settings
    const ctx = this.ctx

    // Calculate dynamic properties
    const radius = this.computeDynamic('size', s.radius, dab)
    const opacity = this.computeDynamic('opacity', s.opacity, dab)
    const flow = this.computeDynamic('flow', s.flow, dab)
    const hardness = this.computeDynamic('hardness', s.hardness, dab)
    const angle = s.angle + this.computeDynamic('angle', s.angle, dab)
    const roundness = Math.max(0.01, s.roundness * (1 + this.computeDynamic('roundness', 0, dab)))

    // Apply color dynamics
    const color = this.computeColor(dab)

    // Apply scatter
    const scatter = this.computeDynamic('scatter', 0, dab)
    const offsetX = (Math.random() - 0.5) * scatter * radius * 2
    const offsetY = (Math.random() - 0.5) * scatter * radius * 2

    // Apply spacing
    const spacing = Math.max(0.01, s.spacing * (1 + this.computeDynamic('spacing', 0, dab)))

    // Draw with symmetry
    if (s.symmetry.type !== 'none') {
      this.drawWithSymmetry(dab, radius, opacity, flow, hardness, angle, roundness, color, offsetX, offsetY, spacing)
    } else {
      this.drawSingleDab(dab, radius, opacity, flow, hardness, angle, roundness, color, offsetX, offsetY)
    }
  }

  private computeDynamic(type: keyof PaintDynamics, base: number, dab: BrushDab): number {
    const dyn = this.settings.dynamics[type]
    let value = 0

    // Pressure
    if (dyn.pressure > 0) value += dyn.pressure * dab.pressure

    // Velocity
    if (dyn.velocity > 0 && this.dabs.length > 1) {
      const prev = this.dabs[this.dabs.length - 2]
      const dx = dab.x - prev.x
      const dy = dab.y - prev.y
      const dist = Math.hypot(dx, dy)
      const dt = dab.timestamp - prev.timestamp
      const velocity = dt > 0 ? dist / dt : 0
      value += dyn.velocity * Math.min(1, velocity / 100)
    }

    // Direction
    if (dyn.direction > 0 && this.dabs.length > 1) {
      const prev = this.dabs[this.dabs.length - 2]
      const dx = dab.x - prev.x
      const dy = dab.y - prev.y
      const dir = Math.atan2(dy, dx)
      value += dyn.direction * Math.sin(dir)
    }

    // Tilt
    if (dyn.tilt > 0) {
      const tilt = Math.hypot(dab.tiltX, dab.tiltY)
      value += dyn.tilt * Math.min(1, tilt / 0.5)
    }

    // Rotation
    if (dyn.rotation > 0) {
      value += dyn.rotation * (dab.rotation / (Math.PI * 2))
    }

    // Random
    if (dyn.random > 0) {
      value += dyn.random * (Math.random() - 0.5) * 2
    }

    // Fade
    if (dyn.fade > 0) {
      const t = this.dabs.length / 100
      value += dyn.fade * (1 - t)
    }

    // Apply curve
    if (dyn.curve && dyn.curve.length >= 4) {
      // Simple linear interpolation on curve
      const t = Math.min(1, Math.max(0, value))
      let curveValue = 0
      for (let i = 0; i < dyn.curve.length - 2; i += 2) {
        const x1 = dyn.curve[i], y1 = dyn.curve[i + 1]
        const x2 = dyn.curve[i + 2], y2 = dyn.curve[i + 3]
        if (value >= x1 && value <= x2) {
          const t = (value - x1) / (x2 - x1)
          curveValue = y1 + (y2 - y1) * t
          break
        }
      }
      value = curveValue
    }

    return base * (1 + value)
  }

  private computeColor(dab: BrushDab): string {
    const c = this.settings.color
    let h = 0, s = 1, v = 1

    if (c.foregroundBackground > 0) {
      // Mix between foreground and background - simplified
    }

    if (c.hueJitter > 0) h += (Math.random() - 0.5) * 2 * c.hueJitter * 360
    if (c.saturationJitter > 0) s += (Math.random() - 0.5) * 2 * c.saturationJitter
    if (c.brightnessJitter > 0) v += (Math.random() - 0.5) * 2 * c.brightnessJitter

    h = Math.max(0, Math.min(360, h))
    s = Math.max(0, Math.min(1, s))
    v = Math.max(0, Math.min(1, v))

    return hsvToHex(h, s, v)
  }

  private drawSingleDab(
    dab: BrushDab,
    radius: number,
    opacity: number,
    flow: number,
    hardness: number,
    angle: number,
    roundness: number,
    color: string,
    offsetX: number,
    offsetY: number
  ): void {
    const ctx = this.ctx
    const r = radius * Math.max(0.01, flow)

    ctx.save()
    ctx.translate(dab.x + offsetX, dab.y + offsetY)
    ctx.rotate(angle)
    ctx.scale(1, roundness)

    // Create brush gradient
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
    const alpha = opacity * Math.max(0.01, flow)
    if (hardness < 1) {
      grad.addColorStop(0, hexWithAlpha(color, alpha))
      grad.addColorStop(hardness, hexWithAlpha(color, alpha * hardness))
      grad.addColorStop(1, hexWithAlpha(color, 0))
    } else {
      grad.addColorStop(0, hexWithAlpha(color, alpha))
      grad.addColorStop(1, hexWithAlpha(color, 0))
    }

    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.ellipse(0, 0, r, r * Math.max(0.01, 1), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawWithSymmetry(
    dab: BrushDab,
    radius: number,
    opacity: number,
    flow: number,
    hardness: number,
    angle: number,
    roundness: number,
    color: string,
    offsetX: number,
    offsetY: number,
    spacing: number
  ): void {
    const s = this.settings.symmetry
    if (s.type === 'none') return

    const cx = this.canvas.width * s.centerX
    const cy = this.canvas.height * s.centerY

    const centers: Array<{ x: number; y: number; angle: number }> = []

    switch (s.type) {
      case 'mirror-x':
        centers.push({ x: dab.x, y: dab.y, angle: 0 })
        centers.push({ x: 2 * cx - dab.x, y: dab.y, angle: Math.PI })
        break
      case 'mirror-y':
        centers.push({ x: dab.x, y: dab.y, angle: 0 })
        centers.push({ x: dab.x, y: 2 * cy - dab.y, angle: 0 })
        break
      case 'radial':
        for (let i = 0; i < s.segments; i++) {
          const a = (i / s.segments) * Math.PI * 2
          const dx = dab.x - cx
          const dy = dab.y - cy
          const dist = Math.hypot(dx, dy)
          const a = Math.atan2(dy, dx) + a
          centers.push({ x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist, angle: a })
        }
        break
      case 'mandala':
        for (let i = 0; i < s.segments * 2; i++) {
          const a = (i / (s.segments * 2)) * Math.PI * 2
          const dx = dab.x - cx
          const dy = dab.y - cy
          const dist = Math.hypot(dx, dy)
          const a = Math.atan2(dy, dx) + (i % 2 === 0 ? a : -a)
          centers.push({ x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist, angle: a })
        }
        break
      case 'tiling':
        // Simplified tiling
        for (let tx = -1; tx <= 1; tx++) {
          for (let ty = -1; ty <= 1; ty++) {
            centers.push({ x: dab.x + tx * this.canvas.width, y: dab.y + ty * this.canvas.height, angle: 0 })
          }
        }
        break
    }

    for (const center of centers) {
      this.drawSingleDab(
        { ...dab, x: center.x, y: center.y },
        radius, opacity, flow, hardness, center.angle, roundness,
        color, 0, 0
      )
    }
  }

  updateSettings(settings: Partial<AdvancedBrushSettings>): void {
    Object.assign(this.settings, settings)
  }

  getSettings(): AdvancedBrushSettings {
    return { ...this.settings }
  }
}

function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function hsvToHex(h: number, s: number, v: number): string {
  const i = Math.floor(h / 60)
  const f = h / 60 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)

  let r, g, b
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    case 5: r = v; g = p; b = q; break
    default: r = 0; g = 0; b = 0
  }

  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** MyPaint Brush Loader */
export async function loadMyPaintBrush(json: string): Promise<MyPaintBrushSettings> {
  const data = JSON.parse(json)
  return { ...DEFAULT_MYPAINT_SETTINGS, ...data }
}

/** Export brush as MyPaint format */
export function exportMyPaintBrush(settings: MyPaintBrushSettings): string {
  return JSON.stringify(settings, null, 2)
}

/** Convert advanced settings to MyPaint format */
export function toMyPaintFormat(settings: AdvancedBrushSettings): MyPaintBrushSettings {
  return {
    radius: settings.radius,
    hardness: settings.hardness,
    opacity: settings.opacity,
    speed: 1.0 / Math.max(0.01, settings.spacing),
    e: 1.0,
    random: settings.dynamics.jitter.random,
    radius_log: Math.log(settings.radius),
    hardness_log: Math.log(Math.max(0.001, settings.hardness)),
    opacity_log: Math.log(settings.opacity),
    speed_log: 0,
    e_log: 0,
    random_log: Math.log(Math.max(0.001, settings.dynamics.jitter.random)),
    smudge_length: settings.smudge.length,
    smudge_strength: settings.smudge.strength,
    smudge_color: 0,
    eraser: settings.eraser.mode === 'eraser',
    color_hue: 0,
    color_saturation: 1,
    color_value: 1,
    dab_shape: settings.dabShape,
    dab_custom: settings.customDab || null,
    symmetry_mode: settings.symmetry.type.replace('-', '_') as any,
    symmetry_center_x: settings.symmetry.centerX,
    symmetry_center_y: settings.symmetry.centerY,
    symmetry_segments: settings.symmetry.segments,
    color_hue_jitter: settings.color.hueJitter,
    color_saturation_jitter: settings.color.saturationJitter,
    color_value_jitter: settings.color.brightnessJitter,
    color_purity_jitter: settings.color.purityJitter,
    color_fg_bg_jitter: settings.color.foregroundBackground,
  }
}