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
import { useEditorStore, defaultToolbarLayoutForPreset } from '../../store'
import { formatCombo } from '../../shortcuts'
import type { ToolDef, ToolId, ToolbarSection, ToolbarLayout } from '../../types'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { setActiveTool } from '../../tools/registry'
import { TOOL_CLUSTERS, toolClusterPanelId, type ToolClusterDef } from '../../constants/tool-clusters'
import type { DockSide } from '../../store'
import { beginWindowDrag } from '../panels/window-drag'
import { PanelLayoutContextMenu } from '../panels/panel-layout-menu'
import { insertBefore, moveToGroup, pinToTop } from './layout-ops'
import { ToolIcon } from './tool-icons'

/** Toolbox grid metrics (px). The button is 40px wide; the row gap and the
 *  frame padding are added on top so a multi-column toolbox is never cut off. */
const GRID_CELL_W = 40
const GRID_GAP = 2
const GRID_FRAME = 4


/** effective toolbar layout: the user's custom layout, else the factory default */
function useToolbarLayout(): ToolbarLayout {
  const layout = useEditorStore(s => s.toolbarLayout)
  const preset = useEditorStore(s => s.workspacePreset)
  return useMemo(() => {
    // Handle legacy layout (ToolbarSection[] array)
    if (Array.isArray(layout)) {
      return { mode: 'rail' as const, sections: layout }
    }
    // Handle new layout object
    if (layout && typeof layout === 'object' && 'mode' in layout) {
      return layout as ToolbarLayout
    }
    // No customisation — the template default (multi-column grid for GIMP).
    return defaultToolbarLayoutForPreset(preset)
  }, [layout, preset])
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

export function Toolbar({ compact = false, embedded = false, clusterWindows = false }: { compact?: boolean; embedded?: boolean; clusterWindows?: boolean }) {
  const activeTool = useEditorStore(s => s.activeTool)
  const setTool = useEditorStore(s => s.setTool)
  const setToolbarLayout = useEditorStore(s => s.setToolbarLayout)
  const pushToast = useEditorStore(s => s.pushToast)
  const layout = useToolbarLayout()
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

  const sections = layout.sections
  const isGridMode = layout.mode === 'grid'
  // A toolbox column holds one 40px button; the column gap and the frame
  // padding are added on top so the grid is never clipped.
  const gridColumns = Math.max(1, Math.min(4, layout.gridColumns ?? 2))
  const gridWidth = gridColumns * GRID_CELL_W + (gridColumns - 1) * GRID_GAP + GRID_FRAME * 2

  // ---------- drag & drop (desktop rail only) ----------
  const [dragSrc, setDragSrc] = useState<ToolId | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const dnd = !compact && !isGridMode // Grid mode uses different DnD

  const selectTool = (id: ToolId) => {
    setTool(id)
    setActiveTool(id)
  }

  const readDropId = (e: React.DragEvent): ToolId | null => {
    const id = (e.dataTransfer.getData('text/plain') || dragSrc) as ToolId
    return id && TOOL_MAP[id] ? id : null
  }
  const applyLayout = (next: ToolbarLayout, msg: string) => {
    if (JSON.stringify(next) === JSON.stringify(layout)) return
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
          { ...layout, sections: insertBefore(sections, id, sec.tool) },
          `${TOOL_MAP[id].label} moved before ${TOOL_MAP[sec.tool].label}`
        )
      } else {
        const first = sec.tools[0]
        applyLayout(
          { ...layout, sections: moveToGroup(sections, id, first) },
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
      applyLayout({ ...layout, sections: pinToTop(sections, id) }, `${TOOL_MAP[id].label} pinned to the toolbar`)
      closeFlyoutMenus()
    },
  } : {}

  const dragActive = dnd && !!dragSrc

  // MS Paint ribbon: each cluster is a compact multi-row group. Clusters are
  // first-class window targets — drag the caption, double-click it, or use its
  // pop-out button to float the group; dropping the floating window on any dock
  // docks it there. A moved cluster disappears from the ribbon until returned.
  if (workspacePreset === 'paint' && compact) {
    const shownIds = new Set(TOOL_CLUSTERS.flatMap(group => group.tools))
    const allIds = sections.flatMap(sec => sec.kind === 'single' ? [sec.tool] : sec.tools)
    const moreTools = [...new Set(allIds)].filter(id => !shownIds.has(id)).map(id => TOOL_MAP[id]).filter(Boolean) as ToolDef[]
    return (
      <div
        data-toolbar-mode="paint-ribbon"
        className="flex min-h-[4.5rem] min-w-0 flex-1 shrink-0 flex-wrap items-stretch gap-y-1 bg-panel px-1 py-1"
        role="toolbar"
        aria-label="MS Paint grouped tools ribbon"
      >
        {TOOL_CLUSTERS.map(group => {
          const tools = group.tools.map(id => TOOL_MAP[id]).filter(Boolean) as ToolDef[]
          if (!tools.length) return null
          return (
            <RibbonClusterGroup key={group.id} cluster={group} windows={clusterWindows}>
              <div className="grid content-center gap-x-1 gap-y-0.5" style={{ gridTemplateColumns: `repeat(${group.columns}, minmax(0, 1fr))` }}>
                {tools.map(tool => (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => selectTool(tool.id)}
                    title={`${tool.label}${keys[tool.id] ? ` (${keys[tool.id].toUpperCase()})` : ''}`}
                    aria-label={tool.label}
                    aria-pressed={activeTool === tool.id}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded transition-colors',
                      activeTool === tool.id
                        ? 'bg-primary/15 text-primary ring-1 ring-primary/60'
                        : 'text-foreground/85 hover:bg-accent'
                    )}
                  >
                    <ToolIcon icon={tool.icon} toolId={tool.id} size={16} />
                  </button>
                ))}
              </div>
            </RibbonClusterGroup>
          )
        })}
        <section aria-label="More tools" className="flex shrink-0 flex-col justify-between px-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex h-7 items-center gap-1 rounded px-1.5 text-[10px] text-foreground/85 hover:bg-accent" aria-label="More tools">
                <Icons.Grid3X3 size={15} />
                <span>More</span>
                <Icons.ChevronDown size={11} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="start" className="z-[90] max-h-[70vh] min-w-56 overflow-y-auto">
              {moreTools.map(tool => (
                <DropdownMenuItem key={tool.id} onSelect={() => selectTool(tool.id)} className="gap-2 text-xs">
                  <ToolIcon icon={tool.icon} toolId={tool.id} />
                  <span className="flex-1">{tool.label}</span>
                  {tool.id === activeTool && <Icons.Check size={11} className="text-primary" />}
                  <span className="font-mono text-[10px] text-muted-foreground">{formatCombo(keys[tool.id])}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="border-t border-border/60 pt-0.5 text-center text-[9px] leading-3 text-muted-foreground">More</span>
        </section>
        {clusterWindows && (
          <section aria-label="Toolbox groups" className="flex shrink-0 flex-col items-center justify-between px-1">
            <ToolClusterMenu showLabel />
            <span className="border-t border-border/60 pt-0.5 text-center text-[9px] leading-3 text-muted-foreground">Groups</span>
          </section>
        )}
      </div>
    )
  }

  // Grid mode rendering (GIMP-style toolbox)
  if (isGridMode && !compact) {
    const gridDnd = dnd ? {
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const id = readDropId(e)
        endDrag()
        if (!id) return
        // In grid mode, append to the end of the grid
        const newSection: ToolbarSection = { kind: 'single', tool: id }
        const newSections = [...sections, newSection]
        applyLayout({ ...layout, sections: newSections }, `${TOOL_MAP[id].label} added to toolbox`)
        closeFlyoutMenus()
      },
    } : {}

    // Build grid rows from sections with row/col hints
    const gridRows = new Map<number, Map<number, ToolbarSection>>()
    let maxRow = 0
    sections.forEach((sec, idx) => {
      const row = sec.row ?? Math.floor(idx / gridColumns)
      const col = sec.col ?? (idx % gridColumns)
      maxRow = Math.max(maxRow, row)
      if (!gridRows.has(row)) gridRows.set(row, new Map())
      gridRows.get(row)!.set(col, sec)
    })

    return (
      <div
        {...gridDnd}
        data-toolbar-mode="grid"
        className={cn(
          'flex bg-panel flex-shrink-0 z-20 transition-all flex-col h-full',
          // the embedded GIMP toolbox sits in its own narrow column; the
          // standalone grid gets the usual separator
          embedded ? 'overflow-y-auto overflow-x-hidden' : 'border-r',
          dragActive && 'ring-1 ring-primary/60'
        )}
        style={{ width: gridWidth }}
        role="toolbar"
        aria-label="Tools"
      >
        {Array.from({ length: maxRow + 1 }, (_, rowIdx) => (
          <div key={`row-${rowIdx}`} className="flex flex-row gap-0.5 px-1 py-0.5">
            {Array.from({ length: gridColumns }, (_, colIdx) => {
              const sec = gridRows.get(rowIdx)?.get(colIdx)
              if (!sec) return <div key={`empty-${rowIdx}-${colIdx}`} className="w-10 h-9" />
              const key = sectionKey(sec)
              const hovered = !!hoverKey && hoverKey === key && dragSrc && dragSrc !== key
              if (sec.kind === 'single') {
                const def = TOOL_MAP[sec.tool]
                if (!def) return null
                return (
                  <div key={`${sec.tool}-${rowIdx}-${colIdx}`} className={cn('flex flex-shrink-0 rounded-sm', hovered && 'ring-1 ring-primary/70')}>
                    <ToolButton
                      def={def} shortcut={keys[sec.tool]} active={activeTool === sec.tool}
                      onSelect={selectTool} compact={false}
                      dragHandle={dnd ? { onDragStart: itemDragStart(sec.tool), onDragEnd: endDrag } : undefined}
                    />
                  </div>
                )
              }
              const tools = sec.tools.map(t => TOOL_MAP[t]).filter(Boolean)
              if (tools.length === 1) {
                return (
                  <div key={`${tools[0].id}-${rowIdx}-${colIdx}`} className={cn('flex flex-shrink-0 rounded-sm', hovered && 'ring-1 ring-primary/70')}>
                    <ToolButton
                      def={tools[0]} shortcut={keys[tools[0].id]} active={activeTool === tools[0].id}
                      onSelect={selectTool} compact={false}
                      dragHandle={dnd ? { onDragStart: itemDragStart(tools[0].id), onDragEnd: endDrag } : undefined}
                    />
                  </div>
                )
              }
              if (!tools.length) return null
              const activeInGroup = tools.find(t => t.id === activeTool)
              const main = activeInGroup ?? tools[0]
              return (
                <div key={`grp-${rowIdx}-${colIdx}`} className={cn('flex flex-shrink-0 rounded-sm', hovered && 'ring-1 ring-primary/70')}>
                  <ToolGroupButton
                    tools={tools}
                    main={main}
                    active={!!activeInGroup}
                    activeTool={activeTool}
                    keys={keys}
                    onSelect={selectTool}
                    compact={false}
                    embedded={false}
                    dnd={dnd}
                    itemDragStart={itemDragStart}
                    endDrag={endDrag}
                  />
                </div>
              )
            })}
          </div>
        ))}
        {!compact && (
          <div className="mt-auto flex items-center justify-center border-t border-border/60 px-1 py-1" aria-label="Toolbox groups">
            <ToolClusterMenu />
          </div>
        )}
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

  // Rail mode rendering (original vertical/horizontal rail)
  return (
    <div
      {...railDnd}
      data-toolbar-mode="rail"
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
      {!compact && (
        <div className="mt-auto flex items-center justify-center border-t border-border/40 p-1" aria-label="Toolbox groups">
          <ToolClusterMenu />
        </div>
      )}
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

/** One ribbon cluster. The caption is a pull handle: drag it to float the
 *  cluster, double-click it to pop it out, or use the small pop-out button.
 *  While a cluster is floating or explicitly docked its ribbon slot is removed
 *  so the same tools cannot be shown twice. Touch layouts pass windows={false}
 *  because floating windows are desktop-only. */
function RibbonClusterGroup({
  cluster,
  children,
  windows,
}: {
  cluster: ToolClusterDef
  children: React.ReactNode
  windows: boolean
}) {
  const id = toolClusterPanelId(cluster.id)
  const floating = useEditorStore(s => !!s.panels.floating[id])
  const dockSide = useEditorStore(s => s.panels.dockSide[id])
  const panelsLocked = useEditorStore(s => s.workspaceLayoutLocks[s.workspacePreset].panels)
  const pull = useRef<{ x: number; y: number; handed: boolean } | null>(null)

  if (windows && (floating || dockSide)) return null

  if (!windows) {
    return (
      <section
        data-tool-cluster={cluster.id}
        aria-label={`${cluster.label} tools`}
        className="flex shrink-0 flex-col border-r border-border/70 px-1.5 first:pl-1 last:border-r-0"
      >
        <div className="flex min-h-[3.25rem] flex-1 items-center justify-center">{children}</div>
        <span className="whitespace-nowrap border-t border-border/60 pt-0.5 text-center text-[9px] leading-3 text-muted-foreground">{cluster.label}</span>
      </section>
    )
  }

  const popOut = () => {
    if (panelsLocked) return
    useEditorStore.getState().floatPanel(id, cluster.defaultFloat)
  }
  const onDown = (e: React.PointerEvent<HTMLElement>) => {
    if (panelsLocked || e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    pull.current = { x: e.clientX, y: e.clientY, handed: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = pull.current
    if (!d || d.handed || panelsLocked) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 12) {
      d.handed = true
      beginWindowDrag(id, e, { defaultFloat: cluster.defaultFloat, home: true })
    }
  }
  const onUp = () => { pull.current = null }

  return (
    <PanelLayoutContextMenu
      id={id}
      label={`${cluster.label} tools`}
      hasHome
      defaultFloat={cluster.defaultFloat}
    >
      <section
        data-tool-cluster={cluster.id}
        aria-label={`${cluster.label} tools`}
        className="group/cluster flex shrink-0 flex-col border-r border-border/70 px-1.5 first:pl-1 last:border-r-0"
      >
        <div className="flex min-h-[3.25rem] flex-1 items-center justify-center">{children}</div>
        <div
          className={cn(
            'flex items-center justify-center gap-0.5 border-t border-border/60 pt-0.5',
            panelsLocked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
          )}
          title={panelsLocked
            ? `${cluster.label} — toolbox groups are locked in this workspace`
            : `${cluster.label} — drag or double-click to float · right-click for dock options`}
          onDoubleClick={event => {
            if ((event.target as HTMLElement).closest('button')) return
            popOut()
          }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <Icons.GripVertical size={8} className="shrink-0 opacity-35 transition-opacity group-hover/cluster:opacity-80" aria-hidden />
          <span className="whitespace-nowrap text-center text-[9px] leading-3 text-muted-foreground">{cluster.label}</span>
          <button
            type="button"
            disabled={panelsLocked}
            onClick={event => { event.stopPropagation(); popOut() }}
            className="rounded p-0.5 text-muted-foreground opacity-40 transition-opacity hover:bg-accent hover:text-primary focus-visible:opacity-100 group-hover/cluster:opacity-100 disabled:hidden"
            title={`Float ${cluster.label} tools`}
            aria-label={`Float ${cluster.label} tools`}
          >
            <Icons.PanelTopOpen size={9} />
          </button>
        </div>
      </section>
    </PanelLayoutContextMenu>
  )
}

const DOCK_SIDE_LABELS: Record<DockSide, string> = {
  left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom',
  'top-left': 'Top left', 'top-right': 'Top right',
  'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right',
}

/** Pop-out / dock / return menu for every toolbox cluster in every workspace. */
export function ToolClusterMenu({ showLabel = false }: { showLabel?: boolean }) {
  const workspacePreset = useEditorStore(s => s.workspacePreset)
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const panelsLocked = useEditorStore(s => s.workspaceLayoutLocks[s.workspacePreset].panels)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-7 items-center justify-center gap-1 rounded px-1.5 text-[10px] text-foreground/85 hover:bg-accent disabled:opacity-40"
          title={panelsLocked ? 'Toolbox groups are locked in this workspace' : 'Float, dock or return toolbox groups'}
          aria-label="Toolbox groups"
        >
          <Icons.LayoutGrid size={15} />
          {showLabel && <span>Groups</span>}
          <Icons.ChevronDown size={11} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="z-[95] min-w-60">
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground select-none">
          Toolbox groups
        </div>
        {TOOL_CLUSTERS.map(cluster => {
          const id = toolClusterPanelId(cluster.id)
          const docked = floating[id] ? null : dockSide[id]
          const status = floating[id] ? 'Floating'
            : docked ? DOCK_SIDE_LABELS[docked]
            : workspacePreset === 'paint' ? 'Ribbon' : 'Hidden'
          const Icon = (Icons as unknown as Record<string, React.ComponentType<{ size?: number }>>)[cluster.icon] ?? Icons.LayoutGrid
          return (
            <DropdownMenuSub key={cluster.id}>
              <DropdownMenuSubTrigger className="gap-2 text-xs">
                <Icon size={13} />
                <span className="flex-1">{cluster.label}</span>
                <span className={cn(
                  'rounded border px-1 py-px text-[9px]',
                  status === 'Floating' || status === 'Ribbon'
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground',
                )}>{status}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="z-[100] min-w-44">
                <DropdownMenuItem
                  disabled={panelsLocked}
                  className="gap-2 text-xs"
                  onSelect={() => useEditorStore.getState().floatPanel(id, cluster.defaultFloat)}
                >
                  <Icons.Maximize2 size={13} />
                  <span>Float group</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {(['left', 'right', 'top', 'bottom'] as const).map(side => (
                  <DropdownMenuItem
                    key={side}
                    disabled={panelsLocked}
                    className="gap-2 text-xs"
                    onSelect={() => useEditorStore.getState().dockPanel(id, side)}
                  >
                    <Icons.PanelRight size={13} className={side === 'left' ? 'rotate-180' : side === 'top' ? '-rotate-90' : side === 'bottom' ? 'rotate-90' : undefined} />
                    <span>Dock {side}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={panelsLocked || (!floating[id] && !docked)}
                  className="gap-2 text-xs"
                  onSelect={() => useEditorStore.getState().homePanel(id)}
                >
                  <Icons.RotateCcw size={13} />
                  <span>{workspacePreset === 'paint' ? 'Return to ribbon' : 'Hide group'}</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const TOOL_LONG_PRESS_MS = 450
const TOOL_LONG_PRESS_MOVE_PX = 8

function ToolGroupButton({
  tools, main, active, activeTool, keys, onSelect, compact, ribbon = false, embedded, dnd, itemDragStart, endDrag,
}: {
  tools: ToolDef[]
  main: ToolDef
  active: boolean
  activeTool: ToolId
  keys: Record<ToolId, string>
  onSelect: (id: ToolId) => void
  compact: boolean
  ribbon?: boolean
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
        ribbon={ribbon}
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
  def, shortcut, active, onSelect, compact, ribbon = false, hasGroup, dragHandle, beforeSelect,
  onContextMenu, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave,
}: {
  def: ToolDef
  /** live activation key (already reflects user overrides) */
  shortcut: string
  active: boolean
  onSelect: (id: ToolId) => void
  compact?: boolean
  ribbon?: boolean
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
        ribbon ? 'h-7 w-7' : compact ? 'w-10 h-10' : 'w-10 h-9',
        active
          ? 'bg-accent text-accent-foreground shadow-inner'
          : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground',
        hasGroup && !compact && 'mb-0'
      )}
    >
      <ToolIcon icon={def.icon} toolId={def.id} size={ribbon ? 14 : compact ? 15 : 17} />
      {active && <span className={cn('absolute bg-primary', compact ? 'left-0.5 w-0.5 h-6' : 'left-0 w-0.5 h-6')} />}
    </button>
  )
}
