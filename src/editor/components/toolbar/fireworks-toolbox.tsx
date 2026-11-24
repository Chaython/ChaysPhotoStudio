'use client'
// ============================================================
// Fireworks Expanded Mode toolbox
//
// The classic Fireworks toolbox is a narrow, two-column palette with category
// labels (Select, Bitmap, Vector, Web, Colors, View) instead of a single
// vertical rail. The tools are the same registered editor tools; this component
// only changes their grouping and presentation. The "Tools" caption opens the
// remaining registered tools so nothing is unreachable from the compact palette.
// ============================================================
import * as Icons from 'lucide-react'
import { useMemo } from 'react'
import { TOOL_MAP } from '../../constants/tools'
import { useEditorStore } from '../../store'
import { setActiveTool } from '../../tools/registry'
import type { ToolId } from '../../types'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ToolIcon } from './tool-icons'
import { ToolClusterMenu } from './toolbar'

interface FireworksToolGroup {
  label: string
  tools: readonly ToolId[]
}

const FIREWORKS_TOOL_GROUPS: readonly FireworksToolGroup[] = [
  {
    label: 'Select',
    tools: ['move', 'path-select', 'direct-select', 'crop', 'marquee-rect', 'marquee-ellipse', 'lasso', 'polygon-lasso', 'magic-wand', 'quick-select', 'object-select'],
  },
  {
    label: 'Bitmap',
    tools: ['brush', 'pencil', 'eraser', 'blur', 'sharpen', 'dodge', 'burn', 'smudge', 'clone-stamp', 'paint-bucket', 'gradient', 'eyedropper'],
  },
  {
    label: 'Vector',
    tools: ['pen', 'pen-freeform', 'pen-curvature', 'shape', 'text'],
  },
  {
    label: 'Web',
    tools: ['slice', 'slice-select', 'hotspot', 'frame', 'artboard', 'count'],
  },
  // Fireworks places the fill/stroke swatches between the Web and View groups.
  { label: 'Colors', tools: [] },
  {
    label: 'View',
    tools: ['hand', 'zoom', 'rotate-view', 'measure'],
  },
]

const PALETTE_TOOL_IDS = new Set<ToolId>(FIREWORKS_TOOL_GROUPS.flatMap(group => group.tools))
const MORE_TOOLS = Object.values(TOOL_MAP)
  .filter(tool => !PALETTE_TOOL_IDS.has(tool.id))
  .sort((a, b) => a.label.localeCompare(b.label))

/** live shortcut labels (reflects user overrides) */
function useToolKeys(): Record<ToolId, string> {
  const overrides = useEditorStore(s => s.shortcutOverrides)
  return useMemo(() => {
    const out = {} as Record<ToolId, string>
    for (const id of Object.keys(TOOL_MAP) as ToolId[]) {
      out[id] = (overrides?.[`tool:${id}`] || TOOL_MAP[id].shortcut || '?').toLowerCase()
    }
    return out
  }, [overrides])
}

export function FireworksToolbox() {
  const activeTool = useEditorStore(s => s.activeTool)
  const setTool = useEditorStore(s => s.setTool)
  const keys = useToolKeys()

  const selectTool = (id: ToolId) => {
    setTool(id)
    setActiveTool(id)
  }

  return (
    <div
      data-fireworks-toolbox
      data-toolbar-mode="fireworks"
      role="toolbar"
      aria-label="Fireworks toolbox"
      className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-panel"
    >
      <div className="shrink-0 border-b border-border/70 px-1 py-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-6 w-full items-center justify-between gap-1 rounded px-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent hover:text-foreground"
              title="More tools"
              aria-label="More tools"
            >
              <span>Tools</span>
              <Icons.ChevronDown size={11} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="z-[95] max-h-[70vh] min-w-56 overflow-y-auto">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground select-none">
              More tools
            </div>
            {MORE_TOOLS.map(tool => (
              <DropdownMenuItem key={tool.id} onSelect={() => selectTool(tool.id)} className="gap-2 text-xs">
                <ToolIcon icon={tool.icon} toolId={tool.id} />
                <span className="flex-1">{tool.label}</span>
                {tool.id === activeTool && <Icons.Check size={11} className="text-primary" />}
                <span className="font-mono text-[10px] text-muted-foreground">{keys[tool.id].toUpperCase()}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-[10px] text-muted-foreground">
              Palette tools are grouped in the toolbox above.
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden zphoto-scroll">
        {FIREWORKS_TOOL_GROUPS.map(group => {
          if (group.label === 'Colors') return <FireworksColorsSection key="colors" />
          const tools = group.tools.map(id => TOOL_MAP[id]).filter(Boolean)
          if (!tools.length) return null
          return (
            <section key={group.label} className="border-b border-border/50 px-1 pb-0.5" aria-label={`${group.label} tools`}>
              <div className="px-1 pb-0.5 pt-0.5 text-[9px] font-medium uppercase leading-3 tracking-wide text-muted-foreground">
                {group.label}
              </div>
              <div className="grid grid-cols-2 justify-items-stretch gap-0.5">
                {tools.map(tool => (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => selectTool(tool.id)}
                    title={`${tool.label}${keys[tool.id] ? ` (${keys[tool.id].toUpperCase()})` : ''}`}
                    aria-label={tool.label}
                    aria-pressed={activeTool === tool.id}
                    className={cn(
                      'flex h-[22px] min-w-0 items-center justify-center rounded-sm border transition-colors',
                      activeTool === tool.id
                        ? 'border-primary/60 bg-primary/15 text-primary'
                        : 'border-transparent text-foreground/85 hover:border-border hover:bg-accent',
                    )}
                  >
                    <ToolIcon icon={tool.icon} toolId={tool.id} size={14} />
                  </button>
                ))}
              </div>
            </section>
          )
        })}
      </div>

      <div className="flex shrink-0 items-center justify-center border-t border-border/60 px-1 py-1" aria-label="Toolbox groups">
        <ToolClusterMenu showLabel />
      </div>
    </div>
  )
}

function FireworksColorsSection() {
  const fg = useEditorStore(s => s.fgColor)
  const bg = useEditorStore(s => s.bgColor)
  const setFg = useEditorStore(s => s.setFgColor)
  const setBg = useEditorStore(s => s.setBgColor)
  const setTarget = useEditorStore(s => s.setActiveColorTarget)
  const swap = useEditorStore(s => s.swapColors)

  return (
    <section className="border-b border-border/50 px-1 pb-0.5" aria-label="Colors">
      <div className="px-1 pb-0.5 pt-0.5 text-[9px] font-medium uppercase leading-3 tracking-wide text-muted-foreground">Colors</div>
      <div className="flex items-center justify-between gap-1 px-1">
        <div className="relative h-9 w-11" aria-label="Fill and stroke colors">
          <label
            className="absolute left-0 top-0 z-10 h-6 w-6 cursor-pointer rounded-sm border-2 border-foreground/70 shadow-sm"
            style={{ backgroundColor: fg }}
            title="Fill color — click to choose"
          >
            <input
              type="color"
              value={fg}
              onFocus={() => setTarget('fg')}
              onChange={event => { setTarget('fg'); setFg(event.target.value) }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Fill color picker"
            />
          </label>
          <label
            className="absolute bottom-0 right-0 h-6 w-6 cursor-pointer rounded-sm border-2 border-foreground/50 shadow-sm"
            style={{ backgroundColor: bg }}
            title="Stroke color — click to choose"
          >
            <input
              type="color"
              value={bg}
              onFocus={() => setTarget('bg')}
              onChange={event => { setTarget('bg'); setBg(event.target.value) }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Stroke color picker"
            />
          </label>
        </div>
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => { setFg('#000000'); setBg('#ffffff') }}
            className="h-4 w-5 rounded-sm border border-border text-[10px] leading-none hover:bg-accent"
            title="Default fill and stroke colors"
            aria-label="Default fill and stroke colors"
          >↙</button>
          <button
            type="button"
            onClick={swap}
            className="flex h-4 w-5 items-center justify-center rounded-sm border border-border hover:bg-accent"
            title="Swap fill and stroke colors"
            aria-label="Swap fill and stroke colors"
          >
            <Icons.ArrowLeftRight size={10} />
          </button>
        </div>
      </div>
    </section>
  )
}
