'use client'
// Generic schema-driven adjustment + filter dialogs with live preview,
// plus custom controls (curves points editor, gradient stops, kernel grid,
// LUT picker for Color Lookup — Task 9-b)
import { useEffect, useMemo, useRef, useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Upload } from 'lucide-react'
import { ControlRenderer } from '../toolbar/tool-options-bar'
import { engine } from '../../engine/engine'
import * as imageOps from '../../image-ops'
import type { ControlDef, DialogInstance, AdjustmentType, FilterType } from '../../types'
import { useEditorStore } from '../../store'

export interface DialogProps {
  inst: DialogInstance
  onClose(): void
}

export function GenericAdjustmentDialog({ inst, onClose }: DialogProps) {
  const type = inst.type as AdjustmentType
  const mode = inst.props?.mode ?? 'direct'
  const layerId = inst.props?.layerId ?? engine.activeLayer?.id
  const def = imageOps.ADJUSTMENTS[type]
  const [params, setParams] = useState<Record<string, any>>(() => {
    if (mode === 'adjust-layer') {
      const layer = engine.layerById(layerId ?? '')
      if (layer?.adjustment?.type === type) return { ...def?.defaults, ...layer.adjustment.params }
    }
    return { ...def?.defaults, ...inst.props?.params }
  })
  const [preview, setPreview] = useState(true)
  const [applying, setApplying] = useState(false) // heavy op runs off-thread — keep the commit airtight

  // live preview (synchronous, stays on the main thread — preview paths are untouched by the worker offload)
  useEffect(() => {
    if (!def) return
    if (preview) engine.setPreviewAdjustment(type, params)
    else engine.clearPreviewAdjustment()
    return () => engine.clearPreviewAdjustment()
  }, [params, preview, type, def])

  if (!def || !layerId) return null

  const apply = async () => {
    if (applying) return
    setApplying(true)
    engine.clearPreviewAdjustment()
    try {
      if (mode === 'adjust-layer') {
        engine.setLayerAdjustment(layerId, type, params)
      } else if (type === 'color-lookup' && imageOps.getLut(String(params.lutId ?? ''))?.builtin === false) {
        // custom .cube tables exist only in the main-thread LUT registry —
        // the pixel worker would no-op on them, so commit synchronously here
        // (builtin ids bake deterministically in the worker, async is fine)
        engine.applyAdjustmentToLayer(layerId, type, params)
      } else {
        // heavy one-shot op — pixel math off the main thread (worker pool); identical history flow
        await engine.applyAdjustmentToLayerAsync(layerId, type, params)
      }
    } finally {
      onClose()
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{def.label}{mode === 'adjust-layer' ? ' — Adjustment Layer' : ''}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-1">
        {def.controls.map(c => (
          <CustomControl key={c.key} control={c} params={params} setParams={setParams} />
        ))}
        {!def.controls.length && <div className="text-xs text-muted-foreground">This adjustment takes no parameters.</div>}
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground mr-auto cursor-pointer">
          <input type="checkbox" checked={preview} onChange={e => setPreview(e.target.checked)} className="accent-primary" />
          Preview
        </label>
        <Button variant="secondary" size="sm" onClick={() => setParams({ ...def.defaults })} disabled={applying}>Reset</Button>
        <Button variant="secondary" size="sm" onClick={() => { engine.clearPreviewAdjustment(); onClose() }} disabled={applying}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={applying}>{applying ? 'Applying…' : 'OK'}</Button>
      </DialogFooter>
    </>
  )
}

export function GenericFilterDialog({ inst, onClose }: DialogProps) {
  const type = inst.type as FilterType
  const layerId = inst.props?.layerId ?? engine.activeLayer?.id
  const smartFilterId = inst.props?.smartFilterId as string | undefined
  const layer = layerId ? engine.layerById(layerId) : null
  const def = imageOps.FILTERS[type]
  const [params, setParams] = useState<Record<string, any>>(() => {
    if (smartFilterId) {
      const sf = layer?.smartFilters.find(f => f.id === smartFilterId)
      if (sf) return { ...def?.defaults, ...sf.params }
    }
    return { ...def?.defaults, ...inst.props?.params }
  })
  const [preview, setPreview] = useState(true)
  const [applying, setApplying] = useState(false) // heavy op runs off-thread — keep the commit airtight
  const origSmartParams = useRef(smartFilterId ? { ...params } : null)

  useEffect(() => {
    if (!def || !layerId) return
    if (smartFilterId) {
      if (preview) engine.updateSmartFilter(layerId, smartFilterId, params)
    } else if (preview) {
      engine.setPreviewFilter(layerId, type, params)
    }
  }, [params, preview, type, def, layerId, smartFilterId])

  if (!def || !layerId) return null

  const apply = async () => {
    if (applying) return
    setApplying(true)
    try {
      if (smartFilterId) {
        engine.updateSmartFilter(layerId, smartFilterId, params)
        engine.pushHistory(`Smart Filter: ${def.label}`)
      } else {
        engine.clearPreviewFilter()
        // heavy one-shot op — pixel math off the main thread (worker pool); identical history flow
        await engine.applyFilterToLayerAsync(layerId, type, params)
      }
    } finally {
      onClose()
    }
  }
  const cancel = () => {
    if (smartFilterId && origSmartParams.current) {
      engine.updateSmartFilter(layerId, smartFilterId, origSmartParams.current)
    }
    engine.clearPreviewFilter()
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{def.label}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-1">
        {def.controls.map(c => (
          <CustomControl key={c.key} control={c} params={params} setParams={setParams} />
        ))}
        {!def.controls.length && <div className="text-xs text-muted-foreground">No parameters — applies directly.</div>}
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground mr-auto cursor-pointer">
          <input type="checkbox" checked={preview} onChange={e => setPreview(e.target.checked)} className="accent-primary" />
          Preview
        </label>
        <Button variant="secondary" size="sm" onClick={() => setParams({ ...def.defaults })} disabled={applying}>Reset</Button>
        <Button variant="secondary" size="sm" onClick={cancel} disabled={applying}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={applying}>{applying ? 'Applying…' : 'OK'}</Button>
      </DialogFooter>
    </>
  )
}

function CustomControl({ control, params, setParams }: {
  control: ControlDef
  params: Record<string, any>
  setParams: (p: Record<string, any>) => void
}) {
  if (control.type === 'custom') {
    switch (control.customId) {
      case 'curves-points':
        return <CurvesPointsControl control={control} params={params} setParams={setParams} />
      case 'gradient-stops':
        return <GradientStopsControl control={control} params={params} setParams={setParams} />
      case 'kernel-editor':
        return <KernelGridControl control={control} params={params} setParams={setParams} />
      case 'lut':
        return <LutPickerControl control={control} params={params} setParams={setParams} />
      default:
        return null
    }
  }
  return (
    <ControlRenderer
      control={control}
      value={params[control.key]}
      onChange={v => setParams({ ...params, [control.key]: v })}
    />
  )
}

// ---------------- interactive curves editor ----------------
function CurvesPointsControl({ params, setParams }: { control: ControlDef; params: Record<string, any>; setParams: (p: Record<string, any>) => void }) {
  const channel = params.channel ?? 'rgb'
  const key = channel === 'r' ? 'pointsR' : channel === 'g' ? 'pointsG' : channel === 'b' ? 'pointsB' : 'points'
  const points: { x: number; y: number }[] = params[key] ?? [
    { x: 0, y: 0 }, { x: 255, y: 255 },
  ]
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draggingIdx = useRef<number | null>(null)
  const W = 256, H = 256

  const pts = useMemo(() => [...points].sort((a, b) => a.x - b.x), [points])

  const draw = () => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo((i / 4) * W, 0); ctx.lineTo((i / 4) * W, H); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, (i / 4) * H); ctx.lineTo(W, (i / 4) * H); ctx.stroke()
    }
    // diagonal
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke()
    ctx.setLineDash([])
    // curve
    const sorted = pts
    ctx.strokeStyle = channel === 'r' ? '#ef4444' : channel === 'g' ? '#22c55e' : channel === 'b' ? '#3b82f6' : '#e8a33d'
    ctx.lineWidth = 2
    ctx.beginPath()
    const evalY = (x: number) => {
      let j = 0
      while (j < sorted.length - 2 && sorted[j + 1].x < x) j++
      const a = sorted[j], b = sorted[Math.min(j + 1, sorted.length - 1)]
      const t = b.x === a.x ? 0 : Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x)))
      const s = t * t * (3 - 2 * t)
      return a.y + (b.y - a.y) * s
    }
    for (let x = 0; x <= W; x += 2) {
      const y = H - (evalY(x / W * 255) / 255) * H
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.stroke()
    // points
    for (const p of pts) {
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc((p.x / 255) * W, H - (p.y / 255) * H, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }

  useEffect(draw)

  const toPoint = (e: React.PointerEvent) => {
    const c = canvasRef.current!
    const rect = c.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 255
    const y = (1 - (e.clientY - rect.top) / rect.height) * 255
    return { x: Math.round(Math.min(255, Math.max(0, x))), y: Math.round(Math.min(255, Math.max(0, y))) }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground w-14">Channel</span>
        {(['rgb', 'r', 'g', 'b'] as const).map(ch => (
          <button
            key={ch}
            className={cnBasic('px-2 py-0.5 rounded text-[10px]', channel === ch, ch)}
            onClick={() => setParams({ ...params, channel: ch })}
          >{ch.toUpperCase()}</button>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="w-full aspect-square rounded bg-black/60 cursor-crosshair touch-none"
        onPointerDown={e => {
          const p = toPoint(e)
          // find near point
          const idx = pts.findIndex(pt => Math.hypot(pt.x - p.x, pt.y - p.y) < 16)
          if (idx >= 0) draggingIdx.current = idx
          else if (pts.length < 12) {
            const next = [...pts, p].sort((a, b) => a.x - b.x)
            draggingIdx.current = next.findIndex(pt => pt === p)
            setParams({ ...params, [key]: next })
          }
        }}
        onPointerMove={e => {
          if (draggingIdx.current === null) return
          const p = toPoint(e)
          const next = pts.map((pt, i) => i === draggingIdx.current ? p : pt)
          // clamp: x between neighbors
          next.sort((a, b) => a.x - b.x)
          setParams({ ...params, [key]: next })
        }}
        onPointerUp={() => { draggingIdx.current = null }}
        onDoubleClick={e => {
          const p = toPoint(e as unknown as React.PointerEvent)
          if (pts.length > 2) {
            const idx = pts.findIndex(pt => Math.hypot(pt.x - p.x, pt.y - p.y) < 16)
            if (idx > 0 && idx < pts.length - 1) {
              setParams({ ...params, [key]: pts.filter((_, i) => i !== idx) })
            }
          }
        }}
      />
      <div className="text-[10px] text-muted-foreground">
        Click to add points · drag to shape · double-click a point to delete · presets:
        {['Linear', 'S-Curve', 'Fade', 'Punch'].map(preset => (
          <button
            key={preset}
            className="ml-1.5 px-1.5 py-0.5 rounded border hover:bg-accent"
            onClick={() => {
              const presets: Record<string, { x: number; y: number }[]> = {
                Linear: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
                'S-Curve': [{ x: 0, y: 0 }, { x: 64, y: 56 }, { x: 128, y: 128 }, { x: 192, y: 200 }, { x: 255, y: 255 }],
                Fade: [{ x: 0, y: 40 }, { x: 128, y: 128 }, { x: 255, y: 220 }],
                Punch: [{ x: 0, y: 0 }, { x: 96, y: 72 }, { x: 160, y: 190 }, { x: 255, y: 255 }],
              }
              setParams({ ...params, [key]: presets[preset] })
            }}
          >{preset}</button>
        ))}
      </div>
    </div>
  )
}

function cnBasic(base: string, active: boolean, ch: string) {
  const color = ch === 'r' ? 'data-[active]:bg-red-500/30' : ch === 'g' ? 'data-[active]:bg-green-500/30' : ch === 'b' ? 'data-[active]:bg-blue-500/30' : ''
  return `${base} ${active ? (ch === 'r' ? 'bg-red-500/30 text-red-300' : ch === 'g' ? 'bg-green-500/30 text-green-300' : ch === 'b' ? 'bg-blue-500/30 text-blue-300' : 'bg-primary/25 text-primary') : 'bg-muted/40 text-muted-foreground'} ${color}`
}

// ---------------- gradient stops ----------------
function GradientStopsControl({ params, setParams }: { control: ControlDef; params: Record<string, any>; setParams: (p: Record<string, any>) => void }) {
  const stops: { pos: number; color: string }[] = params.stops ?? [
    { pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' },
  ]
  const [sel, setSel] = useState(0)
  const gradCss = `linear-gradient(to right, ${[...stops].sort((a, b) => a.pos - b.pos).map(s => `${s.color} ${(s.pos * 100).toFixed(1)}%`).join(', ')})`
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const posFromEvent = (e: React.PointerEvent) => {
    const el = trackRef.current!
    const rect = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">Gradient Map</div>
      <div
        ref={trackRef}
        className="relative h-7 rounded border cursor-pointer"
        style={{ background: gradCss }}
        onPointerDown={e => {
          const pos = posFromEvent(e)
          if (sel >= 0 && sel < stops.length) {
            const next = stops.map((st, i) => i === sel ? { ...st, pos } : st)
            setParams({ ...params, stops: next })
          }
          dragging.current = true
        }}
        onPointerMove={e => {
          if (!dragging.current) return
          const pos = posFromEvent(e)
          if (sel >= 0 && sel < stops.length) {
            const next = stops.map((st, i) => i === sel ? { ...st, pos } : st)
            setParams({ ...params, stops: next })
          }
        }}
        onPointerUp={() => { dragging.current = false }}
      >
        {[...stops].sort((a, b) => a.pos - b.pos).map((s, i) => (
          <button
            key={i}
            className="absolute -top-1.5 w-3.5 h-6 rounded-sm border-2 shadow"
            style={{ left: `calc(${s.pos * 100}% - 7px)`, borderColor: i === sel ? 'var(--primary)' : '#666', background: s.color }}
            onPointerDown={e => { e.stopPropagation(); setSel(i) }}
            aria-label={`Stop ${i}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={stops[sel]?.color ?? '#ffffff'}
          onChange={e => {
            const next = [...stops]
            next[sel] = { ...next[sel], color: e.target.value }
            setParams({ ...params, stops: next })
          }}
          className="w-8 h-7 rounded border bg-transparent p-0"
          aria-label="Stop color"
        />
        <Button size="sm" variant="secondary" className="h-6 text-[10px]" onClick={() => {
          if (stops.length < 8) setParams({ ...params, stops: [...stops, { pos: 0.5, color: '#e8a33d' }] })
        }}>+ Stop</Button>
        <Button size="sm" variant="secondary" className="h-6 text-[10px]" onClick={() => {
          if (stops.length > 2) setParams({ ...params, stops: stops.filter((_, i) => i !== sel) })
          setSel(0)
        }}>− Stop</Button>
        <span className="text-[10px] text-muted-foreground ml-auto font-mono">{(stops[sel] ? stops[sel].pos * 100 : 0).toFixed(0)}%</span>
      </div>
    </div>
  )
}

// ---------------- LUT picker (color-lookup adjustment) ----------------
// Value contract: the param is ONLY the lutId string — tables live in the
// image-ops LUT registry (module state), never in params, so history
// snapshots stay JSON-serializable.
const LUT_PREVIEW_SAMPLES: [number, number, number][] = [
  [0, 0, 0], [0.33, 0.33, 0.33], [0.66, 0.66, 0.66], [1, 1, 1], [0.91, 0.64, 0.24],
]

function lutChipColors(lutId: string): string[] {
  const lut = imageOps.getLut(lutId)
  if (!lut) return ['#000000', '#2b2b2b', '#575757', '#ffffff', '#e8a33d']
  const out = [0, 0, 0]
  const hex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return LUT_PREVIEW_SAMPLES.map(([r, g, b]) => {
    imageOps.sampleLUT(lut, r, g, b, out)
    return `#${hex(out[0])}${hex(out[1])}${hex(out[2])}`
  })
}

function LutPickerControl({ control, params, setParams }: { control: ControlDef; params: Record<string, any>; setParams: (p: Record<string, any>) => void }) {
  const key = control.key
  const currentId = String(params[key] ?? 'teal-orange')
  const luts = useMemo(() => imageOps.listLuts(), [currentId])
  const chips = useMemo(() => lutChipColors(currentId), [currentId])
  const current = imageOps.getLut(currentId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!f) return
    try {
      const text = await f.text()
      const lut = imageOps.parseCube(text, f.name.replace(/\.cube$/i, ''))
      setLoadError(null)
      setParams({ ...params, [key]: lut.id })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'parse failed'
      setLoadError(msg)
      useEditorStore.getState().pushToast(`Invalid .cube file: ${msg}`, 'error')
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground shrink-0">{control.label}</span>
        <Select value={currentId} onValueChange={v => setParams({ ...params, [key]: v })}>
          <SelectTrigger className="h-6! flex-1 min-w-0 px-1.5 py-0.5 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-50 max-h-72">
            {luts.map(l => (
              <SelectItem key={l.id} value={l.id} className="text-[11px]">
                {l.name}{l.builtin ? '' : ' · custom'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="secondary" size="sm"
          className="h-6 px-2 text-[10px] gap-1 shrink-0"
          onClick={() => fileRef.current?.click()}
          title="Import an Adobe .cube LUT file"
        >
          <Upload size={10} /> .cube
        </Button>
        <input ref={fileRef} type="file" accept=".cube,text/plain" className="hidden" onChange={onFile} aria-label="Load .cube LUT file" />
      </div>
      {/* tone preview: black / 33% / 66% / white / amber pushed through the LUT */}
      <div className="flex gap-0.5 h-5 rounded border overflow-hidden" aria-hidden>
        {chips.map((c, i) => (
          <div key={i} className="flex-1" style={{ background: c }} />
        ))}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="truncate">{current ? current.name : 'unknown LUT id'}</span>
        {current && <span className="ml-auto shrink-0">{current.size}³{current.builtin ? '' : ' · session'}</span>}
        {loadError && <span className="text-destructive truncate">{loadError}</span>}
      </div>
    </div>
  )
}

// ---------------- 5×5 kernel editor ----------------
function KernelGridControl({ params, setParams }: { control: ControlDef; params: Record<string, any>; setParams: (p: Record<string, any>) => void }) {
  const kernel: number[] = params.kernel ?? new Array(25).fill(0)
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">Custom 5×5 Convolution Kernel</div>
      <div className="grid grid-cols-5 gap-1 w-fit">
        {kernel.map((v, i) => (
          <input
            key={i}
            type="number"
            value={v}
            step={0.5}
            onChange={e => {
              const next = [...kernel]
              next[i] = Number(e.target.value) || 0
              setParams({ ...params, kernel: next })
            }}
            className="w-12 h-7 text-[10px] font-mono text-center bg-background border rounded"
            aria-label={`Kernel ${Math.floor(i / 5)},${i % 5}`}
          />
        ))}
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {[
          { label: 'Sharpen', k: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, -4, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] },
          { label: 'Laplace', k: [-1, -1, -1, -1, -1, -1, -1, 8, -1, -1, -1, -1, 8, -1, -1, -1, -1, 8, -1, -1, -1, -1, -1, -1, -1] },
          { label: 'Emboss', k: [-1, -1, 0, -1, 0, -1, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
          { label: 'Blur', k: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(() => 1) },
        ].map(p => (
          <button key={p.label} className="px-2 py-0.5 rounded border text-[10px] hover:bg-accent" onClick={() => setParams({ ...params, kernel: p.k, scale: 25 })}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <ControlRenderer control={{ key: 'scale', label: 'Scale', type: 'number', min: 1, max: 100 }} value={params.scale ?? 1} onChange={v => setParams({ ...params, scale: v })} />
        <ControlRenderer control={{ key: 'offset', label: 'Offset', type: 'number', min: -255, max: 255 }} value={params.offset ?? 0} onChange={v => setParams({ ...params, offset: v })} />
      </div>
    </div>
  )
}
