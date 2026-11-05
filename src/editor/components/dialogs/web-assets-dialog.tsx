'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { engine } from '../../engine/engine'
import { getFlatComposite } from '../../engine/document'
import { encodeCanvas } from '../../formats'
import { createCanvas, ctx2d, downloadBlob, uid } from '../../utils/canvas'
import { useEditorStore } from '../../store'
import {
  MAX_WEB_REGIONS, MAX_WEB_REGION_POINTS, buildImageMapHtml, fileStem, normalizeWebRegions,
  regionShape, type WebRegion, type WebRegionKind, type WebRegionShape,
} from '../../web-assets'
import {
  findWebRegion, moveRegion, regionBounds, scaleRegionPoints,
} from '../../tools/web-region-geometry'
import type { DialogProps } from './generic-dialogs'

type ImageFormat = 'png' | 'jpeg' | 'webp'

export function WebAssetsDialog({ inst, onClose }: DialogProps) {
  // Bind this dialog to the document active when it opened. A later tab switch
  // must never apply its regions or export to a different document.
  const sourceDocId = useRef(engine.activeDoc?.id ?? null)
  const docId = sourceDocId.current
  const doc = engine.docs.find(d => d.id === docId) ?? null
  const [regions, setRegions] = useState<WebRegion[]>(() =>
    doc ? normalizeWebRegions(doc.webRegions, doc.width, doc.height) : [])
  const [selected, setSelected] = useState<string | null>(() => {
    const requested = inst.props?.regionId ?? doc?.activeWebRegionId
    return typeof requested === 'string' && doc?.webRegions?.some(r => r.id === requested) ? requested : null
  })
  const [drawKind, setDrawKind] = useState<WebRegionKind>('slice')
  const [drawShape, setDrawShape] = useState<WebRegionShape>('rect')
  const [format, setFormat] = useState<ImageFormat>('png')
  const [quality, setQuality] = useState(90)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [polyDraft, setPolyDraft] = useState<number[] | null>(null)
  const [polyCursor, setPolyCursor] = useState<{ x: number; y: number } | null>(null)
  const selectRegion = (id: string | null) => {
    setSelected(id)
    if (doc) {
      doc.activeWebRegionId = id
      engine.emit()
    }
  }
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
  const polyMode = drawKind === 'hotspot' && drawShape === 'poly'
  const circleMode = drawKind === 'hotspot' && drawShape === 'circle'
  const addPolygonRegion = (points: number[]) => {
    if (!doc || points.length < 6) { setPolyDraft(null); setPolyCursor(null); return }
    const bounds = regionBounds(points)
    if (bounds.width < 3 || bounds.height < 3) { setPolyDraft(null); setPolyCursor(null); return }
    if (regions.length >= MAX_WEB_REGIONS) {
      useEditorStore.getState().pushToast('Maximum ' + MAX_WEB_REGIONS + ' web regions', 'error')
      setPolyDraft(null); setPolyCursor(null)
      return
    }
    const r: WebRegion = {
      id: uid(), kind: 'hotspot', shape: 'poly', points: points.slice(),
      name: 'Hotspot ' + (regions.filter(x => x.kind === 'hotspot').length + 1),
      ...bounds, href: '', alt: '', target: '_self',
    }
    commitRegions([...regions, r])
    selectRegion(r.id)
    setPolyDraft(null); setPolyCursor(null)
  }
  const finishPolyDraft = () => {
    if (polyDraft) addPolygonRegion(polyDraft)
    else { setPolyDraft(null); setPolyCursor(null) }
  }
  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || busy) return
    const p = point(event)
    if (!p) return
    event.currentTarget.setPointerCapture(event.pointerId)
    if (polyMode) {
      if (polyDraft) {
        const tol = 8 * (doc ? doc.width / Math.max(1, thumbSize.w) : 1)
        const last = polyDraft.length - 2
        if (polyDraft.length >= 6 && Math.hypot(p.x - polyDraft[0], p.y - polyDraft[1]) <= tol) {
          finishPolyDraft()
          return
        }
        if (Math.hypot(p.x - polyDraft[last], p.y - polyDraft[last + 1]) > 1
          && polyDraft.length / 2 < MAX_WEB_REGION_POINTS) setPolyDraft([...polyDraft, p.x, p.y])
        setPolyCursor(p)
        return
      }
      // No draft yet: clicking an existing region still selects it.
      const hit = findWebRegion(regions, p.x, p.y)
      if (hit) { selectRegion(hit.id); setDrag(null); setCursor(null); return }
      setPolyDraft([p.x, p.y])
      setPolyCursor(p)
      return
    }
    setDrag(p)
    setCursor(p)
  }
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const p = point(event)
    if (polyDraft) { if (p) setPolyCursor(p); return }
    if (drag) setCursor(p)
  }
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || !doc) return
    const p = point(event)
    setDrag(null); setCursor(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!p || polyMode) return
    if (Math.abs(p.x - drag.x) < 3 && Math.abs(p.y - drag.y) < 3) {
      const hit = findWebRegion(regions, p.x, p.y)
      selectRegion(hit?.id ?? null)
      return
    }
    if (regions.length >= MAX_WEB_REGIONS) {
      useEditorStore.getState().pushToast('Maximum ' + MAX_WEB_REGIONS + ' web regions', 'error')
      return
    }
    const x = Math.min(drag.x, p.x), y = Math.min(drag.y, p.y)
    let width = Math.abs(drag.x - p.x) + 1, height = Math.abs(drag.y - p.y) + 1
    if (circleMode) { const side = Math.min(width, height); width = side; height = side }
    const r: WebRegion = {
      id: uid(), kind: drawKind,
      ...(circleMode ? { shape: 'circle' as const } : {}),
      name: (drawKind === 'slice' ? 'Slice ' : 'Hotspot ')
        + (regions.filter(r => r.kind === drawKind).length + 1),
      x, y, width, height,
      href: '', alt: '', target: '_self',
    }
    commitRegions([...regions, r])
    selectRegion(r.id)
  }
  const onPreviewKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && polyDraft) { event.preventDefault(); finishPolyDraft() }
    else if (event.key === 'Escape' && polyDraft) { event.preventDefault(); setPolyDraft(null); setPolyCursor(null) }
  }
  const draft = drag && cursor ? {
    x: Math.min(drag.x, cursor.x), y: Math.min(drag.y, cursor.y),
    width: Math.abs(cursor.x - drag.x) + 1, height: Math.abs(cursor.y - drag.y) + 1,
  } : null
  const squareDraft = draft && circleMode
    ? { ...draft, width: Math.min(draft.width, draft.height), height: Math.min(draft.width, draft.height) }
    : draft

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
          const shape = regionShape(active)
          if (shape === 'poly' && active.points) {
            if (label === 'x' || label === 'y') {
              const next = moveRegion(active, label === 'x' ? n - active.x : 0, label === 'y' ? n - active.y : 0,
                doc.width, doc.height)
              update({ ...next, points: next.points?.slice() })
            } else {
              const width = label === 'width' ? Math.max(1, Math.min(doc.width - active.x, n)) : active.width
              const height = label === 'height' ? Math.max(1, Math.min(doc.height - active.y, n)) : active.height
              const next = scaleRegionPoints(active, { x: active.x, y: active.y, width, height }, doc.width, doc.height)
              update({ ...next, points: next.points?.slice() })
            }
            return
          }
          if (shape === 'circle') {
            // Circles stay square: editing either dimension updates both.
            if (label === 'x' || label === 'y') {
              const max = label === 'x' ? doc.width - active.width : doc.height - active.height
              const v = Math.max(0, Math.min(max, n))
              update(label === 'x' ? { x: v } : { y: v })
            } else {
              const side = Math.max(1, Math.min(Math.min(doc.width - active.x, doc.height - active.y), n))
              update({ width: side, height: side })
            }
            return
          }
          const max = label === 'x' ? doc.width - 1 : label === 'y' ? doc.height - 1
            : label === 'width' ? doc.width - active.x : doc.height - active.y
          update({ [label]: Math.max(label === 'width' || label === 'height' ? 1 : 0, Math.min(max, n)) })
        }} />
    </div>

  return <>
    <DialogHeader><DialogTitle>Web Slices & Hotspots</DialogTitle></DialogHeader>
    {!doc ? <div className="text-xs">Open a document first.</div> : (
      <div className="space-y-3 text-xs">
        <p className="text-muted-foreground">Drag to create a rectangular or circular region; polygon hotspots are drawn click-by-click. Click an existing region to edit it. Regions save with the native project without changing pixels.</p>
        <div className="flex items-center gap-2">
          <Label>Draw</Label>
          <select className="rounded border border-border bg-background p-1" value={drawKind} onChange={e => {
            setDrawKind(e.target.value as WebRegionKind)
            setPolyDraft(null); setPolyCursor(null)
          }}>
            <option value="slice">Slice</option><option value="hotspot">Hotspot</option>
          </select>
          {drawKind === 'hotspot' && <>
            <Label>Shape</Label>
            <select aria-label="Hotspot shape" className="rounded border border-border bg-background p-1" value={drawShape} onChange={e => {
              setDrawShape(e.target.value as WebRegionShape)
              setPolyDraft(null); setPolyCursor(null)
            }}>
              <option value="rect">Rectangle</option>
              <option value="circle">Circle</option>
              <option value="poly">Polygon</option>
            </select>
          </>}
          <span className="ml-auto text-muted-foreground">{regions.length}/{MAX_WEB_REGIONS} regions</span>
        </div>
        <div ref={previewBoxRef} tabIndex={0} className="relative mx-auto border border-border select-none touch-none cursor-crosshair overflow-hidden outline-none"
          style={{ width: thumbSize.w, height: thumbSize.h }}
          onKeyDown={onPreviewKey} onDoubleClick={() => { if (polyDraft) finishPolyDraft() }}>
          <canvas ref={previewRef} width={thumbSize.w} height={thumbSize.h} className="block w-full h-full" />
          {regions.map(r => {
            const shape = regionShape(r)
            const border = r.id === selected ? 'border-yellow-400' : r.kind === 'slice' ? 'border-sky-400' : 'border-emerald-400'
            if (shape === 'poly' && r.points) {
              const pts = r.points.reduce((s, n, i) => i % 2 === 0 ? s + n : s + ',' + n + ' ', '').trim()
              return <div key={r.id} className="pointer-events-none absolute inset-0">
                <svg className="absolute inset-0 w-full h-full" viewBox={'0 0 ' + doc.width + ' ' + doc.height} preserveAspectRatio="none">
                  <polygon points={pts} fill={r.id === selected ? 'rgba(250,204,21,.12)' : 'none'}
                    stroke={r.id === selected ? '#facc15' : '#34d399'} strokeWidth={r.id === selected ? 2 : 1.5}
                    strokeDasharray={r.id === selected ? undefined : '5,3'} vectorEffect="non-scaling-stroke" />
                </svg>
                <span className="absolute bg-black/75 px-1 text-[9px] text-white whitespace-nowrap"
                  style={{ left: (r.x * 100 / doc.width) + '%', top: (r.y * 100 / doc.height) + '%' }}>{r.name}</span>
              </div>
            }
            return <div key={r.id} style={{ ...boxStyle(r), ...(shape === 'circle' ? { borderRadius: '50%' } : {}) }}
              className={'pointer-events-none absolute border-2 ' + border}>
              <span className="absolute top-0 left-0 bg-black/75 px-1 text-[9px] text-white whitespace-nowrap">{r.name}</span>
            </div>
          })}
          {squareDraft && <div className="pointer-events-none absolute border-2 border-dashed border-yellow-300 bg-yellow-300/10"
            style={{ ...boxStyle(squareDraft), ...(circleMode ? { borderRadius: '50%' } : {}) }} />}
          {polyDraft && <svg className="pointer-events-none absolute inset-0 w-full h-full" viewBox={'0 0 ' + doc.width + ' ' + doc.height} preserveAspectRatio="none">
            <polyline
              points={polyDraft.reduce((s, n, i) => i % 2 === 0 ? s + n : s + ',' + n + ' ', '').trim()
                + (polyCursor ? ' ' + polyCursor.x + ',' + polyCursor.y : '')}
              fill="rgba(250,204,21,.08)" stroke="#facc15" strokeWidth={1.6} strokeDasharray="6,4" vectorEffect="non-scaling-stroke" />
            {polyDraft.length >= 2 && <circle cx={polyDraft[0]} cy={polyDraft[1]} r={Math.max(2, doc.width / 90)}
              fill="none" stroke="#facc15" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
          </svg>}
          <div className="absolute inset-0" onPointerDown={begin} onPointerMove={move} onPointerUp={end}
            onPointerCancel={() => { setDrag(null); setCursor(null) }} />
        </div>
        <div className="max-h-24 overflow-y-auto rounded border border-border p-1 flex flex-wrap gap-1">
          {regions.map(r => <button type="button" key={r.id} onClick={() => selectRegion(r.id)}
            className={'rounded border px-2 py-1 text-[10px] ' + (selected === r.id ? 'border-primary bg-primary/15' : 'border-border')}>
            {r.kind === 'slice' ? '▣ ' : regionShape(r) === 'circle' ? '● ' : regionShape(r) === 'poly' ? '⬠ ' : '↗ '}{r.name}
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
              commitRegions(regions.filter(r => r.id !== active.id)); selectRegion(null)
            }}>Delete</Button>
          </div>
          <div className="grid grid-cols-4 gap-2">{(['x', 'y', 'width', 'height'] as const).map(numberField)}</div>
          {regionShape(active) === 'poly' && active.points && <p className="text-[10px] text-muted-foreground">Polygon hotspot with {active.points.length / 2} vertices; X/Y translate and width/height rescale the vertices. Edit individual vertices with the Hotspot canvas tool.</p>}
          {regionShape(active) === 'circle' && <p className="text-[10px] text-muted-foreground">Circular image-map area; width and height stay square.</p>}
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
        <p className="text-[10px] text-muted-foreground">Exports the flattened full image, rectangular slice images and HTML image-map links (rect, circle and polygon areas). Unsafe link schemes are excluded. Not a layered Fireworks PNG or an HDR/CMYK export. Browsers without File System Access may download files separately.</p>
      </div>
    )}
    <DialogFooter>
      <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
      <Button size="sm" onClick={() => void exportAssets()} disabled={!doc || busy}>{busy ? 'Exporting…' : 'Export Web Assets'}</Button>
    </DialogFooter>
  </>
}
