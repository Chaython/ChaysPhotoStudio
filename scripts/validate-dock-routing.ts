import assert from 'node:assert/strict'
import { resolvePanelDockSide, VALID_DOCK_SIDES } from '../src/editor/components/panels/dock-resolution'

const id = 'layers'
assert.equal(VALID_DOCK_SIDES.length, 8, 'the selector must represent all eight dock positions')
for (const side of VALID_DOCK_SIDES) {
  const placements = { [id]: side }
  assert.equal(resolvePanelDockSide(id, placements, false), side,
    `Panel explicitly placed in ${side} must not fall back to the right rail`)
  for (const rail of ['left', 'right']) {
    assert.equal(resolvePanelDockSide(id, placements, false) === rail, side === rail,
      `${side} must be exclusive to its own rail/strip`)
  }
}
assert.equal(resolvePanelDockSide('tools', {}, true), null, 'native module stays at its home')
assert.equal(resolvePanelDockSide('layers', {}, false), 'right', 'ordinary undocked panel defaults right')
assert.equal(resolvePanelDockSide('layers', { layers: 'invalid' }, false), 'right', 'invalid saved side falls back safely')
console.log('All eight dock destinations resolve exclusively; native/default fallback preserved')
