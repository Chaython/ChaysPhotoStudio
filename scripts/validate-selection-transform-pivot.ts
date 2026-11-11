import { strict as assert } from 'node:assert'
import { selectionTransformPivot } from '../src/editor/tools/selection-transform-utils'

const bounds = { x: 10, y: 20, w: 80, h: 40 }
assert.deepEqual(selectionTransformPivot(bounds, 50, 50), { x: 50, y: 40 })
assert.deepEqual(selectionTransformPivot(bounds, 0, 0), { x: 10, y: 20 })
assert.deepEqual(selectionTransformPivot(bounds, 100, 100), { x: 90, y: 60 })
assert.deepEqual(selectionTransformPivot(bounds, 0, 100), { x: 10, y: 60 })
assert.deepEqual(selectionTransformPivot(bounds, 25, 75), { x: 30, y: 50 })
assert.deepEqual(selectionTransformPivot(bounds, -50, 150), { x: 10, y: 60 })
assert.deepEqual(selectionTransformPivot(bounds, Number.NaN, Number.POSITIVE_INFINITY), { x: 50, y: 40 })
console.log('Marquee transform pivot validation passed')
