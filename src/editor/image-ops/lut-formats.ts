// ============================================================
// LUT file formats — readers for the three interchange formats a
// Color Lookup layer can be fed with:
//
//   .cube  Adobe / DaVinci Resolve   (see lut.ts for the reader)
//   .3dl   Autodesk Lustre / Flame    (this file)
//   .look  SpeedGrade XML             (this file)
//
// The file grammars are the published contract; the code here is ours.
//
// Two details in `.3dl` are worth calling out because they are the
// difference between "loads" and "loads correctly":
//
//  1. Node ordering. A `.3dl` lists its cube with BLUE varying fastest,
//     while our table layout is red-fastest. The reader transposes
//     while it copies instead of teaching the sampler a second
//     indexing scheme.
//
//  2. The "shaper" row. Some `.3dl` files carry a 1-D input curve
//     ahead of the cube, and Photoshop applies it to every channel
//     before the 3-D lookup. We keep that curve exact in
//     `LutDef.shaper` (see lut-core.ts) rather than baking it into the
//     cube grid — a bake would have to resample the curve onto the
//     cube's node spacing and would bend its breakpoints.
//
// Pure functions — no DOM / engine imports.
// ============================================================

import { registerCustomLut, type LutDef } from './lut-core'
import { parseCube } from './lut'

export type LutFileFormat = 'cube' | '3dl' | 'look'

/** Largest cube edge we will build a table for (≈ 6 MB of floats). */
const MAX_EDGE = 129

/**
 * Decode a LUT file's bytes to text. Some `.look` files are written as
 * UTF-16 with a byte-order mark, so the BOM is honoured before falling
 * back to UTF-8.
 */
export function decodeLutText(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2))
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2))
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * Which reader a file needs. The extension decides when it is
 * meaningful; otherwise the content is sniffed (XML → SpeedGrade, a
 * `3DMESH`/`Mesh` header → Lustre, anything else → `.cube`).
 */
export function detectLutFormat(fileName: string, bytes: Uint8Array): LutFileFormat {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.3dl')) return '3dl'
  if (lower.endsWith('.look')) return 'look'
  if (lower.endsWith('.cube')) return 'cube'
  const text = decodeLutText(bytes).trimStart()
  if (text.startsWith('<')) return 'look'
  if (/^(3DMESH\b|Mesh\s+\d+\s+\d+)/im.test(text)) return '3dl'
  return 'cube'
}

/** Read any supported LUT file and register the resulting table. */
export function parseLutFile(fileName: string, bytes: Uint8Array): LutDef {
  const format = detectLutFormat(fileName, bytes)
  const text = decodeLutText(bytes)
  const base = fileName.replace(/\.[^.]+$/, '').trim() || 'Custom LUT'
  if (format === '3dl') return parse3dl(text, base)
  if (format === 'look') return parseLook(text, base)
  return parseCube(text, base)
}

// ------------------------------------------------------------------ .3dl

const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/**
 * Whether a token reads as a floating-point number. `NaN` and `inf`
 * count: they are numbers, so a row that carries one is a node row
 * (and is then refused for being non-finite) rather than a header.
 */
function readsAsFloat(token: string): boolean {
  if (/^(?:nan|[-+]?inf(?:inity)?)$/i.test(token)) return true
  return NUMERIC.test(token)
}

/**
 * The code range a `.3dl` node table was written with, when the file
 * does not declare one.
 *
 * The table's own largest value decides: the smallest integer depth
 * that still covers it is the range the file was written on. A file
 * with a header is read on the 10-bit-or-wider scale; a headerless
 * file skips the 10-bit reading, so a table peaking at 255 or 1023
 * is read on the 12-bit scale — which is how Photoshop reads it.
 */
function inferCodeRange(max: number, hasHeader: boolean): number {
  if (max <= 1) return 1
  const depths = hasHeader ? [1023, 4095, 16383, 65535] : [4095, 16383, 65535]
  for (const d of depths) if (max <= d) return d
  return max
}

/**
 * Parse a Lustre/Flame `.3dl` table.
 *
 * Grammar accepted:
 *   - an optional `3DMESH` magic line
 *   - an optional `Mesh <inBits> <outBits>` declaration. `inBits`
 *     gives the cube edge as 2^inBits + 1; `outBits` gives the output
 *     code range as 2^outBits - 1.
 *   - an optional shaper row (two or more values on one line) ahead of
 *     the cube
 *   - the cube itself: one RGB triple per line, BLUE varying fastest
 *
 * Without a declaration the cube edge is the cube root of the row
 * count and the code range is inferred from the largest value.
 */
export function parse3dl(text: string, name: string): LutDef {
  const rows: number[][] = []
  let declared: { inBits: number; outBits: number } | null = null
  let hasHeader = false
  let shaper: number[] | null = null
  let firstWidth = 0

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim()
    if (!line) continue
    const fields = line.split(/\s+/)
    const first = fields[0]
    // A header is the `3DMESH` magic, or a word that is not a number.
    // A token that merely *starts* like a number ("0oops") is read
    // strictly instead, so a broken node row is refused rather than
    // silently skipped as a header.
    const isHeader = first.toLowerCase() === '3dmesh' || (/^[A-Za-z]/.test(first) && !readsAsFloat(first))
    if (isHeader) {
      // a header line: the `3DMESH` magic or the `Mesh` declaration
      hasHeader = true
      if (first.toLowerCase() === 'mesh' && fields.length === 3) {
        const inBits = Number(fields[1])
        const outBits = Number(fields[2])
        if (
          Number.isInteger(inBits) && Number.isInteger(outBits) &&
          inBits >= 1 && inBits <= 7 && outBits >= 1 && outBits <= 16
        ) {
          declared = { inBits, outBits }
        }
      }
      continue
    }
    // every token on a node line must be a number — a malformed one is
    // refused rather than dropped, because dropping it could turn a
    // shaper row into a plain ramp and lose it without a word
    const values = fields.map(Number)
    if (!values.every(v => Number.isFinite(v))) {
      throw new Error(`bad numeric row in .3dl: "${line}"`)
    }
    if (!firstWidth) firstWidth = values.length
    if (values.length === 3) {
      rows.push(values)
    } else if (values.length >= 2) {
      if (shaper || rows.length) throw new Error('a .3dl file may carry only one shaper row')
      shaper = values
    } else {
      // a one-value row is neither a node nor a shaper — refuse it
      // rather than dropping it, which would silently shift the table
      throw new Error(`a .3dl row must hold three node values or a shaper row: "${line}"`)
    }
  }

  let edge: number
  let nodes: number[][]
  let scale: number

  if (declared) {
    edge = 2 ** declared.inBits + 1
    const expected = edge ** 3
    nodes = rows
    if (!shaper && rows.length === expected + 1 && firstWidth === edge) {
      // One row more than the declared cube, and the first row is as
      // wide as the cube edge: that row is the shaper, not a node.
      // (Only a 3-wide cube can reach this branch, because any other
      // width was already claimed as a shaper above.)
      shaper = rows[0]
      nodes = rows.slice(1)
    }
    if (nodes.length !== expected) {
      throw new Error(`expected ${expected} rows for the declared ${edge}³ cube, found ${nodes.length}`)
    }
    let max = 0
    for (const row of nodes) for (const v of row) if (v > max) max = v
    // A declared range wins for every in-range value — including a
    // small maximum, where 1 means one step of the declared range and
    // not full output. Only a value beyond the declaration means the
    // declaration was wrong, and then the inference takes over.
    const declaredRange = 2 ** declared.outBits - 1
    scale = max > declaredRange ? inferCodeRange(max, hasHeader) : declaredRange
  } else {
    const count = rows.length
    edge = Math.round(Math.cbrt(count))
    if (edge < 2 || edge ** 3 !== count) {
      throw new Error(`${count} rows is not a cube`)
    }
    nodes = rows
    let max = 0
    for (const row of nodes) for (const v of row) if (v > max) max = v
    scale = inferCodeRange(max, hasHeader)
  }

  if (edge > MAX_EDGE) {
    throw new Error(`unsupported .3dl cube size ${edge}³ (up to ${MAX_EDGE}³ supported)`)
  }

  const table = new Float32Array(edge * edge * edge * 3)
  for (let i = 0; i < nodes.length; i++) {
    const row = nodes[i]
    // file order: blue varies fastest
    const r = Math.floor(i / (edge * edge))
    const g = Math.floor(i / edge) % edge
    const b = i % edge
    const at = ((b * edge + g) * edge + r) * 3
    table[at] = row[0] / scale
    table[at + 1] = row[1] / scale
    table[at + 2] = row[2] / scale
  }

  const lutName = (name || 'Custom LUT').trim() || 'Custom LUT'
  return registerCustomLut(table, edge, lutName, '3dl', buildShaper(shaper))
}

/**
 * Turn a `.3dl` shaper row into a normalised 0..1 curve.
 *
 * The row is a ramp of input codes. It is read on the same code range
 * as the table, and a row that is only the even ramp (the usual case)
 * is dropped: it would bend nothing.
 */
function buildShaper(shaper: number[] | null): Float32Array | undefined {
  if (!shaper || shaper.length < 2) return undefined
  let max = 0
  for (const v of shaper) if (v > max) max = v
  const scale = inferCodeRange(max, true)
  const m = shaper.length
  // an even ramp within one code is still the even ramp
  const tolerance = scale > 1 ? 1 : 1 / 1023
  let even = true
  for (let k = 0; k < m; k++) {
    if (Math.abs(shaper[k] - (scale * k) / (m - 1)) > tolerance) { even = false; break }
  }
  if (even) return undefined
  const curve = new Float32Array(m)
  for (let k = 0; k < m; k++) curve[k] = Math.min(1, Math.max(0, shaper[k] / scale))
  return curve
}

// ------------------------------------------------------------------ .look

/**
 * Parse a SpeedGrade `.look` file.
 *
 * The file is a small XML document carrying a `<size>` and a `<data>`
 * block: the table as a hex string of little-endian float32 RGB
 * triplets, red varying fastest. Some writers emit four floats per
 * entry (RGBA); the alpha is ignored.
 */
export function parseLook(text: string, name: string): LutDef {
  // comments can hold tag-like text, so drop them before looking for tags
  const clean = text.replace(/<!--[\s\S]*?-->/g, '')
  const tag = (tagName: string): string | null => {
    const open = `<${tagName}>`
    const close = `</${tagName}>`
    const start = clean.indexOf(open)
    if (start < 0) return null
    const from = start + open.length
    const end = clean.indexOf(close, from)
    if (end < 0) return null
    return clean.slice(from, end).trim().replace(/^"/, '').replace(/"$/, '').trim()
  }

  const sizeText = tag('size')
  const size = sizeText ? Number(sizeText) : 0
  if (!Number.isInteger(size) || size < 2) throw new Error('no usable <size> in .look')
  if (size > MAX_EDGE) throw new Error(`unsupported .look size ${size}³ (up to ${MAX_EDGE}³ supported)`)

  const dataText = tag('data')
  if (!dataText) throw new Error('no <data> in .look')
  const hex = dataText.replace(/\s+/g, '')
  if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Error('invalid hexadecimal <data> in .look')
  // every float needs exactly eight hex digits
  if (hex.length % 8 !== 0) throw new Error('incomplete float in .look <data>')

  const entries = size ** 3
  const floats = hex.length / 8
  const stride = floats === entries * 4 ? 4 : floats === entries * 3 ? 3 : 0
  if (!stride) {
    throw new Error(`.look holds ${floats} floats; ${entries * 3} (RGB) or ${entries * 4} (RGBA) expected`)
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  const view = new DataView(bytes.buffer)

  // `.look` lists red fastest, which is already our table order
  const table = new Float32Array(entries * 3)
  for (let i = 0; i < entries; i++) {
    const at = i * stride * 4
    table[i * 3] = view.getFloat32(at, true)
    table[i * 3 + 1] = view.getFloat32(at + 4, true)
    table[i * 3 + 2] = view.getFloat32(at + 8, true)
  }

  const title = tag('title')
  const lutName = (title || name || 'Custom LUT').trim() || 'Custom LUT'
  return registerCustomLut(table, size, lutName, 'look')
}
