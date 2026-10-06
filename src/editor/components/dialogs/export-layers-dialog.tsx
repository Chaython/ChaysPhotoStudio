'use client'

import { useMemo, useState } from 'react'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { encodeCanvas } from '../../formats'
import { createCanvas, ctx2d, downloadBlob, getImageData } from '../../utils/canvas'
import type { DialogProps } from './generic-dialogs'

type ExportFormat = 'png' | 'jpeg' | 'webp'

function cleanName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Layer'
}

function trimTransparent(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const data = getImageData(canvas).data
  let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] === 0) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX || maxY < minY) return createCanvas(1, 1)
  if (minX === 0 && minY === 0 && maxX === canvas.width - 1 && maxY === canvas.height - 1) return canvas
  const out = createCanvas(maxX - minX + 1, maxY - minY + 1)
  ctx2d(out).drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

export function ExportLayersDialog({ onClose }: DialogProps) {
  const doc = engine.activeDoc
  const [format, setFormat] = useState<ExportFormat>('png')
  const [quality, setQuality] = useState(92)
  const [prefix, setPrefix] = useState('')
  const [visibleOnly, setVisibleOnly] = useState(true)
  const [trim, setTrim] = useState(true)
  const [includeMetadata, setIncludeMetadata] = useState(true)
  const [busy, setBusy] = useState(false)

  const layers = useMemo(
    () => (doc?.layers ?? []).filter(layer => layer.kind !== 'adjustment' && (!visibleOnly || layer.visible)),
    [doc, visibleOnly],
  )

  const exportLayers = async () => {
    if (!doc || busy || layers.length === 0) return
    setBusy(true)
    const store = useEditorStore.getState()
    const ext = format === 'jpeg' ? 'jpg' : format
    const picker = (window as any).showDirectoryPicker as undefined | ((opts?: any) => Promise<any>)
    let directory: any = null

    try {
      if (picker) {
        try {
          directory = await picker({ mode: 'readwrite' })
        } catch (err: any) {
          if (err?.name === 'AbortError') return
          // Permission/API failures fall back to normal browser downloads.
        }
      }

      let exported = 0
      const basePrefix = cleanName(prefix || doc.name.replace(/\.[^.]+$/, ''))
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i]
        store.setProgress({
          active: true,
          label: 'Exporting layer ' + (i + 1) + '/' + layers.length + ': ' + layer.name,
          value: i / layers.length,
        })
        let canvas = engine.renderIsolatedLayer(layer.id)
        if (!canvas) continue
        if (trim) canvas = trimTransparent(canvas)
        const blob = await encodeCanvas(canvas, format, {
          quality,
          background: '#ffffff',
          metadata: doc.metadata,
          includeMetadata,
          resolutionPpi: doc.resolutionPpi ?? 72,
        })
        const index = String(i + 1).padStart(Math.max(2, String(layers.length).length), '0')
        const fileName = basePrefix + ' - ' + index + ' - ' + cleanName(layer.name) + '.' + ext
        if (directory) {
          const handle = await directory.getFileHandle(fileName, { create: true })
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
        } else {
          downloadBlob(blob, fileName)
          await new Promise(resolve => setTimeout(resolve, 80))
        }
        exported++
      }
      store.pushToast('Exported ' + exported + ' layer' + (exported === 1 ? '' : 's') + ' as ' + format.toUpperCase(), 'success')
      onClose()
    } catch (err) {
      const why = err instanceof Error && err.message ? ' — ' + err.message : ''
      store.pushToast('Layer export failed' + why, 'error')
    } finally {
      store.setProgress(null)
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader><DialogTitle>Export Layers to Files</DialogTitle></DialogHeader>
      <div className="space-y-3 py-1">
        <div className="text-[11px] text-muted-foreground">
          Exports each raster, Smart Object, text, and shape layer through the normal compositor so masks and Layer Styles are preserved. Adjustment layers are skipped because they have no standalone pixels.
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">File prefix</Label>
            <Input
              value={prefix}
              onChange={e => setPrefix(e.target.value)}
              placeholder={doc?.name?.replace(/\.[^.]+$/, '') || 'Document'}
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Format</Label>
            <Select value={format} onValueChange={v => setFormat(v as ExportFormat)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="png" className="text-xs">PNG</SelectItem>
                <SelectItem value="jpeg" className="text-xs">JPEG</SelectItem>
                <SelectItem value="webp" className="text-xs">WebP</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {format !== 'png' && (
          <div className="space-y-1">
            <Label className="text-[11px]">Quality — {quality}%</Label>
            <input
              type="range"
              min={1}
              max={100}
              value={quality}
              onChange={e => setQuality(Number(e.target.value))}
              className="w-full"
            />
          </div>
        )}

        <div className="rounded border border-border/60 p-2 space-y-2 text-[11px]">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={visibleOnly} onChange={e => setVisibleOnly(e.target.checked)} />
            Visible layers only
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={trim} onChange={e => setTrim(e.target.checked)} />
            Trim transparent pixels
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={includeMetadata} onChange={e => setIncludeMetadata(e.target.checked)} />
            Include File Info metadata
          </label>
        </div>

        <div className="text-[10px] text-muted-foreground">
          {layers.length} exportable layer{layers.length === 1 ? '' : 's'} · File System Access browsers save into one chosen folder; other browsers download each file separately.
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={() => void exportLayers()} disabled={!doc || !layers.length || busy}>
          {busy ? 'Exporting…' : 'Export Layers'}
        </Button>
      </DialogFooter>
    </>
  )
}
