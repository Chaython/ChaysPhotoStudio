'use client'
import { useSyncExternalStore } from 'react'
import {
  defaultLayerContextPreferences, loadLayerContextPreferences,
  saveLayerContextPreferences, LAYER_CONTEXT_MENU_STORAGE_KEY,
  type LayerContextMenuPreferences,
} from './layer-context-menu-config'

// A shared snapshot keeps both menu surfaces in sync without a state-effect
// hydration mismatch, reloading the document or duplicating per-row state.
const serverSnapshot = defaultLayerContextPreferences()
let snapshot: LayerContextMenuPreferences | null = null
const listeners = new Set<() => void>()
function getSnapshot(): LayerContextMenuPreferences {
  if (!snapshot) snapshot = loadLayerContextPreferences()
  return snapshot
}
function broadcast(): void { for (const listener of listeners) listener() }
function onStorage(event: StorageEvent): void {
  if (event.key !== LAYER_CONTEXT_MENU_STORAGE_KEY && event.key !== null) return
  snapshot = loadLayerContextPreferences()
  broadcast()
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}
export function useLayerContextMenuPreferences(): readonly [
  LayerContextMenuPreferences, (prefs: LayerContextMenuPreferences) => void,
] {
  const preferences = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot)
  const update = (prefs: LayerContextMenuPreferences) => {
    saveLayerContextPreferences(prefs)
    snapshot = loadLayerContextPreferences()
    broadcast()
  }
  return [preferences, update] as const
}
