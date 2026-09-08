// Crop / Eyedropper / Hand / Zoom tools
import type { Tool, PointerInfo, Rect } from '../types'
import { engine } from '../engine/engine'
import { getOptions, newDrag, drawCross, drawDashedRect } from './shared'
import { rectFromPoints, clamp } from '../utils/canvas'
import { useEditorStore } from '../store'
import { snapToGuides } from '../engine/guides'

/** guide-snap a doc point when snapping is on */
function snapPoint(x: number, y: number): { x: number; y: number } {
  const doc = engine.activeDoc
  if (!doc) return { x, y }
  const prefs = useEditorStore.getState().view
  if (!prefs.snapGuides || !doc.guides?.length) return { x, y }
  return snapToGuides(doc, doc.view, x, y)
}

// ---------- Crop ----------
let cropDrag = newDrag()
let cropRect: Rect | null = null
let cropHover: { x: number; y: number } | null = null

export const cropTool: Tool = {
  id: 'crop',
  cursor: 'crosshair',
  onPointerDown(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc || p.button !== 0) return
    if (cropRect && !cropDrag.active) {
      // dragging inside existing crop rect → move it
      if (p.docX >= cropRect.x && p.docX <= cropRect.x + cropRect.w && p.docY >= cropRect.y && p.docY <= cropRect.y + cropRect.h) {
        cropDrag = { startX: p.docX, startY: p.docY, lastX: p.docX, lastY: p.docY, active: true }
        return
      }
    }
    cropRect = null
    cropDrag = { startX: p.docX, startY: p.docY, lastX: p.docX, lastY: p.docY, active: true }
  },
  onPointerMove(p: PointerInfo) {
    cropHover = { x: p.docX, y: p.docY }
    if (!cropDrag.active) { engine.requestRender(); return }
    if (cropRect) {
      // move mode
      const dx = p.docX - cropDrag.startX, dy = p.docY - cropDrag.startY
      cropRect = { ...cropRect, x: cropRect.x + dx, y: cropRect.y + dy }
      cropDrag.startX = p.docX; cropDrag.startY = p.docY
    } else {
      const s = snapPoint(p.docX, p.docY)
      let r = rectFromPoints(cropDrag.startX, cropDrag.startY, s.x, s.y)
      const opts = getOptions('crop')
      if (opts.ratio && opts.ratio !== 'free') {
        const [a, b] = opts.ratio.split(':').map(Number)
        if (a && b) {
          const ratio = a / b
          if (r.w / r.h > ratio) r = { ...r, w: r.h * ratio }
          else r = { ...r, h: r.w / ratio }
        }
      }
      cropRect = r
    }
    engine.requestRender()
  },
  onPointerUp() { cropDrag.active = false },
  onDoubleClick() { commitCrop() },
  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && cropRect) { commitCrop(); return true }
    if (e.key === 'Escape') { cropRect = null; engine.requestRender(); return true }
    return false
  },
  renderOverlay(ctx, view, w, h, mouse) {
    void mouse
    const doc = engine.activeDoc
    if (!doc) return
    const r = cropRect
    if (!r) {
      // hint
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(w / 2 - 130, h - 34, 260, 22)
      ctx.fillStyle = '#fff'
      ctx.font = '12px sans-serif'
      ctx.fillText('Drag to define crop · Enter or double-click to apply', w / 2 - 122, h - 19)
      ctx.restore()
      return
    }
    const x = r.x * view.zoom + view.panX
    const y = r.y * view.zoom + view.panY
    const rw = r.w * view.zoom, rh = r.h * view.zoom
    // darken outside
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(0, 0, w, y)
    ctx.fillRect(0, y + rh, w, h - y - rh)
    ctx.fillRect(0, y, x, rh)
    ctx.fillRect(x + rw, y, w - x - rw, rh)
    // rule of thirds
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 1
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(x + (rw * i) / 3, y); ctx.lineTo(x + (rw * i) / 3, y + rh); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(x, y + (rh * i) / 3); ctx.lineTo(x + rw, y + (rh * i) / 3); ctx.stroke()
    }
    ctx.restore()
    drawDashedRect(ctx, x, y, rw, rh)
    // size readout
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.7)'
    ctx.fillRect(x, y + rh + 6, 110, 18)
    ctx.fillStyle = '#fff'
    ctx.font = '11px monospace'
    ctx.fillText(`${Math.round(r.w)} × ${Math.round(r.h)} px`, x + 6, y + rh + 19)
    ctx.restore()
  },
}

function commitCrop() {
  const doc = engine.activeDoc
  if (!doc || !cropRect) return
  const r = cropRect
  cropRect = null
  if (r.w < 4 || r.h < 4) { engine.requestRender(); return }
  engine.cropTo({
    x: clamp(r.x, 0, doc.width - 1),
    y: clamp(r.y, 0, doc.height - 1),
    w: clamp(r.w, 1, doc.width),
    h: clamp(r.h, 1, doc.height),
  })
}

// ---------- Eyedropper ----------
export const eyedropperTool: Tool = {
  id: 'eyedropper',
  cursor: 'crosshair',
  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const opts = getOptions('eyedropper')
    const hex = engine.sampleColor(p.docX, p.docY, opts.sample ?? 'composite')
    if (!hex) return
    const store = useEditorStore.getState()
    if (p.alt) store.setBgColor(hex)
    else store.setFgColor(hex)
  },
  onPointerMove(p: PointerInfo) {
    // live preview in status bar handled by cursor pos; color chip preview
    const opts = getOptions('eyedropper')
    const hex = engine.sampleColor(p.docX, p.docY, opts.sample ?? 'composite')
    if (hex) { eyedropPreview = hex; engine.requestRender() }
  },
  renderOverlay(ctx, view, w, h, mouse) {
    void view; void w; void h
    if (mouse && eyedropPreview) {
      ctx.save()
      ctx.fillStyle = eyedropPreview
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(mouse.x + 18, mouse.y - 18, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
    drawCross(ctx, mouse)
  },
}
let eyedropPreview: string | null = null

// ---------- Hand ----------
let handDrag = newDrag()
export const handTool: Tool = {
  id: 'hand',
  cursor: 'grab',
  onPointerDown(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc) return
    handDrag = { startX: p.rawX, startY: p.rawY, lastX: p.rawX, lastY: p.rawY, active: true }
  },
  onPointerMove(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc || !handDrag.active) return
    doc.view.panX += p.rawX - handDrag.lastX
    doc.view.panY += p.rawY - handDrag.lastY
    handDrag.lastX = p.rawX
    handDrag.lastY = p.rawY
    engine.requestRender()
  },
  onPointerUp() { handDrag.active = false },
}

// ---------- Zoom ----------
export const zoomTool: Tool = {
  id: 'zoom',
  cursor: 'zoom-in',
  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const opts = getOptions('zoom')
    const dir = p.alt ? 'out' : opts.mode ?? 'in'
    engine.zoomBy(dir === 'in' ? 1.35 : 1 / 1.35)
  },
  renderOverlay(ctx, view, w, h, mouse) {
    void view; void w; void h; void mouse
  },
}
