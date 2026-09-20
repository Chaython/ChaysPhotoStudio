// ============================================================
// Type & Shape tools (Task 2-b upgrade)
//  Text: clicking an existing text layer's measured glyph bounds ACTIVATES it
//  (scratch-canvas measureText, same metrics as renderTextCanvas) instead of
//  stacking new layers. New layers are created with content '' — the
//  TextLayerEditor in canvas-workspace opens its textarea automatically when
//  the active text layer has empty content; a `zphoto:edit-text` window event
//  is also dispatched for future listeners.
//  Shape: live preview of the actual shape path while dragging (overlay),
//  Shift constrains to square / 45° lines.
// ============================================================
import type { Tool, PointerInfo, ShapeSpec, TextSpec } from '../types'
import { engine } from '../engine/engine'
import { getOptions, getFgColor, newDrag, drawCross, drawDashedRect } from './shared'
import { measureTextSpecBounds } from './dab-utils'
import { rectFromPoints, createCanvas, ctx2d, clamp } from '../utils/canvas'
import { traceShapePath } from '../engine/shape-path'

// ============================================================
// Type tool
// ============================================================

/** activate an existing text layer under the cursor, if any */
function textLayerAt(docX: number, docY: number): string | null {
  const doc = engine.activeDoc
  if (!doc) return null
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i]
    if (l.kind !== 'text' || !l.text || !l.visible) continue
    const b = measureTextSpecBounds(l.text)
    if (docX >= b.x && docX <= b.x + b.w && docY >= b.y && docY <= b.y + b.h) return l.id
  }
  return null
}

function editTextLayer(layerId: string) {
  const doc = engine.activeDoc
  if (!doc) return
  doc.activeLayerId = layerId
  // TextLayerEditor renders its textarea when the active text layer's content
  // is '' — engine.emit() bumps renderTick so it mounts immediately
  engine.emit()
  try {
    window.dispatchEvent(new CustomEvent('zphoto:edit-text', { detail: { layerId } }))
  } catch { /* non-browser context */ }
}

let textDrag = newDrag()
let textFrame: { x: number; y: number; w: number; h: number } | null = null

type TextHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
interface TextResizeState {
  layerId: string
  handle: TextHandle
  startX: number
  startY: number
  original: TextSpec
  changed: boolean
}
let textResize: TextResizeState | null = null

function activeParagraphText(): { id: string; text: TextSpec } | null {
  const doc = engine.activeDoc
  if (!doc?.activeLayerId) return null
  const layer = engine.layerById(doc.activeLayerId)
  if (!layer || layer.kind !== 'text' || !layer.text?.boxWidth || !layer.text.boxHeight) return null
  return { id: layer.id, text: layer.text }
}

function textHandles(t: TextSpec) {
  const x = t.x, y = t.y, w = t.boxWidth ?? 0, h = t.boxHeight ?? 0
  const cx = x + w / 2, cy = y + h / 2
  return [
    { id: 'nw' as TextHandle, x, y },
    { id: 'n' as TextHandle, x: cx, y },
    { id: 'ne' as TextHandle, x: x + w, y },
    { id: 'e' as TextHandle, x: x + w, y: cy },
    { id: 'se' as TextHandle, x: x + w, y: y + h },
    { id: 's' as TextHandle, x: cx, y: y + h },
    { id: 'sw' as TextHandle, x, y: y + h },
    { id: 'w' as TextHandle, x, y: cy },
  ]
}

function hitTextHandle(p: PointerInfo): { id: string; text: TextSpec; handle: TextHandle } | null {
  const active = activeParagraphText()
  const doc = engine.activeDoc
  if (!active || !doc) return null
  const tol = Math.max(4, 8 / Math.max(.02, doc.view.zoom))
  let best: TextHandle | null = null
  let bestD = Infinity
  for (const h of textHandles(active.text)) {
    const d = Math.hypot(p.docX - h.x, p.docY - h.y)
    if (d <= tol && d < bestD) { best = h.id; bestD = d }
  }
  return best ? { ...active, handle: best } : null
}

function updateTextResize(p: PointerInfo) {
  const st = textResize
  if (!st) return
  const o = st.original
  let left = o.x, top = o.y
  let right = o.x + (o.boxWidth ?? 20)
  let bottom = o.y + (o.boxHeight ?? Math.max(20, o.fontSize * o.lineHeight))
  const dx = p.docX - st.startX, dy = p.docY - st.startY
  if (st.handle.includes('w')) left += dx
  if (st.handle.includes('e')) right += dx
  if (st.handle.includes('n')) top += dy
  if (st.handle.includes('s')) bottom += dy

  const minW = 20
  const minH = Math.max(20, o.fontSize * Math.max(.5, o.lineHeight || 1.2))
  if (right - left < minW) {
    if (st.handle.includes('w')) left = right - minW
    else right = left + minW
  }
  if (bottom - top < minH) {
    if (st.handle.includes('n')) top = bottom - minH
    else bottom = top + minH
  }

  // Alt/Option resizes the paragraph frame around its original center.
  if (p.alt) {
    const cx = o.x + (o.boxWidth ?? minW) / 2
    const cy = o.y + (o.boxHeight ?? minH) / 2
    const halfW = Math.max(minW / 2, Math.max(Math.abs(cx - left), Math.abs(right - cx)))
    const halfH = Math.max(minH / 2, Math.max(Math.abs(cy - top), Math.abs(bottom - cy)))
    if (st.handle.includes('w') || st.handle.includes('e')) { left = cx - halfW; right = cx + halfW }
    if (st.handle.includes('n') || st.handle.includes('s')) { top = cy - halfH; bottom = cy + halfH }
  }

  const next: TextSpec = {
    ...o,
    x: left,
    y: top,
    boxWidth: right - left,
    boxHeight: bottom - top,
  }
  st.changed = Math.abs(next.x - o.x) > .01 || Math.abs(next.y - o.y) > .01
    || Math.abs((next.boxWidth ?? 0) - (o.boxWidth ?? 0)) > .01
    || Math.abs((next.boxHeight ?? 0) - (o.boxHeight ?? 0)) > .01
  engine.setLayerProps(st.layerId, { text: next }, { history: false, silent: true })
  engine.requestRender()
  engine.pokeOverlay()
}

function finishTextResize(commit: boolean) {
  const st = textResize
  if (!st) return
  textResize = null
  if (!commit) {
    engine.setLayerProps(st.layerId, { text: { ...st.original } }, { history: false, silent: true })
    engine.emit()
    return
  }
  if (st.changed) {
    engine.pushHistory('Resize Text Frame')
    engine.emit()
  } else engine.pokeOverlay()
}

function createTextLayerAt(x: number, y: number, box?: { w: number; h: number }) {
  const opts = getOptions('text')
  const layer = engine.addTextLayer({
    x: Math.round(x), y: Math.round(y),
    fontSize: opts.size ?? 48,
    fontFamily: opts.family ?? 'Georgia, serif',
    color: opts.color ?? getFgColor(),
    bold: !!opts.bold, italic: !!opts.italic,
    underline: !!opts.underline, strikethrough: !!opts.strikethrough,
    align: opts.align ?? 'left',
    direction: opts.direction === 'vertical' ? 'vertical' : 'horizontal',
    kerning: opts.kerning !== false,
    ligatures: opts.ligatures !== false,
    smallCaps: opts.smallCaps === true,
    fontStretch: opts.fontStretch ?? 'normal',
    lineHeight: Math.max(.5, Number(opts.lineHeight) || 1.2),
    tracking: Number(opts.tracking) || 0,
    warpStyle: opts.warpStyle ?? 'none',
    warpBend: clamp(Number(opts.warpBend) || 0, -100, 100),
    warpHorizontal: clamp(Number(opts.warpHorizontal) || 0, -100, 100),
    warpVertical: clamp(Number(opts.warpVertical) || 0, -100, 100),
    boxWidth: box ? Math.max(20, Math.round(box.w)) : undefined,
    boxHeight: box ? Math.max(20, Math.round(box.h)) : undefined,
    content: '',
  })
  if (layer) editTextLayer(layer.id)
}

export const textTool: Tool = {
  id: 'text',
  cursor: 'text',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const doc = engine.activeDoc
    if (!doc) return
    const opts = getOptions('text')

    // Paragraph text exposes Photoshop-style on-canvas frame handles. Test
    // these before normal text hit activation so dragging a handle reflows the
    // paragraph instead of opening the text editor.
    const frameHandle = hitTextHandle(p)
    if (frameHandle) {
      textResize = {
        layerId: frameHandle.id,
        handle: frameHandle.handle,
        startX: p.docX,
        startY: p.docY,
        original: { ...frameHandle.text },
        changed: false,
      }
      engine.pokeOverlay()
      return
    }

    // Clicking an existing point/paragraph text frame activates it for editing.
    const hit = textLayerAt(p.docX, p.docY)
    if (hit) {
      editTextLayer(hit)
      return
    }

    if (opts.mode === 'paragraph') {
      textDrag = { startX: p.docX, startY: p.docY, lastX: p.docX, lastY: p.docY, active: true }
      textFrame = null
      engine.pokeOverlay()
      return
    }

    createTextLayerAt(p.docX, p.docY)
  },

  onPointerMove(p: PointerInfo) {
    if (textResize) { updateTextResize(p); return }
    if (!textDrag.active) return
    textFrame = rectFromPoints(textDrag.startX, textDrag.startY, p.docX, p.docY)
    engine.pokeOverlay()
  },

  onPointerUp(p: PointerInfo) {
    if (textResize) { finishTextResize(true); return }
    if (!textDrag.active) return
    textDrag.active = false
    const opts = getOptions('text')
    let r = textFrame ?? rectFromPoints(textDrag.startX, textDrag.startY, p.docX, p.docY)
    textFrame = null
    if (r.w < 10 || r.h < 10) {
      r = {
        x: textDrag.startX,
        y: textDrag.startY,
        w: Math.max(20, Number(opts.boxWidth) || 320),
        h: Math.max(20, Number(opts.boxHeight) || 180),
      }
    }
    createTextLayerAt(r.x, r.y, { w: r.w, h: r.h })
    engine.pokeOverlay()
  },

  onDoubleClick(p: PointerInfo) {
    const hit = textLayerAt(p.docX, p.docY)
    if (hit) editTextLayer(hit)
  },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && textResize) {
      finishTextResize(false)
      return true
    }
    if (e.key === 'Escape' && textDrag.active) {
      textDrag.active = false
      textFrame = null
      engine.pokeOverlay()
      return true
    }
    return false
  },

  onDeactivate() {
    if (textResize) finishTextResize(true)
    textDrag.active = false
    textFrame = null
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    if (textDrag.active && textFrame) {
      const x = textFrame.x * view.zoom + view.panX
      const y = textFrame.y * view.zoom + view.panY
      const rw = textFrame.w * view.zoom
      const rh = textFrame.h * view.zoom
      ctx.save()
      ctx.fillStyle = 'rgba(232,163,61,.08)'
      ctx.fillRect(x, y, rw, rh)
      ctx.restore()
      drawDashedRect(ctx, x, y, rw, rh)
      ctx.save()
      ctx.font = '11px ui-monospace, monospace'
      ctx.fillStyle = 'rgba(0,0,0,.78)'
      const label = `${Math.round(textFrame.w)} × ${Math.round(textFrame.h)} px`
      const tw = ctx.measureText(label).width + 12
      ctx.fillRect(x, y - 20, tw, 16)
      ctx.fillStyle = '#e8a33d'
      ctx.fillText(label, x + 6, y - 8)
      ctx.restore()
      return
    }
    const paragraph = activeParagraphText()
    if (paragraph) {
      const t = paragraph.text
      const x = t.x * view.zoom + view.panX
      const y = t.y * view.zoom + view.panY
      const rw = (t.boxWidth ?? 0) * view.zoom
      const rh = (t.boxHeight ?? 0) * view.zoom
      ctx.save()
      ctx.strokeStyle = 'rgba(232,163,61,.92)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.strokeRect(x + .5, y + .5, rw, rh)
      ctx.setLineDash([])
      for (const hnd of textHandles(t)) {
        const hx = hnd.x * view.zoom + view.panX
        const hy = hnd.y * view.zoom + view.panY
        const active = textResize?.handle === hnd.id
        const s = active ? 9 : 7
        ctx.fillStyle = active ? '#e8a33d' : '#fff'
        ctx.strokeStyle = 'rgba(15,15,17,.95)'
        ctx.fillRect(hx - s / 2, hy - s / 2, s, s)
        ctx.strokeRect(hx - s / 2, hy - s / 2, s, s)
      }
      const label = `${Math.round(t.boxWidth ?? 0)} × ${Math.round(t.boxHeight ?? 0)} px`
      ctx.font = '10px ui-monospace, monospace'
      const tw = ctx.measureText(label).width + 10
      ctx.fillStyle = 'rgba(10,10,12,.82)'
      ctx.fillRect(x, y - 20, tw, 16)
      ctx.fillStyle = '#e8a33d'
      ctx.fillText(label, x + 5, y - 8)
      ctx.restore()
    }

    if (mouse) {
      // I-beam-ish marker: cross + baseline ticks
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(mouse.x - 10, mouse.y); ctx.lineTo(mouse.x + 10, mouse.y)
      ctx.moveTo(mouse.x, mouse.y - 10); ctx.lineTo(mouse.x, mouse.y + 10)
      ctx.moveTo(mouse.x - 4, mouse.y - 13); ctx.lineTo(mouse.x + 4, mouse.y - 13)
      ctx.moveTo(mouse.x - 4, mouse.y + 13); ctx.lineTo(mouse.x + 4, mouse.y + 13)
      ctx.stroke()
      ctx.restore()
    }
  },
}

// ============================================================
// Shape tool
// ============================================================
let drag = newDrag()
let shapeRect: { x: number; y: number; w: number; h: number } | null = null
/** raw (un-normalized) drag vector for lines */
let shapeVec: { x0: number; y0: number; x1: number; y1: number } | null = null

function currentShapeSpec(p: PointerInfo, live: boolean): ShapeSpec | null {
  const opts = getOptions('shape')
  const isLine = opts.shape === 'line'
  let r = rectFromPoints(drag.startX, drag.startY, p.docX, p.docY)
  let vec = { x0: drag.startX, y0: drag.startY, x1: p.docX, y1: p.docY }
  if (p.alt && !isLine) {
    const dx = Math.abs(p.docX - drag.startX), dy = Math.abs(p.docY - drag.startY)
    r = { x: drag.startX - dx, y: drag.startY - dy, w: dx * 2, h: dy * 2 }
    vec = { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }
  }
  if (p.shift) {
    if (isLine) {
      // constrain the line to 45° increments
      const dx = p.docX - drag.startX, dy = p.docY - drag.startY
      const dist = Math.hypot(dx, dy)
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
      vec = { x0: drag.startX, y0: drag.startY, x1: drag.startX + Math.cos(angle) * dist, y1: drag.startY + Math.sin(angle) * dist }
      r = rectFromPoints(vec.x0, vec.y0, vec.x1, vec.y1)
    } else {
      const s = Math.max(r.w, r.h)
      if (p.alt) r = { x: drag.startX - s / 2, y: drag.startY - s / 2, w: s, h: s }
      else {
        const sx = p.docX >= drag.startX ? 1 : -1
        const sy = p.docY >= drag.startY ? 1 : -1
        r = { x: sx > 0 ? drag.startX : drag.startX - s, y: sy > 0 ? drag.startY : drag.startY - s, w: s, h: s }
      }
      vec = { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }
    }
  }
  if (!live) {
    // committed shapes snap to integers
    if (isLine) {
      return {
        shape: 'line',
        x: Math.round(vec.x0), y: Math.round(vec.y0),
        w: Math.round(vec.x1 - vec.x0), h: Math.round(vec.y1 - vec.y0),
        radius: 0,
        fill: null,
        fillOpacity: 0,
        stroke: opts.stroke ?? '#ffffff',
        strokeWidth: opts.strokeWidth ?? 4,
        strokeOpacity: opts.strokeOpacity ?? 100,
        lineCap: opts.lineCap ?? 'round',
        strokeAlign: opts.strokeAlign ?? 'center',
        dash: opts.dash ?? 'solid',
        dashLength: opts.dashLength ?? 12,
        gapLength: opts.gapLength ?? 8,
        arrowStart: opts.arrowStart === true,
        arrowEnd: opts.arrowEnd === true,
        sides: opts.sides ?? 5,
        starInset: opts.starInset ?? 45,
      }
    }
    return {
      shape: opts.shape ?? 'rect',
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h),
      radius: opts.radius ?? 12,
      fill: opts.fill ?? '#e8a33d',
      fillOpacity: opts.fillOpacity ?? 100,
      stroke: opts.strokeEnabled ? (opts.stroke ?? '#ffffff') : null,
      strokeWidth: opts.strokeWidth ?? 4,
      strokeOpacity: opts.strokeOpacity ?? 100,
      lineCap: opts.lineCap ?? 'round',
      strokeAlign: opts.strokeAlign ?? 'center',
      dash: opts.dash ?? 'solid',
      dashLength: opts.dashLength ?? 12,
      gapLength: opts.gapLength ?? 8,
      arrowStart: opts.arrowStart === true,
      arrowEnd: opts.arrowEnd === true,
      sides: opts.sides ?? 5,
      starInset: opts.starInset ?? 45,
    }
  }
  // live preview path
  if (isLine) {
    return { shape: 'line', x: vec.x0, y: vec.y0, w: vec.x1 - vec.x0, h: vec.y1 - vec.y0, radius: 0, fill: null, fillOpacity: 0, stroke: opts.stroke ?? '#ffffff', strokeWidth: opts.strokeWidth ?? 4, strokeOpacity: opts.strokeOpacity ?? 100, lineCap: opts.lineCap ?? 'round', strokeAlign: opts.strokeAlign ?? 'center', dash: opts.dash ?? 'solid', dashLength: opts.dashLength ?? 12, gapLength: opts.gapLength ?? 8, arrowStart: opts.arrowStart === true, arrowEnd: opts.arrowEnd === true, sides: opts.sides ?? 5, starInset: opts.starInset ?? 45 }
  }
  return { shape: opts.shape ?? 'rect', x: r.x, y: r.y, w: r.w, h: r.h, radius: opts.radius ?? 12, fill: opts.fill ?? '#e8a33d', fillOpacity: opts.fillOpacity ?? 100, stroke: opts.strokeEnabled ? (opts.stroke ?? '#ffffff') : null, strokeWidth: opts.strokeWidth ?? 4, strokeOpacity: opts.strokeOpacity ?? 100, lineCap: opts.lineCap ?? 'round', strokeAlign: opts.strokeAlign ?? 'center', dash: opts.dash ?? 'solid', dashLength: opts.dashLength ?? 12, gapLength: opts.gapLength ?? 8, arrowStart: false, arrowEnd: false, sides: opts.sides ?? 5, starInset: opts.starInset ?? 45 }
}

function applyPreviewDash(ctx: CanvasRenderingContext2D, spec: ShapeSpec, width: number) {
  if (spec.dash === 'dashed') ctx.setLineDash([width * 3, width * 2])
  else if (spec.dash === 'dotted') ctx.setLineDash([width * .25, width * 1.8])
  else if (spec.dash === 'custom') ctx.setLineDash([Math.max(1, spec.dashLength ?? 12), Math.max(1, spec.gapLength ?? 8)])
  else ctx.setLineDash([])
}

function drawShapePreview(
  ctx: CanvasRenderingContext2D,
  spec: ShapeSpec,
  view: { zoom: number; panX: number; panY: number },
  viewportW: number,
  viewportH: number,
) {
  if (spec.shape === 'line') {
    ctx.save()
    ctx.translate(view.panX, view.panY)
    ctx.scale(view.zoom, view.zoom)
    traceShapePath(ctx, spec)
    ctx.strokeStyle = spec.stroke || spec.fill || '#e8a33d'
    ctx.globalAlpha = Math.max(0, Math.min(1, (spec.strokeOpacity ?? 100) / 100))
    const width = Math.max(spec.strokeWidth ?? 4, 1.5 / view.zoom)
    ctx.lineWidth = width
    ctx.lineCap = spec.lineCap ?? 'round'
    applyPreviewDash(ctx, spec, width)
    ctx.stroke()
    drawArrowheads(ctx, spec)
    ctx.restore()
    return
  }

  if (spec.fill) {
    ctx.save()
    ctx.translate(view.panX, view.panY)
    ctx.scale(view.zoom, view.zoom)
    traceShapePath(ctx, spec)
    ctx.fillStyle = spec.fill
    ctx.globalAlpha = 0.4 * Math.max(0, Math.min(1, (spec.fillOpacity ?? 100) / 100))
    ctx.fill()
    ctx.restore()
  }
  if (!spec.stroke || (spec.strokeWidth ?? 0) <= 0) return

  const alpha = Math.max(0, Math.min(1, (spec.strokeOpacity ?? 100) / 100))
  const align = spec.strokeAlign ?? 'center'
  if (align === 'outside') {
    // Build outside strokes offscreen so punching out the shape interior does
    // not erase the fill preview or unrelated overlays beneath it.
    const tmp = createCanvas(Math.max(1, viewportW), Math.max(1, viewportH))
    const tc = ctx2d(tmp)
    tc.translate(view.panX, view.panY)
    tc.scale(view.zoom, view.zoom)
    tc.strokeStyle = spec.stroke
    tc.lineWidth = (spec.strokeWidth ?? 4) * 2
    tc.lineJoin = 'round'
    applyPreviewDash(tc, spec, spec.strokeWidth ?? 4)
    traceShapePath(tc, spec)
    tc.stroke()
    tc.setLineDash([])
    tc.globalCompositeOperation = 'destination-out'
    traceShapePath(tc, spec)
    tc.fillStyle = '#000'
    tc.fill()
    tc.globalCompositeOperation = 'source-over'
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.drawImage(tmp, 0, 0)
    ctx.restore()
    return
  }

  ctx.save()
  ctx.translate(view.panX, view.panY)
  ctx.scale(view.zoom, view.zoom)
  if (align === 'inside') {
    traceShapePath(ctx, spec)
    ctx.clip()
  }
  ctx.strokeStyle = spec.stroke
  ctx.globalAlpha = alpha
  ctx.lineWidth = (spec.strokeWidth ?? 4) * (align === 'inside' ? 2 : 1)
  ctx.lineJoin = 'round'
  applyPreviewDash(ctx, spec, spec.strokeWidth ?? 4)
  traceShapePath(ctx, spec)
  ctx.stroke()
  ctx.restore()
}

function drawArrowheads(ctx: CanvasRenderingContext2D, spec: ShapeSpec) {
  if (spec.shape !== 'line' || (!spec.arrowStart && !spec.arrowEnd)) return
  const x0 = spec.x, y0 = spec.y, x1 = spec.x + spec.w, y1 = spec.y + spec.h
  const angle = Math.atan2(y1 - y0, x1 - x0)
  const len = Math.max(8, (spec.strokeWidth ?? 4) * 4)
  const spread = Math.PI / 7
  const draw = (x: number, y: number, a: number) => {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x - Math.cos(a - spread) * len, y - Math.sin(a - spread) * len)
    ctx.moveTo(x, y)
    ctx.lineTo(x - Math.cos(a + spread) * len, y - Math.sin(a + spread) * len)
    ctx.stroke()
  }
  if (spec.arrowEnd) draw(x1, y1, angle)
  if (spec.arrowStart) draw(x0, y0, angle + Math.PI)
}

export const shapeTool: Tool = {
  id: 'shape',
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    drag = { startX: p.docX, startY: p.docY, lastX: p.docX, lastY: p.docY, active: true }
    shapeRect = null
    shapeVec = null
    engine.requestRender()
  },

  onPointerMove(p: PointerInfo) {
    if (!drag.active) return
    const spec = currentShapeSpec(p, true)
    if (spec) shapeRect = { x: spec.x, y: spec.y, w: spec.w, h: spec.h }
    shapeVec = spec ? { x0: spec.x, y0: spec.y, x1: spec.x + spec.w, y1: spec.y + spec.h } : null
    engine.requestRender()
  },

  onPointerUp(p: PointerInfo) {
    if (!drag.active) return
    drag.active = false
    const spec = currentShapeSpec(p, false)
    shapeRect = null
    shapeVec = null
    const isLine = spec?.shape === 'line'
    if (!spec || (!isLine && (Math.abs(spec.w) < 2 || Math.abs(spec.h) < 2)) || (isLine && Math.hypot(spec.w, spec.h) < 2)) {
      engine.requestRender()
      return
    }
    engine.addShapeLayer(spec)
  },

  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    if (shapeRect && drag.active && shapeVec) {
      const shapeOpts = getOptions('shape')
      const spec = shapeOpts.shape === 'line'
        ? { ...shapeOpts, shape: 'line', x: shapeVec.x0, y: shapeVec.y0, w: shapeVec.x1 - shapeVec.x0, h: shapeVec.y1 - shapeVec.y0 } as ShapeSpec
        : { ...shapeOpts, stroke: shapeOpts.strokeEnabled ? (shapeOpts.stroke ?? '#ffffff') : null, x: shapeRect.x, y: shapeRect.y, w: shapeRect.w, h: shapeRect.h } as ShapeSpec
      drawShapePreview(ctx, spec, view, w, h)
      // dashed bbox
      const x = shapeRect.x * view.zoom + view.panX
      const y = shapeRect.y * view.zoom + view.panY
      drawDashedRect(ctx, x, y, shapeRect.w * view.zoom, shapeRect.h * view.zoom)
      // size readout
      ctx.save()
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillStyle = 'rgba(0,0,0,0.8)'
      ctx.fillText(`${Math.round(Math.abs(shapeRect.w))} × ${Math.round(Math.abs(shapeRect.h))}`, x + 2, y - 4)
      ctx.fillStyle = '#e8a33d'
      ctx.fillText(`${Math.round(Math.abs(shapeRect.w))} × ${Math.round(Math.abs(shapeRect.h))}`, x + 1, y - 5)
      ctx.restore()
    } else drawCross(ctx, mouse)
  },
}
