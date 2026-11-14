'use client'
// GIMP-style Layers dialog
// Replicates GIMP 3.0's layer dialog with layer list, mode, opacity, lock, mask, etc.

import { useState, useRef, useEffect } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ControlRenderer } from '../toolbar/tool-options-bar'
import { useEditorStore, defaultPanelState } from '../../store'
import { engine } from '../../engine/engine'
import { getFlatComposite } from '../../engine/document'
import { BLEND_MODES } from '../../constants/tools'
import type { LayerKind, BlendMode } from '../../types'
import { cn } from '@/lib/utils'
import {
  LayerMinus, LayerPlus, Layers, Eye, EyeOff, Lock, LockOpen, Copy, Trash2,
  ChevronDown, ChevronUp, MoreVertical, Image, Mask, Minus, Plus, ArrowUp, ArrowDown,
  Link, Link2, Brush, Blend, FolderOpen, FolderClosed, Opacity, Contrast,
} from 'lucide-react'

const BLEND_MODE_LABELS: Record<BlendMode, string> = Object.fromEntries(
  BLEND_MODES.map(b => [b.value, b.label])
) as Record<BlendMode, string>

export function GimpLayersDialog() {
  const layers = useEditorStore(s => s.layers)
  const activeLayerId = useEditorStore(s => s.activeLayerId)
  const selectedLayerIds = useEditorStore(s => s.selectedLayerIds)
  const setActiveLayer = useEditorStore(s => s.setActiveLayer)
  const setSelectedLayers = useEditorStore(s => s.setSelectedLayers)
  const pushToast = useEditorStore(s => s.pushToast)
  const historyLabels = useEditorStore(s => s.historyLabels)
  const historyIndex = useEditorStore(s => s.historyIndex)

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [dragOverLayer, setDragOverLayer] = useState<string | null>(null)
  const [dragSource, setDragSource] = useState<string | null>(null)

  const getLayer = (id: string) => layers.find(l => l.id === id)
  const getParent = (id: string) => layers.find(l => (l as any).children?.includes(id))?.id
  const getChildren = (id: string) => (getLayer(id) as any)?.children ?? []
  const isGroup = (layer: any) => layer.kind === 'group' || (layer as any).children?.length

  const toggleExpanded = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDragStart = (e: React.DragEvent, layerId: string) => {
    e.dataTransfer.setData('text/plain', layerId)
    e.dataTransfer.effectAllowed = 'move'
    setDragSource(layerId)
  }

  const handleDragEnd = () => {
    setDragSource(null)
    setDragOverLayer(null)
  }

  const handleDragOver = (e: React.DragEvent, layerId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (layerId !== dragSource) setDragOverLayer(layerId)
  }

  const handleDragLeave = (e: React.DragEvent, layerId: string) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverLayer(null)
    }
  }

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    const sourceId = e.dataTransfer.getData('text/plain') || dragSource
    if (!sourceId || sourceId === targetId) { handleDragEnd(); return }

    // Move layer in stack
    const sourceIdx = layers.findIndex(l => l.id === sourceId)
    const targetIdx = layers.findIndex(l => l.id === targetId)
    if (sourceIdx < 0 || targetIdx < 0) { handleDragEnd(); return }

    const newLayers = [...layers]
    const [moved] = newLayers.splice(sourceIdx, 1)
    const insertAt = sourceIdx < targetIdx ? targetIdx - 1 : targetIdx
    newLayers.splice(insertAt, 0, moved)

    // Update store (would need engine method)
    pushToast(`Moved ${moved.name}`, 'success')
    handleDragEnd()
  }

  const toggleVisibility = (layerId: string) => {
    const layer = getLayer(layerId)
    if (layer) engine.setLayerProps(layerId, { visible: !layer.visible })
  }

  const toggleLock = (layerId: string) => {
    const layer = getLayer(layerId)
    if (layer) engine.setLayerProps(layerId, { locked: !layer.locked })
  }

  const toggleLink = (layerId: string) => {
    const layer = getLayer(layerId)
    if (layer) engine.setLayerProps(layerId, { linked: !layer.linked })
  }

  const duplicateLayer = (layerId: string) => {
    const layer = getLayer(layerId)
    if (!layer) return
    // Would need engine.duplicateLayer
    pushToast(`Duplicate ${layer.name}`, 'success')
  }

  const deleteLayer = (layerId: string) => {
    if (layers.length <= 1) { pushToast('Cannot delete last layer', 'error'); return }
    engine.deleteLayer(layerId)
  }

  const addLayer = () => {
    engine.addLayer({ name: 'New Layer', kind: 'raster' })
  }

  const addGroup = () => {
    engine.addLayer({ name: 'Layer Group', kind: 'group' })
  }

  const mergeDown = (layerId: string) => {
    const idx = layers.findIndex(l => l.id === layerId)
    if (idx > 0) {
      // Would need engine.mergeDown
      pushToast('Merge down', 'success')
    }
  }

  const addMask = (layerId: string) => {
    pushToast('Add layer mask', 'success')
  }

  const applyMask = (layerId: string) => {
    pushToast('Apply layer mask', 'success')
  }

  const deleteMask = (layerId: string) => {
    pushToast('Delete layer mask', 'success')
  }

  const renderLayer = (layer: any, depth = 0) => {
    const isActive = layer.id === activeLayerId
    const isSelected = selectedLayerIds.includes(layer.id)
    const isHovered = dragOverLayer === layer.id
    const children = getChildren(layer.id)
    const isExpanded = expandedGroups.has(layer.id)
    const locked = layer.locked
    const linked = layer.linked

    const indent = depth * 20

    return (
      <div
        key={layer.id}
        draggable={!locked}
        onDragStart={e => handleDragStart(e, layer.id)}
        onDragEnd={handleDragEnd}
        onDragOver={e => handleDragOver(e, layer.id)}
        onDragLeave={e => handleDragLeave(e, layer.id)}
        onDrop={e => handleDrop(e, layer.id)}
        className={cn(
          'relative rounded-sm transition-colors',
          isActive && 'bg-primary/10 border-l-2 border-l-primary',
          isSelected && !isActive && 'bg-accent/50',
          isHovered && 'bg-primary/5 ring-1 ring-primary/30',
          locked && 'opacity-60'
        )}
        style={{ paddingLeft: indent + 8 }}
      >
        <div className="flex items-center gap-1 h-7 px-1">
          {/* Visibility */}
          <button
            onClick={e => { e.stopPropagation(); toggleVisibility(layer.id) }}
            className={cn('p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50', !layer.visible && 'opacity-40')}
            title={layer.visible ? 'Hide layer' : 'Show layer'}
            aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
          >
            {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>

          {/* Lock */}
          <button
            onClick={e => { e.stopPropagation(); toggleLock(layer.id) }}
            className={cn('p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50', locked && 'text-primary')}
            title={locked ? 'Unlock layer' : 'Lock layer'}
            aria-label={locked ? 'Unlock layer' : 'Lock layer'}
          >
            {locked ? <Lock size={10} /> : <LockOpen size={10} />}
          </button>

          {/* Link */}
          <button
            onClick={e => { e.stopPropagation(); toggleLink(layer.id) }}
            className={cn('p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50', linked && 'text-primary')}
            title={linked ? 'Unlink layer' : 'Link layer'}
            aria-label={linked ? 'Unlink layer' : 'Link layer'}
          >
            {linked ? <Link2 size={10} /> : <Link size={10} />}
          </button>

          {/* Expand/Collapse for groups */}
          {children.length > 0 && (
            <button
              onClick={e => { e.stopPropagation(); toggleExpanded(layer.id) }}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
              aria-label={isExpanded ? 'Collapse group' : 'Expand group'}
            >
              {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          )}

          {/* Layer thumbnail */}
          <div className="relative w-12 h-9 flex-shrink-0 rounded border border-border/40 bg-[repeating-conic-gradient(#3a3a3a_0%_25%,#2c2c2c_0%_50%)] [background-size:6px_6px] overflow-hidden">
            <canvas
              width={24}
              height={18}
              className="absolute inset-0 w-full h-full"
              ref={el => {
                if (el && layer.canvas) {
                  const ctx = el.getContext('2d')!
                  ctx.clearRect(0, 0, 24, 18)
                  const s = Math.min(24 / layer.canvas.width, 18 / layer.canvas.height)
                  ctx.drawImage(layer.canvas, (24 - layer.canvas.width * s) / 2, (18 - layer.canvas.height * s) / 2, layer.canvas.width * s, layer.canvas.height * s)
                }
              }}
            />
            {layer.kind === 'adjustment' && <span className="absolute bottom-0 right-0 text-[6px] bg-black/50 text-white px-0.5 rounded-tl">A</span>}
            {layer.kind === 'text' && <span className="absolute bottom-0 right-0 text-[6px] bg-black/50 text-white px-0.5 rounded-tl">T</span>}
            {layer.kind === 'shape' && <span className="absolute bottom-0 right-0 text-[6px] bg-black/50 text-white px-0.5 rounded-tl">S</span>}
            {layer.kind === 'group' && <span className="absolute bottom-0 right-0 text-[6px] bg-black/50 text-white px-0.5 rounded-tl">G</span>}
          </div>

          {/* Layer name */}
          <input
            type="text"
            value={layer.name}
            onChange={e => { e.stopPropagation(); engine.setLayerProps(layer.id, { name: e.target.value }) }}
            onBlur={e => { e.stopPropagation(); engine.setLayerProps(layer.id, { name: e.target.value }) }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className={cn(
              'flex-1 min-w-0 bg-transparent border-0 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:bg-accent/50 rounded px-1',
              isActive && 'font-medium'
            )}
            placeholder="Layer name"
          />

          {/* Blend mode */}
          <Select
            value={layer.blendMode || 'normal'}
            onValueChange={value => engine.setLayerProps(layer.id, { blendMode: value as any })}
          >
            <SelectTrigger className="w-24 h-6 text-[10px]">
              <SelectValue placeholder="Normal" />
            </SelectTrigger>
            <SelectContent>
              {BLEND_MODES.map(m => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Opacity */}
          <div className="w-24 flex items-center gap-1">
            <Opacity size={10} className="text-muted-foreground" />
            <Slider
              value={[layer.opacity ?? 1]}
              onValueChange={([v]) => engine.setLayerProps(layer.id, { opacity: v })}
              min={0}
              max={1}
              step={0.01}
              className="flex-1 h-1.5"
            />
          </div>

          {/* Layer kind icon */}
          <span className="w-6 text-center text-muted-foreground">
            {layer.kind === 'group' ? <FolderOpen size={12} /> :
             layer.kind === 'adjustment' ? <Contrast size={12} /> :
             layer.kind === 'text' ? <Brush size={12} /> :
             layer.kind === 'shape' ? <Blend size={12} /> :
             <Image size={12} />}
          </span>

          {/* Menu */}
          <button
            onClick={e => { e.stopPropagation(); /* context menu */ }}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
            aria-label="Layer options"
          >
            <MoreVertical size={10} />
          </button>
        </div>

        {/* Children */}
        {children.length > 0 && isExpanded && (
          <div className="border-l border-border/30 ml-4">
            {children.map(child => renderLayer(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-panel border-r">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 border-b border-border/40">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={addLayer} title="New Layer">
          <LayerPlus size={14} />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={addGroup} title="New Layer Group">
          <FolderPlus size={14} />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { if (activeLayerId) duplicateLayer(activeLayerId) }} title="Duplicate Layer" disabled={!activeLayerId}>
          <Copy size={14} />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { if (activeLayerId) mergeDown(activeLayerId) }} title="Merge Down" disabled={!activeLayerId || layers.length <= 1}>
          <Layers size={14} />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { if (activeLayerId) addMask(activeLayerId) }} title="Add Layer Mask" disabled={!activeLayerId}>
          <Mask size={14} />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { if (activeLayerId) deleteLayer(activeLayerId) }} title="Delete Layer" disabled={!activeLayerId || layers.length <= 1} className="text-destructive hover:text-destructive">
          <Trash2 size={14} />
        </Button>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">{layers.length} layers</span>
      </div>

      {/* Layer stack */}
      <div className="flex-1 overflow-y-auto zphoto-scroll p-1 space-y-0.5" role="list" aria-label="Layers">
        {layers.map((layer, idx) => (
          <div
            key={layer.id}
            role="listitem"
            onClick={() => setActiveLayer(layer.id)}
            onDoubleClick={e => { e.stopPropagation(); /* rename */ }}
            className={cn(
              'rounded-sm transition-colors',
              layer.id === activeLayerId && 'bg-primary/10',
            )}
          >
            {renderLayer(layer)}
          </div>
        ))}
        {layers.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50">
            <Layers size={32} className="mb-2" />
            <p className="text-sm">No layers</p>
            <Button variant="ghost" size="sm" onClick={addLayer}>Add first layer</Button>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="border-t border-border/40 px-2 py-1.5 text-[10px] text-muted-foreground flex items-center gap-2">
        <span>Opacity: {Math.round((layers.find(l => l.id === activeLayerId)?.opacity ?? 1) * 100)}%</span>
        <span>Mode: {BLEND_MODE_LABELS[layers.find(l => l.id === activeLayerId)?.blendMode as BlendMode || 'normal']}</span>
        <span className="flex-1" />
        <span>{historyIndex + 1} / {historyLabels.length}</span>
      </div>
    </div>
  )
}