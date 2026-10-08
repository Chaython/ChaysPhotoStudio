// Menu structure + command registry (File/Edit/Image/Layer/Select/Filter/Plugins/View/Window/Help)
import { engine } from '../engine/engine'
import { getFlatComposite } from '../engine/document'
import { useEditorStore } from '../store'
import { newDocumentFromClipboard, openFiles, placeImageAsSmartLayer, saveProject } from '../engine/io'
import { pluginManager } from '../plugins/plugin-manager'
import { importGimpBrushFile } from '../plugins/brush-presets'
import { importGimpGradientFile } from '../plugins/gradient-presets'
import type { AdjustmentType, FilterType } from '../types'
import { commandCombo, formatCombo, type CommandId } from '../shortcuts'
import { IMPORT_ACCEPT } from '../formats'

export interface MenuItem {
  id: string
  label?: string
  /** static label, or a function returning the LIVE label (reads the
   *  user's current shortcut overrides — TASK 17) */
  shortcut?: string | (() => string)
  separator?: boolean
  submenu?: MenuItem[]
  checked?: () => boolean
  enabled?: () => boolean
  run?: () => void
}

/** live shortcut label for a registry command — reflects edits made in the
 *  Keyboard Shortcuts dialog immediately (no reload needed) */
const sc = (id: CommandId) => () => formatCombo(commandCombo(id))

const S = (run?: () => void): MenuItem => ({ id: 'sep', separator: true, run })
const exportBaseName = (name: string) => name.replace(/\.zproj\.json$/i, '').replace(/\.[^.]+$/, '') || 'Untitled'

function fileInput(accept: string, multiple: boolean, cb: (files: FileList) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.multiple = multiple
  input.onchange = () => { if (input.files?.length) cb(input.files) }
  input.click()
}

const store = () => useEditorStore.getState()

/** grid size display label: 0 = adaptive (Auto) */
function gridSizeLabel(px: number): string {
  return px > 0 ? `${px} px` : 'Auto (zoom)'
}

const openDlg = (type: any, props?: any) => store().openDialog(type, props)

const transformItems: MenuItem[] = [
  { id: 'transform-again', label: 'Again', enabled: () => engine.canRepeatTransform(), run: () => engine.repeatLastTransform() },
  S(),
  { id: 'transform-scale', label: 'Scale…', run: () => openDlg('transform', { layerId: engine.activeLayer?.id, mode: 'scale' }) },
  { id: 'transform-rotate', label: 'Rotate…', run: () => openDlg('transform', { layerId: engine.activeLayer?.id, mode: 'rotate' }) },
  { id: 'transform-skew', label: 'Skew…', run: () => openDlg('transform', { layerId: engine.activeLayer?.id, mode: 'skew' }) },
  { id: 'transform-distort', label: 'Distort…', run: () => openDlg('transform', { layerId: engine.activeLayer?.id, mode: 'distort' }) },
  { id: 'transform-perspective', label: 'Perspective…', run: () => openDlg('transform', { layerId: engine.activeLayer?.id, mode: 'perspective' }) },
  { id: 'transform-warp', label: 'Warp…', run: () => openDlg('transform', { layerId: engine.activeLayer?.id, mode: 'warp' }) },
  S(),
  { id: 'transform-180', label: 'Rotate 180°', run: () => engine.transformLayer(engine.activeLayer?.id ?? '', { mode: 'rotate', rotation: 180 }) },
  { id: 'transform-90cw', label: 'Rotate 90° Clockwise', run: () => engine.transformLayer(engine.activeLayer?.id ?? '', { mode: 'rotate', rotation: 90 }) },
  { id: 'transform-90ccw', label: 'Rotate 90° Counter Clockwise', run: () => engine.transformLayer(engine.activeLayer?.id ?? '', { mode: 'rotate', rotation: -90 }) },
  { id: 'transform-flip-h', label: 'Flip Horizontal', run: () => { const l = engine.activeLayer; if (l) engine.flipLayer(l.id, 'horizontal') } },
  { id: 'transform-flip-v', label: 'Flip Vertical', run: () => { const l = engine.activeLayer; if (l) engine.flipLayer(l.id, 'vertical') } },
]

// ---------- Image > Adjustments (destructive) ----------
const adjustmentItems: MenuItem[] = ([
  'brightness-contrast', 'levels', 'exposure', 'vibrance', 'hue-saturation',
  'color-balance', 'black-white', 'photo-filter', 'channel-mixer', 'selective-color',
  'curves', 'gradient-map', 'posterize', 'threshold', 'camera-raw', 'shadow-highlight',
  'color-lookup', 'equalize',
] as AdjustmentType[]).map(t => ({
  id: `adj-${t}`,
  label: adjLabel(t),
  run: () => {
    const layer = engine.activeLayer
    if (!layer) { store().pushToast('No active layer', 'error'); return }
    openDlg(t as any, { layerId: layer.id, mode: 'direct' })
  },
}))
adjustmentItems.push({
  id: 'adj-invert', label: 'Invert', shortcut: sc('invert'),
  run: () => {
    const layer = engine.activeLayer
    if (layer) engine.applyAdjustmentToLayer(layer.id, 'invert', {})
  },
})
adjustmentItems.push({
  id: 'adj-match-color', label: 'Match Color…',
  run: () => openDlg('match-color'),
})

function adjLabel(t: string): string {
  const map: Record<string, string> = {
    'brightness-contrast': 'Brightness/Contrast…', levels: 'Levels…', exposure: 'Exposure…',
    vibrance: 'Vibrance…', 'hue-saturation': 'Hue/Saturation…', 'color-balance': 'Color Balance…',
    'black-white': 'Black & White…', 'photo-filter': 'Photo Filter…', 'channel-mixer': 'Channel Mixer…',
    'selective-color': 'Selective Color…', curves: 'Curves…', 'gradient-map': 'Gradient Map…',
    posterize: 'Posterize…', threshold: 'Threshold…', 'camera-raw': 'Camera Raw Basic…',
    'shadow-highlight': 'Shadow/Highlight…', 'color-lookup': 'Color Lookup…', equalize: 'Equalize…',
  }
  return map[t] ?? t
}

// ---------- Layer > New Adjustment Layer ----------
const newAdjLayerItems: MenuItem[] = ([
  'curves', 'levels', 'brightness-contrast', 'exposure', 'vibrance', 'hue-saturation',
  'color-balance', 'black-white', 'photo-filter', 'channel-mixer', 'selective-color',
  'gradient-map', 'posterize', 'threshold', 'camera-raw', 'shadow-highlight',
  'color-lookup',
] as AdjustmentType[]).map(t => ({
  id: `al-${t}`,
  label: adjLabel(t),
  run: () => { engine.addAdjustmentLayer(t) },
}))


// Photoshop-style arrangement of the current layer (index 0 = bottom).
type ArrangeDirection = 'front' | 'forward' | 'backward' | 'back'
function arrangeActiveLayer(direction: ArrangeDirection): void {
  const doc = engine.activeDoc
  const layer = engine.activeLayer
  if (!doc || !layer) return
  const idx = doc.layers.findIndex(l => l.id === layer.id)
  if (idx < 0) return
  const last = doc.layers.length - 1
  const target = direction === 'front' ? last
    : direction === 'forward' ? Math.min(last, idx + 1)
    : direction === 'backward' ? Math.max(0, idx - 1) : 0
  engine.reorderLayer(layer.id, target)
}
function canArrangeLayer(direction: ArrangeDirection): boolean {
  const doc = engine.activeDoc
  const layer = engine.activeLayer
  if (!doc || !layer) return false
  const idx = doc.layers.findIndex(l => l.id === layer.id)
  return idx >= 0 && (direction === 'front' || direction === 'forward'
    ? idx < doc.layers.length - 1 : idx > 0)
}
const layerArrangeMenu: MenuItem[] = [
  { id: 'layer-arrange-front', label: 'Bring to Front', shortcut: sc('bringToFront'), enabled: () => canArrangeLayer('front'), run: () => arrangeActiveLayer('front') },
  { id: 'layer-arrange-forward', label: 'Bring Forward', shortcut: sc('bringForward'), enabled: () => canArrangeLayer('forward'), run: () => arrangeActiveLayer('forward') },
  { id: 'layer-arrange-backward', label: 'Send Backward', shortcut: sc('sendBackward'), enabled: () => canArrangeLayer('backward'), run: () => arrangeActiveLayer('backward') },
  { id: 'layer-arrange-back', label: 'Send to Back', shortcut: sc('sendToBack'), enabled: () => canArrangeLayer('back'), run: () => arrangeActiveLayer('back') },
]

// ---------- Layer > Align / Distribute (editable, non-destructive) ----------
type LayerAlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
type LayerAlignReference = 'selection' | 'primary' | 'canvas'
const layerAlignModes: { id: LayerAlignMode; label: string }[] = [
  { id: 'left', label: 'Left Edges' },
  { id: 'hcenter', label: 'Horizontal Centers' },
  { id: 'right', label: 'Right Edges' },
  { id: 'top', label: 'Top Edges' },
  { id: 'vcenter', label: 'Vertical Centers' },
  { id: 'bottom', label: 'Bottom Edges' },
]
const layerAlignMenu: MenuItem[] = ([
  { id: 'selection', label: 'Selected Layer Bounds' },
  { id: 'primary', label: 'Active Layer' },
  { id: 'canvas', label: 'Canvas' },
] as { id: LayerAlignReference; label: string }[]).map(reference => ({
  id: `layer-align-${reference.id}`,
  label: reference.label,
  enabled: () => engine.selectedLayers().length >= (reference.id === 'canvas' ? 1 : 2),
  submenu: layerAlignModes.map(mode => ({
    id: `layer-align-${reference.id}-${mode.id}`,
    label: mode.label,
    run: () => engine.alignSelected(mode.id, reference.id),
  })),
}))

const layerDistributeMenu: MenuItem[] = [
  { id: 'layer-distribute-h', label: 'Horizontal Centers', run: () => engine.distributeSelected('horizontal') },
  { id: 'layer-distribute-v', label: 'Vertical Centers', run: () => engine.distributeSelected('vertical') },
  S(),
  { id: 'layer-distribute-spacing-h', label: 'Horizontal Spacing', run: () => engine.distributeSelectedSpacing('horizontal') },
  { id: 'layer-distribute-spacing-v', label: 'Vertical Spacing', run: () => engine.distributeSelectedSpacing('vertical') },
]

// ---------- Filters ----------
const filterGroups: { label: string; filters: FilterType[] }[] = [
  { label: 'Blur', filters: ['gaussian-blur', 'box-blur', 'motion-blur', 'radial-blur', 'average'] },
  { label: 'Sharpen', filters: ['smart-sharpen'] },
  { label: 'Noise', filters: ['add-noise', 'median', 'dust-scratches'] },
  { label: 'Pixelate', filters: ['mosaic', 'crystallize', 'newsprint'] },
  { label: 'Stylize', filters: ['find-edges', 'emboss', 'wind', 'oil-paint', 'diffuse-glow'] },
  { label: 'Distort', filters: ['twirl', 'wave', 'spherize', 'zigzag', 'pinch', 'shear', 'glass', 'ocean-ripple', 'displace', 'chromatic-aberration'] },
  { label: 'Render', filters: ['clouds', 'difference-clouds', 'fibers', 'lens-flare', 'vignette', 'bloom'] },
  { label: 'Other', filters: ['high-pass', 'custom-kernel', 'minimum', 'maximum', 'lens-correction'] },
]

function filterLabel(t: string): string {
  const map: Record<string, string> = {
    'gaussian-blur': 'Gaussian Blur…', 'box-blur': 'Box Blur…', 'motion-blur': 'Motion Blur…',
    'radial-blur': 'Radial Blur…', 'smart-sharpen': 'Unsharp Mask…', 'add-noise': 'Add Noise…',
    median: 'Median…', 'dust-scratches': 'Dust & Scratches…', mosaic: 'Mosaic…',
    crystallize: 'Crystallize…', 'find-edges': 'Find Edges', emboss: 'Emboss…',
    wind: 'Wind…', 'oil-paint': 'Oil Paint…', 'high-pass': 'High Pass…',
    'custom-kernel': 'Custom Kernel…', minimum: 'Minimum…', maximum: 'Maximum…',
    twirl: 'Twirl…', wave: 'Wave…', spherize: 'Spherize…', clouds: 'Clouds…',
    'lens-flare': 'Lens Flare…', newsprint: 'Newsprint…', vignette: 'Vignette…',
    bloom: 'Bloom…', 'chromatic-aberration': 'Chromatic Aberration…',
    'diffuse-glow': 'Diffuse Glow…', glass: 'Glass…', 'ocean-ripple': 'Ocean Ripple…',
    zigzag: 'Zigzag…', pinch: 'Pinch…', displace: 'Displace…', fibers: 'Fibers…',
    'difference-clouds': 'Difference Clouds…', average: 'Average…',
    'lens-correction': 'Lens Correction…', shear: 'Shear…',
  }
  return map[t] ?? t
}

const filterMenu: MenuItem[] = filterGroups.map(g => ({
  id: `fg-${g.label}`,
  label: g.label,
  submenu: g.filters.map(f => ({
    id: `f-${f}`,
    label: filterLabel(f),
    run: () => {
      const layer = engine.activeLayer
      if (!layer) { store().pushToast('No active layer', 'error'); return }
      if (f === 'find-edges') { void engine.applyFilterToLayerAsync(layer.id, f, {}); return }
      openDlg(f as any, { layerId: layer.id })
    },
  })),
}))

// ---------- Plugins (Task 7-A) ----------

/** position of the Plugins menu inside MENUS (menu-bar swaps in the dynamic items) */
export const PLUGINS_MENU_INDEX = 6

/**
 * Full Plugins menu: static entries + commands of every ENABLED installed
 * plugin. MENUS is a static const, so the menu bar calls THIS getter on every
 * render — pluginManager bumps the store renderTick on install/enable/remove,
 * which re-renders the menu bar and picks the new commands up (the same
 * checked()/enabled() live-evaluation pattern the rest of the menus use).
 */
export function getPluginsMenuItems(): MenuItem[] {
  const dynamic: MenuItem[] = pluginManager
    .list()
    .filter(p => p.enabled && p.commands.length > 0)
    .flatMap(p => p.commands.map(c => ({
      id: `plug-${p.manifest.id}-${c.id}`,
      label: `${p.manifest.name}: ${c.label}`,
      run: () => { void pluginManager.runCommand(p.manifest.id, c.id) },
    })))
  const items: MenuItem[] = [
    { id: 'plugins-manager', label: 'Plugin Manager…', run: () => openDlg('plugin-manager') },
    S(),
  ]
  if (dynamic.length) {
    items.push(...dynamic, S())
  }
  items.push(
    { id: 'plugins-import-brush', label: 'Import GIMP Brush…', run: () => { void importGimpBrushFile() } },
    { id: 'plugins-import-gradient', label: 'Import GIMP Gradient…', run: () => { void importGimpGradientFile() } },
  )
  return items
}

/** static fallback (the dynamic getter above is what the menu bar renders) */
const pluginsMenuStatic: MenuItem[] = [
  { id: 'plugins-manager', label: 'Plugin Manager…', run: () => openDlg('plugin-manager') },
  S(),
  { id: 'plugins-import-brush', label: 'Import GIMP Brush…', run: () => { void importGimpBrushFile() } },
  { id: 'plugins-import-gradient', label: 'Import GIMP Gradient…', run: () => { void importGimpGradientFile() } },
]

export const MENUS: MenuItem[][] = [
  // ================= FILE =================
  [
    { id: 'file-new', label: 'New…', shortcut: sc('newDoc'), run: () => openDlg('new-doc') },
    { id: 'file-new-clipboard', label: 'New from Clipboard', run: () => { void newDocumentFromClipboard() } },
    { id: 'file-open', label: 'Open…', shortcut: sc('open'), run: () => fileInput(IMPORT_ACCEPT, true, files => openFiles(Array.from(files))) },
    { id: 'file-open-as-layer', label: 'Open as Layer…', run: () => fileInput(IMPORT_ACCEPT, true, files => openFiles(Array.from(files), true)) },
    { id: 'file-place', label: 'Place (Smart Object)…', run: () => fileInput(IMPORT_ACCEPT, false, files => placeImageAsSmartLayer(files[0])) },
    { id: 'file-ai-generate', label: 'AI Generate Image…', run: () => openDlg('ai-generate') },
    { id: 'file-ai-tools', label: 'AI Tools & ComfyUI…', run: () => openDlg('ai-tools') },
    S(),
    { id: 'file-open-recent', label: 'Recent & Recovery…', run: () => openDlg('recovery') },
    { id: 'file-info', label: 'File Info / Metadata…', enabled: () => !!engine.activeDoc, run: () => store().revealPanel('metadata') },
    S(),
    { id: 'file-save-project', label: 'Save Project', shortcut: sc('save'), run: () => { void saveProject() } },
    { id: 'file-save-project-as', label: 'Save Project As…', shortcut: sc('saveAs'), run: () => { void saveProject({ saveAs: true }) } },
    { id: 'file-export', label: 'Export As…', shortcut: sc('export'), run: () => openDlg('export') },
    { id: 'file-export-layers', label: 'Export Layers to Files…', enabled: () => !!engine.activeDoc?.layers.some(layer => layer.kind !== 'adjustment'), run: () => openDlg('export-layers') },
    { id: 'file-quick-export', label: 'Quick Export PNG', run: async () => {
      const doc = engine.activeDoc
      if (doc) await engine.exportActive({ format: 'png', quality: 100, scale: 1, fileName: exportBaseName(doc.name) })
    } },
    { id: 'file-quick-export-webp', label: 'Quick Export WebP', run: async () => {
      const doc = engine.activeDoc
      if (doc) await engine.exportActive({ format: 'webp', quality: 92, scale: 1, fileName: exportBaseName(doc.name) })
    } },
    { id: 'file-quick-export-jpeg', label: 'Quick Export JPEG', run: async () => {
      const doc = engine.activeDoc
      if (doc) await engine.exportActive({ format: 'jpeg', quality: 92, scale: 1, fileName: exportBaseName(doc.name) })
    } },
    S(),
    { id: 'file-close', label: 'Close', run: () => { const d = engine.activeDoc; if (d) engine.closeDocument(d.id) } },
  ],
  // ================= EDIT =================
  [
    { id: 'edit-undo', label: 'Undo', shortcut: sc('undo'), enabled: () => (engine.activeDoc?.history.index ?? 0) > 0, run: () => engine.undo() },
    { id: 'edit-redo', label: 'Redo', shortcut: sc('redo'), enabled: () => (engine.activeDoc?.history.index ?? -1) < (engine.activeDoc?.history.states.length ?? 0) - 1, run: () => engine.redo() },
    S(),
    { id: 'edit-copy', label: 'Copy Layer', shortcut: sc('copy'), run: () => engine.copyLayer(false) },
    { id: 'edit-copy-merged', label: 'Copy Merged', shortcut: sc('copyMerged'), run: () => engine.copyLayer(true) },
    { id: 'edit-cut', label: 'Cut', shortcut: sc('cut'), run: () => engine.cutLayer() },
    { id: 'edit-paste', label: 'Paste', shortcut: sc('paste'), run: () => engine.pasteLayer() },
    { id: 'edit-paste-into', label: 'Paste Into Selection', shortcut: sc('pasteInto'),
      enabled: () => engine.canPasteIntoSelection(), run: () => { void engine.pasteIntoSelection() } },
    { id: 'edit-paste-outside', label: 'Paste Outside Selection',
      enabled: () => engine.canPasteOutsideSelection(), run: () => { void engine.pasteOutsideSelection() } },
    { id: 'edit-paste-center', label: 'Paste at Canvas Center',
      enabled: () => !!engine.activeDoc, run: () => { void engine.pasteAtCanvasCenter() } },
    { id: 'edit-paste-system', label: 'Paste External Image', 
      enabled: () => typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function',
      submenu: [
        { id: 'edit-paste-system-normal', label: 'As New Layer',
          run: () => { void engine.pasteFromSystemClipboard(false) } },
        { id: 'edit-paste-system-into', label: 'Into Selection',
          enabled: () => !!engine.activeDoc?.selection,
          run: () => { void engine.pasteFromSystemClipboard(true) } },
        { id: 'edit-paste-system-outside', label: 'Outside Selection',
          enabled: () => !!engine.activeDoc?.selection,
          run: () => { void engine.pasteFromSystemClipboard(false, true) } },
      ] },
    S(),
    { id: 'edit-fill-fg', label: 'Fill with Foreground', shortcut: sc('fillFg'), run: () => engine.fillSelection(store().fgColor) },
    { id: 'edit-fill-bg', label: 'Fill with Background', shortcut: sc('fillBg'), run: () => engine.fillSelection(store().bgColor) },
    { id: 'edit-clear', label: 'Clear Selection', shortcut: sc('clearSelection'), run: () => engine.deleteSelectionPixels() },
    S(),
    { id: 'edit-transform', label: 'Free Transform…', shortcut: sc('transform'), run: () => openDlg('transform', { layerId: engine.activeLayer?.id, mode: 'free' }) },
    { id: 'edit-transform-submenu', label: 'Transform', submenu: transformItems },
    { id: 'edit-puppet-warp', label: 'Puppet Warp…', enabled: () => !!engine.activeLayer && engine.activeLayer.kind !== 'adjustment', run: () => openDlg('puppet-warp', { layerId: engine.activeLayer?.id }) },
    S(),
    { id: 'edit-caf', label: 'Content-Aware Fill…', run: () => openDlg('content-aware-fill') },
    S(),
    { id: 'edit-shortcuts', label: 'Keyboard Shortcuts…', run: () => openDlg('shortcuts') },
    { id: 'edit-customize-toolbar', label: 'Customize Toolbar…', run: () => openDlg('customize-toolbar') },
  ],
  // ================= IMAGE =================
  [
    { id: 'img-duplicate', label: 'Duplicate…', enabled: () => !!engine.activeDoc, run: () => engine.duplicateDocument() },
    S(),
    { id: 'img-size', label: 'Image Size…', shortcut: sc('imageSize'), run: () => openDlg('image-size') },
    { id: 'img-ai-upscale', label: 'AI Upscale…', shortcut: sc('aiUpscale'), run: () => openDlg('ai-upscale') },
    { id: 'img-ca-scale', label: 'Content-Aware Scale…', run: () => openDlg('content-aware-scale') },
    { id: 'img-canvas-size', label: 'Canvas Size…', shortcut: sc('canvasSize'), run: () => openDlg('canvas-size') },
    S(),
    { id: 'img-auto-tone', label: 'Auto Tone', shortcut: sc('autoTone'), run: () => void engine.autoCorrectAsync('tone') },
    { id: 'img-auto-contrast', label: 'Auto Contrast', shortcut: sc('autoContrast'), run: () => void engine.autoCorrectAsync('contrast') },
    { id: 'img-auto-color', label: 'Auto Color', shortcut: sc('autoColor'), run: () => void engine.autoCorrectAsync('color') },
    S(),
    { id: 'img-rotate-90cw', label: 'Rotate 90° CW', run: () => engine.rotateCanvas(90) },
    { id: 'img-rotate-90ccw', label: 'Rotate 90° CCW', run: () => engine.rotateCanvas(-90) },
    { id: 'img-rotate-180', label: 'Rotate 180°', run: () => engine.rotateCanvas(180) },
    { id: 'img-flip-h', label: 'Flip Canvas Horizontal', run: () => engine.flipCanvas('horizontal') },
    { id: 'img-flip-v', label: 'Flip Canvas Vertical', run: () => engine.flipCanvas('vertical') },
    S(),
    { id: 'img-crop-selection', label: 'Crop to Selection', run: () => {
      const doc = engine.activeDoc
      if (doc?.selection) engine.cropTo(doc.selection.bounds)
      else store().pushToast('No selection', 'error')
    } },
    { id: 'img-reveal-all', label: 'Reveal All', enabled: () => !!engine.activeDoc,
      run: () => { if (!engine.revealAll()) store().pushToast('No off-canvas visible content to reveal', 'info') } },
    { id: 'img-trim', label: 'Trim Transparent Pixels', run: () => {
      const doc = engine.activeDoc
      if (!doc) return
      // compute opaque bounds of composite
      const flat = getFlatComposite(doc)
      const d = flat.getContext('2d')!.getImageData(0, 0, flat.width, flat.height).data
      let minX = flat.width, minY = flat.height, maxX = -1, maxY = -1
      for (let y = 0; y < flat.height; y++) for (let x = 0; x < flat.width; x++) {
        if (d[(y * flat.width + x) * 4 + 3] > 4) {
          if (x < minX) minX = x; if (x > maxX) maxX = x
          if (y < minY) minY = y; if (y > maxY) maxY = y
        }
      }
      if (maxX < 0) return
      engine.cropTo({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 })
    } },
    S(),
    { id: 'img-apply-image', label: 'Apply Image…', enabled: () => !!engine.activeLayer && engine.activeLayer.kind !== 'adjustment', run: () => openDlg('apply-image') },
    { id: 'img-calculations', label: 'Calculations…', enabled: () => !!engine.activeDoc, run: () => openDlg('calculations') },
    S(),
    { id: 'img-adjustments', label: 'Adjustments', submenu: adjustmentItems },
  ],
  // ================= LAYER =================
  [
    { id: 'layer-new', label: 'New Layer', shortcut: sc('newLayer'), run: () => engine.addRasterLayer() },
    { id: 'layer-via-copy', label: 'Layer via Copy / Duplicate', shortcut: sc('duplicateLayer'),
      enabled: () => !!engine.activeLayer && engine.activeLayer.kind !== 'adjustment',
      run: () => engine.duplicateLayerOrSelection() },
    { id: 'layer-via-cut', label: 'Layer via Cut', shortcut: sc('layerViaCut'),
      enabled: () => !!engine.activeDoc?.selection && engine.activeLayer?.kind === 'raster' && !engine.activeLayer.locked,
      run: () => engine.layerViaSelection('cut') },
    { id: 'layer-duplicate', label: 'Duplicate Entire Layer', run: () => { const l = engine.activeLayer; if (l) engine.duplicateLayer(l.id) } },
    { id: 'layer-duplicate-into', label: 'Duplicate Into…', enabled: () => !!engine.activeLayer && engine.docs.length > 1, run: () => openDlg('duplicate-layer', { layerId: engine.activeLayer?.id }) },
    { id: 'layer-delete', label: 'Delete Layer', run: () => engine.deleteLayer() },
    S(),
    { id: 'layer-new-adj', label: 'New Adjustment Layer', submenu: newAdjLayerItems },
    S(),
    { id: 'layer-arrange', label: 'Arrange', enabled: () => (engine.activeDoc?.layers.length ?? 0) > 1, submenu: layerArrangeMenu },
    { id: 'layer-lock', label: 'Lock Selected Layers', enabled: () => engine.canSetSelectedLayersLocked(true), run: () => engine.setSelectedLayersLocked(true) },
    { id: 'layer-unlock', label: 'Unlock Selected Layers', enabled: () => engine.canSetSelectedLayersLocked(false), run: () => engine.setSelectedLayersLocked(false) },
    { id: 'layer-align', label: 'Align', enabled: () => engine.selectedLayers().length > 0, submenu: layerAlignMenu },
    { id: 'layer-distribute', label: 'Distribute', enabled: () => engine.selectedLayers().length >= 3, submenu: layerDistributeMenu },
    S(),
    { id: 'layer-mask', label: 'Layer Mask', enabled: () => !!engine.activeLayer, submenu: [
      { id: 'layer-mask-reveal', label: 'Reveal All',
        enabled: () => !!engine.activeLayer && !engine.activeLayer.mask && !engine.activeLayer.locked,
        run: () => { const l = engine.activeLayer; if (l) engine.addLayerMaskMode(l.id, 'reveal-all') } },
      { id: 'layer-mask-hide-all', label: 'Hide All',
        enabled: () => !!engine.activeLayer && !engine.activeLayer.mask && !engine.activeLayer.locked,
        run: () => { const l = engine.activeLayer; if (l) engine.addLayerMaskMode(l.id, 'hide-all') } },
      { id: 'layer-mask-from-sel', label: 'Reveal Selection',
        enabled: () => !!engine.activeDoc?.selection && !!engine.activeLayer && !engine.activeLayer.mask && !engine.activeLayer.locked,
        run: () => { const l = engine.activeLayer; if (l) engine.addLayerMaskMode(l.id, 'reveal-selection') } },
      { id: 'layer-mask-hide-sel', label: 'Hide Selection',
        enabled: () => !!engine.activeDoc?.selection && !!engine.activeLayer && !engine.activeLayer.mask && !engine.activeLayer.locked,
        run: () => { const l = engine.activeLayer; if (l) engine.addLayerMaskMode(l.id, 'hide-selection') } },
      S(),
      { id: 'layer-mask-invert', label: 'Invert Layer Mask',
        enabled: () => !!engine.activeLayer?.mask && !engine.activeLayer.locked,
        run: () => { const l = engine.activeLayer; if (l) engine.invertLayerMask(l.id) } },
      { id: 'layer-mask-save-channel', label: 'Save Mask as Alpha Channel',
        enabled: () => !!engine.activeLayer?.mask,
        run: () => { const l = engine.activeLayer; if (l) engine.saveLayerMaskAsChannel(l.id) } },
      { id: 'layer-mask-copy', label: 'Copy Layer Mask',
        enabled: () => !!engine.activeLayer?.mask,
        run: () => { const l = engine.activeLayer; if (l) engine.copyLayerMask(l.id) } },
      { id: 'layer-mask-paste', label: 'Paste Layer Mask',
        enabled: () => engine.canPasteLayerMask(),
        run: () => { const l = engine.activeLayer; if (l) engine.pasteLayerMask(l.id) } },
      { id: 'layer-mask-replace', label: 'Replace Mask with Copied Mask',
        enabled: () => engine.canPasteLayerMask(true),
        run: () => { const l = engine.activeLayer; if (l) engine.pasteLayerMask(l.id, true) } },
      { id: 'layer-mask-disable', label: 'Disable Layer Mask',
        enabled: () => !!engine.activeLayer?.mask && !!engine.activeLayer.maskEnabled && !engine.activeLayer.locked,
        run: () => { const l = engine.activeLayer; if (l) engine.setLayerMaskEnabled(l.id, false) } },
      { id: 'layer-mask-enable', label: 'Enable Layer Mask',
        enabled: () => !!engine.activeLayer?.mask && !engine.activeLayer.maskEnabled && !engine.activeLayer.locked,
        run: () => { const l = engine.activeLayer; if (l) engine.setLayerMaskEnabled(l.id, true) } },
      S(),
      { id: 'layer-mask-apply', label: 'Apply Layer Mask',
        enabled: () => engine.activeLayer?.kind === 'raster' && !!engine.activeLayer.mask &&
          !!engine.activeLayer.maskEnabled && !engine.activeLayer.locked,
        run: () => { const l = engine.activeLayer; if (l) engine.deleteLayerMask(l.id, true) } },
      { id: 'layer-mask-delete', label: 'Delete Layer Mask',
        enabled: () => !!engine.activeLayer?.mask && !engine.activeLayer.locked,
        run: () => { const l = engine.activeLayer; if (l) engine.deleteLayerMask(l.id, false) } },
    ] },
    S(),
    { id: 'layer-clip', label: 'Create/Release Clipping Mask', shortcut: sc('toggleClipping'), run: () => { const l = engine.activeLayer; if (l) engine.toggleClipping(l.id) } },
    S(),
    { id: 'layer-style', label: 'Layer Style…', run: () => openDlg('layer-styles', { layerId: engine.activeLayer?.id }) },
    { id: 'layer-style-copy', label: 'Copy Layer Style', enabled: () => !!engine.activeLayer?.fx, run: () => { const l = engine.activeLayer; if (l) engine.copyLayerStyle(l.id) } },
    { id: 'layer-style-paste', label: 'Paste Layer Style', enabled: () => !!engine.activeLayer && engine.activeLayer.kind !== 'adjustment' && engine.canPasteLayerStyle, run: () => { const l = engine.activeLayer; if (l) engine.pasteLayerStyle(l.id) } },
    { id: 'layer-style-clear', label: 'Clear Layer Style', enabled: () => !!engine.activeLayer?.fx, run: () => { const l = engine.activeLayer; if (l) engine.clearLayerStyle(l.id) } },
    { id: 'layer-expand-frame', label: 'Expand to Fill Frame', run: () => { const l = engine.activeLayer; if (l) engine.expandLayerToFrame(l.id) } },
    { id: 'layer-trim-content', label: 'Trim Layer to Content', run: () => { const l = engine.activeLayer; if (l) engine.trimLayerToContent(l.id) } },
    { id: 'layer-matting', label: 'Matting', enabled: () => !!engine.activeLayer && engine.activeLayer.kind !== 'adjustment' && !engine.activeLayer.locked, submenu: [
      { id: 'layer-matting-defringe', label: 'Defringe…', run: () => {
        const l = engine.activeLayer
        if (!l) return
        const raw = prompt('Defringe width (pixels):', '1')
        if (raw === null) return
        const px = Math.max(1, Math.min(64, Math.round(Number(raw) || 0)))
        if (px > 0) engine.defringeLayer(l.id, px)
      } },
      { id: 'layer-matting-remove-black', label: 'Remove Black Matte', run: () => { const l = engine.activeLayer; if (l) engine.removeLayerMatte(l.id, 'black') } },
      { id: 'layer-matting-remove-white', label: 'Remove White Matte', run: () => { const l = engine.activeLayer; if (l) engine.removeLayerMatte(l.id, 'white') } },
    ] },
    S(),
    { id: 'layer-rasterize', label: 'Rasterize Layer', run: () => engine.rasterizeLayer() },
    { id: 'layer-merge-down', label: 'Merge Down', shortcut: sc('mergeDown'), run: () => engine.mergeDown() },
    { id: 'layer-merge-visible', label: 'Merge Visible', shortcut: sc('mergeVisible'), run: () => engine.mergeVisible() },
    { id: 'layer-flatten', label: 'Flatten Image', run: () => engine.flatten() },
  ],
  // ================= SELECT =================
  [
    { id: 'sel-all', label: 'All', shortcut: sc('selectAll'), run: () => engine.selectAll() },
    { id: 'sel-deselect', label: 'Deselect', shortcut: sc('deselect'), run: () => engine.deselect() },
    { id: 'sel-reselect', label: 'Reselect', shortcut: sc('reselect'), enabled: () => engine.canReselectSelection(), run: () => engine.reselectSelection() },
    { id: 'sel-inverse', label: 'Inverse', shortcut: sc('invertSelection'), run: () => engine.invertSelection() },
    { id: 'sel-layer-alpha', label: 'Load Layer Transparency', enabled: () => !!engine.activeLayer && engine.activeLayer.kind !== 'adjustment',
      submenu: [
        { id: 'sel-layer-alpha-new', label: 'Replace Selection', run: () => engine.loadLayerTransparency('new') },
        { id: 'sel-layer-alpha-add', label: 'Add to Selection', run: () => engine.loadLayerTransparency('add') },
        { id: 'sel-layer-alpha-sub', label: 'Subtract from Selection', run: () => engine.loadLayerTransparency('subtract') },
        { id: 'sel-layer-alpha-intersect', label: 'Intersect with Selection', run: () => engine.loadLayerTransparency('intersect') },
      ] },
    { id: 'sel-mask-alpha', label: 'Load Layer Mask as Selection',
      enabled: () => !!engine.activeLayer?.mask, submenu: [
        { id: 'sel-mask-alpha-new', label: 'Replace Selection', run: () => engine.loadLayerMaskAsSelection('new') },
        { id: 'sel-mask-alpha-add', label: 'Add to Selection', run: () => engine.loadLayerMaskAsSelection('add') },
        { id: 'sel-mask-alpha-sub', label: 'Subtract from Selection', run: () => engine.loadLayerMaskAsSelection('subtract') },
        { id: 'sel-mask-alpha-intersect', label: 'Intersect with Selection', run: () => engine.loadLayerMaskAsSelection('intersect') },
      ] },
    S(),
    { id: 'sel-subject', label: 'Select Subject', run: () => engine.selectSubject() },
    { id: 'sel-detect-objects', label: 'Detect Objects (AI)…', run: () => openDlg('detect-objects') },
    { id: 'sel-color-range', label: 'Color Range…', run: () => openDlg('color-range') },
    { id: 'sel-focus', label: 'Focus Area…', run: () => engine.focusAreaSelect({ threshold: 6 }) },
    { id: 'sel-color-grow', label: 'Grow (Similar Colors)…',
      enabled: () => !!engine.activeDoc?.selection,
      run: () => { const raw = prompt('Grow color tolerance (0–100):', '32'); if (raw !== null && raw.trim()) void engine.selectionColorMatch('grow', Number(raw)) } },
    { id: 'sel-color-similar', label: 'Similar…',
      enabled: () => !!engine.activeDoc?.selection,
      run: () => { const raw = prompt('Select Similar tolerance (0–100):', '32'); if (raw !== null && raw.trim()) void engine.selectionColorMatch('similar', Number(raw)) } },
    S(),
    { id: 'sel-modify', label: 'Modify', enabled: () => !!engine.activeDoc?.selection, submenu: [
      { id: 'sel-border', label: 'Border…', run: () => { const raw = prompt('Border width (pixels):', '8'); if (raw !== null) engine.selectionModify('border', Number(raw)) } },
      { id: 'sel-smooth', label: 'Smooth…', run: () => { const raw = prompt('Smooth radius (pixels):', '4'); if (raw !== null) engine.selectionModify('smooth', Number(raw)) } },
      { id: 'sel-grow', label: 'Expand…', run: () => { const raw = prompt('Expand by (pixels):', '4'); if (raw !== null) engine.selectionModify('grow', Number(raw)) } },
      { id: 'sel-contract', label: 'Contract…', run: () => { const raw = prompt('Contract by (pixels):', '4'); if (raw !== null) engine.selectionModify('contract', Number(raw)) } },
      { id: 'sel-feather', label: 'Feather…', run: () => { const raw = prompt('Feather radius (pixels):', '5'); if (raw !== null) engine.selectionModify('feather', Number(raw)) } },
    ] },
    S(),
    { id: 'sel-refine', label: 'Select and Mask…', shortcut: sc('selectMask'), run: () => openDlg('select-mask') },
    S(),
    { id: 'sel-save-channel', label: 'Save Selection as Channel', run: () => engine.saveSelectionChannel() },
    { id: 'sel-load-luminosity', label: 'Load Luminosity as Selection', run: () => engine.loadChannelAsSelection('luminosity') },
  ],
  // ================= FILTER =================
  filterMenu.length === 1 ? filterMenu[0].submenu! : [
    { id: 'filter-last', label: 'Last Filter', shortcut: sc('repeatFilter'),
      enabled: () => engine.canRepeatLastFilter(),
      run: () => { void engine.repeatLastFilter() } },
    S(),
    { id: 'filter-liquify', label: 'Liquify…', shortcut: sc('liquify'), run: () => openDlg('liquify') },
    S(),
    ...filterMenu,
  ],
  // ================= PLUGINS (dynamic — see getPluginsMenuItems) =================
  pluginsMenuStatic,
  // ================= VIEW =================
  [
    { id: 'view-zoom-in', label: 'Zoom In', shortcut: sc('zoomIn'), run: () => engine.zoomBy(1.25) },
    { id: 'view-zoom-out', label: 'Zoom Out', shortcut: sc('zoomOut'), run: () => engine.zoomBy(1 / 1.25) },
    { id: 'view-fit', label: 'Fit to Page (Fit on Screen)', shortcut: sc('zoomFit'), run: () => { const v = (window as any).__zphotoViewport; v?.fit() } },
    { id: 'view-fit-content', label: 'Fit Blank Space (Content)', shortcut: sc('zoomFitContent'), run: () => { const v = (window as any).__zphotoViewport; v?.fitContent() } },
    { id: 'view-100', label: 'Actual Pixels (100%)', shortcut: sc('zoom100'), run: () => engine.setZoom(1) },
    S(),
    { id: 'view-proof-setup', label: 'Proof Setup…', enabled: () => !!engine.activeDoc, run: () => openDlg('proof-setup') },
    { id: 'view-proof-colors', label: 'Proof Colors', shortcut: sc('proofColors'), checked: () => !!engine.activeDoc?.proof?.enabled, enabled: () => !!engine.activeDoc, run: () => engine.toggleProofColors() },
    { id: 'view-gamut-warning', label: 'Gamut Warning', shortcut: sc('gamutWarning'), checked: () => !!engine.activeDoc?.proof?.gamutWarning, enabled: () => !!engine.activeDoc, run: () => engine.toggleGamutWarning() },
    S(),
    { id: 'view-rulers', label: 'Rulers', shortcut: sc('toggleRulers'), checked: () => store().view.showRulers, run: () => store().setViewPref('showRulers', !store().view.showRulers) },
    { id: 'view-ruler-units', label: 'Ruler Units', submenu: [
      { id: 'view-ru-px', label: 'Pixels', checked: () => store().view.rulerUnits === 'px', run: () => store().setViewPref('rulerUnits', 'px') },
      { id: 'view-ru-in', label: 'Inches', checked: () => store().view.rulerUnits === 'in', run: () => store().setViewPref('rulerUnits', 'in') },
      { id: 'view-ru-cm', label: 'Centimeters', checked: () => store().view.rulerUnits === 'cm', run: () => store().setViewPref('rulerUnits', 'cm') },
      { id: 'view-ru-mm', label: 'Millimeters', checked: () => store().view.rulerUnits === 'mm', run: () => store().setViewPref('rulerUnits', 'mm') },
    ] },
    { id: 'view-show-guides', label: 'Show Guides', shortcut: sc('toggleGuides'), checked: () => store().view.showGuides, run: () => store().setViewPref('showGuides', !store().view.showGuides) },
    { id: 'view-snap-guides', label: 'Snap to Guides', checked: () => store().view.snapGuides, run: () => store().setViewPref('snapGuides', !store().view.snapGuides) },
    { id: 'view-new-guide', label: 'New Guide…', run: () => {
      const v = prompt('New guide — enter "h 200" for a horizontal guide at y=200, or "v 350" for a vertical guide at x=350:', 'h 200')
      if (!v) return
      const m = v.trim().match(/^(h|v)\s+(-?\d+(?:\.\d+)?)$/i)
      if (!m) { store().pushToast('Invalid guide spec — use "h 200" or "v 350"', 'error'); return }
      engine.addGuide(m[1].toLowerCase() as 'h' | 'v', Number(m[2]))
    } },
    { id: 'view-clear-guides', label: 'Clear Guides', enabled: () => (engine.activeDoc?.guides?.length ?? 0) > 0, run: () => engine.clearGuides() },
    S(),
    { id: 'view-grid', label: 'Show Grid', shortcut: sc('toggleGrid'), checked: () => store().view.showGrid, run: () => store().setViewPref('showGrid', !store().view.showGrid) },
    { id: 'view-grid-labels', label: 'Grid Coordinate Labels', checked: () => store().view.showGridLabels, enabled: () => store().view.showGrid, run: () => store().setViewPref('showGridLabels', !store().view.showGridLabels) },
    { id: 'view-grid-snap', label: 'Snap to Grid', shortcut: sc('toggleSnapGrid'), checked: () => store().view.snapGrid, run: () => store().setViewPref('snapGrid', !store().view.snapGrid) },
    { id: 'view-grid-size', label: `Grid Size: ${gridSizeLabel(store().view.gridSize)}`, run: () => {
      // cycle: Auto → 8 → 16 → 32 → 64 → 128 → Auto
      const cycle = [0, 8, 16, 32, 64, 128]
      const cur = cycle.indexOf(store().view.gridSize)
      const next = cycle[(cur + 1) % cycle.length]
      store().setGridSize(next)
      store().pushToast(next === 0 ? 'Grid size: Auto (adapts to zoom)' : `Grid size: ${next} px`, 'info')
    } },
    { id: 'view-pixel-grid', label: 'Pixel Grid', checked: () => store().view.showPixelGrid !== false, run: () => store().setViewPref('showPixelGrid', !(store().view.showPixelGrid !== false)) },
    S(),
    { id: 'view-gpu', label: 'GPU Acceleration', checked: () => engine.isGpuEnabled(), enabled: () => engine.gpuInfo().supported, run: () => engine.setGpuAccelerated(!engine.isGpuEnabled()) },
    S(),
    { id: 'view-ch-rgb', label: 'RGB Channels', checked: () => engine.activeDoc?.channelView === 'rgb', run: () => engine.setChannelView('rgb') },
    { id: 'view-ch-r', label: 'Red Channel', checked: () => engine.activeDoc?.channelView === 'r', run: () => engine.setChannelView('r') },
    { id: 'view-ch-g', label: 'Green Channel', checked: () => engine.activeDoc?.channelView === 'g', run: () => engine.setChannelView('g') },
    { id: 'view-ch-b', label: 'Blue Channel', checked: () => engine.activeDoc?.channelView === 'b', run: () => engine.setChannelView('b') },
  ],
  // ================= WINDOW =================
  [
    // Native workspace chrome remains in its built-in location until moved;
    // revealPanel focuses it wherever the user has arranged it.
    { id: 'win-tools', label: 'Tools', run: () => store().revealPanel('tools') },
    { id: 'win-tool-options', label: 'Tool Options', run: () => store().revealPanel('tool-options') },
    { id: 'win-documents', label: 'Open Files', run: () => store().revealPanel('documents') },
    S(),
    // Every registered panel is available here, regardless of whether it is
    // docked left/right/top or floating. revealPanel focuses/activates it.
    { id: 'win-color', label: 'Color', run: () => store().revealPanel('color') },
    { id: 'win-layers', label: 'Layers', run: () => store().revealPanel('layers') },
    { id: 'win-channels', label: 'Channels', run: () => store().revealPanel('channels') },
    { id: 'win-history', label: 'History', run: () => store().revealPanel('history') },
    { id: 'win-actions', label: 'Actions', run: () => store().revealPanel('actions') },
    { id: 'win-adjustments', label: 'Adjustments', run: () => store().revealPanel('adjustments') },
    { id: 'win-properties', label: 'Properties', run: () => store().revealPanel('properties') },
    { id: 'win-metadata', label: 'Metadata', run: () => store().revealPanel('metadata') },
    { id: 'win-navigator', label: 'Navigator', run: () => store().revealPanel('navigator') },
    { id: 'win-histogram', label: 'Histogram', run: () => store().revealPanel('histogram') },
    { id: 'win-timeline', label: 'Timeline', run: () => store().revealPanel('timeline') },
    { id: 'win-clone-source', label: 'Clone Source', run: () => store().revealPanel('clone-source') },
    { id: 'win-info', label: 'Info', run: () => store().revealPanel('info') },
    { id: 'win-paths', label: 'Paths', run: () => store().revealPanel('paths') },
    { id: 'win-patterns', label: 'Patterns', run: () => store().revealPanel('patterns') },
    { id: 'win-tool-presets', label: 'Tool Presets', run: () => store().revealPanel('tool-presets') },
    { id: 'win-layer-comps', label: 'Layer Comps', run: () => store().revealPanel('layer-comps') },
    S(),
    { id: 'win-script', label: 'Scripting Console…', run: () => openDlg('script-console') },
    { id: 'win-batch', label: 'Batch / Image Processor…', run: () => openDlg('batch') },
    S(),
    { id: 'win-reset-layout', label: 'Reset Panel Layout', run: () => store().resetPanelLayout() },
  ],
  // ================= HELP =================
  [
    { id: 'help-about', label: "About Chay's Photo Studio", run: () => openDlg('about') },
    { id: 'help-license', label: 'License & Donations…', run: () => openDlg('about') },
    {
      id: 'help-donate',
      label: 'Support the Project (Donate)…',
      run: () => window.open('https://github.com/sponsors/Chaython', '_blank', 'noopener'),
    },
    { id: 'help-shortcuts', label: 'Keyboard Shortcuts', run: () => openDlg('shortcuts') },
  ],
]
