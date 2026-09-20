'use client'
// Panel registry — single source of truth for dockable/floating editor panels.
// The dock renders tabs from this list; FloatingPanels renders windows from it.
// NOTE: this module imports panel components (which import the store) — keep it
// free of store imports to avoid a circular dependency.
import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Layers, GitBranch, History, Zap, SlidersHorizontal, Settings, Compass, BarChart3, Palette, Film, Stamp, Info,
} from 'lucide-react'
import { LayersPanel } from './layers-panel'
import { HistoryPanel, NavigatorPanel, HistogramPanel } from './history-navigator-histogram'
import { ColorPanel } from './color-panel'
import { ChannelsPanel, AdjustmentsPanel, ActionsPanel, PropertiesPanel } from './channels-actions-properties'
import { TimelinePanel } from './timeline-panel'
import { CloneSourcePanel } from './clone-source-panel'
import { InfoPanel } from './info-panel'

export type PanelId =
  | 'color' | 'layers' | 'channels' | 'history' | 'actions'
  | 'adjustments' | 'properties' | 'navigator' | 'histogram' | 'timeline' | 'clone-source' | 'info'

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
  /** 'tab' = icon tab in the dock; 'color' renders as the collapsible top section */
  dockSlot: 'tab' | 'color'
}

export const PANELS: PanelDef[] = [
  {
    id: 'color', label: 'Color', icon: Palette, render: ColorPanel,
    defaultFloat: { w: 252, h: 420 }, minFloat: { w: 200, h: 240 }, dockSlot: 'color',
  },
  {
    id: 'layers', label: 'Layers', icon: Layers, render: LayersPanel,
    defaultFloat: { w: 288, h: 440 }, minFloat: { w: 230, h: 260 }, dockSlot: 'tab',
  },
  {
    id: 'channels', label: 'Channels', icon: GitBranch, render: ChannelsPanel,
    defaultFloat: { w: 264, h: 400 }, minFloat: { w: 220, h: 240 }, dockSlot: 'tab',
  },
  {
    id: 'history', label: 'History', icon: History, render: HistoryPanel,
    defaultFloat: { w: 264, h: 400 }, minFloat: { w: 220, h: 240 }, dockSlot: 'tab',
  },
  {
    id: 'actions', label: 'Actions', icon: Zap, render: ActionsPanel,
    defaultFloat: { w: 304, h: 440 }, minFloat: { w: 240, h: 280 }, dockSlot: 'tab',
  },
  {
    id: 'adjustments', label: 'Adjust', icon: SlidersHorizontal, render: AdjustmentsPanel,
    defaultFloat: { w: 264, h: 430 }, minFloat: { w: 220, h: 260 }, dockSlot: 'tab',
  },
  {
    id: 'properties', label: 'Props', icon: Settings, render: PropertiesPanel,
    defaultFloat: { w: 288, h: 470 }, minFloat: { w: 230, h: 300 }, dockSlot: 'tab',
  },
  {
    id: 'navigator', label: 'Nav', icon: Compass, render: NavigatorPanel,
    defaultFloat: { w: 268, h: 340 }, minFloat: { w: 220, h: 250 }, dockSlot: 'tab',
  },
  {
    id: 'histogram', label: 'Hist', icon: BarChart3, render: HistogramPanel,
    defaultFloat: { w: 284, h: 320 }, minFloat: { w: 220, h: 220 }, dockSlot: 'tab',
  },
  {
    id: 'timeline', label: 'Timeline', icon: Film, render: TimelinePanel,
    defaultFloat: { w: 680, h: 280 }, minFloat: { w: 460, h: 200 }, dockSlot: 'tab',
  },
  {
    id: 'clone-source', label: 'Clone', icon: Stamp, render: CloneSourcePanel,
    defaultFloat: { w: 292, h: 420 }, minFloat: { w: 240, h: 300 }, dockSlot: 'tab',
  },
  {
    id: 'info', label: 'Info', icon: Info, render: InfoPanel,
    defaultFloat: { w: 300, h: 430 }, minFloat: { w: 240, h: 280 }, dockSlot: 'tab',
  },
]

export const PANEL_MAP: Record<string, PanelDef> = Object.fromEntries(
  PANELS.map(p => [p.id, p])
) as Record<string, PanelDef>

/** tab-order panel ids (used by the dock tab bar) */
export const TAB_PANELS: PanelDef[] = PANELS.filter(p => p.dockSlot === 'tab')
