'use client'
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import * as Icons from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { BLEND_MODES } from '../../constants/tools'
import { useEditorStore, type LayerMeta } from '../../store'
import { engine } from '../../engine/engine'
import { prepareLayer } from '../../engine/document'
import type { BlendMode } from '../../types'
import { cn } from '@/lib/utils'
import { ADJUSTMENT_ICONS } from '../../constants/tools'
import { FancyScroll } from '@/components/ui/fancy-scroll'

export function LayersPanel() {
  const layers = useEditorStore(s => s.layers)
  const activeLayerId = useEditorStore(s => s.activeLayerId)
  const selectedLayerIds = useEditorStore(s => s.selectedLayerIds)
  const alignTo = useEditorStore(s => (s.toolOptions.move?.alignTo ?? 'selection') as 'selection' | 'canvas' | 'primary')
  const tick = useEditorStore(s => s.renderTick)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const dragId = useRef<string | null>(null)
  const soloBackup = useRef<Record<string, boolean> | null>(null)

  const doc = engine.activeDoc
  const activeLayer = doc?.layers.find(l => l.id === activeLayerId)
  const selectedSet = new Set(selectedLayerIds)
  const selectedLayers = doc?.layers.filter(l => selectedSet.has(l.id)) ?? []

  const idxOf = (metaId: string) => layers.findIndex(l => l.id === metaId) // display index (0=top)
  const q = query.trim().toLowerCase()
  const visibleLayers = layers.filter(l => (kindFilter === 'all' || l.kind === kindFilter) && (!q || l.name.toLowerCase().includes(q)))

  const setActive = (id: string, e: ReactMouseEvent) => {
    if (!doc) return
    const order = layers.map(l => l.id) // display order: top → bottom
    const current = doc.selectedLayerIds?.filter(x => doc.layers.some(l => l.id === x))
      ?? (doc.activeLayerId ? [doc.activeLayerId] : [])

    if (e.shiftKey && doc.activeLayerId) {
      const a = order.indexOf(doc.activeLayerId)
      const b = order.indexOf(id)
      if (a >= 0 && b >= 0) {
        const lo = Math.min(a, b), hi = Math.max(a, b)
        doc.selectedLayerIds = order.slice(lo, hi + 1)
      } else doc.selectedLayerIds = [id]
      doc.activeLayerId = id
    } else if (e.ctrlKey || e.metaKey) {
      const set = new Set(current)
      if (set.has(id) && set.size > 1) set.delete(id)
      else set.add(id)
      doc.selectedLayerIds = [...set]
      doc.activeLayerId = set.has(id) ? id : (doc.selectedLayerIds[doc.selectedLayerIds.length - 1] ?? null)
    } else {
      doc.activeLayerId = id
      doc.selectedLayerIds = [id]
    }
    engine.emit()
  }

  const reorder = (id: string, displayIdx: number) => {
    // display index 0 = top → array index = len-1-displayIdx
    if (!doc) return
    const arrIdx = doc.layers.length - 1 - displayIdx
    engine.reorderLayer(id, arrIdx)
  }

  const toggleSolo = (id: string) => {
    if (!doc) return
    const backup = soloBackup.current
    if (backup) {
      for (const l of doc.layers) if (l.id in backup) l.visible = backup[l.id]
      soloBackup.current = null
      engine.pushHistory('Restore Layer Visibility')
      engine.emit()
      return
    }
    soloBackup.current = Object.fromEntries(doc.layers.map(l => [l.id, l.visible]))
    for (const l of doc.layers) l.visible = l.id === id
    engine.pushHistory('Solo Layer')
    engine.emit()
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* blend + opacity row */}
      <div className="flex items-center gap-2 p-2 border-b text-[11px]">
        <Icons.Blend size={12} className="text-muted-foreground shrink-0" aria-hidden />
        <span className="text-muted-foreground shrink-0">Blend</span>
        <Select
          value={activeLayer?.blendMode ?? 'normal'}
          onValueChange={v => {
            const targets = selectedLayers.length ? selectedLayers : (activeLayer ? [activeLayer] : [])
            for (const l of targets) engine.setLayerProps(l.id, { blendMode: v as BlendMode }, { history: false })
            if (targets.length) { engine.pushHistory(targets.length > 1 ? 'Layer Blend Modes' : 'Layer Blend Mode'); engine.emit() }
          }}
        >
          <SelectTrigger className="h-6! flex-1 px-1.5 py-0.5 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-50 max-h-64">
            {BLEND_MODES.map(b => (
              <SelectItem key={b.value} value={b.value} className="text-[11px]">{b.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5 border-b text-[11px]">
        <Icons.Droplet size={12} className="text-muted-foreground shrink-0" aria-hidden />
        <span className="text-muted-foreground shrink-0 w-12">Opacity</span>
        <Slider
          value={[activeLayer?.opacity ?? 100]}
          min={0}
          max={100}
          step={1}
          onValueChange={v => {
            const targets = selectedLayers.length ? selectedLayers : (activeLayer ? [activeLayer] : [])
            for (const l of targets) engine.setLayerProps(l.id, { opacity: v[0] }, { history: false })
          }}
          onValueCommit={() => {
            if (selectedLayers.length || activeLayer) engine.pushHistory(selectedLayers.length > 1 ? 'Layer Opacities' : 'Layer Opacity')
          }}
          className="flex-1"
        />
        <span className="font-mono w-9 text-right">{Math.round(activeLayer?.opacity ?? 100)}%</span>
      </div>

      {selectedLayers.length > 1 && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b bg-panel/35" title={`Align ${selectedLayers.length} selected layers to ${alignTo}`}>
          <span className="text-[10px] text-muted-foreground mr-1 tabular-nums">{selectedLayers.length} selected</span>
          <PanelBtn title="Align left" icon="AlignHorizontalJustifyStart" onClick={() => engine.alignSelected('left', alignTo)} />
          <PanelBtn title="Align horizontal centers" icon="AlignHorizontalJustifyCenter" onClick={() => engine.alignSelected('hcenter', alignTo)} />
          <PanelBtn title="Align right" icon="AlignHorizontalJustifyEnd" onClick={() => engine.alignSelected('right', alignTo)} />
          <PanelBtn title="Align top" icon="AlignVerticalJustifyStart" onClick={() => engine.alignSelected('top', alignTo)} />
          <PanelBtn title="Align vertical centers" icon="AlignVerticalJustifyCenter" onClick={() => engine.alignSelected('vcenter', alignTo)} />
          <PanelBtn title="Align bottom" icon="AlignVerticalJustifyEnd" onClick={() => engine.alignSelected('bottom', alignTo)} />
          {selectedLayers.length >= 3 && (
            <>
              <span className="w-px h-4 bg-border mx-0.5" />
              <PanelBtn title="Distribute horizontal centers" icon="GalleryHorizontal" onClick={() => engine.distributeSelected('horizontal')} />
              <PanelBtn title="Distribute vertical centers" icon="GalleryVertical" onClick={() => engine.distributeSelected('vertical')} />
              <PanelBtn title="Distribute horizontal spacing" icon="BetweenHorizontalStart" onClick={() => engine.distributeSelectedSpacing('horizontal')} />
              <PanelBtn title="Distribute vertical spacing" icon="BetweenVerticalStart" onClick={() => engine.distributeSelectedSpacing('vertical')} />
            </>
          )}
        </div>
      )}

      {/* fast layer search/filter — important once real projects reach dozens of layers */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b bg-panel/40">
        <Icons.Search size={12} className="text-muted-foreground shrink-0" aria-hidden />
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find layer…" className="h-6 min-w-0 flex-1 text-[10px] px-2" />
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="h-6! w-24 px-1.5 py-0 text-[10px]"><SelectValue /></SelectTrigger>
          <SelectContent className="z-50">
            <SelectItem value="all" className="text-[10px]">All</SelectItem>
            <SelectItem value="raster" className="text-[10px]">Pixels</SelectItem>
            <SelectItem value="smart" className="text-[10px]">Smart</SelectItem>
            <SelectItem value="text" className="text-[10px]">Text</SelectItem>
            <SelectItem value="shape" className="text-[10px]">Shapes</SelectItem>
            <SelectItem value="adjustment" className="text-[10px]">Adjust</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* layer list */}
      <FancyScroll className="flex-1 min-h-0" role="list" aria-label="Layers">
        {visibleLayers.map(meta => {
          const displayIdx = idxOf(meta.id)
          return (
            <LayerRow
            key={meta.id}
            meta={meta}
            tick={tick}
            active={selectedSet.has(meta.id)}
            primary={meta.id === activeLayerId}
            renaming={renaming === meta.id}
            renameValue={renameValue}
            onActivate={e => setActive(meta.id, e)}
            onToggleVisibility={(solo) => solo ? toggleSolo(meta.id) : engine.setLayerProps(meta.id, { visible: !meta.visible })}
            onStartRename={() => { setRenaming(meta.id); setRenameValue(meta.name) }}
            onRename={v => {
              engine.setLayerProps(meta.id, { name: v })
              setRenaming(null)
            }}
            onRenameChange={setRenameValue}
            onDragStart={() => { dragId.current = meta.id }}
            onDropAt={targetId => {
              if (dragId.current && dragId.current !== targetId) reorder(dragId.current, idxOf(targetId))
              dragId.current = null
            }}
            onMoveUp={displayIdx > 0 ? () => engine.moveLayerBy(meta.id, 1) : undefined}
            onMoveDown={displayIdx < layers.length - 1 ? () => engine.moveLayerBy(meta.id, -1) : undefined}
            />
          )
        })}
        {!layers.length && <div className="p-4 text-[11px] text-muted-foreground text-center">No layers</div>}
        {!!layers.length && !visibleLayers.length && <div className="p-4 text-[11px] text-muted-foreground text-center">No layers match this filter</div>}
      </FancyScroll>

      {/* footer buttons */}
      <div className="flex items-center gap-0.5 p-1 border-t bg-panel/50">
        <PanelBtn title="New layer" icon="Plus" onClick={() => engine.addRasterLayer()} />
        <PanelBtn title="Duplicate" icon="Copy" onClick={() => { if (activeLayer) engine.duplicateLayer(activeLayer.id) }} />
        <PanelBtn title="Add mask from selection" icon="SquareDashed" onClick={() => { if (activeLayer) engine.addLayerMask(activeLayer.id, true) }} />
        <PanelBtn
          title={activeLayer?.clipped ? 'Release clipping' : 'Clip to layer below'}
          icon="ArrowDownToLine"
          active={activeLayer?.clipped}
          onClick={() => { if (activeLayer) engine.toggleClipping(activeLayer.id) }}
        />
        <PanelBtn title="Rasterize" icon="Grid2x2" onClick={() => engine.rasterizeLayer()} />
        <PanelBtn title="Merge down" icon="Combine" onClick={() => engine.mergeDown()} />
        <span className="flex-1" />
        <PanelBtn title="Delete layer" icon="Trash2" danger onClick={() => engine.deleteLayer()} />
      </div>
    </div>
  )
}

function LayerRow({ meta, tick, active, primary, renaming, renameValue, onActivate, onToggleVisibility, onStartRename, onRename, onRenameChange, onDragStart, onDropAt, onMoveUp, onMoveDown }: {
  meta: LayerMeta
  tick: number
  active: boolean
  primary: boolean
  renaming: boolean
  renameValue: string
  onActivate(e: ReactMouseEvent<HTMLDivElement>): void
  onToggleVisibility(solo: boolean): void
  onStartRename(): void
  onRename(v: string): void
  onRenameChange(v: string): void
  onDragStart(): void
  onDropAt(targetId: string): void
  onMoveUp?(): void
  onMoveDown?(): void
}) {
  const thumbRef = useRef<HTMLCanvasElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(null)
  const doc = engine.activeDoc
  const layer = doc?.layers.find(l => l.id === meta.id)

  useEffect(() => {
    const c = thumbRef.current
    if (!c || !layer || !doc) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    const src = layer.kind === 'adjustment' ? null : prepareLayer(doc, layer)
    if (src && src.width && src.height) {
      const scale = Math.min(c.width / src.width, c.height / src.height, 1)
      const w = src.width * scale, h = src.height * scale
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h)
    }
  }, [tick, layer, doc, meta.thumbV])

  useEffect(() => {
    const c = maskRef.current
    if (!c || !layer?.mask) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(layer.mask, 0, 0, c.width, c.height)
    // white-ify
    ctx.globalCompositeOperation = 'source-atop'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.globalCompositeOperation = 'source-over'
  }, [tick, layer, meta.thumbV])

  const adjIcon = meta.adjustmentType ? (ADJUSTMENT_ICONS[meta.adjustmentType] ?? 'Sliders') : null
  const AdjIcon = adjIcon ? ((Icons as any)[adjIcon] ?? Icons.Sliders) : null
  const kind = kindBadge(meta)
  const KindIcon = (Icons as any)[kind.icon] ?? Icons.Image

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="listitem"
          draggable
          onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); onDropAt(meta.id) }}
          onClick={onActivate}
          onDoubleClick={onStartRename}
          className={cn(
            'flex items-center gap-2 px-2 py-1.5 cursor-pointer border-b border-border/30 group',
            active ? 'bg-accent/70' : 'hover:bg-accent/30'
          )}
        >
          {/* visibility */}
          <button
            className={cn('w-4 flex-shrink-0', meta.visible ? 'text-foreground' : 'text-muted-foreground/40')}
            onClick={e => { e.stopPropagation(); onToggleVisibility(e.altKey) }}
            title="Click: show/hide · Alt-click: solo/restore layers"
            aria-label={meta.visible ? 'Hide layer' : 'Show layer'}
          >
            <Icons.Eye size={13} />
          </button>

          {/* thumbnails */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <div className={cn('w-9 h-9 rounded-sm border bg-checker', primary && 'ring-1 ring-primary')}>
              {meta.kind === 'adjustment' && AdjIcon ? (
                <div className="w-full h-full flex items-center justify-center bg-muted/30">
                  <AdjIcon size={15} className="text-primary" />
                </div>
              ) : (
                <canvas ref={thumbRef} width={36} height={36} className="w-9 h-9 rounded-sm" />
              )}
            </div>
            {meta.hasMask && (
              <div className={cn('w-6 h-6 rounded-sm border bg-black overflow-hidden', !meta.maskEnabled && 'opacity-40')}>
                <canvas ref={maskRef} width={24} height={24} className="w-6 h-6" />
              </div>
            )}
            {meta.hasVectorMask && (
              <button
                className={cn(
                  'w-6 h-6 rounded-sm border grid place-items-center bg-muted/30 text-primary',
                  !meta.vectorMaskEnabled && 'opacity-40',
                )}
                title={meta.vectorMaskEnabled ? 'Vector mask enabled · click to disable' : 'Vector mask disabled · click to enable'}
                onClick={e => { e.stopPropagation(); engine.toggleVectorMask(meta.id) }}
              >
                <Icons.PenTool size={12} />
              </button>
            )}
          </div>

          {/* name + badges */}
          <div className="flex-1 min-w-0">
            {renaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={e => onRenameChange(e.target.value)}
                onBlur={() => onRename(renameValue)}
                onKeyDown={e => { if (e.key === 'Enter') onRename(renameValue); if (e.key === 'Escape') onRename(meta.name) }}
                className="w-full h-6 text-[11px] bg-background border rounded px-1"
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="shrink-0 flex items-center text-muted-foreground/80" title={kind.label} aria-label={kind.label}>
                  <KindIcon size={11} />
                </span>
                {meta.origin === 'detect' && (
                  <span className="shrink-0 flex items-center text-primary" title="Lifted from a detected object" aria-label="Detected object layer">
                    <Icons.ScanSearch size={11} />
                  </span>
                )}
                {meta.clipped && <Icons.CornerDownRight size={11} className="text-muted-foreground shrink-0" />}
                {meta.smartFilterCount > 0 && (
                  <span className="text-[8px] bg-primary/20 text-primary px-1 rounded-sm shrink-0" title="Smart filters">
                    SF×{meta.smartFilterCount}
                  </span>
                )}
                {meta.hasBlendIf && <span className="text-[8px] bg-muted px-1 rounded-sm shrink-0" title="Blend-If active">fx</span>}
                {meta.hasFx && (
                  <button
                    className="text-primary shrink-0 hover:scale-110 transition-transform"
                    title="Layer Style — click to edit"
                    aria-label="Layer style effects"
                    onClick={e => { e.stopPropagation(); useEditorStore.getState().openDialog('layer-styles', { layerId: meta.id }) }}
                  >
                    <Icons.Sparkles size={10} />
                  </button>
                )}
                {meta.locked && <Icons.Lock size={10} className="text-muted-foreground shrink-0" />}
                <span className={cn('text-[11px] truncate', !meta.visible && 'text-muted-foreground/50')}>{meta.name}</span>
              </div>
            )}
            <div className="text-[9px] text-muted-foreground">
              {meta.kind === 'adjustment' ? meta.adjustmentType : `${meta.opacity}% · ${meta.blendMode}`}
            </div>
          </div>

          {/* quick actions on hover */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {onMoveUp && <button className="p-0.5 text-muted-foreground hover:text-foreground" onClick={e => { e.stopPropagation(); onMoveUp() }} title="Move up"><Icons.ArrowUp size={11} /></button>}
            {onMoveDown && <button className="p-0.5 text-muted-foreground hover:text-foreground" onClick={e => { e.stopPropagation(); onMoveDown() }} title="Move down"><Icons.ArrowDown size={11} /></button>}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="z-50">
        <ContextMenuItem onClick={() => onStartRename()}><Icons.Pencil /> Rename…</ContextMenuItem>
        <ContextMenuItem onClick={() => useEditorStore.getState().openDialog('layer-styles', { layerId: meta.id })}><Icons.Sparkles /> Layer Style…</ContextMenuItem>
        <ContextMenuItem onClick={() => engine.duplicateLayer(meta.id)}><Icons.CopyPlus /> Duplicate Layer</ContextMenuItem>
        <ContextMenuItem onClick={() => engine.addLayerMask(meta.id, true)}><Icons.SquareDashed /> Add Mask from Selection</ContextMenuItem>
        <ContextMenuItem onClick={() => engine.addLayerMask(meta.id, false)}><Icons.Square /> Add Mask (Reveal All)</ContextMenuItem>
        {meta.hasMask && <ContextMenuItem onClick={() => engine.deleteLayerMask(meta.id, true)}><Icons.Stamp /> Apply Mask</ContextMenuItem>}
        {meta.hasMask && <ContextMenuItem onClick={() => engine.deleteLayerMask(meta.id, false)}><Icons.Trash2 /> Delete Mask</ContextMenuItem>}
        {meta.hasVectorMask && <ContextMenuItem onClick={() => engine.toggleVectorMask(meta.id)}><Icons.PenTool /> {meta.vectorMaskEnabled ? 'Disable' : 'Enable'} Vector Mask</ContextMenuItem>}
        {meta.hasVectorMask && <ContextMenuItem onClick={() => engine.deleteVectorMask(meta.id)}><Icons.Trash2 /> Delete Vector Mask</ContextMenuItem>}
        <ContextMenuItem onClick={() => engine.toggleClipping(meta.id)}><Icons.CornerDownRight /> Toggle Clipping</ContextMenuItem>
        <ContextMenuItem onClick={() => engine.rasterizeLayer(meta.id)}><Icons.Grid2x2 /> Rasterize</ContextMenuItem>
        <ContextMenuItem onClick={() => engine.trimLayerToContent(meta.id)}><Icons.ScanLine /> Trim to Content</ContextMenuItem>
        <ContextMenuItem onClick={() => engine.mergeDown(meta.id)}><Icons.Combine /> Merge Down</ContextMenuItem>
        <ContextMenuItem onClick={() => engine.deleteLayer(meta.id)} className="text-destructive"><Icons.Trash2 className="text-destructive" /> Delete Layer</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** PS-style type badge: every layer kind gets a relevant icon before its name */
function kindBadge(meta: LayerMeta): { icon: string; label: string } {
  if (meta.kind === 'text') return { icon: 'Type', label: 'Text layer' }
  if (meta.kind === 'shape') return { icon: 'Shapes', label: 'Shape layer' }
  if (meta.kind === 'smart') return { icon: 'Layers', label: 'Smart Object' }
  if (meta.kind === 'adjustment') {
    return {
      icon: ADJUSTMENT_ICONS[meta.adjustmentType ?? ''] ?? 'Sliders',
      label: meta.adjustmentType ? `Adjustment — ${meta.adjustmentType}` : 'Adjustment layer',
    }
  }
  return { icon: 'Image', label: 'Raster layer' }
}

export function PanelBtn({ title, icon, onClick, danger, active }: {
  title: string
  icon: string
  onClick(): void
  danger?: boolean
  active?: boolean
}) {
  const Cmp = (Icons as any)[icon] ?? Icons.Circle
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'w-7 h-7 rounded-sm flex items-center justify-center transition-colors',
        danger ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
        active && 'bg-accent text-foreground'
      )}
    >
      <Cmp size={14} />
    </button>
  )
}
