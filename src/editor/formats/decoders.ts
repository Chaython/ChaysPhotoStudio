// ============================================================
// Chay's Photo Studio — Image format decoders (TASK 9-a)
// Pure TypeScript, zero npm deps. Hot loops use flat typed
// arrays only (no per-pixel allocation) so a 4000×3000 TIFF
// decodes in well under a second. Browser APIs used:
//   DecompressionStream('deflate')  — zlib TIFF strips/tiles
//   createImageBitmap               — PNG-embedded ICO entries
// ============================================================

import { createCanvas, ctx2d } from '../utils/canvas'

export type ImportFormatId =
  | 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'svg'
  | 'bmp' | 'ico' | 'tiff' | 'psd' | 'tga' | 'ppm' | 'qoi' | 'pcx'

/** decoded raster: tightly packed 8-bit RGBA (ImageData-compatible).
 *  Typed as Uint8ClampedArray<ArrayBuffer> (not ArrayBufferLike) so it feeds
 *  `new ImageData(rgba, w, h)` under strict lib.dom typings. */
export interface RawImage {
  width: number
  height: number
  rgba: Uint8ClampedArray<ArrayBuffer>
  /** Original decoded component depth before normalization to the current
   * 8-bit RGBA working raster. */
  sourceBitDepth?: number
}

// ---------- shared helpers ----------

export function rawToCanvas(raw: RawImage): HTMLCanvasElement {
  const c = createCanvas(raw.width, raw.height)
  ctx2d(c).putImageData(new ImageData(raw.rgba, raw.width, raw.height), 0, 0)
  return c
}

export function scanAlpha(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true
  return false
}

function ascii(bytes: Uint8Array, off: number, len: number): string {
  let s = ''
  const end = Math.min(off + len, bytes.length)
  for (let i = off; i < end; i++) s += String.fromCharCode(bytes[i])
  return s
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Deflate-compressed TIFF requires DecompressionStream (unsupported browser)')
  }
  // (data is a view over a possibly-larger buffer — cast for BlobPart strictness)
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// ============================================================
// format detection (magic bytes)
// ============================================================

export function detectFormat(bytes: Uint8Array): ImportFormatId | null {
  const b = bytes
  const n = b.length
  if (n < 2) return null
  const eq = (s: string, off = 0): boolean => {
    if (n < off + s.length) return false
    for (let i = 0; i < s.length; i++) if (b[off + i] !== s.charCodeAt(i)) return false
    return true
  }
  if (eq('II*\0') || eq('MM\0*')) return 'tiff'
  if (n >= 8 && b[0] === 0x89 && eq('PNG\r\n\x1a\n')) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (eq('GIF8')) return 'gif'
  if (eq('RIFF') && eq('WEBP', 8)) return 'webp'
  if (eq('qoif')) return 'qoi'
  if (eq('8BPS')) return 'psd'
  if (eq('BM') && n >= 6) return 'bmp'
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'ico' // ICONDIR
  if (b[0] === 0 && b[1] === 0 && b[2] === 2 && b[3] === 0) {
    // ICONDIR (CUR) — but a bare uncompressed TGA (no id, no cmap, type 2)
    // has the identical first 4 bytes; disambiguate by the entry count,
    // which is the TGA colormap first-entry index (0 for cmap-less files)
    const count = b[4] | (b[5] << 8)
    if (n >= 6 && count > 0 && count <= 512) return 'ico'
  }
  if (b[0] === 0x3a && b[1] === 0xde && b[2] === 0x68 && b[3] === 0xb1) return 'pcx' // DCX
  if (eq('ftyp', 4)) {
    const brand = ascii(b, 8, 4)
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1') return 'avif'
    return null
  }
  // PCX header heuristic (works with a 32-byte sniff — extra fields checked
  // only when more bytes are available)
  if (b[0] === 0x0a && b[1] <= 5 && b[2] <= 1 && (b[3] === 1 || b[3] === 2 || b[3] === 4 || b[3] === 8) && n >= 12) {
    const xmin = b[4] | (b[5] << 8), ymin = b[6] | (b[7] << 8)
    const xmax = b[8] | (b[9] << 8), ymax = b[10] | (b[11] << 8)
    const w = xmax - xmin + 1, h = ymax - ymin + 1
    if (w >= 1 && w <= 8192 && h >= 1 && h <= 8192) {
      if (n < 70 || (b[65] >= 1 && b[65] <= 4 && b[66] > 0)) return 'pcx'
    }
  }
  // netpbm: P1..P7 + whitespace/comment
  if (b[0] === 0x50 /* P */ && b[1] >= 0x31 && b[1] <= 0x37) {
    if (n < 3) return 'ppm'
    const c = b[2]
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x23) return 'ppm'
  }
  // TGA footer (only present when we got the whole file)
  if (n >= 26 && eq('TRUEVISION-XFILE.', n - 26)) return 'tga'
  // bare DIB (no BM file header)
  if (n >= 6) {
    const hsz = b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)
    if (hsz === 12 || hsz === 16 || hsz === 40 || hsz === 52 || hsz === 56 || hsz === 64 || hsz === 108 || hsz === 124) return 'bmp'
  }
  if (looksLikeSvg(b)) return 'svg'
  if (looksLikeTga(b)) return 'tga'
  return null
}

function looksLikeSvg(b: Uint8Array): boolean {
  let start = 0
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) start = 3
  while (start < b.length && (b[start] === 0x20 || b[start] === 0x09 || b[start] === 0x0a || b[start] === 0x0d)) start++
  if (start >= b.length || b[start] !== 0x3c /* < */) return false
  const head = ascii(b, start, 2048)
  return head.includes('<svg')
}

function looksLikeTga(b: Uint8Array): boolean {
  if (b.length < 18) return false
  const cmapType = b[1]
  if (cmapType > 1) return false
  const imgType = b[2]
  if (imgType !== 1 && imgType !== 2 && imgType !== 3 && imgType !== 9 && imgType !== 10 && imgType !== 11) return false
  const w = b[12] | (b[13] << 8)
  const h = b[14] | (b[15] << 8)
  if (w === 0 || h === 0) return false
  const bpp = b[16]
  if (bpp !== 8 && bpp !== 16 && bpp !== 24 && bpp !== 32) return false
  if (b[17] & 0xc0) return false
  const cmapLen = b[5] | (b[6] << 8)
  const cmapBits = b[7]
  if (cmapType === 0 && (cmapLen !== 0 || cmapBits !== 0)) return false
  if (cmapType === 1 && cmapLen > 0 && cmapBits !== 15 && cmapBits !== 16 && cmapBits !== 24 && cmapBits !== 32) return false
  const colormapped = imgType === 1 || imgType === 9
  if (colormapped && cmapType !== 1) return false
  if (b[0] > 0 && b.length < 18 + b[0]) return false
  return true
}

// ============================================================
// LZW (TIFF flavor — MSB-first codes, clear/EOI; early-change
// with an automatic retry using the delayed-change convention
// for old/broken encoder output)
// ============================================================

function lzwDecodeTiff(src: Uint8Array, outLen: number): Uint8Array {
  try {
    return lzwDecodeCore(src, outLen, true)
  } catch {
    return lzwDecodeCore(src, outLen, false)
  }
}

function lzwDecodeCore(src: Uint8Array, outLen: number, early: boolean): Uint8Array {
  const out = new Uint8Array(outLen)
  const prefix = new Int32Array(4096)
  const suffix = new Uint8Array(4096)
  const first = new Uint8Array(4096)
  for (let i = 0; i < 256; i++) { suffix[i] = i; first[i] = i; prefix[i] = -1 }
  const stack = new Uint8Array(4096)
  let width = 9
  let next = 258
  let prev = -1
  let op = 0
  let bytePos = 0
  let cur = 0
  let curBits = 0
  const srcLen = src.length
  for (;;) {
    while (curBits < width) {
      if (bytePos >= srcLen) return out
      cur = (cur << 8) | src[bytePos++]
      curBits += 8
    }
    curBits -= width
    const code = (cur >>> curBits) & ((1 << width) - 1)
    if (code === 257) return out // EOI
    if (code === 256) { // clear
      width = 9
      next = 258
      prev = -1
      continue
    }
    if (prev === -1) {
      if (code > 255) throw new Error('LZW: bad first code')
      if (op >= outLen) throw new Error('LZW: overrun')
      out[op++] = code
      prev = code
      continue
    }
    if (code > next) throw new Error('LZW: invalid code')
    // add entry — for KwKwK (code === next) the entry IS the string to emit
    if (next < 4096) {
      const headFirst = code < next ? first[code] : first[prev]
      prefix[next] = prev
      suffix[next] = headFirst
      first[next] = first[prev]
      next++
      const threshold = early ? (1 << width) - 1 : 1 << width
      if (next === threshold && width < 12) width++
    }
    // emit string for `code`
    let sp = 0
    let c = code
    while (c >= 258) {
      stack[sp++] = suffix[c]
      c = prefix[c]
      if (c < 0) throw new Error('LZW: corrupt chain')
    }
    stack[sp++] = c
    while (sp > 0) {
      if (op >= outLen) throw new Error('LZW: overrun')
      out[op++] = stack[--sp]
    }
    prev = code
  }
}

// ============================================================
// PackBits
// ============================================================

function packBitsDecode(src: Uint8Array, srcEnd: number, out: Uint8Array, outLen: number): void {
  let sp = 0
  let op = 0
  while (sp < srcEnd) {
    const n = src[sp++]
    if (n < 128) {
      const cnt = n + 1
      if (sp + cnt > srcEnd || op + cnt > outLen) throw new Error('PackBits: overrun')
      for (let i = 0; i < cnt; i++) out[op++] = src[sp++]
    } else if (n > 128) {
      const cnt = 257 - n
      if (sp >= srcEnd || op + cnt > outLen) throw new Error('PackBits: overrun')
      const v = src[sp++]
      for (let i = 0; i < cnt; i++) out[op++] = v
    } // 128 = no-op
  }
}

// ============================================================
// TIFF — both endiannesses, strips & tiles, interleaved & planar,
// 8/16-bit, gray / RGB / palette / CMYK, associated &
// unassociated alpha, compression: none / LZW / deflate / PackBits
// ============================================================

const TIFF_TYPE_SIZES: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
}

function readTiffValues(view: DataView, type: number, count: number, fieldOff: number, le: boolean): number[] {
  const unit = TIFF_TYPE_SIZES[type]
  if (!unit || count < 0) return []
  const total = unit * count
  let off: number
  if (total <= 4) off = fieldOff
  else {
    if (fieldOff + 4 > view.byteLength) return []
    off = view.getUint32(fieldOff, le)
  }
  if (off < 0 || off + total > view.byteLength) return []
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const o = off + i * unit
    switch (type) {
      case 1: case 2: case 6: case 7: out.push(view.getUint8(o)); break
      case 3: out.push(view.getUint16(o, le)); break
      case 4: out.push(view.getUint32(o, le)); break
      case 5: { const d = view.getUint32(o + 4, le); out.push(d ? view.getUint32(o, le) / d : 0); break }
      case 8: out.push(view.getInt16(o, le)); break
      case 9: out.push(view.getInt32(o, le)); break
      case 10: { const d = view.getUint32(o + 4, le); out.push(d ? view.getInt32(o, le) / d : 0); break }
      case 11: out.push(view.getFloat32(o, le)); break
      case 12: out.push(view.getFloat64(o, le)); break
      default: out.push(0)
    }
  }
  return out
}

async function decompressTiffBlock(bytes: Uint8Array, off: number, cnt: number, compression: number, expected: number): Promise<Uint8Array> {
  if (cnt <= 0 || off < 0 || off + cnt > bytes.length) throw new Error('Corrupt TIFF block (offset/length out of range)')
  let data: Uint8Array
  switch (compression) {
    case 1: data = bytes.subarray(off, off + Math.min(cnt, expected)); break
    case 5: data = lzwDecodeTiff(bytes.subarray(off, off + cnt), expected); break
    case 32773: {
      data = new Uint8Array(expected)
      packBitsDecode(bytes, off + cnt, data, expected)
      break
    }
    case 8:
    case 32946: {
      data = await inflateZlib(bytes.subarray(off, off + cnt))
      break
    }
    default:
      throw new Error(`Unsupported TIFF compression ${compression}`)
  }
  if (data.length === expected) return data
  if (data.length > expected) return data.subarray(0, expected)
  const full = new Uint8Array(expected)
  full.set(data)
  return full
}

export async function decodeTiff(bytes: Uint8Array): Promise<RawImage> {
  if (bytes.length < 8) throw new Error('Truncated TIFF file')
  const le = bytes[0] === 0x49 && bytes[1] === 0x49
  const be = bytes[0] === 0x4d && bytes[1] === 0x4d
  if (!le && !be) throw new Error('Not a TIFF file (bad byte-order mark)')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint16(2, le) !== 42) throw new Error('Not a TIFF file (bad magic)')
  const ifdOff = view.getUint32(4, le)
  if (ifdOff < 8 || ifdOff + 2 > bytes.length) throw new Error('Corrupt TIFF IFD offset')

  const tags = new Map<number, number[]>()
  const nEntries = view.getUint16(ifdOff, le)
  for (let i = 0; i < nEntries; i++) {
    const e = ifdOff + 2 + i * 12
    if (e + 12 > bytes.length) break
    const tag = view.getUint16(e, le)
    const type = view.getUint16(e + 2, le)
    const count = view.getUint32(e + 4, le)
    if (count > 1 << 20) continue
    const vals = readTiffValues(view, type, count, e + 8, le)
    if (vals.length) tags.set(tag, vals)
  }
  const num = (tag: number, dflt = 0): number => tags.get(tag)?.[0] ?? dflt

  const width = num(256)
  const height = num(257)
  if (width <= 0 || height <= 0 || width * height > 268435456) {
    throw new Error(`Invalid TIFF dimensions ${width}×${height}`)
  }
  const bitsArr = tags.get(258) ?? [1]
  for (const b of bitsArr) if (b !== bitsArr[0]) throw new Error('TIFF with mixed per-channel bit depths is not supported')
  const bps = bitsArr[0]
  const compression = num(259, 1)
  const photometric = num(262, 1)
  const spp = num(277, photometric === 2 ? 3 : photometric === 5 ? 4 : 1)
  const rowsPerStrip = num(278, 0xffffffff)
  const planar = num(284, 1) === 2 && spp > 1 ? 2 : 1
  const predictor = num(317, 1)
  const sampleFormat = num(339, 1)
  const extraSamples = tags.get(338) ?? []
  const tileW = num(322, 0)
  const tileH = num(323, 0)

  if (sampleFormat === 3) throw new Error('Floating-point TIFF samples are not supported')
  if (spp < 1 || spp > 6) throw new Error(`Invalid TIFF samples per pixel ${spp}`)
  if (compression !== 1 && compression !== 5 && compression !== 8 && compression !== 32946 && compression !== 32773) {
    throw new Error(`Unsupported TIFF compression ${compression}`)
  }
  if (photometric === 2 && spp < 3) throw new Error('Corrupt RGB TIFF (fewer than 3 samples)')
  if (photometric === 5 && spp < 4) throw new Error('Corrupt CMYK TIFF (fewer than 4 samples)')

  let baseColors: number
  let palette: Uint8Array | null = null
  let invertGray = false
  switch (photometric) {
    case 0: baseColors = 1; invertGray = true; break           // WhiteIsZero
    case 1: baseColors = 1; break                              // BlackIsZero
    case 2: baseColors = 3; break                              // RGB
    case 3: {                                                  // Palette
      baseColors = 1
      const cmap = tags.get(320)
      if (!cmap || cmap.length < 3) throw new Error('Paletted TIFF has no color map')
      palette = new Uint8Array(cmap.length)
      for (let i = 0; i < cmap.length; i++) palette[i] = Math.round(cmap[i] / 257)
      break
    }
    case 5: baseColors = 4; break                              // CMYK / Separation
    default:
      throw new Error(`Unsupported TIFF photometric ${photometric} (supported: grayscale / RGB / palette / CMYK)`)
  }
  if (photometric === 3 && spp !== 1) throw new Error('Corrupt paletted TIFF (samples per pixel ≠ 1)')

  const packed = spp === 1 && bps < 8 && (photometric === 0 || photometric === 1 || photometric === 3)
  if (!packed && bps !== 8 && bps !== 16) throw new Error(`Unsupported TIFF bit depth ${bps}`)

  const alphaSample = spp > baseColors ? spp - 1 : -1
  const assocAlpha = extraSamples.length > 0 && extraSamples[0] === 1

  // ---- block geometry (unified strips / tiles) ----
  const useTiles = tileW > 0 && tileH > 0
  const blockFullW = useTiles ? tileW : width
  const blockFullH = useTiles ? tileH : Math.min(rowsPerStrip, height)
  const blocksX = useTiles ? Math.ceil(width / tileW) : 1
  const blocksY = Math.ceil(height / Math.max(1, Math.min(blockFullH, height)))
  const blocksPerPlane = blocksX * blocksY
  const offsets = tags.get(useTiles ? 324 : 273) ?? []
  const counts = tags.get(useTiles ? 325 : 279) ?? []
  if (!offsets.length) throw new Error('TIFF has no image data (missing strip/tile offsets)')

  const sppEff = planar === 2 ? 1 : spp
  const bytesPerSample = packed ? 0 : bps >> 3
  const expectedBlockBytes = (fullH: number): number => {
    if (packed) return fullH * ((blockFullW * bps + 7) >> 3)
    return fullH * blockFullW * sppEff * bytesPerSample
  }

  const planes: Uint8Array[] = []
  for (let p = 0; p < spp; p++) planes.push(new Uint8Array(width * height))
  const out = new Uint8ClampedArray(width * height * 4)

  const nPlanesToRead = planar === 2 ? spp : 1
  for (let plane = 0; plane < nPlanesToRead; plane++) {
    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        const blockIdx = plane * blocksPerPlane + by * blocksX + bx
        if (blockIdx >= offsets.length) continue
        const stripH = useTiles ? tileH : Math.min(rowsPerStrip, height)
        const dstX = bx * blockFullW
        const dstY = by * stripH
        const dstW = Math.min(blockFullW, width - dstX)
        const dstH = Math.min(stripH, height - dstY)
        if (dstW <= 0 || dstH <= 0) continue
        const fullH = useTiles ? tileH : Math.min(rowsPerStrip, height - dstY)
        if (fullH <= 0) continue
        const off = offsets[blockIdx]
        const cnt = counts[blockIdx] ?? expectedBlockBytes(fullH)
        const expected = expectedBlockBytes(fullH)
        const raw = await decompressTiffBlock(bytes, off, cnt, compression, expected)

        let sampleBytes: Uint8Array
        let rowBytes: number
        if (packed) {
          sampleBytes = unpackSubByte(raw, bps, blockFullW, fullH, photometric !== 3)
          rowBytes = blockFullW
        } else if (bps === 16) {
          sampleBytes = normalize16(raw, le, blockFullW, fullH, sppEff, predictor === 2)
          rowBytes = blockFullW * sppEff
        } else {
          if (predictor === 2) applyPredictor8(raw, blockFullW, fullH, sppEff)
          sampleBytes = raw
          rowBytes = blockFullW * sppEff
        }

        if (planar === 2) {
          copyIntoPlane(planes[plane], width, dstX, dstY, dstW, dstH, sampleBytes, rowBytes, 1, 0)
        } else {
          for (let s = 0; s < spp; s++) {
            copyIntoPlane(planes[s], width, dstX, dstY, dstW, dstH, sampleBytes, rowBytes, spp, s)
          }
        }
      }
    }
  }

  combinePlanes(out, planes, width * height, photometric, alphaSample, assocAlpha, invertGray, palette)
  return { width, height, rgba: out, sourceBitDepth: bps }
}

function copyIntoPlane(
  plane: Uint8Array, imgW: number,
  dstX: number, dstY: number, dstW: number, dstH: number,
  src: Uint8Array, rowBytes: number, spp: number, sampleIdx: number,
): void {
  for (let y = 0; y < dstH; y++) {
    const sIdx = y * rowBytes + sampleIdx
    const dIdx = (dstY + y) * imgW + dstX
    if (spp === 1) {
      plane.set(src.subarray(sIdx, sIdx + dstW), dIdx)
    } else {
      const end = dIdx + dstW
      let s = sIdx
      let d = dIdx
      while (d < end) { plane[d++] = src[s]; s += spp }
    }
  }
}

function applyPredictor8(raw: Uint8Array, w: number, rows: number, spp: number): void {
  const rowLen = w * spp
  for (let y = 0; y < rows; y++) {
    const row = y * rowLen
    for (let x = 1; x < w; x++) {
      const px = row + x * spp
      for (let s = 0; s < spp; s++) raw[px + s] = (raw[px + s] + raw[px - spp + s]) & 0xff
    }
  }
}

/** 16-bit samples (file byte order) → 8-bit; applies the horizontal
 *  predictor (tag 317 = 2) on the native 16-bit values in the same pass. */
function normalize16(raw: Uint8Array, le: boolean, w: number, rows: number, spp: number, pred: boolean): Uint8Array {
  const n = w * rows * spp
  const out = new Uint8Array(n)
  const rowLen = w * spp
  for (let y = 0; y < rows; y++) {
    const row = y * rowLen
    for (let s = 0; s < spp; s++) {
      let acc = 0
      for (let x = 0; x < w; x++) {
        const idx = row + x * spp + s
        const b0 = raw[idx * 2]
        const b1 = raw[idx * 2 + 1]
        let v = le ? (b1 << 8) | b0 : (b0 << 8) | b1
        if (pred) { v = (v + acc) & 0xffff; acc = v }
        out[idx] = v >> 8
      }
    }
  }
  return out
}

/** 1/2/4-bit packed single-channel samples → 8-bit */
function unpackSubByte(raw: Uint8Array, bits: number, w: number, rows: number, scale: boolean): Uint8Array {
  const rowBytes = (w * bits + 7) >> 3
  const out = new Uint8Array(w * rows)
  const mask = (1 << bits) - 1
  for (let y = 0; y < rows; y++) {
    const src = y * rowBytes
    const dst = y * w
    for (let x = 0; x < w; x++) {
      const bitOff = x * bits
      const byte = raw[src + (bitOff >> 3)]
      const shift = 8 - bits - (bitOff & 7)
      const v = (byte >> shift) & mask
      out[dst + x] = scale ? Math.round((v * 255) / mask) : v
    }
  }
  return out
}

function combinePlanes(
  out: Uint8ClampedArray, planes: Uint8Array[], n: number,
  photometric: number, alphaSample: number, assocAlpha: boolean,
  invertGray: boolean, palette: Uint8Array | null,
): void {
  const p0 = planes[0]
  const p1 = planes[1]
  const p2 = planes[2]
  const p3 = planes[3]
  const pAlpha = alphaSample >= 0 && planes[alphaSample] ? planes[alphaSample] : null
  const recip = new Float32Array(256)
  if (assocAlpha) { for (let a = 1; a < 256; a++) recip[a] = 255 / a }
  let cmykLut: Uint8Array | null = null
  if (photometric === 5) {
    cmykLut = new Uint8Array(65536)
    for (let c = 0; c < 256; c++) {
      for (let k = 0; k < 256; k++) {
        cmykLut[(c << 8) | k] = Math.round(((255 - c) * (255 - k)) / 255)
      }
    }
  }
  const pal = palette
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    let r = 0, g = 0, b = 0
    const a = pAlpha ? pAlpha[i] : 255
    switch (photometric) {
      case 0:
      case 1: {
        let v = p0[i]
        if (invertGray) v = 255 - v
        r = v; g = v; b = v
        break
      }
      case 2: {
        r = p0[i]; g = p1 ? p1[i] : 0; b = p2 ? p2[i] : 0
        break
      }
      case 3: {
        const idx = p0[i] * 3
        if (pal && idx + 2 < pal.length) { r = pal[idx]; g = pal[idx + 1]; b = pal[idx + 2] }
        break
      }
      case 5: {
        const lut = cmykLut!
        const k = p3 ? p3[i] : 0
        r = lut[(p0[i] << 8) | k]
        g = lut[(p1 ? p1[i] : 0) << 8 | k]
        b = lut[(p2 ? p2[i] : 0) << 8 | k]
        break
      }
    }
    if (assocAlpha && a > 0) {
      const f = recip[a]
      if (r * f > 255) r = 255; else r = Math.round(r * f)
      if (g * f > 255) g = 255; else g = Math.round(g * f)
      if (b * f > 255) b = 255; else b = Math.round(b * f)
    }
    out[o] = r
    out[o + 1] = g
    out[o + 2] = b
    out[o + 3] = a
  }
}

// ============================================================
// TGA
// ============================================================

export function decodeTga(bytes: Uint8Array): RawImage {
  if (bytes.length < 18) throw new Error('Truncated TGA file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const idLen = bytes[0]
  const cmapType = bytes[1]
  const imgType = bytes[2]
  const cmapFirst = view.getUint16(3, true)
  const cmapLen = view.getUint16(5, true)
  const cmapBits = bytes[7]
  const width = view.getUint16(12, true)
  const height = view.getUint16(14, true)
  const bpp = bytes[16]
  const descriptor = bytes[17]
  if (width <= 0 || height <= 0) throw new Error('Invalid TGA dimensions')
  if (![1, 2, 3, 9, 10, 11].includes(imgType)) throw new Error(`Unsupported TGA image type ${imgType}`)
  if (bpp !== 8 && bpp !== 16 && bpp !== 24 && bpp !== 32) throw new Error(`Unsupported TGA bit depth ${bpp}`)

  const bytesPP = bpp >> 3
  const pixCount = width * height
  const pixels = new Uint8Array(pixCount * bytesPP)
  let pos = 18 + idLen + (cmapType ? cmapLen * ((cmapBits + 7) >> 3) : 0)

  const rle = imgType >= 9
  if (rle) {
    let o = 0
    while (o < pixels.length) {
      if (pos >= bytes.length) throw new Error('Truncated TGA RLE data')
      const hdr = bytes[pos++]
      const count = (hdr & 0x7f) + 1
      if (hdr & 0x80) {
        if (pos + bytesPP > bytes.length) throw new Error('Truncated TGA RLE packet')
        const px0 = pos
        pos += bytesPP
        for (let i = 0; i < count && o < pixels.length; i++) {
          for (let j = 0; j < bytesPP; j++) pixels[o + j] = bytes[px0 + j]
          o += bytesPP
        }
      } else {
        const need = count * bytesPP
        if (pos + need > bytes.length) throw new Error('Truncated TGA raw packet')
        pixels.set(bytes.subarray(pos, pos + need), o)
        pos += need
        o += need
      }
    }
  } else {
    const need = pixCount * bytesPP
    if (pos + need > bytes.length) throw new Error('Truncated TGA pixel data')
    pixels.set(bytes.subarray(pos, pos + need))
  }

  // color map → RGBA entries
  let cmap: Uint8Array | null = null
  if (cmapType && cmapLen > 0) {
    const es = (cmapBits + 7) >> 3
    const cmapOff = 18 + idLen
    if (cmapOff + cmapLen * es > bytes.length) throw new Error('Truncated TGA color map')
    cmap = new Uint8Array(cmapLen * 4)
    for (let i = 0; i < cmapLen; i++) {
      const o = cmapOff + i * es
      if (es === 4) { cmap[i * 4] = bytes[o + 2]; cmap[i * 4 + 1] = bytes[o + 1]; cmap[i * 4 + 2] = bytes[o]; cmap[i * 4 + 3] = bytes[o + 3] }
      else if (es === 3) { cmap[i * 4] = bytes[o + 2]; cmap[i * 4 + 1] = bytes[o + 1]; cmap[i * 4 + 2] = bytes[o]; cmap[i * 4 + 3] = 255 }
      else if (es === 2) {
        const v = bytes[o] | (bytes[o + 1] << 8)
        cmap[i * 4] = scale5((v >> 10) & 31); cmap[i * 4 + 1] = scale5((v >> 5) & 31); cmap[i * 4 + 2] = scale5(v & 31)
        cmap[i * 4 + 3] = v & 0x8000 ? 255 : 0
      } else if (es === 1) {
        const v = bytes[o]
        cmap[i * 4] = v; cmap[i * 4 + 1] = v; cmap[i * 4 + 2] = v; cmap[i * 4 + 3] = 255
      }
    }
  }

  const out = new Uint8ClampedArray(pixCount * 4)
  const scaleLut = new Uint8Array(32)
  for (let i = 0; i < 32; i++) scaleLut[i] = Math.round((i * 255) / 31)
  const colormapped = imgType === 1 || imgType === 9
  for (let i = 0, o = 0; i < pixCount; i++, o += 4) {
    let r = 0, g = 0, b = 0, a = 255
    switch (bpp) {
      case 8: {
        const v = pixels[i]
        if (colormapped && cmap) {
          const idx = v - cmapFirst
          if (idx >= 0 && idx < cmapLen) {
            r = cmap[idx * 4]; g = cmap[idx * 4 + 1]; b = cmap[idx * 4 + 2]; a = cmap[idx * 4 + 3]
          } else { a = 0 }
        } else { r = v; g = v; b = v }
        break
      }
      case 16: {
        const v = pixels[i * 2] | (pixels[i * 2 + 1] << 8)
        r = scaleLut[(v >> 10) & 31]; g = scaleLut[(v >> 5) & 31]; b = scaleLut[v & 31]
        a = v & 0x8000 ? 255 : 0
        break
      }
      case 24: {
        const p = i * 3
        b = pixels[p]; g = pixels[p + 1]; r = pixels[p + 2]
        break
      }
      case 32: {
        const p = i * 4
        b = pixels[p]; g = pixels[p + 1]; r = pixels[p + 2]; a = pixels[p + 3]
        break
      }
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a
  }

  // origin: default bottom-left; descriptor bit 5 = top-left, bit 4 = right-to-left
  const topOrigin = (descriptor & 0x20) !== 0
  const rightOrigin = (descriptor & 0x10) !== 0
  if (topOrigin && !rightOrigin) return { width, height, rgba: out }
  const flipped = new Uint8ClampedArray(out.length)
  for (let y = 0; y < height; y++) {
    const srcY = topOrigin ? y : height - 1 - y
    for (let x = 0; x < width; x++) {
      const srcX = rightOrigin ? width - 1 - x : x
      const s = (srcY * width + srcX) * 4
      const d = (y * width + x) * 4
      flipped[d] = out[s]; flipped[d + 1] = out[s + 1]; flipped[d + 2] = out[s + 2]; flipped[d + 3] = out[s + 3]
    }
  }
  return { width, height, rgba: flipped }
}

function scale5(v: number): number { return Math.round((v * 255) / 31) }

// ============================================================
// PPM / PGM / PBM / PAM (netpbm P1..P7)
// ============================================================

const WS = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c

export function decodePnm(bytes: Uint8Array): RawImage {
  let pos = 0
  const n = bytes.length
  const nextToken = (): string => {
    for (;;) {
      while (pos < n && WS(bytes[pos])) pos++
      if (pos < n && bytes[pos] === 0x23 /* # */) { while (pos < n && bytes[pos] !== 0x0a) pos++; continue }
      break
    }
    const start = pos
    while (pos < n && !WS(bytes[pos]) && bytes[pos] !== 0x23) pos++
    return ascii(bytes, start, pos - start)
  }
  const magic = nextToken()
  if (!/^P[1-7]$/.test(magic)) throw new Error('Not a netpbm (PBM/PGM/PPM/PAM) file')

  let width = 0
  let height = 0
  let maxval = 255
  let depth = 3
  let tupltype = 'RGB'
  let binary = false

  if (magic === 'P7') {
    // PAM header: KEY VALUE lines until ENDHDR
    for (;;) {
      while (pos < n && WS(bytes[pos])) pos++
      if (pos < n && bytes[pos] === 0x23) { while (pos < n && bytes[pos] !== 0x0a) pos++; continue }
      if (pos >= n) throw new Error('PAM header missing ENDHDR')
      const lineStart = pos
      while (pos < n && bytes[pos] !== 0x0a) pos++
      const hasNl = pos < n
      if (hasNl) pos++
      const line = ascii(bytes, lineStart, pos - lineStart - (hasNl ? 1 : 0))
      const m = /^(\S+)\s*(.*)$/.exec(line)
      if (!m) continue
      const key = m[1]
      const val = m[2].trim()
      if (key === 'WIDTH') width = parseInt(val, 10)
      else if (key === 'HEIGHT') height = parseInt(val, 10)
      else if (key === 'DEPTH') depth = parseInt(val, 10)
      else if (key === 'MAXVAL') maxval = parseInt(val, 10)
      else if (key === 'TUPLTYPE') tupltype = val
      else if (key === 'ENDHDR') break
    }
    binary = true
    if (pos < n && WS(bytes[pos])) pos++ // single whitespace after ENDHDR
  } else {
    width = parseInt(nextToken(), 10)
    height = parseInt(nextToken(), 10)
    if (magic === 'P1' || magic === 'P4') maxval = 1
    else maxval = parseInt(nextToken(), 10)
    binary = magic === 'P4' || magic === 'P5' || magic === 'P6'
    if (binary && pos < n && WS(bytes[pos])) pos++ // exactly one whitespace before raster
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > 268435456) {
    throw new Error(`Invalid netpbm dimensions ${width}×${height}`)
  }
  if (!Number.isFinite(maxval) || maxval < 1 || maxval > 65535) throw new Error(`Invalid netpbm maxval ${maxval}`)

  const pixCount = width * height
  const out = new Uint8ClampedArray(pixCount * 4)
  const scale16 = maxval > 255
  const val = (i: number): number => (scale16 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i])
  const scale = (v: number): number => (maxval === 1 ? (v ? 255 : 0) : Math.round((v * 255) / maxval))

  if (magic === 'P7') {
    const isBW = tupltype.startsWith('BLACKANDWHITE')
    const hasAlpha = tupltype === 'RGB_ALPHA' || tupltype === 'GRAYSCALE_ALPHA' || tupltype === 'BLACKANDWHITE_ALPHA'
    if (depth < 1 || depth > 4) throw new Error(`Invalid PAM depth ${depth}`)
    const bps = scale16 ? 2 : 1
    const bpp = depth * bps
    if (pos + pixCount * bpp > n) throw new Error('Truncated PAM raster')
    const colorCount = hasAlpha ? depth - 1 : depth
    for (let i = 0, o = 0, p = pos; i < pixCount; i++, o += 4, p += bpp) {
      if (colorCount === 1) {
        let v: number
        const raw = val(p)
        if (isBW) v = raw ? 0 : 255 // 1 = black
        else v = scale(raw)
        out[o] = v; out[o + 1] = v; out[o + 2] = v
      } else {
        out[o] = scale(val(p))
        out[o + 1] = scale(val(p + bps))
        out[o + 2] = scale(val(p + 2 * bps))
      }
      out[o + 3] = hasAlpha ? scale(val(p + colorCount * bps)) : 255
    }
    return { width, height, rgba: out }
  }

  switch (magic) {
    case 'P1': {
      // ASCII bitmap, 1 = black
      let o = 0
      for (let i = 0; i < pixCount; i++) {
        const t = nextToken()
        if (t !== '0' && t !== '1') throw new Error('Corrupt PBM (P1) sample data')
        const v = t === '1' ? 0 : 255
        out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255
        o += 4
      }
      break
    }
    case 'P2': {
      let o = 0
      for (let i = 0; i < pixCount; i++) {
        const v = scale(parseInt(nextToken(), 10) || 0)
        out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255
        o += 4
      }
      break
    }
    case 'P3': {
      let o = 0
      for (let i = 0; i < pixCount; i++) {
        out[o] = scale(parseInt(nextToken(), 10) || 0)
        out[o + 1] = scale(parseInt(nextToken(), 10) || 0)
        out[o + 2] = scale(parseInt(nextToken(), 10) || 0)
        out[o + 3] = 255
        o += 4
      }
      break
    }
    case 'P4': {
      // packed bits, MSB first, 1 = black, rows padded to byte
      const rowBytes = (width + 7) >> 3
      if (pos + rowBytes * height > n) throw new Error('Truncated PBM (P4) raster')
      for (let y = 0, o = 0; y < height; y++) {
        const row = pos + y * rowBytes
        for (let x = 0; x < width; x++, o += 4) {
          const bit = (bytes[row + (x >> 3)] >> (7 - (x & 7))) & 1
          const v = bit ? 0 : 255
          out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255
        }
      }
      break
    }
    case 'P5': {
      const bps = scale16 ? 2 : 1
      if (pos + pixCount * bps > n) throw new Error('Truncated PGM (P5) raster')
      for (let i = 0, o = 0, p = pos; i < pixCount; i++, o += 4, p += bps) {
        const v = scale(val(p))
        out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255
      }
      break
    }
    case 'P6': {
      const bps = scale16 ? 2 : 1
      if (pos + pixCount * 3 * bps > n) throw new Error('Truncated PPM (P6) raster')
      for (let i = 0, o = 0, p = pos; i < pixCount; i++, o += 4, p += 3 * bps) {
        out[o] = scale(val(p))
        out[o + 1] = scale(val(p + bps))
        out[o + 2] = scale(val(p + 2 * bps))
        out[o + 3] = 255
      }
      break
    }
  }
  return { width, height, rgba: out }
}

// ============================================================
// QOI — https://qoiformat.org
// ============================================================

export function decodeQoi(bytes: Uint8Array): RawImage {
  if (bytes.length < 14) throw new Error('Truncated QOI file')
  if (ascii(bytes, 0, 4) !== 'qoif') throw new Error('Not a QOI file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(4)
  const height = view.getUint32(8)
  const channels = bytes[12]
  if (width <= 0 || height <= 0 || width * height > 268435456) throw new Error(`Invalid QOI dimensions ${width}×${height}`)
  if (channels !== 3 && channels !== 4) throw new Error(`Invalid QOI channel count ${channels}`)

  const out = new Uint8ClampedArray(width * height * 4)
  const index = new Uint8Array(64 * 4)
  let r = 0, g = 0, b = 0, a = 255
  let pos = 14
  const n = bytes.length
  let o = 0
  while (o < out.length && pos < n) {
    const b1 = bytes[pos]
    if (b1 === 0xfe) { // QOI_OP_RGB
      pos += 4
      if (pos > n) throw new Error('Truncated QOI chunk')
      r = bytes[pos - 3]; g = bytes[pos - 2]; b = bytes[pos - 1]
    } else if (b1 === 0xff) { // QOI_OP_RGBA
      pos += 5
      if (pos > n) throw new Error('Truncated QOI chunk')
      r = bytes[pos - 4]; g = bytes[pos - 3]; b = bytes[pos - 2]; a = bytes[pos - 1]
    } else if ((b1 & 0xc0) === 0x00) { // QOI_OP_INDEX
      pos++
      const idx = (b1 & 0x3f) * 4
      r = index[idx]; g = index[idx + 1]; b = index[idx + 2]; a = index[idx + 3]
    } else if ((b1 & 0xc0) === 0x40) { // QOI_OP_DIFF
      pos++
      r += ((b1 >> 4) & 3) - 2
      g += ((b1 >> 2) & 3) - 2
      b += (b1 & 3) - 2
    } else if ((b1 & 0xc0) === 0x80) { // QOI_OP_LUMA
      pos += 2
      if (pos > n) throw new Error('Truncated QOI chunk')
      const b2 = bytes[pos - 1]
      const dg = (b1 & 0x3f) - 32
      r += dg + (b2 >> 4) - 8
      g += dg
      b += dg + (b2 & 0x0f) - 8
    } else { // QOI_OP_RUN
      pos++
      const run = (b1 & 0x3f) + 1
      for (let i = 0; i < run && o < out.length; i++, o += 4) {
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a
      }
      continue
    }
    if (r < 0) r = 0; else if (r > 255) r = 255
    if (g < 0) g = 0; else if (g > 255) g = 255
    if (b < 0) b = 0; else if (b > 255) b = 255
    const hash = (r * 3 + g * 5 + b * 7 + a * 11) % 64
    index[hash * 4] = r; index[hash * 4 + 1] = g; index[hash * 4 + 2] = b; index[hash * 4 + 3] = a
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a
    o += 4
  }
  return { width, height, rgba: out }
}

// ============================================================
// PCX / DCX (single page)
// ============================================================

export function decodePcx(bytes: Uint8Array): RawImage {
  let page = bytes
  if (bytes.length > 8 && bytes[0] === 0x3a && bytes[1] === 0xde && bytes[2] === 0x68 && bytes[3] === 0xb1) {
    // DCX container: magic + array of page offsets (0-terminated)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const first = view.getUint32(4, true)
    if (first <= 0 || first >= bytes.length) throw new Error('Corrupt DCX container')
    page = bytes.subarray(first)
  }
  if (page.length < 128) throw new Error('Truncated PCX header')
  if (page[0] !== 0x0a) throw new Error('Not a PCX file')
  const view = new DataView(page.buffer, page.byteOffset, page.byteLength)
  const encoding = page[2]
  const bits = page[3]
  const xmin = view.getUint16(4, true)
  const ymin = view.getUint16(6, true)
  const xmax = view.getUint16(8, true)
  const ymax = view.getUint16(10, true)
  const nplanes = page[65]
  const bytesPerLine = view.getUint16(66, true)
  const width = xmax - xmin + 1
  const height = ymax - ymin + 1
  if (width <= 0 || height <= 0 || width > 32768 || height > 32768) throw new Error(`Invalid PCX dimensions ${width}×${height}`)
  if (bytesPerLine <= 0 || nplanes < 1 || nplanes > 4) throw new Error('Corrupt PCX header')

  const rowSize = bytesPerLine * nplanes
  const raw = new Uint8Array(rowSize * height)
  if (encoding === 0) {
    if (128 + raw.length > page.length) throw new Error('Truncated PCX pixel data')
    raw.set(page.subarray(128, 128 + raw.length))
  } else {
    let sp = 128
    let op = 0
    const pLen = page.length
    while (op < raw.length && sp < pLen) {
      const b = page[sp++]
      if ((b & 0xc0) === 0xc0) {
        const cnt = b & 0x3f
        const v = sp < pLen ? page[sp++] : 0
        for (let i = 0; i < cnt && op < raw.length; i++) raw[op++] = v
      } else {
        raw[op++] = b
      }
    }
  }

  // 16-color palette (48 bytes at header offset 16)
  const headerPal = new Uint8Array(16 * 3)
  for (let i = 0; i < 48; i++) headerPal[i] = page[16 + i]

  // 256-color VGA palette: 0x0C indicator 769 bytes from EOF
  const pal256 = page.length >= 769 && page[page.length - 769] === 0x0c
    ? page.subarray(page.length - 768)
    : null

  const pixCount = width * height
  const out = new Uint8ClampedArray(pixCount * 4)
  const sample = (rowStart: number, x: number): number => {
    const byte = raw[rowStart + ((x * bits) >> 3)]
    switch (bits) {
      case 1: return (byte >> (7 - (x & 7))) & 1
      case 2: return (byte >> (6 - 2 * (x & 3))) & 3
      case 4: return (byte >> (4 - 4 * (x & 1))) & 0x0f
      default: return raw[rowStart + x]
    }
  }

  if (bits === 8 && nplanes === 3) {
    // 24-bit truecolor — planes are R, G, B
    for (let y = 0, o = 0; y < height; y++) {
      const row = y * rowSize
      const rp = row, gp = row + bytesPerLine, bp = row + 2 * bytesPerLine
      for (let x = 0; x < width; x++, o += 4) {
        out[o] = raw[rp + x]; out[o + 1] = raw[gp + x]; out[o + 2] = raw[bp + x]; out[o + 3] = 255
      }
    }
  } else if (bits === 8 && nplanes === 4) {
    // 4-plane CMYK
    for (let y = 0, o = 0; y < height; y++) {
      const row = y * rowSize
      for (let x = 0; x < width; x++, o += 4) {
        const c = raw[row + x], m = raw[row + bytesPerLine + x]
        const yy = raw[row + 2 * bytesPerLine + x], k = raw[row + 3 * bytesPerLine + x]
        out[o] = Math.round(((255 - c) * (255 - k)) / 255)
        out[o + 1] = Math.round(((255 - m) * (255 - k)) / 255)
        out[o + 2] = Math.round(((255 - yy) * (255 - k)) / 255)
        out[o + 3] = 255
      }
    }
  } else if (bits === 8 && nplanes === 1) {
    if (pal256) {
      for (let y = 0, o = 0; y < height; y++) {
        const row = y * rowSize
        for (let x = 0; x < width; x++, o += 4) {
          const idx = raw[row + x] * 3
          out[o] = pal256[idx]; out[o + 1] = pal256[idx + 1]; out[o + 2] = pal256[idx + 2]; out[o + 3] = 255
        }
      }
    } else {
      for (let y = 0, o = 0; y < height; y++) {
        const row = y * rowSize
        for (let x = 0; x < width; x++, o += 4) {
          const v = raw[row + x]
          out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255
        }
      }
    }
  } else if (bits === 1 && nplanes === 1) {
    // monochrome — bit set = white
    for (let y = 0, o = 0; y < height; y++) {
      const row = y * rowSize
      for (let x = 0; x < width; x++, o += 4) {
        const v = sample(row, x) ? 255 : 0
        out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255
      }
    }
  } else if (bits * nplanes <= 4 && bits <= 4) {
    // paletted — combine plane bits → 16-color header palette
    for (let y = 0, o = 0; y < height; y++) {
      const row = y * rowSize
      for (let x = 0; x < width; x++, o += 4) {
        let idx = 0
        for (let p = 0; p < nplanes; p++) idx |= sample(row + p * bytesPerLine, x) << p
        const pi = (idx & 15) * 3
        out[o] = headerPal[pi]; out[o + 1] = headerPal[pi + 1]; out[o + 2] = headerPal[pi + 2]; out[o + 3] = 255
      }
    }
  } else {
    throw new Error(`Unsupported PCX format: ${bits} bits × ${nplanes} planes`)
  }
  return { width, height, rgba: out }
}

// ============================================================
// BMP (deep fallback) + shared DIB core (used by ICO entries)
// ============================================================

export function decodeBmp(bytes: Uint8Array): RawImage {
  if (bytes.length < 14) throw new Error('Truncated BMP file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const dataOff = view.getUint32(10, true)
    return decodeDib(bytes, view, 14, dataOff, false)
  }
  return decodeDib(bytes, view, 0, -1, false) // bare DIB
}

interface DibInfo {
  width: number
  height: number
  bpp: number
  compression: number
  topDown: boolean
  paletteOff: number
  paletteCount: number
  paletteEntrySize: number
  masks: { r: number; g: number; b: number; a: number } | null
  dataStart: number
}

function parseDibHeader(view: DataView, dibOff: number, dataOff: number, icon: boolean): DibInfo {
  const biSize = view.getUint32(dibOff, true)
  let width: number
  let height: number
  let bpp: number
  let compression = 0
  let clrUsed = 0
  let paletteEntrySize = 4
  if (biSize === 12) {
    // BITMAPCOREHEADER (OS/2)
    width = view.getUint16(dibOff + 4, true)
    height = view.getUint16(dibOff + 8, true)
    bpp = view.getUint16(dibOff + 10, true)
    paletteEntrySize = 3
  } else {
    width = view.getInt32(dibOff + 4, true)
    height = view.getInt32(dibOff + 8, true)
    bpp = view.getUint16(dibOff + 14, true)
    compression = view.getUint32(dibOff + 16, true)
    clrUsed = view.getUint32(dibOff + 32, true)
  }
  const hAbs = Math.abs(height)
  const imgH = icon ? hAbs >> 1 : hAbs
  const topDown = !icon && height < 0
  const paletteCount = bpp <= 8 ? (clrUsed || 1 << bpp) : 0
  const paletteOff = dibOff + biSize
  let masks: { r: number; g: number; b: number; a: number } | null = null
  if (compression === 3 || compression === 6) {
    // BI_BITFIELDS / BI_ALPHABITFIELDS — masks in the header (V3/V4/V5) or
    // immediately following a 40-byte header
    let mOff = dibOff + biSize
    let count = compression === 6 ? 4 : 3
    if (biSize === 52 || biSize === 56 || biSize === 108 || biSize === 124) {
      mOff = dibOff + 40
      count = biSize === 52 ? 3 : 4
    }
    masks = {
      r: view.getUint32(mOff, true),
      g: view.getUint32(mOff + 4, true),
      b: view.getUint32(mOff + 8, true),
      a: count === 4 ? view.getUint32(mOff + 12, true) : 0,
    }
    if (!masks.r && !masks.g && !masks.b) masks = null
  }
  let dataStart = dataOff
  if (dataStart < 0) dataStart = paletteOff + paletteCount * paletteEntrySize
  return { width, height: imgH, bpp, compression, topDown, paletteOff, paletteCount, paletteEntrySize, masks, dataStart }
}

function decodeDib(bytes: Uint8Array, view: DataView, dibOff: number, dataOff: number, icon: boolean): RawImage {
  const info = parseDibHeader(view, dibOff, dataOff, icon)
  const { width, height, bpp, topDown, masks } = info
  if (width <= 0 || height <= 0 || width * height > 268435456) throw new Error(`Invalid BMP dimensions ${width}×${height}`)
  if (bpp !== 1 && bpp !== 4 && bpp !== 8 && bpp !== 16 && bpp !== 24 && bpp !== 32) {
    throw new Error(`Unsupported BMP bit depth ${bpp}`)
  }
  if (info.compression === 1 && bpp !== 8) throw new Error('RLE8 BMP requires 8bpp')
  if (info.compression === 2 && bpp !== 4) throw new Error('RLE4 BMP requires 4bpp')
  if (info.compression !== 0 && info.compression !== 1 && info.compression !== 2 && info.compression !== 3 && info.compression !== 6) {
    throw new Error(`Unsupported BMP compression ${info.compression}`)
  }

  // palette → RGBA
  const palette = new Uint8Array(Math.max(1, info.paletteCount) * 4)
  for (let i = 0; i < info.paletteCount; i++) {
    const o = info.paletteOff + i * info.paletteEntrySize
    if (o + info.paletteEntrySize > bytes.length) break
    if (info.paletteEntrySize === 3) {
      palette[i * 4] = bytes[o + 2]; palette[i * 4 + 1] = bytes[o + 1]; palette[i * 4 + 2] = bytes[o]; palette[i * 4 + 3] = 255
    } else {
      palette[i * 4] = bytes[o + 2]; palette[i * 4 + 1] = bytes[o + 1]; palette[i * 4 + 2] = bytes[o]
      palette[i * 4 + 3] = bytes[o + 3] || 255 // reserved byte is usually 0
    }
  }

  const pixCount = width * height
  const out = new Uint8ClampedArray(pixCount * 4)
  const rowBytes = ((width * bpp + 31) >> 5) << 2
  const data = bytes
  const start = info.dataStart

  if (info.compression === 1 || info.compression === 2) {
    decodeDibRle(data, start, out, width, height, info.compression === 1 ? 8 : 4, palette)
  } else if (masks && (bpp === 16 || bpp === 32)) {
    decodeDibBitFields(data, start, out, width, height, rowBytes, topDown, bpp, masks)
  } else {
    let anyAlpha = false
    for (let y = 0; y < height; y++) {
      const srcY = topDown ? y : height - 1 - y
      const row = start + srcY * rowBytes
      let o = y * width * 4
      for (let x = 0; x < width; x++, o += 4) {
        switch (bpp) {
          case 1: {
            const byte = data[row + (x >> 3)]
            copyPalettePixel(out, o, palette, (byte >> (7 - (x & 7))) & 1)
            break
          }
          case 4: {
            const byte = data[row + (x >> 1)]
            copyPalettePixel(out, o, palette, x & 1 ? byte & 0x0f : byte >> 4)
            break
          }
          case 8: {
            copyPalettePixel(out, o, palette, data[row + x])
            break
          }
          case 16: {
            // 5-5-5
            const v = data[row + x * 2] | (data[row + x * 2 + 1] << 8)
            out[o] = (((v >> 10) & 31) * 255) / 31 | 0
            out[o + 1] = (((v >> 5) & 31) * 255) / 31 | 0
            out[o + 2] = ((v & 31) * 255) / 31 | 0
            out[o + 3] = 255
            break
          }
          case 24: {
            const p = row + x * 3
            out[o] = data[p + 2]; out[o + 1] = data[p + 1]; out[o + 2] = data[p]; out[o + 3] = 255
            break
          }
          default: { // 32
            const p = row + x * 4
            out[o] = data[p + 2]; out[o + 1] = data[p + 1]; out[o + 2] = data[p]
            const a = data[p + 3]
            out[o + 3] = a
            if (a) anyAlpha = true
            break
          }
        }
      }
    }
    if (bpp === 32 && !anyAlpha) {
      // BI_RGB 32-bit: 4th byte is "reserved" — treat as alpha only when the
      // file actually carries non-zero values (Photoshop does this)
      for (let o = 3; o < out.length; o += 4) out[o] = 255
    }
  }

  if (icon) applyIconAndMask(data, start, out, width, height, bpp, rowBytes)
  return { width, height, rgba: out }
}

function copyPalettePixel(out: Uint8ClampedArray, o: number, palette: Uint8Array, idx: number): void {
  const pi = idx * 4
  out[o] = palette[pi]; out[o + 1] = palette[pi + 1]; out[o + 2] = palette[pi + 2]; out[o + 3] = palette[pi + 3]
}

function decodeDibBitFields(
  data: Uint8Array, start: number, out: Uint8ClampedArray,
  width: number, height: number, rowBytes: number, topDown: boolean,
  bpp: number, masks: { r: number; g: number; b: number; a: number },
): void {
  const channel = (v: number, mask: number): number => {
    if (!mask) return 0
    let m = mask
    let shift = 0
    while (m && !(m & 1)) { m >>>= 1; shift++ }
    const bits = 32 - Math.clz32(m)
    const val = (v & mask) >>> shift
    if (bits >= 8) return val >> (bits - 8)
    return Math.round((val * 255) / ((1 << bits) - 1))
  }
  const hasAlpha = masks.a !== 0
  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : height - 1 - y
    const row = start + srcY * rowBytes
    let o = y * width * 4
    for (let x = 0; x < width; x++, o += 4) {
      let v: number
      if (bpp === 16) v = data[row + x * 2] | (data[row + x * 2 + 1] << 8)
      else v = (data[row + x * 4] | (data[row + x * 4 + 1] << 8) | (data[row + x * 4 + 2] << 16) | (data[row + x * 4 + 3] << 24)) >>> 0
      out[o] = channel(v, masks.r)
      out[o + 1] = channel(v, masks.g)
      out[o + 2] = channel(v, masks.b)
      out[o + 3] = hasAlpha ? channel(v, masks.a) : 255
    }
  }
}

function decodeDibRle(
  data: Uint8Array, start: number, out: Uint8ClampedArray,
  width: number, height: number, bpp: 4 | 8, palette: Uint8Array,
): void {
  let x = 0
  let y = 0
  let p = start
  const end = data.length
  const put = (idx: number) => {
    if (x >= width || y >= height) return
    copyPalettePixel(out, (y * width + x) * 4, palette, idx)
    x++
  }
  while (p + 1 < end) {
    const count = data[p]
    const v = data[p + 1]
    p += 2
    if (count > 0) {
      if (bpp === 8) { for (let i = 0; i < count; i++) put(v) }
      else { for (let i = 0; i < count; i++) put(i & 1 ? v & 0x0f : v >> 4) }
    } else {
      switch (v) {
        case 0: x = 0; y++; break                      // end of line
        case 1: return                                 // end of bitmap
        case 2: {                                      // delta
          if (p + 2 > end) return
          x += data[p]
          y += data[p + 1]
          p += 2
          if (y >= height) return
          break
        }
        default: {                                     // literal run (word padded)
          const nPixels = v
          const nBytes = bpp === 8 ? nPixels : (nPixels + 1) >> 1
          if (p + nBytes > end) return
          if (bpp === 8) {
            for (let i = 0; i < nPixels; i++) put(data[p + i])
          } else {
            for (let i = 0; i < nPixels; i++) {
              const byte = data[p + (i >> 1)]
              put(i & 1 ? byte & 0x0f : byte >> 4)
            }
          }
          p += nBytes + (nBytes & 1)
          break
        }
      }
    }
  }
}

/** ICO entries: apply the 1bpp AND mask as alpha when the DIB alpha is empty */
function applyIconAndMask(
  data: Uint8Array, start: number, out: Uint8ClampedArray,
  width: number, height: number, bpp: number, rowBytes: number,
): void {
  if (bpp === 32) {
    let anyAlpha = false
    for (let o = 3; o < out.length; o += 4) { if (out[o] !== 0) { anyAlpha = true; break } }
    if (anyAlpha) return // real alpha channel wins
  }
  const maskRowBytes = ((width + 31) >> 5) << 2
  const maskOff = start + rowBytes * height
  if (maskOff + maskRowBytes * height > data.length) return // no mask present
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y // bottom-up
    const row = maskOff + srcY * maskRowBytes
    for (let x = 0; x < width; x++) {
      const bit = (data[row + (x >> 3)] >> (7 - (x & 7))) & 1
      out[(y * width + x) * 4 + 3] = bit ? 0 : 255
    }
  }
}

// ============================================================
// ICO / CUR
// ============================================================

export async function decodeIco(bytes: Uint8Array): Promise<RawImage> {
  if (bytes.length < 6) throw new Error('Truncated ICO file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const type = view.getUint16(2, true)
  if (type !== 1 && type !== 2) throw new Error('Not an ICO/CUR file')
  const count = view.getUint16(4, true)
  if (count === 0) throw new Error('ICO contains no images')

  let bestOff = -1
  let bestArea = -1
  let bestBpp = -1
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16
    if (e + 16 > bytes.length) break
    const w = bytes[e] || 256
    const h = bytes[e + 1] || 256
    const bpp = view.getUint16(e + 6, true)
    const area = w * h
    if (area > bestArea || (area === bestArea && bpp > bestBpp)) {
      bestArea = area
      bestBpp = bpp
      bestOff = view.getUint32(e + 12, true)
    }
  }
  if (bestOff < 0 || bestOff >= bytes.length) throw new Error('Corrupt ICO entry offsets')

  const isPng = bytes[bestOff] === 0x89 && bytes[bestOff + 1] === 0x50 && bytes[bestOff + 2] === 0x4e && bytes[bestOff + 3] === 0x47
  if (isPng) {
    const blob = new Blob([bytes.subarray(bestOff) as unknown as BlobPart])
    try {
      const bitmap = await createImageBitmap(blob)
      const c = createCanvas(bitmap.width, bitmap.height)
      const ctx = ctx2d(c)
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      const img = ctx.getImageData(0, 0, c.width, c.height)
      return { width: c.width, height: c.height, rgba: img.data }
    } catch {
      throw new Error('Could not decode the PNG image inside this ICO')
    }
  }
  // DIB entry (BITMAPINFOHEADER without the file header, double-height, + AND mask)
  return decodeDib(bytes, view, bestOff, -1, true)
}
