import assert from 'node:assert/strict'
import { autoSideDockWidth, horizontalDockPanelWidth } from '../src/editor/components/panels/auto-dock-sizing'
import type { PanelDef } from '../src/editor/components/panels/panel-registry'
import { useEditorStore } from '../src/editor/store'

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

// Manual height must only affect the chosen strip, not other corners.
const store = useEditorStore.getState()
store.setHorizontalDockHeight('top-left', 66)
store.setHorizontalDockHeight('top-right', 180)
store.setHorizontalDockHeight('bottom', 72)
assert.equal(useEditorStore.getState().panels.dockHeights['top-left'], 66)
assert.equal(useEditorStore.getState().panels.dockHeights['top-right'], 180)
assert.equal(useEditorStore.getState().panels.dockHeights['bottom'], 72)
assert.equal(useEditorStore.getState().panels.dockHeights['bottom-right'], undefined)
store.resetHorizontalDockHeight('top-left')
assert.equal(useEditorStore.getState().panels.dockHeights['top-left'], undefined)
assert.equal(useEditorStore.getState().panels.dockHeights['top-right'], 180, 'reset must not affect other corners')
store.setHorizontalDockHeight('bottom-right', 1)
assert.equal(useEditorStore.getState().panels.dockHeights['bottom-right'], 44, 'manual height clamps to 44px instead of jumping to 120px')
useEditorStore.getState().resetPanelLayout()
