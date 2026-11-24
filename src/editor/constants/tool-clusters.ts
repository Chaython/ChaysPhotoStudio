// Workspace-independent toolbox clusters.
//
// The groups on the MS Paint ribbon (Selection, Image, Tools, Brushes, Shapes,
// Retouch) are not just decoration: every group is a first-class window target.
// A cluster can be floated, dragged to any of the eight dock positions, or
// returned to its ribbon/home slot. Keeping the definitions free of component
// imports lets the panel registry, store validation, menus and toolbar share
// the exact same ids and tool membership.
import type { ToolId } from '../types'

export const TOOL_CLUSTER_IDS = [
  'selection', 'image', 'tools', 'brushes', 'shapes', 'retouch',
] as const

export type ToolClusterId = (typeof TOOL_CLUSTER_IDS)[number]
export type ToolClusterPanelId = `cluster:${ToolClusterId}`

export const toolClusterPanelId = (id: ToolClusterId): ToolClusterPanelId => `cluster:${id}`

export interface ToolClusterDef {
  id: ToolClusterId
  label: string
  /** lucide-react export name, resolved in the toolbar/panel registry */
  icon: string
  /** columns used by the compact Paint ribbon group */
  columns: number
  /** columns used by a floating/docked cluster window */
  panelColumns: number
  tools: readonly ToolId[]
  defaultFloat: { w: number; h: number }
}

export const TOOL_CLUSTERS: readonly ToolClusterDef[] = [
  {
    id: 'selection', label: 'Selection', icon: 'SquareDashed', columns: 2, panelColumns: 4,
    tools: ['move', 'marquee-rect', 'marquee-ellipse', 'lasso'],
    defaultFloat: { w: 210, h: 128 },
  },
  {
    id: 'image', label: 'Image', icon: 'Image', columns: 2, panelColumns: 3,
    tools: ['crop', 'eyedropper', 'color-sampler'],
    defaultFloat: { w: 180, h: 120 },
  },
  {
    id: 'tools', label: 'Tools', icon: 'Wrench', columns: 2, panelColumns: 3,
    tools: ['pencil', 'paint-bucket', 'text', 'eraser', 'zoom', 'hand'],
    defaultFloat: { w: 180, h: 148 },
  },
  {
    id: 'brushes', label: 'Brushes', icon: 'Paintbrush', columns: 2, panelColumns: 3,
    tools: ['brush', 'airbrush', 'ink', 'mypaint-brush'],
    defaultFloat: { w: 180, h: 120 },
  },
  {
    id: 'shapes', label: 'Shapes', icon: 'Shapes', columns: 2, panelColumns: 2,
    tools: ['shape', 'pen'],
    defaultFloat: { w: 180, h: 120 },
  },
  {
    id: 'retouch', label: 'Retouch', icon: 'Sparkles', columns: 2, panelColumns: 3,
    tools: ['clone-stamp', 'blur', 'sharpen', 'smudge'],
    defaultFloat: { w: 180, h: 120 },
  },
]

export const TOOL_CLUSTER_MAP: Record<ToolClusterId, ToolClusterDef> = Object.fromEntries(
  TOOL_CLUSTERS.map(cluster => [cluster.id, cluster]),
) as Record<ToolClusterId, ToolClusterDef>

export const TOOL_CLUSTER_PANEL_IDS: readonly ToolClusterPanelId[] =
  TOOL_CLUSTERS.map(cluster => toolClusterPanelId(cluster.id))

export const isToolClusterPanelId = (id: string): id is ToolClusterPanelId =>
  (TOOL_CLUSTER_PANEL_IDS as readonly string[]).includes(id)

export const toolClusterIdFromPanelId = (id: string): ToolClusterId | null => {
  if (!isToolClusterPanelId(id)) return null
  return id.slice('cluster:'.length) as ToolClusterId
}
