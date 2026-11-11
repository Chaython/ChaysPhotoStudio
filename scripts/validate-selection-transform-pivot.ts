import { strict as assert } from 'node:assert'
import { scaleRectAroundPivot, selectionTransformPivot } from '../src/editor/tools/selection-transform-utils'

const bounds = { x: 10, y: 20, w: 80, h: 40 }
assert.deepEqual(selectionTransformPivot(bounds, 50, 50), { x: 50, y: 40 })
assert.deepEqual(selectionTransformPivot(bounds, 0, 0), { x: 10, y: 20 })
assert.deepEqual(selectionTransformPivot(bounds, 100, 100), { x: 90, y: 60 })
assert.deepEqual(selectionTransformPivot(bounds, 0, 100), { x: 10, y: 60 })
assert.deepEqual(selectionTransformPivot(bounds, 25, 75), { x: 30, y: 50 })
assert.deepEqual(selectionTransformPivot(bounds, -50, 150), { x: 10, y: 60 })
assert.deepEqual(selectionTransformPivot(bounds, Number.NaN, Number.POSITIVE_INFINITY), { x: 50, y: 40 })

const start = { x: 10, y: 20, w: 80, h: 40 }
const center = { x: 50, y: 40 }
assert.deepEqual(scaleRectAroundPivot(start, 'se', { x: 130, y: 80 }, center), { x: -30, y: 0, w: 160, h: 80 })
assert.deepEqual(scaleRectAroundPivot(start, 'nw', { x: 30, y: 30 }, center), { x: 30, y: 30, w: 40, h: 20 })
assert.deepEqual(scaleRectAroundPivot(start, 'e', { x: 130, y: 40 }, center), { x: 10, y: 20, w: 160, h: 40 })
assert.deepEqual(scaleRectAroundPivot(start, 'se', { x: 130, y: 60 }, center, true), { x: 0, y: 0, w: 160, h: 80 })
const offCenter = scaleRectAroundPivot(start, 'se', { x: 170, y: 100 }, { x: 10, y: 20 })
assert.deepEqual(offCenter, { x: 10, y: 20, w: 160, h: 80 })
// A handle coincident with the pivot cannot change that axis and must not explode in size.
assert.deepEqual(scaleRectAroundPivot(start, 'nw', { x: -100, y: -100 }, { x: 10, y: 20 }), start)
console.log('Marquee transform pivot validation passed')
