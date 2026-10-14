'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { engine } from '../../engine/engine'
import { compositeDocument, getFlatComposite } from '../../engine/document'
import { useEditorStore } from '../../store'
import { createCanvas, ctx2d, downloadBlob, uid } from '../../utils/canvas'
import { encodeCanvas } from '../../formats'
import { fileStem } from '../../web-assets'
import { artboardCrop, buildArtboardRolloverHtml, gridArtboards, layersForArtboard, MAX_ARTBOARDS, normalizeArtboards, type Artboard, type RolloverSlot } from '../../artboards'
import type { DialogProps } from './generic-dialogs'

type ImageFormat = 'png' | 'jpeg' | 'webp'

/** Render an artboard or its linked Layer Comp as a detached composite.
 * The source document's live layer properties and History are never mutated. */
function previewArtboard(
  doc: import('../../types').PsDocument, board: Artboard, slot: RolloverSlot = 'normal',
): HTMLCanvasElement {
  const rollover = board.rollover
  const id = slot === 'hover' ? rollover?.hoverCompId : slot === 'pressed' ? rollover?.pressedCompId : rollover?.normalCompId
  const defaultId = rollover?.normalCompId
  const comp = doc.layerComps?.find(item => item.id === (id ?? defaultId))
  if (board.visibleLayerIds === undefined && !comp) return getFlatComposite(doc)

  const selected = layersForArtboard(doc.layers, board)
  const layers = !comp ? selected : selected.map(layer => {
    const st = comp.layers[layer.id]
    if (!st) return layer
    const next: typeof layer = { ...layer, _v: layer._v + 1 }
    if (comp.options.visibility && typeof st.visible === 'boolean') next.visible = st.visible
    if (comp.options.position) {
      if (typeof st.offsetX === 'number' && Number.isFinite(st.offsetX)) next.offsetX = st.offsetX
      if (typeof st.offsetY === 'number' && Number.isFinite(st.offsetY)) next.offsetY = st.offsetY
      if ('transform' in st) next.transform = st.transform ? structuredClone(st.transform) : null
    }
    if (comp.options.appearance) {
      if (typeof st.opacity === 'number' && Number.isFinite(st.opacity)) next.opacity = Math.max(0, Math.min(100, st.opacity))
      if (st.blendMode) next.blendMode = st.blendMode
      if (typeof st.clipped === 'boolean') next.clipped = st.clipped
      if (typeof st.maskEnabled === 'boolean') next.maskEnabled = st.maskEnabled
      if ('blendIf' in st) next.blendIf = st.blendIf ? structuredClone(st.blendIf) : null
      if ('fx' in st) next.fx = st.fx ? structuredClone(st.fx) : null
    }
    return next
  })
  return compositeDocument({
    ...doc, layers, _liveDrag: null, previewFilter: null, previewAdjustment: null,
    _stroke: null, _strokeLayerId: null, channelView: 'rgb',
  })
}

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
  const [previewSlot, setPreviewSlot] = useState<RolloverSlot>('normal')
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
        const selected = boards.find(board => board.id === selectedId)
        const composite = selected ? previewArtboard(doc, selected, previewSlot) : getFlatComposite(doc)
        ctx.drawImage(composite, 0, 0, thumb.width, thumb.height)
      }
    } catch (error) {
      useEditorStore.getState().pushToast('Artboard preview unavailable: ' + String(error), 'error')
    }
  }, [doc, thumb, boards, selectedId, previewSlot])

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
    doc.artboards = valid.map(a => structuredClone(a))
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
      const extension = format === 'jpeg' ? 'jpg' : format
      const prefix = fileStem(doc.name)
      for (let i = 0; i < output.length; i++) {
        const board = output[i]
        const rect = artboardCrop(board, doc.width, doc.height)
        if (!rect) continue
        store.setProgress({ active: true, label: 'Exporting artboard ' + (i + 1) + '/' + output.length,
          value: i / output.length })
        const baseName = prefix + '-artboard-' + String(i + 1).padStart(2, '0')
          + '-' + fileStem(board.name)
        const saveArtifact = async (blob: Blob, filename: string) => {
          if (directory) {
            const file = await directory.getFileHandle(filename, { create: true })
            const writable = await file.createWritable()
            try { await writable.write(blob) } finally { await writable.close() }
          } else {
            downloadBlob(blob, filename)
            await new Promise(resolve => setTimeout(resolve, 80))
          }
        }
        const saveVariant = async (slot: RolloverSlot, filename: string) => {
          const cropped = createCanvas(rect.sw, rect.sh)
          ctx2d(cropped).drawImage(previewArtboard(doc, board, slot),
            rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh)
          const blob = await encodeCanvas(cropped, format, { quality,
            background: '#ffffff', includeMetadata: false, resolutionPpi: doc.resolutionPpi ?? 72 })
          await saveArtifact(blob, filename)
        }
        const normalFile = baseName + '.' + extension
        await saveVariant('normal', normalFile)
        const validComp = (id?: string) => !!id && (doc.layerComps ?? []).some(comp => comp.id === id)
        const hoverFile = validComp(board.rollover?.hoverCompId) ? baseName + '-hover.' + extension : undefined
        const pressedFile = validComp(board.rollover?.pressedCompId) ? baseName + '-pressed.' + extension : undefined
        if (hoverFile) await saveVariant('hover', hoverFile)
        if (pressedFile) await saveVariant('pressed', pressedFile)
        if (hoverFile || pressedFile) {
          const html = buildArtboardRolloverHtml(board.name, rect.sw, rect.sh, {
            normal: normalFile, hover: hoverFile, pressed: pressedFile,
          })
          await saveArtifact(new Blob([html], { type: 'text/html;charset=utf-8' }), baseName + '-rollover.html')
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
          <div className="space-y-1 border-t border-border/60 pt-2">
            <div className="flex flex-wrap gap-1.5 items-center">
              <Label className="text-[11px]">Layers on this artboard</Label>
              <span className="text-[10px] text-muted-foreground">
                {active.visibleLayerIds === undefined ? 'All document layers' : active.visibleLayerIds.length + ' assigned'}
              </span>
              <Button size="sm" variant="secondary" disabled={busy || active.visibleLayerIds === undefined}
                onClick={() => modify({ visibleLayerIds: undefined })}>All layers</Button>
              <Button size="sm" variant="secondary" disabled={busy}
                onClick={() => modify({ visibleLayerIds: [] })}>Hide all</Button>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1 rounded border border-border/60 p-1.5">
              {[...doc.layers].reverse().map(layer => <label key={layer.id}
                className="flex items-center gap-2 text-[11px] cursor-pointer">
                <input type="checkbox" disabled={busy}
                  checked={active.visibleLayerIds === undefined || active.visibleLayerIds.includes(layer.id)}
                  onChange={event => {
                    const ids = active.visibleLayerIds ?? doc.layers.map(l => l.id)
                    const next = new Set(ids)
                    if (event.target.checked) next.add(layer.id)
                    else next.delete(layer.id)
                    modify({ visibleLayerIds: [...next] })
                  }} />
                <span className={layer.visible ? '' : 'text-muted-foreground'}>{layer.name}</span>
                {!layer.visible && <span className="text-[9px] text-muted-foreground">(hidden in document)</span>}
              </label>)}
              {!doc.layers.length && <div className="text-muted-foreground">No editable layers.</div>}
            </div>
            <p className="text-[10px] text-muted-foreground">Artboard-only layer inclusion affects its preview and export; it does not remove layers from the main canvas or change their global visibility. Hidden document layers remain hidden.</p>
          </div>
          <div className="space-y-2 border-t border-border/60 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-[11px]">Rollover states (Layer Comps)</Label>
              <select aria-label="Preview rollover state" className="rounded border border-border bg-background p-1"
                value={previewSlot} onChange={e => setPreviewSlot(e.target.value as RolloverSlot)}>
                <option value="normal">Preview normal</option>
                <option value="hover">Preview hover</option>
                <option value="pressed">Preview pressed</option>
              </select>
            </div>
            {([
              ['normal', 'normalCompId', 'Normal'],
              ['hover', 'hoverCompId', 'Hover'],
              ['pressed', 'pressedCompId', 'Pressed'],
            ] as const).map(([slot, key, label]) => <div key={slot} className="flex items-center gap-2">
              <Label className="w-14 text-[11px]">{label}</Label>
              <select aria-label={label + ' Layer Comp'} className="min-w-0 flex-1 rounded border border-border bg-background p-1"
                value={active.rollover?.[key] ?? ''} disabled={busy}
                onChange={e => modify({ rollover: { ...active.rollover, [key]: e.target.value || undefined } })}>
                <option value="">{slot === 'normal' ? 'Live document' : 'Use normal state'}</option>
                {(doc.layerComps ?? []).map(comp => <option key={comp.id} value={comp.id}>{comp.name}</option>)}
              </select>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => {
                if (engine.activeDoc?.id !== sourceId) return
                const comp = engine.createLayerComp(active.name + ' — ' + label,
                  { visibility: true, position: true, appearance: true })
                if (comp) modify({ rollover: { ...active.rollover, [key]: comp.id } })
              }}>Capture</Button>
            </div>)}
            <p className="text-[10px] text-muted-foreground">Capture records the live layer appearance as a reusable Layer Comp. Assign separate Hover and Pressed comps to export CSS-only prototype states; unassigned states fall back to Normal. Use the Layer Comps panel to update snapshots after editing. This is not native Fireworks state or symbol support.</p>
          </div>
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
        <p className="text-[10px] text-muted-foreground">Artboards store individual layer selections and optional Normal/Hover/Pressed Layer Comp references in .zproj.json. HTML rollover previews use CSS, with separately exported flattened images. The editor still shares one canvas/layer tree; there are no off-canvas pages, true Fireworks state objects, Illustrator AI round trips or independent page histories.</p>
      </div>
    )}
    <DialogFooter>
      <Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>Close</Button>
      <Button size="sm" disabled={!doc || busy || !boards.length || (exportChoice === 'selected' && !active)}
        onClick={() => void exportArtboards()}>{busy ? 'Exporting…' : 'Export Artboards'}</Button>
    </DialogFooter>
  </>
}
