'use client'
// Chay's Photo Studio — main application shell
import { useEffect, useState } from 'react'
import * as Icons from 'lucide-react'
import { MenuBar } from './menu-bar'
import { Toolbar } from '../toolbar/toolbar'
import { ToolOptionsBar } from '../toolbar/tool-options-bar'
import { CanvasWorkspace } from '../workspace/canvas-workspace'
import { PanelDock, LeftDock } from '../panels/panel-dock'
import { TopDock } from '../panels/top-dock'
import { FloatingPanels } from '../panels/floating-panels'
import { DialogManager } from '../dialogs/dialog-manager'
import { WelcomeScreen } from './welcome-screen'
import { useKeyboardShortcuts } from '../../keyboard-shortcuts'
import { useEditorStore } from '../../store'
import { engine } from '../../engine/engine'
import { openFiles, placeImageAsSmartLayer } from '../../engine/io'
import { startAutoSave } from '../../engine/autosave'
import { dataUrlToCanvas } from '../../image-ops'
import { getViewport, setCursorCallbacks } from '../../engine/render'
import { TOOL_DEFS } from '../../constants/tools'
import { setActiveTool } from '../../tools/registry'
import type { ToolId } from '../../types'
import { PanelRight, Wrench, ImagePlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function EditorApp() {
  const hasDoc = useEditorStore(s => !!s.activeDocId)
  const [theme, setTheme] = useState<'dark' | 'light' | 'oled'>(() => {
    if (typeof window === 'undefined') return 'dark'
    const saved = window.localStorage.getItem('chays-photo-studio-theme')
    return saved === 'light' || saved === 'oled' || saved === 'dark' ? saved : 'dark'
  })
  const [mobilePanels, setMobilePanels] = useState(false)
  const [mobileTools, setMobileTools] = useState(false)
  const [dropping, setDropping] = useState(false)

  useKeyboardShortcuts()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme !== 'light')
    document.documentElement.classList.toggle('oled', theme === 'oled')
    document.documentElement.classList.toggle('zphoto', true)
    window.localStorage.setItem('chays-photo-studio-theme', theme)
  }, [theme])

  // engine → store bridge + ui bridge
  useEffect(() => {
    ;(window as any).__zphotoEngine = engine
    ;(window as any).__zphotoStore = useEditorStore
    const sync = () => useEditorStore.getState().syncFromEngine()
    sync()
    engine.ui = {
      openDialog: (type, props) => useEditorStore.getState().openDialog(type, props),
      toast: (msg, type) => useEditorStore.getState().pushToast(msg, type),
    }
    engine.loadPersistedActions()
    const unsub = engine.onChange(sync)
    const stopAutoSave = startAutoSave()
    setCursorCallbacks({
      onCursorMove: (x, y) => {
        // lightweight status update — direct store set to avoid full sync
        const s = useEditorStore.getState()
        if (s.cursor?.x !== Math.round(x) || s.cursor?.y !== Math.round(y)) {
          useEditorStore.setState({ cursor: { x, y } })
        }
      },
    })
    return () => {
      unsub()
      stopAutoSave()
    }
  }, [])

  // Protect unsaved work from accidental tab/window closes. Browsers display
  // their own confirmation text for beforeunload.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!engine.docs.some(d => d.dirty)) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // drag & drop files (window-level, the app's single drop entry point):
  // a single image + an open document → Photoshop-style place as Smart Object
  // layer; otherwise open as documents (project files too). The depth counter
  // keeps the overlay stable while hovering nested elements.
  // INTERNAL result drags (AI Generate preview → canvas) carry the
  // 'text/x-chays-result' marker and are placed at the drop point.
  useEffect(() => {
    let depth = 0
    const isResultDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('text/x-chays-result')
    const placeGeneratedAtPoint = async (dataUrl: string, clientX: number, clientY: number) => {
      try {
        const canvas = await dataUrlToCanvas(dataUrl)
        let doc = engine.activeDoc
        if (!doc) {
          engine.newDocument({ name: 'Generated Image', width: canvas.width, height: canvas.height, fill: 'transparent' })
          doc = engine.activeDoc
          if (!doc) return
        }
        // drop point → document space (canvas-host coords → pan/zoom)
        const host = getViewport().host
        const rect = host?.getBoundingClientRect()
        const docX = rect ? (clientX - rect.left - doc.view.panX) / doc.view.zoom : doc.width / 2
        const docY = rect ? (clientY - rect.top - doc.view.panY) / doc.view.zoom : doc.height / 2
        const layer = engine.addLayerFromCanvas(canvas, 'Generated Image')
        if (layer && (canvas.width !== doc.width || canvas.height !== doc.height)) {
          // native-size layer: position its center on the drop point (kept
          // within the doc so the drop always lands visibly on canvas)
          const cx = Math.min(Math.max(docX, 0), doc.width)
          const cy = Math.min(Math.max(docY, 0), doc.height)
          layer.offsetX = Math.round(cx - canvas.width / 2)
          layer.offsetY = Math.round(cy - canvas.height / 2)
          engine.emit()
        }
        useEditorStore.getState().pushToast('Placed generated image at the drop point', 'success')
      } catch {
        useEditorStore.getState().pushToast("Couldn't place the generated image", 'error')
      }
    }
    const filesOf = (e: DragEvent) => Array.from(e.dataTransfer?.files ?? [])
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDropping(false)
      // AI Generate result drag → place as a layer at the drop point
      if (isResultDrag(e)) {
        const stash = (window as any).__chaysDragResult as { dataUrl: string } | undefined
        ;(window as any).__chaysDragResult = null
        if (stash?.dataUrl) void placeGeneratedAtPoint(stash.dataUrl, e.clientX, e.clientY)
        return
      }
      const files = filesOf(e)
      if (!files.length) return
      const projects = files.filter(f => f.name.endsWith('.zproj.json'))
      const images = files.filter(f => f.type.startsWith('image/') && !f.name.endsWith('.zproj.json'))
      const others = files.filter(f => !f.type.startsWith('image/') && !f.name.endsWith('.zproj.json'))
      if (others.length) useEditorStore.getState().pushToast(`Skipped ${others.length} non-image file${others.length > 1 ? 's' : ''}`, 'error')
      if (projects.length) void openFiles(projects)
      if (images.length === 1 && engine.activeDoc) {
        void placeImageAsSmartLayer(images[0])
      } else if (images.length) {
        void openFiles(images)
      }
    }
    const onDragOver = (e: DragEvent) => {
      // FILE drags: the whole window is a drop target for opening images —
      // cancel + 'copy' so the browser lets the file land anywhere.
      // INTERNAL drags (toolbar tools, layers, timeline frames) carry only
      // text/plain: leave them to their own handlers. Stomping dropEffect
      // to 'copy' here made every effectAllowed='move' drag mismatch, so
      // Chromium refused to dispatch the drop event at all (drags "not
      // working" / flaky depending on whether the last event before the
      // release happened to be a dragenter).
      // AI result drags are also internal, but must land on the canvas:
      // cancel them so the browser dispatches the drop.
      if (isResultDrag(e)) {
        e.preventDefault()
        e.dataTransfer!.dropEffect = 'copy'
        return
      }
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      depth++
      if (e.dataTransfer?.types?.includes('Files') || isResultDrag(e)) setDropping(true)
    }
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDropping(false)
    }
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    return () => {
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
    }
  }, [])

  // deep link / browser-plugin import: `?url=<image>` opens that image
  // (used by the browser plugin's "Edit image in Chay's Photo Studio"
  // context menu and by external links). Runs once; the param is then
  // stripped so reloads don't re-import.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('url') || params.get('image') || params.get('src')
    if (!raw) return
    for (const k of ['url', 'image', 'src']) params.delete(k)
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
    const url = raw.startsWith('/') ? new URL(raw, window.location.origin).href : raw
    void (async () => {
      try {
        const res = await fetch(url, { mode: 'cors' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        if (!blob.type.startsWith('image/')) throw new Error('not an image')
        const nameFromUrl = decodeURIComponent(url.split('/').pop()?.split('?')[0] || '')
        const file = new File([blob], nameFromUrl || 'image.png', { type: blob.type })
        await openFiles([file])
        useEditorStore.getState().pushToast('Opened image from link', 'success')
      } catch {
        useEditorStore.getState().pushToast("Couldn't load the image from that link — the site may block cross-origin requests. Save it to your device and drop it here instead.", 'error')
      }
    })()
  }, [])

  // Electron desktop launches: images opened via file association /
  // "Open with" arrive as `chays:open-file` DOM events carrying a
  // File or File[] (bridged by src/app/native-bridges.tsx). No-op
  // in the browser.
  useEffect(() => {
    const onOpenFile = (e: Event) => {
      const detail = (e as CustomEvent<File | File[]>).detail
      const files = detail instanceof File ? [detail] : Array.isArray(detail) ? detail.filter(f => f instanceof File) : []
      if (files.length) void openFiles(files)
    }
    window.addEventListener('chays:open-file', onOpenFile as EventListener)
    return () => window.removeEventListener('chays:open-file', onOpenFile as EventListener)
  }, [])

  // keep zoom display fresh
  useEffect(() => {
    const id = setInterval(() => {
      const doc = engine.activeDoc
      if (doc) {
        const s = useEditorStore.getState()
        if (Math.abs(s.zoom - doc.view.zoom) > 0.001) useEditorStore.setState({ zoom: doc.view.zoom })
      }
    }, 400)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground font-sans select-none" style={{ ['--ws-bg' as any]: 'var(--workspace)' }}>
      <MenuBar theme={theme} setTheme={setTheme} />
      <div className="flex-1 min-h-0 flex flex-col-reverse md:flex-row">
        {/* mobile: panels drawer above canvas; desktop: toolbar + left dock + canvas + right dock */}
        <div className="flex flex-1 min-h-0 min-w-0">
          <div className="hidden md:flex flex-col">
            <Toolbar />
          </div>
          <LeftDock />
          <div data-workspace className="flex flex-1 min-w-0 flex-col">
            <div className="md:hidden">
              <Toolbar compact />
            </div>
            <ToolOptionsBar />
            {/* top dock strip — panels dropped at the top of the canvas dock here */}
            <TopDock />
            {hasDoc ? <CanvasWorkspace /> : (
              <div className="flex-1 flex flex-col min-h-0">
                <WelcomeScreen />
                <MobileStatusBar />
              </div>
            )}
          </div>
        </div>
        {/* desktop right dock (self-hides below md) */}
        <PanelDock />
        {/* mobile drawer */}
        {mobilePanels && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div className="flex-1 bg-black/50" onClick={() => setMobilePanels(false)} />
            <div className="w-[85vw] max-w-xs h-full shadow-2xl animate-in slide-in-from-right-4">
              <PanelDock mobile />
            </div>
          </div>
        )}
      </div>

      {/* floating panel windows (fixed click-through layer, above workspace) */}
      <FloatingPanels />

      {/* toasts */}
      <Toasts />
      <DialogManager />
      <MobileToolsToggle
        onOpenPanels={() => setMobilePanels(v => !v)}
        panelsOpen={mobilePanels}
        onOpenTools={() => setMobileTools(v => !v)}
        toolsOpen={mobileTools}
      />
      {mobileTools && <MobileToolsSheet onClose={() => setMobileTools(false)} />}
      {/* drop overlay (drag images onto the app) */}
      {dropping && (
        <div className="fixed inset-0 z-[90] pointer-events-none flex items-center justify-center p-4">
          <div className="absolute inset-4 border-2 border-dashed border-primary/70 rounded-xl bg-primary/5" />
          <div className="relative bg-panel/95 border rounded-lg px-8 py-5 text-center shadow-2xl">
            <ImagePlus size={26} className="mx-auto text-primary mb-2" aria-hidden />
            <div className="text-sm font-medium">Drop images here</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {engine.activeDoc
                ? 'A single image is placed as a Smart Object layer in this document'
                : 'Images open as new documents'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Toasts() {
  const toasts = useEditorStore(s => s.toasts)
  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={cn(
            'px-3 py-1.5 rounded-md border shadow-lg text-xs animate-in fade-in slide-in-from-bottom-2 pointer-events-auto',
            t.type === 'success' ? 'bg-primary text-primary-foreground border-primary' :
            t.type === 'error' ? 'bg-destructive text-white border-destructive' :
            'bg-popover text-popover-foreground border-border'
          )}
          role="status"
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}

function MobileStatusBar() {
  return (
    <div className="h-7 flex items-center px-3 bg-panel border-t text-[10px] text-muted-foreground flex-shrink-0">
      Ready — open an image or create a document
    </div>
  )
}

function MobileToolsToggle({ onOpenPanels, panelsOpen, onOpenTools, toolsOpen }: {
  onOpenPanels(): void
  panelsOpen: boolean
  onOpenTools(): void
  toolsOpen: boolean
}) {
  return (
    <div className="md:hidden fixed right-3 bottom-11 z-40 flex flex-col gap-2">
      <button
        className="w-11 h-11 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        onClick={onOpenPanels}
        aria-label="Toggle panels"
        title="Panels"
      >
        <PanelRight size={18} />
      </button>
      <button
        className={cn(
          'w-11 h-11 rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform',
          toolsOpen || panelsOpen ? 'bg-muted text-foreground' : 'bg-secondary text-secondary-foreground'
        )}
        onClick={onOpenTools}
        aria-label="Quick tools"
        aria-expanded={toolsOpen}
        title="Quick tools — jump to any tool"
      >
        <Wrench size={18} />
      </button>
    </div>
  )
}

/** bottom sheet with the full grouped tool list — the wrench button's payload */
function MobileToolsSheet({ onClose }: { onClose(): void }) {
  const activeTool = useEditorStore(s => s.activeTool)

  const groups: [number, ToolId[]][] = (() => {
    const map = new Map<number, ToolId[]>()
    for (const def of TOOL_DEFS) {
      if (!map.has(def.group)) map.set(def.group, [])
      map.get(def.group)!.push(def.id)
    }
    return [...map.entries()]
  })()

  const pick = (id: ToolId) => {
    activateTool(id)
    onClose()
  }

  return (
    <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-label="Quick tools">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="bg-panel border-t rounded-t-xl max-h-[65vh] flex flex-col animate-in slide-in-from-bottom-4 duration-200 shadow-2xl">
        <div className="flex items-center px-4 h-10 border-b flex-shrink-0">
          <span className="text-xs font-semibold">Tools</span>
          <span className="flex-1" />
          <button
            type="button"
            className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
            onClick={onClose}
            aria-label="Close quick tools"
          >
            <X size={15} />
          </button>
        </div>
        <div className="overflow-y-auto p-3 flex flex-col gap-3">
          {groups.map(([group, tools]) => (
            <div key={group} className="grid grid-cols-4 gap-1.5">
              {tools.map(id => {
                const def = TOOL_DEFS.find(t => t.id === id)!
                const Icon = (Icons as any)[def.icon] ?? Icons.MousePointer2
                return (
                  <button
                    key={id}
                    type="button"
                    className={cn(
                      'flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg border transition-colors min-h-[64px]',
                      activeTool === id
                        ? 'border-primary/60 bg-primary/10 text-primary'
                        : 'border-border bg-background/40 text-muted-foreground hover:text-foreground hover:bg-accent/40'
                    )}
                    onClick={() => pick(id)}
                    aria-pressed={activeTool === id}
                  >
                    <Icon size={18} strokeWidth={1.75} />
                    <span className="text-[9px] leading-tight text-center truncate w-full">{def.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// export viewport accessor for menus
export function fitViewport() {
  getViewport().fit()
}

/** shared tool activation — store + tools registry + engine tracking */
function activateTool(id: ToolId) {
  useEditorStore.getState().setTool(id)
  setActiveTool(id)
  ;(engine as any)._activeToolId = id
}
