// ============================================================
// Selection Brush — Photoshop-style painted selection overlay.
//
// While active, the selected area is shown as a colored overlay instead of
// marching ants. Size / Hardness / Opacity control the grayscale selection
// mask itself, so soft or low-opacity strokes remain editable as partial
// selection values. Alt temporarily subtracts; Shift temporarily adds.
// ============================================================
import type { PointerInfo, Tool } from '../types'
import { engine } from '../engine/engine'
import { cloneCanvas, createCanvas, ctx2d } from '../utils/canvas'
import { drawBrushCursor, getOptions, softDab, walkDabs } from './shared'

let liveMask: HTMLCanvasElement | null = null
let tintMask: HTMLCanvasElement | null = null
let liveDocId: string | null = null
let tintColor = ''
let activeStroke = false
let subtractStroke = false
let lastPoint: { x: number; y: number } | null = null

function rebuildTint() {
  const doc = engine.activeDoc
  if (!doc || !liveMask) { tintMask = null; return }
  const opts = getOptions('selection-brush')
  const color = typeof opts.overlayColor === 'string' ? opts.overlayColor : '#ef4444'
  const out = createCanvas(doc.width, doc.height)
  const c = ctx2d(out)
  c.drawImage(liveMask, 0, 0)
  c.globalCompositeOperation = 'source-in'
  c.fillStyle = color
  c.fillRect(0, 0, doc.width, doc.height)
  c.globalCompositeOperation = 'source-over'
  tintMask = out
  tintColor = color
}

function ensureLiveMask() {
  const doc = engine.activeDoc
  if (!doc) { liveMask = null; tintMask = null; liveDocId = null; return }
  if (liveMask && liveDocId === doc.id && liveMask.width === doc.width && liveMask.height === doc.height) return
  liveMask = doc.selection ? cloneCanvas(doc.selection.mask) : createCanvas(doc.width, doc.height)
  liveDocId = doc.id
  rebuildTint()
}

function resetLive() {
  activeStroke = false
  lastPoint = null
  liveMask = null
  tintMask = null
  liveDocId = null
  tintColor = ''
}

function strokeIsSubtract(p: PointerInfo): boolean {
  const mode = getOptions('selection-brush').brushMode === 'subtract' ? 'subtract' : 'add'
  if (p.alt) return true
  if (p.shift) return false
  return mode === 'subtract'
}

function dab(x: number, y: number) {
  const doc = engine.activeDoc
  if (!doc || !liveMask) return
  const opts = getOptions('selection-brush')
  const size = Math.max(1, Number(opts.size) || 40)
  const hardness = Math.max(0, Math.min(100, Number(opts.hardness) || 0))
  const opacity = Math.max(.01, Math.min(1, (Number(opts.opacity) || 100) / 100))
  const radius = size / 2

  const mc = ctx2d(liveMask)
  mc.save()
  mc.globalCompositeOperation = subtractStroke ? 'destination-out' : 'source-over'
  mc.globalAlpha = opacity
  softDab(mc, x, y, radius, hardness, '#ffffff')
  mc.restore()

  if (!tintMask || tintColor !== (opts.overlayColor ?? '#ef4444')) rebuildTint()
  if (tintMask) {
    const tc = ctx2d(tintMask)
    tc.save()
    tc.globalCompositeOperation = subtractStroke ? 'destination-out' : 'source-over'
    tc.globalAlpha = opacity
    softDab(tc, x, y, radius, hardness, typeof opts.overlayColor === 'string' ? opts.overlayColor : '#ef4444')
    tc.restore()
  }
}

function paintTo(p: PointerInfo) {
  if (!lastPoint) {
    dab(p.docX, p.docY)
    lastPoint = { x: p.docX, y: p.docY }
    return
  }
  const size = Math.max(1, Number(getOptions('selection-brush').size) || 40)
  const spacing = Math.max(.5, size * .12)
  const points = walkDabs(lastPoint.x, lastPoint.y, p.docX, p.docY, spacing)
  for (const pt of points) dab(pt.x, pt.y)
  if (!points.length) dab(p.docX, p.docY)
  lastPoint = { x: p.docX, y: p.docY }
}

function commitStroke() {
  if (!activeStroke || !liveMask) return
  activeStroke = false
  lastPoint = null
  // New mode is intentional: liveMask already contains the previous selection
  // plus/minus the current stroke. Each stroke is one undoable history step.
  engine.setSelectionMask(liveMask, 'new', 'Selection Brush')
  ensureLiveMask()
  engine.pokeOverlay()
}

export const selectionBrushTool: Tool = {
  id: 'selection-brush',
  cursor: 'none',

  onActivate() {
    ensureLiveMask()
    engine.pokeOverlay()
  },

  onDeactivate() {
    if (activeStroke) commitStroke()
    resetLive()
    engine.pokeOverlay()
  },

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0 || !engine.activeDoc) return
    ensureLiveMask()
    if (!liveMask) return
    activeStroke = true
    subtractStroke = strokeIsSubtract(p)
    lastPoint = null
    paintTo(p)
    engine.pokeOverlay()
  },

  onPointerMove(p: PointerInfo) {
    if (!activeStroke) return
    paintTo(p)
    engine.pokeOverlay()
  },

  onPointerUp() {
    commitStroke()
  },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && activeStroke) {
      // Rehydrate from the committed document selection, discarding only the
      // in-progress stroke.
      activeStroke = false
      lastPoint = null
      liveMask = null
      ensureLiveMask()
      engine.pokeOverlay()
      return true
    }
    return false
  },

  renderOverlay(ctx, view, w, h) {
    void w; void h
    ensureLiveMask()
    const opts = getOptions('selection-brush')
    const color = typeof opts.overlayColor === 'string' ? opts.overlayColor : '#ef4444'
    if (tintColor !== color) rebuildTint()
    if (!tintMask) return
    ctx.save()
    ctx.globalAlpha = Math.max(.1, Math.min(.9, (Number(opts.overlayOpacity) || 45) / 100))
    ctx.drawImage(
      tintMask,
      view.panX,
      view.panY,
      tintMask.width * view.zoom,
      tintMask.height * view.zoom,
    )
    ctx.restore()
  },

  renderCursor(ctx, view, w, h, mouse) {
    void w; void h
    drawBrushCursor(ctx, mouse, Math.max(1, Number(getOptions('selection-brush').size) || 40), view.zoom)
  },
}
