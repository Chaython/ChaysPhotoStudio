'use client'
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TOOL_MAP } from '../../constants/tools'
import { useEditorStore } from '../../store'
import type { ControlDef, ToolId } from '../../types'
import { BrushTipPicker } from './brush-tip-picker'
import { cn } from '@/lib/utils'
import * as gradientPresets from '../../plugins/gradient-presets'
import { cleanMixerBrush, loadMixerBrushFromForeground } from '../../tools/mixer-brush'

/** fixed-height vertical divider — shadcn Separator stretches h-full which
 *  breaks in a wrapping flex row, so the options bar uses plain divs */
function VDivider({ className }: { className?: string }) {
  return <div aria-hidden className={cn('h-5 w-px bg-border shrink-0', className)} />
}

const COLLAPSE_KEY = 'zphoto-optionsbar-collapsed'

function loadCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
}

export function ToolOptionsBar({ embedded = false, mobile = false }: { embedded?: boolean; mobile?: boolean }) {
  const activeTool = useEditorStore(s => s.activeTool)
  const opts = useEditorStore(s => s.toolOptions[s.activeTool])
  const setToolOption = useEditorStore(s => s.setToolOption)
  const def = TOOL_MAP[activeTool as ToolId]
  const [collapsed, setCollapsed] = useState(loadCollapsed)

  if (!def) return null

  const hasControls = def.options.length > 0

  const toggleCollapsed = () => {
    setCollapsed(v => {
      const next = !v
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* noop */ }
      return next
    })
  }

  return (
    // Expanded: wraps to its full natural height so every setting stays visible.
    // Collapsed (chevron): one slim row — extra controls swipe horizontally.
    // Below md the bar is always the single-row swipe strip (mobile overlay
    // scrollbars + no room to wrap anyway).
    <div className={cn('flex bg-panel flex-shrink-0 min-w-0', !embedded && 'border-b', embedded && 'h-full')}>
      <div
        className={cn(
          'flex items-center gap-x-3 gap-y-1.5 px-3 py-1.5 min-w-0 flex-1 min-h-9',
          mobile
            ? 'flex-nowrap overflow-x-auto zphoto-scroll min-h-12 py-2 [&_button]:min-h-9 [&_input]:min-h-9 [&_[role=combobox]]:min-h-9 [&_[role=slider]]:min-h-7'
            : (collapsed ? 'flex-nowrap overflow-x-auto zphoto-scroll' : 'flex-wrap'),
          !mobile && 'max-md:flex-nowrap max-md:overflow-x-auto max-md:zphoto-scroll',
          embedded && 'content-start overflow-auto'
        )}
        role="group"
        aria-label="Tool options"
      >
        <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap pr-1">
          {def.label}
        </span>
        <VDivider />
        {(activeTool === 'brush' || activeTool === 'eraser') && (
          <>
            <BrushTipPicker tool={activeTool} />
            <VDivider />
          </>
        )}
        {hasControls ? (
          def.options.map(c => (
            <ControlRenderer
              key={c.key}
              control={c}
              value={opts?.[c.key] ?? def.defaults[c.key]}
              onChange={v => setToolOption(activeTool, c.key, v)}
            />
          ))
        ) : (
          <span className="text-[11px] text-muted-foreground">No options</span>
        )}
      </div>
      {/* minimize / expand — the whole point of the collapsed mode is reclaiming
          canvas space; hidden below md where the bar is already a single row */}
      {!mobile && <div className="hidden md:flex items-center px-1 flex-shrink-0 border-l border-border/60">
        <button
          type="button"
          className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand tool options' : 'Minimize tool options'}
          aria-label={collapsed ? 'Expand tool options' : 'Minimize tool options'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>}
    </div>
  )
}

type ToolGradientStop = { pos: number; color: string; opacity: number }

function GradientToolStopsControl({ value, onChange }: { value: unknown; onChange: (v: ToolGradientStop[]) => void }) {
  const [, setPresetVersion] = useState(0)
  useEffect(() => gradientPresets.onChange(() => setPresetVersion(v => v + 1)), [])
  const presets = gradientPresets.list()

  const initial: ToolGradientStop[] = Array.isArray(value) && value.length >= 2
    ? value.map((s: any) => ({
        pos: Math.min(1, Math.max(0, Number(s?.pos) || 0)),
        color: typeof s?.color === 'string' ? s.color : '#ffffff',
        opacity: Math.min(100, Math.max(0, Number(s?.opacity ?? 100))),
      }))
    : [
        { pos: 0, color: '#000000', opacity: 100 },
        { pos: 0.5, color: '#808080', opacity: 100 },
        { pos: 1, color: '#ffffff', opacity: 100 },
      ]
  const stops = [...initial].sort((a, b) => a.pos - b.pos)
  const [selected, setSelected] = useState(0)
  const sel = Math.min(Math.max(0, selected), stops.length - 1)
  const current = stops[sel]
  const css = `linear-gradient(to right, ${stops.map(s => {
    const alpha = Math.round(s.opacity * 2.55).toString(16).padStart(2, '0')
    return `${s.color}${alpha} ${(s.pos * 100).toFixed(1)}%`
  }).join(', ')})`

  const replaceStop = (patch: Partial<ToolGradientStop>) => {
    const updated = { ...stops[sel], ...patch }
    const next = stops.map((s, i) => i === sel ? updated : s).sort((a, b) => a.pos - b.pos)
    onChange(next)
    setSelected(Math.max(0, next.indexOf(updated)))
  }

  const addStop = () => {
    if (stops.length >= 16) return
    const pos = current
      ? Math.min(.99, Math.max(.01, current.pos + .1))
      : .5
    const next = [...stops, { pos, color: current?.color ?? '#e8a33d', opacity: current?.opacity ?? 100 }]
      .sort((a, b) => a.pos - b.pos)
    onChange(next)
    setSelected(next.findIndex(s => Math.abs(s.pos - pos) < 1e-6))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-6 w-28 rounded border border-border px-1.5 text-left text-[10px] hover:bg-accent"
          title="Edit gradient color and opacity stops"
        >
          <span className="block h-3.5 w-full rounded-sm border border-black/20" style={{ background: css }} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="z-[100] w-80 p-3">
        <div className="mb-2 text-xs font-medium">Gradient Editor</div>
        <div className="relative mb-4 h-8 rounded border border-border" style={{ background: css }}>
          {stops.map((s, i) => (
            <button
              key={`${i}:${s.pos}`}
              type="button"
              aria-label={`Gradient stop ${i + 1}`}
              onClick={() => setSelected(i)}
              className="absolute -bottom-2 h-4 w-4 -translate-x-1/2 rotate-45 border-2 shadow-sm"
              style={{
                left: `${s.pos * 100}%`,
                backgroundColor: s.color,
                borderColor: i === sel ? 'var(--primary)' : 'var(--border)',
                opacity: Math.max(.25, s.opacity / 100),
              }}
            />
          ))}
        </div>

        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[10px]">
          <span>Position</span>
          <Slider
            value={[current?.pos ?? 0]}
            min={0}
            max={1}
            step={0.005}
            onValueChange={v => replaceStop({ pos: v[0] })}
          />
          <span className="w-10 text-right font-mono">{Math.round((current?.pos ?? 0) * 100)}%</span>

          <span>Opacity</span>
          <Slider
            value={[current?.opacity ?? 100]}
            min={0}
            max={100}
            step={1}
            onValueChange={v => replaceStop({ opacity: v[0] })}
          />
          <span className="w-10 text-right font-mono">{Math.round(current?.opacity ?? 100)}%</span>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <select
            className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-[10px]"
            defaultValue=""
            onChange={e => {
              const preset = gradientPresets.getById(e.target.value)
              if (!preset) return
              const next = preset.stops.slice(0, 16).map(s => ({
                pos: Math.min(1, Math.max(0, s.pos)),
                color: `#${[s.r, s.g, s.b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`,
                opacity: Math.round(Math.min(1, Math.max(0, s.a)) * 100),
              }))
              if (next.length >= 2) {
                onChange(next)
                setSelected(0)
              }
              e.currentTarget.value = ''
            }}
            aria-label="Imported gradient preset"
          >
            <option value="">Imported gradient…</option>
            {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            type="button"
            className="h-7 rounded border border-border px-2 text-[10px] hover:bg-accent"
            onClick={async () => {
              const preset = await gradientPresets.importGimpGradientFile()
              if (!preset) return
              const next = preset.stops.slice(0, 16).map(s => ({
                pos: Math.min(1, Math.max(0, s.pos)),
                color: `#${[s.r, s.g, s.b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`,
                opacity: Math.round(Math.min(1, Math.max(0, s.a)) * 100),
              }))
              if (next.length >= 2) onChange(next)
            }}
          >
            Import .ggr
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            type="color"
            value={current?.color ?? '#ffffff'}
            onChange={e => replaceStop({ color: e.target.value })}
            className="h-7 w-9 rounded border bg-transparent p-0"
            aria-label="Gradient stop color"
          />
          <Input
            value={current?.color ?? '#ffffff'}
            onChange={e => {
              const v = e.target.value.trim()
              if (/^#[0-9a-f]{6}$/i.test(v)) replaceStop({ color: v })
            }}
            className="h-7 flex-1 font-mono text-[10px]"
            aria-label="Gradient stop hex color"
          />
          <button type="button" onClick={addStop} className="h-7 rounded border border-border px-2 hover:bg-accent" title="Add stop">
            <Plus size={12} />
          </button>
          <button
            type="button"
            disabled={stops.length <= 2}
            onClick={() => {
              if (stops.length <= 2) return
              const next = stops.filter((_, i) => i !== sel)
              onChange(next)
              setSelected(Math.min(sel, next.length - 1))
            }}
            className="h-7 rounded border border-border px-2 hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
            title="Remove stop"
          >
            <Trash2 size={12} />
          </button>
        </div>
        <div className="mt-2 text-[9px] text-muted-foreground">
          Up to 16 independent color/opacity stops. Select a diamond, then adjust position, opacity, or color.
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ControlRenderer({ control, value, onChange, compact = true }: {
  control: ControlDef
  value: any
  onChange: (v: any) => void
  compact?: boolean
}) {
  const label = (
    <span className="text-[11px] text-muted-foreground whitespace-nowrap" title={control.hint}>
      {control.label}
    </span>
  )
  switch (control.type) {
    case 'slider':
    case 'angle': {
      const isAngle = control.type === 'angle'
      return (
        <div className="flex items-center gap-2 shrink-0 h-7">
          {label}
          <Slider
            value={[typeof value === 'number' ? value : (control.min ?? 0)]}
            min={control.min ?? 0}
            max={control.max ?? 100}
            step={control.step ?? 1}
            onValueChange={v => onChange(v[0])}
            className={cn('w-20', isAngle && 'w-24')}
          />
          <Input
            type="number"
            value={typeof value === 'number' ? Math.round(value * 100) / 100 : ''}
            min={control.min}
            max={control.max}
            step={control.step}
            onChange={e => {
              const n = Number(e.target.value)
              if (!Number.isNaN(n)) onChange(n)
            }}
            className="h-6 w-14 text-[11px] font-mono px-1"
          />
          {control.unit && <span className="text-[10px] text-muted-foreground">{control.unit}</span>}
        </div>
      )
    }
    case 'number':
      return (
        <div className="flex items-center gap-2 shrink-0 h-7">
          {label}
          <Input
            type="number"
            value={typeof value === 'number' ? value : ''}
            min={control.min}
            max={control.max}
            step={control.step}
            onChange={e => onChange(Number(e.target.value))}
            className="h-6 w-16 text-[11px] font-mono px-1"
          />
        </div>
      )
    case 'select':
      return (
        <div className="flex items-center gap-2 shrink-0 h-7">
          {label}
          <Select value={String(value)} onValueChange={v => onChange(v)}>
            {/* h-6! — the base data-[size=default]:h-9 out-specifies a plain h-6,
                making triggers 36px tall (they overflowed fixed-height bars) */}
            <SelectTrigger className="h-6! w-28 px-1.5 py-0.5 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-50 max-h-72">
              {!control.options?.some(o => String(o.value) === String(value)) && String(value).startsWith('user:') && (
                <SelectItem value={String(value)} className="text-[11px]">Imported Pattern</SelectItem>
              )}
              {control.options?.map(o => (
                <SelectItem key={String(o.value)} value={String(o.value)} className="text-[11px]">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    case 'toggle':
      return (
        <div className="flex items-center gap-1.5 shrink-0 h-7">
          <Switch checked={!!value} onCheckedChange={v => onChange(v)} className="scale-75 data-[state=checked]:bg-primary" />
          {label}
        </div>
      )
    case 'custom':
      if (control.customId === 'gradient-tool-stops') {
        return (
          <div className="flex items-center gap-2 shrink-0 h-7">
            {label}
            <GradientToolStopsControl value={value} onChange={onChange} />
          </div>
        )
      }
      if (control.customId === 'mixer-brush-actions') {
        return (
          <div className="flex items-center gap-1 shrink-0 h-7">
            {label}
            <button
              type="button"
              className="h-6 rounded border border-border px-2 text-[10px] hover:bg-accent"
              onClick={() => loadMixerBrushFromForeground()}
              title="Load the Mixer Brush reservoir with the foreground color"
            >
              Load
            </button>
            <button
              type="button"
              className="h-6 rounded border border-border px-2 text-[10px] hover:bg-accent"
              onClick={() => cleanMixerBrush()}
              title="Clean the Mixer Brush reservoir; the next stroke starts by picking up canvas color"
            >
              Clean
            </button>
          </div>
        )
      }
      if (control.customId === 'select-and-mask') {
        return (
          <button
            type="button"
            className="h-6 shrink-0 rounded border border-primary/40 bg-primary/10 px-2.5 text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors"
            onClick={() => useEditorStore.getState().openDialog('select-mask')}
            title={control.hint || 'Open Select & Mask'}
          >
            Select & Mask…
          </button>
        )
      }
      return null
    case 'color':
      return (
        <div className="flex items-center gap-2 shrink-0 h-7">
          {label}
          <input
            type="color"
            value={value ?? '#ffffff'}
            onChange={e => onChange(e.target.value)}
            className="w-7 h-6 rounded border bg-transparent cursor-pointer p-0"
            aria-label={control.label}
          />
        </div>
      )
    default:
      return null
  }
}
