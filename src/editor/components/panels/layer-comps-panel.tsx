'use client'

import { useState } from 'react'
import {
  Check, ChevronLeft, ChevronRight, Copy, Layers, Pencil, Plus, RefreshCw,
  RotateCcw, Trash2, TriangleAlert,
} from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { cn } from '@/lib/utils'

export function LayerCompsPanel() {
  const tick = useEditorStore(s => s.renderTick)
  void tick
  const doc = engine.activeDoc
  const comps = doc?.layerComps ?? []
  const activeId = doc?.activeLayerCompId ?? null
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState(true)
  const [position, setPosition] = useState(true)
  const [appearance, setAppearance] = useState(true)

  const create = () => {
    if (!doc) return
    const fallback = `Layer Comp ${comps.length + 1}`
    const comp = engine.createLayerComp(name.trim() || fallback, { visibility, position, appearance })
    if (!comp) return
    setName('')
    useEditorStore.getState().pushToast(`Created “${comp.name}”`, 'success')
  }

  const rename = (id: string, current: string) => {
    const next = window.prompt('Rename Layer Comp:', current)
    if (next === null) return
    engine.renameLayerComp(id, next)
  }

  if (!doc) {
    return <div className="p-4 text-[11px] text-muted-foreground text-center">Open a document to use Layer Comps.</div>
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="p-2 border-b space-y-2 bg-panel/40">
        <div className="flex items-center gap-1">
          <input
            value={name}
            onChange={e => setName(e.target.value.slice(0, 80))}
            onKeyDown={e => { if (e.key === 'Enter') create() }}
            placeholder={`Layer Comp ${comps.length + 1}`}
            className="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-[11px] outline-none focus:border-primary/60"
            aria-label="New Layer Comp name"
          />
          <button
            type="button"
            className="h-8 px-2.5 rounded border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1 text-[10px]"
            onClick={create}
            title="Create Layer Comp from the current document state"
          >
            <Plus size={12} /> New
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span className="text-[9px] uppercase tracking-wide">Record</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={visibility} onChange={e => setVisibility(e.target.checked)} />
            Visibility
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={position} onChange={e => setPosition(e.target.checked)} />
            Position
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={appearance} onChange={e => setAppearance(e.target.checked)} />
            Appearance
          </label>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="h-7 w-8 rounded border text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-35"
            onClick={() => engine.cycleLayerComp(-1)}
            disabled={!comps.length}
            title="Previous Layer Comp"
            aria-label="Previous Layer Comp"
          >
            <ChevronLeft size={13} className="mx-auto" />
          </button>
          <button
            type="button"
            className="h-7 w-8 rounded border text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-35"
            onClick={() => engine.cycleLayerComp(1)}
            disabled={!comps.length}
            title="Next Layer Comp"
            aria-label="Next Layer Comp"
          >
            <ChevronRight size={13} className="mx-auto" />
          </button>
          <button
            type="button"
            className="h-7 px-2 rounded border text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-35 flex items-center gap-1"
            onClick={() => engine.restoreLastLayerCompState()}
            disabled={!doc.lastLayerCompState}
            title="Restore the document state from before Layer Comps were applied"
          >
            <RotateCcw size={11} /> Last Document State
          </button>
          <span className="ml-auto text-[9px] text-muted-foreground">{comps.length} comp{comps.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto zphoto-scroll">
        {comps.map(comp => {
          const active = activeId === comp.id
          const missingLayers = Object.keys(comp.layers).some(id => !doc.layers.some(l => l.id === id))
          return (
            <div
              key={comp.id}
              className={cn(
                'group border-b border-border/35 flex items-stretch',
                active ? 'bg-accent/70 border-l-2 border-l-primary' : 'hover:bg-accent/25',
              )}
            >
              <button
                type="button"
                onClick={() => engine.applyLayerComp(comp.id)}
                onDoubleClick={() => rename(comp.id, comp.name)}
                className="min-w-0 flex-1 text-left px-2 py-2"
                title="Apply Layer Comp · double-click to rename"
              >
                <div className="flex items-center gap-1.5">
                  {active ? <Check size={11} className="text-primary shrink-0" /> : <Layers size={11} className="text-muted-foreground shrink-0" />}
                  <span className="truncate text-[11px] font-medium">{comp.name}</span>
                  {missingLayers && <TriangleAlert size={10} className="text-amber-500 shrink-0" aria-label="Some recorded layers no longer exist" />}
                </div>
                <div className="mt-1 flex items-center gap-1 pl-[18px] text-[8px] uppercase tracking-wide">
                  {comp.options.visibility && <span className="rounded border px-1 text-muted-foreground">V</span>}
                  {comp.options.position && <span className="rounded border px-1 text-muted-foreground">P</span>}
                  {comp.options.appearance && <span className="rounded border px-1 text-muted-foreground">A</span>}
                  <span className="ml-1 text-muted-foreground/60 normal-case tracking-normal">
                    updated {new Date(comp.updatedAt).toLocaleTimeString()}
                  </span>
                </div>
                {comp.comment && <div className="pl-[18px] mt-1 truncate text-[9px] text-muted-foreground">{comp.comment}</div>}
              </button>

              <div className="flex items-center pr-1 opacity-50 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  className="h-7 w-7 grid place-items-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                  onClick={() => engine.updateLayerComp(comp.id)}
                  title="Update this comp from current document state"
                  aria-label={`Update ${comp.name}`}
                >
                  <RefreshCw size={11} />
                </button>
                <button
                  type="button"
                  className="h-7 w-7 grid place-items-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                  onClick={() => engine.duplicateLayerComp(comp.id)}
                  title="Duplicate Layer Comp"
                  aria-label={`Duplicate ${comp.name}`}
                >
                  <Copy size={11} />
                </button>
                <button
                  type="button"
                  className="h-7 w-7 grid place-items-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                  onClick={() => rename(comp.id, comp.name)}
                  title="Rename Layer Comp"
                  aria-label={`Rename ${comp.name}`}
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  className="h-7 w-7 grid place-items-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  onClick={() => engine.deleteLayerComp(comp.id)}
                  title="Delete Layer Comp"
                  aria-label={`Delete ${comp.name}`}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          )
        })}

        {!comps.length && (
          <div className="p-5 text-center text-[10px] text-muted-foreground leading-relaxed">
            <Layers size={20} className="mx-auto mb-2 opacity-50" />
            Save alternate layouts without duplicating pixel data.
            <br />
            Layer Comps can record visibility, position and appearance.
          </div>
        )}
      </div>
    </div>
  )
}
