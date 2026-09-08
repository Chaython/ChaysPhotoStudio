'use client'
// ============================================================
// BrushTipPicker — compact popover tip picker for the options bar
// (Task 1-A). Rendered for the brush AND eraser tools.
//   · grid of procedural tips from tools/brush-tips.ts (TIP_DEFS),
//     each tile = the tip's cached preview() canvas; selected tip
//     gets the amber ring (ring-primary).
//   · selecting a procedural tip writes `tip`, clears `stampId` +
//     the active image preset, and applies the tip's default
//     spacing/hardness/flow (+ roundness/angle when the tip
//     overrides them, e.g. the calligraphy nib).
//   · "Imported" section (brush only — the eraser has no image
//     stamps): live list of GIMP .gbr presets from brush-presets,
//     clicking one sets `stampId` (resolveStamp wins over the tip),
//     "None (procedural)" returns to the procedural tip, and
//     "Import .gbr…" runs importGimpBrushFile(). The list reacts to
//     brushPresets.onChange so imports appear live.
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { ChevronDown, Upload, Shapes } from 'lucide-react'
import { useEditorStore } from '../../store'
import { TIP_DEFS, ERASER_TIP_IDS, getTip } from '../../tools/brush-tips'
import * as brushPresets from '../../plugins/brush-presets'
import { cn } from '@/lib/utils'

/** option keys the picker applies from TipDef.defaults */
const DEFAULT_KEYS = ['spacing', 'hardness', 'flow', 'roundness', 'angle'] as const

/** small canvas rendering the tip's cached preview() */
function TipThumb({ tipId, size = 26 }: { tipId: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const cv = ref.current
    const def = getTip(tipId)
    if (!cv || !def) return
    const c = cv.getContext('2d')
    if (!c) return
    const src = def.preview(size)
    c.clearRect(0, 0, size, size)
    c.drawImage(src, 0, 0)
  }, [tipId, size])
  return <canvas ref={ref} width={size} height={size} className="block" aria-hidden />
}

export function BrushTipPicker({ tool }: { tool: 'brush' | 'eraser' }) {
  const [open, setOpen] = useState(false)
  // re-render when brush presets change (imports/removals anywhere in the app)
  const [, force] = useState(0)
  const opts = useEditorStore(s => s.toolOptions[tool]) ?? {}
  const setToolOption = useEditorStore(s => s.setToolOption)

  useEffect(() => brushPresets.onChange(() => force(n => n + 1)), [])

  const tips = tool === 'eraser'
    ? TIP_DEFS.filter(t => ERASER_TIP_IDS.includes(t.id))
    : TIP_DEFS

  const tipId = typeof opts.tip === 'string' && getTip(opts.tip)
    ? (tool === 'eraser' ? (ERASER_TIP_IDS.includes(opts.tip) ? opts.tip : 'round-soft') : opts.tip)
    : 'round-soft'
  const tipDef = getTip(tipId)!

  // current image stamp (brush only): opts.stampId ?? active preset
  const stampId = tool === 'brush'
    ? (typeof opts.stampId === 'string' && opts.stampId ? opts.stampId : brushPresets.getActiveId())
    : null
  const preset = stampId ? brushPresets.getById(stampId) : null
  const presetList = tool === 'brush' ? brushPresets.list() : []

  function selectTip(id: string) {
    const def = getTip(id)
    setToolOption(tool, 'tip', id)
    setToolOption(tool, 'stampId', null)
    brushPresets.setActive(null) // back to procedural painting
    if (def) {
      for (const key of DEFAULT_KEYS) {
        if (def.defaults[key] !== undefined) setToolOption(tool, key, def.defaults[key])
      }
    }
    setOpen(false)
  }

  function selectPreset(id: string) {
    setToolOption(tool, 'stampId', id)
    brushPresets.setActive(id)
    void brushPresets.warmPreset(id) // decode so the first stroke paints with it
    setOpen(false)
  }

  function clearPreset() {
    setToolOption(tool, 'stampId', null)
    brushPresets.setActive(null)
    setOpen(false)
  }

  async function importBrush() {
    const p = await brushPresets.importGimpBrushFile()
    if (p) setToolOption(tool, 'stampId', p.id) // addBrushPreset already made it active
  }

  const label = preset ? preset.name : tipDef.label

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Brush tip"
          title={`Tip: ${label}`}
          className="flex items-center gap-1 h-7 px-1 rounded hover:bg-accent/50 transition-colors shrink-0"
        >
          {preset?.dataURL ? (
            <img src={preset.dataURL} alt="" className="size-5 object-contain" />
          ) : (
            <span className="size-5 flex items-center justify-center">
              <TipThumb tipId={tipId} size={20} />
            </span>
          )}
          <span className="text-[11px] text-muted-foreground max-w-[96px] truncate hidden sm:inline">
            {label}
          </span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2 z-50">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pb-1">
          Tip
        </div>
        <div className="grid grid-cols-5 gap-1">
          {tips.map(t => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              aria-label={t.label}
              onClick={() => selectTip(t.id)}
              className={cn(
                'size-8 rounded flex items-center justify-center bg-background/60 hover:bg-accent/40 transition-colors',
                t.id === tipId && !preset && 'ring-2 ring-primary',
              )}
            >
              <TipThumb tipId={t.id} size={26} />
            </button>
          ))}
        </div>

        {tool === 'brush' && (
          <>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pt-2.5 pb-1">
              Imported
            </div>
            <div className="max-h-36 overflow-y-auto zphoto-scroll rounded bg-background/40 space-y-0.5">
              <button
                type="button"
                onClick={clearPreset}
                className={cn(
                  'w-full flex items-center gap-2 h-7 px-1.5 rounded text-[11px] text-left hover:bg-accent/40 transition-colors',
                  !preset && 'text-primary',
                )}
              >
                <span className="size-5 rounded border border-dashed border-muted-foreground/60 flex items-center justify-center shrink-0">
                  <Shapes className="size-3" />
                </span>
                <span className="truncate">None (procedural)</span>
              </button>
              {presetList.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPreset(p.id)}
                  title={`${p.name} — spacing ${p.spacing}%`}
                  className={cn(
                    'w-full flex items-center gap-2 h-7 px-1.5 rounded text-[11px] text-left hover:bg-accent/40 transition-colors',
                    preset?.id === p.id && 'bg-primary/15 text-primary',
                  )}
                >
                  {p.dataURL ? (
                    <img src={p.dataURL} alt="" className="size-5 object-contain shrink-0" />
                  ) : (
                    <span className="size-5 shrink-0" />
                  )}
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void importBrush()}
              className="mt-2 w-full h-7 rounded border border-border/80 flex items-center justify-center gap-1.5 text-[11px] hover:bg-accent/40 transition-colors"
            >
              <Upload className="size-3" />
              Import .gbr…
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
