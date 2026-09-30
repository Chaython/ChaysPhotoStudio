// Minimal runtime Kiwi decoder for self-describing Figma .fig payloads.
//
// Kiwi's binary schema is embedded in each .fig file, so we can decode the
// exact schema shipped with the document instead of pinning a generated schema.
// The format is documented by evanw/kiwi (MIT):
// https://github.com/evanw/kiwi

export type KiwiKind = 'ENUM' | 'STRUCT' | 'MESSAGE'
export interface KiwiField {
  name: string
  type: string | null
  isArray: boolean
  value: number
}
export interface KiwiDefinition {
  name: string
  kind: KiwiKind
  fields: KiwiField[]
}
export interface KiwiSchema { definitions: KiwiDefinition[] }

class KiwiReader {
  private p = 0
  constructor(private readonly data: Uint8Array) {}

  byte(): number {
    if (this.p >= this.data.length) throw new Error('Truncated Kiwi data')
    return this.data[this.p++]
  }

  bytes(): Uint8Array {
    const n = this.varUint()
    if (n > 512 * 1024 * 1024 || this.p + n > this.data.length) throw new Error('Invalid Kiwi byte array')
    const out = this.data.slice(this.p, this.p + n)
    this.p += n
    return out
  }

  varUint(): number {
    let value = 0
    let factor = 1
    for (let i = 0; i < 5; i++) {
      const b = this.byte()
      value += (b & 127) * factor
      if (!(b & 128)) return value >>> 0
      factor *= 128
    }
    throw new Error('Kiwi uint exceeds 32 bits')
  }

  varInt(): number {
    const value = this.varUint()
    return value & 1 ? ~((value >>> 1) | 0) : (value >>> 1)
  }

  varUint64(): number | string {
    let value = BigInt(0)
    let shift = BigInt(0)
    for (let i = 0; i < 10; i++) {
      const b = this.byte()
      value |= BigInt(b & 127) << shift
      if (!(b & 128)) {
        return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString()
      }
      shift += BigInt(7)
    }
    throw new Error('Invalid Kiwi uint64')
  }

  varInt64(): number | string {
    const raw = this.varUint64()
    const value = typeof raw === 'number' ? BigInt(raw) : BigInt(raw)
    const decoded = (value & BigInt(1)) ? ~(value >> BigInt(1)) : (value >> BigInt(1))
    return decoded >= BigInt(Number.MIN_SAFE_INTEGER) && decoded <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(decoded) : decoded.toString()
  }

  varFloat(): number {
    const first = this.byte()
    if (first === 0) return 0
    const b1 = this.byte(), b2 = this.byte(), b3 = this.byte()
    let bits = first | (b1 << 8) | (b2 << 16) | (b3 << 24)
    bits = (bits << 23) | (bits >>> 9)
    const buf = new ArrayBuffer(4)
    const v = new DataView(buf)
    v.setInt32(0, bits, true)
    return v.getFloat32(0, true)
  }

  string(): string {
    const units: number[] = []
    for (;;) {
      const a = this.byte()
      let cp: number
      if (a < 0xc0) cp = a
      else {
        const b = this.byte()
        if (a < 0xe0) cp = ((a & 0x1f) << 6) | (b & 0x3f)
        else {
          const c = this.byte()
          if (a < 0xf0) cp = ((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f)
          else {
            const d = this.byte()
            cp = ((a & 7) << 18) | ((b & 0x3f) << 12) | ((c & 0x3f) << 6) | (d & 0x3f)
          }
        }
      }
      if (cp === 0) return String.fromCharCode(...units)
      if (cp < 0x10000) units.push(cp)
      else {
        cp -= 0x10000
        units.push((cp >> 10) + 0xd800, (cp & 0x3ff) + 0xdc00)
      }
      if (units.length > 16 * 1024 * 1024) throw new Error('Kiwi string is too large')
    }
  }
}

const primitiveTypes = ['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64']
const kinds: KiwiKind[] = ['ENUM', 'STRUCT', 'MESSAGE']

export function decodeKiwiBinarySchema(data: Uint8Array): KiwiSchema {
  const r = new KiwiReader(data)
  const count = r.varUint()
  if (count > 100000) throw new Error('Kiwi schema has too many definitions')
  const raw: Array<{ name: string; kind: KiwiKind; fields: Array<KiwiField & { rawType: number | null }> }> = []
  for (let i = 0; i < count; i++) {
    const name = r.string()
    const kind = kinds[r.byte()]
    if (!kind) throw new Error('Invalid Kiwi definition kind')
    const fieldCount = r.varUint()
    if (fieldCount > 100000) throw new Error('Kiwi definition has too many fields')
    const fields: Array<KiwiField & { rawType: number | null }> = []
    for (let j = 0; j < fieldCount; j++) {
      fields.push({
        name: r.string(),
        rawType: r.varInt(),
        type: null,
        isArray: !!(r.byte() & 1),
        value: r.varUint(),
      })
    }
    raw.push({ name, kind, fields })
  }
  const definitions: KiwiDefinition[] = raw.map((def) => ({
    name: def.name,
    kind: def.kind,
    fields: def.fields.map((field) => {
      if (def.kind === 'ENUM') return { ...field, type: null }
      const t = field.rawType!
      let type: string
      if (t < 0) {
        const index = ~t
        if (index < 0 || index >= primitiveTypes.length) throw new Error('Invalid Kiwi primitive type')
        type = primitiveTypes[index]
      } else {
        if (t >= raw.length) throw new Error('Invalid Kiwi definition reference')
        type = raw[t].name
      }
      return { name: field.name, type, isArray: field.isArray, value: field.value }
    }),
  }))
  return { definitions }
}

function enumValue(def: KiwiDefinition, value: number): string | number {
  return def.fields.find(f => f.value === value)?.name ?? value
}

export function decodeKiwiMessage(schema: KiwiSchema, data: Uint8Array, rootName = 'Message'): any {
  const defs = new Map(schema.definitions.map(def => [def.name, def]))
  const root = defs.get(rootName)
    ?? [...schema.definitions].reverse().find(def => def.kind === 'MESSAGE')
  if (!root) throw new Error('Kiwi schema contains no root message')

  let objectCount = 0
  const decodeValue = (r: KiwiReader, type: string, depth: number): any => {
    if (depth > 256) throw new Error('Kiwi object nesting is too deep')
    switch (type) {
      case 'bool': return !!r.byte()
      case 'byte': return r.byte()
      case 'int': return r.varInt()
      case 'uint': return r.varUint()
      case 'float': return r.varFloat()
      case 'string': return r.string()
      case 'int64': return r.varInt64()
      case 'uint64': return r.varUint64()
    }
    const def = defs.get(type)
    if (!def) throw new Error(`Unknown Kiwi type ${type}`)
    if (def.kind === 'ENUM') return enumValue(def, r.varUint())
    return decodeDef(r, def, depth + 1)
  }

  const decodeField = (r: KiwiReader, field: KiwiField, depth: number): any => {
    if (field.isArray) {
      if (field.type === 'byte') return r.bytes()
      const n = r.varUint()
      if (n > 10_000_000) throw new Error('Kiwi array is too large')
      const values = new Array(n)
      for (let i = 0; i < n; i++) values[i] = decodeValue(r, field.type!, depth)
      return values
    }
    return decodeValue(r, field.type!, depth)
  }

  const decodeDef = (r: KiwiReader, def: KiwiDefinition, depth: number): any => {
    if (++objectCount > 5_000_000) throw new Error('Kiwi document has too many objects')
    const out: Record<string, any> = {}
    if (def.kind === 'STRUCT') {
      for (const field of def.fields) out[field.name] = decodeField(r, field, depth)
      return out
    }
    if (def.kind !== 'MESSAGE') throw new Error('Cannot decode enum as object')
    const byId = new Map(def.fields.map(field => [field.value, field]))
    for (;;) {
      const id = r.varUint()
      if (id === 0) return out
      const field = byId.get(id)
      if (!field) throw new Error(`Kiwi message ${def.name} contains unknown field id ${id}`)
      out[field.name] = decodeField(r, field, depth)
    }
  }

  return decodeDef(new KiwiReader(data), root, 0)
}
