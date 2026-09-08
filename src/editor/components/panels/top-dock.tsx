'use client'
// Top dock — a horizontal panel strip that lives directly below the tool
// options bar, inside the workspace column. Any floating window can be
// dropped here ("drag to the top of the canvas"), and any panel can be
// moved here from the + arrange menus. Panels render side by side in
// fixed-width boxes with their own titlebar (drag = pull back out).
// The strip height is resizable from its bottom edge and persisted.
// When empty, a zero-height anchor div keeps [data-panel-dock="top"] in
// the DOM so the drop zone can extend 64px down into the canvas.
import { useEffect, useRef, useState } from 'react'
import { PanelRight, X } from 'lucide-react'
import { useEditorStore, TOP_HEIGHT_DEFAULT } from '../../store'
import { PANEL_MAP, TAB_PANELS } from './panel-registry'
import { AddPanelMenu, useDockDrop } from './panel-dock'
import { beginWindowDrag } from './floating-panels'
import { cn } from '@/lib/utils'

const PULL_THRESHOLD = 14 // px of travel before a titlebar drag pops the box out

export function TopDock() {
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const floating = useEditorStore(s => s.panels.floating)
  const topOrder = useEditorStore(s => s.panels.topOrder)
  const topHeight = useEditorStore(s => s.panels.topHeight)
  const setTopHeight = useEditorStore(s => s.setTopHeight)
  const hasDoc = useEditorStore(s => !!s.activeDocId)

  const dropActive = useDockDrop('top', false)

  const ids = topOrder.filter(id =>
    PANEL_MAP[id] && (dockSide[id] ?? 'right') === 'top' && !floating[id],
  )

  // strip hidden on mobile; the anchor keeps the drop target alive when empty
  if (ids.length === 0) {
    return <div data-panel-dock="top" className="hidden md:block h-0 flex-shrink-0" aria-hidden />
  }

  return (
    <aside
      data-panel-dock="top"
      data-drop-active={dropActive ? '1' : undefined}
      className="hidden md:flex bg-panel border-b flex-shrink-0 relative panel-dock-drop"
      style={{ height: topHeight }}
      aria-label="Top panel strip"
    >
      {/* height drag divider (bottom edge — pull down → taller) */}
      <HeightDivider height={topHeight} onHeight={setTopHeight} onReset={() => setTopHeight(TOP_HEIGHT_DEFAULT)} />

      <div className="flex-1 min-w-0 flex">
        {/* arrange menu pinned at the strip start */}
        <div className="w-8 flex items-center justify-center border-r border-border/60 flex-shrink-0">
          <AddPanelMenu side="top" mobile={false} />
        </div>
        {/* panel boxes — swipe horizontally when the row overflows */}
        <div className="flex-1 min-w-0 flex overflow-x-auto zphoto-scroll" role="list" aria-label="Top dock panels">
          {ids.map(id => (
            <TopPanelBox key={id} id={id} hasDoc={hasDoc} />
          ))}
        </div>
      </div>

      {/* drop-to-dock target overlay */}
      {dropActive && (
        <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
          <div className="px-3 py-1.5 rounded-md bg-primary/15 border border-primary/50 text-primary text-[11px] font-medium shadow-lg">
            Drop to dock top
          </div>
        </div>
      )}
    </aside>
  )
}

function TopPanelBox({ id, hasDoc }: { id: string; hasDoc: boolean }) {
  const def = PANEL_MAP[id]
  const dockPanel = useEditorStore(s => s.dockPanel)
  const floatPanel = useEditorStore(s => s.floatPanel)
  const [dockedOut, setDockedOut] = useState(false)

  const pull = useRef<{ x: number; y: number; handed: boolean } | null>(null)
  const onDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    pull.current = { x: e.clientX, y: e.clientY, handed: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = pull.current
    if (!d || d.handed) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > PULL_THRESHOLD) {
      d.handed = true
      beginWindowDrag(id, e) // box pops out under the pointer as a window
    }
  }
  const onUp = () => { pull.current = null }

  if (!def) return null
  const Icon = def.icon
  const Content = def.render
  const w = Math.max(200, Math.min(340, def.defaultFloat.w))

  const moveRight = () => {
    if (dockedOut) return
    setDockedOut(true)
    window.setTimeout(() => {
      dockPanel(id, 'right')
      setDockedOut(false)
    }, 120)
  }

  return (
    <div
      role="listitem"
      className={cn(
        'flex flex-col border-r border-border/60 flex-shrink-0 bg-panel',
        dockedOut ? 'opacity-40 transition-opacity duration-100' : 'transition-opacity',
      )}
      style={{ width: w }}
    >
      {/* titlebar = drag handle (pull out to float) */}
      <div
        className="h-7 flex items-center gap-1 px-1.5 border-b bg-panel/80 flex-shrink-0 cursor-grab active:cursor-grabbing"
        title={`${def.label} — drag to pull out into a window`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <Icon size={11} className="text-primary shrink-0" />
        <span className="text-[11px] font-medium truncate flex-1 pl-0.5">{def.label}</span>
        <button
          type="button"
          className="h-5 w-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          title="Move this panel to the right dock"
          aria-label={`Move ${def.label} to the right dock`}
          onClick={moveRight}
        >
          <PanelRight size={11} />
        </button>
        <button
          type="button"
          className="h-5 w-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          title="Pull this panel out into a floating window"
          aria-label={`Float ${def.label}`}
          onClick={() => floatPanel(id)}
        >
          <X size={11} />
        </button>
      </div>
      {/* content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {hasDoc ? <Content /> : (
          <div className="p-3 text-[11px] text-muted-foreground text-center leading-relaxed">
            Open an image or create a document to start editing.
          </div>
        )}
      </div>
    </div>
  )
}

// ---- horizontal height divider (bottom edge of the strip) ------------------------

function HeightDivider({ height, onHeight, onReset }: {
  height: number
  onHeight: (px: number) => void
  onReset: () => void
}) {
  const [active, setActive] = useState(false)
  const drag = useRef<{ startY: number; startH: number } | null>(null)
  const rafId = useRef(0)
  const pending = useRef<number | null>(null)

  useEffect(() => () => {
    if (rafId.current) cancelAnimationFrame(rafId.current)
  }, [])

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startY: e.clientY, startH: height }
    setActive(true)
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    pending.current = d.startH + (e.clientY - d.startY)
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0
        if (pending.current !== null) onHeight(pending.current)
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
      aria-orientation="horizontal"
      aria-label="Resize top panel strip"
      title="Drag to resize · double-click to reset"
      className="absolute left-0 right-0 bottom-0 -mb-[3px] h-[6px] z-20 cursor-row-resize touch-none transition-colors hover:bg-primary/40"
      {...(active ? { 'data-active': '1' } : {})}
      style={{ background: active ? 'color-mix(in oklab, var(--primary) 60%, transparent)' : undefined }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={onReset}
    />
  )
}
