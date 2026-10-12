/**
 * The Move tool's layer context menu is user-configurable. Keep the catalog
 * independent of React so preferences can be validated without the DOM.
 */
export const LAYER_CONTEXT_MENU_SECTIONS = [
  { id: 'edit', label: 'Edit', entries: [
    { id: 'undo', label: 'Undo' }, { id: 'redo', label: 'Redo' },
    { id: 'cut', label: 'Cut Layer' }, { id: 'paste', label: 'Paste Layer' },
  ] },
  { id: 'operations', label: 'Layer operations', entries: [
    { id: 'expand', label: 'Expand to Fill Frame' },
    { id: 'transform', label: 'Free Transform' },
    { id: 'style', label: 'Layer Style' },
    { id: 'copy-style', label: 'Copy Layer Style' },
    { id: 'paste-style', label: 'Paste Layer Style' },
    { id: 'clear-style', label: 'Clear Layer Style' },
    { id: 'matting', label: 'Matting submenu' },
  ] },
  { id: 'clipboard', label: 'Duplicate and delete', entries: [
    { id: 'duplicate', label: 'Duplicate Layer' },
    { id: 'duplicate-into', label: 'Duplicate Into' },
    { id: 'copy-pixels', label: 'Copy Layer Pixels' },
    { id: 'delete', label: 'Delete Layer' },
  ] },
  { id: 'arrange', label: 'Arrange and flip', entries: [
    { id: 'arrange', label: 'Arrange submenu' },
    { id: 'flip-h', label: 'Flip Layer Horizontal' },
    { id: 'flip-v', label: 'Flip Layer Vertical' },
  ] },
  { id: 'convert', label: 'Convert and merge', entries: [
    { id: 'rasterize', label: 'Rasterize Layer' },
    { id: 'merge-down', label: 'Merge Down' },
    { id: 'rename', label: 'Rename Layer' },
  ] },
  { id: 'properties', label: 'Inspect', entries: [
    { id: 'properties', label: 'Layer Properties' },
  ] },
] as const

export type LayerContextSectionId = typeof LAYER_CONTEXT_MENU_SECTIONS[number]['id']
type ActionFromSection<T> = T extends { entries: readonly (infer E)[] }
  ? E extends { id: infer ID extends string } ? ID : never
  : never
export type LayerContextActionId = ActionFromSection<(typeof LAYER_CONTEXT_MENU_SECTIONS)[number]>
export interface LayerContextMenuPreferences {
  hidden: LayerContextActionId[]
  order: Record<LayerContextSectionId, LayerContextActionId[]>
}

export const LAYER_CONTEXT_MENU_STORAGE_KEY = 'zphoto-layer-context-menu-v1'
const knownIds = new Set<string>(LAYER_CONTEXT_MENU_SECTIONS.flatMap(section => section.entries.map(entry => entry.id)))

export function defaultLayerContextPreferences(): LayerContextMenuPreferences {
  return {
    hidden: [],
    order: Object.fromEntries(
      LAYER_CONTEXT_MENU_SECTIONS.map(section => [section.id, section.entries.map(entry => entry.id)]),
    ) as LayerContextMenuPreferences['order'],
  }
}

export function normalizeLayerContextPreferences(value: unknown): LayerContextMenuPreferences {
  const defaults = defaultLayerContextPreferences()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const prefs = value as Record<string, unknown>
  const hidden = Array.isArray(prefs.hidden)
    ? [...new Set(prefs.hidden.filter((id): id is LayerContextActionId => typeof id === 'string' && knownIds.has(id)))]
    : []
  const savedOrder = prefs.order && typeof prefs.order === 'object' && !Array.isArray(prefs.order)
    ? prefs.order as Record<string, unknown> : {}
  for (const section of LAYER_CONTEXT_MENU_SECTIONS) {
    const validIds: LayerContextActionId[] = defaults.order[section.id]
    const raw = savedOrder[section.id]
    const kept = Array.isArray(raw)
      ? [...new Set(raw.filter((id): id is LayerContextActionId => typeof id === 'string' && validIds.some(validId => validId === id)))]
      : []
    defaults.order[section.id] = [...kept, ...validIds.filter(id => !kept.includes(id))]
  }
  defaults.hidden = hidden
  return defaults
}

export function setLayerContextActionVisible(
  prefs: LayerContextMenuPreferences,
  actionId: LayerContextActionId,
  visible: boolean,
): LayerContextMenuPreferences {
  const safe = normalizeLayerContextPreferences(prefs)
  safe.hidden = visible ? safe.hidden.filter(id => id !== actionId)
    : [...new Set([...safe.hidden, actionId])]
  return safe
}

export function moveLayerContextAction(
  prefs: LayerContextMenuPreferences,
  sectionId: LayerContextSectionId,
  actionId: LayerContextActionId,
  direction: -1 | 1,
): LayerContextMenuPreferences {
  const safe = normalizeLayerContextPreferences(prefs)
  const order = safe.order[sectionId]
  const current = order.indexOf(actionId)
  if (current < 0 || current + direction < 0 || current + direction >= order.length) return safe
  const other = current + direction
  ;[order[current], order[other]] = [order[other], order[current]]
  return safe
}

export function loadLayerContextPreferences(): LayerContextMenuPreferences {
  if (typeof window === 'undefined') return defaultLayerContextPreferences()
  try {
    const saved = window.localStorage.getItem(LAYER_CONTEXT_MENU_STORAGE_KEY)
    return normalizeLayerContextPreferences(saved ? JSON.parse(saved) : null)
  } catch { return defaultLayerContextPreferences() }
}

export function saveLayerContextPreferences(prefs: LayerContextMenuPreferences): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LAYER_CONTEXT_MENU_STORAGE_KEY, JSON.stringify(normalizeLayerContextPreferences(prefs)))
  } catch { /* Storage can be disabled in private browsing; retain in-session state. */ }
}
