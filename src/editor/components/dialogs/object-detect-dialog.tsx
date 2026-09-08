'use client'
// ============================================================
// Detect Objects (AI) dialog — cloud vision bounding boxes over a
// downscaled composite of the active document. Each detected box can
// be turned into a rectangular selection or lifted into its own layer
// ("Layer via Copy" from the composite — dialogs stays open so several
// objects can be picked). Server-side only: the pixels travel as a
// ≤800px JPEG data-URL to /api/object-detect; the raw image never
// leaves the browser except as that compressed preview.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, ScanSearch, RefreshCw, Check, CopyPlus, Boxes, Layers } from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { getFlatComposite } from '../../engine/document'
import { createCanvas, ctx2d } from '../../utils/canvas'
import type { DialogProps } from './generic-dialogs'
import { cn } from '@/lib/utils'

const MAX_DIM = 800 // analysis-side long edge
const AMBER = '#e8a33d'
const HOVER_TINT = 'rgba(232,163,61,0.15)'
const CHECKER = 'bg-[repeating-conic-gradient(#3a3a3a_0%_25%,#2c2c2c_0%_50%)] [background-size:12px_12px]'

interface DetectedObject {
  label: string
  x: number
  y: number
  w: number
  h: number
}

export function ObjectDetectDialog({ onClose }: DialogProps) {
  const doc = engine.activeDoc
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [objects, setObjects] = useState<DetectedObject[] | null>(null) // null = not run yet
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [layered, setLayered] = useState<number[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runToken = useRef(0)
  const inFlight = useRef(false)

  // ---- detection pipeline: composite → ≤800px → JPEG data-URL → POST ----
  const detect = useCallback(async () => {
    const d = engine.activeDoc
    if (!d || inFlight.current) return
    inFlight.current = true
    const token = ++runToken.current
    setBusy(true)
    setError(null)
    setObjects(null)
    setHover(null)
    setPicked([])
    setLayered([])
    try {
      const flat = getFlatComposite(d)
      const scale = Math.min(1, MAX_DIM / Math.max(d.width, d.height))
      const pw = Math.max(1, Math.round(d.width * scale))
      const ph = Math.max(1, Math.round(d.height * scale))
      const small = createCanvas(pw, ph)
      const c = ctx2d(small)
      c.imageSmoothingQuality = 'high'
      c.drawImage(flat, 0, 0, pw, ph)
      const image = small.toDataURL('image/jpeg', 0.88)
      if (token !== runToken.current) return
      setPreview(small)

      const res = await fetch('/api/object-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      })
      let json: any = null
      try { json = await res.json() } catch { /* non-JSON error body */ }
      if (token !== runToken.current) return
      if (!res.ok || !json || !Array.isArray(json.objects)) {
        throw new Error(
          (json && typeof json.error === 'string' && json.error) ||
            `Detection failed (HTTP ${res.status})`,
        )
      }
      setObjects(json.objects as DetectedObject[])
    } catch (e) {
      if (token !== runToken.current) return
      setError(e instanceof Error ? e.message : 'Detection failed')
    } finally {
      if (token === runToken.current) setBusy(false)
      inFlight.current = false
    }
  }, [])

  // run once on mount when a document is active
  useEffect(() => {
    if (engine.activeDoc) void detect()
  }, [detect])

  // ---- preview rendering: composite + amber boxes + label chips ----
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !preview) return
    if (canvas.width !== preview.width) canvas.width = preview.width
    if (canvas.height !== preview.height) canvas.height = preview.height
    const c = ctx2d(canvas)
    c.clearRect(0, 0, canvas.width, canvas.height)
    c.drawImage(preview, 0, 0)
    if (!objects?.length) return
    const W = canvas.width
    const H = canvas.height
    objects.forEach((o, i) => {
      const x = o.x * W
      const y = o.y * H
      const w = o.w * W
      const h = o.h * H
      const hot = i === hover
      if (hot) {
        c.fillStyle = HOVER_TINT
        c.fillRect(x, y, w, h)
      }
      // dark outline halo for contrast, then the amber 2px border
      c.lineWidth = 3.5
      c.strokeStyle = 'rgba(15,15,17,0.85)'
      c.strokeRect(x, y, w, h)
      c.lineWidth = hot ? 2.5 : 2
      c.strokeStyle = hot ? '#ffffff' : AMBER
      c.strokeRect(x, y, w, h)

      // label chip — small dark pill, amber text (guides.ts badge style)
      const label = o.label.length > 24 ? `${o.label.slice(0, 23)}…` : o.label
      c.font = '10px ui-monospace, SFMono-Regular, monospace'
      const tw = c.measureText(label).width
      let bx = x
      let by = y - 18
      if (by < 0) by = Math.min(y + 2, H - 16)
      if (bx + tw + 10 > W) bx = Math.max(0, W - tw - 10)
      c.fillStyle = 'rgba(15,15,17,0.82)'
      c.strokeStyle = hot ? 'rgba(255,255,255,0.75)' : 'rgba(232,163,61,0.55)'
      c.lineWidth = 1
      c.beginPath()
      c.roundRect(bx, by, tw + 10, 16, 3)
      c.fill()
      c.stroke()
      c.fillStyle = hot ? '#ffffff' : '#f4c47c'
      c.textBaseline = 'middle'
      c.fillText(label, bx + 5, by + 8)
    })
  }, [preview, objects, hover])

  // ---- normalized-coord hit-test on the preview canvas ----
  const hitTest = (e: React.MouseEvent<HTMLCanvasElement>): number | null => {
    const canvas = canvasRef.current
    if (!canvas || !objects?.length) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i]
      if (nx >= o.x && nx <= o.x + o.w && ny >= o.y && ny <= o.y + o.h) return i
    }
    return null
  }

  // ---- turn a box into a real selection (dialog stays open) ----
  const select = (i: number) => {
    const d = engine.activeDoc
    if (!d || !objects) return
    const o = objects[i]
    engine.selectShape(
      { x: o.x * d.width, y: o.y * d.height, w: o.w * d.width, h: o.h * d.height },
      'rect',
      0,
      'new',
    )
    setPicked(p => (p.includes(i) ? p : [...p, i]))
    useEditorStore.getState().pushToast(`Selected “${o.label}”`, 'success')
  }

  // ---- turn a box into its own layer (Layer via Copy from composite) ----
  const makeLayer = (i: number, quiet = false): boolean => {
    const d = engine.activeDoc
    if (!d || !objects) return false
    const o = objects[i]
    const layer = engine.addObjectLayer(
      { x: o.x * d.width, y: o.y * d.height, w: o.w * d.width, h: o.h * d.height },
      o.label,
    )
    if (!layer) return false
    setLayered(p => (p.includes(i) ? p : [...p, i]))
    if (!quiet) useEditorStore.getState().pushToast(`Layer “${layer.name}” created`, 'success')
    return true
  }

  // ---- lift every not-yet-layered object in one go ----
  const makeAllLayers = () => {
    if (!objects?.length) return
    let made = 0
    objects.forEach((_, i) => {
      if (!layered.includes(i) && makeLayer(i, true)) made++
    })
    useEditorStore.getState().pushToast(
      made === 1 ? 'Created 1 object layer' : `Created ${made} object layers`,
      made ? 'success' : 'info',
    )
  }

  // ---- guards ----
  if (!doc) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanSearch size={15} className="text-primary" /> Detect Objects (AI)
          </DialogTitle>
        </DialogHeader>
        <div className="py-4 text-xs text-muted-foreground">
          Open a document first — object detection needs an active image.
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </>
    )
  }

  const count = objects?.length ?? 0

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ScanSearch size={15} className="text-primary" /> Detect Objects (AI)
        </DialogTitle>
        <p className="-mt-1 text-[10px] text-muted-foreground">Cloud vision · Z.AI</p>
      </DialogHeader>

      <div className="space-y-3 py-1">
        {/* busy */}
        {busy && (
          <div className="flex items-center justify-center gap-2 rounded border border-border bg-muted/40 px-3 py-8 text-[11px] text-muted-foreground">
            <Loader2 size={14} className="animate-spin text-primary" />
            Analyzing image…
          </div>
        )}

        {/* error */}
        {error && !busy && (
          <div className="space-y-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2.5">
            <div className="text-[11px] leading-relaxed text-destructive">{error}</div>
            <Button size="sm" variant="secondary" className="h-7 text-[11px]" onClick={() => void detect()}>
              <RefreshCw size={12} className="mr-1.5" /> Retry
            </Button>
          </div>
        )}

        {/* empty result */}
        {!busy && !error && objects && count === 0 && (
          <div className="rounded border border-border bg-muted/40 px-3 py-8 text-center text-[11px] text-muted-foreground">
            No objects detected — try a photo with clear subjects.
          </div>
        )}

        {/* preview with boxes */}
        {preview && !busy && !error && (
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground">
              Hover to highlight · click a box to select · Shift-click to make it a layer
            </div>
            <canvas
              ref={canvasRef}
              className={cn('w-full rounded border border-border', CHECKER, objects?.length ? 'cursor-pointer' : '')}
              onMouseMove={e => setHover(hitTest(e))}
              onMouseLeave={() => setHover(null)}
              onClick={e => { if (hover !== null) { if (e.shiftKey) makeLayer(hover); else select(hover) } }}
              aria-label="Detected objects preview"
            />
          </div>
        )}

        {/* object list */}
        {objects && count > 0 && !busy && !error && (
          <div className="max-h-64 overflow-y-auto zphoto-scroll rounded border border-border divide-y divide-border">
            {objects.map((o, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 text-[11px] transition-colors',
                  i === hover ? 'bg-primary/10' : 'hover:bg-accent/50',
                )}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(h => (h === i ? null : h))}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                    picked.includes(i) || layered.includes(i) ? 'bg-primary' : 'bg-border',
                  )}
                  title={picked.includes(i) ? 'Selected' : layered.includes(i) ? 'Lifted to a layer' : 'Not picked yet'}
                />
                <span className="flex-1 truncate flex items-center gap-1" title={o.label}>
                  <Boxes size={11} className="flex-shrink-0 text-muted-foreground/70" aria-hidden />
                  <span className="truncate">{o.label}</span>
                  {layered.includes(i) && (
                    <Layers size={11} className="flex-shrink-0 text-primary" aria-label="Lifted to a layer" />
                  )}
                </span>
                <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground">
                  {Math.round(o.w * doc.width)}×{Math.round(o.h * doc.height)} px
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-6 flex-shrink-0 px-2 text-[10px]"
                  onClick={() => select(i)}
                  title="Turn this box into a rectangular selection"
                >
                  {picked.includes(i) && <Check size={11} className="mr-1" />}
                  Select
                </Button>
                <Button
                  size="sm"
                  className="h-6 flex-shrink-0 px-2 text-[10px]"
                  onClick={() => makeLayer(i)}
                  disabled={layered.includes(i)}
                  title="Lift this object into its own layer (Layer via Copy)"
                >
                  {layered.includes(i) ? <Check size={11} className="mr-1" /> : <CopyPlus size={11} className="mr-1" />}
                  Layer
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <DialogFooter className="sm:justify-between">
        <span className="text-[10px] text-muted-foreground">
          {busy ? 'Detecting…' : `Detected ${count} object${count === 1 ? '' : 's'}`}
        </span>
        <div className="flex items-center gap-2">
          {!busy && !error && count > 0 && (
            <Button
              size="sm"
              className="text-[11px]"
              onClick={makeAllLayers}
              disabled={!objects?.some((_, i) => !layered.includes(i))}
              title="Create one layer per detected object (copies the composite region)"
            >
              <Layers size={12} className="mr-1.5" />
              Make All Layers
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Close</Button>
        </div>
      </DialogFooter>
    </>
  )
}
