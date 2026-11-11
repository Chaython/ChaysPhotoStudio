import { strict as assert } from 'node:assert'
import { moveNudgeDelta } from '../src/editor/tools/move-nudge-utils'

assert.deepEqual(moveNudgeDelta('ArrowLeft', false), { dx: -1, dy: 0 })
assert.deepEqual(moveNudgeDelta('ArrowRight', false), { dx: 1, dy: 0 })
assert.deepEqual(moveNudgeDelta('ArrowUp', false), { dx: 0, dy: -1 })
assert.deepEqual(moveNudgeDelta('ArrowDown', false), { dx: 0, dy: 1 })
assert.deepEqual(moveNudgeDelta('ArrowLeft', true), { dx: -10, dy: 0 })
assert.deepEqual(moveNudgeDelta('ArrowRight', true), { dx: 10, dy: 0 })
assert.deepEqual(moveNudgeDelta('ArrowUp', true), { dx: 0, dy: -10 })
assert.deepEqual(moveNudgeDelta('ArrowDown', true), { dx: 0, dy: 10 })
assert.equal(moveNudgeDelta('Enter', false), null)
assert.equal(moveNudgeDelta('Escape', true), null)
console.log('Move keyboard nudge validation passed')
