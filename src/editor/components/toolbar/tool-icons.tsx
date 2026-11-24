'use client'
// Shared workspace icon vocabulary. Keeping this out of the main toolbar lets
// pop-out tool clusters render the exact same icons without importing (and
// therefore creating a module cycle through) the toolbar itself.
import * as Icons from 'lucide-react'
import { useEditorStore } from '../../store'
import type { ToolId } from '../../types'

/**
 * Workspace icon language. The tools and their behavior remain shared, but
 * each preset gets a recognizable icon vocabulary instead of reusing one
 * generic rail. Names resolve to lucide-react exports with a safe fallback.
 */
const WORKSPACE_TOOL_ICONS: Record<string, Record<string, string>> = {
  photoshop: {
    move: 'Move', 'marquee-rect': 'SquareDashed', 'marquee-ellipse': 'CircleDashed',
    lasso: 'Lasso', 'polygon-lasso': 'Pentagon', 'magnetic-lasso': 'Magnet',
    'object-select': 'ScanSearch', 'quick-select': 'BrushHighlighter', 'magic-wand': 'WandSparkles',
    crop: 'Crop', eyedropper: 'Pipette', brush: 'Paintbrush', pencil: 'Pencil',
    eraser: 'Eraser', 'clone-stamp': 'Stamp', 'spot-healing': 'Sparkles',
    gradient: 'Blend', 'paint-bucket': 'PaintBucket', pen: 'PenTool', text: 'Type',
    shape: 'Shapes', hand: 'Hand', zoom: 'ZoomIn',
  },
  illustrator: {
    move: 'Pointer', artboard: 'PanelsTopLeft', 'marquee-rect': 'MousePointer2',
    'marquee-ellipse': 'Circle', lasso: 'Lasso', 'polygon-lasso': 'Pentagon',
    'magic-wand': 'Wand2', eyedropper: 'Pipette', brush: 'Brush',
    pencil: 'Pencil', eraser: 'Eraser', pen: 'PenTool', 'pen-freeform': 'PenLine',
    'pen-curvature': 'Spline', text: 'Type', 'path-select': 'MousePointer2',
    'direct-select': 'MousePointer', shape: 'Shapes', gradient: 'Blend',
    'paint-bucket': 'PaintBucket', hand: 'Hand', zoom: 'ZoomIn',
  },
  gimp: {
    move: 'Move', 'marquee-rect': 'Square', 'marquee-ellipse': 'Circle',
    lasso: 'Lasso', 'polygon-lasso': 'PenLine', 'magnetic-lasso': 'Magnet',
    'quick-select': 'Brush', 'magic-wand': 'WandSparkles', crop: 'Crop',
    eyedropper: 'Pipette', brush: 'Paintbrush', pencil: 'Pencil',
    eraser: 'Eraser', 'clone-stamp': 'Stamp', 'healing-brush': 'Bandage',
    gradient: 'Blend', 'paint-bucket': 'PaintBucket', pen: 'Waypoints',
    text: 'Type', shape: 'Shapes', hand: 'Hand', zoom: 'ZoomIn',
    // New GIMP tools
    alignment: 'AlignHorizontalDistributeCenter',
    rotate: 'RotateCcw',
    scale: 'Maximize2',
    shear: 'Slash',
    perspective: 'Box',
    'unified-transform': 'Move3d',
    'handle-transform': 'CornerUpLeft',
    flip: 'FlipHorizontal2',
    'cage-transform': 'Grid',
    'warp-transform': 'Waves',
    'scissors-select': 'Scissors',
    'foreground-select': 'User',
    airbrush: 'SprayCan',
    ink: 'Pen',
    'mypaint-brush': 'Paintbrush',
  },
  paint: {
    move: 'Move', 'marquee-rect': 'SquareDashed', 'marquee-ellipse': 'CircleDashed',
    lasso: 'Lasso', crop: 'Crop', eyedropper: 'Pipette', 'color-sampler': 'Pipette',
    pencil: 'Pencil', brush: 'Paintbrush', airbrush: 'SprayCan', ink: 'Pen',
    'paint-bucket': 'PaintBucket', gradient: 'Blend', eraser: 'Eraser',
    text: 'Type', shape: 'Shapes', pen: 'PenTool', zoom: 'ZoomIn', hand: 'Hand',
  },
  fireworks: {
    move: 'Pointer', artboard: 'PanelsTopLeft', 'marquee-rect': 'Square',
    'marquee-ellipse': 'Circle', lasso: 'Lasso', crop: 'Crop',
    slice: 'Scissors', hotspot: 'MousePointerClick', eyedropper: 'Pipette',
    brush: 'Paintbrush', pencil: 'Pencil', eraser: 'Eraser',
    pen: 'PenTool', text: 'Type', shape: 'Shapes', gradient: 'Blend',
    'paint-bucket': 'PaintBucket', hand: 'Hand', zoom: 'ZoomIn',
  },
}

const WORKSPACE_CUSTOM_GLYPHS: Record<string, Record<string, React.ReactNode>> = {
  photoshop: {
    'marquee-rect': <><rect x="4" y="5" width="16" height="14" strokeDasharray="2 2" /><path d="M7 8h10M7 16h10" /></>,
    'spot-healing': <><circle cx="12" cy="12" r="7" /><path d="M12 7v10M7 12h10M9 9l6 6M15 9l-6 6" /></>,
    'clone-stamp': <><path d="M7 8h10v7H7zM9 15v3h6v-3" /><path d="M9 5h6" /></>,
    brush: <><path d="m5 16 9-9 4 4-9 9H5z" /><path d="m14 7 2-2 4 4-2 2" /></>,
    lasso: <><path d="M5 8c0-3 3-5 7-5s7 2 7 5-3 5-7 5c-2 0-3-.5-4-1l-3 3 1-5" /><path d="M12 13v4c0 2 1 3 3 3" /></>,
    'marquee-ellipse': <><ellipse cx="12" cy="12" rx="8" ry="6" strokeDasharray="2 2" /><path d="M4 12h16" /></>,
    crop: <><path d="M7 3v14a2 2 0 0 0 2 2h12M3 7h14a2 2 0 0 1 2 2v12" /></>,
    eraser: <><path d="m4 15 8-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-5 6H9z" /><path d="m9 19 6-7" /></>,
  },
  illustrator: {
    move: <><path d="M12 2v20M2 12h20M12 2l-2 3m2-3 2 3M22 12l-3-2m3 2-3 2M12 22l-2-3m2 3 2-3M2 12l3-2m-3 2 3 2" /></>,
    artboard: <><rect x="4" y="4" width="16" height="16" /><path d="M8 2v4m8-4v4M8 18v4m8-4v4M2 8h4m12 0h4M2 16h4m12 0h4" /></>,
    'path-select': <><path d="M5 19 7 5l12 4-8 10z" /><circle cx="5" cy="19" r="1.6" fill="currentColor" /><circle cx="7" cy="5" r="1.6" fill="currentColor" /><circle cx="19" cy="9" r="1.6" fill="currentColor" /><circle cx="11" cy="19" r="1.6" fill="currentColor" /></>,
    'direct-select': <><path d="m5 3 2 17 4-5 4 5 2-2-4-5 6-1z" /><circle cx="7" cy="5" r="1.2" fill="currentColor" /></>,
    pen: <><path d="m12 3 6 6-8 10-5 2 2-5z" /><path d="m10 5 6 6M5 16l4 3" /><circle cx="12" cy="3" r="1.5" /></>,
    'pen-freeform': <><path d="M4 18c2-12 5-12 8-5s5 6 8-7" /><circle cx="4" cy="18" r="1.5" /><circle cx="20" cy="6" r="1.5" /></>,
    text: <><path d="M4 5h16M12 5v14M8 19h8" /><path d="M8 5 6 9m10-4 2 4" /></>,
    shape: <><rect x="3" y="4" width="8" height="8" /><circle cx="17" cy="8" r="4" /><path d="m12 21 4-7 4 7z" /></>,
    'magic-wand': <><path d="m4 20 12-12 4 4L8 24z" /><path d="m16 3 1-2m4 5 2-1m-6 7 2 2" /></>,
    eyedropper: <><path d="m14 4 6 6M12 6l6 6-9 9H4v-5z" /><path d="m4 20-1 1" /></>,
    gradient: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 18 18 5M8 19 20 7M4 13l8-8" /></>,
    pencil: <><path d="m4 16 11-11 5 5L9 21H4z" /><path d="m13 7 5 5M4 16l5 5" /></>,
    eraser: <><path d="m4 15 8-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-5 6H9z" /><path d="m9 19 6-7" /></>,
  },
  gimp: {
    'marquee-rect': <><rect x="4" y="4" width="16" height="16" strokeDasharray="1.5 2" /><path d="M8 8h8v8H8z" /></>,
    brush: <><path d="m5 17 9-10 4 4-9 10H5z" /><path d="M14 7 17 4l4 4-3 3" /><path d="M4 21c0-2 2-3 4-3" /></>,
    pen: <><path d="M4 19 12 4l8 15z" /><circle cx="12" cy="4" r="1.5" fill="currentColor" /><circle cx="4" cy="19" r="1.5" fill="currentColor" /><circle cx="20" cy="19" r="1.5" fill="currentColor" /></>,
    'marquee-ellipse': <><ellipse cx="12" cy="12" rx="8" ry="6" strokeDasharray="2 2" /></>,
    lasso: <><path d="M5 8c0-3 3-5 7-5s7 2 7 5-3 5-7 5c-2 0-3-.5-4-1l-3 3 1-5" /></>,
    crop: <><path d="M7 3v14a2 2 0 0 0 2 2h12M3 7h14a2 2 0 0 1 2 2v12" /></>,
    eraser: <><path d="m4 15 8-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-5 6H9z" /><path d="m9 19 6-7" /></>,
    'clone-stamp': <><path d="M7 8h10v7H7zM9 15v3h6v-3" /><path d="M9 5h6" /></>,
    'healing-brush': <><path d="m5 15 10-10 5 5-10 10H5z" /><path d="m11 9 5 5M8 17l2-2" /></>,
    gradient: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 18 18 5M8 19 20 7" /></>,
    // New GIMP tools
    alignment: <><rect x="4" y="4" width="16" height="16" /><path d="M4 12h16M12 4v16" stroke="currentColor" strokeWidth="0.5" /></>,
    rotate: <><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8m11.3 11.3l2.8 2.8M4.9 19.1l2.8-2.8m11.3-11.3l2.8-2.8" /><circle cx="12" cy="12" r="3" /></>,
    scale: <><rect x="5" y="5" width="14" height="14" /><path d="M3 12h6M15 12h6M12 3v6M12 15v6" /></>,
    shear: <><path d="M4 16l16-12" /><path d="M4 8l16 12" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" /></>,
    perspective: <><path d="M6 4l6 16M12 4l6 16M6 20l6-16" /><path d="M6 4h12M12 20h12" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" /></>,
    'unified-transform': <><rect x="4" y="4" width="16" height="16" /><path d="M12 4v4M12 16v4M4 12h4M16 12h4" /><path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" strokeWidth="0.5" /></>,
    'handle-transform': <><rect x="4" y="4" width="16" height="16" /><circle cx="4" cy="4" r="2" fill="currentColor" /><circle cx="20" cy="4" r="2" fill="currentColor" /><circle cx="4" cy="20" r="2" fill="currentColor" /><circle cx="20" cy="20" r="2" fill="currentColor" /></>,
    flip: <><path d="M4 12h16" /><path d="M8 8l4-4 4 4M8 16l4 4 4-4" /></>,
    'cage-transform': <><rect x="3" y="3" width="18" height="18" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke="currentColor" strokeWidth="0.5" /></>,
    'warp-transform': <><rect x="3" y="3" width="18" height="18" /><path d="M3 12c3-4 9-4 12 0M3 12c3 4 9 4 12 0" stroke="currentColor" strokeWidth="0.5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></>,
    'scissors-select': <><path d="M4 12l4-6 4 6 4-6 4 6" strokeWidth="1.5" /><circle cx="8" cy="6" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="16" cy="6" r="1.5" fill="currentColor" /></>,
    'foreground-select': <><path d="M6 6l6 6 6-6" strokeWidth="2" /><path d="M12 2v20M2 12h20" strokeWidth="0.5" strokeDasharray="2 2" /></>,
    airbrush: <><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 4.9l-2.8 2.8" /><circle cx="12" cy="12" r="4" /><path d="M12 8v8" strokeWidth="0.5" /></>,
    ink: <><path d="M4 20l8-12 8 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 8v12" strokeWidth="0.5" /></>,
    'mypaint-brush': <><path d="M12 2c0 3-3 5-7 5s-7-2-7-5c0-2 1-4 3-5l-3-3 1-5c4 1 7 3 7 6s-3 5-7 5z" /><path d="M12 13v4c0 2 1 3 3 3" /></>,
  },
  fireworks: {
    slice: <><rect x="3" y="4" width="18" height="16" /><path d="M12 4v16M3 12h18" /><path d="m9 9 3 3-3 3" /></>,
    hotspot: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1v3m0 16v3M1 12h3m16 0h3" /></>,
    move: <><path d="M12 2v20M2 12h20M12 2l-3 3m3-3 3 3M22 12l-3-3m3 3-3 3M12 22l-3-3m3 3 3-3M2 12l3-3m-3 3 3 3" /></>,
    eyedropper: <><path d="m14 4 6 6M12 6l6 6-9 9H4v-5z" /></>,
    pen: <><path d="m12 3 6 6-8 10-5 2 2-5z" /><path d="m10 5 6 6" /></>,
    shape: <><rect x="3" y="4" width="8" height="8" /><circle cx="17" cy="8" r="4" /><path d="m12 21 4-7 4 7z" /></>,
  },
}

export function ToolIcon({ icon, toolId, size = 16 }: { icon: string; toolId?: ToolId; size?: number }) {
  const workspacePreset = useEditorStore(s => s.workspacePreset)
  const workspaceIcon = toolId ? WORKSPACE_TOOL_ICONS[workspacePreset]?.[toolId] : undefined
  const customGlyph = toolId ? WORKSPACE_CUSTOM_GLYPHS[workspacePreset]?.[toolId] : undefined
  if (customGlyph) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {customGlyph}
      </svg>
    )
  }
  const Cmp = (Icons as any)[workspaceIcon ?? icon] ?? (Icons as any)[icon] ?? Icons.MousePointer2
  return <Cmp size={size} strokeWidth={1.75} />
}
