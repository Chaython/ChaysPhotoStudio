'use client'
// ============================================================
// Fireworks Expanded Mode inspector panels
//  · Optimize — export format/quality settings for the active document
//  · Align    — object alignment against the selection, canvas or primary object
//  · Pages    — Fireworks-style page/artboard list
//  · States   — frame-animation states (Fireworks "States")
//
// These are ordinary registered panels: they can live in either inspector
// stack, float as windows, or dock in any of the shared dock positions.
// ============================================================
import { useMemo, useState } from 'react'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignStartHorizontal, AlignStartVertical, Copy, Gauge, Layers, Plus, Settings2, Trash2,
} from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { normalizeArtboards, MAX_ARTBOARDS } from '../../artboards'
import { uid } from '../../utils/canvas'
import { cn } from '@/lib/utils'

type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
type AlignReference = 'selection' | 'canvas' | 'primary'

const ALIGN_ACTIONS: { kind: AlignKind; label: string; icon: typeof AlignStartVertical }[] = [
  { kind: 'left', label: 'Align left edges', icon: AlignStartVertical },
  { kind: 'hcenter', label: 'Align horizontal centers', icon: AlignCenterVertical },
  { kind: 'right', label: 'Align right edges', icon: AlignEndVertical },
  { kind: 'top', label: 'Align top edges', icon: AlignStartHorizontal },
  { kind: 'vcenter', label: 'Align vertical centers', icon: AlignCenterHorizontal },
  { kind: 'bottom', label: 'Align bottom edges', icon: AlignEndHorizontal },
]

export function OptimizePanel() {
  const tick = useEditorStore(s => s.renderTick)
  const workspacePreset = useEditorStore(s => s.workspacePreset)
  const [format, setFormat] = useState<'jpeg' | 'png' | 'gif' | 'webp'>('jpeg')
  const [quality, setQuality] = useState(80)
  const [matte, setMatte] = useState('#ffffff')
  const doc = engine.activeDoc
  void tick

  const estimate = useMemo(() => {
    if (!doc) return 0
    const pixels = doc.width * doc.height
    if (format === 'png') return Math.round(pixels * 1.35)
    if (format === 'gif') return Math.round(pixels * 0.62)
    const compression = 0.06 + (quality / 100) * 0.34
    return Math.round(pixels * compression)
  }, [doc, format, quality])

  const sizeLabel = estimate >= 1024 * 1024
    ? `${(estimate / (1024 * 1024)).toFixed(2)} MB`
    : `${Math.max(1, Math.round(estimate / 1024))} KB`

  if (!doc) {
    return <div className="p-3 text-[11px] text-muted-foreground">Open a document to optimize its export.</div>
  }

  return (
    <div className="p-2.5 space-y-2.5 text-[11px]">
      <div className="flex items-center gap-1.5">
        <Gauge size={13} className="text-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Optimize</span>
      </div>

      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-muted-foreground">Format</span>
        <select
          className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-[11px]"
          value={format}
          onChange={event => setFormat(event.target.value as typeof format)}
          aria-label="Optimized export format"
        >
          <option value="jpeg">JPEG</option>
          <option value="png">PNG</option>
          <option value="gif">GIF</option>
          <option value="webp">WebP</option>
        </select>
      </label>

      {(format === 'jpeg' || format === 'webp') && (
        <label className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-muted-foreground">Quality</span>
          <input
            className="min-w-0 flex-1 accent-primary"
            type="range"
            min={10}
            max={100}
            value={quality}
            onChange={event => setQuality(Number(event.target.value))}
            aria-label="Optimized export quality"
          />
          <span className="w-8 text-right tabular-nums">{quality}</span>
        </label>
      )}

      {format === 'jpeg' && (
        <label className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-muted-foreground">Matte</span>
          <input
            className="h-7 w-10 rounded border border-border bg-background p-0.5"
            type="color"
            value={matte}
            onChange={event => setMatte(event.target.value)}
            aria-label="JPEG matte color"
          />
          <span className="font-mono text-[10px] text-muted-foreground">{matte.toUpperCase()}</span>
        </label>
      )}

      <div className="flex items-center justify-between rounded border border-border/70 bg-background/50 px-2 py-1.5">
        <span className="text-muted-foreground">Estimated size</span>
        <span className="font-medium tabular-nums">{sizeLabel}</span>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          className="h-7 rounded border text-[10px] hover:bg-accent"
          onClick={() => useEditorStore.getState().openDialog('export')}
        >
          Export…
        </button>
        <button
          type="button"
          className="h-7 rounded border text-[10px] hover:bg-accent"
          onClick={() => window.dispatchEvent(new CustomEvent('zphoto:fireworks-view', { detail: 'preview' }))}
        >
          Preview
        </button>
      </div>
      <div className="text-[9px] leading-relaxed text-muted-foreground">
        Optimize settings are used by the Preview and 2-Up/4-Up document views. Use Export for the full
        format and metadata controls.
      </div>
      {workspacePreset === 'fireworks' && (
        <div className="border-t pt-2 text-[9px] text-muted-foreground">
          Expanded Mode keeps this panel above History and Align, just like Fireworks CS6.
        </div>
      )}
    </div>
  )
}

export function AlignPanel() {
  const tick = useEditorStore(s => s.renderTick)
  const selected = useEditorStore(s => s.selectedLayerIds)
  const [reference, setReference] = useState<AlignReference>('selection')
  const doc = engine.activeDoc
  void tick
  const canAlign = !!doc && selected.length > 0

  return (
    <div className="p-2.5 space-y-2.5 text-[11px]">
      <div className="flex items-center gap-1.5">
        <AlignStartVertical size={13} className="text-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Align</span>
      </div>

      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-muted-foreground">Relative to</span>
        <select
          className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-[11px]"
          value={reference}
          onChange={event => setReference(event.target.value as AlignReference)}
          aria-label="Align relative to"
        >
          <option value="selection">Selection</option>
          <option value="canvas">Canvas</option>
          <option value="primary">Primary object</option>
        </select>
      </label>

      <div className="grid grid-cols-3 gap-1" role="group" aria-label="Align selected layers">
        {ALIGN_ACTIONS.map(action => {
          const Icon = action.icon
          return (
            <button
              key={action.kind}
              type="button"
              disabled={!canAlign}
              title={action.label}
              aria-label={action.label}
              className="flex h-8 items-center justify-center rounded border border-border/70 text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-foreground disabled:opacity-35"
              onClick={() => engine.alignSelected(action.kind, reference)}
            >
              <Icon size={15} />
            </button>
          )
        })}
      </div>

      <div className="rounded border border-border/70 bg-background/50 px-2 py-1.5 text-[10px] text-muted-foreground">
        {canAlign
          ? `${selected.length} object${selected.length === 1 ? '' : 's'} selected · ${reference === 'canvas' ? 'aligning to canvas' : reference === 'primary' ? 'aligning to the primary object' : 'aligning within the selection bounds'}`
          : 'Select one or more objects to align.'}
      </div>
    </div>
  )
}

export function PagesPanel() {
  const tick = useEditorStore(s => s.renderTick)
  const doc = engine.activeDoc
  void tick
  if (!doc) return <div className="p-3 text-[11px] text-muted-foreground">Open a document to manage pages.</div>
  const boards = normalizeArtboards(doc.artboards, doc.width, doc.height)
  const activeId = doc.activeArtboardId ?? null

  // Read the live document inside handlers: mutating the render-scoped `doc`
  // in a callback trips react-hooks/immutability and can go stale.
  const select = (id: string | null) => {
    const target = engine.activeDoc
    if (!target) return
    target.activeArtboardId = id
    engine.emitOverlay()
    engine.emit()
  }
  const addPage = () => {
    const target = engine.activeDoc
    if (!target) return
    const current = normalizeArtboards(target.artboards, target.width, target.height)
    if (current.length >= MAX_ARTBOARDS) {
      useEditorStore.getState().pushToast('Page limit reached', 'error')
      return
    }
    const id = uid()
    target.artboards = [...current, {
      id, name: `Page ${current.length + 1}`, x: 0, y: 0, width: target.width, height: target.height,
    }]
    target.activeArtboardId = id
    engine.pushHistory('Add Page', target)
    engine.emit()
  }
  const deletePage = (id: string) => {
    const target = engine.activeDoc
    if (!target) return
    const next = normalizeArtboards(target.artboards, target.width, target.height).filter(board => board.id !== id)
    target.artboards = next
    target.activeArtboardId = next[0]?.id ?? null
    engine.pushHistory('Delete Page', target)
    engine.emit()
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-[11px]">
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <Layers size={12} className="text-primary" />
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pages</span>
        <button type="button" className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent" title="Add page" aria-label="Add page" onClick={addPage}>
          <Plus size={13} />
        </button>
        <button type="button" className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent" title="Manage pages and artboards" aria-label="Manage pages and artboards" onClick={() => useEditorStore.getState().openDialog('artboards')}>
          <Settings2 size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto zphoto-scroll p-1">
        <button
          type="button"
          onClick={() => select(null)}
          aria-pressed={activeId === null}
          className={cn(
            'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left',
            activeId === null ? 'bg-primary/15 text-primary' : 'hover:bg-accent',
          )}
        >
          <span className="w-5 shrink-0 text-[9px] text-muted-foreground">1</span>
          <span className="min-w-0 flex-1 truncate">Canvas</span>
          <span className="text-[9px] text-muted-foreground">{doc.width}×{doc.height}</span>
        </button>
        {boards.map((board, index) => (
          <div key={board.id} className={cn(
            'group/page flex items-center gap-1 rounded px-1.5 py-1',
            activeId === board.id ? 'bg-primary/15 text-primary' : 'hover:bg-accent',
          )}>
            <button
              type="button"
              onClick={() => select(board.id)}
              aria-pressed={activeId === board.id}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span className="w-5 shrink-0 text-[9px] text-muted-foreground">{index + 2}</span>
              <span className="min-w-0 flex-1 truncate">{board.name}</span>
              <span className="text-[9px] text-muted-foreground">{board.width}×{board.height}</span>
            </button>
            <button
              type="button"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover/page:opacity-100"
              title={`Delete ${board.name}`}
              aria-label={`Delete ${board.name}`}
              onClick={() => deletePage(board.id)}
            >
              <Trash2 size={10} />
            </button>
          </div>
        ))}
        {boards.length === 0 && (
          <div className="px-2 py-3 text-[10px] leading-relaxed text-muted-foreground">
            The canvas is Page 1. Add a page to create an export artboard that shares this layer stack.
          </div>
        )}
      </div>
    </div>
  )
}

export function StatesPanel() {
  const frames = useEditorStore(s => s.timelineFrames)
  const active = useEditorStore(s => s.timelineActiveFrame)
  const setTimelineFrame = useEditorStore(s => s.setTimelineFrame)
  const doc = engine.activeDoc

  if (!doc) return <div className="p-3 text-[11px] text-muted-foreground">Open a document to manage states.</div>

  const ensure = () => {
    engine.ensureFrames()
  }
  const addState = (mode: 'duplicate' | 'empty') => {
    if (!doc.frames?.length) {
      engine.ensureFrames()
    }
    const index = engine.addFrame(mode)
    if (index >= 0) setTimelineFrame(index)
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-[11px]">
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <Copy size={12} className="text-primary" />
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">States</span>
        <button type="button" className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent" title="Add state from the current appearance" aria-label="Add state" onClick={() => addState('duplicate')}>
          <Plus size={13} />
        </button>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-35"
          title="Delete the active state"
          aria-label="Delete the active state"
          disabled={frames.length <= 1}
          onClick={() => engine.deleteFrame(active)}
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto zphoto-scroll p-1">
        {frames.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-5 text-center">
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              States capture the visibility and appearance of the layer stack for rollovers and animation.
            </p>
            <button type="button" className="h-7 rounded border px-2 text-[10px] hover:bg-accent" onClick={ensure}>
              Create State 1
            </button>
          </div>
        ) : frames.map((frame, index) => (
          <button
            key={frame.id}
            type="button"
            onClick={() => setTimelineFrame(index)}
            aria-pressed={index === active}
            className={cn(
              'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left',
              index === active ? 'bg-primary/15 text-primary' : 'hover:bg-accent',
            )}
          >
            <span className="w-5 shrink-0 text-[9px] text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate">{frame.name}</span>
            <span className="text-[9px] tabular-nums text-muted-foreground">{frame.delayMs} ms</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 border-t border-border/60 p-1">
        <button type="button" className="h-6 flex-1 rounded border text-[9px] hover:bg-accent" onClick={() => addState('duplicate')}>
          Duplicate State
        </button>
        <button type="button" className="h-6 flex-1 rounded border text-[9px] hover:bg-accent" onClick={() => addState('empty')}>
          Blank State
        </button>
      </div>
    </div>
  )
}
