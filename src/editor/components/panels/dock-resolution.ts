// Centralized dock routing used by the left/right rails. Every horizontal
// destination is EXCLUSIVE to its own strip, including the four corners.
// A missing side means the panel's built-in home or the default right rail.
import type { DockSide } from '../../store'

export const VALID_DOCK_SIDES: readonly DockSide[] = [
  'left', 'right', 'top', 'bottom',
  'top-left', 'top-right', 'bottom-left', 'bottom-right',
]

export function resolvePanelDockSide(
  id: string,
  dockSide: Record<string, string>,
  hasNativeHome: boolean,
): DockSide | null {
  const explicit = dockSide[id]
  if (VALID_DOCK_SIDES.includes(explicit as DockSide)) return explicit as DockSide
  return hasNativeHome ? null : 'right'
}
