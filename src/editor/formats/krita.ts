import { readZipEntries, textEntry, findEntry } from './archive'
import type { ParsedDocument, ParsedDocumentLayer } from './document-parser-types'
import { bytesToCanvas, finite, safeName } from './parser-utils'
import { createCanvas, ctx2d } from '../utils/canvas'

const TILE_W = 64
const TILE_H = 64

function lzfDecode(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected)
  let ip = 0, op = 0
  while (ip < src.length && op < expected) {
    const ctrl = src[ip++]
    if (ctrl < 32) {
      const len = ctrl + 1
      if (ip + len > src.length || op + len > expected) throw new Error('Corrupt Krita LZF literal run')
      out.set(src.subarray(ip, ip + len), op)
      ip += len; op += len
    } else {
      let len = ctrl >> 5
      let ref = op - ((ctrl & 0x1f) << 8) - 1
      if (len === 7) {
        if (ip >= src.length) throw new Error('Corrupt Krita LZF length')
        len += src[ip++]
      }
      if (ip >= src.length) throw new Error('Corrupt Krita LZF back-reference')
      ref -= src[ip++]
      len += 2
      if (ref < 0 || op + len > expected) throw new Error('Corrupt Krita LZF back-reference')
      for (let i = 0; i < len; i++) out[op++] = out[ref++]
    }
  }
  if (op !== expected) throw new Error('Krita LZF tile decoded to an unexpected size')
  return out
}

function asciiLine(bytes: Uint8Array, at: number): { text: string; next: number } {
  const end = bytes.indexOf(0x0a, at)
  if (end < 0) throw new Error('Truncated Krita tile header')
  let text = ''
  for (let i = at; i < end; i++) text += String.fromCharCode(bytes[i])
  return { text: text.replace(/\r$/, ''), next: end + 1 }
}

function fillDefault(out: Uint8ClampedArray, pixel: Uint8Array | null) {
  if (!pixel || pixel.length < 4 || (pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 0)) return
  for (let i = 0; i < out.length; i += 4) {
    out[i] = pixel[2]; out[i + 1] = pixel[1]; out[i + 2] = pixel[0]; out[i + 3] = pixel[3]
  }
}

function decodePaintDevice(bytes: Uint8Array, width: number, height: number, defaultPixel: Uint8Array | null): HTMLCanvasElement {
  let p = 0
  const headers = [
    ['VERSION', '2'],
    ['TILEWIDTH', String(TILE_W)],
    ['TILEHEIGHT', String(TILE_H)],
  ]
  for (const [key, expected] of headers) {
    const line = asciiLine(bytes, p); p = line.next
    const parts = line.text.trim().split(/\s+/)
    if (parts[0] !== key || parts[1] !== expected) throw new Error(`Unsupported Krita tile header: ${line.text}`)
  }
  const pixelLine = asciiLine(bytes, p); p = pixelLine.next
  const pixelMatch = /^PIXELSIZE\s+(\d+)$/.exec(pixelLine.text.trim())
  const pixelSize = Number(pixelMatch?.[1] ?? 0)
  if (pixelSize !== 4) throw new Error(`Krita paint layer uses unsupported pixel size ${pixelSize}`)
  const dataLine = asciiLine(bytes, p); p = dataLine.next
  const countMatch = /^DATA\s+(\d+)$/.exec(dataLine.text.trim())
  const count = Number(countMatch?.[1] ?? -1)
  if (!Number.isSafeInteger(count) || count < 0 || count > 1000000) throw new Error('Invalid Krita tile count')

  const rgba = new Uint8ClampedArray(width * height * 4)
  fillDefault(rgba, defaultPixel)
  const rawLen = TILE_W * TILE_H * 4
  for (let ti = 0; ti < count; ti++) {
    const line = asciiLine(bytes, p); p = line.next
    const parts = line.text.split(',')
    if (parts.length !== 4 || parts[2] !== 'LZF') throw new Error('Invalid Krita tile record')
    const tx = Number(parts[0]), ty = Number(parts[1]), size = Number(parts[3])
    if (!Number.isSafeInteger(tx) || !Number.isSafeInteger(ty) || !Number.isSafeInteger(size) || size < 1 || p + size > bytes.length) {
      throw new Error('Invalid Krita tile bounds')
    }
    const payload = bytes.subarray(p, p + size); p += size
    let tile: Uint8Array
    if (payload[0] === 0) {
      if (payload.length - 1 < rawLen) throw new Error('Truncated raw Krita tile')
      tile = payload.subarray(1, 1 + rawLen)
    } else if (payload[0] === 1) {
      tile = lzfDecode(payload.subarray(1), rawLen)
    } else {
      // Some old writers omit the leading compression byte for raw data.
      if (payload.length === rawLen) tile = payload
      else throw new Error('Unknown Krita tile compression flag')
    }

    const x0 = tx * TILE_W, y0 = ty * TILE_H
    for (let y = 0; y < TILE_H; y++) {
      const dy = y0 + y
      if (dy < 0 || dy >= height) continue
      for (let x = 0; x < TILE_W; x++) {
        const dx = x0 + x
        if (dx < 0 || dx >= width) continue
        const si = (y * TILE_W + x) * 4
        const di = (dy * width + dx) * 4
        // Krita RGBA/8bit native paint-device storage is BGRA.
        rgba[di] = tile[si + 2]
        rgba[di + 1] = tile[si + 1]
        rgba[di + 2] = tile[si]
        rgba[di + 3] = tile[si + 3]
      }
    }
  }
  const canvas = createCanvas(width, height)
  ctx2d(canvas).putImageData(new ImageData(rgba, width, height), 0, 0)
  return canvas
}

function blendMode(value: string | null): string {
  const v = String(value ?? 'normal').toLowerCase()
  const map: Record<string, string> = {
    normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
    darken: 'darken', lighten: 'lighten', dodge: 'color-dodge', burn: 'color-burn',
    'color_dodge': 'color-dodge', 'color_burn': 'color-burn',
    hard_light: 'hard-light', soft_light: 'soft-light', difference: 'difference',
    exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color',
    luminosity: 'luminosity', add: 'linear-dodge', addition: 'linear-dodge',
  }
  return map[v] ?? 'normal'
}

function childElements(el: Element): Element[] {
  return Array.from(el.children)
}

function findLayerPayload(entries: Map<string, any>, imageName: string, filename: string): any | null {
  const exact = [
    `${imageName}/layers/${filename}`,
    `layers/${filename}`,
    filename,
  ]
  for (const path of exact) if (entries.has(path)) return entries.get(path)
  return findEntry(entries, name => name.endsWith(`/layers/${filename}`))
}

async function parseLayerTree(
  parent: Element,
  entries: Map<string, any>,
  imageName: string,
  width: number,
  height: number,
  out: ParsedDocumentLayer[],
  warnings: string[],
  prefix = '',
): Promise<void> {
  for (const el of childElements(parent)) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'layers') {
      await parseLayerTree(el, entries, imageName, width, height, out, warnings, prefix)
      continue
    }
    if (tag !== 'layer') continue
    const type = String(el.getAttribute('nodetype') ?? 'paintlayer').toLowerCase()
    const name = safeName(el.getAttribute('name'), type === 'grouplayer' ? 'Group' : 'Layer')
    const fullName = prefix ? `${prefix} / ${name}` : name
    if (type === 'grouplayer') {
      await parseLayerTree(el, entries, imageName, width, height, out, warnings, fullName)
      continue
    }
    if (type !== 'paintlayer') {
      warnings.push(`Krita layer “${fullName}” uses unsupported node type “${type}”`)
      continue
    }
    const filename = String(el.getAttribute('filename') ?? '')
    if (!filename) { warnings.push(`Krita paint layer “${fullName}” has no filename`); continue }
    const payload = findLayerPayload(entries, imageName, filename)
    if (!payload) { warnings.push(`Krita paint layer “${fullName}” is missing native pixel data`); continue }
    const def = entries.get(`${imageName}/layers/${filename}.defaultpixel`)
      ?? findEntry(entries, n => n.endsWith(`/layers/${filename}.defaultpixel`))
    try {
      const canvas = decodePaintDevice(payload.data, width, height, def?.data ?? null)
      out.push({
        kind: 'raster',
        name: fullName,
        visible: el.getAttribute('visible') !== '0',
        opacity: Math.max(0, Math.min(100, finite(el.getAttribute('opacity'), 255) * 100 / 255)),
        blendMode: blendMode(el.getAttribute('compositeop')),
        left: finite(el.getAttribute('x'), 0),
        top: finite(el.getAttribute('y'), 0),
        canvas,
        metadata: { sourceFormat: 'kra', nodeType: type, filename },
      })
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      warnings.push(`Krita layer “${fullName}” could not be decoded: ${why}`)
    }
  }
}

export async function parseKrita(bytes: Uint8Array, fileName = 'Krita document'): Promise<ParsedDocument> {
  const entries = await readZipEntries(bytes)
  const mime = textEntry(entries, 'mimetype')?.trim()
  if (mime && mime !== 'application/x-krita') throw new Error('Not a Krita .kra archive')
  const xml = textEntry(entries, 'maindoc.xml')
  if (!xml) throw new Error('Krita maindoc.xml is missing')
  const dom = new DOMParser().parseFromString(xml, 'application/xml')
  if (dom.querySelector('parsererror')) throw new Error('Krita maindoc.xml is malformed')
  const image = dom.querySelector('IMAGE, image')
  if (!image) throw new Error('Krita IMAGE metadata is missing')
  const width = Math.max(1, Math.round(finite(image.getAttribute('width'), 1)))
  const height = Math.max(1, Math.round(finite(image.getAttribute('height'), 1)))
  if (width * height > 268435456) throw new Error('Krita document dimensions are too large')
  const imageName = String(image.getAttribute('name') ?? '').trim()
  const layersRoot = Array.from(image.children).find(el => el.tagName.toLowerCase() === 'layers')
  if (!layersRoot) throw new Error('Krita document contains no layer tree')

  const layers: ParsedDocumentLayer[] = []
  const warnings: string[] = []
  await parseLayerTree(layersRoot, entries, imageName, width, height, layers, warnings)

  let composite: HTMLCanvasElement | null = null
  const merged = entries.get('mergedimage.png')
  if (merged) {
    try { composite = await bytesToCanvas(merged.data, 'image/png') } catch { /* semantic layers still usable */ }
  }
  if (!layers.length && composite) {
    layers.push({ kind: 'raster', name: fileName.replace(/\.[^.]+$/, ''), canvas: composite, left: 0, top: 0 })
    warnings.push('Krita source layers were not decodable; imported mergedimage.png')
  }
  if (!layers.length) throw new Error('Krita parser found no decodable paint layers')
  return {
    width, height,
    name: fileName,
    sourceBitDepth: 8,
    layers,
    composite,
    warnings,
  }
}
