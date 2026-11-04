'use client'
// ============================================================
// Chay's Photo Studio — tool rail (TASK 17/18)
//
// Renders the customizable tool rail from the store layout
// (custom ?? factory default). Besides clicking to activate,
// the desktop rail is fully drag & drop enabled:
//   · flyout menu items are draggable — drag one out of its
//     menu and drop it on the rail to PIN it (its own button)
//   · every tool button is draggable — drop it on a flyout's
//     button to move it INTO that subcategory
//   · drop on a pinned button inserts right before it
// Successful drops toast what happened and close any open
// flyout. Compact (mobile) keeps the same layout but skips
// DnD (touch drags aren't reliable) — use Customize Toolbar.
// ============================================================
import { useMemo, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { TOOL_MAP } from '../../constants/tools'
import { useEditorStore, defaultToolbarLayout } from '../../store'
import { formatCombo } from '../../shortcuts'
import type { ToolDef, ToolId, ToolbarSection } from '../../types'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { engine } from '../../engine/engine'
import { setActiveTool } from '../../tools/registry'
import { insertBefore, moveToGroup, pinToTop } from './layout-ops'

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

function ToolIcon({ icon, toolId, size = 16 }: { icon: string; toolId?: ToolId; size?: number }) {
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

/** effective toolbar sections: the user's custom layout, else the factory default */
function useToolbarSections(): ToolbarSection[] {
  const layout = useEditorStore(s => s.toolbarLayout)
  const preset = useEditorStore(s => s.workspacePreset)
  return useMemo(
    () => layout ?? defaultToolbarLayout(preset),
    [layout, preset]
  )
}

/** live tool shortcut labels (updates when the user edits bindings) */
function useToolKeys(): Record<ToolId, string> {
  const overrides = useEditorStore(s => s.shortcutOverrides)
  return useMemo(() => {
    const out = {} as Record<ToolId, string>
    for (const id of Object.keys(TOOL_MAP) as ToolId[]) {
      out[id] = (overrides?.[`tool:${id}`] || TOOL_MAP[id].shortcut || '?').toLowerCase()
    }
    return out
  }, [overrides])
}

export function Toolbar({ compact = false, embedded = false }: { compact?: boolean; embedded?: boolean }) {
  const activeTool = useEditorStore(s => s.activeTool)
  const setTool = useEditorStore(s => s.setTool)
  const renderTick = useEditorStore(s => s.renderTick)
  const hasDoc = useEditorStore(s => !!s.activeDocId)
  const setToolbarLayout = useEditorStore(s => s.setToolbarLayout)
  const pushToast = useEditorStore(s => s.pushToast)
  const sections = useToolbarSections()
  const keys = useToolKeys()
  const workspacePreset = useEditorStore(s => s.workspacePreset)
  const fgColor = useEditorStore(s => s.fgColor)
  const bgColor = useEditorStore(s => s.bgColor)
  const setFgColor = useEditorStore(s => s.setFgColor)
  const setBgColor = useEditorStore(s => s.setBgColor)
  const activeColorTarget = useEditorStore(s => s.activeColorTarget)
  const setActiveColorTarget = useEditorStore(s => s.setActiveColorTarget)
  const swapColors = useEditorStore(s => s.swapColors)
  const illustratorColors = workspacePreset === 'illustrator' && !compact && !embedded

  // ---------- drag & drop (desktop rail only) ----------
  const [dragSrc, setDragSrc] = useState<ToolId | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const dnd = !compact

  const selectTool = (id: ToolId) => {
    setTool(id)
    setActiveTool(id)
    // update engine tool tracking
    ; (engine as any)._activeToolId = id
    void renderTick
    void hasDoc
  }

  const readDropId = (e: React.DragEvent): ToolId | null => {
    const id = (e.dataTransfer.getData('text/plain') || dragSrc) as ToolId
    return id && TOOL_MAP[id] ? id : null
  }
  const applyLayout = (next: ToolbarSection[], msg: string) => {
    if (next === sections) return
    setToolbarLayout(next)
    pushToast(msg, 'success')
  }
  const endDrag = () => { setDragSrc(null); setHoverKey(null) }
  const closeFlyoutMenus = () => {
    // any open Radix menu (the flyout we dragged out of) listens for Escape
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) } catch { /* noop */ }
  }

  const itemDragStart = (id: ToolId) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    setDragSrc(id)
  }

  const sectionKey = (sec: ToolbarSection): ToolId =>
    sec.kind === 'single' ? sec.tool : sec.tools[0]

  const sectionDnd = (sec: ToolbarSection) => (dnd ? {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setHoverKey(sectionKey(sec))
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setHoverKey(h => (h === sectionKey(sec) ? null : h))
      }
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const id = readDropId(e)
      endDrag()
      if (!id) return
      if (sec.kind === 'single') {
        applyLayout(
          insertBefore(sections, id, sec.tool),
          `${TOOL_MAP[id].label} moved before ${TOOL_MAP[sec.tool].label}`
        )
      } else {
        const first = sec.tools[0]
        applyLayout(
          moveToGroup(sections, id, first),
          `${TOOL_MAP[id].label} moved to the ${TOOL_MAP[first].label} flyout`
        )
      }
      closeFlyoutMenus()
    },
  } : {})

  const railDnd = dnd ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const id = readDropId(e)
      endDrag()
      if (!id) return
      applyLayout(pinToTop(sections, id), `${TOOL_MAP[id].label} pinned to the toolbar`)
      closeFlyoutMenus()
    },
  } : {}

  const dragActive = dnd && !!dragSrc

  return (
    <div
      {...railDnd}
      className={cn(
        'flex bg-panel border-r flex-shrink-0 z-20 transition-all',
        compact
          ? 'flex-row overflow-x-auto w-full h-14 border-b'
          : embedded
            ? 'flex-row flex-wrap content-start overflow-y-auto w-full h-full border-0 p-1'
            : 'flex-col w-12 h-full',
        dragActive && 'ring-1 ring-primary/60'
      )}
      role="toolbar"
      aria-label="Tools"
    >
      {sections.map((sec, i) => {
        const secDnd = sectionDnd(sec)
        const key = sectionKey(sec)
        const hovered = !!hoverKey && hoverKey === key && dragSrc && dragSrc !== key
        if (sec.kind === 'single') {
          const def = TOOL_MAP[sec.tool]
          if (!def) return null
          return (
            <div key={`${sec.tool}-${i}`} {...secDnd} className={cn('flex flex-shrink-0 rounded-sm', compact
                ? 'flex-row px-1.5 gap-1 items-center'
                : embedded
                  ? 'flex-col p-1 gap-0.5'
                  : 'flex-col p-1 gap-0.5 border-b border-border/40 mb-1', hovered && 'ring-1 ring-primary/70')}>
              <ToolButton
                def={def} shortcut={keys[sec.tool]} active={activeTool === sec.tool}
                onSelect={selectTool} compact={compact}
                dragHandle={dnd ? { onDragStart: itemDragStart(sec.tool), onDragEnd: endDrag } : undefined}
              />
            </div>
          )
        }
        // group (flyout) — a group reduced to one tool renders as a single button
        const tools = sec.tools.map(t => TOOL_MAP[t]).filter(Boolean)
        if (tools.length === 1) {
          return (
            <div key={`${sec.tools[0]}-${i}`} {...secDnd} className={cn('flex flex-shrink-0 rounded-sm', compact
                ? 'flex-row px-1.5 gap-1 items-center'
                : embedded
                  ? 'flex-col p-1 gap-0.5'
                  : 'flex-col p-1 gap-0.5 border-b border-border/40 mb-1', hovered && 'ring-1 ring-primary/70')}>
              <ToolButton
                def={tools[0]} shortcut={keys[tools[0].id]} active={activeTool === tools[0].id}
                onSelect={selectTool} compact={compact}
                dragHandle={dnd ? { onDragStart: itemDragStart(tools[0].id), onDragEnd: endDrag } : undefined}
              />
            </div>
          )
        }
        if (!tools.length) return null
        const activeInGroup = tools.find(t => t.id === activeTool)
        const main = activeInGroup ?? tools[0]
        return (
          <div key={`grp-${i}`} {...secDnd} className={cn('flex flex-shrink-0 rounded-sm', compact
                ? 'flex-row px-1.5 gap-1 items-center'
                : embedded
                  ? 'flex-col p-1 gap-0.5'
                  : 'flex-col p-1 gap-0.5 border-b border-border/40 mb-1', hovered && 'ring-1 ring-primary/70')}>
            <ToolGroupButton
              tools={tools}
              main={main}
              active={!!activeInGroup}
              activeTool={activeTool}
              keys={keys}
              onSelect={selectTool}
              compact={compact}
              embedded={embedded}
              dnd={dnd}
              itemDragStart={itemDragStart}
              endDrag={endDrag}
            />
          </div>
        )
      })}
      {illustratorColors && (
        <div className="mt-auto border-t border-border/60 px-1.5 py-2 flex flex-col items-center gap-1.5" aria-label="Fill and Stroke colors">
          <div className="relative w-9 h-9" aria-label="Fill and Stroke swatches">
            <label
              className={cn('absolute left-0 top-0 z-10 h-6 w-6 rounded-sm border-2 shadow-sm cursor-pointer', activeColorTarget === 'fg' ? 'border-primary' : 'border-foreground/60')}
              title="Fill color — click to choose"
              aria-label="Choose Fill color"
              style={{ backgroundColor: fgColor }}
            >
              <input
                type="color"
                value={fgColor}
                onFocus={() => setActiveColorTarget('fg')}
                onChange={e => { setActiveColorTarget('fg'); setFgColor(e.target.value) }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label="Fill color picker"
              />
            </label>
            <label
              className={cn('absolute right-0 bottom-0 h-6 w-6 rounded-sm border-2 shadow-sm cursor-pointer', activeColorTarget === 'bg' ? 'border-primary' : 'border-foreground/60')}
              title="Stroke color — click to choose"
              aria-label="Choose Stroke color"
              style={{ backgroundColor: bgColor }}
            >
              <input
                type="color"
                value={bgColor}
                onFocus={() => setActiveColorTarget('bg')}
                onChange={e => { setActiveColorTarget('bg'); setBgColor(e.target.value) }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label="Stroke color picker"
              />
            </label>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => { setFgColor('#000000'); setBgColor('#ffffff') }}
              className="h-4 w-4 rounded-sm border border-border text-[10px] leading-none hover:bg-accent"
              title="Default Fill and Stroke colors" aria-label="Default Fill and Stroke colors">↙</button>
            <button type="button" onClick={swapColors}
              className="h-4 w-4 rounded-sm border border-border flex items-center justify-center hover:bg-accent"
              title="Swap Fill and Stroke colors" aria-label="Swap Fill and Stroke colors">
              <Icons.ArrowLeftRight size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const TOOL_LONG_PRESS_MS = 450
const TOOL_LONG_PRESS_MOVE_PX = 8

function ToolGroupButton({
  tools, main, active, activeTool, keys, onSelect, compact, embedded, dnd, itemDragStart, endDrag,
}: {
  tools: ToolDef[]
  main: ToolDef
  active: boolean
  activeTool: ToolId
  keys: Record<ToolId, string>
  onSelect: (id: ToolId) => void
  compact: boolean
  embedded: boolean
  dnd: boolean
  itemDragStart: (id: ToolId) => (e: React.DragEvent) => void
  endDrag: () => void
}) {
  const [open, setOpen] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  const suppressNextSelect = useRef(false)

  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = null
    pressOrigin.current = null
  }

  const beginLongPress = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    cancelLongPress()
    pressOrigin.current = { x: e.clientX, y: e.clientY }
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null
      pressOrigin.current = null
      suppressNextSelect.current = true
      setOpen(true)
    }, TOOL_LONG_PRESS_MS)
  }

  const trackLongPress = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = pressOrigin.current
    if (!start) return
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TOOL_LONG_PRESS_MOVE_PX) cancelLongPress()
  }

  const openFromContextMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    cancelLongPress()
    suppressNextSelect.current = false
    setOpen(true)
  }

  const beforeSelect = () => {
    if (!suppressNextSelect.current) return false
    suppressNextSelect.current = false
    return true
  }

  const dragHandle = dnd ? {
    onDragStart: (e: React.DragEvent<HTMLButtonElement>) => {
      cancelLongPress()
      itemDragStart(main.id)(e)
    },
    onDragEnd: () => {
      cancelLongPress()
      endDrag()
    },
  } : undefined

  return (
    <div className="relative group/tool">
      <ToolButton
        def={main}
        shortcut={keys[main.id]}
        active={active}
        onSelect={onSelect}
        compact={compact}
        hasGroup
        beforeSelect={beforeSelect}
        onContextMenu={openFromContextMenu}
        onPointerDown={beginLongPress}
        onPointerMove={trackLongPress}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
        dragHandle={dragHandle}
      />

      <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'absolute right-0 bottom-0 z-10 flex items-center justify-center rounded-tl-sm',
              'text-muted-foreground hover:text-foreground hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
              compact ? 'w-4 h-4' : 'w-3.5 h-3.5',
            )}
            title="Show related tools"
            aria-label={`Show tools related to ${main.label}`}
            aria-haspopup="menu"
          >
            <Icons.ChevronDown size={9} strokeWidth={2.25} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={compact || embedded ? 'bottom' : 'right'}
          align="start"
          className="z-[90] min-w-48"
        >
          {tools.map(t => (
            <DropdownMenuItem
              key={t.id}
              onSelect={() => onSelect(t.id)}
              className="gap-2 text-xs"
              draggable={dnd}
              onDragStart={dnd ? itemDragStart(t.id) : undefined}
              onDragEnd={dnd ? endDrag : undefined}
              title={dnd ? 'Drag onto the toolbar to pin this tool' : undefined}
            >
              <ToolIcon icon={t.icon} toolId={t.id} />
              <span className="flex-1">{t.label}</span>
              {t.id === activeTool && <Icons.Check size={11} className="text-primary" />}
              <span className="text-muted-foreground font-mono text-[10px]">{formatCombo(keys[t.id])}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ToolButton({
  def, shortcut, active, onSelect, compact, hasGroup, dragHandle, beforeSelect,
  onContextMenu, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave,
}: {
  def: ToolDef
  /** live activation key (already reflects user overrides) */
  shortcut: string
  active: boolean
  onSelect: (id: ToolId) => void
  compact?: boolean
  hasGroup?: boolean
  beforeSelect?: () => boolean
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>
  onPointerMove?: React.PointerEventHandler<HTMLButtonElement>
  onPointerUp?: React.PointerEventHandler<HTMLButtonElement>
  onPointerCancel?: React.PointerEventHandler<HTMLButtonElement>
  onPointerLeave?: React.PointerEventHandler<HTMLButtonElement>
  /** rail DnD — present on desktop: makes the button a drag source for its tool */
  dragHandle?: { onDragStart: (e: React.DragEvent<HTMLButtonElement>) => void; onDragEnd: () => void }
}) {
  return (
    <button
      onClick={() => {
        if (beforeSelect?.()) return
        onSelect(def.id)
      }}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      draggable={!!dragHandle}
      onDragStart={dragHandle?.onDragStart}
      onDragEnd={dragHandle?.onDragEnd}
      title={`${def.label} (${shortcut ? shortcut.toUpperCase() : '—'})${dragHandle ? ' · drag to rearrange the toolbar' : ''}${hasGroup ? ' · dropdown, long-press, or right-click for related tools' : ''}`}
      aria-label={def.label}
      aria-pressed={active}
      className={cn(
        'relative rounded-sm flex items-center justify-center transition-colors touch-manipulation',
        compact ? 'w-10 h-10' : 'w-10 h-9',
        active
          ? 'bg-accent text-accent-foreground shadow-inner'
          : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground',
        hasGroup && !compact && 'mb-0'
      )}
    >
      <ToolIcon icon={def.icon} toolId={def.id} size={compact ? 15 : 17} />
      {active && <span className={cn('absolute bg-primary', compact ? 'left-0.5 w-0.5 h-6' : 'left-0 w-0.5 h-6')} />}
    </button>
  )
}
