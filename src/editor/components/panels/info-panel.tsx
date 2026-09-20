'use client'

import { useMemo } from 'react'
import { Crosshair, Info, Trash2 } from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { readColor } from '../../tools/color-readout'

export function InfoPanel() {
  const tick = useEditorStore(s => s.renderTick)
  const opts = useEditorStore(s => s.toolOptions['color-sampler'] ?? {})
  const setOpt = useEditorStore(s => s.setToolOption)
  const setTool = useEditorStore(s => s.setTool)
  void tick

  const doc = engine.activeDoc
  const samplers = doc?.colorSamplers ?? []
  const scope = opts.sample === 'layer' ? 'layer' : 'composite'
  const sampleSize = Math.max(1, Number(opts.radius) || 1)
  const radius = Math.max(0, Math.floor((sampleSize - 1) / 2))

  const rows = useMemo(() => samplers.map((p, index) => {
    const hex = engine.sampleColor(p.x, p.y, scope, radius) ?? '#000000'
    return { p, index, value: readColor(hex) }
  }), [tick, scope, radius, samplers.length, doc?.id])

  return (
    <div className="h-full min-h-0 flex flex-col text-xs" aria-label="Info panel">
      <div className="p-2 border-b border-border flex items-center gap-2">
        <Info size={13} />
        <span className="font-medium">Info / Color Samplers</span>
        <span className="flex-1" />
        <button
          className="h-7 px-2 rounded border border-border hover:bg-accent flex items-center gap-1"
          onClick={() => setTool('color-sampler')}
          title="Activate Color Sampler"
        >
          <Crosshair size={12} /> Sample
        </button>
      </div>

      <div className="p-2 border-b border-border grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-muted-foreground">
          Source
          <select
            className="h-7 rounded border border-border bg-background px-1 text-foreground"
            value={scope}
            onChange={e => setOpt('color-sampler', 'sample', e.target.value)}
          >
            <option value="composite">All Layers</option>
            <option value="layer">Current Layer</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-muted-foreground">
          Sample
          <select
            className="h-7 rounded border border-border bg-background px-1 text-foreground"
            value={sampleSize}
            onChange={e => setOpt('color-sampler', 'radius', Number(e.target.value))}
          >
            {[1, 3, 5, 7, 11].map(n => <option key={n} value={n}>{n === 1 ? 'Point' : `${n} × ${n}`}</option>)}
          </select>
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {rows.map(({ p, index, value }) => {
          const [r, g, b] = value.rgb
          const [h, s, l] = value.hsl
          const [ll, aa, bb] = value.lab
          const [c, m, y, k] = value.cmyk
          return (
            <div key={p.id} className="p-2 border-b border-border/50">
              <div className="flex items-center gap-2 mb-1.5">
                <div
                  className="w-7 h-7 rounded border border-border shrink-0"
                  style={{ backgroundColor: value.hex }}
                  title={value.hex}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">#{index + 1} <span className="font-mono">{value.hex}</span></div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    X {p.x.toFixed(1)} · Y {p.y.toFixed(1)}
                  </div>
                </div>
                <button
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={() => engine.removeColorSampler(p.id)}
                  title="Remove sampler"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="grid grid-cols-[38px_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px] tabular-nums">
                <span className="text-muted-foreground">RGB</span><span>{r}, {g}, {b}</span>
                <span className="text-muted-foreground">HSL</span><span>{Math.round(h)}°, {Math.round(s)}%, {Math.round(l)}%</span>
                <span className="text-muted-foreground">Lab</span><span>{ll.toFixed(1)}, {aa.toFixed(1)}, {bb.toFixed(1)}</span>
                <span className="text-muted-foreground">CMYK</span><span>{Math.round(c)}%, {Math.round(m)}%, {Math.round(y)}%, {Math.round(k)}%</span>
              </div>
            </div>
          )
        })}
        {!rows.length && (
          <div className="p-5 text-center text-muted-foreground text-[11px] leading-relaxed">
            Select the Color Sampler tool and click the image to add persistent sample points.
            <br />Alt/Option-click a point to remove it.
          </div>
        )}
      </div>

      {!!rows.length && (
        <div className="p-2 border-t border-border">
          <button
            className="w-full h-7 rounded border border-border hover:bg-destructive/10 hover:text-destructive flex items-center justify-center gap-1"
            onClick={() => engine.clearColorSamplers()}
          >
            <Trash2 size={12} /> Clear all samplers
          </button>
        </div>
      )}
    </div>
  )
}
