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

/** Natural width for the compact horizontal modules. The browser can measure
 * the document tabs/toolbar contents, and we only cap the result to prevent
 * huge filename lists from taking over the canvas. */
export function horizontalDockPanelWidth(
  id: string,
  fallbackWidth: number,
): { width: string; minWidth: number; maxWidth: string } | { width: number } {
  if (id === 'documents' || id === 'tool-options') {
    return {
      width: 'max-content',
      minWidth: id === 'documents' ? 180 : 260,
      maxWidth: 'min(72vw, 940px)',
    }
  }
  return { width: fallbackWidth }
}
