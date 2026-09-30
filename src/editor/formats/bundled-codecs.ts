import { createCanvas, ctx2d } from '../utils/canvas'
import { decodeEpsPostScript } from './eps'
import type { RawImage } from './decoders'

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer
  }
  return bytes.slice().buffer as ArrayBuffer
}

function imageDataToRaw(img: ImageData, sourceBitDepth = 8): RawImage {
  return {
    width: img.width,
    height: img.height,
    rgba: new Uint8ClampedArray(img.data),
    sourceBitDepth,
  }
}

export async function decodeBundledHeic(bytes: Uint8Array): Promise<RawImage> {
  const mod: any = await import('@discourse/heic')
  const decode = mod.decode ?? mod.default
  if (typeof decode !== 'function') throw new Error('Bundled HEIC decoder did not expose decode()')
  const img = await decode(exactArrayBuffer(bytes))
  if (!img?.data || !img?.width || !img?.height) throw new Error('HEIC decoder returned no image')
  return imageDataToRaw(img, 8)
}

export async function decodeBundledJxl(bytes: Uint8Array): Promise<RawImage> {
  const mod: any = await import('@jsquash/jxl')
  const decode = mod.decode ?? mod.default
  if (typeof decode !== 'function') throw new Error('Bundled JPEG XL decoder did not expose decode()')
  const img = await decode(exactArrayBuffer(bytes))
  if (!img?.data || !img?.width || !img?.height) throw new Error('JPEG XL decoder returned no image')
  // The current jSquash decode API returns ImageData. High-bit JXL encoding is
  // supported by the library, but decoded output is presently browser ImageData.
  return imageDataToRaw(img, 8)
}

export async function decodeBundledJp2(bytes: Uint8Array): Promise<RawImage> {
  const mod: any = await import('jpeg2000')
  const JpxImage = mod.JpxImage ?? mod.default?.JpxImage
  if (typeof JpxImage !== 'function') throw new Error('Bundled JPEG 2000 decoder did not expose JpxImage')
  const jpx = new JpxImage()
  jpx.parse(bytes)
  const width = Number(jpx.width) || 0
  const height = Number(jpx.height) || 0
  const components = Math.max(1, Number(jpx.componentsCount) || 3)
  if (width < 1 || height < 1 || width * height > 268435456) throw new Error('Invalid JPEG 2000 dimensions')
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  for (const tile of jpx.tiles ?? []) {
    const tw = Number(tile.width) || 0
    const th = Number(tile.height) || 0
    const left = Number(tile.left) || 0
    const top = Number(tile.top) || 0
    const src: Uint8Array = tile.items
    if (!src || tw < 1 || th < 1) continue
    const tilePixels = tw * th
    // jpeg2000 exposes interleaved component bytes in each decoded tile.
    const stride = Math.max(1, Math.floor(src.length / Math.max(1, tilePixels)))
    for (let y = 0; y < th; y++) {
      const dy = top + y
      if (dy < 0 || dy >= height) continue
      for (let x = 0; x < tw; x++) {
        const dx = left + x
        if (dx < 0 || dx >= width) continue
        const si = (y * tw + x) * stride
        const di = (dy * width + dx) * 4
        if (components === 1 || stride === 1) {
          const v = src[si] ?? 0
          rgba[di] = v; rgba[di + 1] = v; rgba[di + 2] = v
        } else {
          rgba[di] = src[si] ?? 0
          rgba[di + 1] = src[si + 1] ?? rgba[di]
          rgba[di + 2] = src[si + 2] ?? rgba[di + 1]
          if (components >= 4 && stride >= 4) rgba[di + 3] = src[si + 3] ?? 255
        }
      }
    }
  }
  return { width, height, rgba, sourceBitDepth: 8 }
}

function normalizeRawResult(result: any): RawImage {
  if (!result) throw new Error('RAW decoder returned no image')
  const width = Number(result.width ?? result.imageWidth ?? result.raw_width ?? result.rawWidth) || 0
  const height = Number(result.height ?? result.imageHeight ?? result.raw_height ?? result.rawHeight) || 0
  const data = result.data ?? result.imageData ?? result.pixels
  if (width < 1 || height < 1 || !data) throw new Error('RAW decoder returned invalid dimensions or pixels')
  const n = width * height
  const channels = Math.max(1, Math.min(4, Math.round(Number(result.colors ?? result.channels ?? result.components) || (data.length / n))))
  const rgba = new Uint8ClampedArray(n * 4)

  if (data instanceof Uint16Array) {
    const rgba16 = new Uint16Array(n * 4)
    for (let i = 0, s = 0, o = 0; i < n; i++, s += channels, o += 4) {
      if (channels === 1) {
        const v = data[s] ?? 0
        rgba16[o] = v; rgba16[o + 1] = v; rgba16[o + 2] = v
      } else {
        rgba16[o] = data[s] ?? 0
        rgba16[o + 1] = data[s + 1] ?? rgba16[o]
        rgba16[o + 2] = data[s + 2] ?? rgba16[o + 1]
      }
      rgba16[o + 3] = channels >= 4 ? data[s + 3] ?? 65535 : 65535
      rgba[o] = rgba16[o] >>> 8
      rgba[o + 1] = rgba16[o + 1] >>> 8
      rgba[o + 2] = rgba16[o + 2] >>> 8
      rgba[o + 3] = rgba16[o + 3] >>> 8
    }
    return { width, height, rgba, rgba16, sourceBitDepth: 16 }
  }

  const src: ArrayLike<number> = data
  for (let i = 0, s = 0, o = 0; i < n; i++, s += channels, o += 4) {
    if (channels === 1) {
      const v = Number(src[s]) || 0
      rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v
    } else {
      rgba[o] = Number(src[s]) || 0
      rgba[o + 1] = Number(src[s + 1]) || rgba[o]
      rgba[o + 2] = Number(src[s + 2]) || rgba[o + 1]
    }
    rgba[o + 3] = channels >= 4 ? Number(src[s + 3]) || 255 : 255
  }
  return { width, height, rgba, sourceBitDepth: 8 }
}

export async function decodeBundledRaw(bytes: Uint8Array): Promise<RawImage> {
  const mod: any = await import('libraw-wasm')
  const LibRaw = mod.default ?? mod.LibRaw
  if (typeof LibRaw !== 'function') throw new Error('Bundled RAW decoder did not expose LibRaw')
  const raw = new LibRaw()
  try {
    await raw.open(bytes, {
      outputBps: 16,
      outputColor: 1,
      useCameraWb: true,
      useCameraMatrix: 1,
      highlight: 2,
      noAutoBright: false,
      userQual: 3,
    })
    const result = await raw.imageData()
    return normalizeRawResult(result)
  } finally {
    try { await raw.close?.() } catch { /* optional lifecycle method */ }
    try { raw.destroy?.() } catch { /* optional lifecycle method */ }
  }
}

export function decodeBundledEps(bytes: Uint8Array): HTMLCanvasElement {
  return decodeEpsPostScript(bytes)
}
