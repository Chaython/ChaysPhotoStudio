// Use panel registry content requirements rather than assigning the same
// 264px frame to every side panel. These are safe initial widths, not guesses
// based on invisible/offscreen DOM nodes. The existing width handle overrides
// this when the user wants more space.
import type { PanelDef } from './panel-registry'

export function autoSideDockWidth(panel: PanelDef | undefined, photoshop = false): number {
  if (photoshop) return 318 // two stacked Photoshop inspectors share one width
  if (!panel) return 264
  if (panel.id === 'documents') return 220 // 32px-high tab strip; scroll long names
  if (panel.id === 'tools') return 220
  if (panel.id === 'tool-options') return 380
  return Math.max(220, Math.min(460, panel.minFloat.w + 12))
}
