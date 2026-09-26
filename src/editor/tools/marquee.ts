import type { Tool, PointerInfo, Rect, SelectionState } from '../types'
import { engine } from '../engine/engine'
import { newDrag, getOptions, combineMode, drawDashedRect, drawCross } from './shared'
import { rectFromPoints, cloneCanvas, createCanvas, ctx2d, clamp } from '../utils/canvas'
import { selectionFromMask } from '../engine/selection'
import { snapToGuides } from '../engine/guides'
import { useEditorStore } from '../store'

function snapPoint(x: number, y: number): { x: number; y: number } {
  const doc = engine.activeDoc
  if (!doc) return { x, y }
  const prefs = useEditorStore.getState().view
  if (!prefs.snapGuides || !doc.guides?.length) return { x, y }
  return snapToGuides(doc, doc.view, x, y)
}

let drag = newDrag()
let current: Rect | null = null
let startMods = { shift: false, alt: false }

interface SelectionMove {
  originalMask: HTMLCanvasElement
  startX: number
  startY: number
  dx: number
  dy: number
  bounds: Rect
  previewMask: HTMLCanvasElement
}
let selectionMove: SelectionMove | null = null

type SelectionTransformHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate' | 'inside'
interface SelectionTransform {
  originalMask: HTMLCanvasElement
  startRect: Rect
  handle: SelectionTransformHandle
  startX: number
  startY: number
  startAngle: number
  changed: boolean
  previewMask: HTMLCanvasElement
}
let selectionTransform: SelectionTransform | null = null

function clipSelectionBounds(r: Rect, w: number, h: number): Rect {
  const x0 = Math.max(0, r.x)
  const y0 = Math.max(0, r.y)
  const x1 = Math.min(w, r.x + r.w)
  const y1 = Math.min(h, r.y + r.h)
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

function previewSelectionState(mask: HTMLCanvasElement, bounds: Rect): SelectionState {
  return { mask, bounds, _v: 1, _pathsV: -1, _paths: null }
}

function rotatedBounds(r: Rect, angle: number): Rect {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const ca = Math.cos(angle), sa = Math.sin(angle)
  const corners = [
    [r.x, r.y], [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h], [r.x, r.y + r.h],
  ]
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of corners) {
    const dx = x - cx, dy = y - cy
    const rx = cx + dx * ca - dy * sa
    const ry = cy + dx * sa + dy * ca
    minX = Math.min(minX, rx); minY = Math.min(minY, ry)
    maxX = Math.max(maxX, rx); maxY = Math.max(maxY, ry)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function transformHandlePoints(r: Rect) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  return [
    ['nw', r.x, r.y], ['n', cx, r.y], ['ne', r.x + r.w, r.y],
    ['e', r.x + r.w, cy], ['se', r.x + r.w, r.y + r.h],
    ['s', cx, r.y + r.h], ['sw', r.x, r.y + r.h], ['w', r.x, cy],
  ] as [Exclude<SelectionTransformHandle, 'rotate' | 'inside'>, number, number][]
}

function hitSelectionTransform(p: PointerInfo, r: Rect, zoom: number): SelectionTransformHandle | null {
  const tol = Math.max(8 / Math.max(.02, zoom), 2)
  const rx = r.x + r.w / 2
  const ry = r.y - 28 / Math.max(.02, zoom)
  if (Math.hypot(p.docX - rx, p.docY - ry) <= tol * 1.25) return 'rotate'
  for (const [id, x, y] of transformHandlePoints(r)) {
    if (Math.hypot(p.docX - x, p.docY - y) <= tol) return id
  }
  if (p.docX >= r.x && p.docX <= r.x + r.w && p.docY >= r.y && p.docY <= r.y + r.h) return 'inside'
  return null
}

function transformedRect(start: Rect, handle: SelectionTransformHandle, p: PointerInfo, sx: number, sy: number): Rect {
  if (handle === 'inside' || handle === 'rotate') return { ...start }
  let x0 = start.x, y0 = start.y, x1 = start.x + start.w, y1 = start.y + start.h
  if (handle.includes('w')) x0 = p.docX
  if (handle.includes('e')) x1 = p.docX
  if (handle.includes('n')) y0 = p.docY
  if (handle.includes('s')) y1 = p.docY
  let r = rectFromPoints(x0, y0, x1, y1)

  if (p.shift) {
    const ratio = start.w / Math.max(.001, start.h)
    const wantH = r.w / ratio
    const wantW = r.h * ratio
    if (Math.abs(wantH - r.h) <= Math.abs(wantW - r.w)) {
      if (handle.includes('n')) r.y = start.y + start.h - wantH
      r.h = wantH
    } else {
      if (handle.includes('w')) r.x = start.x + start.w - wantW
      r.w = wantW
    }
  }
  if (p.alt) {
    const cx = start.x + start.w / 2, cy = start.y + start.h / 2
    if (handle.includes('w') || handle.includes('e')) {
      const half = Math.abs((handle.includes('w') ? r.x : r.x + r.w) - cx)
      r.x = cx - half; r.w = half * 2
    }
    if (handle.includes('n') || handle.includes('s')) {
      const half = Math.abs((handle.includes('n') ? r.y : r.y + r.h) - cy)
      r.y = cy - half; r.h = half * 2
    }
  }
  void sx; void sy
  return r
}

function previewSelectionTransform(p: PointerInfo) {
  const doc = engine.activeDoc
  const st = selectionTransform
  if (!doc || !st) return
  const mask = st.previewMask
  const mc = ctx2d(mask)
  mc.setTransform(1, 0, 0, 1, 0, 0)
  mc.clearRect(0, 0, mask.width, mask.height)
  const b = st.startRect
  let nextBounds = { ...b }

  if (st.handle === 'rotate') {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    let a = Math.atan2(p.docY - cy, p.docX - cx) - st.startAngle
    if (p.shift) {
      const step = Math.PI / 12
      a = Math.round(a / step) * step
    }
    mc.translate(cx, cy)
    mc.rotate(a)
    mc.translate(-cx, -cy)
    mc.drawImage(st.originalMask, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h)
    mc.setTransform(1, 0, 0, 1, 0, 0)
    nextBounds = rotatedBounds(b, a)
    st.changed = Math.abs(a) > 1e-4
  } else if (st.handle === 'inside') {
    let dx = Math.round(p.docX - st.startX)
    let dy = Math.round(p.docY - st.startY)
    if (p.shift) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0
      else dx = 0
    }
    mc.drawImage(st.originalMask, b.x, b.y, b.w, b.h, b.x + dx, b.y + dy, b.w, b.h)
    nextBounds = { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h }
    st.changed = !!(dx || dy)
  } else {
    const r = transformedRect(b, st.handle, p, st.startX, st.startY)
    nextBounds = r
    if (r.w > .5 && r.h > .5) {
      mc.imageSmoothingEnabled = true
      mc.imageSmoothingQuality = 'high'
      mc.drawImage(st.originalMask, b.x, b.y, b.w, b.h, r.x, r.y, r.w, r.h)
      st.changed = Math.abs(r.x - b.x) > .01 || Math.abs(r.y - b.y) > .01 || Math.abs(r.w - b.w) > .01 || Math.abs(r.h - b.h) > .01
    }
  }
  doc.selection = previewSelectionState(mask, clipSelectionBounds(nextBounds, doc.width, doc.height))
  engine.pokeOverlay()
}

function finishSelectionTransform(commit: boolean) {
  const doc = engine.activeDoc
  const st = selectionTransform
  if (!doc || !st) { selectionTransform = null; return }
  if (!commit || !st.changed) {
    doc.selection = selectionFromMask(cloneCanvas(st.originalMask))
    engine.pokeOverlay()
  } else {
    engine.pushHistory('Transform Selection')
    engine.pokeOverlay()
  }
  selectionTransform = null
}

function pointInSelection(x: number, y: number): boolean {
  const doc = engine.activeDoc
  const sel = doc?.selection
  if (!doc || !sel) return false
  const px = Math.floor(x), py = Math.floor(y)
  if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) return false
  const b = sel.bounds
  if (x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) return false
  return ctx2d(sel.mask).getImageData(px, py, 1, 1).data[3] > 0
}

function previewSelectionMove(dx: number, dy: number) {
  const doc = engine.activeDoc
  if (!doc || !selectionMove) return
  const mask = selectionMove.previewMask
  const mc = ctx2d(mask)
  mc.clearRect(0, 0, mask.width, mask.height)
  const b = selectionMove.bounds
  mc.drawImage(selectionMove.originalMask, b.x, b.y, b.w, b.h, b.x + dx, b.y + dy, b.w, b.h)
  doc.selection = previewSelectionState(mask, clipSelectionBounds({
    x: selectionMove.bounds.x + dx,
    y: selectionMove.bounds.y + dy,
    w: selectionMove.bounds.w,
    h: selectionMove.bounds.h,
  }, doc.width, doc.height))
  engine.pokeOverlay()
}

function finishSelectionMove(commit: boolean) {
  const doc = engine.activeDoc
  const sm = selectionMove
  if (!doc || !sm) { selectionMove = null; return }
  if (!commit) {
    doc.selection = selectionFromMask(cloneCanvas(sm.originalMask))
    engine.pokeOverlay()
  } else if (sm.dx || sm.dy) {
    engine.pushHistory('Move Selection')
    engine.pokeOverlay()
  }
  selectionMove = null
}

function ratioFrom(opts: Record<string, any>): number {
  return Math.max(0.001, (Number(opts.ratioW) || 1) / Math.max(0.001, Number(opts.ratioH) || 1))
}

function geometry(kind: 'rect' | 'ellipse', p: PointerInfo, opts: Record<string, any>): Rect {
  const s = snapPoint(p.docX, p.docY)
  const style = opts.style ?? 'normal'
  if (style === 'fixed') {
    const w = Math.max(1, Number(opts.fixedW) || 100)
    const h = Math.max(1, Number(opts.fixedH) || 100)
    return p.alt
      ? { x: s.x - w / 2, y: s.y - h / 2, w, h }
      : { x: s.x, y: s.y, w, h }
  }

  let dx = s.x - drag.startX, dy = s.y - drag.startY
  const forcedRatio = style === 'ratio' ? ratioFrom(opts) : (p.shift ? 1 : null)
  if (forcedRatio) {
    if (Math.abs(dx) / Math.max(.001, Math.abs(dy)) > forcedRatio) {
      dy = Math.sign(dy || 1) * Math.abs(dx) / forcedRatio
    } else {
      dx = Math.sign(dx || 1) * Math.abs(dy) * forcedRatio
    }
  }

  // Alt/Option grows from the initial click as the center. This also fixes
  // the old Shift-square bug where dragging up/left could jump quadrants.
  if (p.alt) {
    return {
      x: drag.startX - Math.abs(dx),
      y: drag.startY - Math.abs(dy),
      w: Math.abs(dx) * 2,
      h: Math.abs(dy) * 2,
    }
  }
  return rectFromPoints(drag.startX, drag.startY, drag.startX + dx, drag.startY + dy)
}

function make(kind: 'rect' | 'ellipse'): Tool {
  const id = kind === 'rect' ? 'marquee-rect' : 'marquee-ellipse'
  return {
    id,
    cursor: 'crosshair',

    onPointerDown(p: PointerInfo) {
      if (p.button !== 0) return
      const opts = getOptions(id)
      const doc = engine.activeDoc
      if (doc?.selection && opts.transformSelection === true) {
        const hit = hitSelectionTransform(p, doc.selection.bounds, doc.view.zoom)
        if (hit) {
          const b = { ...doc.selection.bounds }
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2
          selectionTransform = {
            originalMask: cloneCanvas(doc.selection.mask),
            startRect: b,
            handle: hit,
            startX: p.docX,
            startY: p.docY,
            startAngle: Math.atan2(p.docY - cy, p.docX - cx),
            changed: false,
            previewMask: createCanvas(doc.width, doc.height),
          }
          drag.active = false
          current = null
          engine.pokeOverlay()
          return
        }
      }
      // Photoshop marquee behavior: with New Selection active, dragging from
      // inside the current selection moves only the boundary/mask, never pixels.
      if (doc?.selection && (opts.mode ?? 'new') === 'new' && !p.shift && !p.alt && pointInSelection(p.docX, p.docY)) {
        selectionMove = {
          originalMask: cloneCanvas(doc.selection.mask),
          startX: p.docX,
          startY: p.docY,
          dx: 0,
          dy: 0,
          bounds: { ...doc.selection.bounds },
          previewMask: createCanvas(doc.width, doc.height),
        }
        drag.active = false
        current = null
        engine.pokeOverlay()
        return
      }
      const s = snapPoint(p.docX, p.docY)
      drag = { startX: s.x, startY: s.y, lastX: s.x, lastY: s.y, active: true }
      startMods = { shift: p.shift, alt: p.alt }
      current = opts.style === 'fixed' ? geometry(kind, p, opts) : null
      engine.pokeOverlay()
    },

    onPointerMove(p: PointerInfo) {
      if (selectionTransform) {
        previewSelectionTransform(p)
        return
      }
      if (selectionMove) {
        let dx = Math.round(p.docX - selectionMove.startX)
        let dy = Math.round(p.docY - selectionMove.startY)
        if (p.shift) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0
          else dx = 0
        }
        const snapped = snapPoint(selectionMove.bounds.x + dx, selectionMove.bounds.y + dy)
        dx += Math.round(snapped.x - (selectionMove.bounds.x + dx))
        dy += Math.round(snapped.y - (selectionMove.bounds.y + dy))
        if (dx === selectionMove.dx && dy === selectionMove.dy) return
        selectionMove.dx = dx
        selectionMove.dy = dy
        previewSelectionMove(dx, dy)
        return
      }
      if (!drag.active) return
      current = geometry(kind, p, getOptions(id))
      engine.pokeOverlay()
    },

    onPointerUp(p: PointerInfo) {
      if (selectionTransform) { finishSelectionTransform(true); return }
      if (selectionMove) { finishSelectionMove(true); return }
      if (!drag.active) return
      drag.active = false
      const opts = getOptions(id)
      const rect = current ?? geometry(kind, p, opts)
      current = null
      if (rect.w < 1 || rect.h < 1) { engine.pokeOverlay(); return }
      // Combine modifiers are determined by the gesture start, so releasing
      // Shift after using it to constrain geometry cannot accidentally change
      // Add/Subtract semantics at commit.
      const mode = combineMode(startMods, opts.mode ?? 'new')
      engine.selectShape(
        { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
        kind, opts.feather ?? 0, mode, opts.antiAlias !== false,
      )
      engine.pokeOverlay()
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && selectionTransform) {
        finishSelectionTransform(false)
        return true
      }
      if (e.key === 'Enter' && selectionTransform) {
        finishSelectionTransform(true)
        return true
      }
      if (e.key === 'Escape' && selectionMove) {
        finishSelectionMove(false)
        return true
      }
      if (e.key === 'Escape' && drag.active) {
        drag.active = false; current = null; engine.pokeOverlay(); return true
      }
      return false
    },

    onDeactivate() {
      if (selectionTransform) finishSelectionTransform(true)
      if (selectionMove) finishSelectionMove(true)
      drag.active = false
      current = null
    },

    renderOverlay(ctx, view, w, h, mouse) {
      void w; void h
      if (current && drag.active) {
        const x = current.x * view.zoom + view.panX
        const y = current.y * view.zoom + view.panY
        const rw = current.w * view.zoom
        const rh = current.h * view.zoom
        ctx.save()
        ctx.fillStyle = 'rgba(255,255,255,0.08)'
        if (kind === 'ellipse') {
          ctx.beginPath()
          ctx.ellipse(x + rw / 2, y + rh / 2, Math.abs(rw / 2), Math.abs(rh / 2), 0, 0, Math.PI * 2)
          ctx.fill()
        } else ctx.fillRect(x, y, rw, rh)
        ctx.restore()
        drawDashedRect(ctx, x, y, rw, rh)
        ctx.save()
        const label = `${Math.round(current.w)} × ${Math.round(current.h)}`
        ctx.font = '11px monospace'
        const tw = ctx.measureText(label).width + 12
        ctx.fillStyle = 'rgba(0,0,0,0.72)'
        ctx.fillRect(x + rw + 6, y - 20, tw, 16)
        ctx.fillStyle = '#fff'
        ctx.fillText(label, x + rw + 12, y - 8)
        ctx.restore()
      } else {
        const doc = engine.activeDoc
        const opts = getOptions(id)
        if (doc?.selection && opts.transformSelection === true) {
          const b = doc.selection.bounds
          const x = b.x * view.zoom + view.panX, y = b.y * view.zoom + view.panY
          const rw = b.w * view.zoom, rh = b.h * view.zoom
          drawDashedRect(ctx, x, y, rw, rh)
          ctx.save()
          ctx.strokeStyle = '#e8a33d'
          ctx.lineWidth = 1
          const rotX = x + rw / 2, rotY = y - 28
          ctx.beginPath(); ctx.moveTo(x + rw / 2, y); ctx.lineTo(rotX, rotY); ctx.stroke()
          for (const [, hx, hy] of transformHandlePoints(b)) {
            const sx = hx * view.zoom + view.panX, sy = hy * view.zoom + view.panY
            ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'
            ctx.fillRect(sx - 4, sy - 4, 8, 8); ctx.strokeRect(sx - 4.5, sy - 4.5, 9, 9)
          }
          ctx.fillStyle = '#e8a33d'; ctx.strokeStyle = '#111'
          ctx.beginPath(); ctx.arc(rotX, rotY, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
          ctx.restore()
        } else drawCross(ctx, mouse)
      }
    },
  }
}

export const marqueeRectTool: Tool = make('rect')
export const marqueeEllipseTool: Tool = make('ellipse')

function makeSingle(axis: 'row' | 'column'): Tool {
  const id = axis === 'row' ? 'marquee-row' : 'marquee-column'
  let active = false
  let position = 0
  let gestureMods = { shift: false, alt: false }

  const updatePosition = (p: PointerInfo) => {
    const doc = engine.activeDoc
    if (!doc) return
    const snapped = snapPoint(p.docX, p.docY)
    position = axis === 'row'
      ? clamp(Math.floor(snapped.y), 0, Math.max(0, doc.height - 1))
      : clamp(Math.floor(snapped.x), 0, Math.max(0, doc.width - 1))
  }

  return {
    id,
    cursor: 'crosshair',

    onPointerDown(p: PointerInfo) {
      if (p.button !== 0 || !engine.activeDoc) return
      active = true
      gestureMods = { shift: p.shift, alt: p.alt }
      updatePosition(p)
      engine.pokeOverlay()
    },

    onPointerMove(p: PointerInfo) {
      if (!active) return
      updatePosition(p)
      engine.pokeOverlay()
    },

    onPointerUp(p: PointerInfo) {
      const doc = engine.activeDoc
      if (!active || !doc) return
      updatePosition(p)
      active = false
      const opts = getOptions(id)
      const mode = combineMode(gestureMods, opts.mode ?? 'new')
      const feather = Math.max(0, Number(opts.feather) || 0)
      const rect = axis === 'row'
        ? { x: 0, y: position, w: doc.width, h: 1 }
        : { x: position, y: 0, w: 1, h: doc.height }
      engine.selectShape(rect, 'rect', feather, mode, false)
      engine.pokeOverlay()
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && active) {
        active = false
        engine.pokeOverlay()
        return true
      }
      return false
    },

    onDeactivate() {
      active = false
    },

    renderOverlay(ctx, view, w, h, mouse) {
      void w; void h
      const doc = engine.activeDoc
      if (!doc || !active) {
        drawCross(ctx, mouse)
        return
      }
      const x0 = view.panX
      const y0 = view.panY
      const x1 = view.panX + doc.width * view.zoom
      const y1 = view.panY + doc.height * view.zoom
      ctx.save()
      ctx.lineWidth = 1
      ctx.setLineDash([5, 4])
      ctx.strokeStyle = '#ffffff'
      ctx.beginPath()
      if (axis === 'row') {
        const y = y0 + (position + .5) * view.zoom
        ctx.moveTo(x0, y); ctx.lineTo(x1, y)
      } else {
        const x = x0 + (position + .5) * view.zoom
        ctx.moveTo(x, y0); ctx.lineTo(x, y1)
      }
      ctx.stroke()
      ctx.strokeStyle = '#000000'
      ctx.lineDashOffset = 5
      ctx.stroke()
      ctx.setLineDash([])
      const label = axis === 'row' ? `1 px row · y ${position}` : `1 px column · x ${position}`
      ctx.font = '11px ui-monospace, monospace'
      const tw = ctx.measureText(label).width + 10
      const lx = axis === 'row' ? x0 + 8 : Math.min(x1 - tw - 4, x0 + position * view.zoom + 8)
      const ly = axis === 'row' ? Math.min(y1 - 18, y0 + position * view.zoom + 6) : y0 + 8
      ctx.fillStyle = 'rgba(0,0,0,.72)'
      ctx.fillRect(lx, ly, tw, 16)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, lx + 5, ly + 12)
      ctx.restore()
    },
  }
}

export const marqueeRowTool: Tool = makeSingle('row')
export const marqueeColumnTool: Tool = makeSingle('column')
