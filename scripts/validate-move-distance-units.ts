import { strict as assert } from 'node:assert'
import { formatMoveDistance, pixelsPerMoveUnit } from '../src/editor/tools/move-distance-utils'

assert.equal(pixelsPerMoveUnit('px', true, 300, 12), 1)
assert.equal(pixelsPerMoveUnit('in', true, 300, 12), 300)
assert.equal(pixelsPerMoveUnit('cm', true, 254, 12), 100)
assert.equal(pixelsPerMoveUnit('mm', true, 254, 12), 10)
assert.equal(pixelsPerMoveUnit('in', false, 300, 150), 150)
assert.equal(pixelsPerMoveUnit('in', true, 0, 150), 72)
assert.equal(pixelsPerMoveUnit('in', false, 300, 0), 1)

assert.equal(formatMoveDistance(300, 'in', true, 300, 1), '1 in')
assert.equal(formatMoveDistance(150, 'cm', true, 300, 1), '1.3 cm')
assert.equal(formatMoveDistance(25.4, 'mm', true, 72, 1), '8.8 mm')
assert.equal(formatMoveDistance(12.34, 'px', true, 300, 1), '12.3 px')
assert.equal(formatMoveDistance(150, 'in', false, 300, 150), '1 in')
assert.equal(formatMoveDistance(10, 'invalid', true, 300, 1), '10 px')

console.log('Move distance unit validation passed')
