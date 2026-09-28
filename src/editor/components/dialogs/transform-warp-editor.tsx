'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { engine } from '../../engine/engine'
import type { TransformWarpSpec } from '../../types'
import { createCanvas, ctx2d, clamp } from '../../utils/canvas'
import {
  cloneWarpMesh, presetWarpMesh, regularWarpMesh, removeWarpSplit,
  resampleWarpMesh, splitWarpMesh, validateWarpMesh, warpCanvasToMesh,
  type WarpPreset,
} from '../../image-ops/transform'

type GuideMode = 'auto' | 'always' | 'never'

function resetWarpPoints(mesh: TransformWarpSpec): TransformWarpSpec {
  const m = validateWarpMesh(mesh) ?? regularWarpMesh(3, 3)
  return {
    u: [...m.u],
    v: [...m.v],
    points: m.v.flatMap(y => m.u.map(x => ({ x, y }))),
  }
}

function controlPointSource(mesh: TransformWarpSpec, index: number) {
  const cols = mesh.u.length
  const row = Math.floor(index / cols)
  const col = index % cols
  return { x: mesh.u[col], y: mesh.v[row] }
}

function previewSource(layerId: string): HTMLCanvasElement | null {
  const layer = engine.layerById(layerId)
  const doc = engine.activeDoc
  if (!layer || !doc) return null
  let raw: HTMLCanvasElement | null = null
  if (layer.kind === 'smart' && layer.source) raw = layer.source
  else if (layer.kind === 'raster' && layer.canvas) raw = layer.canvas
  else {
    const full = engine.layerCanvasDocSpace(layerId)
    const r = engine.layerContentRect(layerId)
    if (full && r) {
      raw = createCanvas(Math.max(1, Math.ceil(r.w)), Math.max(1, Math.ceil(r.h)))
      ctx2d(raw).drawImage(full, -r.x, -r.y)
    }
  }
  if (!raw) return null
  const maxDim = 480
  const s = Math.min(1, maxDim / Math.max(raw.width, raw.height))
  if (s >= .999) return raw
  const out = createCanvas(Math.max(1, Math.round(raw.width * s)), Math.max(1, Math.round(raw.height * s)))
  const c = ctx2d(out)
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'
  c.drawImage(raw, 0, 0, out.width, out.height)
  return out
}

export function TransformWarpEditor({
  layerId,
  mesh,
  onChange,
}: {
  layerId: string
  mesh: TransformWarpSpec
  onChange(mesh: TransformWarpSpec): void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<null | {
    pointerId: number
    hit: number
    start: { x: number; y: number }
    selected: number[]
    original: { x: number; y: number }[]
  }>(null)

  const source = useMemo(() => previewSource(layerId), [layerId])
  const [selected, setSelected] = useState<number[]>([])
  const [dragging, setDragging] = useState(false)
  const [multiSelect, setMultiSelect] = useState(false)
  const [preset, setPreset] = useState<WarpPreset>('custom')
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal')
  const [bend, setBend] = useState(0)
  const [hDist, setHDist] = useState(0)
  const [vDist, setVDist] = useState(0)
  const [customCols, setCustomCols] = useState(Math.max(1, mesh.u.length - 1))
  const [customRows, setCustomRows] = useState(Math.max(1, mesh.v.length - 1))
  const [splitX, setSplitX] = useState(50)
  const [splitY, setSplitY] = useState(50)
  const [guideMode, setGuideMode] = useState<GuideMode>('always')
  const [guideColor, setGuideColor] = useState('#33c7ff')
  const [guideOpacity, setGuideOpacity] = useState(80)
  const [guideDensity, setGuideDensity] = useState(2)

  const normalized = validateWarpMesh(mesh) ?? regularWarpMesh(3, 3)

  const updatePreset = (
    nextPreset = preset,
    nextBend = bend,
    nextH = hDist,
    nextV = vDist,
    nextOrientation = orientation,
  ) => {
    if (nextPreset === 'custom') return
    onChange(presetWarpMesh(
      Math.max(1, normalized.u.length - 1),
      Math.max(1, normalized.v.length - 1),
      nextPreset,
      nextBend,
      nextH,
      nextV,
      nextOrientation,
    ))
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !source) return
    const W = 560, H = 300
    if (canvas.width !== W) canvas.width = W
    if (canvas.height !== H) canvas.height = H
    const c = ctx2d(canvas)
    c.clearRect(0, 0, W, H)
    c.fillStyle = '#111318'
    c.fillRect(0, 0, W, H)

    const localDest = normalized.points.map(p => ({ x: p.x * source.width, y: p.y * source.height }))
    const warped = warpCanvasToMesh(source, normalized, localDest)
    const fit = Math.min((W - 32) / warped.canvas.width, (H - 32) / warped.canvas.height, 2.5)
    const dw = warped.canvas.width * fit, dh = warped.canvas.height * fit
    const dx = (W - dw) / 2, dy = (H - dh) / 2

    // Transparency checker.
    const tile = 10
    for (let y = 0; y < H; y += tile) {
      for (let x = 0; x < W; x += tile) {
        c.fillStyle = ((x / tile + y / tile) & 1) ? '#242830' : '#1b1e25'
        c.fillRect(x, y, tile, tile)
      }
    }
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    c.drawImage(warped.canvas, dx, dy, dw, dh)

    const toScreen = (p: { x: number; y: number }) => ({
      x: dx + (p.x * source.width - warped.offsetX) * fit,
      y: dy + (p.y * source.height - warped.offsetY) * fit,
    })
    ;(canvas as any).__warpView = { dx, dy, fit, offsetX: warped.offsetX, offsetY: warped.offsetY, sourceW: source.width, sourceH: source.height }

    const show = guideMode === 'always' || (guideMode === 'auto' && (dragging || selected.length > 0))
    if (!show) return

    const color = guideColor
    const alpha = clamp(guideOpacity, 5, 100) / 100
    c.save()
    c.strokeStyle = color
    c.fillStyle = color
    c.globalAlpha = alpha
    c.lineWidth = 1

    const idx = (col: number, row: number) => row * normalized.u.length + col
    const line = (a: { x: number; y: number }, b: { x: number; y: number }, faint = false) => {
      const aa = toScreen(a), bb = toScreen(b)
      c.save()
      if (faint) c.globalAlpha *= .42
      c.beginPath(); c.moveTo(aa.x, aa.y); c.lineTo(bb.x, bb.y); c.stroke()
      c.restore()
    }

    // Main split lines.
    for (let row = 0; row < normalized.v.length; row++) {
      for (let col = 0; col < normalized.u.length - 1; col++) {
        line(normalized.points[idx(col, row)], normalized.points[idx(col + 1, row)])
      }
    }
    for (let col = 0; col < normalized.u.length; col++) {
      for (let row = 0; row < normalized.v.length - 1; row++) {
        line(normalized.points[idx(col, row)], normalized.points[idx(col, row + 1)])
      }
    }

    // Visual density lines between actual split lines.
    const density = Math.max(0, Math.min(4, Math.round(guideDensity)))
    if (density > 0) {
      const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
        x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
      })
      for (let row = 0; row < normalized.v.length - 1; row++) {
        for (let col = 0; col < normalized.u.length - 1; col++) {
          const p00 = normalized.points[idx(col, row)]
          const p10 = normalized.points[idx(col + 1, row)]
          const p11 = normalized.points[idx(col + 1, row + 1)]
          const p01 = normalized.points[idx(col, row + 1)]
          for (let k = 1; k <= density; k++) {
            const t = k / (density + 1)
            line(lerp(p00, p10, t), lerp(p01, p11, t), true)
            line(lerp(p00, p01, t), lerp(p10, p11, t), true)
          }
        }
      }
    }

    // Anchor points.
    normalized.points.forEach((p, i) => {
      const q = toScreen(p)
      const active = selected.includes(i)
      c.beginPath()
      c.arc(q.x, q.y, active ? 5 : 3.5, 0, Math.PI * 2)
      c.globalAlpha = active ? 1 : alpha
      c.fill()
      c.lineWidth = active ? 2 : 1
      c.strokeStyle = active ? '#ffffff' : color
      c.stroke()
      c.strokeStyle = color
      c.globalAlpha = alpha
    })
    c.restore()
  }, [source, normalized, guideMode, guideColor, guideOpacity, guideDensity, dragging, selected])

  const screenToNormalized = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const view = (canvas as any).__warpView
    if (!view || !source) return null
    const rect = canvas.getBoundingClientRect()
    const sx = (e.clientX - rect.left) * (canvas.width / rect.width)
    const sy = (e.clientY - rect.top) * (canvas.height / rect.height)
    const localX = view.offsetX + (sx - view.dx) / view.fit
    const localY = view.offsetY + (sy - view.dy) / view.fit
    return { x: localX / view.sourceW, y: localY / view.sourceH, sx, sy }
  }

  const hitPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const view = (canvas as any).__warpView
    const p = screenToNormalized(e)
    if (!view || !p || !source) return -1
    let best = -1, bestD = 15
    normalized.points.forEach((node, i) => {
      const sx = view.dx + (node.x * source.width - view.offsetX) * view.fit
      const sy = view.dy + (node.y * source.height - view.offsetY) * view.fit
      const d = Math.hypot(p.sx - sx, p.sy - sy)
      if (d < bestD) { bestD = d; best = i }
    })
    return best
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const hit = hitPoint(e)
    if (hit < 0) {
      if (!e.shiftKey && !multiSelect) setSelected([])
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = screenToNormalized(e)
    if (!p) return
    let nextSelected: number[]
    if (e.shiftKey || multiSelect) {
      nextSelected = selected.includes(hit)
        ? selected.filter(i => i !== hit)
        : [...selected, hit]
      if (!nextSelected.includes(hit)) nextSelected = [...nextSelected, hit]
    } else nextSelected = [hit]
    setSelected(nextSelected)
    dragRef.current = {
      pointerId: e.pointerId,
      hit,
      start: { x: p.x, y: p.y },
      selected: nextSelected,
      original: normalized.points.map(v => ({ ...v })),
    }
    setDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const p = screenToNormalized(e)
    if (!p) return
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y
    const next = cloneWarpMesh(normalized)
    next.points = drag.original.map((node, i) => drag.selected.includes(i)
      ? { x: clamp(node.x + dx, -.75, 1.75), y: clamp(node.y + dy, -.75, 1.75) }
      : { ...node })
    setPreset('custom')
    onChange(next)
  }

  const finishPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    dragRef.current = null
    setDragging(false)
  }

  const resetSelected = () => {
    if (!selected.length) return
    const next = cloneWarpMesh(normalized)
    for (const i of selected) next.points[i] = controlPointSource(next, i)
    setPreset('custom')
    onChange(next)
  }

  const changeGrid = (cols: number, rows: number) => {
    const c = Math.max(1, Math.min(12, Math.round(cols)))
    const r = Math.max(1, Math.min(12, Math.round(rows)))
    setCustomCols(c); setCustomRows(r)
    setPreset('custom')
    setSelected([])
    onChange(resampleWarpMesh(normalized, c, r))
  }

  const applyPresetValues = (updates: Partial<{ preset: WarpPreset; bend: number; h: number; v: number; orientation: 'horizontal' | 'vertical' }>) => {
    const np = updates.preset ?? preset
    const nb = updates.bend ?? bend
    const nh = updates.h ?? hDist
    const nv = updates.v ?? vDist
    const no = updates.orientation ?? orientation
    if (updates.preset !== undefined) setPreset(np)
    if (updates.bend !== undefined) setBend(nb)
    if (updates.h !== undefined) setHDist(nh)
    if (updates.v !== undefined) setVDist(nv)
    if (updates.orientation !== undefined) setOrientation(no)
    if (np !== 'custom') updatePreset(np, nb, nh, nv, no)
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-[1fr_140px]">
        <div className="space-y-1">
          <Label className="text-[11px]">Warp Style</Label>
          <Select value={preset} onValueChange={v => applyPresetValues({ preset: v as WarpPreset })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="custom">Custom</SelectItem>
              <SelectItem value="arc">Arc</SelectItem>
              <SelectItem value="arch">Arch</SelectItem>
              <SelectItem value="bulge">Bulge</SelectItem>
              <SelectItem value="flag">Flag</SelectItem>
              <SelectItem value="wave">Wave</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Orientation</Label>
          <Select value={orientation} onValueChange={v => applyPresetValues({ orientation: v as 'horizontal' | 'vertical' })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="horizontal">Horizontal</SelectItem>
              <SelectItem value="vertical">Vertical</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {preset !== 'custom' && (
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px]">Bend {bend}%</Label>
            <input type="range" min={-100} max={100} value={bend} onChange={e => applyPresetValues({ bend: Number(e.target.value) })} className="w-full accent-primary" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">H {hDist}%</Label>
            <input type="range" min={-100} max={100} value={hDist} onChange={e => applyPresetValues({ h: Number(e.target.value) })} className="w-full accent-primary" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">V {vDist}%</Label>
            <input type="range" min={-100} max={100} value={vDist} onChange={e => applyPresetValues({ v: Number(e.target.value) })} className="w-full accent-primary" />
          </div>
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-[1fr_auto] items-end">
        <div className="space-y-1">
          <Label className="text-[11px]">Grid</Label>
          <div className="flex flex-wrap gap-1">
            {[3, 4, 5].map(n => (
              <Button key={n} type="button" variant="secondary" size="sm" className="h-7 text-[10px]" onClick={() => changeGrid(n, n)}>
                {n}×{n}
              </Button>
            ))}
            <div className="flex items-center gap-1 ml-1">
              <Input type="number" min={1} max={12} value={customCols} onChange={e => setCustomCols(clamp(Number(e.target.value) || 1, 1, 12))} className="h-7 w-14 text-[10px]" aria-label="Custom warp columns" />
              <span className="text-[10px] text-muted-foreground">×</span>
              <Input type="number" min={1} max={12} value={customRows} onChange={e => setCustomRows(clamp(Number(e.target.value) || 1, 1, 12))} className="h-7 w-14 text-[10px]" aria-label="Custom warp rows" />
              <Button type="button" variant="secondary" size="sm" className="h-7 text-[10px]" onClick={() => changeGrid(customCols, customRows)}>Custom</Button>
            </div>
          </div>
        </div>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer pb-1">
          <input type="checkbox" checked={multiSelect} onChange={e => setMultiSelect(e.target.checked)} className="accent-primary" />
          Multi-select
        </label>
      </div>

      <canvas
        ref={canvasRef}
        className="w-full rounded-md border bg-black touch-none cursor-crosshair"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        aria-label="Transform Warp mesh editor"
      />

      <div className="flex flex-wrap gap-1.5">
        <Button type="button" variant="secondary" size="sm" className="h-7 text-[10px]" onClick={resetSelected} disabled={!selected.length}>Reset Selected</Button>
        <Button type="button" variant="secondary" size="sm" className="h-7 text-[10px]" onClick={() => { setPreset('custom'); setSelected([]); onChange(resetWarpPoints(normalized)) }}>Reset Mesh</Button>
        <span className="text-[9px] text-muted-foreground self-center ml-auto">
          Drag points · Shift-click or Multi-select to move several · double-click reset is replaced by Reset Selected for touch parity
        </span>
      </div>

      <div className="rounded-md border p-2 space-y-2">
        <div className="text-[10px] font-semibold">Split Warp</div>
        <div className="grid gap-2 md:grid-cols-2">
          <div className="flex items-center gap-1">
            <Input type="number" min={1} max={99} value={splitX} onChange={e => setSplitX(clamp(Number(e.target.value) || 50, 1, 99))} className="h-7 w-16 text-[10px]" />
            <span className="text-[10px] text-muted-foreground">%</span>
            <Button type="button" variant="secondary" size="sm" className="h-7 text-[10px]" onClick={() => { setPreset('custom'); onChange(splitWarpMesh(normalized, 'u', splitX / 100)) }}>Split Vertical</Button>
          </div>
          <div className="flex items-center gap-1">
            <Input type="number" min={1} max={99} value={splitY} onChange={e => setSplitY(clamp(Number(e.target.value) || 50, 1, 99))} className="h-7 w-16 text-[10px]" />
            <span className="text-[10px] text-muted-foreground">%</span>
            <Button type="button" variant="secondary" size="sm" className="h-7 text-[10px]" onClick={() => { setPreset('custom'); onChange(splitWarpMesh(normalized, 'v', splitY / 100)) }}>Split Horizontal</Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {normalized.u.slice(1, -1).map((v, i) => (
            <button key={`u-${i}-${v}`} type="button" className="h-6 rounded border px-1.5 text-[9px] text-muted-foreground hover:text-destructive" onClick={() => onChange(removeWarpSplit(normalized, 'u', i + 1))} title="Remove vertical split">
              V {Math.round(v * 100)}% ×
            </button>
          ))}
          {normalized.v.slice(1, -1).map((v, i) => (
            <button key={`v-${i}-${v}`} type="button" className="h-6 rounded border px-1.5 text-[9px] text-muted-foreground hover:text-destructive" onClick={() => onChange(removeWarpSplit(normalized, 'v', i + 1))} title="Remove horizontal split">
              H {Math.round(v * 100)}% ×
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border p-2 space-y-2">
        <div className="text-[10px] font-semibold">Warp Guides</div>
        <div className="grid gap-2 md:grid-cols-4 items-end">
          <div className="space-y-1">
            <Label className="text-[9px]">Show</Label>
            <Select value={guideMode} onValueChange={v => setGuideMode(v as GuideMode)}>
              <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="always">Always</SelectItem>
                <SelectItem value="never">Never</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[9px]">Color</Label>
            <input type="color" value={guideColor} onChange={e => setGuideColor(e.target.value)} className="h-7 w-full rounded border bg-background" />
          </div>
          <div className="space-y-1">
            <Label className="text-[9px]">Opacity {guideOpacity}%</Label>
            <input type="range" min={5} max={100} value={guideOpacity} onChange={e => setGuideOpacity(Number(e.target.value))} className="w-full accent-primary" />
          </div>
          <div className="space-y-1">
            <Label className="text-[9px]">Density {guideDensity}</Label>
            <input type="range" min={0} max={4} step={1} value={guideDensity} onChange={e => setGuideDensity(Number(e.target.value))} className="w-full accent-primary" />
          </div>
        </div>
      </div>
    </div>
  )
}
