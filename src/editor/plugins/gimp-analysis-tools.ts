'use client'
// GIMP Analysis Tools
// Histogram, Colorcube, Sample Points, Border Average, Page Curl, etc.

import { createCanvas, ctx2d } from '../utils/canvas'

export interface HistogramData {
  red: number[]
  green: number[]
  blue: number[]
  alpha: number[]
  luminance: number[]
  rgb: number[] // combined
  stats: {
    mean: { r: number; g: number; b: number; l: number }
    stdDev: { r: number; g: number; b: number; l: number }
    median: { r: number; g: number; b: number; l: number }
    min: { r: number; g: number; b: number; l: number }
    max: { r: number; g: number; b: number; l: number }
    count: number
  }
}

export interface SamplePoint {
  id: string
  x: number
  y: number
  color: { r: number; g: number; b: number; a: number }
  hex: string
  position: 'absolute' | 'relative'
  label?: string
}

export interface ColorcubeData {
  voxels: number // number of occupied voxels
  colors: number // unique colors
  range: { r: [number, number]; g: [number, number]; b: [number, number] }
  density: Float32Array // 3D density grid
}

export interface BorderAverageResult {
  top: { r: number; g: number; b: number; hex: string }
  bottom: { r: number; g: number; b: number; hex: string }
  left: { r: number; g: number; b: number; hex: string }
  right: { r: number; g: number; b: number; hex: string }
  all: { r: number; g: number; b: number; hex: string }
}

/** Compute histogram for canvas */
export function computeHistogram(canvas: HTMLCanvasElement, channel: 'rgb' | 'red' | 'green' | 'blue' | 'alpha' | 'luminance' = 'rgb'): HistogramData {
  const ctx = ctx2d(canvas)
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data
  const count = width * height

  const hist = {
    red: new Array(256).fill(0),
    green: new Array(256).fill(0),
    blue: new Array(256).fill(0),
    alpha: new Array(256).fill(0),
    luminance: new Array(256).fill(0),
    rgb: new Array(256).fill(0),
    stats: {
      mean: { r: 0, g: 0, b: 0, l: 0 },
      stdDev: { r: 0, g: 0, b: 0, l: 0 },
      median: { r: 0, g: 0, b: 0, l: 0 },
      min: { r: 255, g: 255, b: 255, l: 255 },
      max: { r: 0, g: 0, b: 0, l: 0 },
      count,
    }
  }

  // First pass: build histograms and compute min/max/mean
  let rSum = 0, gSum = 0, bSum = 0, lSum = 0

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]
    const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b)

    hist.red[r]++
    hist.green[g]++
    hist.blue[b]++
    hist.alpha[a]++
    hist.luminance[l]++
    hist.rgb[Math.round((r + g + b) / 3)]++

    rSum += r
    gSum += g
    bSum += b
    lSum += l

    hist.stats.min.r = Math.min(hist.stats.min.r, r)
    hist.stats.min.g = Math.min(hist.stats.min.g, g)
    hist.stats.min.b = Math.min(hist.stats.min.b, b)
    hist.stats.min.l = Math.min(hist.stats.min.l, l)
    hist.stats.max.r = Math.max(hist.stats.max.r, r)
    hist.stats.max.g = Math.max(hist.stats.max.g, g)
    hist.stats.max.b = Math.max(hist.stats.max.b, b)
    hist.stats.max.l = Math.max(hist.stats.max.l, l)
  }

  hist.stats.mean.r = rSum / count
  hist.stats.mean.g = gSum / count
  hist.stats.mean.b = bSum / count
  hist.stats.mean.l = lSum / count

  // Second pass: stdDev
  let rVar = 0, gVar = 0, bVar = 0, lVar = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b)

    rVar += Math.pow(r - hist.stats.mean.r, 2)
    gVar += Math.pow(g - hist.stats.mean.g, 2)
    bVar += Math.pow(b - hist.stats.mean.b, 2)
    lVar += Math.pow(l - hist.stats.mean.l, 2)
  }

  hist.stats.stdDev.r = Math.sqrt(rVar / count)
  hist.stats.stdDev.g = Math.sqrt(gVar / count)
  hist.stats.stdDev.b = Math.sqrt(bVar / count)
  hist.stats.stdDev.l = Math.sqrt(lVar / count)

  // Compute median
  hist.stats.median.r = findMedian(hist.red, count)
  hist.stats.median.g = findMedian(hist.green, count)
  hist.stats.median.b = findMedian(hist.blue, count)
  hist.stats.median.l = findMedian(hist.luminance, count)

  return hist
}

function findMedian(hist: number[], totalCount: number): number {
  const target = totalCount / 2
  let cumulative = 0
  for (let i = 0; i < 256; i++) {
    cumulative += hist[i]
    if (cumulative >= target) return i
  }
  return 255
}

/** Render histogram as canvas */
export function renderHistogram(hist: HistogramData, width = 512, height = 256, channels: Array<'red' | 'green' | 'blue' | 'luminance' | 'rgb'> = ['red', 'green', 'blue', 'luminance']): HTMLCanvasElement {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  // Background
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(0, 0, width, height)

  // Grid
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 0.5
  for (let i = 0; i <= 10; i++) {
    const y = (i / 10) * height
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  for (let i = 0; i <= 16; i++) {
    const x = (i / 16) * width
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }

  // Channel colors
  const colors: Record<string, string> = {
    red: '#ff4444',
    green: '#44ff44',
    blue: '#4444ff',
    luminance: '#ffffff',
    rgb: '#ffff00',
  }

  // Find max value for scaling
  let maxVal = 0
  for (const ch of channels) {
    const h = hist[ch]
    for (let i = 0; i < 256; i++) {
      maxVal = Math.max(maxVal, h[i])
    }
  }

  // Draw each channel
  for (const ch of channels) {
    const h = hist[ch]
    const color = colors[ch] || '#ffffff'
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.globalAlpha = channels.length > 1 ? 0.7 : 1
    ctx.beginPath()
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * width
      const y = height - (h[i] / maxVal) * height * 0.9
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  ctx.globalAlpha = 1

  // Draw mean lines
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  for (const ch of channels) {
    const mean = hist.stats.mean[ch === 'luminance' ? 'l' : ch === 'rgb' ? 'r' : ch]
    const x = (mean / 255) * width
    ctx.strokeStyle = colors[ch]
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // Labels
  ctx.fillStyle = '#888'
  ctx.font = '10px monospace'
  ctx.fillText('0', 2, height - 2)
  ctx.fillText('255', width - 24, height - 2)
  ctx.fillText('0', width / 2 - 6, height - 2)

  return canvas
}

/** Sample points management */
export class SamplePointManager {
  private points: Map<string, SamplePoint> = new Map()
  private listeners: Set<() => void> = new Set()

  addPoint(x: number, y: number, canvas: HTMLCanvasElement, options: { label?: string; position?: 'absolute' | 'relative' } = {}): SamplePoint {
    const ctx = ctx2d(canvas)
    const { width, height } = canvas
    const img = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1)
    const [r, g, b, a] = img.data

    const id = 'sample-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
    const point: SamplePoint = {
      id,
      x: options.position === 'relative' ? x / width : x,
      y: options.position === 'relative' ? y / height : y,
      color: { r, g, b, a },
      hex: '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''),
      position: options.position ?? 'absolute',
      label: options.label,
    }

    this.points.set(id, point)
    this.notify()
    return point
  }

  removePoint(id: string): boolean {
    const result = this.points.delete(id)
    if (result) this.notify()
    return result
  }

  clear(): void {
    this.points.clear()
    this.notify()
  }

  getPoints(): SamplePoint[] {
    return Array.from(this.points.values())
  }

  getPoint(id: string): SamplePoint | undefined {
    return this.points.get(id)
  }

  updatePoint(id: string, canvas: HTMLCanvasElement): SamplePoint | undefined {
    const point = this.points.get(id)
    if (!point) return undefined

    const ctx = ctx2d(canvas)
    const { width, height } = canvas
    const px = point.position === 'relative' ? point.x * width : point.x
    const py = point.position === 'relative' ? point.y * height : point.y

    const img = ctx.getImageData(Math.floor(px), Math.floor(py), 1, 1)
    const [r, g, b, a] = img.data

    point.color = { r, g, b, a }
    point.hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    this.notify()
    return point
  }

  updateAll(canvas: HTMLCanvasElement): void {
    for (const id of this.points.keys()) {
      this.updatePoint(id, canvas)
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Compute colorcube (3D color histogram) */
export function computeColorcube(canvas: HTMLCanvasElement, resolution = 32): ColorcubeData {
  const ctx = ctx2d(canvas)
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data

  const voxelSize = 256 / resolution
  const density = new Float32Array(resolution * resolution * resolution)

  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0
  const colorSet = new Set<number>()

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    minR = Math.min(minR, r)
    maxR = Math.max(maxR, r)
    minG = Math.min(minG, g)
    maxG = Math.max(maxG, g)
    minB = Math.min(minB, b)
    maxB = Math.max(maxB, b)

    const ri = Math.min(resolution - 1, Math.floor(r / voxelSize))
    const gi = Math.min(resolution - 1, Math.floor(g / voxelSize))
    const bi = Math.min(resolution - 1, Math.floor(b / voxelSize))

    const idx = (ri * resolution + gi) * resolution + bi
    density[idx]++

    colorSet.add((r << 16) | (g << 8) | b)
  }

  // Normalize density
  const maxDensity = Math.max(...density)
  if (maxDensity > 0) {
    for (let i = 0; i < density.length; i++) {
      density[i] /= maxDensity
    }
  }

  return {
    voxels: density.filter(d => d > 0).length,
    colors: colorSet.size,
    range: { r: [minR, maxR], g: [minG, maxG], b: [minB, maxB] },
    density,
  }
}

/** Render colorcube as 2D projection */
export function renderColorcube(cube: ColorcubeData, width = 512, height = 512): HTMLCanvasElement {
  const canvas = createCanvas(width, height)
  const ctx = ctx2d(canvas)

  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, width, height)

  // Project 3D color cube to 2D (R-G plane, B as brightness)
  const resolution = Math.round(Math.cbrt(cube.density.length))
  const cellSize = width / resolution

  for (let r = 0; r < resolution; r++) {
    for (let g = 0; g < resolution; g++) {
      let maxB = 0
      let totalDensity = 0

      for (let b = 0; b < resolution; b++) {
        const idx = (r * resolution + g) * resolution + b
        const d = cube.density[idx]
        if (d > 0) {
          totalDensity += d
          maxB = Math.max(maxB, b)
        }
      }

      if (totalDensity > 0) {
        const intensity = Math.min(1, totalDensity * 2)
        const hue = maxB / resolution * 360
        ctx.fillStyle = `hsl(${hue}, 80%, ${30 + intensity * 50}%)`
        ctx.fillRect(r * cellSize, (resolution - 1 - g) * cellSize, cellSize, cellSize)
      }
    }
  }

  return canvas
}

/** Border average color */
export function computeBorderAverage(canvas: HTMLCanvasElement, borderWidth = 10): BorderAverageResult {
  const ctx = ctx2d(canvas)
  const { width, height } = canvas

  function averageRegion(x: number, y: number, w: number, h: number) {
    const img = ctx.getImageData(x, y, w, h)
    const data = img.data
    let r = 0, g = 0, b = 0, count = 0

    for (let i = 0; i < data.length; i += 4) {
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      count++
    }

    if (count === 0) return { r: 0, g: 0, b: 0, hex: '#000000' }

    r = Math.round(r / count)
    g = Math.round(g / count)
    b = Math.round(b / count)
    return { r, g, b, hex: '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('') }
  }

  const top = averageRegion(0, 0, width, borderWidth)
  const bottom = averageRegion(0, height - borderWidth, width, borderWidth)
  const left = averageRegion(0, 0, borderWidth, height)
  const right = averageRegion(width - borderWidth, 0, borderWidth, height)

  // All borders combined
  const allR = Math.round((top.r + bottom.r + left.r + right.r) / 4)
  const allG = Math.round((top.g + bottom.g + left.g + right.g) / 4)
  const allB = Math.round((top.b + bottom.b + left.b + right.b) / 4)

  return {
    top,
    bottom,
    left,
    right,
    all: { r: allR, g: allG, b: allB, hex: '#' + [allR, allG, allB].map(v => v.toString(16).padStart(2, '0')).join('') },
  }
}

/** Page curl effect */
export async function applyPageCurl(
  canvas: HTMLCanvasElement,
  options: {
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    curlSize: number // 0-100
    curlDirection: 'up' | 'down'
    shadowOpacity: number
    shadowBlur: number
  }
): Promise<HTMLCanvasElement> {
  const { corner, curlSize, curlDirection, shadowOpacity, shadowBlur } = options
  const { width, height } = canvas

  const output = createCanvas(width, height)
  const ctx = ctx2d(output)

  // Draw original
  ctx.drawImage(canvas, 0, 0)

  // Create curl overlay
  const curlCanvas = createCanvas(width, height)
  const curlCtx = ctx2d(curlCanvas)

  const size = Math.min(width, height) * (curlSize / 100)

  curlCtx.save()

  // Transform to target corner
  switch (corner) {
    case 'top-left':
      curlCtx.translate(0, 0)
      break
    case 'top-right':
      curlCtx.translate(width, 0)
      curlCtx.scale(-1, 1)
      break
    case 'bottom-left':
      curlCtx.translate(0, height)
      curlCtx.scale(1, -1)
      break
    case 'bottom-right':
      curlCtx.translate(width, height)
      curlCtx.scale(-1, -1)
      break
  }

  // Draw curl shape
  curlCtx.beginPath()
  curlCtx.moveTo(0, 0)
  curlCtx.lineTo(size, 0)
  curlCtx.quadraticCurveTo(size * 0.7, size * 0.3, size * 0.3, size * 0.7)
  curlCtx.lineTo(0, size)
  curlCtx.closePath()

  // Gradient for curl
  const gradient = curlCtx.createLinearGradient(0, 0, size, size)
  gradient.addColorStop(0, 'rgba(255,255,255,0.3)')
  gradient.addColorStop(0.5, 'rgba(200,200,200,0.4)')
  gradient.addColorStop(1, 'rgba(150,150,150,0.5)')
  curlCtx.fillStyle = gradient
  curlCtx.fill()

  // Shadow
  curlCtx.shadowColor = `rgba(0,0,0,${shadowOpacity})`
  curlCtx.shadowBlur = shadowBlur
  curlCtx.shadowOffsetX = curlDirection === 'up' ? -5 : 5
  curlCtx.shadowOffsetY = curlDirection === 'up' ? -5 : 5
  curlCtx.fill()

  curlCtx.restore()

  // Composite
  ctx.globalCompositeOperation = 'multiply'
  ctx.drawImage(curlCanvas, 0, 0)
  ctx.globalCompositeOperation = 'source-over'

  return output
}

/** Threshold analysis - find optimal threshold for binarization */
export function findOptimalThreshold(canvas: HTMLCanvasElement, method: 'otsu' | 'isodata' | 'mean' | 'min' | 'max' = 'otsu'): number {
  const hist = computeHistogram(canvas, 'luminance')
  const h = hist.luminance
  const total = hist.stats.count

  if (method === 'mean') {
    return Math.round(hist.stats.mean.l)
  }

  if (method === 'min') {
    return hist.stats.min.l
  }

  if (method === 'max') {
    return hist.stats.max.l
  }

  if (method === 'isodata') {
    // Iterative intermeans
    let threshold = Math.round(hist.stats.mean.l)
    let prevThreshold = -1

    while (threshold !== prevThreshold && Math.abs(threshold - prevThreshold) > 1) {
      prevThreshold = threshold

      let sum1 = 0, count1 = 0, sum2 = 0, count2 = 0
      for (let i = 0; i <= threshold; i++) {
        sum1 += i * h[i]
        count1 += h[i]
      }
      for (let i = threshold + 1; i < 256; i++) {
        sum2 += i * h[i]
        count2 += h[i]
      }

      const mean1 = count1 > 0 ? sum1 / count1 : 0
      const mean2 = count2 > 0 ? sum2 / count2 : 255
      threshold = Math.round((mean1 + mean2) / 2)
    }

    return threshold
  }

  // Otsu's method
  let maxVariance = -1
  let optimalThreshold = 0

  for (let t = 0; t < 256; t++) {
    let w0 = 0, w1 = 0
    let sum0 = 0, sum1 = 0

    for (let i = 0; i <= t; i++) {
      w0 += h[i]
      sum0 += i * h[i]
    }
    for (let i = t + 1; i < 256; i++) {
      w1 += h[i]
      sum1 += i * h[i]
    }

    if (w0 === 0 || w1 === 0) continue

    const mean0 = sum0 / w0
    const mean1 = sum1 / w1
    const variance = w0 * w1 * Math.pow(mean0 - mean1, 2)

    if (variance > maxVariance) {
      maxVariance = variance
      optimalThreshold = t
    }
  }

  return optimalThreshold
}

/** Apply threshold to canvas */
export function applyThreshold(canvas: HTMLCanvasElement, threshold: number, foreground = '#ffffff', background = '#000000'): HTMLCanvasElement {
  const ctx = ctx2d(canvas)
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data

  const fg = hexToRgb(foreground)
  const bg = hexToRgb(background)

  for (let i = 0; i < data.length; i += 4) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    if (l >= threshold) {
      data[i] = fg.r
      data[i + 1] = fg.g
      data[i + 2] = fg.b
    } else {
      data[i] = bg.r
      data[i + 1] = bg.g
      data[i + 2] = bg.b
    }
    data[i + 3] = 255
  }

  const output = createCanvas(width, height)
  ctx2d(output).putImageData(img, 0, 0)
  return output
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

/** Exposure analysis - find over/under exposed regions */
export function analyzeExposure(canvas: HTMLCanvasElement, highlightThreshold = 240, shadowThreshold = 15): { overexposed: number; underexposed: number; total: number } {
  const ctx = ctx2d(canvas)
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data

  let overexposed = 0
  let underexposed = 0
  let total = width * height

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    if (r >= highlightThreshold && g >= highlightThreshold && b >= highlightThreshold) {
      overexposed++
    }
    if (r <= shadowThreshold && g <= shadowThreshold && b <= shadowThreshold) {
      underexposed++
    }
  }

  return { overexposed, underexposed, total }
}

/** Focus analysis - estimate sharpness */
export function analyzeSharpness(canvas: HTMLCanvasElement): { score: number; laplacianVar: number } {
  const ctx = ctx2d(canvas)
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height)
  const data = img.data

  // Convert to grayscale
  const gray = new Float32Array(width * height)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }

  // Laplacian variance (focus measure)
  let laplacianSum = 0
  let laplacianSqSum = 0
  let count = 0

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      const laplacian = gray[idx - width] + gray[idx + width] + gray[idx - 1] + gray[idx + 1] - 4 * gray[idx]
      laplacianSum += laplacian
      laplacianSqSum += laplacian * laplacian
      count++
    }
  }

  const mean = laplacianSum / count
  const variance = laplacianSqSum / count - mean * mean

  return { score: Math.min(100, variance / 1000), laplacianVar: variance }
}