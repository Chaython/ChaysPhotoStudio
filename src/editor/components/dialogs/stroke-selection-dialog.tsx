'use client'
import { useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import type { StrokePlacement } from '../../image-ops/selection-stroke'
import type { DialogProps } from './generic-dialogs'

export function StrokeSelectionDialog({ onClose }: DialogProps) {
  const fg = useEditorStore(s => s.fgColor)
  const [width, setWidth] = useState(3)
  const [placement, setPlacement] = useState<StrokePlacement>('inside')
  const [color, setColor] = useState(/^#[0-9a-f]{6}$/i.test(fg) ? fg : '#ffffff')
  const [opacity, setOpacity] = useState(100)
  const [busy, setBusy] = useState(false)
  const apply = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (await engine.strokeSelectionToLayer({ width, placement, color, opacity })) onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <DialogHeader><DialogTitle>Stroke Selection</DialogTitle></DialogHeader>
      <p className="text-xs text-muted-foreground">
        Outline the active selection on a new layer. Original artwork, masks, and styles stay editable.
      </p>
      <div className="space-y-3 py-1">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="stroke-width" className="text-xs">Width (pixels)</Label>
            <Input id="stroke-width" className="h-8 text-xs" type="number" min={1} max={200} step={1}
              value={width} onChange={e => setWidth(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Location</Label>
            <Select value={placement} onValueChange={v => setPlacement(v as StrokePlacement)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inside">Inside</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="outside">Outside</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="stroke-color" className="text-xs">Stroke color</Label>
            <Input id="stroke-color" className="h-8 cursor-pointer px-1" type="color"
              value={color} onChange={e => setColor(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="stroke-opacity" className="text-xs">Opacity (%)</Label>
            <Input id="stroke-opacity" className="h-8 text-xs" type="number" min={0} max={100} step={1}
              value={opacity} onChange={e => setOpacity(Number(e.target.value))} />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Follows selection contours, holes, feathering and canvas edges. Large images use background processing.
        </p>
      </div>
      <DialogFooter>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={busy || !Number.isInteger(width) || width < 1 || width > 200 ||
          !Number.isFinite(opacity) || opacity < 0 || opacity > 100} onClick={() => { void apply() }}>
          {busy ? 'Applying…' : 'Stroke on New Layer'}
        </Button>
      </DialogFooter>
    </>
  )
}
