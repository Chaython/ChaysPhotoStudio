import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pixelsPerMeasureUnit } from '../src/editor/tools/measure-utils'

const eq = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `Expected ${expected} but received ${actual}`)
eq(pixelsPerMeasureUnit('px', true, 300, 10), 1)
eq(pixelsPerMeasureUnit('px', false, 300, 10), 1)
eq(pixelsPerMeasureUnit('in', true, 300, 1), 300)
eq(pixelsPerMeasureUnit('cm', true, 300, 1), 300 / 2.54)
eq(pixelsPerMeasureUnit('mm', true, 300, 1), 300 / 25.4)
for (const unit of ['in', 'mm', 'cm']) {
  eq(pixelsPerMeasureUnit(unit, false, 300, 42.25), 42.25)
  eq(pixelsPerMeasureUnit(unit, false, 300, 0), 1)
  eq(pixelsPerMeasureUnit(unit, false, 300, NaN), 1)
  eq(pixelsPerMeasureUnit(unit, true, NaN, 9), unit === 'in' ? 72 : 72 / (unit === 'cm' ? 2.54 : 25.4))
}
eq(pixelsPerMeasureUnit('unsupported', true, 300, 9), 1)

// Verify integration points as well as the standalone conversion arithmetic.
const load = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const measure = load('src/editor/tools/measure.ts')
const sampler = load('src/editor/tools/color-sampler.ts')
const renderer = load('src/editor/engine/render.ts')
assert.match(measure, /pixelsPerMeasureUnit\(/)
assert.match(measure, /belongsToActiveDocument\(\)/)
assert.match(measure, /renderPersistentMeasurementOverlay/)
assert.match(renderer, /activeToolId !== 'measure'\) renderPersistentMeasurementOverlay/)
assert.match(renderer, /activeToolId !== 'color-sampler'/)
assert.match(sampler, /ArrowLeft: \[-1, 0\]/)
assert.match(sampler, /e\.shiftKey \? 10 : 1/)
console.log('Ruler calibration, document isolation, tool-overlay wiring and precision sampler controls validated.')
