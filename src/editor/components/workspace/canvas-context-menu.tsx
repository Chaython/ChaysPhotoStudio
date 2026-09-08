'use client'
// Canvas right-click context menu (Move tool active): layer functions at the
// pointer — "Expand to Fill Frame" / smart-fill empty space, transform,
// duplicate/delete, arrange, flip, rasterize, merge, rename, properties.
// Rendered inside the Radix <ContextMenu> tree in canvas-workspace.tsx.
import { ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from '@/components/ui/context-menu'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { Frame, Copy, Trash2, FlipHorizontal, FlipVertical, Combine, SquareDashed, Sparkles, ClipboardPaste, Scaling, ArrowUpDown, Pencil, SlidersHorizontal, ArrowUp, ArrowUpToLine, ArrowDown, ArrowDownToLine, Image as ImageIcon, Type, Shapes, Layers } from 'lucide-react'
import type { Rect } from '../../types'

const kindLabel: Record<string, string> = {
  raster: 'Raster', smart: 'Smart Object', text: 'Text', shape: 'Shape', adjustment: 'Adjustment',
}
const kindIcon: Record<string, typeof ImageIcon> = {
  raster: ImageIcon, smart: Layers, text: Type, shape: Shapes, adjustment: SlidersHorizontal,
}

/** the menu content for the layer the user right-clicked (the layer under the
 *  cursor when one was hit — it was already made active — otherwise the
 *  active layer). Re-resolves the layer from the engine at render time so
 *  item state (kind/locked/index) is always current. */
export function CanvasLayerMenuContent({ layerId }: { layerId: string }) {
  const openDialog = useEditorStore(s => s.openDialog)
  const setRightPanelTab = useEditorStore(s => s.setRightPanelTab)
  const layer = engine.layerById(layerId)
  if (!layer) {
    return (
      <ContextMenuContent className="min-w-52">
        <ContextMenuLabel className="text-xs text-muted-foreground">Layer no longer exists</ContextMenuLabel>
      </ContextMenuContent>
    )
  }
  const doc = engine.activeDoc!
  const idx = doc.layers.findIndex(l => l.id === layer.id)
  const rect: Rect | null = engine.layerContentRect(layer.id)
  const pixelLayer = layer.kind !== 'adjustment'
  const canEdit = pixelLayer && !layer.locked
  const notBottom = idx > 0
  const notTop = idx < doc.layers.length - 1
  const act = (fn: () => void) => () => fn()

  const rename = () => {
    const name = prompt('Layer name:', layer.name)
    if (name && name.trim()) engine.setLayerProps(layer.id, { name: name.trim() }, { label: 'Rename Layer' })
  }
  const K = kindIcon[layer.kind] ?? ImageIcon

  return (
    <ContextMenuContent className="min-w-56 text-xs" aria-label={`Layer actions: ${layer.name}`}>
      <ContextMenuLabel className="text-xs font-medium truncate max-w-64 block">
        {layer.name}
        {layer.locked && <span className="text-muted-foreground font-normal"> · locked</span>}
      </ContextMenuLabel>
      <ContextMenuLabel className="text-[10px] text-muted-foreground pt-0 -mt-2 truncate max-w-64 block">
        <K className="inline size-3 mr-0.5 -mt-0.5 align-middle" aria-hidden />
        {kindLabel[layer.kind] ?? layer.kind}
        {rect && ` · ${Math.round(rect.w)}×${Math.round(rect.h)} · X ${Math.round(rect.x)} Y ${Math.round(rect.y)}`}
      </ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!canEdit} onClick={act(() => engine.expandLayerToFrame(layer.id))}>
        <Frame />
        Expand to Fill Frame
      </ContextMenuItem>
      <ContextMenuItem disabled={!canEdit} onClick={act(() => openDialog('transform', { layerId: layer.id }))}>
        <Scaling />
        Free Transform…
        <ContextMenuShortcut>Ctrl+T</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={!pixelLayer} onClick={act(() => openDialog('layer-styles', { layerId: layer.id }))}>
        <Sparkles />
        Layer Style{layer.fx ? ' (edit)' : '…'}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={act(() => engine.duplicateLayer(layer.id))}>
        <Copy />
        Duplicate Layer
        <ContextMenuShortcut>Ctrl+J</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={!pixelLayer} onClick={act(() => engine.copyLayer(false))}>
        <ClipboardPaste />
        Copy Layer Pixels
        <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onClick={act(() => engine.deleteLayer(layer.id))}>
        <Trash2 />
        Delete Layer
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <ArrowUpDown />
          Arrange
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="text-xs">
          <ContextMenuItem disabled={!notTop} onClick={act(() => engine.moveLayerBy(layer.id, +1))}><ArrowUp /> Bring Forward</ContextMenuItem>
          <ContextMenuItem disabled={!notTop} onClick={act(() => engine.reorderLayer(layer.id, doc.layers.length - 1))}><ArrowUpToLine /> Bring to Front</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!notBottom} onClick={act(() => engine.moveLayerBy(layer.id, -1))}><ArrowDown /> Send Backward</ContextMenuItem>
          <ContextMenuItem onClick={act(() => engine.reorderLayer(layer.id, 0))}><ArrowDownToLine /> Send to Back</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem disabled={!canEdit} onClick={act(() => engine.flipLayer(layer.id, 'horizontal'))}>
        <FlipHorizontal />
        Flip Layer Horizontal
      </ContextMenuItem>
      <ContextMenuItem disabled={!canEdit} onClick={act(() => engine.flipLayer(layer.id, 'vertical'))}>
        <FlipVertical />
        Flip Layer Vertical
      </ContextMenuItem>
      <ContextMenuSeparator />
      {layer.kind !== 'raster' && (
        <ContextMenuItem onClick={act(() => engine.rasterizeLayer(layer.id))}>
          <SquareDashed />
          Rasterize Layer
        </ContextMenuItem>
      )}
      <ContextMenuItem disabled={!notBottom} onClick={act(() => engine.mergeDown(layer.id))}>
        <Combine />
        Merge Down
        <ContextMenuShortcut>Ctrl+E</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={rename}><Pencil /> Rename…</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={act(() => setRightPanelTab('properties'))}><SlidersHorizontal /> Layer Properties…</ContextMenuItem>
    </ContextMenuContent>
  )
}
