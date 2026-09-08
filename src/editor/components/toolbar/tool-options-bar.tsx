'use client'
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { TOOL_MAP } from '../../constants/tools'
import { useEditorStore } from '../../store'
import type { ControlDef, ToolId } from '../../types'
import { BrushTipPicker } from './brush-tip-picker'
import { cn } from '@/lib/utils'

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

export function ToolOptionsBar() {
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
    <div className="flex bg-panel border-b flex-shrink-0">
      <div
        className={cn(
          'flex items-center gap-x-3 gap-y-1.5 px-3 py-1.5 min-w-0 flex-1 min-h-9',
          collapsed ? 'flex-nowrap overflow-x-auto zphoto-scroll' : 'flex-wrap',
          'max-md:flex-nowrap max-md:overflow-x-auto max-md:zphoto-scroll'
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
      <div className="hidden md:flex items-center px-1 flex-shrink-0 border-l border-border/60">
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
      </div>
    </div>
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
