'use client'

import { useEffect, useMemo, useState } from 'react'
import { Blend, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { engine } from '../../engine/engine'
import { getFlatComposite, invalidateFlat, prepareLayer } from '../../engine/document'
import { BLEND_MODES } from '../../constants/tools'
import { applyImageToCanvas, type ApplyImageChannel } from '../../image-ops/apply-image'
import { cloneCanvas } from '../../utils/canvas'
import { useEditorStore } from '../../store'
import type { BlendMode } from '../../types'
import type { DialogProps } from './generic-dialogs'

export function ApplyImageDialog({ onClose }: DialogProps) {
  const tick = useEditorStore(s => s.renderTick)
  void tick
  const doc = engine.activeDoc
  const target = engine.activeLayer

  const [sourceDocId, setSourceDocId] = useState(doc?.id ?? '')
  const [sourceLayerId, setSourceLayerId] = useState('merged')
  const [channel, setChannel] = useState<ApplyImageChannel>('rgb')
  const [blendMode, setBlendMode] = useState<BlendMode>('normal')
  const [opacity, setOpacity] = useState(100)
  const [invert, setInvert] = useState(false)
  const [preserveTransparency, setPreserveTransparency] = useState(false)
  const [busy, setBusy] = useState(false)

  const sourceDoc = engine.docs.find(d => d.id === sourceDocId) ?? doc
  const sourceLayers = useMemo(
    () => (sourceDoc?.layers ?? []).filter(layer => layer.kind !== 'adjustment'),
    [sourceDoc, tick],
  )

  useEffect(() => {
    if (!sourceDocId && doc) setSourceDocId(doc.id)
  }, [doc, sourceDocId])

  useEffect(() => {
    if (sourceLayerId !== 'merged' && !sourceLayers.some(layer => layer.id === sourceLayerId)) {
      setSourceLayerId('merged')
    }
  }, [sourceLayerId, sourceLayers])

  const apply = () => {
    if (!doc || !target || !sourceDoc || busy) return
    if (target.locked) {
      useEditorStore.getState().pushToast('Unlock the target layer before Apply Image', 'error')
      return
    }
    if (target.kind === 'adjustment') {
      useEditorStore.getState().pushToast('Apply Image needs a pixel-capable target layer', 'error')
      return
    }
    if (doc.workingBitDepth === 32) {
      useEditorStore.getState().pushToast('Apply Image is disabled for 32-bit HDR until scene-linear blending is supported', 'info')
      return
    }

    setBusy(true)
    try {
      const sourceBase = sourceLayerId === 'merged'
        ? getFlatComposite(sourceDoc)
        : prepareLayer(sourceDoc, sourceDoc.layers.find(layer => layer.id === sourceLayerId)!)
      if (!sourceBase) throw new Error('Source layer has no renderable pixels')

      // Snapshot before mutating the target; source and target may be the same layer.
      const sourceSnapshot = cloneCanvas(sourceBase)
      const wasRaster = target.kind === 'raster'
      const writable = engine.mutateLayerPixels(target.id)
      if (!writable?.canvas) throw new Error('Target layer has no writable pixels')

      const result = applyImageToCanvas(writable.canvas, sourceSnapshot, {
        channel,
        blendMode,
        opacity,
        invert,
        preserveTransparency,
        targetOffsetX: writable.offsetX ?? 0,
        targetOffsetY: writable.offsetY ?? 0,
        selectionMask: doc.selection?.mask ?? null,
      })

      writable.canvas = result
      writable._v++
      invalidateFlat(doc)
      engine.pushHistory('Apply Image')
      engine.emit()
      if (!wasRaster) useEditorStore.getState().pushToast('Target layer rasterized for Apply Image', 'info')
      useEditorStore.getState().pushToast('Apply Image completed', 'success')
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Apply Image failed'
      useEditorStore.getState().pushToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!doc || !target) {
    return (
      <>
        <DialogHeader><DialogTitle>Apply Image</DialogTitle></DialogHeader>
        <div className="py-4 text-xs text-muted-foreground">Open a document and select a layer first.</div>
        <DialogFooter><Button variant="secondary" size="sm" onClick={onClose}>Close</Button></DialogFooter>
      </>
    )
  }

  const mismatch = sourceDoc && (sourceDoc.width !== doc.width || sourceDoc.height !== doc.height)

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Blend size={15} className="text-primary" /> Apply Image</DialogTitle>
      </DialogHeader>

      <div className="space-y-3 py-1">
        <div className="rounded border border-border/60 bg-muted/20 px-2.5 py-2 text-[10px] text-muted-foreground">
          Blend a merged document or individual layer directly into <span className="text-foreground">{target.name}</span>.
          The active selection limits the operation automatically.
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] flex items-center gap-1"><ImageIcon size={11} /> Source document</Label>
          <Select value={sourceDoc?.id ?? ''} onValueChange={value => { setSourceDocId(value); setSourceLayerId('merged') }}>
            <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent className="z-50">
              {engine.docs.map(d => (
                <SelectItem key={d.id} value={d.id} className="text-[11px]">
                  {d.name} · {d.width} × {d.height}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Layer</Label>
            <Select value={sourceLayerId} onValueChange={setSourceLayerId}>
              <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="merged" className="text-[11px]">Merged</SelectItem>
                {sourceLayers.map(layer => (
                  <SelectItem key={layer.id} value={layer.id} className="text-[11px]">{layer.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px]">Channel</Label>
            <Select value={channel} onValueChange={value => setChannel(value as ApplyImageChannel)}>
              <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="rgb" className="text-[11px]">RGB</SelectItem>
                <SelectItem value="red" className="text-[11px]">Red</SelectItem>
                <SelectItem value="green" className="text-[11px]">Green</SelectItem>
                <SelectItem value="blue" className="text-[11px]">Blue</SelectItem>
                <SelectItem value="alpha" className="text-[11px]">Alpha</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Blending</Label>
            <Select value={blendMode} onValueChange={value => setBlendMode(value as BlendMode)}>
              <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50 max-h-72">
                {BLEND_MODES.map(mode => (
                  <SelectItem key={mode.value} value={mode.value} className="text-[11px]">{mode.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px]">Opacity — {opacity}%</Label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={opacity}
              onChange={e => setOpacity(Number(e.target.value))}
              className="w-full mt-2"
            />
          </div>
        </div>

        <div className="rounded border border-border/60 p-2 space-y-2 text-[11px]">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={invert} onCheckedChange={value => setInvert(value === true)} />
            Invert source channel
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={preserveTransparency} onCheckedChange={value => setPreserveTransparency(value === true)} />
            Preserve target transparency
          </label>
        </div>

        {mismatch && (
          <div className="text-[10px] text-amber-500">
            Source and target dimensions differ. Apply Image aligns them at document origin and clips pixels outside the target.
          </div>
        )}
        {doc.workingBitDepth === 32 && (
          <div className="text-[10px] text-amber-500">
            32-bit HDR Apply Image is disabled to avoid collapsing scene-linear Float32 data through Canvas blending.
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={busy || target.locked || target.kind === 'adjustment' || doc.workingBitDepth === 32}>
          {busy ? 'Applying…' : 'Apply'}
        </Button>
      </DialogFooter>
    </>
  )
}
