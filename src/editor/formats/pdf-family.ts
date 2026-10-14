import type { ParsedDocument, ParsedDocumentLayer } from './document-parser-types'
import { finite } from './parser-utils'
import { createCanvas } from '../utils/canvas'
import { decodePublishedFormatPreview } from './photopea-formats'
import { decodeTiff, rawToCanvas } from './decoders'

function latin(bytes: Uint8Array): string {
  return new TextDecoder('iso-8859-1', { fatal: false }).decode(bytes)
}

// PDF.js runs only for PDF/PDF-compatible AI. Keep EPS preview support separate
// so importing EPS never downloads or initializes a PDF worker.
async function parsePdf(bytes: Uint8Array, fileName: string): Promise<ParsedDocument> {
  const { renderPdfPages } = await import('./pdf-render')
  return renderPdfPages(bytes, fileName)
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
  const source = latin(bytes.subarray(0, Math.min(bytes.length, 1024 * 1024)))
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
  if (fileName.toLowerCase().endsWith('.pdf')) throw new Error('Invalid PDF header: %PDF signature not found')
  return parseEps(bytes, fileName)
}
