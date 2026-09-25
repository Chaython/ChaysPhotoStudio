// ============================================================
// Pattern Stamp — brush a repeating pattern onto the active layer.
//
// Uses the shared built-in pattern renderer so phase/scale/offset match the
// Paint Bucket and Healing Brush pattern modes. Aligned keeps one document-
// anchored phase across strokes; unaligned restarts the pattern at each stroke.
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, getFgColor, getBgColor, walkDabs, drawBrushCursor } from './shared'
import { createCanvas, ctx2d, clamp } from '../utils/canvas'
import { paintBuiltinPattern } from './patterns'

let active = false
let last: { x: number; y: number } | null = null
let strokeAnchor: { x: number; y: number } | null = null
let patternScratch: HTMLCanvasElement | null = null

function getPatternScratch(side: number): HTMLCanvasElement {
  const s = Math.max(4, Math.ceil(side))
  if (!patternScratch || patternScratch.width !== s || patternScratch.height !== s) {
    patternScratch = createCanvas(s, s)
  } else {
    ctx2d(patternScratch).clearRect(0, 0, s, s)
  }
  return patternScratch
}

function stampDab(x: number, y: number, p: PointerInfo) {
  if (!active) return
  const opts = getOptions('pattern-stamp')
  const pressure = p.pointerType === 'pen' ? clamp(p.pressure, 0, 1) : 1
  let size = Math.max(1, Number(opts.size) || 60)
  if (p.pointerType === 'pen' && opts.pressureSize === true) size *= .25 + .75 * pressure
  let flow = clamp((Number(opts.flow) || 100) / 100, .01, 1)
  if (p.pointerType === 'pen' && opts.pressureFlow !== false) flow *= .25 + .75 * pressure

  const r = size / 2
  const side = Math.max(4, Math.ceil(size) + 6)
  const half = side / 2
  const patch = getPatternScratch(side)
  const pc = ctx2d(patch)
  const patchDocX = x - half
  const patchDocY = y - half

  const aligned = opts.aligned !== false
  const anchor = strokeAnchor ?? { x, y }
  paintBuiltinPattern(pc, side, side, {
    kind: String(opts.pattern ?? 'checker'),
    scale: clamp((Number(opts.patternScale) || 100) / 100, .25, 4),
    offsetX: Number(opts.patternOffsetX) || 0,
    offsetY: Number(opts.patternOffsetY) || 0,
    fg: getFgColor(),
    bg: getBgColor(),
    originX: aligned ? patchDocX : patchDocX - anchor.x,
    originY: aligned ? patchDocY : patchDocY - anchor.y,
  })

  if (opts.impressionist === true) {
    const src = pc.getImageData(0, 0, side, side)
    pc.clearRect(0, 0, side, side)
    const strokeScale = clamp((Number(opts.impressionistStroke) || 55) / 100, .1, 1.5)
    const scatter = clamp((Number(opts.impressionistScatter) || 45) / 100, 0, 1)
    const marks = Math.max(5, Math.round(10 + scatter * 22))
    pc.lineCap = 'round'
    for (let i = 0; i < marks; i++) {
      const px = Math.random() * side
      const py = Math.random() * side
      const j = (Math.floor(py) * side + Math.floor(px)) * 4
      const a = src.data[j + 3] / 255
      if (a <= .01) continue
      const angle = Math.random() * Math.PI * 2
      const len = Math.max(2, size * strokeScale * (.35 + Math.random() * .75))
      const halfLen = len / 2
      pc.strokeStyle = `rgba(${src.data[j]},${src.data[j + 1]},${src.data[j + 2]},${a})`
      pc.lineWidth = Math.max(1, size * (.035 + Math.random() * .05))
      pc.beginPath()
      pc.moveTo(px - Math.cos(angle) * halfLen, py - Math.sin(angle) * halfLen)
      pc.lineTo(px + Math.cos(angle) * halfLen, py + Math.sin(angle) * halfLen)
      pc.stroke()
    }
  }

  // Shape the pattern with the brush hardness. A hard brush gets a crisp disk;
  // softer brushes fade toward the edge without blurring the pattern itself.
  pc.globalCompositeOperation = 'destination-in'
  const hardness = clamp((Number(opts.hardness) || 0) / 100, 0, .995)
  const inner = r * hardness
  const grad = pc.createRadialGradient(half, half, inner, half, half, Math.max(inner + .5, r))
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  pc.fillStyle = grad
  pc.beginPath()
  pc.arc(half, half, Math.max(.5, r), 0, Math.PI * 2)
  pc.fill()
  pc.globalCompositeOperation = 'source-over'

  engine.dab(
    x, y,
    (ctx, dx, dy) => ctx.drawImage(patch, dx - half, dy - half),
    flow,
    r + 4,
  )
}

function finish() {
  if (!active) return
  active = false
  last = null
  strokeAnchor = null
  engine.endStroke('Pattern Stamp')
}

export const patternStampTool: Tool = {
  id: 'pattern-stamp',
  requiresLayer: true,
  cursor: 'none',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const layer = engine.activeLayer
    if (!layer || layer.locked || layer.kind === 'adjustment') return
    const opts = getOptions('pattern-stamp')
    engine.beginStroke(layer.id, {
      opacity: opts.opacity ?? 100,
      blendMode: opts.blendMode ?? 'normal',
    })
    const doc = engine.activeDoc
    if (!doc?._stroke) return
    active = true
    last = { x: p.docX, y: p.docY }
    strokeAnchor = { x: p.docX, y: p.docY }
    stampDab(p.docX, p.docY, p)
  },

  onPointerMove(p: PointerInfo) {
    if (!active || !last) return
    const opts = getOptions('pattern-stamp')
    const size = Math.max(1, Number(opts.size) || 60)
    const spacing = Math.max(1, size * clamp((Number(opts.spacing) || 15) / 100, .01, 2))
    for (const q of walkDabs(last.x, last.y, p.docX, p.docY, spacing)) stampDab(q.x, q.y, p)
    if (Math.hypot(p.docX - last.x, p.docY - last.y) >= spacing) last = { x: p.docX, y: p.docY }
  },

  onPointerUp() { finish() },
  onDeactivate() { finish() },

  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    drawBrushCursor(ctx, mouse, Number(getOptions('pattern-stamp').size) || 60, view.zoom)
  },
}
