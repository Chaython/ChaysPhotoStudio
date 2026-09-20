// ============================================================
// Path Selection Tool — Photoshop-style whole-path selection/movement.
//
// Click a saved path's curve/anchor to select it, then drag to translate the
// complete vector path. Shift constrains movement to the dominant axis.
// Optional guide snapping uses the path's first anchor as the registration
// point. The drag previews live and commits one history state on release.
// ============================================================
import type { Tool, PointerInfo, PathAnchor, SavedPath } from '../types'
import { engine } from '../engine/engine'
import { getOptions } from './shared'
import { snapToGuides } from '../engine/guides'

type Pt = { x: number; y: number }
type Seg = { p0: Pt; p1: Pt; p2: Pt; p3: Pt }

let selectedId: string | null = null
let drag: {
  startX: number
  startY: number
  original: PathAnchor[]
  dx: number
  dy: number
} | null = null

function segBetween(a: PathAnchor, b: PathAnchor): Seg {
  return {
    p0: { x: a.x, y: a.y },
    p1: { x: a.x + a.outX, y: a.y + a.outY },
    p2: { x: b.x + b.inX, y: b.y + b.inY },
    p3: { x: b.x, y: b.y },
  }
}

function cubicAt(s: Seg, t: number): Pt {
  const u = 1 - t
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
  return {
    x: a * s.p0.x + b * s.p1.x + c * s.p2.x + d * s.p3.x,
    y: a * s.p0.y + b * s.p1.y + c * s.p2.y + d * s.p3.y,
  }
}

function pathSegments(path: SavedPath): Seg[] {
  const a = path.anchors
  const out: Seg[] = []
  for (let i = 1; i < a.length; i++) out.push(segBetween(a[i - 1], a[i]))
  if (path.closed && a.length >= 2) out.push(segBetween(a[a.length - 1], a[0]))
  return out
}

function distanceToPath(path: SavedPath, x: number, y: number): number {
  let best = Infinity
  for (const a of path.anchors) best = Math.min(best, Math.hypot(x - a.x, y - a.y))
  for (const s of pathSegments(path)) {
    for (let i = 0; i <= 24; i++) {
      const q = cubicAt(s, i / 24)
      best = Math.min(best, Math.hypot(x - q.x, y - q.y))
    }
  }
  return best
}

function hitPath(p: PointerInfo): SavedPath | null {
  const doc = engine.activeDoc
  if (!doc) return null
  const tol = 9 / Math.max(.02, doc.view.zoom)
  let hit: SavedPath | null = null
  let best = tol
  // reverse list so a later/topmost panel entry wins when paths overlap
  for (const path of [...(doc.savedPaths ?? [])].reverse()) {
    if (!path.visible || path.anchors.length < 2) continue
    const d = distanceToPath(path, p.docX, p.docY)
    if (d <= best) { best = d; hit = path }
  }
  return hit
}

function selectedPath(): SavedPath | null {
  return engine.activeDoc?.savedPaths?.find(p => p.id === selectedId) ?? null
}

function setPreview(dx: number, dy: number) {
  const doc = engine.activeDoc
  const path = selectedPath()
  if (!doc || !path || !drag) return
  path.anchors = drag.original.map(a => ({ ...a, x: a.x + dx, y: a.y + dy }))
  drag.dx = dx
  drag.dy = dy
  doc.dirty = true
  engine.pokeOverlay()
}

export const pathSelectTool: Tool = {
  id: 'path-select',
  cursor: 'default',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    const path = hitPath(p)
    selectedId = path?.id ?? null
    if (!path) {
      drag = null
      engine.pokeOverlay()
      return
    }
    drag = {
      startX: p.docX,
      startY: p.docY,
      original: path.anchors.map(a => ({ ...a })),
      dx: 0,
      dy: 0,
    }
    engine.pokeOverlay()
  },

  onPointerMove(p: PointerInfo) {
    const doc = engine.activeDoc
    const path = selectedPath()
    if (!doc || !path || !drag) return
    let dx = p.docX - drag.startX
    let dy = p.docY - drag.startY
    if (p.shift) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0
      else dx = 0
    }
    if (getOptions('path-select').snapGuides !== false && doc.guides?.length && drag.original.length) {
      const first = drag.original[0]
      const snapped = snapToGuides(doc, doc.view, first.x + dx, first.y + dy, 8)
      dx += snapped.x - (first.x + dx)
      dy += snapped.y - (first.y + dy)
    }
    setPreview(dx, dy)
  },

  onPointerUp() {
    if (!drag) return
    const moved = Math.abs(drag.dx) > .001 || Math.abs(drag.dy) > .001
    drag = null
    if (moved) {
      engine.pushHistory('Move Path')
      engine.emit()
    } else engine.pokeOverlay()
  },

  onKeyDown(e: KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault()
      engine.deleteSavedPath(selectedId)
      selectedId = null
      drag = null
      return true
    }
    if (e.key === 'Escape') {
      if (drag) {
        const path = selectedPath()
        if (path) path.anchors = drag.original.map(a => ({ ...a }))
        drag = null
        engine.pokeOverlay()
        return true
      }
      if (selectedId) {
        selectedId = null
        engine.pokeOverlay()
        return true
      }
    }
    return false
  },

  onDeactivate() {
    if (drag) {
      const moved = Math.abs(drag.dx) > .001 || Math.abs(drag.dy) > .001
      drag = null
      if (moved) { engine.pushHistory('Move Path'); engine.emit() }
    }
  },

  renderOverlay(ctx, view, w, h) {
    void w; void h
    const path = selectedPath()
    if (!path) return
    const a = path.anchors
    ctx.save()
    ctx.translate(view.panX, view.panY)
    ctx.scale(view.zoom, view.zoom)
    ctx.strokeStyle = '#ffffff'
    ctx.fillStyle = '#e8a33d'
    ctx.lineWidth = 1 / Math.max(.02, view.zoom)
    if (a.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(a[0].x, a[0].y)
      for (let i = 1; i < a.length; i++) {
        const p0 = a[i - 1], p1 = a[i]
        ctx.bezierCurveTo(p0.x + p0.outX, p0.y + p0.outY, p1.x + p1.inX, p1.y + p1.inY, p1.x, p1.y)
      }
      if (path.closed) {
        const p0 = a[a.length - 1], p1 = a[0]
        ctx.bezierCurveTo(p0.x + p0.outX, p0.y + p0.outY, p1.x + p1.inX, p1.y + p1.inY, p1.x, p1.y)
        ctx.closePath()
      }
      ctx.setLineDash([])
      ctx.stroke()
    }
    if (getOptions('path-select').showAnchors !== false) {
      const r = 3.5 / Math.max(.02, view.zoom)
      for (const p of a) {
        ctx.beginPath()
        ctx.rect(p.x - r, p.y - r, r * 2, r * 2)
        ctx.fill(); ctx.stroke()
      }
    }
    ctx.restore()
  },
}
