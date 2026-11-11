import { strict as assert } from 'node:assert'
import {
  allMeasurementScalePresets,
  BUILTIN_MEASUREMENT_SCALE_PRESETS,
  deleteMeasurementScalePreset,
  loadMeasurementScalePresets,
  matchingMeasurementScalePreset,
  saveMeasurementScalePreset,
} from '../src/editor/tools/measure-scale-presets'

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
  },
})

const values = { unit: 'in' as const, useDocResolution: false, pixelsPerUnit: 96 }
let presets = saveMeasurementScalePreset('Print scale', values)
assert.equal(presets.length, 1)
assert.equal(presets[0].name, 'Print scale')
assert.equal(presets[0].pixelsPerUnit, 96)
assert.equal(loadMeasurementScalePresets().length, 1)

presets = saveMeasurementScalePreset('print SCALE', { ...values, pixelsPerUnit: 120 })
assert.equal(presets.length, 1, 'case-insensitive save should update, not duplicate')
assert.equal(presets[0].pixelsPerUnit, 120)

const selected = matchingMeasurementScalePreset(presets, { ...values, pixelsPerUnit: 120 })
assert.equal(selected?.id, presets[0].id)
assert.equal(matchingMeasurementScalePreset(presets, values), null)

const builtins = allMeasurementScalePresets(presets)
assert.equal(builtins.length, BUILTIN_MEASUREMENT_SCALE_PRESETS.length + 1)
assert.equal(builtins.filter(p => p.builtin).length, BUILTIN_MEASUREMENT_SCALE_PRESETS.length)

const id = presets[0].id
presets = deleteMeasurementScalePreset(id)
assert.equal(presets.length, 0)
assert.equal(loadMeasurementScalePresets().length, 0)

store.set('zphoto-measure-scale-presets', JSON.stringify([
  { id: 'duplicate', name: 'First', unit: 'mm', pixelsPerUnit: 2 },
  { id: 'duplicate', name: 'Second', unit: 'cm', pixelsPerUnit: 3 },
  { id: 'builtin-forged', name: 'Forged', unit: 'px', pixelsPerUnit: 1 },
  null,
  { id: 'bad-number', name: 'Bad', unit: 'in', pixelsPerUnit: -4 },
]))
const sanitized = loadMeasurementScalePresets()
assert.equal(sanitized.length, 2, 'duplicate and forged built-in entries must be rejected; invalid numeric values should normalize safely')
assert.equal(sanitized[0].name, 'First')
assert.equal(sanitized[0].pixelsPerUnit, 2)
assert.equal(sanitized[1].name, 'Bad')
assert.equal(sanitized[1].pixelsPerUnit, 1)

store.set('zphoto-measure-scale-presets', '{not json')
assert.deepEqual(loadMeasurementScalePresets(), [])

store.set('zphoto-measure-scale-presets', '[]')
for (let i = 0; i < 70; i++) {
  saveMeasurementScalePreset(`Scale ${i}`, { unit: 'cm', useDocResolution: false, pixelsPerUnit: i + 1 })
}
assert.equal(loadMeasurementScalePresets().length, 64, 'custom preset storage must remain bounded')

console.log('Measurement scale preset validation passed')
