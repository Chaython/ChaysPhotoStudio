// Tool registry — aggregates every tool module
import type { Tool, ToolId } from '../types'
import { moveTool } from './move'
import { marqueeRectTool, marqueeEllipseTool } from './marquee'
import { lassoTool } from './lasso'
import { polygonLassoTool } from './polygon-lasso'
import { magneticLassoTool } from './magnetic-lasso'
import { measureTool } from './measure'
import { objectSelectTool, quickSelectTool } from './select-tools'
import { magicWandTool } from './wand'
import { brushTool, pencilTool } from './brush'
import { mixerBrushTool } from './mixer-brush'
import { colorReplacementTool } from './color-replacement'
import { historyBrushTool } from './history-brush'
import { artHistoryBrushTool } from './art-history-brush'
import { penTool } from './pen'
import { eraserTool } from './eraser'
import { backgroundEraserTool } from './background-eraser'
import { magicEraserTool } from './magic-eraser'
import { cloneStampTool } from './clone-stamp'
import { patternStampTool } from './pattern-stamp'
import { healingBrushTool, spotHealingTool, patchTool } from './healing'
import { contentAwareMoveTool } from './content-aware-move'
import { redEyeTool } from './red-eye'
import { blurTool, sharpenTool, smudgeTool, dodgeTool, burnTool, spongeTool } from './retouch'
import { gradientTool, paintBucketTool } from './fill'
import { textTool, shapeTool } from './text-shapes'
import { cropTool, eyedropperTool, handTool, zoomTool } from './crop'
import { colorSamplerTool } from './color-sampler'

export const TOOLS: Record<ToolId, Tool> = {
  'move': moveTool,
  'marquee-rect': marqueeRectTool,
  'marquee-ellipse': marqueeEllipseTool,
  'lasso': lassoTool,
  'polygon-lasso': polygonLassoTool,
  'magnetic-lasso': magneticLassoTool,
  'measure': measureTool,
  'object-select': objectSelectTool,
  'quick-select': quickSelectTool,
  'magic-wand': magicWandTool,
  'crop': cropTool,
  'eyedropper': eyedropperTool,
  'color-sampler': colorSamplerTool,
  'brush': brushTool,
  'pencil': pencilTool,
  'mixer-brush': mixerBrushTool,
  'color-replacement': colorReplacementTool,
  'history-brush': historyBrushTool,
  'art-history-brush': artHistoryBrushTool,
  'clone-stamp': cloneStampTool,
  'pattern-stamp': patternStampTool,
  'healing-brush': healingBrushTool,
  'spot-healing': spotHealingTool,
  'patch': patchTool,
  'content-aware-move': contentAwareMoveTool,
  'red-eye': redEyeTool,
  'eraser': eraserTool,
  'background-eraser': backgroundEraserTool,
  'magic-eraser': magicEraserTool,
  'gradient': gradientTool,
  'paint-bucket': paintBucketTool,
  'blur': blurTool,
  'sharpen': sharpenTool,
  'smudge': smudgeTool,
  'dodge': dodgeTool,
  'burn': burnTool,
  'sponge': spongeTool,
  'text': textTool,
  'pen': penTool,
  'shape': shapeTool,
  'hand': handTool,
  'zoom': zoomTool,
}

let activeToolId: ToolId = 'move'
export function getTool(id: ToolId): Tool | null {
  return TOOLS[id] ?? null
}
export function setActiveTool(id: ToolId) {
  const prev = TOOLS[activeToolId]
  prev?.onDeactivate?.()
  activeToolId = id
  TOOLS[id]?.onActivate?.()
}
export function getActiveToolId(): ToolId { return activeToolId }
