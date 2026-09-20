'use client'

import { useMemo, useState } from 'react'
import { Copy, Eye, EyeOff, MousePointer2, PenTool, ShieldCheck, Trash2 } from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import type { SavedPath } from '../../types'
import { loadSavedPathIntoPen } from '../../tools/pen'

function pathSummary(path: SavedPath) {
  const n = path.anchors.length
  return `${n} anchor${n === 1 ? '' : 's'} · ${path.closed ? 'closed' : 'open'}`
}

export function PathsPanel() {
  const renderTick = useEditorStore(s => s.renderTick)
  void renderTick
  const setTool = useEditorStore(s => s.setTool)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const paths = engine.activeDoc?.savedPaths ?? []
  const selected = useMemo(
    () => paths.find(p => p.id === selectedId) ?? paths[paths.length - 1] ?? null,
    [paths, selectedId],
  )

  const edit = (path: SavedPath) => {
    setSelectedId(path.id)
    setTool('pen')
    loadSavedPathIntoPen(path)
  }

  const rename = (path: SavedPath) => {
    const next = prompt('Path name:', path.name)?.trim()
    if (!next || next === path.name) return
    engine.updateSavedPath(path.id, { name: next }, 'Rename Path')
  }

  return (
    <div className="p-2 flex min-h-0 flex-col gap-2 text-xs" aria-label="Paths panel">
      <div className="flex items-center justify-between">
        <div className="font-medium flex items-center gap-1.5"><PenTool size={13} /> Paths</div>
        <button
          className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-accent"
          onClick={() => setTool('pen')}
          title="Activate Pen Tool"
        >
          New Path
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border">
        {!paths.length ? (
          <div className="p-3 text-[10px] leading-relaxed text-muted-foreground">
            No saved paths. Choose <b>Save Work Path</b> in the Pen tool and press Enter after drawing.
          </div>
        ) : paths.map(path => {
          const active = selected?.id === path.id
          return (
            <div
              key={path.id}
              className={[
                'flex items-center gap-1 border-b border-border/70 px-1.5 py-1.5 last:border-b-0',
                active ? 'bg-primary/10' : 'hover:bg-accent/50',
              ].join(' ')}
              onClick={() => setSelectedId(path.id)}
              onDoubleClick={() => edit(path)}
            >
              <button
                className="p-1 text-muted-foreground hover:text-foreground"
                title={path.visible ? 'Hide path overlay' : 'Show path overlay'}
                onClick={e => {
                  e.stopPropagation()
                  engine.updateSavedPath(path.id, { visible: !path.visible }, path.visible ? 'Hide Path' : 'Show Path')
                }}
              >
                {path.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button
                className="min-w-0 flex-1 text-left"
                onDoubleClick={e => { e.stopPropagation(); rename(path) }}
                title="Double-click name to rename"
              >
                <div className="truncate font-medium">{path.name}</div>
                <div className="truncate text-[9px] text-muted-foreground">{pathSummary(path)}</div>
              </button>
              <button
                className="p-1 text-muted-foreground hover:text-foreground"
                title="Edit with Pen Tool"
                onClick={e => { e.stopPropagation(); edit(path) }}
              >
                <PenTool size={12} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-3 gap-1">
        <button
          className="flex items-center justify-center gap-1 rounded border border-border px-1 py-1.5 hover:bg-accent disabled:opacity-40"
          disabled={!selected}
          onClick={() => selected && engine.savedPathToSelection(selected.id, 'new')}
          title="Load path as a selection"
        >
          <MousePointer2 size={11} /> Select
        </button>
        <button
          className="flex items-center justify-center gap-1 rounded border border-border px-1 py-1.5 hover:bg-accent disabled:opacity-40"
          disabled={!selected || !engine.activeLayer || engine.activeLayer.kind === 'adjustment'}
          onClick={() => {
            if (!selected || !engine.activeLayer) return
            engine.addVectorMaskFromPath(engine.activeLayer.id, selected.id)
          }}
          title="Use this path as a non-destructive vector mask on the active layer"
        >
          <ShieldCheck size={11} /> V.Mask
        </button>
        <button
          className="flex items-center justify-center gap-1 rounded border border-border px-1 py-1.5 hover:bg-accent disabled:opacity-40"
          disabled={!selected}
          onClick={() => selected && engine.duplicateSavedPath(selected.id)}
        >
          <Copy size={11} /> Copy
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          className="flex-1 rounded border border-border px-1.5 py-1.5 hover:bg-accent disabled:opacity-40"
          disabled={!selected}
          onClick={() => selected && edit(selected)}
        >
          Load in Pen
        </button>
        <button
          className="p-1.5 rounded border border-border hover:bg-destructive/15 hover:text-destructive disabled:opacity-40"
          disabled={!selected}
          title="Delete selected path"
          onClick={() => {
            if (!selected) return
            engine.deleteSavedPath(selected.id)
            setSelectedId(null)
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="text-[9px] leading-relaxed text-muted-foreground">
        Double-click a path to edit it. Saved paths persist in project files, convert to selections, or become editable non-destructive vector masks.
      </div>
    </div>
  )
}
