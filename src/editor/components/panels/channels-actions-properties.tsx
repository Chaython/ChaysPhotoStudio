'use client'
// ============================================================
// Channels / Adjustments / Actions / Properties panels — TASK 2-C
// Channels: live thumbnails, save selection as channel, luminosity masks
// Actions: full manager (record, play, rename, duplicate, export/import)
// Properties: Blend-If editor, smart filters, live adjustment params
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { getFlatComposite, invalidateFlat } from '../../engine/document'
import { ADJUSTMENT_ICONS } from '../../constants/tools'
import { getImageData, uid, downloadBlob, clamp } from '../../utils/canvas'
import { ADJUSTMENTS, FILTERS, listLuts, getLut, parseCube, sampleLUT } from '../../image-ops'
import { PanelBtn } from './layers-panel'
import { ControlRenderer } from '../toolbar/tool-options-bar'
import { cn } from '@/lib/utils'
import { FancyScroll } from '@/components/ui/fancy-scroll'
import type {
  AdjustmentType, BlendIfSettings, BlendIfSlider, ChannelView, FilterType, PsAction,
} from '../../types'

// ================= Channels =================
const CHANNELS = [
  { id: 'rgb', label: 'RGB', desc: 'Composite' },
  { id: 'r', label: 'R', desc: 'Red' },
  { id: 'g', label: 'G', desc: 'Green' },
  { id: 'b', label: 'B', desc: 'Blue' },
] as const

/** Build a luminosity selection mask from the flat composite (alpha carries the mask value). */
function buildLuminosityMask(mode: 'lights' | 'darks' | 'midtones'): Uint8ClampedArray | null {
  const doc = engine.activeDoc
  if (!doc) return null
  const flat = getFlatComposite(doc)
  const img = getImageData(flat)
  const d = img.data
  const out = new Uint8ClampedArray(doc.width * doc.height)
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    const lum = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]
    out[i] = mode === 'lights' ? lum : mode === 'darks' ? 255 - lum : Math.abs(lum - 128) * 2
  }
  return out
}

function loadLumMask(mode: 'lights' | 'darks' | 'midtones') {
  const mask = buildLuminosityMask(mode)
  if (!mask) return
  const label = mode === 'lights' ? 'Luminosity Mask — Lights' : mode === 'darks' ? 'Luminosity Mask — Darks' : 'Luminosity Mask — Midtones'
  engine.setSelectionAlpha(mask, 'new', label)
}

export function ChannelsPanel() {
  const tick = useEditorStore(s => s.renderTick)
  const channelView = useEditorStore(s => s.channelView)
  const savedChannels = useEditorStore(s => s.savedChannels)
  const hasSelection = useEditorStore(s => s.hasSelection)
  const refs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const suppressClick = useRef(false)

  // live channel thumbnails (re-drawn each renderTick)
  useEffect(() => {
    const doc = engine.activeDoc
    if (!doc) return
    const flat = getFlatComposite(doc)
    const img = getImageData(flat)
    const d = img.data
    for (const ch of CHANNELS) {
      const c = refs.current[ch.id]
      if (!c) continue
      const ctx = c.getContext('2d')!
      const out = ctx.createImageData(c.width, c.height)
      const sx = c.width / doc.width, sy = c.height / doc.height
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const si = Math.min(doc.height - 1, Math.round(y / sy)) * doc.width + Math.min(doc.width - 1, Math.round(x / sx))
          const val = ch.id === 'rgb'
            ? 0.299 * d[si * 4] + 0.587 * d[si * 4 + 1] + 0.114 * d[si * 4 + 2]
            : d[si * 4 + (ch.id === 'r' ? 0 : ch.id === 'g' ? 1 : 2)]
          const o = (y * c.width + x) * 4
          out.data[o] = val; out.data[o + 1] = val; out.data[o + 2] = val; out.data[o + 3] = 255
        }
      }
      ctx.putImageData(out, 0, 0)
    }
  }, [tick])

  const soloChannel = (id: ChannelView) => {
    engine.setChannelView(channelView === id ? 'rgb' : id)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-2 py-1 text-[10px] text-muted-foreground border-b flex items-center gap-1.5">
        <Icons.MousePointerClick size={11} className="text-primary shrink-0" />
        <span>Ctrl/⌘+click a channel to load it as a selection</span>
      </div>

      <FancyScroll className="flex-1 min-h-0">
        {CHANNELS.map(ch => {
          const visible = channelView === 'rgb' || channelView === ch.id
          return (
            <div
              key={ch.id}
              role="button"
              tabIndex={0}
              aria-pressed={channelView === ch.id}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 cursor-pointer border-b border-border/30 group',
                channelView === ch.id ? 'bg-accent/60' : 'hover:bg-accent/25'
              )}
              onClick={() => { if (suppressClick.current) { suppressClick.current = false; return } engine.setChannelView(ch.id as ChannelView) }
              }
              onPointerDown={e => {
                if (e.ctrlKey || e.metaKey) {
                  e.preventDefault()
                  suppressClick.current = true
                  engine.loadChannelAsSelection(ch.id === 'rgb' ? 'luminosity' : (ch.id as any))
                }
              }}
              onKeyDown={e => { if (e.key === 'Enter') engine.setChannelView(ch.id as ChannelView) }}
            >
              {/* visibility eyeball */}
              <button
                className={cn('w-4 flex-shrink-0', visible ? 'text-foreground' : 'text-muted-foreground/40 hover:text-muted-foreground')}
                title={visible ? `Hide ${ch.label} (solo off)` : `Solo ${ch.label}`}
                onClick={e => { e.stopPropagation(); soloChannel(ch.id as ChannelView) }}
                aria-label={visible ? `Hide ${ch.label}` : `Show ${ch.label}`}
              >
                {visible ? <Icons.Eye size={13} /> : <Icons.EyeOff size={13} />}
              </button>

              <div className="w-8 h-8 rounded-sm border overflow-hidden bg-black flex-shrink-0">
                <canvas ref={el => { refs.current[ch.id] = el }} width={32} height={32} className="w-8 h-8" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium">{ch.label}</div>
                <div className="text-[9px] text-muted-foreground">{ch.desc}</div>
              </div>

              <button
                className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground p-1 transition-opacity"
                title={`Load ${ch.label} as selection`}
                onClick={e => { e.stopPropagation(); engine.loadChannelAsSelection(ch.id === 'rgb' ? 'luminosity' : (ch.id as any)) }}
              >
                <Icons.MousePointerClick size={12} />
              </button>
            </div>
          )
        })}

        {/* luminosity masks */}
        <div className="border-b border-border/30">
          <div className="px-2 pt-1.5 pb-1 flex items-center gap-1.5 bg-muted/20">
            <Icons.Spline size={13} className="text-primary shrink-0" />
            <span className="text-[11px] flex-1">Luminosity Masks</span>
          </div>
          <div className="grid grid-cols-4 gap-1 px-2 pb-2">
            <button
              className="text-[9px] py-1 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
              title="Load full luminosity as selection"
              onClick={() => engine.loadChannelAsSelection('luminosity')}
            >L</button>
            <button
              className="text-[9px] py-1 rounded bg-muted/40 hover:bg-primary/25 hover:text-primary transition-colors"
              title="Lights — select by luminance (bright = selected)"
              onClick={() => loadLumMask('lights')}
            >Light</button>
            <button
              className="text-[9px] py-1 rounded bg-muted/40 hover:bg-primary/25 hover:text-primary transition-colors"
              title="Darks — inverted luminance mask"
              onClick={() => loadLumMask('darks')}
            >Dark</button>
            <button
              className="text-[9px] py-1 rounded bg-muted/40 hover:bg-primary/25 hover:text-primary transition-colors"
              title="Midtones — excludes extremes"
              onClick={() => loadLumMask('midtones')}
            >Mid</button>
          </div>
        </div>

        {/* saved alpha channels */}
        {savedChannels.length > 0 && (
          <div className="px-2 pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Alpha</div>
        )}
        {savedChannels.map(ch => (
          <div key={ch.id} className="flex items-center gap-2 px-2 py-1.5 border-b border-border/30 hover:bg-accent/25 group">
            <SavedChannelThumb id={ch.id} />
            <span className="text-[11px] flex-1 truncate">{ch.name}</span>
            <button
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-1"
              title="Load channel as selection"
              onClick={() => engine.loadChannelAsSelection(ch.id)}
            ><Icons.MousePointerClick size={12} /></button>
            <button
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1"
              title="Delete channel"
              onClick={() => engine.deleteSavedChannel(ch.id)}
            ><Icons.Trash2 size={12} /></button>
          </div>
        ))}
      </FancyScroll>

      {/* footer */}
      <div className="flex items-center gap-0.5 p-1 border-t bg-panel/50">
        <PanelBtn
          title={hasSelection ? 'Save current selection as new channel' : 'No selection to save'}
          icon="Save"
          onClick={() => engine.saveSelectionChannel()}
        />
        <PanelBtn
          title="Load luminosity (L) as selection"
          icon="Spline"
          onClick={() => engine.loadChannelAsSelection('luminosity')}
        />
        <span className="flex-1" />
        <span className="text-[9px] text-muted-foreground pr-1">
          {savedChannels.length} alpha
        </span>
      </div>
    </div>
  )
}

function SavedChannelThumb({ id }: { id: string }) {
  const tick = useEditorStore(s => s.renderTick)
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const doc = engine.activeDoc
    const ch = doc?.savedChannels.find(c => c.id === id)
    const c = ref.current
    if (!doc || !ch || !c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(ch.mask, 0, 0, c.width, c.height)
    ctx.globalCompositeOperation = 'source-atop'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.globalCompositeOperation = 'source-over'
  }, [tick, id])
  return <div className="w-8 h-8 rounded-sm border overflow-hidden bg-black flex-shrink-0"><canvas ref={ref} width={32} height={32} className="w-8 h-8" /></div>
}

// ================= Adjustments (quick create) =================
const QUICK_ADJUSTMENTS: { type: AdjustmentType; label: string }[] = [
  { type: 'curves', label: 'Curves' },
  { type: 'levels', label: 'Levels' },
  { type: 'brightness-contrast', label: 'Brightness/Contrast' },
  { type: 'exposure', label: 'Exposure' },
  { type: 'vibrance', label: 'Vibrance' },
  { type: 'hue-saturation', label: 'Hue/Saturation' },
  { type: 'color-balance', label: 'Color Balance' },
  { type: 'black-white', label: 'Black & White' },
  { type: 'photo-filter', label: 'Photo Filter' },
  { type: 'color-lookup', label: 'Color Lookup' },
  { type: 'channel-mixer', label: 'Channel Mixer' },
  { type: 'selective-color', label: 'Selective Color' },
  { type: 'gradient-map', label: 'Gradient Map' },
  { type: 'posterize', label: 'Posterize' },
  { type: 'threshold', label: 'Threshold' },
  { type: 'invert', label: 'Invert' },
  { type: 'camera-raw', label: 'Camera Raw' },
]

export function AdjustmentsPanel() {
  return (
    <FancyScroll className="h-full" contentClassName="p-2 grid grid-cols-2 gap-1.5 content-start">
      {QUICK_ADJUSTMENTS.map(a => {
        const icon = ADJUSTMENT_ICONS[a.type] ?? 'Sliders'
        const Cmp = (Icons as any)[icon] ?? Icons.Sliders
        return (
          <button
            key={a.type}
            className="flex items-center gap-2 p-2 rounded-md border bg-muted/20 hover:bg-accent/40 hover:border-primary/40 transition-colors text-left"
            onClick={() => {
              engine.addAdjustmentLayer(a.type)
              useEditorStore.getState().setRightPanelTab('properties')
            }}
            title={`New ${a.label} adjustment layer`}
          >
            <Cmp size={14} className="text-primary shrink-0" />
            <span className="text-[10px] leading-tight">{a.label}</span>
          </button>
        )
      })}
    </FancyScroll>
  )
}

// ================= Actions =================
const OP_ICONS: Record<string, string> = {
  applyFilter: 'Sparkles', applyFilterComposite: 'Sparkles', applyAdjustment: 'Sliders',
  setAdjustmentParams: 'Sliders', addAdjustmentLayer: 'Sliders', invertAdjust: 'Contrast',
  fill: 'PaintBucket', contentAwareFill: 'Blend', crop: 'Crop', resizeImage: 'Scaling',
  addLayer: 'Layers', flatten: 'Combine', rotate: 'RotateCw', flipCanvas: 'FlipHorizontal',
}

function actionIcon(op: string) {
  return (Icons as any)[OP_ICONS[op] ?? 'Zap'] ?? Icons.Zap
}

export function ActionsPanel() {
  const actions = useEditorStore(s => s.actions)
  const recording = useEditorStore(s => s.recording)
  const tick = useEditorStore(s => s.renderTick)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  void tick

  // live recording mirror (private engine field; ops emit -> renderTick bumps)
  const liveAction: PsAction | null = recording ? ((engine as any).recordingAction ?? null) : null

  const persist = () => { (engine as any).persistActions?.() }

  const commitRename = (id: string, v: string) => {
    const name = v.trim()
    const a = engine.actions.find(x => x.id === id)
    if (a && name && name !== a.name) {
      a.name = name
      persist()
      engine.emit()
    }
    setRenaming(null)
  }

  const duplicateAction = (id: string) => {
    const src = engine.actions.find(x => x.id === id)
    if (!src) return
    engine.actions.push({
      id: uid(), name: `${src.name} copy`, created: Date.now(),
      steps: src.steps.map(s => ({ op: s.op, args: { ...s.args }, label: s.label })),
    })
    persist()
    engine.emit()
  }

  const exportActions = () => {
    if (!engine.actions.length) { useEditorStore.getState().pushToast('No actions to export', 'info'); return }
    const blob = new Blob(
      [JSON.stringify({ app: 'z-photo-studio', version: 1, actions: engine.actions }, null, 2)],
      { type: 'application/json' }
    )
    downloadBlob(blob, 'zphoto-actions.json')
    useEditorStore.getState().pushToast(`Exported ${engine.actions.length} action(s)`, 'success')
  }

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!f) return
    try {
      const data = JSON.parse(await f.text())
      const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.actions) ? data.actions : []
      let added = 0
      for (const item of list) {
        if (!item || typeof item.name !== 'string' || !Array.isArray(item.steps)) continue
        const steps = item.steps
          .filter((s: any) => s && typeof s.op === 'string' && typeof s.label === 'string')
          .map((s: any) => ({ op: s.op, args: (s.args && typeof s.args === 'object') ? s.args : {}, label: s.label }))
        engine.actions.push({ id: uid(), name: item.name, steps, created: typeof item.created === 'number' ? item.created : Date.now() })
        added++
      }
      persist()
      engine.emit()
      useEditorStore.getState().pushToast(added ? `Imported ${added} action(s)` : 'No valid actions found', added ? 'success' : 'error')
    } catch {
      useEditorStore.getState().pushToast('Invalid actions file', 'error')
    }
  }

  const requestDelete = (id: string) => {
    if (confirmDelete === id) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      setConfirmDelete(null)
      engine.deleteAction(id)
    } else {
      setConfirmDelete(id)
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      confirmTimer.current = setTimeout(() => setConfirmDelete(null), 2600)
    }
  }

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current) }, [])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* toolbar */}
      <div className="flex items-center gap-0.5 p-1 border-b">
        <PanelBtn
          title={recording ? 'Stop recording' : 'Record new action'}
          icon={recording ? 'Square' : 'Circle'}
          active={recording}
          onClick={() => { if (recording) { engine.stopRecording() } else { engine.startRecording() } }}
        />
        <PanelBtn
          title="Play last action"
          icon="Play"
          onClick={() => {
            if (!actions.length) { useEditorStore.getState().pushToast('Record an action first', 'info'); return }
            engine.playAction(actions[actions.length - 1])
          }}
        />
        <PanelBtn title="Batch play on files…" icon="FileStack" onClick={() => useEditorStore.getState().openDialog('batch')} />
        <span className="flex-1" />
        <PanelBtn title="Import actions (.json)" icon="Upload" onClick={() => importRef.current?.click()} />
        <PanelBtn title="Export all actions (.json)" icon="Download" onClick={exportActions} />
        <PanelBtn
          title="Delete all actions"
          icon="Trash2"
          danger
          onClick={() => {
            if (!actions.length) return
            for (const a of [...engine.actions]) engine.deleteAction(a.id)
          }}
        />
        <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={onImportFile} aria-label="Import actions file" />
      </div>

      {recording && (
        <div className="px-2 py-1 bg-destructive/10 text-destructive text-[10px] flex items-center gap-1.5 border-b">
          <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
          Recording… {liveAction?.steps.length ?? 0} step(s) — perform operations
        </div>
      )}

      <FancyScroll className="flex-1 min-h-0" role="list" aria-label="Actions">
        {actions.map(a => (
          <div key={a.id} className="border-b border-border/30">
            <div
              role="listitem"
              className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-accent/25 group"
              onClick={() => setExpanded(expanded === a.id ? null : a.id)}
            >
              <button className="text-muted-foreground p-0.5" aria-label={expanded === a.id ? 'Collapse' : 'Expand'}>
                {expanded === a.id ? <Icons.ChevronDown size={11} /> : <Icons.ChevronRight size={11} />}
              </button>
              {renaming === a.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(a.id, renameValue)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(a.id, renameValue)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  onClick={e => e.stopPropagation()}
                  className="flex-1 h-5 text-[11px] bg-background border rounded px-1 min-w-0"
                  aria-label="Action name"
                />
              ) : (
                <span
                  className="text-[11px] flex-1 truncate cursor-text"
                  title="Double-click to rename"
                  onDoubleClick={e => {
                    e.stopPropagation()
                    setRenaming(a.id); setRenameValue(a.name)
                  }}
                >{a.name}</span>
              )}
              <span className="text-[9px] text-muted-foreground shrink-0">{a.steps.length} st</span>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  className="p-0.5 text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Play on active document"
                  onClick={e => { e.stopPropagation(); engine.playAction(a) }}
                ><Icons.Play size={11} /></button>
                <button
                  className="p-0.5 text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Duplicate action"
                  onClick={e => { e.stopPropagation(); duplicateAction(a.id) }}
                ><Icons.Copy size={11} /></button>
                <button
                  className={cn(
                    'p-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-sm',
                    confirmDelete === a.id ? 'opacity-100 text-destructive bg-destructive/10' : 'text-muted-foreground hover:text-destructive'
                  )}
                  title={confirmDelete === a.id ? 'Click again to delete' : 'Delete action'}
                  onClick={e => { e.stopPropagation(); requestDelete(a.id) }}
                >
                  {confirmDelete === a.id ? <span className="text-[9px] px-0.5">Sure?</span> : <Icons.Trash2 size={11} />}
                </button>
              </div>
            </div>
            {expanded === a.id && (
              <div className="pb-1 pl-5 pr-2">
                {a.steps.map((st, i) => {
                  const OpIcon = actionIcon(st.op)
                  return (
                    <div key={i} className="text-[10px] text-muted-foreground py-0.5 flex items-center gap-1.5">
                      <OpIcon size={10} className="text-primary/70 shrink-0" />
                      <span className="truncate" title={st.label}>{st.label}</span>
                    </div>
                  )
                })}
                {!a.steps.length && <div className="text-[10px] text-muted-foreground/60 py-0.5">Empty action</div>}
              </div>
            )}
          </div>
        ))}

        {/* live recording steps */}
        {recording && liveAction && (
          <div className="border-b border-border/30 bg-destructive/5">
            <div className="px-2 py-1.5 flex items-center gap-1.5">
              <Icons.CircleDot size={11} className="text-destructive animate-pulse" />
              <span className="text-[11px] flex-1 truncate">{liveAction.name} (recording)</span>
              <span className="text-[9px] text-muted-foreground">{liveAction.steps.length} st</span>
            </div>
            <div className="pb-1 pl-5 pr-2">
              {liveAction.steps.map((st, i) => {
                const OpIcon = actionIcon(st.op)
                return (
                  <div key={i} className="text-[10px] text-muted-foreground py-0.5 flex items-center gap-1.5">
                    <OpIcon size={10} className="text-primary/70 shrink-0" />
                    <span className="truncate">{st.label}</span>
                  </div>
                )
              })}
              {!liveAction.steps.length && <div className="text-[10px] text-muted-foreground/60 py-0.5">Waiting for operations…</div>}
            </div>
          </div>
        )}

        {!actions.length && !recording && (
          <div className="p-4 text-[11px] text-muted-foreground text-center leading-relaxed">
            No actions yet.<br />
            Click <span className="text-destructive">●</span> to record operations,<br />
            then ▶ to replay them — or use<br />Batch for whole folders.
          </div>
        )}
      </FancyScroll>
    </div>
  )
}

// ================= Properties =================
export function PropertiesPanel() {
  const activeLayerId = useEditorStore(s => s.activeLayerId)
  const tick = useEditorStore(s => s.renderTick)
  const doc = engine.activeDoc
  const layer = doc?.layers.find(l => l.id === activeLayerId)
  void tick

  if (!doc) return <div className="p-4 text-[11px] text-muted-foreground">No document</div>
  if (!layer) return <div className="p-4 text-[11px] text-muted-foreground">No active layer</div>

  const isAdj = layer.kind === 'adjustment' && layer.adjustment
  const isText = layer.kind === 'text' && layer.text

  return (
    <FancyScroll className="h-full" contentClassName="p-3 space-y-3 text-[11px]">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Document</div>
        <div className="font-medium">{doc.name}</div>
        <div className="text-muted-foreground">{doc.width} × {doc.height} px · RGB/8 · {doc.layers.length} layers</div>
      </div>

      <div className="border-t pt-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Layer · {layer.kind}</div>
        <div className="font-medium truncate">{layer.name}</div>
        {layer.kind === 'smart' && (
          <div className="text-muted-foreground text-[10px]">
            Non-destructive smart object — transforms stay editable ·
            Source {layer.source?.width}×{layer.source?.height}px · Scale {Math.round((layer.transform?.scale ?? 1) * 100)}%
          </div>
        )}
      </div>

      {isAdj && <AdjustmentEditor layerId={layer.id} />}

      <BlendIfSection key={layer.id} layerId={layer.id} />

      {isText && <TextProperties layerId={layer.id} />}

      {(layer.smartFilters.length > 0 || layer.kind !== 'adjustment') && <SmartFiltersSection layerId={layer.id} />}

      {layer.kind === 'smart' && (
        <div className="border-t pt-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Smart Object</div>
          <div className="flex gap-1 mt-1">
            <button className="px-2 py-1 rounded border text-[10px] hover:bg-accent" onClick={() => engine.rasterizeLayer(layer.id)}>Rasterize</button>
          </div>
        </div>
      )}
    </FancyScroll>
  )
}

// ---------- adjustment layer: live parameter editing ----------
function AdjustmentEditor({ layerId }: { layerId: string }) {
  const tick = useEditorStore(s => s.renderTick)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPushed = useRef<string>('')
  void tick

  const layer = engine.layerById(layerId)
  const adj = layer?.adjustment
  const def = adj ? ADJUSTMENTS[adj.type] : null

  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current) }, [])

  if (!adj || !def || !layer) return null

  const setParam = (key: string, value: any) => {
    const l = engine.layerById(layerId)
    if (!l?.adjustment) return
    const params = { ...l.adjustment.params, [key]: value }
    engine.setLayerProps(layerId, { adjustment: { type: l.adjustment.type, params } }, { history: false, label: 'Edit Adjustment' })
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      const cur = engine.layerById(layerId)?.adjustment
      if (!cur) return
      const json = JSON.stringify(cur.params)
      if (json !== lastPushed.current) {
        lastPushed.current = json
        engine.pushHistory(`Edit ${def.label}`)
      }
    }, 300)
  }

  const icon = ADJUSTMENT_ICONS[adj.type] ?? 'Sliders'
  const Cmp = (Icons as any)[icon] ?? Icons.Sliders

  return (
    <div className="border-t pt-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Cmp size={13} className="text-primary shrink-0" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex-1">Adjustment</span>
        <span className="text-primary truncate">{def.label}</span>
        <button
          className="p-0.5 text-muted-foreground hover:text-primary"
          title="Open full dialog"
          onClick={() => useEditorStore.getState().openDialog(adj.type as any, { layerId, mode: 'adjust-layer' })}
        ><Icons.Maximize2 size={11} /></button>
      </div>
      {def.controls.map(c =>
        c.type === 'custom' ? (
          c.customId === 'lut' ? (
            <LutInlineControl
              key={c.key}
              value={String(adj.params[c.key] ?? def.defaults[c.key])}
              onChange={v => setParam(c.key, v)}
            />
          ) : (
            <button
              key={c.key}
              className="w-full px-2 py-1 rounded border text-[10px] hover:bg-accent hover:border-primary/40 text-left"
              onClick={() => useEditorStore.getState().openDialog(adj.type as any, { layerId, mode: 'adjust-layer' })}
            >
              Edit {c.label}…
            </button>
          )
        ) : (
          <div key={c.key} className="flex items-center min-w-0 overflow-x-auto zphoto-scroll">
            <ControlRenderer control={c} value={adj.params[c.key] ?? def.defaults[c.key]} onChange={(v: any) => setParam(c.key, v)} />
          </div>
        )
      )}
    </div>
  )
}

// ---------- inline LUT control (color-lookup adjustment layer) ----------
// Value contract: only the lutId string travels through params — the actual
// Float32 tables live in the image-ops LUT registry, so layer params stay
// JSON-serializable for history snapshots.
const LUT_CHIP_SAMPLES: [number, number, number][] = [
  [0, 0, 0], [0.33, 0.33, 0.33], [0.66, 0.66, 0.66], [1, 1, 1], [0.91, 0.64, 0.24],
]

function lutChips(lutId: string): string[] {
  const lut = getLut(lutId)
  if (!lut) return ['#000000', '#2b2b2b', '#575757', '#ffffff', '#e8a33d']
  const out = [0, 0, 0]
  const hex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return LUT_CHIP_SAMPLES.map(([r, g, b]) => {
    sampleLUT(lut, r, g, b, out)
    return `#${hex(out[0])}${hex(out[1])}${hex(out[2])}`
  })
}

function LutInlineControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const luts = useMemo(() => listLuts(), [value])
  const chips = useMemo(() => lutChips(value), [value])
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!f) return
    try {
      const text = await f.text()
      const lut = parseCube(text, f.name.replace(/\.cube$/i, ''))
      onChange(lut.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'parse failed'
      useEditorStore.getState().pushToast(`Invalid .cube file: ${msg}`, 'error')
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-5 flex-1 min-w-0 bg-background border rounded text-[10px] px-1"
          title="Color Lookup LUT"
          aria-label="Color Lookup LUT"
        >
          {luts.map(l => (
            <option key={l.id} value={l.id}>{l.name}{l.builtin ? '' : ' · custom'}</option>
          ))}
        </select>
        <button
          className="h-5 px-1.5 rounded border text-[10px] text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-accent shrink-0 flex items-center gap-1"
          onClick={() => fileRef.current?.click()}
          title="Import an Adobe .cube LUT file"
        >
          <Icons.Upload size={9} /> .cube
        </button>
        <input ref={fileRef} type="file" accept=".cube,text/plain" className="hidden" onChange={onFile} aria-label="Load .cube LUT file" />
      </div>
      {/* tone preview: black / 33% / 66% / white / amber pushed through the LUT */}
      <div className="flex gap-0.5 h-3.5 rounded border overflow-hidden" aria-hidden>
        {chips.map((c, i) => (
          <div key={i} className="flex-1" style={{ background: c }} />
        ))}
      </div>
    </div>
  )
}

// ---------- advanced blending (blend-if) ----------
const DEFAULT_BLEND_IF: BlendIfSettings = {
  channel: 'gray',
  thisLayer: { lo: 0, loSoft: 0, hi: 255, hiSoft: 0 },
  underLayer: { lo: 0, loSoft: 0, hi: 255, hiSoft: 0 },
}

const BLEND_IF_CHANNELS: { value: BlendIfSettings['channel']; label: string; grad: string }[] = [
  { value: 'gray', label: 'Gray', grad: 'linear-gradient(to right, #000, #fff)' },
  { value: 'r', label: 'Red', grad: 'linear-gradient(to right, #000, #f00)' },
  { value: 'g', label: 'Green', grad: 'linear-gradient(to right, #000, #0f0)' },
  { value: 'b', label: 'Blue', grad: 'linear-gradient(to right, #000, #00f)' },
]

function currentBlendIf(layerId: string): BlendIfSettings {
  return engine.layerById(layerId)?.blendIf ?? DEFAULT_BLEND_IF
}

function BlendIfSection({ layerId }: { layerId: string }) {
  const tick = useEditorStore(s => s.renderTick)
  const [open, setOpen] = useState(() => !!engine.layerById(layerId)?.blendIf)
  const [split, setSplit] = useState(false)
  const [, force] = useState(0)
  void tick

  const layer = engine.layerById(layerId)
  const settings = layer?.blendIf ?? null

  if (!layer) return null

  const channel = settings?.channel ?? 'gray'
  const grad = (BLEND_IF_CHANNELS.find(c => c.value === channel) ?? BLEND_IF_CHANNELS[0]).grad

  /** live preview — mutate the engine layer directly, re-render viewport, NO history push */
  const liveUpdate = (row: 'thisLayer' | 'underLayer', slider: BlendIfSlider) => {
    const l = engine.layerById(layerId)
    const doc = engine.activeDoc
    if (!l || !doc) return
    const base = l.blendIf ?? DEFAULT_BLEND_IF
    l.blendIf = { ...base, [row]: slider }
    l._v++
    invalidateFlat(doc)
    engine.requestRender()
    force(v => v + 1)
  }

  /** commit on pointer-up — single history entry per drag */
  const commit = () => {
    const l = engine.layerById(layerId)
    if (l?.blendIf) engine.setBlendIf(layerId, l.blendIf)
  }

  const setChannel = (ch: BlendIfSettings['channel']) => {
    if (ch === channel) return
    const base = currentBlendIf(layerId)
    engine.setBlendIf(layerId, { ...base, channel: ch })
  }

  const reset = () => engine.setBlendIf(layerId, null)

  return (
    <div className="border-t pt-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Icons.Blend size={13} className="text-primary shrink-0" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex-1">Advanced Blending</span>
        {settings && <span className="text-[8px] bg-primary/20 text-primary px-1 rounded-sm" title="Blend-If active">fx</span>}
        <button
          className="p-0.5 text-muted-foreground hover:text-foreground"
          title={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen(o => !o)}
        >{open ? <Icons.ChevronDown size={11} /> : <Icons.ChevronRight size={11} />}</button>
      </div>

      {open && (
        <div className="space-y-2">
          {/* channel select */}
          <div className="flex items-center gap-1.5">
            <select
              value={channel}
              onChange={e => setChannel(e.target.value as BlendIfSettings['channel'])}
              className="h-5 flex-1 bg-background border rounded text-[10px] px-1"
              aria-label="Blend-If channel"
            >
              {BLEND_IF_CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <button
              className={cn('px-1.5 h-5 rounded border text-[9px] flex items-center gap-1', split ? 'bg-primary/15 text-primary border-primary/40' : 'text-muted-foreground hover:text-foreground')}
              title="Split mode — Alt-style feathering for every solid-handle drag"
              onClick={() => setSplit(s => !s)}
            >
              <Icons.MoveHorizontal size={10} /> Split
            </button>
            <button
              className="px-1.5 h-5 rounded border text-[9px] text-muted-foreground hover:text-destructive hover:border-destructive/40"
              title="Reset blend-if to default (none)"
              onClick={reset}
            >Reset</button>
          </div>

          <SplitSlider
            label="This Layer"
            row="thisLayer"
            layerId={layerId}
            grad={grad}
            split={split}
            onLive={liveUpdate}
            onCommit={commit}
          />
          <SplitSlider
            label="Underlying Layer"
            row="underLayer"
            layerId={layerId}
            grad={grad}
            split={split}
            onLive={liveUpdate}
            onCommit={commit}
          />

          <div className="text-[9px] text-muted-foreground leading-relaxed">
            Drag solid ▲ handles to hide dark/bright values · Alt-drag ▲ (or Split mode) pulls the feather half ▼ apart · drag ▼ to reshape the soft zone.
          </div>
        </div>
      )}
    </div>
  )
}

type BlendRow = 'thisLayer' | 'underLayer'
type HandlePart = 'lo' | 'loSoft' | 'hi' | 'hiSoft'

function SplitSlider({ label, row, layerId, grad, split, onLive, onCommit }: {
  label: string
  row: BlendRow
  layerId: string
  grad: string
  split: boolean
  onLive(row: BlendRow, slider: BlendIfSlider): void
  onCommit(): void
}) {
  const tick = useEditorStore(s => s.renderTick)
  const barRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ part: HandlePart; pair: boolean; moved: boolean } | null>(null)
  void tick

  const s: BlendIfSlider = (currentBlendIf(layerId)[row]) ?? { lo: 0, loSoft: 0, hi: 255, hiSoft: 0 }
  const lo = Math.round(s.lo), loSoft = Math.round(s.loSoft), hi = Math.round(s.hi), hiSoft = Math.round(s.hiSoft)
  const pct = (v: number) => `${(clamp(v, 0, 255) / 255) * 100}%`

  const valueFromEvent = (e: React.PointerEvent): number => {
    const r = barRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * 255)
  }

  const startDrag = (e: React.PointerEvent, part: HandlePart) => {
    e.preventDefault()
    e.stopPropagation()
    drag.current = { part, pair: e.altKey || split, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const cur = currentBlendIf(layerId)[row]
    const v = valueFromEvent(e)
    let next: BlendIfSlider
    if (d.part === 'lo') {
      if (d.pair) {
        // Alt / Split: pull the soft half away from the solid point (creates the feather)
        next = { ...cur, loSoft: clamp(cur.lo - v, 0, cur.lo) }
      } else {
        next = { ...cur, lo: clamp(v, cur.loSoft, cur.hi) }
      }
    } else if (d.part === 'loSoft') {
      const p = clamp(v, 0, cur.lo) // hidden boundary position
      next = { ...cur, loSoft: cur.lo - p }
    } else if (d.part === 'hi') {
      if (d.pair) {
        // Alt / Split: pull the soft half away from the solid point
        next = { ...cur, hiSoft: clamp(v - cur.hi, 0, 255 - cur.hi) }
      } else {
        next = { ...cur, hi: clamp(v, cur.lo, 255 - cur.hiSoft) }
      }
    } else {
      const p = clamp(v, cur.hi, 255) // hidden boundary position
      next = { ...cur, hiSoft: p - cur.hi }
    }
    const changed = next.lo !== cur.lo || next.loSoft !== cur.loSoft || next.hi !== cur.hi || next.hiSoft !== cur.hiSoft
    if (changed) {
      d.moved = true
      onLive(row, next)
    }
  }

  const endDrag = (e: React.PointerEvent) => {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }
    if (drag.current?.moved) onCommit()
    drag.current = null
  }

  const handle = (part: HandlePart, pos: number, solid: boolean, title: string) => (
    <div
      className={cn(
        'absolute -translate-x-1/2 w-4 h-3.5 flex items-center justify-center cursor-ew-resize touch-none z-10',
        solid ? 'bottom-0 items-start pt-0.5' : 'top-0 items-end pb-0.5'
      )}
      style={{ left: pct(pos) }}
      title={title}
      onPointerDown={e => startDrag(e, part)}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="slider"
      aria-label={`${label} ${title}`}
      aria-valuenow={Math.round(pos)}
      aria-valuemin={0}
      aria-valuemax={255}
    >
      {solid ? (
        <span
          className={cn('block w-0 h-0 border-x-[4px] border-x-transparent border-t-0')}
          style={{ borderBottom: '6px solid', borderBottomColor: part === 'lo' ? '#d6d3d1' : '#fafafa' }}
        />
      ) : (
        <span
          className="block w-0 h-0 border-x-[3.5px] border-x-transparent border-b-0"
          style={{ borderTop: '6px solid rgba(245,158,11,0.75)' }}
        />
      )}
    </div>
  )

  return (
    <div className="select-none">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[9px] font-mono text-muted-foreground/80 ml-auto" title="lo / feather · hi / feather">
          {lo}/{loSoft} · {hi}/{hiSoft}
        </span>
      </div>

      {/* bar + handles */}
      <div className="relative h-8 mx-0.5">
        {/* soft handles (above the bar) */}
        {loSoft > 0 && handle('loSoft', lo - loSoft, false, `Feather start ${lo - loSoft}`)}
        {hiSoft > 0 && handle('hiSoft', hi + hiSoft, false, `Feather end ${hi + hiSoft}`)}
        {/* solid handles always visible */}
        {handle('lo', lo, true, `Black point ${lo} — drag to hide darker values${loSoft ? '' : ' (Alt-drag to feather)'}`)}
        {handle('hi', hi, true, `White point ${hi} — drag to hide brighter values${hiSoft ? '' : ' (Alt-drag to feather)'}`)}

        {/* gradient bar */}
        <div ref={barRef} className="absolute top-3.5 left-0 right-0 h-2 rounded-sm border border-border overflow-hidden">
          <div className="absolute inset-0" style={{ background: grad }} />
          {/* hidden zone: below feather start */}
          {loSoft > 0 && (
            <>
              <div className="absolute top-0 bottom-0 bg-black/60" style={{ left: 0, width: pct(lo - loSoft) }} />
              <div
                className="absolute top-0 bottom-0"
                style={{ left: pct(lo - loSoft), width: pct(loSoft), background: 'linear-gradient(to right, rgba(0,0,0,0.6), rgba(0,0,0,0))' }}
              />
            </>
          )}
          {loSoft === 0 && lo > 0 && <div className="absolute top-0 bottom-0 bg-black/60" style={{ left: 0, width: pct(lo) }} />}
          {/* hidden zone: above feather end */}
          {hiSoft > 0 && (
            <>
              <div
                className="absolute top-0 bottom-0"
                style={{ left: pct(hi), width: pct(hiSoft), background: 'linear-gradient(to right, rgba(0,0,0,0), rgba(0,0,0,0.6))' }}
              />
              <div className="absolute top-0 bottom-0 bg-black/60" style={{ left: pct(hi + hiSoft), right: 0 }} />
            </>
          )}
          {hiSoft === 0 && hi < 255 && <div className="absolute top-0 bottom-0 bg-black/60" style={{ left: pct(hi), right: 0 }} />}
        </div>
      </div>
    </div>
  )
}

// ---------- smart filters ----------
const QUICK_SMART_FILTERS: FilterType[] = ['gaussian-blur', 'smart-sharpen', 'add-noise']

function SmartFiltersSection({ layerId }: { layerId: string }) {
  const tick = useEditorStore(s => s.renderTick)
  const layer = engine.layerById(layerId)
  void tick
  if (!layer) return null

  const addSmart = (type: FilterType) => {
    const def = FILTERS[type]
    if (!def) return
    const l = engine.layerById(layerId)
    if (!l) return
    const wasSmart = l.kind === 'smart'
    engine.addSmartFilter(layerId, type, { ...def.defaults })
    if (wasSmart) {
      const l2 = engine.layerById(layerId)
      const sf = l2?.smartFilters[l2.smartFilters.length - 1]
      if (sf) {
        useEditorStore.getState().openDialog(sf.type as any, { layerId, smartFilterId: sf.id, mode: 'smart-filter' })
      }
    } else {
      useEditorStore.getState().pushToast(`${def.label} applied destructively — convert to a Smart Object for non-destructive editing`, 'info')
    }
  }

  return (
    <div className="border-t pt-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Icons.Sparkles size={13} className="text-primary shrink-0" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex-1">Smart Filters</span>
        <select
          value=""
          onChange={e => { if (e.target.value) addSmart(e.target.value as FilterType); e.currentTarget.value = '' }}
          className="h-5 bg-background border rounded text-[10px] px-1 max-w-[110px]"
          title="Add smart filter"
          aria-label="Add smart filter"
        >
          <option value="">+ Add…</option>
          {QUICK_SMART_FILTERS.map(t => (
            <option key={t} value={t}>{FILTERS[t]?.label ?? t}</option>
          ))}
        </select>
      </div>
      {layer.smartFilters.length === 0 && (
        <div className="text-[10px] text-muted-foreground">No smart filters — add one above</div>
      )}
      {layer.smartFilters.map(sf => (
        <div key={sf.id} className="flex items-center gap-1.5 py-0.5 group">
          <button
            className={cn('w-3.5 h-3.5 rounded-sm border flex items-center justify-center', sf.enabled ? 'bg-primary/20 border-primary/50' : 'border-border')}
            onClick={() => engine.toggleSmartFilter(layerId, sf.id)}
            aria-label={sf.enabled ? 'Disable filter' : 'Enable filter'}
          >
            {sf.enabled && <Icons.Check size={9} className="text-primary" />}
          </button>
          <button
            className="flex-1 text-left hover:text-primary truncate"
            title={`${FILTERS[sf.type]?.label ?? sf.type} — click to edit`}
            onClick={() => useEditorStore.getState().openDialog(sf.type as any, { layerId, smartFilterId: sf.id, mode: 'smart-filter' })}
          >
            {FILTERS[sf.type]?.label ?? sf.type}
          </button>
          <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" onClick={() => engine.removeSmartFilter(layerId, sf.id)} aria-label="Remove filter">
            <Icons.X size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------- text layer properties (baseline behavior kept) ----------
function TextProperties({ layerId }: { layerId: string }) {
  const tick = useEditorStore(s => s.renderTick)
  const layer = engine.layerById(layerId)
  const t = layer?.text
  void tick
  if (!t) return null
  const update = (patch: Partial<typeof t>) => engine.setLayerProps(layerId, { text: { ...t, ...patch } }, { history: false })
  return (
    <div className="border-t pt-2 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Type Layer</div>
      <textarea
        value={t.content}
        onChange={e => update({ content: e.target.value })}
        className="w-full h-16 text-[11px] p-1.5 rounded bg-background border"
      />
      <div className="grid grid-cols-2 gap-1">
        <label className="flex items-center gap-1">Size
          <input type="number" value={t.fontSize} min={6} max={500} onChange={e => update({ fontSize: Number(e.target.value) })} className="w-14 h-5 bg-background border rounded text-[10px] px-1" />
        </label>
        <label className="flex items-center gap-1">Line H
          <input type="number" value={t.lineHeight} step={0.1} min={0.5} max={3} onChange={e => update({ lineHeight: Number(e.target.value) })} className="w-12 h-5 bg-background border rounded text-[10px] px-1" />
        </label>
      </div>
      <div className="flex items-center gap-1">
        <input type="color" value={t.color} onChange={e => update({ color: e.target.value })} className="w-7 h-6 rounded border bg-transparent p-0" aria-label="Text color" />
        <select value={t.fontFamily} onChange={e => update({ fontFamily: e.target.value })} className="flex-1 h-5 bg-background border rounded text-[10px]">
          <option value="Georgia, serif">Georgia</option>
          <option value='"Times New Roman", serif'>Times</option>
          <option value="Helvetica, Arial, sans-serif">Helvetica</option>
          <option value="Arial, sans-serif">Arial</option>
          <option value='"Courier New", monospace'>Courier</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={t.kerning !== false} onChange={e => update({ kerning: e.target.checked })} />
          Kerning
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={t.ligatures !== false} onChange={e => update({ ligatures: e.target.checked })} />
          Ligatures
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={t.smallCaps === true} onChange={e => update({ smallCaps: e.target.checked })} />
          Small Caps
        </label>
        <select value={t.fontStretch ?? 'normal'} onChange={e => update({ fontStretch: e.target.value as NonNullable<typeof t.fontStretch> })} className="h-5 bg-background border rounded text-[9px] px-1" title="Font width/stretch">
          <option value="condensed">Condensed</option>
          <option value="semi-condensed">Semi Condensed</option>
          <option value="normal">Normal</option>
          <option value="semi-expanded">Semi Expanded</option>
          <option value="expanded">Expanded</option>
        </select>
      </div>
      <div className="mt-2 border-t pt-2 space-y-1.5">
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Warp Text</div>
        <select value={t.warpStyle ?? 'none'} onChange={e => update({ warpStyle: e.target.value as NonNullable<typeof t.warpStyle> })} className="w-full h-6 bg-background border rounded text-[10px] px-1">
          <option value="none">None</option>
          <option value="arc">Arc</option>
          <option value="arch">Arch</option>
          <option value="bulge">Bulge</option>
          <option value="flag">Flag</option>
          <option value="wave">Wave</option>
        </select>
        {([['Bend', 'warpBend'], ['H Distort', 'warpHorizontal'], ['V Distort', 'warpVertical']] as const).map(([label, key]) => (
          <label key={key} className="grid grid-cols-[58px_1fr_42px] items-center gap-1 text-[10px]">
            <span>{label}</span>
            <input type="range" min={-100} max={100} step={1} value={Number(t[key] ?? 0)} onChange={e => update({ [key]: Number(e.target.value) })} className="min-w-0" />
            <input type="number" min={-100} max={100} step={1} value={Number(t[key] ?? 0)} onChange={e => update({ [key]: Number(e.target.value) })} className="h-5 w-10 bg-background border rounded text-[9px] px-1" />
          </label>
        ))}
      </div>
    </div>
  )
}
