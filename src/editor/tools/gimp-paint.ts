// GIMP-style paint tools — placeholder implementations
import type { Tool } from '../types'
import { useEditorStore } from '../store'

function makePaintTool(id: string, label: string): Tool {
  return {
    id: id as any,
    label,
    cursor: 'none',
    requiresLayer: true,
    onPointerDown: () => {
      const pushToast = useEditorStore.getState().pushToast
      pushToast(`${label} tool — not yet implemented`, 'info')
    },
    onActivate: () => {
      const pushToast = useEditorStore.getState().pushToast
      pushToast(`${label} tool — not yet implemented`, 'info')
    },
  }
}

export const airbrushTool = makePaintTool('airbrush', 'Airbrush')
export const inkTool = makePaintTool('ink', 'Ink')
export const mypaintBrushTool = makePaintTool('mypaint-brush', 'MyPaint Brush')