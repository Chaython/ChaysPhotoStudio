// ============================================================
// Direct Selection Tool — edit anchors and Bezier handles on saved paths.
// ============================================================
import type { Tool, PointerInfo, PathAnchor, SavedPath } from '../types'
import { engine } from '../engine/engine'
import { getOptions } from './shared'

type Pt = { x: number; y: number }
type Drag =
  | { kind: 'anchor'; index: number; original: PathAnchor[]; startX: number; startY: number }
  | { kind: 'handle'; index: number; which: 'in' | 'out'; original: PathAnchor[] }

let selectedId: string | null = null
let activeAnchor = -1
let drag: Drag | null = null
const HIT_PX = 8

function selectedPath(): SavedPath | null {
  return engine.activeDoc?.savedPaths?.find(p => p.id === selectedId) ?? null
}

function pointAt(a: PathAnchor, which: 'in' | 'out'): Pt {
  return which === 'in'
    ? { x: a.x + a.inX, y: a.y + a.inY }
    : { x: a.x + a.outX, y: a.y + a.outY }
}

function constrain45(dx: number, dy: number): Pt {
  const len = Math.hypot(dx, dy)
  if (len < .001) return { x: dx, y: dy }
  const step = Math.PI / 4
  const a = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: Math.cos(a) * len, y: Math.sin(a) * len }
}

function hitAnchor(path: SavedPath, p: PointerInfo): number {
  const z = engine.activeDoc?.view.zoom ?? 1
  let hit = -1, best = HIT_PX
  for (let i = 0; i < path.anchors.length; i++) {
    const a = path.anchors[i]
    const d = Math.hypot(p.docX - a.x, p.docY - a.y) * z
    if (d <= best) { best = d; hit = i }
  }
  return hit
}

function hitHandle(path: SavedPath, p: PointerInfo): { index: number; which: 'in' | 'out' } | null {
  if (activeAnchor < 0 || activeAnchor >= path.anchors.length) return null
  const z = engine.activeDoc?.view.zoom ?? 1
  const a = path.anchors[activeAnchor]
  let best = HIT_PX
  let hit: { index: number; which: 'in' | 'out' } | null = null
  for (const which of ['in', 'out'] as const) {
    const h = pointAt(a, which)
    if (h.x === a.x && h.y === a.y) continue
    const d = Math.hypot(p.docX - h.x, p.docY - h.y) * z
    if (d <= best) { best = d; hit = { index: activeAnchor, which } }
  }
  return hit
}

function cubic(a: PathAnchor, b: PathAnchor, t: number): Pt {
  const p0 = { x: a.x, y: a.y }
  const p1 = { x: a.x + a.outX, y: a.y + a.outY }
  const p2 = { x: b.x + b.inX, y: b.y + b.inY }
  const p3 = { x: b.x, y: b.y }
  const u = 1 - t
  return {
    x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
    y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
  }
}

function distanceToPath(path: SavedPath, x: number, y: number): number {
  let best = Infinity
  const a = path.anchors
  for (let i = 1; i < a.length; i++) {
    for (let k = 0; k <= 24; k++) {
      const q = cubic(a[i - 1], a[i], k / 24)
      best = Math.min(best, Math.hypot(x - q.x, y - q.y))
    }
  }
  if (path.closed && a.length >= 2) {
    for (let k = 0; k <= 24; k++) {
      const q = cubic(a[a.length - 1], a[0], k / 24)
      best = Math.min(best, Math.hypot(x - q.x, y - q.y))
    }
  }
  return best
}

function hitPath(p: PointerInfo): SavedPath | null {
  const doc = engine.activeDoc
  if (!doc) return null
  const tol = HIT_PX / Math.max(.02, doc.view.zoom)
  let hit: SavedPath | null = null, best = tol
  for (const path of [...(doc.savedPaths ?? [])].reverse()) {
    if (!path.visible || path.anchors.length < 2) continue
    const d = distanceToPath(path, p.docX, p.docY)
    if (d <= best) { best = d; hit = path }
  }
  return hit
}

function commit(label: string) {
  drag = null
  engine.pushHistory(label)
  engine.emit()
}

export const directSelectTool: Tool = {
  id: 'direct-select',
  cursor: 'default',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    let path = selectedPath()
    if (path) {
      const hh = hitHandle(path, p)
      if (hh) {
        drag = { kind: 'handle', index: hh.index, which: hh.which, original: path.anchors.map(a => ({ ...a })) }
        return
      }
      const ai = hitAnchor(path, p)
      if (ai >= 0) {
        activeAnchor = ai
        drag = {
          kind: 'anchor', index: ai,
          original: path.anchors.map(a => ({ ...a })),
          startX: p.docX, startY: p.docY,
        }
        engine.pokeOverlay()
        return
      }
    }

    path = hitPath(p)
    selectedId = path?.id ?? null
    activeAnchor = path ? hitAnchor(path, p) : -1
    drag = null
    engine.pokeOverlay()
  },

  onPointerMove(p: PointerInfo) {
    const path = selectedPath()
    if (!path || !drag) return
    const a = path.anchors[drag.index]
    const orig = drag.original[drag.index]
    if (!a || !orig) return

    if (drag.kind === 'anchor') {
      let dx = p.docX - drag.startX
      let dy = p.docY - drag.startY
      if (p.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0
        else dx = 0
      }
      path.anchors[drag.index] = { ...orig, x: orig.x + dx, y: orig.y + dy }
    } else {
      let dx = p.docX - a.x, dy = p.docY - a.y
      if (p.shift) { const q = constrain45(dx, dy); dx = q.x; dy = q.y }
      const next = { ...a }
      if (p.alt) next.pair = false
      if (drag.which === 'in') {
        next.inX = dx; next.inY = dy
        if (next.pair) { next.outX = -dx; next.outY = -dy }
      } else {
        next.outX = dx; next.outY = dy
        if (next.pair) { next.inX = -dx; next.inY = -dy }
      }
      path.anchors[drag.index] = next
    }
    engine.activeDoc!.dirty = true
    engine.pokeOverlay()
  },

  onPointerUp() {
    if (!drag) return
    const path = selectedPath()
    if (!path) { drag = null; return }
    const before = JSON.stringify(drag.original)
    const after = JSON.stringify(path.anchors)
    if (before !== after) commit(drag.kind === 'anchor' ? 'Move Path Anchor' : 'Edit Path Handle')
    else { drag = null; engine.pokeOverlay() }
  },

  onKeyDown(e: KeyboardEvent) {
    const path = selectedPath()
    if ((e.key === 'Delete' || e.key === 'Backspace') && path && activeAnchor >= 0) {
      e.preventDefault()
      if (path.anchors.length <= 2) {
        engine.deleteSavedPath(path.id)
        selectedId = null
        activeAnchor = -1
      } else {
        path.anchors.splice(activeAnchor, 1)
        activeAnchor = Math.min(activeAnchor, path.anchors.length - 1)
        engine.pushHistory('Delete Path Anchor')
        engine.emit()
      }
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
        activeAnchor = -1
        engine.pokeOverlay()
        return true
      }
    }
    return false
  },

  onDeactivate() {
    if (drag) {
      const path = selectedPath()
      const changed = path && JSON.stringify(path.anchors) !== JSON.stringify(drag.original)
      if (changed) commit(drag.kind === 'anchor' ? 'Move Path Anchor' : 'Edit Path Handle')
      else drag = null
    }
  },

  renderOverlay(ctx, view, w, h) {
    void w; void h
    const path = selectedPath()
    if (!path) return
    const z = Math.max(.02, view.zoom)
    ctx.save()
    ctx.translate(view.panX, view.panY)
    ctx.scale(z, z)

    const a = path.anchors
    ctx.lineWidth = 1 / z
    ctx.strokeStyle = '#fff'
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
      ctx.stroke()
    }

    const rr = 4 / z
    for (let i = 0; i < a.length; i++) {
      const p = a[i]
      ctx.fillStyle = i === activeAnchor ? '#fff' : '#e8a33d'
      ctx.strokeStyle = 'rgba(0,0,0,.75)'
      ctx.fillRect(p.x - rr, p.y - rr, rr * 2, rr * 2)
      ctx.strokeRect(p.x - rr, p.y - rr, rr * 2, rr * 2)
    }

    if (getOptions('direct-select').showHandles !== false && activeAnchor >= 0 && activeAnchor < a.length) {
      const p = a[activeAnchor]
      for (const which of ['in', 'out'] as const) {
        const hp = pointAt(p, which)
        if (hp.x === p.x && hp.y === p.y) continue
        ctx.strokeStyle = 'rgba(255,255,255,.6)'
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(hp.x, hp.y); ctx.stroke()
        ctx.fillStyle = '#e8a33d'
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 4 / z, 0, Math.PI * 2); ctx.fill()
      }
    }
    ctx.restore()
  },
}
