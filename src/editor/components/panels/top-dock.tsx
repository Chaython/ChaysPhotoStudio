'use client'
// Horizontal modular panel strip. Panels render side-by-side and use the same
// actions and pull-to-float behavior as the left/right docks.
import { useEffect, useRef, useState } from 'react'
import { useEditorStore, TOP_HEIGHT_DEFAULT } from '../../store'
import { PANEL_MAP } from './panel-registry'
import { PanelActionsMenu } from './panel-actions-menu'
import { AddPanelMenu, useDockDrop } from './panel-dock'
import { beginWindowDrag } from './floating-panels'
import { cn } from '@/lib/utils'

const PULL_THRESHOLD = 14

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
      <HeightDivider height={topHeight} onHeight={setTopHeight} onReset={() => setTopHeight(TOP_HEIGHT_DEFAULT)} />

      <div className="flex-1 min-w-0 flex">
        <div className="w-8 flex items-center justify-center border-r border-border/60 flex-shrink-0">
          <AddPanelMenu side="top" mobile={false} />
        </div>
        <div className="flex-1 min-w-0 flex overflow-x-auto zphoto-scroll" role="list" aria-label="Top dock panels">
          {ids.map(id => <TopPanelBox key={id} id={id} hasDoc={hasDoc} />)}
        </div>
      </div>

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
      beginWindowDrag(id, e)
    }
  }
  const onUp = () => { pull.current = null }

  if (!def) return null
  const Icon = def.icon
  const Content = def.render
  const w = def.topWidth ?? Math.max(200, Math.min(360, def.defaultFloat.w))

  return (
    <div role="listitem" className="flex flex-col border-r border-border/60 flex-shrink-0 bg-panel" style={{ width: w }}>
      <div
        className="h-7 flex items-center gap-1 px-1.5 border-b bg-panel/80 flex-shrink-0 cursor-grab active:cursor-grabbing"
        title={`${def.label} — drag or double-click to float`}
        onDoubleClick={() => useEditorStore.getState().floatPanel(id, def.defaultFloat)}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <Icon size={11} className="text-primary shrink-0" />
        <span className="text-[11px] font-medium truncate flex-1 pl-0.5">{def.label}</span>
        <PanelActionsMenu id={id} />
      </div>
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
