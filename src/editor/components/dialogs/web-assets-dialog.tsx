'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { engine } from '../../engine/engine'
import { getFlatComposite } from '../../engine/document'
import { encodeCanvas } from '../../formats'
import { createCanvas, ctx2d, downloadBlob, uid } from '../../utils/canvas'
import { useEditorStore } from '../../store'
import { MAX_WEB_REGIONS, buildImageMapHtml, fileStem, normalizeWebRegions, type WebRegion, type WebRegionKind } from '../../web-assets'
import type { DialogProps } from './generic-dialogs'

type ImageFormat = 'png' | 'jpeg' | 'webp'

export function WebAssetsDialog({ onClose }: DialogProps) {
  const doc = engine.activeDoc
  const docId = doc?.id
  const [regions, setRegions] = useState<WebRegion[]>(() =>
    doc ? normalizeWebRegions(doc.webRegions, doc.width, doc.height) : [])
  const [selected, setSelected] = useState<string | null>(null)
  const [drawKind, setDrawKind] = useState<WebRegionKind>('slice')
  const [format, setFormat] = useState<ImageFormat>('png')
  const [quality, setQuality] = useState(90)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const previewBoxRef = useRef<HTMLDivElement>(null)
  const thumbSize = useMemo(() => {
    if (!doc) return { w: 1, h: 1 }
    const scale = Math.min(1, 650 / doc.width, 360 / doc.height)
    return { w: Math.max(1, Math.round(doc.width * scale)), h: Math.max(1, Math.round(doc.height * scale)) }
  }, [doc])

  useEffect(() => {
    if (!doc) return
    const preview = previewRef.current
    if (!preview) return
    try {
      const ctx = preview.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, preview.width, preview.height)
        ctx.drawImage(getFlatComposite(doc), 0, 0, preview.width, preview.height)
      }
    } catch (e) {
      useEditorStore.getState().pushToast('Could not render web assets preview: ' + String(e), 'error')
    }
  }, [doc, docId, thumbSize])

  const active = regions.find(r => r.id === selected) ?? null
  const commitRegions = (next: WebRegion[]) => {
    if (!doc || engine.activeDoc?.id !== docId) return
    const valid = normalizeWebRegions(next, doc.width, doc.height)
    setRegions(valid)
    doc.webRegions = valid.map(r => ({ ...r }))
    doc.dirty = true
    engine.emit()
  }
  const update = (patch: Partial<WebRegion>) => {
    if (active) commitRegions(regions.map(r => r.id === active.id ? { ...r, ...patch } : r))
  }
  const point = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!doc || !previewBoxRef.current) return null
    const b = previewBoxRef.current.getBoundingClientRect()
    if (!b.width || !b.height) return null
    return {
      x: Math.min(doc.width - 1, Math.max(0, Math.floor((event.clientX - b.left) * doc.width / b.width))),
      y: Math.min(doc.height - 1, Math.max(0, Math.floor((event.clientY - b.top) * doc.height / b.height))),
    }
  }
  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || busy) return
    const p = point(event)
    if (!p) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag(p)
    setCursor(p)
  }
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag) setCursor(point(event))
  }
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || !doc) return
    const p = point(event)
    setDrag(null); setCursor(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!p) return
    if (Math.abs(p.x - drag.x) < 3 && Math.abs(p.y - drag.y) < 3) {
      const hit = [...regions].reverse().find(r =>
        p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height)
      setSelected(hit?.id ?? null)
      return
    }
    if (regions.length >= MAX_WEB_REGIONS) {
      useEditorStore.getState().pushToast('Maximum ' + MAX_WEB_REGIONS + ' web regions', 'error')
      return
    }
    const x = Math.min(drag.x, p.x), y = Math.min(drag.y, p.y)
    const r: WebRegion = {
      id: uid(), kind: drawKind,
      name: (drawKind === 'slice' ? 'Slice ' : 'Hotspot ')
        + (regions.filter(r => r.kind === drawKind).length + 1),
      x, y, width: Math.abs(drag.x - p.x) + 1, height: Math.abs(drag.y - p.y) + 1,
      href: '', alt: '', target: '_self',
    }
    commitRegions([...regions, r])
    setSelected(r.id)
  }
  const draft = drag && cursor ? {
    x: Math.min(drag.x, cursor.x), y: Math.min(drag.y, cursor.y),
    width: Math.abs(cursor.x - drag.x) + 1, height: Math.abs(cursor.y - drag.y) + 1,
  } : null

  const exportAssets = async () => {
    if (!doc || engine.activeDoc?.id !== docId || busy) return
    const store = useEditorStore.getState()
    setBusy(true)
    let directory: any = null
    try {
      const picker = (window as any).showDirectoryPicker as undefined | ((opts?: any) => Promise<any>)
      if (picker) {
        try { directory = await picker({ mode: 'readwrite' }) }
        catch (error: any) { if (error?.name === 'AbortError') return }
      }
      const save = async (blob: Blob, name: string) => {
        if (directory) {
          const handle = await directory.getFileHandle(name, { create: true })
          const writable = await handle.createWritable()
          try { await writable.write(blob) } finally { await writable.close() }
        } else {
          downloadBlob(blob, name)
          await new Promise(resolve => setTimeout(resolve, 80))
        }
      }
      if (engine.activeDoc?.id !== docId) throw Error('Active document changed')
      const flat = getFlatComposite(doc)
      const ext = format === 'jpeg' ? 'jpg' : format
      const stem = fileStem(doc.name)
      const fullName = stem + '-full.' + ext
      const options = { quality, background: '#ffffff', includeMetadata: false }
      await save(await encodeCanvas(flat, format, options), fullName)
      const slices = normalizeWebRegions(regions, doc.width, doc.height).filter(r => r.kind === 'slice')
      for (let i = 0; i < slices.length; i++) {
        const r = slices[i]
        store.setProgress({ active: true, label: 'Exporting web slice ' + (i + 1) + '/' + slices.length, value: (i + 1) / (slices.length + 2) })
        const crop = createCanvas(r.width, r.height)
        ctx2d(crop).drawImage(flat, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height)
        const name = stem + '-slice-' + String(i + 1).padStart(3, '0') + '-' + fileStem(r.name) + '.' + ext
        await save(await encodeCanvas(crop, format, options), name)
      }
      await save(new Blob([buildImageMapHtml(fullName, doc.width, doc.height, regions)], { type: 'text/html;charset=utf-8' }), stem + '-web.html')
      store.pushToast('Exported image, ' + slices.length + ' slice(s) and HTML image map', 'success')
      onClose()
    } catch (error) {
      store.pushToast('Web assets export failed: ' + (error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      store.setProgress(null)
      setBusy(false)
    }
  }

  const boxStyle = (r: Pick<WebRegion, 'x' | 'y' | 'width' | 'height'>): CSSProperties => ({
    left: (r.x * 100 / (doc?.width || 1)) + '%',
    top: (r.y * 100 / (doc?.height || 1)) + '%',
    width: (r.width * 100 / (doc?.width || 1)) + '%',
    height: (r.height * 100 / (doc?.height || 1)) + '%',
  })
  const numberField = (label: 'x' | 'y' | 'width' | 'height') =>
    <div className="space-y-1" key={label}>
      <Label className="text-[10px] uppercase">{label}</Label>
      <Input aria-label={label} className="h-7 text-xs" type="number"
        min={label === 'width' || label === 'height' ? 1 : 0}
        value={active?.[label] ?? 0} onChange={event => {
          const n = Number(event.target.value)
          if (!active || !doc || !Number.isSafeInteger(n)) return
          const max = label === 'x' ? doc.width - 1 : label === 'y' ? doc.height - 1
            : label === 'width' ? doc.width - active.x : doc.height - active.y
          update({ [label]: Math.max(label === 'width' || label === 'height' ? 1 : 0, Math.min(max, n)) })
        }} />
    </div>

  return <>
    <DialogHeader><DialogTitle>Web Slices & Hotspots</DialogTitle></DialogHeader>
    {!doc ? <div className="text-xs">Open a document first.</div> : (
      <div className="space-y-3 text-xs">
        <p className="text-muted-foreground">Drag to create a rectangular region. Click an existing region to edit it. Regions save with the native project without changing pixels.</p>
        <div className="flex items-center gap-2">
          <Label>Draw</Label>
          <select className="rounded border border-border bg-background p-1" value={drawKind} onChange={e => setDrawKind(e.target.value as WebRegionKind)}>
            <option value="slice">Slice</option><option value="hotspot">Hotspot</option>
          </select>
          <span className="ml-auto text-muted-foreground">{regions.length}/{MAX_WEB_REGIONS} regions</span>
        </div>
        <div ref={previewBoxRef} className="relative mx-auto border border-border select-none touch-none cursor-crosshair overflow-hidden"
          style={{ width: thumbSize.w, height: thumbSize.h }}>
          <canvas ref={previewRef} width={thumbSize.w} height={thumbSize.h} className="block w-full h-full" />
          {regions.map(r => <div key={r.id} style={boxStyle(r)}
            className={'pointer-events-none absolute border-2 ' + (r.id === selected ? 'border-yellow-400' : r.kind === 'slice' ? 'border-sky-400' : 'border-emerald-400')}>
            <span className="absolute top-0 left-0 bg-black/75 px-1 text-[9px] text-white whitespace-nowrap">{r.name}</span>
          </div>)}
          {draft && <div className="pointer-events-none absolute border-2 border-dashed border-yellow-300 bg-yellow-300/10" style={boxStyle(draft)} />}
          <div className="absolute inset-0" onPointerDown={begin} onPointerMove={move} onPointerUp={end}
            onPointerCancel={() => { setDrag(null); setCursor(null) }} />
        </div>
        <div className="max-h-24 overflow-y-auto rounded border border-border p-1 flex flex-wrap gap-1">
          {regions.map(r => <button type="button" key={r.id} onClick={() => setSelected(r.id)}
            className={'rounded border px-2 py-1 text-[10px] ' + (selected === r.id ? 'border-primary bg-primary/15' : 'border-border')}>
            {r.kind === 'slice' ? '▣ ' : '↗ '}{r.name}
          </button>)}
          {!regions.length && <span className="p-1 text-muted-foreground">No regions yet. Drag on the preview to add one.</span>}
        </div>
        {active && <div className="space-y-2 rounded border border-border p-2">
          <div className="flex gap-2 items-center">
            <select aria-label="Region type" className="rounded border border-border bg-background p-1" value={active.kind}
              onChange={e => update({ kind: e.target.value as WebRegionKind })}>
              <option value="slice">Slice</option><option value="hotspot">Hotspot</option>
            </select>
            <Input aria-label="Region name" className="h-7 text-xs flex-1" value={active.name}
              onChange={e => update({ name: e.target.value })} />
            <Button size="sm" variant="destructive" onClick={() => {
              commitRegions(regions.filter(r => r.id !== active.id)); setSelected(null)
            }}>Delete</Button>
          </div>
          <div className="grid grid-cols-4 gap-2">{(['x', 'y', 'width', 'height'] as const).map(numberField)}</div>
          {active.kind === 'hotspot' && <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label>Link URL / relative path</Label><Input className="h-7 text-xs"
              value={active.href || ''} onChange={e => update({ href: e.target.value })} placeholder="https://example.com/page" /></div>
            <div className="space-y-1"><Label>Accessible alt text</Label><Input className="h-7 text-xs"
              value={active.alt || ''} onChange={e => update({ alt: e.target.value })} placeholder="Describe this link" /></div>
            <label className="col-span-2 flex gap-2 items-center"><input type="checkbox" checked={active.target === '_blank'}
              onChange={e => update({ target: e.target.checked ? '_blank' : '_self' })} />Open in new tab (noopener)</label>
          </div>}
        </div>}
        <div className="flex items-center gap-2">
          <Label>Format</Label>
          <select className="rounded border border-border bg-background p-1" value={format}
            onChange={e => setFormat(e.target.value as ImageFormat)}>
            <option value="png">PNG</option><option value="webp">WebP</option><option value="jpeg">JPEG</option>
          </select>
          {format !== 'png' && <label className="flex items-center gap-2">Quality {quality}
            <input aria-label="Image quality" type="range" min={1} max={100} value={quality}
              onChange={e => setQuality(Number(e.target.value))} /></label>}
        </div>
        <p className="text-[10px] text-muted-foreground">Exports the flattened full image, individual slice images and HTML image-map links. Unsafe link schemes are excluded. Not a layered Fireworks PNG or an HDR/CMYK export. Browsers without File System Access may download files separately.</p>
      </div>
    )}
    <DialogFooter>
      <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
      <Button size="sm" onClick={() => void exportAssets()} disabled={!doc || busy}>{busy ? 'Exporting…' : 'Export Web Assets'}</Button>
    </DialogFooter>
  </>
}
