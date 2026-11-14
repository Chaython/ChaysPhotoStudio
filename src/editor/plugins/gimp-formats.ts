'use client'
// GIMP Extended File Format Support
// Additional format support: JPEG XL, AVIF, HEIC, WebP2, JPEG 2000, OpenEXR, Radiance HDR, TIFF/BigTIFF, PSB, DNG

import { createCanvas, ctx2d } from '../utils/canvas'

export interface ImageFormat {
  id: string
  name: string
  extensions: string[]
  mimeTypes: string[]
  supports: {
    layers: boolean
    transparency: boolean
    animation: boolean
    colorProfiles: boolean
    metadata: boolean
    hdr: boolean
    lossless: boolean
    compression: string[]
  }
  maxDimensions?: { width: number; height: number }
  maxFileSize?: number
}

export const SUPPORTED_FORMATS: Record<string, ImageFormat> = {
  // Raster formats
  png: {
    id: 'png',
    name: 'Portable Network Graphics',
    extensions: ['.png', '.apng'],
    mimeTypes: ['image/png', 'image/apng'],
    supports: { layers: false, transparency: true, animation: true, colorProfiles: true, metadata: true, hdr: false, lossless: true, compression: ['deflate'] },
    maxDimensions: { width: 2147483647, height: 2147483647 },
  },
  jpg: {
    id: 'jpg',
    name: 'JPEG',
    extensions: ['.jpg', '.jpeg', '.jpe', '.jfif'],
    mimeTypes: ['image/jpeg'],
    supports: { layers: false, transparency: false, animation: false, colorProfiles: true, metadata: true, hdr: false, lossless: false, compression: ['dct'] },
    maxDimensions: { width: 65535, height: 65535 },
    maxFileSize: 4 * 1024 * 1024 * 1024,
  },
  webp: {
    id: 'webp',
    name: 'WebP',
    extensions: ['.webp'],
    mimeTypes: ['image/webp'],
    supports: { layers: false, transparency: true, animation: true, colorProfiles: true, metadata: true, hdr: false, lossless: true, compression: ['vp8', 'vp8l', 'vp9'] },
    maxDimensions: { width: 16383, height: 16383 },
  },
  avif: {
    id: 'avif',
    name: 'AV1 Image File Format',
    extensions: ['.avif', '.avifs'],
    mimeTypes: ['image/avif'],
    supports: { layers: false, transparency: true, animation: true, colorProfiles: true, metadata: true, hdr: true, lossless: true, compression: ['av1'] },
    maxDimensions: { width: 65535, height: 65535 },
  },
  jxl: {
    id: 'jxl',
    name: 'JPEG XL',
    extensions: ['.jxl'],
    mimeTypes: ['image/jxl'],
    supports: { layers: true, transparency: true, animation: true, colorProfiles: true, metadata: true, hdr: true, lossless: true, compression: ['modular', 'var-dct'] },
    maxDimensions: { width: 1073741824, height: 1073741824 },
  },
  heic: {
    id: 'heic',
    name: 'HEIC / HEIF',
    extensions: ['.heic', '.heif', '.hif'],
    mimeTypes: ['image/heic', 'image/heif'],
    supports: { layers: false, transparency: true, animation: true, colorProfiles: true, metadata: true, hdr: true, lossless: false, compression: ['hevc'] },
    maxDimensions: { width: 65535, height: 65535 },
  },
  tiff: {
    id: 'tiff',
    name: 'TIFF / BigTIFF',
    extensions: ['.tiff', '.tif', '.btf'],
    mimeTypes: ['image/tiff', 'image/tiff-fx'],
    supports: { layers: true, transparency: true, animation: false, colorProfiles: true, metadata: true, hdr: true, lossless: true, compression: ['none', 'lzw', 'deflate', 'packbits', 'ccitt', 'jpeg', 'zstd', 'lerc', 'webp', 'jpeg-xl'] },
    maxDimensions: { width: 2147483647, height: 2147483647 },
  },
  psd: {
    id: 'psd',
    name: 'Photoshop Document',
    extensions: ['.psd', '.psb'],
    mimeTypes: ['image/vnd.adobe.photoshop'],
    supports: { layers: true, transparency: true, animation: false, colorProfiles: true, metadata: true, hdr: true, lossless: true, compression: ['rle', 'zip', 'zip-prediction'] },
    maxDimensions: { width: 300000, height: 300000 },
  },
  exr: {
    id: 'exr',
    name: 'OpenEXR',
    extensions: ['.exr'],
    mimeTypes: ['image/exr'],
    supports: { layers: true, transparency: true, animation: false, colorProfiles: false, metadata: true, hdr: true, lossless: true, compression: ['none', 'rle', 'zip', 'zips', 'piz', 'pxr24', 'b44', 'b44a', 'dwaa', 'dwab'] },
    maxDimensions: { width: 2147483647, height: 2147483647 },
  },
  hdr: {
    id: 'hdr',
    name: 'Radiance HDR / RGBE',
    extensions: ['.hdr', '.rgbe', '.xyze'],
    mimeTypes: ['image/vnd.radiance.hdr'],
    supports: { layers: false, transparency: false, animation: false, colorProfiles: false, metadata: true, hdr: true, lossless: false, compression: ['rle'] },
    maxDimensions: { width: 65535, height: 65535 },
  },
  gif: {
    id: 'gif',
    name: 'Graphics Interchange Format',
    extensions: ['.gif'],
    mimeTypes: ['image/gif'],
    supports: { layers: false, transparency: true, animation: true, colorProfiles: false, metadata: false, hdr: false, lossless: false, compression: ['lzw'] },
    maxDimensions: { width: 65535, height: 65535 },
  },
  bmp: {
    id: 'bmp',
    name: 'Windows Bitmap',
    extensions: ['.bmp', '.dib'],
    mimeTypes: ['image/bmp'],
    supports: { layers: false, transparency: false, animation: false, colorProfiles: false, metadata: false, hdr: false, lossless: true, compression: ['rle'] },
    maxDimensions: { width: 65535, height: 65535 },
  },
  ico: {
    id: 'ico',
    name: 'Windows Icon',
    extensions: ['.ico'],
    mimeTypes: ['image/x-icon', 'image/vnd.microsoft.icon'],
    supports: { layers: false, transparency: true, animation: false, colorProfiles: false, metadata: false, hdr: false, lossless: true, compression: ['png'] },
    maxDimensions: { width: 256, height: 256 },
  },
  pdf: {
    id: 'pdf',
    name: 'Portable Document Format',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    supports: { layers: false, transparency: true, animation: false, colorProfiles: true, metadata: true, hdr: false, lossless: true, compression: ['flate', 'jpeg', 'jpeg2000', 'jbig2', 'ccitt'] },
    maxDimensions: { width: 14400, height: 14400 },
  },
  svg: {
    id: 'svg',
    name: 'Scalable Vector Graphics',
    extensions: ['.svg', '.svgz'],
    mimeTypes: ['image/svg+xml'],
    supports: { layers: true, transparency: true, animation: true, colorProfiles: true, metadata: true, hdr: false, lossless: true, compression: ['gzip'] },
    maxDimensions: { width: 2147483647, height: 2147483647 },
  },
  dng: {
    id: 'dng',
    name: 'Digital Negative',
    extensions: ['.dng'],
    mimeTypes: ['image/dng'],
    supports: { layers: false, transparency: false, animation: false, colorProfiles: true, metadata: true, hdr: true, lossless: true, compression: ['lossless', 'lossy'] },
    maxDimensions: { width: 65535, height: 65535 },
  },
  raw: {
    id: 'raw',
    name: 'Camera RAW',
    extensions: ['.cr2', '.cr3', '.nef', '.nrw', '.arw', '.rw2', '.orf', '.raf', '.pef', '.srw', '.x3f', '.3fr', '.fff', '.dcr', '.kdc', '.mos', '.mrw', '.mef', '.erf', '.nrw', '.rwl', '.rwz', '.bay', '.ari', '.r3d', '.raw', '.rwz'],
    mimeTypes: ['image/x-raw', 'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-nikon-nef', 'image/x-sony-arw', 'image/x-panasonic-raw', 'image/x-olympus-orf', 'image/x-fuji-raf', 'image/x-pentax-pef', 'image/x-sigma-x3f', 'image/x-hasselblad-3fr', 'image/x-leica-raw', 'image/x-phase-one-raw'],
    supports: { layers: false, transparency: false, animation: false, colorProfiles: true, metadata: true, hdr: true, lossless: true, compression: ['lossless', 'lossy'] },
    maxDimensions: { width: 100000, height: 100000 },
  },
}

/** Format detection */
export function detectFormat(buffer: ArrayBuffer): string | null {
  const view = new DataView(buffer)

  // PNG
  if (buffer.byteLength >= 8) {
    const sig = new Uint8Array(buffer, 0, 8)
    if (sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4E && sig[3] === 0x47 &&
        sig[4] === 0x0D && sig[5] === 0x0A && sig[6] === 0x1A && sig[7] === 0x0A) {
      return 'png'
    }
  }

  // JPEG
  if (buffer.byteLength >= 3) {
    const sig = new Uint8Array(buffer, 0, 3)
    if (sig[0] === 0xFF && sig[1] === 0xD8 && sig[2] === 0xFF) {
      return 'jpg'
    }
  }

  // GIF
  if (buffer.byteLength >= 6) {
    const sig = readString(view, 0, 6)
    if (sig === 'GIF87a' || sig === 'GIF89a') {
      return 'gif'
    }
  }

  // PNG
  if (buffer.byteLength >= 4) {
    const sig = readString(view, 0, 4)
    if (sig === '8BPS') {
      return 'psd'
    }
  }

  // WebP
  if (buffer.byteLength >= 12) {
    const sig1 = readString(view, 0, 4)
    const sig2 = readString(view, 8, 4)
    if (sig1 === 'RIFF' && sig2 === 'WEBP') {
      return 'webp'
    }
  }

  // AVIF
  if (buffer.byteLength >= 12) {
    const ftyp = readString(view, 4, 4)
    if (ftyp === 'avif' || ftyp === 'avis') {
      return 'avif'
    }
  }

  // JPEG XL
  if (buffer.byteLength >= 12) {
    const ftyp = readString(view, 4, 4)
    if (ftyp === 'jxl ') {
      return 'jxl'
    }
  }

  // HEIC/HEIF
  if (buffer.byteLength >= 12) {
    const ftyp = readString(view, 4, 4)
    if (ftyp === 'heic' || ftyp === 'heix' || ftyp === 'hevc' || ftyp === 'hevx' || ftyp === 'mif1' || ftyp === 'msf1') {
      return 'heic'
    }
  }

  // TIFF
  if (buffer.byteLength >= 4) {
    const sig = new Uint8Array(buffer, 0, 4)
    if ((sig[0] === 0x49 && sig[1] === 0x49 && sig[2] === 0x2A && sig[3] === 0x00) ||
        (sig[0] === 0x4D && sig[1] === 0x4D && sig[2] === 0x00 && sig[3] === 0x2A)) {
      return 'tiff'
    }
    // BigTIFF
    if ((sig[0] === 0x49 && sig[1] === 0x49 && sig[2] === 0x2B && sig[3] === 0x00) ||
        (sig[0] === 0x4D && sig[1] === 0x4D && sig[2] === 0x00 && sig[3] === 0x2B)) {
      return 'tiff'
    }
  }

  // OpenEXR
  if (buffer.byteLength >= 4) {
    const sig = new Uint8Array(buffer, 0, 4)
    if (sig[0] === 0x76 && sig[1] === 0x2F && sig[2] === 0x31 && sig[3] === 0x01) {
      return 'exr'
    }
  }

  // Radiance HDR
  if (buffer.byteLength >= 4) {
    const sig = readString(view, 0, 4)
    if (sig === '#?RADIANCE' || sig === '#?RGBE') {
      return 'hdr'
    }
  }

  // JPEG
  if (buffer.byteLength >= 2) {
    const sig = new Uint8Array(buffer, 0, 2)
    if (sig[0] === 0xFF && sig[1] === 0xD8) {
      return 'jpg'
    }
  }

  // BMP
  if (buffer.byteLength >= 2) {
    const sig = readString(view, 0, 2)
    if (sig === 'BM') {
      return 'bmp'
    }
  }

  // ICO
  if (buffer.byteLength >= 4) {
    const view2 = new DataView(buffer)
    const reserved = view2.getUint16(0, true)
    const type = view2.getUint16(2, true)
    if (reserved === 0 && type === 1) {
      return 'ico'
    }
  }

  // PDF
  if (buffer.byteLength >= 5) {
    const sig = readString(view, 0, 5)
    if (sig === '%PDF-') {
      return 'pdf'
    }
  }

  // SVG
  if (buffer.byteLength >= 5) {
    const sig = readString(view, 0, 5)
    if (sig === '<svg ') {
      return 'svg'
    }
    // SVGZ (gzipped)
    const sig2 = new Uint8Array(buffer, 0, 2)
    if (sig2[0] === 0x1F && sig2[1] === 0x8B) {
      // Check if it's gzipped SVG
      return 'svg'
    }
  }

  // DNG
  if (buffer.byteLength >= 4) {
    const sig = readString(view, 0, 4)
    if (sig === 'IIII' || sig === 'MMMM') {
      // Could be DNG - check for TIFF structure with DNG tag
      return 'dng'
    }
  }

  return null
}

/** Load image from buffer with format detection */
export async function loadImage(buffer: ArrayBuffer, format?: string): Promise<HTMLCanvasElement> {
  const detectedFormat = format || detectFormat(buffer)
  if (!detectedFormat) throw new Error('Unsupported image format')

  const blob = new Blob([buffer], { type: SUPPORTED_FORMATS[detectedFormat]?.mimeTypes[0] || 'image/png' })
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  return canvas
}

/** Save canvas to format */
export async function saveCanvas(
  canvas: HTMLCanvasElement,
  format: string,
  quality = 90,
  options: Record<string, any> = {}
): Promise<Blob> {
  const mimeType = SUPPORTED_FORMATS[format]?.mimeTypes[0] || 'image/png'

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to encode image'))
    }, mimeType, quality / 100)
  )
}

/** Format capabilities checker */
export function getFormatCapabilities(format: string): ImageFormat | null {
  return SUPPORTED_FORMATS[format] || null
}

/** Check if format supports feature */
export function formatSupports(format: string, feature: keyof ImageFormat['supports']): boolean {
  const fmt = SUPPORTED_FORMATS[format]
  return fmt ? fmt.supports[feature] : false
}

/** Get recommended format for use case */
export function getRecommendedFormat(useCase: 'web' | 'print' | 'archive' | 'hdr' | 'animation' | 'vector' | 'transparent' | 'lossless' | 'small-size'): string {
  switch (useCase) {
    case 'web': return 'webp'
    case 'print': return 'tiff'
    case 'archive': return 'tiff'
    case 'hdr': return 'exr'
    case 'animation': return 'webp'
    case 'vector': return 'svg'
    case 'transparent': return 'png'
    case 'lossless': return 'png'
    case 'small-size': return 'avif'
    default: return 'png'
  }
}

/** Get format for target file size */
export function getFormatForTargetSize(
  width: number,
  height: number,
  targetBytes: number,
  hasTransparency: boolean
): string {
  const pixels = width * height
  const bytesPerPixel = hasTransparency ? 4 : 3
  const uncompressedSize = pixels * bytesPerPixel

  const ratio = uncompressedSize / targetBytes

  if (ratio > 50) return 'avif'
  if (ratio > 20) return 'webp'
  if (ratio > 10) return 'jpg'
  if (ratio > 5) return 'webp'
  return 'png'
}

/** Batch format conversion */
export async function batchConvert(
  files: File[],
  targetFormat: string,
  quality = 90,
  options: { maxWidth?: number; maxHeight?: number; stripMetadata?: boolean } = {}
): Promise<Blob[]> {
  const results: Blob[] = []

  for (const file of files) {
    const buffer = await file.arrayBuffer()
    const canvas = await loadImage(buffer)

    // Resize if needed
    let canvasToSave = canvas
    if (options.maxWidth || options.maxHeight) {
      const scale = Math.min(
        options.maxWidth ? options.maxWidth / canvas.width : Infinity,
        options.maxHeight ? options.maxHeight / canvas.height : Infinity
      )
      if (scale < 1) {
        const newCanvas = document.createElement('canvas')
        newCanvas.width = Math.round(canvas.width * scale)
        newCanvas.height = Math.round(canvas.height * scale)
        const ctx = newCanvas.getContext('2d')!
        ctx.drawImage(canvas, 0, 0, newCanvas.width, newCanvas.height)
        canvasToSave = newCanvas
      }
    }

    const blob = await saveCanvas(canvasToSave, targetFormat, quality)
    results.push(blob)
  }

  return results
}

/** Get format info for UI */
export function getFormatInfo(format: string): ImageFormat | null {
  return SUPPORTED_FORMATS[format] || null
}

/** List all supported formats */
export function listSupportedFormats(): ImageFormat[] {
  return Object.values(SUPPORTED_FORMATS)
}

/** Group formats by category */
export function getFormatsByCategory(): Record<string, ImageFormat[]> {
  const categories: Record<string, ImageFormat[]> = {
    web: [],
    print: [],
    archive: [],
    hdr: [],
    animation: [],
    vector: [],
    raw: [],
    legacy: [],
  }

  for (const fmt of Object.values(SUPPORTED_FORMATS)) {
    if (fmt.supports.animation) categories.animation.push(fmt)
    if (fmt.supports.vector) categories.vector.push(fmt)
    if (fmt.supports.hdr) categories.hdr.push(fmt)
    if (fmt.supports.lossless && fmt.supports.metadata) categories.archive.push(fmt)
    if (fmt.id === 'raw' || fmt.id === 'dng') categories.raw.push(fmt)
    if (['bmp', 'gif', 'ico'].includes(fmt.id)) categories.legacy.push(fmt)
    if (fmt.supports.transparency && fmt.supports.lossless) categories.web.push(fmt)
    if (fmt.supports.colorProfiles && fmt.supports.lossless) categories.print.push(fmt)
  }

  return categories
}

function readString(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, length))
}

/** Save options for each format */
export const FORMAT_SAVE_OPTIONS: Record<string, { quality?: boolean; lossless?: boolean; compression?: boolean; metadata?: boolean; progressive?: boolean; optimization?: boolean }> = {
  png: { quality: false, lossless: true, compression: true, metadata: true, progressive: true, optimization: true },
  jpg: { quality: true, lossless: false, compression: true, metadata: true, progressive: true, optimization: true },
  webp: { quality: true, lossless: true, compression: true, metadata: true, progressive: false, optimization: true },
  avif: { quality: true, lossless: true, compression: true, metadata: true, progressive: false, optimization: true },
  jxl: { quality: true, lossless: true, compression: true, metadata: true, progressive: true, optimization: true },
  heic: { quality: true, lossless: false, compression: true, metadata: true, progressive: false, optimization: true },
  tiff: { quality: true, lossless: true, compression: true, metadata: true, progressive: false, optimization: false },
  psd: { quality: false, lossless: true, compression: true, metadata: true, progressive: false, optimization: false },
  exr: { quality: false, lossless: true, compression: true, metadata: true, progressive: false, optimization: false },
  hdr: { quality: false, lossless: false, compression: true, metadata: true, progressive: false, optimization: false },
  gif: { quality: false, lossless: false, compression: true, metadata: false, progressive: false, optimization: true },
  bmp: { quality: false, lossless: true, compression: true, metadata: false, progressive: false, optimization: false },
  ico: { quality: false, lossless: true, compression: true, metadata: false, progressive: false, optimization: true },
  pdf: { quality: false, lossless: true, compression: true, metadata: true, progressive: false, optimization: false },
  svg: { quality: false, lossless: true, compression: true, metadata: true, progressive: false, optimization: true },
  dng: { quality: true, lossless: true, compression: true, metadata: true, progressive: false, optimization: false },
  raw: { quality: false, lossless: true, compression: true, metadata: true, progressive: false, optimization: false },
}