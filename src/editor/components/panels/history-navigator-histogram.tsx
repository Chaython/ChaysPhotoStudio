'use client'
// ============================================================
// History / Navigator / Histogram panels — TASK 2-C
// History: type icons, snapshots, clear
// Navigator: live viewport rect + pan-by-drag + zoom controls
// Histogram: channel select, RGB/L/Colors, throttled stats
// ============================================================
import { useEffect, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { getFlatComposite } from '../../engine/document'
import { getViewport } from '../../engine/render'
import { getImageData, createCanvas, ctx2d } from '../../utils/canvas'
import { PanelBtn } from './layers-panel'
import { cn } from '@/lib/utils'
import { FancyScroll } from '@/components/ui/fancy-scroll'

// ================= History =================
function stateIcon(label: string): { icon: string; title: string } {
  const l = label.toLowerCase()
  if (/snapshot/.test(l)) return { icon: 'Camera', title: 'Snapshot' }
  if (/brush|dab|stroke|paint|pencil|eraser|clone|heal|smudge|dodge|burn|sponge|fill/.test(l)) return { icon: 'Brush', title: 'Paint' }
  if (/select|mask|channel|marquee|lasso|wand|deselect|subject|object/.test(l)) return { icon: 'SquareDashed', title: 'Selection' }
  if (/filter|blur|sharpen|noise|emboss|wind|mosaic|twirl|wave|crystal|median|pass|flare|clouds|edges|lens/.test(l)) return { icon: 'Sparkles', title: 'Filter' }
  if (/adjust|curve|level|exposure|vibrance|hue|saturation|color balance|photo filter|channel mixer|gradient map|posterize|threshold|invert|camera raw|black.?white/.test(l)) return { icon: 'Sliders', title: 'Adjustment' }
  if (/layer|clip|raster|merge|flatten|reorder|text|shape|smart/.test(l)) return { icon: 'Layers', title: 'Layer' }
  if (/crop|resize|image size|canvas|rotate|flip|transform/.test(l)) return { icon: 'Crop', title: 'Geometry' }
  if (/open|new doc|place|save|export|project|batch/.test(l)) return { icon: 'Image', title: 'File' }
  return { icon: 'CircleDot', title: 'State' }
}

export function HistoryPanel() {
  const labels = useEditorStore(s => s.historyLabels)
  const index = useEditorStore(s => s.historyIndex)
  const renderTick = useEditorStore(s => s.renderTick)
  void renderTick
  const [confirmClear, setConfirmClear] = useState(false)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const doc = engine.activeDoc
  const snapshots = doc?.historySnapshots ?? []
  const markedSnapshotId = doc?.historyBrushSnapshotId ?? null

  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current) }, [])

  const createSnapshot = () => {
    const next = (engine.activeDoc?.historySnapshots?.length ?? 0) + 1
    const name = window.prompt('Snapshot name:', `Snapshot ${next}`)
    if (name === null) return
    const snap = engine.createHistorySnapshot(name)
    if (snap) useEditorStore.getState().pushToast(`Created “${snap.name}”`, 'success')
  }

  const renameSnapshot = (id: string, current: string) => {
    const name = window.prompt('Rename snapshot:', current)
    if (name === null) return
    engine.renameHistorySnapshot(id, name)
  }

  const clearHistory = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      if (clearTimer.current) clearTimeout(clearTimer.current)
      clearTimer.current = setTimeout(() => setConfirmClear(false), 2600)
      return
    }
    if (clearTimer.current) clearTimeout(clearTimer.current)
    setConfirmClear(false)
    const d = engine.activeDoc
    const h = d?.history
    if (!d || !h || !h.states.length) return
    h.states = [h.states[h.index]]
    h.index = 0
    engine.setHistoryBrushSource(0)
    // Named snapshots are intentionally preserved, matching Photoshop's
    // distinction between rolling History states and durable snapshots.
    useEditorStore.getState().pushToast('History cleared; named snapshots kept', 'info')
  }

  const setBrushSource = (i: number) => {
    const d = engine.activeDoc
    if (!d?.history.states[i]) return
    const label = d.history.states[i].label
    engine.setHistoryBrushSnapshot(null)
    engine.setHistoryBrushSource(i)
    useEditorStore.getState().pushToast(`History Brush source: ${label}`, 'info')
  }

  const setSnapshotBrushSource = (id: string, name: string) => {
    engine.setHistoryBrushSnapshot(id)
    useEditorStore.getState().pushToast(`History Brush source: ${name}`, 'info')
  }

  const brushSource = (() => {
    const d = engine.activeDoc
    if (!d?.history.states.length) return 0
    return Math.max(0, Math.min(d.history.states.length - 1, d.historyBrushSourceIndex ?? 0))
  })()

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-0.5 p-1 border-b bg-panel/50">
        <PanelBtn title="Create named snapshot of current state" icon="Camera" onClick={createSnapshot} />
        <span className="flex-1" />
        <span className="text-[9px] text-muted-foreground pr-1">{snapshots.length} snapshot(s) · {labels.length} state(s)</span>
        <button
          className={cn(
            'h-7 px-2 rounded-sm flex items-center gap-1 text-[10px] transition-colors',
            confirmClear ? 'bg-destructive/15 text-destructive' : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
          )}
          title={confirmClear ? 'Click again to confirm' : 'Clear rolling history; named snapshots are preserved'}
          onClick={clearHistory}
        >
          <Icons.Trash2 size={12} />
          {confirmClear ? 'Sure?' : 'Clear'}
        </button>
      </div>

      {snapshots.length > 0 && (
        <div className="border-b border-border/60 bg-background/20">
          <div className="h-6 px-2 flex items-center gap-1 text-[9px] uppercase tracking-wide text-muted-foreground">
            <Icons.Camera size={10} className="text-primary" />
            Named Snapshots
          </div>
          <div className="max-h-32 overflow-y-auto zphoto-scroll">
            {snapshots.map(snap => {
              const isBrush = markedSnapshotId === snap.id
              return (
                <div key={snap.id} className="flex items-stretch border-t border-border/30 group">
                  <button
                    className={cn(
                      'w-7 shrink-0 grid place-items-center border-r border-border/30',
                      isBrush ? 'text-primary bg-primary/10' : 'text-muted-foreground/35 hover:text-foreground'
                    )}
                    onClick={() => setSnapshotBrushSource(snap.id, snap.name)}
                    title={isBrush ? 'Current History Brush snapshot source' : 'Use this snapshot for History/Art History Brush and Erase to History'}
                    aria-label={isBrush ? 'Current History Brush snapshot source' : `Use ${snap.name} as History Brush source`}
                  >
                    <Icons.Brush size={11} fill={isBrush ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    className="min-w-0 flex-1 px-2 py-1.5 text-left text-[11px] hover:bg-accent/30"
                    onClick={() => engine.applyHistorySnapshot(snap.id)}
                    onDoubleClick={() => renameSnapshot(snap.id, snap.name)}
                    title="Click to restore snapshot · double-click to rename"
                  >
                    <span className="block truncate">{snap.name}</span>
                    <span className="block text-[9px] text-muted-foreground/60">{new Date(snap.time).toLocaleTimeString()}</span>
                  </button>
                  <button
                    className="w-7 grid place-items-center text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
                    onClick={() => renameSnapshot(snap.id, snap.name)}
                    title="Rename snapshot"
                    aria-label={`Rename ${snap.name}`}
                  >
                    <Icons.Pencil size={10} />
                  </button>
                  <button
                    className="w-7 grid place-items-center text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                    onClick={() => engine.deleteHistorySnapshot(snap.id)}
                    title="Delete snapshot"
                    aria-label={`Delete ${snap.name}`}
                  >
                    <Icons.X size={10} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="h-6 px-2 flex items-center text-[9px] uppercase tracking-wide text-muted-foreground border-b border-border/40">
        History States
      </div>
      <FancyScroll className="flex-1 min-h-0" role="list" aria-label="History states">
        {labels.map((label, i) => {
          const { icon } = stateIcon(label)
          const Icon = (Icons as any)[icon] ?? Icons.CircleDot
          const isCurrent = i === index
          const isBrushSource = !markedSnapshotId && i === brushSource
          return (
            <div
              key={`${i}-${label}`}
              role="listitem"
              className={cn(
                'w-full border-b border-border/30 flex items-stretch group',
                isCurrent ? 'bg-accent/70 text-foreground border-l-2 border-l-primary' : i < index ? 'text-foreground/70 hover:bg-accent/30' : 'text-muted-foreground/40 hover:bg-accent/20'
              )}
            >
              <button
                className={cn(
                  'w-7 shrink-0 grid place-items-center border-r border-border/30',
                  isBrushSource ? 'text-primary bg-primary/10' : 'text-muted-foreground/35 hover:text-foreground'
                )}
                title={isBrushSource ? 'History Brush source' : `Use “${label}” as History Brush source`}
                aria-label={isBrushSource ? 'Current History Brush source' : `Set ${label} as History Brush source`}
                onClick={() => setBrushSource(i)}
              >
                <Icons.Brush size={11} fill={isBrushSource ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={() => engine.jumpHistory(i)}
                className="min-w-0 flex-1 text-left px-2 py-1.5 text-[11px] flex items-center gap-2"
                title={`Jump to: ${label}`}
              >
                <Icon size={11} className={cn('shrink-0', isCurrent ? 'text-primary' : 'opacity-60')} aria-hidden />
                <span className="truncate flex-1">{label}</span>
                <span className="text-[9px] text-muted-foreground/60 font-mono opacity-0 group-hover:opacity-100 transition-opacity">{i}</span>
              </button>
            </div>
          )
        })}
        {!labels.length && <div className="p-4 text-[11px] text-muted-foreground text-center">No history yet</div>}
      </FancyScroll>
    </div>
  )
}

// ================= Navigator =================
export function NavigatorPanel() {
  const tick = useEditorStore(s => s.renderTick)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layout = useRef({ scale: 1, offX: 0, offY: 0 })
  const panning = useRef(false)
  const lastKey = useRef('')
  const [zoomPct, setZoomPct] = useState(() => Math.round((engine.activeDoc?.view.zoom ?? 1) * 100))

  // live redraw loop — the viewport rect must track pan/zoom even when the
  // store doesn't emit (space-drag panning only requests a canvas redraw)
  useEffect(() => {
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const c = canvasRef.current
      const doc = engine.activeDoc
      if (!c || !doc) return
      const key = `${doc.id}|${tick}|${doc.view.zoom.toFixed(4)}|${Math.round(doc.view.panX)}|${Math.round(doc.view.panY)}`
      if (key === lastKey.current) return
      lastKey.current = key
      const ctx = c.getContext('2d')!
      const W = c.width, H = c.height
      ctx.clearRect(0, 0, W, H)
      const flat = getFlatComposite(doc)
      const scale = Math.min(W / doc.width, H / doc.height)
      const w = doc.width * scale, h = doc.height * scale
      const offX = (W - w) / 2, offY = (H - h) / 2
      layout.current = { scale, offX, offY }
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(flat, offX, offY, w, h)
      // viewport rect (visible region in doc space, mapped into preview coords)
      const host = getViewport().host
      const v = doc.view
      const vw = host?.clientWidth ?? 0, vh = host?.clientHeight ?? 0
      if (vw > 0 && vh > 0 && v.zoom > 0) {
        const x0 = offX + (-v.panX / v.zoom) * scale
        const y0 = offY + (-v.panY / v.zoom) * scale
        const rw = (vw / v.zoom) * scale
        const rh = (vh / v.zoom) * scale
        ctx.fillStyle = 'rgba(245,158,11,0.10)'
        ctx.fillRect(x0, y0, rw, rh)
        ctx.strokeStyle = 'rgba(245,158,11,0.95)'
        ctx.lineWidth = 1.5
        ctx.strokeRect(x0, y0, rw, rh)
      }
      const pct = Math.round(v.zoom * 100)
      setZoomPct(p => (p === pct ? p : pct))
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [tick])

  /** center the document point under the pointer and keep it there while dragging */
  const panTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current
    const doc = engine.activeDoc
    const host = getViewport().host
    if (!c || !doc || !host) return
    const rect = c.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * c.width
    const py = ((e.clientY - rect.top) / rect.height) * c.height
    const { scale, offX, offY } = layout.current
    const docX = (px - offX) / scale
    const docY = (py - offY) / scale
    doc.view.panX = host.clientWidth / 2 - docX * doc.view.zoom
    doc.view.panY = host.clientHeight / 2 - docY * doc.view.zoom
    // view-only: re-blit the cached composite — no recomposite while dragging
    engine.viewChanged()
  }

  const endPan = () => {
    if (!panning.current) return
    panning.current = false
    engine.emitView() // sync store mirrors (zoom readout etc.) — no composite
  }

  return (
    <div className="p-2 h-full flex flex-col gap-2 min-h-0">
      <canvas
        ref={canvasRef}
        width={240}
        height={160}
        className="w-full aspect-[3/2] max-h-[240px] mx-auto rounded bg-black/40 checker cursor-grab active:cursor-grabbing touch-none"
        aria-label="Navigator preview — drag to pan"
        onPointerDown={e => {
          e.preventDefault()
          panning.current = true
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          panTo(e)
        }}
        onPointerMove={e => { if (panning.current) panTo(e) }}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      />

      {/* zoom controls */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <button
          className="w-6 h-6 rounded border text-muted-foreground hover:text-foreground text-[11px] shrink-0"
          title="Zoom out"
          onClick={() => engine.zoomBy(1 / 1.25)}
        >−</button>
        <input
          type="range" min={2} max={3200} value={zoomPct}
          onChange={e => engine.setZoom(Number(e.target.value) / 100)}
          className="flex-1 accent-primary"
          aria-label="Zoom"
        />
        <button
          className="w-6 h-6 rounded border text-muted-foreground hover:text-foreground text-[11px] shrink-0"
          title="Zoom in"
          onClick={() => engine.zoomBy(1.25)}
        >+</button>
      </div>

      <div className="flex items-center gap-1">
        <button
          className="flex-1 h-6 rounded border text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/40"
          onClick={() => getViewport().fit()}
          title="Fit image in window"
        >Fit</button>
        <button
          className="flex-1 h-6 rounded border text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/40"
          onClick={() => engine.setZoom(1)}
          title="Zoom to 100% (actual pixels)"
        >100%</button>
        <span className="text-[10px] text-muted-foreground font-mono w-12 text-right">{zoomPct}%</span>
      </div>
    </div>
  )
}

// ================= Histogram =================
type HistChannel = 'rgb' | 'l' | 'colors'

interface HistData {
  r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array
  total: number; mean: number; std: number; median: number
}

/** stride-sampled histogram + luminance stats (max ~400k samples keeps this snappy) */
function computeHist(img: ImageData): HistData {
  const d = img.data
  const px = d.length / 4
  const stride = Math.max(1, Math.floor(px / 400_000))
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256)
  let total = 0
  for (let i = 0; i < d.length; i += 4 * stride) {
    if (d[i + 3] < 8) continue
    r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++
    l[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++
    total++
  }
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * l[i]
  const mean = total ? sum / total : 0
  let variance = 0
  for (let i = 0; i < 256; i++) { const dv = i - mean; variance += dv * dv * l[i] }
  const std = total ? Math.sqrt(variance / total) : 0
  let cum = 0, median = 0
  const half = total / 2
  for (let i = 0; i < 256; i++) { cum += l[i]; if (cum >= half) { median = i; break } }
  return { r, g, b, l, total, mean, std, median }
}

export function HistogramPanel() {
  const tick = useEditorStore(s => s.renderTick)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [channel, setChannel] = useState<HistChannel>('rgb')
  const [stats, setStats] = useState<{ mean: number; std: number; median: number; total: number } | null>(null)
  const lastRun = useRef(0)
  const lastChannel = useRef<HistChannel>('rgb')
  const lastDocId = useRef<string | null>(null)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (pending.current) clearTimeout(pending.current) }, [])

  const drawNow = () => {
    lastRun.current = performance.now()
    const c = canvasRef.current
    const doc = engine.activeDoc
    if (!c || !doc) return
    const ctx = c.getContext('2d')!
    const W = c.width, H = c.height
    ctx.fillStyle = '#0d0d0d'
    ctx.fillRect(0, 0, W, H)
    const flat = getFlatComposite(doc)
    // downscale before the readback: a histogram over a ≤512px proxy is
    // statistically identical to the stride-sampled full-res pass, but the
    // getImageData copy drops from ~48 MB (12 MP photo) to ~1 MB — the panel
    // stops stalling the main thread on large documents
    const maxDim = Math.max(doc.width, doc.height)
    const s = maxDim > 512 ? 512 / maxDim : 1
    let img: ImageData
    if (s < 1) {
      const small = createCanvas(Math.max(1, Math.round(doc.width * s)), Math.max(1, Math.round(doc.height * s)))
      ctx2d(small).drawImage(flat, 0, 0, small.width, small.height)
      img = getImageData(small)
    } else {
      img = getImageData(flat)
    }
    const hist = computeHist(img)
    setStats({ mean: hist.mean, std: hist.std, median: hist.median, total: hist.total })

    const maxL = Math.max(...hist.l) || 1
    const drawChannelLine = (arr: Uint32Array, color: string, max: number) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i < 256; i++) {
        const h = (Math.log1p(arr[i]) / Math.log1p(max)) * (H - 6)
        const x = (i / 256) * W
        if (i === 0) ctx.moveTo(x, H - h)
        else ctx.lineTo(x, H - h)
      }
      ctx.stroke()
    }

    if (channel === 'rgb' || channel === 'l') {
      // luminance fill
      ctx.fillStyle = channel === 'l' ? 'rgba(245,158,11,0.35)' : 'rgba(160,160,160,0.55)'
      for (let i = 0; i < 256; i++) {
        const h = (hist.l[i] / maxL) * (H - 4)
        ctx.fillRect((i / 256) * W, H - h, W / 256 + 0.5, h)
      }
    }
    if (channel === 'rgb' || channel === 'colors') {
      const maxC = Math.max(...hist.r, ...hist.g, ...hist.b) || 1
      drawChannelLine(hist.r, 'rgba(239,68,68,0.75)', maxC)
      drawChannelLine(hist.g, 'rgba(34,197,94,0.75)', maxC)
      drawChannelLine(hist.b, 'rgba(59,130,246,0.75)', maxC)
    }

    // grid lines at 25% / 50% / 75%
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    for (let f = 0.25; f < 0.9; f += 0.25) {
      const y = Math.round(H * f) + 0.5
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }
  }

  useEffect(() => {
    const doc = engine.activeDoc
    const forced = channel !== lastChannel.current || doc?.id !== lastDocId.current || lastRun.current === 0
    lastChannel.current = channel
    lastDocId.current = doc?.id ?? null
    const elapsed = performance.now() - lastRun.current
    if (!forced && elapsed < 400) {
      // trailing redraw so the final state is always rendered
      if (pending.current) clearTimeout(pending.current)
      pending.current = setTimeout(drawNow, 400 - elapsed)
      return
    }
    if (pending.current) clearTimeout(pending.current)
    pending.current = setTimeout(drawNow, 0)
  }, [tick, channel])

  return (
    <div className="p-2 space-y-1.5">
      {/* header + channel select */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex-1">Histogram</span>
        <div className="flex rounded border overflow-hidden">
          {(['rgb', 'l', 'colors'] as HistChannel[]).map(ch => (
            <button
              key={ch}
              className={cn(
                'px-1.5 h-5 text-[9px] uppercase transition-colors',
                channel === ch ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setChannel(ch)}
              title={ch === 'rgb' ? 'RGB + luminance' : ch === 'l' ? 'Luminosity' : 'Color channels only'}
            >{ch === 'colors' ? 'Colors' : ch.toUpperCase()}</button>
          ))}
        </div>
      </div>

      <canvas ref={canvasRef} width={240} height={110} className="w-full rounded border" aria-label="Histogram" />

      {/* stats row */}
      <div className="grid grid-cols-4 gap-1 text-[9px] font-mono text-muted-foreground">
        <span title="Mean luminance">μ {stats ? stats.mean.toFixed(1) : '—'}</span>
        <span title="Standard deviation">σ {stats ? stats.std.toFixed(1) : '—'}</span>
        <span title="Median luminance">med {stats ? stats.median : '—'}</span>
        <span className="text-right" title="Sampled pixels">{stats ? stats.total.toLocaleString() : '—'}</span>
      </div>

      <div className="flex justify-between text-[9px] text-muted-foreground/70">
        {channel === 'l'
          ? <><span>0</span><span className="text-primary/80">Luminosity (fill)</span><span>255</span></>
          : <><span className="text-red-500/80">R</span><span className="text-green-500/80">G</span><span className="text-blue-500/80">B</span>{channel === 'rgb' && <span className="ml-auto">Lum (fill)</span>}</>}
      </div>
    </div>
  )
}
