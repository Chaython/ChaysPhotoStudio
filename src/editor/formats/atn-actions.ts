// ============================================================
// Photoshop Actions (.atn) ↔ studio actions.
//
// An `.atn` file holds a folder of actions; each action is a list
// of steps, and each step is a Photoshop event carrying its
// parameters in a descriptor. This module translates between that
// model and our own `PsAction` / `ActionStep` model.
//
// An import produces two kinds of step:
//
//   * mapped — the event is one this module knows and its
//     descriptor holds only settings we understand, so the step
//     plays as one of our operations;
//   * kept   — anything else. The event, its panel name and its
//     descriptor are stored verbatim in the step's arguments, the
//     step is skipped on playback, and it is written back
//     unchanged: importing a file and re-exporting it never
//     silently drops or alters an edit.
//
// Numbers are big-endian; the value vocabulary is the one
// documented in `atn-descriptor.ts`.
//
// Written from the published "Photoshop File Formats" action and
// descriptor structures and from observation of the events
// Photoshop records. No code was copied.
// ============================================================

import type { ActionStep, ControlDef, PsAction } from '../types'
import { ADJUSTMENTS } from '../image-ops/adjustments'
import { FILTERS as FILTERS_BASE } from '../image-ops/filters'
import { FILTERS2 } from '../image-ops/filters2'
import type { AtnClass, AtnDescriptor, AtnId, AtnReference, AtnValue } from './atn-descriptor'
import { atnBool, atnGet, atnId, atnUnicodeText } from './atn-descriptor'
import type { AtnActionSet, AtnEvent, AtnStep } from './atn'
import { atnAction, atnActionSet, atnEventId, atnStep, atnStepLabel, parseAtn, writeAtn } from './atn'

// ---------------------------------------------------------------- registries

const FILTERS = { ...FILTERS_BASE, ...FILTERS2 } as Record<string, { controls: ControlDef[]; defaults: Record<string, any> }>

/** The op a kept step is stored under. The engine skips it on playback. */
export const KEPT_STEP_OP = 'photoshop'

// ---------------------------------------------------------------- JSON forms

/**
 * The descriptor in a JSON-safe form.
 *
 * `PsAction`s are persisted as JSON, and a kept step must survive
 * that: every binary payload is kept as a plain array of numbers
 * and every string as its UTF-16 code units, so nothing is lost
 * on the way through `JSON.stringify`.
 */
export interface AtnJsonDescriptor {
  name: number[]
  classId: AtnId
  items: { key: AtnId; value: AtnJsonValue }[]
}

/** A class reference in JSON-safe form. */
export interface AtnJsonClass {
  name: number[]
  id: AtnId
}

/** A reference in JSON-safe form. */
export type AtnJsonReference =
  | { type: 'property'; cls: AtnJsonClass; key: AtnId }
  | { type: 'class'; cls: AtnJsonClass }
  | { type: 'enumerated'; cls: AtnJsonClass; typeId: AtnId; value: AtnId }
  | { type: 'offset'; cls: AtnJsonClass; offset: number }
  | { type: 'identifier'; cls: AtnJsonClass; id: number }
  | { type: 'index'; cls: AtnJsonClass; index: number }
  | { type: 'name'; cls: AtnJsonClass; name: number[] }

/** A descriptor value in JSON-safe form. */
export type AtnJsonValue =
  | { type: 'reference'; items: AtnJsonReference[] }
  | { type: 'descriptor'; descriptor: AtnJsonDescriptor }
  | { type: 'globalObject'; descriptor: AtnJsonDescriptor }
  | { type: 'list'; items: AtnJsonValue[] }
  | { type: 'double'; value: number }
  | { type: 'unitFloat'; unit: string; value: number }
  | { type: 'unitFloats'; unit: string; values: number[] }
  | { type: 'text'; value: number[] }
  | { type: 'enum'; typeId: AtnId; value: AtnId }
  | { type: 'integer'; value: number }
  | { type: 'largeInteger'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'class'; cls: AtnJsonClass }
  | { type: 'globalClass'; cls: AtnJsonClass }
  | { type: 'alias'; bytes: number[] }
  | { type: 'path'; bytes: number[] }
  | { type: 'rawData'; bytes: number[] }
  | { type: 'objectArray'; prefix: number; body: AtnJsonDescriptor }

/** A kept step in JSON-safe form: a `.atn` step exactly as read. */
export interface AtnJsonStep {
  expanded: boolean
  enabled: boolean
  withDialog: boolean
  dialogOptions: number
  event: { kind: 'code'; code: string } | { kind: 'name'; name: string }
  dictionary: string
  descriptor?: AtnJsonDescriptor
}

const classToJson = (cls: { name: { units: number[] }; id: AtnId }): AtnJsonClass => ({ name: [...cls.name.units], id: { ...cls.id } })

function classFromJson(j: any): AtnClass | null {
  if (!j || !Array.isArray(j.name) || !j.name.every((n: any) => typeof n === 'number' && Number.isInteger(n))) return null
  if (!j.id || typeof j.id.text !== 'string' || typeof j.id.code !== 'boolean') return null
  return { name: { units: j.name }, id: { text: j.id.text, code: j.id.code } }
}

function valueToJson(v: AtnValue): AtnJsonValue {
  switch (v.type) {
    case 'reference': return { type: 'reference', items: v.items.map(referenceToJson) }
    case 'descriptor': return { type: 'descriptor', descriptor: descriptorToJson(v.descriptor) }
    case 'globalObject': return { type: 'globalObject', descriptor: descriptorToJson(v.descriptor) }
    case 'list': return { type: 'list', items: v.items.map(valueToJson) }
    case 'double': case 'integer': case 'largeInteger': return { type: v.type, value: v.value }
    case 'unitFloat': return { type: 'unitFloat', unit: v.unit, value: v.value }
    case 'unitFloats': return { type: 'unitFloats', unit: v.unit, values: [...v.values] }
    case 'text': return { type: 'text', value: [...v.value.units] }
    case 'enum': return { type: 'enum', typeId: { ...v.typeId }, value: { ...v.value } }
    case 'boolean': return { type: 'boolean', value: v.value }
    case 'class': return { type: 'class', cls: classToJson(v.cls) }
    case 'globalClass': return { type: 'globalClass', cls: classToJson(v.cls) }
    case 'alias': case 'path': case 'rawData': return { type: v.type, bytes: [...v.bytes] }
    case 'objectArray': return { type: 'objectArray', prefix: v.prefix, body: descriptorToJson(v.body) }
  }
}

function valueFromJson(j: any): AtnValue | null {
  if (!j || typeof j.type !== 'string') return null
  switch (j.type) {
    case 'reference': {
      if (!Array.isArray(j.items)) return null
      const items: AtnReference[] = []
      for (const item of j.items) {
        const ref = referenceFromJson(item)
        if (!ref) return null
        items.push(ref)
      }
      return { type: 'reference', items }
    }
    case 'descriptor': {
      const d = descriptorFromJson(j.descriptor)
      return d ? { type: 'descriptor', descriptor: d } : null
    }
    case 'globalObject': {
      const d = descriptorFromJson(j.descriptor)
      return d ? { type: 'globalObject', descriptor: d } : null
    }
    case 'list': {
      if (!Array.isArray(j.items)) return null
      const items: AtnValue[] = []
      for (const item of j.items) {
        const v = valueFromJson(item)
        if (!v) return null
        items.push(v)
      }
      return { type: 'list', items }
    }
    case 'double': case 'integer': case 'largeInteger':
      return typeof j.value === 'number' ? { type: j.type, value: j.value } : null
    case 'unitFloat':
      return typeof j.unit === 'string' && typeof j.value === 'number' ? { type: 'unitFloat', unit: j.unit, value: j.value } : null
    case 'unitFloats': {
      if (typeof j.unit !== 'string' || !Array.isArray(j.values) || !j.values.every((n: any) => typeof n === 'number')) return null
      return { type: 'unitFloats', unit: j.unit, values: j.values }
    }
    case 'text': {
      if (!Array.isArray(j.value) || !j.value.every((n: any) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 0xffff)) return null
      return { type: 'text', value: { units: j.value } }
    }
    case 'enum': {
      const typeId = idFromJson(j.typeId)
      const value = idFromJson(j.value)
      return typeId && value ? { type: 'enum', typeId, value } : null
    }
    case 'boolean': return typeof j.value === 'boolean' ? { type: 'boolean', value: j.value } : null
    case 'class': case 'globalClass': {
      const cls = classFromJson(j.cls)
      return cls ? { type: j.type, cls } : null
    }
    case 'alias': case 'path': case 'rawData': {
      if (!Array.isArray(j.bytes) || !j.bytes.every((n: any) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255)) return null
      return { type: j.type, bytes: Uint8Array.from(j.bytes) } as AtnValue
    }
    case 'objectArray': {
      if (typeof j.prefix !== 'number') return null
      const body = descriptorFromJson(j.body)
      return body ? { type: 'objectArray', prefix: j.prefix, body } : null
    }
    default: return null
  }
}

function referenceToJson(ref: AtnReference): AtnJsonReference {
  switch (ref.type) {
    case 'property': return { type: 'property', cls: classToJson(ref.cls), key: { ...ref.key } }
    case 'class': return { type: 'class', cls: classToJson(ref.cls) }
    case 'enumerated': return { type: 'enumerated', cls: classToJson(ref.cls), typeId: { ...ref.typeId }, value: { ...ref.value } }
    case 'offset': return { type: 'offset', cls: classToJson(ref.cls), offset: ref.offset }
    case 'identifier': return { type: 'identifier', cls: classToJson(ref.cls), id: ref.id }
    case 'index': return { type: 'index', cls: classToJson(ref.cls), index: ref.index }
    case 'name': return { type: 'name', cls: classToJson(ref.cls), name: [...ref.name.units] }
  }
}

function referenceFromJson(j: any): AtnReference | null {
  if (!j || typeof j.type !== 'string') return null
  const cls = classFromJson(j.cls)
  if (!cls) return null
  switch (j.type) {
    case 'property': {
      const key = idFromJson(j.key)
      return key ? { type: 'property', cls, key } : null
    }
    case 'class': return { type: 'class', cls }
    case 'enumerated': {
      const typeId = idFromJson(j.typeId)
      const value = idFromJson(j.value)
      return typeId && value ? { type: 'enumerated', cls, typeId, value } : null
    }
    case 'offset': return typeof j.offset === 'number' ? { type: 'offset', cls, offset: j.offset } : null
    case 'identifier': return typeof j.id === 'number' ? { type: 'identifier', cls, id: j.id } : null
    case 'index': return typeof j.index === 'number' ? { type: 'index', cls, index: j.index } : null
    case 'name': {
      if (!Array.isArray(j.name) || !j.name.every((n: any) => typeof n === 'number' && Number.isInteger(n))) return null
      return { type: 'name', cls, name: { units: j.name } }
    }
    default: return null
  }
}

const idFromJson = (j: any): AtnId | null =>
  j && typeof j.text === 'string' && typeof j.code === 'boolean' ? { text: j.text, code: j.code } : null

/** Converts a descriptor to its JSON-safe form. */
export function descriptorToJson(d: AtnDescriptor): AtnJsonDescriptor {
  return {
    name: [...d.name.units],
    classId: { ...d.classId },
    items: d.items.map(item => ({ key: { ...item.key }, value: valueToJson(item.value) })),
  }
}

/** Rebuilds a descriptor from its JSON-safe form, or `null` if it is malformed. */
export function descriptorFromJson(j: unknown): AtnDescriptor | null {
  if (!j || typeof j !== 'object') return null
  const o = j as any
  if (!Array.isArray(o.name) || !o.name.every((n: any) => typeof n === 'number' && Number.isInteger(n))) return null
  const classId = idFromJson(o.classId)
  if (!classId || !Array.isArray(o.items)) return null
  const items: { key: AtnId; value: AtnValue }[] = []
  for (const item of o.items) {
    const key = idFromJson(item?.key)
    if (!key) return null
    const value = valueFromJson(item?.value)
    if (!value) return null
    items.push({ key, value })
  }
  return { name: { units: o.name }, classId, items }
}

/** Converts a `.atn` step to its JSON-safe form. */
export function atnStepToJson(step: AtnStep): AtnJsonStep {
  return {
    expanded: step.expanded,
    enabled: step.enabled,
    withDialog: step.withDialog,
    dialogOptions: step.dialogOptions,
    event: { ...step.event },
    dictionary: step.dictionary,
    descriptor: step.descriptor ? descriptorToJson(step.descriptor) : undefined,
  }
}

/** Rebuilds a `.atn` step from its JSON-safe form, or `null` if it is malformed. */
export function atnStepFromJson(j: unknown): AtnStep | null {
  if (!j || typeof j !== 'object') return null
  const o = j as any
  if (typeof o.expanded !== 'boolean' || typeof o.enabled !== 'boolean' || typeof o.withDialog !== 'boolean') return null
  if (typeof o.dialogOptions !== 'number' || typeof o.dictionary !== 'string') return null
  const event = o.event
  if (!event || typeof event.kind !== 'string') return null
  if (event.kind === 'code') {
    if (typeof event.code !== 'string' || event.code.length !== 4) return null
  } else if (event.kind === 'name') {
    if (typeof event.name !== 'string') return null
  } else {
    return null
  }
  const descriptor = o.descriptor === undefined ? undefined : descriptorFromJson(o.descriptor)
  if (o.descriptor !== undefined && !descriptor) return null
  return {
    expanded: o.expanded,
    enabled: o.enabled,
    withDialog: o.withDialog,
    dialogOptions: o.dialogOptions,
    event: event as AtnEvent,
    dictionary: o.dictionary,
    descriptor: descriptor ?? undefined,
  }
}

// ---------------------------------------------------------------- value readers

/** The number a value carries, whatever its form. */
function valueNumber(v: AtnValue | undefined): number | undefined {
  if (!v) return undefined
  switch (v.type) {
    case 'double': case 'unitFloat': case 'integer': case 'largeInteger':
      return Number.isFinite(v.value) ? v.value : undefined
    default:
      return undefined
  }
}

/** A pixel measurement (`UntF` with the `#Pxl` unit, or a plain number). */
function valuePixels(v: AtnValue | undefined): number | undefined {
  if (!v) return undefined
  if (v.type === 'unitFloat') return v.unit === '#Pxl' && Number.isFinite(v.value) ? v.value : undefined
  if (v.type === 'integer' || v.type === 'double') return Number.isFinite(v.value) ? v.value : undefined
  return undefined
}

/** A percentage (`UntF` with the `#Prc` unit, or a plain number). */
function valuePercent(v: AtnValue | undefined): number | undefined {
  if (!v) return undefined
  if (v.type === 'unitFloat') return v.unit === '#Prc' && Number.isFinite(v.value) ? v.value : undefined
  if (v.type === 'integer' || v.type === 'double') return Number.isFinite(v.value) ? v.value : undefined
  return undefined
}

/** An angle (`UntF` with the `#Ang` unit, or a plain number). */
function valueAngle(v: AtnValue | undefined): number | undefined {
  if (!v) return undefined
  if (v.type === 'unitFloat') return v.unit === '#Ang' && Number.isFinite(v.value) ? v.value : undefined
  if (v.type === 'integer' || v.type === 'double') return Number.isFinite(v.value) ? v.value : undefined
  return undefined
}

/** An enumeration value's id, its trailing padding removed (`Spn ` → `Spn`). */
function valueEnum(v: AtnValue | undefined): string | undefined {
  if (!v || v.type !== 'enum') return undefined
  return v.value.text.trim()
}

/** A boolean a value carries. */
function valueBool(v: AtnValue | undefined): boolean | undefined {
  return atnBool(v)
}

// ---------------------------------------------------------------- value builders

const psPx = (v: number): AtnValue => ({ type: 'unitFloat', unit: '#Pxl', value: v })
const psPct = (v: number): AtnValue => ({ type: 'unitFloat', unit: '#Prc', value: v })
const psAng = (v: number): AtnValue => ({ type: 'unitFloat', unit: '#Ang', value: v })
const psRsl = (v: number): AtnValue => ({ type: 'unitFloat', unit: '#Rsl', value: v })
const psInt = (v: number): AtnValue => ({ type: 'integer', value: Math.round(v) })
const psDbl = (v: number): AtnValue => ({ type: 'double', value: v })
const psBool = (v: boolean): AtnValue => ({ type: 'boolean', value: v })
const psEnum = (typeId: string, value: string): AtnValue => ({ type: 'enum', typeId: atnId(typeId), value: atnId(value) })

/** An empty descriptor of a class, with the given key/value items in order. */
function makeDescriptor(classId: string, items: [string, AtnValue][] = []): AtnDescriptor {
  return {
    name: { units: [] },
    classId: atnId(classId),
    items: items.map(([key, value]) => ({ key: atnId(key), value })),
  }
}

// ---------------------------------------------------------------- enum tables
// Photoshop writes four-character codes, padded with spaces where the code is
// shorter. Lookups compare trimmed ids so either spelling reads.

const NOISE: Record<string, string> = { 'Unfr': 'uniform', 'Gsn ': 'gaussian' }
const OFFSET_FILL: Record<string, string> = { 'Wrp ': 'wrap', 'Rpt ': 'repeat-edge', 'Bckg': 'transparent' }
const RADIAL_METHOD: Record<string, string> = { 'Spn ': 'spin', 'Zm  ': 'zoom' }
const RADIAL_QUALITY: Record<string, string> = { 'Drft': 'draft', 'Gd  ': 'good', 'Bst ': 'best' }
const WIND_METHOD: Record<string, string> = { 'Wnd ': 'wind', 'Stgr': 'stagger' }
// Photoshop names the direction the streaks extend, not their source: `Left`
// means the streaks run leftwards, i.e. the wind comes from the right.
const WIND_DIRECTION: Record<string, string> = { 'Left': 'right', 'Rght': 'left' }
const WAVE_TYPE: Record<string, string> = { 'WvSn': 'sine', 'WvSq': 'square', 'WvTr': 'triangle' }
const ZIGZAG_STYLE: Record<string, string> = { 'PndR': 'pond', 'OtFr': 'outFromCenter', 'ArnC': 'aroundCenter' }

/** An enum id → our value, accepting either spelling of the code. */
function lookupEnum(table: Record<string, string>, code: string | undefined): string | undefined {
  if (code === undefined) return undefined
  for (const [key, value] of Object.entries(table)) if (key.trim() === code) return value
  return undefined
}

/** Our value → the enum id Photoshop writes. */
function enumCode(table: Record<string, string>, value: string): string | undefined {
  for (const [key, v] of Object.entries(table)) if (v === value) return key
  return undefined
}

// ---------------------------------------------------------------- mappings

/**
 * One Photoshop event this module understands.
 *
 * `keys` are the descriptor keys the mapping reads or writes; a
 * descriptor carrying any other key (apart from the tolerated
 * infrastructure keys) cannot be mapped, because it holds a setting
 * that would be lost — the step stays a kept step instead.
 */
interface AtnMapping {
  /** The Photoshop event code, empty when the event is a name. */
  code: string
  /** The Photoshop event names (TEXT events) that mean the same thing. */
  names: string[]
  /** The studio op the event plays as. */
  op: 'applyFilter' | 'applyAdjustment' | 'flatten' | 'resizeImage'
  /** The filter or adjustment type, for the two apply ops. */
  type?: string
  /** The descriptor's class id. */
  classId: string
  /** The label shown in the Actions panel. */
  label: string
  /** The descriptor keys the mapping reads or writes. */
  keys: string[]
  /** Reads the studio parameters; `null` when the step cannot be mapped. */
  read: (d: AtnDescriptor) => Record<string, any> | null
  /** Writes the studio parameters as a Photoshop descriptor. */
  write: (params: Record<string, any>) => AtnDescriptor | null
}

/**
 * Keys Photoshop writes into these descriptors that carry no
 * setting of their own here: the layer the step targets, the
 * interpolation a filter uses, the random seed, and so on.
 */
const TOLERATED_KEYS = new Set([
  'T   ',       // the target layer
  'Intr',       // interpolation
  'FlRs',       // random seed
  'Opct',       // opacity
  'Msk ',       // mask
  'presetKind', // the adjustment's preset marker
  'Vrsn',       // adjustment version
  'auto',       // automatic mode
  'ChnT',       // studio channel editing target (extension; Photoshop keeps the step)
])

/** The key of a Gaussian Blur / Median / High Pass / Minimum / Maximum / Box Blur radius. */
function readRadius(d: AtnDescriptor, key = 'Rds '): Record<string, any> | null {
  const radius = valuePixels(atnGet(d, key))
  return radius === undefined ? null : { radius }
}

const writeRadius = (p: Record<string, any>, fallback = 4): AtnDescriptor =>
  makeDescriptor('null', [['Rds ', psPx(p.radius ?? fallback)]])

const FILTER_MAPPINGS: AtnMapping[] = [
  {
    code: 'GsnB', names: ['gaussianBlur'], op: 'applyFilter', type: 'gaussian-blur',
    classId: 'null', label: 'Gaussian Blur', keys: ['Rds '],
    read: d => readRadius(d),
    write: p => writeRadius(p),
  },
  {
    // Photoshop records Box Blur and Surface Blur by name, not by code.
    code: '', names: ['boxblur', 'boxBlur'], op: 'applyFilter', type: 'box-blur',
    classId: 'null', label: 'Box Blur', keys: ['Rds '],
    read: d => readRadius(d),
    write: p => writeRadius(p),
  },
  {
    code: 'MtnB', names: ['motionBlur'], op: 'applyFilter', type: 'motion-blur',
    classId: 'null', label: 'Motion Blur', keys: ['Angl', 'Dstn'],
    read: d => {
      const angle = valueAngle(atnGet(d, 'Angl'))
      const distance = valuePixels(atnGet(d, 'Dstn'))
      return angle === undefined || distance === undefined ? null : { angle, distance }
    },
    write: p => makeDescriptor('null', [['Angl', psAng(p.angle ?? 0)], ['Dstn', psPx(p.distance ?? 20)]]),
  },
  {
    code: 'RdlB', names: ['radialBlur'], op: 'applyFilter', type: 'radial-blur',
    classId: 'null', label: 'Radial Blur', keys: ['Amnt', 'BlrM', 'BlrQ'],
    read: d => {
      const amount = valueNumber(atnGet(d, 'Amnt'))
      if (amount === undefined) return null
      const method = lookupEnum(RADIAL_METHOD, valueEnum(atnGet(d, 'BlrM')))
      if (valueEnum(atnGet(d, 'BlrM')) !== undefined && method === undefined) return null
      const quality = lookupEnum(RADIAL_QUALITY, valueEnum(atnGet(d, 'BlrQ')))
      if (valueEnum(atnGet(d, 'BlrQ')) !== undefined && quality === undefined) return null
      const out: Record<string, any> = { amount }
      if (method !== undefined) out.method = method
      if (quality !== undefined) out.quality = quality
      return out
    },
    write: p => {
      const items: [string, AtnValue][] = [['Amnt', psInt(p.amount ?? 20)]]
      const method = enumCode(RADIAL_METHOD, p.method ?? 'spin')
      const quality = enumCode(RADIAL_QUALITY, p.quality ?? 'good')
      if (!method || !quality) return null
      items.push(['BlrM', psEnum('BlrM', method)], ['BlrQ', psEnum('BlrQ', quality)])
      return makeDescriptor('null', items)
    },
  },
  {
    code: 'Mdn ', names: ['median'], op: 'applyFilter', type: 'median',
    classId: 'null', label: 'Median', keys: ['Rds '],
    read: d => readRadius(d),
    write: p => writeRadius(p, 2),
  },
  {
    code: 'DstS', names: ['dustAndScratches'], op: 'applyFilter', type: 'dust-scratches',
    classId: 'null', label: 'Dust & Scratches', keys: ['Rds ', 'Thsh'],
    read: d => {
      const radius = valuePixels(atnGet(d, 'Rds '))
      const threshold = valueNumber(atnGet(d, 'Thsh'))
      if (radius === undefined) return null
      const out: Record<string, any> = { radius }
      if (threshold !== undefined) out.threshold = threshold
      return out
    },
    write: p => makeDescriptor('null', [['Rds ', psPx(p.radius ?? 2)], ['Thsh', psInt(p.threshold ?? 10)]]),
  },
  {
    code: 'UnsM', names: ['unsharpMask'], op: 'applyFilter', type: 'smart-sharpen',
    classId: 'null', label: 'Unsharp Mask', keys: ['Amnt', 'Rds ', 'Thsh'],
    read: d => {
      const amount = valuePercent(atnGet(d, 'Amnt'))
      const radius = valuePixels(atnGet(d, 'Rds '))
      if (amount === undefined || radius === undefined) return null
      const out: Record<string, any> = { amount, radius }
      const threshold = valueNumber(atnGet(d, 'Thsh'))
      if (threshold !== undefined) out.threshold = threshold
      return out
    },
    write: p => {
      const items: [string, AtnValue][] = [['Amnt', psPct(p.amount ?? 80)], ['Rds ', psPx(p.radius ?? 2)]]
      const threshold = p.threshold
      if (typeof threshold === 'number') items.push(['Thsh', psInt(threshold)])
      return makeDescriptor('null', items)
    },
  },
  {
    code: 'AdNs', names: ['addNoise'], op: 'applyFilter', type: 'add-noise',
    classId: 'null', label: 'Add Noise', keys: ['Nose', 'Dstr', 'Mnch'],
    read: d => {
      const amount = valuePercent(atnGet(d, 'Nose'))
      if (amount === undefined) return null
      const out: Record<string, any> = { amount }
      const distribution = lookupEnum(NOISE, valueEnum(atnGet(d, 'Dstr')))
      if (valueEnum(atnGet(d, 'Dstr')) !== undefined && distribution === undefined) return null
      if (distribution !== undefined) out.distribution = distribution
      const mono = valueBool(atnGet(d, 'Mnch'))
      if (mono !== undefined) out.monochromatic = mono
      return out
    },
    write: p => {
      const distribution = enumCode(NOISE, p.distribution ?? 'uniform')
      if (!distribution) return null
      const items: [string, AtnValue][] = [['Nose', psPct(p.amount ?? 12)], ['Dstr', psEnum('Dstr', distribution)]]
      if (p.monochromatic !== undefined) items.push(['Mnch', psBool(p.monochromatic === true)])
      return makeDescriptor('null', items)
    },
  },
  {
    code: 'HghP', names: ['highPass'], op: 'applyFilter', type: 'high-pass',
    classId: 'null', label: 'High Pass', keys: ['Rds '],
    read: d => readRadius(d),
    write: p => writeRadius(p, 3),
  },
  {
    // Oil Paint. Photoshop records this by name in some versions; keys:
    // `Rds ` radius, `StyL` stylization, `Cln ` cleanliness.
    code: '', names: ['oilPaint'], op: 'applyFilter', type: 'oil-paint',
    classId: 'null', label: 'Oil Paint', keys: ['Rds ', 'StyL', 'Cln '],
    read: d => {
      const radius = valueNumber(atnGet(d, 'Rds '))
      const style = valueNumber(atnGet(d, 'StyL'))
      const clean = valueNumber(atnGet(d, 'Cln '))
      if (radius === undefined) return null
      const out: Record<string, any> = { radius }
      if (style !== undefined) out.brush = style
      if (clean !== undefined) out.style = clean
      return out
    },
    write: p => {
      const items: [string, AtnValue][] = [['Rds ', psInt(p.radius ?? 4)]]
      if (typeof p.brush === 'number') items.push(['StyL', psInt(p.brush)])
      if (typeof p.style === 'number') items.push(['Cln ', psInt(p.style)])
      return makeDescriptor('null', items)
    },
  },
  {
    code: 'Mnm ', names: ['minimum'], op: 'applyFilter', type: 'minimum',
    classId: 'null', label: 'Minimum', keys: ['Rds '],
    read: d => readRadius(d),
    write: p => writeRadius(p, 2),
  },
  {
    code: 'Mxm ', names: ['maximum'], op: 'applyFilter', type: 'maximum',
    classId: 'null', label: 'Maximum', keys: ['Rds '],
    read: d => readRadius(d),
    write: p => writeRadius(p, 2),
  },
  {
    code: 'Crst', names: ['crystallize'], op: 'applyFilter', type: 'crystallize',
    classId: 'null', label: 'Crystallize', keys: ['ClSz'],
    read: d => {
      const size = valuePixels(atnGet(d, 'ClSz'))
      return size === undefined ? null : { size }
    },
    write: p => makeDescriptor('null', [['ClSz', psPx(p.size ?? 20)]]),
  },
  {
    code: 'Msc ', names: ['mosaic'], op: 'applyFilter', type: 'mosaic',
    classId: 'null', label: 'Mosaic', keys: ['ClSz'],
    read: d => {
      const size = valuePixels(atnGet(d, 'ClSz'))
      return size === undefined ? null : { size }
    },
    write: p => makeDescriptor('null', [['ClSz', psPx(p.size ?? 12)]]),
  },
  {
    code: 'Embs', names: ['emboss'], op: 'applyFilter', type: 'emboss',
    classId: 'null', label: 'Emboss', keys: ['Angl', 'Hght', 'Amnt'],
    read: d => {
      const angle = valueAngle(atnGet(d, 'Angl'))
      const height = valueNumber(atnGet(d, 'Hght'))
      const amount = valueNumber(atnGet(d, 'Amnt'))
      if (angle === undefined) return null
      const out: Record<string, any> = { angle }
      if (height !== undefined) out.height = height
      if (amount !== undefined) out.amount = amount
      return out
    },
    write: p => makeDescriptor('null', [['Angl', psAng(p.angle ?? 135)], ['Hght', psInt(p.height ?? 2)], ['Amnt', psInt(p.amount ?? 100)]]),
  },
  {
    code: 'Ofst', names: ['offset'], op: 'applyFilter', type: 'offset',
    classId: 'null', label: 'Offset', keys: ['Hrzn', 'Vrtc', 'Fl  '],
    read: d => {
      const horizontal = valueNumber(atnGet(d, 'Hrzn'))
      const vertical = valueNumber(atnGet(d, 'Vrtc'))
      if (horizontal === undefined || vertical === undefined) return null
      const out: Record<string, any> = { horizontal, vertical }
      const edgeMode = lookupEnum(OFFSET_FILL, valueEnum(atnGet(d, 'Fl  ')))
      if (valueEnum(atnGet(d, 'Fl  ')) !== undefined && edgeMode === undefined) return null
      if (edgeMode !== undefined) out.edgeMode = edgeMode
      return out
    },
    write: p => {
      const items: [string, AtnValue][] = [['Hrzn', psInt(p.horizontal ?? 0)], ['Vrtc', psInt(p.vertical ?? 0)]]
      const edgeMode = enumCode(OFFSET_FILL, p.edgeMode ?? 'wrap')
      if (!edgeMode) return null
      items.push(['Fl  ', psEnum('FlMd', edgeMode)])
      return makeDescriptor('null', items)
    },
  },
  {
    code: 'Wnd ', names: ['wind'], op: 'applyFilter', type: 'wind',
    classId: 'null', label: 'Wind', keys: ['WndM', 'Drct', 'Strt'],
    read: d => {
      const out: Record<string, any> = {}
      const method = lookupEnum(WIND_METHOD, valueEnum(atnGet(d, 'WndM')))
      if (valueEnum(atnGet(d, 'WndM')) !== undefined && method === undefined) return null
      const direction = lookupEnum(WIND_DIRECTION, valueEnum(atnGet(d, 'Drct')))
      if (valueEnum(atnGet(d, 'Drct')) !== undefined && direction === undefined) return null
      if (method !== undefined) out.method = method
      if (direction !== undefined) out.direction = direction
      const strength = valueNumber(atnGet(d, 'Strt'))
      if (strength !== undefined) out.strength = strength
      return out
    },
    write: p => {
      const method = enumCode(WIND_METHOD, p.method ?? 'wind')
      const direction = enumCode(WIND_DIRECTION, p.direction ?? 'right')
      if (!method || !direction) return null
      const items: [string, AtnValue][] = [['WndM', psEnum('WndM', method)], ['Drct', psEnum('Drct', direction)]]
      if (typeof p.strength === 'number') items.push(['Strt', psInt(p.strength)])
      return makeDescriptor('null', items)
    },
  },
  {
    code: 'Twrl', names: ['twirl'], op: 'applyFilter', type: 'twirl',
    classId: 'null', label: 'Twirl', keys: ['Angl'],
    read: d => {
      const angle = valueAngle(atnGet(d, 'Angl'))
      return angle === undefined ? null : { angle }
    },
    write: p => makeDescriptor('null', [['Angl', psAng(p.angle ?? 50)]]),
  },
  {
    code: 'Sphr', names: ['spherize'], op: 'applyFilter', type: 'spherize',
    classId: 'null', label: 'Spherize', keys: ['Amnt', 'SphM'],
    read: d => {
      const amount = valueNumber(atnGet(d, 'Amnt'))
      if (amount === undefined) return null
      // Our Spherize is horizontal and vertical alike: a mode that squeezes
      // only one axis cannot be played faithfully.
      const mode = valueEnum(atnGet(d, 'SphM'))
      if (mode !== undefined && mode !== 'Nrml') return null
      return { amount }
    },
    write: p => makeDescriptor('null', [['Amnt', psInt(p.amount ?? 50)]]),
  },
  {
    code: 'Wave', names: ['wave'], op: 'applyFilter', type: 'wave',
    classId: 'null', label: 'Wave', keys: ['Wvtp', 'AmMn', 'AmMx', 'WLMn', 'WLMx', 'NmbG'],
    read: d => {
      const type = lookupEnum(WAVE_TYPE, valueEnum(atnGet(d, 'Wvtp')))
      if (valueEnum(atnGet(d, 'Wvtp')) !== undefined && type === undefined) return null
      const amplitudeMin = valueNumber(atnGet(d, 'AmMn'))
      const amplitudeMax = valueNumber(atnGet(d, 'AmMx'))
      const wavelengthMin = valueNumber(atnGet(d, 'WLMn'))
      const wavelengthMax = valueNumber(atnGet(d, 'WLMx'))
      if (amplitudeMin === undefined || amplitudeMax === undefined || wavelengthMin === undefined || wavelengthMax === undefined) return null
      // Our Wave is one oscillator at one amplitude and one wavelength, so an
      // event that varies either across generators cannot be played exactly.
      if (amplitudeMin !== amplitudeMax || wavelengthMin !== wavelengthMax) return null
      const generators = valueNumber(atnGet(d, 'NmbG'))
      if (generators !== undefined && Math.round(generators) !== 1) return null
      const out: Record<string, any> = { amplitude: amplitudeMin, wavelength: wavelengthMin }
      if (type !== undefined) out.type = type
      return out
    },
    write: p => {
      const type = enumCode(WAVE_TYPE, p.type ?? 'sine')
      if (!type) return null
      const amplitude = p.amplitude ?? 20
      const wavelength = p.wavelength ?? 120
      return makeDescriptor('null', [
        ['Wvtp', psEnum('Wvtp', type)],
        ['NmbG', psInt(1)],
        ['WLMn', psInt(wavelength)], ['WLMx', psInt(wavelength)],
        ['AmMn', psInt(amplitude)], ['AmMx', psInt(amplitude)],
      ])
    },
  },
  {
    code: 'Pnch', names: ['pinch'], op: 'applyFilter', type: 'pinch',
    classId: 'null', label: 'Pinch', keys: ['Amnt'],
    read: d => {
      const amount = valueNumber(atnGet(d, 'Amnt'))
      return amount === undefined ? null : { amount }
    },
    write: p => makeDescriptor('null', [['Amnt', psInt(p.amount ?? 25)]]),
  },
  {
    code: 'ZgZg', names: ['zigZag'], op: 'applyFilter', type: 'zigzag',
    classId: 'null', label: 'ZigZag', keys: ['Amnt', 'NmbR', 'ZZTy', 'SclH', 'SclV'],
    read: d => {
      const amount = valueNumber(atnGet(d, 'Amnt'))
      const ridges = valueNumber(atnGet(d, 'NmbR'))
      if (amount === undefined || ridges === undefined) return null
      // A horizontal or vertical scale below 100 % cannot be played.
      for (const key of ['SclH', 'SclV']) {
        const scale = valueNumber(atnGet(d, key))
        if (scale !== undefined && Math.round(scale) !== 100) return null
      }
      const style = lookupEnum(ZIGZAG_STYLE, valueEnum(atnGet(d, 'ZZTy')))
      if (valueEnum(atnGet(d, 'ZZTy')) !== undefined && style === undefined) return null
      const out: Record<string, any> = { amount, ridges: Math.round(ridges) }
      if (style !== undefined) out.style = style
      return out
    },
    write: p => {
      const style = enumCode(ZIGZAG_STYLE, p.style ?? 'pond')
      if (!style) return null
      return makeDescriptor('null', [
        ['Amnt', psInt(p.amount ?? 20)],
        ['NmbR', psInt(p.ridges ?? 8)],
        ['ZZTy', psEnum('ZZTy', style)],
      ])
    },
  },
  {
    code: 'Avrg', names: ['Avrg', 'average'], op: 'applyFilter', type: 'average',
    classId: 'null', label: 'Average', keys: [],
    read: () => ({}),
    write: () => makeDescriptor('null'),
  },
  {
    code: 'FndE', names: ['findEdges'], op: 'applyFilter', type: 'find-edges',
    classId: 'null', label: 'Find Edges', keys: [],
    read: () => ({}),
    write: () => makeDescriptor('null'),
  },
]

const ADJUSTMENT_MAPPINGS: AtnMapping[] = [
  {
    code: 'BrgC', names: ['BrgC'], op: 'applyAdjustment', type: 'brightness-contrast',
    classId: 'BrgC', label: 'Brightness/Contrast', keys: ['Brgh', 'Cntr', 'useLegacy'],
    read: d => {
      const brightness = valueNumber(atnGet(d, 'Brgh'))
      const contrast = valueNumber(atnGet(d, 'Cntr'))
      if (brightness === undefined || contrast === undefined) return null
      const out: Record<string, any> = { brightness, contrast }
      const legacy = valueBool(atnGet(d, 'useLegacy'))
      if (legacy !== undefined) out.legacy = legacy
      return out
    },
    write: p => makeDescriptor('BrgC', [
      ['Brgh', psInt(p.brightness ?? 0)],
      ['Cntr', psInt(p.contrast ?? 0)],
      ['useLegacy', psBool(p.legacy === true)],
    ]),
  },
  {
    code: 'HStr', names: ['HStr'], op: 'applyAdjustment', type: 'hue-saturation',
    classId: 'HStr', label: 'Hue/Saturation', keys: ['Clrz', 'Adjs'],
    read: readHueSaturation,
    write: writeHueSaturation,
  },
  {
    code: 'Pstr', names: ['Pstr'], op: 'applyAdjustment', type: 'posterize',
    classId: 'Pstr', label: 'Posterize', keys: ['Lvls'],
    read: d => {
      const levels = valueNumber(atnGet(d, 'Lvls'))
      return levels === undefined ? null : { levels }
    },
    write: p => makeDescriptor('Pstr', [['Lvls', psInt(p.levels ?? 6)]]),
  },
  {
    code: 'Thrs', names: ['Thrs'], op: 'applyAdjustment', type: 'threshold',
    classId: 'Thrs', label: 'Threshold', keys: ['Lvl '],
    read: d => {
      const level = valueNumber(atnGet(d, 'Lvl '))
      return level === undefined ? null : { level }
    },
    write: p => makeDescriptor('Thrs', [['Lvl ', psInt(p.level ?? 128)]]),
  },
  {
    code: 'Invr', names: ['Invr'], op: 'applyAdjustment', type: 'invert',
    classId: 'Invr', label: 'Invert', keys: [],
    read: () => ({}),
    write: () => makeDescriptor('Invr'),
  },
  {
    code: 'Dstt', names: ['desaturate'], op: 'applyAdjustment', type: 'desaturate',
    classId: 'Dstt', label: 'Desaturate', keys: [],
    read: () => ({}),
    write: () => makeDescriptor('Dstt'),
  },
  {
    // Photoshop records Exposure by name in some versions; the class id is
    // the string id `exposure`. Keys: exposure (stops), gamma, offset.
    code: '', names: ['exposure'], op: 'applyAdjustment', type: 'exposure',
    classId: 'exposure', label: 'Exposure', keys: ['ExpS', 'GmmC', 'Offs'],
    read: d => {
      const exposure = valueNumber(atnGet(d, 'ExpS'))
      const gamma = valueNumber(atnGet(d, 'GmmC'))
      const offset = valueNumber(atnGet(d, 'Offs'))
      if (exposure === undefined) return null
      const out: Record<string, any> = { exposure }
      if (gamma !== undefined) out.gamma = gamma
      if (offset !== undefined) out.offset = offset
      return out
    },
    write: p => {
      const items: [string, AtnValue][] = [['ExpS', psDbl(p.exposure ?? 0)]]
      if (typeof p.gamma === 'number') items.push(['GmmC', psDbl(p.gamma)])
      if (typeof p.offset === 'number') items.push(['Offs', psDbl(p.offset)])
      return makeDescriptor('exposure', items)
    },
  },
  {
    // Color Balance. Keys: `CtnM` (tones: Shdw/Mid/Hgh/Mstr), `CtnV` (RGB
    // balance in range [-100, 100]). Photoshop stores the tone as an
    // enumeration and the values as a double array.
    code: 'CBr ', names: ['colorBalance'], op: 'applyAdjustment', type: 'color-balance',
    classId: 'CBl ', label: 'Color Balance', keys: ['CtnM', 'CtnV'],
    read: d => {
      const tones = valueEnum(atnGet(d, 'CtnM'))
      const values = atnGet(d, 'CtnV')
      if (!tones || !values || values.type !== 'list' || values.items.length !== 3) return null
      const rv = valueNumber(values.items[0])
      const gv = valueNumber(values.items[1])
      const bv = valueNumber(values.items[2])
      if (rv === undefined || gv === undefined || bv === undefined) return null
      return { tones, shadows: rv, midtones: gv, highlights: bv }
    },
    write: p => {
      const tones = enumCode({ Shdw: 'Shadows', 'Mid ': 'Midtones', Hgh: 'Highlights', Mstr: 'Master' }, p.tones ?? 'Midtones')
      if (!tones) return null
      return makeDescriptor('CBl ', [
        ['CtnM', psEnum('CtnM', tones)],
        ['CtnV', { type: 'list', items: [
          { type: 'double', value: p.shadows ?? 0 },
          { type: 'double', value: p.midtones ?? 0 },
          { type: 'double', value: p.highlights ?? 0 },
        ] }],
      ])
    },
  },
  {
    code: 'Eqlz', names: ['equalize'], op: 'applyAdjustment', type: 'equalize',
    classId: 'Eqlz', label: 'Equalize', keys: [],
    read: () => ({}),
    write: () => makeDescriptor('Eqlz'),
  },
  {
    // Photoshop records Vibrance by name, not by code; the class is the
    // string id `vibrance`.
    code: '', names: ['vibrance'], op: 'applyAdjustment', type: 'vibrance',
    classId: 'vibrance', label: 'Vibrance', keys: ['vibrance', 'Strt'],
    read: d => {
      const out: Record<string, any> = {}
      const vibrance = valueNumber(atnGet(d, 'vibrance'))
      const saturation = valueNumber(atnGet(d, 'Strt'))
      if (vibrance !== undefined) out.vibrance = vibrance
      if (saturation !== undefined) out.saturation = saturation
      return Object.keys(out).length ? out : null
    },
    write: p => {
      const items: [string, AtnValue][] = []
      if (typeof p.vibrance === 'number') items.push(['vibrance', psInt(p.vibrance)])
      if (typeof p.saturation === 'number') items.push(['Strt', psInt(p.saturation)])
      return items.length ? makeDescriptor('vibrance', items) : makeDescriptor('vibrance')
    },
  },
]

const DOCUMENT_MAPPINGS: AtnMapping[] = [
  {
    code: 'FltI', names: ['flattenImage'], op: 'flatten',
    classId: 'null', label: 'Flatten Image', keys: [],
    read: () => ({}),
    write: () => makeDescriptor('null'),
  },
  {
    code: 'ImgS', names: ['imageSize'], op: 'resizeImage',
    classId: 'null', label: 'Image Size', keys: ['Wdth', 'Hght', 'Rslt', 'Intr', 'CnsP', 'scaleStyles'],
    read: d => {
      const w = valuePixels(atnGet(d, 'Wdth'))
      const h = valuePixels(atnGet(d, 'Hght'))
      if (w === undefined || h === undefined) return null
      const out: Record<string, any> = { w: Math.round(w), h: Math.round(h) }
      const resolution = valueNumber(atnGet(d, 'Rslt'))
      if (resolution !== undefined) out.resolutionPpi = resolution
      // Photoshop resamples only when the event names an interpolation.
      out.resample = atnGet(d, 'Intr') !== undefined
      return out
    },
    write: p => {
      const items: [string, AtnValue][] = [['Wdth', psPx(p.w ?? 0)], ['Hght', psPx(p.h ?? 0)]]
      if (typeof p.resolutionPpi === 'number') items.push(['Rslt', psRsl(p.resolutionPpi)])
      if (p.resample !== false) items.push(['Intr', psEnum('Intp', 'Bcbc')])
      return makeDescriptor('null', items)
    },
  },
]

const MAPPINGS: AtnMapping[] = [...FILTER_MAPPINGS, ...ADJUSTMENT_MAPPINGS, ...DOCUMENT_MAPPINGS]

// ------------------------------------------------- Hue/Saturation details

/**
 * The keys a master Hue/Saturation entry may carry. An entry with
 * `LclR` is a colour range (Reds, Yellows, …), which our single
 * Hue/Saturation adjustment cannot express — such a step is kept.
 */
const HUE_MASTER_KEYS = new Set(['H   ', 'Hue ', 'Strt', 'Lght'])

function readHueSaturation(d: AtnDescriptor): Record<string, any> | null {
  const list = atnGet(d, 'Adjs')
  if (!list || list.type !== 'list' || !list.items.length) return null
  let master: AtnDescriptor | undefined
  for (const entry of list.items) {
    if (entry.type !== 'descriptor') return null
    if (atnGet(entry.descriptor, 'LclR')) return null
    master ??= entry.descriptor
  }
  if (!master || !master.items.length) return null
  for (const item of master.items) if (!HUE_MASTER_KEYS.has(item.key.text)) return null
  const out: Record<string, any> = {}
  const colorize = valueBool(atnGet(d, 'Clrz'))
  if (colorize !== undefined) out.colorize = colorize
  const hue = valueNumber(atnGet(master, 'H   ')) ?? valueNumber(atnGet(master, 'Hue '))
  if (hue !== undefined) out.hue = hue
  const saturation = valueNumber(atnGet(master, 'Strt'))
  if (saturation !== undefined) out.saturation = saturation
  const lightness = valueNumber(atnGet(master, 'Lght'))
  if (lightness !== undefined) out.lightness = lightness
  return out
}

function writeHueSaturation(p: Record<string, any>): AtnDescriptor | null {
  const master = makeDescriptor('Hst2', [
    ['H   ', psInt(p.hue ?? 0)],
    ['Strt', psInt(p.saturation ?? 0)],
    ['Lght', psInt(p.lightness ?? 0)],
  ])
  return makeDescriptor('HStr', [
    ['presetKind', psEnum('presetKindType', 'presetKindCustom')],
    ['Clrz', psBool(p.colorize === true)],
    ['Adjs', { type: 'list', items: [{ type: 'descriptor', descriptor: master }] }],
  ])
}

// ---------------------------------------------------------------- import

/** What an `.atn` import produced. */
export interface AtnImport {
  /** One studio action per action in the set. */
  actions: PsAction[]
  /** How many steps were mapped to studio operations. */
  mapped: number
  /** How many steps were kept verbatim (skipped on playback). */
  kept: number
}

function newActionId(): string {
  return `atn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Finds the mapping for an event id, matching the code or any of the
 * names the event is recorded by.
 */
function findMapping(id: string): AtnMapping | undefined {
  const trimmed = id.trim()
  return MAPPINGS.find(m => (m.code && m.code === id) || m.names.some(n => n === trimmed))
}

/** `true` when every key of the descriptor is one the mapping understands. */
function keysAreKnown(mapping: AtnMapping, d: AtnDescriptor): boolean {
  return d.items.every(item => mapping.keys.includes(item.key.text) || TOLERATED_KEYS.has(item.key.text))
}

/** Clamps numeric parameters to the operation's own control ranges. */
function normalizeParams(mapping: AtnMapping, params: Record<string, any>): Record<string, any> | null {
  if (mapping.op === 'flatten') return {}
  if (mapping.op === 'resizeImage') {
    const w = Math.round(params.w), h = Math.round(params.h)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null
    const out: Record<string, any> = { w, h }
    if (typeof params.resolutionPpi === 'number' && Number.isFinite(params.resolutionPpi)) out.resolutionPpi = params.resolutionPpi
    out.resample = params.resample !== false
    return out
  }
  const def = mapping.type ? (mapping.op === 'applyFilter' ? FILTERS[mapping.type] : ADJUSTMENTS[mapping.type as keyof typeof ADJUSTMENTS]) : undefined
  if (!def) return null
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(params)) {
    const control = def.controls.find(c => c.key === key)
    if (!control) continue
    if (control.type === 'select') {
      const allowed = (control.options ?? []).map(o => o.value)
      if (!allowed.includes(value)) return null
      out[key] = value
    } else if (control.type === 'toggle') {
      out[key] = value === true
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      let n = value
      if (control.min !== undefined) n = Math.max(control.min, n)
      if (control.max !== undefined) n = Math.min(control.max, n)
      out[key] = n
    } else {
      out[key] = value
    }
  }
  return out
}

/** The engine's argument shape for a mapped op. */
function argsFor(mapping: AtnMapping, params: Record<string, any>): Record<string, any> {
  if (mapping.op === 'flatten') return {}
  if (mapping.op === 'resizeImage') return { ...params }
  return { type: mapping.type, params }
}

/** Maps a `.atn` step to a studio step, or `null` to keep it verbatim. */
function mapStep(step: AtnStep): ActionStep | null {
  const mapping = findMapping(atnEventId(step.event))
  if (!mapping) return null
  if (!step.descriptor) {
    if (mapping.keys.length === 0) return { op: mapping.op, args: argsFor(mapping, {}), label: mapping.label }
    return null
  }
  if (!keysAreKnown(mapping, step.descriptor)) return null
  const params = mapping.read(step.descriptor)
  if (!params) return null
  const normalized = normalizeParams(mapping, params)
  if (!normalized) return null
  // Studio channel editing target: restore the target so re-import edits the
  // same components. The `ChnT` key is a Studio extension; Photoshop ignores it.
  const targetItem = step.descriptor.items.find(item => item.key.text.trim() === 'ChnT')
  if (targetItem && targetItem.value.type === 'enum') {
    const target = targetItem.value.value.text.trim()
    if (target === 'r' || target === 'g' || target === 'b' || target === 'rg' || target === 'rb' || target === 'gb') {
      normalized.target = target
    }
  }
  return { op: mapping.op, args: argsFor(mapping, normalized), label: mapping.label }
}

/** Converts a parsed action set to studio actions. */
export function atnToStudioActions(set: AtnActionSet): AtnImport {
  const actions: PsAction[] = []
  let mapped = 0
  let kept = 0
  for (const action of set.actions) {
    const steps: ActionStep[] = []
    for (const step of action.steps) {
      const studio = mapStep(step)
      if (studio) {
        steps.push(studio)
        mapped++
        continue
      }
      steps.push({
        op: KEPT_STEP_OP,
        args: { atn: atnStepToJson(step) },
        label: atnStepLabel(step),
      })
      kept++
    }
    actions.push({
      id: newActionId(),
      name: atnUnicodeText(action.name).trim() || 'Action',
      steps,
      created: Date.now(),
    })
  }
  return { actions, mapped, kept }
}

/** Parses an `.atn` file and converts it to studio actions. */
export function readAtnActions(data: Uint8Array): AtnImport & { setName: string; warnings: string[] } {
  const set = parseAtn(data)
  const { actions, mapped, kept } = atnToStudioActions(set)
  return { actions, mapped, kept, setName: atnUnicodeText(set.name).trim(), warnings: set.warnings }
}

// ---------------------------------------------------------------- export

/** Merges an operation's defaults into its recorded parameters. */
function mergedParams(mapping: AtnMapping, params: Record<string, any>): Record<string, any> {
  const def = mapping.type ? (mapping.op === 'applyFilter' ? FILTERS[mapping.type] : ADJUSTMENTS[mapping.type as keyof typeof ADJUSTMENTS]) : undefined
  return def ? { ...def.defaults, ...params } : params
}

/** The event a mapping is recorded by. */
function eventFor(mapping: AtnMapping): AtnEvent {
  return mapping.code ? { kind: 'code', code: mapping.code } : { kind: 'name', name: mapping.names[0] }
}

/** Finds the mapping that plays as a studio op. */
function findMappingForOp(op: string, type?: string): AtnMapping | undefined {
  return MAPPINGS.find(m => m.op === op && (m.type === undefined || m.type === type))
}

/** Converts a studio step to a `.atn` step, or `null` when it cannot be expressed. */
function stepToAtn(step: ActionStep): AtnStep | null {
  if (step.op === KEPT_STEP_OP) return atnStepFromJson(step.args?.atn)
  const mapping = findMappingForOp(step.op, step.args?.type)
  if (!mapping) return null
  const params = mergedParams(mapping, step.args?.params ?? step.args ?? {})
  const descriptor = mapping.write(params)
  if (!descriptor) return null
  // Studio channel editing target: record it so re-import restricts the same
  // components. Photoshop has no equivalent key, so the step is kept verbatim
  // by Photoshop but round-trips faithfully in Studio.
  const target = step.args?.target
  if (typeof target === 'string' && target !== 'composite') {
    descriptor.items.push({ key: atnId('ChnT'), value: psEnum('ChnT', target) })
  }
  return atnStep(eventFor(mapping), mapping.label, descriptor)
}

/**
 * The step an export actually writes. An operation Photoshop has no event
 * for stays visible as a named step (without a descriptor) rather than
 * being dropped silently: Photoshop shows it in the Actions panel and
 * skips it on playback, and importing the file again keeps it.
 */
function stepToAtnWritten(step: ActionStep): AtnStep {
  return stepToAtn(step) ?? atnStep({ kind: 'name', name: `zphoto.${step.op}` }, step.label)
}

/** Converts studio actions to an action set, ready to be written. */
export function studioActionsToAtn(actions: readonly PsAction[], setName = 'Photo Studio Actions'): AtnActionSet {
  const set = atnActionSet(setName)
  for (const action of actions) {
    const atn = atnAction(action.name)
    for (const step of action.steps) {
      atn.steps.push(stepToAtnWritten(step))
    }
    set.actions.push(atn)
  }
  return set
}

/** Writes studio actions as an `.atn` file. */
export function writeAtnActions(actions: readonly PsAction[], setName = 'Photo Studio Actions'): Uint8Array {
  return writeAtn(studioActionsToAtn(actions, setName))
}

/** The number of steps an export could express as Photoshop events. */
export function countExpressibleSteps(actions: readonly PsAction[]): number {
  return actions.reduce((n, action) => n + action.steps.filter(step => stepToAtn(step) !== null).length, 0)
}
