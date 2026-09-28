// Small, dependency-free ZIP reader used by dedicated document parsers.
// Supports the ZIP subset used by Sketch, XD and Krita: stored/deflated,
// single-disk archives with 32-bit sizes. Entries are bounded to avoid
// accidental zip bombs in the browser.

export interface ZipEntry {
  name: string
  data: Uint8Array
  compression: number
  uncompressedSize: number
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const MAX_ENTRIES = 20000
const MAX_ENTRY_BYTES = 512 * 1024 * 1024
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024

function u16(view: DataView, off: number): number {
  if (off < 0 || off + 2 > view.byteLength) throw new Error('Truncated ZIP')
  return view.getUint16(off, true)
}
function u32(view: DataView, off: number): number {
  if (off < 0 || off + 4 > view.byteLength) throw new Error('Truncated ZIP')
  return view.getUint32(off, true)
}

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const DS = (globalThis as any).DecompressionStream
  if (typeof DS !== 'function') throw new Error('This browser cannot inflate ZIP entries')
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DS('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = value as Uint8Array
    total += chunk.length
    if (total > Math.min(MAX_ENTRY_BYTES, Math.max(expected + 1024 * 1024, expected * 2))) {
      await reader.cancel()
      throw new Error('ZIP entry expanded beyond its declared size')
    }
    chunks.push(chunk)
  }
  const out = new Uint8Array(total)
  let p = 0
  for (const chunk of chunks) { out.set(chunk, p); p += chunk.length }
  return out
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  // ZIP legacy names are CP437. For document containers in practice names are
  // overwhelmingly ASCII; preserve bytes losslessly for the 7-bit range.
  let s = ''
  for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : '�'
  return s
}

export async function readZipEntries(bytes: Uint8Array): Promise<Map<string, ZipEntry>> {
  if (bytes.length < 22) throw new Error('Truncated ZIP archive')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  const min = Math.max(0, bytes.length - 22 - 0xffff)
  for (let p = bytes.length - 22; p >= min; p--) {
    if (u32(view, p) === SIG_EOCD) { eocd = p; break }
  }
  if (eocd < 0) throw new Error('ZIP end-of-central-directory not found')
  if (u16(view, eocd + 4) !== 0 || u16(view, eocd + 6) !== 0) {
    throw new Error('Multi-disk ZIP archives are unsupported')
  }
  const count = u16(view, eocd + 10)
  if (count > MAX_ENTRIES) throw new Error('ZIP archive has too many entries')
  let p = u32(view, eocd + 16)
  const out = new Map<string, ZipEntry>()
  let totalOutput = 0

  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(view, p) !== SIG_CENTRAL) throw new Error('Malformed ZIP central directory')
    const flags = u16(view, p + 8)
    const compression = u16(view, p + 10)
    const compressedSize = u32(view, p + 20)
    const uncompressedSize = u32(view, p + 24)
    const nameLen = u16(view, p + 28)
    const extraLen = u16(view, p + 30)
    const commentLen = u16(view, p + 32)
    const localOffset = u32(view, p + 42)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('ZIP64 entries are not supported by this parser')
    }
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error('ZIP entry is too large')
    totalOutput += uncompressedSize
    if (totalOutput > MAX_TOTAL_BYTES) throw new Error('ZIP archive expands beyond the import limit')
    if (flags & 1) throw new Error('Encrypted ZIP entries are unsupported')
    if (compression !== 0 && compression !== 8) throw new Error(`ZIP compression method ${compression} is unsupported`)
    if (p + 46 + nameLen + extraLen + commentLen > bytes.length) throw new Error('Truncated ZIP entry')
    const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), !!(flags & 0x0800))

    if (localOffset + 30 > bytes.length || u32(view, localOffset) !== SIG_LOCAL) throw new Error('Malformed ZIP local header')
    const localNameLen = u16(view, localOffset + 26)
    const localExtraLen = u16(view, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const dataEnd = dataStart + compressedSize
    if (dataEnd > bytes.length) throw new Error('Truncated ZIP entry data')
    const packed = bytes.subarray(dataStart, dataEnd)
    const data = compression === 0 ? packed.slice() : await inflateRaw(packed, uncompressedSize)
    if (data.length !== uncompressedSize) {
      // Some producers write an incorrect zero size with data descriptors; the
      // supported document formats normally do not. Reject instead of guessing.
      throw new Error(`ZIP entry ${name} expanded to an unexpected size`)
    }
    out.set(name, { name, data, compression, uncompressedSize })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

export function textEntry(entries: Map<string, ZipEntry>, name: string): string | null {
  const entry = entries.get(name)
  return entry ? new TextDecoder('utf-8', { fatal: false }).decode(entry.data) : null
}

export function jsonEntry<T = any>(entries: Map<string, ZipEntry>, name: string): T | null {
  const text = textEntry(entries, name)
  if (text == null) return null
  return JSON.parse(text) as T
}

export function findEntry(entries: Map<string, ZipEntry>, predicate: (name: string) => boolean): ZipEntry | null {
  for (const [name, entry] of entries) if (predicate(name)) return entry
  return null
}
