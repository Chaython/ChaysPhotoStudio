// OpenRaster (.ora) import/export for GIMP, Krita and MyPaint interchange.
// Baseline ORA: stored "mimetype" first, stack.xml, per-layer PNGs,
// mergedimage.png and Thumbnails/thumbnail.png.
// https://www.openraster.org/baseline/file-layout-spec.html
import { readZipEntries, textEntry } from './archive'
import { bytesToCanvas } from './parser-utils'
import { canvasToBlob, createCanvas, ctx2d } from '../utils/canvas'
import type { ParsedDocument, ParsedDocumentLayer } from './document-parser-types'

const MIME = 'image/openraster'
const MAX_PIXELS = 268435456
const MAX_LAYERS = 10000

const FROM_SVG: Record<string, string> = {
  'svg:src-over': 'normal', 'svg:multiply': 'multiply', 'svg:screen': 'screen',
  'svg:overlay': 'overlay', 'svg:darken': 'darken', 'svg:lighten': 'lighten',
  'svg:color-dodge': 'color-dodge', 'svg:color-burn': 'color-burn',
  'svg:hard-light': 'hard-light', 'svg:soft-light': 'soft-light',
  'svg:difference': 'difference', 'svg:color': 'color',
  'svg:luminosity': 'luminosity', 'svg:hue': 'hue',
  'svg:saturation': 'saturation',
}
const TO_SVG = Object.fromEntries(Object.entries(FROM_SVG).map(([key, value]) => [value, key]))
TO_SVG['linear-dodge'] = 'svg:plus'
FROM_SVG['svg:plus'] = 'linear-dodge'
TO_SVG.exclusion = 'svg:src-over' // exclusion is not in baseline ORA

function normalizedNumber(value: string | null, fallback: number): number {
  if (value === null || value.trim() === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
function dimension(value: string | null, label: string): number {
  const n = Number(value)
  if (value === null || !Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid OpenRaster ${label}`)
  return n
}
function safePath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')
    || path.split('/').some(segment => !segment || segment === '.' || segment === '..'))
    throw new Error('Unsafe OpenRaster layer path')
  return path
}
function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
function elementChildren(node: Element): Element[] { return Array.from(node.children) }
function opacity(node: Element): number {
  return Math.max(0, Math.min(1, normalizedNumber(node.getAttribute('opacity'), 1)))
}
function visible(node: Element): boolean { return node.getAttribute('visibility') !== 'hidden' }

export async function parseOpenRaster(bytes: Uint8Array, fileName = 'OpenRaster document'): Promise<ParsedDocument> {
  const entries = await readZipEntries(bytes)
  const mime = textEntry(entries, 'mimetype')
  if (mime !== MIME) throw new Error('Not an OpenRaster archive (invalid mimetype)')
  const xml = textEntry(entries, 'stack.xml')
  if (!xml) throw new Error('OpenRaster stack.xml is missing')
  const dom = new DOMParser().parseFromString(xml, 'application/xml')
  if (dom.getElementsByTagName('parsererror').length || dom.documentElement.localName !== 'image')
    throw new Error('Malformed OpenRaster stack.xml')
  const root = dom.documentElement
  const width = dimension(root.getAttribute('w'), 'width')
  const height = dimension(root.getAttribute('h'), 'height')
  if (width * height > MAX_PIXELS) throw new Error('OpenRaster image exceeds the pixel limit')
  const stack = elementChildren(root).find(el => el.localName === 'stack')
  if (!stack) throw new Error('OpenRaster stack.xml has no root stack')
  const layers: ParsedDocumentLayer[] = []
  const warnings: string[] = []
  // ORA stacks are ordered top-first; editor layers are stored bottom-first.
  // We descend in ORA order and reverse once, retaining all stack offsets.
  async function walk(parent: Element, prefix: string, inheritedVisible: boolean, inheritedOpacity: number, depth: number) {
    if (depth > 32) throw new Error('OpenRaster nesting is too deep')
    for (const el of elementChildren(parent)) {
      const kind = el.localName
      if (kind === 'stack') {
        const name = el.getAttribute('name')?.trim() || 'Group'
        const composite = el.getAttribute('composite-op') || 'svg:src-over'
        const groupOpacity = opacity(el)
        if (composite !== 'svg:src-over' || groupOpacity < 1 || (el.hasAttribute('isolation') && el.getAttribute('isolation') !== 'auto'))
          warnings.push(`Group “${name}” was flattened into separate layers; isolated group compositing may differ`)
        await walk(el, prefix ? `${prefix} / ${name}` : name,
          inheritedVisible && visible(el), inheritedOpacity * groupOpacity, depth + 1)
        continue
      }
      if (kind !== 'layer') {
        warnings.push(`Unsupported OpenRaster element “${kind}” was skipped`)
        continue
      }
      if (layers.length >= MAX_LAYERS) throw new Error('OpenRaster layer limit exceeded')
      const label = el.getAttribute('name') || 'Layer'
      const name = prefix ? `${prefix} / ${label}` : label
      const rawMode = el.getAttribute('composite-op') || 'svg:src-over'
      const blendMode = FROM_SVG[rawMode] || 'normal'
      if (!(rawMode in FROM_SVG)) warnings.push(`Layer “${name}”: unsupported blend mode “${rawMode}”; using Normal`)
      try {
        const src = safePath(el.getAttribute('src') || '')
        if (!/\.png$/i.test(src)) throw new Error('Only PNG layer payloads are supported')
        const entry = entries.get(src)
        if (!entry) throw new Error(`missing file ${src}`)
        const canvas = await bytesToCanvas(entry.data, 'image/png')
        layers.push({
          kind: 'raster', name, canvas,
          left: Math.trunc(normalizedNumber(el.getAttribute('x'), 0)),
          top: Math.trunc(normalizedNumber(el.getAttribute('y'), 0)),
          visible: inheritedVisible && visible(el),
          opacity: inheritedOpacity * opacity(el) * 100,
          blendMode,
          metadata: { sourceFormat: 'ora', src },
        })
      } catch (error) {
        warnings.push(`Layer “${name}” could not be imported: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  await walk(stack, '', true, 1, 0)
  layers.reverse()
  let composite: HTMLCanvasElement | null = null
  const merged = entries.get('mergedimage.png')
  if (merged) {
    try { composite = await bytesToCanvas(merged.data, 'image/png') }
    catch { warnings.push('OpenRaster mergedimage.png could not be decoded') }
  }
  if (!layers.length && composite) {
    layers.push({ kind: 'raster', name: 'Merged image', canvas: composite, left: 0, top: 0 })
    warnings.push('No editable layers could be imported; opened the merged preview')
  }
  if (!layers.length) throw new Error('OpenRaster archive has no decodable layers')
  const resolution = normalizedNumber(root.getAttribute('xres'), 72)
  return {
    width, height, name: fileName, layers, composite, warnings, sourceBitDepth: 8,
    resolutionPpi: resolution >= 1 && resolution <= 12000 ? resolution : undefined,
  }
}

// Small stored-entry ZIP encoder. PNG is already compressed; storing it avoids
// making large edits wait on an unnecessary second compression pass.
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const b of data) {
    crc ^= b
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
interface ArchiveEntry { name: string; data: Uint8Array }
function zipStored(entries: ArchiveEntry[]): Blob {
  if (entries.length > 0xffff) throw new Error('Too many OpenRaster ZIP entries')
  const utf8 = new TextEncoder()
  const records = entries.map(e => ({
    name: utf8.encode(e.name), bytes: e.data, crc: crc32(e.data),
  }))
  let localLength = 0, centralLength = 0
  for (const r of records) {
    if (r.name.length > 0xffff || r.bytes.length > 0xffffffff) throw new Error('OpenRaster ZIP entry is too large')
    localLength += 30 + r.name.length + r.bytes.length
    centralLength += 46 + r.name.length
  }
  const total = localLength + centralLength + 22
  if (total > 0xffffffff || total > 1024 * 1024 * 1024) throw new Error('OpenRaster archive exceeds the 1 GiB export limit')
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let offset = 0, centralOffset = localLength
  for (const r of records) {
    const localOffset = offset
    view.setUint32(offset, 0x04034b50, true)
    view.setUint16(offset + 4, 20, true)
    view.setUint16(offset + 6, 0x0800, true) // UTF-8 filenames
    view.setUint16(offset + 8, 0, true) // stored
    view.setUint32(offset + 14, r.crc, true)
    view.setUint32(offset + 18, r.bytes.length, true)
    view.setUint32(offset + 22, r.bytes.length, true)
    view.setUint16(offset + 26, r.name.length, true)
    out.set(r.name, offset + 30)
    offset += 30 + r.name.length
    out.set(r.bytes, offset)
    offset += r.bytes.length

    view.setUint32(centralOffset, 0x02014b50, true)
    view.setUint16(centralOffset + 4, 20, true)
    view.setUint16(centralOffset + 6, 20, true)
    view.setUint16(centralOffset + 8, 0x0800, true)
    view.setUint32(centralOffset + 16, r.crc, true)
    view.setUint32(centralOffset + 20, r.bytes.length, true)
    view.setUint32(centralOffset + 24, r.bytes.length, true)
    view.setUint16(centralOffset + 28, r.name.length, true)
    view.setUint32(centralOffset + 42, localOffset, true)
    out.set(r.name, centralOffset + 46)
    centralOffset += 46 + r.name.length
  }
  view.setUint32(centralOffset, 0x06054b50, true)
  view.setUint16(centralOffset + 8, records.length, true)
  view.setUint16(centralOffset + 10, records.length, true)
  view.setUint32(centralOffset + 12, centralLength, true)
  view.setUint32(centralOffset + 16, localLength, true)
  return new Blob([out], { type: MIME })
}

export interface OpenRasterLayer {
  name: string
  canvas: HTMLCanvasElement
  left: number
  top: number
  opacity: number // percent (0..100)
  visible: boolean
  blendMode: string
}

export async function buildOpenRaster(
  width: number, height: number, layers: OpenRasterLayer[], merged: HTMLCanvasElement,
  options: { name?: string; resolutionPpi?: number } = {},
): Promise<Blob> {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width * height > MAX_PIXELS || layers.length > MAX_LAYERS)
    throw new Error('Invalid OpenRaster canvas dimensions or layer count')
  const encode = async (canvas: HTMLCanvasElement) =>
    new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer())
  const entries: ArchiveEntry[] = [{ name: 'mimetype', data: new TextEncoder().encode(MIME) }]
  const xmlLayers: string[] = []
  // The first layer in stack.xml is topmost.
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (!layer.canvas.width || !layer.canvas.height) continue
    const src = `data/layer${String(i).padStart(5, '0')}.png`
    entries.push({ name: src, data: await encode(layer.canvas) })
    const mode = TO_SVG[layer.blendMode] || 'svg:src-over'
    xmlLayers.push(`    <layer name="${xmlEscape(layer.name)}" src="${src}" x="${Math.trunc(layer.left)}" y="${Math.trunc(layer.top)}" opacity="${(Math.max(0, Math.min(100, layer.opacity)) / 100).toFixed(6)}" visibility="${layer.visible ? 'visible' : 'hidden'}" composite-op="${mode}" />`)
  }
  entries.push({ name: 'mergedimage.png', data: await encode(merged) })
  const thumbScale = Math.min(1, 256 / width, 256 / height)
  const thumb = createCanvas(Math.max(1, Math.round(width * thumbScale)), Math.max(1, Math.round(height * thumbScale)))
  const tc = ctx2d(thumb)
  tc.imageSmoothingQuality = 'high'
  tc.drawImage(merged, 0, 0, thumb.width, thumb.height)
  entries.push({ name: 'Thumbnails/thumbnail.png', data: await encode(thumb) })
  const ppi = options.resolutionPpi && Number.isFinite(options.resolutionPpi) ? options.resolutionPpi : 72
  const stackXml = `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.3" w="${width}" h="${height}" name="${xmlEscape(options.name || '')}" xres="${ppi}" yres="${ppi}">\n  <stack>\n${xmlLayers.join('\n')}\n  </stack>\n</image>\n`
  entries.splice(1, 0, { name: 'stack.xml', data: new TextEncoder().encode(stackXml) })
  return zipStored(entries)
}
