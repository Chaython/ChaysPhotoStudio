'use client'
// ============================================================
// Layer Style (fx) dialog — drop shadow, outer glow, inner shadow,
// stroke, color overlay. Fully non-destructive: every change live-
// previews on the canvas (history-free silent writes); OK commits one
// history step, Cancel restores the exact original.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ControlRenderer } from '../toolbar/tool-options-bar'
import { engine } from '../../engine/engine'
import { defaultFX } from '../../engine/layer-fx'
import { useEditorStore } from '../../store'
import type { DialogProps } from './generic-dialogs'
import type { ColorOverlayFX, ControlDef, GlowFX, LayerFX, ShadowFX, StrokeFX } from '../../types'
import { cn } from '@/lib/utils'

type EffectKey = keyof LayerFX

const EFFECTS: { key: EffectKey; label: string; hint: string }[] = [
  { key: 'dropShadow', label: 'Drop Shadow', hint: 'Offset blurred copy beneath the layer' },
  { key: 'outerGlow', label: 'Outer Glow', hint: 'Soft halo around the layer' },
  { key: 'innerShadow', label: 'Inner Shadow', hint: 'Darkened edge inset into the layer' },
  { key: 'stroke', label: 'Stroke', hint: 'Outline along the layer silhouette' },
  { key: 'colorOverlay', label: 'Color Overlay', hint: 'Flat color fill of the layer shape' },
]

const SHADOW_CONTROLS: ControlDef[] = [
  { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'angle', label: 'Angle', type: 'angle', min: 0, max: 360, step: 1, unit: '°' },
  { key: 'distance', label: 'Distance', type: 'slider', min: 0, max: 200, step: 1, unit: 'px' },
  { key: 'blur', label: 'Blur', type: 'slider', min: 0, max: 200, step: 1, unit: 'px' },
  { key: 'color', label: 'Color', type: 'color' },
]

const GLOW_CONTROLS: ControlDef[] = [
  { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'blur', label: 'Blur', type: 'slider', min: 1, max: 200, step: 1, unit: 'px' },
  { key: 'color', label: 'Color', type: 'color' },
]

const STROKE_CONTROLS: ControlDef[] = [
  { key: 'size', label: 'Size', type: 'slider', min: 1, max: 64, step: 1, unit: 'px' },
  { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'position', label: 'Position', type: 'select', options: [
    { label: 'Outside', value: 'outside' },
    { label: 'Inside', value: 'inside' },
  ] },
  { key: 'color', label: 'Color', type: 'color' },
]

const OVERLAY_CONTROLS: ControlDef[] = [
  { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'color', label: 'Color', type: 'color' },
]

function cloneFX(fx: LayerFX | null): LayerFX {
  return {
    dropShadow: fx?.dropShadow ? { ...fx.dropShadow } : undefined,
    outerGlow: fx?.outerGlow ? { ...fx.outerGlow } : undefined,
    innerShadow: fx?.innerShadow ? { ...fx.innerShadow } : undefined,
    stroke: fx?.stroke ? { ...fx.stroke } : undefined,
    colorOverlay: fx?.colorOverlay ? { ...fx.colorOverlay } : undefined,
  }
}

/** remove disabled/undefined effects — a null result clears the fx badge */
function compactFX(fx: LayerFX | null): LayerFX | null {
  const out: LayerFX = {}
  let any = false
  for (const e of EFFECTS) {
    const v = (fx as any)?.[e.key] as { enabled?: boolean } | undefined
    if (v?.enabled) { (out as any)[e.key] = v; any = true }
  }
  return any ? out : null
}

export function LayerStylesDialog({ inst, onClose }: DialogProps) {
  const layerId: string | undefined = inst.props?.layerId ?? engine.activeLayer?.id
  const layer = engine.layerById(layerId ?? '')
  const [fx, setFx] = useState<LayerFX>(() => cloneFX(layer?.fx ?? null))
  const [selected, setSelected] = useState<EffectKey>(() => {
    const cur = layer?.fx
    const firstOn = EFFECTS.find(e => (cur as any)?.[e.key]?.enabled)
    return firstOn?.key ?? 'dropShadow'
  })
  // original for Cancel — captured once (ref: never re-read)
  const originalRef = useRef<LayerFX | null>(layer?.fx ?? null)
  const [preview] = useState(true)

  // live preview: silent, history-free writes — OK pushes one history step
  useEffect(() => {
    if (!layerId) return
    if (preview) {
      engine.setLayerFX(layerId, compactFX(fx), { history: false, silent: true })
      engine.requestRender()
    }
  }, [fx, preview, layerId])

  const enabledCount = useMemo(() => EFFECTS.filter(e => (fx as any)[e.key]?.enabled).length, [fx])

  if (!layerId || !layer) {
    return (
      <>
        <DialogHeader><DialogTitle>Layer Style</DialogTitle></DialogHeader>
        <div className="py-4 text-xs text-muted-foreground">No active layer.</div>
        <DialogFooter><Button size="sm" variant="secondary" onClick={onClose}>Close</Button></DialogFooter>
      </>
    )
  }

  const patch = (key: EffectKey, field: string, value: any) => {
    setFx(prev => ({ ...prev, [key]: { ...(prev as any)[key], [field]: value } }) as LayerFX)
  }
  const toggle = (key: EffectKey, on: boolean) => {
    setFx(prev => {
      const base = (prev as any)[key] ?? (defaultFX() as any)[key]
      return { ...prev, [key]: { ...base, enabled: on } } as LayerFX
    })
  }

  const commit = () => {
    engine.setLayerFX(layerId, compactFX(fx))
    onClose()
  }
  const cancel = () => {
    // restore the exact original (also clears the live preview)
    engine.setLayerFX(layerId, originalRef.current ? compactFX(cloneFX(originalRef.current)) : null, { history: false, silent: true })
    engine.requestRender()
    onClose()
  }
  const reset = () => setFx(cloneFX(null))

  const current = (fx as any)[selected] as Record<string, any> | undefined
  const controls =
    selected === 'dropShadow' || selected === 'innerShadow' ? SHADOW_CONTROLS
    : selected === 'outerGlow' ? GLOW_CONTROLS
    : selected === 'stroke' ? STROKE_CONTROLS
    : OVERLAY_CONTROLS

  return (
    <>
      <DialogHeader>
        <DialogTitle>Layer Style — {layer.name}</DialogTitle>
      </DialogHeader>
      <div className="flex gap-3 py-1 min-h-64 max-h-[70vh]">
        {/* effect list (PS style) */}
        <div className="w-40 shrink-0 border rounded-md overflow-y-auto zphoto-scroll" role="list" aria-label="Layer effects">
          {EFFECTS.map(e => {
            const on = !!(fx as any)[e.key]?.enabled
            return (
              <button
                key={e.key}
                role="listitem"
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] border-b border-border/30',
                  selected === e.key ? 'bg-accent/70 text-foreground' : 'hover:bg-accent/30 text-muted-foreground'
                )}
                onClick={() => setSelected(e.key)}
                title={e.hint}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={ev => { ev.stopPropagation(); toggle(e.key, ev.target.checked) }}
                  onClick={ev => ev.stopPropagation()}
                  className="accent-primary w-3 h-3 shrink-0"
                  aria-label={`${e.label} enabled`}
                />
                <span className="truncate">{e.label}</span>
                {on && <span className="ml-auto text-[8px] text-primary">●</span>}
              </button>
            )
          })}
        </div>
        {/* controls of the selected effect */}
        <div className="flex-1 min-w-0 space-y-2.5 overflow-y-auto zphoto-scroll pr-1">
          {!current?.enabled ? (
            <div className="text-[11px] text-muted-foreground py-6 text-center border border-dashed rounded-md">
              {EFFECTS.find(e => e.key === selected)?.hint}
              <br />Enable the checkbox to edit {EFFECTS.find(e => e.key === selected)?.label}.
            </div>
          ) : (
            controls.map(c => (
              <ControlRenderer
                key={c.key}
                control={c}
                value={current[c.key]}
                onChange={(v: any) => patch(selected, c.key, v)}
              />
            ))
          )}
          {selected === 'stroke' && current?.enabled && (
            <p className="text-[10px] text-muted-foreground pt-1">
              Outside stroke traces the silhouette; Inside stroke insets from the edges.
            </p>
          )}
        </div>
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <span className="text-[10px] text-muted-foreground mr-auto self-center">
          {enabledCount ? `${enabledCount} effect${enabledCount > 1 ? 's' : ''} active · live preview` : 'No effects enabled'}
        </span>
        <Button variant="secondary" size="sm" onClick={reset}>Clear All</Button>
        <Button variant="secondary" size="sm" onClick={cancel}>Cancel</Button>
        <Button size="sm" onClick={commit}>OK</Button>
      </DialogFooter>
    </>
  )
}

// re-exported types used by menus/panels (avoids circular type gymnastics)
export type { ShadowFX, GlowFX, StrokeFX, ColorOverlayFX }
