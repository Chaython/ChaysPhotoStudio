'use client'
// Floating panel windows + shared window-drag controller.
//
// Layout: <FloatingPanels /> renders a fixed, click-through layer (z-30) above
// the workspace; each window is absolutely positioned from the store rect.
//
// Drag architecture: a single module-level "session" drives all window drags
// (move / resize) via window-level pointer listeners. Geometry during the drag
// is applied by DIRECT DOM mutation (no store churn); the final rect is
// committed to the store on release. Escape cancels back to the pre-drag state.
// `beginWindowDrag()` lets the dock hand off a tab-drag gesture: it floats the
// panel under the pointer and starts a session in the same gesture.
//
// Drop-to-dock: while a move session is active, ALL THREE docks are drop
// targets — dropping over the right dock docks right, over the left dock /
// left rail (or the left edge strip of the workspace while the rail is
// closed) docks LEFT, over the top strip (or the top edge strip while the
// strip is empty) docks TOP. Docks highlight through the 'zphoto-dockdrop'
// CustomEvent (detail.side), and the edge strips render a translucent
// indicator in this layer.
import { memo, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Minimize2 } from 'lucide-react'
import { useEditorStore, type PanelRect, type DockSide } from '../../store'
import { PANEL_MAP } from './panel-registry'
import { cn } from '@/lib/utils'

type DragMode = 'move' | 'resize-se' | 'resize-e' | 'resize-s'

export const DOCK_DROP_EVENT = 'zphoto-dockdrop'

/** depth of the canvas-edge strips that dock panels while the target itself
 *  is hidden (left rail closed / top strip empty) */
const EDGE_STRIP_W = 64

interface Session {
  id: string
  pointerId: number
  mode: DragMode
  startPointer: { x: number; y: number }
  startRect: PanelRect
  /** pre-drag rect — restored on Escape */
  origin: PanelRect | null
  /** true when the drag began from a dock tab (Escape re-docks) */
  originDocked: boolean
  el: HTMLElement | null
  chromeApplied: boolean
  last: { x: number; y: number; w: number; h: number }
  dockZone: DockSide | null
  dockStrip: DOMRect | null
}

let session: Session | null = null

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function findWindowEl(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-floating-panel="${CSS.escape(id)}"]`)
}

function setDockDrop(active: boolean, side?: DockSide | null, strip?: DOMRect | null) {
  window.dispatchEvent(new CustomEvent(DOCK_DROP_EVENT, { detail: { active, side: active ? side : undefined, strip: active ? strip : undefined } }))
}

// ---- dock zone detection -------------------------------------------------------

interface DockZone {
  side: DockSide
  strip: DOMRect | null
}

/** which dock would the pointer (x, y) drop into? Every panel — including
 *  Color — can dock into any area (right / left / top / floating). */
function dockZoneAt(x: number, y: number, _id: string): DockZone | null {
  const inRect = (r: DOMRect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  const right = document.querySelector('[data-panel-dock="right"]')?.getBoundingClientRect()
  if (right && inRect(right)) return { side: 'right', strip: null }
  const left = document.querySelector('[data-panel-dock="left"]')?.getBoundingClientRect()
  if (left && inRect(left)) return { side: 'left', strip: null }
  const top = document.querySelector('[data-panel-dock="top"]')?.getBoundingClientRect()
  if (top) {
    if (top.height >= 8 && inRect(top)) return { side: 'top', strip: null }
    // empty strip (zero-height anchor) — extend the target 64px down into
    // the canvas so "drag to the top of the canvas" is an obvious gesture
    if (top.height < 8 && x >= top.left && x <= top.right && y >= top.top && y <= top.top + EDGE_STRIP_W) {
      return { side: 'top', strip: new DOMRect(top.left, top.top, top.width, EDGE_STRIP_W) }
    }
  }
  // the closed left rail is only 36px wide — extend the target into the
  // workspace edge strip so "drag all the way left" is easy and obvious
  if (left && left.width < 60) {
    const ws = document.querySelector('[data-workspace]')?.getBoundingClientRect()
    if (ws && x >= ws.left && x <= ws.left + EDGE_STRIP_W && y >= ws.top && y <= ws.bottom) {
      return { side: 'left', strip: new DOMRect(ws.left, ws.top, EDGE_STRIP_W, ws.height) }
    }
  }
  return null
}

// ---- session event handlers (window-level) -----------------------------------

function onSessionMove(e: PointerEvent) {
  const s = session
  if (!s || e.pointerId !== s.pointerId) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const def = PANEL_MAP[s.id]
  const minW = def?.minFloat.w ?? 200
  const minH = def?.minFloat.h ?? 160
  const dx = e.clientX - s.startPointer.x
  const dy = e.clientY - s.startPointer.y

  let { x, y, w, h } = s.last
  if (s.mode === 'move') {
    x = clampNum(s.startRect.x + dx, -s.startRect.w + 80, Math.max(-s.startRect.w + 80, vw - 80))
    y = clampNum(s.startRect.y + dy, 48, Math.max(48, vh - 40))
  } else {
    if (s.mode.includes('e')) w = clampNum(s.startRect.w + dx, minW, vw)
    if (s.mode.includes('s')) h = clampNum(s.startRect.h + dy, minH, vh)
  }
  s.last = { x, y, w, h }

  if (!s.el) s.el = findWindowEl(s.id)
  const el = s.el
  if (el) {
    if (!s.chromeApplied) {
      s.chromeApplied = true
      el.setAttribute(s.mode === 'move' ? 'data-dragging' : 'data-resizing', '1')
    }
    // direct DOM mutation — the store only sees the final rect on release
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.width = `${w}px`
    if (s.mode !== 'move') el.style.height = `${h}px`
  }

  // drop-to-dock zones (move only)
  if (s.mode === 'move') {
    const zone = dockZoneAt(e.clientX, e.clientY, s.id)
    const zoneSide = zone?.side ?? null
    // DOMRects are recreated per call — compare geometry, not references,
    // so the event only fires when the zone actually changes
    const rectKey = (r: DOMRect | null) => r ? `${r.left},${r.top},${r.width}` : ''
    if (zoneSide !== s.dockZone || rectKey(zone?.strip ?? null) !== rectKey(s.dockStrip)) {
      s.dockZone = zoneSide
      s.dockStrip = zone?.strip ?? null
      setDockDrop(!!zone, zoneSide, s.dockStrip)
    }
  }
}

function onSessionEnd(e: PointerEvent) {
  if (!session || e.pointerId !== session.pointerId) return
  commitSession(false)
}

function onSessionKey(e: KeyboardEvent) {
  if (!session) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    commitSession(true)
  }
}

function teardownListeners() {
  window.removeEventListener('pointermove', onSessionMove)
  window.removeEventListener('pointerup', onSessionEnd)
  window.removeEventListener('pointercancel', onSessionEnd)
  window.removeEventListener('keydown', onSessionKey, true)
}

function releaseChrome(s: Session) {
  const el = s.el ?? findWindowEl(s.id)
  el?.removeAttribute('data-dragging')
  el?.removeAttribute('data-resizing')
}

function commitSession(cancel: boolean) {
  const s = session
  if (!s) return
  session = null
  teardownListeners()
  setDockDrop(false)
  releaseChrome(s)
  const store = useEditorStore.getState()

  if (cancel) {
    if (s.originDocked || !s.origin) {
      // drag started from a dock tab → Escape puts it back in its dock
      store.dockPanel(s.id)
      return
    }
    const el = s.el ?? findWindowEl(s.id)
    if (el) {
      el.style.left = `${s.origin.x}px`
      el.style.top = `${s.origin.y}px`
      el.style.width = `${s.origin.w}px`
      el.style.height = `${s.origin.h}px`
    }
    store.movePanel(s.id, s.origin.x, s.origin.y)
    store.resizePanel(s.id, s.origin.w, s.origin.h)
    return
  }

  if (s.mode === 'move' && s.dockZone) {
    store.dockPanel(s.id, s.dockZone) // drop over a dock zone → dock on that side
    return
  }
  if (s.mode === 'move') store.movePanel(s.id, s.last.x, s.last.y)
  else store.resizePanel(s.id, s.last.w, s.last.h)
}

function startSession(
  id: string,
  pointerId: number,
  mode: DragMode,
  startPointer: { x: number; y: number },
  startRect: PanelRect,
  opts: { origin?: PanelRect | null; originDocked?: boolean } = {},
) {
  if (session) commitSession(false) // one gesture at a time
  session = {
    id,
    pointerId,
    mode,
    startPointer,
    startRect,
    origin: opts.origin ?? startRect,
    originDocked: opts.originDocked ?? false,
    el: findWindowEl(id),
    chromeApplied: false,
    last: { x: startRect.x, y: startRect.y, w: startRect.w, h: startRect.h },
    dockZone: null,
    dockStrip: null,
  }
  window.addEventListener('pointermove', onSessionMove)
  window.addEventListener('pointerup', onSessionEnd)
  window.addEventListener('pointercancel', onSessionEnd)
  window.addEventListener('keydown', onSessionKey, true)
}

/**
 * Hand-off entry point for the dock: float `id` under the pointer and continue
 * the current gesture as a window title-bar drag. Called when a tab drag
 * exceeds the pull threshold.
 */
export function beginWindowDrag(id: string, e: { clientX: number; clientY: number; pointerId: number }) {
  const def = PANEL_MAP[id]
  if (!def) return
  const store = useEditorStore.getState()
  const existing = store.panels.floating[id]
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = existing?.w ?? def.defaultFloat.w
  const h = existing?.h ?? def.defaultFloat.h
  const x = clampNum(e.clientX - 12, -w + 80, Math.max(-w + 80, vw - 80))
  const y = clampNum(e.clientY - 8, 48, Math.max(48, vh - 60))
  if (existing) {
    store.movePanel(id, x, y)
    store.focusPanel(id)
  } else {
    store.floatPanel(id, { x, y, w, h })
  }
  const rect = useEditorStore.getState().panels.floating[id]
  if (!rect) return
  startSession(id, e.pointerId, 'move', { x: e.clientX, y: e.clientY }, rect, { origin: null, originDocked: !existing })
}

// ---- components ----------------------------------------------------------------

const TITLEBAR_H = 28

interface FloatingWindowProps {
  id: string
}

const FloatingWindow = memo(function FloatingWindow({ id }: FloatingWindowProps) {
  const rect = useEditorStore(s => s.panels.floating[id])
  const [docking, setDocking] = useState(false)
  const def = PANEL_MAP[id]
  if (!rect || !def) return null
  const Icon = def.icon
  const Content = def.render

  const focus = () => useEditorStore.getState().focusPanel(id)

  const onTitlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return // chrome buttons handle themselves
    const r = useEditorStore.getState().panels.floating[id]
    if (!r) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    startSession(id, e.pointerId, 'move', { x: e.clientX, y: e.clientY }, r)
  }

  const startResize = (mode: DragMode) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const r = useEditorStore.getState().panels.floating[id]
    if (!r) return
    e.currentTarget.setPointerCapture(e.pointerId)
    startSession(id, e.pointerId, mode, { x: e.clientX, y: e.clientY }, r)
  }

  const dockBack = () => {
    if (docking) return
    setDocking(true)
    window.setTimeout(() => {
      useEditorStore.getState().dockPanel(id)
      setDocking(false)
    }, 140)
  }

  return (
    <div
      data-floating-panel={id}
      className={cn(
        'panel-window pointer-events-auto bg-panel border border-border rounded-md shadow-2xl',
        docking ? 'animate-out fade-out zoom-out-95 duration-150' : 'animate-in fade-in zoom-in-95 duration-150'
      )}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.collapsed ? TITLEBAR_H : rect.h,
        zIndex: rect.z,
      }}
      onPointerDown={focus}
    >
      {/* title bar = drag handle */}
      <div
        className="panel-window-titlebar h-7 flex items-center gap-1 px-1.5 border-b bg-panel/80 flex-shrink-0"
        onPointerDown={onTitlePointerDown}
      >
        <Icon size={11} className="text-primary shrink-0" />
        <span className="text-[11px] font-medium truncate flex-1 pl-0.5">{def.label}</span>
        <button
          type="button"
          className="h-5 w-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          title={rect.collapsed ? 'Expand' : 'Collapse'}
          aria-label={rect.collapsed ? 'Expand panel' : 'Collapse panel'}
          onClick={() => useEditorStore.getState().collapsePanel(id, !rect.collapsed)}
        >
          {rect.collapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
        </button>
        <button
          type="button"
          className="h-5 w-5 flex items-center justify-center rounded-sm text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          title="Dock panel"
          aria-label="Dock panel back into its dock"
          onClick={dockBack}
        >
          <Minimize2 size={11} />
        </button>
      </div>

      {/* content (unmounted while collapsed — re-mounted expands) */}
      {!rect.collapsed && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <Content />
        </div>
      )}

      {/* resize handles — above the content */}
      {!rect.collapsed && !docking && (
        <>
          <div
            className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize z-30"
            style={{ touchAction: 'none' }}
            onPointerDown={startResize('resize-se')}
          />
          <div
            className="absolute top-0 bottom-0 right-0 w-[4px] cursor-ew-resize z-30"
            style={{ touchAction: 'none' }}
            onPointerDown={startResize('resize-e')}
          />
          <div
            className="absolute bottom-0 left-0 right-0 h-[4px] cursor-ns-resize z-30"
            style={{ touchAction: 'none' }}
            onPointerDown={startResize('resize-s')}
          />
        </>
      )}
    </div>
  )
})

export const FloatingPanels = memo(function FloatingPanels() {
  const floating = useEditorStore(s => s.panels.floating)
  const ids = Object.keys(floating)
  return (
    <div className="fixed inset-0 z-30 pointer-events-none" aria-label="Floating panel windows">
      {ids.map(id => <FloatingWindow key={id} id={id} />)}
      <DockStripIndicator />
    </div>
  )
})

/** translucent strip over the workspace's left edge ("dock left" while the
 *  rail is closed) or the top edge of the canvas ("dock top" while the strip
 *  is empty) while a window drag is parked in one of those zones */
const DockStripIndicator = memo(function DockStripIndicator() {
  const [zone, setZone] = useState<{ strip: DOMRect; side: DockSide } | null>(null)
  useEffect(() => {
    const onDropEvt = (e: Event) => {
      const d = (e as CustomEvent).detail
      setZone(d?.active && d?.strip && (d.side === 'left' || d.side === 'top')
        ? { strip: d.strip, side: d.side }
        : null)
    }
    window.addEventListener(DOCK_DROP_EVENT, onDropEvt as EventListener)
    return () => window.removeEventListener(DOCK_DROP_EVENT, onDropEvt as EventListener)
  }, [])
  if (!zone) return null
  return (
    <div
      className="absolute z-40 pointer-events-none"
      style={{
        left: zone.strip.left, top: zone.strip.top, width: zone.strip.width, height: zone.strip.height,
        boxShadow: 'inset 0 0 0 2px color-mix(in oklab, var(--primary) 70%, transparent)',
        background: 'color-mix(in oklab, var(--primary) 10%, transparent)',
      }}
      aria-hidden
    >
      <div
        className={
          zone.side === 'top'
            ? 'absolute left-3 top-1/2 -translate-y-1/2 whitespace-nowrap px-2 py-1 rounded bg-primary/20 border border-primary/60 text-primary text-[11px] font-medium shadow-lg'
            : 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap px-2 py-1 rounded bg-primary/20 border border-primary/60 text-primary text-[11px] font-medium shadow-lg'
        }
      >
        {zone.side === 'top' ? 'Dock top' : 'Dock left'}
      </div>
    </div>
  )
})

/** dev/test helper — is a window drag session active? */
export function isWindowDragActive(): boolean {
  return session !== null
}
