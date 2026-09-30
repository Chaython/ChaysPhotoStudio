'use client'
// ============================================================
// Layer Style dialog — Photoshop-style effect stack, fully non-destructive.
// Changes live-preview without history; OK commits one history state and
// Cancel restores the exact original.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ControlRenderer } from '../toolbar/tool-options-bar'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { defaultFX } from '../../engine/layer-fx'
import { listUserPatterns } from '../../tools/patterns'
import type { ControlDef, LayerFX, StyleContourPoint } from '../../types'
import type { DialogProps } from './generic-dialogs'
import { cn } from '@/lib/utils'

type EffectKey = keyof LayerFX

const LINEAR_CONTOUR: StyleContourPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
const CONTOUR_EFFECTS = new Set<EffectKey>(['bevelEmboss', 'innerShadow', 'innerGlow', 'satin', 'outerGlow', 'dropShadow'])
const CONTOUR_PRESETS: { label: string; points: StyleContourPoint[] }[] = [
  { label: 'Linear', points: LINEAR_CONTOUR },
  { label: 'S Curve', points: [{ x: 0, y: 0 }, { x: .25, y: .08 }, { x: .5, y: .5 }, { x: .75, y: .92 }, { x: 1, y: 1 }] },
  { label: 'Cone', points: [{ x: 0, y: 0 }, { x: .5, y: 1 }, { x: 1, y: 0 }] },
  { label: 'Ring', points: [{ x: 0, y: 0 }, { x: .25, y: .9 }, { x: .5, y: .15 }, { x: .75, y: .9 }, { x: 1, y: 0 }] },
]

function normalizeContour(points: StyleContourPoint[] | undefined): StyleContourPoint[] {
  const src = points?.length ? points : LINEAR_CONTOUR
  const sorted = src
    .map(p => ({ x: Math.max(0, Math.min(1, Number(p.x) || 0)), y: Math.max(0, Math.min(1, Number(p.y) || 0)) }))
    .sort((a, b) => a.x - b.x)
  if (!sorted.length) return LINEAR_CONTOUR.map(p => ({ ...p }))
  if (sorted[0].x > 0) sorted.unshift({ x: 0, y: sorted[0].y })
  if (sorted[sorted.length - 1].x < 1) sorted.push({ x: 1, y: sorted[sorted.length - 1].y })
  sorted[0].x = 0
  sorted[sorted.length - 1].x = 1
  return sorted
}

function ContourEditor({ value, onChange }: { value?: StyleContourPoint[]; onChange(points: StyleContourPoint[]): void }) {
  const points = normalizeContour(value)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<number | null>(null)
  const W = 270, H = 126, P = 10
  const sx = (x: number) => P + x * (W - P * 2)
  const sy = (y: number) => H - P - y * (H - P * 2)
  const eventPoint = (e: ReactPointerEvent<SVGSVGElement>): StyleContourPoint => {
    const rect = svgRef.current!.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const py = ((e.clientY - rect.top) / rect.height) * H
    return {
      x: Math.max(0, Math.min(1, (px - P) / (W - P * 2))),
      y: Math.max(0, Math.min(1, (H - P - py) / (H - P * 2))),
    }
  }
  const movePoint = (index: number, next: StyleContourPoint) => {
    const copy = points.map(p => ({ ...p }))
    const lo = index === 0 ? 0 : copy[index - 1].x + .01
    const hi = index === copy.length - 1 ? 1 : copy[index + 1].x - .01
    copy[index] = {
      x: index === 0 ? 0 : index === copy.length - 1 ? 1 : Math.max(lo, Math.min(hi, next.x)),
      y: next.y,
    }
    onChange(copy)
  }
  const addPoint = (next: StyleContourPoint) => {
    if (points.length >= 12) return
    const copy = [...points.map(p => ({ ...p })), next].sort((a, b) => a.x - b.x)
    onChange(copy)
  }
  const removePoint = (index: number) => {
    if (index <= 0 || index >= points.length - 1) return
    onChange(points.filter((_, i) => i !== index).map(p => ({ ...p })))
  }
  const polyline = points.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')

  return (
    <div className="rounded-md border border-border/70 bg-background/30 p-2 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium">Contour</span>
        <span className="text-[9px] text-muted-foreground">click to add · drag to shape · double-click interior point to remove</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-32 rounded border border-border bg-black/20 touch-none select-none"
        onPointerDown={e => {
          if (e.target !== e.currentTarget) return
          addPoint(eventPoint(e))
        }}
        onPointerMove={e => {
          if (dragging.current === null) return
          movePoint(dragging.current, eventPoint(e))
        }}
        onPointerUp={e => {
          if (dragging.current !== null) e.currentTarget.releasePointerCapture?.(e.pointerId)
          dragging.current = null
        }}
        onPointerCancel={() => { dragging.current = null }}
        aria-label="Layer style contour curve editor"
      >
        {[.25, .5, .75].map(v => (
          <g key={v} opacity=".2">
            <line x1={sx(v)} y1={P} x2={sx(v)} y2={H - P} stroke="currentColor" strokeWidth=".6" />
            <line x1={P} y1={sy(v)} x2={W - P} y2={sy(v)} stroke="currentColor" strokeWidth=".6" />
          </g>
        ))}
        <line x1={P} y1={H - P} x2={W - P} y2={P} stroke="currentColor" strokeOpacity=".18" strokeDasharray="3 3" />
        <polyline points={polyline} fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={sx(p.x)}
            cy={sy(p.y)}
            r="4.5"
            className="fill-background stroke-primary cursor-grab active:cursor-grabbing"
            strokeWidth="2"
            onPointerDown={e => {
              e.stopPropagation()
              dragging.current = i
              e.currentTarget.ownerSVGElement?.setPointerCapture?.(e.pointerId)
            }}
            onDoubleClick={e => { e.stopPropagation(); removePoint(i) }}
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-1">
        {CONTOUR_PRESETS.map(preset => (
          <button
            key={preset.label}
            type="button"
            className="h-6 px-2 rounded border text-[9px] text-muted-foreground hover:text-foreground hover:bg-accent"
            onClick={() => onChange(preset.points.map(p => ({ ...p })))}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const STYLE_DEFAULTS_KEY = 'chays-photo-layer-style-defaults-v1'

function readSavedDefaults(): Partial<LayerFX> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STYLE_DEFAULTS_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed as Partial<LayerFX> : {}
  } catch {
    return {}
  }
}

function defaultFor(key: EffectKey): Record<string, unknown> | undefined {
  const saved = readSavedDefaults()[key]
  const builtin = defaultFX()[key]
  return (saved ?? builtin) as Record<string, unknown> | undefined
}

function saveEffectDefault(key: EffectKey, value: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  const saved = readSavedDefaults()
  saved[key] = { ...value, enabled: true } as never
  window.localStorage.setItem(STYLE_DEFAULTS_KEY, JSON.stringify(saved))
}

function clearEffectDefault(key: EffectKey) {
  if (typeof window === 'undefined') return
  const saved = readSavedDefaults()
  delete saved[key]
  window.localStorage.setItem(STYLE_DEFAULTS_KEY, JSON.stringify(saved))
}

const EFFECTS: { key: EffectKey; label: string; hint: string }[] = [
  { key: 'bevelEmboss', label: 'Bevel & Emboss', hint: 'Highlights and shadows that simulate raised or recessed depth' },
  { key: 'stroke', label: 'Stroke', hint: 'Color, gradient, or pattern outline along the layer silhouette' },
  { key: 'innerShadow', label: 'Inner Shadow', hint: 'Recessed shadow inside the layer edges' },
  { key: 'innerGlow', label: 'Inner Glow', hint: 'Glow from the edge or center inside the layer' },
  { key: 'satin', label: 'Satin', hint: 'Interior light-and-shadow shading for a silky finish' },
  { key: 'colorOverlay', label: 'Color Overlay', hint: 'Flat color fill of the layer shape' },
  { key: 'gradientOverlay', label: 'Gradient Overlay', hint: 'Linear or radial gradient over the layer contents' },
  { key: 'patternOverlay', label: 'Pattern Overlay', hint: 'Repeating built-in or imported pattern over the layer' },
  { key: 'outerGlow', label: 'Outer Glow', hint: 'Soft halo outside the layer silhouette' },
  { key: 'dropShadow', label: 'Drop Shadow', hint: 'Offset blurred shadow beneath the layer' },
]

const SHADOW_CONTROLS: ControlDef[] = [
  { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'angle', label: 'Angle', type: 'angle', min: 0, max: 360, step: 1, unit: '°' },
  { key: 'distance', label: 'Distance', type: 'slider', min: 0, max: 200, step: 1, unit: 'px' },
  { key: 'blur', label: 'Size', type: 'slider', min: 0, max: 200, step: 1, unit: 'px' },
  { key: 'color', label: 'Color', type: 'color' },
]

const OUTER_GLOW_CONTROLS: ControlDef[] = [
  { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'blur', label: 'Size', type: 'slider', min: 1, max: 200, step: 1, unit: 'px' },
  { key: 'color', label: 'Color', type: 'color' },
]

const INNER_GLOW_CONTROLS: ControlDef[] = [
  { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'source', label: 'Source', type: 'select', options: [
    { label: 'Edge', value: 'edge' }, { label: 'Center', value: 'center' },
  ] },
  { key: 'choke', label: 'Choke', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'blur', label: 'Size', type: 'slider', min: 1, max: 200, step: 1, unit: 'px' },
  { key: 'color', label: 'Color', type: 'color' },
]

const BEVEL_CONTROLS: ControlDef[] = [
  { key: 'style', label: 'Style', type: 'select', options: [
    { label: 'Inner Bevel', value: 'inner-bevel' },
    { label: 'Outer Bevel', value: 'outer-bevel' },
    { label: 'Emboss', value: 'emboss' },
  ] },
  { key: 'technique', label: 'Technique', type: 'select', options: [
    { label: 'Smooth', value: 'smooth' },
    { label: 'Chisel Hard', value: 'chisel-hard' },
    { label: 'Chisel Soft', value: 'chisel-soft' },
  ] },
  { key: 'depth', label: 'Depth', type: 'slider', min: 1, max: 1000, step: 1, unit: '%' },
  { key: 'direction', label: 'Direction', type: 'select', options: [
    { label: 'Up', value: 'up' }, { label: 'Down', value: 'down' },
  ] },
  { key: 'size', label: 'Size', type: 'slider', min: 1, max: 128, step: 1, unit: 'px' },
  { key: 'soften', label: 'Soften', type: 'slider', min: 0, max: 32, step: 1, unit: 'px' },
  { key: 'angle', label: 'Angle', type: 'angle', min: 0, max: 360, step: 1, unit: '°' },
  { key: 'altitude', label: 'Altitude', type: 'slider', min: 0, max: 90, step: 1, unit: '°' },
  { key: 'highlightColor', label: 'Highlight Color', type: 'color' },
  { key: 'highlightOpacity', label: 'Highlight Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'shadowColor', label: 'Shadow Color', type: 'color' },
  { key: 'shadowOpacity', label: 'Shadow Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
]

const SATIN_CONTROLS: ControlDef[] = [
  { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'angle', label: 'Angle', type: 'angle', min: 0, max: 360, step: 1, unit: '°' },
  { key: 'distance', label: 'Distance', type: 'slider', min: 0, max: 100, step: 1, unit: 'px' },
  { key: 'size', label: 'Size', type: 'slider', min: 1, max: 100, step: 1, unit: 'px' },
  { key: 'invert', label: 'Invert', type: 'toggle' },
  { key: 'color', label: 'Color', type: 'color' },
]

const COLOR_OVERLAY_CONTROLS: ControlDef[] = [
  { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'color', label: 'Color', type: 'color' },
]

const GRADIENT_CONTROLS: ControlDef[] = [
  { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'style', label: 'Style', type: 'select', options: [
    { label: 'Linear', value: 'linear' }, { label: 'Radial', value: 'radial' },
  ] },
  { key: 'angle', label: 'Angle', type: 'angle', min: 0, max: 360, step: 1, unit: '°' },
  { key: 'scale', label: 'Scale', type: 'slider', min: 10, max: 400, step: 1, unit: '%' },
  { key: 'reverse', label: 'Reverse', type: 'toggle' },
  { key: 'startColor', label: 'Start Color', type: 'color' },
  { key: 'endColor', label: 'End Color', type: 'color' },
]

function patternOptions() {
  return [
    { label: 'Checker', value: 'checker' },
    { label: 'Diagonal Stripes', value: 'diagonal' },
    { label: 'Dots', value: 'dots' },
    { label: 'Grid', value: 'grid' },
    ...listUserPatterns().map(p => ({ label: p.name, value: p.id })),
  ]
}

function patternControls(prefix = ''): ControlDef[] {
  const key = (name: string) => `${prefix}${name}`
  return [
    { key: key('pattern'), label: 'Pattern', type: 'select', options: patternOptions() },
    { key: key('patternScale'), label: 'Scale', type: 'slider', min: 25, max: 400, step: 5, unit: '%' },
    { key: key('patternOffsetX'), label: 'Offset X', type: 'number', min: -10000, max: 10000, step: 1, unit: 'px' },
    { key: key('patternOffsetY'), label: 'Offset Y', type: 'number', min: -10000, max: 10000, step: 1, unit: 'px' },
    { key: key('patternFg'), label: 'Foreground', type: 'color' },
    { key: key('patternBg'), label: 'Background', type: 'color' },
  ]
}

function controlsFor(selected: EffectKey, current: Record<string, any> | undefined): ControlDef[] {
  if (selected === 'bevelEmboss') return BEVEL_CONTROLS
  if (selected === 'dropShadow' || selected === 'innerShadow') return SHADOW_CONTROLS
  if (selected === 'outerGlow') return OUTER_GLOW_CONTROLS
  if (selected === 'innerGlow') return INNER_GLOW_CONTROLS
  if (selected === 'satin') return SATIN_CONTROLS
  if (selected === 'colorOverlay') return COLOR_OVERLAY_CONTROLS
  if (selected === 'gradientOverlay') return GRADIENT_CONTROLS
  if (selected === 'patternOverlay') {
    return [
      { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'pattern', label: 'Pattern', type: 'select', options: patternOptions() },
      { key: 'scale', label: 'Scale', type: 'slider', min: 25, max: 400, step: 5, unit: '%' },
      { key: 'offsetX', label: 'Offset X', type: 'number', min: -10000, max: 10000, step: 1, unit: 'px' },
      { key: 'offsetY', label: 'Offset Y', type: 'number', min: -10000, max: 10000, step: 1, unit: 'px' },
      { key: 'fg', label: 'Foreground', type: 'color' },
      { key: 'bg', label: 'Background', type: 'color' },
    ]
  }
  if (selected === 'stroke') {
    const base: ControlDef[] = [
      { key: 'size', label: 'Size', type: 'slider', min: 1, max: 128, step: 1, unit: 'px' },
      { key: 'position', label: 'Position', type: 'select', options: [
        { label: 'Outside', value: 'outside' }, { label: 'Center', value: 'center' }, { label: 'Inside', value: 'inside' },
      ] },
      { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'fillType', label: 'Fill Type', type: 'select', options: [
        { label: 'Color', value: 'color' }, { label: 'Gradient', value: 'gradient' }, { label: 'Pattern', value: 'pattern' },
      ] },
    ]
    if (current?.fillType === 'gradient') return base.concat([
      { key: 'gradientStart', label: 'Start Color', type: 'color' },
      { key: 'gradientEnd', label: 'End Color', type: 'color' },
      { key: 'gradientAngle', label: 'Angle', type: 'angle', min: 0, max: 360, step: 1, unit: '°' },
      { key: 'gradientScale', label: 'Scale', type: 'slider', min: 10, max: 400, step: 1, unit: '%' },
    ])
    if (current?.fillType === 'pattern') return base.concat(patternControls())
    return base.concat([{ key: 'color', label: 'Color', type: 'color' }])
  }
  return []
}

function cloneFX(fx: LayerFX | null): LayerFX {
  const contour = (points: StyleContourPoint[] | undefined) => points?.map(p => ({ ...p }))
  return {
    bevelEmboss: fx?.bevelEmboss ? { ...fx.bevelEmboss, contour: contour(fx.bevelEmboss.contour) } : undefined,
    stroke: fx?.stroke ? { ...fx.stroke } : undefined,
    innerShadow: fx?.innerShadow ? { ...fx.innerShadow, contour: contour(fx.innerShadow.contour) } : undefined,
    innerGlow: fx?.innerGlow ? { ...fx.innerGlow, contour: contour(fx.innerGlow.contour) } : undefined,
    satin: fx?.satin ? { ...fx.satin, contour: contour(fx.satin.contour) } : undefined,
    colorOverlay: fx?.colorOverlay ? { ...fx.colorOverlay } : undefined,
    gradientOverlay: fx?.gradientOverlay ? { ...fx.gradientOverlay } : undefined,
    patternOverlay: fx?.patternOverlay ? { ...fx.patternOverlay } : undefined,
    outerGlow: fx?.outerGlow ? { ...fx.outerGlow, contour: contour(fx.outerGlow.contour) } : undefined,
    dropShadow: fx?.dropShadow ? { ...fx.dropShadow, contour: contour(fx.dropShadow.contour) } : undefined,
  }
}

function compactFX(fx: LayerFX | null): LayerFX | null {
  const out: LayerFX = {}
  let any = false
  for (const e of EFFECTS) {
    const value = fx?.[e.key] as { enabled?: boolean } | undefined
    if (value?.enabled) {
      ;(out as Record<string, unknown>)[e.key] = value
      any = true
    }
  }
  return any ? out : null
}

export function LayerStylesDialog({ inst, onClose }: DialogProps) {
  const layerId: string | undefined = inst.props?.layerId ?? engine.activeLayer?.id
  const layer = engine.layerById(layerId ?? '')
  const [fx, setFx] = useState<LayerFX>(() => cloneFX(layer?.fx ?? null))
  const [selected, setSelected] = useState<EffectKey>(() => {
    const current = layer?.fx
    const firstOn = EFFECTS.find(e => current?.[e.key]?.enabled)
    return firstOn?.key ?? 'bevelEmboss'
  })
  const originalRef = useRef<LayerFX | null>(layer?.fx ? cloneFX(layer.fx) : null)

  useEffect(() => {
    if (!layerId) return
    engine.setLayerFX(layerId, compactFX(fx), { history: false, silent: true })
    engine.requestRender()
  }, [fx, layerId])

  const enabledCount = useMemo(
    () => EFFECTS.filter(e => fx[e.key]?.enabled).length,
    [fx],
  )

  if (!layerId || !layer) {
    return (
      <>
        <DialogHeader><DialogTitle>Layer Style</DialogTitle></DialogHeader>
        <div className="py-4 text-xs text-muted-foreground">No active layer.</div>
        <DialogFooter><Button size="sm" variant="secondary" onClick={onClose}>Close</Button></DialogFooter>
      </>
    )
  }

  const patch = (key: EffectKey, field: string, value: unknown) => {
    setFx(prev => ({
      ...prev,
      [key]: { ...(prev[key] as Record<string, unknown> | undefined), [field]: value },
    }) as LayerFX)
  }

  const toggle = (key: EffectKey, on: boolean) => {
    setFx(prev => {
      const base = prev[key] ?? defaultFor(key)
      return { ...prev, [key]: { ...(base as Record<string, unknown>), enabled: on } } as LayerFX
    })
  }

  const commit = () => {
    engine.setLayerFX(layerId, compactFX(fx))
    onClose()
  }

  const cancel = () => {
    engine.setLayerFX(
      layerId,
      originalRef.current ? compactFX(cloneFX(originalRef.current)) : null,
      { history: false, silent: true },
    )
    engine.requestRender()
    onClose()
  }

  const selectedDef = EFFECTS.find(e => e.key === selected)
  const current = fx[selected] as Record<string, any> | undefined
  const reset = () => setFx(cloneFX(null))
  const makeDefault = () => {
    if (!current) return
    saveEffectDefault(selected, current)
    useEditorStore.getState().pushToast(`${selectedDef?.label ?? 'Effect'} defaults saved`, 'success')
  }
  const resetDefault = () => {
    clearEffectDefault(selected)
    const built = defaultFX()[selected] as Record<string, unknown> | undefined
    if (built) setFx(prev => ({ ...prev, [selected]: { ...built, enabled: current?.enabled !== false } }) as LayerFX)
    useEditorStore.getState().pushToast(`${selectedDef?.label ?? 'Effect'} defaults reset`, 'info')
  }
  const controls = controlsFor(selected, current)
  return (
    <>
      <DialogHeader>
        <DialogTitle>Layer Style — {layer.name}</DialogTitle>
      </DialogHeader>
      <div className="flex gap-3 py-1 min-h-[22rem] max-h-[72vh]">
        <div className="w-44 shrink-0 border rounded-md overflow-y-auto zphoto-scroll" role="list" aria-label="Layer effects">
          {EFFECTS.map(effect => {
            const on = !!fx[effect.key]?.enabled
            return (
              <button
                key={effect.key}
                role="listitem"
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] border-b border-border/30',
                  selected === effect.key
                    ? 'bg-accent/70 text-foreground'
                    : 'hover:bg-accent/30 text-muted-foreground',
                )}
                onClick={() => setSelected(effect.key)}
                title={effect.hint}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={ev => { ev.stopPropagation(); toggle(effect.key, ev.target.checked) }}
                  onClick={ev => ev.stopPropagation()}
                  className="accent-primary w-3 h-3 shrink-0"
                  aria-label={`${effect.label} enabled`}
                />
                <span className="truncate">{effect.label}</span>
                {on && <span className="ml-auto text-[8px] text-primary">●</span>}
              </button>
            )
          })}
        </div>

        <div className="flex-1 min-w-0 space-y-2.5 overflow-y-auto zphoto-scroll pr-1">
          {!current?.enabled ? (
            <div className="text-[11px] text-muted-foreground py-8 px-3 text-center border border-dashed rounded-md">
              {selectedDef?.hint}
              <br />
              Enable the checkbox to edit {selectedDef?.label}.
            </div>
          ) : (
            controls.map(control => (
              <ControlRenderer
                key={control.key}
                control={control}
                value={current[control.key]}
                onChange={(value: unknown) => patch(selected, control.key, value)}
              />
            ))
          )}

          {current?.enabled && CONTOUR_EFFECTS.has(selected) && (
            <ContourEditor
              value={current.contour as StyleContourPoint[] | undefined}
              onChange={points => patch(selected, 'contour', points)}
            />
          )}

          {selected === 'bevelEmboss' && current?.enabled && (
            <p className="text-[10px] text-muted-foreground pt-1">
              Lighting uses Angle + Altitude; Direction flips the highlight and shadow. Chisel modes reduce smoothing for harder engraved edges; the Contour remaps edge intensity before highlight/shadow colorization.
            </p>
          )}
          {selected === 'stroke' && current?.enabled && (
            <p className="text-[10px] text-muted-foreground pt-1">
              Stroke supports Photoshop-style Outside, Center, and Inside placement with Color, Gradient, or Pattern fills.
            </p>
          )}
          {selected === 'patternOverlay' && current?.enabled && String(current.pattern).startsWith('user:') && (
            <p className="text-[10px] text-muted-foreground pt-1">
              Imported patterns come from the Patterns panel and remain reusable across tools.
            </p>
          )}
        </div>
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <span className="text-[10px] text-muted-foreground mr-auto self-center">
          {enabledCount
            ? `${enabledCount} effect${enabledCount > 1 ? 's' : ''} active · live preview`
            : 'No effects enabled'}
        </span>
        <Button variant="ghost" size="sm" onClick={makeDefault} disabled={!current?.enabled}>Make Default</Button>
        <Button variant="ghost" size="sm" onClick={resetDefault}>Reset Default</Button>
        <Button variant="secondary" size="sm" onClick={reset}>Clear All</Button>
        <Button variant="secondary" size="sm" onClick={cancel}>Cancel</Button>
        <Button size="sm" onClick={commit}>OK</Button>
      </DialogFooter>
    </>
  )
}
