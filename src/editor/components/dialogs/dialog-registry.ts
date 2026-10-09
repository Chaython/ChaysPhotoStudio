'use client'
// Dialog component registry — maps DialogType → component
// NOTE: TASK 2-D may upgrade individual dialog files and re-point entries here.
import { createElement, lazy, Suspense, type ComponentType } from 'react'
import type { DialogType } from '../../types'
import type { DialogProps } from './generic-dialogs'
// Dynamic imports are deliberately declared outside render so React preserves
// component identity, dialog state, and preview cleanup across store updates.
function deferredDialog(load: () => Promise<{ default: ComponentType<DialogProps> }>): ComponentType<DialogProps> {
  const Loaded = lazy(load)
  return function DeferredDialog(props: DialogProps) {
    return createElement(Suspense, {
      fallback: createElement('div', { role: 'status', className: 'py-6 text-center text-xs text-muted-foreground' }, 'Loading dialog…'),
    }, createElement(Loaded, props))
  }
}

const GenericAdjustmentDialog = deferredDialog(() => import('./generic-dialogs').then(m => ({ default: m.GenericAdjustmentDialog })))
const GenericFilterDialog = deferredDialog(() => import('./generic-dialogs').then(m => ({ default: m.GenericFilterDialog })))
const NewDocDialog = deferredDialog(() => import('./doc-dialogs').then(m => ({ default: m.NewDocDialog })))
const ImageSizeDialog = deferredDialog(() => import('./doc-dialogs').then(m => ({ default: m.ImageSizeDialog })))
const CanvasSizeDialog = deferredDialog(() => import('./doc-dialogs').then(m => ({ default: m.CanvasSizeDialog })))
const ExportDialog = deferredDialog(() => import('./doc-dialogs').then(m => ({ default: m.ExportDialog })))
const TransformDialog = deferredDialog(() => import('./doc-dialogs').then(m => ({ default: m.TransformDialog })))
const AiUpscaleDialog = deferredDialog(() => import('./ai-upscale-dialog').then(m => ({ default: m.AiUpscaleDialog })))
const AiGenerateDialog = deferredDialog(() => import('./ai-generate-dialog').then(m => ({ default: m.AiGenerateDialog })))
const AiToolsDialog = deferredDialog(() => import('./ai-tools-dialog').then(m => ({ default: m.AiToolsDialog })))
const LiquifyDialog = deferredDialog(() => import('./liquify-dialog').then(m => ({ default: m.LiquifyDialog })))
const ContentAwareScaleDialog = deferredDialog(() => import('./content-aware-scale-dialog').then(m => ({ default: m.ContentAwareScaleDialog })))
const MatchColorDialog = deferredDialog(() => import('./match-color-dialog').then(m => ({ default: m.MatchColorDialog })))
const PluginManagerDialog = deferredDialog(() => import('./plugin-manager-dialog').then(m => ({ default: m.PluginManagerDialog })))
const LayerStylesDialog = deferredDialog(() => import('./layer-styles-dialog').then(m => ({ default: m.LayerStylesDialog })))
const ObjectDetectDialog = deferredDialog(() => import('./object-detect-dialog').then(m => ({ default: m.ObjectDetectDialog })))
const AllToolsDialog = deferredDialog(() => import('./all-tools-dialog').then(m => ({ default: m.AllToolsDialog })))
const ShortcutsDialog = deferredDialog(() => import('./shortcuts-dialog').then(m => ({ default: m.ShortcutsDialog })))
const ToolbarCustomizeDialog = deferredDialog(() => import('./toolbar-dialog').then(m => ({ default: m.ToolbarCustomizeDialog })))
const RecoveryDialog = deferredDialog(() => import('./recovery-dialog').then(m => ({ default: m.RecoveryDialog })))
const ApplyImageDialog = deferredDialog(() => import('./apply-image-dialog').then(m => ({ default: m.ApplyImageDialog })))
const CalculationsDialog = deferredDialog(() => import('./calculations-dialog').then(m => ({ default: m.CalculationsDialog })))
const ExportLayersDialog = deferredDialog(() => import('./export-layers-dialog').then(m => ({ default: m.ExportLayersDialog })))
const DuplicateLayerDialog = deferredDialog(() => import('./duplicate-layer-dialog').then(m => ({ default: m.DuplicateLayerDialog })))
const StrokeSelectionDialog = deferredDialog(() => import('./stroke-selection-dialog').then(m => ({ default: m.StrokeSelectionDialog })))
const HelpGuideDialog = deferredDialog(() => import('./help-guide-dialog').then(m => ({ default: m.HelpGuideDialog })))
const ProofSetupDialog = deferredDialog(() => import('./proof-setup-dialog').then(m => ({ default: m.ProofSetupDialog })))
const PuppetWarpDialog = deferredDialog(() => import('./puppet-warp-dialog').then(m => ({ default: m.PuppetWarpDialog })))
const ColorRangeDialog = deferredDialog(() => import('./advanced-dialogs').then(m => ({ default: m.ColorRangeDialog })))
const SelectMaskDialog = deferredDialog(() => import('./advanced-dialogs').then(m => ({ default: m.SelectMaskDialog })))
const ContentAwareFillDialog = deferredDialog(() => import('./advanced-dialogs').then(m => ({ default: m.ContentAwareFillDialog })))
const BatchDialog = deferredDialog(() => import('./advanced-dialogs').then(m => ({ default: m.BatchDialog })))
const ScriptConsoleDialog = deferredDialog(() => import('./advanced-dialogs').then(m => ({ default: m.ScriptConsoleDialog })))
const AboutDialog = deferredDialog(() => import('./advanced-dialogs').then(m => ({ default: m.AboutDialog })))

const ADJUSTMENT_TYPES: DialogType[] = [
  'curves', 'levels', 'brightness-contrast', 'exposure', 'vibrance', 'hue-saturation',
  'color-balance', 'black-white', 'photo-filter', 'channel-mixer', 'selective-color',
  'gradient-map', 'posterize', 'threshold', 'camera-raw', 'invert', 'shadow-highlight',
]

const FILTER_TYPES: DialogType[] = [
  'gaussian-blur', 'motion-blur', 'radial-blur', 'box-blur', 'smart-sharpen', 'add-noise',
  'median', 'dust-scratches', 'mosaic', 'crystallize', 'emboss', 'wind', 'oil-paint',
  'high-pass', 'custom-kernel', 'minimum', 'maximum', 'twirl', 'wave', 'spherize',
  'clouds', 'lens-flare', 'newsprint', 'vignette', 'bloom', 'chromatic-aberration',
]

// TASK 9-b — Color Lookup / Equalize adjustments + the 11 new filters. Their
// type strings already exist in AdjustmentType/FilterType (types.ts) and are
// wired in the menus, but the DialogType union has not caught up yet, hence
// the opaque double cast (the store passes dialog types through as strings).
const NEW_ADJUSTMENT_TYPES: DialogType[] = (['color-lookup', 'equalize'] as const) as unknown as DialogType[]
const NEW_FILTER_TYPES: DialogType[] = ([
  'average', 'diffuse-glow', 'glass', 'ocean-ripple', 'zigzag', 'pinch',
  'shear', 'displace', 'fibers', 'difference-clouds', 'lens-correction', 'offset',
] as const) as unknown as DialogType[]

export const DIALOG_COMPONENTS: Partial<Record<DialogType, (props: DialogProps) => React.ReactNode>> = {
  'new-doc': NewDocDialog,
  'image-size': ImageSizeDialog,
  'ai-upscale': AiUpscaleDialog,
  'ai-generate': AiGenerateDialog,
  'ai-tools': AiToolsDialog,
  'liquify': LiquifyDialog,
  'content-aware-scale': ContentAwareScaleDialog,
  'match-color': MatchColorDialog,
  'apply-image': ApplyImageDialog,
  'calculations': CalculationsDialog,
  'plugin-manager': PluginManagerDialog,
  'layer-styles': LayerStylesDialog,
  'detect-objects': ObjectDetectDialog,
  'canvas-size': CanvasSizeDialog,
  'export': ExportDialog,
  'export-layers': ExportLayersDialog,
  'duplicate-layer': DuplicateLayerDialog,
  'stroke-selection': StrokeSelectionDialog,
  'help-guide': HelpGuideDialog,
  'proof-setup': ProofSetupDialog,
  'puppet-warp': PuppetWarpDialog,
  'transform': TransformDialog,
  'color-range': ColorRangeDialog,
  'select-mask': SelectMaskDialog,
  'content-aware-fill': ContentAwareFillDialog,
  'batch': BatchDialog,
  'script-console': ScriptConsoleDialog,
  'shortcuts': ShortcutsDialog,
  'all-tools': AllToolsDialog,
  'customize-toolbar': ToolbarCustomizeDialog,
  'about': AboutDialog,
  'recovery': RecoveryDialog,
  // schema-driven dialogs
  ...Object.fromEntries(ADJUSTMENT_TYPES.map(t => [t, GenericAdjustmentDialog])),
  ...Object.fromEntries(FILTER_TYPES.map(t => [t, GenericFilterDialog])),
  ...Object.fromEntries(NEW_ADJUSTMENT_TYPES.map(t => [t, GenericAdjustmentDialog])),
  ...Object.fromEntries(NEW_FILTER_TYPES.map(t => [t, GenericFilterDialog])),
} as any
