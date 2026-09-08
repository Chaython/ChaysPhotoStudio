'use client'
// ============================================================
// Color panel — TASK 2-C
// fg/bg targets, SV square + hue slider, RGB + HSL numeric rows,
// swatches, persistent recent-colors memory (localStorage)
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { useEditorStore } from '../../store'
import { rgbToHex, hexToRgb, rgbToHsv, hsvToRgb, clamp } from '../../utils/canvas'
import { cn } from '@/lib/utils'
import { ArrowLeftRight, RotateCcw, Eraser } from 'lucide-react'

const SWATCHES = [
  '#000000', '#ffffff', '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#f43f5e', '#78716c', '#a8a29e', '#57534e',
]

const RECENTS_KEY = 'zphoto-recent-colors'
const RECENTS_MAX = 10
const HEX_RE = /^#[0-9a-fA-F]{6}$/

// ---------- HSL helpers (local — utils only ships HSV) ----------
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  let h = 0, s = 0
  if (d > 0) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360
  const ss = clamp(s, 0, 100) / 100
  const ll = clamp(l, 0, 100) / 100
  if (ss === 0) { const v = Math.round(ll * 255); return [v, v, v] }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss
  const p = 2 * ll - q
  const hue2rgb = (t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return [Math.round(hue2rgb(hh + 1 / 3) * 255), Math.round(hue2rgb(hh) * 255), Math.round(hue2rgb(hh - 1 / 3) * 255)]
}

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        return arr.filter((x: unknown): x is string => typeof x === 'string' && HEX_RE.test(x)).slice(0, RECENTS_MAX)
      }
    }
  } catch { /* ignore */ }
  return []
}

export function ColorPanel() {
  const fg = useEditorStore(s => s.fgColor)
  const bg = useEditorStore(s => s.bgColor)
  const setFg = useEditorStore(s => s.setFgColor)
  const setBg = useEditorStore(s => s.setBgColor)
  const swap = useEditorStore(s => s.swapColors)
  const active = useEditorStore(s => s.activeColorTarget)
  const setActive = useEditorStore(s => s.setActiveColorTarget)

  const [hex, setHex] = useState(fg)
  const [lastHexValid, setLastHexValid] = useState(fg)
  const [recents, setRecents] = useState<string[]>([])
  const recentsRef = useRef<string[]>([])

  // load recent-colors memory (client only)
  useEffect(() => {
    const loaded = loadRecents()
    recentsRef.current = loaded
    setRecents(loaded)
  }, [])

  const current = active === 'fg' ? fg : bg

  // keep the hex field in sync with external color changes (eyedropper, menus…)
  useEffect(() => {
    if (current.toLowerCase() !== lastHexValid.toLowerCase()) {
      setHex(current)
      setLastHexValid(current)
    }
  }, [current, lastHexValid])

  const [r, g, b] = hexToRgb(current)
  const [h, s, v] = rgbToHsv(r, g, b)
  const [hDeg, sPct, lPct] = rgbToHsl(r, g, b)

  const applyHex = (hx: string, remember = false) => {
    setHex(hx)
    setLastHexValid(hx)
    if (active === 'fg') setFg(hx); else setBg(hx)
    if (remember) pushRecent(hx)
  }

  const pushRecent = (c: string) => {
    const val = c.toLowerCase()
    if (!HEX_RE.test(val)) return
    if (recentsRef.current[0] === val) return
    const next = [val, ...recentsRef.current.filter(x => x !== val)].slice(0, RECENTS_MAX)
    recentsRef.current = next
    setRecents(next)
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const commit = (hr: number, sg: number, vv: number) => {
    const [nr, ng, nb] = hsvToRgb(hr, sg, vv)
    applyHex(rgbToHex(nr, ng, nb))
  }

  const commitHsl = (hh: number, ss: number, ll: number) => {
    const [nr, ng, nb] = hslToRgb(hh, ss, ll)
    applyHex(rgbToHex(nr, ng, nb))
  }

  const commitRgb = (nr: number, ng: number, nb: number) => {
    applyHex(rgbToHex(
      Math.round(clamp(nr, 0, 255)),
      Math.round(clamp(ng, 0, 255)),
      Math.round(clamp(nb, 0, 255))
    ))
  }

  const svRef = useRef<HTMLDivElement>(null)
  const svDragging = useRef(false)

  const pickSv = (e: { clientX: number; clientY: number }) => {
    const el = svRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const sx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const sy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    commit(h, sx * 100, (1 - sy) * 100)
  }

  return (
    <div className="p-2 flex flex-col gap-2" aria-label="Color picker">
      {/* fg/bg chips */}
      <div className="flex items-center gap-2">
        <div className="relative w-14 h-10">
          <button
            className={cn('absolute left-0 top-0 w-7 h-7 rounded border-2 shadow', active === 'fg' ? 'border-primary z-10' : 'border-border')}
            style={{ background: fg }}
            onClick={() => setActive('fg')}
            aria-label="Foreground color"
            title="Foreground"
          />
          <button
            className={cn('absolute left-5 top-4 w-7 h-7 rounded border-2 shadow', active === 'bg' ? 'border-primary z-10' : 'border-border')}
            style={{ background: bg }}
            onClick={() => setActive('bg')}
            aria-label="Background color"
            title="Background"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <button className="text-muted-foreground hover:text-foreground" onClick={swap} title="Swap (X)"><ArrowLeftRight size={12} /></button>
          <button
            className="text-muted-foreground hover:text-foreground"
            title="Reset to black/white"
            onClick={() => { setFg('#000000'); setBg('#ffffff'); setHex('#000000'); setLastHexValid('#000000') }}
          ><RotateCcw size={12} /></button>
        </div>
        <div className="flex-1">
          <Input
            value={hex}
            onChange={e => {
              setHex(e.target.value)
              if (HEX_RE.test(e.target.value)) {
                setLastHexValid(e.target.value)
                if (active === 'fg') setFg(e.target.value); else setBg(e.target.value)
              }
            }}
            onBlur={() => pushRecent(lastHexValid)}
            onKeyDown={e => { if (e.key === 'Enter') pushRecent(lastHexValid) }}
            className="h-6 text-[11px] font-mono"
            aria-label="Hex color"
          />
        </div>
      </div>

      {/* SV square */}
      <div
        ref={svRef}
        className="relative h-24 rounded cursor-crosshair border overflow-hidden touch-none"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureHue()})`,
        }}
        onPointerDown={e => { svDragging.current = true; pickSv(e) }}
        onPointerMove={e => { if (svDragging.current) pickSv(e) }}
        onPointerUp={() => { svDragging.current = false; pushRecent(lastHexValid) }}
        onPointerCancel={() => { svDragging.current = false }}
      >
        <div
          className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-white shadow pointer-events-none"
          style={{ left: `${s}%`, top: `${100 - v}%` }}
        />
      </div>

      {/* hue slider */}
      <input
        type="range" min={0} max={360} value={h}
        onChange={e => commit(Number(e.target.value), s, v)}
        onPointerUp={() => pushRecent(lastHexValid)}
        className="w-full h-3 rounded appearance-none cursor-pointer"
        style={{ background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' }}
        aria-label="Hue"
      />

      {/* rgb readouts */}
      <div className="grid grid-cols-3 gap-1">
        {([['R', r], ['G', g], ['B', b]] as const).map(([label, val]) => (
          <div key={label} className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">{label}</span>
            <Input
              type="number" min={0} max={255} value={val}
              onChange={e => {
                const n = Number(e.target.value)
                if (Number.isNaN(n)) return
                const nr = label === 'R' ? n : r
                const ng = label === 'G' ? n : g
                const nb = label === 'B' ? n : b
                commitRgb(nr, ng, nb)
              }}
              onBlur={() => pushRecent(lastHexValid)}
              className="h-5 text-[10px] font-mono px-1"
            />
          </div>
        ))}
      </div>

      {/* hsl readouts */}
      <div className="grid grid-cols-3 gap-1">
        {([['H', hDeg, 360, '°'], ['S', sPct, 100, '%'], ['L', lPct, 100, '%']] as const).map(([label, val, max, unit]) => (
          <div key={label} className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">{label}</span>
            <Input
              type="number" min={0} max={max} value={val}
              onChange={e => {
                const n = Number(e.target.value)
                if (Number.isNaN(n)) return
                const hh = label === 'H' ? n : hDeg
                const ss = label === 'S' ? n : sPct
                const ll = label === 'L' ? n : lPct
                commitHsl(hh, ss, ll)
              }}
              onBlur={() => pushRecent(lastHexValid)}
              className="h-5 text-[10px] font-mono px-1"
              aria-label={`${label} (${unit})`}
            />
          </div>
        ))}
      </div>

      {/* swatches */}
      <div className="grid grid-cols-10 gap-1">
        {SWATCHES.map(sw => (
          <button
            key={sw}
            className="w-full aspect-square rounded-sm border border-border/60 hover:scale-110 transition-transform"
            style={{ background: sw }}
            onClick={() => applyHex(sw, true)}
            aria-label={`Swatch ${sw}`}
            title={sw}
          />
        ))}
      </div>

      {/* recent colors */}
      <div>
        <div className="flex items-center gap-1 mb-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex-1">Recent</span>
          {recents.length > 0 && (
            <button
              className="text-muted-foreground/60 hover:text-destructive"
              title="Clear recent colors"
              onClick={() => {
                recentsRef.current = []
                setRecents([])
                try { localStorage.removeItem(RECENTS_KEY) } catch { /* ignore */ }
              }}
              aria-label="Clear recent colors"
            ><Eraser size={11} /></button>
          )}
        </div>
        <div className="grid grid-cols-10 gap-1">
          {Array.from({ length: RECENTS_MAX }).map((_, i) => {
            const c = recents[i]
            return c ? (
              <button
                key={c}
                className="w-full aspect-square rounded-sm border border-border/60 hover:scale-110 transition-transform"
                style={{ background: c }}
                onClick={() => applyHex(c, true)}
                aria-label={`Recent color ${c}`}
                title={c}
              />
            ) : (
              <div key={`empty-${i}`} className="w-full aspect-square rounded-sm border border-dashed border-border/40" aria-hidden />
            )
          })}
        </div>
      </div>
    </div>
  )

  function pureHue() {
    const [r1, g1, b1] = hsvToRgb(h, 100, 100)
    return rgbToHex(r1, g1, b1)
  }
}
