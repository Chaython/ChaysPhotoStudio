'use client'
// GIMP Color Picker Enhancement
// Advanced color picker with sampling ring, color history, palette generation, and color analysis

import { createCanvas, ctx2d } from '../utils/canvas'

export interface ColorSample {
  id: string
  color: string
  rgb: { r: number; g: number; b: number }
  hsl: { h: number; s: number; l: number }
  hsv: { h: number; s: number; v: number }
  lab: { l: number; a: number; b: number }
  cmyk: { c: number; m: number; y: number; k: number }
  xyz: { x: number; y: number; z: number }
  position: { x: number; y: number }
  timestamp: number
  label?: string
  locked: boolean
}

export interface ColorPickerOptions {
  /** Sample size */
  sampleSize: 'point' | '3x3' | '5x5' | '11x11' | '25x25' | '51x51'
  /** Show color info panel */
  showInfo: boolean
  /** Show color history */
  showHistory: boolean
  /** Max history size */
  maxHistory: number
  /** Auto-add to history */
  autoAddHistory: boolean
  /** Show color values */
  showValues: boolean
  /** Value format */
  valueFormat: 'hex' | 'rgb' | 'hsl' | 'hsv' | 'lab' | 'cmyk' | 'xyz'
  /** Show color wheel */
  showWheel: boolean
  /** Show sliders */
  showSliders: boolean
  /** Show palette */
  showPalette: boolean
  /** Show harmonies */
  showHarmonies: boolean
  /** Color space */
  colorSpace: 'srgb' | 'adobe-rgb' | 'prophoto' | 'display-p3' | 'rec2020'
  /** Sample size in pixels */
  sampleRadius: number
  /** Average samples */
  averageSamples: boolean
  /** Show color values in multiple formats */
  showAllFormats: boolean
  /** Copy format */
  copyFormat: 'hex' | 'rgb' | 'hsl' | 'css' | 'all'
}

export interface ColorPickerState {
  currentColor: string
  history: ColorSample[]
  samples: ColorSample[]
  options: ColorPickerOptions
  activeFormat: string
  colorSpace: string
  eyedropperActive: boolean
  sampleRadius: number
}

/** Color Picker Manager */
export class ColorPickerManager {
  private state: ColorPickerState
  private listeners: Set<() => void> = new Set()
  private canvasSize: { width: number; height: number } = { width: 0, height: 0 }
  private sourceCanvas: HTMLCanvasElement | null = null

  constructor() {
    this.state = {
      currentColor: '#000000',
      history: [],
      samples: [],
      options: {
        sampleSize: '3x3',
        showInfo: true,
        showHistory: true,
        maxHistory: 50,
        autoAddHistory: true,
        showValues: true,
        valueFormat: 'hex',
        showWheel: true,
        showSliders: true,
        showPalette: true,
        showHarmonies: true,
        colorSpace: 'srgb',
        sampleRadius: 1,
        averageSamples: true,
        showAllFormats: true,
        copyFormat: 'hex',
      },
      activeFormat: 'hex',
      colorSpace: 'srgb',
      eyedropperActive: false,
      sampleRadius: 1,
    }
  }

  setCanvasSize(width: number, height: number): void {
    this.state.canvasSize = { width, height }
  }

  setSourceCanvas(canvas: HTMLCanvasElement): void {
    this.sourceCanvas = canvas
  }

  getState(): ColorPickerState {
    return { ...this.state }
  }

  /** Sample color at position */
  sampleColor(x: number, y: number): ColorSample | null {
    if (!this.sourceCanvas) return null

    const ctx = this.sourceCanvas.getContext('2d')!
    const { width, height } = this.sourceCanvas

    // Clamp coordinates
    x = Math.max(0, Math.min(width - 1, Math.floor(x)))
    y = Math.max(0, Math.min(height - 1, Math.floor(y)))

    const radius = this.state.sampleRadius
    let r = 0, g = 0, b = 0, a = 255
    let count = 0

    // Sample area
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const px = Math.max(0, Math.min(this.canvasSize.width - 1, x + dx))
        const py = Math.max(0, Math.min(this.canvasSize.height - 1, y + dy))
        const idx = (py * this.canvasSize.width + px) * 4
        const imgData = this.sourceCanvas?.getContext('2d')!.getImageData(px, py, 1, 1)
        if (imgData) {
          const data = imgData.data
          r += data[0]
          g += data[1]
          b += data[2]
          a += data[3]
          count++
        }
      }
    }

    if (count === 0) return null

    r = Math.round(r / count)
    g = Math.round(g / count)
    b = Math.round(b / count)
    a = Math.round(a / count)

    return this.createColorSample(r, g, b, a, x, y)
  }

  private createColorSample(r: number, g: number, b: number, a: number, x: number, y: number): ColorSample {
    const rgb = { r, g, b }
    const hsl = rgbToHsl(r, g, b)
    const hsv = rgbToHsv(r, g, b)
    const lab = rgbToLab(r, g, b)
    const cmyk = rgbToCmyk(r, g, b)
    const xyz = rgbToXyz(r, g, b)

    const hex = rgbToHex(r, g, b)

    return {
      id: 'sample-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
      color: hex,
      rgb,
      hsl,
      hsv,
      lab,
      cmyk,
      xyz,
      position: { x: 0, y: 0 }, // Would be set by caller
      timestamp: Date.now(),
      locked: false,
    }
  }

  /** Sample color at position and add to history */
  pickColor(x: number, y: number): ColorSample | null {
    const sample = this.sampleColor(x, y)
    if (!sample) return null

    sample.position = { x, y }

    // Add to history
    if (this.state.options.autoAddHistory) {
      this.addToHistory(sample)
    }

    // Update current color
    this.state.currentColor = sample.color

    this.notify()
    return sample
  }

  /** Add color to history */
  addToHistory(sample: ColorSample): void {
    this.state.history.unshift(sample)
    if (this.state.history.length > this.state.options.maxHistory) {
      this.state.history.pop()
    }
    this.notify()
  }

  /** Remove from history */
  removeFromHistory(id: string): boolean {
    const index = this.state.history.findIndex(s => s.id === id)
    if (index >= 0) {
      this.state.history.splice(index, 1)
      this.notify()
      return true
    }
    return false
  }

  /** Clear history */
  clearHistory(): void {
    this.state.history = []
    this.notify()
  }

  /** Add to saved samples */
  addSample(sample: ColorSample): void {
    this.state.samples.push(sample)
    this.notify()
  }

  /** Remove sample */
  removeSample(id: string): boolean {
    const index = this.state.samples.findIndex(s => s.id === id)
    if (index >= 0) {
      this.state.samples.splice(index, 1)
      this.notify()
      return true
    }
    return false
  }

  /** Clear samples */
  clearSamples(): void {
    this.state.samples = []
    this.notify()
  }

  /** Set current color */
  setCurrentColor(color: string): void {
    this.state.currentColor = color
    this.notify()
  }

  /** Get current color */
  getCurrentColor(): string {
    return this.state.currentColor
  }

  /** Get history */
  getHistory(): ColorSample[] {
    return [...this.state.history]
  }

  /** Get samples */
  getSamples(): ColorSample[] {
    return [...this.state.samples]
  }

  /** Set options */
  setOptions(options: Partial<ColorPickerOptions>): void {
    Object.assign(this.state.options, options)
    this.notify()
  }

  /** Get options */
  getOptions(): ColorPickerOptions {
    return { ...this.state.options }
  }

  /** Generate color harmonies */
  getHarmonies(baseColor: string): Record<string, string[]> {
    const rgb = hexToRgb(baseColor)
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
    const h = hsl.h

    return {
      complementary: [baseColor, hslToHex((h + 180) % 360, hsl.s, hsl.l)],
      triadic: [
        baseColor,
        hslToHex((h + 120) % 360, hsl.s, hsl.l),
        hslToHex((h + 240) % 360, hsl.s, hsl.l),
      ],
      tetradic: [
        baseColor,
        hslToHex((h + 90) % 360, hsl.s, hsl.l),
        hslToHex((h + 180) % 360, hsl.s, hsl.l),
        hslToHex((h + 270) % 360, hsl.s, hsl.l),
      ],
      analogous: [
        hslToHex((h + 30) % 360, hsl.s, hsl.l),
        baseColor,
        hslToHex((h + 330) % 360, hsl.s, hsl.l),
      ],
      monochromatic: [
        hslToHex(h, hsl.s, Math.max(0, hsl.l - 30)),
        hslToHex(h, hsl.s, Math.max(0, hsl.l - 15)),
        baseColor,
        hslToHex(h, hsl.s, Math.min(100, hsl.l + 15)),
        hslToHex(h, hsl.s, Math.min(100, hsl.l + 30)),
      ],
      splitComplementary: [
        baseColor,
        hslToHex((h + 150) % 360, hsl.s, hsl.l),
        hslToHex((h + 210) % 360, hsl.s, hsl.l),
      ],
    }
  }

  /** Generate color palette from image */
  async generatePaletteFromImage(
    canvas: HTMLCanvasElement,
    colorCount = 16
  ): Promise<string[]> {
    const ctx = canvas.getContext('2d')!
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imgData.data

    // Simple color quantization using k-means (simplified)
    const colorMap = new Map<string, number>()

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]

      if (a < 128) continue // Skip transparent

      // Quantize to reduce color space
      const qr = Math.round(r / 32) * 32
      const qg = Math.round(g / 32) * 32
      const qb = Math.round(b / 32) * 32
      const key = `${qr},${qg},${qb}`

      colorMap.set(key, (colorMap.get(key) || 0) + 1)
    }

    // Sort by frequency
    const sorted = Array.from(colorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, colorCount)

    return sorted.map(([color]) => {
      const [r, g, b] = color.split(',').map(Number)
      return rgbToHex(r, g, b)
    })
  }

  /** Export color palette */
  exportPalette(format: 'aco' | 'ase' | 'gpl' | 'json' | 'css'): string {
    const colors = this.state.samples.map(s => s.color)

    switch (format) {
      case 'json':
        return JSON.stringify(this.state.samples, null, 2)
      case 'css':
        return this.state.samples.map(s => `--color-${s.id}: ${s.color};`).join('\n')
      case 'aco':
        // Adobe Color Swatch format (simplified)
        return this.exportACO()
      case 'ase':
        // Adobe Swatch Exchange (simplified)
        return this.exportASE()
      case 'gpl':
        // GIMP Palette
        return this.exportGPL()
      default:
        return JSON.stringify(this.state.samples, null, 2)
    }
  }

  private exportACO(): string {
    // Simplified ACO export
    return 'ACO format export not fully implemented'
  }

  private exportASE(): string {
    // Simplified ASE export
    return 'ASE format export not fully implemented'
  }

  private exportGPL(): string {
    let gpl = 'GIMP Palette\nName: Chay\'s Palette\nColumns: 16\n#\n'
    for (const sample of this.state.samples) {
      const { r, g, b } = sample.rgb
      gpl += `${r} ${g} ${b} ${sample.color}\n`
    }
    return gpl
  }

  /** Get color info in all formats */
  getColorInfo(color: string): Record<string, string> {
    const rgb = hexToRgb(color)
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
    const lab = rgbToLab(rgb.r, rgb.g, rgb.b)
    const cmyk = rgbToCmyk(rgb.r, rgb.g, rgb.b)
    const xyz = rgbToXyz(rgb.r, rgb.g, rgb.b)

    return {
      hex: color,
      rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      hsl: `hsl(${Math.round(hsl.h)}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%)`,
      hsv: `hsv(${Math.round(hsv.h)}, ${Math.round(hsv.s)}%, ${Math.round(hsv.v)}%)`,
      lab: `lab(${lab.l.toFixed(1)}, ${lab.a.toFixed(1)}, ${lab.b.toFixed(1)})`,
      cmyk: `cmyk(${Math.round(cmyk.c)}%, ${Math.round(cmyk.m)}%, ${Math.round(cmyk.y)}%, ${Math.round(cmyk.k)}%)`,
      xyz: `xyz(${xyz.x.toFixed(2)}, ${xyz.y.toFixed(2)}, ${xyz.z.toFixed(2)})`,
    }
  }

  /** Get color contrast ratio */
  getContrastRatio(color1: string, color2: string): number {
    const l1 = this.getRelativeLuminance(color1)
    const l2 = this.getRelativeLuminance(color2)
    const lighter = Math.max(l1, l2)
    const darker = Math.min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)
  }

  private getRelativeLuminance(color: string): number {
    const rgb = hexToRgb(color)
    const rsrgb = rgb.r / 255
    const gsrgb = rgb.g / 255
    const bsrgb = rgb.b / 255

    const r = rsrgb <= 0.03928 ? rsrgb / 12.92 : Math.pow((rsrgb + 0.055) / 1.055, 2.4)
    const g = gsrgb <= 0.03928 ? gsrgb / 12.92 : Math.pow((gsrgb + 0.055) / 1.055, 2.4)
    const b = bsrgb <= 0.03928 ? bsrgb / 12.92 : Math.pow((bsrgb + 0.055) / 1.055, 2.4)

    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  /** Check WCAG contrast compliance */
  checkWCAGCompliance(color1: string, color2: string, level: 'AA' | 'AAA' = 'AA', size: 'normal' | 'large' = 'normal'): { pass: boolean; ratio: number; required: number } {
    const ratio = this.getContrastRatio(color1, color2)
    const required = level === 'AA' ? (size === 'large' ? 3 : 4.5) : (size === 'large' ? 4.5 : 7)
    return { pass: ratio >= required, ratio, required }
  }

  /** Find nearest named color */
  getNearestNamedColor(color: string): { name: string; hex: string; distance: number } {
    const namedColors: Record<string, string> = {
      'AliceBlue': '#F0F8FF', 'AntiqueWhite': '#FAEBD7', 'Aqua': '#00FFFF',
      'Aquamarine': '#7FFFD4', 'Azure': '#F0FFFF', 'Beige': '#F5F5DC',
      'Bisque': '#FFE4C4', 'Black': '#000000', 'BlanchedAlmond': '#FFEBCD',
      'Blue': '#0000FF', 'BlueViolet': '#8A2BE2', 'Brown': '#A52A2A',
      'BurlyWood': '#DEB887', 'CadetBlue': '#5F9EA0', 'Chartreuse': '#7FFF00',
      'Chocolate': '#D2691E', 'Coral': '#FF7F50', 'CornflowerBlue': '#6495ED',
      'Cornsilk': '#FFF8DC', 'Crimson': '#DC143C', 'Cyan': '#00FFFF',
      'DarkBlue': '#00008B', 'DarkCyan': '#008B8B', 'DarkGoldenRod': '#B8860B',
      'DarkGray': '#A9A9A9', 'DarkGreen': '#006400', 'DarkKhaki': '#BDB76B',
      'DarkMagenta': '#8B008B', 'DarkOliveGreen': '#556B2F', 'DarkOrange': '#FF8C00',
      'DarkOrchid': '#9932CC', 'DarkRed': '#8B0000', 'DarkSalmon': '#E9967A',
      'DarkSeaGreen': '#8FBC8F', 'DarkSlateBlue': '#483D8B', 'DarkSlateGray': '#2F4F4F',
      'DarkTurquoise': '#00CED1', 'DarkViolet': '#9400D3', 'DeepPink': '#FF1493',
      'DeepSkyBlue': '#00BFFF', 'DimGray': '#696969', 'DodgerBlue': '#1E90FF',
      'FireBrick': '#B22222', 'FloralWhite': '#FFFAF0', 'ForestGreen': '#228B22',
      'Fuchsia': '#FF00FF', 'Gainsboro': '#DCDCDC', 'GhostWhite': '#F8F8FF',
      'Gold': '#FFD700', 'GoldenRod': '#DAA520', 'Gray': '#808080',
      'Green': '#008000', 'GreenYellow': '#ADFF2F', 'HoneyDew': '#F0FFF0',
      'HotPink': '#FF69B4', 'IndianRed': '#CD5C5C', 'Indigo': '#4B0082',
      'Ivory': '#FFFFF0', 'Khaki': '#F0E68C', 'Lavender': '#E6E6FA',
      'LavenderBlush': '#FFF0F5', 'LawnGreen': '#7CFC00', 'LemonChiffon': '#FFFACD',
      'LightBlue': '#ADD8E6', 'LightCoral': '#F08080', 'LightCyan': '#E0FFFF',
      'LightGoldenRodYellow': '#FAFAD2', 'LightGray': '#D3D3D3', 'LightGreen': '#90EE90',
      'LightPink': '#FFB6C1', 'LightSalmon': '#FFA07A', 'LightSeaGreen': '#20B2AA',
      'LightSkyBlue': '#87CEFA', 'LightSlateGray': '#778899', 'LightSteelBlue': '#B0C4DE',
      'LightYellow': '#FFFFE0', 'Lime': '#00FF00', 'LimeGreen': '#32CD32',
      'Linen': '#FAF0E6', 'Magenta': '#FF00FF', 'Maroon': '#800000',
      'MediumAquamarine': '#66CDAA', 'MediumBlue': '#0000CD', 'MediumOrchid': '#BA55D3',
      'MediumPurple': '#9370DB', 'MediumSeaGreen': '#3CB371', 'MediumSlateBlue': '#7B68EE',
      'MediumSpringGreen': '#00FA9A', 'MediumTurquoise': '#48D1CC', 'MediumVioletRed': '#C71585',
      'MidnightBlue': '#191970', 'MintCream': '#F5FFFA', 'MistyRose': '#FFE4E1',
      'Moccasin': '#FFE4B5', 'NavajoWhite': '#FFDEAD', 'Navy': '#000080',
      'OldLace': '#FDF5E6', 'Olive': '#808000', 'OliveDrab': '#6B8E23',
      'Orange': '#FFA500', 'OrangeRed': '#FF4500', 'Orchid': '#DA70D6',
      'PaleGoldenRod': '#EEE8AA', 'PaleGreen': '#98FB98', 'PaleTurquoise': '#AFEEEE',
      'PaleVioletRed': '#DB7093', 'PapayaWhip': '#FFEFD5', 'PeachPuff': '#FFDAB9',
      'Peru': '#CD853F', 'Pink': '#FFC0CB', 'Plum': '#DDA0DD', 'PowderBlue': '#B0E0E6',
      'Purple': '#800080', 'RebeccaPurple': '#663399', 'Red': '#FF0000',
      'RosyBrown': '#BC8F8F', 'RoyalBlue': '#4169E1', 'SaddleBrown': '#8B4513',
      'Salmon': '#FA8072', 'SandyBrown': '#F4A460', 'SeaGreen': '#2E8B57',
      'SeaShell': '#FFF5EE', 'Sienna': '#A0522D', 'Silver': '#C0C0C0',
      'SkyBlue': '#87CEEB', 'SlateBlue': '#6A5ACD', 'SlateGray': '#708090',
      'Snow': '#FFFAFA', 'SpringGreen': '#00FF7F', 'SteelBlue': '#4682B4',
      'Tan': '#D2B48C', 'Teal': '#008080', 'Thistle': '#D8BFD8', 'Tomato': '#FF6347',
      'Turquoise': '#40E0D0', 'Violet': '#EE82EE', 'Wheat': '#F5DEB3',
      'White': '#FFFFFF', 'WhiteSmoke': '#F5F5F5', 'Yellow': '#FFFF00',
      'YellowGreen': '#9ACD32',
    }

    const rgb = hexToRgb(color)
    let minDist = Infinity
    let nearest = { name: '', hex: '', distance: Infinity }

    for (const [name, hex] of Object.entries(namedColors)) {
      const cRgb = hexToRgb(hex)
      const dist = Math.sqrt(
        Math.pow(rgb.r - cRgb.r, 2) +
        Math.pow(rgb.g - cRgb.g, 2) +
        Math.pow(rgb.b - cRgb.b, 2)
      )
      if (dist < minDist) {
        minDist = dist
        nearest = { name, hex, distance: dist }
      }
    }

    return nearest
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Color space conversions */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0, l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const v = max
  const d = max - min
  const s = max === 0 ? 0 : d / max
  let h = 0
  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }
  return { h: h * 360, s: s * 100, v: v * 100 }
}

function rgbToLab(r: number, g: number, b: number): { l: number; a: number; b: number } {
  // Simplified sRGB to Lab conversion
  const [x, y, z] = rgbToXyz(r, g, b)
  const xr = x / 95.047, yr = y / 100, zr = z / 108.883
  const fx = xr > 0.008856 ? Math.cbrt(xr) : 7.787 * xr + 16 / 116
  const fy = yr > 0.008856 ? Math.cbrt(yr) : 7.787 * yr + 16 / 116
  const fz = zr > 0.008856 ? Math.cbrt(zr) : 7.787 * zr + 16 / 116
  return {
    l: Math.max(0, 116 * fy - 16),
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

function rgbToCmyk(r: number, g: number, b: number): { c: number; m: number; y: number; k: number } {
  r /= 255; g /= 255; b /= 255
  const k = 1 - Math.max(r, g, b)
  if (k === 1) return { c: 0, m: 0, y: 0, k: 1 }
  return {
    c: Math.round((1 - r - k) / (1 - k) * 100),
    m: Math.round((1 - g - k) / (1 - k) * 100),
    y: Math.round((1 - b - k) / (1 - k) * 100),
    k: Math.round(k * 100),
  }
}

function rgbToXyz(r: number, g: number, b: number): { x: number; y: number; z: number } {
  r /= 255; g /= 255; b /= 255
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92
  return {
    x: (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100,
    y: (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100,
    z: (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100,
  }
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = 0; g = 0; b = c }
  else { r = c; g = 0; b = x }
  r = Math.round((r + m) * 255)
  g = Math.round((g + m) * 255)
  b = Math.round((b + m) * 255)
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

/** Color Picker UI Component */
export function createColorPickerUI(
  picker: ColorPickerManager,
  onColorChange: (color: string) => void
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'color-picker-ui'
  container.innerHTML = `
    <div class="color-picker-panel">
      <div class="color-preview-large" id="color-preview-large" style="width:100%;height:80px;border:1px solid #ccc;border-radius:4px;"></div>
      
      <div class="color-formats" id="color-formats"></div>
      
      <div class="color-wheel-container" id="color-wheel-container">
        <canvas id="color-wheel" width="256" height="256"></canvas>
        <canvas id="hue-slider" width="256" height="20"></canvas>
        <canvas id="alpha-slider" width="256" height="20"></canvas>
      </div>
      
      <div class="color-sliders" id="color-sliders">
        <div class="slider-row">
          <label>R: <input type="range" id="slider-r" min="0" max="255" value="0"></label>
          <input type="number" id="input-r" min="0" max="255" value="0" style="width:50px">
        </div>
        <div class="slider-row">
          <label>G: <input type="range" id="slider-g" min="0" max="255" value="0"></label>
          <input type="number" id="input-g" min="0" max="255" value="0" style="width:50px">
        </div>
        <div class="slider-row">
          <label>B: <input type="range" id="slider-b" min="0" max="255" value="0"></label>
          <input type="number" id="input-b" min="0" max="255" value="0" style="width:50px">
        </div>
        <div class="slider-row">
          <label>A: <input type="range" id="slider-a" min="0" max="255" value="255"></label>
          <input type="number" id="input-a" min="0" max="255" value="255" style="width:50px">
        </div>
      </div>
      
      <div class="color-harmonies" id="color-harmonies"></div>
      
      <div class="color-palette" id="color-palette"></div>
      
      <div class="color-history" id="color-history">
        <h4>History</h4>
        <div class="history-swatches" id="history-swatches"></div>
        <button id="clear-history">Clear History</button>
      </div>
      
      <div class="saved-samples" id="saved-samples">
        <h4>Saved Samples</h4>
        <div class="sample-swatches" id="sample-swatches"></div>
        <div class="sample-actions">
          <button id="add-sample" class="primary">Add Current</button>
          <button id="clear-samples" class="danger">Clear All</button>
          <button id="export-palette" class="secondary">Export</button>
        </div>
      </div>
      
      <div class="color-analysis" id="color-analysis">
        <h4>Color Analysis</h4>
        <div class="analysis-grid" id="analysis-grid"></div>
        <div class="contrast-check">
          <h4>Contrast Check</h4>
          <div class="control-row">
            <label>Against: <input type="color" id="contrast-color" value="#ffffff"></label>
          </div>
          <div class="contrast-result" id="contrast-result"></div>
        </div>
        <div class="nearest-color">
          <h4>Nearest Named Color</h4>
          <div id="nearest-color-info"></div>
        </div>
      </div>
    </div>
  `

  // Initialize color wheel
  const wheelCanvas = container.querySelector('#color-wheel') as HTMLCanvasElement
  const hueCanvas = container.querySelector('#hue-slider') as HTMLCanvasElement
  const alphaCanvas = container.querySelector('#alpha-slider') as HTMLCanvasElement
  const preview = container.querySelector('#color-preview-large') as HTMLDivElement
  const formatsDiv = container.querySelector('#color-formats') as HTMLDivElement
  const sliders = container.querySelector('#color-sliders') as HTMLDivElement
  const harmoniesDiv = container.querySelector('#color-harmonies') as HTMLDivElement
  const paletteDiv = container.querySelector('#color-palette') as HTMLDivElement
  const historySwatches = container.querySelector('#history-swatches') as HTMLDivElement
  const sampleSwatches = container.querySelector('#sample-swatches') as HTMLDivElement
  const analysisGrid = container.querySelector('#analysis-grid') as HTMLDivElement
  const contrastResult = container.querySelector('#contrast-result') as HTMLDivElement
  const nearestColorInfo = container.querySelector('#nearest-color-info') as HTMLDivElement
  const analysisGrid = container.querySelector('#analysis-grid') as HTMLDivElement

  let currentHue = 0
  let currentSaturation = 100
  let currentLightness = 50
  let currentAlpha = 1

  // Draw color wheel
  function drawColorWheel(): void {
    const ctx = wheelCanvas.getContext('2d')!
    const { width, height } = wheelCanvas
    const centerX = width / 2
    const centerY = height / 2
    const radius = Math.min(width, height) / 2 - 2

    // Draw saturation/lightness square
    const imageData = ctx.createImageData(width, height)
    const data = imageData.data

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX
        const dy = y - centerY
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist > radius) {
          data[(y * width + x) * 4 + 3] = 0
          continue
        }

        const angle = Math.atan2(dy, dx)
        const saturation = Math.min(1, dist / radius)
        const lightness = 0.5

        const h = (angle + Math.PI) / (2 * Math.PI) * 360
        const s = saturation
        const l = lightness

        const rgb = hslToRgb(h / 360, saturation, lightness)
        const idx = (y * width + x) * 4
        data[idx] = Math.round(rgb.r * 255)
        data[idx + 1] = Math.round(rgb.g * 255)
        data[idx + 2] = Math.round(rgb.b * 255)
        data[idx + 3] = 255
      }
    }

    ctx.putImageData(imageData, 0, 0)

    // Draw hue indicator
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke()
  }

  function drawHueSlider(): void {
    const ctx = hueCanvas.getContext('2d')!
    const gradient = ctx.createLinearGradient(0, 0, hueCanvas.width, 0)
    for (let i = 0; i <= 360; i++) {
      const hsl = hslToRgb(i / 360, 1, 0.5)
      gradient.addColorStop(i / 360, `rgb(${hsl.r},${hsl.g},${hsl.b})`)
    }
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, hueCanvas.width, hueCanvas.height)
  }

  function drawAlphaSlider(): void {
    const ctx = alphaCanvas.getContext('2d')!
    const gradient = ctx.createLinearGradient(0, 0, alphaCanvas.width, 0)
    gradient.addColorStop(0, 'transparent')
    gradient.addColorStop(1, 'white')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, alphaCanvas.width, alphaCanvas.height)
  }

  function updateUI(): void {
    // Update preview
    preview.style.background = currentColor
    preview.style.border = '1px solid #ccc'

    // Update formats
    const info = picker.getColorInfo(currentColor)
    formatsDiv.innerHTML = Object.entries(info).map(([key, value]) =>
      `<div class="format-row"><span class="format-label">${key.toUpperCase()}</span><span class="format-value" title="Click to copy">${value}</span></div>`
    ).join('')

    // Update sliders
    const rgb = hexToRgb(currentColor)
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
    currentHue = hsl.h
    currentSaturation = hsl.s
    currentLightness = hsl.l

    ;(container.querySelector('#slider-r') as HTMLInputElement).value = String(rgb.r)
    ;(container.querySelector('#slider-g') as HTMLInputElement).value = String(rgb.g)
    ;(container.querySelector('#slider-b') as HTMLInputElement).value = String(rgb.b)
    ;(container.querySelector('#slider-a') as HTMLInputElement).value = String(Math.round(currentAlpha * 255))
    ;(container.querySelector('#input-r') as HTMLInputElement).value = String(rgb.r)
    ;(container.querySelector('#input-g') as HTMLInputElement).value = String(rgb.g)
    ;(container.querySelector('#input-b') as HTMLInputElement).value = String(rgb.b)
    ;(container.querySelector('#input-a') as HTMLInputElement).value = String(Math.round(currentAlpha * 255))

    // Update harmonies
    updateHarmonies()

    // Update palette
    updatePalette()

    // Update history
    updateHistory()

    // Update samples
    updateSamples()

    // Update analysis
    updateAnalysis()
  }

  function updateHarmonies(): void {
    const harmonies = picker.getHarmonies(currentColor)
    harmoniesDiv.innerHTML = Object.entries(harmonies).map(([name, colors]) => `
      <div class="harmony-group">
        <h5>${name.charAt(0).toUpperCase() + name.slice(1)}</h5>
        <div class="harmony-colors">
          ${colors.map(c => `<div class="harmony-color" style="background:${c}" title="${c}"></div>`).join('')}
        </div>
      </div>
    `).join('')
  }

  function updatePalette(): void {
    const samples = picker.getSamples()
    paletteDiv.innerHTML = samples.map(s => `
      <div class="palette-swatch" style="background:${s.color}" title="${s.color}" data-id="${s.id}">
        <span class="remove-btn">×</span>
      </div>
    `).join('')
  }

  function updateHistory(): void {
    const history = picker.getHistory()
    historySwatches.innerHTML = history.slice(0, 20).map(c => `
      <div class="history-swatch" style="background:${c.color}" title="${c.color}" data-id="${c.id}"></div>
    `).join('')
  }

  function updateSamples(): void {
    const samples = picker.getSamples()
    sampleSwatches.innerHTML = samples.map(s => `
      <div class="sample-swatch" style="background:${s.color}" title="${s.color}" data-id="${s.id}">
        <span class="remove-btn">×</span>
      </div>
    `).join('')
  }

  function updateAnalysis(): void {
    const info = picker.getColorInfo(currentColor)
    analysisGrid.innerHTML = Object.entries(info).map(([key, value]) =>
      `<div class="analysis-item"><span class="analysis-label">${key}</span><span class="analysis-value">${value}</span></div>`
    ).join('')

    // Contrast check
    const contrastColor = (document.getElementById('contrast-color') as HTMLInputElement).value
    const ratio = picker.getContrastRatio(currentColor, contrastColor)
    const aaNormal = picker.checkWCAGCompliance(currentColor, contrastColor, 'AA', 'normal')
    const aaLarge = picker.checkWCAGCompliance(currentColor, contrastColor, 'AA', 'large')
    const aaaNormal = picker.checkWCAGCompliance(currentColor, contrastColor, 'AAA', 'normal')
    const aaaLarge = picker.checkWCAGCompliance(currentColor, contrastColor, 'AAA', 'large')

    contrastResult.innerHTML = `
      <div class="contrast-ratio">Ratio: ${ratio.toFixed(2)}:1</div>
      <div class="wcag-results">
        <div class="wcag-item ${aaNormal.pass ? 'pass' : 'fail'}">AA Normal: ${aaNormal.pass ? '✓' : '✗'} (${aaNormal.required}:1)</div>
        <div class="wcag-item ${aaLarge.pass ? 'pass' : 'fail'}">AA Large: ${aaLarge.pass ? '✓' : '✗'} (${aaLarge.required}:1)</div>
        <div class="wcag-item ${aaaNormal.pass ? 'pass' : 'fail'}">AAA Normal: ${aaaNormal.pass ? '✓' : '✗'} (${aaaNormal.required}:1)</div>
        <div class="wcag-item ${aaaLarge.pass ? 'pass' : 'fail'}">AAA Large: ${aaaLarge.pass ? '✓' : '✗'} (${aaaLarge.required}:1)</div>
      </div>
    `

    // Nearest named color
    const nearest = picker.getNearestNamedColor(currentColor)
    nearestColorInfo.innerHTML = `
      <div class="nearest-color-swatch" style="background:${nearest.hex}"></div>
      <div class="nearest-color-info">
        <span class="nearest-name">${nearest.name}</span>
        <span class="nearest-hex">${nearest.hex}</span>
        <span class="nearest-distance">Distance: ${nearest.distance.toFixed(2)}</span>
      </div>
    `

    // Color analysis grid
    const info = picker.getColorInfo(currentColor)
    analysisGrid.innerHTML = Object.entries(info).map(([key, value]) =>
      `<div class="analysis-item"><span class="analysis-label">${key}</span><span class="analysis-value" title="Click to copy">${value}</span></div>`
    ).join('')
  }

  // Initialize
  drawColorWheel()
  drawHueSlider()
  drawAlphaSlider()
  updateUI()

  // Event listeners
  wheelCanvas.addEventListener('mousedown', (e) => {
    const rect = wheelCanvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    pickFromWheel(x, y)
  })

  hueCanvas.addEventListener('mousedown', (e) => {
    const rect = hueCanvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    currentHue = (x / hueCanvas.width) * 360
    drawHueSlider()
    updateColorFromHSL()
  })

  alphaCanvas.addEventListener('mousedown', (e) => {
    const rect = alphaCanvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    currentAlpha = x / alphaCanvas.width
    drawAlphaSlider()
    updateColorFromHSL()
  })

  function pickFromWheel(x: number, y: number): void {
    const rect = wheelCanvas.getBoundingClientRect()
    const cx = x - rect.left
    const cy = y - rect.top
    const centerX = wheelCanvas.width / 2
    const centerY = wheelCanvas.height / 2
    const dx = cx - centerX
    const dy = cy - centerY
    const dist = Math.sqrt(dx * dx + dy * dy)
    const radius = Math.min(wheelCanvas.width, wheelCanvas.height) / 2 - 2

    if (dist > radius) return

    const angle = Math.atan2(dy, dx)
    const saturation = Math.min(1, dist / radius)

    currentHue = (angle + Math.PI) / (2 * Math.PI) * 360
    currentSaturation = saturation * 100

    updateColorFromHSL()
  }

  function updateColorFromHSL(): void {
    const hsl = hslToHex(currentHue / 360, currentSaturation / 100, currentLightness / 100)
    const rgb = hexToRgb(hsl)
    currentColor = hsl
    currentAlpha = 1 // Simplified
    updateUI()
    onColorChange(currentColor)
  }

  // Slider events
  ;['r', 'g', 'b', 'a'].forEach(channel => {
    const slider = container.querySelector(`#slider-${channel}`) as HTMLInputElement
    const input = container.querySelector(`#input-${channel}`) as HTMLInputElement

    slider.addEventListener('input', () => {
      input.value = slider.value
      updateFromSliders()
    })
    input.addEventListener('input', () => {
      slider.value = input.value
      updateFromSliders()
    })
  })

  function updateFromSliders(): void {
    const r = parseInt((container.querySelector('#slider-r') as HTMLInputElement).value)
    const g = parseInt((container.querySelector('#slider-g') as HTMLInputElement).value)
    const b = parseInt((container.querySelector('#slider-b') as HTMLInputElement).value)
    const a = parseInt((container.querySelector('#slider-a') as HTMLInputElement).value) / 255

    currentColor = rgbToHex(r, g, b)
    currentAlpha = a / 255
    updateUI()
    onColorChange(currentColor)
  }

  // Harmony click
  harmoniesDiv.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.classList.contains('harmony-color')) {
      const color = target.style.backgroundColor
      // Convert rgb() to hex
      const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
      if (match) {
        currentColor = rgbToHex(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]))
        updateUI()
        onColorChange(currentColor)
      }
    }
  })

  // Palette click
  paletteDiv.addEventListener('click', (e) => {
    const swatch = e.target.closest('.palette-swatch')
    if (swatch) {
      const color = swatch.style.backgroundColor
      const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
      if (match) {
        currentColor = rgbToHex(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]))
        updateUI()
        onColorChange(currentColor)
      }
    }
  })

  // History click
  historySwatches.addEventListener('click', (e) => {
    const swatch = e.target.closest('.history-swatch')
    if (swatch) {
      currentColor = swatch.dataset.id // Actually the color is in the style
      const match = swatch.style.backgroundColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
      if (match) {
        currentColor = rgbToHex(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]))
        updateUI()
        onColorChange(currentColor)
      }
    }
  })

  // Sample click
  sampleSwatches.addEventListener('click', (e) => {
    const swatch = e.target.closest('.sample-swatch')
    if (swatch) {
      const color = swatch.style.backgroundColor
      const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
      if (match) {
        currentColor = rgbToHex(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]))
        updateUI()
        onColorChange(currentColor)
      }
    }
  })

  // Clear history
  container.querySelector('#clear-history')?.addEventListener('click', () => {
    picker.clearHistory()
    updateUI()
  })

  // Add sample
  container.querySelector('#add-sample')?.addEventListener('click', () => {
    picker.addSample(picker.getHistory()[0] || { color: currentColor, id: '', rgb: hexToRgb(currentColor), hsl: { h: 0, s: 0, l: 0 }, hsv: { h: 0, s: 0, v: 0 }, lab: { l: 0, a: 0, b: 0 }, cmyk: { c: 0, m: 0, y: 0, k: 0 }, xyz: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0 }, timestamp: Date.now(), locked: false })
    updateUI()
  })

  // Clear samples
  container.querySelector('#clear-samples')?.addEventListener('click', () => {
    picker.clearSamples()
    updateUI()
  })

  // Export palette
  container.querySelector('#export-palette')?.addEventListener('click', () => {
    const format = prompt('Export format (aco, ase, gpl, json, css):', 'json')
    if (format) {
      const data = picker.exportPalette(format as any)
      const blob = new Blob([data], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `palette.${format}`
      a.click()
      URL.revokeObjectURL(url)
    }
  })

  // Clear history
  container.querySelector('#clear-history')?.addEventListener('click', () => {
    if (confirm('Clear all history?')) {
      picker.clearHistory()
      updateUI()
    }
  })

  // Contrast color change
  container.querySelector('#contrast-color')?.addEventListener('input', () => {
    updateUI()
  })

  return container
}

/** Export color palette as various formats */
export function exportPalette(colors: string[], format: 'aco' | 'ase' | 'gpl' | 'json' | 'css'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(colors, null, 2)
    case 'css':
      return colors.map((c, i) => `--color-${i + 1}: ${c};`).join('\n')
    case 'gpl':
      let gpl = 'GIMP Palette\nName: Exported Palette\nColumns: 16\n#\n'
      for (const color of colors) {
        const rgb = hexToRgb(color)
        gpl += `${rgb.r} ${rgb.g} ${rgb.b} ${color}\n`
      }
      return gpl
    default:
      return JSON.stringify(colors)
  }
}