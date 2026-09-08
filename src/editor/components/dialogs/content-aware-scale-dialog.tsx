'use client'
// ============================================================
// Content-Aware Scale — seam-carving rescale workspace
// Width/Height % sliders (50–200%) with link toggle, optional
// selection protection, debounced (150 ms) seam-carve preview on
// a ≤500px snapshot with a superseded-token guard, and a commit
// path that carves the flat composite and opens the result as a
// NEW document ("Name · CAS") via engine.addCanvasDocument —
// the cloud-upscale flow keeps the original untouched.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { Maximize2, Link2, ShieldCheck, Sparkles, RotateCcw, Info } from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { getFlatComposite } from '../../engine/document'
import { seamCarve, boxResampleMask } from '../../image-ops/seam-carve'
import { createCanvas, ctx2d, getImageData, putImageData } from '../../utils/canvas'
import type { DialogProps } from './generic-dialogs'
import { cn } from '@/lib/utils'

const PREVIEW_MAX = 500 // px — preview carve snapshot long side

export function ContentAwareScaleDialog({ onClose }: DialogProps) {
  const doc = engine.activeDoc
  const hasSelection = useEditorStore(s => s.hasSelection)
  const [wPct, setWPct] = useState(100)
  const [hPct, setHPct] = useState(100)
  const [linked, setLinked] = useState(true)
  const [protectSel, setProtectSel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [previewing, setPreviewing] = useState(false)
  const beforeRef = useRef<HTMLCanvasElement>(null)
  const afterRef = useRef<HTMLCanvasElement>(null)
  const previewToken = useRef(0)
  const abortRef = useRef(false)
  const snapRef = useRef<ImageData | null>(null)        // ≤500px flat snapshot
  const protectDocRef = useRef<Uint8Array | null>(null) // doc-space selection alpha
  const protectPreviewRef = useRef<Uint8Array | null>(null)

  const targetW = doc ? Math.max(1, Math.round(doc.width * wPct / 100)) : 0
  const targetH = doc ? Math.max(1, Math.round(doc.height * hPct / 100)) : 0
  const megapixels = (targetW * targetH) / 1e6
  const tooBig = megapixels > 40
  const unchanged = !!doc && targetW === doc.width && targetH === doc.height

  // ---- draw an ImageData letterboxed into a fixed-size preview canvas ----
  const drawInto = useCallback((cv: HTMLCanvasElement | null, img: ImageData, protect?: Uint8Array | null) => {
    if (!cv) return
    const c = cv.getContext('2d')!
    c.clearRect(0, 0, cv.width, cv.height)
    const s = Math.min(cv.width / img.width, cv.height / img.height)
    const dw = Math.max(1, Math.round(img.width * s))
    const dh = Math.max(1, Math.round(img.height * s))
    const dx = Math.round((cv.width - dw) / 2)
    const dy = Math.round((cv.height - dh) / 2)
    const tmp = createCanvas(img.width, img.height)
    putImageData(tmp, img)
    c.imageSmoothingQuality = 'high'
    c.drawImage(tmp, dx, dy, dw, dh)
    if (protect && protect.length === img.width * img.height) {
      // amber tint over protected pixels (selection overlay)
      const ov = c.createImageData(dw, dh)
      for (let py = 0; py < dh; py++) {
        const sy = Math.min(img.height - 1, Math.round(py / s))
        for (let px = 0; px < dw; px++) {
          const sx = Math.min(img.width - 1, Math.round(px / s))
          const m = protect[sy * img.width + sx] / 255
          if (m <= 0.02) continue
          const o = (py * dw + px) * 4
          ov.data[o] = 232; ov.data[o + 1] = 163; ov.data[o + 2] = 61
          ov.data[o + 3] = Math.round(150 * m)
        }
      }
      const oc = createCanvas(dw, dh)
      ctx2d(oc).putImageData(ov, 0, 0)
      c.drawImage(oc, dx, dy)
    }
  }, [])

  const drawBefore = useCallback(() => {
    const snap = snapRef.current
    if (!snap) return
    drawInto(beforeRef.current, snap, protectSel ? protectPreviewRef.current : null)
  }, [drawInto, protectSel])

  useEffect(() => { drawBefore() }, [drawBefore])

  // ---- init: snapshot, selection protect mask, preview canvas sizes ----
  useEffect(() => {
    const d = engine.activeDoc
    if (!d) return
    const flat = getFlatComposite(d)
    const s = Math.min(1, PREVIEW_MAX / Math.max(d.width, d.height))
    const pw = Math.max(1, Math.round(d.width * s))
    const ph = Math.max(1, Math.round(d.height * s))
    const c = createCanvas(pw, ph)
    const cc = ctx2d(c)
    cc.imageSmoothingQuality = 'high'
    cc.drawImage(flat, 0, 0, pw, ph)
    snapRef.current = getImageData(c)
    if (d.selection) {
      const sd = getImageData(d.selection.mask)
      const alpha = new Uint8Array(d.width * d.height) // protect = 255 → carved last
      for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = sd.data[j]
      protectDocRef.current = alpha
      protectPreviewRef.current = boxResampleMask(alpha, d.width, d.height, pw, ph)
      setProtectSel(true)
    }
    const bs = Math.min(320 / pw, 190 / ph)
    const bw = Math.max(120, Math.round(pw * bs))
    const bh = Math.max(90, Math.round(ph * bs))
    for (const ref of [beforeRef, afterRef]) {
      const cv = ref.current
      if (cv) { cv.width = bw; cv.height = bh }
    }
  }, [])

  // abort the full-res run if the dialog unmounts mid-carve
  useEffect(() => {
    abortRef.current = false
    return () => { abortRef.current = true }
  }, [])

  // ---- live preview: debounced seam-carve on the snapshot ----
  const recompute = useCallback(async () => {
    const snap = snapRef.current
    const after = afterRef.current
    if (!snap || !after || busy) return
    const token = ++previewToken.current
    const tw = Math.max(1, Math.round(snap.width * wPct / 100))
    const th = Math.max(1, Math.round(snap.height * hPct / 100))
    setPreviewing(true)
    try {
      let out: ImageData
      if (tw === snap.width && th === snap.height) {
        out = new ImageData(new Uint8ClampedArray(snap.data), snap.width, snap.height)
      } else {
        const res = await seamCarve(snap, {
          targetW: tw,
          targetH: th,
          protect: protectSel ? protectPreviewRef.current : null,
        })
        out = res.imageData
      }
      if (token !== previewToken.current) return // superseded
      drawInto(after, out)
    } finally {
      if (token === previewToken.current) setPreviewing(false)
    }
  }, [wPct, hPct, protectSel, busy, drawInto])

  useEffect(() => {
    const id = setTimeout(() => { void recompute() }, 150)
    return () => clearTimeout(id)
  }, [recompute])

  const onWPct = (v: number) => {
    setWPct(v)
    if (linked) setHPct(v)
  }
  const onHPct = (v: number) => {
    setHPct(v)
    if (linked) setWPct(v)
  }

  // ---- commit: carve the flat composite, open as a new document ----
  const apply = async () => {
    if (!doc || busy || unchanged || tooBig) return
    setBusy(true)
    setProgress(0.01)
    useEditorStore.getState().setProgress({ active: true, label: 'Content-Aware Scale', value: 0 })
    try {
      const flat = getFlatComposite(doc)
      const img = getImageData(flat)
      const protect = protectSel && protectDocRef.current ? protectDocRef.current : null
      const res = await seamCarve(img, {
        targetW,
        targetH,
        protect,
        onProgress: p => {
          setProgress(p)
          useEditorStore.getState().setProgress({ active: true, label: 'Content-Aware Scale', value: p })
          return !abortRef.current // aborted when the dialog closed mid-run
        },
      })
      if (res.aborted) {
        useEditorStore.getState().pushToast('Content-Aware Scale cancelled', 'info')
        return
      }
      const out = createCanvas(res.imageData.width, res.imageData.height)
      putImageData(out, res.imageData)
      engine.addCanvasDocument(out, `${doc.name} · CAS`)
      useEditorStore.getState().pushToast(
        `Content-Aware Scale complete — ${res.imageData.width} × ${res.imageData.height} px`, 'success',
      )
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Content-Aware Scale failed'
      useEditorStore.getState().pushToast(msg, 'error')
    } finally {
      useEditorStore.getState().setProgress(null)
      setProgress(0)
      setBusy(false)
    }
  }

  if (!doc) {
    return (
      <>
        <DialogHeader><DialogTitle>Content-Aware Scale</DialogTitle></DialogHeader>
        <div className="text-xs text-muted-foreground py-4">No active document.</div>
        <DialogFooter><Button variant="secondary" size="sm" onClick={onClose}>Close</Button></DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Maximize2 size={15} className="text-primary" /> Content-Aware Scale</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-1">
        {/* scale sliders */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] flex items-center justify-between">
              <span>Width</span>
              <span className="font-mono text-primary">{wPct}%</span>
            </Label>
            <Slider value={[wPct]} min={50} max={200} step={1} onValueChange={v => onWPct(v[0])} disabled={busy} />
            <div className="text-[10px] font-mono text-muted-foreground">{doc.width} → {targetW} px</div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] flex items-center justify-between">
              <span>Height</span>
              <span className="font-mono text-primary">{hPct}%</span>
            </Label>
            <Slider value={[hPct]} min={50} max={200} step={1} onValueChange={v => onHPct(v[0])} disabled={busy} />
            <div className="text-[10px] font-mono text-muted-foreground">{doc.height} → {targetH} px</div>
          </div>
        </div>

        {/* link + reset */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
            <Checkbox checked={linked} onCheckedChange={v => setLinked(v === true)} disabled={busy} />
            <Link2 size={11} className="text-muted-foreground" />
            Preserve aspect
          </label>
          <button
            type="button"
            className="h-6 px-2 rounded-md border border-border/60 text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"
            onClick={() => { setWPct(100); setHPct(100) }}
            disabled={busy}
          ><RotateCcw size={11} />Reset</button>
          <span className="ml-auto text-[10px] text-muted-foreground">seam carving · 50–200%</span>
        </div>

        {/* protect selection */}
        <label
          className={cn(
            'flex items-start gap-2 rounded border px-2.5 py-2 transition-colors',
            protectSel && hasSelection ? 'border-primary/50 bg-primary/10' : 'border-border',
            !hasSelection && 'opacity-60 cursor-not-allowed',
          )}
        >
          <Checkbox
            checked={protectSel}
            disabled={!hasSelection || busy}
            onCheckedChange={v => setProtectSel(v === true)}
            className="mt-0.5"
          />
          <span className="leading-tight">
            <span className="flex items-center gap-1.5 text-[11px] font-medium">
              <ShieldCheck size={12} className="text-primary" /> Protect selection area
            </span>
            <span className="block text-[10px] text-muted-foreground leading-snug">
              {hasSelection
                ? 'Seams avoid the selected content — it keeps its proportions while the rest rescales.'
                : 'Make a selection first to protect a region.'}
            </span>
          </span>
        </label>

        {/* target size */}
        <div className="flex items-center gap-2 text-[11px] font-mono px-2.5 py-1.5 rounded bg-muted/60 border">
          <span className="text-muted-foreground">{doc.width} × {doc.height}</span>
          <span className="text-primary">→</span>
          <span>{targetW} × {targetH}</span>
          <span className="text-muted-foreground">({megapixels.toFixed(1)} MP)</span>
          {unchanged && <span className="ml-auto text-destructive">target equals source</span>}
          {tooBig && <span className="ml-auto text-destructive">exceeds 40 MP</span>}
        </div>

        {/* preview */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-[11px]">Seam preview — Before / After</Label>
            {previewing && <span className="text-[10px] font-mono text-primary animate-pulse">carving…</span>}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <figure className="space-y-0.5">
              <canvas ref={beforeRef}
                className="w-full rounded border bg-[repeating-conic-gradient(#3a3a3a_0%_25%,#2c2c2c_0%_50%)] [background-size:12px_12px]"
                aria-label="Content-Aware Scale before preview — amber region is protected" />
              <figcaption className="text-[9px] text-muted-foreground text-center">
                Before{protectSel && hasSelection ? ' · protected region' : ''}
              </figcaption>
            </figure>
            <figure className="space-y-0.5">
              <canvas ref={afterRef}
                className="w-full rounded border border-primary/40 bg-[repeating-conic-gradient(#3a3a3a_0%_25%,#2c2c2c_0%_50%)] [background-size:12px_12px]"
                aria-label="Content-Aware Scale after preview" />
              <figcaption className="text-[9px] text-primary text-center">Content-aware</figcaption>
            </figure>
          </div>
        </div>

        {/* note */}
        <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <Info size={11} className="mt-0.5 flex-shrink-0" />
          <span>
            Low-energy seams are inserted or removed so important content keeps its proportions.
            The result opens as a new flattened document — the original stays untouched.
          </span>
        </div>

        {busy && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="text-[10px] font-mono text-primary">Carving seams… {Math.round(progress * 100)}%</div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={busy || unchanged || tooBig}>
          <Sparkles size={13} className="mr-1.5" />
          {busy ? 'Scaling…' : `Scale to ${targetW} × ${targetH}`}
        </Button>
      </DialogFooter>
    </>
  )
}
