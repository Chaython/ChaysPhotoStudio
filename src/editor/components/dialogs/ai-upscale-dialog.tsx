'use client'
// AI Upscale dialog — on-device Lanczos+detail engine with a live 100%
// crop comparison preview, progress and target-size guard.
import { useEffect, useRef, useState, useCallback } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Sparkles, Cpu, ZoomIn, Info } from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { getFlatComposite } from '../../engine/document'
import { upscaleSmart } from '../../image-ops'
import { createCanvas, ctx2d } from '../../utils/canvas'
import type { DialogProps } from './generic-dialogs'
import { cn } from '@/lib/utils'

const SCALES = [1.5, 2, 3, 4]
const CROP = 180 // preview crop (doc px)

export function AiUpscaleDialog({ onClose }: DialogProps) {
  const doc = engine.activeDoc
  const [scale, setScale] = useState(2)
  const [detail, setDetail] = useState(55)
  const [denoise, setDenoise] = useState(20)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const beforeRef = useRef<HTMLCanvasElement>(null)
  const afterRef = useRef<HTMLCanvasElement>(null)
  const previewToken = useRef(0)

  const targetW = doc ? Math.round(doc.width * scale) : 0
  const targetH = doc ? Math.round(doc.height * scale) : 0
  const megapixels = (targetW * targetH) / 1e6
  const tooBig = megapixels > 40

  // ---- live preview: center crop, standard resample vs AI upscale ----
  const recompute = useCallback(async () => {
    const before = beforeRef.current
    const after = afterRef.current
    if (!doc || !before || !after) return
    const token = ++previewToken.current
    const flat = getFlatComposite(doc)
    const cw = Math.min(CROP, doc.width), ch = Math.min(CROP, doc.height)
    const cx = Math.floor((doc.width - cw) / 2), cy = Math.floor((doc.height - ch) / 2)
    const crop = createCanvas(cw, ch)
    ctx2d(crop).drawImage(flat, -cx, -cy)

    // "before" — the browser's standard high-quality resample (what Image Size gives)
    const bc = ctx2d(before)
    bc.imageSmoothingQuality = 'high'
    bc.clearRect(0, 0, before.width, before.height)
    bc.drawImage(crop, 0, 0, cw * scale, ch * scale)

    // "after" — AI pipeline (denoise → Lanczos → detail)
    const result = await upscaleSmart(crop, { scale, detail, denoise })
    if (token !== previewToken.current) return // superseded
    const ac = ctx2d(after)
    ac.clearRect(0, 0, after.width, after.height)
    ac.drawImage(result, 0, 0)
  }, [doc, scale, detail, denoise])

  useEffect(() => {
    const id = setTimeout(() => { void recompute() }, 140)
    return () => clearTimeout(id)
  }, [recompute])

  const previewPx = Math.min(300, Math.round(CROP * scale))

  const apply = async () => {
    if (!doc || busy) return
    if (tooBig) { useEditorStore.getState().pushToast('Result exceeds 40 MP — choose a smaller scale', 'error'); return }
    setBusy(true)
    setProgress(0.01)
    const store = useEditorStore.getState()
    store.setProgress({ active: true, label: 'AI upscale', value: 0 })
    try {
      const ok = await engine.aiUpscale({
        scale, detail, denoise,
        onProgress: p => { setProgress(p); useEditorStore.getState().setProgress({ active: true, label: 'AI upscale', value: p }) },
      })
      if (ok) onClose()
    } finally {
      useEditorStore.getState().setProgress(null)
      setProgress(0)
      setBusy(false)
    }
  }

  if (!doc) {
    return (
      <>
        <DialogHeader><DialogTitle>AI Upscale</DialogTitle></DialogHeader>
        <div className="text-xs text-muted-foreground py-4">No active document.</div>
        <DialogFooter><Button variant="secondary" size="sm" onClick={onClose}>Close</Button></DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Sparkles size={15} className="text-primary" /> AI Upscale</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-1">
        {/* engine */}
        <div className="flex items-center gap-2 rounded border border-primary/40 bg-primary/10 px-2.5 py-2 text-[11px]">
          <Cpu size={14} className="text-primary" />
          <span>
            <span className="block font-medium">On-device precision engine</span>
            <span className="text-[10px] text-muted-foreground">Lanczos-3 · edge-adaptive detail · runs 100% locally</span>
          </span>
        </div>

        {/* scale */}
        <div className="space-y-1">
          <Label className="text-[11px] flex items-center gap-1.5"><ZoomIn size={11} /> Scale</Label>
          <div className="grid grid-cols-4 gap-1">
            {SCALES.map(s => (
              <button
                key={s}
                className={cn('h-7 rounded border text-[11px] font-mono transition-colors',
                  scale === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent')}
                onClick={() => setScale(s)}
                aria-pressed={scale === s}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>

        {/* sliders */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[11px]">Detail Recovery <span className="text-muted-foreground font-mono">{detail}%</span></Label>
            <Slider value={[detail]} min={0} max={100} step={1} onValueChange={v => setDetail(v[0])} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px]">Denoise <span className="text-muted-foreground font-mono">{denoise}%</span></Label>
            <Slider value={[denoise]} min={0} max={100} step={1} onValueChange={v => setDenoise(v[0])} disabled={busy} />
          </div>
        </div>

        {/* target size */}
        <div className="flex items-center gap-2 text-[11px] font-mono px-2.5 py-1.5 rounded bg-muted/60 border">
          <span className="text-muted-foreground">{doc.width} × {doc.height}</span>
          <span className="text-primary">→</span>
          <span>{targetW} × {targetH}</span>
          <span className="text-muted-foreground">({megapixels.toFixed(1)} MP)</span>
          {tooBig && <span className="ml-auto text-destructive">exceeds 40 MP</span>}
        </div>

        {/* preview */}
        <div className="space-y-1">
          <Label className="text-[11px]">Center detail @ {(scale).toFixed(1)}× — Standard vs AI</Label>
          <div className="grid grid-cols-2 gap-1.5">
            <figure className="space-y-0.5">
              <canvas ref={beforeRef} width={previewPx} height={previewPx}
                className="w-full rounded border bg-[repeating-conic-gradient(#3a3a3a_0%_25%,#2c2c2c_0%_50%)] [background-size:12px_12px]"
                aria-label="Standard resample preview" />
              <figcaption className="text-[9px] text-muted-foreground text-center">Standard resample</figcaption>
            </figure>
            <figure className="space-y-0.5">
              <canvas ref={afterRef} width={previewPx} height={previewPx}
                className="w-full rounded border border-primary/40 bg-[repeating-conic-gradient(#3a3a3a_0%_25%,#2c2c2c_0%_50%)] [background-size:12px_12px]"
                aria-label="AI upscale preview" />
              <figcaption className="text-[9px] text-primary text-center">AI upscale</figcaption>
            </figure>
          </div>
        </div>

        {/* engine note */}
        <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <Info size={11} className="mt-0.5 flex-shrink-0" />
          <span>
            Applies in place — every layer keeps its structure, masks and smart filters; text/vector layers
            re-render crisply. Pixel data is never re-compressed or uploaded (raw RGBA pipeline, fully
            on-device). Recorded in Actions.
          </span>
        </div>

        {busy && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={busy || tooBig}>
          <Sparkles size={13} className="mr-1.5" />
          {busy ? 'Upscaling…' : `Upscale to ${targetW} × ${targetH}`}
        </Button>
      </DialogFooter>
    </>
  )
}
