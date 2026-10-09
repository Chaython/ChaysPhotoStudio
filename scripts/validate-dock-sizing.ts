import assert from 'node:assert/strict'
import { autoSideDockWidth, horizontalDockPanelWidth } from '../src/editor/components/panels/auto-dock-sizing'
import type { PanelDef } from '../src/editor/components/panels/panel-registry'

function panel(id: PanelDef['id'], minWidth: number): PanelDef {
  return { id, label: id, minFloat: { w: minWidth, h: 110 }, defaultFloat: { w: 720, h: 420 } } as PanelDef
}
assert.equal(autoSideDockWidth(panel('documents', 320)), 220, 'Open Files should not use its 720px float size in a side dock')
assert.equal(autoSideDockWidth(panel('tool-options', 360)), 380)
assert.equal(autoSideDockWidth(panel('timeline', 460)), 460, 'wide timeline retains a useful working width')
assert.equal(autoSideDockWidth(panel('layers', 230)), 242)
assert.equal(autoSideDockWidth(panel('metadata', 500)), 460, 'side docks remain bounded')
assert.equal(autoSideDockWidth(undefined), 264)
assert.equal(autoSideDockWidth(panel('documents', 320), true), 318, 'Photoshop stacked inspectors keep their common width')

assert.deepEqual(horizontalDockPanelWidth('documents', 720), {
  width: 'max-content', minWidth: 180, maxWidth: 'min(72vw, 940px)',
})
assert.deepEqual(horizontalDockPanelWidth('tool-options', 760), {
  width: 'max-content', minWidth: 260, maxWidth: 'min(72vw, 940px)',
})
assert.deepEqual(horizontalDockPanelWidth('layers', 290), { width: 290 })
console.log('Dock widths fit compact modules and keep complex content usable and bounded')
