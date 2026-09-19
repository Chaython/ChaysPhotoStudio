'use client'
// Dialog component registry — maps DialogType → component
// NOTE: TASK 2-D may upgrade individual dialog files and re-point entries here.
import type { DialogType } from '../../types'
import { GenericAdjustmentDialog, GenericFilterDialog, type DialogProps } from './generic-dialogs'
import { NewDocDialog, ImageSizeDialog, CanvasSizeDialog, ExportDialog, TransformDialog } from './doc-dialogs'
import { AiUpscaleDialog } from './ai-upscale-dialog'
import { AiGenerateDialog } from './ai-generate-dialog'
import { AiToolsDialog } from './ai-tools-dialog'
import { LiquifyDialog } from './liquify-dialog'
import { ContentAwareScaleDialog } from './content-aware-scale-dialog'
import { MatchColorDialog } from './match-color-dialog'
import { PluginManagerDialog } from './plugin-manager-dialog'
import { LayerStylesDialog } from './layer-styles-dialog'
import { ObjectDetectDialog } from './object-detect-dialog'
import { ShortcutsDialog } from './shortcuts-dialog'
import { ToolbarCustomizeDialog } from './toolbar-dialog'
import { RecoveryDialog } from './recovery-dialog'
import {
  ColorRangeDialog, SelectMaskDialog, ContentAwareFillDialog, BatchDialog,
  ScriptConsoleDialog, AboutDialog,
} from './advanced-dialogs'

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
  'shear', 'displace', 'fibers', 'difference-clouds', 'lens-correction',
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
  'plugin-manager': PluginManagerDialog,
  'layer-styles': LayerStylesDialog,
  'detect-objects': ObjectDetectDialog,
  'canvas-size': CanvasSizeDialog,
  'export': ExportDialog,
  'transform': TransformDialog,
  'color-range': ColorRangeDialog,
  'select-mask': SelectMaskDialog,
  'content-aware-fill': ContentAwareFillDialog,
  'batch': BatchDialog,
  'script-console': ScriptConsoleDialog,
  'shortcuts': ShortcutsDialog,
  'customize-toolbar': ToolbarCustomizeDialog,
  'about': AboutDialog,
  'recovery': RecoveryDialog,
  // schema-driven dialogs
  ...Object.fromEntries(ADJUSTMENT_TYPES.map(t => [t, GenericAdjustmentDialog])),
  ...Object.fromEntries(FILTER_TYPES.map(t => [t, GenericFilterDialog])),
  ...Object.fromEntries(NEW_ADJUSTMENT_TYPES.map(t => [t, GenericAdjustmentDialog])),
  ...Object.fromEntries(NEW_FILTER_TYPES.map(t => [t, GenericFilterDialog])),
} as any
