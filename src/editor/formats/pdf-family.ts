import type { ParsedDocument, ParsedDocumentLayer } from './document-parser-types'
import { bytesToCanvas, finite, safeName } from './parser-utils'
import { createCanvas, ctx2d } from '../utils/canvas'
import { decodePublishedFormatPreview } from './photopea-formats'
import { decodeTiff, rawToCanvas } from './decoders'

function latin(bytes: Uint8Array): string {
  return new TextDecoder('iso-8859-1', { fatal: false }).decode(bytes)
}

function pageBounds(text: string): { x: number; y: number; width: number; height: number } {
  const re = /\/(?:CropBox|MediaBox)\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/
  const m = re.exec(text)
  if (!m) return { x: 0, y: 0, width: 1024, height: 768 }
  const x0 = finite(m[1]), y0 = finite(m[2]), x1 = finite(m[3], 1024), y1 = finite(m[4], 768)
  return { x: x0, y: y0, width: Math.max(1, Math.abs(x1 - x0)), height: Math.max(1, Math.abs(y1 - y0)) }
}

async function inflatePdf(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as any).DecompressionStream
  if (typeof DS !== 'function') throw new Error('Flate PDF stream requires DecompressionStream')
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DS('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function unfilterPng(data: Uint8Array, width: number, height: number, channels: number, bpc: number, predictor: number): Uint8Array {
  if (bpc !== 8 || predictor < 10) return data
  const stride = width * channels
  const out = new Uint8Array(stride * height)
  let ip = 0
  for (let y = 0; y < height; y++) {
    if (ip >= data.length) break
    const filter = data[ip++]
    const row = out.subarray(y * stride, (y + 1) * stride)
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride && ip < data.length; x++) {
      const raw = data[ip++]
      const a = x >= channels ? row[x - channels] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= channels ? prev[x - channels] : 0
      if (filter === 0) row[x] = raw
      else if (filter === 1) row[x] = (raw + a) & 255
      else if (filter === 2) row[x] = (raw + b) & 255
      else if (filter === 3) row[x] = (raw + Math.floor((a + b) / 2)) & 255
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        row[x] = (raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      } else row[x] = raw
    }
  }
  return out
}

function rawPdfImage(data: Uint8Array, dict: string, width: number, height: number): HTMLCanvasElement | null {
  const bpc = Number(/\/BitsPerComponent\s+(\d+)/.exec(dict)?.[1] ?? 8)
  if (bpc !== 8) return null
  const cs = /\/ColorSpace\s*\/(DeviceGray|DeviceRGB|DeviceCMYK)/.exec(dict)?.[1] ?? 'DeviceRGB'
  const channels = cs === 'DeviceGray' ? 1 : cs === 'DeviceCMYK' ? 4 : 3
  const predictor = Number(/\/Predictor\s+(\d+)/.exec(dict)?.[1] ?? 1)
  const decoded = unfilterPng(data, width, height, channels, bpc, predictor)
  if (decoded.length < width * height * channels) return null
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, o = 0; i < width * height; i++, o += 4) {
    if (channels === 1) {
      const v = decoded[i]; rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v
    } else if (channels === 3) {
      const p = i * 3; rgba[o] = decoded[p]; rgba[o + 1] = decoded[p + 1]; rgba[o + 2] = decoded[p + 2]
    } else {
      const p = i * 4
      const c = decoded[p] / 255, m = decoded[p + 1] / 255, y = decoded[p + 2] / 255, k = decoded[p + 3] / 255
      rgba[o] = Math.round(255 * (1 - Math.min(1, c * (1 - k) + k)))
      rgba[o + 1] = Math.round(255 * (1 - Math.min(1, m * (1 - k) + k)))
      rgba[o + 2] = Math.round(255 * (1 - Math.min(1, y * (1 - k) + k)))
    }
    rgba[o + 3] = 255
  }
  const canvas = createCanvas(width, height)
  ctx2d(canvas).putImageData(new ImageData(rgba, width, height), 0, 0)
  return canvas
}

function pdfStrings(text: string): string[] {
  const out: string[] = []
  const decode = (s: string) => s
    .replace(/\\([nrtbf()\\])/g, (_m, c) => ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','(':'(',')':')','\\':'\\'} as any)[c] ?? c)
    .replace(/\\([0-7]{1,3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)))
  const re = /\(((?:\\.|[^\\()]){1,2000})\)\s*(?:Tj|['"])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const value = decode(m[1]).trim()
    if (value && /[\p{L}\p{N}]/u.test(value)) out.push(value)
    if (out.length >= 500) break
  }
  return out
}

async function extractPdfImages(bytes: Uint8Array, source: string, width: number, height: number, warnings: string[]): Promise<ParsedDocumentLayer[]> {
  const layers: ParsedDocumentLayer[] = []
  let pos = 0
  while ((pos = source.indexOf('/Subtype', pos)) >= 0 && layers.length < 256) {
    if (!/^\/Subtype\s*\/Image/.test(source.slice(pos, pos + 80))) { pos += 8; continue }
    const streamWord = source.indexOf('stream', pos)
    if (streamWord < 0 || streamWord - pos > 10000) break
    const dictStart = source.lastIndexOf('<<', pos)
    if (dictStart < 0) { pos += 8; continue }
    const dict = source.slice(dictStart, streamWord)
    const w = Number(/\/Width\s+(\d+)/.exec(dict)?.[1] ?? 0)
    const h = Number(/\/Height\s+(\d+)/.exec(dict)?.[1] ?? 0)
    if (!(w > 0 && h > 0) || w * h > 268435456) { pos = streamWord + 6; continue }
    let dataStart = streamWord + 6
    if (source[dataStart] === '\r' && source[dataStart + 1] === '\n') dataStart += 2
    else if (source[dataStart] === '\n' || source[dataStart] === '\r') dataStart++
    const end = source.indexOf('endstream', dataStart)
    if (end < 0) break
    // Latin-1 decoding preserves one UTF-16 code unit per source byte, so
    // string offsets are valid byte offsets for stream slicing.
    let data = bytes.subarray(dataStart, end)
    while (data.length && (data[data.length - 1] === 0x0a || data[data.length - 1] === 0x0d)) data = data.subarray(0, data.length - 1)
    const filter = /\/Filter\s*(?:\[\s*)?\/(DCTDecode|JPXDecode|FlateDecode)/.exec(dict)?.[1]
    let canvas: HTMLCanvasElement | null = null
    try {
      if (filter === 'DCTDecode') canvas = await bytesToCanvas(data, 'image/jpeg')
      else if (filter === 'JPXDecode') canvas = await bytesToCanvas(data, 'image/jp2')
      else if (filter === 'FlateDecode') canvas = rawPdfImage(await inflatePdf(data), dict, w, h)
      else if (!filter) canvas = rawPdfImage(data, dict, w, h)
    } catch { canvas = null }
    if (canvas) {
      layers.push({
        kind: 'raster',
        name: `PDF Image ${layers.length + 1}`,
        canvas,
        left: Math.max(0, Math.round((width - canvas.width) / 2)),
        top: Math.max(0, Math.round((height - canvas.height) / 2)),
        metadata: { sourceFormat: 'pdf', objectWidth: w, objectHeight: h, filter: filter ?? 'raw' },
      })
    }
    pos = end + 9
  }
  if (layers.length) warnings.push('PDF image XObjects are extracted as separate layers; complex page placement matrices are approximated')
  return layers
}

async function parsePdf(bytes: Uint8Array, fileName: string): Promise<ParsedDocument> {
  const source = latin(bytes)
  const b = pageBounds(source)
  const width = Math.max(1, Math.ceil(b.width)), height = Math.max(1, Math.ceil(b.height))
  const warnings: string[] = []
  const layers = await extractPdfImages(bytes, source, width, height, warnings)

  const textCandidates = [...pdfStrings(source)]
  // Also inspect small Flate content streams for text operators.
  const streamRe = /<<(?:.|\n|\r){0,5000}?\/Filter\s*\/FlateDecode(?:.|\n|\r){0,5000}?>>\s*stream\r?\n/g
  let sm: RegExpExecArray | null
  while ((sm = streamRe.exec(source)) && textCandidates.length < 500) {
    const start = sm.index + sm[0].length
    const end = source.indexOf('endstream', start)
    if (end < 0 || end - start > 16 * 1024 * 1024) continue
    try {
      const raw = bytes.subarray(start, end - (source[end - 1] === '\n' ? 1 : 0))
      const inflated = await inflatePdf(raw)
      textCandidates.push(...pdfStrings(latin(inflated)))
    } catch { /* other filter chains / malformed streams */ }
  }
  const unique = Array.from(new Set(textCandidates.map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean))).slice(0, 200)
  if (unique.length) {
    layers.push({
      kind: 'text',
      name: 'Extracted PDF Text',
      text: {
        content: unique.join('\n'),
        fontFamily: 'Arial',
        fontSize: 14,
        color: '#000000',
        bold: false, italic: false, align: 'left',
        lineHeight: 1.25, tracking: 0,
        boxWidth: Math.max(1, width - 48), boxHeight: Math.max(1, height - 48),
        x: 24, y: 38,
      },
      metadata: { sourceFormat: 'pdf', extractedStrings: unique.length },
    })
    warnings.push('PDF text is extracted as editable content; exact fonts and text matrices may require a full PDF rendering engine')
  }

  if (!layers.length) {
    try {
      const preview = await decodePublishedFormatPreview(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), fileName)
      layers.push({ kind: 'raster', name: fileName.replace(/\.[^.]+$/, ''), canvas: preview, left: 0, top: 0 })
    } catch {
      // Still return a valid page-sized document. This is preferable to
      // misrepresenting an unsupported PDF page as a random embedded image.
      layers.push({ kind: 'raster', name: 'PDF Page', canvas: createCanvas(width, height), left: 0, top: 0 })
      warnings.push('No directly extractable PDF page objects were found; unsupported vector operators were left blank')
    }
  }
  return { width, height, name: fileName, sourceBitDepth: 8, resolutionPpi: 72, layers, warnings }
}

function epsBounds(source: string): { width: number; height: number } {
  const m = /^%%(?:HiRes)?BoundingBox:\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/m.exec(source)
  if (!m) return { width: 1024, height: 768 }
  return { width: Math.max(1, Math.ceil(Math.abs(finite(m[3]) - finite(m[1])))), height: Math.max(1, Math.ceil(Math.abs(finite(m[4]) - finite(m[2])))) }
}

async function parseEps(bytes: Uint8Array, fileName: string): Promise<ParsedDocument> {
  // Adobe binary EPS header: magic + PS offset/len + WMF offset/len + TIFF offset/len.
  if (bytes.length >= 30 && bytes[0] === 0xc5 && bytes[1] === 0xd0 && bytes[2] === 0xd3 && bytes[3] === 0xc6) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const tiffOffset = v.getUint32(20, true), tiffLength = v.getUint32(24, true)
    if (tiffOffset > 0 && tiffLength > 0 && tiffOffset + tiffLength <= bytes.length) {
      try {
        const canvas = rawToCanvas(await decodeTiff(bytes.subarray(tiffOffset, tiffOffset + tiffLength)))
        return { width: canvas.width, height: canvas.height, name: fileName, sourceBitDepth: 8, layers: [
          { kind: 'raster', name: 'EPS TIFF Preview', canvas, left: 0, top: 0 },
        ], warnings: ['EPS PostScript vectors are preserved only through the embedded TIFF preview in this file'] }
      } catch { /* continue with PostScript text */ }
    }
  }
  const source = latin(bytes)
  // Illustrator files saved with PDF compatibility often contain an embedded
  // PDF section. Hand it to the PDF parser from the first %PDF marker.
  const pdfAt = source.indexOf('%PDF-')
  if (pdfAt >= 0) return parsePdf(bytes.subarray(pdfAt), fileName)
  const b = epsBounds(source)
  const layers: ParsedDocumentLayer[] = []
  const warnings = ['EPS/PostScript drawing operators are only partially parsed; embedded previews are preferred']
  try {
    const preview = await decodePublishedFormatPreview(new Blob([bytes as unknown as BlobPart]), fileName)
    layers.push({ kind: 'raster', name: fileName.replace(/\.[^.]+$/, ''), canvas: preview, left: 0, top: 0 })
  } catch {
    layers.push({ kind: 'raster', name: 'EPS Artboard', canvas: createCanvas(b.width, b.height), left: 0, top: 0 })
  }
  return { width: b.width, height: b.height, name: fileName, sourceBitDepth: 8, resolutionPpi: 72, layers, warnings }
}

export async function parsePdfFamily(bytes: Uint8Array, fileName: string): Promise<ParsedDocument> {
  const source = latin(bytes.subarray(0, Math.min(bytes.length, 1024 * 1024)))
  if (source.includes('%PDF-')) {
    const at = source.indexOf('%PDF-')
    return parsePdf(at > 0 ? bytes.subarray(at) : bytes, fileName)
  }
  return parseEps(bytes, fileName)
}
