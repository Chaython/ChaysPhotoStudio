import type { BlendMode, ToolDef, ToolId, ControlDef } from '../types'
import { TIP_DEFS, ERASER_TIP_IDS } from '../tools/brush-tips'

/** select options for the brush tip dropdown (kept in sync with the picker) */
const tipSelectOptions = TIP_DEFS.map(t => ({ label: t.label, value: t.id }))
/** eraser tip subset (no image stamps for the eraser) */
const eraserTipSelectOptions = ERASER_TIP_IDS.map(id => ({
  label: TIP_DEFS.find(t => t.id === id)?.label ?? id,
  value: id,
}))

const selMode: ControlDef = {
  key: 'mode', label: 'Mode', type: 'select',
  options: [
    { label: 'New', value: 'new' }, { label: 'Add', value: 'add' },
    { label: 'Subtract', value: 'subtract' }, { label: 'Intersect', value: 'intersect' },
  ],
}

const featherCtl: ControlDef = { key: 'feather', label: 'Feather', type: 'slider', min: 0, max: 250, step: 1, unit: 'px' }
const antialiasCtl: ControlDef = { key: 'antiAlias', label: 'Anti-alias', type: 'toggle' }

const symmetryCtl: ControlDef = {
  key: 'symmetry', label: 'Symmetry', type: 'select',
  options: [
    { label: 'Off', value: 'off' }, { label: 'Mirror X', value: 'mirror-x' },
    { label: 'Mirror Y', value: 'mirror-y' }, { label: 'Point', value: 'point' },
    { label: 'Mandala', value: 'mandala' },
  ],
}
const mandalaCtl: ControlDef = { key: 'mandalaCount', label: 'Segments', type: 'slider', min: 3, max: 16, step: 1 }

const brushCtls: ControlDef[] = [
  { key: 'size', label: 'Size', type: 'slider', min: 1, max: 500, step: 1, unit: 'px' },
  { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'opacity', label: 'Opacity', type: 'slider', min: 1, max: 100, step: 1, unit: '%' },
  { key: 'flow', label: 'Flow', type: 'slider', min: 1, max: 100, step: 1, unit: '%' },
  { key: 'spacing', label: 'Spacing', type: 'slider', min: 1, max: 200, step: 5, unit: '%' },
]

const exposureCtls: ControlDef[] = [
  { key: 'exposure', label: 'Exposure', type: 'slider', min: -5, max: 5, step: 0.05 },
  { key: 'offset', label: 'Offset', type: 'slider', min: -0.5, max: 0.5, step: 0.01 },
  { key: 'gamma', label: 'Gamma Correction', type: 'slider', min: 0.1, max: 3, step: 0.01 },
]

const paintBlendOptions = [
  { label: 'Normal', value: 'normal' },
  { label: 'Multiply', value: 'multiply' },
  { label: 'Screen', value: 'screen' },
  { label: 'Overlay', value: 'overlay' },
  { label: 'Darken', value: 'darken' },
  { label: 'Lighten', value: 'lighten' },
  { label: 'Color Dodge', value: 'color-dodge' },
  { label: 'Color Burn', value: 'color-burn' },
  { label: 'Hard Light', value: 'hard-light' },
  { label: 'Soft Light', value: 'soft-light' },
  { label: 'Difference', value: 'difference' },
]

export const TOOL_DEFS: ToolDef[] = [
  // group 0 — navigation / arrangement
  { id: 'move', label: 'Move', group: 0, shortcut: 'V', icon: 'Move', defaults: { autoSelect: true, showTransformControls: true, smartGuides: true, alignTo: 'selection' } as any, options: [
    { key: 'autoSelect', label: 'Auto-select layer', type: 'toggle' },
    { key: 'showTransformControls', label: 'Show Transform Controls', type: 'toggle' },
    { key: 'smartGuides', label: 'Smart Guides', type: 'toggle', hint: 'Snap layer edges and centers to other layers and the canvas' },
    { key: 'alignTo', label: 'Align To', type: 'select', options: [{ label: 'Selected Layers', value: 'selection' }, { label: 'Primary Layer', value: 'primary' }, { label: 'Canvas', value: 'canvas' }] },
  ]},
  // group 1 — selections
  { id: 'marquee-rect', label: 'Rectangular Marquee', group: 1, shortcut: 'M', icon: 'SquareDashed', cursor: 'crosshair', defaults: { mode: 'new', feather: 0, antiAlias: true, style: 'normal', ratioW: 1, ratioH: 1, fixedW: 100, fixedH: 100 }, options: [selMode, featherCtl, antialiasCtl, { key: 'style', label: 'Style', type: 'select', options: [{ label: 'Normal', value: 'normal' }, { label: 'Fixed Ratio', value: 'ratio' }, { label: 'Fixed Size', value: 'fixed' }] }, { key: 'ratioW', label: 'Ratio W', type: 'number', min: 0.01, max: 1000, step: 0.1 }, { key: 'ratioH', label: 'Ratio H', type: 'number', min: 0.01, max: 1000, step: 0.1 }, { key: 'fixedW', label: 'Fixed W', type: 'number', min: 1, max: 100000, step: 1, unit: 'px' }, { key: 'fixedH', label: 'Fixed H', type: 'number', min: 1, max: 100000, step: 1, unit: 'px' }]},
  { id: 'marquee-ellipse', label: 'Elliptical Marquee', group: 1, shortcut: 'M', icon: 'CircleDashed', cursor: 'crosshair', defaults: { mode: 'new', feather: 0, antiAlias: true, style: 'normal', ratioW: 1, ratioH: 1, fixedW: 100, fixedH: 100 }, options: [selMode, featherCtl, antialiasCtl, { key: 'style', label: 'Style', type: 'select', options: [{ label: 'Normal', value: 'normal' }, { label: 'Fixed Ratio', value: 'ratio' }, { label: 'Fixed Size', value: 'fixed' }] }, { key: 'ratioW', label: 'Ratio W', type: 'number', min: 0.01, max: 1000, step: 0.1 }, { key: 'ratioH', label: 'Ratio H', type: 'number', min: 0.01, max: 1000, step: 0.1 }, { key: 'fixedW', label: 'Fixed W', type: 'number', min: 1, max: 100000, step: 1, unit: 'px' }, { key: 'fixedH', label: 'Fixed H', type: 'number', min: 1, max: 100000, step: 1, unit: 'px' }]},
  { id: 'lasso', label: 'Lasso', group: 1, shortcut: 'L', icon: 'Lasso', cursor: 'crosshair', defaults: { mode: 'new', feather: 0, antiAlias: true, smoothing: 0 }, options: [selMode, featherCtl, antialiasCtl, { key: 'smoothing', label: 'Smoothing', type: 'slider', min: 0, max: 20, step: 1, hint: 'Reduce hand jitter while preserving the contour' }] },
  { id: 'polygon-lasso', label: 'Polygonal Lasso', group: 1, shortcut: 'L', icon: 'Pentagon', cursor: 'crosshair', defaults: { mode: 'new', feather: 0, antiAlias: true, angleSnap: 45 }, options: [selMode, featherCtl, antialiasCtl, { key: 'angleSnap', label: 'Shift Angle', type: 'select', options: [{ label: '15°', value: 15 }, { label: '30°', value: 30 }, { label: '45°', value: 45 }, { label: '90°', value: 90 }] }] },
  { id: 'magnetic-lasso', label: 'Magnetic Lasso', group: 1, shortcut: 'L', icon: 'Magnet', cursor: 'crosshair', defaults: { mode: 'new', width: 16, contrast: 16, frequency: 57, feather: 0.8, antiAlias: true, sample: 'composite' }, options: [selMode, { key: 'width', label: 'Width', type: 'slider', min: 1, max: 40, step: 1, unit: 'px' }, { key: 'contrast', label: 'Contrast', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'frequency', label: 'Frequency', type: 'slider', min: 1, max: 100, step: 1 }, { key: 'sample', label: 'Sample', type: 'select', options: [{ label: 'Composite', value: 'composite' }, { label: 'Active Layer', value: 'layer' }] }, featherCtl, antialiasCtl] },
  { id: 'object-select', label: 'Object Selection', group: 1, shortcut: 'W', icon: 'ScanSearch', cursor: 'crosshair', defaults: { mode: 'new', geometry: 'rectangle', feather: 1, level: 'balanced', sample: 'composite', antiAlias: true }, options: [selMode, { key: 'geometry', label: 'Region', type: 'select', options: [{ label: 'Rectangle', value: 'rectangle' }, { label: 'Lasso', value: 'lasso' }] }, { key: 'sample', label: 'Sample', type: 'select', options: [{ label: 'All Layers', value: 'composite' }, { label: 'Active Layer', value: 'layer' }] }, { key: 'level', label: 'AI Level', type: 'select', options: [{ label: 'Fast', value: 'fast' }, { label: 'Balanced', value: 'balanced' }, { label: 'Thorough', value: 'thorough' }] }, featherCtl, antialiasCtl]},
  { id: 'quick-select', label: 'Quick Selection', group: 1, shortcut: 'W', icon: 'BrushHighlighter', cursor: 'crosshair', defaults: { mode: 'new', size: 40, tolerance: 30, feather: 1, sample: 'composite', autoEnhance: true }, options: [selMode, { key: 'size', label: 'Brush Size', type: 'slider', min: 4, max: 300, step: 1, unit: 'px' }, { key: 'tolerance', label: 'Tolerance', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'sample', label: 'Sample', type: 'select', options: [{ label: 'All Layers', value: 'composite' }, { label: 'Active Layer', value: 'layer' }] }, { key: 'autoEnhance', label: 'Auto-Enhance Edge', type: 'toggle' }, featherCtl] },
  { id: 'magic-wand', label: 'Magic Wand', group: 1, shortcut: 'W', icon: 'Wand2', cursor: 'crosshair', defaults: { mode: 'new', tolerance: 32, contiguous: true, diagonal: false, sample: 'composite', sampleRadius: 1, edgeAware: 35, adaptive: true, matchAlpha: false, exactPixels: false, antiAlias: true, feather: 0, smooth: 0 }, options: [selMode, { key: 'exactPixels', label: 'Pixel Exact', type: 'toggle', hint: 'Raw RGBA matching with hard edges for pixel art, icons and sprites' }, { key: 'tolerance', label: 'Tolerance', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'sampleRadius', label: 'Sample', type: 'select', options: [{ label: 'Point', value: 0 }, { label: '3 × 3 Average', value: 1 }, { label: '5 × 5 Average', value: 2 }, { label: '7 × 7 Average', value: 3 }], hint: 'Average around the click to ignore single noisy pixels' }, { key: 'edgeAware', label: 'Edge Protection', type: 'slider', min: 0, max: 100, step: 1, unit: '%', hint: 'Resists leaking across strong luminance/color edges' }, { key: 'adaptive', label: 'Adaptive Region', type: 'toggle', hint: 'Follows gentle gradients while staying anchored to the sampled color' }, { key: 'contiguous', label: 'Contiguous', type: 'toggle' }, { key: 'diagonal', label: 'Diagonal Fill', type: 'toggle', hint: '8-connected fill — includes diagonally adjacent pixels' }, { key: 'sample', label: 'Source', type: 'select', options: [{ label: 'Composite', value: 'composite' }, { label: 'Active Layer', value: 'layer' }] }, { key: 'matchAlpha', label: 'Match Transparency', type: 'toggle' }, { key: 'smooth', label: 'Smooth', type: 'slider', min: 0, max: 8, step: 1 }, { key: 'feather', label: 'Feather', type: 'slider', min: 0, max: 20, step: 0.5, unit: 'px' }, antialiasCtl] },
  { id: 'crop', label: 'Crop', group: 3, shortcut: 'C', icon: 'Crop', cursor: 'crosshair', defaults: { ratio: 'free', ratioW: 1, ratioH: 1, overlay: 'thirds', deletePixels: false, straighten: false }, options: [{ key: 'straighten', label: 'Straighten', type: 'toggle', hint: 'Drag a line that should be horizontal; the canvas rotates to level it' }, { key: 'ratio', label: 'Ratio', type: 'select', options: [{ label: 'Free', value: 'free' }, { label: 'Custom', value: 'custom' }, { label: '1:1', value: '1:1' }, { label: '4:3', value: '4:3' }, { label: '3:2', value: '3:2' }, { label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }] }, { key: 'ratioW', label: 'Ratio W', type: 'number', min: 0.01, max: 1000, step: 0.1 }, { key: 'ratioH', label: 'Ratio H', type: 'number', min: 0.01, max: 1000, step: 0.1 }, { key: 'overlay', label: 'Overlay', type: 'select', options: [{ label: 'Rule of Thirds', value: 'thirds' }, { label: 'Grid', value: 'grid' }, { label: 'Diagonal', value: 'diagonal' }, { label: 'Golden Ratio', value: 'golden' }, { label: 'None', value: 'none' }] }, { key: 'deletePixels', label: 'Delete Cropped Pixels', type: 'toggle', hint: 'Off preserves hidden raster pixels outside the new frame' }] },
  { id: 'eyedropper', label: 'Color Picker', group: 2, shortcut: 'I', icon: 'Pipette', cursor: 'crosshair', defaults: { sample: 'composite', radius: 1, hud: 'all' }, options: [{ key: 'sample', label: 'Sample', type: 'select', options: [{ label: 'All Layers', value: 'composite' }, { label: 'Current Layer', value: 'layer' }] }, { key: 'radius', label: 'Sample Size', type: 'select', options: [{ label: 'Point Sample', value: 1 }, { label: '3 × 3 Average', value: 3 }, { label: '5 × 5 Average', value: 5 }, { label: '7 × 7 Average', value: 7 }, { label: '11 × 11 Average', value: 11 }] }, { key: 'hud', label: 'HUD', type: 'select', options: [{ label: 'HEX', value: 'hex' }, { label: 'RGB', value: 'rgb' }, { label: 'HSL', value: 'hsl' }, { label: 'All', value: 'all' }] }] },
  { id: 'measure', label: 'Measure', group: 3, shortcut: 'K', icon: 'Ruler', cursor: 'crosshair', defaults: { angleSnap: 45, showDelta: true, persist: true, chain: false, unit: 'px', pixelsPerUnit: 1 }, options: [{ key: 'chain', label: 'Multi-segment', type: 'toggle', hint: 'Each new drag continues from the previous endpoint and reports total length' }, { key: 'angleSnap', label: 'Shift Angle', type: 'select', options: [{ label: '15°', value: 15 }, { label: '30°', value: 30 }, { label: '45°', value: 45 }, { label: '90°', value: 90 }] }, { key: 'unit', label: 'Units', type: 'select', options: [{ label: 'Pixels', value: 'px' }, { label: 'Millimeters', value: 'mm' }, { label: 'Centimeters', value: 'cm' }, { label: 'Inches', value: 'in' }] }, { key: 'pixelsPerUnit', label: 'px / unit', type: 'number', min: 0.001, max: 100000, step: 0.01, hint: 'Calibration: how many document pixels equal one selected unit' }, { key: 'showDelta', label: 'Show ΔX / ΔY', type: 'toggle' }, { key: 'persist', label: 'Keep Measurement', type: 'toggle', hint: 'Keep the ruler visible after switching tools' }] },

  // group 2 — color picker (standalone button — always visible in the toolbar)

  // group 3 — crop / measure

  // group 4 — painting (GIMP-style symmetry painting + dynamics + procedural tip library)
  { id: 'brush', label: 'Brush', group: 4, shortcut: 'B', icon: 'Brush', cursor: 'none', requiresLayer: true, defaults: { size: 40, hardness: 80, opacity: 100, flow: 100, spacing: 15, blendMode: 'normal', tip: 'round-soft', angle: 0, angleFollow: false, tiltAngle: false, tiltRoundness: false, twistAngle: false, roundness: 100, jitter: 0, smoothing: 0, symmetry: 'off', mandalaCount: 6, scatter: 0, fade: 0, airbrush: false, dynamics: 'off', stampId: null, pressureFlow: true }, options: [...brushCtls, { key: 'blendMode', label: 'Mode', type: 'select', options: paintBlendOptions }, { key: 'pressureFlow', label: 'Pen Pressure → Flow', type: 'toggle' }, { key: 'tip', label: 'Tip', type: 'select', options: tipSelectOptions }, { key: 'angle', label: 'Angle', type: 'angle', min: 0, max: 360, step: 1, unit: '°', hint: 'Tip rotation (rotatable tips)' }, { key: 'roundness', label: 'Roundness', type: 'slider', min: 10, max: 100, step: 1, unit: '%', hint: 'Calligraphy nib squash' }, { key: 'angleFollow', label: 'Follow', type: 'toggle', hint: 'Rotate the tip with the stroke direction' }, { key: 'tiltAngle', label: 'Pen Tilt → Angle', type: 'toggle', hint: 'Rotate supported brush tips with stylus tilt direction' }, { key: 'tiltRoundness', label: 'Pen Tilt → Roundness', type: 'toggle', hint: 'Flatten the nib as the stylus tilts' }, { key: 'twistAngle', label: 'Pen Rotation → Angle', type: 'toggle', hint: 'Use stylus barrel rotation when supported' }, { key: 'jitter', label: 'Jitter', type: 'slider', min: 0, max: 100, step: 1, unit: '%', hint: 'Per-dab color variation' }, { key: 'smoothing', label: 'Smoothing', type: 'slider', min: 0, max: 90, step: 5, unit: '%' }, symmetryCtl, mandalaCtl, { key: 'scatter', label: 'Scatter', type: 'slider', min: 0, max: 300, step: 5, unit: '%' }, { key: 'fade', label: 'Fade', type: 'slider', min: 0, max: 600, step: 10, unit: 'px' }, { key: 'airbrush', label: 'Airbrush', type: 'toggle' }, { key: 'dynamics', label: 'Dynamics', type: 'select', options: [{ label: 'Off', value: 'off' }, { label: 'Velocity → Size', value: 'velocity' }, { label: 'Velocity → Opacity', value: 'velocity-opacity' }, { label: 'Pressure → Size', value: 'pressure' }] }] },
  { id: 'pencil', label: 'Pencil', group: 4, shortcut: 'B', icon: 'Pencil', cursor: 'none', requiresLayer: true, defaults: { size: 8, hardness: 100, opacity: 100, flow: 100, spacing: 12, blendMode: 'normal', symmetry: 'off', mandalaCount: 6, autoErase: false, pressureFlow: true }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 1, max: 500, step: 1, unit: 'px' }, { key: 'opacity', label: 'Opacity', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'spacing', label: 'Spacing', type: 'slider', min: 1, max: 200, step: 5, unit: '%' }, { key: 'blendMode', label: 'Mode', type: 'select', options: paintBlendOptions }, { key: 'autoErase', label: 'Auto Erase', type: 'toggle' }, { key: 'pressureFlow', label: 'Pen Pressure → Flow', type: 'toggle' }, symmetryCtl, mandalaCtl] },
  { id: 'mixer-brush', label: 'Mixer Brush', group: 4, shortcut: 'B', icon: 'Paintbrush', cursor: 'none', requiresLayer: true, defaults: { size: 55, hardness: 55, wet: 50, load: 50, mix: 50, flow: 60, spacing: 12, sampleAllLayers: true, pressureFlow: true, autoClean: false }, options: [
    { key: 'size', label: 'Size', type: 'slider', min: 2, max: 500, step: 1, unit: 'px' },
    { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'wet', label: 'Wet', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'load', label: 'Load', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'mix', label: 'Mix', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'flow', label: 'Flow', type: 'slider', min: 1, max: 100, step: 1, unit: '%' },
    { key: 'spacing', label: 'Spacing', type: 'slider', min: 1, max: 100, step: 1, unit: '%' },
    { key: 'sampleAllLayers', label: 'Sample All Layers', type: 'toggle' },
    { key: 'pressureFlow', label: 'Pen Pressure → Flow', type: 'toggle' },
    { key: 'autoClean', label: 'Clean Brush After Stroke', type: 'toggle' },
  ] },
  { id: 'color-replacement', label: 'Color Replacement', group: 4, shortcut: 'B', icon: 'Paintbrush2', cursor: 'none', requiresLayer: true, defaults: { size: 50, hardness: 70, spacing: 15, tolerance: 30, opacity: 100, sampling: 'continuous', limits: 'find-edges', pressureSize: false }, options: [
    { key: 'size', label: 'Size', type: 'slider', min: 2, max: 500, step: 1, unit: 'px' },
    { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'spacing', label: 'Spacing', type: 'slider', min: 1, max: 200, step: 5, unit: '%' },
    { key: 'tolerance', label: 'Tolerance', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'opacity', label: 'Opacity', type: 'slider', min: 1, max: 100, step: 1, unit: '%' },
    { key: 'sampling', label: 'Sampling', type: 'select', options: [{ label: 'Continuous', value: 'continuous' }, { label: 'Once', value: 'once' }, { label: 'Background Swatch', value: 'background' }] },
    { key: 'limits', label: 'Limits', type: 'select', options: [{ label: 'Discontiguous', value: 'discontiguous' }, { label: 'Contiguous', value: 'contiguous' }, { label: 'Find Edges', value: 'find-edges' }] },
    { key: 'pressureSize', label: 'Pen Pressure → Size', type: 'toggle' },
  ] },  { id: 'history-brush', label: 'History Brush', group: 4, shortcut: 'Y', icon: 'Brush', cursor: 'none', requiresLayer: true, defaults: { size: 45, hardness: 75, opacity: 100, flow: 100, spacing: 15, source: 'previous', pressureFlow: true, pressureSize: false }, options: [
    { key: 'source', label: 'Source', type: 'select', options: [{ label: 'Previous History State', value: 'previous' }, { label: 'Original State', value: 'original' }] },
    { key: 'size', label: 'Size', type: 'slider', min: 1, max: 500, step: 1, unit: 'px' },
    { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'opacity', label: 'Opacity', type: 'slider', min: 1, max: 100, step: 1, unit: '%' },
    { key: 'flow', label: 'Flow', type: 'slider', min: 1, max: 100, step: 1, unit: '%' },
    { key: 'spacing', label: 'Spacing', type: 'slider', min: 1, max: 200, step: 5, unit: '%' },
    { key: 'pressureFlow', label: 'Pen Pressure → Flow', type: 'toggle' },
    { key: 'pressureSize', label: 'Pen Pressure → Size', type: 'toggle' },
  ] },
  { id: 'art-history-brush', label: 'Art History Brush', group: 4, shortcut: 'Y', icon: 'Brush', cursor: 'none', requiresLayer: true, defaults: { size: 38, opacity: 100, flow: 70, spacing: 18, source: 'previous', style: 'tight-medium', area: 50, tolerance: 0, pressureFlow: true, pressureSize: false }, options: [
    { key: 'source', label: 'Source', type: 'select', options: [{ label: 'Previous History State', value: 'previous' }, { label: 'Original State', value: 'original' }] },
    { key: 'style', label: 'Style', type: 'select', options: [{ label: 'Tight Short', value: 'tight-short' }, { label: 'Tight Medium', value: 'tight-medium' }, { label: 'Loose Medium', value: 'loose-medium' }, { label: 'Loose Long', value: 'loose-long' }, { label: 'Curl', value: 'curl' }] },
    { key: 'size', label: 'Brush Size', type: 'slider', min: 2, max: 300, step: 1, unit: 'px' },
    { key: 'area', label: 'Area', type: 'slider', min: 1, max: 200, step: 1, unit: '%' },
    { key: 'tolerance', label: 'Tolerance', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'opacity', label: 'Opacity', type: 'slider', min: 1, max: 100, step: 1, unit: '%' },
    { key: 'flow', label: 'Flow', type: 'slider', min: 1, max: 100, step: 1, unit: '%' },
    { key: 'spacing', label: 'Spacing', type: 'slider', min: 1, max: 200, step: 5, unit: '%' },
    { key: 'pressureFlow', label: 'Pen Pressure → Flow', type: 'toggle' },
    { key: 'pressureSize', label: 'Pen Pressure → Size', type: 'toggle' },
  ] },

  { id: 'eraser', label: 'Eraser', group: 4, shortcut: 'E', icon: 'Eraser', cursor: 'none', requiresLayer: true, defaults: { size: 40, hardness: 70, opacity: 100, flow: 100, spacing: 15, tip: 'round-soft', angle: 0, angleFollow: false, roundness: 100, symmetry: 'off', mandalaCount: 6, mode: 'brush', pressure: true, pressureSize: false }, options: [{ key: 'mode', label: 'Mode', type: 'select', options: [{ label: 'Brush', value: 'brush' }, { label: 'Pencil', value: 'pencil' }, { label: 'Block', value: 'block' }] }, ...brushCtls, { key: 'pressure', label: 'Pen Pressure → Flow', type: 'toggle' }, { key: 'pressureSize', label: 'Pen Pressure → Size', type: 'toggle' }, { key: 'tip', label: 'Tip', type: 'select', options: eraserTipSelectOptions }, { key: 'angle', label: 'Angle', type: 'angle', min: 0, max: 360, step: 1, unit: '°', hint: 'Tip rotation (rotatable tips)' }, { key: 'roundness', label: 'Roundness', type: 'slider', min: 10, max: 100, step: 1, unit: '%', hint: 'Calligraphy nib squash' }, { key: 'angleFollow', label: 'Follow', type: 'toggle', hint: 'Rotate the tip with the stroke direction' }, symmetryCtl, mandalaCtl] },
  { id: 'background-eraser', label: 'Background Eraser', group: 4, shortcut: 'E', icon: 'Eraser', cursor: 'none', requiresLayer: true, defaults: { size: 50, hardness: 70, spacing: 18, tolerance: 30, sampling: 'continuous', limits: 'find-edges', protectForeground: false, pressureSize: false }, options: [
    { key: 'size', label: 'Size', type: 'slider', min: 4, max: 500, step: 1, unit: 'px' },
    { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'spacing', label: 'Spacing', type: 'slider', min: 1, max: 200, step: 5, unit: '%' },
    { key: 'tolerance', label: 'Tolerance', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'sampling', label: 'Sampling', type: 'select', options: [{ label: 'Continuous', value: 'continuous' }, { label: 'Once', value: 'once' }, { label: 'Background Swatch', value: 'background' }] },
    { key: 'limits', label: 'Limits', type: 'select', options: [{ label: 'Contiguous', value: 'contiguous' }, { label: 'Discontiguous', value: 'discontiguous' }, { label: 'Find Edges', value: 'find-edges' }] },
    { key: 'protectForeground', label: 'Protect Foreground Color', type: 'toggle' },
    { key: 'pressureSize', label: 'Pen Pressure → Size', type: 'toggle' },
  ] },

  // group 5 — retouching
  { id: 'magic-eraser', label: 'Magic Eraser', group: 4, shortcut: 'E', icon: 'WandSparkles', cursor: 'crosshair', requiresLayer: true, defaults: { tolerance: 32, opacity: 100, contiguous: true, antiAlias: true, sampleAllLayers: false, sampleRadius: 0, edgeAware: 20, exactPixels: false, output: 'pixels' }, options: [
    { key: 'output', label: 'Output', type: 'select', options: [{ label: 'Erase Pixels', value: 'pixels' }, { label: 'Layer Mask', value: 'mask' }], hint: 'Layer Mask hides the matched region non-destructively' },
    { key: 'tolerance', label: 'Tolerance', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'opacity', label: 'Opacity', type: 'slider', min: 1, max: 100, step: 1, unit: '%' },
    { key: 'contiguous', label: 'Contiguous', type: 'toggle' },
    { key: 'antiAlias', label: 'Anti-alias', type: 'toggle' },
    { key: 'sampleAllLayers', label: 'Sample All Layers', type: 'toggle', hint: 'Use the visible composite to decide what matches, but erase only the active layer' },
    { key: 'sampleRadius', label: 'Sample', type: 'select', options: [{ label: 'Point', value: 0 }, { label: '3 × 3 Average', value: 1 }, { label: '5 × 5 Average', value: 2 }] },
    { key: 'edgeAware', label: 'Edge Protection', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'exactPixels', label: 'Pixel Exact', type: 'toggle', hint: 'Hard RGBA matching for sprites/icons' },
  ]},
  { id: 'clone-stamp', label: 'Clone Stamp', group: 5, shortcut: 'S', icon: 'Stamp', cursor: 'none', requiresLayer: true, defaults: { size: 60, hardness: 70, opacity: 100, flow: 100, spacing: 15, blendMode: 'normal', sourceSlot: 1, aligned: true, mirrored: false, rotate: 0, scale: 100, sample: 'layer' }, options: [{ key: 'sourceSlot', label: 'Source', type: 'select', options: [{ label: '#1', value: 1 }, { label: '#2', value: 2 }, { label: '#3', value: 3 }, { label: '#4', value: 4 }, { label: '#5', value: 5 }], hint: 'Five independent Clone Source slots' }, ...brushCtls, { key: 'blendMode', label: 'Mode', type: 'select', options: paintBlendOptions }, { key: 'sample', label: 'Sample', type: 'select', options: [{ label: 'Current Layer', value: 'layer' }, { label: 'Current & Below / Composite', value: 'composite' }] }, { key: 'aligned', label: 'Aligned', type: 'toggle' }, { key: 'mirrored', label: 'Mirrored', type: 'toggle' }, { key: 'rotate', label: 'Rotate', type: 'angle' }, { key: 'scale', label: 'Source Scale', type: 'slider', min: 25, max: 400, step: 1, unit: '%' }] },  { id: 'pattern-stamp', label: 'Pattern Stamp', group: 5, shortcut: 'S', icon: 'Stamp', cursor: 'none', requiresLayer: true, defaults: { size: 60, hardness: 70, opacity: 100, flow: 100, spacing: 15, blendMode: 'normal', pattern: 'checker', patternScale: 100, patternOffsetX: 0, patternOffsetY: 0, aligned: true, pressureFlow: true, pressureSize: false }, options: [
    ...brushCtls,
    { key: 'blendMode', label: 'Mode', type: 'select', options: paintBlendOptions },
    { key: 'pattern', label: 'Pattern', type: 'select', options: [{ label: 'Checker', value: 'checker' }, { label: 'Diagonal Stripes', value: 'diagonal' }, { label: 'Dots', value: 'dots' }, { label: 'Grid', value: 'grid' }] },
    { key: 'patternScale', label: 'Pattern Scale', type: 'slider', min: 25, max: 400, step: 5, unit: '%' },
    { key: 'patternOffsetX', label: 'Pattern X', type: 'number', min: -10000, max: 10000, step: 1, unit: 'px' },
    { key: 'patternOffsetY', label: 'Pattern Y', type: 'number', min: -10000, max: 10000, step: 1, unit: 'px' },
    { key: 'aligned', label: 'Aligned', type: 'toggle', hint: 'Keep the pattern phase locked across separate strokes' },
    { key: 'pressureFlow', label: 'Pen Pressure → Flow', type: 'toggle' },
    { key: 'pressureSize', label: 'Pen Pressure → Size', type: 'toggle' },
  ] },

  { id: 'healing-brush', label: 'Healing Brush', group: 5, shortcut: 'J', icon: 'Bandage', cursor: 'none', requiresLayer: true, defaults: { size: 40, hardness: 60, opacity: 100, flow: 100, spacing: 15, blendMode: 'normal', aligned: true, sample: 'layer', pattern: 'checker', patternScale: 100, patternOffsetX: 0, patternOffsetY: 0, diffusion: 5, pressure: true, mirrored: false, rotate: 0, scale: 100 }, options: [...brushCtls, { key: 'blendMode', label: 'Mode', type: 'select', options: paintBlendOptions }, { key: 'sample', label: 'Source', type: 'select', options: [{ label: 'Current Layer', value: 'layer' }, { label: 'All Layers', value: 'composite' }, { label: 'Pattern', value: 'pattern' }] }, { key: 'pattern', label: 'Pattern', type: 'select', options: [{ label: 'Checker', value: 'checker' }, { label: 'Diagonal Stripes', value: 'diagonal' }, { label: 'Dots', value: 'dots' }, { label: 'Grid', value: 'grid' }] }, { key: 'patternScale', label: 'Pattern Scale', type: 'slider', min: 25, max: 400, step: 5, unit: '%' }, { key: 'patternOffsetX', label: 'Pattern X', type: 'number', min: -10000, max: 10000, step: 1, unit: 'px' }, { key: 'patternOffsetY', label: 'Pattern Y', type: 'number', min: -10000, max: 10000, step: 1, unit: 'px' }, { key: 'aligned', label: 'Aligned', type: 'toggle' }, { key: 'diffusion', label: 'Diffusion', type: 'slider', min: 1, max: 7, step: 1 }, { key: 'pressure', label: 'Pen Pressure', type: 'toggle' }, { key: 'mirrored', label: 'Mirrored', type: 'toggle' }, { key: 'rotate', label: 'Source Rotate', type: 'angle' }, { key: 'scale', label: 'Source Scale', type: 'slider', min: 25, max: 400, step: 1, unit: '%' }] },
  { id: 'spot-healing', label: 'Spot Healing', group: 5, shortcut: 'J', icon: 'Sparkles', cursor: 'none', requiresLayer: true, defaults: { size: 40, hardness: 60, type: 'content-aware', sampleAllLayers: false, output: 'current' }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 300, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'type', label: 'Mode', type: 'select', options: [{ label: 'Content-Aware', value: 'content-aware' }, { label: 'Proximity Match', value: 'proximity' }] }, { key: 'sampleAllLayers', label: 'Sample All Layers', type: 'toggle' }, { key: 'output', label: 'Output', type: 'select', options: [{ label: 'Current Layer', value: 'current' }, { label: 'New Layer', value: 'new' }], hint: 'Heal non-destructively onto a new layer' }] },
  { id: 'patch', label: 'Patch', group: 5, shortcut: 'J', icon: 'Spline', cursor: 'crosshair', requiresLayer: true, defaults: { mode: 'new', direction: 'source', heal: 'content-aware', diffusion: 5, sampleAllLayers: false }, options: [selMode, { key: 'direction', label: 'Patch Mode', type: 'select', options: [{ label: 'Source', value: 'source' }, { label: 'Destination', value: 'destination' }], hint: 'Source: select damage and drag to good pixels · Destination: select good pixels and drag them over damage' }, { key: 'heal', label: 'Patch', type: 'select', options: [{ label: 'Content-Aware', value: 'content-aware' }, { label: 'Texture Only', value: 'texture' }] }, { key: 'diffusion', label: 'Diffusion', type: 'slider', min: 1, max: 7, step: 1 }, { key: 'sampleAllLayers', label: 'Sample All Layers', type: 'toggle' }] },
  { id: 'red-eye', label: 'Red Eye', group: 5, shortcut: 'J', icon: 'Eye', cursor: 'crosshair', requiresLayer: true, defaults: { size: 60, darken: 50, threshold: 25 }, options: [
    { key: 'size', label: 'Pupil Size', type: 'slider', min: 8, max: 300, step: 1, unit: 'px' },
    { key: 'darken', label: 'Darken Amount', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'threshold', label: 'Red Threshold', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  ] },
  { id: 'blur', label: 'Blur', group: 5, shortcut: 'R', icon: 'Droplets', cursor: 'none', requiresLayer: true, defaults: { size: 60, hardness: 60, strength: 60, pressure: true, sampleAllLayers: false, output: 'current' }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 400, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'strength', label: 'Strength', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'pressure', label: 'Pen Pressure', type: 'toggle' }, { key: 'sampleAllLayers', label: 'Sample All Layers', type: 'toggle', hint: 'Used for non-destructive New Layer output' }, { key: 'output', label: 'Output', type: 'select', options: [{ label: 'Current Layer', value: 'current' }, { label: 'New Layer', value: 'new' }] }] },
  { id: 'sharpen', label: 'Sharpen', group: 5, shortcut: 'R', icon: 'Zap', cursor: 'none', requiresLayer: true, defaults: { size: 60, hardness: 60, strength: 50, threshold: 2, pressure: true, sampleAllLayers: false, output: 'current' }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 400, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'strength', label: 'Strength', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 50, step: 1 }, { key: 'pressure', label: 'Pen Pressure', type: 'toggle' }, { key: 'sampleAllLayers', label: 'Sample All Layers', type: 'toggle', hint: 'Used for non-destructive New Layer output' }, { key: 'output', label: 'Output', type: 'select', options: [{ label: 'Current Layer', value: 'current' }, { label: 'New Layer', value: 'new' }] }] },
  { id: 'smudge', label: 'Smudge', group: 5, shortcut: 'R', icon: 'Fingerprint', cursor: 'none', requiresLayer: true, defaults: { size: 50, hardness: 70, strength: 60, sampleAllLayers: false, fingerPainting: false, pressureStrength: true, pressureSize: false, output: 'current' }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 300, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'strength', label: 'Strength', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'sampleAllLayers', label: 'Sample All Layers', type: 'toggle' }, { key: 'fingerPainting', label: 'Finger Painting', type: 'toggle' }, { key: 'pressureStrength', label: 'Pen Pressure → Strength', type: 'toggle' }, { key: 'pressureSize', label: 'Pen Pressure → Size', type: 'toggle' }, { key: 'output', label: 'Output', type: 'select', options: [{ label: 'Current Layer', value: 'current' }, { label: 'New Layer', value: 'new' }] }] },
  { id: 'dodge', label: 'Dodge', group: 5, shortcut: 'O', icon: 'Sun', cursor: 'none', requiresLayer: true, defaults: { size: 60, hardness: 60, exposure: 30, range: 'midtones', protectTones: true, pressure: true }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 400, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'exposure', label: 'Exposure', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'range', label: 'Range', type: 'select', options: [{ label: 'Shadows', value: 'shadows' }, { label: 'Midtones', value: 'midtones' }, { label: 'Highlights', value: 'highlights' }] }, { key: 'protectTones', label: 'Protect Tones', type: 'toggle', hint: 'Preserve hue/chroma while changing luminance' }, { key: 'pressure', label: 'Pen Pressure', type: 'toggle' }] },
  { id: 'burn', label: 'Burn', group: 5, shortcut: 'O', icon: 'Moon', cursor: 'none', requiresLayer: true, defaults: { size: 60, hardness: 60, exposure: 30, range: 'midtones', protectTones: true, pressure: true }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 400, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'exposure', label: 'Exposure', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'range', label: 'Range', type: 'select', options: [{ label: 'Shadows', value: 'shadows' }, { label: 'Midtones', value: 'midtones' }, { label: 'Highlights', value: 'highlights' }] }, { key: 'protectTones', label: 'Protect Tones', type: 'toggle', hint: 'Preserve hue/chroma while changing luminance' }, { key: 'pressure', label: 'Pen Pressure', type: 'toggle' }] },
  { id: 'sponge', label: 'Sponge', group: 5, shortcut: 'O', icon: 'Paintbrush', cursor: 'none', requiresLayer: true, defaults: { size: 60, hardness: 60, flow: 30, mode: 'saturate', vibrance: true, pressure: true }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 400, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'flow', label: 'Flow', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'mode', label: 'Mode', type: 'select', options: [{ label: 'Saturate', value: 'saturate' }, { label: 'Desaturate', value: 'desaturate' }] }, { key: 'vibrance', label: 'Vibrance', type: 'toggle' }, { key: 'pressure', label: 'Pen Pressure', type: 'toggle' }] },

  // group 6 — fill & type
  { id: 'gradient', label: 'Gradient', group: 6, shortcut: 'G', icon: 'Blend', cursor: 'crosshair', requiresLayer: true, defaults: { mode: 'linear', dither: true, reverse: false, opacity: 100, type: 'fg-bg', customStart: '#000000', customMid: '#808080', customEnd: '#ffffff', customMidpoint: 50, customStartOpacity: 100, customMidOpacity: 100, customEndOpacity: 100, interpolation: 'rgb', transparency: true, blendMode: 'normal' }, options: [{ key: 'mode', label: 'Type', type: 'select', options: [{ label: 'Linear', value: 'linear' }, { label: 'Radial', value: 'radial' }, { label: 'Angle', value: 'angle' }, { label: 'Reflected', value: 'reflected' }, { label: 'Diamond', value: 'diamond' }] }, { key: 'type', label: 'Preset', type: 'select', options: [{ label: 'Foreground → Background', value: 'fg-bg' }, { label: 'Foreground → Transparent', value: 'fg-transparent' }, { label: 'Black → White', value: 'bw' }, { label: 'Spectrum', value: 'spectrum' }, { label: 'Custom 3-Stop', value: 'custom' }] }, { key: 'customStart', label: 'Start', type: 'color' }, { key: 'customMid', label: 'Middle', type: 'color' }, { key: 'customEnd', label: 'End', type: 'color' }, { key: 'customMidpoint', label: 'Middle Position', type: 'slider', min: 1, max: 99, step: 1, unit: '%' }, { key: 'customStartOpacity', label: 'Start Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'customMidOpacity', label: 'Middle Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'customEndOpacity', label: 'End Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'interpolation', label: 'Interpolation', type: 'select', options: [{ label: 'RGB', value: 'rgb' }, { label: 'HSL (shortest hue)', value: 'hsl' }] }, { key: 'reverse', label: 'Reverse', type: 'toggle' }, { key: 'opacity', label: 'Opacity', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'blendMode', label: 'Blend', type: 'select', options: paintBlendOptions }, { key: 'transparency', label: 'Transparency', type: 'toggle' }, { key: 'dither', label: 'Dither', type: 'toggle' }] },
  { id: 'paint-bucket', label: 'Paint Bucket', group: 6, shortcut: 'G', icon: 'PaintBucket', cursor: 'crosshair', requiresLayer: true, defaults: { tolerance: 32, contiguous: true, diagonal: false, perceptual: true, smooth: 0, opacity: 100, sample: 'layer', antiAlias: true, fill: 'foreground', pattern: 'checker', patternScale: 100, patternOffsetX: 0, patternOffsetY: 0, blendMode: 'normal' }, options: [{ key: 'tolerance', label: 'Tolerance', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'perceptual', label: 'Perceptual Color', type: 'toggle', hint: 'Match visible color differences instead of raw RGB distance' }, { key: 'contiguous', label: 'Contiguous', type: 'toggle' }, { key: 'diagonal', label: 'Diagonal Fill', type: 'toggle' }, { key: 'smooth', label: 'Smooth Edge', type: 'slider', min: 0, max: 4, step: 1 }, { key: 'antiAlias', label: 'Anti-alias', type: 'toggle' }, { key: 'fill', label: 'Fill', type: 'select', options: [{ label: 'Foreground', value: 'foreground' }, { label: 'Background', value: 'background' }, { label: 'Pattern', value: 'pattern' }] }, { key: 'pattern', label: 'Pattern', type: 'select', options: [{ label: 'Checker', value: 'checker' }, { label: 'Diagonal Stripes', value: 'diagonal' }, { label: 'Dots', value: 'dots' }, { label: 'Grid', value: 'grid' }] }, { key: 'patternScale', label: 'Pattern Scale', type: 'slider', min: 25, max: 400, step: 5, unit: '%' }, { key: 'patternOffsetX', label: 'Pattern X', type: 'number', min: -10000, max: 10000, step: 1, unit: 'px' }, { key: 'patternOffsetY', label: 'Pattern Y', type: 'number', min: -10000, max: 10000, step: 1, unit: 'px' }, { key: 'opacity', label: 'Opacity', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'blendMode', label: 'Blend', type: 'select', options: paintBlendOptions }, { key: 'sample', label: 'Sample', type: 'select', options: [{ label: 'Active Layer', value: 'layer' }, { label: 'All Layers', value: 'composite' }] }] },
  { id: 'text', label: 'Type', group: 6, shortcut: 'T', icon: 'Type', cursor: 'text', defaults: { mode: 'point', direction: 'horizontal', kerning: true, size: 48, family: 'Georgia, serif', color: '#ffffff', bold: false, italic: false, underline: false, strikethrough: false, align: 'left', lineHeight: 1.2, tracking: 0, boxWidth: 320, boxHeight: 180 }, options: [{ key: 'mode', label: 'Type Mode', type: 'select', options: [{ label: 'Point Text', value: 'point' }, { label: 'Paragraph Box', value: 'paragraph' }] }, { key: 'direction', label: 'Direction', type: 'select', options: [{ label: 'Horizontal', value: 'horizontal' }, { label: 'Vertical', value: 'vertical' }] }, { key: 'kerning', label: 'Font Kerning', type: 'toggle', hint: 'Use the font’s built-in kerning pairs; Tracking is added separately' }, { key: 'boxWidth', label: 'Default W', type: 'number', min: 20, max: 10000, step: 1 }, { key: 'boxHeight', label: 'Default H', type: 'number', min: 20, max: 10000, step: 1 }, { key: 'size', label: 'Size', type: 'slider', min: 6, max: 500, step: 1, unit: 'px' }, { key: 'family', label: 'Font', type: 'select', options: [{ label: 'Georgia (Serif)', value: 'Georgia, serif' }, { label: 'Times (Serif)', value: '"Times New Roman", serif' }, { label: 'Helvetica (Sans)', value: 'Helvetica, Arial, sans-serif' }, { label: 'Arial (Sans)', value: 'Arial, sans-serif' }, { label: 'Courier (Mono)', value: '"Courier New", monospace' }, { label: 'Verdana (Sans)', value: 'Verdana, sans-serif' }] }, { key: 'color', label: 'Color', type: 'color' }, { key: 'bold', label: 'Bold', type: 'toggle' }, { key: 'italic', label: 'Italic', type: 'toggle' }, { key: 'underline', label: 'Underline', type: 'toggle' }, { key: 'strikethrough', label: 'Strikethrough', type: 'toggle' }, { key: 'align', label: 'Align', type: 'select', options: [{ label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }, { label: 'Right', value: 'right' }] }, { key: 'lineHeight', label: 'Leading', type: 'slider', min: 0.5, max: 3, step: 0.05 }, { key: 'tracking', label: 'Tracking', type: 'slider', min: -10, max: 50, step: 0.5, unit: 'px' }] },
  { id: 'pen', label: 'Pen', group: 6, shortcut: 'P', icon: 'PenTool', cursor: 'crosshair', defaults: { mode: 'new', feather: 0, antiAlias: true, action: 'selection', strokeSize: 8, strokeOpacity: 100 }, options: [selMode, featherCtl, antialiasCtl, { key: 'action', label: 'On Commit', type: 'select', options: [{ label: 'Make Selection', value: 'selection' }, { label: 'Stroke Path', value: 'stroke' }, { label: 'Fill Path', value: 'fill' }], hint: 'Enter commits the path · Escape cancels' }, { key: 'strokeSize', label: 'Stroke Size', type: 'slider', min: 1, max: 200, step: 1, unit: 'px' }, { key: 'strokeOpacity', label: 'Stroke Opacity', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }] },
  { id: 'shape', label: 'Shape', group: 6, shortcut: 'U', icon: 'Shapes', cursor: 'crosshair', defaults: { shape: 'rect', radius: 12, fill: '#e8a33d', fillOpacity: 100, stroke: '#ffffff', strokeEnabled: false, strokeWidth: 4, strokeOpacity: 100, strokeAlign: 'center', lineCap: 'round', dash: 'solid', dashLength: 12, gapLength: 8, arrowStart: false, arrowEnd: false, sides: 5, starInset: 45 }, options: [{ key: 'shape', label: 'Shape', type: 'select', options: [{ label: 'Rectangle', value: 'rect' }, { label: 'Rounded Rect', value: 'rounded-rect' }, { label: 'Ellipse', value: 'ellipse' }, { label: 'Triangle', value: 'triangle' }, { label: 'Polygon', value: 'polygon' }, { label: 'Star', value: 'star' }, { label: 'Line', value: 'line' }] }, { key: 'fill', label: 'Fill', type: 'color' }, { key: 'fillOpacity', label: 'Fill Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'strokeEnabled', label: 'Stroke', type: 'toggle' }, { key: 'stroke', label: 'Stroke Color', type: 'color' }, { key: 'strokeWidth', label: 'Stroke Width', type: 'slider', min: 1, max: 100, step: 1, unit: 'px' }, { key: 'strokeOpacity', label: 'Stroke Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'strokeAlign', label: 'Stroke Align', type: 'select', options: [{ label: 'Inside', value: 'inside' }, { label: 'Center', value: 'center' }, { label: 'Outside', value: 'outside' }] }, { key: 'lineCap', label: 'Line Cap', type: 'select', options: [{ label: 'Round', value: 'round' }, { label: 'Butt', value: 'butt' }, { label: 'Square', value: 'square' }] }, { key: 'dash', label: 'Stroke Style', type: 'select', options: [{ label: 'Solid', value: 'solid' }, { label: 'Dashed', value: 'dashed' }, { label: 'Dotted', value: 'dotted' }, { label: 'Custom', value: 'custom' }] }, { key: 'dashLength', label: 'Dash', type: 'number', min: 1, max: 1000, step: 1, unit: 'px' }, { key: 'gapLength', label: 'Gap', type: 'number', min: 1, max: 1000, step: 1, unit: 'px' }, { key: 'arrowStart', label: 'Start Arrow', type: 'toggle' }, { key: 'arrowEnd', label: 'End Arrow', type: 'toggle' }, { key: 'radius', label: 'Corner Radius', type: 'slider', min: 0, max: 200, step: 1, unit: 'px' }, { key: 'sides', label: 'Sides / Points', type: 'slider', min: 3, max: 16, step: 1 }, { key: 'starInset', label: 'Star Inset', type: 'slider', min: 10, max: 90, step: 1, unit: '%' }] },

  // group 7 — view
  { id: 'hand', label: 'Hand', group: 7, shortcut: 'H', icon: 'Hand', cursor: 'grab', defaults: {} , options: [] },
  { id: 'zoom', label: 'Zoom', group: 7, shortcut: 'Z', icon: 'ZoomIn', cursor: 'zoom-in', defaults: { mode: 'in', scrubby: true }, options: [{ key: 'mode', label: 'Mode', type: 'select', options: [{ label: 'Zoom In', value: 'in' }, { label: 'Zoom Out', value: 'out' }] }, { key: 'scrubby', label: 'Scrubby Zoom', type: 'toggle' }] },
]

export const TOOL_MAP: Record<ToolId, ToolDef> = Object.fromEntries(
  TOOL_DEFS.map(t => [t.id, t])
) as Record<ToolId, ToolDef>

// tools that cycle with repeated shortcut presses
export const TOOL_CYCLES: ToolId[][] = [
  ['marquee-rect', 'marquee-ellipse'],
  ['lasso', 'polygon-lasso', 'magnetic-lasso'],
  ['object-select', 'quick-select', 'magic-wand'],
  ['brush', 'pencil', 'mixer-brush', 'color-replacement'],
  ['history-brush', 'art-history-brush'],
  ['eraser', 'background-eraser', 'magic-eraser'],
  ['clone-stamp', 'pattern-stamp'],
  ['healing-brush', 'spot-healing', 'patch', 'red-eye'],
  ['blur', 'sharpen', 'smudge'],
  ['dodge', 'burn', 'sponge'],
  ['gradient', 'paint-bucket'],
]

// ---------- Blend modes ----------
export const BLEND_MODES: { value: BlendMode; label: string; gco: GlobalCompositeOperation }[] = [
  { value: 'normal', label: 'Normal', gco: 'source-over' },
  { value: 'multiply', label: 'Multiply', gco: 'multiply' },
  { value: 'screen', label: 'Screen', gco: 'screen' },
  { value: 'overlay', label: 'Overlay', gco: 'overlay' },
  { value: 'darken', label: 'Darken', gco: 'darken' },
  { value: 'lighten', label: 'Lighten', gco: 'lighten' },
  { value: 'color-dodge', label: 'Color Dodge', gco: 'color-dodge' },
  { value: 'color-burn', label: 'Color Burn', gco: 'color-burn' },
  { value: 'linear-dodge', label: 'Linear Dodge (Add)', gco: 'add' as GlobalCompositeOperation },
  { value: 'hard-light', label: 'Hard Light', gco: 'hard-light' },
  { value: 'soft-light', label: 'Soft Light', gco: 'soft-light' },
  { value: 'difference', label: 'Difference', gco: 'difference' },
  { value: 'exclusion', label: 'Exclusion', gco: 'exclusion' },
  { value: 'hue', label: 'Hue', gco: 'hue' },
  { value: 'saturation', label: 'Saturation', gco: 'saturation' },
  { value: 'color', label: 'Color', gco: 'color' },
  { value: 'luminosity', label: 'Luminosity', gco: 'luminosity' },
]

export const BLEND_GCO: Record<BlendMode, GlobalCompositeOperation> = Object.fromEntries(
  BLEND_MODES.map(b => [b.value, b.gco])
) as Record<BlendMode, GlobalCompositeOperation>

export const ADJUSTMENT_ICONS: Record<string, string> = {
  'curves': 'Spline',
  'levels': 'SlidersHorizontal',
  'brightness-contrast': 'SunDim',
  'exposure': 'Aperture',
  'vibrance': 'Palette',
  'hue-saturation': 'Rainbow',
  'color-balance': 'Scale',
  'black-white': 'CircleDot',
  'photo-filter': 'Camera',
  'channel-mixer': 'Blend',
  'selective-color': 'Droplet',
  'gradient-map': 'Blend',
  'posterize': 'Layers2',
  'threshold': 'Activity',
  'invert': 'FlipHorizontal2',
  'camera-raw': 'Sliders',
}
