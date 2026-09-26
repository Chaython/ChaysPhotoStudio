// ============================================================
// Chay's Photo Studio — formats public API (TASK 9-a2)
// Single import surface for every decoder/encoder: magic-byte
// detection, universal decodeFile() (native browser fallback +
// from-scratch TIFF/PSD/TGA/PNM/QOI/PCX/BMP/ICO codecs) and
// encodeCanvas() for the Export dialog. PSD WRITING is not here —
// it needs the live layer stack, so ExportDialog calls buildPsd()
// (re-exported below) itself.
// ============================================================
import { createCanvas, ctx2d, canvasToBlob, getImageData, hexToRgb } from '../utils/canvas'
import {
  detectFormat, decodeTiff, decodeTga, decodePnm, decodeQoi, decodePcx, decodeBmp, decodeIco,
  rawToCanvas, scanAlpha,
} from './decoders'
import {
  encodeTiff, encodeBmp, encodeTga, encodeQoi, encodePpm, encodeIco,
} from './encoders'
import { decodePsd, psdBlendKeyToMode } from './psd'
import type { ImportFormatId, RawImage } from './decoders'
import type { ExportFormatId } from './encoders'

export type { ImportFormatId, RawImage } from './decoders'
export type { ExportFormatId } from './encoders'
export type { PsdDecoded, PsdLayer, PsdLayerInput } from './psd'
export { detectFormat, rawToCanvas, scanAlpha } from './decoders'
export { ICO_SIZE_POOL } from './encoders'
export { decodePsd, buildPsd, psdBlendKeyToMode, blendModeToPsdKey } from './psd'

// ============================================================
// import
// ============================================================

/** One imported image, normalized to a canvas. `psdLayers` (bottom-first)
 *  is present for layered PSD/PSB files so io.ts can rebuild the stack. */
export interface DecodedImage {
  canvas: HTMLCanvasElement
  width: number
  height: number
  hasAlpha: boolean
  format: string
  /** Original component depth before normalization to the editor's working
   * raster. Browser-native formats default to 8 when not introspectable. */
  sourceBitDepth?: number
  /** Physical resolution metadata when available. */
  resolutionPpi?: number
  psdLayers?: {
    name: string
    canvas: HTMLCanvasElement      // pixels of the layer rect (canvas space)
    left: number
    top: number
    /** 0..100 — matches the engine's Layer.opacity scale */
    opacity: number
    /** engine blend mode id ('normal', 'multiply', …) */
    blendMode: string
    visible: boolean
    clipped?: boolean
    /** full-document-size mask canvas, mask value in the alpha channel */
    mask?: HTMLCanvasElement | null
  }[]
}

/** file-input `accept` value covering every decodable format */
export const IMPORT_ACCEPT =
  'image/*,.tif,.tiff,.psd,.psb,.tga,.icb,.vda,.qoi,.pcx,.ppm,.pgm,.pbm,.pam,.ico,.bmp'

/** format sniff from MIME type when magic bytes are inconclusive */
function formatFromMime(type: string): ImportFormatId | null {
  switch (type) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpeg'
    case 'image/gif': return 'gif'
    case 'image/webp': return 'webp'
    case 'image/avif': return 'avif'
    case 'image/svg+xml': return 'svg'
    case 'image/bmp': case 'image/x-bmp': case 'image/x-ms-bmp': case 'image/vnd.wap.wbmp': return 'bmp'
    case 'image/x-icon': case 'image/vnd.microsoft.icon': return 'ico'
    case 'image/tiff': case 'image/x-tiff': return 'tiff'
    case 'image/x-tga': case 'image/x-truevision': case 'image/x-targa': return 'tga'
    default: return null
  }
}

/** browser-native decode (png / jpeg / gif / webp / avif / svg) */
async function decodeNativeCanvas(file: File | Blob, format: string | null): Promise<HTMLCanvasElement> {
  if (format === 'svg' || file.type === 'image/svg+xml') {
    // createImageBitmap cannot parse SVG in most browsers — use <img>
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('SVG decode failed'))
        img.src = url
      })
      const w = Math.max(1, Math.round(img.naturalWidth || 1024))
      const h = Math.max(1, Math.round(img.naturalHeight || 1024))
      const c = createCanvas(w, h)
      ctx2d(c).drawImage(img, 0, 0)
      return c
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const bitmap = await createImageBitmap(file)
  const c = createCanvas(bitmap.width, bitmap.height)
  ctx2d(c).drawImage(bitmap, 0, 0)
  bitmap.close()
  return c
}

function fromRaw(raw: RawImage, format: string): DecodedImage {
  return {
    canvas: rawToCanvas(raw),
    width: raw.width,
    height: raw.height,
    hasAlpha: scanAlpha(raw.rgba),
    format,
    sourceBitDepth: raw.sourceBitDepth ?? 8,
  }
}

/** Decode any supported image file. Detects the format from magic
 *  bytes (falling back to the MIME type), routes to the right codec
 *  and returns a composite canvas — plus per-layer canvases for PSD.
 *  Native-decodable formats (png/jpeg/gif/webp/avif/svg) go through
 *  createImageBitmap/<img>; anything the browser can't do (16-bit
 *  TIFF, PSD, TGA, PNM, QOI, PCX, ICO-DIB) is decoded here. */
export async function decodeFile(file: File | Blob): Promise<DecodedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let format = detectFormat(bytes)
  if (!format) format = formatFromMime(file.type)
  if (!format) {
    if (file.type.startsWith('image/')) {
      // unknown image/* subtype — let the browser try
      const canvas = await decodeNativeCanvas(file, null)
      return {
        canvas,
        width: canvas.width,
        height: canvas.height,
        hasAlpha: scanAlpha(getImageData(canvas).data),
        format: file.type,
        sourceBitDepth: 8,
      }
    }
    throw new Error(`Unsupported image format${file.type ? ` (${file.type})` : ''} — the file type could not be detected`)
  }

  switch (format) {
    case 'tiff': return fromRaw(await decodeTiff(bytes), 'tiff')
    case 'tga': return fromRaw(decodeTga(bytes), 'tga')
    case 'ppm': return fromRaw(decodePnm(bytes), 'ppm')
    case 'qoi': return fromRaw(decodeQoi(bytes), 'qoi')
    case 'pcx': return fromRaw(decodePcx(bytes), 'pcx')
    case 'bmp': return fromRaw(decodeBmp(bytes), 'bmp')
    case 'ico': return fromRaw(await decodeIco(bytes), 'ico')
    case 'psd': {
      const psd = await decodePsd(bytes)
      return {
        canvas: psd.canvas,
        width: psd.width,
        height: psd.height,
        hasAlpha: psd.hasAlpha,
        format: 'psd',
        sourceBitDepth: psd.depth,
        resolutionPpi: psd.resolutionPpi,
        psdLayers: psd.layers.map(l => ({
          name: l.name,
          canvas: l.canvas,
          left: l.left,
          top: l.top,
          // PsdLayer.opacity is 0..100 — identical to the engine's Layer scale
          opacity: l.opacity,
          blendMode: psdBlendKeyToMode(l.blendKey),
          visible: l.visible,
          clipped: l.clipped,
          mask: l.mask,
        })),
      }
    }
    default: {
      // png / jpeg / gif / webp / avif / svg — native
      const canvas = await decodeNativeCanvas(file, format)
      return {
        canvas,
        width: canvas.width,
        height: canvas.height,
        hasAlpha: scanAlpha(getImageData(canvas).data),
        format,
        sourceBitDepth: 8,
      }
    }
  }
}

// ============================================================
// export
// ============================================================

export interface ExportFormatInfo {
  id: ExportFormatId
  label: string
  ext: string
  alpha: boolean
  options: ('quality' | 'background' | 'icoSizes' | 'tiffCompression' | 'psdLayers')[]
  /** one-line hint rendered under the format select */
  hint: string
}

/** every export format the UI offers, in menu order */
export const FORMAT_INFO: ExportFormatInfo[] = [
  { id: 'png', label: 'PNG', ext: 'png', alpha: true, options: [], hint: 'PNG — lossless, alpha' },
  { id: 'jpeg', label: 'JPEG', ext: 'jpg', alpha: false, options: ['quality', 'background'], hint: 'JPEG — lossy, no alpha (flattened)' },
  { id: 'webp', label: 'WebP', ext: 'webp', alpha: true, options: ['quality'], hint: 'WebP — lossy, alpha' },
  { id: 'tiff', label: 'TIFF', ext: 'tif', alpha: true, options: ['tiffCompression'], hint: 'TIFF — LZW lossless, alpha' },
  { id: 'bmp', label: 'BMP', ext: 'bmp', alpha: true, options: ['background'], hint: 'BMP — 24/32-bit (alpha kept when present)' },
  { id: 'tga', label: 'TGA', ext: 'tga', alpha: true, options: ['background'], hint: 'TGA — RLE, 24/32-bit' },
  { id: 'qoi', label: 'QOI', ext: 'qoi', alpha: true, options: [], hint: 'QOI — lossless, compact' },
  { id: 'ppm', label: 'PPM (P6)', ext: 'ppm', alpha: false, options: ['background'], hint: 'PPM — binary RGB, no alpha' },
  { id: 'ico', label: 'ICO', ext: 'ico', alpha: true, options: ['icoSizes'], hint: 'ICO — multi-size Windows icon' },
  { id: 'psd', label: 'PSD (layers)', ext: 'psd', alpha: true, options: ['psdLayers'], hint: 'PSD — layers + composite' },
]

export interface EncodeCanvasOptions {
  /** 1..100 (jpeg / webp) */
  quality?: number
  /** flatten color (#rrggbb) for formats without alpha — default #ffffff */
  background?: string
  /** ICO entry sizes, constrained to ICO_SIZE_POOL */
  icoSizes?: number[]
  /** TIFF predictor-free strip compression — default LZW */
  tiffCompression?: 'none' | 'lzw'
}

function u8Blob(bytes: Uint8Array, type: string): Blob {
  // cast for strict BlobPart typing (runtime accepts typed-array views)
  return new Blob([bytes as unknown as BlobPart], { type })
}

/** composite the canvas over a solid background (only when it has alpha) */
function flattenOn(canvas: HTMLCanvasElement, bgHex: string): HTMLCanvasElement {
  const [r, g, b] = hexToRgb(bgHex)
  const out = createCanvas(canvas.width, canvas.height)
  const ctx = ctx2d(out)
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(canvas, 0, 0)
  return out
}

function hasAnyAlpha(canvas: HTMLCanvasElement): boolean {
  return scanAlpha(getImageData(canvas).data)
}

/** Encode a canvas to any export format. png/jpeg/webp use the browser
 *  encoder (jpeg flattens onto `background` when alpha is present —
 *  browsers would otherwise flatten onto black); tiff/bmp/tga/qoi/ppm/ico
 *  use the from-scratch encoders. PSD is NOT handled here: it needs the
 *  live layer stack — the Export dialog builds it with buildPsd(). */
export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  format: ExportFormatId,
  opts: EncodeCanvasOptions = {},
): Promise<Blob> {
  const bg = opts.background ?? '#ffffff'
  const w = canvas.width
  const h = canvas.height
  switch (format) {
    case 'png':
      return canvasToBlob(canvas, 'image/png')
    case 'jpeg': {
      // JPEG has no alpha — flatten onto the chosen background first
      const src = hasAnyAlpha(canvas) ? flattenOn(canvas, bg) : canvas
      return canvasToBlob(src, 'image/jpeg', Math.min(1, Math.max(0.01, (opts.quality ?? 92) / 100)))
    }
    case 'webp':
      return canvasToBlob(canvas, 'image/webp', Math.min(1, Math.max(0.01, (opts.quality ?? 92) / 100)))
    case 'tiff': {
      const img = getImageData(canvas)
      return u8Blob(encodeTiff(img.data, w, h, (opts.tiffCompression ?? 'lzw') === 'lzw'), 'image/tiff')
    }
    case 'bmp': {
      const img = getImageData(canvas)
      return u8Blob(encodeBmp(img.data, w, h, { bg: hexToRgb(bg) }), 'image/bmp')
    }
    case 'tga': {
      const img = getImageData(canvas)
      return u8Blob(encodeTga(img.data, w, h, { bg: hexToRgb(bg) }), 'image/x-tga')
    }
    case 'qoi': {
      const img = getImageData(canvas)
      return u8Blob(encodeQoi(img.data, w, h), 'image/qoi')
    }
    case 'ppm': {
      const img = getImageData(canvas)
      return u8Blob(encodePpm(img.data, w, h, hexToRgb(bg)), 'image/x-portable-pixmap')
    }
    case 'ico': {
      const bytes = await encodeIco(canvas, opts.icoSizes)
      return u8Blob(bytes, 'image/x-icon')
    }
    case 'psd':
      throw new Error('PSD export needs the layer stack — use buildPsd() from the Export dialog')
  }
}
