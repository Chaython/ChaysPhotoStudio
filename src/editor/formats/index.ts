// ============================================================
// Chay's Photo Studio — formats public API (TASK 9-a2)
// Single import surface for every decoder/encoder: magic-byte
// detection, universal decodeFile() (native browser fallback +
// from-scratch TIFF/PSD/TGA/PNM/QOI/PCX/BMP/ICO codecs) and
// encodeCanvas() for the Export dialog. PSD WRITING is not here —
// it needs the live layer stack, so ExportDialog calls buildPsd()
// (re-exported below) itself.
// ============================================================
import { createCanvas, ctx2d, canvasToBlob, getImageData, getFloat16ImageData, hexToRgb } from '../utils/canvas'
import {
  detectFormat, decodeTiff, decodeTga, decodePnm, decodePfm, decodeRadianceHdr, decodeQoi, decodePcx, decodeBmp, decodeIco,
  rawToCanvas, scanAlpha,
} from './decoders'
import {
  encodeTiff, encodeTiff16, encodeBmp, encodeTga, encodeQoi, encodePpm, encodeIco,
} from './encoders'
import { decodePsd, psdBlendKeyToMode } from './psd'
import {
  decodeBundledHeic, decodeBundledJxl, decodeBundledJp2, decodeBundledRaw,
  decodeBundledPdf, decodeBundledEps,
} from './bundled-codecs'
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
  /** Scene-linear source pixels retained for a true 32-bit HDR document. */
  sourceFloatPixels?: Float32Array
  sourceColorSpace?: 'srgb' | 'linear-srgb'
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
  'image/*,.tif,.tiff,.psd,.psb,.tga,.icb,.vda,.qoi,.pcx,.ppm,.pgm,.pbm,.pam,.pfm,.hdr,.rgbe,.heic,.heif,.hif,.jxl,.jp2,.j2k,.j2c,.ico,.bmp,.pdf,.ai,.eps,.ps,.dng,.cr2,.cr3,.nef,.nrw,.arw,.srf,.sr2,.raf,.orf,.rw2,.pef,.3fr,.fff,.iiq,.kdc,.dcr,.mrw,.x3f,.erf,.mef,.mos,.rwl,.raw'

/** format sniff from MIME type when magic bytes are inconclusive */
function formatFromMime(type: string): ImportFormatId | null {
  switch (type) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpeg'
    case 'image/gif': return 'gif'
    case 'image/webp': return 'webp'
    case 'image/avif': return 'avif'
    case 'image/heic': case 'image/heif': return 'heic'
    case 'image/jxl': return 'jxl'
    case 'image/jp2': case 'image/jpx': case 'image/j2k': return 'jp2'
    case 'image/vnd.radiance': case 'image/x-hdr': return 'hdr'
    case 'image/x-portable-floatmap': return 'pfm'
    case 'image/svg+xml': return 'svg'
    case 'image/bmp': case 'image/x-bmp': case 'image/x-ms-bmp': case 'image/vnd.wap.wbmp': return 'bmp'
    case 'image/x-icon': case 'image/vnd.microsoft.icon': return 'ico'
    case 'image/tiff': case 'image/x-tiff': return 'tiff'
    case 'image/x-tga': case 'image/x-truevision': case 'image/x-targa': return 'tga'
    case 'application/pdf': return 'pdf'
    case 'application/postscript': return 'eps'
    default: return null
  }
}

const RAW_EXTENSIONS = new Set([
  'dng','cr2','cr3','nef','nrw','arw','srf','sr2','raf','orf','rw2','pef',
  '3fr','fff','iiq','kdc','dcr','mrw','x3f','erf','mef','mos','rwl','raw',
])

export function formatFromFileName(name: string | undefined | null): ImportFormatId | null {
  if (!name) return null
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (RAW_EXTENSIONS.has(ext)) return 'raw'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'eps' || ext === 'ps') return 'eps'
  // Modern Illustrator files are PDF-compatible. Legacy Illustrator EPS files
  // are identified by their %!PS magic before this filename fallback runs.
  if (ext === 'ai') return 'pdf'
  if (ext === 'heic' || ext === 'heif' || ext === 'hif') return 'heic'
  if (ext === 'jxl') return 'jxl'
  if (ext === 'jp2' || ext === 'j2k' || ext === 'j2c' || ext === 'jpx') return 'jp2'
  return null


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
  try {
    const bitmap = await createImageBitmap(file)
    const c = createCanvas(bitmap.width, bitmap.height)
    ctx2d(c).drawImage(bitmap, 0, 0)
    bitmap.close()
    return c
  } catch (bitmapError) {
    const Decoder = (globalThis as any).ImageDecoder
    if (typeof Decoder !== 'function') throw bitmapError
    const mime = file.type.startsWith('image/') ? file.type : (
      format === 'heic' ? 'image/heic' :
      format === 'jxl' ? 'image/jxl' :
      format === 'jp2' ? 'image/jp2' :
      format === 'avif' ? 'image/avif' : ''
    )
    if (!mime) throw bitmapError
    const decoder = new Decoder({ data: await file.arrayBuffer(), type: mime })
    try {
      await decoder.tracks.ready
      const decoded = await decoder.decode({ frameIndex: 0 })
      const image = decoded.image
      const w = image.displayWidth || image.codedWidth
      const h = image.displayHeight || image.codedHeight
      const c = createCanvas(w, h)
      ctx2d(c).drawImage(image, 0, 0)
      image.close?.()
      return c
    } finally {
      decoder.close?.()
    }
  }
}

function fromRaw(raw: RawImage, format: string): DecodedImage {
  return {
    canvas: rawToCanvas(raw),
    width: raw.width,
    height: raw.height,
    hasAlpha: scanAlpha(raw.rgba),
    format,
    sourceBitDepth: raw.sourceBitDepth ?? 8,
    sourceFloatPixels: raw.rgbaFloat,
    sourceColorSpace: raw.sourceColorSpace,
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
  const named = formatFromFileName((file as File).name)
  // RAW extensions override container-like magic (notably DNG's TIFF header)
  // so LibRaw performs demosaic / camera color processing.
  let format = named === 'raw' ? 'raw' : detectFormat(bytes)
  if (!format) format = formatFromMime(file.type)
  if (!format) format = named
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
    case 'pfm': return fromRaw(decodePfm(bytes), 'pfm')
    case 'hdr': return fromRaw(decodeRadianceHdr(bytes), 'hdr')
    case 'qoi': return fromRaw(decodeQoi(bytes), 'qoi')
    case 'pcx': return fromRaw(decodePcx(bytes), 'pcx')
    case 'bmp': return fromRaw(decodeBmp(bytes), 'bmp')
    case 'ico': return fromRaw(await decodeIco(bytes), 'ico')
    case 'heic': return fromRaw(await decodeBundledHeic(bytes), 'heic')
    case 'jxl': return fromRaw(await decodeBundledJxl(bytes), 'jxl')
    case 'jp2': return fromRaw(await decodeBundledJp2(bytes), 'jp2')
    case 'raw': return fromRaw(await decodeBundledRaw(bytes), 'raw')
    case 'pdf': {
      const canvas = await decodeBundledPdf(bytes)
      return { canvas, width: canvas.width, height: canvas.height, hasAlpha: scanAlpha(getImageData(canvas).data), format: 'pdf', sourceBitDepth: 8 }
    }
    case 'eps': {
      const canvas = decodeBundledEps(bytes)
      return { canvas, width: canvas.width, height: canvas.height, hasAlpha: scanAlpha(getImageData(canvas).data), format: 'eps', sourceBitDepth: 8 }
    }
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
      // png / jpeg / gif / webp / avif / svg — native. HEIC/JXL/JP2
      // never reach this fallback: they use the bundled codecs above.
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
  options: ('quality' | 'background' | 'icoSizes' | 'tiffCompression' | 'tiffBitDepth' | 'psdLayers')[]
  /** one-line hint rendered under the format select */
  hint: string
}

/** every export format the UI offers, in menu order */
export const FORMAT_INFO: ExportFormatInfo[] = [
  { id: 'png', label: 'PNG', ext: 'png', alpha: true, options: [], hint: 'PNG — lossless, alpha' },
  { id: 'jpeg', label: 'JPEG', ext: 'jpg', alpha: false, options: ['quality', 'background'], hint: 'JPEG — lossy, no alpha (flattened)' },
  { id: 'webp', label: 'WebP', ext: 'webp', alpha: true, options: ['quality'], hint: 'WebP — lossy, alpha' },
  { id: 'tiff', label: 'TIFF', ext: 'tif', alpha: true, options: ['tiffCompression', 'tiffBitDepth'], hint: 'TIFF — 8/16-bit RGBA, LZW lossless, alpha' },
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
  /** TIFF channel precision; 16 requires a float16 working canvas. */
  tiffBitDepth?: 8 | 16
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
      const lzw = (opts.tiffCompression ?? 'lzw') === 'lzw'
      if (opts.tiffBitDepth === 16) {
        const hi = getFloat16ImageData(canvas)
        if (hi?.data) return u8Blob(encodeTiff16(hi.data, w, h, lzw), 'image/tiff')
      }
      const img = getImageData(canvas)
      return u8Blob(encodeTiff(img.data, w, h, lzw), 'image/tiff')
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
