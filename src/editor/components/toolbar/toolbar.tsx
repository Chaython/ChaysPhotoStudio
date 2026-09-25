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

function ToolIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  const Cmp = (Icons as any)[icon] ?? Icons.MousePointer2
  return <Cmp size={size} strokeWidth={1.75} />
}

/** effective toolbar sections: the user's custom layout, else the factory default */
function useToolbarSections(): ToolbarSection[] {
  const layout = useEditorStore(s => s.toolbarLayout)
  return useMemo(
    () => layout ?? defaultToolbarLayout(),
    [layout]
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
              <ToolIcon icon={t.icon} />
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
      <ToolIcon icon={def.icon} size={compact ? 15 : 17} />
      {active && <span className={cn('absolute bg-primary', compact ? 'left-0.5 w-0.5 h-6' : 'left-0 w-0.5 h-6')} />}
    </button>
  )
}
