// Crop / Eyedropper / Hand / Zoom tools — Photoshop-style interaction pass
import type { Tool, PointerInfo, Rect } from '../types'
import { engine } from '../engine/engine'
import { getOptions, newDrag, drawCross, drawDashedRect } from './shared'
import { rectFromPoints, clamp } from '../utils/canvas'
import { useEditorStore } from '../store'
import { snapToGuides } from '../engine/guides'

function snapPoint(x: number, y: number): { x: number; y: number } {
  const doc = engine.activeDoc
  if (!doc) return { x, y }
  const prefs = useEditorStore.getState().view
  if (!prefs.snapGuides || !doc.guides?.length) return { x, y }
  return snapToGuides(doc, doc.view, x, y)
}

// ============================================================
// Crop
// ============================================================
type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'inside'
type CropMode = 'new' | 'move' | 'resize'

let cropDrag = newDrag()
let cropRect: Rect | null = null
let cropStartRect: Rect | null = null
let cropMode: CropMode = 'new'
let cropHandle: CropHandle | null = null

function ratioValue(raw: unknown): number | null {
  if (!raw || raw === 'free') return null
  const [a, b] = String(raw).split(':').map(Number)
  return a > 0 && b > 0 ? a / b : null
}

function rectFromDrag(p: PointerInfo): Rect {
  const opts = getOptions('crop')
  let ex = p.docX, ey = p.docY
  const snapped = snapPoint(ex, ey)
  ex = snapped.x; ey = snapped.y
  let sx = cropDrag.startX, sy = cropDrag.startY
  let dx = ex - sx, dy = ey - sy

  const ratio = ratioValue(opts.ratio)
  if (ratio) {
    if (Math.abs(dx) / Math.max(0.001, Math.abs(dy)) > ratio) dy = Math.sign(dy || 1) * Math.abs(dx) / ratio
    else dx = Math.sign(dx || 1) * Math.abs(dy) * ratio
  }
  if (p.alt) {
    // Alt/Option: draw the crop from its center, matching PS transform-style interaction.
    return { x: sx - Math.abs(dx), y: sy - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 }
  }
  return rectFromPoints(sx, sy, sx + dx, sy + dy)
}

function cropHandlePoints(r: Rect) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  return [
    ['nw', r.x, r.y], ['n', cx, r.y], ['ne', r.x + r.w, r.y],
    ['e', r.x + r.w, cy], ['se', r.x + r.w, r.y + r.h],
    ['s', cx, r.y + r.h], ['sw', r.x, r.y + r.h], ['w', r.x, cy],
  ] as [Exclude<CropHandle, 'inside'>, number, number][]
}

function hitCrop(p: PointerInfo, r: Rect, zoom: number): CropHandle | null {
  const tol = Math.max(8 / Math.max(zoom, 0.02), 2)
  for (const [id, x, y] of cropHandlePoints(r)) {
    if (Math.hypot(p.docX - x, p.docY - y) <= tol) return id
  }
  if (p.docX >= r.x && p.docX <= r.x + r.w && p.docY >= r.y && p.docY <= r.y + r.h) return 'inside'
  return null
}

function resizeCrop(start: Rect, h: Exclude<CropHandle, 'inside'>, p: PointerInfo): Rect {
  const s = snapPoint(p.docX, p.docY)
  let x0 = start.x, y0 = start.y, x1 = start.x + start.w, y1 = start.y + start.h
  if (h.includes('w')) x0 = s.x
  if (h.includes('e')) x1 = s.x
  if (h.includes('n')) y0 = s.y
  if (h.includes('s')) y1 = s.y

  // Edge handles move one edge; corner handles move two. Normalize first.
  let r = rectFromPoints(x0, y0, x1, y1)
  const ratio = ratioValue(getOptions('crop').ratio)
  if (ratio && r.w > 0 && r.h > 0) {
    const corner = h.length === 2
    if (corner) {
      const wantH = r.w / ratio
      const wantW = r.h * ratio
      if (Math.abs(wantH - r.h) < Math.abs(wantW - r.w)) {
        if (h.includes('n')) r.y = (start.y + start.h) - wantH
        r.h = wantH
      } else {
        if (h.includes('w')) r.x = (start.x + start.w) - wantW
        r.w = wantW
      }
    } else if (h === 'e' || h === 'w') {
      const nh = r.w / ratio
      r.y = start.y + (start.h - nh) / 2
      r.h = nh
    } else {
      const nw = r.h * ratio
      r.x = start.x + (start.w - nw) / 2
      r.w = nw
    }
  }
  // Shift temporarily forces square even when Ratio is Free.
  if (p.shift && !ratio) {
    const side = Math.max(r.w, r.h)
    if (h.includes('w')) r.x = start.x + start.w - side
    if (h.includes('n')) r.y = start.y + start.h - side
    r.w = side; r.h = side
  }
  return r
}

export const cropTool: Tool = {
  id: 'crop',
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc || p.button !== 0) return
    if (cropRect) {
      const hit = hitCrop(p, cropRect, doc.view.zoom)
      if (hit) {
        cropMode = hit === 'inside' ? 'move' : 'resize'
        cropHandle = hit
        cropStartRect = { ...cropRect }
        cropDrag = { startX: p.docX, startY: p.docY, lastX: p.docX, lastY: p.docY, active: true }
        return
      }
    }
    cropMode = 'new'
    cropHandle = null
    cropStartRect = null
    cropRect = null
    const s = snapPoint(p.docX, p.docY)
    cropDrag = { startX: s.x, startY: s.y, lastX: s.x, lastY: s.y, active: true }
  },

  onPointerMove(p: PointerInfo) {
    if (!cropDrag.active) return
    if (cropMode === 'move' && cropStartRect) {
      const dx = p.docX - cropDrag.startX, dy = p.docY - cropDrag.startY
      cropRect = { ...cropStartRect, x: cropStartRect.x + dx, y: cropStartRect.y + dy }
    } else if (cropMode === 'resize' && cropStartRect && cropHandle && cropHandle !== 'inside') {
      cropRect = resizeCrop(cropStartRect, cropHandle, p)
    } else {
      cropRect = rectFromDrag(p)
    }
    engine.pokeOverlay()
  },

  onPointerUp() {
    cropDrag.active = false
    cropStartRect = null
    cropHandle = null
  },

  onDoubleClick() { commitCrop() },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && cropRect) { commitCrop(); return true }
    if (e.key === 'Escape' && cropRect) {
      cropRect = null; cropStartRect = null; cropHandle = null; cropDrag.active = false
      engine.pokeOverlay(); return true
    }
    return false
  },

  renderOverlay(ctx, view, w, h, mouse) {
    const r = cropRect
    if (!r) {
      drawCross(ctx, mouse)
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(w / 2 - 154, h - 34, 308, 22)
      ctx.fillStyle = '#fff'
      ctx.font = '12px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Drag crop · Alt from center · Enter / double-click applies', w / 2, h - 19)
      ctx.restore()
      return
    }

    const x = r.x * view.zoom + view.panX
    const y = r.y * view.zoom + view.panY
    const rw = r.w * view.zoom, rh = r.h * view.zoom

    // Darken everything outside the crop, including when it extends beyond
    // the current document. Even-odd clipping avoids negative fill sizes.
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.rect(x, y, rw, rh)
    ctx.clip('evenodd')
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(0, 0, w, h)
    ctx.restore()

    const overlay = String(getOptions('crop').overlay ?? 'thirds')
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.38)'
    ctx.lineWidth = 1
    if (overlay === 'thirds') {
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(x + rw * i / 3, y); ctx.lineTo(x + rw * i / 3, y + rh); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(x, y + rh * i / 3); ctx.lineTo(x + rw, y + rh * i / 3); ctx.stroke()
      }
    } else if (overlay === 'grid') {
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(x + rw * i / 4, y); ctx.lineTo(x + rw * i / 4, y + rh); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(x, y + rh * i / 4); ctx.lineTo(x + rw, y + rh * i / 4); ctx.stroke()
      }
    } else if (overlay === 'diagonal') {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rw, y + rh)
      ctx.moveTo(x + rw, y); ctx.lineTo(x, y + rh); ctx.stroke()
    } else if (overlay === 'golden') {
      const a = 0.382, b = 0.618
      for (const t of [a, b]) {
        ctx.beginPath(); ctx.moveTo(x + rw * t, y); ctx.lineTo(x + rw * t, y + rh); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(x, y + rh * t); ctx.lineTo(x + rw, y + rh * t); ctx.stroke()
      }
    }
    ctx.restore()

    drawDashedRect(ctx, x, y, rw, rh)

    // 8 resize handles
    ctx.save()
    for (const [, hx, hy] of cropHandlePoints(r)) {
      const sx = hx * view.zoom + view.panX, sy = hy * view.zoom + view.panY
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1
      ctx.fillRect(sx - 4, sy - 4, 8, 8); ctx.strokeRect(sx - 4.5, sy - 4.5, 9, 9)
    }
    ctx.restore()

    ctx.save()
    const label = `${Math.round(r.w)} × ${Math.round(r.h)} px`
    ctx.font = '11px monospace'
    const tw = ctx.measureText(label).width + 12
    ctx.fillStyle = 'rgba(0,0,0,0.72)'
    ctx.fillRect(x, y + rh + 6, tw, 18)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, x + 6, y + rh + 19)
    ctx.restore()
  },

  onDeactivate() {
    cropDrag.active = false
    cropStartRect = null
    cropHandle = null
  },
}

function commitCrop() {
  const doc = engine.activeDoc
  if (!doc || !cropRect) return
  const r = cropRect
  cropRect = null
  if (r.w < 1 || r.h < 1) { engine.pokeOverlay(); return }
  const opts = getOptions('crop')
  engine.cropTo(r, { deletePixels: opts.deletePixels !== false })
}

// ============================================================
// Eyedropper
// ============================================================
function eyedropRadius(): number {
  // UI stores Photoshop-style sample size (1,3,5,7,11...), engine expects radius.
  return Math.max(0, Math.floor(((Number(getOptions('eyedropper').radius) || 1) - 1) / 2))
}

export const eyedropperTool: Tool = {
  id: 'eyedropper',
  cursor: 'crosshair',
  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const opts = getOptions('eyedropper')
    const hex = engine.sampleColor(p.docX, p.docY, opts.sample ?? 'composite', eyedropRadius())
    if (!hex) return
    const store = useEditorStore.getState()
    if (p.alt) store.setBgColor(hex)
    else store.setFgColor(hex)
  },
  onPointerMove(p: PointerInfo) {
    const opts = getOptions('eyedropper')
    const hex = engine.sampleColor(p.docX, p.docY, opts.sample ?? 'composite', eyedropRadius())
    if (hex) { eyedropPreview = hex; engine.pokeOverlay() }
  },
  onDeactivate() { eyedropPreview = null },
  renderOverlay(ctx, view, w, h, mouse) {
    void view; void w; void h
    if (mouse && eyedropPreview) {
      ctx.save()
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillStyle = 'rgba(10,10,12,.82)'
      ctx.fillRect(mouse.x + 11, mouse.y - 33, 78, 25)
      ctx.fillStyle = eyedropPreview
      ctx.fillRect(mouse.x + 15, mouse.y - 29, 17, 17)
      ctx.strokeStyle = '#fff'; ctx.strokeRect(mouse.x + 14.5, mouse.y - 29.5, 18, 18)
      ctx.fillStyle = '#fff'
      ctx.fillText(eyedropPreview.toUpperCase(), mouse.x + 37, mouse.y - 17)
      ctx.restore()
    }
    drawCross(ctx, mouse)
  },
}
let eyedropPreview: string | null = null

// ============================================================
// Hand
// ============================================================
let handDrag = newDrag()
export const handTool: Tool = {
  id: 'hand',
  cursor: 'grab',
  onPointerDown(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc || p.button !== 0) return
    handDrag = { startX: p.rawX, startY: p.rawY, lastX: p.rawX, lastY: p.rawY, active: true }
  },
  onPointerMove(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc || !handDrag.active) return
    doc.view.panX += p.rawX - handDrag.lastX
    doc.view.panY += p.rawY - handDrag.lastY
    handDrag.lastX = p.rawX
    handDrag.lastY = p.rawY
    engine.viewChanged()
  },
  onPointerUp() { handDrag.active = false },
  onDoubleClick() {
    // Photoshop: double-click Hand = Fit on Screen.
    ;(window as any).__zphotoViewport?.fit?.()
  },
  onDeactivate() { handDrag.active = false },
}

// ============================================================
// Zoom
// ============================================================
let zoomDrag: { lastX: number; moved: boolean } | null = null

function zoomAt(p: PointerInfo, factor: number) {
  const doc = engine.activeDoc
  if (!doc) return
  const old = doc.view.zoom
  const next = clamp(old * factor, 0.02, 32)
  if (Math.abs(next - old) < 1e-9) return
  // Keep the clicked document coordinate pinned to the same screen point.
  const sx = doc.view.panX + p.docX * old
  const sy = doc.view.panY + p.docY * old
  doc.view.zoom = next
  doc.view.panX = sx - p.docX * next
  doc.view.panY = sy - p.docY * next
  doc.view.autoFit = false
  engine.viewChanged()
}

export const zoomTool: Tool = {
  id: 'zoom',
  cursor: 'zoom-in',
  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const opts = getOptions('zoom')
    if (opts.scrubby !== false) {
      zoomDrag = { lastX: p.rawX, moved: false }
    } else {
      const dir = p.alt ? 'out' : opts.mode ?? 'in'
      zoomAt(p, dir === 'in' ? 1.35 : 1 / 1.35)
    }
  },
  onPointerMove(p: PointerInfo) {
    if (!zoomDrag) return
    const dx = p.rawX - zoomDrag.lastX
    if (Math.abs(dx) < 1) return
    zoomDrag.lastX = p.rawX
    zoomDrag.moved = true
    zoomAt(p, Math.exp(dx * 0.012))
  },
  onPointerUp(p: PointerInfo) {
    if (!zoomDrag) return
    if (!zoomDrag.moved) {
      const opts = getOptions('zoom')
      const dir = p.alt ? 'out' : opts.mode ?? 'in'
      zoomAt(p, dir === 'in' ? 1.35 : 1 / 1.35)
    }
    zoomDrag = null
  },
  onDoubleClick(p: PointerInfo) {
    const doc = engine.activeDoc
    if (doc) zoomAt(p, 1 / doc.view.zoom)
  },
  onDeactivate() { zoomDrag = null },
  renderOverlay() {},
}
