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
import {
  TOOL_CLUSTERS, TOOL_CLUSTER_PANEL_IDS, isToolClusterPanelId, toolClusterPanelId,
} from '../src/editor/constants/tool-clusters'

// --- Registry invariants -------------------------------------------------------
const presetList = [...WORKSPACE_PRESETS]
assert.equal(new Set(presetList).size, presetList.length, 'workspace presets must be unique')
assert.deepEqual(presetList, ['classic', 'photoshop', 'illustrator', 'gimp', 'fireworks', 'paint'],
  'all documented workspace templates must be registered')
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

// --- Toolbox clusters: every group is a real panel target ----------------------
const clusteredTools = TOOL_CLUSTERS.flatMap(cluster => [...cluster.tools])
assert.equal(new Set(clusteredTools).size, clusteredTools.length,
  'a tool may belong to only one ribbon cluster')
for (const id of clusteredTools) {
  assert.ok(toolIds.has(id), `cluster references registered tool ${id}`)
}
assert.equal(TOOL_CLUSTER_PANEL_IDS.length, TOOL_CLUSTERS.length,
  'every cluster needs a stable panel id')
for (const cluster of TOOL_CLUSTERS) {
  const panelId = toolClusterPanelId(cluster.id)
  assert.ok(isToolClusterPanelId(panelId), `${panelId} must be recognized as a cluster panel`)
  assert.ok(isDockablePanelId(panelId), `${panelId} must be floatable/dockable in every workspace`)
  assert.ok(DOCKABLE_PANEL_IDS.includes(panelId), `${panelId} must be in the dockable panel allowlist`)
  assert.ok(cluster.defaultFloat.w >= 100 && cluster.defaultFloat.h >= 80,
    `${cluster.id}: floating group needs a usable default size`)
}
// The Paint toolbar template is built from the same clusters the ribbon and
// Groups menu use, so no group can drift out of sync.
const paintSections = defaultToolbarLayout('paint')
assert.deepEqual(
  paintSections.slice(0, TOOL_CLUSTERS.length).map(section =>
    section.kind === 'single' ? [section.tool] : section.tools),
  TOOL_CLUSTERS.map(cluster => [...cluster.tools]),
  'Paint toolbar template must start with the shared toolbox clusters',
)
// Photoshop template must remain byte-identical to the shipped grouping.
assert.deepEqual(defaultToolbarLayout('photoshop').map(s => s.kind === 'single' ? [s.tool] : s.tools), [
  ['move', 'artboard'],
  ['marquee-rect', 'marquee-ellipse', 'marquee-row', 'marquee-column'],
  ['lasso', 'polygon-lasso', 'magnetic-lasso', 'selection-brush', 'quick-mask'],
  ['object-select', 'quick-select', 'magic-wand'],
  ['crop', 'perspective-crop', 'slice', 'slice-select', 'hotspot', 'frame'],
  ['eyedropper', 'color-sampler', 'measure', 'count'],
  ['remove', 'spot-healing', 'healing-brush', 'patch', 'content-aware-move', 'red-eye'],
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
  ['hand', 'rotate-view'],
  ['zoom'],
  // GIMP-style tools appended by the sanitizer when new tools register
  ['alignment', 'rotate', 'scale', 'shear', 'perspective', 'unified-transform', 'handle-transform', 'flip', 'cage-transform', 'warp-transform', 'scissors-select', 'foreground-select', 'airbrush', 'ink', 'mypaint-brush'],
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
const toolIconsSource = readFileSync(new URL('../src/editor/components/toolbar/tool-icons.tsx', import.meta.url), 'utf8')
const toolClustersSource = readFileSync(new URL('../src/editor/constants/tool-clusters.ts', import.meta.url), 'utf8')
const panelRegistrySource = readFileSync(new URL('../src/editor/components/panels/panel-registry.ts', import.meta.url), 'utf8')
assert.ok(toolIconsSource.includes('const WORKSPACE_CUSTOM_GLYPHS'), 'custom vector glyphs must be defined')
for (const glyph of ['artboard', 'path-select', 'direct-select', 'pen-freeform', 'slice', 'hotspot', 'lasso', 'crop', 'eyedropper', 'gradient', 'eraser', 'clone-stamp', 'healing-brush']) {
  assert.ok(new RegExp(`(?:'${glyph}'|${glyph}):`).test(toolIconsSource), `custom glyph required for ${glyph}`)
}
assert.ok(toolIconsSource.includes('WORKSPACE_CUSTOM_GLYPHS[workspacePreset]'),
  'custom glyphs must resolve by active workspace')
assert.ok(toolIconsSource.includes('const WORKSPACE_TOOL_ICONS'), 'workspace icon maps must be defined')
for (const preset of ['photoshop', 'illustrator', 'gimp', 'fireworks', 'paint']) {
  assert.ok(toolIconsSource.includes(`  ${preset}: {`), `${preset} must have a distinct tool icon map`)
}
assert.ok(toolIconsSource.includes('WORKSPACE_TOOL_ICONS[workspacePreset]'),
  'tool icon rendering must resolve through the active workspace preset')
assert.ok(toolbarSource.includes("from './tool-icons'"),
  'toolbar must reuse the shared workspace icon vocabulary')
assert.ok(toolClustersSource.includes('TOOL_CLUSTER_PANEL_IDS') && toolClustersSource.includes('toolClusterPanelId'),
  'toolbox clusters need stable panel ids')
assert.ok(panelRegistrySource.includes('TOOL_CLUSTERS.map') && panelRegistrySource.includes("home: 'cluster'"),
  'panel registry must expose every toolbox cluster as a floatable home panel')
assert.ok(toolbarSource.includes('TOOL_CLUSTERS.map') && toolbarSource.includes('RibbonClusterGroup'),
  'Paint ribbon must render the shared toolbox clusters with pop-out handles')
assert.ok(toolbarSource.includes('ToolClusterMenu'),
  'every workspace toolbar must offer a toolbox-groups pop-out menu')
assert.ok(toolbarSource.includes('flex-wrap') && !/data-toolbar-mode="paint-ribbon"[\s\S]{0,700}overflow-y-hidden/.test(toolbarSource),
  'Paint ribbon groups must wrap instead of clipping under a fixed-height row')
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
  assert.match(source, /historyLayerId = useRef/,
    `${component} must keep edits to different layers in separate undo steps`)
  assert.match(source, /historyLayerId\.current && historyLayerId\.current !== layerId/,
    `${component} must flush pending history when the selected layer changes`)
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
assert.match(editorShell, /<WorkspaceToolbox embedded=\{workspacePreset === 'gimp'\} \/>/,
  'GIMP toolbox must use the shared workspace toolbox in its wide toolbox column')
assert.match(editorShell, /workspacePreset === 'gimp'[\s\S]*?<ToolOptionsBar embedded layout="vertical" \/>/,
  'GIMP tool options must remain beneath the toolbox in a vertical contextual layout')
const toolOptionsSource = readFileSync(new URL('../src/editor/components/toolbar/tool-options-bar.tsx', import.meta.url), 'utf8')
assert.match(toolOptionsSource, /layout === 'vertical'[\s\S]*?'flex-col items-stretch'/,
  'GIMP tool options must stack controls vertically rather than wrap as a horizontal toolbar')
assert.match(toolOptionsSource, /layout !== 'vertical' && <VDivider \/>/,
  'GIMP tool options must not show horizontal toolbar dividers')
assert.match(editorShell, /workspacePreset !== 'gimp' && workspacePreset !== 'paint'[\s\S]*?<ToolOptionsBar embedded \/>/,
  'non-GIMP/non-Paint workspaces retain the shared horizontal tool-options strip')
assert.match(editorShell, /workspacePreset === 'paint'[\s\S]*?<Toolbar compact clusterWindows \/>[\s\S]*?<PaintColorPalette \/>[\s\S]*?<ToolOptionsBar embedded \/>/,
  'Paint workspace renders a top ribbon, quick color palette and contextual tool options')
assert.match(editorShell, /data-workspace-ribbon="paint"[\s\S]*?min-h-\[4\.5rem\][\s\S]*?min-h-9/,
  'Paint tools and tool-options rows must use normal flow with independent minimum heights')
assert.doesNotMatch(editorShell, /data-workspace-ribbon="paint"[\s\S]{0,700}h-\[4\.75rem\]/,
  'Paint ribbon must not reserve a fixed height that lets settings overlap the toolbar')
assert.match(editorShell, /!mobileMode && <LeftDock \/>/,
  'the left dock stays available in every workspace so toolbox groups can be docked there')
assert.match(editorShell, /!mobileMode && workspacePreset !== 'paint' &&[\s\S]{0,400}<WorkspaceToolbox embedded=\{workspacePreset === 'gimp'\} \/>/,
  'Paint keeps its ribbon and omits the permanent vertical tool rail; Fireworks swaps in its two-column toolbox')
const workspaceToolboxSource = readFileSync(new URL('../src/editor/components/toolbar/workspace-toolbox.tsx', import.meta.url), 'utf8')
assert.match(workspaceToolboxSource, /workspacePreset === 'fireworks'[\s\S]*?<FireworksToolbox \/>[\s\S]*?<Toolbar embedded=\{embedded\} \/>/,
  'the shared toolbox must switch to the Fireworks palette in that workspace')
assert.match(editorShell, /!mobileMode && workspacePreset === 'fireworks' && <FireworksToolbar \/>/,
  'Fireworks Expanded Mode renders its standard toolbar below the menu bar')
assert.match(editorShell, /workspacePreset !== 'gimp' && workspacePreset !== 'paint' && workspacePreset !== 'fireworks'[\s\S]{0,200}<ToolOptionsBar embedded \/>/,
  'Fireworks moves tool options out of the top strip and into Properties')
assert.match(editorShell, /workspacePreset === 'fireworks' && "w-\[84px\]"/,
  'Fireworks reserves a two-column toolbox width instead of the 43px rail')

// --- Fireworks Expanded Mode layout -------------------------------------------
const fireworksToolboxSource = readFileSync(new URL('../src/editor/components/toolbar/fireworks-toolbox.tsx', import.meta.url), 'utf8')
for (const group of ['Select', 'Bitmap', 'Vector', 'Web', 'Colors', 'View']) {
  assert.ok(fireworksToolboxSource.includes(`label: '${group}'`) || fireworksToolboxSource.includes(`aria-label="${group}"`),
    `Fireworks toolbox must expose its ${group} category`)
}
assert.ok(fireworksToolboxSource.includes('grid-cols-2'),
  'Fireworks toolbox tools must render in two columns')
assert.ok(fireworksToolboxSource.includes('<ToolClusterMenu showLabel />'),
  'Fireworks toolbox must keep the shared toolbox-groups menu')
const fireworksToolbarSource = readFileSync(new URL('../src/editor/components/shell/fireworks-toolbar.tsx', import.meta.url), 'utf8')
for (const command of ['New document', 'Open…', 'Save project', 'Undo', 'Redo', 'Cut layer', 'Copy layer', 'Paste layer', 'Zoom out', 'Zoom in', 'Fit on screen']) {
  assert.ok(fireworksToolbarSource.includes(`label="${command}"`), `Fireworks standard toolbar must expose ${command}`)
}
assert.ok(fireworksToolbarSource.includes('Expanded Mode'),
  'Fireworks standard toolbar must identify the Expanded Mode workspace')
const fireworksDocumentBarSource = readFileSync(new URL('../src/editor/components/workspace/fireworks-document-bar.tsx', import.meta.url), 'utf8')
for (const view of ['Original', 'Preview', '2-Up', '4-Up']) {
  assert.ok(fireworksDocumentBarSource.includes(`label: '${view}'`), `Fireworks document bar must expose the ${view} view`)
}
assert.ok(fireworksDocumentBarSource.includes('aria-label="Active page"'),
  'Fireworks document bar must expose the page selector')
const canvasWorkspaceSource = readFileSync(new URL('../src/editor/components/workspace/canvas-workspace.tsx', import.meta.url), 'utf8')
assert.match(canvasWorkspaceSource, /workspacePreset === 'fireworks' && \(\s*<FireworksDocumentBar/,
  'Fireworks must render its view bar below the document tabs')
assert.match(propertiesSource, /<ToolOptionsBar embedded \/>/,
  'Fireworks Properties strip must embed the contextual tool options')
assert.deepEqual(inspectorTemplateTabs('fireworks').upperTabs, ['optimize', 'history', 'align'],
  'Fireworks Expanded Mode opens with Optimize/History/Align')
assert.deepEqual(inspectorTemplateTabs('fireworks').lowerTabs, ['pages', 'states', 'layers'],
  'Fireworks Expanded Mode opens with Pages/States/Layers')
for (const panel of ['optimize', 'align', 'pages', 'states']) {
  assert.ok(isDockablePanelId(panel), `Fireworks ${panel} panel must be dockable in every workspace`)
  assert.ok(panelRegistrySource.includes(`id: '${panel}'`), `Fireworks ${panel} panel must be registered`)
}
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

console.log('Workspace templates: six presets, complete toolbars, per-template inspector stacks, Paint ribbon and Fireworks bottom Properties dock verified')
