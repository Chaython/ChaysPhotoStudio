'use client'
// GIMP-style transform tools — placeholder implementations
import type { Tool } from '../types'
import { useEditorStore } from '../store'

function makeTransformTool(id: string, label: string): Tool {
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

export const alignmentTool = makeTransformTool('alignment', 'Alignment')
export const rotateTool = makeTransformTool('rotate', 'Rotate')
export const scaleTool = makeTransformTool('scale', 'Scale')
export const shearTool = makeTransformTool('shear', 'Shear')
export const perspectiveTool = makeTransformTool('perspective', 'Perspective')
export const unifiedTransformTool = makeTransformTool('unified-transform', 'Unified Transform')
export const handleTransformTool = makeTransformTool('handle-transform', 'Handle Transform')
export const flipTool = makeTransformTool('flip', 'Flip')
export const cageTransformTool = makeTransformTool('cage-transform', 'Cage Transform')
export const warpTransformTool = makeTransformTool('warp-transform', 'Warp Transform')