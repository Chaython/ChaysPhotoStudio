'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { engine } from '../../engine/engine'
import { getFlatComposite } from '../../engine/document'
import { useEditorStore } from '../../store'
import { createCanvas, ctx2d, downloadBlob, uid } from '../../utils/canvas'
import { encodeCanvas } from '../../formats'
import { fileStem } from '../../web-assets'
import { artboardCrop, gridArtboards, MAX_ARTBOARDS, normalizeArtboards, type Artboard } from '../../artboards'
import type { DialogProps } from './generic-dialogs'

type ImageFormat = 'png' | 'jpeg' | 'webp'

export function ArtboardsDialog({ onClose }: DialogProps) {
  // The dialog cannot accidentally modify another document after a tab switch.
  const sourceId = useRef(engine.activeDoc?.id ?? null).current
  const doc = engine.docs.find(d => d.id === sourceId) ?? null
  const [boards, setBoards] = useState<Artboard[]>(() => doc
    ? normalizeArtboards(doc.artboards, doc.width, doc.height) : [])
  const [selectedId, setSelectedId] = useState<string | null>(
    () => doc?.activeArtboardId ?? null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null)
  const [format, setFormat] = useState<ImageFormat>('png')
  const [quality, setQuality] = useState(90)
  const [exportChoice, setExportChoice] = useState<'all' | 'selected'>('all')
  const [busy, setBusy] = useState(false)
  const [outlines, setOutlines] = useState(() => doc?.showArtboardOutlines !== false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const thumb = useMemo(() => {
    if (!doc) return { width: 1, height: 1 }
    const scale = Math.min(1, 590 / doc.width, 340 / doc.height)
    return { width: Math.max(1, Math.round(doc.width * scale)), height: Math.max(1, Math.round(doc.height * scale)) }
  }, [doc])

  useEffect(() => {
    if (!doc || !canvasRef.current) return
    try {
      const ctx = canvasRef.current.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, thumb.width, thumb.height)
        ctx.drawImage(getFlatComposite(doc), 0, 0, thumb.width, thumb.height)
      }
    } catch (error) {
      useEditorStore.getState().pushToast('Artboard preview unavailable: ' + String(error), 'error')
    }
  }, [doc, thumb])

  const active = boards.find(b => b.id === selectedId) ?? null
  const select = (id: string | null) => {
    setSelectedId(id)
    if (doc && engine.activeDoc?.id === sourceId) {
      doc.activeArtboardId = id
      engine.emitOverlay()
    }
  }
  const save = (items: Artboard[], focus: string | null = selectedId) => {
    if (!doc || engine.activeDoc?.id !== sourceId || busy) return
    const valid = normalizeArtboards(items, doc.width, doc.height)
    const nextFocus = focus && valid.some(a => a.id === focus) ? focus : valid[0]?.id ?? null
    setBoards(valid)
    setSelectedId(nextFocus)
    doc.artboards = valid.map(a => ({ ...a }))
    doc.activeArtboardId = nextFocus
    // Commit document layout edits to History just like other editable geometry.
    engine.pushHistory('Edit Artboards', doc)
    engine.emit()
  }
  const modify = (props: Partial<Artboard>) => {
    if (!active) return
    save(boards.map(board => board.id === active.id ? { ...board, ...props } : board), active.id)
  }
  const position = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!doc || !previewRef.current) return null
    const rect = previewRef.current.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    return {
      x: Math.max(0, Math.min(doc.width - 1, Math.floor((event.clientX - rect.left) * doc.width / rect.width))),
      y: Math.max(0, Math.min(doc.height - 1, Math.floor((event.clientY - rect.top) * doc.height / rect.height))),
    }
  }
  const startDraw = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy || event.button !== 0 || !doc || engine.activeDoc?.id !== sourceId) return
    const p = position(event)
    if (!p) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag(p); setDragEnd(p)
  }
  const finishDraw = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!doc || !drag || busy) return
    const last = position(event)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDrag(null); setDragEnd(null)
    if (!last) return
    if (Math.abs(last.x - drag.x) <= 2 && Math.abs(last.y - drag.y) <= 2) {
      const hit = [...boards].reverse().find(b => last.x >= b.x && last.x < b.x + b.width && last.y >= b.y && last.y < b.y + b.height)
      select(hit?.id ?? null)
      return
    }
    if (boards.length >= MAX_ARTBOARDS) {
      useEditorStore.getState().pushToast('Artboard limit reached', 'error')
      return
    }
    const id = uid(), x = Math.min(drag.x, last.x), y = Math.min(drag.y, last.y)
    save([...boards, { id, name: 'Artboard ' + (boards.length + 1),
      x, y, width: Math.abs(last.x - drag.x) + 1, height: Math.abs(last.y - drag.y) + 1 }], id)
  }
  const addFull = () => {
    if (!doc || boards.length >= MAX_ARTBOARDS) return
    const id = uid()
    save([...boards, { id, name: 'Artboard ' + (boards.length + 1),
      x: 0, y: 0, width: doc.width, height: doc.height }], id)
  }
  const addGrid = (columns: number, rows: number) => {
    if (!doc) return
    const tiles = gridArtboards(doc.width, doc.height, columns, rows, uid)
    if (boards.length + tiles.length > MAX_ARTBOARDS) return
    save([...boards, ...tiles.map((a, i) => ({ ...a, name: 'Artboard ' + (boards.length + i + 1) }))],
      tiles[0]?.id ?? selectedId)
  }
  const cloneActive = () => {
    if (!active || !doc || boards.length >= MAX_ARTBOARDS) return
    const id = uid()
    const x = Math.min(doc.width - active.width, active.x + 20)
    const y = Math.min(doc.height - active.height, active.y + 20)
    save([...boards, { ...active, id, name: active.name + ' copy', x, y }], id)
  }
  const exportArtboards = async () => {
    if (!doc || busy || engine.activeDoc?.id !== sourceId) return
    const output = exportChoice === 'selected' ? boards.filter(a => a.id === selectedId) : boards
    if (!output.length) return
    setBusy(true)
    const store = useEditorStore.getState()
    let directory: any = null
    try {
      const picker = (window as any).showDirectoryPicker as undefined | ((options?: any) => Promise<any>)
      if (picker) {
        try { directory = await picker({ mode: 'readwrite' }) }
        catch (error: any) { if (error?.name === 'AbortError') return }
      }
      // User may have changed tabs while approving the directory picker.
      if (engine.activeDoc?.id !== sourceId) throw new Error('Active document changed')
      const composite = getFlatComposite(doc)
      const extension = format === 'jpeg' ? 'jpg' : format
      const prefix = fileStem(doc.name)
      for (let i = 0; i < output.length; i++) {
        const board = output[i]
        const rect = artboardCrop(board, doc.width, doc.height)
        if (!rect) continue
        store.setProgress({ active: true, label: 'Exporting artboard ' + (i + 1) + '/' + output.length,
          value: i / output.length })
        const cropped = createCanvas(rect.sw, rect.sh)
        ctx2d(cropped).drawImage(composite, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh)
        const blob = await encodeCanvas(cropped, format, { quality, background: '#ffffff',
          includeMetadata: false, resolutionPpi: doc.resolutionPpi ?? 72 })
        const filename = prefix + '-artboard-' + String(i + 1).padStart(2, '0')
          + '-' + fileStem(board.name) + '.' + extension
        if (directory) {
          const file = await directory.getFileHandle(filename, { create: true })
          const writable = await file.createWritable()
          try { await writable.write(blob) } finally { await writable.close() }
        } else {
          downloadBlob(blob, filename)
          // Avoid a burst of simultaneous downloads in browser fallback.
          await new Promise(resolve => setTimeout(resolve, 80))
        }
      }
      store.pushToast('Exported ' + output.length + ' artboard' + (output.length === 1 ? '' : 's'), 'success')
      onClose()
    } catch (error) {
      store.pushToast('Artboard export failed: ' + (error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      store.setProgress(null)
      setBusy(false)
    }
  }
  const percentBox = (b: { x: number; y: number; width: number; height: number }): CSSProperties => ({
    left: (b.x * 100 / (doc?.width || 1)) + '%',
    top: (b.y * 100 / (doc?.height || 1)) + '%',
    width: (b.width * 100 / (doc?.width || 1)) + '%',
    height: (b.height * 100 / (doc?.height || 1)) + '%',
  })
  const draft = drag && dragEnd ? {
    x: Math.min(drag.x, dragEnd.x), y: Math.min(drag.y, dragEnd.y),
    width: Math.abs(dragEnd.x - drag.x) + 1, height: Math.abs(dragEnd.y - drag.y) + 1,
  } : null
  const field = (key: 'x' | 'y' | 'width' | 'height') =>
    <div key={key} className="space-y-1">
      <Label className="text-[10px] uppercase">{key}</Label>
      <Input className="h-7 text-xs" aria-label={'Artboard ' + key} type="number"
        min={key === 'width' || key === 'height' ? 1 : 0}
        value={active?.[key] ?? 0} onChange={event => {
          if (!active || !doc) return
          const n = Number(event.target.value)
          if (!Number.isSafeInteger(n)) return
          const max = key === 'x' ? doc.width - 1 : key === 'y' ? doc.height - 1
            : key === 'width' ? doc.width - active.x : doc.height - active.y
          modify({ [key]: Math.max(key === 'width' || key === 'height' ? 1 : 0, Math.min(max, n)) })
        }} />
    </div>

  return <>
    <DialogHeader><DialogTitle>Artboards / Pages</DialogTitle></DialogHeader>
    {!doc ? <p className="text-xs">Open a document to manage artboards.</p> : (
      <div className="space-y-3 text-xs">
        <p className="text-muted-foreground">Define several named export regions within the same editable document. Drag to create an artboard; click a region to edit it. The existing layer stack stays intact.</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="secondary" disabled={busy || boards.length >= MAX_ARTBOARDS} onClick={addFull}>Add canvas</Button>
          <Button size="sm" variant="secondary" disabled={busy || boards.length + 2 > MAX_ARTBOARDS} onClick={() => addGrid(2, 1)}>Split 2</Button>
          <Button size="sm" variant="secondary" disabled={busy || boards.length + 4 > MAX_ARTBOARDS} onClick={() => addGrid(2, 2)}>Grid 2×2</Button>
          <label className="flex items-center gap-1 text-[10px] ml-auto"><input type="checkbox" checked={outlines}
            onChange={e => { if (!doc || engine.activeDoc?.id !== sourceId) return
              setOutlines(e.target.checked); doc.showArtboardOutlines = e.target.checked; doc.dirty = true; engine.emitOverlay() }} />Show on canvas</label>
          <span className="text-muted-foreground">{boards.length}/{MAX_ARTBOARDS}</span>
        </div>
        <div ref={previewRef} className="relative mx-auto touch-none select-none border border-border overflow-hidden" style={{ width: thumb.width, aspectRatio: doc.width + ' / ' + doc.height, maxWidth: '100%' }}>
          <canvas ref={canvasRef} width={thumb.width} height={thumb.height} className="absolute inset-0 w-full h-full" />
          {boards.map(board => <div key={board.id} className={'absolute pointer-events-none border-2 ' +
            (selectedId === board.id ? 'border-yellow-300 bg-yellow-300/10' : 'border-sky-400 bg-sky-400/5')}
            style={percentBox(board)}>
            <span className="absolute left-0 top-0 bg-black/75 text-white px-1 text-[9px] whitespace-nowrap">{board.name}</span>
          </div>)}
          {draft && <div className="absolute pointer-events-none border-2 border-dashed border-emerald-400 bg-emerald-400/10" style={percentBox(draft)} />}
          <div className="absolute inset-0 cursor-crosshair" onPointerDown={startDraw}
            onPointerMove={event => { if (drag) setDragEnd(position(event)) }}
            onPointerUp={finishDraw} onPointerCancel={() => { setDrag(null); setDragEnd(null) }} />
        </div>
        <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
          {boards.map(board => <button key={board.id} type="button" disabled={busy} onClick={() => select(board.id)}
            className={'rounded border px-2 py-1 text-[10px] ' +
              (selectedId === board.id ? 'border-primary bg-primary/15' : 'border-border')}>
            {board.name} · {board.width}×{board.height}
          </button>)}
          {!boards.length && <span className="text-muted-foreground">No artboards defined; existing single-canvas export remains unchanged.</span>}
        </div>
        {active && <div className="space-y-2 rounded border border-border p-2">
          <div className="flex gap-2 items-center">
            <Input aria-label="Artboard name" className="h-7 text-xs flex-1" value={active.name}
              onChange={event => modify({ name: event.target.value || 'Artboard' })} />
            <Button size="sm" variant="secondary" disabled={busy || boards.length >= MAX_ARTBOARDS} onClick={cloneActive}>Duplicate</Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => save(boards.filter(b => b.id !== active.id), null)}>Delete</Button>
          </div>
          <div className="grid grid-cols-4 gap-2">{(['x', 'y', 'width', 'height'] as const).map(field)}</div>
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          <Label>Export</Label>
          <select className="rounded border border-border bg-background p-1" aria-label="Artboards to export"
            value={exportChoice} onChange={e => setExportChoice(e.target.value as 'all' | 'selected')}>
            <option value="all">All artboards</option><option value="selected">Selected artboard</option>
          </select>
          <select aria-label="Artboard export format" className="rounded border border-border bg-background p-1"
            value={format} onChange={e => setFormat(e.target.value as ImageFormat)}>
            <option value="png">PNG</option><option value="webp">WebP</option><option value="jpeg">JPEG</option>
          </select>
          {format !== 'png' && <label className="flex items-center gap-1">Quality {quality}
            <input aria-label="Artboard image quality" type="range" min={1} max={100} value={quality}
              onChange={e => setQuality(Number(e.target.value))}/></label>}
        </div>
        <p className="text-[10px] text-muted-foreground">Artboards are editable document-space rectangles, saved in .zproj.json. They currently share one layer stack; there is no per-artboard layer isolation, off-canvas page expansion, independent page undo, native AI export or Fireworks project interchange. Output is a flattened crop at the current display precision.</p>
      </div>
    )}
    <DialogFooter>
      <Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>Close</Button>
      <Button size="sm" disabled={!doc || busy || !boards.length || (exportChoice === 'selected' && !active)}
        onClick={() => void exportArtboards()}>{busy ? 'Exporting…' : 'Export Artboards'}</Button>
    </DialogFooter>
  </>
}
