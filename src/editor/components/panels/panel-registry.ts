'use client'
// Panel registry — single source of truth for dockable/floating editor panels.
// Every panel follows the same lifecycle: dock into eight edge/corner positions or float as a window.
// NOTE: this module imports panel components (which import the store) — keep it
// free of store imports to avoid a circular dependency.
import { createElement, lazy, Suspense, type ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Layers, GitBranch, History, Zap, SlidersHorizontal, Settings, Compass, BarChart3, Palette, Film, Stamp, Info, PenTool, Grid2X2, Sliders, Wrench, Files, LayoutList, Tags,
} from 'lucide-react'
import { Toolbar } from '../toolbar/toolbar'
import { ToolOptionsBar } from '../toolbar/tool-options-bar'
import { DocumentTabs } from '../workspace/document-tabs'

// Only the selected tab is mounted. Loading its module on first activation keeps
// expensive canvases, metadata parsers and panel effects out of initial startup.
function deferredPanel(load: () => Promise<{ default: ComponentType }>): ComponentType {
  const Loaded = lazy(load)
  return function DeferredPanel() {
    return createElement(
      Suspense,
      { fallback: createElement('div', { role: 'status', className: 'p-3 text-xs text-muted-foreground' }, 'Loading panel…') },
      createElement(Loaded),
    )
  }
}

const LayersPanel = deferredPanel(() => import('./layers-panel').then(m => ({ default: m.LayersPanel })))
const HistoryPanel = deferredPanel(() => import('./history-navigator-histogram').then(m => ({ default: m.HistoryPanel })))
const NavigatorPanel = deferredPanel(() => import('./history-navigator-histogram').then(m => ({ default: m.NavigatorPanel })))
const HistogramPanel = deferredPanel(() => import('./history-navigator-histogram').then(m => ({ default: m.HistogramPanel })))
const ColorPanel = deferredPanel(() => import('./color-panel').then(m => ({ default: m.ColorPanel })))
const ChannelsPanel = deferredPanel(() => import('./channels-actions-properties').then(m => ({ default: m.ChannelsPanel })))
const AdjustmentsPanel = deferredPanel(() => import('./channels-actions-properties').then(m => ({ default: m.AdjustmentsPanel })))
const ActionsPanel = deferredPanel(() => import('./channels-actions-properties').then(m => ({ default: m.ActionsPanel })))
const PropertiesPanel = deferredPanel(() => import('./channels-actions-properties').then(m => ({ default: m.PropertiesPanel })))
const TimelinePanel = deferredPanel(() => import('./timeline-panel').then(m => ({ default: m.TimelinePanel })))
const CloneSourcePanel = deferredPanel(() => import('./clone-source-panel').then(m => ({ default: m.CloneSourcePanel })))
const InfoPanel = deferredPanel(() => import('./info-panel').then(m => ({ default: m.InfoPanel })))
const MetadataPanel = deferredPanel(() => import('./metadata-panel').then(m => ({ default: m.MetadataPanel })))
const PathsPanel = deferredPanel(() => import('./paths-panel').then(m => ({ default: m.PathsPanel })))
const PatternsPanel = deferredPanel(() => import('./patterns-panel').then(m => ({ default: m.PatternsPanel })))
const ToolPresetsPanel = deferredPanel(() => import('./tool-presets-panel').then(m => ({ default: m.ToolPresetsPanel })))
const LayerCompsPanel = deferredPanel(() => import('./layer-comps-panel').then(m => ({ default: m.LayerCompsPanel })))

export type PanelId =
  | 'color' | 'layers' | 'channels' | 'history' | 'actions'
  | 'adjustments' | 'properties' | 'metadata' | 'navigator' | 'histogram' | 'timeline' | 'clone-source' | 'info' | 'paths' | 'patterns' | 'tool-presets' | 'layer-comps'
  | 'tools' | 'tool-options' | 'documents'

export interface PanelDef {
  id: PanelId
  label: string
  icon: LucideIcon
  /** content component (no props) */
  render: ComponentType
  /** initial floating window size */
  defaultFloat: { w: number; h: number }
  /** minimum floating window size */
  minFloat: { w: number; h: number }
  /** built-in shell location; absent = normal panel that defaults right */
  home?: 'tools' | 'tool-options' | 'documents'
  /** preferred width when explicitly docked into the top strip */
  topWidth?: number
}

const ToolsModule = () => createElement(Toolbar, { embedded: true })
const ToolOptionsModule = () => createElement(ToolOptionsBar, { embedded: true })
const DocumentsModule = () => createElement(DocumentTabs, { embedded: true })

export const PANELS: PanelDef[] = [
  {
    id: 'color', label: 'Color', icon: Palette, render: ColorPanel,
    defaultFloat: { w: 252, h: 420 }, minFloat: { w: 200, h: 240 },
  },
  {
    id: 'layers', label: 'Layers', icon: Layers, render: LayersPanel,
    defaultFloat: { w: 288, h: 440 }, minFloat: { w: 230, h: 260 },
  },
  {
    id: 'channels', label: 'Channels', icon: GitBranch, render: ChannelsPanel,
    defaultFloat: { w: 264, h: 400 }, minFloat: { w: 220, h: 240 },
  },
  {
    id: 'history', label: 'History', icon: History, render: HistoryPanel,
    defaultFloat: { w: 264, h: 400 }, minFloat: { w: 220, h: 240 },
  },
  {
    id: 'actions', label: 'Actions', icon: Zap, render: ActionsPanel,
    defaultFloat: { w: 304, h: 440 }, minFloat: { w: 240, h: 280 },
  },
  {
    id: 'adjustments', label: 'Adjust', icon: SlidersHorizontal, render: AdjustmentsPanel,
    defaultFloat: { w: 264, h: 430 }, minFloat: { w: 220, h: 260 },
  },
  {
    id: 'properties', label: 'Props', icon: Settings, render: PropertiesPanel,
    defaultFloat: { w: 288, h: 470 }, minFloat: { w: 230, h: 300 },
  },
  {
    id: 'metadata', label: 'Metadata', icon: Tags, render: MetadataPanel,
    defaultFloat: { w: 420, h: 620 }, minFloat: { w: 300, h: 340 },
  },
  {
    id: 'navigator', label: 'Nav', icon: Compass, render: NavigatorPanel,
    defaultFloat: { w: 268, h: 340 }, minFloat: { w: 220, h: 250 },
  },
  {
    id: 'histogram', label: 'Hist', icon: BarChart3, render: HistogramPanel,
    defaultFloat: { w: 284, h: 320 }, minFloat: { w: 220, h: 220 },
  },
  {
    id: 'timeline', label: 'Timeline', icon: Film, render: TimelinePanel,
    defaultFloat: { w: 680, h: 280 }, minFloat: { w: 460, h: 200 },
  },
  {
    id: 'clone-source', label: 'Clone', icon: Stamp, render: CloneSourcePanel,
    defaultFloat: { w: 292, h: 420 }, minFloat: { w: 240, h: 300 },
  },
  {
    id: 'info', label: 'Info', icon: Info, render: InfoPanel,
    defaultFloat: { w: 300, h: 430 }, minFloat: { w: 240, h: 280 },
  },
  {
    id: 'paths', label: 'Paths', icon: PenTool, render: PathsPanel,
    defaultFloat: { w: 286, h: 420 }, minFloat: { w: 230, h: 260 },
  },
  {
    id: 'patterns', label: 'Patterns', icon: Grid2X2, render: PatternsPanel,
    defaultFloat: { w: 300, h: 430 }, minFloat: { w: 240, h: 280 },
  },
  {
    id: 'tool-presets', label: 'Presets', icon: Sliders, render: ToolPresetsPanel,
    defaultFloat: { w: 300, h: 430 }, minFloat: { w: 240, h: 280 },
  },
  {
    id: 'layer-comps', label: 'Layer Comps', icon: LayoutList, render: LayerCompsPanel,
    defaultFloat: { w: 316, h: 440 }, minFloat: { w: 250, h: 280 },
  },
  {
    id: 'tools', label: 'Tools', icon: Wrench, render: ToolsModule,
    defaultFloat: { w: 300, h: 620 }, minFloat: { w: 180, h: 260 },
    home: 'tools', topWidth: 420,
  },
  {
    id: 'tool-options', label: 'Tool Options', icon: SlidersHorizontal, render: ToolOptionsModule,
    defaultFloat: { w: 760, h: 190 }, minFloat: { w: 360, h: 110 },
    home: 'tool-options', topWidth: 760,
  },
  {
    id: 'documents', label: 'Open Files', icon: Files, render: DocumentsModule,
    defaultFloat: { w: 720, h: 150 }, minFloat: { w: 320, h: 90 },
    home: 'documents', topWidth: 720,
  },
]

export const PANEL_MAP: Record<string, PanelDef> = Object.fromEntries(
  PANELS.map(p => [p.id, p])
) as Record<string, PanelDef>

