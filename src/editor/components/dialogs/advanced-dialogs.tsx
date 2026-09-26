'use client'
// ============================================================
// Advanced dialog workspaces — TASK 2-D bespoke implementations
// Color Range · Select & Mask · Content-Aware Fill · Batch / Image
// Processor · Script Console · Shortcuts · About
//
// Conventions: dark graphite + amber accents, text-[11px] density,
// zphoto-scroll scroll areas, live previews own their cleanup
// (debounced effects return clearTimeout; no engine preview
// setters are used — these dialogs render their own canvases).
//
// NOTE (2-e coordination): ShortcutsDialog below is a good baseline
// owned by 2-d; 2-e may refine it after (last writer wins).
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import {
  Pipette, Plus, Minus, X, Trash2, Copy, Play, RotateCcw, Sparkles, Brush,
  Layers, Wand2, Cpu, ShieldCheck, Terminal, Scissors, Sliders, Zap, Heart, Scale,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IMPORT_ACCEPT } from '../../formats'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { getFlatComposite, compositeDocument, invalidateFlat } from '../../engine/document'
import {
  createCanvas, ctx2d, cloneCanvas, getImageData, putImageData,
  fileToCanvas, canvasToBlob, downloadBlob, formatBytes, clamp,
} from '../../utils/canvas'
import { gaussianBlurChannel } from '../../image-ops/core'
import * as imageOps from '../../image-ops'
import type { PsDocument, Rect } from '../../types'
import type { DialogProps } from './generic-dialogs'
import { setScriptHooks } from '../../engine/scripting-api'

// ============================================================
// shared primitives
// ============================================================

type Sample = { x: number; y: number; color: [number, number, number] }

function previewSize(w: number, h: number, maxW: number, maxH: number) {
  const s = Math.min(maxW / w, maxH / h)
  return { w: Math.max(32, Math.round(w * s)), h: Math.max(32, Math.round(h * s)), s }
}

/** extract selection alpha (255 = selected) from the doc's selection mask */
function selectionAlphaOf(doc: PsDocument): Uint8ClampedArray | null {
  if (!doc.selection) return null
  const d = getImageData(doc.selection.mask)
  const out = new Uint8ClampedArray(doc.width * doc.height)
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = d.data[j]
  return out
}

function Segmented<T extends string>({ options, value, onChange, className }: {
  options: { value: T; label: string; disabled?: boolean }[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cn('inline-flex gap-0.5 rounded-md border border-border/60 bg-muted/40 p-0.5', className)}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          className={cn(
            'px-2 h-6 rounded text-[10px] font-medium transition-colors whitespace-nowrap',
            value === o.value ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            o.disabled && 'opacity-40 cursor-not-allowed',
          )}
          onClick={() => onChange(o.value)}
        >{o.label}</button>
      ))}
    </div>
  )
}

function SliderRow({ label, value, min, max, step = 1, unit, disabled, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  disabled?: boolean
  onChange: (v: number) => void
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
    </div>
  )
}

function CheckRow({ label, checked, onChange, hint }: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer py-0.5">
      <Checkbox checked={checked} onCheckedChange={v => onChange(v === true)} className="mt-0.5" />
      <span className="leading-tight">
        <span className="text-[11px] text-foreground/90">{label}</span>
        {hint && <span className="block text-[10px] text-muted-foreground leading-snug">{hint}</span>}
      </span>
    </label>
  )
}

// ============================================================
// Color Range — full Photoshop-style workspace
// ============================================================

const HUE_TARGETS: Record<string, [number, number, number]> = {
  reds: [214, 45, 42],
  yellows: [225, 205, 60],
  greens: [72, 176, 85],
  cyans: [64, 196, 208],
  blues: [62, 88, 224],
  magentas: [214, 62, 214],
}

const CR_RANGES = [
  { value: 'sampled', label: 'Sampled Colors' },
  { value: 'reds', label: 'Reds' },
  { value: 'yellows', label: 'Yellows' },
  { value: 'greens', label: 'Greens' },
  { value: 'cyans', label: 'Cyans' },
  { value: 'blues', label: 'Blues' },
  { value: 'magentas', label: 'Magentas' },
  { value: 'highlights', label: 'Highlights' },
  { value: 'midtones', label: 'Midtones' },
  { value: 'shadows', label: 'Shadows' },
  { value: 'out-of-focus', label: 'Out of Focus' },
]

export function ColorRangeDialog({ onClose }: DialogProps) {
  const store = useEditorStore.getState()
  const [range, setRange] = useState('sampled')
  const [fuzziness, setFuzziness] = useState(40)
  const [tonalRange, setTonalRange] = useState(50)
  const [previewMode, setPreviewMode] = useState<'grayscale' | 'black-matte' | 'image-red'>('image-red')
  const [localize, setLocalize] = useState(false)
  const [invertSel, setInvertSel] = useState(false)
  const [samples, setSamples] = useState<Sample[]>([])
  const [sampleTool, setSampleTool] = useState<'add' | 'sub'>('add')
  const [coverage, setCoverage] = useState(0)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<ImageData | null>(null)
  const maskRef = useRef<Uint8ClampedArray | null>(null)

  const doc = engine.activeDoc
  const isSampled = range === 'sampled'
  const isTonal = range === 'highlights' || range === 'midtones' || range === 'shadows'
  const colorBased = isSampled || !!HUE_TARGETS[range]

  // size the preview canvas + cache the composite pixels once
  useEffect(() => {
    const d = engine.activeDoc
    const c = previewRef.current
    if (!d || !c) return
    const { w, h } = previewSize(d.width, d.height, 560, 340)
    c.width = w
    c.height = h
    imgRef.current = getImageData(getFlatComposite(d))
  }, [])

  const computeMask = (): Uint8ClampedArray | null => {
    const d = engine.activeDoc
    const img = imgRef.current
    if (!d || !img) return null
    const colors: number[][] = isSampled ? samples.map(s => [...s.color]) : HUE_TARGETS[range] ? [HUE_TARGETS[range]] : []
    // params include points + localized flag (consumed by the localization pass below)
    const mask = imageOps.colorRange(img, {
      range,
      fuzziness,
      colors,
      points: samples.map(s => [s.x, s.y]),
      localized: localize,
    })
    // tonal ranges: "Range" widens/narrows the tone ramp (50 = neutral)
    if (isTonal) {
      const k = 0.25 + (tonalRange / 100) * 1.5
      for (let i = 0; i < mask.length; i++) mask[i] = mask[i] * k
    }
    // Localized Color Clusters — sampled colors only match near their sample
    // points, with a smooth distance falloff (radius = 80px)
    if (localize && isSampled && samples.length) {
      const R = 80
      const R2 = R * R
      const fall = new Float32Array(d.width * d.height)
      for (const s of samples) {
        const x0 = Math.max(0, Math.floor(s.x - R)), x1 = Math.min(d.width - 1, Math.ceil(s.x + R))
        const y0 = Math.max(0, Math.floor(s.y - R)), y1 = Math.min(d.height - 1, Math.ceil(s.y + R))
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const dx = x - s.x, dy = y - s.y
            const d2 = dx * dx + dy * dy
            if (d2 >= R2) continue
            const t = 1 - Math.sqrt(d2) / R
            const i = y * d.width + x
            if (t > fall[i]) fall[i] = t
          }
        }
      }
      for (let i = 0; i < mask.length; i++) mask[i] = mask[i] * fall[i]
    }
    if (invertSel) for (let i = 0; i < mask.length; i++) mask[i] = 255 - mask[i]
    return mask
  }

  const renderPreview = () => {
    const d = engine.activeDoc
    const c = previewRef.current
    const img = imgRef.current
    if (!d || !c || !img) return
    const ctx = c.getContext('2d')!
    const mask = maskRef.current
    const out = ctx.createImageData(c.width, c.height)
    const sx = c.width / d.width, sy = c.height / d.height
    const dd = img.data
    let hit = 0
    for (let py = 0; py < c.height; py++) {
      const dyy = Math.min(d.height - 1, Math.round(py / sy))
      for (let px = 0; px < c.width; px++) {
        const dxx = Math.min(d.width - 1, Math.round(px / sx))
        const si = dyy * d.width + dxx
        const m = mask ? mask[si] / 255 : 0
        if (m > 0.5) hit++
        const o = (py * c.width + px) * 4
        if (previewMode === 'grayscale') {
          const v = m * 255
          out.data[o] = v; out.data[o + 1] = v; out.data[o + 2] = v
        } else if (previewMode === 'black-matte') {
          const k = 0.12 + 0.88 * m
          out.data[o] = dd[si * 4] * k
          out.data[o + 1] = dd[si * 4 + 1] * k
          out.data[o + 2] = dd[si * 4 + 2] * k
        } else {
          // image + red overlay over the selected area
          const a = 0.55 * m
          out.data[o] = dd[si * 4] * (1 - a) + 232 * a
          out.data[o + 1] = dd[si * 4 + 1] * (1 - a) + 80 * a
          out.data[o + 2] = dd[si * 4 + 2] * (1 - a) + 61 * a
        }
        out.data[o + 3] = 255
      }
    }
    ctx.putImageData(out, 0, 0)
    setCoverage(Math.round((hit / (c.width * c.height)) * 1000) / 10)
    // sample point markers
    if (samples.length) {
      const k = c.width / d.width
      ctx.lineWidth = 1
      for (const s of samples) {
        const x = s.x * k, y = s.y * k
        if (localize) {
          ctx.save()
          ctx.setLineDash([3, 3])
          ctx.strokeStyle = 'rgba(232,163,61,0.85)'
          ctx.beginPath(); ctx.arc(x, y, 80 * k, 0, Math.PI * 2); ctx.stroke()
          ctx.restore()
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke()
        ctx.fillStyle = `rgb(${s.color[0]},${s.color[1]},${s.color[2]})`
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill()
      }
    }
  }

  // debounced live preview (mask compute can be heavy on large documents)
  useEffect(() => {
    const t = setTimeout(() => {
      maskRef.current = computeMask()
      renderPreview()
    }, 80)
    return () => clearTimeout(t)
  }, [range, fuzziness, tonalRange, localize, invertSel, samples, previewMode])

  const sampleAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const d = engine.activeDoc
    const c = previewRef.current
    const img = imgRef.current
    if (!d || !c || !img) return
    const rect = c.getBoundingClientRect()
    const x = clamp(Math.round(((e.clientX - rect.left) / rect.width) * d.width), 0, d.width - 1)
    const y = clamp(Math.round(((e.clientY - rect.top) / rect.height) * d.height), 0, d.height - 1)
    const i = (y * d.width + x) * 4
    const color: [number, number, number] = [img.data[i], img.data[i + 1], img.data[i + 2]]
    const mode = e.altKey ? 'sub' : e.shiftKey ? 'add' : sampleTool
    if (mode === 'add') {
      setSamples(prev => (prev.length >= 24 ? prev : [...prev, { x, y, color }]))
    } else if (samples.length) {
      let best = -1, bestD = Infinity
      samples.forEach((s, idx) => {
        const dist = Math.hypot(s.color[0] - color[0], s.color[1] - color[1], s.color[2] - color[2])
        if (dist < bestD) { bestD = dist; best = idx }
      })
      if (bestD > 120) store.pushToast('No similar sampled color to subtract', 'info')
      else setSamples(prev => prev.filter((_, idx) => idx !== best))
    }
  }

  const apply = () => {
    const mask = maskRef.current ?? computeMask()
    if (!mask || !engine.activeDoc) return
    engine.setSelectionAlpha(mask, 'new', 'Color Range')
    store.pushToast(samples.length ? `Color Range applied — ${samples.length} sample(s)` : 'Color Range applied', 'success')
    onClose()
  }

  if (!doc) {
    return (
      <>
        <DialogHeader><DialogTitle>Color Range</DialogTitle></DialogHeader>
        <div className="py-6 text-center text-xs text-muted-foreground">Open an image first, then use Select ▸ Color Range.</div>
        <DialogFooter><Button variant="secondary" size="sm" onClick={onClose}>Close</Button></DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader><DialogTitle>Color Range</DialogTitle></DialogHeader>
      <div className="grid gap-3 py-1 sm:grid-cols-[minmax(0,1fr)_212px]">
        <div className="space-y-2">
          <canvas
            ref={previewRef}
            className="w-full rounded-md border bg-black cursor-crosshair"
            onClick={sampleAt}
            aria-label="Color range preview — click to sample colors"
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              className={cn('h-7 px-2 rounded-md border flex items-center gap-1 text-[10px] transition-colors',
                sampleTool === 'add' ? 'bg-primary/20 text-primary border-primary/40' : 'border-border/60 text-muted-foreground hover:text-foreground')}
              onClick={() => setSampleTool('add')}
              title="Sample colors — click the preview to add"
            ><Pipette size={12} /><Plus size={10} />Sample</button>
            <button
              type="button"
              className={cn('h-7 px-2 rounded-md border flex items-center gap-1 text-[10px] transition-colors',
                sampleTool === 'sub' ? 'bg-primary/20 text-primary border-primary/40' : 'border-border/60 text-muted-foreground hover:text-foreground')}
              onClick={() => setSampleTool('sub')}
              title="Subtract sampled color — click the preview to remove"
            ><Pipette size={12} /><Minus size={10} />Subtract</button>
            <span className="ml-auto text-[10px] text-muted-foreground">Click preview to sample · Shift = add · Alt = subtract</span>
          </div>
          {samples.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground">
              <span>Sampled {samples.length}:</span>
              {samples.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  title="Remove this sample"
                  className="w-4 h-4 rounded-sm border border-border/70 hover:ring-1 hover:ring-primary"
                  style={{ background: `rgb(${s.color[0]},${s.color[1]},${s.color[2]})` }}
                  onClick={() => setSamples(prev => prev.filter((_, j) => j !== i))}
                />
              ))}
              <button type="button" className="ml-1 underline hover:text-foreground" onClick={() => setSamples([])}>clear</button>
            </div>
          )}
        </div>
        <div className="space-y-2.5">
          <div className="space-y-1">
            <Label className="text-[11px]">Select</Label>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50">
                {CR_RANGES.map(r => <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <SliderRow label="Fuzziness" value={fuzziness} min={0} max={200} onChange={setFuzziness} disabled={!colorBased} />
          <SliderRow label="Range" value={tonalRange} min={0} max={100} unit="%" onChange={setTonalRange} disabled={!isTonal} />
          <CheckRow label="Localized Color Clusters" checked={localize} onChange={setLocalize}
            hint="Match only within 80px of each sample point" />
          <CheckRow label="Invert" checked={invertSel} onChange={setInvertSel} />
          <div className="space-y-1 pt-1 border-t border-border/60">
            <Label className="text-[11px]">Selection Preview</Label>
            <Select value={previewMode} onValueChange={v => setPreviewMode(v as typeof previewMode)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="grayscale" className="text-xs">Grayscale</SelectItem>
                <SelectItem value="black-matte" className="text-xs">Black Matte</SelectItem>
                <SelectItem value="image-red" className="text-xs">Image + Red Overlay</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">Coverage ≈ {coverage}%</div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            {isSampled
              ? 'Eyedropper: click the preview to sample colors; each sample widens the matched set.'
              : isTonal
                ? 'Range widens or narrows the tonal ramp; Fuzziness applies to color-based ranges.'
                : 'Named hues match around the canonical hue center; use Fuzziness to widen.'}
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={apply}>Apply to Selection</Button>
      </DialogFooter>
    </>
  )
}

// ============================================================
// Select & Mask — real refinement workspace
// ============================================================

type SmView = 'onion' | 'black' | 'white' | 'mask' | 'overlay'
type SmBrushMode = 'refine' | 'add' | 'subtract'

function smPaintDab(
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  size: number,
  hardness: number,
  opacity: number,
  mode: SmBrushMode,
  refineTarget?: Uint8ClampedArray | null,
) {
  const r = Math.max(.5, size / 2)
  const inner = clamp(hardness / 100, 0, .999)
  const strength = clamp(opacity / 100, .01, 1)
  const x0 = Math.max(0, Math.floor(cx - r - 1))
  const y0 = Math.max(0, Math.floor(cy - r - 1))
  const x1 = Math.min(w - 1, Math.ceil(cx + r + 1))
  const y1 = Math.min(h - 1, Math.ceil(cy + r + 1))

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + .5 - cx, y + .5 - cy) / r
      if (d > 1) continue
      const edge = d <= inner ? 1 : 1 - (d - inner) / Math.max(.001, 1 - inner)
      const a = clamp(edge * strength, 0, 1)
      const i = y * w + x
      const old = alpha[i]
      if (mode === 'add') {
        alpha[i] = Math.round(old + (255 - old) * a)
      } else if (mode === 'subtract') {
        alpha[i] = Math.round(old * (1 - a))
      } else if (refineTarget) {
        alpha[i] = Math.round(old + (refineTarget[i] - old) * a)
      }
    }
  }
}

export function SelectMaskDialog({ onClose }: DialogProps) {
  const store = useEditorStore.getState()
  const hasSelection = useEditorStore(s => s.hasSelection)
  const [radius, setRadius] = useState(3)
  const [contrast, setContrast] = useState(20)
  const [feather, setFeather] = useState(2)
  const [shiftEdge, setShiftEdge] = useState(0)
  const [smooth, setSmooth] = useState(0)
  const [decontaminate, setDecontaminate] = useState(0)
  const [output, setOutput] = useState<'selection' | 'mask' | 'new-layer'>('selection')
  const [view, setView] = useState<SmView>('onion')
  const [onionOpacity, setOnionOpacity] = useState(65)
  const [brushMode, setBrushMode] = useState<SmBrushMode>('refine')
  const [brushSize, setBrushSize] = useState(42)
  const [brushHardness, setBrushHardness] = useState(35)
  const [brushOpacity, setBrushOpacity] = useState(100)
  const [realTime, setRealTime] = useState(true)
  const [paintVersion, setPaintVersion] = useState(0)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const manualAlphaRef = useRef<Uint8ClampedArray | null>(null)
  const initialAlphaRef = useRef<Uint8ClampedArray | null>(null)
  const flatPreviewRef = useRef<ImageData | null>(null)
  const paintRef = useRef<null | {
    pointerId: number
    lastX: number
    lastY: number
    mode: SmBrushMode
    refineTarget: Uint8ClampedArray | null
  }>(null)

  // Initialize a private working selection. The document selection is never
  // mutated while the workspace is open, so Cancel is a true cancel.
  useEffect(() => {
    const d = engine.activeDoc
    const canvas = previewRef.current
    if (!d || !canvas || !d.selection) return
    const { w, h } = previewSize(d.width, d.height, 560, 330)
    canvas.width = w
    canvas.height = h

    const alpha = selectionAlphaOf(d)
    if (!alpha) return
    manualAlphaRef.current = new Uint8ClampedArray(alpha)
    initialAlphaRef.current = new Uint8ClampedArray(alpha)

    // Cache a preview-sized composite once. Slider/brush updates then only
    // refine a small preview mask instead of repeatedly reading/compositing
    // the full document.
    const flat = getFlatComposite(d)
    const mini = createCanvas(w, h)
    const mc = ctx2d(mini)
    mc.imageSmoothingEnabled = true
    mc.imageSmoothingQuality = 'high'
    mc.drawImage(flat, 0, 0, w, h)
    flatPreviewRef.current = getImageData(mini)
    setPaintVersion(v => v + 1)
  }, [])

  // Live preview uses a downsampled copy of the working alpha. Final Apply is
  // still full-resolution through engine.refineSelectionToMask().
  useEffect(() => {
    const t = setTimeout(() => {
      const d = engine.activeDoc
      const canvas = previewRef.current
      const base = manualAlphaRef.current
      const flat = flatPreviewRef.current
      if (!d || !canvas || !base || !flat) return

      const pw = canvas.width, ph = canvas.height
      const small = new Uint8ClampedArray(pw * ph)
      for (let py = 0; py < ph; py++) {
        const sy = Math.min(d.height - 1, Math.floor((py + .5) * d.height / ph))
        for (let px = 0; px < pw; px++) {
          const sx = Math.min(d.width - 1, Math.floor((px + .5) * d.width / pw))
          small[py * pw + px] = base[sy * d.width + sx]
        }
      }

      const scale = Math.min(pw / d.width, ph / d.height)
      const refined = imageOps.refineMask(small, pw, ph, {
        radius: radius * scale,
        contrast,
        feather: feather * scale,
        shiftEdge,
        smooth: smooth * scale,
      })
      const ctx = canvas.getContext('2d')!
      const out = ctx.createImageData(pw, ph)
      const op = onionOpacity / 100
      const dd = flat.data

      for (let i = 0; i < refined.length; i++) {
        const m = refined[i] / 255
        const o = i * 4
        const r = dd[o], g = dd[o + 1], b = dd[o + 2]
        if (view === 'onion') {
          const a = m * op
          const k = (1 - a) * .35 + a
          out.data[o] = r * k; out.data[o + 1] = g * k; out.data[o + 2] = b * k
        } else if (view === 'black') {
          out.data[o] = r * m; out.data[o + 1] = g * m; out.data[o + 2] = b * m
        } else if (view === 'white') {
          out.data[o] = r * m + 255 * (1 - m)
          out.data[o + 1] = g * m + 255 * (1 - m)
          out.data[o + 2] = b * m + 255 * (1 - m)
        } else if (view === 'mask') {
          const v = m * 255
          out.data[o] = v; out.data[o + 1] = v; out.data[o + 2] = v
        } else {
          const a = .55 * (1 - m)
          out.data[o] = r * (1 - a) + 214 * a
          out.data[o + 1] = g * (1 - a) + 72 * a
          out.data[o + 2] = b * (1 - a) + 56 * a
        }
        out.data[o + 3] = 255
      }
      ctx.putImageData(out, 0, 0)
    }, realTime ? 24 : 90)
    return () => clearTimeout(t)
  }, [paintVersion, radius, contrast, feather, shiftEdge, smooth, view, onionOpacity, realTime])

  const pointerDoc = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = engine.activeDoc!
    const canvas = previewRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * d.width, 0, Math.max(0, d.width - .001)),
      y: clamp(((e.clientY - rect.top) / rect.height) * d.height, 0, Math.max(0, d.height - .001)),
    }
  }

  const applyBrushPoint = (
    x: number,
    y: number,
    mode: SmBrushMode,
    target: Uint8ClampedArray | null,
  ) => {
    const d = engine.activeDoc
    const alpha = manualAlphaRef.current
    if (!d || !alpha) return
    smPaintDab(alpha, d.width, d.height, x, y, brushSize, brushHardness, brushOpacity, mode, target)
  }

  const onPaintDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = engine.activeDoc
    const alpha = manualAlphaRef.current
    if (!d || !alpha || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pointerDoc(e)
    const mode: SmBrushMode = e.altKey ? 'subtract' : e.shiftKey ? 'add' : brushMode
    // Refine Edge computes one high-quality target at stroke start, then the
    // brush locally blends toward it. This avoids recomputing refinement for
    // every pointermove while preserving the familiar paint-to-refine workflow.
    const refineTarget = mode === 'refine'
      ? imageOps.refineMask(new Uint8ClampedArray(alpha), d.width, d.height, {
          radius: Math.max(1, radius),
          contrast,
          feather,
          shiftEdge,
          smooth: Math.max(1, smooth),
        })
      : null
    paintRef.current = { pointerId: e.pointerId, lastX: p.x, lastY: p.y, mode, refineTarget }
    applyBrushPoint(p.x, p.y, mode, refineTarget)
    if (realTime) setPaintVersion(v => v + 1)
  }

  const onPaintMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = paintRef.current
    if (!st || st.pointerId !== e.pointerId) return
    const p = pointerDoc(e)
    const dx = p.x - st.lastX, dy = p.y - st.lastY
    const dist = Math.hypot(dx, dy)
    const spacing = Math.max(1, brushSize * .14)
    const ideal = Math.max(1, Math.ceil(dist / spacing))
    const steps = Math.min(96, ideal)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      applyBrushPoint(st.lastX + dx * t, st.lastY + dy * t, st.mode, st.refineTarget)
    }
    st.lastX = p.x
    st.lastY = p.y
    if (realTime) setPaintVersion(v => v + 1)
  }

  const finishPaint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = paintRef.current
    if (!st || st.pointerId !== e.pointerId) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* capture already lost */ }
    paintRef.current = null
    setPaintVersion(v => v + 1)
  }

  const resetBrushEdits = () => {
    const initial = initialAlphaRef.current
    if (!initial) return
    manualAlphaRef.current = new Uint8ClampedArray(initial)
    paintRef.current = null
    setPaintVersion(v => v + 1)
  }

  if (!hasSelection) {
    return (
      <>
        <DialogHeader><DialogTitle>Select and Mask</DialogTitle></DialogHeader>
        <div className="py-6 text-xs text-muted-foreground text-center">
          Make a selection first (marquee, lasso, Selection Brush, wand, Select Subject…), then open Select and Mask.
        </div>
        <DialogFooter><Button variant="secondary" size="sm" onClick={onClose}>Close</Button></DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader><DialogTitle>Select and Mask</DialogTitle></DialogHeader>
      <div className="grid gap-3 py-1 sm:grid-cols-[minmax(0,1fr)_215px]">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Segmented<SmView>
              value={view}
              onChange={setView}
              options={[
                { value: 'onion', label: 'Onion Skin' },
                { value: 'black', label: 'On Black' },
                { value: 'white', label: 'On White' },
                { value: 'mask', label: 'B&W Mask' },
                { value: 'overlay', label: 'Overlay' },
              ]}
            />
            {view === 'onion' && (
              <div className="flex items-center gap-1.5 ml-auto w-28">
                <span className="text-[10px] text-muted-foreground">Opacity</span>
                <Slider value={[onionOpacity]} min={10} max={100} step={5} onValueChange={v => setOnionOpacity(v[0])} className="flex-1" />
                <span className="text-[10px] font-mono text-primary tabular-nums">{onionOpacity}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Segmented<SmBrushMode>
              value={brushMode}
              onChange={setBrushMode}
              options={[
                { value: 'refine', label: 'Refine Edge' },
                { value: 'add', label: 'Add' },
                { value: 'subtract', label: 'Subtract' },
              ]}
            />
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] ml-auto" onClick={resetBrushEdits}>
              <RotateCcw size={11} className="mr-1" /> Reset Brush
            </Button>
          </div>

          <canvas
            ref={previewRef}
            className="w-full rounded-md border bg-black cursor-crosshair touch-none"
            aria-label="Interactive Select and Mask preview"
            onPointerDown={onPaintDown}
            onPointerMove={onPaintMove}
            onPointerUp={finishPaint}
            onPointerCancel={finishPaint}
          />

          <div className="grid grid-cols-3 gap-2">
            <SliderRow label="Brush Size" value={brushSize} min={2} max={500} step={1} unit=" px" onChange={setBrushSize} />
            <SliderRow label="Hardness" value={brushHardness} min={0} max={100} unit="%" onChange={setBrushHardness} />
            <SliderRow label="Opacity" value={brushOpacity} min={1} max={100} unit="%" onChange={setBrushOpacity} />
          </div>
          <CheckRow
            label="Real-time refinement"
            checked={realTime}
            onChange={setRealTime}
            hint="Update the preview while painting; turn off for very large documents and it refreshes on stroke release."
          />
          <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground leading-snug">
            <Brush size={12} className="text-primary shrink-0 mt-0.5" />
            <span>
              Paint directly on the preview. Refine Edge blends the shared edge-refinement result only through the brushed zone;
              Add/Subtract edits selection alpha. Hold Shift to add or Alt/Option to subtract temporarily. Cancel leaves the document selection untouched.
            </span>
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Edge Detection</div>
          <SliderRow label="Radius" value={radius} min={0} max={50} step={0.5} onChange={setRadius} />
          <SliderRow label="Contrast" value={contrast} min={0} max={100} onChange={setContrast} />
          <div className="pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Adjust Edge</div>
          <SliderRow label="Feather" value={feather} min={0} max={100} step={0.5} onChange={setFeather} />
          <SliderRow label="Smooth" value={smooth} min={0} max={20} onChange={setSmooth} />
          <SliderRow label="Shift Edge" value={shiftEdge} min={-100} max={100} onChange={setShiftEdge} />
          <div className="pt-1.5 border-t border-border/60 space-y-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Output Settings</div>
            <div className="space-y-1">
              <Label className="text-[11px]">Output To</Label>
              <Select value={output} onValueChange={v => setOutput(v as typeof output)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="z-50">
                  <SelectItem value="selection" className="text-xs">Selection</SelectItem>
                  <SelectItem value="mask" className="text-xs">Layer Mask</SelectItem>
                  <SelectItem value="new-layer" className="text-xs">New Layer with Decontamination</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <SliderRow label="Decontaminate Colors" value={decontaminate} min={0} max={100} unit="%"
              onChange={setDecontaminate} disabled={output !== 'new-layer'} />
            <p className="text-[10px] text-muted-foreground leading-snug">
              Decontaminate removes edge color spill from the background — available when output is a new layer.
            </p>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={() => {
          const source = manualAlphaRef.current
          if (!source) return
          engine.refineSelectionToMask(
            { radius, contrast, feather, shiftEdge, smooth, decontaminate },
            output,
            source,
          )
          store.pushToast(
            output === 'selection' ? 'Selection refined'
              : output === 'mask' ? 'Refined layer mask applied'
                : 'Decontaminated copy created on a new layer',
            'success',
          )
          onClose()
        }}>Apply</Button>
      </DialogFooter>
    </>
  )
}

// ============================================================
// Content-Aware Fill — sampling-area workspace
// ============================================================

type CafDragMode = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'new'

const MIN_RECT = 12 // smallest sampling-area rect (doc pixels)

function cafHandlePts(w: number, h: number): [number, number][] {
  return [
    [0, 0], [w / 2, 0], [w, 0],
    [0, h / 2], [w, h / 2],
    [0, h], [w / 2, h], [w, h],
  ]
}

function cafHitTest(px: number, py: number, b: Rect, s: number): CafDragMode {
  const rx = b.x * s, ry = b.y * s, rw = b.w * s, rh = b.h * s
  const T = 8
  const nearL = Math.abs(px - rx) <= T, nearR = Math.abs(px - (rx + rw)) <= T
  const nearT = Math.abs(py - ry) <= T, nearB = Math.abs(py - (ry + rh)) <= T
  const insideX = px > rx + T && px < rx + rw - T
  const insideY = py > ry + T && py < ry + rh - T
  if (nearT && nearL) return 'nw'
  if (nearT && nearR) return 'ne'
  if (nearB && nearL) return 'sw'
  if (nearB && nearR) return 'se'
  if (nearT && insideX) return 'n'
  if (nearB && insideX) return 's'
  if (nearL && insideY) return 'w'
  if (nearR && insideY) return 'e'
  if (px > rx && px < rx + rw && py > ry && py < ry + rh) return 'move'
  return 'new'
}

function rotateImageCW(img: ImageData): ImageData {
  const { width: w, height: h, data } = img
  const out = new ImageData(h, w)
  const d = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4
      const di = (x * h + (h - 1 - y)) * 4
      d[di] = data[si]; d[di + 1] = data[si + 1]; d[di + 2] = data[si + 2]; d[di + 3] = data[si + 3]
    }
  }
  return out
}

function rotateImageCCW(img: ImageData): ImageData {
  const { width: w, height: h, data } = img
  const out = new ImageData(h, w)
  const d = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4
      const di = ((w - 1 - x) * h + y) * 4
      d[di] = data[si]; d[di + 1] = data[si + 1]; d[di + 2] = data[si + 2]; d[di + 3] = data[si + 3]
    }
  }
  return out
}

function rotateMaskCW(mask: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = mask[y * w + x]
  }
  return out
}

/** Color Adaptation: re-tint synthesized pixels toward the local surrounding color mean */
function applyColorAdaptation(img: ImageData, mask: Uint8ClampedArray, amount: number) {
  if (amount <= 0) return
  const { width: w, height: h, data } = img
  const sc = Math.min(1, 320 / Math.max(w, h))
  const sw = Math.max(2, Math.round(w * sc)), sh = Math.max(2, Math.round(h * sc))
  const known = new Float32Array(sw * sh)
  const num: Float32Array[] = [new Float32Array(sw * sh), new Float32Array(sw * sh), new Float32Array(sw * sh)]
  for (let y = 0; y < sh; y++) {
    const dy = Math.min(h - 1, Math.round(y / sc))
    for (let x = 0; x < sw; x++) {
      const dx = Math.min(w - 1, Math.round(x / sc))
      const di = dy * w + dx
      const k = 1 - mask[di] / 255
      const si = y * sw + x
      known[si] = k
      num[0][si] = data[di * 4] * k
      num[1][si] = data[di * 4 + 1] * k
      num[2][si] = data[di * 4 + 2] * k
    }
  }
  const r = Math.max(3, Math.round(10 * sc))
  const den = gaussianBlurChannel(known, sw, sh, r)
  const avg = num.map(c => gaussianBlurChannel(c, sw, sh, r))
  const k = amount / 100
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.round(y * sc))
    for (let x = 0; x < w; x++) {
      const di = y * w + x
      const m = mask[di] / 255
      if (m <= 0.04) continue
      const si = sy * sw + Math.min(sw - 1, Math.round(x * sc))
      const denV = Math.max(0.02, den[si])
      const a = m * k
      const o = di * 4
      for (let c = 0; c < 3; c++) {
        const mean = avg[c][si] / denV
        data[o + c] = data[o + c] * (1 - a) + mean * a
      }
    }
  }
}

export function ContentAwareFillDialog({ onClose }: DialogProps) {
  const store = useEditorStore.getState()
  const hasSelection = useEditorStore(s => s.hasSelection)
  const [running, setRunning] = useState(false)
  const [prog, setProg] = useState(0)
  const [colorAdapt, setColorAdapt] = useState(0)
  const [rotationAdapt, setRotationAdapt] = useState(false)
  const [compare, setCompare] = useState<'before' | 'after'>('before')
  const [done, setDone] = useState(false)
  const [bounds, setBounds] = useState<Rect | null>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const beforeRef = useRef<HTMLCanvasElement | null>(null)
  const afterRef = useRef<HTMLCanvasElement | null>(null)
  const selAlphaRef = useRef<Uint8ClampedArray | null>(null)
  const scaleRef = useRef(1)
  const dragRef = useRef<null | { mode: CafDragMode; orig: Rect; sx: number; sy: number; docX: number; docY: number }>(null)

  // init: canvas size, before-snapshot, selection alpha, whole-image sampling area
  useEffect(() => {
    const d = engine.activeDoc
    const c = previewRef.current
    if (!d || !c) return
    const s = Math.min(2, 560 / d.width, 320 / d.height)
    scaleRef.current = s
    c.width = Math.max(1, Math.round(d.width * s))
    c.height = Math.max(1, Math.round(d.height * s))
    beforeRef.current = cloneCanvas(getFlatComposite(d))
    selAlphaRef.current = selectionAlphaOf(d)
    setBounds({ x: 0, y: 0, w: d.width, h: d.height })
  }, [])

  const draw = useCallback(() => {
    const d = engine.activeDoc
    const c = previewRef.current
    if (!d || !c) return
    const ctx = c.getContext('2d')!
    const src = compare === 'after' && afterRef.current ? afterRef.current : (beforeRef.current ?? getFlatComposite(d))
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(src, 0, 0, c.width, c.height)
    const s = scaleRef.current
    // amber highlight of the fill region (actual selection mask, before mode)
    const sel = selAlphaRef.current
    if (compare === 'before' && sel) {
      const ov = ctx.createImageData(c.width, c.height)
      for (let py = 0; py < c.height; py++) {
        const dyy = Math.min(d.height - 1, Math.round(py / s))
        for (let px = 0; px < c.width; px++) {
          const dxx = Math.min(d.width - 1, Math.round(px / s))
          const m = sel[dyy * d.width + dxx] / 255
          if (m <= 0.02) continue
          const o = (py * c.width + px) * 4
          ov.data[o] = 232; ov.data[o + 1] = 163; ov.data[o + 2] = 61
          ov.data[o + 3] = Math.round(160 * m)
        }
      }
      const tmp = createCanvas(c.width, c.height)
      ctx2d(tmp).putImageData(ov, 0, 0)
      ctx.drawImage(tmp, 0, 0)
    }
    // sampling-area rectangle (dashed, draggable)
    const b = bounds
    if (b) {
      const rx = b.x * s, ry = b.y * s, rw = b.w * s, rh = b.h * s
      ctx.save()
      // dim outside the sampling area
      ctx.fillStyle = 'rgba(0,0,0,0.42)'
      ctx.beginPath()
      ctx.rect(0, 0, c.width, c.height)
      ctx.rect(rx, ry, rw, rh)
      ctx.fill('evenodd')
      ctx.strokeStyle = '#e8a33d'
      ctx.lineWidth = 1.5
      ctx.setLineDash([7, 4])
      ctx.strokeRect(rx, ry, rw, rh)
      ctx.setLineDash([])
      ctx.fillStyle = '#e8a33d'
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.lineWidth = 1
      for (const [hx, hy] of cafHandlePts(rw, rh)) {
        ctx.fillRect(rx + hx - 4, ry + hy - 4, 8, 8)
        ctx.strokeRect(rx + hx - 4, ry + hy - 4, 8, 8)
      }
      ctx.font = '10px ui-monospace, SFMono-Regular, monospace'
      ctx.fillStyle = 'rgba(232,163,61,0.95)'
      const label = `Sampling area ${Math.round(b.w)} × ${Math.round(b.h)}`
      const ly = ry < 16 ? ry + rh + 12 : ry - 5
      ctx.fillText(label, Math.max(4, rx), Math.max(12, ly))
      ctx.restore()
    }
  }, [bounds, compare])

  useEffect(() => { draw() }, [draw])

  const canvasPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = previewRef.current!
    const rect = c.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (c.width / rect.width),
      y: (e.clientY - rect.top) * (c.height / rect.height),
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = engine.activeDoc
    const b = bounds
    if (!d || !b || running) return
    const c = previewRef.current!
    c.setPointerCapture(e.pointerId)
    const { x, y } = canvasPos(e)
    const mode = cafHitTest(x, y, b, scaleRef.current)
    dragRef.current = {
      mode,
      orig: { ...b },
      sx: x, sy: y,
      docX: x / scaleRef.current, docY: y / scaleRef.current,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = engine.activeDoc
    const c = previewRef.current
    const b = bounds
    if (!d || !c || !b) return
    const { x, y } = canvasPos(e)
    const dr = dragRef.current
    if (!dr) {
      const mode = cafHitTest(x, y, b, scaleRef.current)
      c.style.cursor = mode === 'new' ? 'crosshair'
        : mode === 'move' ? 'move'
          : mode === 'nw' || mode === 'se' ? 'nwse-resize'
            : mode === 'ne' || mode === 'sw' ? 'nesw-resize'
              : mode === 'n' || mode === 's' ? 'ns-resize' : 'ew-resize'
      return
    }
    const ddx = (x - dr.sx) / scaleRef.current
    const ddy = (y - dr.sy) / scaleRef.current
    const MIN = 12
    let nb: Rect
    if (dr.mode === 'new') {
      const x2 = dr.docX + ddx, y2 = dr.docY + ddy
      nb = { x: Math.min(dr.docX, x2), y: Math.min(dr.docY, y2), w: Math.abs(x2 - dr.docX), h: Math.abs(y2 - dr.docY) }
    } else if (dr.mode === 'move') {
      nb = {
        x: clamp(dr.orig.x + ddx, 0, d.width - dr.orig.w),
        y: clamp(dr.orig.y + ddy, 0, d.height - dr.orig.h),
        w: dr.orig.w, h: dr.orig.h,
      }
    } else {
      let x1 = dr.orig.x, y1 = dr.orig.y
      let x2 = dr.orig.x + dr.orig.w, y2 = dr.orig.y + dr.orig.h
      if (dr.mode.includes('w')) x1 = clamp(dr.orig.x + ddx, 0, x2 - MIN)
      if (dr.mode.includes('e')) x2 = clamp(dr.orig.x + dr.orig.w + ddx, x1 + MIN, d.width)
      if (dr.mode.startsWith('n')) y1 = clamp(dr.orig.y + ddy, 0, y2 - MIN)
      if (dr.mode.startsWith('s')) y2 = clamp(dr.orig.y + dr.orig.h + ddy, y1 + MIN, d.height)
      nb = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
    }
    setBounds(nb)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const dr = dragRef.current
    if (!dr) return
    try { previewRef.current?.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
    dragRef.current = null
    // a degenerate drag-outside gesture reverts to the previous area
    if (dr.mode === 'new') {
      setBounds(prev => (prev && prev.w < MIN_RECT && prev.h < MIN_RECT ? dr.orig : prev))
    }
  }

  const run = async () => {
    const doc = engine.activeDoc
    const layer = engine.activeLayer
    if (!doc || !layer || !doc.selection || running) return
    const b = bounds ?? { x: 0, y: 0, w: doc.width, h: doc.height }
    setRunning(true)
    setProg(0)
    try {
      const l = engine.mutateLayerPixels(layer.id)
      if (!l?.canvas) throw new Error('Active layer has no pixels to fill')
      // the fill math below is doc-space (selection/mask indexing) — bake any
      // offset registration first so the layer canvas is doc-sized
      if (l.offsetX || l.offsetY) engine.bakeRasterLayer(layer.id)
      const selAlpha = selectionAlphaOf(doc)!
      const img = getImageData(l.canvas)
      // fill mask = selection ∩ layer alpha ∩ sampling area
      // (imageOps.inpaint takes no opts param — the rect is folded into the mask,
      // reproducing engine.contentAwareFill with bounds support)
      const bx = Math.max(0, Math.floor(b.x))
      const by = Math.max(0, Math.floor(b.y))
      const bw = Math.min(doc.width, Math.ceil(b.x + b.w)) - bx
      const bh = Math.min(doc.height, Math.ceil(b.y + b.h)) - by
      const combined = new Uint8ClampedArray(selAlpha.length)
      let any = 0
      for (let y = 0; y < doc.height; y++) {
        const inY = y >= by && y < by + bh
        for (let x = 0; x < doc.width; x++) {
          const i = y * doc.width + x
          const inRect = inY && x >= bx && x < bx + bw
          combined[i] = inRect ? Math.min(selAlpha[i], img.data[i * 4 + 3]) : 0
          if (combined[i] > 8) any++
        }
      }
      if (!any) throw new Error('Sampling area does not intersect the selection')
      // snapshot for the rotation-adaptation ensemble
      const origData = rotationAdapt ? new Uint8ClampedArray(img.data) : null
      await imageOps.inpaint(img, combined, p => setProg(p * (rotationAdapt ? 0.5 : 1)))
      if (origData) {
        // Rotation Adaptation: average a second pass solved in a rotated frame
        // (rotation-diverse donors → smoother synthesized gradients)
        const origImg = new ImageData(origData, doc.width, doc.height)
        const rotImg = rotateImageCW(origImg)
        const rotMask = rotateMaskCW(combined, doc.width, doc.height)
        await imageOps.inpaint(rotImg, rotMask, p => setProg(0.5 + p * 0.5))
        const back = rotateImageCCW(rotImg)
        const d = img.data, bd = back.data
        for (let i = 0; i < combined.length; i++) {
          if (combined[i] < 8) continue
          const o = i * 4
          d[o] = (d[o] + bd[o]) * 0.5
          d[o + 1] = (d[o + 1] + bd[o + 1]) * 0.5
          d[o + 2] = (d[o + 2] + bd[o + 2]) * 0.5
        }
      }
      applyColorAdaptation(img, combined, colorAdapt)
      putImageData(l.canvas, img)
      invalidateFlat(doc)
      engine.pushHistory('Content-Aware Fill')
      engine.emit()
      afterRef.current = cloneCanvas(getFlatComposite(doc))
      setDone(true)
      setCompare('after')
      store.pushToast('Content-Aware Fill complete', 'success')
    } catch (err: any) {
      store.pushToast(err?.message ?? 'Content-Aware Fill failed', 'error')
    } finally {
      setRunning(false)
      setProg(0)
    }
  }

  if (!hasSelection) {
    return (
      <>
        <DialogHeader><DialogTitle>Content-Aware Fill</DialogTitle></DialogHeader>
        <div className="py-6 text-xs text-muted-foreground text-center">
          Make a selection of the area to remove first.
        </div>
        <DialogFooter><Button variant="secondary" size="sm" onClick={onClose}>Close</Button></DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader><DialogTitle>Content-Aware Fill</DialogTitle></DialogHeader>
      <div className="grid gap-3 py-1 sm:grid-cols-[minmax(0,1fr)_205px]">
        <div className="space-y-2">
          <canvas
            ref={previewRef}
            className="w-full rounded-md border bg-black touch-none cursor-crosshair"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label="Content-Aware Fill preview — amber region will be synthesized, dashed rectangle restricts sampling"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Segmented<'before' | 'after'>
              value={compare}
              onChange={setCompare}
              options={[
                { value: 'before', label: 'Before' },
                { value: 'after', label: 'After', disabled: !done },
              ]}
            />
            <button
              type="button"
              className="h-6 px-2 rounded-md border border-border/60 text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
              onClick={() => {
                const d = engine.activeDoc
                if (d) setBounds({ x: 0, y: 0, w: d.width, h: d.height })
              }}
            ><RotateCcw size={11} />Whole image</button>
            <span className="ml-auto text-[10px] text-muted-foreground">Drag inside to move · handles resize · drag outside to redraw</span>
          </div>
          {running && (
            <div className="space-y-1">
              <Progress value={Math.round(prog * 100)} className="h-1.5" />
              <div className="text-[10px] font-mono text-primary">
                {rotationAdapt ? 'Synthesizing (rotation ensemble)…' : 'Synthesizing…'} {Math.round(prog * 100)}%
              </div>
            </div>
          )}
        </div>
        <div className="space-y-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Fill Settings</div>
          <SliderRow label="Color Adaptation" value={colorAdapt} min={0} max={100} unit="%" onChange={setColorAdapt} />
          <p className="text-[10px] text-muted-foreground leading-snug">Blends the local surrounding color into the synthesized pixels.</p>
          <CheckRow label="Rotation Adaptation" checked={rotationAdapt} onChange={setRotationAdapt}
            hint="Averages a second solve in a rotated frame — 2× time, smoother gradients" />
          <div className="pt-1.5 border-t border-border/60 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Sampling Area</div>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Only the selection inside the dashed rectangle is synthesized — tighten it around the
              good donor texture.
            </p>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Multi-scale pyramid diffusion, computed locally — no cloud, no upload.
            </p>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>{done ? 'Close' : 'Cancel'}</Button>
        <Button size="sm" disabled={running} onClick={run} className="gap-1">
          <Sparkles size={12} />
          {running ? 'Filling…' : done ? 'Fill Again' : 'Generate Fill'}
        </Button>
      </DialogFooter>
    </>
  )
}

// ============================================================
// Batch / Image Processor
// ============================================================

type BatchLine = { ok: boolean; line: string }

export function BatchDialog({ onClose }: DialogProps) {
  const actions = useEditorStore(s => s.actions)
  const store = useEditorStore.getState()
  const [files, setFiles] = useState<File[]>([])
  const [actionId, setActionId] = useState('none')
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp'>('jpeg')
  const [quality, setQuality] = useState(90)
  const [scale, setScale] = useState(100)
  const [prefix, setPrefix] = useState('')
  const [resizeFit, setResizeFit] = useState(false)
  const [fitW, setFitW] = useState(2048)
  const [fitH, setFitH] = useState(2048)
  const [running, setRunning] = useState(false)
  const [idx, setIdx] = useState(0)
  const [current, setCurrent] = useState('')
  const [log, setLog] = useState<BatchLine[]>([])
  const [totalBytes, setTotalBytes] = useState(0)

  const addFiles = (list: File[]) => {
    if (!list.length) return
    setFiles(prev => {
      const seen = new Set(prev.map(f => `${f.name}:${f.size}`))
      return [...prev, ...list.filter(f => !seen.has(`${f.name}:${f.size}`))]
    })
  }

  const run = async () => {
    if (!files.length || running) return
    const prevActiveId = engine.activeDoc?.id ?? null
    const t0 = performance.now()
    setRunning(true)
    setLog([])
    setTotalBytes(0)
    let okCount = 0
    let bytes = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setIdx(i + 1)
      setCurrent(`Processing ${file.name} (${i + 1}/${files.length})…`)
      await new Promise(r => setTimeout(r, 30)) // let the UI update
      try {
        const canvas = await fileToCanvas(file)
        const base = file.name.replace(/\.[^.]+$/, '')
        const doc = engine.addCanvasDocument(canvas, base)
        const action = actions.find(a => a.id === actionId)
        if (action) engine.playAction(action, doc)
        if (resizeFit && fitW > 0 && fitH > 0 && (doc.width > fitW || doc.height > fitH)) {
          const s = Math.min(fitW / doc.width, fitH / doc.height)
          engine.resizeImage({ w: Math.max(1, Math.round(doc.width * s)), h: Math.max(1, Math.round(doc.height * s)) })
        }
        // export — mirrors engine.exportActive, done locally so the result size
        // can be reported in the log (single encode)
        const flat = compositeDocument(doc)
        let out = flat
        const sc = scale / 100
        if (sc !== 1) {
          out = createCanvas(Math.max(1, Math.round(doc.width * sc)), Math.max(1, Math.round(doc.height * sc)))
          const c = ctx2d(out)
          c.imageSmoothingQuality = 'high'
          c.drawImage(flat, 0, 0, out.width, out.height)
        }
        const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
        const blob = await canvasToBlob(out, mime, format === 'png' ? undefined : quality / 100)
        const fileName = `${prefix}${doc.name}.${format}`
        downloadBlob(blob, fileName)
        engine.closeDocument(doc.id)
        bytes += blob.size
        setTotalBytes(bytes)
        okCount++
        setLog(prev => [...prev, { ok: true, line: `✓ ${file.name} → ${fileName} (${formatBytes(blob.size)})` }])
      } catch (err: any) {
        setLog(prev => [...prev, { ok: false, line: `✗ ${file.name}: ${err?.message ?? 'failed'}` }])
      }
    }
    if (prevActiveId && engine.docs.find(d => d.id === prevActiveId)) engine.setActiveDocument(prevActiveId)
    const secs = ((performance.now() - t0) / 1000).toFixed(1)
    setLog(prev => [...prev, { ok: okCount === files.length, line: `— batch finished in ${secs}s · ${okCount}/${files.length} exported · ${formatBytes(bytes)} total` }])
    setCurrent('')
    setRunning(false)
    store.pushToast(`Batch processed ${okCount}/${files.length} file(s)`, okCount === files.length ? 'success' : 'info')
  }

  return (
    <>
      <DialogHeader><DialogTitle>Batch / Image Processor</DialogTitle></DialogHeader>
      <div className="space-y-3 py-1">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Label className="text-[11px]">Source Files ({files.length})</Label>
            <label className="ml-auto cursor-pointer">
              <input
                type="file"
                accept={IMPORT_ACCEPT}
                multiple
                className="hidden"
                onChange={e => {
                  addFiles(Array.from(e.target.files ?? []))
                  e.target.value = ''
                }}
              />
              <span className="inline-flex h-6 items-center px-2 rounded-md border border-border/60 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/40">+ Add files…</span>
            </label>
          </div>
          {files.length > 0 && (
            <div className="max-h-24 overflow-y-auto text-[10px] text-muted-foreground zphoto-scroll border rounded-md bg-muted/10 divide-y divide-border/40">
              {files.map((f, i) => (
                <div key={`${f.name}:${f.size}`} className="flex items-center gap-2 px-2 py-1">
                  <span className="truncate flex-1">{f.name}</span>
                  <span className="font-mono text-muted-foreground/70 shrink-0">{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-red-400 shrink-0"
                    disabled={running}
                    title="Remove file"
                    onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                  ><X size={11} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Play Action (optional)</Label>
          <Select value={actionId} onValueChange={setActionId}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="z-50">
              <SelectItem value="none" className="text-xs">None — convert only</SelectItem>
              {actions.map(a => <SelectItem key={a.id} value={a.id} className="text-xs">{a.name} ({a.steps.length} steps)</SelectItem>)}
            </SelectContent>
          </Select>
          {actions.length === 0 && (
            <p className="text-[10px] text-muted-foreground">No actions recorded yet — record one in the Actions panel to reuse it here.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <Label className="text-[11px]">Export Format</Label>
            <Select value={format} onValueChange={v => setFormat(v as typeof format)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="z-50">
                <SelectItem value="jpeg" className="text-xs">JPEG</SelectItem>
                <SelectItem value="png" className="text-xs">PNG</SelectItem>
                <SelectItem value="webp" className="text-xs">WebP</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Output Prefix</Label>
            <Input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="processed-" className="h-7 text-xs font-mono" />
          </div>
          <div className="col-span-2">
            {format === 'jpeg' || format === 'webp' ? (
              <SliderRow label="Quality" value={quality} min={10} max={100} unit="%" onChange={setQuality} />
            ) : (
              <SliderRow label="Export Scale" value={scale} min={10} max={200} unit="%" step={5} onChange={setScale} />
            )}
          </div>
          {(format === 'jpeg' || format === 'webp') && (
            <div className="col-span-2">
              <SliderRow label="Export Scale" value={scale} min={10} max={200} unit="%" step={5} onChange={setScale} />
            </div>
          )}
        </div>
        <div className="space-y-1.5 border-t border-border/60 pt-2.5">
          <CheckRow label="Resize to fit" checked={resizeFit} onChange={setResizeFit}
            hint="Shrink oversized images to fit the max bounds before export (preserves aspect ratio)" />
          {resizeFit && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Max Width (px)</Label>
                <Input type="number" min={16} max={16384} value={fitW} onChange={e => setFitW(Number(e.target.value) || 0)} className="h-7 text-xs font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Max Height (px)</Label>
                <Input type="number" min={16} max={16384} value={fitH} onChange={e => setFitH(Number(e.target.value) || 0)} className="h-7 text-xs font-mono" />
              </div>
            </div>
          )}
        </div>
        {(running || current) && (
          <div className="space-y-1">
            <Progress value={files.length ? Math.round((idx / files.length) * 100) : 0} className="h-1.5" />
            <div className="text-[10px] font-mono text-primary">{current} {idx}/{files.length}</div>
          </div>
        )}
        {log.length > 0 && (
          <div className="max-h-28 overflow-y-auto zphoto-scroll rounded-md border bg-black/60 p-2 font-mono text-[10px] leading-4 space-y-0.5">
            {log.map((l, i) => (
              <div key={i} className={l.ok ? 'text-green-300/80' : 'text-red-400'}>{l.line}</div>
            ))}
            {totalBytes > 0 && <div className="text-muted-foreground">total exported: {formatBytes(totalBytes)}</div>}
          </div>
        )}
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        {files.length > 0 && !running && (
          <Button variant="secondary" size="sm" className="mr-auto" onClick={() => { setFiles([]); setLog([]) }}>Clear List</Button>
        )}
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        <Button size="sm" disabled={!files.length || running} onClick={run} className="gap-1">
          <Play size={12} />
          {running ? 'Processing…' : `Process ${files.length || ''} File${files.length === 1 ? '' : 's'}`}
        </Button>
      </DialogFooter>
    </>
  )
}

// ============================================================
// Script Console — pro scripting environment
// ============================================================

type ConEntry = { time: string; msg: string; kind: 'run' | 'ok' | 'err' | 'log' }

const SCRIPT_SNIPPETS: { label: string; code: string }[] = [
  {
    label: 'B&W all layers',
    code: `// B&W conversion over all layers (adjustment layer on top)
const doc = app.activeDocument
doc.applyAdjustment('black-white', { red: 34, green: 56, blue: 10 })
ps.log('B&W applied over ' + doc.layers.length + ' layers')`,
  },
  {
    label: 'Sharpen + vignette',
    code: `// Unsharp mask + dark matte vignette
const doc = app.activeDocument
doc.applyFilter('smart-sharpen', { amount: 140, radius: 1.6, threshold: 2 })
const v = doc.activeLayer.duplicate()
v.setName('Vignette')
v.setBlendMode('multiply')
v.setOpacity(40)
ps.log('Sharpened + vignette layer at 40% multiply')`,
  },
  {
    label: 'Resize 2048 + export PNG',
    code: `// Fit long edge to 2048px, then export a PNG
const doc = app.activeDocument
const s = Math.min(1, 2048 / Math.max(doc.width, doc.height))
doc.resize(Math.round(doc.width * s), Math.round(doc.height * s))
ps.log('Resized to ' + doc.width + 'x' + doc.height)
await doc.export({ format: 'png', fileName: doc.name + '-2048' })
ps.log('Exported PNG')`,
  },
]

export function ScriptConsoleDialog({ onClose }: DialogProps) {
  const [code, setCode] = useState(`// Chay's Photo scripting — a pragmatic Photoshop-style object model
// app.activeDocument, doc.layers, doc.applyFilter/applyAdjustment, ps.log…
const doc = app.activeDocument
if (doc) {
  ps.log('Document: ' + doc.name + ' — ' + doc.width + 'x' + doc.height)
  ps.log('Layers: ' + doc.layers.map(l => l.name).join(', '))
  // doc.applyFilter('gaussian-blur', { radius: 6 })
  // doc.applyAdjustment('vibrance', { vibrance: 40 })
  // doc.selection.selectAll()
  // doc.flatten()
} else {
  ps.log('No document open')
}`)
  const [entries, setEntries] = useState<ConEntry[]>([])
  const codeRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const push = (msg: string, kind: ConEntry['kind'] = 'log') => {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false })
    setEntries(prev => [...prev, { time, msg, kind }])
  }

  // wire ps.log → console output; auto-log document info on open (deferred to a task
  // so we never call setState synchronously inside the effect body)
  useEffect(() => {
    setScriptHooks({ log: (msg: string) => push(msg) })
    const intro = setTimeout(() => {
      const doc = engine.activeDoc
      if (doc) {
        push(`document "${doc.name}" — ${doc.width}×${doc.height}px · ${doc.layers.length} layer(s) · active: ${engine.activeLayer?.name ?? 'none'}`)
      } else {
        push('no document open — use File ▸ Open first', 'err')
      }
    }, 0)
    return () => {
      clearTimeout(intro)
      setScriptHooks({ log: () => { /* console closed */ } })
    }
  }, [])

  // keep the console pinned to the latest line
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [entries])

  const run = async () => {
    push('▶ run', 'run')
    try {
      const api = engine.scriptApi
      // AsyncFunction so snippets may use top-level await
      const AsyncCtor = Object.getPrototypeOf(async function () { }).constructor as new (...args: string[]) => (...fnArgs: unknown[]) => Promise<unknown>
      const fn = new AsyncCtor('app', 'ps', code)
      await fn(api.app, api)
      push('✓ done', 'ok')
    } catch (err: any) {
      push(`✗ ${err?.message ?? err}`, 'err')
    }
  }

  const copyOutput = async () => {
    const text = entries.map(en => `[${en.time}] ${en.msg}`).join('\n')
    if (!text) { useEditorStore.getState().pushToast('Console output is empty', 'info'); return }
    try {
      await navigator.clipboard.writeText(text)
      useEditorStore.getState().pushToast('Console output copied', 'success')
    } catch {
      useEditorStore.getState().pushToast('Clipboard unavailable', 'error')
    }
  }

  const lines = code.split('\n').length

  return (
    <>
      <DialogHeader><DialogTitle>Scripting Console</DialogTitle></DialogHeader>
      <div className="space-y-2 py-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Terminal size={11} className="text-primary" />
          <span className="text-[10px] text-muted-foreground mr-1">Snippets:</span>
          {SCRIPT_SNIPPETS.map(s => (
            <button
              key={s.label}
              type="button"
              onClick={() => setCode(s.code)}
              className="px-2 h-6 rounded-md border border-border/60 bg-muted/30 text-[10px] text-foreground/85 hover:bg-primary/15 hover:text-primary hover:border-primary/40 transition-colors"
            >{s.label}</button>
          ))}
        </div>
        <div className="flex rounded-md border bg-background/70 overflow-hidden focus-within:ring-1 focus-within:ring-primary/50 h-60">
          <div
            ref={gutterRef}
            className="w-9 shrink-0 overflow-hidden border-r bg-muted/25 select-none py-2 pr-1 text-right font-mono text-[11px] leading-5 text-muted-foreground/70"
            aria-hidden
          >
            {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
          </div>
          <textarea
            ref={codeRef}
            value={code}
            onChange={e => setCode(e.target.value)}
            onScroll={e => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop }}
            onKeyDown={e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() }
            }}
            spellCheck={false}
            wrap="off"
            className="flex-1 resize-none bg-transparent py-2 px-2 font-mono text-[11px] leading-5 text-foreground/90 focus:outline-none"
            aria-label="Script code — Ctrl+Enter to run"
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{lines} lines · {code.length} chars</span>
          <span>Ctrl+Enter runs · ps.log() prints below</span>
        </div>
        <div
          ref={logRef}
          className="h-28 rounded-md border bg-black/70 p-2 overflow-y-auto zphoto-scroll font-mono text-[10px] leading-4"
          aria-label="Console output"
        >
          {entries.length === 0 ? (
            <div className="text-muted-foreground/60">{'// output — ps.log(...) prints here'}</div>
          ) : entries.map((en, i) => (
            <div
              key={i}
              className={cn(
                'whitespace-pre-wrap break-all',
                en.kind === 'err' ? 'text-red-400'
                  : en.kind === 'ok' ? 'text-primary'
                    : en.kind === 'run' ? 'text-primary/60' : 'text-green-300/80',
              )}
            >
              <span className="text-muted-foreground/50 mr-1.5">[{en.time}]</span>{en.msg}
            </div>
          ))}
        </div>
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="secondary" size="sm" onClick={() => setEntries([])} className="gap-1"><Trash2 size={12} />Clear</Button>
        <Button variant="secondary" size="sm" onClick={copyOutput} className="gap-1"><Copy size={12} />Copy Output</Button>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        <Button size="sm" onClick={run} className="gap-1"><Play size={12} />Run Script</Button>
      </DialogFooter>
    </>
  )
}

// ============================================================
// About
// ============================================================

const ABOUT_FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Layers, title: 'Layers & Masks', desc: 'Unlimited layers, layer masks, clipping stacks, 17 blend modes, Blend-If' },
  { icon: Sliders, title: 'Adjustments', desc: 'Curves, Levels, HSL, Selective Color, Camera Raw — non-destructive adjustment layers' },
  { icon: Wand2, title: 'Smart Objects', desc: 'Non-destructive transforms and re-editable smart filters' },
  { icon: Scissors, title: 'Pro Selections', desc: 'Select Subject, Color Range, Focus Area, Select & Mask edge refinement' },
  { icon: Brush, title: 'Retouch Suite', desc: 'Healing brush, spot heal, patch, clone stamp, local Content-Aware Fill' },
  { icon: Zap, title: 'Automation', desc: 'Actions recorder, batch image processor, keyboard-driven workflow' },
  { icon: Terminal, title: 'Scriptable', desc: 'Photoshop-style scripting console — automate your whole pipeline' },
  { icon: Cpu, title: 'On-Device Engine', desc: 'Every pixel is processed locally in your browser' },
]

export function AboutDialog({ onClose }: DialogProps) {
  return (
    <>
      <DialogHeader><DialogTitle>About Chay's Photo Studio</DialogTitle></DialogHeader>
      <div className="py-2 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            <Wand2 size={20} className="text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              Chay's Photo Studio
              <span className="ml-2 text-[10px] font-mono text-primary align-middle">v1.0 · Web Edition</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              A Photoshop-class raster image editor that runs entirely in your browser.
            </p>
            <p className="text-[10px] text-muted-foreground/80">© Chaython Meredith 2026 · All rights reserved.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ABOUT_FEATURES.map(f => (
            <div key={f.title} className="flex gap-2 rounded-md border border-border/60 bg-muted/10 p-2">
              <f.icon size={14} className="text-primary shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-foreground/90">{f.title}</div>
                <div className="text-[10px] text-muted-foreground leading-snug">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-2">
          <ShieldCheck size={14} className="text-primary shrink-0" />
          <p className="text-[10px] text-primary/90 leading-snug">
            Runs 100% on-device — no uploads, no accounts, no cloud. Your images never leave this tab.
          </p>
        </div>
        <div className="rounded-md border border-border/60 bg-muted/10 px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/90">
              <Scale size={12} className="text-primary" />
              License
            </div>
            <a
              href="https://github.com/sponsors/Chaython"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md bg-primary/15 border border-primary/40 text-primary text-[10px] font-medium hover:bg-primary/25 active:scale-95 transition-all"
              title="Support Chay's Photo Studio on GitHub Sponsors"
            >
              <Heart size={11} />
              Donate
            </a>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            <span className="text-foreground/85 font-medium">Free for consumer use</span> — individuals, students,
            hobbyists and non-commercial projects may use Chay's Photo Studio at no cost.
            <span className="text-foreground/85 font-medium"> Commercial use requires a license</span> — companies
            and commercial products must contact{' '}
            <a href="mailto:chaython@live.ca" className="text-primary hover:underline font-mono">chaython@live.ca</a>{' '}
            to license before deployment.
            <span className="text-foreground/85 font-medium"> The LICENSE file must always be included</span> with
            any distribution. Provided as-is — no warranty; the author holds no liability for malfunctions or data
            loss. Donations keep the studio free for everyone:{' '}
            <a
              href="https://github.com/sponsors/Chaython"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-mono"
            >
              github.com/sponsors/Chaython
            </a>
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => window.open('https://github.com/sponsors/Chaython', '_blank', 'noopener')}
        >
          <Heart size={12} className="text-primary" />
          Donate
        </Button>
        <Button size="sm" onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  )
}
