'use client'
// Fully modular left/right panel docks. Every registered panel can live in
// either dock, the top strip, or a floating window. No panel has bespoke dock
// chrome: tabs, actions, dragging, sizing and persistence are shared.
import { useEffect, useRef, useState } from 'react'
import { PanelLeft, PanelLeftClose, Plus, RotateCcw } from 'lucide-react'
import { useEditorStore, DOCK_WIDTH_DEFAULT } from '../../store'
import { PANEL_MAP, PANELS } from './panel-registry'
import { PanelActionsMenu } from './panel-actions-menu'
import { beginWindowDrag, DOCK_DROP_EVENT } from './floating-panels'
import { cn } from '@/lib/utils'
import { engine } from '../../engine/engine'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const PULL_THRESHOLD = 14
const EMPTY_DOCK_HIDE_DELAY = 650

export type DockTabSide = 'left' | 'right' | 'top'

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

  const sideLabel: Record<string, string> = { left: 'Left', right: 'Right', top: 'Top', Window: 'Window', Home: 'Home' }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors flex-shrink-0"
          title={`Arrange panels — move panels into the ${side === 'top' ? 'top strip' : side + ' dock'}`}
          aria-label={`Arrange panels for the ${side === 'top' ? 'top strip' : side + ' dock'}`}
        >
          <Plus size={13} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align={side === 'left' ? 'start' : 'end'} className="z-50 min-w-48 max-h-[70vh] overflow-y-auto">
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground select-none">
          Move to {side === 'top' ? 'top strip' : `${side} dock`}
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

function resolvedDockSide(id: string, dockSide: Record<string, string>): 'left' | 'right' | 'top' | null {
  const explicit = dockSide[id]
  if (explicit === 'left' || explicit === 'right' || explicit === 'top') return explicit
  return PANEL_MAP[id]?.home ? null : 'right'
}

function dockedPanels(side: 'left' | 'right', floating: Record<string, unknown>, dockSide: Record<string, string>) {
  return PANELS.filter(p => !floating[p.id] && resolvedDockSide(p.id, dockSide) === side)
}

function useDelayedDockPresence(hasPanels: boolean, delay = EMPTY_DOCK_HIDE_DELAY): boolean {
  const [visible, setVisible] = useState(hasPanels)
  useEffect(() => {
    if (hasPanels) {
      setVisible(true)
      return
    }
    const timer = window.setTimeout(() => setVisible(false), delay)
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
    if (mobile || e.button !== 0) return
    suppressClick.current = false
    pullDrag.current = { id, x: e.clientX, y: e.clientY, handedOff: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPullMove = (e: React.PointerEvent<HTMLElement>) => {
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
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            title={mobile ? t.label : `${t.label} — drag or double-click to float`}
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
            onDoubleClick={() => !mobile && useEditorStore.getState().floatPanel(t.id)}
            onPointerDown={onPullDown(t.id)}
            onPointerMove={onPullMove}
            onPointerUp={onPullUp}
            onPointerCancel={onPullUp}
          >
            <Icon size={14} />
            {activeTab === t.id && <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-t" />}
          </button>
        )
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
  return (
    <div className="h-7 px-2 flex items-center gap-1.5 border-b bg-panel/80 flex-shrink-0">
      <Icon size={11} className="text-primary shrink-0" />
      <span className="text-[11px] font-medium truncate flex-1">{def.label}</span>
      {!mobile && <PanelActionsMenu id={id} />}
    </div>
  )
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
    drag.current = { startX: e.clientX, startWidth: width }
    setActive(true)
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    pending.current = d.startWidth + sign * (e.clientX - d.startX)
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0
        if (pending.current !== null) onWidth(pending.current)
      })
    }
  }
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    setActive(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} panel dock`}
      title="Drag to resize dock · double-click to reset"
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
      onDoubleClick={onReset}
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

export function PanelDock({ mobile = false }: { mobile?: boolean }) {
  const rightTab = useEditorStore(s => s.panels.rightTab)
  const setTab = useEditorStore(s => s.setRightPanelTab)
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const dockWidth = useEditorStore(s => s.panels.dockWidth)
  const setDockWidth = useEditorStore(s => s.setDockWidth)
  const resetLayout = useEditorStore(s => s.resetPanelLayout)
  const hasDoc = useEditorStore(s => !!s.activeDocId)
  const dropActive = useDockDrop('right', mobile)
  const rightCount = mobile ? PANELS.length : dockedPanels('right', floating, dockSide).length
  const dockVisible = useDelayedDockPresence(mobile || rightCount > 0)

  const activePanel = PANEL_MAP[rightTab]
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
          onReset={() => setDockWidth(DOCK_WIDTH_DEFAULT)}
        />
      )}

      <DockTabs side="right" mobile={mobile} />
      {activePanel && <DockPanelHeader id={activePanel.id} mobile={mobile} />}

      <div className="flex-1 min-h-0 flex flex-col">
        {!hasDoc ? (
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
  const leftWidth = useEditorStore(s => s.panels.leftWidth)
  const setLeftDockWidth = useEditorStore(s => s.setLeftDockWidth)
  const setLeftDockOpen = useEditorStore(s => s.setLeftDockOpen)
  const setTab = useEditorStore(s => s.setLeftPanelTab)
  const hasDoc = useEditorStore(s => !!s.activeDocId)
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const dropActive = useDockDrop('left', false)

  const activePanel = PANEL_MAP[leftTab]
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
        onReset={() => setLeftDockWidth(DOCK_WIDTH_DEFAULT)}
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
          hasDoc ? <ActiveContent /> : (
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
