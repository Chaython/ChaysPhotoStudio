'use client'
import { Fragment } from 'react'
// Shared canvas (Move tool) and Layers-panel right-click menu: layer functions at the
// pointer — "Expand to Fill Frame" / smart-fill empty space, transform,
// duplicate/delete, arrange, flip, rasterize, merge, rename, properties.
// Rendered inside the Radix <ContextMenu> tree in canvas-workspace.tsx.
import { ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from '@/components/ui/context-menu'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { Frame, Copy, Trash2, FlipHorizontal, FlipVertical, Combine, SquareDashed, Sparkles, ClipboardPaste, Scaling, ArrowUpDown, Pencil, SlidersHorizontal, ArrowUp, ArrowUpToLine, ArrowDown, ArrowDownToLine, Image as ImageIcon, Type, Shapes, Layers } from 'lucide-react'
import type { Rect } from '../../types'
import { Settings2, Undo2, Redo2, Scissors, Square, Stamp, PenTool, CornerDownRight, ScanLine } from 'lucide-react'
import { LAYER_CONTEXT_MENU_SECTIONS, normalizeLayerContextPreferences, type LayerContextActionId, type LayerContextMenuPreferences } from './layer-context-menu-config'

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
export function CanvasLayerMenuContent({
  layerId, preferences, onCustomize, onRename,
}: {
  layerId: string
  preferences: LayerContextMenuPreferences
  onCustomize: () => void
  onRename?: () => void
}) {
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
  const canMask = !layer.locked && !layer.mask
  const hasMask = !!layer.mask
  const hasVectorMask = !!layer.vectorMask
  const notBottom = idx > 0
  const notTop = idx < doc.layers.length - 1
  const act = (fn: () => void) => () => fn()

  const rename = () => {
    const name = prompt('Layer name:', layer.name)
    if (name && name.trim()) engine.setLayerProps(layer.id, { name: name.trim() }, { label: 'Rename Layer' })
  }
  const K = kindIcon[layer.kind] ?? ImageIcon

  const safePreferences = normalizeLayerContextPreferences(preferences)
  const actions: Record<LayerContextActionId, React.ReactNode> = {
    'undo': (<ContextMenuItem disabled={doc.history.index <= 0} onClick={() => engine.undo()}><Undo2 />Undo<ContextMenuShortcut>Ctrl+Z</ContextMenuShortcut></ContextMenuItem>),
    'redo': (<ContextMenuItem disabled={doc.history.index >= doc.history.states.length - 1} onClick={() => engine.redo()}><Redo2 />Redo<ContextMenuShortcut>Ctrl+Shift+Z</ContextMenuShortcut></ContextMenuItem>),
    'cut': (<ContextMenuItem disabled={!canEdit} onClick={() => engine.cutLayer()}><Scissors />Cut Layer<ContextMenuShortcut>Ctrl+X</ContextMenuShortcut></ContextMenuItem>),
    'paste': (<ContextMenuItem onClick={() => { void engine.pasteLayer() }}><ClipboardPaste />Paste Layer<ContextMenuShortcut>Ctrl+V</ContextMenuShortcut></ContextMenuItem>),
    'expand': (
      <ContextMenuItem disabled={!canEdit} onClick={act(() => engine.expandLayerToFrame(layer.id))}>
        <Frame />
        Expand to Fill Frame
      </ContextMenuItem>
    ),
    'transform': (
      <ContextMenuItem disabled={!canEdit} onClick={act(() => openDialog('transform', { layerId: layer.id }))}>
        <Scaling />
        Free Transform…
        <ContextMenuShortcut>Ctrl+T</ContextMenuShortcut>
      </ContextMenuItem>
    ),
    'style': (
      <ContextMenuItem disabled={!pixelLayer} onClick={act(() => openDialog('layer-styles', { layerId: layer.id }))}>
        <Sparkles />
        Layer Style{layer.fx ? ' (edit)' : '…'}
      </ContextMenuItem>
    ),
    'copy-style': (
      <ContextMenuItem disabled={!layer.fx} onClick={act(() => engine.copyLayerStyle(layer.id))}>
        <Copy />
        Copy Layer Style
      </ContextMenuItem>
    ),
    'paste-style': (
      <ContextMenuItem disabled={!pixelLayer || !engine.canPasteLayerStyle} onClick={act(() => engine.pasteLayerStyle(layer.id))}>
        <ClipboardPaste />
        Paste Layer Style
      </ContextMenuItem>
    ),
    'clear-style': (
      <ContextMenuItem disabled={!layer.fx} onClick={act(() => engine.clearLayerStyle(layer.id))}>
        <Trash2 />
        Clear Layer Style
      </ContextMenuItem>
    ),
    'matting': (
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={!canEdit}>
          <Sparkles />
          Matting
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="text-xs">
          <ContextMenuItem onClick={act(() => {
            const raw = prompt('Defringe width (pixels):', '1')
            if (raw === null) return
            const px = Math.max(1, Math.min(64, Math.round(Number(raw) || 1)))
            engine.defringeLayer(layer.id, px)
          })}>Defringe…</ContextMenuItem>
          <ContextMenuItem onClick={act(() => engine.removeLayerMatte(layer.id, 'black'))}>Remove Black Matte</ContextMenuItem>
          <ContextMenuItem onClick={act(() => engine.removeLayerMatte(layer.id, 'white'))}>Remove White Matte</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    ),
    'duplicate': (
      <ContextMenuItem onClick={act(() => engine.duplicateLayer(layer.id))}>
        <Copy />
        Duplicate Layer
        <ContextMenuShortcut>Ctrl+J</ContextMenuShortcut>
      </ContextMenuItem>
    ),
    'duplicate-into': (
      <ContextMenuItem disabled={engine.docs.length < 2} onClick={act(() => openDialog('duplicate-layer', { layerId: layer.id }))}>
        <Copy />
        Duplicate Into…
      </ContextMenuItem>
    ),
    'copy-pixels': (
      <ContextMenuItem disabled={!pixelLayer} onClick={act(() => engine.copyLayer(false))}>
        <ClipboardPaste />
        Copy Layer Pixels
        <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
      </ContextMenuItem>
    ),
    'delete': (
      <ContextMenuItem variant="destructive" onClick={act(() => engine.deleteLayer(layer.id))}>
        <Trash2 />
        Delete Layer
      </ContextMenuItem>
    ),
    'arrange': (
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
    ),
    'flip-h': (
      <ContextMenuItem disabled={!canEdit} onClick={act(() => engine.flipLayer(layer.id, 'horizontal'))}>
        <FlipHorizontal />
        Flip Layer Horizontal
      </ContextMenuItem>
    ),
    'flip-v': (
      <ContextMenuItem disabled={!canEdit} onClick={act(() => engine.flipLayer(layer.id, 'vertical'))}>
        <FlipVertical />
        Flip Layer Vertical
      </ContextMenuItem>
    ),
    'merge-down': (
      <ContextMenuItem disabled={!notBottom} onClick={act(() => engine.mergeDown(layer.id))}>
        <Combine />
        Merge Down
        <ContextMenuShortcut>Ctrl+E</ContextMenuShortcut>
      </ContextMenuItem>
    ),
    'rename': (
      <ContextMenuItem onClick={onRename ?? rename}><Pencil /> Rename…</ContextMenuItem>
    ),
    'properties': (
      <ContextMenuItem onClick={act(() => setRightPanelTab('properties'))}><SlidersHorizontal /> Layer Properties…</ContextMenuItem>
    ),
    'mask-selection': (
      <ContextMenuItem disabled={!canMask} onClick={() => engine.addLayerMask(layer.id, true)}>
        <SquareDashed /> Add Mask from Selection
      </ContextMenuItem>
    ),
    'mask-reveal': (
      <ContextMenuItem disabled={!canMask} onClick={() => engine.addLayerMask(layer.id, false)}>
        <Square /> Add Mask (Reveal All)
      </ContextMenuItem>
    ),
    'mask-apply': (hasMask ? (
      <ContextMenuItem disabled={layer.locked || layer.kind !== 'raster' || !layer.maskEnabled} onClick={() => engine.deleteLayerMask(layer.id, true)}>
        <Stamp /> Apply Mask
      </ContextMenuItem>
    ) : null),
    'mask-delete': (hasMask ? (
      <ContextMenuItem disabled={layer.locked} onClick={() => engine.deleteLayerMask(layer.id, false)}>
        <Trash2 /> Delete Mask
      </ContextMenuItem>
    ) : null),
    'vector-mask-toggle': (hasVectorMask ? (
      <ContextMenuItem disabled={layer.locked} onClick={() => engine.toggleVectorMask(layer.id)}>
        <PenTool /> {layer.vectorMask?.enabled ? 'Disable' : 'Enable'} Vector Mask
      </ContextMenuItem>
    ) : null),
    'vector-mask-delete': (hasVectorMask ? (
      <ContextMenuItem disabled={layer.locked} onClick={() => engine.deleteVectorMask(layer.id)}>
        <Trash2 /> Delete Vector Mask
      </ContextMenuItem>
    ) : null),
    'clip-toggle': (
      <ContextMenuItem disabled={!notBottom || layer.locked} onClick={() => engine.toggleClipping(layer.id)}>
        <CornerDownRight /> {layer.clipped ? 'Release Clipping' : 'Clip to Layer Below'}
      </ContextMenuItem>
    ),
    'trim': (layer.kind === 'raster' ? (
      <ContextMenuItem disabled={layer.locked} onClick={() => engine.trimLayerToContent(layer.id)}>
        <ScanLine /> Trim to Content
      </ContextMenuItem>
    ) : null),
    'rasterize': (layer.kind !== 'raster' && !layer.locked ? (
      <ContextMenuItem onClick={act(() => engine.rasterizeLayer(layer.id))}>
          <SquareDashed />
          Rasterize Layer
        </ContextMenuItem>
    ) : null),
  }
  return (
    <ContextMenuContent className="z-50 min-w-56 text-xs max-h-[75vh] overflow-y-auto" aria-label={`Layer actions: ${layer.name}`}>
      <ContextMenuLabel className="text-xs font-medium truncate max-w-64 block">
        {layer.name}
        {layer.locked && <span className="text-muted-foreground font-normal"> · locked</span>}
      </ContextMenuLabel>
      <ContextMenuLabel className="text-[10px] text-muted-foreground pt-0 -mt-2 truncate max-w-64 block">
        <K className="inline size-3 mr-0.5 -mt-0.5 align-middle" aria-hidden />
        {kindLabel[layer.kind] ?? layer.kind}
        {rect && ` · ${Math.round(rect.w)}×${Math.round(rect.h)} · X ${Math.round(rect.x)} Y ${Math.round(rect.y)}`}
      </ContextMenuLabel>
      {LAYER_CONTEXT_MENU_SECTIONS.map(section => {
        const visible = safePreferences.order[section.id].filter(id => !safePreferences.hidden.includes(id) && actions[id] != null)
        if (!visible.length) return null
        return (
          <Fragment key={section.id}>
            <ContextMenuSeparator />
            {visible.map(id => <Fragment key={id}>{actions[id]}</Fragment>)}
          </Fragment>
        )
      })}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onCustomize}><Settings2 />Edit context menu…</ContextMenuItem>
    </ContextMenuContent>
  )
}
