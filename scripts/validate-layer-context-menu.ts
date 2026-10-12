import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  LAYER_CONTEXT_MENU_SECTIONS,
  defaultLayerContextPreferences,
  normalizeLayerContextPreferences,
  moveLayerContextAction,
  setLayerContextActionVisible,
} from '../src/editor/components/workspace/layer-context-menu-config'

const defaults = defaultLayerContextPreferences()
const all = LAYER_CONTEXT_MENU_SECTIONS.flatMap(group => group.entries.map(entry => entry.id))
assert.equal(new Set(all).size, all.length, 'Action IDs must be globally unique')
assert.equal(Object.keys(defaults.order).length, LAYER_CONTEXT_MENU_SECTIONS.length)
assert.equal(defaults.hidden.length, 0)
assert.deepEqual(normalizeLayerContextPreferences(null), defaults)

const hidden = setLayerContextActionVisible(defaults, 'transform', false)
assert.ok(hidden.hidden.includes('transform'))
assert.ok(!defaults.hidden.includes('transform'), 'Updates must not mutate their inputs')
const shown = setLayerContextActionVisible(hidden, 'transform', true)
assert.ok(!shown.hidden.includes('transform'))

const moved = moveLayerContextAction(defaults, 'operations', 'transform', -1)
assert.equal(moved.order.operations[0], 'transform')
assert.equal(moved.order.operations[1], 'expand')
assert.equal(defaults.order.operations[0], 'expand')
assert.deepEqual(moveLayerContextAction(moved, 'operations', 'transform', -1), moved, 'Boundary nudge must be stable')
assert.deepEqual(moveLayerContextAction(defaults, 'edit', 'expand', 1), defaults, 'Wrong-group nudge must be stable')

const corrupt = normalizeLayerContextPreferences({
  hidden: ['transform', 'transform', '__proto__', 1, null, 'does-not-exist'],
  order: {
    edit: ['paste', 'paste', '__proto__', 'undo', 123],
    operations: ['delete', 'matting', 'unknown'],
  },
})
assert.deepEqual(corrupt.hidden, ['transform'])
assert.equal(corrupt.order.edit[0], 'paste')
assert.equal(corrupt.order.edit[1], 'undo')
assert.equal(corrupt.order.operations[0], 'matting')
assert.equal(corrupt.order.operations.length, defaults.order.operations.length)
assert.equal(corrupt.order.edit.length, defaults.order.edit.length)

const file = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const context = file('src/editor/components/workspace/canvas-context-menu.tsx')
const workspace = file('src/editor/components/workspace/canvas-workspace.tsx')
const editor = file('src/editor/components/workspace/layer-context-menu-editor.tsx')
for (const id of all) {
  assert.ok(context.includes(`'${id}':`), `Menu action missing: ${id}`)
}
assert.match(context, /safePreferences\.order\[section\.id\]/)
assert.match(context, /onSelect=\{onCustomize\}/)
assert.match(workspace, /saveLayerContextPreferences\(next\)/)
assert.match(editor, /onChange\(defaultLayerContextPreferences\(\)\)/)

console.log(`Validated ${all.length} editable context menu actions, order, visibility, storage wiring and reset.`)
