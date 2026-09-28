// Canvas / color / math helpers used across the engine

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export type CanvasBitDepth = 8 | 16
export type CanvasColorSpace = 'srgb' | 'display-p3'

export interface CanvasWorkingProfile {
  bitDepth: CanvasBitDepth
  colorSpace: CanvasColorSpace
}

export interface CanvasPixelCapabilities {
  workingPixelFormat: 'rgba-unorm8' | 'rgba-float16'
  workingBitDepth: CanvasBitDepth
  workingColorSpace: CanvasColorSpace
  float16Context: boolean
  float16ImageData: boolean
  displayP3: boolean
}

let pixelCaps: CanvasPixelCapabilities | null = null
let defaultProfile: CanvasWorkingProfile = { bitDepth: 8, colorSpace: 'srgb' }
const canvasProfiles = new WeakMap<HTMLCanvasElement, CanvasWorkingProfile>()

/** Feature-probe the modern Canvas 2D float16 / Display-P3 path. */
export function canvasPixelCapabilities(): CanvasPixelCapabilities {
  if (pixelCaps) return pixelCaps
  let float16Context = false
  let float16ImageData = false
  let displayP3 = false

  if (typeof document !== 'undefined') {
    try {
      const probe = document.createElement('canvas')
      probe.width = probe.height = 1
      const ctx = probe.getContext('2d', {
        colorType: 'float16',
        colorSpace: 'display-p3',
        willReadFrequently: true,
      } as any) as (CanvasRenderingContext2D & {
        getContextAttributes?: () => { colorType?: string; colorSpace?: string }
      }) | null
      const attrs = ctx?.getContextAttributes?.() as ({ colorType?: string; colorSpace?: string } | undefined)
      float16Context = attrs?.colorType === 'float16'
      displayP3 = attrs?.colorSpace === 'display-p3'
      if (ctx) {
        try {
          const img = (ctx as any).getImageData(0, 0, 1, 1, {
            pixelFormat: 'rgba-float16',
            colorSpace: 'display-p3',
          })
          float16ImageData = img?.pixelFormat === 'rgba-float16' || img?.data?.constructor?.name === 'Float16Array'
          displayP3 = displayP3 || img?.colorSpace === 'display-p3'
        } catch { /* runtime exposes only the legacy ImageData path */ }
      }
    } catch { /* unsupported context attributes */ }
  }

  pixelCaps = {
    workingPixelFormat: float16Context && float16ImageData ? 'rgba-float16' : 'rgba-unorm8',
    workingBitDepth: float16Context && float16ImageData ? 16 : 8,
    workingColorSpace: displayP3 ? 'display-p3' : 'srgb',
    float16Context,
    float16ImageData,
    displayP3,
  }
  return pixelCaps
}

/** Set the profile inherited by newly-created color canvases. Unsupported
 * requests fall back cleanly rather than pretending a higher precision exists. */
export function setCanvasWorkingProfile(profile: CanvasWorkingProfile): CanvasWorkingProfile {
  const caps = canvasPixelCapabilities()
  defaultProfile = {
    bitDepth: profile.bitDepth === 16 && caps.float16Context && caps.float16ImageData ? 16 : 8,
    colorSpace: profile.colorSpace === 'display-p3' && caps.displayP3 ? 'display-p3' : 'srgb',
  }
  return { ...defaultProfile }
}

export function currentCanvasWorkingProfile(): CanvasWorkingProfile {
  return { ...defaultProfile }
}

function inferCanvasProfile(c: HTMLCanvasElement): CanvasWorkingProfile {
  const existing = canvasProfiles.get(c)
  if (existing) return existing
  const ctx = c.getContext('2d') as (CanvasRenderingContext2D & {
    getContextAttributes?: () => { colorType?: string; colorSpace?: string }
  }) | null
  const attrs = ctx?.getContextAttributes?.()
  const profile: CanvasWorkingProfile = {
    bitDepth: attrs?.colorType === 'float16' ? 16 : 8,
    colorSpace: attrs?.colorSpace === 'display-p3' ? 'display-p3' : 'srgb',
  }
  canvasProfiles.set(c, profile)
  return profile
}

export function canvasProfile(c: HTMLCanvasElement): CanvasWorkingProfile {
  return { ...inferCanvasProfile(c) }
}

export function createCanvas(
  w: number,
  h: number,
  profile: CanvasWorkingProfile = defaultProfile,
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  const caps = canvasPixelCapabilities()
  const requested: CanvasWorkingProfile = {
    bitDepth: profile.bitDepth === 16 && caps.float16Context && caps.float16ImageData ? 16 : 8,
    colorSpace: profile.colorSpace === 'display-p3' && caps.displayP3 ? 'display-p3' : 'srgb',
  }
  const ctx = c.getContext('2d', {
    willReadFrequently: true,
    colorType: requested.bitDepth === 16 ? 'float16' : 'unorm8',
    colorSpace: requested.colorSpace,
  } as any) as (CanvasRenderingContext2D & {
    getContextAttributes?: () => { colorType?: string; colorSpace?: string }
  }) | null
  if (!ctx) throw new Error('2D context unavailable')
  const attrs = ctx.getContextAttributes?.()
  canvasProfiles.set(c, {
    bitDepth: attrs?.colorType === 'float16' ? 16 : requested.bitDepth === 16 && caps.float16Context ? 16 : 8,
    colorSpace: attrs?.colorSpace === 'display-p3' ? 'display-p3' : requested.colorSpace === 'display-p3' && caps.displayP3 ? 'display-p3' : 'srgb',
  })
  return c
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  inferCanvasProfile(c)
  return ctx
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height, canvasProfile(src))
  ctx2d(c).drawImage(src, 0, 0)
  return c
}

export function canvasFromImage(
  img: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  w?: number,
  h?: number,
  profile?: CanvasWorkingProfile,
): HTMLCanvasElement {
  const cw = w ?? (img as any).width
  const ch = h ?? (img as any).height
  const inherited = profile ?? (img instanceof HTMLCanvasElement ? canvasProfile(img) : defaultProfile)
  const c = createCanvas(cw, ch, inherited)
  ctx2d(c).drawImage(img as any, 0, 0, cw, ch)
  return c
}

export function getImageData(c: HTMLCanvasElement): ImageData {
  return ctx2d(c).getImageData(0, 0, c.width, c.height)
}

/** Read a float16 backing store without quantizing through legacy ImageData.
 * Returns null on browsers that expose a float16 context but not float16 ImageData. */
export function getFloat16ImageData(c: HTMLCanvasElement): any | null {
  if (canvasProfile(c).bitDepth !== 16) return null
  try {
    const p = canvasProfile(c)
    return (ctx2d(c) as any).getImageData(0, 0, c.width, c.height, {
      pixelFormat: 'rgba-float16',
      colorSpace: p.colorSpace,
    })
  } catch {
    return null
  }
}

export function putFloat16Pixels(
  c: HTMLCanvasElement,
  pixels: ArrayLike<number>,
  colorSpace: CanvasColorSpace = canvasProfile(c).colorSpace,
): boolean {
  const Float16 = (globalThis as any).Float16Array
  if (canvasProfile(c).bitDepth !== 16 || typeof Float16 !== 'function') return false
  try {
    const data = pixels instanceof Float16 ? pixels : new Float16(Array.from(pixels as ArrayLike<number>))
    const image = new (ImageData as any)(data, c.width, c.height, {
      pixelFormat: 'rgba-float16',
      colorSpace,
    })
    ;(ctx2d(c) as any).putImageData(image, 0, 0)
    return true
  } catch {
    return false
  }
}

export function putImageData(c: HTMLCanvasElement, data: ImageData) {
  ctx2d(c).putImageData(data, 0, 0)
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay)
}

export function rectFromPoints(ax: number, ay: number, bx: number, by: number) {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) }
}

export function rectsIntersect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function inflateRect(r: { x: number; y: number; w: number; h: number }, px: number) {
  return { x: r.x - px, y: r.y - px, w: r.w + px * 2, h: r.h + px * 2 }
}

export function clampRectToSize(
  r: { x: number; y: number; w: number; h: number },
  w: number,
  h: number,
) {
  const x0 = clamp(Math.floor(r.x), 0, w)
  const y0 = clamp(Math.floor(r.y), 0, h)
  const x1 = clamp(Math.ceil(r.x + r.w), 0, w)
  const y1 = clamp(Math.ceil(r.y + r.h), 0, h)
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

export function unionRect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x + a.w, b.x + b.w)
  const y1 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function alphaBounds(
  alpha: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  pad = 0,
): { x: number; y: number; w: number; h: number } | null {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let i = 0; i < alpha.length; i++) {
    if (!alpha[i]) continue
    const x = i % w
    const y = (i / w) | 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (maxX < minX || maxY < minY) return null
  return clampRectToSize({
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + 1 + pad * 2,
    h: maxY - minY + 1 + pad * 2,
  }, w, h)
}

export function cropCanvasRegion(
  src: HTMLCanvasElement,
  r: { x: number; y: number; w: number; h: number },
): HTMLCanvasElement {
  const out = createCanvas(r.w, r.h)
  ctx2d(out).drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  return out
}

export function cropAlphaRegion(
  alpha: Uint8ClampedArray | Uint8Array,
  sourceWidth: number,
  r: { x: number; y: number; w: number; h: number },
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h)
  for (let y = 0; y < r.h; y++) {
    const srcRow = (r.y + y) * sourceWidth + r.x
    const dstRow = y * r.w
    for (let x = 0; x < r.w; x++) out[dstRow + x] = alpha[srcRow + x]
  }
  return out
}

// ---------- masks ----------
/** Masks are canvases whose ALPHA channel carries the mask value (255 = visible/selected). */
export function makeMaskCanvas(w: number, h: number, value = 0): HTMLCanvasElement {
  const c = createCanvas(w, h)
  const d = new ImageData(w, h)
  const a = d.data
  for (let i = 0; i < a.length; i += 4) { a[i] = 255; a[i + 1] = 255; a[i + 2] = 255; a[i + 3] = value }
  putImageData(c, d)
  return c
}

export function getMaskAlpha(c: HTMLCanvasElement): Uint8ClampedArray {
  const d = getImageData(c)
  const out = new Uint8ClampedArray(d.width * d.height)
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = d.data[j]
  return out
}

export function setMaskAlpha(c: HTMLCanvasElement, alpha: Uint8ClampedArray | Uint8Array) {
  const d = getImageData(c)
  for (let i = 0, j = 3; i < alpha.length; i++, j += 4) {
    d.data[j] = alpha[i]
    d.data[j - 3] = 255; d.data[j - 2] = 255; d.data[j - 1] = 255
  }
  putImageData(c, d)
}

export function maskToImageDataGray(c: HTMLCanvasElement): ImageData {
  const d = getImageData(c)
  const out = new ImageData(d.width, d.height)
  for (let i = 0, j = 0; j < d.data.length; i++, j += 4) {
    const v = d.data[j + 3]
    out.data[j] = v; out.data[j + 1] = v; out.data[j + 2] = v; out.data[j + 3] = 255
  }
  return out
}

/** combine two mask alpha arrays with the given mode; returns new array */
export function combineMaskAlpha(a: Uint8ClampedArray, b: Uint8ClampedArray, mode: 'add' | 'subtract' | 'intersect'): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.length)
  for (let i = 0; i < a.length; i++) {
    if (mode === 'add') out[i] = Math.max(a[i], b[i])
    else if (mode === 'subtract') out[i] = Math.max(0, a[i] - b[i])
    else out[i] = Math.min(a[i], b[i])
  }
  return out
}

// ---------- colors ----------
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(n)) return [255, 255, 255]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return [h, s * 100, max * 100]
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360; s /= 100; v /= 100
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c } else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c } else if (h < 300) { r = x; b = c } else { r = c; b = x }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

export function srgbToLinear(v: number): number {
  v /= 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

export function linearToSrgb(v: number): number {
  v = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return clamp(v * 255, 0, 255)
}

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

// ---------- misc ----------
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** bilinear resample of a canvas */
export function resampleCanvas(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const dst = createCanvas(w, h)
  const c = ctx2d(dst)
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'
  c.drawImage(src, 0, 0, w, h)
  return dst
}

/** load an image file into a canvas */
export async function fileToCanvas(file: File | Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file)
  const c = canvasFromImage(bitmap)
  bitmap.close()
  return c
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function canvasToBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((res, rej) => {
    c.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), type, quality)
  })
}

/** Draw a soft round dab (radial-gradient alpha) into a context at x,y */
export function drawSoftDab(
  ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, hardness: number, color: string, alpha: number
) {
  const inner = clamp(hardness / 100, 0, 0.98)
  const g = ctx.createRadialGradient(x, y, radius * inner, x, y, radius)
  const [r, gg, b] = hexToRgb(color)
  g.addColorStop(0, `rgba(${r},${gg},${b},${alpha})`)
  g.addColorStop(1, `rgba(${r},${gg},${b},0)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}

/** build a radial falloff mask (0..1) for a square region */
export function radialFalloff(radius: number): Float32Array {
  const size = Math.ceil(radius * 2) + 1
  const out = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - radius, dy = y - radius
      const d = Math.sqrt(dx * dx + dy * dy) / radius
      out[y * size + x] = clamp(1 - (d - 0.55) / 0.45, 0, 1)
    }
  }
  return out
}
