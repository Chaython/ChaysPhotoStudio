'use client'
// GIMP-style selection tools — placeholder implementations
import type { Tool } from '../types'
import { useEditorStore } from '../store'

function makeSelectionTool(id: string, label: string): Tool {
  return {
    id: id as any,
    label,
    cursor: 'crosshair',
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

export const scissorsSelectTool = makeSelectionTool('scissors-select', 'Scissors Select')
export const foregroundSelectTool = makeSelectionTool('foreground-select', 'Foreground Select')