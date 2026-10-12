/**
 * Photoshop image resource 1032 (0x0408): grid and guide information.
 * Pixel positions are unsigned fixed-point values in units of 1/32 px.
 * This codec deliberately preserves unmodified resource bytes, grid cycles,
 * Pascal resource names and any unknown trailing data on no-op exports.
 */
export interface PsdGuide {
  orientation: 'h' | 'v'
  pos: number
}

export const PSD_GUIDE_RESOURCE_ID = 0x0408

interface GuideResource {
  payloadStart: number
  payloadEnd: number
  gridHorizontal: number
  gridVertical: number
  guides: PsdGuide[]
}

export function isPsdGuideResource(resource: Uint8Array): boolean {
  return resource.length >= 6 &&
    (String.fromCharCode(...resource.subarray(0, 4)) === '8BIM' ||
     String.fromCharCode(...resource.subarray(0, 4)) === 'MeSa') &&
    ((resource[4] << 8) | resource[5]) === PSD_GUIDE_RESOURCE_ID
}

function parseGuideResource(resource: Uint8Array): GuideResource | null {
  if (!isPsdGuideResource(resource) || resource.length < 12) return null
  const view = new DataView(resource.buffer, resource.byteOffset, resource.byteLength)
  const nameStart = 6
  const nameBytes = (resource[nameStart] + 2) & ~1
  const lengthOffset = nameStart + nameBytes
  if (lengthOffset + 4 > resource.length) return null
  const payloadSize = view.getUint32(lengthOffset)
  const payloadStart = lengthOffset + 4
  const payloadEnd = payloadStart + payloadSize
  if (payloadSize < 16 || payloadEnd > resource.length ||
      payloadEnd + (payloadSize & 1) !== resource.length) return null
  if (view.getUint32(payloadStart) !== 1) return null
  const count = view.getUint32(payloadStart + 12)
  if (count > Math.floor((payloadSize - 16) / 5) || count > 100000) return null
  const guides: PsdGuide[] = []
  for (let index = 0; index < count; index++) {
    const at = payloadStart + 16 + index * 5
    const direction = resource[at + 4]
    if (direction !== 0 && direction !== 1) return null
    guides.push({
      orientation: direction === 0 ? 'v' : 'h',
      pos: view.getUint32(at) / 32,
    })
  }
  return {
    payloadStart, payloadEnd,
    gridHorizontal: view.getUint32(payloadStart + 4),
    gridVertical: view.getUint32(payloadStart + 8),
    guides,
  }
}

/** Decode valid Photoshop guides; malformed/unknown resources stay opaque. */
export function readPsdGuides(resources: readonly Uint8Array[]): PsdGuide[] {
  for (const resource of resources) {
    if (!isPsdGuideResource(resource)) continue
    const parsed = parseGuideResource(resource)
    if (parsed) return parsed.guides
  }
  return []
}

function encodeGuidePosition(guide: PsdGuide): number {
  if ((guide.orientation !== 'h' && guide.orientation !== 'v') ||
      !Number.isFinite(guide.pos) || guide.pos < 0 ||
      guide.pos > 0xffffffff / 32) {
    throw new Error('Photoshop guide positions must be finite nonnegative document coordinates')
  }
  return Math.round(guide.pos * 32)
}

function matchesExisting(parsed: GuideResource, resource: Uint8Array, guides: readonly PsdGuide[]): boolean {
  if (parsed.guides.length !== guides.length) return false
  const dv = new DataView(resource.buffer, resource.byteOffset, resource.byteLength)
  return guides.every((guide, index) =>
    (guide.orientation === 'h' || guide.orientation === 'v') &&
    guide.orientation === parsed.guides[index].orientation &&
    Number.isFinite(guide.pos) &&
    Math.abs(guide.pos * 32 - dv.getUint32(parsed.payloadStart + 16 + index * 5)) < 1e-7
  )
}

/**
 * Update just resource 1032. Unmodified guides return their exact original
 * resource bytes (including grid configuration and unknown fields).
 * If an existing resource is malformed or ambiguous, never silently replace it.
 */
export function writePsdGuides(
  resources: readonly Uint8Array[], guides: readonly PsdGuide[],
): Uint8Array[] {
  const input = [...resources]
  const indices = input.flatMap((resource, index) => isPsdGuideResource(resource) ? [index] : [])
  const original = indices.length === 1 ? input[indices[0]] : undefined
  const parsed = original ? parseGuideResource(original) : null
  if (!indices.length && !guides.length) return input
  if (indices.length === 1 && parsed && matchesExisting(parsed, original!, guides)) return input
  if (indices.length && (!parsed || indices.length !== 1)) {
    throw new Error('Cannot edit malformed or duplicate Photoshop guide resources without losing original metadata')
  }
  if (parsed && parsed.payloadEnd - parsed.payloadStart !== 16 + parsed.guides.length * 5) {
    throw new Error('Cannot edit Photoshop guides with unknown trailing metadata; original resource is preserved')
  }
  const positions = guides.map(encodeGuidePosition)
  if (guides.length > 100000) throw new Error('Too many Photoshop guides')
  const payloadSize = 16 + guides.length * 5
  const namePrefix = original ? original.slice(0, parsed!.payloadStart - 4) :
    Uint8Array.from([56, 66, 73, 77, 4, 8, 0, 0])
  const out = new Uint8Array(namePrefix.length + 4 + payloadSize + (payloadSize & 1))
  out.set(namePrefix)
  const dv = new DataView(out.buffer)
  dv.setUint32(namePrefix.length, payloadSize)
  const at = namePrefix.length + 4
  dv.setUint32(at, 1)
  dv.setUint32(at + 4, parsed?.gridHorizontal ?? 576)
  dv.setUint32(at + 8, parsed?.gridVertical ?? 576)
  dv.setUint32(at + 12, guides.length)
  for (let index = 0; index < guides.length; index++) {
    const p = at + 16 + index * 5
    dv.setUint32(p, positions[index])
    out[p + 4] = guides[index].orientation === 'h' ? 1 : 0
  }
  if (!original) return [...input, out]
  input[indices[0]] = out
  return input
}
