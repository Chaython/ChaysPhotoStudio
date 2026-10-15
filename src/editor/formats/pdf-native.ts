// Native PDF text and vector recovery. This is deliberately conservative:
// only axis-aligned text runs and simple solid-color paths become editable.
// The PDF.js-rendered raster reference stays authoritative for effects, images,
// glyph substitutions, patterns, clipping, forms, and anything not representable
// by the editor's native TextSpec / ShapeSpec structures.
import type { ParsedDocumentLayer } from './document-parser-types'
import type { PathAnchor } from '../types'

// PDF.js 6.4.299 OPS (public pdfjsLib.OPS) and DrawOPS from its evaluator.
export interface PdfOps {
  save: number; restore: number; transform: number
  setLineWidth: number; setFillRGBColor: number; setStrokeRGBColor: number
  setFillGray: number; setStrokeGray: number
  setFillCMYKColor: number; setStrokeCMYKColor: number
  constructPath: number; clip: number; eoClip: number; setGState: number
  beginGroup: number; endGroup: number
}
export interface PdfOperatorList {
  fnArray: ArrayLike<number>
  argsArray: ArrayLike<any>
}
export interface PdfTextItem {
  str?: string
  transform?: number[]
  width?: number
  height?: number
  fontName?: string
  dir?: string
}
export interface PdfTextContent {
  items: PdfTextItem[]
  styles?: Record<string, { fontFamily?: string; ascent?: number; descent?: number }>
}

export type PdfMatrix = readonly [number, number, number, number, number, number]
const ID: PdfMatrix = [1, 0, 0, 1, 0, 0]
const MAX_TEXT = 120
const MAX_VECTOR = 120
const MAX_ITEMS = 12000
const MAX_OPS = 140000
const MAX_PATH_NUMBERS = 3200

function multiply(a: PdfMatrix, b: PdfMatrix): PdfMatrix {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}
function finiteMatrix(a: unknown): a is PdfMatrix {
  if (!(Array.isArray(a) || ArrayBuffer.isView(a))) return false
  const matrix = a as ArrayLike<number>
  return matrix.length >= 6 && Array.from({ length: 6 }, (_, i) => matrix[i]).every(Number.isFinite)
}
function pt(m: PdfMatrix, x: number, y: number) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}
function bounded(x: number, y: number, width: number, height: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= width * 8 + 8192 &&
    Math.abs(y) <= height * 8 + 8192
}
function colorFrom(args: unknown, mode: 'rgb' | 'gray' | 'cmyk'): string | null {
  const raw = Array.isArray(args) ? args : []
  // PDF.js has historically emitted separate channels and packed Uint8 arrays.
  const values = raw.length === 1 && (Array.isArray(raw[0]) || ArrayBuffer.isView(raw[0]))
    ? Array.from(raw[0] as ArrayLike<number>) : raw
  const number = values.map(Number)
  if (!number.every(Number.isFinite)) return null
  const n = mode === 'gray' ? 1 : mode === 'rgb' ? 3 : 4
  if (number.length < n) return null
  // Packed Uint8 colors are byte values, including channel value 1. Treating
  // 1 as normalized white turned near-black PDF fills into full intensity.
  // PDF.js float channel arguments are instead normalized to [0, 1].
  const packedBytes = raw.length === 1 && raw[0] instanceof Uint8Array
  const normalized = number.slice(0, n).map(v =>
    Math.max(0, Math.min(1, packedBytes ? v / 255 : v > 1 ? v / 255 : v)))
  const channels = mode === 'gray' ? [normalized[0], normalized[0], normalized[0]]
    : mode === 'rgb' ? normalized.slice(0, 3)
      : [
        (1 - normalized[0]) * (1 - normalized[3]),
        (1 - normalized[1]) * (1 - normalized[3]),
        (1 - normalized[2]) * (1 - normalized[3]),
      ]
  return '#' + channels.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}

interface PdfPaintState {
  matrix: PdfMatrix
  fill: string | null
  stroke: string | null
  width: number
  complex: boolean
}
function baseState(): PdfPaintState { return { matrix: ID, fill: '#000000', stroke: '#000000', width: 1, complex: false } }

function readPath(input: unknown, matrix: PdfMatrix, width: number, height: number):
  { anchors: PathAnchor[]; closed: boolean } | null {
  if (!input || typeof input !== 'object' || !('length' in input)) return null
  const raw = input as ArrayLike<number>
  if (raw.length < 6 || raw.length > MAX_PATH_NUMBERS) return null
  const anchors: PathAnchor[] = []
  let i = 0, closed = false, subpaths = 0
  let last = { x: 0, y: 0 }
  const push = (x: number, y: number, incoming?: { x: number; y: number }): boolean => {
    const p = pt(matrix, x, y)
    const q = incoming ? pt(matrix, incoming.x, incoming.y) : p
    if (!bounded(p.x, p.y, width, height) || !bounded(q.x, q.y, width, height)) return false
    anchors.push({ x: p.x, y: p.y, inX: q.x - p.x, inY: q.y - p.y,
      outX: 0, outY: 0, pair: false })
    return true
  }
  const out = (x: number, y: number) => {
    const a = anchors[anchors.length - 1]
    if (!a) return false
    const p = pt(matrix, x, y)
    if (!bounded(p.x, p.y, width, height)) return false
    a.outX = p.x - a.x; a.outY = p.y - a.y
    return true
  }
  while (i < raw.length) {
    const op = raw[i++]
    if (op === 0) { // DrawOPS.moveTo
      if (++subpaths > 1 || i + 1 >= raw.length) return null
      const x = raw[i++], y = raw[i++]
      if (!push(x, y)) return null
      last = { x, y }
    } else if (op === 1) { // lineTo
      if (!subpaths || i + 1 >= raw.length) return null
      const x = raw[i++], y = raw[i++]
      if (!push(x, y)) return null
      last = { x, y }
    } else if (op === 2) { // cubic
      if (!subpaths || i + 5 >= raw.length) return null
      const x1 = raw[i++], y1 = raw[i++], x2 = raw[i++], y2 = raw[i++]
      const x = raw[i++], y = raw[i++]
      if (!out(x1, y1) || !push(x, y, { x: x2, y: y2 })) return null
      last = { x, y }
    } else if (op === 3) { // quadratic
      if (!subpaths || i + 3 >= raw.length) return null
      const qx = raw[i++], qy = raw[i++], x = raw[i++], y = raw[i++]
      const c1 = { x: last.x + 2 / 3 * (qx - last.x), y: last.y + 2 / 3 * (qy - last.y) }
      const c2 = { x: x + 2 / 3 * (qx - x), y: y + 2 / 3 * (qy - y) }
      if (!out(c1.x, c1.y) || !push(x, y, c2)) return null
      last = { x, y }
    } else if (op === 4) {
      closed = true
      if (i !== raw.length) return null // do not invent compound paths
    } else return null
  }
  if (anchors.length < 2 || (closed && anchors.length < 3)) return null
  if (closed && anchors.length >= 2) {
    const a = anchors[0], b = anchors[anchors.length - 1]
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.001) anchors.pop()
  }
  return anchors.length >= 2 ? { anchors, closed } : null
}

function fontFamily(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) return 'Arial'
  // Strip subset font prefixes and prevent invalid CSS font shorthands.
  const cleaned = name.replace(/^[A-Z]{6}\+/, '').replace(/[;"'\\]/g, '').trim()
  return cleaned.slice(0, 90) || 'Arial'
}

export function pdfEditableText(
  content: PdfTextContent, viewport: PdfMatrix, width: number, height: number, pageNumber: number,
): ParsedDocumentLayer[] {
  const layers: ParsedDocumentLayer[] = []
  const items = Array.isArray(content.items) ? content.items : []
  for (const item of items.slice(0, MAX_ITEMS)) {
    if (layers.length >= MAX_TEXT) break
    if (!item?.str || item.str.trim().length === 0 ||
        item.str.length > 2000 || !finiteMatrix(item.transform)) continue
    const tr = multiply(viewport, item.transform as PdfMatrix)
    // The native text renderer has no glyph-level rotation/skew or bidi support.
    // Keep these on the PDF-rendered reference, rather than distort them.
    const size = Math.hypot(tr[2], tr[3])
    if (!Number.isFinite(size) || size < 1 || size > 1024 ||
        Math.abs(tr[1]) > size * 0.015 || Math.abs(tr[2]) > size * 0.015 ||
        tr[0] <= 0 || tr[3] >= 0 || item.dir === 'ttb' || item.dir === 'rtl') continue
    const x = tr[4], y = tr[5] - size * 0.85
    if (!bounded(x, y, width, height)) continue
    const name = item.str.replace(/\s+/g, ' ').trim().slice(0, 36)
    const family = fontFamily(content.styles?.[item.fontName ?? '']?.fontFamily)
    layers.push({
      kind: 'text',
      name: `PDF P${pageNumber} · Text: ${name}`,
      visible: false,
      text: {
        content: item.str, x, y, fontSize: size, fontFamily: family,
        color: '#000000', bold: /bold/i.test(family), italic: /italic|oblique/i.test(family),
        align: 'left', lineHeight: 1.2, tracking: 0,
      },
      metadata: { sourceFormat: 'pdf', pageNumber, editableObject: 'text', 
        originalFontName: item.fontName ?? '', approximateAppearance: true },
    })
  }
  return layers
}

export function pdfEditableVectors(
  list: PdfOperatorList, ops: PdfOps, viewport: PdfMatrix,
  width: number, height: number, pageNumber: number,
): ParsedDocumentLayer[] {
  const result: ParsedDocumentLayer[] = []
  const stack: PdfPaintState[] = []
  let state = baseState()
  const length = Math.min(list.fnArray.length, list.argsArray.length, MAX_OPS)
  for (let i = 0; i < length && result.length < MAX_VECTOR; i++) {
    const op = list.fnArray[i]
    const args = list.argsArray[i]
    if (op === ops.save) { stack.push({ ...state }); continue }
    if (op === ops.restore) { state = stack.pop() ?? baseState(); continue }
    if (op === ops.transform) {
      if (finiteMatrix(args)) state.matrix = multiply(state.matrix, args as PdfMatrix)
      else state.complex = true
      continue
    }
    if (op === ops.setLineWidth) { state.width = Math.max(0, Number(args?.[0]) || 0); continue }
    if (op === ops.setFillRGBColor || op === ops.setFillGray || op === ops.setFillCMYKColor) {
      state.fill = colorFrom(args, op === ops.setFillGray ? 'gray' : op === ops.setFillCMYKColor ? 'cmyk' : 'rgb')
      continue
    }
    if (op === ops.setStrokeRGBColor || op === ops.setStrokeGray || op === ops.setStrokeCMYKColor) {
      state.stroke = colorFrom(args, op === ops.setStrokeGray ? 'gray' : op === ops.setStrokeCMYKColor ? 'cmyk' : 'rgb')
      continue
    }
    if (op === ops.clip || op === ops.eoClip || op === ops.setGState ||
        op === ops.beginGroup) { state.complex = true; continue }
    if (op !== ops.constructPath || !Array.isArray(args) || state.complex) continue
    const [paintOp, pathData] = args
    const fill = [22, 23, 24, 25, 26, 27].includes(paintOp)
    const stroke = [20, 21, 24, 25, 26, 27].includes(paintOp)
    if (!fill && !stroke) continue
    const path = readPath(pathData?.[0], multiply(viewport, state.matrix), width, height)
    if (!path) continue
    const xs = path.anchors.map(a => a.x), ys = path.anchors.map(a => a.y)
    const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys)
    const scaleX = Math.hypot(state.matrix[0], state.matrix[1]) * Math.hypot(viewport[0], viewport[1])
    const scaleY = Math.hypot(state.matrix[2], state.matrix[3]) * Math.hypot(viewport[2], viewport[3])
    const sw = state.width * (scaleX + scaleY) / 2
    if (!Number.isFinite(sw) || sw > 2000) continue
    result.push({
      kind: 'shape',
      name: `PDF P${pageNumber} · Vector ${result.length + 1}`,
      visible: false,
      shape: {
        shape: 'path', x: minX, y: minY,
        w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY),
        radius: 0, sides: 5, starInset: 50,
        fill: fill ? state.fill : null, fillOpacity: 100,
        stroke: stroke && sw > 0 ? state.stroke : null, strokeWidth: stroke ? sw : 0,
        strokeOpacity: 100, pathAnchors: path.anchors, pathClosed: path.closed,
      },
      metadata: { sourceFormat: 'pdf', pageNumber, editableObject: 'vector', approximateAppearance: true },
    })
  }
  return result
}
