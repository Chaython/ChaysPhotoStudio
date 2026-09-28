import { createCanvas, ctx2d } from '../utils/canvas'

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  try {
    const bitmap = await createImageBitmap(blob)
    const canvas = createCanvas(Math.max(1, bitmap.width), Math.max(1, bitmap.height))
    ctx2d(canvas).drawImage(bitmap, 0, 0)
    bitmap.close()
    return canvas
  } catch (bitmapError) {
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.decoding = 'async'
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(bitmapError)
        img.src = url
      })
      const canvas = createCanvas(Math.max(1, img.naturalWidth || 1), Math.max(1, img.naturalHeight || 1))
      ctx2d(canvas).drawImage(img, 0, 0)
      return canvas
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

export async function bytesToCanvas(bytes: Uint8Array, mime = 'application/octet-stream'): Promise<HTMLCanvasElement> {
  return blobToCanvas(new Blob([bytes as unknown as BlobPart], { type: mime }))
}

export function rgbaCss(value: any, fallback = '#000000'): string {
  if (!value || typeof value !== 'object') return fallback
  if (value.mode === 'RGB' && value.value) {
    const r = clampByte(Number(value.value.r))
    const g = clampByte(Number(value.value.g))
    const b = clampByte(Number(value.value.b))
    const a = Number.isFinite(Number(value.alpha)) ? Math.max(0, Math.min(1, Number(value.alpha))) : 1
    return a < 0.999 ? `rgba(${r},${g},${b},${a})` : rgbHex(r, g, b)
  }
  const r0 = value.red ?? value.r
  const g0 = value.green ?? value.g
  const b0 = value.blue ?? value.b
  if ([r0, g0, b0].every(v => Number.isFinite(Number(v)))) {
    const scale = Math.max(Number(r0), Number(g0), Number(b0)) <= 1.0001 ? 255 : 1
    const r = clampByte(Number(r0) * scale)
    const g = clampByte(Number(g0) * scale)
    const b = clampByte(Number(b0) * scale)
    const a0 = value.alpha ?? value.a
    const a = Number.isFinite(Number(a0)) ? Math.max(0, Math.min(1, Number(a0) > 1 ? Number(a0) / 255 : Number(a0))) : 1
    return a < 0.999 ? `rgba(${r},${g},${b},${a})` : rgbHex(r, g, b)
  }
  return fallback
}

export function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(v) ? v : 0)))
}

export function rgbHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => clampByte(v).toString(16).padStart(2, '0')).join('')
}

export function finite(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function percentOpacity(v: unknown, defaultValue = 100): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return defaultValue
  return Math.max(0, Math.min(100, n <= 1 ? n * 100 : n <= 255 ? n * 100 / 255 : n))
}

export function safeName(value: unknown, fallback = 'Layer'): string {
  const s = String(value ?? '').trim()
  return s ? s.slice(0, 255) : fallback
}

export function mimeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'avif': return 'image/avif'
    case 'svg': return 'image/svg+xml'
    case 'bmp': return 'image/bmp'
    default: return 'application/octet-stream'
  }
}
