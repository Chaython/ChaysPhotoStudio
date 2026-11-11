import { strict as assert } from 'node:assert'
import { nudgeSelectionBounds } from '../src/editor/tools/selection-nudge-utils'

const source = { x: 10, y: 20, w: 30, h: 40 }
assert.deepEqual(nudgeSelectionBounds(source, 1, 0, 100, 100), { x: 11, y: 20, w: 30, h: 40 })
assert.deepEqual(nudgeSelectionBounds(source, -1, 0, 100, 100), { x: 9, y: 20, w: 30, h: 40 })
assert.deepEqual(nudgeSelectionBounds(source, 0, -10, 100, 100), { x: 10, y: 10, w: 30, h: 40 })
assert.deepEqual(nudgeSelectionBounds(source, 0, 10, 100, 100), { x: 10, y: 30, w: 30, h: 40 })
assert.deepEqual(nudgeSelectionBounds(source, -20, -30, 100, 100), { x: 0, y: 0, w: 20, h: 30 })
assert.deepEqual(nudgeSelectionBounds(source, 100, 100, 100, 100), { x: 100, y: 100, w: 0, h: 0 })
assert.deepEqual(nudgeSelectionBounds(source, 0, 0, 100, 100), source)
console.log('Marquee selection nudge geometry validation passed')
