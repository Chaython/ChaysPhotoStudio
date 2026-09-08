'use client'
// Panel docks — left AND right. Panels can be arranged into either area:
//   • drag a floating window over a dock (or the left edge zone) and release
//   • pull a tab out of either dock to float it, then drop it on the other side
//   • use the "+" menu in either tab bar to move panels between docks
// Right dock: resizable width (left divider), pull-out-to-float tabs,
// collapsible Color section, drop target, engine status footer.
// Left dock: same dock behaviors + a slim rail when closed (click / drop opens).
// Mobile (`mobile` prop) keeps the original fixed drawer behavior.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, GripHorizontal, PanelLeft, PanelLeftClose, PanelRight, Plus, RotateCcw } from 'lucide-react'
import { useEditorStore, DOCK_WIDTH_DEFAULT } from '../../store'
import { TAB_PANELS, PANEL_MAP, PANELS } from './panel-registry'
import { ColorPanel } from './color-panel'
import { beginWindowDrag, DOCK_DROP_EVENT } from './floating-panels'
import { cn } from '@/lib/utils'
import { engine } from '../../engine/engine'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const PULL_THRESHOLD = 14 // px of pointer travel before a tab pops out into a window

export type DockTabSide = 'left' | 'right' | 'top'

interface PullDrag {
  id: string
  x: number
  y: number
  handedOff: boolean
}

/** side-matched drop highlight from the floating-window drag session */
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

// ---- "+" menu: arrange panels between docks ------------------------------------

const COLOR_DEF = PANELS[0] // { id: 'color', ... } — dockable everywhere,
// but on the right dock it renders as the fixed collapsible section

/** every dock's arrange menu offers the full panel list, with a badge showing
 *  where each panel currently lives (Left / Right / Top / Window) */
export function AddPanelMenu({ side, mobile }: { side: DockTabSide; mobile: boolean }) {
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  if (mobile) return null

  const items = [COLOR_DEF, ...TAB_PANELS]
  const sideLabel: Record<string, string> = { left: 'Left', right: 'Right', top: 'Top', Window: 'Window' }

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
      <DropdownMenuContent side="bottom" align={side === 'left' ? 'start' : 'end'} className="z-50 min-w-44">
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground select-none">
          Move to {side === 'top' ? 'top strip' : `${side} dock`}
        </div>
        {items.map(p => {
          const isFloating = !!floating[p.id]
          const at = isFloating ? 'Window' : (dockSide[p.id] ?? 'right')
          const Icon = (p as any).icon
          return (
            <DropdownMenuItem
              key={p.id}
              onClick={() => useEditorStore.getState().dockPanel(p.id, side)}
              className="gap-2 text-xs"
            >
              {Icon ? <Icon size={13} /> : <PanelRight size={13} />}
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

// ---- shared tab bar (pull-out gesture + per-side active tab) --------------------

function DockTabs({ side, mobile, extra }: {
  side: DockTabSide
  mobile: boolean
  extra?: React.ReactNode
}) {
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const activeTab = useEditorStore(s => (side === 'left' ? s.panels.leftTab : s.panels.rightTab))
  const setTabLeft = useEditorStore(s => s.setLeftPanelTab)
  const setTabRight = useEditorStore(s => s.setRightPanelTab)
  const setTab = side === 'left' ? setTabLeft : setTabRight

  // the Color panel joins the LEFT tab bar when docked there (on the right it
  // renders as the fixed collapsible section instead, never as a tab)
  const pool = side === 'left' ? [...TAB_PANELS, COLOR_DEF] : TAB_PANELS
  const tabs = pool.filter(p => !floating[p.id] && (dockSide[p.id] ?? 'right') === side)

  // ---- tab pull-out gesture → floating window ----------------------------------
  const pullDrag = useRef<PullDrag | null>(null)
  const suppressClick = useRef(false)

  const onPullDown = (id: string) => (e: React.PointerEvent<HTMLElement>) => {
    if (mobile || e.button !== 0) return
    suppressClick.current = false // clear any stale suppression from a previous gesture
    pullDrag.current = { id, x: e.clientX, y: e.clientY, handedOff: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPullMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = pullDrag.current
    if (!d || d.handedOff) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > PULL_THRESHOLD) {
      d.handedOff = true
      suppressClick.current = true
      // float the panel under the pointer; the window drag session takes over
      beginWindowDrag(d.id, e)
    }
  }
  const onPullUp = () => {
    pullDrag.current = null
  }

  return (
    <div className="flex border-b overflow-x-auto flex-shrink-0 zphoto-scroll" role="tablist" aria-label={`${side} dock panel tabs`}>
      {tabs.length === 0 ? (
        <div className="flex-1 h-8 flex items-center justify-center text-[10px] text-muted-foreground select-none">
          {side === 'left' ? 'No panels — use + or drop a window here' : 'Drag windows back to dock'}
        </div>
      ) : tabs.map(t => {
        const Icon = t.icon
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            title={mobile ? t.label : `${t.label} — drag to float, + menu to move`}
            className={cn(
              'flex-1 min-w-8 h-8 flex items-center justify-center relative',
              activeTab === t.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              !mobile && 'cursor-grab active:cursor-grabbing'
            )}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false
                return
              }
              setTab(t.id)
            }}
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

// ---- vertical width divider (shared) -------------------------------------------

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

  // left dock: divider on the RIGHT edge (pull right → wider)
  // right dock: divider on the LEFT edge (pull left → wider)
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
        active ? 'bg-primary/60' : 'bg-transparent'
      )}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={onReset}
    />
  )
}

// ---- drop overlay pill ----------------------------------------------------------

function DropOverlay({ side }: { side: 'left' | 'right' }) {
  return (
    <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
      <div className="px-3 py-1.5 rounded-md bg-primary/15 border border-primary/50 text-primary text-[11px] font-medium shadow-lg">
        Drop to dock {side}
      </div>
    </div>
  )
}

// ---- RIGHT dock ------------------------------------------------------------------

export function PanelDock({ mobile = false }: { mobile?: boolean }) {
  const rightTab = useEditorStore(s => s.panels.rightTab)
  const setTab = useEditorStore(s => s.setRightPanelTab)
  const colorOpen = useEditorStore(s => s.panels.colorPanelOpen)
  const toggleColor = useEditorStore(s => s.toggleColorPanel)
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const dockWidth = useEditorStore(s => s.panels.dockWidth)
  const setDockWidth = useEditorStore(s => s.setDockWidth)
  const resetLayout = useEditorStore(s => s.resetPanelLayout)
  const dockPanel = useEditorStore(s => s.dockPanel)
  const hasDoc = useEditorStore(s => !!s.activeDocId)

  const dropActive = useDockDrop('right', mobile)

  const colorFloating = !!floating['color']
  const colorHere = !colorFloating && (dockSide['color'] ?? 'right') === 'right'
  const activePanel = PANEL_MAP[rightTab]
  // rightTab === 'color' must NEVER validate: the Color panel renders as the
  // fixed collapsible section, so a 'color' body tab would duplicate it
  const ActiveContent = activePanel && rightTab !== 'color' && !floating[rightTab] && (dockSide[rightTab] ?? 'right') === 'right'
    ? activePanel.render : null

  // keep the active tab valid — panels move between docks / float away, and
  // the stored tab can go stale; heal it to the first panel on this side
  useEffect(() => {
    const valid = !!PANEL_MAP[rightTab] && rightTab !== 'color' && !floating[rightTab] && (dockSide[rightTab] ?? 'right') === 'right'
    if (valid) return
    const first = TAB_PANELS.find(p => !floating[p.id] && (dockSide[p.id] ?? 'right') === 'right')
    const healed = first?.id ?? ''
    if (healed !== rightTab) setTab(healed)
  }, [rightTab, floating, dockSide, setTab])

  return (
    <aside
      data-panel-dock={mobile ? undefined : 'right'}
      data-drop-active={dropActive ? '1' : undefined}
      className={cn(
        'bg-panel border-l flex flex-col flex-shrink-0 min-h-0 relative panel-dock-drop',
        mobile ? 'w-full' : 'hidden md:flex'
      )}
      style={mobile ? undefined : { width: dockWidth }}
      aria-label="Panels"
    >
      {/* width drag divider (left edge, desktop) */}
      {!mobile && (
        <WidthDivider
          side="right"
          width={dockWidth}
          onWidth={setDockWidth}
          onReset={() => setDockWidth(DOCK_WIDTH_DEFAULT)}
        />
      )}

      {/* color panel (collapsible section; grip pulls it out) — only when the
          Color panel actually lives in this dock; it may be a left-dock tab,
          a top-strip box or a floating window instead */}
      <div className="border-b">
        <div className="flex items-center gap-0.5 px-1.5 h-7">
          {!mobile && (
            <span
              className="p-0.5 -ml-0.5 rounded cursor-grab active:cursor-grabbing text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              title="Drag to float the Color panel"
              onPointerDown={onColorPullDown}
              onPointerMove={onColorPullMove}
              onPointerUp={onColorPullUp}
              onPointerCancel={onColorPullUp}
            >
              <GripHorizontal size={11} />
            </span>
          )}
          <button
            className="flex-1 flex items-center gap-1 px-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
            onClick={toggleColor}
            aria-expanded={colorOpen && colorHere}
          >
            <span className={cn('transition-transform', colorOpen && colorHere && 'rotate-90')}>
              <ChevronDown size={11} />
            </span>
            Color
          </button>
          {!colorHere && (
            <button
              className="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              title="Move the Color panel back into this dock"
              aria-label="Move the Color panel back into this dock"
              onClick={() => dockPanel('color', 'right')}
            >
              <PanelRight size={11} />
            </button>
          )}
        </div>
        {colorHere ? (
          colorOpen && <ColorPanel />
        ) : (
          <div className="px-3 pb-2 text-[10px] text-muted-foreground leading-relaxed">
            {colorFloating
              ? 'Color panel is floating — drag its window over any dock to put it back.'
              : `Color lives in the ${dockSide['color'] === 'left' ? 'left dock' : 'top strip'} — use the button above to bring it back.`}
          </div>
        )}
      </div>

      {/* tabs header (dockable panels; floating ones drop out of the bar) */}
      <DockTabs side="right" mobile={mobile} />

      {/* active panel content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {!hasDoc ? (
          <div className="p-4 text-[11px] text-muted-foreground text-center leading-relaxed">
            Open an image or create a document to start editing.
          </div>
        ) : ActiveContent ? (
          <ActiveContent />
        ) : activePanel && !floating[rightTab] ? (
          <div className="flex-1 flex items-center justify-center px-4 text-center text-[10px] text-muted-foreground">
            {activePanel.label} lives in the left dock — use its tab there, or the + menu to move it back.
          </div>
        ) : activePanel ? (
          <div className="flex-1 flex items-center justify-center px-4 text-center text-[10px] text-muted-foreground">
            {activePanel.label} is floating — drag its window over a dock to put it back.
          </div>
        ) : null}
      </div>

      {/* engine status footer + layout reset */}
      <div className="h-6 px-2 flex items-center gap-1 text-[9px] text-muted-foreground border-t flex-shrink-0">
        <span className="truncate flex-1">{engine.docs.length} doc(s) · engine ready</span>
        {!mobile && (
          <button
            className="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Reset panel layout (dock all windows, default widths)"
            aria-label="Reset panel layout"
            onClick={() => resetLayout()}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>

      {/* drop-to-dock target overlay */}
      {dropActive && <DropOverlay side="right" />}
    </aside>
  )
}

// color grip pull-out (kept separate so the dock component stays lean)
let colorPull: { x: number; y: number; handed: boolean } | null = null
const onColorPullDown = (e: React.PointerEvent<HTMLElement>) => {
  if (e.button !== 0) return
  colorPull = { x: e.clientX, y: e.clientY, handed: false }
  e.currentTarget.setPointerCapture(e.pointerId)
}
const onColorPullMove = (e: React.PointerEvent<HTMLElement>) => {
  if (!colorPull || colorPull.handed) return
  if (Math.hypot(e.clientX - colorPull.x, e.clientY - colorPull.y) > PULL_THRESHOLD) {
    colorPull.handed = true
    beginWindowDrag('color', e)
  }
}
const onColorPullUp = () => {
  colorPull = null
}

// ---- LEFT dock ---------------------------------------------------------------------

export function LeftDock() {
  const leftOpen = useEditorStore(s => s.panels.leftOpen)

  if (!leftOpen) return <LeftRail />
  return <LeftDockOpen />
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
  const ActiveContent = activePanel && !floating[leftTab] && (dockSide[leftTab] ?? 'right') === 'left'
    ? activePanel.render : null

  // heal a stale active tab (panel moved away / floated)
  useEffect(() => {
    const valid = !!PANEL_MAP[leftTab] && !floating[leftTab] && (dockSide[leftTab] ?? 'right') === 'left'
    if (valid) return
    const first = TAB_PANELS.find(p => !floating[p.id] && (dockSide[p.id] ?? 'right') === 'left')
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
      {/* width drag divider (right edge — pull right → wider) */}
      <WidthDivider
        side="left"
        width={leftWidth}
        onWidth={setLeftDockWidth}
        onReset={() => setLeftDockWidth(DOCK_WIDTH_DEFAULT)}
      />

      {/* header: tabs + close-to-rail */}
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

      {/* active panel content */}
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
            <p>Drop a floating panel window here,<br />or use the <span className="text-primary font-medium">+</span> menu to move<br />panels from the right dock.</p>
            {activePanel && <p className="text-foreground/70">{activePanel.label} is selected — it lives in the right dock.</p>}
            {leftTab && activePanel && (
              <button
                type="button"
                className="text-[10px] text-primary hover:underline"
                onClick={() => setTab('')}
              >
                Clear selection
              </button>
            )}
          </div>
        )}
      </div>

      {/* drop-to-dock target overlay */}
      {dropActive && <DropOverlay side="left" />}
    </aside>
  )
}

function useLeftDockCount(): number {
  const floating = useEditorStore(s => s.panels.floating)
  const dockSide = useEditorStore(s => s.panels.dockSide)
  return [...TAB_PANELS, COLOR_DEF].filter(p => !floating[p.id] && (dockSide[p.id] ?? 'right') === 'left').length
}
