// Additional raster decoders: SGI RGB/RGBA and Sun Raster.
// Both are binary formats used by older graphics and workstation tools.
// No network services, native binaries or browser image codecs are required.
import type { RawImage } from './decoders'

const MAX_PIXELS = 64 * 1024 * 1024

function dimensions(width: number, height: number, format: string): number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width * height > MAX_PIXELS) {
    throw new Error(`Invalid ${format} dimensions ${width}×${height}`)
  }
  return width * height
}

function result(width: number, height: number, rgba: Uint8ClampedArray, rgba16?: Uint16Array): RawImage {
  return { width, height, rgba: rgba as Uint8ClampedArray<ArrayBuffer>, rgba16, sourceBitDepth: rgba16 ? 16 : 8 }
}

/** Silicon Graphics .sgi/.rgb/.rgba/.bw, planar 8/16-bit, uncompressed or 8-bit RLE. */
export function decodeSgi(bytes: Uint8Array): RawImage {
  if (bytes.length < 512 || bytes[0] !== 1 || bytes[1] !== 0xda) throw new Error('Not an SGI image')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const storage = bytes[2], bpc = bytes[3]
  const width = view.getUint16(6, false), height = view.getUint16(8, false)
  const channels = view.getUint16(10, false)
  const colorMap = view.getUint32(104, false)
  const count = dimensions(width, height, 'SGI')
  if (storage > 1 || (bpc !== 1 && bpc !== 2) ||
      channels < 1 || channels > 4 || colorMap !== 0) {
    throw new Error('Unsupported SGI channel layout, compression, or colormap')
  }
  if (storage === 1 && bpc === 2) {
    throw new Error('16-bit SGI RLE is not supported (uncompressed 16-bit is supported)')
  }
  const rowCount = height * channels
  const tableEnd = 512 + rowCount * 8
  if (storage === 1 && (!Number.isSafeInteger(tableEnd) || tableEnd > bytes.length)) {
    throw new Error('Truncated SGI RLE row tables')
  }
  const rgba = new Uint8ClampedArray(count * 4)
  const rgba16 = bpc === 2 ? new Uint16Array(count * 4) : undefined
  for (let p = 3; p < rgba.length; p += 4) rgba[p] = 255
  if (rgba16) for (let p = 3; p < rgba16.length; p += 4) rgba16[p] = 65535

  for (let channel = 0; channel < channels; channel++) {
    for (let sy = 0; sy < height; sy++) {
      const samples = new Uint16Array(width)
      if (storage === 0) {
        const pos = 512 + (channel * height + sy) * width * bpc
        if (pos > bytes.length || width * bpc > bytes.length - pos) throw new Error('Truncated SGI pixel data')
        for (let x = 0; x < width; x++) {
          samples[x] = bpc === 1 ? bytes[pos + x] : view.getUint16(pos + x * 2, false)
        }
      } else {
        const index = channel * height + sy
        const offset = view.getUint32(512 + index * 4, false)
        const length = view.getUint32(512 + rowCount * 4 + index * 4, false)
        if (offset < tableEnd || length === 0 || offset > bytes.length || length > bytes.length - offset) {
          throw new Error('Invalid SGI RLE row range')
        }
        const end = offset + length
        let p = offset, x = 0
        while (p < end && x < width) {
          const op = bytes[p++], run = op & 0x7f
          if (run === 0) break
          if (x + run > width) throw new Error('SGI RLE exceeds row width')
          if (op & 0x80) {
            if (run > end - p) throw new Error('Truncated SGI RLE literal run')
            for (let i = 0; i < run; i++) samples[x++] = bytes[p++]
          } else {
            if (p >= end) throw new Error('Truncated SGI RLE repeat run')
            const value = bytes[p++]
            for (let i = 0; i < run; i++) samples[x++] = value
          }
        }
        if (x !== width) throw new Error('Truncated SGI RLE scanline')
      }
      // SGI's first stored row is the bottom row.
      const destRow = (height - 1 - sy) * width * 4
      for (let x = 0; x < width; x++) {
        const sample = samples[x]
        const eight = bpc === 1 ? sample : Math.round(sample / 257)
        const sixteen = bpc === 1 ? sample * 257 : sample
        const dest = destRow + x * 4
        const indexes = channels <= 2 && channel === 0 ? [0, 1, 2] :
          [channels <= 2 ? 3 : channel]
        for (const k of indexes) {
          rgba[dest + k] = eight
          if (rgba16) rgba16[dest + k] = sixteen
        }
      }
    }
  }
  return result(width, height, rgba, rgba16)
}

/** Sun Raster .ras, 1/8/24/32-bit, standard/RGB byte order and byte RLE. */
export function decodeSunRaster(bytes: Uint8Array): RawImage {
  if (bytes.length < 32 || bytes[0] !== 0x59 || bytes[1] !== 0xa6 ||
      bytes[2] !== 0x6a || bytes[3] !== 0x95) throw new Error('Not a Sun Raster file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(4, false), height = view.getUint32(8, false)
  const depth = view.getUint32(12, false), length = view.getUint32(16, false)
  const type = view.getUint32(20, false), mapType = view.getUint32(24, false)
  const mapLength = view.getUint32(28, false)
  const count = dimensions(width, height, 'Sun Raster')
  if (![1, 8, 24, 32].includes(depth) || ![0, 1, 2, 3].includes(type) ||
      ![0, 1].includes(mapType) || mapLength > 768) {
    throw new Error('Unsupported Sun Raster depth, encoding, or palette')
  }
  if (mapLength > bytes.length - 32) throw new Error('Truncated Sun Raster palette')
  if (mapType === 1 && (mapLength < 3 || mapLength % 3 !== 0)) throw new Error('Invalid Sun Raster RGB palette')
  const rowBytes = Math.ceil(width * depth / 8)
  const stride = (rowBytes + 1) & ~1
  const expected = stride * height
  const offset = 32 + mapLength
  if (offset > bytes.length || expected > MAX_PIXELS * 4 + height) {
    throw new Error('Invalid Sun Raster payload')
  }
  const available = bytes.length - offset
  const packedLength = length === 0 ? available : length
  if (packedLength > available) throw new Error('Truncated Sun Raster payload')
  let raster: Uint8Array
  if (type === 2) {
    raster = new Uint8Array(expected)
    let src = offset, dest = 0
    const end = offset + packedLength
    while (src < end && dest < expected) {
      const value = bytes[src++]
      if (value !== 0x80) { raster[dest++] = value; continue }
      if (src >= end) throw new Error('Truncated Sun Raster RLE marker')
      const run = bytes[src++]
      if (run === 0) { raster[dest++] = 0x80; continue }
      if (src >= end || run + 1 > expected - dest) throw new Error('Invalid Sun Raster RLE run')
      raster.fill(bytes[src++], dest, dest + run + 1)
      dest += run + 1
    }
    if (dest !== expected) throw new Error('Truncated Sun Raster RLE pixels')
  } else {
    if (expected > packedLength) throw new Error('Truncated Sun Raster pixels')
    raster = bytes.subarray(offset, offset + expected)
  }
  const rgba = new Uint8ClampedArray(count * 4)
  const paletteCount = mapType === 1 ? mapLength / 3 : 0
  const palette = bytes.subarray(32, 32 + mapLength)
  for (let y = 0; y < height; y++) {
    const row = y * stride
    for (let x = 0; x < width; x++) {
      const dest = (y * width + x) * 4
      let red = 0, green = 0, blue = 0, alpha = 255
      if (depth === 1 || depth === 8) {
        const idx = depth === 1 ? ((raster[row + (x >> 3)] >> (7 - (x & 7))) & 1) :
          raster[row + x]
        if (paletteCount) {
          if (idx >= paletteCount) throw new Error('Sun Raster palette index out of bounds')
          red = palette[idx]; green = palette[paletteCount + idx]; blue = palette[paletteCount * 2 + idx]
        } else {
          red = green = blue = depth === 1 ? (idx ? 0 : 255) : idx
        }
      } else {
        const pos = row + x * (depth / 8)
        const base = depth === 32 ? pos + 1 : pos
        if (type === 3) {
          red = raster[base]; green = raster[base + 1]; blue = raster[base + 2]
        } else {
          blue = raster[base]; green = raster[base + 1]; red = raster[base + 2]
        }
        if (depth === 32) alpha = raster[pos] || 255 // zero denotes unused padding in old XRGB files
      }
      rgba[dest] = red; rgba[dest + 1] = green; rgba[dest + 2] = blue; rgba[dest + 3] = alpha
    }
  }
  return result(width, height, rgba)
}
