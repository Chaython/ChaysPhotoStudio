// ============================================================
// Photoshop Actions files (`.atn`).
//
// An `.atn` file holds one action set — the folder the Actions panel
// shows — with its actions and their steps. Every number is
// big-endian.
//
//   file   := version u32 (12 or 16), set name UnicodeString,
//             expanded u8, action count u32, count × action
//   action := function key u16 (0 = none, n = Fn), shift u8,
//             command u8, colour u16, name UnicodeString,
//             expanded u8, step count u32, count × step
//   step   := expanded u8, enabled u8, with dialog u8,
//             dialog options u8,
//             event kind [4]: "TEXT" (u32 length + bytes) |
//                            "long" (a 4-character event code),
//             dictionary name (u32 length + bytes: the name the
//             Actions panel shows),
//             descriptor flag i32 (-1 = a descriptor follows, 0 = none),
//             [descriptor]
//
// The descriptor is a plain Action Descriptor body (no version
// prefix): the event's parameters, exactly as Photoshop's own "Make",
// "Set" and "Gaussian Blur" events carry them.
//
// The event name and the panel name are byte strings, not Unicode —
// they are the authoring platform's legacy encoding when a Photoshop
// was localised. The bytes are kept verbatim so that a file read and
// written again is unchanged.
//
// Version 12 files (Photoshop 5) use a legacy descriptor layout:
// bare four-byte identifiers, and no name or class at the root. They
// are read; files are always written as version 16.
//
// Written from the published "Photoshop File Formats" specification
// and the observable behaviour of files Photoshop writes.
// ============================================================

import type { AtnDescriptor, AtnReference, AtnUnicode, AtnValue } from './atn-descriptor'
import {
  ATN_MAX_ITEMS,
  AtnReader,
  AtnWriter,
  atnId,
  atnUnicode,
  atnUnicodeNul,
  atnUnicodeText,
  latin1ToText,
  readAtnClass,
  readAtnDescriptor,
  readAtnId,
  readAtnUnicode,
  readAtnValue,
  textToLatin1,
  writeAtnClass,
  writeAtnDescriptor,
  writeAtnId,
  writeAtnUnicode,
  writeAtnValue,
} from './atn-descriptor'

/** The version this module writes (Photoshop 6 and every later release). */
export const ATN_VERSION = 16

/** Most actions read from one set (Photoshop's own sets hold a few dozen). */
export const ATN_MAX_ACTIONS = 10_000

/** Most steps read from one action. */
export const ATN_MAX_STEPS = 100_000

// ---------------------------------------------------------------- model

/** A Photoshop event id: a four-character code or a string name. */
export type AtnEvent =
  | { kind: 'code'; code: string }
  | { kind: 'name'; name: string }

/** One step of an action: a Photoshop event with its parameters. */
export interface AtnStep {
  /** Whether the step's parameters are shown expanded in the panel. */
  expanded: boolean
  /** The panel's check mark: a switched-off step is skipped on playback. */
  enabled: boolean
  /** The panel's dialog toggle: playback shows the step's dialog. */
  withDialog: boolean
  /** Dialog options (0 = none, 2 = show, 3 = don't show). */
  dialogOptions: number
  /** The event. */
  event: AtnEvent
  /** The name the Actions panel shows, kept as bytes. */
  dictionary: string
  /** The event's parameters; absent for events without any. */
  descriptor?: AtnDescriptor
}

/** One action of a set. */
export interface AtnAction {
  /** Function key that plays the action: 0 = none, n = Fn. */
  functionKey: number
  /** Shift modifier of the function key. */
  shift: boolean
  /** Command (Control on Windows) modifier of the function key. */
  command: boolean
  /** Button Mode colour index (0 = none, then red, orange, …). */
  color: number
  /** The action's name. */
  name: AtnUnicode
  /** Whether the action is shown expanded in the panel. */
  expanded: boolean
  /** The steps, in playback order. */
  steps: AtnStep[]
}

/** A parsed action set. */
export interface AtnActionSet {
  /** The set's name (the Actions panel folder). */
  name: AtnUnicode
  /** Whether the set is shown expanded in the panel. */
  expanded: boolean
  /** The actions, in panel order. */
  actions: AtnAction[]
  /** The version the file was read from (12 or 16). */
  version: number
  /** Problems that did not stop the parse. */
  warnings: string[]
}

// ---------------------------------------------------------------- helpers

/** The event's id as text: the code's four characters, or the name. */
export function atnEventId(event: AtnEvent): string {
  return event.kind === 'code' ? event.code : event.name
}

/** An event id as text. */
export function atnEventIs(event: AtnEvent, id: string): boolean {
  return atnEventId(event) === id
}

/** The step's panel name, decoded for display. */
export function atnStepLabel(step: AtnStep): string {
  const className = atnUnicodeText(step.descriptor?.name).trim()
  if (className) return className
  const bytes = textToLatin1(step.dictionary)
  try {
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    // A Latin-1 reading of non-ASCII bytes would show mojibake; the
    // UTF-8 reading replaces them, which is the better guess.
    return decoded.trim() || atnEventId(step.event)
  } catch {
    return latin1ToText(bytes).trim() || atnEventId(step.event)
  }
}

// ---------------------------------------------------------------- reading

/** Parses an `.atn` file (version 12 or 16). */
export function parseAtn(data: Uint8Array): AtnActionSet {
  const r = new AtnReader(data)
  const version = r.u32('an actions file version')
  if (version !== 12 && version !== ATN_VERSION) {
    throw new Error(`unsupported .atn file version ${version} (supported: 12 and ${ATN_VERSION})`)
  }
  const legacy = version === 12
  const name = readAtnUnicode(r)
  const expanded = r.u8('an expanded flag') !== 0
  const count = r.u32('an action count')
  if (count > ATN_MAX_ACTIONS) throw new Error('a .atn file declares too many actions')
  const actions: AtnAction[] = []
  for (let i = 0; i < count; i++) actions.push(readAction(r, legacy))
  const warnings: string[] = []
  if (!r.done) warnings.push(`${r.remaining} trailing bytes ignored`)
  return { name, expanded, actions, version, warnings }
}

/** Reads one action. */
function readAction(r: AtnReader, legacy: boolean): AtnAction {
  const functionKey = r.u16('a function key')
  const shift = r.u8('a shift flag') !== 0
  const command = r.u8('a command flag') !== 0
  const color = r.u16('a colour index')
  const name = readAtnUnicode(r)
  const expanded = r.u8('an expanded flag') !== 0
  const count = r.u32('a step count')
  if (count > ATN_MAX_STEPS) throw new Error('a .atn action declares too many steps')
  const steps: AtnStep[] = []
  for (let i = 0; i < count; i++) steps.push(readStep(r, legacy))
  return { functionKey, shift, command, color, name, expanded, steps }
}

/** Reads one step. */
function readStep(r: AtnReader, legacy: boolean): AtnStep {
  const expanded = r.u8('an expanded flag') !== 0
  const enabled = r.u8('an enabled flag') !== 0
  const withDialog = r.u8('a dialog flag') !== 0
  const dialogOptions = r.u8('dialog options')
  const kind = r.ascii(4, 'an event kind')
  let event: AtnEvent
  if (kind === 'TEXT') {
    const n = r.u32('an event name length')
    if (n > r.remaining) throw new Error('a .atn event name is longer than the file')
    event = { kind: 'name', name: latin1ToText(r.bytes(n, 'an event name')) }
  } else if (kind === 'long') {
    event = { kind: 'code', code: r.ascii(4, 'an event code') }
  } else {
    throw new Error(`unsupported .atn event kind "${kind}"`)
  }
  const dictLen = r.u32('a panel name length')
  if (dictLen > r.remaining) throw new Error('a .atn panel name is longer than the file')
  const dictionary = latin1ToText(r.bytes(dictLen, 'a panel name'))
  const flag = r.i32('a descriptor flag')
  let descriptor: AtnDescriptor | undefined
  if (flag === -1) {
    descriptor = legacy ? readLegacyRootDescriptor(r) : readAtnDescriptor(r)
  } else if (flag !== 0) {
    throw new Error(`invalid .atn descriptor flag ${flag}`)
  }
  return { expanded, enabled, withDialog, dialogOptions, event, dictionary, descriptor }
}

// ---------------------------------------------------------------- legacy

/**
 * The version 12 (Photoshop 5) descriptor dialect.
 *
 * Legacy descriptors have no name and no class at the root, and every
 * identifier is a bare four-byte code rather than a length-prefixed
 * string. They are read but never written: a file is always written
 * as version 16.
 */
function readLegacyRootDescriptor(r: AtnReader): AtnDescriptor {
  const d = readLegacyDescriptor(r, { text: 'null', code: true }, 0)
  return d
}

function readLegacyDescriptor(r: AtnReader, classId: { text: string; code: boolean }, depth: number): AtnDescriptor {
  if (depth > 64) throw new Error('a .atn descriptor is nested too deeply')
  const count = r.u32('a descriptor item count')
  if (count > ATN_MAX_ITEMS) throw new Error('a .atn descriptor declares too many items')
  const items: { key: { text: string; code: boolean }; value: AtnValue }[] = []
  for (let i = 0; i < count; i++) {
    const key = { text: r.ascii(4, 'a key code'), code: true }
    items.push({ key, value: readLegacyValue(r, depth + 1) })
  }
  return { name: { units: [] }, classId, items }
}

function readLegacyClass(r: AtnReader) {
  return { name: { units: [] as number[] }, id: { text: r.ascii(4, 'a class code'), code: true } }
}

function readLegacyValue(r: AtnReader, depth: number): AtnValue {
  if (depth > 64) throw new Error('a .atn value is nested too deeply')
  const type = r.ascii(4, 'a value type')
  switch (type) {
    case 'obj ': {
      const count = r.u32('a reference count')
      if (count > ATN_MAX_ITEMS) throw new Error('a .atn reference list declares too many items')
      const items: AtnReference[] = []
      for (let i = 0; i < count; i++) items.push(readLegacyReference(r))
      return { type: 'reference', items }
    }
    case 'Objc':
    case 'GlbO': {
      const classId = { text: r.ascii(4, 'a class code'), code: true }
      const descriptor = readLegacyDescriptor(r, classId, depth + 1)
      return type === 'Objc'
        ? { type: 'descriptor', descriptor }
        : { type: 'globalObject', descriptor }
    }
    case 'VlLs': {
      const count = r.u32('a list count')
      if (count > ATN_MAX_ITEMS) throw new Error('a .atn list declares too many items')
      const items: AtnValue[] = []
      for (let i = 0; i < count; i++) items.push(readLegacyValue(r, depth + 1))
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
      return {
        type: 'enum',
        typeId: { text: r.ascii(4, 'an enum type code'), code: true },
        value: { text: r.ascii(4, 'an enum value code'), code: true },
      }
    case 'long':
      return { type: 'integer', value: r.i32('an integer') }
    case 'comp':
      return { type: 'largeInteger', value: r.i64('a large integer') }
    case 'bool':
      return { type: 'boolean', value: r.u8('a boolean') !== 0 }
    case 'type':
      return { type: 'class', cls: readLegacyClass(r) }
    case 'GlbC':
      return { type: 'globalClass', cls: readLegacyClass(r) }
    case 'alis':
      return { type: 'alias', bytes: readLegacyBlob(r) }
    case 'Pth ':
      return { type: 'path', bytes: readLegacyBlob(r) }
    case 'tdta':
      return { type: 'rawData', bytes: readLegacyBlob(r) }
    case 'ObAr': {
      const classId = { text: r.ascii(4, 'a class code'), code: true }
      const prefix = r.u32('an object array prefix')
      return { type: 'objectArray', prefix, body: readLegacyDescriptor(r, classId, depth + 1) }
    }
    default:
      throw new Error(`unsupported legacy .atn value type "${type}"`)
  }
}

function readLegacyBlob(r: AtnReader): Uint8Array {
  const n = r.u32('a blob length')
  if (n > r.remaining) throw new Error('a .atn blob is longer than the file')
  return r.bytes(n, 'a blob').slice()
}

function readLegacyReference(r: AtnReader): AtnReference {
  const type = r.ascii(4, 'a reference type')
  const cls = readLegacyClass(r)
  switch (type) {
    case 'prop':
      return { type: 'property', cls, key: { text: r.ascii(4, 'a key code'), code: true } }
    case 'Clss':
      return { type: 'class', cls }
    case 'Enmr':
      return {
        type: 'enumerated',
        cls,
        typeId: { text: r.ascii(4, 'an enum type code'), code: true },
        value: { text: r.ascii(4, 'an enum value code'), code: true },
      }
    case 'rele':
      return { type: 'offset', cls, offset: r.i32('an offset') }
    case 'Idnt':
      return { type: 'identifier', cls, id: r.u32('an identifier') }
    case 'indx':
      return { type: 'index', cls, index: r.u32('an index') }
    case 'name':
      return { type: 'name', cls, name: readAtnUnicode(r) }
    default:
      throw new Error(`unsupported legacy .atn reference type "${type}"`)
  }
}

// ---------------------------------------------------------------- writing

/** Writes an `.atn` file (version 16). */
export function writeAtn(set: AtnActionSet): Uint8Array {
  const w = new AtnWriter()
  w.u32(ATN_VERSION)
  writeAtnUnicode(w, set.name)
  w.u8(set.expanded ? 1 : 0)
  w.u32(set.actions.length)
  for (const action of set.actions) writeAction(w, action)
  return w.finish()
}

/** Writes one action. */
function writeAction(w: AtnWriter, action: AtnAction): void {
  w.u16(action.functionKey)
  w.u8(action.shift ? 1 : 0)
  w.u8(action.command ? 1 : 0)
  w.u16(action.color)
  writeAtnUnicode(w, action.name)
  w.u8(action.expanded ? 1 : 0)
  w.u32(action.steps.length)
  for (const step of action.steps) writeStep(w, step)
}

/** Writes one step. */
function writeStep(w: AtnWriter, step: AtnStep): void {
  w.u8(step.expanded ? 1 : 0)
  w.u8(step.enabled ? 1 : 0)
  w.u8(step.withDialog ? 1 : 0)
  w.u8(step.dialogOptions)
  if (step.event.kind === 'name') {
    w.ascii('TEXT')
    const bytes = textToLatin1(step.event.name)
    w.u32(bytes.length)
    w.raw(bytes)
  } else {
    w.ascii('long')
    w.ascii(step.event.code)
  }
  const dict = textToLatin1(step.dictionary)
  w.u32(dict.length)
  w.raw(dict)
  if (step.descriptor) {
    w.i32(-1)
    writeAtnDescriptor(w, step.descriptor)
  } else {
    w.i32(0)
  }
}

// ---------------------------------------------------------------- building

/** A new, empty action set. */
export function atnActionSet(name: string): AtnActionSet {
  return {
    name: atnUnicodeNul(name),
    expanded: true,
    actions: [],
    version: ATN_VERSION,
    warnings: [],
  }
}

/** A new action in a set. */
export function atnAction(name: string): AtnAction {
  return {
    functionKey: 0,
    shift: false,
    command: false,
    color: 0,
    name: atnUnicodeNul(name),
    expanded: true,
    steps: [],
  }
}

/** A new step. */
export function atnStep(event: AtnEvent, dictionary: string, descriptor?: AtnDescriptor): AtnStep {
  return {
    expanded: false,
    enabled: true,
    withDialog: false,
    dialogOptions: 0,
    event,
    dictionary,
    descriptor,
  }
}

export { atnId, atnUnicode, atnUnicodeNul, atnUnicodeText, readAtnId, readAtnClass, readAtnValue, writeAtnId, writeAtnClass, writeAtnValue }
