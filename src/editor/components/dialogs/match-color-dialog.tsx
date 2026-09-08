'use client'
// ============================================================
// Match Color — PS Image > Adjustments > Match Color
// Transfer the color statistics of another open document onto the
// active layer. Source select (other open docs), Luminance /
// Color Intensity / Fade sliders + Neutralize toggle, debounced
// (150 ms) before/after preview on a ≤400px center-crop of the
// active layer. Commit: mutateLayerPixels → matchColor at full
// resolution → invalidateFlat → pushHistory('Match Color') → emit.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Palette, Image as ImageIcon, Wand2, Info } from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { getFlatComposite, invalidateFlat } from '../../engine/document'
import { matchColor } from '../../image-ops/auto'
import { downsampleImage } from '../../image-ops/core'
import { createCanvas, ctx2d, getImageData, putImageData } from '../../utils/canvas'
import { runPixelOpFromCanvas } from '../../engine/pixel-worker'
import type { DialogProps } from './generic-dialogs'
import { cn } from '@/lib/utils'

const CROP = 400   // preview crop (layer px)
const SRC_MAX = 400 // source stats resolution (preview)
const SRC_COMMIT_MAX = 800 // source stats resolution (commit)

function SliderRow({ label, value, min, max, step = 1, unit, disabled, onChange, hint }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  disabled?: boolean
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-muted-foreground leading-none">{label}</Label>
        <span className={cn('text-[10px] font-mono tabular-nums', disabled ? 'text-muted-foreground/50' : 'text-primary')}>
          {value}{unit ?? ''}
        </span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} disabled={disabled} onValueChange={v => onChange(v[0])} />
      {hint && <div className="text-[10px] text-muted-foreground leading-snug">{hint}</div>}
    </div>
  )
}

export function MatchColorDialog({ onClose }: DialogProps) {
  const doc = engine.activeDoc
  const layer = engine.activeLayer
  const renderTick = useEditorStore(s => s.renderTick)
  void renderTick // engine emits re-render the source list (docs can open/close)
  const [srcId, setSrcId] = useState<string | null>(null)
  const [luminance, setLuminance] = useState(100)
  const [intensity, setIntensity] = useState(100)
  const [fade, setFade] = useState(0)
  const [neutralize, setNeutralize] = useState(false)
  const [busy, setBusy] = useState(false)
  const beforeRef = useRef<HTMLCanvasElement>(null)
  const afterRef = useRef<HTMLCanvasElement>(null)
  const previewToken = useRef(0)
  const cropRef = useRef<ImageData | null>(null)
  const srcCacheRef = useRef<{ id: string; flat: HTMLCanvasElement; img: ImageData } | null>(null)

  const sources = doc ? engine.docs.filter(d => d.id !== doc.id) : []
  const activeSource = srcId ? sources.find(d => d.id === srcId) ?? null : null

  // auto-select the first source so the Select stays controlled (no React warning)
  useEffect(() => {
    if (!srcId && sources.length) setSrcId(sources[0].id)
  }, [srcId, sources])

  // ---- draw an ImageData letterboxed into a fixed-size preview canvas ----
  const drawInto = useCallback((cv: HTMLCanvasElement | null, img: ImageData) => {
    if (!cv) return
    const c = cv.getContext('2d')!
    c.clearRect(0, 0, cv.width, cv.height)
    const s = Math.min(cv.width / img.width, cv.height / img.height)
    const dw = Math.max(1, Math.round(img.width * s))
    const dh = Math.max(1, Math.round(img.height * s))
    const tmp = createCanvas(img.width, img.height)
    putImageData(tmp, img)
    c.imageSmoothingQuality = 'high'
    c.drawImage(tmp, Math.round((cv.width - dw) / 2), Math.round((cv.height - dh) / 2), dw, dh)
  }, [])

  // ---- init: center-crop snapshot of the active layer, preview sizes ----
  useEffect(() => {
    const d = engine.activeDoc
    const l = engine.activeLayer
    if (!d || !l) return
    const lc = engine.layerCanvasDocSpace(l.id) // doc-space pixels (raster offset baked for preview)
    if (!lc) return
    const cw = Math.min(CROP, lc.width)
    const ch = Math.min(CROP, lc.height)
    const cx = Math.floor((lc.width - cw) / 2)
    const cy = Math.floor((lc.height - ch) / 2)
    const c = createCanvas(cw, ch)
    ctx2d(c).drawImage(lc, -cx, -cy)
    cropRef.current = getImageData(c)
    const s = Math.min(310 / cw, 185 / ch)
    const bw = Math.max(120, Math.round(cw * s))
    const bh = Math.max(90, Math.round(ch * s))
    for (const ref of [beforeRef, afterRef]) {
      const cv = ref.current
      if (cv) { cv.width = bw; cv.height = bh }
    }
    drawInto(beforeRef.current, cropRef.current)
    if (!srcId) {
      const first = engine.docs.find(x => x.id !== d.id)
      if (first) setSrcId(first.id)
    }
  }, [])

  // ---- source stats image (downscaled flat composite, cached by identity) ----
  const getSourceImg = useCallback((): ImageData | null => {
    const d = engine.activeDoc
    if (!d || !srcId) return null
    const sd = engine.docs.find(x => x.id === srcId)
    if (!sd || sd.id === d.id) return null
    const flat = getFlatComposite(sd)
    const cached = srcCacheRef.current
    if (cached && cached.id === sd.id && cached.flat === flat) return cached.img
    const img = downsampleImage(getImageData(flat), SRC_MAX)
    srcCacheRef.current = { id: sd.id, flat, img }
    return img
  }, [srcId])

  // ---- live preview: matchColor on the crop copy ----
  const recompute = useCallback(() => {
    const crop = cropRef.current
    const after = afterRef.current
    if (!crop || !after) return
    const token = ++previewToken.current
    const srcImg = getSourceImg()
    if (!srcImg) {
      const c = after.getContext('2d')
      c?.clearRect(0, 0, after.width, after.height)
      return
    }
    const out = new ImageData(new Uint8ClampedArray(crop.data), crop.width, crop.height)
    matchColor(out, srcImg, { luminance, fade, neutralize, intensity })
    if (token !== previewToken.current) return // superseded
    drawInto(after, out)
  }, [luminance, fade, neutralize, intensity, getSourceImg, drawInto])

  useEffect(() => {
    const id = setTimeout(() => { recompute() }, 150)
    return () => clearTimeout(id)
  }, [recompute])

  // ---- commit: full-resolution match on the active layer ----
  // heavy one-shot op — pixel math runs in the pixel-op worker pool (Task 7-b);
  // the source stats image is copied by the wrapper (never consumed) so the
  // synchronous fallback re-run stays correct.
  const apply = async () => {
    if (!doc || !layer || !activeSource || busy) return
    setBusy(true)
    try {
      if (layer.kind !== 'raster') {
        useEditorStore.getState().pushToast('Layer rasterized for Match Color', 'info')
      }
      const l = engine.mutateLayerPixels(layer.id) // COW clone; rasterizes non-raster
      if (!l?.canvas) {
        useEditorStore.getState().pushToast('Active layer has no pixels to adjust', 'error')
        return
      }
      const srcImg = downsampleImage(getImageData(getFlatComposite(activeSource)), SRC_COMMIT_MAX)
      const out = await runPixelOpFromCanvas(l.canvas, {
        kind: 'match-color',
        params: { luminance, fade, neutralize, intensity },
        source: srcImg,
      })
      putImageData(l.canvas, out)
      invalidateFlat(doc)
      engine.pushHistory('Match Color')
      engine.emit()
      useEditorStore.getState().pushToast(`Match Color applied from “${activeSource.name}”`, 'success')
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Match Color failed'
      useEditorStore.getState().pushToast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!doc || !layer) {
    return (
      <>
        <DialogHeader><DialogTitle>Match Color</DialogTitle></DialogHeader>
        <div className="text-xs text-muted-foreground py-4">No active document or layer.</div>
        <DialogFooter><Button variant="secondary" size="sm" onClick={onClose}>Close</Button></DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Palette size={15} className="text-primary" /> Match Color</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-1">
        {/* source */}
        <div className="space-y-1.5">
          <Label className="text-[11px] flex items-center gap-1.5"><ImageIcon size={11} /> Source</Label>
          {sources.length > 0 ? (
            <Select value={srcId ?? ''} onValueChange={v => setSrcId(v)}>
              <SelectTrigger className="h-8 text-[11px]">
                <SelectValue placeholder="Choose a source document" />
              </SelectTrigger>
              <SelectContent>
                {sources.map(d => (
                  <SelectItem key={d.id} value={d.id} className="text-[11px]">
                    {d.name} · {d.width} × {d.height}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-[10px] text-muted-foreground rounded border border-dashed border-border px-2.5 py-2 leading-snug">
              Open a second image (another tab in this workspace) to use as the color source.
            </p>
          )}
        </div>

        {/* sliders */}
        <div className="grid grid-cols-2 gap-3">
          <SliderRow
            label="Luminance" value={luminance} min={0} max={100} unit="%"
            onChange={setLuminance} disabled={busy}
            hint="How far the brightness moves toward the source."
          />
          <SliderRow
            label="Color Intensity" value={intensity} min={0} max={100} unit="%"
            onChange={setIntensity} disabled={busy}
            hint="Strength of the color + contrast transfer."
          />
        </div>
        <SliderRow label="Fade" value={fade} min={0} max={100} unit="%" onChange={setFade} disabled={busy} />

        {/* neutralize */}
        <label
          className={cn(
            'flex items-start gap-2 rounded border px-2.5 py-2 transition-colors cursor-pointer',
            neutralize ? 'border-primary/50 bg-primary/10' : 'border-border',
          )}
        >
          <Checkbox checked={neutralize} onCheckedChange={v => setNeutralize(v === true)} className="mt-0.5" disabled={busy} />
          <span className="leading-tight">
            <span className="text-[11px] font-medium">Neutralize</span>
            <span className="block text-[10px] text-muted-foreground leading-snug">
              Gray-balances this layer before matching — reduces its own color cast.
            </span>
          </span>
        </label>

        {/* preview */}
        <div className="space-y-1">
          <Label className="text-[11px]">Active layer center detail — Before / After</Label>
          <div className="grid grid-cols-2 gap-1.5">
            <figure className="space-y-0.5">
              <canvas ref={beforeRef}
                className="w-full rounded border bg-[repeating-conic-gradient(#3a3a3a_0%_25%,#2c2c2c_0%_50%)] [background-size:12px_12px]"
                aria-label="Match Color before preview" />
              <figcaption className="text-[9px] text-muted-foreground text-center">Before</figcaption>
            </figure>
            <figure className="space-y-0.5">
              <canvas ref={afterRef}
                className="w-full rounded border border-primary/40 bg-[repeating-conic-gradient(#3a3a3a_0%_25%,#2c2c2c_0%_50%)] [background-size:12px_12px]"
                aria-label="Match Color after preview" />
              <figcaption className="text-[9px] text-primary text-center">
                {activeSource ? `Matched · ${activeSource.name}` : 'No source'}
              </figcaption>
            </figure>
          </div>
        </div>

        {/* note */}
        <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <Info size={11} className="mt-0.5 flex-shrink-0" />
          <span>
            Per-channel mean + contrast statistics are transferred from the source document onto the
            active layer. Applies destructively to the layer pixels — history keeps one step back.
          </span>
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={busy || !activeSource}>
          <Wand2 size={13} className="mr-1.5" />
          {busy ? 'Matching…' : 'Match Color'}
        </Button>
      </DialogFooter>
    </>
  )
}
