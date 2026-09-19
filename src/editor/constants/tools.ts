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

export const TOOL_DEFS: ToolDef[] = [
  // group 0 — navigation / arrangement
  { id: 'move', label: 'Move', group: 0, shortcut: 'V', icon: 'Move', defaults: { autoSelect: true } as any, options: [
    { key: 'autoSelect', label: 'Auto-select layer', type: 'toggle' },
  ]},
  // group 1 — selections
  { id: 'marquee-rect', label: 'Rectangular Marquee', group: 1, shortcut: 'M', icon: 'SquareDashed', cursor: 'crosshair', defaults: { mode: 'new', feather: 0, antiAlias: true, style: 'normal' }, options: [selMode, featherCtl, antialiasCtl, { key: 'style', label: 'Style', type: 'select', options: [{ label: 'Normal', value: 'normal' }, { label: 'Fixed Ratio', value: 'ratio' }, { label: 'Fixed Size', value: 'fixed' }] }]},
  { id: 'marquee-ellipse', label: 'Elliptical Marquee', group: 1, shortcut: 'M', icon: 'CircleDashed', cursor: 'crosshair', defaults: { mode: 'new', feather: 0, antiAlias: true, style: 'normal' }, options: [selMode, featherCtl, antialiasCtl, { key: 'style', label: 'Style', type: 'select', options: [{ label: 'Normal', value: 'normal' }, { label: 'Fixed Ratio', value: 'ratio' }, { label: 'Fixed Size', value: 'fixed' }] }]},
  { id: 'lasso', label: 'Lasso', group: 1, shortcut: 'L', icon: 'Lasso', cursor: 'crosshair', defaults: { mode: 'new', feather: 0, antiAlias: true }, options: [selMode, featherCtl, antialiasCtl] },
  { id: 'polygon-lasso', label: 'Polygonal Lasso', group: 1, shortcut: 'L', icon: 'Pentagon', cursor: 'crosshair', defaults: { mode: 'new', feather: 0, antiAlias: true }, options: [selMode, featherCtl, antialiasCtl] },
  { id: 'magnetic-lasso', label: 'Magnetic Lasso', group: 1, shortcut: 'L', icon: 'Magnet', cursor: 'crosshair', defaults: { mode: 'new', width: 16, contrast: 16, frequency: 57, feather: 0.8, antiAlias: true }, options: [selMode, { key: 'width', label: 'Width', type: 'slider', min: 1, max: 40, step: 1, unit: 'px' }, { key: 'contrast', label: 'Contrast', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'frequency', label: 'Frequency', type: 'slider', min: 1, max: 100, step: 1 }, featherCtl, antialiasCtl] },
  { id: 'object-select', label: 'Object Selection', group: 1, shortcut: 'W', icon: 'ScanSearch', cursor: 'crosshair', defaults: { mode: 'new', feather: 1, level: 'balanced' }, options: [selMode, featherCtl, { key: 'level', label: 'AI Level', type: 'select', options: [{ label: 'Fast', value: 'fast' }, { label: 'Balanced', value: 'balanced' }, { label: 'Thorough', value: 'thorough' }] }]},
  { id: 'quick-select', label: 'Quick Selection', group: 1, shortcut: 'W', icon: 'BrushHighlighter', cursor: 'crosshair', defaults: { mode: 'new', size: 40, tolerance: 30, feather: 1 }, options: [selMode, { key: 'size', label: 'Brush Size', type: 'slider', min: 4, max: 300, step: 1, unit: 'px' }, { key: 'tolerance', label: 'Tolerance', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, featherCtl] },
  { id: 'magic-wand', label: 'Magic Wand', group: 1, shortcut: 'W', icon: 'Wand2', cursor: 'crosshair', defaults: { mode: 'new', tolerance: 32, contiguous: true, diagonal: false, sample: 'composite', sampleRadius: 1, edgeAware: 35, adaptive: true, matchAlpha: false, exactPixels: false, antiAlias: true, feather: 0, smooth: 0 }, options: [selMode, { key: 'exactPixels', label: 'Pixel Exact', type: 'toggle', hint: 'Raw RGBA matching with hard edges for pixel art, icons and sprites' }, { key: 'tolerance', label: 'Tolerance', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'sampleRadius', label: 'Sample', type: 'select', options: [{ label: 'Point', value: 0 }, { label: '3 × 3 Average', value: 1 }, { label: '5 × 5 Average', value: 2 }, { label: '7 × 7 Average', value: 3 }], hint: 'Average around the click to ignore single noisy pixels' }, { key: 'edgeAware', label: 'Edge Protection', type: 'slider', min: 0, max: 100, step: 1, unit: '%', hint: 'Resists leaking across strong luminance/color edges' }, { key: 'adaptive', label: 'Adaptive Region', type: 'toggle', hint: 'Follows gentle gradients while staying anchored to the sampled color' }, { key: 'contiguous', label: 'Contiguous', type: 'toggle' }, { key: 'diagonal', label: 'Diagonal Fill', type: 'toggle', hint: '8-connected fill — includes diagonally adjacent pixels' }, { key: 'sample', label: 'Source', type: 'select', options: [{ label: 'Composite', value: 'composite' }, { label: 'Active Layer', value: 'layer' }] }, { key: 'matchAlpha', label: 'Match Transparency', type: 'toggle' }, { key: 'smooth', label: 'Smooth', type: 'slider', min: 0, max: 8, step: 1 }, { key: 'feather', label: 'Feather', type: 'slider', min: 0, max: 20, step: 0.5, unit: 'px' }, antialiasCtl] },
  { id: 'crop', label: 'Crop', group: 3, shortcut: 'C', icon: 'Crop', cursor: 'crosshair', defaults: { ratio: 'free' }, options: [{ key: 'ratio', label: 'Ratio', type: 'select', options: [{ label: 'Free', value: 'free' }, { label: '1:1', value: '1:1' }, { label: '4:3', value: '4:3' }, { label: '3:2', value: '3:2' }, { label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }] }] },
  { id: 'eyedropper', label: 'Color Picker', group: 2, shortcut: 'I', icon: 'Pipette', cursor: 'crosshair', defaults: { sample: 'composite', radius: 1 }, options: [{ key: 'sample', label: 'Sample', type: 'select', options: [{ label: 'Composite', value: 'composite' }, { label: 'Active Layer', value: 'layer' }] }, { key: 'radius', label: 'Sample Radius', type: 'slider', min: 1, max: 11, step: 2, unit: 'px' }] },
  { id: 'measure', label: 'Measure', group: 3, shortcut: 'K', icon: 'Ruler', cursor: 'crosshair', defaults: {}, options: [] },

  // group 2 — color picker (standalone button — always visible in the toolbar)

  // group 3 — crop / measure

  // group 4 — painting (GIMP-style symmetry painting + dynamics + procedural tip library)
  { id: 'brush', label: 'Brush', group: 4, shortcut: 'B', icon: 'Brush', cursor: 'none', requiresLayer: true, defaults: { size: 40, hardness: 80, opacity: 100, flow: 100, spacing: 15, tip: 'round-soft', angle: 0, angleFollow: false, roundness: 100, jitter: 0, smoothing: 0, symmetry: 'off', mandalaCount: 6, scatter: 0, fade: 0, airbrush: false, dynamics: 'off', stampId: null }, options: [...brushCtls, { key: 'tip', label: 'Tip', type: 'select', options: tipSelectOptions }, { key: 'angle', label: 'Angle', type: 'angle', min: 0, max: 360, step: 1, unit: '°', hint: 'Tip rotation (rotatable tips)' }, { key: 'roundness', label: 'Roundness', type: 'slider', min: 10, max: 100, step: 1, unit: '%', hint: 'Calligraphy nib squash' }, { key: 'angleFollow', label: 'Follow', type: 'toggle', hint: 'Rotate the tip with the stroke direction' }, { key: 'jitter', label: 'Jitter', type: 'slider', min: 0, max: 100, step: 1, unit: '%', hint: 'Per-dab color variation' }, { key: 'smoothing', label: 'Smoothing', type: 'slider', min: 0, max: 90, step: 5, unit: '%' }, symmetryCtl, mandalaCtl, { key: 'scatter', label: 'Scatter', type: 'slider', min: 0, max: 300, step: 5, unit: '%' }, { key: 'fade', label: 'Fade', type: 'slider', min: 0, max: 600, step: 10, unit: 'px' }, { key: 'airbrush', label: 'Airbrush', type: 'toggle' }, { key: 'dynamics', label: 'Dynamics', type: 'select', options: [{ label: 'Off', value: 'off' }, { label: 'Velocity → Size', value: 'velocity' }, { label: 'Velocity → Opacity', value: 'velocity-opacity' }, { label: 'Pressure → Size', value: 'pressure' }] }] },
  { id: 'pencil', label: 'Pencil', group: 4, shortcut: 'B', icon: 'Pencil', cursor: 'none', requiresLayer: true, defaults: { size: 8, hardness: 100, opacity: 100, flow: 100, spacing: 12, symmetry: 'off', mandalaCount: 6 }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 1, max: 500, step: 1, unit: 'px' }, { key: 'opacity', label: 'Opacity', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'spacing', label: 'Spacing', type: 'slider', min: 1, max: 200, step: 5, unit: '%' }, symmetryCtl, mandalaCtl] },
  { id: 'eraser', label: 'Eraser', group: 4, shortcut: 'E', icon: 'Eraser', cursor: 'none', requiresLayer: true, defaults: { size: 40, hardness: 70, opacity: 100, flow: 100, spacing: 15, tip: 'round-soft', angle: 0, angleFollow: false, roundness: 100, symmetry: 'off', mandalaCount: 6 }, options: [...brushCtls, { key: 'tip', label: 'Tip', type: 'select', options: eraserTipSelectOptions }, { key: 'angle', label: 'Angle', type: 'angle', min: 0, max: 360, step: 1, unit: '°', hint: 'Tip rotation (rotatable tips)' }, { key: 'roundness', label: 'Roundness', type: 'slider', min: 10, max: 100, step: 1, unit: '%', hint: 'Calligraphy nib squash' }, { key: 'angleFollow', label: 'Follow', type: 'toggle', hint: 'Rotate the tip with the stroke direction' }, symmetryCtl, mandalaCtl] },

  // group 5 — retouching
  { id: 'clone-stamp', label: 'Clone Stamp', group: 5, shortcut: 'S', icon: 'Stamp', cursor: 'none', requiresLayer: true, defaults: { size: 60, hardness: 70, opacity: 100, flow: 100, spacing: 15, aligned: true, mirrored: false, rotate: 0, sample: 'layer' }, options: [...brushCtls, { key: 'sample', label: 'Sample', type: 'select', options: [{ label: 'Current Layer', value: 'layer' }, { label: 'Current & Below / Composite', value: 'composite' }] }, { key: 'aligned', label: 'Aligned', type: 'toggle' }, { key: 'mirrored', label: 'Mirrored', type: 'toggle' }, { key: 'rotate', label: 'Rotate', type: 'angle' }] },
  { id: 'healing-brush', label: 'Healing Brush', group: 5, shortcut: 'J', icon: 'Bandage', cursor: 'none', requiresLayer: true, defaults: { size: 40, hardness: 60, opacity: 100, flow: 100, spacing: 15, aligned: true, sample: 'layer' }, options: [...brushCtls, { key: 'sample', label: 'Sample', type: 'select', options: [{ label: 'Current Layer', value: 'layer' }, { label: 'Current & Below / Composite', value: 'composite' }] }, { key: 'aligned', label: 'Aligned', type: 'toggle' }] },
  { id: 'spot-healing', label: 'Spot Healing', group: 5, shortcut: 'J', icon: 'Sparkles', cursor: 'none', requiresLayer: true, defaults: { size: 40, hardness: 60, type: 'content-aware' }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 300, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'type', label: 'Mode', type: 'select', options: [{ label: 'Content-Aware', value: 'content-aware' }, { label: 'Proximity Match', value: 'proximity' }] }] },
  { id: 'patch', label: 'Patch', group: 5, shortcut: 'J', icon: 'Spline', cursor: 'crosshair', requiresLayer: true, defaults: { mode: 'new', heal: 'content-aware' }, options: [selMode, { key: 'heal', label: 'Patch', type: 'select', options: [{ label: 'Content-Aware', value: 'content-aware' }, { label: 'Texture Only', value: 'texture' }] }] },
  { id: 'blur', label: 'Blur', group: 5, shortcut: 'R', icon: 'Droplets', cursor: 'none', requiresLayer: true, defaults: { size: 60, hardness: 60, strength: 60 }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 400, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'strength', label: 'Strength', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }] },
  { id: 'sharpen', label: 'Sharpen', group: 5, shortcut: 'R', icon: 'Zap', cursor: 'none', requiresLayer: true, defaults: { size: 60, hardness: 60, strength: 50 }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 400, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'strength', label: 'Strength', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }] },
  { id: 'smudge', label: 'Smudge', group: 5, shortcut: 'R', icon: 'Fingerprint', cursor: 'none', requiresLayer: true, defaults: { size: 50, hardness: 70, strength: 60 }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 300, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'strength', label: 'Strength', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }] },
  { id: 'dodge', label: 'Dodge', group: 5, shortcut: 'O', icon: 'Sun', cursor: 'none', requiresLayer: true, defaults: { size: 60, hardness: 60, exposure: 30, range: 'midtones', protectTones: true }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 400, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'exposure', label: 'Exposure', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'range', label: 'Range', type: 'select', options: [{ label: 'Shadows', value: 'shadows' }, { label: 'Midtones', value: 'midtones' }, { label: 'Highlights', value: 'highlights' }] }, { key: 'protectTones', label: 'Protect Tones', type: 'toggle', hint: 'Preserve hue/chroma while changing luminance' }] },
  { id: 'burn', label: 'Burn', group: 5, shortcut: 'O', icon: 'Moon', cursor: 'none', requiresLayer: true, defaults: { size: 60, hardness: 60, exposure: 30, range: 'midtones', protectTones: true }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 400, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'exposure', label: 'Exposure', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'range', label: 'Range', type: 'select', options: [{ label: 'Shadows', value: 'shadows' }, { label: 'Midtones', value: 'midtones' }, { label: 'Highlights', value: 'highlights' }] }, { key: 'protectTones', label: 'Protect Tones', type: 'toggle', hint: 'Preserve hue/chroma while changing luminance' }] },
  { id: 'sponge', label: 'Sponge', group: 5, shortcut: 'O', icon: 'Paintbrush', cursor: 'none', requiresLayer: true, defaults: { size: 60, hardness: 60, flow: 30, mode: 'saturate' }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 4, max: 400, step: 1, unit: 'px' }, { key: 'hardness', label: 'Hardness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' }, { key: 'flow', label: 'Flow', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'mode', label: 'Mode', type: 'select', options: [{ label: 'Saturate', value: 'saturate' }, { label: 'Desaturate', value: 'desaturate' }] }] },

  // group 6 — fill & type
  { id: 'gradient', label: 'Gradient', group: 6, shortcut: 'G', icon: 'Blend', cursor: 'crosshair', requiresLayer: true, defaults: { mode: 'linear', dither: true, reverse: false, opacity: 100, type: 'fg-bg', custom: [] }, options: [{ key: 'mode', label: 'Type', type: 'select', options: [{ label: 'Linear', value: 'linear' }, { label: 'Radial', value: 'radial' }, { label: 'Angle', value: 'angle' }, { label: 'Reflected', value: 'reflected' }] }, { key: 'type', label: 'Preset', type: 'select', options: [{ label: 'Foreground → Background', value: 'fg-bg' }, { label: 'Foreground → Transparent', value: 'fg-transparent' }, { label: 'Black → White', value: 'bw' }, { label: 'Spectrum', value: 'spectrum' }] }, { key: 'reverse', label: 'Reverse', type: 'toggle' }, { key: 'opacity', label: 'Opacity', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'dither', label: 'Dither', type: 'toggle' }] },
  { id: 'paint-bucket', label: 'Paint Bucket', group: 6, shortcut: 'G', icon: 'PaintBucket', cursor: 'crosshair', requiresLayer: true, defaults: { tolerance: 32, contiguous: true, opacity: 100, sample: 'layer' }, options: [{ key: 'tolerance', label: 'Tolerance', type: 'slider', min: 0, max: 255, step: 1 }, { key: 'contiguous', label: 'Contiguous', type: 'toggle' }, { key: 'opacity', label: 'Opacity', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }, { key: 'sample', label: 'Sample', type: 'select', options: [{ label: 'Active Layer', value: 'layer' }, { label: 'Composite', value: 'composite' }] }] },
  { id: 'text', label: 'Type', group: 6, shortcut: 'T', icon: 'Type', cursor: 'text', defaults: { size: 48, family: 'Georgia, serif', color: '#ffffff', bold: false, italic: false, align: 'left' }, options: [{ key: 'size', label: 'Size', type: 'slider', min: 6, max: 500, step: 1, unit: 'px' }, { key: 'family', label: 'Font', type: 'select', options: [{ label: 'Georgia (Serif)', value: 'Georgia, serif' }, { label: 'Times (Serif)', value: '"Times New Roman", serif' }, { label: 'Helvetica (Sans)', value: 'Helvetica, Arial, sans-serif' }, { label: 'Arial (Sans)', value: 'Arial, sans-serif' }, { label: 'Courier (Mono)', value: '"Courier New", monospace' }, { label: 'Verdana (Sans)', value: 'Verdana, sans-serif' }] }, { key: 'color', label: 'Color', type: 'color' }, { key: 'bold', label: 'Bold', type: 'toggle' }, { key: 'italic', label: 'Italic', type: 'toggle' }, { key: 'align', label: 'Align', type: 'select', options: [{ label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }, { label: 'Right', value: 'right' }] }] },
  { id: 'pen', label: 'Pen', group: 6, shortcut: 'P', icon: 'PenTool', cursor: 'crosshair', defaults: { mode: 'new', feather: 0, antiAlias: true, action: 'selection', strokeSize: 8, strokeOpacity: 100 }, options: [selMode, featherCtl, antialiasCtl, { key: 'action', label: 'On Commit', type: 'select', options: [{ label: 'Make Selection', value: 'selection' }, { label: 'Stroke Path', value: 'stroke' }, { label: 'Fill Path', value: 'fill' }], hint: 'Enter commits the path · Escape cancels' }, { key: 'strokeSize', label: 'Stroke Size', type: 'slider', min: 1, max: 200, step: 1, unit: 'px' }, { key: 'strokeOpacity', label: 'Stroke Opacity', type: 'slider', min: 1, max: 100, step: 1, unit: '%' }] },
  { id: 'shape', label: 'Shape', group: 6, shortcut: 'U', icon: 'Shapes', cursor: 'crosshair', defaults: { shape: 'rect', radius: 12, fill: '#e8a33d', stroke: '#ffffff', strokeEnabled: false, strokeWidth: 4, sides: 5, starInset: 45 }, options: [{ key: 'shape', label: 'Shape', type: 'select', options: [{ label: 'Rectangle', value: 'rect' }, { label: 'Rounded Rect', value: 'rounded-rect' }, { label: 'Ellipse', value: 'ellipse' }, { label: 'Triangle', value: 'triangle' }, { label: 'Polygon', value: 'polygon' }, { label: 'Star', value: 'star' }, { label: 'Line', value: 'line' }] }, { key: 'fill', label: 'Fill', type: 'color' }, { key: 'strokeEnabled', label: 'Stroke', type: 'toggle' }, { key: 'stroke', label: 'Stroke Color', type: 'color' }, { key: 'strokeWidth', label: 'Stroke Width', type: 'slider', min: 1, max: 100, step: 1, unit: 'px' }, { key: 'radius', label: 'Corner Radius', type: 'slider', min: 0, max: 200, step: 1, unit: 'px' }, { key: 'sides', label: 'Sides / Points', type: 'slider', min: 3, max: 16, step: 1 }, { key: 'starInset', label: 'Star Inset', type: 'slider', min: 10, max: 90, step: 1, unit: '%' }] },

  // group 7 — view
  { id: 'hand', label: 'Hand', group: 7, shortcut: 'H', icon: 'Hand', cursor: 'grab', defaults: {} , options: [] },
  { id: 'zoom', label: 'Zoom', group: 7, shortcut: 'Z', icon: 'ZoomIn', cursor: 'zoom-in', defaults: { mode: 'in' }, options: [{ key: 'mode', label: 'Mode', type: 'select', options: [{ label: 'Zoom In', value: 'in' }, { label: 'Zoom Out', value: 'out' }] }] },
]

export const TOOL_MAP: Record<ToolId, ToolDef> = Object.fromEntries(
  TOOL_DEFS.map(t => [t.id, t])
) as Record<ToolId, ToolDef>

// tools that cycle with repeated shortcut presses
export const TOOL_CYCLES: ToolId[][] = [
  ['marquee-rect', 'marquee-ellipse'],
  ['lasso', 'polygon-lasso', 'magnetic-lasso'],
  ['object-select', 'quick-select', 'magic-wand'],
  ['brush', 'pencil'],
  ['clone-stamp'],
  ['healing-brush', 'spot-healing', 'patch'],
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
