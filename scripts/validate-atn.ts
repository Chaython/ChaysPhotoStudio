// ============================================================
// Validator for the Photoshop Actions (.atn) interchange.
//
//   1. the Action Descriptor reader/writer round-trips byte for byte
//   2. an .atn file read and written again is byte for byte the same
//   3. a version 12 (Photoshop 5) legacy file reads
//   4. kept steps survive a round trip through the JSON-safe form
//   5. the event mappings produce the parameters they claim to
//   6. a mapped step exports back to the Photoshop event it came from
//   7. the JSON-safe descriptor form survives JSON.stringify
//
// Run with:  node --import ts-register.mjs scripts/validate-atn.ts
// ============================================================

import assert from 'node:assert/strict'
import {
  AtnReader, AtnWriter, atnBool, atnGet, atnId, atnUnicodeNul,
  readAtnDescriptor, readAtnValue, writeAtnDescriptor, writeAtnValue,
  type AtnDescriptor, type AtnValue,
} from '../src/editor/formats/atn-descriptor'
import {
  ATN_VERSION, parseAtn, writeAtn,
  atnAction, atnActionSet, atnStep,
  type AtnActionSet, type AtnStep,
} from '../src/editor/formats/atn'
import {
  atnStepFromJson, atnStepToJson, countExpressibleSteps,
  descriptorFromJson, descriptorToJson,
  readAtnActions, writeAtnActions,
} from '../src/editor/formats/atn-actions'
import type { ActionStep, PsAction } from '../src/editor/types'

// ---------------------------------------------------------------- builders

const px = (v: number): AtnValue => ({ type: 'unitFloat', unit: '#Pxl', value: v })
const pct = (v: number): AtnValue => ({ type: 'unitFloat', unit: '#Prc', value: v })
const ang = (v: number): AtnValue => ({ type: 'unitFloat', unit: '#Ang', value: v })
const int = (v: number): AtnValue => ({ type: 'integer', value: v })
const dbl = (v: number): AtnValue => ({ type: 'double', value: v })
const bool = (v: boolean): AtnValue => ({ type: 'boolean', value: v })
const enm = (typeId: string, value: string): AtnValue => ({ type: 'enum', typeId: atnId(typeId), value: atnId(value) })

function desc(classId: string, items: [string, AtnValue][] = []): AtnDescriptor {
  return { name: { units: [] }, classId: atnId(classId), items: items.map(([k, v]) => ({ key: atnId(k), value: v })) }
}

/** A v16 .atn byte image of one action with the given steps. */
function atnFile(setName: string, actionName: string, steps: AtnStep[]): Uint8Array {
  const set = atnActionSet(setName)
  const action = atnAction(actionName)
  action.steps.push(...steps)
  set.actions.push(action)
  return writeAtn(set)
}

/** A modern filter step: a 4-character code event plus its descriptor. */
function filterStep(code: string, panelName: string, d: AtnDescriptor): AtnStep {
  const step = atnStep({ kind: 'code', code }, panelName, d)
  return step
}

/** A Photoshop string event (no code): how Box Blur and Vibrance are recorded. */
function namedStep(name: string, panelName: string, d?: AtnDescriptor): AtnStep {
  return atnStep({ kind: 'name', name }, panelName, d)
}

// ---------------------------------------------------------------- 1. descriptors

function roundTripValue(v: AtnValue): AtnValue {
  const w = new AtnWriter()
  writeAtnValue(w, v)
  const r = new AtnReader(w.finish())
  return readAtnValue(r)
}

function testDescriptorRoundTrip() {
  const cases: AtnValue[] = [
    { type: 'reference', items: [{ type: 'property', cls: { name: { units: [] }, id: atnId('Lyr ') }, key: atnId('Rds ') }] },
    { type: 'descriptor', descriptor: desc('null', [['Rds ', px(4)], ['Nose', pct(12)]]), },
    { type: 'globalObject', descriptor: desc('GltG') },
    { type: 'list', items: [int(1), dbl(2.5), bool(true), { type: 'text', value: atnUnicodeNul('hi') }] },
    { type: 'double', value: -0.5 },
    { type: 'unitFloat', unit: '#Ang', value: 135 },
    { type: 'unitFloats', unit: '#Pxl', values: [1, 2, 3] },
    { type: 'text', value: atnUnicodeNul('Gaussian Blur') },
    { type: 'enum', typeId: atnId('BlrM'), value: atnId('Spn ') },
    { type: 'integer', value: -7 },
    { type: 'largeInteger', value: -1 },
    { type: 'boolean', value: true },
    { type: 'class', cls: { name: atnUnicodeNul('Layer'), id: atnId('Lyr ') } },
    { type: 'globalClass', cls: { name: { units: [] }, id: atnId('null') } },
    { type: 'alias', bytes: Uint8Array.from([1, 2, 3]) },
    { type: 'path', bytes: Uint8Array.from([9]) },
    { type: 'rawData', bytes: Uint8Array.from([4, 5, 6, 7]) },
    { type: 'objectArray', prefix: 16, body: desc('Crvs', [['Adjs', { type: 'list', items: [int(1)] }]]) },
  ]
  for (const v of cases) assert.deepEqual(roundTripValue(v), v, `value ${v.type}`)

  // ids remember whether they were a code or a string: to Photoshop the two
  // are different keys, so a read/write cycle must not collapse them.
  const codeId = atnId('Rds ')
  assert.equal(codeId.code, true)
  const stringId = atnId('presetKind')
  assert.equal(stringId.code, false)

  const d = desc('null', [
    ['Rds ', px(3.5)],
    ['useLegacy', bool(false)],
    ['presetKind', enm('presetKindType', 'presetKindCustom')],
    ['Adjs', { type: 'list', items: [{ type: 'descriptor', descriptor: desc('Hst2', [['H   ', int(10)], ['Strt', int(-20)], ['Lght', int(5)]]) }] }],
  ])
  const w = new AtnWriter()
  writeAtnDescriptor(w, d)
  const back = readAtnDescriptor(new AtnReader(w.finish()))
  assert.deepEqual(back, d)
  assert.equal(atnGet(back, 'Rds ')?.type, 'unitFloat')
  assert.equal(atnGet(back, 'Rds ') && atnBool(atnGet(back, 'useLegacy')), false)
}

// ---------------------------------------------------------------- 2. file round trip

function testFileRoundTrip() {
  const steps: AtnStep[] = [
    filterStep('GsnB', 'Gaussian Blur', desc('null', [['Rds ', px(4)], ['T   ', { type: 'reference', items: [] }]])),
    filterStep('MtnB', 'Motion Blur', desc('null', [['Angl', ang(45)], ['Dstn', px(20)]])),
    atnStep({ kind: 'name', name: 'boxblur' }, 'Box Blur', desc('null', [['Rds ', px(8)]])),
    atnStep({ kind: 'code', code: 'FltI' }, 'Flatten Image'),
    { ...atnStep({ kind: 'code', code: 'Invr' }, 'Invert'), expanded: true, enabled: false, withDialog: true, dialogOptions: 3 },
  ]
  const bytes = atnFile('My Set', 'My Action', steps)
  const parsed = parseAtn(bytes)
  assert.equal(parsed.version, ATN_VERSION)
  const written = writeAtn(parsed)
  assert.deepEqual([...written], [...bytes], 'a v16 file must survive a read/write cycle byte for byte')

  // A second cycle is stable too.
  assert.deepEqual([...writeAtn(parseAtn(written))], [...written])
}

// ---------------------------------------------------------------- 3. legacy read

function testLegacyRead() {
  // A version 12 file: no name/class at the root, every id a bare code.
  const w = new AtnWriter()
  w.u32(12)
  // set name (Unicode), expanded, action count
  w.u32(4); w.u16(0x004f); w.u16(0x006c); w.u16(0x0064); w.u16(0x0000) // "Old" + NUL
  w.u8(1)
  w.u32(1)
  // action: fn key, shift, command, colour, name, expanded, step count
  w.u16(0); w.u8(0); w.u8(0); w.u16(0)
  w.u32(5); w.u16(0x0047); w.u16(0x0072); w.u16(0x0061); w.u16(0x0064); w.u16(0x0000) // "Grad" + NUL
  w.u8(0)
  w.u32(1)
  // step: expanded, enabled, withDialog, dialogOptions, event kind, event, panel name, flag
  w.u8(0); w.u8(1); w.u8(0); w.u8(0)
  w.ascii('long'); w.ascii('BrgC')
  w.u32(8); w.ascii('Brighten')
  w.i32(-1)
  // legacy descriptor: item count, then bare-code items
  w.u32(2)
  w.ascii('Brgh'); w.ascii('long'); w.i32(30)
  w.ascii('Cntr'); w.ascii('long'); w.i32(-10)
  const bytes = w.finish()
  const set = parseAtn(bytes)
  assert.equal(set.version, 12)
  assert.equal(set.actions.length, 1)
  assert.equal(set.actions[0].steps.length, 1)
  const step = set.actions[0].steps[0]
  assert.equal(step.descriptor?.items.length, 2)
  // Legacy descriptors have no root name or class.
  assert.equal(step.descriptor?.name.units.length, 0)
  assert.equal(step.descriptor?.classId.text, 'null')

  // The Brightness/Contrast mapping reads it, because bare legacy codes and
  // the modern form carry the same key text.
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 1)
  assert.equal(imported.kept, 0)
  const args = imported.actions[0].steps[0].args
  assert.equal(args.type, 'brightness-contrast')
  assert.equal(args.params.brightness, 30)
  assert.equal(args.params.contrast, -10)
}

// ---------------------------------------------------------------- 4. kept steps

function testKeptSteps() {
  // An event this studio has no operation for, and one whose descriptor
  // carries a setting we cannot express, must both survive unchanged.
  const unknown = atnStep({ kind: 'code', code: 'Crst' }, 'Crystallize', desc('null', [['ClSz', px(9)], ['GlwT', int(1)]]))
  const bytes = atnFile('Kept', 'Kept Action', [unknown])
  const imported = readAtnActions(bytes)
  assert.equal(imported.mapped, 0)
  assert.equal(imported.kept, 1)
  const step = imported.actions[0].steps[0]
  assert.equal(step.op, 'photoshop')

  // The JSON-safe form must survive JSON.stringify / parse.
  const json = JSON.parse(JSON.stringify(step.args.atn))
  const restored = atnStepFromJson(json)
  assert.ok(restored)
  const rebuilt = atnActionSet('Kept')
  const action = atnAction('Kept Action')
  action.steps.push(restored!)
  rebuilt.actions.push(action)
  assert.deepEqual([...writeAtn(rebuilt)], [...bytes], 'a kept step must be written back exactly')

  // A kept step is skipped on playback, not mis-applied.
  const actionStep: ActionStep = { op: 'photoshop', args: { atn: atnStepToJson(unknown) }, label: 'Crystallize' }
  assert.equal(atnStepFromJson(actionStep.args.atn)?.descriptor?.items.length, 2)
}

// ---------------------------------------------------------------- 5. mappings

function testMappings() {
  const mapped = (steps: AtnStep[]): PsAction[] => readAtnActions(atnFile('S', 'A', steps)).actions

  // Gaussian Blur
  const [gauss] = mapped([filterStep('GsnB', 'Gaussian Blur', desc('null', [['Rds ', px(6.5)]]))])
  assert.equal(gauss.steps[0].op, 'applyFilter')
  assert.equal(gauss.steps[0].args.type, 'gaussian-blur')
  assert.equal(gauss.steps[0].args.params.radius, 6.5)

  // Motion Blur
  const [motion] = mapped([filterStep('MtnB', 'Motion Blur', desc('null', [['Angl', ang(45)], ['Dstn', px(30)]]))])
  assert.equal(motion.steps[0].args.params.angle, 45)
  assert.equal(motion.steps[0].args.params.distance, 30)

  // Radial Blur (spin / good)
  const [radial] = mapped([filterStep('RdlB', 'Radial Blur', desc('null', [['Amnt', int(25)], ['BlrM', enm('BlrM', 'Spn ')], ['BlrQ', enm('BlrQ', 'Bst ')]]))])
  assert.equal(radial.steps[0].args.params.amount, 25)
  assert.equal(radial.steps[0].args.params.method, 'spin')
  assert.equal(radial.steps[0].args.params.quality, 'best')

  // Add Noise (gaussian, monochromatic)
  const [noise] = mapped([filterStep('AdNs', 'Add Noise', desc('null', [['Nose', pct(18)], ['Dstr', enm('Dstr', 'Gsn ')], ['Mnch', bool(true)], ['FlRs', int(7)]]))])
  assert.equal(noise.steps[0].args.params.amount, 18)
  assert.equal(noise.steps[0].args.params.distribution, 'gaussian')
  assert.equal(noise.steps[0].args.params.monochromatic, true)

  // Unsharp Mask
  const [unsharp] = mapped([filterStep('UnsM', 'Unsharp Mask', desc('null', [['Amnt', pct(110)], ['Rds ', px(2.5)], ['Thsh', int(3)]]))])
  assert.equal(unsharp.steps[0].args.type, 'smart-sharpen')
  assert.equal(unsharp.steps[0].args.params.amount, 110)
  assert.equal(unsharp.steps[0].args.params.radius, 2.5)
  assert.equal(unsharp.steps[0].args.params.threshold, 3)

  // Offset (repeat fill)
  const [offset] = mapped([filterStep('Ofst', 'Offset', desc('null', [['Hrzn', int(12)], ['Vrtc', int(-7)], ['Fl  ', enm('FlMd', 'Rpt ')]]))])
  assert.equal(offset.steps[0].args.params.horizontal, 12)
  assert.equal(offset.steps[0].args.params.vertical, -7)
  assert.equal(offset.steps[0].args.params.edgeMode, 'repeat-edge')

  // Wind: Photoshop names the direction the streaks extend, so `Left` is
  // "from the right" here.
  const [wind] = mapped([filterStep('Wnd ', 'Wind', desc('null', [['WndM', enm('WndM', 'Wnd ')], ['Drct', enm('Drct', 'Left')], ['Strt', int(10)]]))])
  assert.equal(wind.steps[0].args.params.method, 'wind')
  assert.equal(wind.steps[0].args.params.direction, 'right')
  assert.equal(wind.steps[0].args.params.strength, 10)

  // Box Blur, recorded by name
  const [box] = mapped([namedStep('boxblur', 'Box Blur', desc('null', [['Rds ', px(8)]]))])
  assert.equal(box.steps[0].args.type, 'box-blur')
  assert.equal(box.steps[0].args.params.radius, 8)

  // Average and Find Edges carry no parameters
  const [paramless] = mapped([atnStep({ kind: 'code', code: 'Avrg' }, 'Average'), atnStep({ kind: 'code', code: 'FndE' }, 'Find Edges')])
  assert.equal(paramless.steps[0].args.type, 'average')
  assert.equal(paramless.steps[1].args.type, 'find-edges')

  // Hue/Saturation master entry
  const [hue] = mapped([filterStep('HStr', 'Hue/Saturation', desc('HStr', [
    ['presetKind', enm('presetKindType', 'presetKindCustom')],
    ['Clrz', bool(true)],
    ['Adjs', { type: 'list', items: [{ type: 'descriptor', descriptor: desc('Hst2', [['H   ', int(30)], ['Strt', int(-15)], ['Lght', int(5)]]) }] }],
  ]))])
  assert.equal(hue.steps[0].args.type, 'hue-saturation')
  assert.equal(hue.steps[0].args.params.hue, 30)
  assert.equal(hue.steps[0].args.params.saturation, -15)
  assert.equal(hue.steps[0].args.params.lightness, 5)
  assert.equal(hue.steps[0].args.params.colorize, true)

  // A Hue/Saturation that adjusts a colour range cannot be played faithfully.
  const [hueRange] = mapped([filterStep('HStr', 'Hue/Saturation', desc('HStr', [
    ['Adjs', { type: 'list', items: [{ type: 'descriptor', descriptor: desc('Hst2', [['LclR', int(1)], ['H   ', int(30)], ['Strt', int(0)], ['Lght', int(0)]]) }] }],
  ]))])
  assert.equal(hueRange.steps[0].op, 'photoshop')

  // Posterize, Threshold, Invert
  const [posterize] = mapped([filterStep('Pstr', 'Posterize', desc('Pstr', [['Lvls', int(8)]]))])
  assert.equal(posterize.steps[0].args.params.levels, 8)
  const [threshold] = mapped([filterStep('Thrs', 'Threshold', desc('Thrs', [['Lvl ', int(200)]]))])
  assert.equal(threshold.steps[0].args.params.level, 200)
  const [invert] = mapped([filterStep('Invr', 'Invert', desc('Invr'))])
  assert.equal(invert.steps[0].args.type, 'invert')

  // Desaturate and Equalize carry no parameters
  const [desat] = mapped([filterStep('Dstt', 'Desaturate', desc('Dstt'))])
  assert.equal(desat.steps[0].args.type, 'desaturate')
  const [equalize] = mapped([filterStep('Eqlz', 'Equalize', desc('Eqlz'))])
  assert.equal(equalize.steps[0].args.type, 'equalize')

  // Vibrance, recorded by name
  const [vibrance] = mapped([namedStep('vibrance', 'Vibrance', desc('vibrance', [['vibrance', int(40)], ['Strt', int(10)]]))])
  assert.equal(vibrance.steps[0].args.params.vibrance, 40)
  assert.equal(vibrance.steps[0].args.params.saturation, 10)

  // Flatten and Image Size
  const [doc] = mapped([
    atnStep({ kind: 'code', code: 'FltI' }, 'Flatten Image'),
    filterStep('ImgS', 'Image Size', desc('null', [['Wdth', px(800)], ['Hght', px(600)], ['Rslt', { type: 'unitFloat', unit: '#Rsl', value: 300 }], ['Intr', enm('Intp', 'Bcbc')]])),
  ])
  assert.equal(doc.steps[0].op, 'flatten')
  assert.equal(doc.steps[1].op, 'resizeImage')
  assert.equal(doc.steps[1].args.w, 800)
  assert.equal(doc.steps[1].args.h, 600)
  assert.equal(doc.steps[1].args.resolutionPpi, 300)
  assert.equal(doc.steps[1].args.resample, true)

  // A setting the descriptor cannot express keeps the step: Spherize squeezed
  // on one axis only, and a Wave that varies its amplitude.
  const [spherize] = mapped([filterStep('Sphr', 'Spherize', desc('null', [['Amnt', int(50)], ['SphM', enm('SphM', 'HrzO')]]))])
  assert.equal(spherize.steps[0].op, 'photoshop')
  const [wave] = mapped([filterStep('Wave', 'Wave', desc('null', [['Wvtp', enm('Wvtp', 'WvSn')], ['AmMn', int(10)], ['AmMx', int(35)], ['WLMn', int(10)], ['WLMx', int(120)], ['NmbG', int(5)]]))])
  assert.equal(wave.steps[0].op, 'photoshop')

  // Values outside our control ranges are clamped, not rejected: a Gaussian
  // Blur wider than the slider still blurs by our widest radius.
  const [wide] = mapped([filterStep('GsnB', 'Gaussian Blur', desc('null', [['Rds ', px(900)]]))])
  assert.equal(wide.steps[0].args.params.radius, 250)
}

// ---------------------------------------------------------------- 6. export

function testExport() {
  const action: PsAction = {
    id: 'a1', name: 'Test Action', created: 0,
    steps: [
      { op: 'applyFilter', args: { type: 'gaussian-blur', params: { radius: 5 } }, label: 'Gaussian Blur' },
      { op: 'applyAdjustment', args: { type: 'brightness-contrast', params: { brightness: 20, contrast: -5, legacy: true } }, label: 'Brightness/Contrast' },
      { op: 'flatten', args: {}, label: 'Flatten Image' },
      { op: 'crop', args: { x: 0, y: 0, w: 10, h: 10 }, label: 'Crop' },
    ],
  }
  const bytes = writeAtnActions([action], 'Exported')
  const set = parseAtn(bytes)
  assert.equal(set.actions.length, 1)
  const [gsn, brg, flt, crop] = set.actions[0].steps
  assert.equal(gsn.event.kind === 'code' && gsn.event.code, 'GsnB')
  assert.deepEqual(gsn.descriptor?.items.map(i => i.key.text), ['Rds '])
  assert.equal(brg.event.kind === 'code' && brg.event.code, 'BrgC')
  assert.equal(brg.descriptor?.items.length, 3)
  assert.equal(flt.event.kind === 'code' && flt.event.code, 'FltI')
  // An operation Photoshop has no event for stays visible, without a descriptor.
  assert.equal(crop.event.kind, 'name')
  assert.equal(crop.event.kind === 'name' && crop.event.name, 'zphoto.crop')
  assert.equal(crop.dictionary, 'Crop')

  // And Photoshop reads the exported file back into the same edits.
  const round = readAtnActions(bytes)
  assert.equal(round.mapped, 3)
  assert.equal(round.kept, 1)
  assert.equal(round.actions[0].steps[0].args.type, 'gaussian-blur')
  assert.equal(round.actions[0].steps[0].args.params.radius, 5)
  assert.equal(round.actions[0].steps[1].args.params.legacy, true)
  assert.equal(round.actions[0].steps[2].op, 'flatten')

  // Every step is expressible except the crop.
  assert.equal(countExpressibleSteps([action]), 3)

  // An export with no steps at all is still a valid, empty set.
  const empty = parseAtn(writeAtnActions([], 'Empty'))
  assert.equal(empty.actions.length, 0)
}

// ---------------------------------------------------------------- 7. JSON safety

function testJsonSafety() {
  const d = desc('null', [
    ['Rds ', px(3.5)],
    ['Adjs', { type: 'list', items: [{ type: 'descriptor', descriptor: desc('Hst2', [['H   ', int(30)]]) }] }],
    ['Objc', { type: 'descriptor', descriptor: desc('Lyr ') }],
    ['alis', { type: 'alias', bytes: Uint8Array.from([1, 2, 3]) }],
    ['TEXT', { type: 'text', value: atnUnicodeNul('Héllo — 😀') }],
  ])
  const json = JSON.parse(JSON.stringify(descriptorToJson(d)))
  const back = descriptorFromJson(json)
  assert.ok(back)
  assert.deepEqual(back, d)

  // Malformed input is rejected, not crashed on.
  assert.equal(descriptorFromJson(null), null)
  assert.equal(descriptorFromJson({}), null)
  assert.equal(descriptorFromJson({ name: [], classId: { text: 'x', code: true }, items: [{ key: null }] }), null)
  assert.equal(atnStepFromJson(null), null)
  assert.equal(atnStepFromJson({ event: { kind: 'code', code: 'tooolong' } }), null)

  // A kept step's descriptor round-trips through JSON unchanged. The extra
  // key keeps the step a kept step instead of mapping to Crystallize.
  const bytes = atnFile('J', 'J', [filterStep('Crst', 'Crystallize', desc('null', [['ClSz', px(9)], ['GlwT', int(1)]]))])
  const imported = readAtnActions(bytes)
  const jsonStep = JSON.parse(JSON.stringify(imported.actions[0].steps[0].args.atn))
  const restored = atnStepFromJson(jsonStep)
  assert.ok(restored)
  const rebuilt = atnActionSet('J')
  const a = atnAction('J')
  a.steps.push(restored!)
  rebuilt.actions.push(a)
  assert.deepEqual([...writeAtn(rebuilt)], [...bytes])
}

// ---------------------------------------------------------------- runner

const tests: [string, () => void][] = [
  ['descriptor round-trip', testDescriptorRoundTrip],
  ['.atn file round-trip', testFileRoundTrip],
  ['version 12 legacy read', testLegacyRead],
  ['kept steps', testKeptSteps],
  ['event mappings', testMappings],
  ['export to .atn', testExport],
  ['JSON safety', testJsonSafety],
]

let failed = 0
for (const [name, run] of tests) {
  try {
    run()
    console.log(`  ok  ${name}`)
  } catch (err) {
    failed++
    console.error(`FAIL  ${name}`)
    console.error(err)
  }
}

if (failed) {
  console.error(`validate-atn: ${failed} test group(s) failed`)
  process.exit(1)
}
console.log('validate-atn: all checks passed')
