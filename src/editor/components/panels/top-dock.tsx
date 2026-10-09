'use client'
// Horizontal modular panel strip. Panels render side-by-side and use the same
// actions and pull-to-float behavior as the left/right docks.
import { useEffect, useRef, useState } from 'react'
import { useEditorStore, TOP_HEIGHT_DEFAULT } from '../../store'
import { PANEL_MAP } from './panel-registry'
import { horizontalDockPanelWidth } from './auto-dock-sizing'
import { PanelContextMenu } from './panel-actions-menu'
import { AddPanelMenu, useDockDrop } from './panel-dock'
import { beginWindowDrag } from './floating-panels'
import { cn } from '@/lib/utils'

const PULL_THRESHOLD = 14

export function TopDock({ side = 'top' }: { side?: 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }) {
  const dockSide = useEditorStore(s => s.panels.dockSide)
  const floating = useEditorStore(s => s.panels.floating)
  const topOrder = useEditorStore(s => s.panels.topOrder)
  const isBottom = side.startsWith('bottom')
  const savedHeight = useEditorStore(s => s.panels.dockHeights[side])
  const manualHeight = savedHeight !== undefined
  const setHeight = useEditorStore(s => s.setHorizontalDockHeight)
  const resetHeight = useEditorStore(s => s.resetHorizontalDockHeight)
  const hasDoc = useEditorStore(s => !!s.activeDocId)
  const dropActive = useDockDrop(side, false)

  const ids = (side === 'top' ? topOrder : Object.keys(dockSide)).filter(id =>
    PANEL_MAP[id] && dockSide[id] === side && !floating[id],
  )

  if (ids.length === 0) {
    return <div data-panel-dock={side} className="hidden md:block h-0 flex-shrink-0" aria-hidden />
  }

  return (
    <aside
      data-panel-dock={side}
      data-drop-active={dropActive ? '1' : undefined}
      className={cn('hidden md:flex bg-panel flex-shrink-0 relative panel-dock-drop', side.startsWith('bottom') ? 'border-t' : 'border-b')}
      style={manualHeight ? { height: savedHeight, maxHeight: '45vh' } : { height: 'max-content', maxHeight: '45vh' }}
      aria-label={`${side} panel strip`}
    >
      <HeightDivider height={savedHeight ?? (isBottom ? 192 : TOP_HEIGHT_DEFAULT)}
        onHeight={px => setHeight(side, px)} onReset={() => resetHeight(side)} bottom={isBottom} />

      <div className="flex-1 min-w-0 flex">
        <div className="w-8 flex items-center justify-center border-r border-border/60 flex-shrink-0">
          <AddPanelMenu side={side} mobile={false} />
        </div>
        <div className={cn("min-w-0 flex overflow-x-auto zphoto-scroll", manualHeight ? "flex-1" : "flex-initial")} role="list" aria-label={`${side} dock panels`}>
          {ids.map(id => <TopPanelBox key={id} id={id} hasDoc={hasDoc} manualHeight={manualHeight} />)}
        </div>
      </div>

      {dropActive && (
        <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
          <div className="px-3 py-1.5 rounded-md bg-primary/15 border border-primary/50 text-primary text-[11px] font-medium shadow-lg">
            {`Drop to dock ${side.replaceAll("-", " ")}`}
          </div>
        </div>
      )}
    </aside>
  )
}

function TopPanelBox({ id, hasDoc, manualHeight }: { id: string; hasDoc: boolean; manualHeight: boolean }) {
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
  // Open Files is a 32px document tab bar; reserving its old 720px width
  // and 232px dock height wasted most of the canvas. Compact modules
  // follow intrinsic width, bounded by the viewport as their content grows.
  const compact = id === 'documents' || id === 'tool-options'
  const width = horizontalDockPanelWidth(id, def.topWidth ?? Math.max(200, Math.min(360, def.defaultFloat.w)))

  return (
    <div role="listitem" className={cn("flex flex-col border-r border-border/60 flex-shrink-0 bg-panel", manualHeight && "h-full")} style={width}>
      <PanelContextMenu id={id}>
        <div
          className="h-7 flex items-center gap-1 px-1.5 border-b bg-panel/80 flex-shrink-0 cursor-grab active:cursor-grabbing"
          title={`${def.label} — drag/double-click to float · right-click for panel options`}
          onDoubleClick={() => useEditorStore.getState().floatPanel(id, def.defaultFloat)}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <Icon size={11} className="text-primary shrink-0" />
          <span className="text-[11px] font-medium truncate flex-1 pl-0.5">{def.label}</span>
        </div>
      </PanelContextMenu>
      <div className={cn("min-h-0 overflow-auto zphoto-scroll", manualHeight ? "flex-1" : id === "documents" ? "shrink-0" : "max-h-[min(38vh,420px)]")}
        style={!manualHeight && !compact ? { minHeight: "min(128px, 28vh)" } : undefined}>
        {hasDoc || def.home ? <Content /> : (
          <div className="p-3 text-[11px] text-muted-foreground text-center leading-relaxed">
            Open an image or create a document to start editing.
          </div>
        )}
      </div>
    </div>
  )
}

function HeightDivider({ height, onHeight, onReset, bottom = false }: {
  height: number
  onHeight: (px: number) => void
  onReset: () => void
  bottom?: boolean
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
    // Auto-height rows no longer use the stored (legacy) height. Begin from
    // the rendered strip size so the first manual resize never jumps.
    drag.current = { startY: e.clientY, startH: e.currentTarget.parentElement?.getBoundingClientRect().height || height }
    setActive(true)
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    pending.current = d.startH + (bottom ? -1 : 1) * (e.clientY - d.startY)
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
      aria-label={bottom ? "Resize bottom panel strip" : "Resize top panel strip"}
      title="Drag to fix dock height · double-click to fit contents automatically"
      className={cn("absolute left-0 right-0 h-[6px] z-20 cursor-row-resize touch-none transition-colors hover:bg-primary/40", bottom ? "top-0 -mt-[3px]" : "bottom-0 -mb-[3px]")}
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
