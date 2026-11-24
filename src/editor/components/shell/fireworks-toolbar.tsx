'use client'
// ============================================================
// Fireworks Expanded Mode standard toolbar
//
// A compact, full-width command row between the menu bar and the document
// tabs. It mirrors the classic Fireworks standard toolbar (file/edit/history/
// zoom) and advertises the active Expanded Mode workspace.
// ============================================================
import { useRef } from 'react'
import {
  Copy, CornerDownLeft, Flame, Maximize2, Redo2, Save, Scissors,
  Square, Undo2, ZoomIn, ZoomOut, ClipboardPaste, FolderOpen, FilePlus2,
} from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { openFiles, saveProject } from '../../engine/io'
import { getViewport } from '../../engine/render'
import { IMPORT_ACCEPT } from '../../formats'
import { cn } from '@/lib/utils'

function ToolbarButton({
  label, icon: Icon, onClick, disabled = false, active = false,
}: {
  label: string
  icon: typeof Save
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-transparent text-foreground/80 transition-colors',
        active ? 'border-primary/50 bg-primary/15 text-primary' : 'hover:border-border hover:bg-accent hover:text-foreground',
        disabled && 'cursor-default opacity-35 hover:border-transparent hover:bg-transparent',
      )}
    >
      <Icon size={14} />
    </button>
  )
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border/80" />
}

export function FireworksToolbar() {
  const fileInput = useRef<HTMLInputElement>(null)
  const hasDoc = useEditorStore(s => !!s.activeDocId)
  const zoom = useEditorStore(s => s.zoom)
  const historyIndex = useEditorStore(s => s.historyIndex)
  const historyLabels = useEditorStore(s => s.historyLabels)
  const doc = useEditorStore(s => s.docs.find(d => d.id === s.activeDocId))
  const canUndo = hasDoc && historyIndex > 0
  const canRedo = hasDoc && historyIndex >= 0 && historyIndex < historyLabels.length - 1

  const open = () => fileInput.current?.click()
  const zoomPercent = Math.round(zoom * 100)

  return (
    <div
      data-fireworks-standard-toolbar
      role="toolbar"
      aria-label="Fireworks standard toolbar"
      className="hidden h-9 shrink-0 items-center gap-0.5 border-b border-border bg-panel px-1.5 md:flex"
    >
      <input
        ref={fileInput}
        type="file"
        data-file-purpose="document"
        accept={`${IMPORT_ACCEPT},.zproj.json`}
        multiple
        className="hidden"
        aria-label="Open files"
        onChange={event => {
          if (event.target.files?.length) void openFiles(Array.from(event.target.files))
          event.target.value = ''
        }}
      />

      <ToolbarButton label="New document" icon={FilePlus2} onClick={() => useEditorStore.getState().openDialog('new-doc')} />
      <ToolbarButton label="Open…" icon={FolderOpen} onClick={open} />
      <ToolbarButton label="Save project" icon={Save} onClick={() => { void saveProject() }} disabled={!hasDoc} />

      <Divider />

      <ToolbarButton label="Undo" icon={Undo2} onClick={() => engine.undo()} disabled={!canUndo} />
      <ToolbarButton label="Redo" icon={Redo2} onClick={() => engine.redo()} disabled={!canRedo} />

      <Divider />

      <ToolbarButton label="Cut layer" icon={Scissors} onClick={() => { engine.cutLayer() }} disabled={!hasDoc} />
      <ToolbarButton label="Copy layer" icon={Copy} onClick={() => { engine.copyLayer(false) }} disabled={!hasDoc} />
      <ToolbarButton label="Paste layer" icon={ClipboardPaste} onClick={() => { engine.pasteLayer() }} disabled={!hasDoc} />

      <Divider />

      <ToolbarButton label="Zoom out" icon={ZoomOut} onClick={() => engine.zoomBy(1 / 1.25)} disabled={!hasDoc} />
      <button
        type="button"
        className="h-7 min-w-12 shrink-0 rounded-sm border border-transparent px-1 font-mono text-[10px] tabular-nums text-foreground/85 hover:border-border hover:bg-accent"
        title="Actual pixels (100%)"
        aria-label="Actual pixels (100%)"
        disabled={!hasDoc}
        onClick={() => engine.setZoom(1)}
      >
        {zoomPercent}%
      </button>
      <ToolbarButton label="Zoom in" icon={ZoomIn} onClick={() => engine.zoomBy(1.25)} disabled={!hasDoc} />
      <ToolbarButton label="Fit on screen" icon={Maximize2} onClick={() => getViewport().fit()} disabled={!hasDoc} />

      <Divider />

      <ToolbarButton label="Zoom to selection" icon={Square} onClick={() => getViewport().fitContent()} disabled={!hasDoc} />
      <ToolbarButton label="Reset view" icon={CornerDownLeft} onClick={() => getViewport().fit()} disabled={!hasDoc} />

      <div className="ml-2 flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {doc && (
          <span className="truncate text-[10px] text-muted-foreground" title={doc.name}>
            {doc.name}{doc.dirty ? ' •' : ''}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 rounded-sm border border-primary/35 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary" title="Fireworks Expanded Mode workspace">
        <Flame size={12} />
        <span>Expanded Mode</span>
      </div>
    </div>
  )
}
