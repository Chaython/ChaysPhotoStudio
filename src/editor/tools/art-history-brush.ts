// ============================================================
// Art History Brush — painterly reconstruction from an earlier history state.
//
// Each dab samples colors from the chosen raster history source and lays down
// small oriented marks. Tolerance compares the stroke-start image to the
// history source, so unchanged areas can be protected from repainting.
// ============================================================
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, walkDabs, drawBrushCursor } from './shared'
import { createCanvas, ctx2d, clamp, getImageData } from '../utils/canvas'

let active = false
let last: { x: number; y: number } | null = null
let sourceImage: ImageData | null = null
let targetImage: ImageData | null = null

function historySource(layerId: string): HTMLCanvasElement | null {
  const doc = engine.activeDoc
  if (!doc) return null
  const opts = getOptions('art-history-brush')
  const states = doc.history.states
  if (!states.length) return null
  const index = opts.source === 'original' ? 0 : Math.max(0, doc.history.index - 1)
  const state = states[index]
  const layer = state?.layers.find(l => l.id === layerId)
  if (!layer?.canvas || layer.kind !== 'raster') return null
  const out = createCanvas(doc.width, doc.height)
  ctx2d(out).drawImage(layer.canvas, layer.offsetX ?? 0, layer.offsetY ?? 0)
  return out
}

function sample(data: ImageData, x: number, y: number): [number, number, number, number] | null {
  const px = Math.round(x), py = Math.round(y)
  if (px < 0 || py < 0 || px >= data.width || py >= data.height) return null
  const i = (py * data.width + px) * 4
  return [data.data[i], data.data[i + 1], data.data[i + 2], data.data[i + 3]]
}

function differsEnough(x: number, y: number, tolerance: number): boolean {
  if (!sourceImage || !targetImage || tolerance <= 0) return true
  const a = sample(sourceImage, x, y)
  const b = sample(targetImage, x, y)
  if (!a || !b) return false
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]
  const dist = Math.sqrt(dr * dr * .2126 + dg * dg * .7152 + db * db * .0722) / 2.55
  return dist >= tolerance
}

function styleParams(style: string) {
  if (style === 'tight-short') return { marks: 6, spread: .24, length: .32, width: .12, curl: false }
  if (style === 'loose-medium') return { marks: 11, spread: .60, length: .70, width: .11, curl: false }
  if (style === 'loose-long') return { marks: 13, spread: .78, length: 1.10, width: .09, curl: false }
  if (style === 'curl') return { marks: 10, spread: .58, length: .72, width: .10, curl: true }
  return { marks: 8, spread: .38, length: .55, width: .11, curl: false }
}

function artDab(x: number, y: number, p: PointerInfo) {
  if (!active || !sourceImage) return
  const opts = getOptions('art-history-brush')
  const pressure = p.pointerType === 'pen' ? clamp(p.pressure, 0, 1) : 1
  let size = Math.max(2, Number(opts.size) || 38)
  if (p.pointerType === 'pen' && opts.pressureSize === true) size *= .25 + .75 * pressure
  let flow = clamp((Number(opts.flow) || 70) / 100, .01, 1)
  if (p.pointerType === 'pen' && opts.pressureFlow !== false) flow *= .25 + .75 * pressure
  const tolerance = clamp(Number(opts.tolerance) || 0, 0, 100)
  const area = clamp((Number(opts.area) || 50) / 100, .01, 2)
  const style = styleParams(String(opts.style ?? 'tight-medium'))
  if (!differsEnough(x, y, tolerance)) return

  const spreadR = size * style.spread * area
  const strokeLen = size * style.length
  const lineW = Math.max(1, size * style.width)
  const marks = Math.max(2, Math.round(style.marks * (.75 + area * .5)))

  engine.dab(x, y, (ctx, dx, dy) => {
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = 0; i < marks; i++) {
      const a = Math.random() * Math.PI * 2
      const rr = Math.sqrt(Math.random()) * spreadR
      const ox = Math.cos(a) * rr
      const oy = Math.sin(a) * rr
      const sx = x + ox, sy = y + oy
      if (!differsEnough(sx, sy, tolerance)) continue
      const col = sample(sourceImage!, sx, sy)
      if (!col || col[3] <= 0) continue
      const theta = a + (Math.random() - .5) * Math.PI
      const len = strokeLen * (.55 + Math.random() * .75)
      const x0 = dx + ox - Math.cos(theta) * len * .5
      const y0 = dy + oy - Math.sin(theta) * len * .5
      const x1 = dx + ox + Math.cos(theta) * len * .5
      const y1 = dy + oy + Math.sin(theta) * len * .5
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${col[3] / 255})`
      ctx.lineWidth = lineW * (.65 + Math.random() * .7)
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      if (style.curl) {
        const bend = len * (.25 + Math.random() * .25) * (Math.random() < .5 ? -1 : 1)
        const mx = (x0 + x1) / 2 - Math.sin(theta) * bend
        const my = (y0 + y1) / 2 + Math.cos(theta) * bend
        ctx.quadraticCurveTo(mx, my, x1, y1)
      } else ctx.lineTo(x1, y1)
      ctx.stroke()
    }
    ctx.restore()
  }, flow, spreadR + strokeLen + lineW + 4)
}

function finish() {
  if (!active) return
  active = false
  last = null
  sourceImage = null
  targetImage = null
  engine.endStroke('Art History Brush')
}

export const artHistoryBrushTool: Tool = {
  id: 'art-history-brush',
  requiresLayer: true,
  cursor: 'none',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const layer = engine.activeLayer
    if (!layer || layer.locked || layer.kind === 'adjustment') return
    if (layer.kind !== 'raster' || !layer.canvas) {
      engine.ui?.toast('Art History Brush paints raster layers — rasterize this layer first', 'info')
      return
    }
    const src = historySource(layer.id)
    const current = engine.layerCanvasDocSpace(layer.id)
    if (!src || !current) {
      engine.ui?.toast('No compatible raster pixels exist in the selected history source', 'error')
      return
    }
    sourceImage = getImageData(src)
    targetImage = getImageData(current)
    const opts = getOptions('art-history-brush')
    engine.beginStroke(layer.id, { opacity: opts.opacity ?? 100 })
    active = true
    last = { x: p.docX, y: p.docY }
    artDab(p.docX, p.docY, p)
  },

  onPointerMove(p: PointerInfo) {
    if (!active || !last) return
    const opts = getOptions('art-history-brush')
    const size = Math.max(2, Number(opts.size) || 38)
    const spacing = Math.max(1, size * clamp((Number(opts.spacing) || 18) / 100, .01, 2))
    for (const q of walkDabs(last.x, last.y, p.docX, p.docY, spacing)) artDab(q.x, q.y, p)
    if (Math.hypot(p.docX - last.x, p.docY - last.y) >= spacing) last = { x: p.docX, y: p.docY }
  },

  onPointerUp() { finish() },
  onDeactivate() { finish() },

  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    drawBrushCursor(ctx, mouse, Number(getOptions('art-history-brush').size) || 38, view.zoom)
  },
}
