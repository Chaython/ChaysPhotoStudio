import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  WORKSPACE_PRESETS, WORKSPACE_PRESET_LABELS, INSPECTOR_PRESETS, INSPECTOR_HEADER_LABELS,
  isInspectorPreset, inspectorTemplateTabs, defaultToolbarLayout, sanitizeToolbarLayout,
  presetPanelState, PHOTOSHOP_INSPECTOR_UPPER_TABS, PHOTOSHOP_INSPECTOR_LOWER_TABS,
  ILLUSTRATOR_INSPECTOR_UPPER_TABS, ILLUSTRATOR_INSPECTOR_LOWER_TABS,
  GIMP_INSPECTOR_UPPER_TABS, GIMP_INSPECTOR_LOWER_TABS,
  FIREWORKS_INSPECTOR_UPPER_TABS, FIREWORKS_INSPECTOR_LOWER_TABS,
  DOCK_WIDTH_DEFAULT,
} from '../src/editor/store'
import type { ToolbarSection, ToolId } from '../src/editor/types'
import { TOOL_DEFS } from '../src/editor/constants/tools'
import { DOCKABLE_PANEL_IDS, isDockablePanelId } from '../src/editor/constants/panel-ids'

// --- Registry invariants -------------------------------------------------------
const presetList = [...WORKSPACE_PRESETS]
assert.equal(new Set(presetList).size, presetList.length, 'workspace presets must be unique')
assert.deepEqual(presetList, ['classic', 'photoshop', 'illustrator', 'gimp', 'fireworks'],
  'the five documented templates must be registered')
for (const preset of presetList) {
  assert.ok(WORKSPACE_PRESET_LABELS[preset].length > 0, `label for ${preset}`)
  assert.ok(INSPECTOR_HEADER_LABELS[preset].length > 0, `inspector header for ${preset}`)
}
assert.ok(INSPECTOR_PRESETS.includes('photoshop') && !INSPECTOR_PRESETS.includes('classic'),
  'classic must keep the tabbed dock while inspector presets use the stacked dock')
assert.equal(isInspectorPreset('classic'), false)
for (const preset of INSPECTOR_PRESETS) assert.equal(isInspectorPreset(preset), true)
assert.equal(isInspectorPreset('photoshop'), true)

// --- Toolbar templates: every tool exactly once --------------------------------
const allToolIds = TOOL_DEFS.map(def => def.id)
function layoutTools(sections: ToolbarSection[]): ToolId[] {
  return sections.flatMap(section => section.kind === 'single' ? [section.tool] : section.tools)
}
for (const preset of presetList) {
  const layout = defaultToolbarLayout(preset)
  const tools = layoutTools(layout)
  assert.equal(tools.length, new Set(tools).size, `${preset}: no tool may appear twice`)
  assert.deepEqual([...tools].sort(), [...allToolIds].sort(),
    `${preset}: every registered tool must stay accessible exactly once`)
  // The sanitizer is the authority on structure; templates must already comply.
  assert.deepEqual(sanitizeToolbarLayout(layout), layout,
    `${preset}: template must survive sanitization unchanged`)
}
// Classic groups by ToolDef group number (stable within each group).
const groupSorted = [...TOOL_DEFS].sort((a, b) => a.group - b.group).map(def => def.id)
assert.deepEqual(layoutTools(defaultToolbarLayout('classic')), groupSorted,
  'classic toolbar must group tools by registry group, preserving in-group order')
// Photoshop template must remain byte-identical to the shipped grouping.
assert.deepEqual(defaultToolbarLayout('photoshop').map(s => s.kind === 'single' ? [s.tool] : s.tools), [
  ['move', 'artboard'],
  ['marquee-rect', 'marquee-ellipse', 'marquee-row', 'marquee-column'],
  ['lasso', 'polygon-lasso', 'magnetic-lasso', 'selection-brush'],
  ['object-select', 'quick-select', 'magic-wand'],
  ['crop', 'perspective-crop', 'slice', 'hotspot'],
  ['eyedropper', 'color-sampler', 'measure', 'count'],
  ['spot-healing', 'healing-brush', 'patch', 'content-aware-move', 'red-eye'],
  ['brush', 'pencil', 'mixer-brush', 'color-replacement'],
  ['clone-stamp', 'pattern-stamp'],
  ['history-brush', 'art-history-brush'],
  ['eraser', 'background-eraser', 'magic-eraser'],
  ['gradient', 'paint-bucket'],
  ['blur', 'sharpen', 'smudge'],
  ['dodge', 'burn', 'sponge'],
  ['pen', 'pen-freeform', 'pen-curvature'],
  ['text', 'type-mask-horizontal', 'type-mask-vertical'],
  ['path-select', 'direct-select'],
  ['shape'],
  ['hand'],
  ['zoom'],
], 'photoshop toolbar template must stay stable')

// --- Inspector templates: valid, non-overlapping, well-formed ------------------
const templateConstants: Record<string, readonly string[]> = {
  photoshop: [...PHOTOSHOP_INSPECTOR_UPPER_TABS, ...PHOTOSHOP_INSPECTOR_LOWER_TABS],
  illustrator: [...ILLUSTRATOR_INSPECTOR_UPPER_TABS, ...ILLUSTRATOR_INSPECTOR_LOWER_TABS],
  gimp: [...GIMP_INSPECTOR_UPPER_TABS, ...GIMP_INSPECTOR_LOWER_TABS],
  fireworks: [...FIREWORKS_INSPECTOR_UPPER_TABS, ...FIREWORKS_INSPECTOR_LOWER_TABS],
}
for (const preset of presetList) {
  const { upperTabs, lowerTabs } = inspectorTemplateTabs(preset)
  assert.ok(upperTabs.length > 0 && lowerTabs.length > 0, `${preset}: both inspector stacks must be non-empty`)
  for (const id of [...upperTabs, ...lowerTabs]) {
    assert.ok(isDockablePanelId(id), `${preset}: inspector tab ${id} must be a registered panel`)
  }
  const overlap = upperTabs.filter(id => lowerTabs.includes(id))
  assert.deepEqual(overlap, [], `${preset}: a panel cannot live in both inspector stacks`)
}
// Known inspector templates differ from each other (a copy-paste bug would
// make two application workspaces equal). Classic is exempt: it never renders
// the stacked inspector and only keeps placeholder state.
const inspectorSignatures = INSPECTOR_PRESETS.map(p => JSON.stringify(inspectorTemplateTabs(p)))
assert.equal(new Set(inspectorSignatures).size, INSPECTOR_PRESETS.length,
  'each inspector workspace needs its own template')
// Illustrator opens on Properties and keeps object structure/history in its lower stack.
assert.deepEqual(inspectorTemplateTabs('illustrator').upperTabs, ['properties', 'color', 'navigator', 'tool-presets'],
  'illustrator opens with its Properties controls visible')
assert.deepEqual(inspectorTemplateTabs('illustrator').lowerTabs, ['layers', 'paths', 'history', 'actions', 'layer-comps'],
  'illustrator keeps object structure and editing history together')
// Fireworks reserves Properties for the bottom strip, not the right inspector.
assert.ok(!inspectorTemplateTabs('fireworks').upperTabs.includes('properties') &&
  !inspectorTemplateTabs('fireworks').lowerTabs.includes('properties'),
  'fireworks keeps Properties docked at the bottom instead of the inspector stacks')

// --- Shared shell presentation invariants --------------------------------------
// Workspace presets must adapt the shared editor shell rather than fork it.
// GIMP gets a wide, wrapping toolbox and its tool options below that toolbox;
// the shared horizontal options strip stays disabled for that preset.
const editorShell = readFileSync(new URL('../src/editor/components/shell/editor-app.tsx', import.meta.url), 'utf8')
const toolbarSource = readFileSync(new URL('../src/editor/components/toolbar/toolbar.tsx', import.meta.url), 'utf8')
assert.ok(toolbarSource.includes('const WORKSPACE_TOOL_ICONS'), 'workspace icon maps must be defined')
for (const preset of ['photoshop', 'illustrator', 'gimp', 'fireworks']) {
  assert.ok(toolbarSource.includes(`  ${preset}: {`), `${preset} must have a distinct tool icon map`)
}
assert.ok(toolbarSource.includes('WORKSPACE_TOOL_ICONS[workspacePreset]'),
  'tool icon rendering must resolve through the active workspace preset')
assert.match(toolbarSource, /workspacePreset === 'illustrator' && !compact && !embedded/,
  'Illustrator Fill/Stroke controls belong at the bottom of the standard vertical toolbar')
assert.ok(toolbarSource.includes('aria-label="Fill color picker"') && toolbarSource.includes('type="color"'),
  'Illustrator Fill swatch must open a color picker')
assert.ok(toolbarSource.includes('aria-label="Stroke color picker"') && toolbarSource.includes('type="color"'),
  'Illustrator Stroke swatch must open a color picker')
assert.match(toolbarSource, /swapColors/,
  'Illustrator toolbar must expose Fill/Stroke swapping')
const topDockSource = readFileSync(new URL('../src/editor/components/panels/top-dock.tsx', import.meta.url), 'utf8')
assert.match(editorShell, /<Toolbar embedded=\{workspacePreset === 'gimp'\} \/>/,
  'GIMP toolbox must use the shared toolbar in its wide toolbox column')
assert.match(editorShell, /workspacePreset === 'gimp'[\s\S]*?<ToolOptionsBar embedded \/>/,
  'GIMP tool options must remain beneath the toolbox')
assert.match(editorShell, /workspacePreset !== 'gimp'[\s\S]*?<ToolOptionsBar embedded \/>/,
  'other workspaces retain the shared horizontal tool-options strip')
assert.match(topDockSource, /side === "bottom" && id === "properties"[\s\S]*?width: "100%"/,
  'Fireworks Properties must expand across the bottom dock instead of staying a narrow floating-panel width')

// --- Panel templates -----------------------------------------------------------
const basePanels = {
  rightTab: 'layers', leftTab: '', leftOpen: false, leftWidth: DOCK_WIDTH_DEFAULT,
  leftWidthManual: false, dockWidthManual: false, colorPanelOpen: true,
  floating: {}, dockSide: {}, topOrder: [], zTop: 0, dockWidth: DOCK_WIDTH_DEFAULT,
} as const
for (const preset of presetList) {
  const panels = presetPanelState(preset, { ...basePanels } as any)
  assert.equal(panels.rightTab, 'layers', `${preset}: layers panel is selected by default`)
  assert.deepEqual(panels.floating, {})
  assert.equal(panels.dockWidthManual, false)
  assert.equal(panels.photoshopInspector.upperTabs.join('|'), inspectorTemplateTabs(preset).upperTabs.join('|'),
    `${preset}: inspector state must start from the template tabs`)
  assert.equal(panels.photoshopInspector.lowerTabs.join('|'), inspectorTemplateTabs(preset).lowerTabs.join('|'),
    `${preset}: inspector state must start from the template tabs`)
  assert.ok(panels.photoshopInspector.upperTabs.includes(panels.photoshopInspector.upperTab),
    `${preset}: active upper tab must be part of the upper stack`)
  assert.ok(panels.photoshopInspector.lowerTabs.includes(panels.photoshopInspector.lowerTab),
    `${preset}: active lower tab must be part of the lower stack`)
}
assert.equal(presetPanelState('photoshop', { ...basePanels } as any).dockWidth, 318,
  'photoshop keeps its historical 318px inspector width')
assert.equal(presetPanelState('illustrator', { ...basePanels } as any).dockWidth, 300,
  'illustrator uses its narrower properties/layers inspector')
const gimp = presetPanelState('gimp', { ...basePanels } as any)
assert.equal(gimp.dockWidth, 286, 'gimp uses a compact right-side dock')
assert.equal(gimp.leftWidth, 260, 'gimp reserves the wider toolbox column')
const fireworks = presetPanelState('fireworks', { ...basePanels } as any)
assert.equal(fireworks.dockSide.properties, 'bottom',
  'fireworks docks the Properties inspector below the canvas')
assert.equal(fireworks.dockWidth, 270, 'fireworks uses its compact inspector width')
assert.equal(fireworks.bottomHeight, 210, 'fireworks reserves space for its Properties strip')
assert.equal(fireworks.dockHeights.bottom, 210, 'fireworks applies the default height to its bottom dock')
assert.ok(!('properties' in presetPanelState('illustrator', { ...basePanels } as any).dockSide),
  'other templates do not move Properties to the bottom')

console.log('Workspace templates: five presets, complete toolbars, per-template inspector stacks and Fireworks bottom Properties dock verified')
