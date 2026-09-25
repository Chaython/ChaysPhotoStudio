'use client'
// Panel registry — single source of truth for dockable/floating editor panels.
// Every panel follows the same lifecycle: dock left/right/top or float as a window.
// NOTE: this module imports panel components (which import the store) — keep it
// free of store imports to avoid a circular dependency.
import { createElement, type ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Layers, GitBranch, History, Zap, SlidersHorizontal, Settings, Compass, BarChart3, Palette, Film, Stamp, Info, PenTool, Grid2X2, Sliders, Wrench, Files,
} from 'lucide-react'
import { LayersPanel } from './layers-panel'
import { HistoryPanel, NavigatorPanel, HistogramPanel } from './history-navigator-histogram'
import { ColorPanel } from './color-panel'
import { ChannelsPanel, AdjustmentsPanel, ActionsPanel, PropertiesPanel } from './channels-actions-properties'
import { TimelinePanel } from './timeline-panel'
import { CloneSourcePanel } from './clone-source-panel'
import { InfoPanel } from './info-panel'
import { PathsPanel } from './paths-panel'
import { PatternsPanel } from './patterns-panel'
import { ToolPresetsPanel } from './tool-presets-panel'
import { Toolbar } from '../toolbar/toolbar'
import { ToolOptionsBar } from '../toolbar/tool-options-bar'
import { DocumentTabs } from '../workspace/document-tabs'

export type PanelId =
  | 'color' | 'layers' | 'channels' | 'history' | 'actions'
  | 'adjustments' | 'properties' | 'navigator' | 'histogram' | 'timeline' | 'clone-source' | 'info' | 'paths' | 'patterns' | 'tool-presets'
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

