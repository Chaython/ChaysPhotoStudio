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
  detectFormat, decodeTiff, tiffPageOffsets, decodeTga, decodePnm, decodePfm, decodeRadianceHdr, decodeQoi, decodePcx, dcxPageOffsets, decodeBmp, decodeIco,
  rawToCanvas, scanAlpha,
} from './decoders'
import {
  encodeTiff, encodeTiff16, encodeBmp, encodeTga, encodeQoi, encodePpm, encodeIco,
} from './encoders'
import { decodePsd, psdBlendKeyToMode } from './psd'
import type { ImportFormatId, RawImage } from './decoders'
import type { ExportFormatId } from './encoders'
import { decodePublishedFormatPreview, fileExtension, isPhotopeaPublishedExtension, publishedFormatKind, PHOTOPEA_IMPORT_ACCEPT } from './photopea-formats'
import { hasDedicatedDocumentParser, parseStructuredDocument } from './structured'
import { decodeDds, decodeIcns, decodeIff } from './legacy-raster'
import { decodeSgi, decodeSunRaster } from './heritage-raster'
import { decodeFits } from './scientific-fits'
import { decodeDicom } from './scientific-dicom'
import type { RawDevelopSettings } from './raw-develop'
import type { ParsedDocumentLayer } from './document-parser-types'
import type { ImageMetadata, LayerFX } from '../types'
import { buildWritableXmp, embedRasterMetadata } from './metadata-write'

export type { ImportFormatId, RawImage } from './decoders'
export type { ExportFormatId } from './encoders'
export type { PsdDecoded, PsdLayer, PsdLayerInput } from './psd'
export type { ParsedDocument, ParsedDocumentLayer } from './document-parser-types'
export { detectFormat, rawToCanvas, scanAlpha } from './decoders'
export { buildOpenRaster } from './openraster'
export { ICO_SIZE_POOL } from './encoders'
export { decodePsd, buildPsd, psdBlendKeyToMode, blendModeToPsdKey } from './psd'
export { PHOTOPEA_IMPORT_ACCEPT, PHOTOPEA_COMPLEX_EXTENSIONS, PHOTOPEA_RASTER_EXTENSIONS, PHOTOPEA_RAW_EXTENSIONS, PHOTOPEA_ANIMATED_EXTENSIONS, EXTRA_IMPORT_EXTENSIONS, fileExtension, publishedFormatKind, isPhotopeaPublishedExtension } from './photopea-formats'
export { hasDedicatedDocumentParser, parseStructuredDocument } from './structured'

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
  /** Semantic layers supplied by dedicated non-PSD document parsers. */
  documentLayers?: ParsedDocumentLayer[]
  warnings?: string[]
  psdImageResources?: Uint8Array[]
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
    /** editable layer style decoded from PSD effect metadata when supported */
    fx?: LayerFX | null
    /** opaque Photoshop additional-layer-information blocks */
    additionalInfo?: Uint8Array[]
  }[]
}

/** file-input `accept` value covering every decodable format */
export const IMPORT_ACCEPT = `${PHOTOPEA_IMPORT_ACCEPT},.zproj.json`

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
export async function decodeFile(file: File | Blob, options?: { rawSettings?: RawDevelopSettings }): Promise<DecodedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const sourceName = (file as File).name || ''
  if (fileExtension(sourceName) === 'bpg') {
    throw new Error('BPG decoding is unavailable: no reviewed decoder is bundled. Recognition does not imply image decoding support.')
  }
  // Dedicated structured parsers keep editable objects/layers for supported
  // document containers. A composite preview is still attached for Place,
  // Open-as-Layer and callers that only understand a canvas.
  if (sourceName && hasDedicatedDocumentParser(sourceName)) {
    const parsed = await parseStructuredDocument(file, sourceName)
    if (parsed) {
      let canvas = parsed.composite ?? null
      if (!canvas) {
        try { canvas = await decodePublishedFormatPreview(file, sourceName) }
        catch { canvas = createCanvas(parsed.width, parsed.height) }
      }
      return {
        canvas,
        width: parsed.width,
        height: parsed.height,
        hasAlpha: scanAlpha(getImageData(canvas).data),
        format: fileExtension(sourceName),
        sourceBitDepth: parsed.sourceBitDepth ?? 8,
        resolutionPpi: parsed.resolutionPpi,
        documentLayers: parsed.layers,
        warnings: parsed.warnings,
      }
    }
  }
  // Most camera RAW formats are TIFF-family containers. Their magic bytes
  // therefore look like ordinary TIFF even though the sensor payload is not a
  // baseline RGB TIFF. Route them to the RAW/embedded-preview path before the
  // TIFF codec gets a chance to misclassify them.
  if (publishedFormatKind(sourceName) === 'raw') {
    try {
      const { decodeCameraRaw } = await import('./wasm-codecs')
      const rendered = fromRaw(await decodeCameraRaw(bytes.buffer as ArrayBuffer, options?.rawSettings), fileExtension(sourceName))
      rendered.warnings = ['Decoded original RAW sensor image through LibRaw. 16-bit precision is retained where supported.']
      return rendered
    } catch (rawError) {
      const canvas = await decodePublishedFormatPreview(file, sourceName)
      return {
        canvas, width: canvas.width, height: canvas.height,
        hasAlpha: scanAlpha(getImageData(canvas).data),
        format: fileExtension(sourceName), sourceBitDepth: 8,
        warnings: ['RAW sensor decoding failed (' +
          (rawError instanceof Error ? rawError.message : String(rawError)) +
          '). Imported an embedded 8-bit preview instead.'],
      }
    }
  }
  if (['jls', 'jxr', 'wdp', 'hdp'].includes(fileExtension(sourceName))) {
    const wasm = await import('./wasm-codecs')
    const ext = fileExtension(sourceName)
    const decoded = ext === 'jls' ? await wasm.decodeJpegLs(bytes.buffer as ArrayBuffer)
      : await wasm.decodeModernWasm(bytes.buffer as ArrayBuffer, 'jxr')
    return fromRaw(decoded, ext)
  }
  let format = detectFormat(bytes)
  if (!format) format = formatFromMime(file.type)
  if (!format) {
    const name = (file as File).name || ''
    if (isPhotopeaPublishedExtension(name)) {
      const canvas = publishedFormatKind(name) === 'video'
        ? (await import('./photopea-formats')).decodeVideoFrame(file)
        : decodePublishedFormatPreview(file, name)
      const resolved = await canvas
      return {
        canvas: resolved,
        width: resolved.width,
        height: resolved.height,
        hasAlpha: scanAlpha(getImageData(resolved).data),
        format: fileExtension(name) || file.type || 'unknown',
        sourceBitDepth: 8,
      }
    }
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
    case 'tiff': {
      const pages = tiffPageOffsets(bytes)
      if (pages.length < 2) return fromRaw(await decodeTiff(bytes), 'tiff')
      const decoded = await Promise.all(pages.map((_, page) => decodeTiff(bytes, page)))
      const first = fromRaw(decoded[0], 'tiff')
      return {
        ...first,
        documentLayers: decoded.map((page, index) => ({
          kind: 'raster' as const, name: 'TIFF page ' + (index + 1),
          canvas: rawToCanvas(page), left: 0, top: 0, visible: index === 0,
        })),
        warnings: ['Imported ' + pages.length + ' TIFF pages as separate layers. Toggle page visibility in Layers.'],
      }
    }
    case 'tga': return fromRaw(decodeTga(bytes), 'tga')
    case 'ppm': return fromRaw(decodePnm(bytes), 'ppm')
    case 'pfm': return fromRaw(decodePfm(bytes), 'pfm')
    case 'hdr': return fromRaw(decodeRadianceHdr(bytes), 'hdr')
    case 'qoi': return fromRaw(decodeQoi(bytes), 'qoi')
    case 'pcx': {
      const pages = dcxPageOffsets(bytes)
      if (pages.length < 2) return fromRaw(decodePcx(bytes), 'pcx')
      const decoded = pages.map((_, index) => decodePcx(bytes, index))
      const first = fromRaw(decoded[0], 'pcx')
      return {
        ...first,
        documentLayers: decoded.map((page, index) => ({
          kind: 'raster' as const, name: 'DCX page ' + (index + 1),
          canvas: rawToCanvas(page), left: 0, top: 0, visible: index === 0,
        })),
        warnings: ['Imported ' + pages.length + ' DCX pages as separate layers. Toggle page visibility in Layers.'],
      }
    }
    case 'bmp': return fromRaw(decodeBmp(bytes), 'bmp')
    case 'ico': return fromRaw(await decodeIco(bytes), 'ico')
    case 'dds': return fromRaw(decodeDds(bytes), 'dds')
    case 'exr': {
      const {decodeExrParts}=await import('./openexr')
      const parts=await decodeExrParts(bytes)
      if(parts.length===1)return fromRaw(parts[0].image,'exr')
      const base=fromRaw(parts[0].image,'exr')
      return {...base,documentLayers:parts.map((part,index)=>({
        kind:'raster' as const,name:part.name,
        canvas:rawToCanvas(part.image),hdrPixels:part.image.rgbaFloat,
        left:0,top:0,visible:index===0,
      })),warnings:['EXR has '+parts.length+' regular image parts. Layer previews may be reduced to the canvas working precision; retain the original EXR for HDR-authoritative samples.'],
      }
    }
    case 'jp2': {
      const { decodeJpeg2000 } = await import('./wasm-codecs')
      return fromRaw(await decodeJpeg2000(bytes.buffer as ArrayBuffer), 'jp2')
    }
    case 'fits':
    case 'dicom': {
      const parsed = format === 'fits' ? decodeFits(bytes) : await decodeDicom(bytes)
      const first = fromRaw(parsed.image, format)
      return {
        ...first,
        documentLayers: parsed.frames.length > 1 ? parsed.frames.map((frame, i) => ({
          kind: 'raster' as const,
          name: (format === 'fits' ? 'FITS slice ' : 'DICOM frame ') + (i + 1),
          canvas: rawToCanvas(frame), left: 0, top: 0, visible: i === 0,
        })) : undefined,
        warnings: parsed.warnings,
      }
    }
    case 'sgi': return fromRaw(decodeSgi(bytes), 'sgi')
    case 'sunras': return fromRaw(decodeSunRaster(bytes), 'sunras')
    case 'iff': return fromRaw(decodeIff(bytes), 'iff')
    case 'anim': return fromRaw(decodeIff(bytes), 'anim')
    case 'icns': {
      const canvas = await decodeIcns(bytes)
      return { canvas, width: canvas.width, height: canvas.height, hasAlpha: scanAlpha(getImageData(canvas).data), format: 'icns', sourceBitDepth: 8 }
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
        psdImageResources: psd.imageResources.map(b => b.slice()),
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
          additionalInfo: l.additionalInfo.map(b => b.slice()),
        })),
      }
    }
    default: {
      // png / jpeg / gif / webp / avif / svg — native
      try {
        const canvas = await decodeNativeCanvas(file, format)
        return {
          canvas, width: canvas.width, height: canvas.height,
          hasAlpha: scanAlpha(getImageData(canvas).data),
          format, sourceBitDepth: 8,
        }
      } catch (nativeError) {
        if (format === 'jxl' || format === 'heic') {
          const { decodeModernWasm } = await import('./wasm-codecs')
          return fromRaw(await decodeModernWasm(bytes.buffer as ArrayBuffer, format), format)
        }
        throw nativeError
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
  { id: 'ora', label: 'OpenRaster (GIMP/Krita layers)', ext: 'ora', alpha: true, options: [], hint: 'OpenRaster — editable PNG layers; unsupported effects are rasterized' },
  { id: 'psd', label: 'PSD (layers)', ext: 'psd', alpha: true, options: ['psdLayers'], hint: 'PSD — layers + composite' },
]

export interface EncodeCanvasOptions {
  /** 1..100 (jpeg / webp) */
  quality?: number
  /** Document File Info metadata written as XMP/IPTC/EXIF when supported. */
  metadata?: ImageMetadata
  /** False strips editable File Info while still retaining non-personal print resolution. */
  includeMetadata?: boolean
  /** Physical document resolution embedded into PNG/JPEG/WebP/TIFF. */
  resolutionPpi?: number
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
    case 'png': {
      const blob = await canvasToBlob(canvas, 'image/png')
      return embedRasterMetadata(blob, 'png', opts.includeMetadata === false ? undefined : opts.metadata, {
        resolutionPpi: opts.resolutionPpi ?? 72,
        width: w,
        height: h,
        hasAlpha: hasAnyAlpha(canvas),
      })
    }
    case 'jpeg': {
      // JPEG has no alpha — flatten onto the chosen background first
      const src = hasAnyAlpha(canvas) ? flattenOn(canvas, bg) : canvas
      const blob = await canvasToBlob(src, 'image/jpeg', Math.min(1, Math.max(0.01, (opts.quality ?? 92) / 100)))
      return embedRasterMetadata(blob, 'jpeg', opts.includeMetadata === false ? undefined : opts.metadata, {
        resolutionPpi: opts.resolutionPpi ?? 72,
        width: w,
        height: h,
        hasAlpha: false,
      })
    }
    case 'webp': {
      const blob = await canvasToBlob(canvas, 'image/webp', Math.min(1, Math.max(0.01, (opts.quality ?? 92) / 100)))
      return embedRasterMetadata(blob, 'webp', opts.includeMetadata === false ? undefined : opts.metadata, {
        resolutionPpi: opts.resolutionPpi ?? 72,
        width: w,
        height: h,
        hasAlpha: hasAnyAlpha(canvas),
      })
    }
    case 'tiff': {
      const lzw = (opts.tiffCompression ?? 'lzw') === 'lzw'
      const xmp = opts.includeMetadata === false ? undefined : buildWritableXmp(opts.metadata)
      const tiffMeta = {
        resolutionPpi: opts.resolutionPpi ?? 72,
        xmp: xmp ? new TextEncoder().encode(xmp) : undefined,
      }
      if (opts.tiffBitDepth === 16) {
        const hi = getFloat16ImageData(canvas)
        if (hi?.data) return u8Blob(encodeTiff16(hi.data, w, h, lzw, tiffMeta), 'image/tiff')
      }
      const img = getImageData(canvas)
      return u8Blob(encodeTiff(img.data, w, h, lzw, tiffMeta), 'image/tiff')
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
    case 'ora':
      throw new Error('OpenRaster export needs the layer stack — use buildOpenRaster() from the Export dialog')
  }
  throw new Error(`Unsupported export format: ${String(format)}`)
}
