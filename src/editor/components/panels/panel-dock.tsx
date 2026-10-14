'use client'
// Fully modular left/right panel docks. Every registered panel can live in
// either dock, the top strip, or a floating window. No panel has bespoke dock
// chrome: tabs, actions, dragging, sizing and persistence are shared.
import { useEffect, useRef, useState } from 'react'
import { PanelLeft, PanelLeftClose, PanelRightClose, PanelRightOpen, Plus, RotateCcw } from 'lucide-react'
import { useEditorStore, PHOTOSHOP_INSPECTOR_UPPER_TABS, PHOTOSHOP_INSPECTOR_LOWER_TABS } from '../../store'
import { PANEL_MAP, PANELS } from './panel-registry'
import { autoSideDockWidth } from './auto-dock-sizing'
import { PanelContextMenu } from './panel-actions-menu'
import { beginWindowDrag, DOCK_DROP_EVENT } from './floating-panels'
import { cn } from '@/lib/utils'
import { engine } from '../../engine/engine'
import { resolvePanelDockSide } from './dock-resolution'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const PULL_THRESHOLD = 14
const EMPTY_DOCK_HIDE_DELAY = 650

export type DockTabSide = 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

interface PullDrag {
  id: string
  x: number
  y: number
  handedOff: boolean
}

export function useDockDrop(side: DockTabSide, mobile: boolean): boolean {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const onDropEvt = (e: Event) => {
      const d = (e as CustomEvent).detail
      setActive(!!(d?.active && d?.side === side))
    }
    window.addEventListener(DOCK_DROP_EVENT, onDropEvt as EventListener)
    return () => window.removeEventListener(DOCK_DROP_EVENT, onDropEvt as EventListener)
  }, [side])
  return active && !mobile
}

/** Move any panel to this dock. The badge always reflects its actual location. */
export function AddPanelMenu({ side, mobile }: { side: DockTabSide; mobile: boolean }) {
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  if (mobile) return null

  const sideLabel: Record<string, string> = { left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom', 'top-left': 'Top left', 'top-right': 'Top right', 'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right', Window: 'Window', Home: 'Home' }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors flex-shrink-0"
          title={`Arrange panels — move panels into the ${side.includes('top') || side.includes('bottom') ? side.replaceAll('-', ' ') + ' strip' : side + ' dock'}`}
          aria-label={`Arrange panels for the ${side === 'top' ? 'top strip' : side + ' dock'}`}
        >
          <Plus size={13} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align={side === 'left' ? 'start' : 'end'} className="z-50 min-w-48 max-h-[70vh] overflow-y-auto">
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground select-none">
          Move to {side.includes('top') || side.includes('bottom') ? `${side.replaceAll('-', ' ')} strip` : `${side} dock`}
        </div>
        {PANELS.map(p => {
          const at = floating[p.id] ? 'Window' : (dockSide[p.id] ?? (p.home ? 'Home' : 'right'))
          const Icon = p.icon
          return (
            <DropdownMenuItem
              key={p.id}
              onClick={() => useEditorStore.getState().dockPanel(p.id, side)}
              className="gap-2 text-xs"
            >
              <Icon size={13} />
              <span className="flex-1">{p.label}</span>
              <span className={cn(
                'text-[9px] px-1 py-px rounded border',
                at === side ? 'text-primary border-primary/40 bg-primary/10' : 'text-muted-foreground border-border',
              )}>
                {sideLabel[at] ?? at}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function resolvedDockSide(id: string, dockSide: Record<string, string>) {
  return resolvePanelDockSide(id, dockSide, !!PANEL_MAP[id]?.home)
}

function dockedPanels(side: 'left' | 'right', floating: Record<string, unknown>, dockSide: Record<string, string>) {
  return PANELS.filter(p => !floating[p.id] && resolvedDockSide(p.id, dockSide) === side)
}

function useDelayedDockPresence(hasPanels: boolean, delay = EMPTY_DOCK_HIDE_DELAY): boolean {
  const [visible, setVisible] = useState(hasPanels)
  useEffect(() => {
    // Use the timer callback for both transitions: showing remains effectively
    // immediate, while an emptied dock gets a short grace period before hiding.
    const timer = window.setTimeout(() => setVisible(hasPanels), hasPanels ? 0 : delay)
    return () => window.clearTimeout(timer)
  }, [hasPanels, delay])
  return visible
}

function DockTabs({ side, mobile, extra }: {
  side: 'left' | 'right'
  mobile: boolean
  extra?: React.ReactNode
}) {
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const activeTab = useEditorStore(s => side === 'left' ? s.panels.leftTab : s.panels.rightTab)
  const setTabLeft = useEditorStore(s => s.setLeftPanelTab)
  const setTabRight = useEditorStore(s => s.setRightPanelTab)
  const setTab = side === 'left' ? setTabLeft : setTabRight

  // Mobile uses the right drawer as a universal panel browser so a desktop
  // layout cannot strand left/top panels on a small screen.
  const tabs = mobile
    ? PANELS.filter(p => !floating[p.id])
    : dockedPanels(side, floating, dockSide)

  const pullDrag = useRef<PullDrag | null>(null)
  const suppressClick = useRef(false)

  const onPullDown = (id: string) => (e: React.PointerEvent<HTMLElement>) => {
    if (mobile || e.button !== 0 || (e.buttons & 1) === 0) { pullDrag.current = null; return }
    suppressClick.current = false
    pullDrag.current = { id, x: e.clientX, y: e.clientY, handedOff: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPullMove = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.buttons & 1) === 0) { pullDrag.current = null; return }
    const d = pullDrag.current
    if (!d || d.handedOff) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > PULL_THRESHOLD) {
      d.handedOff = true
      suppressClick.current = true
      beginWindowDrag(d.id, e)
    }
  }

  const onPullUp = () => { pullDrag.current = null }

  return (
    <div className="flex border-b overflow-x-auto flex-shrink-0 zphoto-scroll" role="tablist" aria-label={`${side} dock panel tabs`}>
      {tabs.length === 0 ? (
        <div className="flex-1 h-8 flex items-center justify-center text-[10px] text-muted-foreground select-none">
          No panels — use + or drop a floating panel here
        </div>
      ) : tabs.map(t => {
        const Icon = t.icon
        const tabButton = (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            title={mobile ? t.label : `${t.label} — drag/double-click to float · right-click for panel options`}
            className={cn(
              'flex-1 min-w-8 h-8 flex items-center justify-center relative',
              activeTab === t.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              !mobile && 'cursor-grab active:cursor-grabbing',
            )}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false
                return
              }
              setTab(t.id)
            }}
            onDoubleClick={() => !mobile && useEditorStore.getState().floatPanel(t.id, t.defaultFloat)}
            onPointerDown={onPullDown(t.id)}
            onPointerMove={onPullMove}
            onPointerUp={onPullUp}
            onPointerCancel={onPullUp}
          >
            <Icon size={14} />
            {activeTab === t.id && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-t" />}
          </button>
        )
        return mobile ? tabButton : <PanelContextMenu key={t.id} id={t.id}>{tabButton}</PanelContextMenu>
      })}
      <div className="flex items-center flex-shrink-0">
        {extra}
        <AddPanelMenu side={side} mobile={mobile} />
      </div>
    </div>
  )
}

function DockPanelHeader({ id, mobile }: { id: string; mobile: boolean }) {
  const def = PANEL_MAP[id]
  if (!def) return null
  const Icon = def.icon
  const header = (
    <div
      className="h-7 px-2 flex items-center gap-1.5 border-b bg-panel/80 flex-shrink-0"
      title={mobile ? def.label : `${def.label} — right-click for panel options`}
    >
      <Icon size={11} className="text-primary shrink-0" />
      <span className="text-[11px] font-medium truncate flex-1">{def.label}</span>
    </div>
  )
  return mobile ? header : <PanelContextMenu id={id}>{header}</PanelContextMenu>
}

function WidthDivider({ side, width, onWidth, onReset }: {
  side: 'left' | 'right'
  width: number
  onWidth: (px: number) => void
  onReset: () => void
}) {
  const [active, setActive] = useState(false)
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const rafId = useRef(0)
  const pending = useRef<number | null>(null)

  useEffect(() => () => {
    if (rafId.current) cancelAnimationFrame(rafId.current)
  }, [])

  const sign = side === 'left' ? 1 : -1
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startWidth: e.currentTarget.parentElement?.getBoundingClientRect().width || width }
    setActive(true)
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    pending.current = d.startWidth + sign * (e.clientX - d.startX)
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0
        if (pending.current !== null) { const next = pending.current; pending.current = null; onWidth(next) }
      })
    }
  }
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = 0 }
    if (pending.current !== null) { const next = pending.current; pending.current = null; onWidth(next) }
    setActive(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} panel dock`}
      title="Drag to resize dock · double-click to fit panel automatically"
      className={cn(
        side === 'left'
          ? 'absolute right-0 top-0 bottom-0 -mr-[3px] w-[6px]'
          : 'absolute left-0 top-0 bottom-0 -ml-[3px] w-[6px]',
        'z-20 cursor-col-resize touch-none transition-colors hover:bg-primary/40',
        active ? 'bg-primary/60' : 'bg-transparent',
      )}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => {
        if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = 0 }
        pending.current = null
        onReset()
      }}
    />
  )
}

function DropOverlay({ side }: { side: 'left' | 'right' }) {
  return (
    <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
      <div className="px-3 py-1.5 rounded-md bg-primary/15 border border-primary/50 text-primary text-[11px] font-medium shadow-lg">
        Drop to dock {side}
      </div>
    </div>
  )
}

/** A Photoshop-inspired essentials inspector using the actual registered panels.
 * The upper/lower stacks are independently selectable and resize with a
 * keyboard-accessible splitter; floating/dock moves still use the shared store.
 */
const PHOTOSHOP_UPPER_TABS: readonly string[] = PHOTOSHOP_INSPECTOR_UPPER_TABS
const PHOTOSHOP_LOWER_TABS: readonly string[] = PHOTOSHOP_INSPECTOR_LOWER_TABS
const PHOTOSHOP_TAB_MIME = 'application/x-zphoto-inspector-tab'
const clampInspectorSplit = (value: number) => Math.max(22, Math.min(70, value))

function PhotoshopRightDock() {
  const inspector = useEditorStore(s => s.panels.photoshopInspector)
  const setInspector = useEditorStore(s => s.setPhotoshopInspector)
  const { upperTab: upperSelection, lowerTab: lowerSelection, upperTabs, lowerTabs, upperPercent, collapsed } = inspector
  const moveInspectorTab = useEditorStore(s => s.movePhotoshopInspectorTab)
  const resizing = useRef(false)
  const rightTab = useEditorStore(s => s.panels.rightTab)
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const savedWidth = useEditorStore(s => s.panels.dockWidth)
  const widthManual = useEditorStore(s => s.panels.dockWidthManual)
  const width = widthManual ? savedWidth : Math.max(300,
    autoSideDockWidth(PANEL_MAP[upperSelection], true), autoSideDockWidth(PANEL_MAP[lowerSelection], true))
  const setWidth = useEditorStore(s => s.setDockWidth)
  const resetWidth = useEditorStore(s => s.resetDockWidthAuto)
  const hasDoc = useEditorStore(s => !!s.activeDocId)
  const dropActive = useDockDrop('right', false)
  // Keep both groups' selected tabs when clicking the other group, while
  // honouring an externally selected Window-menu panel.
  const isUpper = upperTabs.includes(rightTab)
  const upper = isUpper ? rightTab : upperSelection
  const lower = !isUpper && PANEL_MAP[rightTab] ? rightTab : lowerSelection
  const visibleLowerTabs = lowerTabs.includes(lower) ? lowerTabs : [...lowerTabs, lower]
  const selectUpper = (id: string) => { setInspector({ upperTab: id, collapsed: false }); useEditorStore.getState().setRightPanelTab(id) }
  const selectLower = (id: string) => { setInspector({ lowerTab: id, collapsed: false }); useEditorStore.getState().setRightPanelTab(id) }

  // Drag tabs within a stack or into the other inspector stack. Alt+arrows
  // provide the same actions without a pointer.
  const tabs = (ids: readonly string[], active: string, choose: (id: string) => void,
    label: string, group: 'upper' | 'lower') => (
    <div className="flex h-8 shrink-0 overflow-x-auto border-b border-border/70 bg-panel zphoto-scroll"
      role="tablist" aria-label={label} data-inspector-tabs={group}
      onDragOver={e => { if (e.dataTransfer.types.includes(PHOTOSHOP_TAB_MIME)) e.preventDefault() }}
      onDrop={e => {
        const id = e.dataTransfer.getData(PHOTOSHOP_TAB_MIME)
        if (!id) return
        e.preventDefault()
        moveInspectorTab(id, group)
      }}>
      {ids.map((id, index) => {
        const def = PANEL_MAP[id]
        if (!def) return null
        const Icon = def.icon
        const relocated = !!floating[id] || (dockSide[id] != null && dockSide[id] !== 'right')
        return (
          <PanelContextMenu key={id} id={id}>
            <button type="button" role="tab" draggable data-inspector-tab={id}
              aria-selected={active === id}
              title={def.label + (relocated ? ' (arranged elsewhere)' : ' — drag to reorder or change stack; Alt+arrows to move; double-click to float')}
              className={cn('relative flex shrink-0 items-center gap-1 px-2 text-[10px] border-r border-border/40 cursor-grab active:cursor-grabbing',
                active === id ? 'text-foreground bg-background font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
              onClick={() => choose(id)}
              onDoubleClick={() => useEditorStore.getState().floatPanel(id, def.defaultFloat)}
              onDragStart={e => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData(PHOTOSHOP_TAB_MIME, id)
                e.dataTransfer.setData('text/plain', id)
              }}
              onDragOver={e => { if (e.dataTransfer.types.includes(PHOTOSHOP_TAB_MIME)) e.preventDefault() }}
              onDrop={e => {
                const dragged = e.dataTransfer.getData(PHOTOSHOP_TAB_MIME)
                if (!dragged) return
                e.preventDefault()
                if (dragged === id) { e.stopPropagation(); return }
                e.stopPropagation()
                moveInspectorTab(dragged, group, id)
              }}
              onKeyDown={e => {
                if (!e.altKey) return
                // React may reparent the tab when changing stacks; keep the
                // keyboard user's focus on the same tab after its move.
                const restoreFocus = () => requestAnimationFrame(() => {
                  document.querySelector<HTMLButtonElement>(`[data-inspector-tab="${id}"]`)?.focus()
                })
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault()
                  const destination = e.key === 'ArrowUp' ? 'upper' : 'lower'
                  moveInspectorTab(id, destination)
                  restoreFocus()
                } else if (e.key === 'ArrowLeft' && index > 0) {
                  e.preventDefault()
                  moveInspectorTab(id, group, ids[index - 1])
                  restoreFocus()
                } else if (e.key === 'ArrowRight' && index < ids.length - 1) {
                  e.preventDefault()
                  moveInspectorTab(id, group, ids[index + 2])
                  restoreFocus()
                }
              }}>
              <Icon size={12} aria-hidden /><span>{def.label}</span>
            </button>
          </PanelContextMenu>
        )
      })}
    </div>
  )
  const content = (id: string) => {
    const def = PANEL_MAP[id]
    if (!def) return null
    if (floating[id] || (dockSide[id] && dockSide[id] !== 'right')) return (
      <div className="flex-1 flex flex-col justify-center items-center gap-2 p-3 text-center text-xs text-muted-foreground">
        {def.label} was moved to another dock.
        <button type="button" className="text-primary underline"
          onClick={() => useEditorStore.getState().dockPanel(id, 'right')}>Return panel here</button>
      </div>)
    if (!hasDoc && !def.home) return <div className="p-3 text-[11px] text-muted-foreground">Open an image to use {def.label}.</div>
    const Content = def.render
    return <Content />
  }

  if (collapsed) return (
    <aside data-panel-dock="right" data-photoshop-dock="true" data-photoshop-collapsed="true"
      data-drop-active={dropActive ? '1' : undefined}
      className="relative hidden md:flex w-9 shrink-0 min-h-0 overflow-y-auto zphoto-scroll flex-col items-center gap-1 border-l bg-panel py-1 panel-dock-drop"
      aria-label="Collapsed Photoshop inspector">
      <button type="button" className="h-8 w-8 shrink-0 flex items-center justify-center hover:bg-accent"
        title="Expand inspector" aria-label="Expand Photoshop inspector" onClick={() => setInspector({ collapsed: false })}>
        <PanelRightOpen size={16} />
      </button>
      {[...upperTabs, ...lowerTabs].map(id => {
        const def = PANEL_MAP[id]
        if (!def) return null
        const Icon = def.icon
        return <button type="button" key={id} className="h-8 w-8 shrink-0 flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground"
          title={def.label} aria-label={'Show ' + def.label + ' panel'}
          onClick={() => { if (PHOTOSHOP_UPPER_TABS.includes(id)) selectUpper(id); else selectLower(id); setInspector({ collapsed: false }) }}>
          <Icon size={15} />
        </button>
      })}
      {dropActive && <DropOverlay side="right" />}
    </aside>
  )

  const onSplitPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    resizing.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onSplitPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing.current) return
    const bounds = e.currentTarget.parentElement?.getBoundingClientRect()
    if (!bounds) return
    const available = Math.max(1, bounds.height - 28)
    setInspector({ upperPercent: clampInspectorSplit(Math.round(100 * (e.clientY - bounds.top - 28) / available)) })
  }
  const onSplitPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    resizing.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  return (
    <aside data-panel-dock="right" data-photoshop-dock="true" data-drop-active={dropActive ? '1' : undefined}
      className="relative hidden md:flex shrink-0 min-h-0 flex-col border-l border-border bg-panel panel-dock-drop"
      style={{ width }} aria-label="Photoshop-style inspector panels">
      <WidthDivider side="right" width={width} onWidth={setWidth} onReset={resetWidth} />
      <div className="h-7 shrink-0 pl-2 border-b flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Essentials</span>
        <div className="flex items-center">
          <AddPanelMenu side="right" mobile={false} />
          <button type="button" className="h-7 w-7 flex items-center justify-center hover:bg-accent"
            title="Restore the default Photoshop inspector tab groups"
            aria-label="Reset Photoshop inspector tab groups"
            onClick={() => setInspector({
              upperTabs: [...PHOTOSHOP_UPPER_TABS], lowerTabs: [...PHOTOSHOP_LOWER_TABS],
              upperTab: 'color', lowerTab: 'layers',
            })}><RotateCcw size={12}/></button>
          <button type="button" className="h-7 w-7 flex items-center justify-center hover:bg-accent"
            title="Collapse inspector to icons" aria-label="Collapse Photoshop inspector"
            onClick={() => setInspector({ collapsed: true })}><PanelRightClose size={13} /></button>
        </div>
      </div>
      <section data-photoshop-stack="upper" className="flex min-h-0 flex-col"
        style={{ flex: '0 0 ' + upperPercent + '%' }}>
        {tabs(upperTabs, upper, selectUpper, 'Upper inspector panel tabs', 'upper')}
        <div className="flex flex-1 min-h-0 flex-col overflow-auto zphoto-scroll">{content(upper)}</div>
      </section>
      <div role="separator" tabIndex={0} aria-label="Resize Photoshop inspector groups"
        aria-orientation="horizontal" aria-valuemin={22} aria-valuemax={70} aria-valuenow={upperPercent}
        title="Drag to resize upper and lower panels; arrow keys resize"
        className="h-2 shrink-0 flex items-center cursor-row-resize touch-none border-y border-border/60 bg-panel hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary"
        onPointerDown={onSplitPointerDown} onPointerMove={onSplitPointerMove}
        onPointerUp={onSplitPointerUp} onPointerCancel={onSplitPointerUp}
        onDoubleClick={() => setInspector({ upperPercent: 40 })}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setInspector({ upperPercent: clampInspectorSplit(upperPercent + (e.key === 'ArrowDown' ? 5 : -5)) })
          } else if (e.key === 'Home') { e.preventDefault(); setInspector({ upperPercent: 22 }) }
          else if (e.key === 'End') { e.preventDefault(); setInspector({ upperPercent: 70 }) }
        }}>
        <span aria-hidden className="mx-auto h-px w-9 bg-muted-foreground/60" />
      </div>
      <section data-photoshop-stack="lower" className="flex min-h-0 flex-1 flex-col">
        {tabs(visibleLowerTabs, lower, selectLower, 'Lower inspector panel tabs', 'lower')}
        <div className="flex-1 flex min-h-0 flex-col overflow-auto zphoto-scroll">{content(lower)}</div>
      </section>
      {dropActive && <DropOverlay side="right" />}
    </aside>
  )
}

export function PanelDock({ mobile = false }: { mobile?: boolean }) {
  const workspacePreset = useEditorStore(s => s.workspacePreset)
  const rightTab = useEditorStore(s => s.panels.rightTab)
  const setTab = useEditorStore(s => s.setRightPanelTab)
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const savedDockWidth = useEditorStore(s => s.panels.dockWidth)
  const dockWidthManual = useEditorStore(s => s.panels.dockWidthManual)
  const setDockWidth = useEditorStore(s => s.setDockWidth)
  const resetDockWidthAuto = useEditorStore(s => s.resetDockWidthAuto)
  const resetLayout = useEditorStore(s => s.resetPanelLayout)
  const hasDoc = useEditorStore(s => !!s.activeDocId)
  const dropActive = useDockDrop('right', mobile)
  const rightCount = mobile ? PANELS.length : dockedPanels('right', floating, dockSide).length
  const dockVisible = useDelayedDockPresence(mobile || rightCount > 0)

  const activePanel = PANEL_MAP[rightTab]
  const dockWidth = dockWidthManual ? savedDockWidth : autoSideDockWidth(activePanel)
  const activeHere = !!activePanel && !floating[rightTab] && (mobile || resolvedDockSide(rightTab, dockSide) === 'right')
  const ActiveContent = activeHere ? activePanel.render : null

  useEffect(() => {
    const valid = !!PANEL_MAP[rightTab] && !floating[rightTab] && (mobile || resolvedDockSide(rightTab, dockSide) === 'right')
    if (valid) return
    const first = mobile
      ? PANELS.find(p => !floating[p.id])
      : dockedPanels('right', floating, dockSide)[0]
    const healed = first?.id ?? ''
    if (healed !== rightTab) setTab(healed)
  }, [rightTab, floating, dockSide, mobile, setTab])

  if (!mobile && workspacePreset === 'photoshop') return <PhotoshopRightDock />
  if (!mobile && !dockVisible) return null

  return (
    <aside
      data-panel-dock={mobile ? undefined : 'right'}
      data-drop-active={dropActive ? '1' : undefined}
      className={cn(
        'bg-panel border-l flex flex-col flex-shrink-0 min-h-0 relative panel-dock-drop',
        mobile ? 'w-full' : 'hidden md:flex',
      )}
      style={mobile ? undefined : { width: dockWidth }}
      aria-label="Panels"
    >
      {!mobile && (
        <WidthDivider
          side="right"
          width={dockWidth}
          onWidth={setDockWidth}
          onReset={resetDockWidthAuto}
        />
      )}

      <DockTabs side="right" mobile={mobile} />
      {activePanel && <DockPanelHeader id={activePanel.id} mobile={mobile} />}

      <div className="flex-1 min-h-0 flex flex-col">
        {!hasDoc && !activePanel?.home ? (
          <div className="p-4 text-[11px] text-muted-foreground text-center leading-relaxed">
            Open an image or create a document to start editing.
          </div>
        ) : ActiveContent ? (
          <ActiveContent />
        ) : activePanel ? (
          <div className="flex-1 flex items-center justify-center px-4 text-center text-[10px] text-muted-foreground">
            {activePanel.label} is arranged elsewhere. Use its panel menu or the + menu to bring it here.
          </div>
        ) : null}
      </div>

      <div className="h-6 px-2 flex items-center gap-1 text-[9px] text-muted-foreground border-t flex-shrink-0">
        <span className="truncate flex-1">{engine.docs.length} doc(s) · engine ready</span>
        {!mobile && (
          <button
            className="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Reset panel layout"
            aria-label="Reset panel layout"
            onClick={() => resetLayout()}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>

      {dropActive && <DropOverlay side="right" />}
    </aside>
  )
}

export function LeftDock() {
  const leftOpen = useEditorStore(s => s.panels.leftOpen)
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const count = dockedPanels('left', floating, dockSide).length
  const visible = useDelayedDockPresence(count > 0)

  if (!visible) return null
  return leftOpen ? <LeftDockOpen /> : <LeftRail />
}

function LeftRail() {
  const setLeftDockOpen = useEditorStore(s => s.setLeftDockOpen)
  const dropActive = useDockDrop('left', false)
  const leftCount = useLeftDockCount()

  return (
    <div
      data-panel-dock="left"
      data-drop-active={dropActive ? '1' : undefined}
      className="hidden md:flex w-9 bg-panel border-r flex-col items-center pt-1.5 gap-1 flex-shrink-0 relative panel-dock-drop"
      aria-label="Left panel dock (closed)"
    >
      <button
        type="button"
        className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        onClick={() => setLeftDockOpen(true)}
        title="Open left panel dock"
        aria-label="Open left panel dock"
      >
        <PanelLeft size={15} />
      </button>
      {leftCount > 0 && (
        <div
          className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[9px] flex items-center justify-center border border-primary/40"
          title={`${leftCount} panel(s) docked left`}
        >
          {leftCount}
        </div>
      )}
      {dropActive && <DropOverlay side="left" />}
    </div>
  )
}

function LeftDockOpen() {
  const leftTab = useEditorStore(s => s.panels.leftTab)
  const savedLeftWidth = useEditorStore(s => s.panels.leftWidth)
  const leftWidthManual = useEditorStore(s => s.panels.leftWidthManual)
  const setLeftDockWidth = useEditorStore(s => s.setLeftDockWidth)
  const resetLeftDockWidthAuto = useEditorStore(s => s.resetLeftDockWidthAuto)
  const setLeftDockOpen = useEditorStore(s => s.setLeftDockOpen)
  const setTab = useEditorStore(s => s.setLeftPanelTab)
  const hasDoc = useEditorStore(s => !!s.activeDocId)
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const dropActive = useDockDrop('left', false)

  const activePanel = PANEL_MAP[leftTab]
  const leftWidth = leftWidthManual ? savedLeftWidth : autoSideDockWidth(activePanel)
  const ActiveContent = activePanel && !floating[leftTab] && resolvedDockSide(leftTab, dockSide) === 'left'
    ? activePanel.render
    : null

  useEffect(() => {
    const valid = !!PANEL_MAP[leftTab] && !floating[leftTab] && resolvedDockSide(leftTab, dockSide) === 'left'
    if (valid) return
    const first = dockedPanels('left', floating, dockSide)[0]
    const healed = first?.id ?? ''
    if (healed !== leftTab) setTab(healed)
  }, [leftTab, floating, dockSide, setTab])

  return (
    <aside
      data-panel-dock="left"
      data-drop-active={dropActive ? '1' : undefined}
      className="hidden md:flex bg-panel border-r flex flex-col flex-shrink-0 min-h-0 relative panel-dock-drop"
      style={{ width: leftWidth }}
      aria-label="Left panels"
    >
      <WidthDivider
        side="left"
        width={leftWidth}
        onWidth={setLeftDockWidth}
        onReset={resetLeftDockWidthAuto}
      />

      <DockTabs
        side="left"
        mobile={false}
        extra={
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            onClick={() => setLeftDockOpen(false)}
            title="Collapse left dock to a rail"
            aria-label="Collapse left dock to a rail"
          >
            <PanelLeftClose size={13} />
          </button>
        }
      />
      {activePanel && <DockPanelHeader id={activePanel.id} mobile={false} />}

      <div className="flex-1 min-h-0 flex flex-col">
        {ActiveContent ? (
          hasDoc || activePanel?.home ? <ActiveContent /> : (
            <div className="p-4 text-[11px] text-muted-foreground text-center leading-relaxed">
              Open an image or create a document to start editing.
            </div>
          )
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center text-[10px] text-muted-foreground leading-relaxed">
            <PanelLeft size={18} className="text-muted-foreground/60" aria-hidden />
            <p>Drop a floating panel here,<br />or use the <span className="text-primary font-medium">+</span> menu.</p>
          </div>
        )}
      </div>

      {dropActive && <DropOverlay side="left" />}
    </aside>
  )
}

function useLeftDockCount(): number {
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  return dockedPanels('left', floating, dockSide).length
}
