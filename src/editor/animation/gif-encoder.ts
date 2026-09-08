// ============================================================
// GIF89a animated encoder — from scratch, no npm (Task 9-c)
//  · octree color quantizer (built from stride-sampled pixels of ALL frames)
//  · optional Floyd–Steinberg dithering (serpentine scan)
//  · LZW compressor (min code size 8, 12-bit codes, clear-code resets,
//    ≤255-byte sub-block chunking, LSB-first bit packing)
//  · GIF89a header / Logical Screen Descriptor / global color table /
//    NETSCAPE2.0 loop extension / per-frame GCE + image descriptor
//  · transparency: palette slot 0 reserved, alpha < 128 → index 0, disposal 2
// ============================================================

import { getImageData } from '../utils/canvas'

export interface GifEncodeOptions {
  /** palette size incl. the reserved transparent slot — clamped 2..256 (default 128) */
  colors?: number
  /** Floyd–Steinberg dithering, serpentine (default true) */
  dither?: boolean
  /** NETSCAPE2.0 loop-forever extension (default true) */
  loopForever?: boolean
  /** alpha < 128 → transparent index 0, disposal 2 (default true).
   *  When false, frames are flattened over white, disposal 1. */
  transparentBg?: boolean
  /** 0..1 encoding progress (called once per frame) */
  onProgress?: (frac: number) => void
}

export interface GifFrameInput {
  canvas: HTMLCanvasElement
  delayMs: number
}

// ---------- growable byte buffer ----------------------------------------------

class ByteBuf {
  private buf = new Uint8Array(16)
  private len = 0
  constructor(cap = 1024) {
    if (cap > 16) this.buf = new Uint8Array(cap)
  }
  private reserve(n: number) {
    if (this.len + n <= this.buf.length) return
    let cap = this.buf.length * 2
    while (cap < this.len + n) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }
  u8(v: number) { this.reserve(1); this.buf[this.len++] = v & 0xff }
  bytes(src: Uint8Array) { this.reserve(src.length); this.buf.set(src, this.len); this.len += src.length }
  view(): Uint8Array<ArrayBuffer> { return this.buf.subarray(0, this.len) }
}

// ---------- octree color quantizer --------------------------------------------

const MAX_DEPTH = 5 // leaves keyed by the top 5 bits/channel (15-bit color)

class OctreeNode {
  children: (OctreeNode | null)[] = [null, null, null, null, null, null, null, null]
  r = 0; g = 0; b = 0; count = 0
  leaf = false
  /** number of live children (internal-list bookkeeping) */
  n = 0
}

class OctreeQuantizer {
  private root = new OctreeNode()
  private leafCount = 0
  /** internal[d] = nodes at depth d that currently have ≥1 child */
  private internal: OctreeNode[][] = Array.from({ length: MAX_DEPTH }, () => [])

  add(r: number, g: number, b: number) {
    let node = this.root
    node.r += r; node.g += g; node.b += b; node.count++
    for (let d = 0; d < MAX_DEPTH; d++) {
      const shift = 7 - d
      const idx = (((r >> shift) & 1) << 2) | (((g >> shift) & 1) << 1) | ((b >> shift) & 1)
      let child = node.children[idx]
      if (!child) {
        child = new OctreeNode()
        node.children[idx] = child
        node.n++
        if (node.n === 1) this.internal[d].push(node)
        if (d === MAX_DEPTH - 1) { child.leaf = true; this.leafCount++ }
      }
      node = child
      node.r += r; node.g += g; node.b += b; node.count++
    }
  }

  /** merge one internal node (deepest first) into a leaf */
  private reduce(): boolean {
    for (let d = MAX_DEPTH - 1; d >= 0; d--) {
      const list = this.internal[d]
      let best = -1
      for (let i = 0; i < list.length; i++) {
        if (list[i].n > 0 && (best < 0 || list[i].count < list[best].count)) best = i
      }
      if (best < 0) continue
      const node = list[best]
      let removed = 0
      for (let i = 0; i < 8; i++) {
        if (node.children[i]) { node.children[i] = null; removed++ }
      }
      node.n = 0
      node.leaf = true
      this.leafCount -= removed - 1
      list.splice(best, 1)
      return true
    }
    return false
  }

  /** average color of every leaf (deterministic depth-first order) */
  palette(maxColors: number): [number, number, number][] {
    let guard = 0
    while (this.leafCount > maxColors && guard++ < 200_000) {
      if (!this.reduce()) break
    }
    const out: [number, number, number][] = []
    const walk = (n: OctreeNode) => {
      if (n.leaf) {
        if (n.count > 0) out.push([Math.round(n.r / n.count), Math.round(n.g / n.count), Math.round(n.b / n.count)])
        return
      }
      for (const c of n.children) if (c) walk(c)
    }
    walk(this.root)
    return out
  }
}

// ---------- LZW compressor ------------------------------------------------------

const MIN_CODE_SIZE = 8

/** GIF LZW: clear-code resets, 12-bit max, table reset when full. Code width
 *  grows right after the entry with value 2^codeSize is defined — the classic
 *  convention that keeps browser decoders in lockstep with the encoder. */
function lzwEncode(indices: Uint8Array, sizeHint: number): Uint8Array {
  const CLEAR = 1 << MIN_CODE_SIZE   // 256
  const EOI = CLEAR + 1              // 257
  const dict = new Map<number, number>()
  let codeSize = MIN_CODE_SIZE + 1   // 9
  let next = EOI + 1                 // 258
  let acc = 0
  let nbits = 0
  const out = new ByteBuf(sizeHint + 1024)

  const emit = (code: number) => {
    acc |= code << nbits
    nbits += codeSize
    while (nbits >= 8) { out.u8(acc & 0xff); acc >>>= 8; nbits -= 8 }
  }

  emit(CLEAR)
  if (!indices.length) {
    emit(EOI)
    if (nbits > 0) out.u8(acc & 0xff)
    return out.view()
  }

  let prefix = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]
    const key = (prefix << 8) | k
    const hit = dict.get(key)
    if (hit !== undefined) { prefix = hit; continue }
    emit(prefix)
    if (next < 4096) {
      dict.set(key, next)
      if (next === (1 << codeSize) && codeSize < 12) codeSize++
      next++
    } else {
      // table full — reset via clear code (decoder resets in lockstep)
      emit(CLEAR)
      dict.clear()
      codeSize = MIN_CODE_SIZE + 1
      next = EOI + 1
    }
    prefix = k
  }
  emit(prefix)
  emit(EOI)
  if (nbits > 0) out.u8(acc & 0xff)
  return out.view()
}

/** wrap raw LZW bytes into ≤255-byte sub-blocks, terminated by 0 */
function toSubBlocks(data: Uint8Array): Uint8Array {
  const blocks = Math.ceil(data.length / 255)
  const out = new Uint8Array(data.length + blocks + 1)
  let p = 0
  for (let o = 0; o < data.length; o += 255) {
    const len = Math.min(255, data.length - o)
    out[p++] = len
    out.set(data.subarray(o, o + len), p)
    p += len
  }
  out[p++] = 0
  return out.subarray(0, p)
}

// ---------- main entry ------------------------------------------------------------

const yieldToUI = () => new Promise<void>(r => setTimeout(r, 0))

export async function encodeGif(frames: GifFrameInput[], opts: GifEncodeOptions = {}): Promise<Blob> {
  if (!frames.length) throw new Error('No frames to encode')

  const colors = Math.max(2, Math.min(256, Math.round(opts.colors ?? 128)))
  const dither = opts.dither !== false
  const loopForever = opts.loopForever !== false
  const transparent = opts.transparentBg !== false
  const onProgress = opts.onProgress

  const W = Math.max(1, frames[0].canvas.width)
  const H = Math.max(1, frames[0].canvas.height)

  // ---- pass 1: octree palette from stride-sampled pixels across all frames ----
  const perFrame = W * H
  let pixelStride = 1
  if (perFrame > 262_144) pixelStride = 4
  else if (perFrame > 65_536) pixelStride = 2
  // don't sample more than ~64 frames' worth of colors
  const frameStride = Math.max(1, Math.ceil(frames.length / 64))

  const octree = new OctreeQuantizer()
  for (let f = 0; f < frames.length; f += frameStride) {
    const img = getImageData(frames[f].canvas)
    const d = img.data
    for (let i = 0; i < d.length; i += 4 * pixelStride) {
      const a = d[i + 3]
      if (transparent) {
        if (a < 128) continue // transparent → palette slot 0, never quantized
        octree.add(d[i], d[i + 1], d[i + 2])
      } else {
        // flatten over white
        const al = a / 255
        octree.add(
          Math.round(d[i] * al + 255 * (1 - al)),
          Math.round(d[i + 1] * al + 255 * (1 - al)),
          Math.round(d[i + 2] * al + 255 * (1 - al)),
        )
      }
    }
  }

  // palette[0] reserved for transparency when enabled
  const octreeColors = Math.max(1, transparent ? Math.min(colors - 1, 255) : colors)
  const octreePalette = octree.palette(octreeColors)
  const palette: [number, number, number][] = transparent
    ? [[0, 0, 0], ...octreePalette]  // slot 0 = transparent (value never displayed)
    : (octreePalette.length ? octreePalette : [[255, 255, 255]])
  const paletteTotal = palette.length

  // global color table size: power of two, 2..256
  let tableSize = 2
  while (tableSize < paletteTotal && tableSize < 256) tableSize <<= 1
  const tableBits = Math.round(Math.log2(tableSize)) // 1..8

  // ---- fast lookup: 15-bit lazy nearest-palette cache ----
  const cache = new Int16Array(32768).fill(-1)
  const searchStart = transparent ? 1 : 0
  const nearestIdx = (r: number, g: number, b: number): number => {
    const key5 = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const hit = cache[key5]
    if (hit >= 0) return hit
    let best = searchStart
    if (best >= paletteTotal) return 0
    let bd = Infinity
    for (let i = searchStart; i < paletteTotal; i++) {
      const dr = r - palette[i][0], dg = g - palette[i][1], db = b - palette[i][2]
      const dist = dr * dr + dg * dg + db * db
      if (dist < bd) { bd = dist; best = i }
    }
    cache[key5] = best
    return best
  }

  // ---- pass 2: quantize + LZW each frame ----
  const indices = new Uint8Array(W * H)
  const quantize = (img: ImageData) => {
    const d = img.data
    if (!dither) {
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const a = d[i + 3]
        if (transparent && a < 128) { indices[p] = 0; continue }
        let r = d[i], g = d[i + 1], b = d[i + 2]
        if (!transparent && a < 255) {
          const al = a / 255
          r = Math.round(r * al + 255 * (1 - al))
          g = Math.round(g * al + 255 * (1 - al))
          b = Math.round(b * al + 255 * (1 - al))
        }
        indices[p] = nearestIdx(r, g, b)
      }
      return
    }
    // Floyd–Steinberg, serpentine rows
    let curR = new Float32Array(W), curG = new Float32Array(W), curB = new Float32Array(W)
    let nxtR = new Float32Array(W), nxtG = new Float32Array(W), nxtB = new Float32Array(W)
    for (let y = 0; y < H; y++) {
      // error accumulated for this row (from the row above) becomes current
      let t = curR; curR = nxtR; nxtR = t
      t = curG; curG = nxtG; nxtG = t
      t = curB; curB = nxtB; nxtB = t
      nxtR.fill(0); nxtG.fill(0); nxtB.fill(0)
      const ltr = (y & 1) === 0
      for (let s = 0; s < W; s++) {
        const x = ltr ? s : W - 1 - s
        const p = y * W + x
        const i = p * 4
        const a = d[i + 3]
        if (transparent && a < 128) {
          indices[p] = 0
          curR[x] = 0; curG[x] = 0; curB[x] = 0 // never propagate error through holes
          continue
        }
        let r: number, g: number, b: number
        if (!transparent && a < 255) {
          const al = a / 255
          r = d[i] * al + 255 * (1 - al) + curR[x]
          g = d[i + 1] * al + 255 * (1 - al) + curG[x]
          b = d[i + 2] * al + 255 * (1 - al) + curB[x]
        } else {
          r = d[i] + curR[x]; g = d[i + 1] + curG[x]; b = d[i + 2] + curB[x]
        }
        r = r < 0 ? 0 : r > 255 ? 255 : r
        g = g < 0 ? 0 : g > 255 ? 255 : g
        b = b < 0 ? 0 : b > 255 ? 255 : b
        const idx = nearestIdx(r | 0, g | 0, b | 0)
        indices[p] = idx
        const pc = palette[idx]
        const er = r - pc[0], eg = g - pc[1], eb = b - pc[2]
        const dir = ltr ? 1 : -1
        const nx = x + dir
        const px = x - dir
        if (nx >= 0 && nx < W) {
          curR[nx] += er * 7 / 16; curG[nx] += eg * 7 / 16; curB[nx] += eb * 7 / 16
        }
        if (px >= 0 && px < W) {
          nxtR[px] += er * 3 / 16; nxtG[px] += eg * 3 / 16; nxtB[px] += eb * 3 / 16
        }
        nxtR[x] += er * 5 / 16; nxtG[x] += eg * 5 / 16; nxtB[x] += eb * 5 / 16
        if (nx >= 0 && nx < W) {
          nxtR[nx] += er * 1 / 16; nxtG[nx] += eg * 1 / 16; nxtB[nx] += eb * 1 / 16
        }
        curR[x] = 0; curG[x] = 0; curB[x] = 0
      }
    }
  }

  // ---- assemble the file ----
  const out = new ByteBuf(W * H + 4096)

  // header "GIF89a"
  out.bytes(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))

  // Logical Screen Descriptor (little-endian 16-bit dims)
  out.u8(W & 0xff); out.u8((W >> 8) & 0xff)
  out.u8(H & 0xff); out.u8((H >> 8) & 0xff)
  // packed: GCT flag | color resolution 7 | sort 0 | table size bits-1
  out.u8(0x80 | (7 << 4) | (tableBits - 1))
  out.u8(0) // background color index
  out.u8(0) // pixel aspect ratio

  // Global Color Table
  for (let i = 0; i < tableSize; i++) {
    const c: [number, number, number] = i < paletteTotal ? palette[i] : [0, 0, 0]
    out.u8(c[0]); out.u8(c[1]); out.u8(c[2])
  }

  // NETSCAPE2.0 loop extension
  if (loopForever) {
    out.u8(0x21); out.u8(0xff); out.u8(0x0b)
    out.bytes(new Uint8Array([0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30])) // "NETSCAPE2.0"
    out.u8(0x03); out.u8(0x01); out.u8(0); out.u8(0) // loop count 0 = forever
    out.u8(0)
  }

  // frames
  for (let f = 0; f < frames.length; f++) {
    const fr = frames[f]
    let img: ImageData
    if (fr.canvas.width === W && fr.canvas.height === H) {
      img = getImageData(fr.canvas)
    } else {
      // normalize stray sizes onto the logical screen
      const c = document.createElement('canvas')
      c.width = W; c.height = H
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(fr.canvas, 0, 0)
      img = ctx.getImageData(0, 0, W, H)
    }
    quantize(img)
    const lzw = lzwEncode(indices, W * H)

    // Graphic Control Extension
    const delay = Math.max(2, Math.round(Math.max(10, fr.delayMs) / 10)) // centiseconds
    const disposal = transparent ? 2 : 1 // 2 = restore to background, 1 = keep
    out.u8(0x21); out.u8(0xf9); out.u8(0x04)
    out.u8((disposal << 2) | (transparent ? 1 : 0))
    out.u8(delay & 0xff); out.u8((delay >> 8) & 0xff)
    out.u8(0) // transparent palette index (slot 0)
    out.u8(0)

    // Image Descriptor (full canvas at 0,0, no local table, no interlace)
    out.u8(0x2c)
    out.u8(0); out.u8(0); out.u8(0); out.u8(0)
    out.u8(W & 0xff); out.u8((W >> 8) & 0xff)
    out.u8(H & 0xff); out.u8((H >> 8) & 0xff)
    out.u8(0)

    // LZW min code size + data sub-blocks
    out.u8(MIN_CODE_SIZE)
    out.bytes(toSubBlocks(lzw))

    onProgress?.((f + 1) / frames.length)
    await yieldToUI()
  }

  // trailer
  out.u8(0x3b)

  return new Blob([out.view()], { type: 'image/gif' })
}
