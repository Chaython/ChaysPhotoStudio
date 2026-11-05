import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  WORKSPACE_PRESETS, WORKSPACE_PRESET_LABELS, INSPECTOR_PRESETS, INSPECTOR_HEADER_LABELS,
  isInspectorPreset, inspectorTemplateTabs, defaultToolbarLayout, sanitizeToolbarLayout,
  presetPanelState, PHOTOSHOP_INSPECTOR_UPPER_TABS, PHOTOSHOP_INSPECTOR_LOWER_TABS,
  ILLUSTRATOR_INSPECTOR_UPPER_TABS, ILLUSTRATOR_INSPECTOR_LOWER_TABS,
  GIMP_INSPECTOR_UPPER_TABS, GIMP_INSPECTOR_LOWER_TABS,
  FIREWORKS_INSPECTOR_UPPER_TABS, FIREWORKS_INSPECTOR_LOWER_TABS,
  defaultWorkspaceShortcutProfile,
  DOCK_WIDTH_DEFAULT,
} from '../src/editor/store'
import type { ToolbarSection, ToolId } from '../src/editor/types'
import { TOOL_DEFS } from '../src/editor/constants/tools'
import { COMMANDS } from '../src/editor/shortcuts'
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
// Application shortcut profiles must target registered commands/tools only.
const commandIds = new Set<string>(COMMANDS.map(command => command.id))
const toolIds = new Set<string>(TOOL_DEFS.map(tool => tool.id))
for (const preset of presetList) {
  const profile = defaultWorkspaceShortcutProfile(preset)
  for (const [key, combo] of Object.entries(profile)) {
    if (key.startsWith('tool:')) {
      assert.ok(toolIds.has(key.slice(5) as ToolId), `shortcut profile ${preset} references registered tool ${key}`)
      assert.match(combo, /^(?:[a-z]|shift\+[a-z])$/, `tool shortcut ${key} must be a letter with optional Shift`)
    } else {
      assert.ok(commandIds.has(key), `shortcut profile ${preset} references registered command ${key}`)
      assert.match(combo, /^[a-z0-9]+(?:\+[a-z0-9]+)*$/, `command shortcut ${key} must use a valid combo`)
    }
  }
}
assert.equal(defaultWorkspaceShortcutProfile('photoshop').deselect, 'ctrl+d')
assert.equal(defaultWorkspaceShortcutProfile('gimp').redo, 'ctrl+y')
assert.equal(defaultWorkspaceShortcutProfile('gimp')['tool:magic-wand'], 'z')
assert.equal(defaultWorkspaceShortcutProfile('gimp')['tool:clone-stamp'], 'c')
assert.equal(defaultWorkspaceShortcutProfile('gimp')['tool:crop'], 'shift+c')
assert.equal(defaultWorkspaceShortcutProfile('illustrator').deselect, 'ctrl+shift+a')
assert.equal(defaultWorkspaceShortcutProfile('fireworks').deselect, 'ctrl+d')
assert.equal(defaultWorkspaceShortcutProfile('gimp')['tool:crop'], 'shift+c',
  'GIMP Crop must use its native Shift+C shortcut')
assert.equal(defaultWorkspaceShortcutProfile('gimp')['tool:paint-bucket'], 'shift+b',
  'GIMP Bucket Fill must use its native Shift+B shortcut')
assert.equal(defaultWorkspaceShortcutProfile('gimp')['tool:eraser'], 'shift+e',
  'GIMP Eraser must use its native Shift+E shortcut')

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
  if (preset === 'illustrator') {
    assert.deepEqual(layout.slice(0, 11).map(section => section.kind === 'single' ? [section.tool] : section.tools), [
      ['move', 'artboard'], ['path-select', 'direct-select'], ['lasso', 'polygon-lasso', 'magic-wand'],
      ['pen', 'pen-freeform', 'pen-curvature'], ['text'], ['shape'], ['brush', 'pencil'],
      ['eyedropper'], ['gradient', 'paint-bucket'], ['hand'], ['zoom'],
    ], 'Illustrator primary rail must prioritize vector selection, drawing, type and navigation tools')
  }
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
assert.ok(toolbarSource.includes('const WORKSPACE_CUSTOM_GLYPHS'), 'custom vector glyphs must be defined')
for (const glyph of ['artboard', 'path-select', 'direct-select', 'pen-freeform', 'slice', 'hotspot', 'lasso', 'crop', 'eyedropper', 'gradient', 'eraser', 'clone-stamp', 'healing-brush']) {
  assert.ok(new RegExp(`(?:'${glyph}'|${glyph}):`).test(toolbarSource), `custom glyph required for ${glyph}`)
}
assert.ok(toolbarSource.includes('WORKSPACE_CUSTOM_GLYPHS[workspacePreset]'),
  'custom glyphs must resolve by active workspace')
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
const propertiesSource = readFileSync(new URL('../src/editor/components/panels/channels-actions-properties.tsx', import.meta.url), 'utf8')
assert.match(propertiesSource, /workspacePreset === 'illustrator' && layer\.kind === 'shape'/,
  'Illustrator Properties must show context-sensitive vector controls only for vector objects')
assert.match(propertiesSource, /function IllustratorShapeProperties\(/,
  'Illustrator vector objects need a dedicated Properties inspector')
assert.match(propertiesSource, /workspacePreset === 'photoshop' && isText/,
  'Photoshop Character and Paragraph controls must only appear for selected type layers')
assert.match(propertiesSource, /workspacePreset === 'fireworks' && <FireworksLayerProperties/,
  'Fireworks Properties dock must show its contextual layer controls')
assert.match(propertiesSource, /function FireworksLayerProperties\(/,
  'Fireworks needs a dedicated contextual Properties inspector')
assert.match(propertiesSource, /if \(!layer\)[\s\S]*?workspacePreset !== 'fireworks'[\s\S]*?<FireworksDocumentProperties doc=\{doc\}/,
  'Fireworks document Properties must remain visible when no layer is selected')
assert.match(propertiesSource, /function FireworksDocumentProperties\(/,
  'Fireworks needs a document-level web asset inspector')
for (const control of ['Document Properties', 'Web Objects', 'slices', 'hotspots', 'Export Artboards', 'Manage Web Objects', 'Manage Artboards']) {
  assert.ok(propertiesSource.includes(control), `Fireworks document inspector must expose ${control}`)
}
assert.match(propertiesSource, /openDialog\('web-assets'\)/,
  'Fireworks document inspector must link to the web asset manager')
assert.match(propertiesSource, /openDialog\('artboards'\)/,
  'Fireworks document inspector must link to the artboard manager')
assert.match(propertiesSource, /openDialog\('web-assets', \{ regionId: region\.id \}\)/,
  'Fireworks web object entries must open the editor focused on that region')
assert.match(propertiesSource, /aria-label=\{\`Edit \$\{region\.kind\} \$\{region\.name\}\`\}/,
  'Fireworks web object entries must expose an accessible edit action')
assert.match(propertiesSource, /doc\.activeWebRegionId === region\.id/,
  'Fireworks inspector must highlight the canvas-focused web object')
assert.match(propertiesSource, /doc\.activeWebRegionId = region\.id/,
  'Fireworks inspector clicks must synchronize focused web object state')
const webRegionToolSource = readFileSync(new URL('../src/editor/tools/web-region-tools.ts', import.meta.url), 'utf8')
assert.match(webRegionToolSource, /function setSelectedRegion\(/,
  'Slice and Hotspot tools must share a document-level focused region')
assert.match(webRegionToolSource, /doc\.activeWebRegionId = id/,
  'Canvas selection must publish its focused web region to the inspector')
assert.match(webRegionToolSource, /function selectedId\(\): string \| null \{[\s\S]*?const focused = doc\.activeWebRegionId[\s\S]*?if \(focused !== undefined\)[\s\S]*?return focused && doc\.webRegions\?\.some\(region => region\.id === focused\) \? focused : null/,
  'Canvas overlay highlighting must read shared focus and respect an explicitly cleared selection')
assert.match(webRegionToolSource, /function setSelectedRegion\([\s\S]*?engine\.emit\(\)/,
  'Canvas region selection must rerender the React inspector as well as the canvas overlay')
assert.doesNotMatch(webRegionToolSource, /selected = \{ docId:/,
  'Canvas region selection must always use the shared document-state synchronizer')
const webAssetsDialogSource = readFileSync(new URL('../src/editor/components/dialogs/web-assets-dialog.tsx', import.meta.url), 'utf8')
assert.match(webAssetsDialogSource, /inst\.props\?\.regionId \?\? doc\?\.activeWebRegionId/,
  'Web Assets editor must open on the region currently focused by the canvas')
assert.match(webAssetsDialogSource, /const selectRegion = \(id: string \| null\) =>[\s\S]*?doc\.activeWebRegionId = id/,
  'Web Assets dialog selection must synchronize the document focused region')
assert.match(webAssetsDialogSource, /onClick=\{\(\) => selectRegion\(r\.id\)\}/,
  'Selecting a web object in the inspector must update shared focus state')
assert.match(webAssetsDialogSource, /commitRegions\(regions\.filter\(r => r\.id !== active\.id\)\); selectRegion\(null\)/,
  'Deleting the focused web object must clear shared focus state')
for (const control of ['Fireworks Properties', 'Opacity', 'Blend mode', 'Visible', 'Hidden', 'Locked', 'Unlocked']) {
  assert.ok(propertiesSource.includes(control), `Fireworks Properties must expose ${control}`)
}
assert.match(propertiesSource, /function PhotoshopTypeControls\(/,
  'Photoshop type layers need a dedicated contextual Character and Paragraph inspector')
assert.match(propertiesSource, /function PhotoshopTypeControls\([\s\S]*?historyTimer = useRef[\s\S]*?history: false, label: 'Edit Type Character'[\s\S]*?engine\.pushHistory\('Edit Type Character'(?:, [^)]+)?\)[\s\S]*?\}, 300\)/,
  'Photoshop Character and Paragraph edits must batch rapid changes into one undo step')
for (const [component, label] of [
  ['PhotoshopTypeControls', 'Edit Type Character'],
  ['IllustratorShapeProperties', 'Edit Vector Object'],
  ['FireworksLayerProperties', 'Edit Fireworks Properties'],
] as const) {
  const start = propertiesSource.indexOf(`function ${component}`)
  const end = propertiesSource.indexOf('\nfunction ', start + 10)
  const source = propertiesSource.slice(start, end < 0 ? undefined : end)
  assert.match(source, /historyDoc = useRef/,
    `${component} must retain the document that received pending edits`)
  assert.ok(source.includes(`engine.pushHistory('${label}', historyDoc.current)`),
    `${component} must commit pending edits when its inspector unmounts`)
  assert.ok(source.includes(`engine.pushHistory('${label}', target)`),
    `${component} must commit history to the edited document after the debounce`)
}
for (const control of [
  'Character font family', 'Character font size', 'Character font style',
  'Character leading', 'Character tracking', 'Character baseline shift',
  'Strikethrough', 'Paragraph', 'Text direction', 'Word spacing', 'Box width',
]) {
  assert.ok(propertiesSource.includes(control), `Photoshop Type inspector must expose ${control}`)
}
for (const control of ['Object fill color', 'Object stroke color', 'Stroke weight']) {
  assert.ok(propertiesSource.includes(control), `Illustrator Properties must expose ${control}`)
}
for (const control of [
  'Fill opacity', 'Stroke opacity', 'Stroke alignment', 'Stroke pattern', 'Line cap',
  'Polygon sides', 'Star inner radius percent', 'Custom dash length', 'Custom dash gap',
  'Start arrow', 'End arrow',
]) {
  assert.ok(propertiesSource.includes(control), `Illustrator Properties must expose ${control}`)
}
for (const [axis, key] of [['X', 'x'], ['Y', 'y'], ['W', 'w'], ['H', 'h']] as const) {
  assert.ok(new RegExp(`numberField\\('${axis}', '${key}'(?:, 0)?\\)`).test(propertiesSource),
    `Illustrator Properties must expose editable object ${axis}`)
}
assert.match(toolbarSource, /swapColors/,
  'Illustrator toolbar must expose Fill/Stroke swapping')
const topDockSource = readFileSync(new URL('../src/editor/components/panels/top-dock.tsx', import.meta.url), 'utf8')
assert.match(editorShell, /<Toolbar embedded=\{workspacePreset === 'gimp'\} \/>/,
  'GIMP toolbox must use the shared toolbar in its wide toolbox column')
assert.match(editorShell, /workspacePreset === 'gimp'[\s\S]*?<ToolOptionsBar embedded layout="vertical" \/>/,
  'GIMP tool options must remain beneath the toolbox in a vertical contextual layout')
const toolOptionsSource = readFileSync(new URL('../src/editor/components/toolbar/tool-options-bar.tsx', import.meta.url), 'utf8')
assert.match(toolOptionsSource, /layout === 'vertical'[\s\S]*?'flex-col items-stretch'/,
  'GIMP tool options must stack controls vertically rather than wrap as a horizontal toolbar')
assert.match(toolOptionsSource, /layout !== 'vertical' && <VDivider \/>/,
  'GIMP tool options must not show horizontal toolbar dividers')
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
