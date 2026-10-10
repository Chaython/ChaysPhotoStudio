'use client'
// Document dialogs: New, Image Size, Canvas Size, Export, Free Transform
import { useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { engine, type TransformMode, type TransformReference } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { createCanvas, ctx2d, downloadBlob, canvasPixelCapabilities } from '../../utils/canvas'
import { compositeDocument, getFlatComposite } from '../../engine/document'
import { FORMAT_INFO, ICO_SIZE_POOL, encodeCanvas, buildPsd, buildOpenRaster } from '../../formats'
import type { PsdLayerInput } from '../../formats'
import type { DialogProps } from './generic-dialogs'
import { TransformWarpEditor } from './transform-warp-editor'
import { buildPhotoshopMetadataResources } from '../../formats/metadata-write'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function base64Bytes(text: string): Uint8Array {
  const raw = atob(text)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function photoshopResourceId(block: Uint8Array): number | null {
  if (block.length < 6) return null
  const sig = String.fromCharCode(block[0], block[1], block[2], block[3])
  if (sig !== '8BIM' && sig !== 'MeSa') return null
  return (block[4] << 8) | block[5]
}

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
  const caps = canvasPixelCapabilities()
  const [bitDepth, setBitDepth] = useState<8 | 16 | 32>(caps.float16Context && caps.float16ImageData ? 16 : 8)
  const [colorSpace, setColorSpace] = useState<'srgb' | 'display-p3'>(caps.displayP3 ? 'display-p3' : 'srgb')
  const store = useEditorStore.getState()

  const create = () => {
    if (w < 1 || h < 1 || w > 8192 || h > 8192) { store.pushToast('Dimensions must be 1–8192', 'error'); return }
    const doc = engine.newDocument({ name: name || undefined, width: Math.round(w), height: Math.round(h), resolutionPpi, bitDepth, colorSpace, fill: fill as any })
    store.pushToast(`Created ${Math.round(w)}×${Math.round(h)} · ${doc.workingBitDepth}-bit · ${doc.workingColorSpace} · ${Math.round(resolutionPpi)} PPI`, 'success')
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
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Color depth</Label>
            <Select value={String(bitDepth)} onValueChange={v => {
              const next = v === '32' ? 32 : v === '16' ? 16 : 8
              setBitDepth(next)
              if (next === 32) setColorSpace('srgb')
            }}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="8" className="text-xs">8-bit/channel</SelectItem>
                <SelectItem value="16" className="text-xs" disabled={!caps.float16Context || !caps.float16ImageData}>16-bit float working raster</SelectItem>
                <SelectItem value="32" className="text-xs" disabled={!caps.float16Context || !caps.float16ImageData}>32-bit float HDR (scene-linear)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Color space</Label>
            <Select value={colorSpace} onValueChange={v => setColorSpace(v === 'display-p3' ? 'display-p3' : 'srgb')}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="srgb" className="text-xs">sRGB</SelectItem>
                <SelectItem value="display-p3" className="text-xs" disabled={!caps.displayP3 || bitDepth === 32}>Display P3</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {bitDepth === 32 && (
          <div className="text-[10px] text-muted-foreground">32-bit mode stores authoritative scene-linear Float32 pixels; the canvas is a 16F sRGB display/edit mirror. SDR-only filters are disabled rather than clipping HDR highlights.</div>
        )}
        {(!caps.float16Context || !caps.float16ImageData) && (
          <div className="text-[10px] text-muted-foreground">16/32-bit working canvases are unavailable in this browser; 8-bit remains available.</div>
        )}
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
  const [tiffBitDepth, setTiffBitDepth] = useState<8 | 16>((doc?.workingBitDepth ?? 8) >= 16 ? 16 : 8)
  const [icoSizes, setIcoSizes] = useState<number[]>([16, 32, 48, 256])
  const [name, setName] = useState(doc?.name ?? 'export')
  const [includeMetadata, setIncludeMetadata] = useState(true)
  const [busy, setBusy] = useState(false)

  const info = FORMAT_INFO.find(f => f.id === format) ?? FORMAT_INFO[0]
  const isPsd = format === 'psd' || format === 'psb' || format === 'ora'
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

      if (format === 'ora') {
        const layers = doc.layers.filter(l => l.kind !== 'adjustment').flatMap(l => {
          const canvas = engine.layerCanvas(l.id)
          if (!canvas || !canvas.width || !canvas.height) return []
          const documentSpace = l.kind !== 'raster'
          return [{
            name: l.name, canvas,
            left: documentSpace ? 0 : l.offsetX ?? 0,
            top: documentSpace ? 0 : l.offsetY ?? 0,
            opacity: l.opacity, visible: l.visible, blendMode: l.blendMode,
          }]
        })
        showProgress('Building OpenRaster…')
        await sleep(16)
        const blob = await buildOpenRaster(doc.width, doc.height, layers, getFlatComposite(doc), {
          name: doc.name, resolutionPpi: doc.resolutionPpi,
        })
        downloadBlob(blob, `${outName}.ora`)
        store.pushToast(`Exported ${outName}.ora — ${layers.length} layers (complex effects may be rasterized)`, 'success')
      } else if (isPsd) {
        const hdrComposite = doc.workingBitDepth === 32 ? engine.hdrCompositeForPsd() : null
        if (doc.workingBitDepth === 32 && !hdrComposite) throw new Error('Complex 32-bit HDR layers cannot be encoded losslessly as PSD/PSB. Simplify the document or preserve it in the native format.')
        const unsupported = doc.layers.filter(l => ['adjustment', 'text', 'shape', 'smart'].includes(l.kind))
        if (unsupported.length && !window.confirm(`${unsupported.length} editable layer(s) (adjustment/text/shape/Smart Object) cannot round-trip natively in Photoshop. Adjustment layers will be omitted and other layers rasterized. Continue exporting a compatibility copy?`)) return
        // Group delimiters are byte-preserved only if the original drawable layer
        // sequence is intact. Reordering or inserting layers can invalidate the
        // Photoshop nesting, so never silently emit stale folder boundaries.
        const sectionMarkers = doc.psdSectionMarkers ?? []
        const originalOrder = doc.psdSectionLayerOrder ?? []
        const preserveGroups = sectionMarkers.length > 0 &&
          unsupported.length === 0 &&
          originalOrder.length === doc.layers.length &&
          doc.layers.every((l, i) => l.id === originalOrder[i] && l.kind === 'raster') &&
          sectionMarkers.every(m => Number.isSafeInteger(m.beforeLayerIndex) &&
            m.beforeLayerIndex >= 0 && m.beforeLayerIndex <= doc.layers.length)
        if (sectionMarkers.length && !preserveGroups &&
            !window.confirm('The layer order or layer types changed since this PSD was opened. Original Photoshop folder/adjustment records cannot be preserved safely. Export without those records?')) return
        if (preserveGroups && sectionMarkers.some(m => m.kind === 'adjustment') &&
            !window.confirm('This PSD contains Photoshop-only adjustment layers. Studio cannot render or edit these adjustments, but the original records can be retained for Photoshop. The appearance after opening in Photoshop may differ from the Studio preview. Continue?')) return
        // ---- layered PSD: raster records and safe, opaque folder delimiters ----
        const inputs: PsdLayerInput[] = []
        const markerSurface = preserveGroups ? createCanvas(1, 1) : null
        const addMarkers = (at: number) => {
          if (!preserveGroups || !markerSurface) return
          for (const m of sectionMarkers) {
            if (m.beforeLayerIndex !== at) continue
            inputs.push({
              sectionMarker: true, name: m.name, canvas: markerSurface,
              left: 0, top: 0, opacity: m.opacity, visible: m.visible,
              blendMode: 'normal', rawBlendKey: m.blendKey,
              additionalInfo: m.additionalInfo.map(base64Bytes),
              blendingRanges: m.blendingRanges ? base64Bytes(m.blendingRanges) : undefined,
            })
          }
        }
        for (let layerIndex = 0; layerIndex < doc.layers.length; layerIndex++) {
          addMarkers(layerIndex)
          const l = doc.layers[layerIndex]
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
            hdrPixels: doc.workingBitDepth === 32 ? l.hdrPixels ?? undefined : undefined,
            fx: l.fx ? structuredClone(l.fx) : null,
            additionalInfo: l.psdAdditionalInfo?.map(base64Bytes),
            blendingRanges: l.psdBlendingRanges ? base64Bytes(l.psdBlendingRanges) : undefined,
          })
        }
        addMarkers(doc.layers.length)
        showProgress(format === 'psb' ? 'Building PSB…' : 'Building PSD…')
        await sleep(16) // let the progress bar paint before the sync encode
        const preservedResources = (doc.psdImageResources ?? [])
          .map(base64Bytes)
          .filter(block => {
            const id = photoshopResourceId(block)
            return id !== 0x0404 && id !== 0x0424
          })
        const metadataResources = includeMetadata ? buildPhotoshopMetadataResources(doc.metadata) : []
        const blob = buildPsd(doc.width, doc.height, inputs, getFlatComposite(doc), {
          resolutionPpi: doc.resolutionPpi ?? 72,
          depth: doc.workingBitDepth === 32 ? 32 : doc.workingBitDepth === 16 ? 16 : 8,
          compositeHdrPixels: hdrComposite ?? undefined,
          colorModeData: doc.workingBitDepth === 32 && doc.psdColorModeData
            ? base64Bytes(doc.psdColorModeData) : undefined,
          format: format === 'psb' ? 'psb' : 'psd',
          imageResources: [...preservedResources, ...metadataResources],
        })
        downloadBlob(blob, `${outName}.${format}`)
        store.pushToast(`Exported ${outName}.${format} — ${inputs.length} layer${inputs.length === 1 ? '' : 's'}`, 'success')
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
          tiffBitDepth,
          metadata: doc.metadata,
          includeMetadata,
          resolutionPpi: doc.resolutionPpi ?? 72,
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

  const opts = format === 'psb' ? (['psdLayers'] as typeof info.options) : info.options
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
                <SelectItem value="psb" className="text-xs">PSB (large document, layered)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground -mt-1.5">{format === 'psb' ? 'PSB v2 large-document layered export (8/16/32-bit RGB). Advanced Photoshop layer objects require compatibility rasterization.' : info.hint}</div>

        {['png', 'jpeg', 'webp', 'tiff', 'psd'].includes(info.id) || format === 'psb' && (
          <div className="rounded border border-border/60 p-2 space-y-1">
            <label className="flex items-center gap-2 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={includeMetadata}
                onChange={e => setIncludeMetadata(e.target.checked)}
                className="accent-primary"
              />
              Include File Info metadata
            </label>
            <div className="text-[9px] text-muted-foreground pl-5">
              Writes editable XMP/IPTC plus document resolution. Source GPS/camera EXIF stays view-only after editing.
            </div>
          </div>
        )}

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
        {opts.includes('tiffBitDepth') && (
          <div className="space-y-1">
            <Label className="text-[11px]">TIFF channel depth</Label>
            <Select value={String(tiffBitDepth)} onValueChange={v => setTiffBitDepth(v === '16' ? 16 : 8)}>
              <SelectTrigger className="h-7 text-xs w-44"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="8" className="text-xs">8-bit/channel</SelectItem>
                <SelectItem value="16" className="text-xs" disabled={(doc?.workingBitDepth ?? 8) < 16}>16-bit/channel</SelectItem>
              </SelectContent>
            </Select>
            {(doc?.workingBitDepth ?? 8) < 16 && <div className="text-[10px] text-muted-foreground">16-bit TIFF export requires a high-depth working document.</div>}
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

type TransformCornerOffsets = [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
]

export function TransformDialog({ inst, onClose }: DialogProps) {
  const layerId = inst.props?.layerId ?? engine.activeLayer?.id
  const layer = layerId ? engine.layerById(layerId) : null
  const isSmart = layer?.kind === 'smart'
  const initialMode = (inst.props?.mode ?? 'free') as TransformMode
  const [mode, setMode] = useState<TransformMode>(initialMode)
  const [x, setX] = useState(0)
  const [y, setY] = useState(0)
  const [scaleX, setScaleX] = useState(100)
  const [scaleY, setScaleY] = useState(100)
  const [linked, setLinked] = useState(true)
  const [rot, setRot] = useState(0)
  const [skewX, setSkewX] = useState(0)
  const [skewY, setSkewY] = useState(0)
  const [perspectiveX, setPerspectiveX] = useState(0)
  const [perspectiveY, setPerspectiveY] = useState(0)
  const [reference, setReference] = useState<TransformReference>('mc')
  const [corners, setCorners] = useState<TransformCornerOffsets>([
    { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
  ])
  const [warpMesh, setWarpMesh] = useState(() => layerId ? engine.layerWarpMesh(layerId, 3, 3) : { u: [0, 1], v: [0, 1], points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] })

  const setScaleAxis = (axis: 'x' | 'y', value: number) => {
    const next = Math.max(1, Math.min(400, value))
    if (axis === 'x') {
      setScaleX(next)
      if (linked) setScaleY(next)
    } else {
      setScaleY(next)
      if (linked) setScaleX(next)
    }
  }

  const setCorner = (index: number, axis: 'x' | 'y', value: number) => {
    setCorners(prev => {
      const next: TransformCornerOffsets = [
        { ...prev[0] }, { ...prev[1] }, { ...prev[2] }, { ...prev[3] },
      ]
      next[index] = { ...next[index], [axis]: value }
      return next
    })
  }

  const apply = () => {
    if (!layerId) return
    engine.transformLayer(layerId, {
      mode,
      x, y,
      scaleX: scaleX / 100,
      scaleY: scaleY / 100,
      rotation: rot,
      skewX, skewY,
      perspectiveX, perspectiveY,
      reference,
      cornerOffsets: [
        { ...corners[0] }, { ...corners[1] }, { ...corners[2] }, { ...corners[3] },
      ],
      warp: mode === 'warp' ? warpMesh : undefined,
    })
    onClose()
  }

  const refs: { id: TransformReference; label: string }[] = [
    { id: 'tl', label: '↖' }, { id: 'tc', label: '↑' }, { id: 'tr', label: '↗' },
    { id: 'ml', label: '←' }, { id: 'mc', label: '●' }, { id: 'mr', label: '→' },
    { id: 'bl', label: '↙' }, { id: 'bc', label: '↓' }, { id: 'br', label: '↘' },
  ]

  const title = mode === 'free' ? 'Free Transform'
    : mode === 'scale' ? 'Scale'
      : mode === 'rotate' ? 'Rotate'
        : mode === 'skew' ? 'Skew'
          : mode === 'distort' ? 'Distort'
            : mode === 'perspective' ? 'Perspective'
              : 'Warp'

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}{isSmart ? ' — Smart Object (non-destructive)' : ''}</DialogTitle>
      </DialogHeader>

      <div className="space-y-3 py-1">
        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-[11px]">Transform Mode</Label>
            <Select value={mode} onValueChange={v => setMode(v as TransformMode)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free Transform</SelectItem>
                <SelectItem value="scale">Scale</SelectItem>
                <SelectItem value="rotate">Rotate</SelectItem>
                <SelectItem value="skew">Skew</SelectItem>
                <SelectItem value="distort">Distort</SelectItem>
                <SelectItem value="perspective">Perspective</SelectItem>
                <SelectItem value="warp">Warp</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(mode === 'free' || mode === 'scale' || mode === 'rotate' || mode === 'skew') && (
            <div className="space-y-1">
              <Label className="text-[11px]">Reference Point</Label>
              <div className="grid grid-cols-3 gap-px rounded border bg-border p-px w-[78px]">
                {refs.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    className={`h-6 text-[10px] bg-background hover:bg-accent ${reference === r.id ? 'text-primary bg-primary/10' : 'text-muted-foreground'}`}
                    onClick={() => setReference(r.id)}
                    title={`Reference point: ${r.id}`}
                    aria-pressed={reference === r.id}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {mode !== 'warp' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Offset X (px)</Label>
                      <Input type="number" value={x} onChange={e => setX(Number(e.target.value))} className="h-8 text-xs font-mono" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Offset Y (px)</Label>
                      <Input type="number" value={y} onChange={e => setY(Number(e.target.value))} className="h-8 text-xs font-mono" />
                    </div>
                  </div>
        )}

        {(mode === 'free' || mode === 'scale') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[11px]">Scale</Label>
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={linked} onChange={e => setLinked(e.target.checked)} className="accent-primary" />
                Link proportions
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">W: {scaleX}%</Label>
                <input type="range" min={1} max={400} value={scaleX} onChange={e => setScaleAxis('x', Number(e.target.value))} className="w-full accent-primary" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">H: {scaleY}%</Label>
                <input type="range" min={1} max={400} value={scaleY} onChange={e => setScaleAxis('y', Number(e.target.value))} className="w-full accent-primary" />
              </div>
            </div>
          </div>
        )}

        {(mode === 'free' || mode === 'rotate') && (
          <div className="space-y-1">
            <Label className="text-[11px]">Rotation: {rot}°</Label>
            <input type="range" min={-180} max={180} step={1} value={rot} onChange={e => setRot(Number(e.target.value))} className="w-full accent-primary" />
          </div>
        )}

        {mode === 'skew' && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Horizontal Skew: {skewX}°</Label>
              <input type="range" min={-80} max={80} step={1} value={skewX} onChange={e => setSkewX(Number(e.target.value))} className="w-full accent-primary" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Vertical Skew: {skewY}°</Label>
              <input type="range" min={-80} max={80} step={1} value={skewY} onChange={e => setSkewY(Number(e.target.value))} className="w-full accent-primary" />
            </div>
          </div>
        )}

        {mode === 'perspective' && (
          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Horizontal Perspective: {perspectiveX}%</Label>
              <input type="range" min={-100} max={100} value={perspectiveX} onChange={e => setPerspectiveX(Number(e.target.value))} className="w-full accent-primary" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Vertical Perspective: {perspectiveY}%</Label>
              <input type="range" min={-100} max={100} value={perspectiveY} onChange={e => setPerspectiveY(Number(e.target.value))} className="w-full accent-primary" />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Opposing corners move symmetrically, matching Photoshop Perspective behavior.
            </p>
          </div>
        )}

        {mode === 'distort' && (
          <div className="space-y-2">
            <Label className="text-[11px]">Corner Offsets (px)</Label>
            <div className="grid grid-cols-2 gap-2">
              {['Top Left', 'Top Right', 'Bottom Right', 'Bottom Left'].map((label, i) => (
                <div key={label} className="rounded border p-2 space-y-1">
                  <div className="text-[10px] font-medium">{label}</div>
                  <div className="grid grid-cols-2 gap-1">
                    <Input
                      type="number"
                      value={corners[i].x}
                      onChange={e => setCorner(i, 'x', Number(e.target.value))}
                      className="h-7 text-[10px] font-mono"
                      aria-label={`${label} X offset`}
                    />
                    <Input
                      type="number"
                      value={corners[i].y}
                      onChange={e => setCorner(i, 'y', Number(e.target.value))}
                      className="h-7 text-[10px] font-mono"
                      aria-label={`${label} Y offset`}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Distort moves all four corners independently. Positive X moves right; positive Y moves down.
            </p>
          </div>
        )}

        {mode === 'warp' && layerId && (
          <TransformWarpEditor layerId={layerId} mesh={warpMesh} onChange={setWarpMesh} />
        )}

        {!isSmart && (mode === 'skew' || mode === 'distort' || mode === 'perspective' || mode === 'warp' || ((mode === 'free' || mode === 'scale') && scaleX !== scaleY)) && layer && (layer.kind === 'text' || layer.kind === 'shape') && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] text-amber-700 dark:text-amber-300">
            This advanced transform rasterizes the editable {layer.kind} layer. Smart Objects keep Warp and projective transforms non-destructive and re-editable.
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={apply}>Apply</Button>
      </DialogFooter>
    </>
  )
}
