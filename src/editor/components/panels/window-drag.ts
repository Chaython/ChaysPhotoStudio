// Bridge for starting a floating-window drag from modules that must not import
// the panel registry (the toolbar is imported by the registry, so a direct
// import of floating-panels would create a module cycle).
export interface WindowDragHint {
  /** initial size when the panel has never floated */
  defaultFloat?: { w: number; h: number }
  /** true when the source lives at a built-in home (ribbon/rail) */
  home?: boolean
}

type DragStarter = (
  id: string,
  e: { clientX: number; clientY: number; pointerId: number },
  hint?: WindowDragHint,
) => void

let starter: DragStarter | null = null

/** Registered once by floating-panels.tsx when its module is evaluated. */
export function registerWindowDragStarter(fn: DragStarter) {
  starter = fn
}

/**
 * Float `id` under the pointer and continue the gesture as a window move.
 * Falls back to a normal float when the window controller has not mounted yet.
 */
export function beginWindowDrag(
  id: string,
  e: { clientX: number; clientY: number; pointerId: number },
  hint?: WindowDragHint,
) {
  if (starter) {
    starter(id, e, hint)
    return
  }
  void import('./floating-panels').then(module => module.beginWindowDrag(id, e, hint))
}
