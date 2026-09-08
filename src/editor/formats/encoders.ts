// ============================================================
// Chay's Photo Studio — Image format encoders (TASK 9-a)
// From-scratch encoders for TIFF, BMP, TGA, QOI, PPM and ICO.
// All take tightly packed RGBA (ImageData.data) + dimensions;
// ICO additionally needs a canvas (PNG-encodes each size).
// ============================================================

import { createCanvas, ctx2d, canvasToBlob } from '../utils/canvas'

export type ExportFormatId = 'png' | 'jpeg' | 'webp' | 'tiff' | 'bmp' | 'tga' | 'qoi' | 'ppm' | 'ico' | 'psd'

// ============================================================
// TIFF — baseline little-endian, RGB + unassociated alpha, strips
// ============================================================

/** TIFF-flavor LZW: MSB-first codes, 9→12 bits, early-change width
 *  increments (TIFF 6.0 spec), ClearCode + dictionary reset when the
 *  table approaches 4096 entries. Flat typed-array dictionary with a
 *  generation stamp so resets never pay a full-table clear. */
export function lzwEncodeTiff(src: Uint8Array | Uint8ClampedArray): Uint8Array {
  // worst case: ~9 output bits per input byte + clear codes
  const out = new Uint8Array(src.length + (src.length >> 3) + 1024)
  let op = 0
  let acc = 0
  let accBits = 0
  // dictionary: (prefixCode << 8 | byte) → (stamp << 12) | code ; 0 = empty
  const table = new Int32Array(4096 * 256)
  const prefix = new Int32Array(4096)
  const suffix = new Uint8Array(4096)
  let next = 258
  let width = 9
  let stamp = 1

  const emit = (code: number) => {
    acc = (acc << width) | code
    accBits += width
    while (accBits >= 8) {
      accBits -= 8
      out[op++] = (acc >>> accBits) & 0xff
    }
  }

  let prefixCode = -1 // empty string
  for (let i = 0; i < src.length; i++) {
    const b = src[i]
    if (prefixCode === -1) {
      prefixCode = b
      continue
    }
    const key = (prefixCode << 8) | b
    const entry = table[key]
    if (entry >= (stamp << 12) && entry < ((stamp + 1) << 12) && entry !== 0) {
      prefixCode = entry & 0xfff
      continue
    }
    // emit the current string, add the new entry
    emit(prefixCode)
    if (next < 4094) {
      table[key] = (stamp << 12) | next
      prefix[next] = prefixCode
      suffix[next] = b
      next++
      // early change (TIFF 6.0 / libtiff): the code width grows right after
      // entry (2^w − 1) is added — emit() runs BEFORE the add, so the bump
      // threshold is 2^w, matching the decoder's read-time transition
      if (next === (1 << width) && width < 12) width++
    } else {
      emit(256) // ClearCode — dictionary reset when the table is nearly full
      next = 258
      width = 9
      stamp++
    }
    prefixCode = b
  }
  if (prefixCode !== -1) emit(prefixCode)
  emit(257) // EOI
  if (accBits > 0) out[op++] = (acc << (8 - accBits)) & 0xff
  return out.subarray(0, op)
}

/** baseline little-endian RGBA 8-bit strip TIFF (compression None or LZW) */
export function encodeTiff(rgba: Uint8ClampedArray, width: number, height: number, lzw: boolean): Uint8Array {
  const bytesPerRow = width * 4
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor((1 << 20) / bytesPerRow) || 1))
  const numStrips = Math.ceil(height / rowsPerStrip)

  const strips: (Uint8Array | Uint8ClampedArray)[] = []
  for (let s = 0; s < numStrips; s++) {
    const rows = Math.min(rowsPerStrip, height - s * rowsPerStrip)
    const raw = rgba.subarray(s * rowsPerStrip * bytesPerRow, s * rowsPerStrip * bytesPerRow + rows * bytesPerRow)
    strips.push(lzw ? lzwEncodeTiff(raw) : raw)
  }

  // tag set (ascending order, required by the spec)
  const TAGS = [
    { tag: 256, type: 4, count: 1 }, // ImageWidth
    { tag: 257, type: 4, count: 1 }, // ImageLength
    { tag: 258, type: 3, count: 4 }, // BitsPerSample = 8,8,8,8
    { tag: 259, type: 3, count: 1 }, // Compression (1 | 5)
    { tag: 262, type: 3, count: 1 }, // Photometric = 2 (RGB)
    { tag: 273, type: 4, count: numStrips }, // StripOffsets
    { tag: 277, type: 3, count: 1 }, // SamplesPerPixel = 4
    { tag: 278, type: 4, count: 1 }, // RowsPerStrip
    { tag: 279, type: 4, count: numStrips }, // StripByteCounts
    { tag: 284, type: 3, count: 1 }, // PlanarConfiguration = 1
    { tag: 338, type: 3, count: 1 }, // ExtraSamples = 2 (unassociated alpha)
  ] as const

  const ifdOff = 8
  const ifdSize = 2 + TAGS.length * 12 + 4
  const bitsOff = ifdOff + ifdSize                       // 8 bytes (4 × SHORT)
  const stripOffArr = bitsOff + 8                        // 4 × numStrips
  const countArr = stripOffArr + 4 * numStrips           // 4 × numStrips
  const dataStart = (countArr + 4 * numStrips + 3) & ~3  // strip data (4-aligned)

  const stripOffsets: number[] = []
  let acc = dataStart
  for (const s of strips) { stripOffsets.push(acc); acc += s.length }
  const total = acc

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  // (TIFF is little-endian — every DataView write needs the LE flag)
  out.set([0x49, 0x49], 0)        // 'II' little-endian
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOff, true)

  // external value arrays
  for (let i = 0; i < 4; i++) view.setUint16(bitsOff + i * 2, 8, true)
  for (let s = 0; s < numStrips; s++) view.setUint32(stripOffArr + s * 4, stripOffsets[s], true)
  for (let s = 0; s < numStrips; s++) view.setUint32(countArr + s * 4, strips[s].length, true)

  // IFD
  view.setUint16(ifdOff, TAGS.length, true)
  let e = ifdOff + 2
  for (const t of TAGS) {
    view.setUint16(e, t.tag, true)
    view.setUint16(e + 2, t.type, true)
    view.setUint32(e + 4, t.count, true)
    const field = e + 8
    switch (t.tag) {
      case 256: view.setUint32(field, width, true); break
      case 257: view.setUint32(field, height, true); break
      case 258: view.setUint32(field, bitsOff, true); break
      case 259: view.setUint16(field, lzw ? 5 : 1, true); break
      case 262: view.setUint16(field, 2, true); break
      case 273: view.setUint32(field, numStrips > 1 ? stripOffArr : stripOffsets[0] ?? 0, true); break
      case 277: view.setUint16(field, 4, true); break
      case 278: view.setUint32(field, rowsPerStrip, true); break
      case 279: view.setUint32(field, numStrips > 1 ? countArr : strips[0]?.length ?? 0, true); break
      case 284: view.setUint16(field, 1, true); break
      case 338: view.setUint16(field, 2, true); break
    }
    e += 12
  }
  view.setUint32(e, 0, true) // next IFD: none

  // strip data
  let o = dataStart
  for (const s of strips) { out.set(s, o); o += s.length }
  return out
}

// ============================================================
// BMP — 24-bit BGR (flattened) or 32-bit BGRA, bottom-up
// ============================================================

export function encodeBmp(
  rgba: Uint8ClampedArray, width: number, height: number,
  opts: { keepAlpha?: boolean; bg?: [number, number, number] } = {},
): Uint8Array {
  const withAlpha = (opts.keepAlpha !== false) && hasAlphaChannel(rgba)
  if (!withAlpha) {
    const [br, bgc, bb] = opts.bg ?? [255, 255, 255]
    const rowBytes = ((width * 3 + 3) >> 2) << 2
    const dataSize = rowBytes * height
    const out = new Uint8Array(54 + dataSize)
    const view = new DataView(out.buffer)
    out.set([0x42, 0x4d], 0)
    view.setUint32(2, 54 + dataSize, true)
    view.setUint32(10, 54, true)
    view.setUint32(14, 40, true)
    view.setInt32(18, width, true)
    view.setInt32(22, height, true)
    view.setUint16(26, 1, true)
    view.setUint16(28, 24, true)
    view.setUint32(34, dataSize, true)
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width * 4
      const dst = 54 + y * rowBytes
      for (let x = 0; x < width; x++) {
        const o = src + x * 4
        const a = rgba[o + 3] / 255
        out[dst + x * 3] = Math.round(rgba[o + 2] * a + bb * (1 - a))
        out[dst + x * 3 + 1] = Math.round(rgba[o + 1] * a + bgc * (1 - a))
        out[dst + x * 3 + 2] = Math.round(rgba[o] * a + br * (1 - a))
      }
    }
    return out
  }
  // 32-bit BGRA
  const dataSize = width * height * 4
  const out = new Uint8Array(54 + dataSize)
  const view = new DataView(out.buffer)
  out.set([0x42, 0x4d], 0)
  view.setUint32(2, 54 + dataSize, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 32, true)
  view.setUint32(34, dataSize, true)
  const rowBytes = width * 4
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * rowBytes
    const dst = 54 + y * rowBytes
    for (let x = 0; x < width; x++) {
      const o = src + x * 4
      out[dst + x * 4] = rgba[o + 2]
      out[dst + x * 4 + 1] = rgba[o + 1]
      out[dst + x * 4 + 2] = rgba[o]
      out[dst + x * 4 + 3] = rgba[o + 3]
    }
  }
  return out
}

function hasAlphaChannel(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true
  return false
}

// ============================================================
// TGA — 24/32-bit, optional RLE, bottom-left origin
// ============================================================

export function encodeTga(
  rgba: Uint8ClampedArray, width: number, height: number,
  opts: { rle?: boolean; keepAlpha?: boolean; bg?: [number, number, number] } = {},
): Uint8Array {
  const withAlpha = (opts.keepAlpha !== false) && hasAlphaChannel(rgba)
  const bpp = withAlpha ? 32 : 24
  const bytesPP = bpp >> 3
  const useRle = opts.rle !== false

  // build bottom-up BGR(A) pixel buffer
  const pixels = new Uint8Array(width * height * bytesPP)
  const bg = opts.bg ?? [255, 255, 255]
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4
    const dst = y * width * bytesPP
    for (let x = 0; x < width; x++) {
      const o = src + x * 4
      const p = dst + x * bytesPP
      if (withAlpha) {
        pixels[p] = rgba[o + 2]
        pixels[p + 1] = rgba[o + 1]
        pixels[p + 2] = rgba[o]
        pixels[p + 3] = rgba[o + 3]
      } else {
        const a = rgba[o + 3] / 255
        pixels[p] = Math.round(rgba[o + 2] * a + bg[2] * (1 - a))
        pixels[p + 1] = Math.round(rgba[o + 1] * a + bg[1] * (1 - a))
        pixels[p + 2] = Math.round(rgba[o] * a + bg[0] * (1 - a))
      }
    }
  }

  const rle = useRle ? tgaRleEncode(pixels, width, height, bytesPP) : pixels
  // header: 18 bytes (TGA is little-endian)
  const out = new Uint8Array(18 + rle.length)
  const view = new DataView(out.buffer)
  out[2] = useRle ? 10 : 2   // image type: RLE / uncompressed true-color
  view.setUint16(12, width, true)
  view.setUint16(14, height, true)
  out[16] = bpp
  // image descriptor: alpha depth (bits 0-3) + origin bits; bottom-left origin
  out[17] = withAlpha ? 0x08 : 0x00
  out.set(rle, 18)
  return out
}

/** per-scanline RLE packets (raw + run, max 128 pixels each) */
function tgaRleEncode(pixels: Uint8Array, width: number, height: number, bytesPP: number): Uint8Array {
  const chunks: Uint8Array[] = []
  const rowBytes = width * bytesPP
  for (let y = 0; y < height; y++) {
    const row = y * rowBytes
    let x = 0
    while (x < width) {
      // find a run at x
      let run = 1
      while (x + run < width && run < 128) {
        let same = true
        for (let j = 0; j < bytesPP; j++) {
          if (pixels[row + (x + run) * bytesPP + j] !== pixels[row + x * bytesPP + j]) { same = false; break }
        }
        if (!same) break
        run++
      }
      if (run >= 2) {
        const pkt = new Uint8Array(2 + bytesPP)
        pkt[0] = 0x80 | (run - 1)
        for (let j = 0; j < bytesPP; j++) pkt[1 + j] = pixels[row + x * bytesPP + j]
        chunks.push(pkt)
        x += run
      } else {
        // raw packet — extend until a 2-pixel run appears or 128 reached
        const start = x
        x++
        while (x < width && x - start < 128) {
          if (x + 1 < width) {
            let same = true
            for (let j = 0; j < bytesPP; j++) {
              if (pixels[row + x * bytesPP + j] !== pixels[row + (x + 1) * bytesPP + j]) { same = false; break }
            }
            if (same) break
          }
          x++
        }
        const cnt = x - start
        const pkt = new Uint8Array(1 + cnt * bytesPP)
        pkt[0] = cnt - 1
        for (let i = 0; i < cnt; i++) {
          for (let j = 0; j < bytesPP; j++) pkt[1 + i * bytesPP + j] = pixels[row + (start + i) * bytesPP + j]
        }
        chunks.push(pkt)
      }
    }
  }
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

// ============================================================
// QOI — full encoder (index, run, diff, luma, rgb, rgba)
// ============================================================

export function encodeQoi(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const n = width * height
  const out = new Uint8Array(14 + n * 5 + 8) // generous upper bound
  const view = new DataView(out.buffer)
  out.set([0x71, 0x6f, 0x69, 0x66], 0) // 'qoif'
  view.setUint32(4, width)
  view.setUint32(8, height)
  out[12] = 4 // channels
  out[13] = 0 // sRGB with linear alpha

  const index = new Uint8Array(64 * 4)
  let prevR = 0, prevG = 0, prevB = 0, prevA = 255
  let op = 14
  let run = 0
  for (let i = 0; i < n; i++) {
    const px = i * 4
    const r = rgba[px], g = rgba[px + 1], b = rgba[px + 2], a = rgba[px + 3]
    if (r === prevR && g === prevG && b === prevB && a === prevA) {
      run++
      if (run === 62 || i === n - 1) {
        out[op++] = 0xc0 | (run - 1)
        run = 0
      }
    } else {
      if (run > 0) {
        out[op++] = 0xc0 | (run - 1)
        run = 0
      }
      const hash = (r * 3 + g * 5 + b * 7 + a * 11) % 64
      if (index[hash * 4] === r && index[hash * 4 + 1] === g && index[hash * 4 + 2] === b && index[hash * 4 + 3] === a) {
        out[op++] = hash
      } else {
        index[hash * 4] = r; index[hash * 4 + 1] = g; index[hash * 4 + 2] = b; index[hash * 4 + 3] = a
        const dr = r - prevR, dg = g - prevG, db = b - prevB
        if (a === prevA && dr > -3 && dr < 2 && dg > -3 && dg < 2 && db > -3 && db < 2) {
          out[op++] = 0x40 | ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2)
        } else if (a === prevA && dg > -33 && dg < 32 && dr - dg > -9 && dr - dg < 8 && db - dg > -9 && db - dg < 8) {
          out[op++] = 0x80 | (dg + 32)
          out[op++] = ((dr - dg + 8) << 4) | (db - dg + 8)
        } else if (a === prevA) {
          out[op++] = 0xfe
          out[op++] = r; out[op++] = g; out[op++] = b
        } else {
          out[op++] = 0xff
          out[op++] = r; out[op++] = g; out[op++] = b; out[op++] = a
        }
      }
      prevR = r; prevG = g; prevB = b; prevA = a
    }
  }
  if (run > 0) out[op++] = 0xc0 | (run - 1)
  // end marker
  out.fill(0, op, op + 7)
  out[op + 7] = 1
  op += 8
  return out.subarray(0, op)
}

// ============================================================
// PPM — P6 binary RGB (alpha flattened)
// ============================================================

export function encodePpm(rgba: Uint8ClampedArray, width: number, height: number, bg: [number, number, number]): Uint8Array {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`)
  const out = new Uint8Array(header.length + width * height * 3)
  out.set(header, 0)
  let o = header.length
  for (let i = 0; i < width * height; i++) {
    const p = i * 4
    const a = rgba[p + 3] / 255
    out[o++] = Math.round(rgba[p] * a + bg[0] * (1 - a))
    out[o++] = Math.round(rgba[p + 1] * a + bg[1] * (1 - a))
    out[o++] = Math.round(rgba[p + 2] * a + bg[2] * (1 - a))
  }
  return out
}

// ============================================================
// ICO — multi-size Windows icon (each entry PNG-encoded)
// ============================================================

export const ICO_SIZE_POOL = [16, 24, 32, 48, 64, 128, 256]

export async function encodeIco(canvas: HTMLCanvasElement, sizes?: number[]): Promise<Uint8Array> {
  const pool = (sizes?.length ? sizes : ICO_SIZE_POOL)
    .filter(s => ICO_SIZE_POOL.includes(s) && s <= Math.min(canvas.width, canvas.height))
  const useSizes = pool.length ? [...new Set(pool)].sort((a, b) => a - b) : [Math.min(16, canvas.width, canvas.height) || 1]
  const pngs: Uint8Array[] = []
  for (const s of useSizes) {
    const c = createCanvas(s, s)
    const ctx = ctx2d(c)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(canvas, 0, 0, s, s)
    const blob = await canvasToBlob(c, 'image/png')
    pngs.push(new Uint8Array(await blob.arrayBuffer()))
  }
  const headerSize = 6 + useSizes.length * 16
  let total = headerSize
  for (const p of pngs) total += p.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint16(0, 0, true)     // reserved
  view.setUint16(2, 1, true)     // type: icon
  view.setUint16(4, useSizes.length, true)
  let offset = headerSize
  for (let i = 0; i < useSizes.length; i++) {
    const e = 6 + i * 16
    out[e] = useSizes[i] >= 256 ? 0 : useSizes[i]        // width (0 = 256)
    out[e + 1] = useSizes[i] >= 256 ? 0 : useSizes[i]    // height
    out[e + 2] = 0                                        // color count
    out[e + 3] = 0                                        // reserved
    view.setUint16(e + 4, 1, true)                        // planes
    view.setUint16(e + 6, 32, true)                       // bit count
    view.setUint32(e + 8, pngs[i].length, true)           // bytes in resource
    view.setUint32(e + 12, offset, true)                  // image offset
    out.set(pngs[i], offset)
    offset += pngs[i].length
  }
  return out
}
