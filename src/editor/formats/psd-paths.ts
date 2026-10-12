/**
 * Adobe Photoshop path information resources 2000–2997. Only a single
 * ordinary open/closed Bézier subpath is converted to Studio's SavedPath
 * model; compound, clipboard, work-path and unfamiliar metadata stay opaque.
 *
 * Adobe stores each 26-byte knot as [selector, in(Y,X), anchor(Y,X), out(Y,X)]
 * with signed 8.24 coordinates normalized to document height/width.
 */
import type { PathAnchor, SavedPath } from '../types'

const MIN_PATH_RESOURCE = 2000
const MAX_PATH_RESOURCE = 2997
const RECORD_SIZE = 26
const FIXED_SCALE = 16777216

export interface PsdPath extends Omit<SavedPath, 'id'> {
  psdPathResourceId: number
}
interface ParsedPathResource {
  id: number
  name: string
  nameEnd: number
  knots: PathAnchor[]
  closed: boolean
}

function pathId(bytes: Uint8Array): number {
  if (bytes.length < 6 ||
      bytes[0] !== 56 || bytes[1] !== 66 || bytes[2] !== 73 || bytes[3] !== 77) return -1
  return (bytes[4] << 8) | bytes[5]
}

function isSavedPathResource(bytes: Uint8Array): boolean {
  const id = pathId(bytes)
  return id >= MIN_PATH_RESOURCE && id <= MAX_PATH_RESOURCE
}

function parsePath(resource: Uint8Array, width: number, height: number): ParsedPathResource | null {
  if (!isSavedPathResource(resource) || resource.length < 12 ||
      !Number.isSafeInteger(width) || width <= 0 ||
      !Number.isSafeInteger(height) || height <= 0) return null
  const nameLen = resource[6]
  const nameBytes = (nameLen + 2) & ~1
  const lengthAt = 6 + nameBytes
  if (lengthAt + 4 > resource.length) return null
  const dv = new DataView(resource.buffer, resource.byteOffset, resource.byteLength)
  const size = dv.getUint32(lengthAt)
  const dataStart = lengthAt + 4
  if (!size || size % RECORD_SIZE !== 0 || dataStart + size + (size & 1) !== resource.length) return null
  // Photoshop's path-name Pascal string can use legacy MacRoman encodings,
  // with optional Unicode descriptors elsewhere. Avoid presenting mojibake as
  // editable path names; preserve unrecognized non-ASCII resources verbatim.
  const nameBytes = resource.subarray(7, 7 + nameLen)
  if (nameBytes.some(byte => byte < 0x20 || byte > 0x7e)) return null
  const name = String.fromCharCode(...nameBytes)
  const recordCount = size / RECORD_SIZE
  if (recordCount > 100000) return null
  let at = dataStart
  const firstSelector = dv.getUint16(at)
  if (firstSelector !== 6 || resource.subarray(at + 2, at + RECORD_SIZE).some(b => b !== 0)) return null
  at += RECORD_SIZE
  let remaining = recordCount - 1
  // Support the canonical optional initial-fill record, but not a filled
  // canvas (fill==1) because Studio's native paths cannot represent that.
  if (remaining && dv.getUint16(at) === 8) {
    if (dv.getUint16(at + 2) !== 0 ||
        resource.subarray(at + 4, at + RECORD_SIZE).some(b => b !== 0)) return null
    at += RECORD_SIZE
    remaining--
  }
  if (!remaining) return null
  const selector = dv.getUint16(at)
  if (selector !== 0 && selector !== 3) return null
  const closed = selector === 0
  const count = dv.getUint16(at + 2)
  if (count < 2 || remaining !== count + 1 ||
      resource.subarray(at + 4, at + RECORD_SIZE).some(b => b !== 0)) return null
  at += RECORD_SIZE
  const anchors: PathAnchor[] = []
  const readCoord = (offset: number, factor: number) => dv.getInt32(offset) / FIXED_SCALE * factor
  for (let i = 0; i < count; i++, at += RECORD_SIZE) {
    const type = dv.getUint16(at)
    if (type !== (closed ? 1 : 4) && type !== (closed ? 2 : 5)) return null
    const y = readCoord(at + 10, height)
    const x = readCoord(at + 14, width)
    // Photoshop writes ABSOLUTE Bézier control points. Studio's PathAnchor
    // stores RELATIVE handle offsets and its renderer adds x/y at draw time.
    const anchor: PathAnchor = {
      x, y,
      inX: readCoord(at + 6, width) - x,
      inY: readCoord(at + 2, height) - y,
      outX: readCoord(at + 22, width) - x,
      outY: readCoord(at + 18, height) - y,
      pair: type === (closed ? 1 : 4),
    }
    if (Object.values(anchor).some(v => typeof v === 'number' && !Number.isFinite(v))) return null
    anchors.push(anchor)
  }
  return { id: pathId(resource), name, nameEnd: dataStart, knots: anchors, closed }
}

export function readPsdPaths(resources: readonly Uint8Array[], width: number, height: number): PsdPath[] {
  const paths: PsdPath[] = []
  // Duplicate IDs are ambiguous even if both copies decode cleanly. Never
  // surface either copy as an editable path; preserve both source records.
  const idCounts = new Map<number, number>()
  for (const resource of resources) {
    if (!isSavedPathResource(resource)) continue
    const id = pathId(resource)
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  }
  for (const resource of resources) {
    const parsed = parsePath(resource, width, height)
    if (!parsed || idCounts.get(parsed.id) !== 1) continue
    paths.push({
      psdPathResourceId: parsed.id, name: parsed.name || 'Path',
      anchors: parsed.knots, closed: parsed.closed, visible: true,
    })
  }
  return paths
}

function fixed(value: number, dimension: number): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(dimension) || dimension <= 0) {
    throw new Error('Invalid Photoshop path coordinate or canvas dimensions')
  }
  const raw = Math.round(value / dimension * FIXED_SCALE)
  if (raw < -0x80000000 || raw > 0x7fffffff) {
    throw new Error('Photoshop path coordinate exceeds signed 8.24 range')
  }
  return raw
}

function samePath(original: ParsedPathResource, path: PsdPath | SavedPath, width: number, height: number): boolean {
  if ((original.name || 'Path') !== path.name || original.closed !== path.closed ||
      original.knots.length !== path.anchors.length) return false
  return path.anchors.every((a, i) => {
    const b = original.knots[i]
    try {
      return a.pair === b.pair &&
        fixed(a.x, width) === fixed(b.x, width) && fixed(a.y, height) === fixed(b.y, height) &&
        fixed(a.x + a.inX, width) === fixed(b.x + b.inX, width) &&
        fixed(a.y + a.inY, height) === fixed(b.y + b.inY, height) &&
        fixed(a.x + a.outX, width) === fixed(b.x + b.outX, width) &&
        fixed(a.y + a.outY, height) === fixed(b.y + b.outY, height)
    } catch {
      return false
    }
  })
}

function encodePath(path: PsdPath | SavedPath, id: number, width: number, height: number): Uint8Array {
  if (!path.name || /[^\x20-\x7e]/.test(path.name) || path.name.length > 255) {
    throw new Error('Edited Photoshop path names currently require 1–255 printable ASCII characters')
  }
  if (path.anchors.length < 2 || path.anchors.length > 65535) {
    throw new Error('Photoshop path needs between 2 and 65535 Bézier anchors')
  }
  const pascalNameBytes = (path.name.length + 2) & ~1
  const recordCount = 2 + path.anchors.length
  const payloadLength = recordCount * RECORD_SIZE
  const out = new Uint8Array(6 + pascalNameBytes + 4 + payloadLength)
  const dv = new DataView(out.buffer)
  out.set([56, 66, 73, 77], 0)
  dv.setUint16(4, id)
  out[6] = path.name.length
  for (let i = 0; i < path.name.length; i++) out[7 + i] = path.name.charCodeAt(i)
  const data = 6 + pascalNameBytes
  dv.setUint32(data, payloadLength)
  let at = data + 4
  dv.setUint16(at, 6)
  at += RECORD_SIZE
  dv.setUint16(at, path.closed ? 0 : 3)
  dv.setUint16(at + 2, path.anchors.length)
  at += RECORD_SIZE
  for (const a of path.anchors) {
    dv.setUint16(at, path.closed ? (a.pair ? 1 : 2) : (a.pair ? 4 : 5))
    const coords: Array<[number, number]> = [
      [a.y + a.inY, a.x + a.inX], [a.y, a.x],
      [a.y + a.outY, a.x + a.outX],
    ]
    for (let i = 0; i < 3; i++) {
      dv.setInt32(at + 2 + i * 8, fixed(coords[i][0], height))
      dv.setInt32(at + 6 + i * 8, fixed(coords[i][1], width))
    }
    at += RECORD_SIZE
  }
  return out
}

/**
 * Sync Studio paths with Photoshop path resources.
 *
 * Only imported, recognized IDs are eligible for deletion/replacement.
 * Unknown, compound or duplicate Photoshop path resources are never touched.
 * New Studio paths receive unused IDs in Adobe's saved-path resource range.
 */
export function writePsdPaths(
  resources: readonly Uint8Array[],
  paths: readonly (SavedPath & { psdPathResourceId?: number })[],
  importedEditableIds: readonly number[],
  width: number, height: number,
): Uint8Array[] {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new Error('Invalid Photoshop document dimensions')
  }
  const result = [...resources]
  const allOriginal = new Map<number, number[]>()
  result.forEach((block, i) => {
    const id = pathId(block)
    if (id >= MIN_PATH_RESOURCE && id <= MAX_PATH_RESOURCE) {
      allOriginal.set(id, [...(allOriginal.get(id) ?? []), i])
    }
  })
  const imported = new Set(importedEditableIds)
  const claimed = new Set<number>()
  const replacements = new Map<number, Uint8Array>()
  const remove = new Set<number>()
  const additions: Uint8Array[] = []
  for (const p of paths) {
    let id = p.psdPathResourceId
    if (id !== undefined) {
      if (!Number.isInteger(id) || id < MIN_PATH_RESOURCE || id > MAX_PATH_RESOURCE || claimed.has(id)) {
        throw new Error('Invalid or duplicate Photoshop path resource ID')
      }
      const positions = allOriginal.get(id) ?? []
      if (positions.length > 1 || (positions.length && !imported.has(id))) {
        throw new Error('Cannot replace an unsupported or duplicate Photoshop path resource')
      }
    } else {
      id = -1
      for (let candidate = MIN_PATH_RESOURCE; candidate <= MAX_PATH_RESOURCE; candidate++) {
        if (!allOriginal.has(candidate) && !claimed.has(candidate)) { id = candidate; break }
      }
      if (id === -1) throw new Error('Photoshop saved-path resource IDs are exhausted')
    }
    claimed.add(id)
    const indices = allOriginal.get(id) ?? []
    const source = indices.length ? result[indices[0]] : undefined
    const parsed = source ? parsePath(source, width, height) : null
    if (source && (!parsed || !imported.has(id))) throw new Error('Source Photoshop path cannot be edited safely')
    if (parsed && samePath(parsed, p, width, height)) continue
    const encoded = encodePath(p, id, width, height)
    if (indices.length) replacements.set(indices[0], encoded)
    else additions.push(encoded)
  }
  for (const id of imported) {
    if (claimed.has(id)) continue
    for (const index of allOriginal.get(id) ?? []) {
      // Only imported editable records may be deleted. Never erase an
      // unsupported or newly introduced opaque original by coincidence.
      if (parsePath(result[index], width, height)) remove.add(index)
    }
  }
  return [...result.flatMap((b, i) => remove.has(i) ? [] : [replacements.get(i) ?? b]), ...additions]
}
