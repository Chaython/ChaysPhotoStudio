'use client'
// Document dialogs: New, Image Size, Canvas Size, Export, Free Transform
import { useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { createCanvas, ctx2d, downloadBlob } from '../../utils/canvas'
import { compositeDocument, getFlatComposite } from '../../engine/document'
import { FORMAT_INFO, ICO_SIZE_POOL, encodeCanvas, buildPsd } from '../../formats'
import type { PsdLayerInput } from '../../formats'
import type { DialogProps } from './generic-dialogs'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

const PRESETS = [
  { label: 'Default 1600 × 1000', w: 1600, h: 1000 },
  { label: 'Full HD 1920 × 1080', w: 1920, h: 1080 },
  { label: 'Square 2048 × 2048', w: 2048, h: 2048 },
  { label: 'Instagram Post 1080²', w: 1080, h: 1080 },
  { label: 'Story 1080 × 1920', w: 1080, h: 1920 },
  { label: 'A4 Print 300dpi 2480 × 3508', w: 2480, h: 3508 },
  { label: 'Web Banner 1440 × 480', w: 1440, h: 480 },
]

export function NewDocDialog({ onClose }: DialogProps) {
  const [w, setW] = useState(1600)
  const [h, setH] = useState(1000)
  const [name, setName] = useState('')
  const [fill, setFill] = useState('white')
  const [resolutionPpi, setResolutionPpi] = useState(300)
  const store = useEditorStore.getState()

  const create = () => {
    if (w < 1 || h < 1 || w > 8192 || h > 8192) { store.pushToast('Dimensions must be 1–8192', 'error'); return }
    engine.newDocument({ name: name || undefined, width: Math.round(w), height: Math.round(h), resolutionPpi, fill: fill as any })
    store.pushToast(`Created ${Math.round(w)}×${Math.round(h)} document at ${Math.round(resolutionPpi)} PPI`, 'success')
    onClose()
  }

  return (
    <>
      <DialogHeader><DialogTitle>New Document</DialogTitle></DialogHeader>
      <div className="space-y-3 py-1">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Untitled" className="h-7 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Background</Label>
            <Select value={fill} onValueChange={setFill}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="white" className="text-xs">White</SelectItem>
                <SelectItem value="transparent" className="text-xs">Transparent</SelectItem>
                <SelectItem value="#111111" className="text-xs">Dark Gray</SelectItem>
                <SelectItem value="#e8a33d" className="text-xs">Amber</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Width (px)</Label>
            <Input type="number" value={w} min={1} max={8192} onChange={e => setW(Number(e.target.value))} className="h-7 text-xs font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Height (px)</Label>
            <Input type="number" value={h} min={1} max={8192} onChange={e => setH(Number(e.target.value))} className="h-7 text-xs font-mono" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-[11px]">Resolution</Label>
            <Input type="number" value={resolutionPpi} min={1} max={12000} step={1} onChange={e => setResolutionPpi(Math.max(1, Number(e.target.value) || 72))} className="h-7 text-xs font-mono" />
          </div>
          <div className="pb-1 text-[10px] text-muted-foreground">
            PPI · print size {(w / Math.max(1, resolutionPpi)).toFixed(2)} × {(h / Math.max(1, resolutionPpi)).toFixed(2)} in
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Presets</Label>
          <div className="grid grid-cols-1 gap-1">
            {PRESETS.map(p => (
              <button key={p.label} className="text-left text-[11px] px-2 py-1 rounded border hover:bg-accent text-muted-foreground hover:text-foreground" onClick={() => { setW(p.w); setH(p.h) }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={create}>Create</Button>
      </DialogFooter>
    </>
  )
}

export function ImageSizeDialog({ onClose }: DialogProps) {
  const doc = engine.activeDoc
  const [w, setW] = useState(doc?.width ?? 1000)
  const [h, setH] = useState(doc?.height ?? 1000)
  const [constrain, setConstrain] = useState(true)
  const [resolutionPpi, setResolutionPpi] = useState(doc?.resolutionPpi ?? 72)
  const [resample, setResample] = useState(true)
  const ratio = (doc?.width ?? 1) / (doc?.height ?? 1)

  const apply = () => {
    if (resolutionPpi < 1 || resolutionPpi > 12000) return
    if (resample && (w < 4 || h < 4)) return
    engine.resizeImage({ w: Math.round(w), h: Math.round(h), resolutionPpi, resample })
    onClose()
  }

  return (
    <>
      <DialogHeader><DialogTitle>Image Size</DialogTitle></DialogHeader>
      <div className="space-y-3 py-1">
        <div className="text-[11px] text-muted-foreground">Current: {doc?.width} × {doc?.height} px ({(((doc?.width ?? 0) * (doc?.height ?? 0)) / 1e6).toFixed(1)} MP) · {Math.round(doc?.resolutionPpi ?? 72)} PPI</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Width</Label>
            <Input type="number" value={Math.round(w)} disabled={!resample} onChange={e => {
              const nw = Number(e.target.value)
              setW(nw)
              if (constrain) setH(nw / ratio)
            }} className="h-7 text-xs font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Height</Label>
            <Input type="number" value={Math.round(h)} disabled={!resample} onChange={e => {
              const nh = Number(e.target.value)
              setH(nh)
              if (constrain) setW(nh * ratio)
            }} className="h-7 text-xs font-mono" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-[11px] cursor-pointer">
          <input type="checkbox" checked={constrain} onChange={e => setConstrain(e.target.checked)} className="accent-primary" />
          Constrain proportions
        </label>
        <div className="grid grid-cols-2 gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-[11px]">Resolution (PPI)</Label>
            <Input type="number" value={resolutionPpi} min={1} max={12000} step={1} onChange={e => setResolutionPpi(Math.max(1, Number(e.target.value) || 72))} className="h-7 text-xs font-mono" />
          </div>
          <div className="pb-1 text-[10px] text-muted-foreground">
            Print: {((resample ? w : (doc?.width ?? w)) / Math.max(1, resolutionPpi)).toFixed(2)} × {((resample ? h : (doc?.height ?? h)) / Math.max(1, resolutionPpi)).toFixed(2)} in
          </div>
        </div>
        <label className="flex items-center gap-2 text-[11px] cursor-pointer">
          <input type="checkbox" checked={resample} onChange={e => setResample(e.target.checked)} className="accent-primary" />
          Resample pixels
        </label>
        {!resample && <div className="text-[10px] text-muted-foreground">Resolution changes physical/print size metadata only; pixel dimensions stay unchanged.</div>}
        <div className="flex gap-1.5">
          {[25, 50, 200].map(p => (
            <button key={p} disabled={!resample} className="px-2 py-1 rounded border text-[10px] hover:bg-accent disabled:opacity-40 disabled:pointer-events-none" onClick={() => {
              setW((doc?.width ?? 1) * p / 100); setH((doc?.height ?? 1) * p / 100)
            }}>{p}%</button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={apply}>Resize</Button>
      </DialogFooter>
    </>
  )
}

export function CanvasSizeDialog({ onClose }: DialogProps) {
  const doc = engine.activeDoc
  const [w, setW] = useState(doc?.width ?? 1000)
  const [h, setH] = useState(doc?.height ?? 1000)
  const [anchor, setAnchor] = useState('center')

  const anchors = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']

  const apply = () => {
    engine.resizeCanvas({ w: Math.round(w), h: Math.round(h), anchor: anchor as any })
    onClose()
  }

  return (
    <>
      <DialogHeader><DialogTitle>Canvas Size</DialogTitle></DialogHeader>
      <div className="space-y-3 py-1">
        <div className="text-[11px] text-muted-foreground">Current: {doc?.width} × {doc?.height}</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Width</Label>
            <Input type="number" value={Math.round(w)} min={1} onChange={e => setW(Number(e.target.value))} className="h-7 text-xs font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Height</Label>
            <Input type="number" value={Math.round(h)} min={1} onChange={e => setH(Number(e.target.value))} className="h-7 text-xs font-mono" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Anchor</Label>
          <div className="grid grid-cols-3 gap-1 w-32">
            {anchors.map(a => (
              <button
                key={a}
                className={`h-8 rounded border text-[9px] ${anchor === a ? 'bg-primary/25 border-primary text-primary' : 'hover:bg-accent'}`}
                onClick={() => setAnchor(a)}
                title={a}
              >
                {a.includes('left') ? '◀' : a.includes('right') ? '▶' : ''}{a.includes('top') ? '▲' : a.includes('bottom') ? '▼' : a === 'center' ? '●' : '—'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={apply}>Apply</Button>
      </DialogFooter>
    </>
  )
}

export function ExportDialog({ onClose }: DialogProps) {
  const doc = engine.activeDoc
  const [format, setFormat] = useState<string>('png')
  const [quality, setQuality] = useState(92)
  const [scale, setScale] = useState(1)
  const [background, setBackground] = useState('#ffffff')
  const [tiffCompression, setTiffCompression] = useState<'none' | 'lzw'>('lzw')
  const [icoSizes, setIcoSizes] = useState<number[]>([16, 32, 48, 256])
  const [name, setName] = useState(doc?.name ?? 'export')
  const [busy, setBusy] = useState(false)

  const info = FORMAT_INFO.find(f => f.id === format) ?? FORMAT_INFO[0]
  const isPsd = info.id === 'psd'
  // icon entries can't exceed the source dimensions
  const icoPool = ICO_SIZE_POOL.filter(s => s <= Math.min(doc?.width ?? 256, doc?.height ?? 256))
  const effectiveIcoSizes = icoSizes.filter(s => icoPool.includes(s))

  const apply = async () => {
    if (!doc || busy) return
    setBusy(true)
    const store = useEditorStore.getState()
    const t0 = performance.now()
    // only surface the progress bar when the export actually runs long
    let progressShown = false
    const showProgress = (label: string) => {
      if (performance.now() - t0 > 100) {
        progressShown = true
        store.setProgress({ active: true, label, value: 0.5 })
      }
    }
    try {
      engine.clearPreviewFilter()
      engine.clearPreviewAdjustment()
      const outName = name || doc.name

      if (isPsd) {
        // ---- layered PSD: one record per layer (bottom-first = doc order) ----
        const inputs: PsdLayerInput[] = []
        for (const l of doc.layers) {
          if (l.kind === 'adjustment') continue // no pixels of their own
          const c = engine.layerCanvas(l.id)
          if (!c || c.width === 0 || c.height === 0) continue
          const docSpace = l.kind !== 'raster' // smart/text/shape render doc-space
          inputs.push({
            name: l.name,
            canvas: c,
            left: docSpace ? 0 : l.offsetX ?? 0,
            top: docSpace ? 0 : l.offsetY ?? 0,
            opacity: l.opacity,
            blendMode: l.blendMode,
            visible: l.visible,
            clipped: l.clipped,
            mask: l.maskEnabled ? l.mask : null,
          })
        }
        showProgress('Building PSD…')
        await sleep(16) // let the progress bar paint before the sync encode
        const blob = buildPsd(doc.width, doc.height, inputs, getFlatComposite(doc), { resolutionPpi: doc.resolutionPpi ?? 72 })
        downloadBlob(blob, `${outName}.psd`)
        store.pushToast(`Exported ${outName}.psd — ${inputs.length} layer${inputs.length === 1 ? '' : 's'}`, 'success')
      } else {
        // ---- flattened raster formats ----
        const flat = compositeDocument(doc)
        let out = flat
        if (scale !== 1) {
          out = createCanvas(Math.max(1, Math.round(doc.width * scale)), Math.max(1, Math.round(doc.height * scale)))
          const c = ctx2d(out)
          c.imageSmoothingQuality = 'high'
          c.drawImage(flat, 0, 0, out.width, out.height)
        }
        showProgress(`Encoding ${info.label}…`)
        await sleep(16) // let the progress bar paint before the (partly sync) encode
        const blob = await encodeCanvas(out, info.id, {
          quality,
          background,
          icoSizes: effectiveIcoSizes.length ? effectiveIcoSizes : undefined,
          tiffCompression,
        })
        downloadBlob(blob, `${outName}.${info.ext}`)
        store.pushToast(`Exported ${outName}.${info.ext}`, 'success')
      }
      onClose()
    } catch (err) {
      const why = err instanceof Error && err.message ? ` — ${err.message}` : ''
      store.pushToast(`Export failed${why}`, 'error')
    } finally {
      if (progressShown) store.setProgress(null)
      setBusy(false)
    }
  }

  const opts = info.options
  const canExport = !!doc && !busy && (!opts.includes('icoSizes') || effectiveIcoSizes.length > 0)

  return (
    <>
      <DialogHeader><DialogTitle>Export As</DialogTitle></DialogHeader>
      <div className="space-y-3 py-1">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">File name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="h-7 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Format</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50">
                {FORMAT_INFO.map(f => (
                  <SelectItem key={f.id} value={f.id} className="text-xs" disabled={f.id === 'psd' && !doc}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground -mt-1.5">{info.hint}</div>

        {opts.includes('quality') && (
          <div className="space-y-1">
            <Label className="text-[11px]">Quality: {quality}%</Label>
            <input type="range" min={1} max={100} value={quality} onChange={e => setQuality(Number(e.target.value))} className="w-full accent-primary" />
          </div>
        )}
        {opts.includes('background') && (
          <div className="space-y-1">
            <Label className="text-[11px]">Background (flatten color)</Label>
            <div className="flex items-center gap-2">
              <input type="color" value={background} onChange={e => setBackground(e.target.value)} className="h-7 w-10 rounded border border-border bg-transparent cursor-pointer" aria-label="Background color" />
              <span className="text-[11px] font-mono text-muted-foreground">{background}</span>
            </div>
          </div>
        )}
        {opts.includes('tiffCompression') && (
          <div className="space-y-1">
            <Label className="text-[11px]">Compression</Label>
            <Select value={tiffCompression} onValueChange={v => setTiffCompression(v as 'none' | 'lzw')}>
              <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="lzw" className="text-xs">LZW (lossless)</SelectItem>
                <SelectItem value="none" className="text-xs">None</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {opts.includes('icoSizes') && (
          <div className="space-y-1">
            <Label className="text-[11px]">Icon sizes ({effectiveIcoSizes.length} selected)</Label>
            <div className="flex flex-wrap gap-2.5">
              {icoPool.map(s => (
                <label key={s} className="flex items-center gap-1 text-[11px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={icoSizes.includes(s)}
                    onChange={e => setIcoSizes(prev => e.target.checked ? [...prev, s] : prev.filter(x => x !== s))}
                    className="accent-primary"
                  />
                  {s}px
                </label>
              ))}
            </div>
          </div>
        )}
        {isPsd && (
          <div className="text-[10px] text-muted-foreground">
            {doc
              ? `${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'} · masks, blend modes, opacity & visibility preserved`
              : 'Open a document to export its layers'}
          </div>
        )}
        {!isPsd && (
          <div className="space-y-1">
            <Label className="text-[11px]">Scale: {Math.round(scale * 100)}% → {Math.round((doc?.width ?? 0) * scale)} × {Math.round((doc?.height ?? 0) * scale)} px</Label>
            <input type="range" min={0.1} max={4} step={0.05} value={scale} onChange={e => setScale(Number(e.target.value))} className="w-full accent-primary" />
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={!canExport}>{busy ? 'Exporting…' : 'Export'}</Button>
      </DialogFooter>
    </>
  )
}

export function TransformDialog({ inst, onClose }: DialogProps) {
  const layerId = inst.props?.layerId ?? engine.activeLayer?.id
  const layer = layerId ? engine.layerById(layerId) : null
  const isSmart = layer?.kind === 'smart'
  const [x, setX] = useState(0)
  const [y, setY] = useState(0)
  const [scale, setScale] = useState(100)
  const [rot, setRot] = useState(0)

  const apply = () => {
    if (!layerId) return
    engine.freeTransformLayer(layerId, { x, y, scale: scale / 100, rotation: rot })
    onClose()
  }

  return (
    <>
      <DialogHeader><DialogTitle>Free Transform{isSmart ? ' — Smart Object (non-destructive)' : ''}</DialogTitle></DialogHeader>
      <div className="space-y-3 py-1">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Offset X (px)</Label>
            <Input type="number" value={x} onChange={e => setX(Number(e.target.value))} className="h-7 text-xs font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Offset Y (px)</Label>
            <Input type="number" value={y} onChange={e => setY(Number(e.target.value))} className="h-7 text-xs font-mono" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Scale: {scale}%</Label>
          <input type="range" min={1} max={400} value={scale} onChange={e => setScale(Number(e.target.value))} className="w-full accent-primary" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Rotation: {rot}°</Label>
          <input type="range" min={-180} max={180} value={rot} onChange={e => setRot(Number(e.target.value))} className="w-full accent-primary" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={apply}>Apply</Button>
      </DialogFooter>
    </>
  )
}
