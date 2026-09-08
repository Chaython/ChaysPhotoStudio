'use client'
// ============================================================
// TimelinePanel — frame animation timeline + GIF / APNG export (Task 9-c)
//  · empty state → "Create Frame Animation" (engine.ensureFrames)
//  · transport: first / prev / play-pause / next / last / loop
//  · active-frame delay (ms) input, frame counter
//  · add (duplicate | empty), duplicate, delete, move / drag-reorder
//  · frame strip with cached thumbnails, onion-skin toggle, auto-scroll
//  · export GIF + APNG with a shared settings popover
// ============================================================
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { frameThumb, exportAnimation } from '../../animation/frames'
import { cn } from '@/lib/utils'

export function TimelinePanel() {
  const activeDocId = useEditorStore(s => s.activeDocId)
  const tick = useEditorStore(s => s.renderTick)
  const playing = useEditorStore(s => s.timelinePlaying)
  const activeFrame = useEditorStore(s => s.timelineActiveFrame)
  const loop = useEditorStore(s => s.timelineLoop)
  const frameMetas = useEditorStore(s => s.timelineFrames)
  const setTimelineFrame = useEditorStore(s => s.setTimelineFrame)
  const toggleTimelinePlay = useEditorStore(s => s.toggleTimelinePlay)
  const timelineNext = useEditorStore(s => s.timelineNext)
  const timelinePrev = useEditorStore(s => s.timelinePrev)
  const toggleTimelineLoop = useEditorStore(s => s.toggleTimelineLoop)
  const busy = useEditorStore(s => s.progress?.active ?? false)

  const [onion, setOnion] = useState(false)
  const [delayDraft, setDelayDraft] = useState('100')
  const [exportScale, setExportScale] = useState('1')
  const [exportColors, setExportColors] = useState('128')
  const [exportDither, setExportDither] = useState(true)

  const doc = engine.activeDoc
  const frameCount = frameMetas.length
  const activeMeta = frameMetas[Math.min(activeFrame, Math.max(0, frameCount - 1))]
  const thumbW = 64
  const thumbH = Math.max(32, Math.min(96, Math.round((thumbW * (doc?.height ?? 1)) / (doc?.width ?? 1))))

  // ---- wire engine.timelineActive to the frames presence + re-apply the
  // active frame after doc switches (no-op when already in sync, thanks to
  // applyFrameToLayers' diff check)
  useEffect(() => {
    if (!doc) return
    const n = doc.frames?.length ?? 0
    engine.timelineActive = n > 0
    if (n) {
      const idx = Math.min(Math.max(0, engine.activeFrameIndex), n - 1)
      engine.applyFrameToLayers(idx, { silent: true })
      engine.requestRender()
    }
  }, [doc, frameCount])

  // ---- stop playback on doc switch AND unmount (clears the store timer)
  useEffect(() => () => { useEditorStore.getState().stopTimeline() }, [activeDocId])

  // ---- mirror live layer edits into the ACTIVE frame record on every
  // engine tick. Layout effect so it runs before the child thumbnail
  // (passive) effects — thumbnails see fresh records.
  useLayoutEffect(() => {
    if (!doc?.frames?.length || !engine.timelineActive) return
    engine.syncFrameFromLayers(engine.activeFrameIndex)
  }, [tick, doc, frameCount])

  // ---- delay draft follows the active frame (adjust-state-during-render:
  //  the draft re-syncs whenever the frame / committed delay / doc changes,
  //  but NOT while the user is typing)
  const delayKey = `${activeDocId}:${activeFrame}:${activeMeta?.delayMs ?? 100}`
  const [syncedDelayKey, setSyncedDelayKey] = useState(delayKey)
  if (delayKey !== syncedDelayKey) {
    setSyncedDelayKey(delayKey)
    setDelayDraft(String(activeMeta?.delayMs ?? 100))
  }

  // ---- auto-scroll the active card into view while playing
  const activeCardRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    activeCardRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [activeFrame, playing])

  const commitDelay = () => {
    const v = parseInt(delayDraft, 10)
    const clamped = Number.isFinite(v) ? Math.min(60000, Math.max(10, v)) : (activeMeta?.delayMs ?? 100)
    setDelayDraft(String(clamped))
    engine.setFrameDelay(activeFrame, clamped)
  }

  const doExport = (format: 'gif' | 'apng') => {
    if (!doc || !frameCount) return
    void exportAnimation(doc, engine, format, {
      scale: Number(exportScale),
      colors: Number(exportColors),
      dither: exportDither,
    })
  }

  // ---- gates (after all hooks) ----
  if (!doc) {
    return (
      <div className="p-4 text-[11px] text-muted-foreground text-center" role="status">
        No document open
      </div>
    )
  }
  if (!frameCount) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-4">
        <Icons.Film size={28} className="text-muted-foreground/50" aria-hidden />
        <p className="text-[11px] text-muted-foreground text-center max-w-[230px] leading-relaxed">
          Create a frame animation — each frame remembers layer visibility,
          opacity and position. Export as GIF or APNG.
        </p>
        <Button size="sm" className="text-[11px] h-7 gap-1.5" onClick={() => engine.ensureFrames()}>
          <Icons.Plus size={13} />
          Create Frame Animation
        </Button>
      </div>
    )
  }

  const totalMs = frameMetas.reduce((a, f) => a + f.delayMs, 0)

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* transport toolbar */}
      <div className="flex items-center gap-0.5 px-1 py-1 border-b bg-panel/50 flex-wrap">
        <TBtn title="First frame" onClick={() => setTimelineFrame(0)}><Icons.SkipBack size={14} /></TBtn>
        <TBtn title="Previous frame" onClick={timelinePrev}><Icons.ChevronLeft size={14} /></TBtn>
        <TBtn title={playing ? 'Pause' : 'Play animation'} onClick={toggleTimelinePlay} active={playing}>
          {playing ? <Icons.Pause size={14} /> : <Icons.Play size={14} />}
        </TBtn>
        <TBtn title="Next frame" onClick={timelineNext}><Icons.ChevronRight size={14} /></TBtn>
        <TBtn title="Last frame" onClick={() => setTimelineFrame(frameCount - 1)}><Icons.SkipForward size={14} /></TBtn>
        <TBtn title="Loop playback" onClick={toggleTimelineLoop} active={loop}><Icons.Repeat size={13} /></TBtn>

        <span className="text-[10px] font-mono text-muted-foreground px-1 tabular-nums" aria-live="polite">
          {activeFrame + 1} / {frameCount}
        </span>

        <label className="flex items-center gap-1 text-[10px] text-muted-foreground" title="Active frame duration (ms)">
          <Icons.Timer size={11} aria-hidden />
          <input
            type="number"
            min={10}
            max={60000}
            step={10}
            value={delayDraft}
            onChange={e => setDelayDraft(e.target.value)}
            onBlur={commitDelay}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            className="w-16 h-6 bg-background border rounded-sm px-1 text-[10px] font-mono tabular-nums focus:border-primary/60 outline-none"
            aria-label="Frame delay in milliseconds"
          />
        </label>

        <span className="flex-1" />

        {/* new frame: + duplicates the current state, dropdown offers empty */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="New frame (duplicates current state)"
              aria-label="New frame"
              className="w-7 h-7 rounded-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
            >
              <Icons.Plus size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-50">
            <DropdownMenuItem onClick={() => engine.addFrame('duplicate')} className="text-[11px]">
              <Icons.Copy size={12} className="mr-1.5" /> Duplicate Frame
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => engine.addFrame('empty')} className="text-[11px]">
              <Icons.EyeOff size={12} className="mr-1.5" /> Empty Frame (all hidden)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <TBtn title="Duplicate frame" onClick={() => engine.duplicateFrame(activeFrame)}><Icons.Copy size={13} /></TBtn>
        <TBtn title="Delete frame" danger onClick={() => engine.deleteFrame(activeFrame)}><Icons.Trash2 size={13} /></TBtn>

        <div className="w-px h-5 bg-border/60 mx-0.5" aria-hidden />

        <ExportBtn label="GIF" title="Export animated GIF" disabled={busy} onClick={() => doExport('gif')} />
        <ExportBtn label="APNG" title="Export animated PNG" disabled={busy} onClick={() => doExport('apng')} />

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Export settings"
              aria-label="Export settings"
              className="w-7 h-7 rounded-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
            >
              <Icons.Settings2 size={13} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-2.5 z-50">
            <div className="space-y-2.5 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Width</span>
                <Select value={exportScale} onValueChange={setExportScale}>
                  <SelectTrigger className="h-6 w-24 px-1.5 py-0 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="z-50">
                    <SelectItem value="1" className="text-[11px]">100%</SelectItem>
                    <SelectItem value="0.75" className="text-[11px]">75%</SelectItem>
                    <SelectItem value="0.5" className="text-[11px]">50%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground" title="GIF palette size">Colors</span>
                <Select value={exportColors} onValueChange={setExportColors}>
                  <SelectTrigger className="h-6 w-24 px-1.5 py-0 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="z-50">
                    <SelectItem value="64" className="text-[11px]">64</SelectItem>
                    <SelectItem value="128" className="text-[11px]">128</SelectItem>
                    <SelectItem value="256" className="text-[11px]">256</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center justify-between gap-2 cursor-pointer select-none" title="GIF Floyd–Steinberg dithering">
                <span className="text-muted-foreground">Dither</span>
                <Checkbox checked={exportDither} onCheckedChange={v => setExportDither(v === true)} aria-label="Dithering" />
              </label>
              <p className="text-[9px] text-muted-foreground/70 leading-relaxed">
                Colors and dither apply to GIF only. Total duration {(totalMs / 1000).toFixed(1)}s.
              </p>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* strip header */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b bg-panel/30">
        <TBtn
          title="Onion skin — blend the previous frame into thumbnails (30%)"
          active={onion}
          small
          onClick={() => setOnion(o => !o)}
        >
          <Icons.Ghost size={12} />
        </TBtn>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {frameCount} frame{frameCount > 1 ? 's' : ''}
        </span>
        <span className="flex-1" />
        <span className="text-[10px] font-mono text-muted-foreground tabular-nums" title="Total animation duration">
          {(totalMs / 1000).toFixed(1)}s
        </span>
      </div>

      {/* frame strip */}
      <div className="flex-1 min-h-0 overflow-x-auto zphoto-scroll" role="list" aria-label="Animation frames">
        <div className="flex items-start gap-1.5 p-2 h-full w-max">
          {frameMetas.map((m, i) => (
            <FrameCard
              key={m.id}
              i={i}
              count={frameCount}
              meta={m}
              active={i === activeFrame}
              onion={onion}
              thumbW={thumbW}
              thumbH={thumbH}
              onSelect={setTimelineFrame}
              cardRef={i === activeFrame ? activeCardRef : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------- frame card ---------------------------------------------------

interface FrameCardProps {
  i: number
  count: number
  meta: { id: string; name: string; delayMs: number }
  active: boolean
  onion: boolean
  thumbW: number
  thumbH: number
  onSelect(i: number): void
  cardRef?: React.RefObject<HTMLDivElement | null>
}

function FrameCard({ i, count, meta, active, onion, thumbW, thumbH, onSelect, cardRef }: FrameCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tick = useEditorStore(s => s.renderTick)

  // thumbnails come from the module-level cache — recomposited only when the
  // frame's pixels / overrides actually changed (key includes layer epoch)
  useEffect(() => {
    const c = canvasRef.current
    const doc = engine.activeDoc
    if (!c || !doc) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    const thumb = frameThumb(doc, engine, i, c.width)
    if (thumb) {
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(thumb, 0, 0, c.width, c.height)
    }
    if (onion && i > 0) {
      const prev = frameThumb(doc, engine, i - 1, c.width)
      if (prev) {
        ctx.globalAlpha = 0.3
        ctx.drawImage(prev, 0, 0, c.width, c.height)
        ctx.globalAlpha = 1
      }
    }
  }, [tick, i, onion, meta.id, meta.delayMs])

  const secLabel = (meta.delayMs / 1000).toFixed(meta.delayMs % 1000 === 0 ? 0 : 1)

  return (
    <div
      ref={cardRef}
      role="listitem"
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; dragFrameIndex.current = i }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault()
        const from = dragFrameIndex.current
        dragFrameIndex.current = null
        if (from !== null && from !== i) engine.moveFrame(from, i)
      }}
      onClick={() => onSelect(i)}
      title={`${meta.name} — ${meta.delayMs} ms`}
      aria-label={`Frame ${i + 1}, ${meta.delayMs} milliseconds${active ? ', active' : ''}`}
      aria-current={active}
      className={cn(
        'relative shrink-0 rounded-md border p-1 cursor-pointer select-none group transition-colors',
        active
          ? 'border-primary bg-accent/60 ring-1 ring-primary/60'
          : 'border-border/50 bg-panel/60 hover:border-primary/40 hover:bg-accent/25',
      )}
    >
      <div
        className="rounded-sm border border-border/40 bg-checker overflow-hidden"
        style={{ width: thumbW, height: thumbH }}
      >
        <canvas ref={canvasRef} width={thumbW} height={thumbH} className="block" aria-hidden />
      </div>
      <div className="flex items-center justify-between gap-1 mt-1 text-[9px] font-mono text-muted-foreground tabular-nums px-0.5">
        <span className={active ? 'text-primary font-semibold' : ''}>{i + 1}</span>
        <span>{secLabel}s</span>
      </div>

      {/* hover reorder (fallback + shortcut alongside drag & drop) */}
      <div className="absolute -top-0.5 -right-0.5 hidden group-hover:flex gap-0.5">
        {i > 0 && (
          <button
            type="button"
            title="Move frame left"
            aria-label={`Move frame ${i + 1} left`}
            onClick={e => { e.stopPropagation(); engine.moveFrame(i, i - 1) }}
            className="w-5 h-5 rounded-sm bg-background/90 border border-border/60 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/50"
          >
            <Icons.ChevronLeft size={11} />
          </button>
        )}
        {i < count - 1 && (
          <button
            type="button"
            title="Move frame right"
            aria-label={`Move frame ${i + 1} right`}
            onClick={e => { e.stopPropagation(); engine.moveFrame(i, i + 1) }}
            className="w-5 h-5 rounded-sm bg-background/90 border border-border/60 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/50"
          >
            <Icons.ChevronRight size={11} />
          </button>
        )}
      </div>
    </div>
  )
}

/** shared drag source index for native HTML5 frame reordering (like layers panel) */
const dragFrameIndex = { current: null as number | null }

// ---------------- tiny button helpers ------------------------------------------

function TBtn({ title, onClick, active, danger, small, children }: {
  title: string
  onClick(): void
  active?: boolean
  danger?: boolean
  small?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-sm flex items-center justify-center transition-colors',
        small ? 'w-5 h-5' : 'w-7 h-7',
        active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
        danger && 'hover:text-destructive hover:bg-destructive/10',
      )}
    >
      {children}
    </button>
  )
}

function ExportBtn({ label, title, disabled, onClick }: {
  label: string
  title: string
  disabled?: boolean
  onClick(): void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="h-6 px-2 rounded-sm border border-border/70 bg-panel/60 text-[10px] font-medium text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-accent/40 transition-colors disabled:opacity-40 disabled:pointer-events-none"
    >
      {label}
    </button>
  )
}
