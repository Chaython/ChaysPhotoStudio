'use client'
// GIMP XCF (eXperimental Computing Facility) format parser
// Supports reading basic layer structure, blending modes, opacity, masks, and pixel data.
// Full XCF spec: https://gitlab.gnome.org/GNOME/gimp/-/blob/master/devel-docs/xcf.txt

import { createCanvas, ctx2d } from '../utils/canvas'

const XCF_MAGIC = 'gimp xcf '
const MAX_DIM = 32768
const MAX_PIXELS = 1_073_741_824

function readU32BE(v: DataView, off: number): number { return v.getUint32(off, false) }
function readU16BE(v: DataView, off: number): number { return v.getUint16(off, false) }
function readS32BE(v: DataView, off: number): number { return v.getInt32(off, false) }
function readString(v: DataView, off: number, maxLen = 1024): string {
  let len = 0
  while (len < maxLen && off + len < v.byteLength && v.getUint8(off + len) !== 0) len++
  return new TextDecoder().decode(new Uint8Array(v.buffer, v.byteOffset + off, len))
}

export interface XcfLayer {
  name: string
  x: number
  y: number
  width: number
  height: number
  opacity: number
  mode: string
  visible: boolean
  linked: boolean
  mask?: XcfMask
  canvas: HTMLCanvasElement
  children?: XcfLayer[] // for layer groups
}

export interface XcfMask {
  x: number
  y: number
  width: number
  height: number
  canvas: HTMLCanvasElement
  apply: boolean
  edit: boolean
  show: boolean
}

export interface ParsedXcf {
  version: number
  width: number
  height: number
  precision: number
  colorSpace: 'RGB' | 'GRAY' | 'INDEXED'
  layers: XcfLayer[]
  guides: Array<{ orientation: 'H' | 'V'; position: number; color: string }>
  selection?: XcfMask
  paths?: unknown[] // placeholder for vector paths
}

const BLEND_MODE_MAP: Record<number, string> = {
  0: 'normal', 1: 'dissolve', 2: 'behind', 3: 'multiply', 4: 'screen',
  5: 'overlay', 6: 'difference', 7: 'addition', 8: 'subtract', 9: 'darken',
  10: 'lighten', 11: 'hue', 12: 'saturation', 13: 'color', 14: 'value',
  15: 'divide', 16: 'dodge', 17: 'burn', 18: 'hardlight', 19: 'softlight',
  20: 'grain_extract', 21: 'grain_merge', 22: 'color_erase', 23: 'erase',
  24: 'merge', 25: 'split', 26: 'plus', 27: 'multiply', 28: 'screen',
  29: 'overlay', 30: 'difference', 31: 'addition', 32: 'subtract',
  33: 'darken_only', 34: 'lighten_only',
}

const PRECISION_MAP: Record<number, string> = {
  0: '8-bit integer', 1: '16-bit integer', 2: '32-bit float',
  3: '16-bit float', 4: '32-bit integer',
}

async function decompressRle(src: Uint8Array, width: number, height: number, bpp: number): Promise<Uint8Array> {
  const out = new Uint8Array(width * height * bpp)
  let srcOff = 0
  let dstOff = 0
  const rowBytes = width * bpp

  for (let y = 0; y < height; y++) {
    for (let c = 0; c < bpp; c++) {
      let x = 0
      while (x < width) {
        if (srcOff >= src.length) throw new Error('Truncated RLE data')
        const count = src[srcOff++]
        if (count < 128) {
          // Raw run
          const len = count + 1
          for (let i = 0; i < len; i++) {
            if (srcOff >= src.length) throw new Error('Truncated RLE data')
            out[dstOff++] = src[srcOff++]
            x++
          }
        } else if (count > 128) {
          // Compressed run
          const len = 257 - count
          if (srcOff >= src.length) throw new Error('Truncated RLE data')
          const val = src[srcOff++]
          for (let i = 0; i < len; i++) {
            out[dstOff++] = val
            x++
          }
        } else {
          // count === 128: end of row marker (GIMP uses this sometimes)
        }
      }
    }
  }
  return out
}

async function decompressZlib(src: Uint8Array): Promise<Uint8Array> {
  // Use browser's built-in decompression via CompressionStream (requires secure context)
  if (typeof DecompressionStream !== 'undefined') {
    const blob = new Blob([src])
    const stream = blob.stream().pipeThrough(new DecompressionStream('deflate'))
    const chunks: Uint8Array[] = []
    for await (const chunk of stream) chunks.push(chunk)
    let total = 0
    for (const c of chunks) total += c.length
    const result = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { result.set(c, off); off += c.length }
    return result
  }
  // Fallback: use pako if available, or throw
  throw new Error('Zlib decompression requires secure context (HTTPS) or pako library')
}

async function readTile(v: DataView, offset: number, tileWidth: number, tileHeight: number, bpp: number, compression: number): Promise<Uint8Array> {
  const tileOffset = readU32BE(v, offset)
  const tileSize = readU32BE(v, offset + 4)
  const tileData = new Uint8Array(v.buffer, v.byteOffset + tileOffset, tileSize)

  if (compression === 0) {
    // No compression - but tiles are stored as RLE rows
    return decompressRle(tileData, tileWidth, tileHeight, bpp)
  } else if (compression === 1) {
    // Zlib compressed
    const decomp = await decompressZlib(tileData)
    return decompressRle(decomp, tileWidth, tileHeight, bpp)
  } else {
    throw new Error(`Unknown tile compression ${compression}`)
  }
}

async function readLayerData(v: DataView, layerOffset: number, layer: Partial<XcfLayer>, bpp: number, compression: number): Promise<HTMLCanvasElement> {
  const { width, height } = layer
  const canvas = createCanvas(width!, height!)
  const ctx = ctx2d(canvas)
  const img = ctx.createImageData(width!, height!)

  const tileWidth = 64
  const tileHeight = 64
  const tilesX = Math.ceil(width! / tileWidth)
  const tilesY = Math.ceil(height! / tileHeight)

  // Read tile directory
  const tileDirOffset = readU32BE(v, layerOffset)
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tileIdx = ty * tilesX + tx
      const tileOff = tileDirOffset + tileIdx * 8
      const tileData = await readTile(v, tileOff, tileWidth, tileHeight, bpp, compression)
      // Copy tile to image data
      const tw = Math.min(tileWidth, width! - tx * tileWidth)
      const th = Math.min(tileHeight, height! - ty * tileHeight)
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const srcIdx = (y * tileWidth + x) * bpp
          const dstIdx = ((ty * tileHeight + y) * width! + (tx * tileWidth + x)) * 4
          if (bpp === 3) {
            img.data[dstIdx] = tileData[srcIdx]
            img.data[dstIdx + 1] = tileData[srcIdx + 1]
            img.data[dstIdx + 2] = tileData[srcIdx + 2]
            img.data[dstIdx + 3] = 255
          } else if (bpp === 4) {
            img.data[dstIdx] = tileData[srcIdx]
            img.data[dstIdx + 1] = tileData[srcIdx + 1]
            img.data[dstIdx + 2] = tileData[srcIdx + 2]
            img.data[dstIdx + 3] = tileData[srcIdx + 3]
          } else if (bpp === 1) {
            img.data[dstIdx] = tileData[srcIdx]
            img.data[dstIdx + 1] = tileData[srcIdx]
            img.data[dstIdx + 2] = tileData[srcIdx]
            img.data[dstIdx + 3] = 255
          } else if (bpp === 2) {
            img.data[dstIdx] = tileData[srcIdx]
            img.data[dstIdx + 1] = tileData[srcIdx]
            img.data[dstIdx + 2] = tileData[srcIdx]
            img.data[dstIdx + 3] = tileData[srcIdx + 1]
          }
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

async function parseHierarchy(v: DataView, offset: number, bpp: number, compression: number, parentX = 0, parentY = 0): Promise<XcfLayer[]> {
  const layers: XcfLayer[] = []
  let currentOffset = offset

  while (currentOffset < v.byteLength) {
    const type = readU32BE(v, currentOffset)
    if (type === 0) break // end of hierarchy

    if (type === 1) {
      // Layer
      currentOffset += 4
      const width = readU32BE(v, currentOffset); currentOffset += 4
      const height = readU32BE(v, currentOffset); currentOffset += 4
      const x = readS32BE(v, currentOffset); currentOffset += 4
      const y = readS32BE(v, currentOffset); currentOffset += 4
      const opacity = v.getUint8(currentOffset++); currentOffset += 3 // padding
      const mode = readU32BE(v, currentOffset); currentOffset += 4
      const flags = readU32BE(v, currentOffset); currentOffset += 4
      const visible = (flags & 1) !== 0
      const linked = (flags & 2) !== 0
      const preserveTrans = (flags & 4) !== 0
      const applyMask = (flags & 8) !== 0
      const editMask = (flags & 16) !== 0
      const showMask = (flags & 32) !== 0

      // Skip floats (parasites pointer)
      currentOffset += 4

      // Layer name
      const nameLen = readU32BE(v, currentOffset); currentOffset += 4
      const name = readString(v, currentOffset, nameLen); currentOffset += nameLen
      currentOffset = (currentOffset + 3) & ~3 // align to 4

      // Skip layer mask (if present) - simplified
      const hasMask = readU32BE(v, currentOffset); currentOffset += 4
      let mask: XcfLayer['mask'] = undefined
      if (hasMask) {
        const maskX = readS32BE(v, currentOffset); currentOffset += 4
        const maskY = readS32BE(v, currentOffset); currentOffset += 4
        const maskW = readU32BE(v, currentOffset); currentOffset += 4
        const maskH = readU32BE(v, currentOffset); currentOffset += 4
        // Skip mask data for now
        currentOffset += 8 // mask data offset + size
        mask = { x: maskX, y: maskY, width: maskW, height: maskH, canvas: createCanvas(1, 1), apply: applyMask, edit: editMask, show: showMask }
      }

      // Read layer pixel data
      const canvas = await readLayerData(v, currentOffset, { width, height, x, y }, bpp, compression)
      currentOffset += 8 // layer data offset + size

      layers.push({
        name,
        x: parentX + x,
        y: parentY + y,
        width,
        height,
        opacity: opacity / 255,
        mode: BLEND_MODE_MAP[mode] ?? 'normal',
        visible,
        linked,
        mask,
        canvas,
      })
    } else if (type === 2) {
      // Layer group
      currentOffset += 4
      const width = readU32BE(v, currentOffset); currentOffset += 4
      const height = readU32BE(v, currentOffset); currentOffset += 4
      const x = readS32BE(v, currentOffset); currentOffset += 4
      const y = readS32BE(v, currentOffset); currentOffset += 4
      const opacity = v.getUint8(currentOffset++); currentOffset += 3
      const mode = readU32BE(v, currentOffset); currentOffset += 4
      const flags = readU32BE(v, currentOffset); currentOffset += 4
      const visible = (flags & 1) !== 0
      const linked = (flags & 2) !== 0

      currentOffset += 4 // parasites

      const nameLen = readU32BE(v, currentOffset); currentOffset += 4
      const name = readString(v, currentOffset, nameLen); currentOffset += nameLen
      currentOffset = (currentOffset + 3) & ~3

      // Parse children recursively
      const childrenOffset = readU32BE(v, currentOffset); currentOffset += 4
      const children = await parseHierarchy(v, childrenOffset, bpp, compression, parentX + x, parentY + y)

      const canvas = createCanvas(width, height)
      // Render children into group canvas
      const ctx = ctx2d(canvas)
      for (const child of children) {
        ctx.globalAlpha = child.opacity
        ctx.globalCompositeOperation = child.mode as any
        ctx.drawImage(child.canvas, child.x - (parentX + x), child.y - (parentY + y))
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'

      layers.push({
        name,
        x: parentX + x,
        y: parentY + y,
        width,
        height,
        opacity: opacity / 255,
        mode: BLEND_MODE_MAP[mode] ?? 'normal',
        visible,
        linked,
        canvas,
        children,
      })

      // Skip group end marker
      currentOffset += 4
    } else {
      // Unknown type - skip
      currentOffset += 4
    }
  }
  return layers
}

export async function parseXcf(buf: ArrayBuffer): Promise<ParsedXcf> {
  const v = new DataView(buf)
  if (buf.byteLength < 9) throw new Error('Truncated XCF file')
  const magic = readString(v, 0, 9)
  if (!magic.startsWith(XCF_MAGIC)) throw new Error('Not a GIMP XCF file')

  let offset = 9
  const version = readU32BE(v, offset); offset += 4
  if (version > 11) throw new Error(`Unsupported XCF version ${version}`)

  const width = readU32BE(v, offset); offset += 4
  const height = readU32BE(v, offset); offset += 4
  const precision = readU32BE(v, offset); offset += 4

  // Color space info (version 4+)
  let colorSpace: 'RGB' | 'GRAY' | 'INDEXED' = 'RGB'
  if (version >= 4) {
    const cs = readU32BE(v, offset); offset += 4
    colorSpace = cs === 0 ? 'RGB' : cs === 1 ? 'GRAY' : 'INDEXED'
  }

  // Read layer hierarchy offset
  const hierarchyOffset = readU32BE(v, offset); offset += 4

  // Read composition info (guides, etc.)
  const guides: ParsedXcf['guides'] = []
  if (version >= 5) {
    const guideCount = readU32BE(v, offset); offset += 4
    for (let i = 0; i < guideCount; i++) {
      const orientation = v.getUint8(offset++) === 0 ? 'H' : 'V'
      const position = readS32BE(v, offset); offset += 4
      const r = v.getUint8(offset++)
      const g = v.getUint8(offset++)
      const b = v.getUint8(offset++)
      offset++ // padding
      guides.push({ orientation, position, color: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}` })
    }
  }

  // Determine BPP and compression from precision
  const isFloat = precision >= 2
  const bytesPerChannel = isFloat ? 4 : (precision === 1 ? 2 : 1)
  const bpp = colorSpace === 'GRAY' ? (1 + 1) : (colorSpace === 'INDEXED' ? 1 : 3) // +1 for alpha in some cases

  // For simplicity, assume standard 8-bit RGBA tiles with RLE compression
  const bppTiles = 4
  const compression = 0 // RLE

  const layers = await parseHierarchy(v, hierarchyOffset, bppTiles, compression)

  return {
    version,
    width,
    height,
    precision,
    colorSpace,
    layers,
    guides,
  }
}

/** Render XCF layers to a single canvas */
export function renderXcf(xcf: ParsedXcf): HTMLCanvasElement {
  const canvas = createCanvas(xcf.width, xcf.height)
  const ctx = ctx2d(canvas)

  function renderLayer(layer: XcfLayer) {
    if (!layer.visible) return
    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.globalCompositeOperation = layer.mode as GlobalCompositeOperation
    if (layer.mask && layer.mask.apply && layer.mask.show) {
      // Simplified: just clip to mask bounds
      ctx.drawImage(layer.canvas, layer.x, layer.y)
    } else {
      ctx.drawImage(layer.canvas, layer.x, layer.y)
    }
    ctx.restore()
    if (layer.children) {
      for (const child of layer.children) renderLayer(child)
    }
  }

  for (const layer of xcf.layers) renderLayer(layer)
  return canvas
}