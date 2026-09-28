// Photopea-compatible import surface and best-effort container / RAW fallbacks.
// The exact extension groups mirror Photopea's published supported-format list.
// Native / custom codecs remain the preferred path; these helpers cover formats
// whose browser decoder support is platform-dependent or whose editable document
// model is proprietary by extracting a safe raster preview when one is embedded.

export const PHOTOPEA_COMPLEX_EXTENSIONS = [
  'psd', 'psb', 'ai', 'indd', 'xcf', 'sketch', 'xd', 'fig', 'kri', 'kra',
  'clip', 'sai', 'pxd', 'pxz', 'cdr', 'ufo', 'afphoto', 'gvdesign',
  'svg', 'eps', 'pdf', 'pdn', 'wmf', 'emf',
] as const

export const PHOTOPEA_RASTER_EXTENSIONS = [
  'png', 'apng', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'ico', 'icns', 'bmp',
  'avif', 'heic', 'heif', 'hif', 'jxl', 'ppm', 'pgm', 'pbm', 'pam',
  'tif', 'tiff', 'dds', 'iff', 'ilbm', 'lbm', 'exr', 'hdr', 'rgbe',
  'anim', 'tga', 'icb', 'vda', 'vst',
] as const

export const PHOTOPEA_RAW_EXTENSIONS = [
  'dng', 'nef', 'cr2', 'cr3', 'arw', 'rw2', 'raf', 'orf', 'gpr', '3fr', 'fff',
] as const

export const PHOTOPEA_ANIMATED_EXTENSIONS = [
  'gif', 'apng', 'mp4', 'webm', 'mkv',
] as const

// Chay's Photo Studio already supports several useful formats beyond that list.
export const EXTRA_IMPORT_EXTENSIONS = [
  'qoi', 'pcx', 'dcx', 'pfm', 'jp2', 'j2k', 'j2c',
] as const

const COMPLEX = new Set<string>(PHOTOPEA_COMPLEX_EXTENSIONS)
const RASTER = new Set<string>(PHOTOPEA_RASTER_EXTENSIONS)
const RAW = new Set<string>(PHOTOPEA_RAW_EXTENSIONS)
const ANIMATED = new Set<string>(PHOTOPEA_ANIMATED_EXTENSIONS)
const EXTRA = new Set<string>(EXTRA_IMPORT_EXTENSIONS)

export type PublishedFormatKind = 'complex' | 'raster' | 'raw' | 'video' | 'extra'

export function fileExtension(name: string): string {
  const clean = (name || '').toLowerCase().split(/[?#]/, 1)[0]
  const dot = clean.lastIndexOf('.')
  return dot >= 0 ? clean.slice(dot + 1) : ''
}

export function publishedFormatKind(name: string): PublishedFormatKind | null {
  const ext = fileExtension(name)
  if (!ext) return null
  if (RAW.has(ext)) return 'raw'
  if (ext === 'mp4' || ext === 'webm' || ext === 'mkv') return 'video'
  if (COMPLEX.has(ext)) return 'complex'
  if (RASTER.has(ext)) return 'raster'
  if (EXTRA.has(ext)) return 'extra'
  return null
}

export function isPhotopeaPublishedExtension(name: string): boolean {
  return publishedFormatKind(name) !== null
}

const ACCEPT_EXTENSIONS = Array.from(new Set([
  ...PHOTOPEA_COMPLEX_EXTENSIONS,
  ...PHOTOPEA_RASTER_EXTENSIONS,
  ...PHOTOPEA_RAW_EXTENSIONS,
  ...PHOTOPEA_ANIMATED_EXTENSIONS,
  ...EXTRA_IMPORT_EXTENSIONS,
]))

export const PHOTOPEA_IMPORT_ACCEPT =
  'image/*,video/mp4,video/webm,video/x-matroska,' +
  ACCEPT_EXTENSIONS.map(ext => `.${ext}`).join(',')

function mimeForName(name: string): string {
  switch (fileExtension(name)) {
    case 'png': case 'apng': return 'image/png'
    case 'jpg': case 'jpeg': case 'jfif': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'avif': return 'image/avif'
    case 'heic': case 'heif': case 'hif': return 'image/heic'
    case 'jxl': return 'image/jxl'
    case 'jp2': case 'j2k': case 'j2c': return 'image/jp2'
    case 'svg': return 'image/svg+xml'
    case 'bmp': return 'image/bmp'
    case 'tif': case 'tiff': return 'image/tiff'
    case 'ico': return 'image/x-icon'
    case 'mp4': return 'video/mp4'
    case 'webm': return 'video/webm'
    case 'mkv': return 'video/x-matroska'
    default: return 'application/octet-stream'
  }
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  try {
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, bitmap.width)
    canvas.height = Math.max(1, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    return canvas
  } catch (bitmapError) {
    const url = URL.createObjectURL(blob)
    try {
      const image = new Image()
      image.decoding = 'async'
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(bitmapError)
        image.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, image.naturalWidth)
      canvas.height = Math.max(1, image.naturalHeight)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 2D context unavailable')
      ctx.drawImage(image, 0, 0)
      return canvas
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

export async function decodeVideoFrame(file: File | Blob): Promise<HTMLCanvasElement> {
  if (typeof document === 'undefined') throw new Error('Video import requires a browser canvas runtime')
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  const wait = (event: string, timeoutMs = 15000) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out decoding video frame')), timeoutMs)
    const done = () => { clearTimeout(timer); cleanup(); resolve() }
    const fail = () => { clearTimeout(timer); cleanup(); reject(new Error('The browser could not decode this video container')) }
    const cleanup = () => {
      video.removeEventListener(event, done)
      video.removeEventListener('error', fail)
    }
    video.addEventListener(event, done, { once: true })
    video.addEventListener('error', fail, { once: true })
  })
  try {
    video.src = url
    await wait('loadedmetadata')
    if (Number.isFinite(video.duration) && video.duration > 0.08) {
      video.currentTime = Math.min(0.1, Math.max(0, video.duration / 20))
      await wait('seeked')
    } else {
      await wait('loadeddata')
    }
    const width = Math.max(1, video.videoWidth)
    const height = Math.max(1, video.videoHeight)
    if (!video.videoWidth || !video.videoHeight) throw new Error('Video contains no decodable visual frame')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(video, 0, 0, width, height)
    return canvas
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

function u16le(view: DataView, off: number): number {
  return off + 2 <= view.byteLength ? view.getUint16(off, true) : 0
}
function u32le(view: DataView, off: number): number {
  return off + 4 <= view.byteLength ? view.getUint32(off, true) : 0
}

interface ZipCandidate {
  name: string
  compressedSize: number
  uncompressedSize: number
  compression: number
  localOffset: number
  priority: number
}

function zipImagePriority(name: string): number {
  const n = name.toLowerCase()
  if (/^(preview|preview\/preview|previews\/preview|mergedimage|thumbnail)\.(png|jpe?g|webp)$/i.test(n)) return 100
  if (/(^|\/)(preview|mergedimage|thumbnail)[^/]*\.(png|jpe?g|webp)$/i.test(n)) return 90
  if (/\.(png|jpe?g|webp|avif)$/i.test(n)) return 30
  if (/\.svg$/i.test(n)) return 10
  return 0
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as any).DecompressionStream
  if (typeof DS !== 'function') throw new Error('ZIP preview needs DecompressionStream')
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DS('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function extractZipPreview(bytes: Uint8Array): Promise<{ data: Uint8Array; name: string } | null> {
  if (bytes.length < 22) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  const min = Math.max(0, bytes.length - 0xffff - 22)
  for (let p = bytes.length - 22; p >= min; p--) {
    if (u32le(view, p) === 0x06054b50) { eocd = p; break }
  }
  if (eocd < 0) return null
  const count = Math.min(100000, u16le(view, eocd + 10))
  let p = u32le(view, eocd + 16)
  const candidates: ZipCandidate[] = []
  const decoder = new TextDecoder('utf-8', { fatal: false })
  for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
    if (u32le(view, p) !== 0x02014b50) break
    const compression = u16le(view, p + 10)
    const compressedSize = u32le(view, p + 20)
    const uncompressedSize = u32le(view, p + 24)
    const nameLen = u16le(view, p + 28)
    const extraLen = u16le(view, p + 30)
    const commentLen = u16le(view, p + 32)
    const localOffset = u32le(view, p + 42)
    if (p + 46 + nameLen > bytes.length) break
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    const priority = zipImagePriority(name)
    if (priority && uncompressedSize > 0 && uncompressedSize <= 128 * 1024 * 1024 && (compression === 0 || compression === 8)) {
      candidates.push({ name, compressedSize, uncompressedSize, compression, localOffset, priority })
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  candidates.sort((a, b) => (b.priority - a.priority) || (b.uncompressedSize - a.uncompressedSize))
  for (const entry of candidates.slice(0, 12)) {
    const lp = entry.localOffset
    if (lp < 0 || lp + 30 > bytes.length || u32le(view, lp) !== 0x04034b50) continue
    const nameLen = u16le(view, lp + 26)
    const extraLen = u16le(view, lp + 28)
    const start = lp + 30 + nameLen + extraLen
    const end = start + entry.compressedSize
    if (start < 0 || end > bytes.length) continue
    try {
      const packed = bytes.subarray(start, end)
      const data = entry.compression === 0 ? packed.slice() : await inflateRaw(packed)
      if (data.length) return { data, name: entry.name }
    } catch {
      // Try the next preview candidate.
    }
  }
  return null
}

interface EmbeddedCandidate { start: number; end: number; mime: string; score: number }

function embeddedRasterCandidates(bytes: Uint8Array): EmbeddedCandidate[] {
  const out: EmbeddedCandidate[] = []
  const n = bytes.length
  // PNG: signature through the complete IEND chunk.
  for (let i = 0; i + 24 < n; i++) {
    if (bytes[i] !== 0x89 || bytes[i + 1] !== 0x50 || bytes[i + 2] !== 0x4e || bytes[i + 3] !== 0x47 ||
        bytes[i + 4] !== 0x0d || bytes[i + 5] !== 0x0a || bytes[i + 6] !== 0x1a || bytes[i + 7] !== 0x0a) continue
    let p = i + 8
    let end = -1
    while (p + 12 <= n) {
      const len = (bytes[p] * 0x1000000) + (bytes[p + 1] << 16) + (bytes[p + 2] << 8) + bytes[p + 3]
      if (len < 0 || len > 128 * 1024 * 1024 || p + 12 + len > n) break
      const isIend = bytes[p + 4] === 0x49 && bytes[p + 5] === 0x45 && bytes[p + 6] === 0x4e && bytes[p + 7] === 0x44
      p += 12 + len
      if (isIend) { end = p; break }
    }
    if (end > i) {
      out.push({ start: i, end, mime: 'image/png', score: end - i })
      i = end - 1
    }
  }
  // JPEG: SOI through EOI. Camera RAW files commonly carry multiple previews;
  // choosing the largest gives the full-resolution embedded preview when present.
  for (let i = 0; i + 4 < n; i++) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xd8 || bytes[i + 2] !== 0xff) continue
    let end = -1
    for (let p = i + 3; p + 1 < n; p++) {
      if (bytes[p] === 0xff && bytes[p + 1] === 0xd9) { end = p + 2; break }
    }
    if (end > i + 1024) {
      out.push({ start: i, end, mime: 'image/jpeg', score: end - i })
      i = Math.max(i, end - 2)
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

export async function decodePublishedFormatPreview(file: File | Blob, name = (file as File).name || ''): Promise<HTMLCanvasElement> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // ZIP-based document formats include Sketch, XD and Krita. Prefer their
  // authored preview / merged image over blind byte scanning.
  try {
    const zip = await extractZipPreview(bytes)
    if (zip) {
      return await blobToCanvas(new Blob([zip.data as unknown as BlobPart], { type: mimeForName(zip.name) }))
    }
  } catch {
    // Continue with embedded-raster scanning.
  }
  const candidates = embeddedRasterCandidates(bytes)
  for (const candidate of candidates.slice(0, 8)) {
    try {
      return await blobToCanvas(new Blob([
        bytes.subarray(candidate.start, candidate.end) as unknown as BlobPart,
      ], { type: candidate.mime }))
    } catch {
      // Continue; proprietary files often contain tiny undecodable thumbnails.
    }
  }
  // Last chance: some runtimes have native decoders for formats not exposed by
  // the standard MIME registry. Preserve the source bytes and let the runtime sniff.
  try {
    return await blobToCanvas(new Blob([bytes as unknown as BlobPart], { type: file.type || mimeForName(name) }))
  } catch {
    const ext = fileExtension(name)
    throw new Error(
      `${ext ? ext.toUpperCase() : 'This'} file is recognized, but this runtime has no decoder and the file contains no usable embedded preview`,
    )
  }
}
