// ============================================================
// Photoshop Action Descriptor — the binary value structure that
// Photoshop uses for action parameters.
//
// Everything is big-endian.
//
//   descriptor := name UnicodeString, class id Id, item count u32,
//                 count × (key Id, value)
//   Id         := u32 length; 0 → a 4-byte code follows, otherwise
//                 `length` bytes of text
//   UnicodeString := u32 code-unit count, then that many UTF-16BE units
//
// A value is a 4-byte OSType followed by its payload. The types are
// listed in `AtnValue` below.
//
// The reader keeps everything it read — including whether an id was
// stored as a 4-byte code or as a length-prefixed string, and
// whether a Unicode string carried a trailing NUL — so a file that
// is read and written again comes out byte for byte the same.
//
// Written from the published "Photoshop File Formats" descriptor
// structure and the observable behaviour of files Photoshop writes.
// ============================================================

/** Maximum nesting accepted when reading (a malformed file must not recurse forever). */
export const ATN_MAX_DEPTH = 64

/** Largest number of items a single list or descriptor may declare. */
export const ATN_MAX_ITEMS = 1_000_000

// ---------------------------------------------------------------- ids

/**
 * A class, key or type identifier.
 *
 * Photoshop writes most ids as a 4-character code (stored as a zero
 * length followed by four bytes) and the rest as a length-prefixed
 * string. The two forms are *different keys* to Photoshop, so the
 * distinction is kept.
 */
export interface AtnId {
  /** The id's bytes, read as Latin-1 so every byte survives. */
  text: string
  /** `true` when the id is stored as a 4-byte code. */
  code: boolean
}

/**
 * These four-character names are written by Photoshop as
 * length-prefixed strings, never as codes. Treating them as codes
 * would change the key Photoshop looks for.
 */
const STRING_IDS = new Set(['warp', 'list', 'time'])

/** Builds an id from text, choosing the form Photoshop would use. */
export function atnId(text: string): AtnId {
  const isCode = text.length === 4 && !STRING_IDS.has(text)
  return { text, code: isCode }
}

/** `true` when the id's bytes are `text`. */
export function atnIdIs(id: AtnId | undefined, text: string): boolean {
  return !!id && id.text === text
}

// ---------------------------------------------------------------- strings

/**
 * A Photoshop Unicode string: UTF-16 code units, kept exactly.
 *
 * The code units are kept rather than a JavaScript string so that
 * trailing NULs and unpaired surrogates survive a read/write cycle.
 */
export interface AtnUnicode {
  units: number[]
}

/** A Unicode string from text, without a trailing NUL. */
export function atnUnicode(text: string): AtnUnicode {
  const units: number[] = []
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    units.push(code)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        units.push(next)
        i++
      }
    }
  }
  return { units }
}

/** A Unicode string from text, with the trailing NUL Photoshop often writes. */
export function atnUnicodeNul(text: string): AtnUnicode {
  const units = atnUnicode(text).units
  units.push(0)
  return { units }
}

/** The text of a Unicode string, without its trailing NULs. */
export function atnUnicodeText(u: AtnUnicode | undefined): string {
  if (!u) return ''
  let end = u.units.length
  while (end > 0 && u.units[end - 1] === 0) end--
  let out = ''
  for (let i = 0; i < end; i++) {
    const code = u.units[i]
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < end) {
      const next = u.units[i + 1]
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += String.fromCharCode(code, next)
        i++
        continue
      }
    }
    out += String.fromCharCode(code)
  }
  return out
}

// ---------------------------------------------------------------- classes

/** A class reference: a display name and a class id. */
export interface AtnClass {
  name: AtnUnicode
  id: AtnId
}

// ---------------------------------------------------------------- values

/** A reference inside an `obj ` value. */
export type AtnReference =
  | { type: 'property'; cls: AtnClass; key: AtnId }
  | { type: 'class'; cls: AtnClass }
  | { type: 'enumerated'; cls: AtnClass; typeId: AtnId; value: AtnId }
  | { type: 'offset'; cls: AtnClass; offset: number }
  | { type: 'identifier'; cls: AtnClass; id: number }
  | { type: 'index'; cls: AtnClass; index: number }
  | { type: 'name'; cls: AtnClass; name: AtnUnicode }

/** A descriptor value. */
export type AtnValue =
  | { type: 'reference'; items: AtnReference[] }
  | { type: 'descriptor'; descriptor: AtnDescriptor }
  | { type: 'globalObject'; descriptor: AtnDescriptor }
  | { type: 'list'; items: AtnValue[] }
  | { type: 'double'; value: number }
  | { type: 'unitFloat'; unit: string; value: number }
  | { type: 'unitFloats'; unit: string; values: number[] }
  | { type: 'text'; value: AtnUnicode }
  | { type: 'enum'; typeId: AtnId; value: AtnId }
  | { type: 'integer'; value: number }
  | { type: 'largeInteger'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'class'; cls: AtnClass }
  | { type: 'globalClass'; cls: AtnClass }
  | { type: 'alias'; bytes: Uint8Array }
  | { type: 'path'; bytes: Uint8Array }
  | { type: 'rawData'; bytes: Uint8Array }
  | { type: 'objectArray'; prefix: number; body: AtnDescriptor }

/** One key/value pair of a descriptor, in stored order. */
export interface AtnDescriptorItem {
  key: AtnId
  value: AtnValue
}

/** An Action Descriptor: a class plus ordered key/value items. */
export interface AtnDescriptor {
  /** Display name of the class (often empty). */
  name: AtnUnicode
  /** Class id. */
  classId: AtnId
  /** Items in stored order. */
  items: AtnDescriptorItem[]
}

/** An empty descriptor of the given class. */
export function atnDescriptor(classId: string, name = ''): AtnDescriptor {
  return { name: atnUnicode(name), classId: atnId(classId), items: [] }
}

/** The first item with the given key. */
export function atnGet(descriptor: AtnDescriptor | undefined, key: string): AtnValue | undefined {
  if (!descriptor) return undefined
  for (const item of descriptor.items) if (atnIdIs(item.key, key)) return item.value
  return undefined
}

/** Every item with the given key. */
export function atnGetAll(descriptor: AtnDescriptor | undefined, key: string): AtnValue[] {
  if (!descriptor) return []
  const out: AtnValue[] = []
  for (const item of descriptor.items) if (atnIdIs(item.key, key)) out.push(item.value)
  return out
}

/** The number a value carries, when it carries one. */
export function atnNumber(value: AtnValue | undefined): number | undefined {
  if (!value) return undefined
  switch (value.type) {
    case 'double':
    case 'unitFloat':
    case 'integer':
    case 'largeInteger':
      return value.value
    case 'boolean':
      return value.value ? 1 : 0
    default:
      return undefined
  }
}

/** The text a value carries, when it carries text. */
export function atnText(value: AtnValue | undefined): string | undefined {
  if (!value) return undefined
  if (value.type === 'text') return atnUnicodeText(value.value)
  if (value.type === 'enum') return value.value.text
  if (value.type === 'unitFloat' || value.type === 'double') return String(value.value)
  return undefined
}

/** The boolean a value carries, when it carries one. */
export function atnBool(value: AtnValue | undefined): boolean | undefined {
  if (!value) return undefined
  if (value.type === 'boolean') return value.value
  if (value.type === 'integer') return value.value !== 0
  return undefined
}

// ---------------------------------------------------------------- bytes

/** A big-endian byte reader with bounds checks. */
export class AtnReader {
  private pos = 0
  private readonly data: Uint8Array
  constructor(data: Uint8Array) { this.data = data }

  get offset(): number { return this.pos }
  get remaining(): number { return this.data.length - this.pos }
  get done(): boolean { return this.pos >= this.data.length }

  private need(n: number, what: string): void {
    if (n < 0 || this.pos + n > this.data.length) {
      throw new Error(`truncated .atn data while reading ${what}`)
    }
  }

  u8(what = 'a byte'): number {
    this.need(1, what)
    return this.data[this.pos++]
  }

  u16(what = 'a u16'): number {
    this.need(2, what)
    const v = (this.data[this.pos] << 8) | this.data[this.pos + 1]
    this.pos += 2
    return v
  }

  u32(what = 'a u32'): number {
    this.need(4, what)
    const v = this.data[this.pos] * 0x1000000 + (this.data[this.pos + 1] << 16) +
      (this.data[this.pos + 2] << 8) + this.data[this.pos + 3]
    this.pos += 4
    return v >>> 0
  }

  i32(what = 'an i32'): number {
    this.need(4, what)
    const v = (this.data[this.pos] << 24) | (this.data[this.pos + 1] << 16) |
      (this.data[this.pos + 2] << 8) | this.data[this.pos + 3]
    this.pos += 4
    return v
  }

  i64(what = 'an i64'): number {
    const hi = this.i32(what)
    const lo = this.u32(what)
    return hi * 0x100000000 + lo
  }

  f64(what = 'a double'): number {
    this.need(8, what)
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 8)
    this.pos += 8
    return view.getFloat64(0, false)
  }

  bytes(n: number, what = 'bytes'): Uint8Array {
    this.need(n, what)
    const out = this.data.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }

  ascii(n: number, what = 'a name'): string {
    return latin1ToText(this.bytes(n, what))
  }
}

/** A big-endian byte writer. */
export class AtnWriter {
  private chunks: number[] = []
  get length(): number { return this.chunks.length }

  u8(v: number): void { this.chunks.push(v & 0xff) }
  u16(v: number): void { this.u8((v >>> 8) & 0xff); this.u8(v & 0xff) }
  u32(v: number): void {
    const n = v >>> 0
    this.u8((n >>> 24) & 0xff)
    this.u8((n >>> 16) & 0xff)
    this.u8((n >>> 8) & 0xff)
    this.u8(n & 0xff)
  }
  i32(v: number): void {
    this.u8((v >>> 24) & 0xff)
    this.u8((v >>> 16) & 0xff)
    this.u8((v >>> 8) & 0xff)
    this.u8(v & 0xff)
  }
  i64(v: number): void {
    const n = Math.trunc(v)
    this.i32(Math.floor(n / 0x100000000))
    this.u32(n >>> 0)
  }
  f64(v: number): void {
    const buf = new ArrayBuffer(8)
    new DataView(buf).setFloat64(0, v, false)
    const view = new Uint8Array(buf)
    for (let i = 0; i < 8; i++) this.u8(view[i])
  }
  raw(bytes: Uint8Array): void { for (const b of bytes) this.u8(b) }
  ascii(text: string): void { for (const b of textToLatin1(text)) this.u8(b) }
  finish(): Uint8Array { return Uint8Array.from(this.chunks) }
}

/** Latin-1 text → bytes (one byte per code point, 0–255). */
export function textToLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

/** Bytes → Latin-1 text (every byte survives). */
export function latin1ToText(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += String.fromCharCode(b)
  return out
}

// ---------------------------------------------------------------- reading

/** Reads a Unicode string. */
export function readAtnUnicode(r: AtnReader): AtnUnicode {
  const count = r.u32('a string length')
  if (count > r.remaining / 2 + 1) throw new Error('a .atn string is longer than the file')
  const units: number[] = new Array(count)
  for (let i = 0; i < count; i++) units[i] = r.u16('a string unit')
  return { units }
}

/** Writes a Unicode string. */
export function writeAtnUnicode(w: AtnWriter, u: AtnUnicode): void {
  w.u32(u.units.length)
  for (const unit of u.units) w.u16(unit)
}

/** Reads an id. */
export function readAtnId(r: AtnReader): AtnId {
  const n = r.u32('an id length')
  if (n === 0) {
    const bytes = r.bytes(4, 'an id code')
    return { text: latin1ToText(bytes), code: true }
  }
  if (n > r.remaining) throw new Error('an .atn id is longer than the file')
  return { text: latin1ToText(r.bytes(n, 'an id')), code: false }
}

/** Writes an id. */
export function writeAtnId(w: AtnWriter, id: AtnId): void {
  if (id.code) {
    w.u32(0)
    w.ascii(id.text.slice(0, 4).padEnd(4, ' '))
  } else {
    const bytes = textToLatin1(id.text)
    w.u32(bytes.length)
    w.raw(bytes)
  }
}

/** Reads a class reference. */
export function readAtnClass(r: AtnReader): AtnClass {
  return { name: readAtnUnicode(r), id: readAtnId(r) }
}

/** Writes a class reference. */
export function writeAtnClass(w: AtnWriter, cls: AtnClass): void {
  writeAtnUnicode(w, cls.name)
  writeAtnId(w, cls.id)
}

/** Reads a descriptor. */
export function readAtnDescriptor(r: AtnReader, depth = 0): AtnDescriptor {
  if (depth > ATN_MAX_DEPTH) throw new Error('a .atn descriptor is nested too deeply')
  const name = readAtnUnicode(r)
  const classId = readAtnId(r)
  const count = r.u32('a descriptor item count')
  if (count > ATN_MAX_ITEMS) throw new Error('a .atn descriptor declares too many items')
  const items: AtnDescriptorItem[] = []
  for (let i = 0; i < count; i++) {
    const key = readAtnId(r)
    const value = readAtnValue(r, depth + 1)
    items.push({ key, value })
  }
  return { name, classId, items }
}

/** Writes a descriptor. */
export function writeAtnDescriptor(w: AtnWriter, d: AtnDescriptor): void {
  writeAtnUnicode(w, d.name)
  writeAtnId(w, d.classId)
  w.u32(d.items.length)
  for (const item of d.items) {
    writeAtnId(w, item.key)
    writeAtnValue(w, item.value)
  }
}

/** Reads a value. */
export function readAtnValue(r: AtnReader, depth = 0): AtnValue {
  if (depth > ATN_MAX_DEPTH) throw new Error('a .atn value is nested too deeply')
  const type = r.ascii(4, 'a value type')
  switch (type) {
    case 'obj ': {
      const count = r.u32('a reference count')
      if (count > ATN_MAX_ITEMS) throw new Error('a .atn reference list declares too many items')
      const items: AtnReference[] = []
      for (let i = 0; i < count; i++) items.push(readAtnReference(r))
      return { type: 'reference', items }
    }
    case 'Objc':
      return { type: 'descriptor', descriptor: readAtnDescriptor(r, depth + 1) }
    case 'GlbO':
      return { type: 'globalObject', descriptor: readAtnDescriptor(r, depth + 1) }
    case 'VlLs': {
      const count = r.u32('a list count')
      if (count > ATN_MAX_ITEMS) throw new Error('a .atn list declares too many items')
      const items: AtnValue[] = []
      for (let i = 0; i < count; i++) items.push(readAtnValue(r, depth + 1))
      return { type: 'list', items }
    }
    case 'doub':
      return { type: 'double', value: r.f64('a double') }
    case 'UntF':
      return { type: 'unitFloat', unit: r.ascii(4, 'a unit'), value: r.f64('a unit value') }
    case 'UnFl': {
      const unit = r.ascii(4, 'a unit')
      const count = r.u32('a unit array count')
      if (count > ATN_MAX_ITEMS) throw new Error('a .atn unit array declares too many items')
      const values: number[] = []
      for (let i = 0; i < count; i++) values.push(r.f64('a unit value'))
      return { type: 'unitFloats', unit, values }
    }
    case 'TEXT':
      return { type: 'text', value: readAtnUnicode(r) }
    case 'enum':
      return { type: 'enum', typeId: readAtnId(r), value: readAtnId(r) }
    case 'long':
      return { type: 'integer', value: r.i32('an integer') }
    case 'comp':
      return { type: 'largeInteger', value: r.i64('a large integer') }
    case 'bool':
      return { type: 'boolean', value: r.u8('a boolean') !== 0 }
    case 'type':
      return { type: 'class', cls: readAtnClass(r) }
    case 'GlbC':
      return { type: 'globalClass', cls: readAtnClass(r) }
    case 'alis':
      return { type: 'alias', bytes: readAtnBlob(r, 'an alias') }
    case 'Pth ':
      return { type: 'path', bytes: readAtnBlob(r, 'a path') }
    case 'tdta':
      return { type: 'rawData', bytes: readAtnBlob(r, 'raw data') }
    case 'ObAr': {
      const prefix = r.u32('an object array prefix')
      return { type: 'objectArray', prefix, body: readAtnDescriptor(r, depth + 1) }
    }
    default:
      throw new Error(`unsupported .atn value type "${type}"`)
  }
}

/** Reads a length-prefixed blob. */
export function readAtnBlob(r: AtnReader, what: string): Uint8Array {
  const n = r.u32(`${what} length`)
  if (n > r.remaining) throw new Error(`a .atn ${what} is longer than the file`)
  return r.bytes(n, what).slice()
}

/** Writes a value. */
export function writeAtnValue(w: AtnWriter, v: AtnValue): void {
  switch (v.type) {
    case 'reference':
      w.ascii('obj ')
      w.u32(v.items.length)
      for (const item of v.items) writeAtnReference(w, item)
      break
    case 'descriptor':
      w.ascii('Objc')
      writeAtnDescriptor(w, v.descriptor)
      break
    case 'globalObject':
      w.ascii('GlbO')
      writeAtnDescriptor(w, v.descriptor)
      break
    case 'list':
      w.ascii('VlLs')
      w.u32(v.items.length)
      for (const item of v.items) writeAtnValue(w, item)
      break
    case 'double':
      w.ascii('doub')
      w.f64(v.value)
      break
    case 'unitFloat':
      w.ascii('UntF')
      w.ascii(v.unit)
      w.f64(v.value)
      break
    case 'unitFloats':
      w.ascii('UnFl')
      w.ascii(v.unit)
      w.u32(v.values.length)
      for (const value of v.values) w.f64(value)
      break
    case 'text':
      w.ascii('TEXT')
      writeAtnUnicode(w, v.value)
      break
    case 'enum':
      w.ascii('enum')
      writeAtnId(w, v.typeId)
      writeAtnId(w, v.value)
      break
    case 'integer':
      w.ascii('long')
      w.i32(v.value)
      break
    case 'largeInteger':
      w.ascii('comp')
      w.i64(v.value)
      break
    case 'boolean':
      w.ascii('bool')
      w.u8(v.value ? 1 : 0)
      break
    case 'class':
      w.ascii('type')
      writeAtnClass(w, v.cls)
      break
    case 'globalClass':
      w.ascii('GlbC')
      writeAtnClass(w, v.cls)
      break
    case 'alias':
      w.ascii('alis')
      w.u32(v.bytes.length)
      w.raw(v.bytes)
      break
    case 'path':
      w.ascii('Pth ')
      w.u32(v.bytes.length)
      w.raw(v.bytes)
      break
    case 'rawData':
      w.ascii('tdta')
      w.u32(v.bytes.length)
      w.raw(v.bytes)
      break
    case 'objectArray':
      w.ascii('ObAr')
      w.u32(v.prefix)
      writeAtnDescriptor(w, v.body)
      break
    default:
      throw new Error(`a .atn value of type "${(v as { type: string }).type}" cannot be written`)
  }
}

/** Reads one reference of an `obj ` value. */
export function readAtnReference(r: AtnReader): AtnReference {
  const type = r.ascii(4, 'a reference type')
  switch (type) {
    case 'prop':
      return { type: 'property', cls: readAtnClass(r), key: readAtnId(r) }
    case 'Clss':
      return { type: 'class', cls: readAtnClass(r) }
    case 'Enmr':
      return { type: 'enumerated', cls: readAtnClass(r), typeId: readAtnId(r), value: readAtnId(r) }
    case 'rele':
      return { type: 'offset', cls: readAtnClass(r), offset: r.i32('an offset') }
    case 'Idnt':
      return { type: 'identifier', cls: readAtnClass(r), id: r.u32('an identifier') }
    case 'indx':
      return { type: 'index', cls: readAtnClass(r), index: r.u32('an index') }
    case 'name':
      return { type: 'name', cls: readAtnClass(r), name: readAtnUnicode(r) }
    default:
      throw new Error(`unsupported .atn reference type "${type}"`)
  }
}

/** Writes one reference of an `obj ` value. */
export function writeAtnReference(w: AtnWriter, ref: AtnReference): void {
  switch (ref.type) {
    case 'property':
      w.ascii('prop')
      writeAtnClass(w, ref.cls)
      writeAtnId(w, ref.key)
      break
    case 'class':
      w.ascii('Clss')
      writeAtnClass(w, ref.cls)
      break
    case 'enumerated':
      w.ascii('Enmr')
      writeAtnClass(w, ref.cls)
      writeAtnId(w, ref.typeId)
      writeAtnId(w, ref.value)
      break
    case 'offset':
      w.ascii('rele')
      writeAtnClass(w, ref.cls)
      w.i32(ref.offset)
      break
    case 'identifier':
      w.ascii('Idnt')
      writeAtnClass(w, ref.cls)
      w.u32(ref.id)
      break
    case 'index':
      w.ascii('indx')
      writeAtnClass(w, ref.cls)
      w.u32(ref.index)
      break
    case 'name':
      w.ascii('name')
      writeAtnClass(w, ref.cls)
      writeAtnUnicode(w, ref.name)
      break
    default:
      throw new Error(`a .atn reference of type "${(ref as { type: string }).type}" cannot be written`)
  }
}
