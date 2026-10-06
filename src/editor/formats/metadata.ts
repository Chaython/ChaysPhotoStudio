import type { EditableImageMetadata, ImageMetadata, ImageMetadataField } from '../types'

const MAX_SCAN_BYTES = 64 * 1024 * 1024
const MAX_XMP_CHARS = 256 * 1024
const MAX_FIELDS = 2500

type AddField = (group: string, tag: string, label: string, value: unknown) => void

const EXIF_TAGS: Record<number, string> = {
  0x010e: 'Image Description',
  0x010f: 'Make',
  0x0110: 'Model',
  0x0112: 'Orientation',
  0x011a: 'X Resolution',
  0x011b: 'Y Resolution',
  0x0128: 'Resolution Unit',
  0x0131: 'Software',
  0x0132: 'Modify Date',
  0x013b: 'Artist',
  0x013e: 'White Point',
  0x013f: 'Primary Chromaticities',
  0x0201: 'Thumbnail Offset',
  0x0202: 'Thumbnail Length',
  0x0211: 'YCbCr Coefficients',
  0x0212: 'YCbCr Sub Sampling',
  0x0213: 'YCbCr Positioning',
  0x0214: 'Reference Black White',
  0x8298: 'Copyright',
  0x829a: 'Exposure Time',
  0x829d: 'F Number',
  0x8769: 'Exif IFD Pointer',
  0x8773: 'ICC Profile',
  0x8822: 'Exposure Program',
  0x8824: 'Spectral Sensitivity',
  0x8825: 'GPS IFD Pointer',
  0x8827: 'ISO',
  0x8828: 'OECF',
  0x8830: 'Sensitivity Type',
  0x8831: 'Standard Output Sensitivity',
  0x8832: 'Recommended Exposure Index',
  0x8833: 'ISO Speed',
  0x9000: 'Exif Version',
  0x9003: 'Date/Time Original',
  0x9004: 'Create Date',
  0x9101: 'Components Configuration',
  0x9102: 'Compressed Bits Per Pixel',
  0x9201: 'Shutter Speed Value',
  0x9202: 'Aperture Value',
  0x9203: 'Brightness Value',
  0x9204: 'Exposure Compensation',
  0x9205: 'Max Aperture Value',
  0x9206: 'Subject Distance',
  0x9207: 'Metering Mode',
  0x9208: 'Light Source',
  0x9209: 'Flash',
  0x920a: 'Focal Length',
  0x9214: 'Subject Area',
  0x927c: 'Maker Note',
  0x9286: 'User Comment',
  0x9290: 'Sub Sec Time',
  0x9291: 'Sub Sec Time Original',
  0x9292: 'Sub Sec Time Digitized',
  0xa000: 'Flashpix Version',
  0xa001: 'Color Space',
  0xa002: 'Exif Image Width',
  0xa003: 'Exif Image Height',
  0xa004: 'Related Sound File',
  0xa005: 'Interoperability IFD Pointer',
  0xa20b: 'Flash Energy',
  0xa20c: 'Spatial Frequency Response',
  0xa20e: 'Focal Plane X Resolution',
  0xa20f: 'Focal Plane Y Resolution',
  0xa210: 'Focal Plane Resolution Unit',
  0xa214: 'Subject Location',
  0xa215: 'Exposure Index',
  0xa217: 'Sensing Method',
  0xa300: 'File Source',
  0xa301: 'Scene Type',
  0xa302: 'CFA Pattern',
  0xa401: 'Custom Rendered',
  0xa402: 'Exposure Mode',
  0xa403: 'White Balance',
  0xa404: 'Digital Zoom Ratio',
  0xa405: 'Focal Length In 35mm Format',
  0xa406: 'Scene Capture Type',
  0xa407: 'Gain Control',
  0xa408: 'Contrast',
  0xa409: 'Saturation',
  0xa40a: 'Sharpness',
  0xa40b: 'Device Setting Description',
  0xa40c: 'Subject Distance Range',
  0xa420: 'Image Unique ID',
  0xa430: 'Camera Owner Name',
  0xa431: 'Body Serial Number',
  0xa432: 'Lens Specification',
  0xa433: 'Lens Make',
  0xa434: 'Lens Model',
  0xa435: 'Lens Serial Number',
  0xa460: 'Composite Image',
  0xa461: 'Source Image Number Of Composite Image',
  0xa462: 'Source Exposure Times Of Composite Image',
  0xa500: 'Gamma',
}

const GPS_TAGS: Record<number, string> = {
  0x0000: 'GPS Version ID',
  0x0001: 'GPS Latitude Ref',
  0x0002: 'GPS Latitude',
  0x0003: 'GPS Longitude Ref',
  0x0004: 'GPS Longitude',
  0x0005: 'GPS Altitude Ref',
  0x0006: 'GPS Altitude',
  0x0007: 'GPS Time Stamp',
  0x0008: 'GPS Satellites',
  0x0009: 'GPS Status',
  0x000a: 'GPS Measure Mode',
  0x000b: 'GPS DOP',
  0x000c: 'GPS Speed Ref',
  0x000d: 'GPS Speed',
  0x000e: 'GPS Track Ref',
  0x000f: 'GPS Track',
  0x0010: 'GPS Image Direction Ref',
  0x0011: 'GPS Image Direction',
  0x0012: 'GPS Map Datum',
  0x0013: 'GPS Destination Latitude Ref',
  0x0014: 'GPS Destination Latitude',
  0x0015: 'GPS Destination Longitude Ref',
  0x0016: 'GPS Destination Longitude',
  0x0017: 'GPS Destination Bearing Ref',
  0x0018: 'GPS Destination Bearing',
  0x0019: 'GPS Destination Distance Ref',
  0x001a: 'GPS Destination Distance',
  0x001b: 'GPS Processing Method',
  0x001c: 'GPS Area Information',
  0x001d: 'GPS Date Stamp',
  0x001e: 'GPS Differential',
  0x001f: 'GPS Horizontal Positioning Error',
}

const IPTC_TAGS: Record<number, string> = {
  0: 'Record Version',
  3: 'Object Type Reference',
  4: 'Object Attribute Reference',
  5: 'Object Name',
  7: 'Edit Status',
  10: 'Urgency',
  12: 'Subject Reference',
  15: 'Category',
  20: 'Supplemental Categories',
  22: 'Fixture Identifier',
  25: 'Keywords',
  26: 'Content Location Code',
  27: 'Content Location Name',
  30: 'Release Date',
  35: 'Release Time',
  37: 'Expiration Date',
  38: 'Expiration Time',
  40: 'Special Instructions',
  42: 'Action Advised',
  45: 'Reference Service',
  47: 'Reference Date',
  50: 'Reference Number',
  55: 'Date Created',
  60: 'Time Created',
  62: 'Digital Creation Date',
  63: 'Digital Creation Time',
  65: 'Originating Program',
  70: 'Program Version',
  75: 'Object Cycle',
  80: 'By-line',
  85: 'By-line Title',
  90: 'City',
  92: 'Sublocation',
  95: 'Province/State',
  100: 'Country/Primary Location Code',
  101: 'Country/Primary Location Name',
  103: 'Original Transmission Reference',
  105: 'Headline',
  110: 'Credit',
  115: 'Source',
  116: 'Copyright Notice',
  118: 'Contact',
  120: 'Caption/Abstract',
  121: 'Local Caption',
  122: 'Writer/Editor',
  125: 'Rasterized Caption',
  130: 'Image Type',
  131: 'Image Orientation',
  135: 'Language Identifier',
  150: 'Audio Type',
  151: 'Audio Sampling Rate',
  152: 'Audio Sampling Resolution',
  153: 'Audio Duration',
  154: 'Audio Outcue',
  184: 'Job ID',
}

function printableAscii(bytes: Uint8Array, start: number, len: number): string {
  let out = ''
  const end = Math.min(bytes.length, start + len)
  for (let i = start; i < end; i++) {
    const c = bytes[i]
    if (c === 0) break
    out += c >= 32 && c <= 126 ? String.fromCharCode(c) : '.'
  }
  return out.trim()
}

function findAscii(bytes: Uint8Array, needle: string, from = 0, to = bytes.length): number {
  if (!needle) return -1
  const end = Math.min(bytes.length, to) - needle.length
  outer: for (let i = Math.max(0, from); i <= end; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer
    }
    return i
  }
  return -1
}

function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\u0000+$/g, '') }
  catch { return printableAscii(bytes, 0, bytes.length) }
}

function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n)
  if (n < 1024) return n + ' B'
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2) + ' ' + units[i]
}

function extensionOf(name: string): string {
  const m = /\.([^.]+)$/.exec(name)
  return m ? m[1].toLowerCase() : ''
}

function detectContainer(bytes: Uint8Array, name: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG'
  if (bytes.length >= 8 && bytes[0] === 0x89 && printableAscii(bytes, 1, 3) === 'PNG') return 'PNG'
  if (bytes.length >= 12 && printableAscii(bytes, 0, 4) === 'RIFF' && printableAscii(bytes, 8, 4) === 'WEBP') return 'WebP'
  if (bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a))) return 'TIFF'
  if (bytes.length >= 4 && printableAscii(bytes, 0, 4) === '8BPS') return 'PSD/PSB'
  if (bytes.length >= 12 && printableAscii(bytes, 4, 4) === 'ftyp') {
    const brand = printableAscii(bytes, 8, 4)
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/i.test(brand)) return 'HEIF/HEIC'
    if (/^(avif|avis)$/i.test(brand)) return 'AVIF'
    return 'ISO BMFF (' + brand + ')'
  }
  const ext = extensionOf(name)
  return ext ? ext.toUpperCase() : 'Unknown'
}

function xmpGroup(nodeName: string): string {
  const prefix = nodeName.includes(':') ? nodeName.split(':')[0].toLowerCase() : ''
  const groups: Record<string, string> = {
    dc: 'XMP Dublin Core',
    photoshop: 'XMP Photoshop',
    exif: 'XMP EXIF',
    exifex: 'XMP EXIF',
    tiff: 'XMP TIFF',
    xmp: 'XMP Basic',
    xmprights: 'XMP Rights',
    xmpmm: 'XMP Media Management',
    aux: 'XMP Camera',
    crs: 'XMP Camera Raw',
    iptccore: 'XMP IPTC Core',
    iptc4xmpcore: 'XMP IPTC Core',
    iptcext: 'XMP IPTC Extension',
    plus: 'XMP PLUS',
    stref: 'XMP Resource Reference',
    stEvt: 'XMP Event',
  }
  return groups[prefix] || 'XMP'
}

function niceXmlLabel(name: string): string {
  const local = name.includes(':') ? name.split(':').pop()! : name
  return local.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
}

function parseXmpText(text: string, add: AddField, setRawXmp: (v: string) => void, warnings: string[]) {
  const trimmed = text.trim()
  if (!trimmed) return
  if (trimmed.length > MAX_XMP_CHARS) {
    setRawXmp(trimmed.slice(0, MAX_XMP_CHARS))
    warnings.push('Raw XMP display was truncated to 256 KiB.')
  } else {
    setRawXmp(trimmed)
  }
  try {
    const doc = new DOMParser().parseFromString(trimmed, 'application/xml')
    if (doc.querySelector('parsererror')) throw new Error('Malformed XMP XML')
    const all = Array.from(doc.getElementsByTagName('*'))
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        if (/^xmlns(?::|$)/i.test(attr.name) || /^rdf:about$/i.test(attr.name)) continue
        const value = attr.value.trim()
        if (value) add(xmpGroup(attr.name), attr.name, niceXmlLabel(attr.name), value)
      }
      const directContainer = Array.from(el.children).find(child => /^(Seq|Bag|Alt)$/i.test(child.localName))
      if (directContainer) {
        const values = Array.from(directContainer.getElementsByTagNameNS('*', 'li'))
          .map(li => (li.textContent || '').trim())
          .filter(Boolean)
        if (values.length) add(xmpGroup(el.nodeName), el.nodeName, niceXmlLabel(el.nodeName), values.join('; '))
        continue
      }
      if (el.children.length === 0) {
        const value = (el.textContent || '').trim()
        if (value && !/^(li|Description)$/i.test(el.localName)) add(xmpGroup(el.nodeName), el.nodeName, niceXmlLabel(el.nodeName), value)
      }
    }
  } catch (err) {
    warnings.push('XMP packet was found but could not be fully parsed.')
  }
}

function scanEmbeddedXmp(bytes: Uint8Array, add: AddField, setRawXmp: (v: string) => void, warnings: string[]) {
  const starts = ['<x:xmpmeta', '<xmpmeta', '<rdf:RDF']
  let start = -1
  for (const marker of starts) {
    const p = findAscii(bytes, marker)
    if (p >= 0 && (start < 0 || p < start)) start = p
  }
  if (start < 0) return
  const endMarkers = ['</x:xmpmeta>', '</xmpmeta>', '</rdf:RDF>']
  let end = -1
  let endLen = 0
  for (const marker of endMarkers) {
    const p = findAscii(bytes, marker, start)
    if (p >= 0 && (end < 0 || p < end)) { end = p; endLen = marker.length }
  }
  if (end < 0) return
  parseXmpText(decodeUtf8(bytes.subarray(start, end + endLen)), add, setRawXmp, warnings)
}

function readIptc(bytes: Uint8Array, start: number, end: number, add: AddField) {
  let p = Math.max(0, start)
  const limit = Math.min(bytes.length, end)
  while (p + 5 <= limit) {
    if (bytes[p] !== 0x1c) { p++; continue }
    const record = bytes[p + 1]
    const dataset = bytes[p + 2]
    let len = (bytes[p + 3] << 8) | bytes[p + 4]
    let header = 5
    if (len & 0x8000) {
      const sizeBytes = len & 0x7fff
      if (sizeBytes < 1 || sizeBytes > 4 || p + 5 + sizeBytes > limit) { p++; continue }
      len = 0
      for (let i = 0; i < sizeBytes; i++) len = len * 256 + bytes[p + 5 + i]
      header += sizeBytes
    }
    const dataStart = p + header
    const dataEnd = Math.min(limit, dataStart + len)
    if (dataStart > limit || dataEnd < dataStart) break
    if (record === 2) {
      const label = IPTC_TAGS[dataset] || ('Dataset ' + dataset)
      const value = decodeUtf8(bytes.subarray(dataStart, dataEnd)).trim()
      if (value) add('IPTC', '2:' + dataset, label, value)
    }
    p = dataStart + len
  }
}

function u16be(bytes: Uint8Array, p: number): number {
  return p + 2 <= bytes.length ? (bytes[p] << 8) | bytes[p + 1] : 0
}

function u32be(bytes: Uint8Array, p: number): number {
  return p + 4 <= bytes.length ? ((bytes[p] * 0x1000000) + (bytes[p + 1] << 16) + (bytes[p + 2] << 8) + bytes[p + 3]) >>> 0 : 0
}

function parseIcc(bytes: Uint8Array, add: AddField) {
  if (bytes.length < 128) return
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sig = printableAscii(bytes, 36, 4)
  if (sig !== 'acsp') return
  add('ICC Profile', 'size', 'Profile Size', humanBytes(v.getUint32(0, false)))
  add('ICC Profile', 'cmm', 'Preferred CMM', printableAscii(bytes, 4, 4))
  const major = bytes[8]
  const minor = bytes[9] >> 4
  const bug = bytes[9] & 15
  add('ICC Profile', 'version', 'Profile Version', major + '.' + minor + '.' + bug)
  add('ICC Profile', 'class', 'Profile Class', printableAscii(bytes, 12, 4))
  add('ICC Profile', 'dataSpace', 'Data Color Space', printableAscii(bytes, 16, 4))
  add('ICC Profile', 'pcs', 'Connection Space', printableAscii(bytes, 20, 4))
  if (bytes.length >= 36) {
    const parts: number[] = []
    for (let p = 24; p < 36; p += 2) parts.push(v.getUint16(p, false))
    if (parts[0]) add('ICC Profile', 'created', 'Created', parts[0] + '-' + String(parts[1]).padStart(2, '0') + '-' + String(parts[2]).padStart(2, '0') + ' ' + String(parts[3]).padStart(2, '0') + ':' + String(parts[4]).padStart(2, '0') + ':' + String(parts[5]).padStart(2, '0'))
  }
  add('ICC Profile', 'platform', 'Primary Platform', printableAscii(bytes, 40, 4))
  add('ICC Profile', 'manufacturer', 'Device Manufacturer', printableAscii(bytes, 48, 4))
  add('ICC Profile', 'model', 'Device Model', printableAscii(bytes, 52, 4))
  if (bytes.length >= 68) add('ICC Profile', 'renderingIntent', 'Rendering Intent', v.getUint32(64, false))
  add('ICC Profile', 'creator', 'Profile Creator', printableAscii(bytes, 80, 4))
  if (bytes.length >= 132) {
    const count = Math.min(128, v.getUint32(128, false))
    add('ICC Profile', 'tagCount', 'Tag Count', count)
    for (let i = 0; i < count; i++) {
      const p = 132 + i * 12
      if (p + 12 > bytes.length) break
      const tag = printableAscii(bytes, p, 4)
      const off = v.getUint32(p + 4, false)
      const size = v.getUint32(p + 8, false)
      if (tag) add('ICC Tags', tag, tag, 'offset ' + off + ' · ' + humanBytes(size))
    }
  }
}

function parsePhotoshopResources(bytes: Uint8Array, start: number, end: number, add: AddField, setRawXmp: (v: string) => void, warnings: string[]) {
  let p = Math.max(0, start)
  const limit = Math.min(bytes.length, end)
  while (p + 12 <= limit) {
    if (printableAscii(bytes, p, 4) !== '8BIM') {
      const next = findAscii(bytes, '8BIM', p + 1, limit)
      if (next < 0) break
      p = next
    }
    const id = u16be(bytes, p + 4)
    let q = p + 6
    if (q >= limit) break
    const nameLen = bytes[q]
    q += 1 + nameLen
    if (((1 + nameLen) & 1) !== 0) q++
    if (q + 4 > limit) break
    const size = u32be(bytes, q)
    const dataStart = q + 4
    const dataEnd = Math.min(limit, dataStart + size)
    if (dataStart > limit || dataEnd < dataStart) break
    if (id === 0x0404) readIptc(bytes, dataStart, dataEnd, add)
    else if (id === 0x040f) parseIcc(bytes.subarray(dataStart, dataEnd), add)
    else if (id === 0x0422 || id === 0x0423) {
      const exif = bytes.subarray(dataStart, dataEnd)
      if (exif.length >= 6 && printableAscii(exif, 0, 4) === 'Exif') parseTiff(exif, 6, add, warnings)
      else parseTiff(exif, 0, add, warnings)
    } else if (id === 0x0424) {
      parseXmpText(decodeUtf8(bytes.subarray(dataStart, dataEnd)), add, setRawXmp, warnings)
    } else if (id === 0x040a) {
      const value = decodeUtf8(bytes.subarray(dataStart, dataEnd)).trim()
      if (value) add('Photoshop', 'copyrightFlag', 'Copyright Flag', value)
    } else if (id === 0x040b) {
      const value = decodeUtf8(bytes.subarray(dataStart, dataEnd)).trim()
      if (value) add('Photoshop', 'url', 'Copyright URL', value)
    }
    p = dataStart + size + (size & 1)
  }
}

interface TiffValue {
  display: string
  raw: string | number[] | Uint8Array
}

function parseTiff(bytes: Uint8Array, base: number, add: AddField, warnings: string[]) {
  if (base < 0 || base + 8 > bytes.length) return
  const little = bytes[base] === 0x49 && bytes[base + 1] === 0x49
  const big = bytes[base] === 0x4d && bytes[base + 1] === 0x4d
  if (!little && !big) return
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const get16 = (p: number) => p >= 0 && p + 2 <= bytes.length ? v.getUint16(p, little) : 0
  const getI16 = (p: number) => p >= 0 && p + 2 <= bytes.length ? v.getInt16(p, little) : 0
  const get32 = (p: number) => p >= 0 && p + 4 <= bytes.length ? v.getUint32(p, little) : 0
  const getI32 = (p: number) => p >= 0 && p + 4 <= bytes.length ? v.getInt32(p, little) : 0
  if (get16(base + 2) !== 42) return

  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 }
  const typeName: Record<number, string> = { 1: 'BYTE', 2: 'ASCII', 3: 'SHORT', 4: 'LONG', 5: 'RATIONAL', 6: 'SBYTE', 7: 'UNDEFINED', 8: 'SSHORT', 9: 'SLONG', 10: 'SRATIONAL', 11: 'FLOAT', 12: 'DOUBLE', 13: 'IFD' }

  const readValue = (entry: number, type: number, count: number): TiffValue | null => {
    const size = sizes[type]
    if (!size || count < 0 || count > 10_000_000) return null
    const total = size * count
    const data = total <= 4 ? entry + 8 : base + get32(entry + 8)
    if (data < 0 || data + total > bytes.length) return null
    if (type === 2) {
      const s = decodeUtf8(bytes.subarray(data, data + total)).replace(/\u0000/g, '').trim()
      return { display: s, raw: s }
    }
    if (type === 7 || (type === 1 && count > 32)) {
      const raw = bytes.slice(data, Math.min(data + total, data + 32))
      const hex = Array.from(raw).map(n => n.toString(16).padStart(2, '0')).join(' ')
      return { display: hex + (total > 32 ? ' … (' + total + ' bytes)' : ''), raw }
    }
    const values: number[] = []
    const max = Math.min(count, 64)
    for (let i = 0; i < max; i++) {
      const p = data + i * size
      let n = 0
      if (type === 1) n = bytes[p]
      else if (type === 6) n = v.getInt8(p)
      else if (type === 3) n = get16(p)
      else if (type === 8) n = getI16(p)
      else if (type === 4 || type === 13) n = get32(p)
      else if (type === 9) n = getI32(p)
      else if (type === 5) {
        const den = get32(p + 4)
        n = den ? get32(p) / den : 0
      } else if (type === 10) {
        const den = getI32(p + 4)
        n = den ? getI32(p) / den : 0
      } else if (type === 11) n = v.getFloat32(p, little)
      else if (type === 12) n = v.getFloat64(p, little)
      if (Number.isFinite(n)) values.push(n)
    }
    const fmt = (n: number) => Number.isInteger(n) ? String(n) : String(Math.round(n * 1_000_000) / 1_000_000)
    return {
      display: values.map(fmt).join(', ') + (count > max ? ' … (' + count + ' values)' : ''),
      raw: values,
    }
  }

  const gpsRaw: Record<number, TiffValue> = {}
  const seen = new Set<number>()
  const parseIfd = (offset: number, group: string, tagNames: Record<number, string>, depth: number) => {
    const pos = base + offset
    if (depth > 5 || seen.has(pos) || pos < base || pos + 2 > bytes.length) return
    seen.add(pos)
    const count = Math.min(get16(pos), 4096)
    for (let i = 0; i < count; i++) {
      const e = pos + 2 + i * 12
      if (e + 12 > bytes.length) break
      const tag = get16(e)
      const type = get16(e + 2)
      const n = get32(e + 4)
      const val = readValue(e, type, n)
      const tagHex = '0x' + tag.toString(16).padStart(4, '0').toUpperCase()
      const label = tagNames[tag] || EXIF_TAGS[tag] || ('Tag ' + tagHex)
      if (val && val.display) add(group, tagHex, label, val.display)
      if (group === 'GPS' && val) gpsRaw[tag] = val
      if ((tag === 0x8769 || tag === 0x8825 || tag === 0xa005) && val && Array.isArray(val.raw) && val.raw.length) {
        const next = Math.round(val.raw[0])
        if (next > 0) {
          if (tag === 0x8769) parseIfd(next, 'EXIF', EXIF_TAGS, depth + 1)
          else if (tag === 0x8825) parseIfd(next, 'GPS', GPS_TAGS, depth + 1)
          else parseIfd(next, 'EXIF Interop', EXIF_TAGS, depth + 1)
        }
      }
    }
    const nextPtrPos = pos + 2 + count * 12
    if (group === 'EXIF IFD0' && nextPtrPos + 4 <= bytes.length) {
      const next = get32(nextPtrPos)
      if (next) parseIfd(next, 'EXIF Thumbnail', EXIF_TAGS, depth + 1)
    }
  }

  const first = get32(base + 4)
  if (first) parseIfd(first, 'EXIF IFD0', EXIF_TAGS, 0)

  const refLat = typeof gpsRaw[1]?.raw === 'string' ? gpsRaw[1].raw : ''
  const refLon = typeof gpsRaw[3]?.raw === 'string' ? gpsRaw[3].raw : ''
  const latVals = Array.isArray(gpsRaw[2]?.raw) ? gpsRaw[2].raw as number[] : []
  const lonVals = Array.isArray(gpsRaw[4]?.raw) ? gpsRaw[4].raw as number[] : []
  if (latVals.length >= 3 && lonVals.length >= 3) {
    let lat = latVals[0] + latVals[1] / 60 + latVals[2] / 3600
    let lon = lonVals[0] + lonVals[1] / 60 + lonVals[2] / 3600
    if (/S/i.test(refLat)) lat = -lat
    if (/W/i.test(refLon)) lon = -lon
    add('Derived', 'GPSDecimal', 'GPS Coordinates', lat.toFixed(7) + ', ' + lon.toFixed(7))
  }

  const orient = EXIF_TAGS[0x0112]
  void orient
  if (seen.size === 0) warnings.push('TIFF/EXIF header was found but no readable IFD entries were available.')
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

function parseJpeg(bytes: Uint8Array, add: AddField, setRawXmp: (v: string) => void, warnings: string[]) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return
  const iccChunks = new Map<number, Uint8Array>()
  let iccTotal = 0
  let p = 2
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) { p++; continue }
    let marker = bytes[p + 1]
    while (marker === 0xff && p + 2 < bytes.length) { p++; marker = bytes[p + 1] }
    if (marker === 0xd9 || marker === 0xda) break
    if (marker >= 0xd0 && marker <= 0xd7) { p += 2; continue }
    const len = u16be(bytes, p + 2)
    if (len < 2 || p + 2 + len > bytes.length) break
    const start = p + 4
    const end = p + 2 + len
    if (marker === 0xe1) {
      if (findAscii(bytes, 'Exif\u0000\u0000', start, Math.min(end, start + 6)) === start) {
        parseTiff(bytes, start + 6, add, warnings)
      } else {
        const hdr = 'http://ns.adobe.com/xap/1.0/\u0000'
        if (findAscii(bytes, hdr, start, Math.min(end, start + hdr.length)) === start) {
          parseXmpText(decodeUtf8(bytes.subarray(start + hdr.length, end)), add, setRawXmp, warnings)
        }
      }
    } else if (marker === 0xed) {
      const hdr = 'Photoshop 3.0\u0000'
      const rs = findAscii(bytes, hdr, start, Math.min(end, start + hdr.length))
      if (rs === start) parsePhotoshopResources(bytes, start + hdr.length, end, add, setRawXmp, warnings)
    } else if (marker === 0xe2) {
      const hdr = 'ICC_PROFILE\u0000'
      if (findAscii(bytes, hdr, start, Math.min(end, start + hdr.length)) === start && start + 14 <= end) {
        const seq = bytes[start + 12]
        iccTotal = Math.max(iccTotal, bytes[start + 13])
        if (seq > 0) iccChunks.set(seq, bytes.slice(start + 14, end))
      }
    } else if (marker === 0xfe) {
      const comment = decodeUtf8(bytes.subarray(start, end)).trim()
      if (comment) add('JPEG', 'Comment', 'Comment', comment)
    } else if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && start + 6 <= end) {
      add('JPEG', 'Precision', 'Sample Precision', bytes[start] + '-bit')
      add('JPEG', 'Dimensions', 'Encoded Dimensions', u16be(bytes, start + 3) + ' × ' + u16be(bytes, start + 1) + ' px')
      add('JPEG', 'Components', 'Components', bytes[start + 5])
    }
    p = end
  }
  if (iccChunks.size) {
    const ordered: Uint8Array[] = []
    for (let i = 1; i <= Math.max(iccTotal, iccChunks.size); i++) if (iccChunks.has(i)) ordered.push(iccChunks.get(i)!)
    if (ordered.length) parseIcc(concatBytes(ordered), add)
  }
}

async function inflateDeflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (typeof DecompressionStream === 'undefined') return null
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

function readNull(bytes: Uint8Array, start: number, end: number): { value: string; next: number } {
  let p = start
  while (p < end && bytes[p] !== 0) p++
  return { value: decodeUtf8(bytes.subarray(start, p)), next: Math.min(end, p + 1) }
}

async function parsePng(bytes: Uint8Array, add: AddField, setRawXmp: (v: string) => void, warnings: string[]) {
  if (bytes.length < 8 || bytes[0] !== 0x89 || printableAscii(bytes, 1, 3) !== 'PNG') return
  let p = 8
  while (p + 12 <= bytes.length) {
    const len = u32be(bytes, p)
    const type = printableAscii(bytes, p + 4, 4)
    const start = p + 8
    const end = start + len
    if (end + 4 > bytes.length) break
    if (type === 'IHDR' && len >= 13) {
      add('PNG', 'Dimensions', 'Encoded Dimensions', u32be(bytes, start) + ' × ' + u32be(bytes, start + 4) + ' px')
      add('PNG', 'BitDepth', 'Bit Depth', bytes[start + 8])
      add('PNG', 'ColorType', 'Color Type', bytes[start + 9])
      add('PNG', 'Interlace', 'Interlace Method', bytes[start + 12])
    } else if (type === 'eXIf') {
      parseTiff(bytes, start, add, warnings)
    } else if (type === 'pHYs' && len >= 9) {
      const x = u32be(bytes, start), y = u32be(bytes, start + 4), unit = bytes[start + 8]
      add('PNG', 'PixelsPerUnitX', 'Pixels Per Unit X', x)
      add('PNG', 'PixelsPerUnitY', 'Pixels Per Unit Y', y)
      add('PNG', 'PhysicalUnit', 'Physical Unit', unit === 1 ? 'metre' : 'unknown')
      if (unit === 1 && x > 0) add('Derived', 'PPI', 'Resolution', (x / 39.37007874).toFixed(2) + ' PPI')
    } else if (type === 'tEXt') {
      const key = readNull(bytes, start, end)
      const value = decodeUtf8(bytes.subarray(key.next, end)).trim()
      if (value) add('PNG Text', key.value || 'Text', key.value || 'Text', value)
    } else if (type === 'zTXt') {
      const key = readNull(bytes, start, end)
      if (key.next < end) {
        const inflated = await inflateDeflate(bytes.subarray(key.next + 1, end))
        if (inflated) add('PNG Text', key.value || 'Text', key.value || 'Text', decodeUtf8(inflated))
      }
    } else if (type === 'iTXt') {
      const key = readNull(bytes, start, end)
      let q = key.next
      if (q + 2 <= end) {
        const compressed = bytes[q] === 1
        q += 2
        const language = readNull(bytes, q, end); q = language.next
        const translated = readNull(bytes, q, end); q = translated.next
        let payload = bytes.subarray(q, end)
        if (compressed) payload = (await inflateDeflate(payload)) || new Uint8Array()
        const value = decodeUtf8(payload).trim()
        if (/xml:com\.adobe\.xmp/i.test(key.value)) parseXmpText(value, add, setRawXmp, warnings)
        else if (value) add('PNG Text', key.value || 'International Text', key.value || 'International Text', value)
      }
    } else if (type === 'iCCP') {
      const profileName = readNull(bytes, start, end)
      if (profileName.next < end) {
        add('ICC Profile', 'name', 'Profile Name', profileName.value)
        const inflated = await inflateDeflate(bytes.subarray(profileName.next + 1, end))
        if (inflated) parseIcc(inflated, add)
      }
    }
    p = end + 4
    if (type === 'IEND') break
  }
}

function parseWebp(bytes: Uint8Array, add: AddField, setRawXmp: (v: string) => void, warnings: string[]) {
  if (bytes.length < 12 || printableAscii(bytes, 0, 4) !== 'RIFF' || printableAscii(bytes, 8, 4) !== 'WEBP') return
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 12
  while (p + 8 <= bytes.length) {
    const type = printableAscii(bytes, p, 4)
    const size = v.getUint32(p + 4, true)
    const start = p + 8
    const end = Math.min(bytes.length, start + size)
    if (type === 'EXIF') {
      const exifHdr = findAscii(bytes, 'Exif\u0000\u0000', start, Math.min(end, start + 6))
      parseTiff(bytes, exifHdr === start ? start + 6 : start, add, warnings)
    } else if (type === 'XMP ') {
      parseXmpText(decodeUtf8(bytes.subarray(start, end)), add, setRawXmp, warnings)
    } else if (type === 'ICCP') {
      parseIcc(bytes.subarray(start, end), add)
    } else if (type === 'VP8X' && size >= 10) {
      const w = 1 + bytes[start + 4] + bytes[start + 5] * 256 + bytes[start + 6] * 65536
      const h = 1 + bytes[start + 7] + bytes[start + 8] * 256 + bytes[start + 9] * 65536
      add('WebP', 'Dimensions', 'Encoded Dimensions', w + ' × ' + h + ' px')
      add('WebP', 'Alpha', 'Alpha', (bytes[start] & 0x10) !== 0 ? 'Yes' : 'No')
      add('WebP', 'Animation', 'Animation', (bytes[start] & 0x02) !== 0 ? 'Yes' : 'No')
    }
    p = start + size + (size & 1)
  }
}

function parsePsd(bytes: Uint8Array, add: AddField, setRawXmp: (v: string) => void, warnings: string[]) {
  if (bytes.length < 26 || printableAscii(bytes, 0, 4) !== '8BPS') return
  const version = u16be(bytes, 4)
  const channels = u16be(bytes, 12)
  const height = u32be(bytes, 14)
  const width = u32be(bytes, 18)
  const depth = u16be(bytes, 22)
  const mode = u16be(bytes, 24)
  const modes: Record<number, string> = { 0: 'Bitmap', 1: 'Grayscale', 2: 'Indexed', 3: 'RGB', 4: 'CMYK', 7: 'Multichannel', 8: 'Duotone', 9: 'Lab' }
  add('PSD', 'Version', 'Format Version', version === 2 ? 'PSB' : 'PSD')
  add('PSD', 'Dimensions', 'Encoded Dimensions', width + ' × ' + height + ' px')
  add('PSD', 'Channels', 'Channels', channels)
  add('PSD', 'Depth', 'Bit Depth', depth + '-bit/channel')
  add('PSD', 'ColorMode', 'Color Mode', modes[mode] || String(mode))
  let p = 26
  if (p + 4 > bytes.length) return
  const colorLen = u32be(bytes, p); p += 4 + colorLen
  if (p + 4 > bytes.length) return
  const resourcesLen = u32be(bytes, p); p += 4
  const resourcesEnd = Math.min(bytes.length, p + resourcesLen)
  parsePhotoshopResources(bytes, p, resourcesEnd, add, setRawXmp, warnings)
}

function parseIsoBmff(bytes: Uint8Array, add: AddField) {
  if (bytes.length < 16 || printableAscii(bytes, 4, 4) !== 'ftyp') return
  const size = u32be(bytes, 0)
  const end = Math.min(bytes.length, size || bytes.length)
  const major = printableAscii(bytes, 8, 4)
  add('Container', 'MajorBrand', 'Major Brand', major)
  if (bytes.length >= 16) add('Container', 'MinorVersion', 'Minor Version', u32be(bytes, 12))
  const brands: string[] = []
  for (let p = 16; p + 4 <= end; p += 4) {
    const b = printableAscii(bytes, p, 4)
    if (b) brands.push(b)
  }
  if (brands.length) add('Container', 'CompatibleBrands', 'Compatible Brands', brands.join(', '))
}

function genericEmbeddedExif(bytes: Uint8Array, add: AddField, warnings: string[]) {
  const exif = findAscii(bytes, 'Exif\u0000\u0000')
  if (exif >= 0) parseTiff(bytes, exif + 6, add, warnings)
}

function fieldMatches(field: ImageMetadataField, tags: string[], labels: string[] = []): boolean {
  const tag = field.tag.toLowerCase()
  const label = field.label.toLowerCase()
  return tags.some(v => tag === v.toLowerCase()) || labels.some(v => label === v.toLowerCase())
}

function firstField(fields: ImageMetadataField[], tags: string[], labels: string[] = []): string | undefined {
  return fields.find(f => fieldMatches(f, tags, labels))?.value?.trim() || undefined
}

export function editableMetadataFromFields(fields: ImageMetadataField[]): EditableImageMetadata {
  const keywordValues = fields
    .filter(f => fieldMatches(f, ['dc:subject', '2:25'], ['Keywords']))
    .flatMap(f => f.value.split(/[;,]/g))
    .map(v => v.trim())
    .filter(Boolean)
  const keywords = Array.from(new Set(keywordValues))
  const ratingRaw = firstField(fields, ['xmp:Rating'], ['Rating'])
  const rating = ratingRaw === undefined ? undefined : Math.max(0, Math.min(5, Math.round(Number(ratingRaw) || 0)))
  const marked = firstField(fields, ['xmpRights:Marked'], ['Marked'])
  const copyrightStatus: EditableImageMetadata['copyrightStatus'] =
    marked === undefined ? 'unknown' : /^(true|1)$/i.test(marked) ? 'copyrighted' : 'public-domain'

  return {
    title: firstField(fields, ['dc:title', '2:5'], ['Object Name', 'Title']),
    description: firstField(fields, ['dc:description', '2:120', '0x010E'], ['Caption/Abstract', 'Image Description', 'Description']),
    author: firstField(fields, ['dc:creator', '2:80', '0x013B'], ['By-line', 'Artist', 'Creator']),
    authorTitle: firstField(fields, ['photoshop:AuthorsPosition', '2:85'], ['By-line Title', 'Authors Position']),
    keywords: keywords.length ? keywords : undefined,
    headline: firstField(fields, ['photoshop:Headline', '2:105'], ['Headline']),
    credit: firstField(fields, ['photoshop:Credit', '2:110'], ['Credit']),
    source: firstField(fields, ['photoshop:Source', '2:115'], ['Source']),
    instructions: firstField(fields, ['photoshop:Instructions', '2:40'], ['Special Instructions', 'Instructions']),
    copyright: firstField(fields, ['dc:rights', '2:116', '0x8298'], ['Copyright Notice', 'Copyright']),
    copyrightStatus,
    copyrightUrl: firstField(fields, ['xmpRights:WebStatement'], ['Web Statement', 'Copyright URL']),
    city: firstField(fields, ['photoshop:City', '2:90'], ['City']),
    state: firstField(fields, ['photoshop:State', '2:95'], ['Province/State', 'State']),
    country: firstField(fields, ['photoshop:Country', '2:101'], ['Country/Primary Location Name', 'Country']),
    countryCode: firstField(fields, ['Iptc4xmpCore:CountryCode', 'iptcCore:CountryCode', '2:100'], ['Country/Primary Location Code', 'Country Code']),
    jobIdentifier: firstField(fields, ['photoshop:TransmissionReference', '2:103', '2:184'], ['Original Transmission Reference', 'Job ID']),
    rating,
  }
}

export async function readImageMetadata(file: File): Promise<ImageMetadata> {
  const fields: ImageMetadataField[] = []
  const warnings: string[] = []
  let rawXmp: string | undefined
  const seen = new Set<string>()

  const add: AddField = (group, tag, label, value) => {
    if (fields.length >= MAX_FIELDS || value === undefined || value === null) return
    let text = typeof value === 'string' ? value.trim() : String(value)
    if (!text) return
    if (text.length > 8192) text = text.slice(0, 8192) + '…'
    const key = group + '\u0000' + tag + '\u0000' + text
    if (seen.has(key)) return
    seen.add(key)
    fields.push({ group, tag, label, value: text })
  }
  const setRawXmp = (value: string) => { if (!rawXmp || value.length > rawXmp.length) rawXmp = value }

  add('File', 'Name', 'File Name', file.name)
  add('File', 'Type', 'MIME Type', file.type || 'unknown')
  add('File', 'Size', 'File Size', humanBytes(file.size) + ' (' + file.size + ' bytes)')
  if (file.lastModified) add('File', 'LastModified', 'File Modified', new Date(file.lastModified).toISOString())
  const ext = extensionOf(file.name)
  if (ext) add('File', 'Extension', 'Extension', ext)

  const scanSize = Math.min(file.size, MAX_SCAN_BYTES)
  let bytes = new Uint8Array()
  try {
    bytes = new Uint8Array(await file.slice(0, scanSize).arrayBuffer())
  } catch {
    warnings.push('Source bytes could not be read for metadata inspection.')
  }
  const format = detectContainer(bytes, file.name)
  add('File', 'Format', 'Detected Format', format)
  if (file.size > scanSize) warnings.push('Metadata scan is limited to the first 64 MiB of this file.')

  if (bytes.length) {
    try {
      if (format === 'JPEG') parseJpeg(bytes, add, setRawXmp, warnings)
      else if (format === 'PNG') await parsePng(bytes, add, setRawXmp, warnings)
      else if (format === 'TIFF') parseTiff(bytes, 0, add, warnings)
      else if (format === 'WebP') parseWebp(bytes, add, setRawXmp, warnings)
      else if (format === 'PSD/PSB') parsePsd(bytes, add, setRawXmp, warnings)
      else if (format.startsWith('HEIF') || format === 'AVIF' || format.startsWith('ISO BMFF')) parseIsoBmff(bytes, add)

      if (!rawXmp) scanEmbeddedXmp(bytes, add, setRawXmp, warnings)
      if (!fields.some(f => f.group.startsWith('EXIF')) && format !== 'TIFF') genericEmbeddedExif(bytes, add, warnings)
    } catch {
      warnings.push('Some embedded metadata was malformed or outside the scanned file range.')
    }
  }

  return {
    fileName: file.name,
    mimeType: file.type || '',
    fileSize: file.size,
    lastModified: file.lastModified || undefined,
    format,
    fields,
    rawXmp,
    editable: editableMetadataFromFields(fields),
    warnings: warnings.length ? Array.from(new Set(warnings)) : undefined,
  }
}
