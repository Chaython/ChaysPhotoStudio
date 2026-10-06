'use client'

import { useMemo, useState } from 'react'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import type { DialogProps } from './generic-dialogs'

export function DuplicateLayerDialog({ inst, onClose }: DialogProps) {
  const sourceDoc = engine.activeDoc
  const layerId = String(inst.props?.layerId ?? engine.activeLayer?.id ?? '')
  const layer = sourceDoc?.layers.find(candidate => candidate.id === layerId) ?? null
  const destinations = useMemo(
    () => engine.docs.filter(doc => doc.id !== sourceDoc?.id),
    [sourceDoc?.id],
  )
  const [targetId, setTargetId] = useState(destinations[0]?.id ?? '')
  const [name, setName] = useState(layer ? layer.name + ' copy' : 'Layer copy')

  const duplicate = () => {
    if (!layer || !targetId) return
    const copy = engine.duplicateLayerToDocument(layer.id, targetId, name)
    if (!copy) {
      useEditorStore.getState().pushToast('Could not duplicate layer into the selected document', 'error')
      return
    }
    const target = engine.docs.find(doc => doc.id === targetId)
    useEditorStore.getState().pushToast('Duplicated “' + layer.name + '” into “' + (target?.name ?? 'document') + '”', 'success')
    onClose()
  }

  return (
    <>
      <DialogHeader><DialogTitle>Duplicate Layer Into Document</DialogTitle></DialogHeader>
      <div className="space-y-3 py-1">
        <div className="text-[11px] text-muted-foreground">
          Duplicates the editable layer without flattening its pixels, masks, Smart Object data, Blend-If, or Layer Styles.
        </div>

        <div className="space-y-1">
          <Label className="text-[11px]">As</Label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={255}
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px]">Destination document</Label>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose a document" /></SelectTrigger>
            <SelectContent className="z-50">
              {destinations.map(doc => (
                <SelectItem key={doc.id} value={doc.id} className="text-xs">
                  {doc.name} — {doc.width}×{doc.height}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!destinations.length && (
          <div className="rounded border border-border bg-muted/30 px-2.5 py-2 text-[10px] text-muted-foreground">
            Open another document first. Ctrl+J still duplicates the layer inside the current document.
          </div>
        )}
      </div>

      <DialogFooter>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={duplicate} disabled={!layer || !targetId}>Duplicate</Button>
      </DialogFooter>
    </>
  )
}
