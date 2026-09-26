'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, RotateCcw, Stamp, Trash2, Upload } from 'lucide-react'
import { useEditorStore } from '../../store'
import { engine } from '../../engine/engine'
import {
  clearCloneSourceSlot, exportCloneSourcePreset, getCloneSourceSlots, importCloneSourcePreset,
  type CloneSourceSlotInfo,
} from '../../tools/clone-stamp'

function sourceThumb(slot: CloneSourceSlotInfo): string | null {
  if (!slot.source || !slot.point || typeof document === 'undefined') return null
  const out = document.createElement('canvas')
  out.width = 72
  out.height = 72
  const ctx = out.getContext('2d')
  if (!ctx) return null
  const sample = 96
  ctx.fillStyle = '#161616'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    slot.source,
    slot.point.x - sample / 2, slot.point.y - sample / 2, sample, sample,
    0, 0, out.width, out.height,
  )
  return out.toDataURL('image/png')
}

export function CloneSourcePanel() {
  const renderTick = useEditorStore(s => s.renderTick)
  const opts = useEditorStore(s => s.toolOptions['clone-stamp'] ?? {})
  const setOpt = useEditorStore(s => s.setToolOption)
  const setTool = useEditorStore(s => s.setTool)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const onChange = () => setRefresh(v => v + 1)
    window.addEventListener('zphoto:clone-source', onChange)
    return () => window.removeEventListener('zphoto:clone-source', onChange)
  }, [])

  const selected = Math.max(0, Math.min(4, Math.round(Number(opts.sourceSlot) || 1) - 1))
  const slots = useMemo(() => getCloneSourceSlots(), [selected, renderTick, refresh])
  const thumbs = useMemo(() => slots.map(sourceThumb), [slots])
  const current = slots[selected]

  const set = (key: string, value: unknown) => setOpt('clone-stamp', key, value)

  const exportPreset = () => {
    try {
      const preset = exportCloneSourcePreset(engine.activeDoc?.name ? `${engine.activeDoc.name} Clone Sources` : 'Clone Sources')
      const blob = new Blob([JSON.stringify(preset)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const base = (engine.activeDoc?.name || 'clone-source').replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '-')
      a.href = url
      a.download = `${base}.clone-source.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      useEditorStore.getState().pushToast('Clone Source preset exported', 'success')
    } catch (err) {
      useEditorStore.getState().pushToast(err instanceof Error ? err.message : 'Clone Source export failed', 'error')
    }
  }

  const importPreset = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text())
      const count = await importCloneSourcePreset(raw)
      setRefresh(v => v + 1)
      useEditorStore.getState().pushToast(`Loaded ${count} Clone Source slot${count === 1 ? '' : 's'}`, 'success')
    } catch (err) {
      useEditorStore.getState().pushToast(err instanceof Error ? err.message : 'Clone Source import failed', 'error')
    }
  }

  return (
    <div className="p-2 flex flex-col gap-2 text-xs" aria-label="Clone Source panel">
      <div className="flex items-center justify-between">
        <div className="font-medium flex items-center gap-1.5"><Stamp size={13} /> Clone Source</div>
        <button
          className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-accent"
          onClick={() => setTool('clone-stamp')}
          title="Activate Clone Stamp"
        >
          Use Tool
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          className="flex items-center justify-center gap-1.5 rounded border border-border px-2 py-1.5 hover:bg-accent"
          onClick={exportPreset}
          title="Export all five Clone Source slots, embedded source snapshots and per-slot transforms"
        >
          <Download size={12} /> Export Sources
        </button>
        <label
          className="flex items-center justify-center gap-1.5 rounded border border-border px-2 py-1.5 hover:bg-accent cursor-pointer"
          title="Load a .clone-source.json preset"
        >
          <Upload size={12} /> Import Sources
          <input
            type="file"
            accept=".json,.clone-source.json,application/json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              e.currentTarget.value = ''
              if (file) void importPreset(file)
            }}
          />
        </label>
      </div>

      <div className="grid grid-cols-5 gap-1">
        {slots.map((slot, i) => (
          <button
            key={i}
            className={[
              'relative aspect-square rounded border overflow-hidden bg-muted/30',
              i === selected ? 'border-primary ring-1 ring-primary/50' : 'border-border hover:border-muted-foreground',
            ].join(' ')}
            onClick={() => set('sourceSlot', i + 1)}
            title={slot.hasSource && slot.point ? `Source #${i + 1} · ${Math.round(slot.point.x)}, ${Math.round(slot.point.y)}` : `Source #${i + 1} · unset`}
          >
            {thumbs[i]
              ? <img src={thumbs[i]!} alt="" className="w-full h-full object-cover" draggable={false} />
              : <span className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[10px]">{i + 1}</span>}
            <span className="absolute left-0.5 top-0.5 min-w-3.5 h-3.5 px-0.5 rounded-sm bg-black/65 text-white text-[9px] leading-[14px] text-center">
              {i + 1}
            </span>
          </button>
        ))}
      </div>

      <div className="rounded border border-border bg-muted/20 p-2 flex items-center gap-2">
        <div className="w-14 h-14 rounded border border-border overflow-hidden bg-background shrink-0">
          {thumbs[selected]
            ? <img src={thumbs[selected]!} alt="" className="w-full h-full object-cover" draggable={false} />
            : <div className="w-full h-full grid place-items-center text-muted-foreground">Alt+click</div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium">Source #{selected + 1}</div>
          <div className="text-muted-foreground tabular-nums">
            {current?.point ? `X ${Math.round(current.point.x)} · Y ${Math.round(current.point.y)}` : 'No source registered'}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">Alt/Option-click the image to register this slot.</div>
        </div>
        <button
          className="p-1 rounded hover:bg-destructive/15 hover:text-destructive disabled:opacity-30"
          onClick={() => clearCloneSourceSlot(selected)}
          disabled={!current?.hasSource}
          title="Clear this source"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="grid grid-cols-[72px_1fr_46px] items-center gap-x-2 gap-y-1.5">
        <label className="text-muted-foreground">Scale</label>
        <input
          type="range" min={25} max={400} step={1}
          value={Number(opts.scale) || 100}
          onChange={e => set('scale', Number(e.target.value))}
          className="w-full"
        />
        <span className="text-right tabular-nums">{Math.round(Number(opts.scale) || 100)}%</span>

        <label className="text-muted-foreground">Rotate</label>
        <input
          type="range" min={-180} max={180} step={1}
          value={Number(opts.rotate) || 0}
          onChange={e => set('rotate', Number(e.target.value))}
          className="w-full"
        />
        <span className="text-right tabular-nums">{Math.round(Number(opts.rotate) || 0)}°</span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex items-center gap-1.5 rounded border border-border px-2 py-1.5 cursor-pointer">
          <input type="checkbox" checked={opts.aligned !== false} onChange={e => set('aligned', e.target.checked)} />
          <span>Aligned</span>
        </label>
        <label className="flex items-center gap-1.5 rounded border border-border px-2 py-1.5 cursor-pointer">
          <input type="checkbox" checked={opts.mirrored === true} onChange={e => set('mirrored', e.target.checked)} />
          <span>Flip H</span>
        </label>
      </div>

      <div className="grid grid-cols-[72px_1fr_46px] items-center gap-x-2 gap-y-1.5">
        <label className="text-muted-foreground">Overlay</label>
        <input
          type="range" min={0} max={100} step={1}
          value={Number(opts.overlayOpacity) || 0}
          onChange={e => set('overlayOpacity', Number(e.target.value))}
          className="w-full"
          disabled={opts.showOverlay === false}
        />
        <span className="text-right tabular-nums">{Math.round(Number(opts.overlayOpacity) || 0)}%</span>
      </div>

      <label className="flex items-center gap-1.5 rounded border border-border px-2 py-1.5 cursor-pointer">
        <input type="checkbox" checked={opts.showOverlay !== false} onChange={e => set('showOverlay', e.target.checked)} />
        <span>Show source overlay at cursor</span>
      </label>

      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex items-center gap-1.5 rounded border border-border px-2 py-1.5 cursor-pointer">
          <input type="checkbox" checked={opts.overlayAutoHide !== false} onChange={e => set('overlayAutoHide', e.target.checked)} />
          <span>Auto Hide</span>
        </label>
        <label className="flex items-center gap-1.5 rounded border border-border px-2 py-1.5 cursor-pointer">
          <input type="checkbox" checked={opts.overlayInvert === true} onChange={e => set('overlayInvert', e.target.checked)} />
          <span>Invert</span>
        </label>
      </div>

      <button
        className="flex items-center justify-center gap-1.5 rounded border border-border px-2 py-1.5 hover:bg-accent"
        onClick={() => { set('scale', 100); set('rotate', 0); set('mirrored', false); set('overlayOpacity', 50); set('showOverlay', true); set('overlayAutoHide', true); set('overlayInvert', false) }}
      >
        <RotateCcw size={12} /> Reset transform
      </button>

      <div className="text-[10px] leading-relaxed text-muted-foreground">
        Scale, rotation, flip and overlay settings are remembered independently for each source slot. Export Sources embeds the source snapshots and transforms in a portable preset. Imported sources reset the destination alignment anchor for safety.
      </div>
    </div>
  )
}
