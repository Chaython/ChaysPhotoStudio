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
import { useMemo, useState } from 'react'
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
            <div className="relative group/tool">
              <ToolButton
                def={main} shortcut={keys[main.id]} active={!!activeInGroup}
                onSelect={selectTool} compact={compact} hasGroup
                dragHandle={dnd ? { onDragStart: itemDragStart(main.id), onDragEnd: endDrag } : undefined}
              />
            </div>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    'text-muted-foreground hover:text-foreground hover:bg-accent rounded-sm transition-colors flex items-center justify-center',
                    compact ? 'w-4 h-10' : 'h-3 w-10'
                  )}
                  aria-label="More tools"
                >
                  <Icons.ChevronRight size={10} className={compact || embedded ? '' : 'rotate-90'} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side={compact || embedded ? 'bottom' : 'right'} align="start" className="z-50">
                {tools.map(t => (
                  <DropdownMenuItem
                    key={t.id}
                    onClick={() => selectTool(t.id)}
                    className="gap-2 text-xs"
                    draggable={dnd}
                    onDragStart={dnd ? itemDragStart(t.id) : undefined}
                    onDragEnd={dnd ? endDrag : undefined}
                    title={dnd ? 'Drag out of the menu onto the toolbar to pin it' : undefined}
                  >
                    <ToolIcon icon={t.icon} />
                    <span className="flex-1">{t.label}</span>
                    <span className="text-muted-foreground font-mono text-[10px]">{formatCombo(keys[t.id])}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      })}
    </div>
  )
}

function ToolButton({ def, shortcut, active, onSelect, compact, hasGroup, dragHandle }: {
  def: ToolDef
  /** live activation key (already reflects user overrides) */
  shortcut: string
  active: boolean
  onSelect: (id: ToolId) => void
  compact?: boolean
  hasGroup?: boolean
  /** rail DnD — present on desktop: makes the button a drag source for its tool */
  dragHandle?: { onDragStart: (e: React.DragEvent<HTMLButtonElement>) => void; onDragEnd: () => void }
}) {
  return (
    <button
      onClick={() => onSelect(def.id)}
      draggable={!!dragHandle}
      onDragStart={dragHandle?.onDragStart}
      onDragEnd={dragHandle?.onDragEnd}
      title={`${def.label} (${shortcut ? shortcut.toUpperCase() : '—'})${dragHandle ? ' · drag to rearrange the toolbar' : ''}`}
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
