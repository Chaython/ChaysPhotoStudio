// ============================================================
// Brush / Pencil — GIMP-style Symmetry Painting + brush dynamics
// (Task 5-d):
//  · symmetry: mirror-x / mirror-y / point / mandala (2N dabs)
//  · scatter: random per-dab offset within a disk (per mirrored dab)
//  · fade: flow scales down to 0 over the first `fade` px of stroke length
//  · smoothing: lazy-brush filtered cursor (follow factor 1 - s/100·0.88)
//  · airbrush: stationary pointer keeps stamping at flow·0.18 every ~50ms
//  · dynamics: 'off' | 'velocity' (size) | 'velocity-opacity' (flow) |
//    'pressure' (pen → size); pen pressure → flow always (existing)
//  · pen pressure → flow ramp (mouse/touch gets full flow)
// Image-stamp brushes (Task 7-A):
//  · when an imported brush preset (GIMP .gbr) is ACTIVE, every dab
//    draws the preset canvas centered at (dx,dy) scaled so its largest
//    dimension ≈ 2·radius (brush size), axis-aligned (no rotation, v1),
//    alpha through the existing engine.dab flow/pressure path.
//  · the stamp is resolved LIVE at stroke start (brushPresets cache)
//    so runtime-installed brushes work without remounts; the whole
//    stroke keeps ONE resolved stamp (consistency within a stroke).
// Procedural tip library (Task 1-A):
//  · when NO image stamp is resolved, the dab shape comes from
//    tools/brush-tips.ts (`opts.tip`, default 'round-soft') — 10 tips
//    with per-tip default settings written by the tip picker.
//  · angle + angleFollow: rotatable tips (flat/angled/bristle/hair)
//    rotate per dab — angleFollow points them along the EMA-smoothed
//    travel direction (vector-EMA, wrap-safe) + the angle offset.
//  · roundness squashes the calligraphy nib.
//  · color jitter: at stroke start a 6-color quantized palette is
//    generated around the fg color; each dab picks a random entry
//    (keeps the stamp cache bounded — see brush-tips.ts).
//  · shape-aware cursor via drawTipCursor (rotated ellipse/square/fan).
//  · pencil paints TRUE aliased dabs (shared.pencilDab — thresholded
//    hard nib, pixel-perfect 0/255 edges, no tips/stamps/jitter).
// All mutable state lives inside the factory closure — nothing leaks
// between strokes, and brush/pencil each get their own closure.
// Single engine.beginStroke/endStroke per stroke; symmetry expands each
// dab into N positions on the shared stroke buffer.
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { clamp, createCanvas, ctx2d } from '../utils/canvas'
import {
  getOptions, brushSettingsFrom, getFgColor, getBgColor, walkDabs, softDab, pencilDab, drawBrushCursor,
  symmetricPoints, drawSymmetryOverlay, ema,
} from './shared'
import { getActiveId, getById, getCachedStampCanvas, warmPreset } from '../plugins/brush-presets'
import { getTip, drawTipCursor, jitterPalette, tipExtentMul } from './brush-tips'
import { useEditorStore } from '../store'

/** airbrush build-up: stamp cadence (ms) and flow reduction while stationary */
const AIRBRUSH_INTERVAL_MS = 50
const AIRBRUSH_FLOW_FACTOR = 0.18
/** EMA weight for the smoothed pointer speed (px/ms) */
const SPEED_EMA = 0.3
/** EMA weight for the smoothed travel direction (vector EMA — wrap-safe) */
const DIR_EMA = 0.35
const RAD = Math.PI / 180

let decoratedDabCanvas: HTMLCanvasElement | null = null
let dualMaskCanvas: HTMLCanvasElement | null = null
const textureTiles = new Map<string, HTMLCanvasElement>()

function scratchCanvas(which: 'dab' | 'dual', size: number): HTMLCanvasElement {
  const s = Math.max(4, Math.ceil(size))
  let cv = which === 'dab' ? decoratedDabCanvas : dualMaskCanvas
  if (!cv || cv.width !== s || cv.height !== s) cv = createCanvas(s, s)
  if (which === 'dab') decoratedDabCanvas = cv
  else dualMaskCanvas = cv
  ctx2d(cv).clearRect(0, 0, s, s)
  return cv
}

function hashNoise(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) | 0
  n = (n ^ (n >>> 13)) * 1274126177
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

function brushTextureTile(kind: string, scalePct: number, depthPct: number, invert: boolean): HTMLCanvasElement {
  const size = clamp(Math.round(24 * clamp(scalePct, 25, 400) / 100), 6, 96)
  const depth = clamp(depthPct / 100, 0, 1)
  const key = `${kind}:${size}:${Math.round(depth * 100)}:${invert ? 1 : 0}`
  const hit = textureTiles.get(key)
  if (hit) return hit
  const cv = createCanvas(size, size)
  const cx = ctx2d(cv)
  const img = cx.createImageData(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 1
    if (kind === 'noise') {
      v = .18 + hashNoise(x, y) * .82
    } else if (kind === 'paper') {
      const a = hashNoise(x, y)
      const b = hashNoise(Math.floor(x / 2) + 101, Math.floor(y / 2) + 211)
      v = .28 + (a * .45 + b * .55) * .72
    } else if (kind === 'dots') {
      const cell = Math.max(4, Math.round(size / 3))
      const dx = (x % cell) - cell / 2
      const dy = (y % cell) - cell / 2
      const rr = Math.hypot(dx, dy) / Math.max(1, cell * .34)
      v = rr <= 1 ? .25 + rr * .45 : 1
    } else {
      // woven canvas: two perpendicular thread bands with mild grain.
      const tx = .5 + .5 * Math.cos((x / Math.max(1, size)) * Math.PI * 8)
      const ty = .5 + .5 * Math.cos((y / Math.max(1, size)) * Math.PI * 8)
      v = .35 + (tx * .32 + ty * .32 + hashNoise(x, y) * .12)
    }
    v = clamp(v, 0, 1)
    if (invert) v = 1 - v
    const alpha = Math.round(255 * ((1 - depth) + depth * v))
    const i = (y * size + x) * 4
    img.data[i] = 255
    img.data[i + 1] = 255
    img.data[i + 2] = 255
    img.data[i + 3] = alpha
  }
  cx.putImageData(img, 0, 0)
  textureTiles.set(key, cv)
  return cv
}

function decorateBrushDab(
  base: (ctx: CanvasRenderingContext2D, dx: number, dy: number) => void,
  opts: Record<string, any>,
  radius: number,
  extent: number,
  tipAngle: number,
  hardness: number,
): (ctx: CanvasRenderingContext2D, dx: number, dy: number) => void {
  const useTexture = opts.textureEnabled === true && Number(opts.textureDepth ?? 45) > 0
  const useDual = opts.dualBrush === true
  if (!useTexture && !useDual) return base

  return (ctx, dx, dy) => {
    const side = Math.max(8, Math.ceil(radius * 2 * Math.max(1, extent) + 12))
    const tmp = scratchCanvas('dab', side)
    const tc = ctx2d(tmp)
    const center = side / 2
    base(tc, center, center)

    if (useDual) {
      const dualId = typeof opts.dualTip === 'string' ? opts.dualTip : 'round-hard'
      const dual = getTip(dualId) ?? getTip('round-hard')
      if (dual) {
        const mask = scratchCanvas('dual', side)
        const mc = ctx2d(mask)
        const dualSize = Math.max(1, radius * 2 * clamp(Number(opts.dualSize ?? 65) / 100, .1, 2))
        dual.drawDab(mc, center, center, {
          size: dualSize,
          hardness,
          angle: tipAngle + Number(opts.dualAngle ?? 0),
          roundness: 100,
          color: '#ffffff',
          rand: Math.random,
        })
        tc.save()
        tc.globalCompositeOperation = 'destination-in'
        tc.drawImage(mask, 0, 0)
        tc.restore()
      }
    }

    if (useTexture) {
      const tile = brushTextureTile(
        String(opts.texture ?? 'canvas'),
        Number(opts.textureScale ?? 100),
        Number(opts.textureDepth ?? 45),
        opts.textureInvert === true,
      )
      const pattern = tc.createPattern(tile, 'repeat')
      if (pattern) {
        tc.save()
        tc.globalCompositeOperation = 'destination-in'
        tc.fillStyle = pattern
        tc.fillRect(0, 0, side, side)
        tc.restore()
      }
    }

    ctx.drawImage(tmp, dx - center, dy - center)
  }
}

interface StrokeState {
  active: boolean
  /** last position fed to walkDabs (doc space — the *filtered* cursor) */
  last: { x: number; y: number } | null
  /** lazy-brush filtered cursor (doc space), reset on pointerdown */
  filtered: { x: number; y: number } | null
  /** previous RAW pointer position (doc space) — speed measurement */
  prevRaw: { x: number; y: number } | null
  /** total filtered stroke length (doc px) — drives fade */
  traveled: number
  /** smoothed pointer speed in px/ms — drives velocity dynamics */
  speed: number
  /** last pointermove timestamp (performance.now) */
  lastT: number
  /** last PointerInfo (pressure/pointerType for airbrush stamps) */
  lastP: PointerInfo | null
  /** airbrush stamp position (doc space — the last painted point) */
  airbrushPos: { x: number; y: number } | null
  /** airbrush interval handle — guarded single-instance */
  airbrushTimer: ReturnType<typeof setInterval> | null
  /** image-stamp brush resolved at stroke start (Task 7-A); null = procedural dabs */
  stamp: { canvas: HTMLCanvasElement; spacing: number } | null
  /** procedural tip id resolved at stroke start (fallback 'round-soft') */
  tipId: string
  /** jittered 6-color palette (stroke start) — null = plain fg color */
  palette: string[] | null
  /** last dab position (doc space) — travel-direction measurement */
  lastDab: { x: number; y: number } | null
  /** EMA-smoothed travel direction unit vector (wrap-safe angle) */
  dirX: number
  dirY: number
  /** true once a travel direction has been measured this stroke */
  hasDir: boolean
  /** Pencil Auto Erase resolves the stroke color once at pointer-down. */
  strokeColor: string | null
  /** Photoshop Shift-click anchor retained between strokes. */
  lastStrokeEnd: { x: number; y: number } | null
}

function makeBrush(kind: 'brush' | 'pencil'): Tool {
  const toolId = kind
  const st: StrokeState = {
    active: false, last: null, filtered: null, prevRaw: null, traveled: 0, speed: 0,
    lastT: 0, lastP: null, airbrushPos: null, airbrushTimer: null, stamp: null,
    tipId: 'round-soft', palette: null, lastDab: null, dirX: 1, dirY: 0, hasDir: false,
    strokeColor: null, lastStrokeEnd: null,
  }

  // ---------- option readers (re-read mid-stroke so the options bar is live) ----------

  function symmetryConfig(opts: Record<string, any>, w: number, h: number) {
    return {
      mode: typeof opts.symmetry === 'string' ? opts.symmetry : 'off',
      count: clamp(Math.round(opts.mandalaCount ?? 6), 3, 16),
      w, h,
    }
  }

  function strokeSpacing(opts: Record<string, any>, stamp: StrokeState['stamp']) {
    const settings = brushSettingsFrom(opts)
    // image stamps carry their own GIMP spacing (percent of stamp size)
    const spacingPct = stamp ? stamp.spacing : settings.spacing * 100
    return Math.max(1, (settings.size * Math.max(1, spacingPct)) / 100)
  }

  /** procedural tip for this stroke — pencil stays procedural-hard;
   *  eraser subset is enforced in eraser.ts (all tips allowed here) */
  function tipFor(opts: Record<string, any>): string {
    if (kind === 'pencil') return 'round-hard'
    const id = typeof opts.tip === 'string' ? opts.tip : 'round-soft'
    return getTip(id) ? id : 'round-soft'
  }

  /** Effective per-dab angle. Pen barrel rotation wins when enabled,
   * then pen tilt direction, then stroke-direction follow, then the static
   * brush angle. Mouse/touch remain unchanged. */
  function dabAngle(opts: Record<string, any>, p?: PointerInfo | null): number {
    const offset = clamp(opts.angle ?? 0, -360, 720)
    if (p?.pointerType === 'pen') {
      if (opts.twistAngle === true && Math.abs(p.twist) > 0.01) return p.twist + offset
      if (opts.tiltAngle === true && Math.hypot(p.tiltX, p.tiltY) > 1) {
        return Math.atan2(p.tiltY, p.tiltX) / RAD + offset
      }
    }
    if (opts.angleFollow === true && st.hasDir) {
      return Math.atan2(st.dirY, st.dirX) / RAD + offset
    }
    return offset
  }

  // ---------- image-stamp resolution (Task 7-A) ----------

  /**
   * Resolve the stamp to paint with: the brush option `stampId` wins when
   * it names an installed preset, else the ACTIVE preset (brushPresets).
   * Read LIVE (cache lookup) so runtime-installed brushes work without
   * remounts. Returns null when the procedural round brush should paint.
   * GIMP spacing (percent of stamp size) comes from the preset record.
   */
  function resolveStamp(opts: Record<string, any>): { canvas: HTMLCanvasElement; spacing: number } | null {
    if (kind !== 'brush') return null // pencil keeps hard procedural dabs
    try {
      const optionId = typeof opts.stampId === 'string' && opts.stampId ? opts.stampId : null
      const wanted = optionId ?? getActiveId()
      if (!wanted) return null
      const preset = getById(wanted)
      const canvas = getCachedStampCanvas(wanted)
      if (!preset || !canvas) return null // not decoded yet → procedural fallback for this stroke
      return { canvas, spacing: preset.spacing ?? 12 }
    } catch {
      return null
    }
  }

  // ---------- core dab (symmetry + scatter + fade + pressure + dynamics) ----------

  /**
   * Stamp one dab at (x, y): expand through the symmetry group, scatter each
   * mirrored position independently, then draw with the effective flow
   * (flow · fade · pressure · airbrush · dynamics) and the dynamics-scaled
   * radius, tip angle and jittered color.
   */
  function stampDab(x: number, y: number, p: PointerInfo | null, flowScale = 1) {
    const doc = engine.activeDoc
    if (!doc || !st.active || !doc._stroke) return
    const opts = getOptions(toolId)
    const settings = brushSettingsFrom(opts)

    // ---- travel-direction EMA (wrap-safe vector average, updated per dab) ----
    if (st.lastDab) {
      const ddx = x - st.lastDab.x, ddy = y - st.lastDab.y
      const dd = Math.hypot(ddx, ddy)
      if (dd > 0.5) {
        st.dirX = ema(st.dirX, ddx / dd, DIR_EMA)
        st.dirY = ema(st.dirY, ddy / dd, DIR_EMA)
        st.hasDir = true
      }
    }
    st.lastDab = { x, y }

    // ---- fade: effective flow multiplier over traveled stroke length ----
    const fade = clamp(opts.fade ?? 0, 0, 600)
    const fadeMul = fade > 0 ? Math.max(0, 1 - st.traveled / fade) : 1
    if (fadeMul <= 0) return // stroke fully faded out

    // ---- pen pressure → flow (mouse/touch gets full flow) ----
    const pressureMul = p && p.pointerType === 'pen' && opts.pressureFlow !== false
      ? 0.3 + 0.7 * clamp(p.pressure, 0, 1)
      : 1

    let flowEff = (settings.flow / 100) * fadeMul * pressureMul * flowScale

    // ---- velocity → opacity dynamics: fast strokes go lighter ----
    if (opts.dynamics === 'velocity-opacity') {
      flowEff *= 1 - 0.6 * clamp(st.speed / 2, 0, 1)
    }

    const flow = clamp(flowEff, 0, 1)
    if (flow <= 0) return

    // ---- size dynamics: velocity (existing) and pen pressure → size ----
    let radius = settings.size / 2
    if (opts.dynamics === 'velocity') {
      const k = clamp(1 - st.speed / (settings.size * 10), 0.35, 1)
      radius *= k
    }
    if (opts.dynamics === 'pressure' && p && p.pointerType === 'pen') {
      radius *= 0.35 + 0.65 * clamp(p.pressure, 0, 1)
    }

    // ---- per-dab color: jittered palette entry or the fg color ----
    const baseColor = kind === 'pencil' ? (st.strokeColor ?? getFgColor()) : getFgColor()
    const color = (kind === 'brush' && !st.stamp && st.palette && st.palette.length > 0)
      ? st.palette[Math.floor(Math.random() * st.palette.length)]
      : baseColor

    const tip = kind === 'brush' && !st.stamp ? getTip(st.tipId) : undefined
    const tipAngle = tip?.rotatable ? dabAngle(opts, p) : 0
    let roundness = clamp(opts.roundness ?? 100, 10, 100)
    if (kind === 'brush' && p?.pointerType === 'pen' && opts.tiltRoundness === true) {
      const tilt = clamp(Math.hypot(p.tiltX, p.tiltY) / 90, 0, 1)
      roundness = clamp(roundness * (1 - tilt * 0.72), 10, 100)
    }

    const rawDrawFn: (ctx: CanvasRenderingContext2D, dx: number, dy: number) => void = kind === 'pencil'
      ? (ctx, dx, dy) => pencilDab(ctx, dx, dy, radius, color)
      : st.stamp
        ? (() => {
            const stampCv = st.stamp!.canvas
            const scale = (radius * 2) / Math.max(stampCv.width, stampCv.height)
            const dw = Math.max(1, stampCv.width * scale)
            const dh = Math.max(1, stampCv.height * scale)
            return (ctx: CanvasRenderingContext2D, dx: number, dy: number) => {
              ctx.drawImage(stampCv, dx - dw / 2, dy - dh / 2, dw, dh)
            }
          })()
        : tip
          ? (ctx, dx, dy) => tip.drawDab(ctx, dx, dy, {
              size: radius * 2,
              hardness: settings.hardness,
              angle: tipAngle,
              roundness,
              color,
              rand: Math.random,
            })
          : (ctx, dx, dy) => softDab(ctx, dx, dy, radius, settings.hardness, color)

    // Conservative radius multiplier covers tips whose painted hull extends
    // outside the nominal brush circle. Texture/Dual Brush decorate only the
    // Brush family; Pencil remains exact hard-pixel output.
    const extent = tip ? tipExtentMul(st.tipId) : 1
    const drawFn = kind === 'brush'
      ? decorateBrushDab(rawDrawFn, opts, radius, extent, tipAngle, settings.hardness)
      : rawDrawFn

    // ---- symmetry expansion (positions may land off-canvas; dabs just clip) ----
    const pts = symmetricPoints(x, y, symmetryConfig(opts, doc.width, doc.height))

    // ---- scatter: uniform disk sampling, per mirrored dab independently ----
    const scatterR = (clamp(opts.scatter ?? 0, 0, 300) / 100) * (settings.size / 2)

    for (const pt of pts) {
      let px = pt.x, py = pt.y
      if (scatterR > 0.5) {
        const r = scatterR * Math.sqrt(Math.random())
        const a = Math.PI * 2 * Math.random()
        px += Math.cos(a) * r
        py += Math.sin(a) * r
      }
      engine.dab(px, py, drawFn, flow, Math.max(4, radius * extent))
    }
  }

  // ---------- airbrush ----------

  function stopAirbrush() {
    if (st.airbrushTimer !== null) {
      clearInterval(st.airbrushTimer)
      st.airbrushTimer = null
    }
  }

  function startAirbrush() {
    stopAirbrush() // guard against double timers
    st.airbrushTimer = setInterval(() => {
      if (!st.active || !st.airbrushPos) { stopAirbrush(); return }
      stampDab(st.airbrushPos.x, st.airbrushPos.y, st.lastP, AIRBRUSH_FLOW_FACTOR)
    }, AIRBRUSH_INTERVAL_MS)
  }

  // ---------- tool ----------

  const tool: Tool = {
    id: kind,
    requiresLayer: true,

    onActivate() {
      // warm the active image-stamp (async decode) so the first stroke paints with it
      const id = getActiveId()
      if (id) void warmPreset(id)
    },

    onPointerDown(p: PointerInfo) {
      if (p.button !== 0) return
      const doc = engine.activeDoc
      const layer = engine.activeLayer
      if (!doc || !layer) return

      // Photoshop muscle memory: Alt/Option temporarily invokes Eyedropper
      // without switching tools or creating a paint history entry.
      if (p.alt) {
        const hex = engine.sampleColor(p.docX, p.docY, 'composite', 0)
        if (hex) useEditorStore.getState().setFgColor(hex)
        engine.pokeOverlay()
        return
      }

      const opts = getOptions(toolId)
      if (kind === 'pencil') {
        const fg = getFgColor()
        const sampled = opts.autoErase === true ? engine.sampleColor(p.docX, p.docY, 'layer', 0) : null
        st.strokeColor = sampled && sampled.toLowerCase() === fg.toLowerCase() ? getBgColor() : fg
      } else {
        st.strokeColor = null
      }
      engine.beginStroke(layer.id, { opacity: opts.opacity ?? 100, blendMode: opts.blendMode ?? 'normal' })
      st.active = true
      // image stamp resolved LIVE at stroke start (Task 7-A); held for the whole stroke
      st.stamp = resolveStamp(opts)
      // procedural tip resolved at stroke start (Task 1-A)
      st.tipId = tipFor(opts)
      // color jitter palette (procedural tips only — stamps are images)
      st.palette = kind === 'brush' && !st.stamp && clamp(opts.jitter ?? 0, 0, 100) > 0
        ? jitterPalette(getFgColor(), opts.jitter ?? 0)
        : null
      const lineFrom = p.shift ? st.lastStrokeEnd : null
      st.filtered = { x: p.docX, y: p.docY } // reset the lazy-brush filter
      st.last = lineFrom ? { ...lineFrom } : { x: p.docX, y: p.docY }
      st.prevRaw = lineFrom ? { ...lineFrom } : { x: p.docX, y: p.docY }
      st.traveled = 0
      st.speed = 0
      st.lastT = performance.now()
      st.lastP = p
      st.lastDab = null
      st.dirX = 1
      st.dirY = 0
      st.hasDir = false
      st.airbrushPos = { x: p.docX, y: p.docY }

      if (lineFrom) {
        const spacing = strokeSpacing(opts, st.stamp)
        st.traveled = Math.hypot(p.docX - lineFrom.x, p.docY - lineFrom.y)
        for (const d of walkDabs(lineFrom.x, lineFrom.y, p.docX, p.docY, spacing)) stampDab(d.x, d.y, p)
        // walkDabs may omit an exact short endpoint; always stamp the click.
        stampDab(p.docX, p.docY, p)
        st.last = { x: p.docX, y: p.docY }
      } else {
        stampDab(p.docX, p.docY, p)
      }
      if (opts.airbrush === true) startAirbrush()
    },

    onPointerMove(p: PointerInfo) {
      if (!st.active || !st.last || !st.filtered) return
      const opts = getOptions(toolId)
      const now = performance.now()

      // ---- smoothed pointer speed (px/ms, EMA to avoid jitter) ----
      const dt = now - st.lastT
      if (dt > 0.5 && st.prevRaw) {
        const inst = Math.hypot(p.docX - st.prevRaw.x, p.docY - st.prevRaw.y) / Math.max(1, dt)
        st.speed = ema(st.speed, inst, SPEED_EMA)
        st.lastT = now
      }
      st.prevRaw = { x: p.docX, y: p.docY }

      // ---- lazy-brush smoothing: filtered cursor chases the raw pointer ----
      const follow = 1 - (clamp(opts.smoothing ?? 0, 0, 100) / 100) * 0.88
      st.filtered = {
        x: st.filtered.x + (p.docX - st.filtered.x) * follow,
        y: st.filtered.y + (p.docY - st.filtered.y) * follow,
      }
      st.airbrushPos = { x: st.filtered.x, y: st.filtered.y }

      // ---- dabs along the filtered path (min step still honored) ----
      const fx = st.filtered.x, fy = st.filtered.y
      const spacing = strokeSpacing(opts, st.stamp)
      const dist = Math.hypot(fx - st.last.x, fy - st.last.y)
      if (dist > 0.01) st.traveled += dist
      for (const d of walkDabs(st.last.x, st.last.y, fx, fy, spacing)) stampDab(d.x, d.y, p)
      if (dist >= spacing) st.last = { x: fx, y: fy }
      st.lastP = p
    },

    onPointerUp() {
      if (!st.active) return
      stopAirbrush()
      if (st.filtered) st.lastStrokeEnd = { ...st.filtered }
      else if (st.lastP) st.lastStrokeEnd = { x: st.lastP.docX, y: st.lastP.docY }
      st.active = false
      st.last = null
      st.filtered = null
      st.prevRaw = null
      st.lastP = null
      st.airbrushPos = null
      st.stamp = null
      st.tipId = 'round-soft'
      st.palette = null
      st.lastDab = null
      st.hasDir = false
      st.strokeColor = null
      engine.endStroke(kind === 'pencil' ? 'Pencil Stroke' : 'Brush Stroke')
    },

    onDeactivate() {
      // tool switched mid-stroke: stop the airbrush and commit cleanly
      stopAirbrush()
      if (st.active) {
        st.active = false
        st.last = null
        st.filtered = null
        st.prevRaw = null
        st.lastP = null
        st.airbrushPos = null
        st.stamp = null
        st.tipId = 'round-soft'
        st.palette = null
        st.lastDab = null
        st.hasDir = false
        st.strokeColor = null
        engine.endStroke(kind === 'pencil' ? 'Pencil Stroke' : 'Brush Stroke')
      }
    },

    renderOverlay(ctx, view, w, h) {
      void w; void h
      const doc = engine.activeDoc
      if (!doc) return
      const opts = getOptions(toolId)
      if (!opts.symmetry || opts.symmetry === 'off') return
      drawSymmetryOverlay(ctx, view, symmetryConfig(opts, doc.width, doc.height))
    },

    renderCursor(ctx, view, w, h, mouse) {
      void w; void h
      const doc = engine.activeDoc
      const opts = getOptions(toolId)
      if (!mouse) return
      // shape-aware cursor for procedural brush tips; circle for pencil/image stamps
      if (kind === 'brush' && !st.stamp) {
        const tipId = getTip(typeof opts.tip === 'string' ? opts.tip : 'round-soft') ? opts.tip : 'round-soft'
        const angle = dabAngle(opts)
        drawTipCursor(ctx, mouse, opts.size ?? 40, view.zoom, tipId, angle, clamp(opts.roundness ?? 100, 10, 100))
      } else {
        drawBrushCursor(ctx, mouse, opts.size ?? 40, view.zoom)
      }
      // tiny amber dot at each symmetric cursor position (2N max — cheap)
      if (!doc || !opts.symmetry || opts.symmetry === 'off') return
      const docX = (mouse.x - view.panX) / view.zoom
      const docY = (mouse.y - view.panY) / view.zoom
      const pts = symmetricPoints(docX, docY, symmetryConfig(opts, doc.width, doc.height))
      ctx.save()
      for (const pt of pts) {
        const sx = pt.x * view.zoom + view.panX
        const sy = pt.y * view.zoom + view.panY
        ctx.beginPath()
        ctx.arc(sx, sy, 3, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(232,163,61,0.95)'
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'
        ctx.lineWidth = 1
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    },
  }
  return tool
}

export const brushTool: Tool = makeBrush('brush')
export const pencilTool: Tool = makeBrush('pencil')
