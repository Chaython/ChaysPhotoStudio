'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { getViewport, setCursorCallbacks, setCurrentToolIdProvider } from '../../engine/render'
import { useEditorStore } from '../../store'
import { engine } from '../../engine/engine'
import { setActiveTool, getActiveToolId } from '../../tools/registry'
import { pickLayerAt } from '../../tools/shared'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { CanvasLayerMenuContent } from './canvas-context-menu'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ZoomIn, ZoomOut, Maximize2, Frame } from 'lucide-react'
import { cn } from '@/lib/utils'
import { canvasPixelCapabilities, fileToCanvas } from '../../utils/canvas'
import { TOOL_MAP } from '../../constants/tools'
import { DocumentTabs } from './document-tabs'
import { NativeModuleShell } from '../panels/native-module-shell'

export function CanvasWorkspace() {
  const hostRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLCanvasElement>(null)
  const activeDocId = useEditorStore(s => s.activeDocId)
  const activeTool = useEditorStore(s => s.activeTool)
  const renderTick = useEditorStore(s => s.renderTick)

  useEffect(() => {
    const host = hostRef.current
    const main = mainRef.current
    const overlay = overlayRef.current
    const cursor = cursorRef.current
    if (!host || !main || !overlay) return
    const vp = getViewport()
    vp.mount(host, main, overlay, cursor ?? undefined)
    setCurrentToolIdProvider(() => {
      // read live from store (avoids stale closure)
      return useEditorStore.getState().activeTool
    })
    setCursorCallbacks({
      // lightweight status-bar updates — NEVER a full syncFromEngine here (it
      // re-renders every subscribed panel on each pointer move → paint lag)
      onCursorMove: (x, y) => {
        const s = useEditorStore.getState()
        const rx = Math.round(x), ry = Math.round(y)
        if (s.cursor?.x !== rx || s.cursor?.y !== ry) useEditorStore.setState({ cursor: { x: rx, y: ry } })
      },
      onZoomChange: (z) => {
        const s = useEditorStore.getState()
        if (Math.abs(s.zoom - z) > 0.0005) useEditorStore.setState({ zoom: z })
      },
    })
    ;(window as any).__zphotoViewport = vp
    return () => vp.unmount()
  }, [])

  // brush-size / tool-option changes must refresh the cursor ring immediately
  useEffect(() => {
    const vp = (window as any).__zphotoViewport
    vp?.pokeOverlay()
    const cc = cursorRef.current
    if (cc && vp?.cursorCanvas) {
      // force one cursor-layer repaint by nudging through a private render tick
      ;(vp as any).renderCursorNow?.()
    }
  }, [renderTick, activeTool])

  // fit docs the FIRST time they become visible; never re-fit afterwards —
  // each document's zoom/pan lives in doc.view and is sticky across tab
  // switches (autoFit false = the doc already has a concrete view). Ctrl+0
  // (Fit on Screen) is the explicit way to re-fit a document.
  useEffect(() => {
    const vp = (window as any).__zphotoViewport
    if (!vp || !activeDocId) return
    const doc = engine.docs.find(d => d.id === activeDocId)
    if (!doc || doc.view.autoFit === false) return
    requestAnimationFrame(() => vp.fit())
  }, [activeDocId])

  // tool switching side effects
  useEffect(() => {
    setActiveTool(activeTool)
    ;(engine as any)._activeToolId = activeTool
    const vp = (window as any).__zphotoViewport
    const cursor = TOOL_MAP[activeTool]?.cursor ?? 'default'
    vp?.setCursorCss(cursor)
  }, [activeTool])

  // ---- OS clipboard paste (right-click → Paste, or Ctrl+V when the internal
  // clipboard is empty and the keydown handler let the default through) ----
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const file = it.getAsFile()
          if (file) {
            e.preventDefault()
            void (async () => {
              try {
                const c = await fileToCanvas(file)
                engine.addLayerFromCanvas(c, 'Pasted Image')
                useEditorStore.getState().pushToast('Pasted image as a new layer', 'success')
              } catch { /* bad image — ignore */ }
            })()
            return
          }
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
  // (drag & drop lives at the app level — see editor-app.tsx: single window
  // entry point, smart-place vs open routing + the drop overlay)

  // ---- right-click layer context menu (Move tool) ----
  // Radix opens the menu on right-click over the canvas host; this handler
  // runs FIRST (Radix composes it before its own) and picks the subject: the
  // layer under the cursor (also made active, Photoshop-style) or the active
  // layer. The engine's Viewport lets the event through un-prevented when the
  // move tool is active (see render.ts onContextMenu) so Radix can open.
  const [ctxLayerId, setCtxLayerId] = useState<string | null>(null)
  const onCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    const doc = engine.activeDoc
    if (!doc) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const docX = (e.clientX - rect.left - doc.view.panX) / doc.view.zoom
    const docY = (e.clientY - rect.top - doc.view.panY) / doc.view.zoom
    const hit = docX >= 0 && docY >= 0 && docX < doc.width && docY < doc.height ? pickLayerAt(docX, docY) : null
    const subject = hit ?? doc.activeLayerId
    if (!subject) { setCtxLayerId(null); return }
    const selected = doc.selectedLayerIds ?? []
    if (!selected.includes(subject)) doc.selectedLayerIds = [subject]
    if (doc.activeLayerId !== subject || !selected.includes(subject)) {
      doc.activeLayerId = subject
      engine.emit()
    }
    setCtxLayerId(subject)
  }, [])
  const ctxMenuEnabled = activeTool === 'move' && !!activeDocId

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-workspace">
      {/* Open files is native here by default, but can be floated/docked on desktop. */}
      <div className="md:hidden">
        <DocumentTabs />
      </div>
      <div className="hidden md:block">
        <NativeModuleShell id="documents" axis="horizontal">
          <DocumentTabs embedded />
        </NativeModuleShell>
      </div>

      {/* canvas host — wrapped as the right-click context-menu trigger (Move tool) */}
      <div className="relative flex-1 min-h-0 overflow-hidden" style={{ ['--workspace-bg' as any]: 'var(--ws-bg)' }}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div ref={hostRef} className="absolute inset-0 touch-none" onContextMenu={onCanvasContextMenu}>
              <canvas ref={mainRef} className="absolute inset-0" />
              <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />
              <canvas ref={cursorRef} className="absolute inset-0 pointer-events-none" />
            </div>
          </ContextMenuTrigger>
          {ctxMenuEnabled && ctxLayerId && <CanvasLayerMenuContent layerId={ctxLayerId} />}
        </ContextMenu>
        {!activeDocId && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <TextLayerEditor />
          </div>
        )}
        {activeDocId && <TextLayerEditor />}
        <ViewControls />
      </div>
      <StatusBar />
    </div>
  )
}

/** on-canvas view controls: zoom out/in, fit-to-page, fit-content (blank
 *  space), 100% — mirrored in View menu + shortcuts (Ctrl+0 / Ctrl+Shift+0) */
function ViewControls() {
  const zoom = useEditorStore(s => s.zoom)
  const hasDoc = useEditorStore(s => !!s.activeDocId)
  const btn = 'h-7 w-7 flex items-center justify-center text-white/75 hover:text-white hover:bg-white/10 rounded transition-colors disabled:opacity-40 disabled:pointer-events-none'
  return (
    <div
      className="absolute bottom-2 right-2 flex items-center gap-0.5 bg-black/65 backdrop-blur-sm border border-white/10 rounded-lg px-1 py-0.5 pointer-events-auto shadow-lg"
      role="group"
      aria-label="View zoom controls"
    >
      <button className={btn} disabled={!hasDoc} aria-label="Zoom out" title="Zoom out (Ctrl+-)" onClick={() => engine.zoomBy(1 / 1.25)}>
        <ZoomOut size={13} />
      </button>
      <button
        className="h-7 min-w-11 px-1 text-[10px] font-mono text-white/85 hover:text-white hover:bg-white/10 rounded transition-colors"
        aria-label="Actual pixels (100%)"
        title="Actual pixels (Ctrl+1)"
        onClick={() => engine.setZoom(1)}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button className={btn} disabled={!hasDoc} aria-label="Zoom in" title="Zoom in (Ctrl+=)" onClick={() => engine.zoomBy(1.25)}>
        <ZoomIn size={13} />
      </button>
      <span className="w-px h-4 bg-white/15 mx-0.5" aria-hidden />
      <button
        className={btn}
        disabled={!hasDoc}
        aria-label="Fit to page"
        title="Fit to page — whole document in view (Ctrl+0)"
        onClick={() => { const v = (window as any).__zphotoViewport; v?.fit() }}
      >
        <Maximize2 size={13} />
      </button>
      <button
        className={btn}
        disabled={!hasDoc}
        aria-label="Fit blank space (content)"
        title="Fit content — zoom to the layers, skipping the blank background margins (Ctrl+Shift+0)"
        onClick={() => { const v = (window as any).__zphotoViewport; v?.fitContent() }}
      >
        <Frame size={13} />
      </button>
    </div>
  )
}

function StatusBar() {
  const cursor = useEditorStore(s => s.cursor)
  const doc = useEditorStore(s => s.docs.find(d => d.id === s.activeDocId))
  const hasSelection = useEditorStore(s => s.hasSelection)
  const progress = useEditorStore(s => s.progress)
  const setRightPanelTab = useEditorStore(s => s.setRightPanelTab)
  const renderTick = useEditorStore(s => s.renderTick)
  void renderTick // re-renders the GPU badge when the toggle changes state
  const gpuActive = engine.isGpuActive()
  const gpuInfo = engine.gpuInfo()
  const pixelCaps = canvasPixelCapabilities()
  const engineDoc = engine.activeDoc
  const workingBits = engineDoc?.workingBitDepth ?? 8
  const sourceBits = engineDoc?.sourceBitDepth ?? workingBits
  const precisionLabel = engineDoc
    ? `${workingBits}-bit ${engineDoc.workingColorSpace === 'display-p3' ? 'Display-P3' : 'sRGB'} working raster`
    : '8-bit sRGB working raster'
  const precisionTitle = [
    `Current editable raster storage: ${workingBits}-bit ${engineDoc?.workingColorSpace === 'display-p3' ? 'Display-P3' : 'sRGB'}.`,
    sourceBits > workingBits ? `Source was ${sourceBits}-bit and is currently normalized to ${workingBits}-bit for editing.` : '',
    pixelCaps.float16Context || pixelCaps.float16ImageData
      ? 'This runtime supports float16 Canvas/ImageData APIs; the editor does not silently enable them because existing pixel processors still use 0..255 ImageData semantics.'
      : 'This runtime did not expose a usable float16 Canvas/ImageData path.',
    pixelCaps.displayP3 ? 'Display-P3 canvas capability detected.' : '',
  ].filter(Boolean).join(' ')
  const measurement = (window as any).__zphotoMeasure as { length: number; angleDeg: number } | undefined
  return (
    <div className="h-7 flex items-center gap-4 px-3 bg-panel border-t text-[10px] text-muted-foreground flex-shrink-0 overflow-hidden">
      {progress?.active ? (
        <span className="text-primary font-medium animate-pulse">{progress.label}… {Math.round(progress.value * 100)}%</span>
      ) : (
        <>
          <button className="hover:text-foreground" onClick={() => setRightPanelTab('navigator')}>
            {doc ? `${doc.width} × ${doc.height} px` : '—'}
          </button>
          <span className="hidden sm:inline">Fit: Ctrl+0 · Content: Ctrl+Shift+0 · Grid: Ctrl+'</span>
          <span className="font-mono">
            {cursor ? `X: ${Math.round(cursor.x)}  Y: ${Math.round(cursor.y)}` : 'X: —  Y: —'}
          </span>
          <span>{hasSelection ? 'Selection active' : 'No selection'}</span>
          {measurement && measurement.length > 0 && (
            <span className="font-mono hidden md:inline">M: {measurement.length.toFixed(1)}px ∠{measurement.angleDeg.toFixed(1)}°</span>
          )}
          <span className="ml-auto hidden md:inline flex items-center gap-1.5">
            {/* GPU acceleration indicator */}
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${gpuActive ? 'bg-emerald-400' : 'bg-amber-400'}`}
              title={gpuInfo.supported ? `${gpuInfo.renderer}` : 'WebGL2 unavailable'}
              aria-hidden
            />
            {gpuActive ? 'GPU' : 'CPU'}
            <span className="text-muted-foreground/60" title={precisionTitle}>
              · Chay's Photo Studio · {precisionLabel}
              {(pixelCaps.float16Context || pixelCaps.float16ImageData) ? ' · 16F capable' : ''}
              · non-destructive engine
            </span>
          </span>
        </>
      )}
    </div>
  )
}

// quick text layer editor shown when a text layer is active
function TextLayerEditor() {
  const activeLayerId = useEditorStore(s => s.activeLayerId)
  const tick = useEditorStore(s => s.renderTick)
  const [editing, setEditing] = useState(false)
  const doc = engine.activeDoc
  const layer = doc?.layers.find(l => l.id === activeLayerId)
  const isText = layer?.kind === 'text' && layer.text
  if (!isText) return null
  const t = layer!.text!
  return editing || t.content === '' ? (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-panel border rounded-lg shadow-xl p-3 w-80 pointer-events-auto">
      <Textarea
        autoFocus
        defaultValue={t.content}
        className="h-24 text-xs bg-background"
        placeholder="Type text…"
        onKeyDown={e => {
          if (e.key === 'Escape') { setEditing(false); (e.target as HTMLTextAreaElement).blur() }
        }}
        onChange={e => {
          engine.setLayerProps(layer!.id, { text: { ...t, content: e.target.value } }, { history: false })
        }}
        onBlur={() => setEditing(false)}
      />
      <div className="flex gap-2 mt-2">
        <Button size="sm" variant="secondary" className="h-6 text-[11px]" onClick={() => { engine.setLayerProps(layer!.id, { text: { ...t, content: t.content } }); setEditing(false) }}>
          Done
        </Button>
      </div>
    </div>
  ) : (
    <button
      key={`${tick}-${t.content.length}`}
      className="absolute top-2 left-1/2 -translate-x-1/2 z-30 bg-panel/90 border rounded px-2.5 py-1 text-[10px] text-muted-foreground hover:text-foreground pointer-events-auto"
      onClick={() => setEditing(true)}
    >
      ✎ Edit text: “{t.content.slice(0, 30)}{t.content.length > 30 ? '…' : ''}”
    </button>
  )
}
