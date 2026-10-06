import type { EditableImageMetadata, ImageMetadata } from '../types'

const enc = new TextEncoder()

function utf8(value: string): Uint8Array {
  return enc.encode(value)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function blobOf(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes as unknown as BlobPart], { type })
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function editable(metadata?: ImageMetadata): EditableImageMetadata {
  return metadata?.editable ?? {}
}

export function hasWritableMetadata(metadata?: ImageMetadata): boolean {
  const e = editable(metadata)
  return !!(
    clean(e.title) || clean(e.description) || clean(e.author) || clean(e.authorTitle) ||
    (e.keywords?.some(v => clean(v))) || clean(e.headline) || clean(e.credit) ||
    clean(e.source) || clean(e.instructions) || clean(e.copyright) ||
    (e.copyrightStatus && e.copyrightStatus !== 'unknown') || clean(e.copyrightUrl) ||
    clean(e.city) || clean(e.state) || clean(e.country) || clean(e.countryCode) ||
    clean(e.jobIdentifier) || Number.isFinite(e.rating)
  )
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function alt(name: string, value: string): string {
  return '<' + name + '><rdf:Alt><rdf:li xml:lang="x-default">' + xml(value) + '</rdf:li></rdf:Alt></' + name + '>'
}

function seq(name: string, values: string[]): string {
  return '<' + name + '><rdf:Seq>' + values.map(v => '<rdf:li>' + xml(v) + '</rdf:li>').join('') + '</rdf:Seq></' + name + '>'
}

function bag(name: string, values: string[]): string {
  return '<' + name + '><rdf:Bag>' + values.map(v => '<rdf:li>' + xml(v) + '</rdf:li>').join('') + '</rdf:Bag></' + name + '>'
}

/** Build a clean XMP packet from the editable File Info model.
 * Source camera/GPS EXIF is intentionally not copied into new exports. */
export function buildWritableXmp(metadata?: ImageMetadata): string | undefined {
  if (!hasWritableMetadata(metadata)) return undefined
  const e = editable(metadata)
  const body: string[] = []
  const attrs: string[] = []

  if (clean(e.title)) body.push(alt('dc:title', clean(e.title)))
  if (clean(e.description)) body.push(alt('dc:description', clean(e.description)))
  if (clean(e.author)) body.push(seq('dc:creator', [clean(e.author)]))
  const keywords = Array.from(new Set((e.keywords ?? []).map(clean).filter(Boolean)))
  if (keywords.length) body.push(bag('dc:subject', keywords))
  if (clean(e.copyright)) body.push(alt('dc:rights', clean(e.copyright)))

  if (clean(e.authorTitle)) attrs.push('photoshop:AuthorsPosition="' + xml(clean(e.authorTitle)) + '"')
  if (clean(e.headline)) attrs.push('photoshop:Headline="' + xml(clean(e.headline)) + '"')
  if (clean(e.credit)) attrs.push('photoshop:Credit="' + xml(clean(e.credit)) + '"')
  if (clean(e.source)) attrs.push('photoshop:Source="' + xml(clean(e.source)) + '"')
  if (clean(e.instructions)) attrs.push('photoshop:Instructions="' + xml(clean(e.instructions)) + '"')
  if (clean(e.city)) attrs.push('photoshop:City="' + xml(clean(e.city)) + '"')
  if (clean(e.state)) attrs.push('photoshop:State="' + xml(clean(e.state)) + '"')
  if (clean(e.country)) attrs.push('photoshop:Country="' + xml(clean(e.country)) + '"')
  if (clean(e.jobIdentifier)) attrs.push('photoshop:TransmissionReference="' + xml(clean(e.jobIdentifier)) + '"')
  if (clean(e.countryCode)) attrs.push('Iptc4xmpCore:CountryCode="' + xml(clean(e.countryCode).toUpperCase()) + '"')
  if (clean(e.copyrightUrl)) attrs.push('xmpRights:WebStatement="' + xml(clean(e.copyrightUrl)) + '"')
  if (e.copyrightStatus === 'copyrighted') attrs.push('xmpRights:Marked="True"')
  if (e.copyrightStatus === 'public-domain') attrs.push('xmpRights:Marked="False"')
  if (Number.isFinite(e.rating)) attrs.push('xmp:Rating="' + Math.max(0, Math.min(5, Math.round(Number(e.rating)))) + '"')

  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Chay\'s Photo Studio">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about=""',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    ' xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"',
    ' xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"',
    ' xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"',
    attrs.length ? ' ' + attrs.join(' ') : '',
    '>',
    body.join(''),
    '</rdf:Description></rdf:RDF></x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('')
}

function iptcDataset(record: number, dataset: number, value: string | Uint8Array): Uint8Array {
  let data = typeof value === 'string' ? utf8(value) : value
  if (data.length > 0x7fff) data = data.subarray(0, 0x7fff)
  const out = new Uint8Array(5 + data.length)
  out[0] = 0x1c
  out[1] = record & 0xff
  out[2] = dataset & 0xff
  out[3] = (data.length >>> 8) & 0xff
  out[4] = data.length & 0xff
  out.set(data, 5)
  return out
}

/** Photoshop/IPTC-IIM compatibility payload used by JPEG APP13. */
export function buildWritableIptc(metadata?: ImageMetadata): Uint8Array | undefined {
  if (!hasWritableMetadata(metadata)) return undefined
  const e = editable(metadata)
  const parts: Uint8Array[] = [iptcDataset(1, 90, new Uint8Array([0x1b, 0x25, 0x47]))]
  const add = (dataset: number, value?: string) => {
    const v = clean(value)
    if (v) parts.push(iptcDataset(2, dataset, v))
  }
  add(5, e.title)
  for (const keyword of Array.from(new Set((e.keywords ?? []).map(clean).filter(Boolean)))) add(25, keyword)
  add(40, e.instructions)
  add(80, e.author)
  add(85, e.authorTitle)
  add(90, e.city)
  add(95, e.state)
  add(100, clean(e.countryCode).toUpperCase())
  add(101, e.country)
  add(103, e.jobIdentifier)
  add(105, e.headline)
  add(110, e.credit)
  add(115, e.source)
  add(116, e.copyright)
  add(120, e.description)
  return concat(parts)
}

function asciiZ(value: string): Uint8Array {
  const data = utf8(value)
  const out = new Uint8Array(data.length + 1)
  out.set(data)
  return out
}

function shortLe(value: number): Uint8Array {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, value, true)
  return out
}

function rationalLe(value: number): Uint8Array {
  const out = new Uint8Array(8)
  const view = new DataView(out.buffer)
  const denominator = 1000
  view.setUint32(0, Math.max(1, Math.round(value * denominator)), true)
  view.setUint32(4, denominator, true)
  return out
}

interface TiffEntry {
  tag: number
  type: number
  count: number
  data: Uint8Array
}

/** Minimal standards-compliant EXIF payload for exported rasters.
 * It writes print resolution and safe author/description/copyright fields,
 * not source camera/GPS measurements that may no longer describe edited pixels. */
export function buildExportExif(metadata: ImageMetadata | undefined, resolutionPpi: number): Uint8Array {
  const e = editable(metadata)
  const entries: TiffEntry[] = []
  const addAscii = (tag: number, value?: string) => {
    const v = clean(value)
    if (!v) return
    const data = asciiZ(v)
    entries.push({ tag, type: 2, count: data.length, data })
  }
  addAscii(0x010e, e.description)
  addAscii(0x0131, "Chay's Photo Studio")
  addAscii(0x013b, e.author)
  addAscii(0x8298, e.copyright)
  entries.push({ tag: 0x011a, type: 5, count: 1, data: rationalLe(Math.max(1, resolutionPpi || 72)) })
  entries.push({ tag: 0x011b, type: 5, count: 1, data: rationalLe(Math.max(1, resolutionPpi || 72)) })
  entries.push({ tag: 0x0128, type: 3, count: 1, data: shortLe(2) })
  entries.sort((a, b) => a.tag - b.tag)

  const ifdOffset = 8
  const ifdSize = 2 + entries.length * 12 + 4
  let externalOffset = ifdOffset + ifdSize
  const external: { offset: number; data: Uint8Array }[] = []
  for (const entry of entries) {
    if (entry.data.length > 4) {
      external.push({ offset: externalOffset, data: entry.data })
      externalOffset += entry.data.length + (entry.data.length & 1)
    }
  }

  const tiff = new Uint8Array(externalOffset)
  const view = new DataView(tiff.buffer)
  tiff.set([0x49, 0x49], 0)
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, entries.length, true)
  let p = ifdOffset + 2
  let extIndex = 0
  for (const entry of entries) {
    view.setUint16(p, entry.tag, true)
    view.setUint16(p + 2, entry.type, true)
    view.setUint32(p + 4, entry.count, true)
    if (entry.data.length <= 4) tiff.set(entry.data, p + 8)
    else view.setUint32(p + 8, external[extIndex++].offset, true)
    p += 12
  }
  view.setUint32(p, 0, true)
  for (const item of external) tiff.set(item.data, item.offset)
  return concat([utf8('Exif\u0000\u0000'), tiff])
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  if (payload.length > 65533) throw new Error('Metadata block is too large for a JPEG segment')
  const out = new Uint8Array(payload.length + 4)
  out[0] = 0xff
  out[1] = marker
  const length = payload.length + 2
  out[2] = (length >>> 8) & 0xff
  out[3] = length & 0xff
  out.set(payload, 4)
  return out
}

function photoshopIptcResource(iptc: Uint8Array): Uint8Array {
  const header = utf8('Photoshop 3.0\u0000')
  const resource = new Uint8Array(4 + 2 + 2 + 4 + iptc.length + (iptc.length & 1))
  resource.set(utf8('8BIM'), 0)
  resource[4] = 0x04
  resource[5] = 0x04
  // Empty Pascal name: length byte + pad byte are already zero.
  const sizeOffset = 8
  const view = new DataView(resource.buffer)
  view.setUint32(sizeOffset, iptc.length, false)
  resource.set(iptc, 12)
  return concat([header, resource])
}

async function embedJpeg(blob: Blob, metadata: ImageMetadata | undefined, resolutionPpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return blob

  const segments: Uint8Array[] = [jpegSegment(0xe1, buildExportExif(metadata, resolutionPpi))]
  const xmp = buildWritableXmp(metadata)
  if (xmp) {
    const header = utf8('http://ns.adobe.com/xap/1.0/\u0000')
    segments.push(jpegSegment(0xe1, concat([header, utf8(xmp)])))
  }
  const iptc = buildWritableIptc(metadata)
  if (iptc?.length) segments.push(jpegSegment(0xed, photoshopIptcResource(iptc)))

  let insert = 2
  if (bytes.length >= 6 && bytes[2] === 0xff && bytes[3] === 0xe0) {
    const len = (bytes[4] << 8) | bytes[5]
    if (len >= 2 && 2 + 2 + len <= bytes.length) insert = 2 + 2 + len
  }
  return blobOf(concat([bytes.subarray(0, insert), ...segments, bytes.subarray(insert)]), 'image/jpeg')
}

let crcTable: Uint32Array | null = null
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = utf8(type)
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length, false)
  out.set(typeBytes, 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(concat([typeBytes, data])), false)
  return out
}

async function embedPng(
  blob: Blob,
  metadata: ImageMetadata | undefined,
  resolutionPpi: number,
): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return blob

  const ppm = Math.max(1, Math.round(Math.max(1, resolutionPpi || 72) * 39.37007874015748))
  const phys = new Uint8Array(9)
  const pv = new DataView(phys.buffer)
  pv.setUint32(0, ppm, false)
  pv.setUint32(4, ppm, false)
  phys[8] = 1
  const additions: Uint8Array[] = [pngChunk('pHYs', phys)]

  const xmp = buildWritableXmp(metadata)
  if (xmp) {
    const prefix = utf8('XML:com.adobe.xmp\u0000')
    const suffix = new Uint8Array([0, 0, 0, 0])
    additions.push(pngChunk('iTXt', concat([prefix, suffix, utf8(xmp)])))
  }

  const parts: Uint8Array[] = [bytes.subarray(0, 8)]
  let p = 8
  let inserted = false
  while (p + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + p, bytes.length - p)
    const len = view.getUint32(0, false)
    const end = p + 12 + len
    if (end > bytes.length) break
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
    if (!inserted && type === 'IDAT') {
      parts.push(...additions)
      inserted = true
    }
    // Fresh browser output normally has neither; skip duplicates if an encoder added them.
    if (type !== 'pHYs' && !(type === 'iTXt' && new TextDecoder().decode(bytes.subarray(p + 8, Math.min(end - 4, p + 64))).startsWith('XML:com.adobe.xmp'))) {
      parts.push(bytes.subarray(p, end))
    }
    p = end
    if (type === 'IEND') break
  }
  if (!inserted) parts.splice(1, 0, ...additions)
  return blobOf(concat(parts), 'image/png')
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + (data.length & 1))
  out.set(utf8(type), 0)
  new DataView(out.buffer).setUint32(4, data.length, true)
  out.set(data, 8)
  return out
}

function vp8xChunk(width: number, height: number, flags: number): Uint8Array {
  const data = new Uint8Array(10)
  data[0] = flags & 0xff
  const w = Math.max(1, Math.min(0x1000000, Math.round(width))) - 1
  const h = Math.max(1, Math.min(0x1000000, Math.round(height))) - 1
  data[4] = w & 0xff
  data[5] = (w >>> 8) & 0xff
  data[6] = (w >>> 16) & 0xff
  data[7] = h & 0xff
  data[8] = (h >>> 8) & 0xff
  data[9] = (h >>> 16) & 0xff
  return riffChunk('VP8X', data)
}

async function embedWebp(
  blob: Blob,
  metadata: ImageMetadata | undefined,
  resolutionPpi: number,
  width: number,
  height: number,
  hasAlpha: boolean,
): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'RIFF' || new TextDecoder().decode(bytes.subarray(8, 12)) !== 'WEBP') return blob

  const xmp = buildWritableXmp(metadata)
  const exif = buildExportExif(metadata, resolutionPpi)
  const chunks: Uint8Array[] = []
  let existingFlags = 0
  let p = 12
  while (p + 8 <= bytes.length) {
    const type = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3])
    const size = new DataView(bytes.buffer, bytes.byteOffset + p + 4, 4).getUint32(0, true)
    const end = p + 8 + size + (size & 1)
    if (end > bytes.length) break
    if (type === 'VP8X' && size >= 10) existingFlags = bytes[p + 8]
    else if (type !== 'EXIF' && type !== 'XMP ') chunks.push(bytes.subarray(p, end))
    p = end
  }

  const flags = existingFlags | (hasAlpha ? 0x10 : 0) | 0x08 | (xmp ? 0x04 : 0)
  const body: Uint8Array[] = [vp8xChunk(width, height, flags), ...chunks, riffChunk('EXIF', exif)]
  if (xmp) body.push(riffChunk('XMP ', utf8(xmp)))
  const bodyBytes = concat(body)
  const header = new Uint8Array(12)
  header.set(utf8('RIFF'), 0)
  new DataView(header.buffer).setUint32(4, 4 + bodyBytes.length, true)
  header.set(utf8('WEBP'), 8)
  return blobOf(concat([header, bodyBytes]), 'image/webp')
}

export interface EmbedRasterMetadataOptions {
  resolutionPpi: number
  width: number
  height: number
  hasAlpha?: boolean
}

/** Add editor-authored File Info + print resolution to browser-encoded images.
 * Camera/GPS EXIF stays view-only because edits can invalidate capture metadata. */
export async function embedRasterMetadata(
  blob: Blob,
  format: 'png' | 'jpeg' | 'webp',
  metadata: ImageMetadata | undefined,
  opts: EmbedRasterMetadataOptions,
): Promise<Blob> {
  if (format === 'jpeg') return embedJpeg(blob, metadata, opts.resolutionPpi)
  if (format === 'png') return embedPng(blob, metadata, opts.resolutionPpi)
  return embedWebp(blob, metadata, opts.resolutionPpi, opts.width, opts.height, !!opts.hasAlpha)
}
