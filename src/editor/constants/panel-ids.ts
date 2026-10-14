/** Registry-neutral list of dockable panels.
 * Keep this module free of components and store imports to avoid dependency cycles
 * when validating a portable workspace layout before the editor UI mounts.
 */
export const DOCKABLE_PANEL_IDS = [
  'color', 'layers', 'channels', 'history', 'actions', 'adjustments', 'properties',
  'metadata', 'navigator', 'histogram', 'timeline', 'clone-source', 'info',
  'paths', 'patterns', 'tool-presets', 'layer-comps',
  'tools', 'tool-options', 'documents',
] as const

export type PanelId = (typeof DOCKABLE_PANEL_IDS)[number]

export const isDockablePanelId = (id: string): id is PanelId =>
  (DOCKABLE_PANEL_IDS as readonly string[]).includes(id)
