import type { Tool, PointerInfo, ViewportState, Rect, Layer } from '../types'
import { engine } from '../engine/engine'
import { buildLiveDrag } from '../engine/document'
import { newDrag, drawCross, pickLayerAt, getOptions } from './shared'
import { snapToGuides } from '../engine/guides'
import { useEditorStore } from '../store'
import { clamp } from '../utils/canvas'
import type { LiveLayerDrag } from '../types'
import { cloneVectorMask } from '../engine/vector-mask'

let drag = newDrag()
let live: LiveLayerDrag | null = null
/** layer ids moved by this drag (a clipstack base drags its children too) */
let movingIds: string[] = []
/** Full-composite live path for dragging a true multi-layer selection. */
let groupMove: { ids: string[]; lastDx: number; lastDy: number; startBounds: Rect } | null = null
let smartGuideX: number | null = null
let smartGuideY: number | null = null

function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  const x0 = Math.min(...rects.map(r => r.x))
  const y0 = Math.min(...rects.map(r => r.y))
  const x1 = Math.max(...rects.map(r => r.x + r.w))
  const y1 = Math.max(...rects.map(r => r.y + r.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function smartSnapRect(rect: Rect, dx: number, dy: number, moving: string[], zoom: number): { dx: number; dy: number } {
  const doc = engine.activeDoc
  if (!doc || getOptions('move').smartGuides === false) {
    smartGuideX = smartGuideY = null
    return { dx, dy }
  }
  const tol = 8 / Math.max(.02, zoom)
  const moved = { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h }
  const mx = [moved.x, moved.x + moved.w / 2, moved.x + moved.w]
  const my = [moved.y, moved.y + moved.h / 2, moved.y + moved.h]
  const xs: number[] = [0, doc.width / 2, doc.width]
  const ys: number[] = [0, doc.height / 2, doc.height]
  for (const l of doc.layers) {
    if (!l.visible || moving.includes(l.id) || l.kind === 'adjustment') continue
    const r = engine.layerContentRect(l.id)
    if (!r) continue
    xs.push(r.x, r.x + r.w / 2, r.x + r.w)
    ys.push(r.y, r.y + r.h / 2, r.y + r.h)
  }
  let bestX = Infinity, bestY = Infinity, snapX: number | null = null, snapY: number | null = null
  for (const a of mx) for (const b of xs) {
    const d = b - a
    if (Math.abs(d) <= tol && Math.abs(d) < Math.abs(bestX)) { bestX = d; snapX = b }
  }
  for (const a of my) for (const b of ys) {
    const d = b - a
    if (Math.abs(d) <= tol && Math.abs(d) < Math.abs(bestY)) { bestY = d; snapY = b }
  }
  if (snapX !== null) dx += bestX
  if (snapY !== null) dy += bestY
  smartGuideX = snapX
  smartGuideY = snapY
  return { dx, dy }
}

// ---------- on-canvas free-transform drag state ----------
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface TransformDrag {
  handle: HandleId
  /** pre-drag content rect in doc space */
  rect: Rect
  /** handle position in doc space at gesture start */
  hx: number
  hy: number
  /** doc-space anchor that stays FIXED (opposite corner/edge; Alt = center) */
  ax: number
  ay: number
  /** pointer doc position at gesture start (for rotation reference) */
  startPx: number
  startPy: number
  /** smart/text layers only scale uniformly (edge handles disabled) */
  uniformOnly: boolean
  /** dynamic per-move: pointer beyond the corner orbit → rotate */
  mode: 'scale' | 'rotate'
  /** live gesture map — exactly what compositeDocument renders */
  sx: number
  sy: number
  rotation: number
  /** rect center (doc) — rotation pivot + rotate-mode threshold reference */
  cx: number
  cy: number
}

let tdrag: TransformDrag | null = null

interface GroupTransformState {
  ids: string[]
  snapshots: Layer[]
  rect: Rect
}
let groupTransform: GroupTransformState | null = null

function snapshotTransformLayer(layer: Layer): Layer {
  return {
    ...layer,
    transform: layer.transform ? { ...layer.transform } : null,
    text: layer.text ? { ...layer.text } : null,
    shape: layer.shape ? {
      ...layer.shape,
      pathAnchors: layer.shape.pathAnchors?.map(a => ({ ...a })),
    } : null,
    smartFilters: layer.smartFilters.map(sf => ({ ...sf, params: { ...sf.params } })),
    vectorMask: cloneVectorMask(layer.vectorMask),
    fx: layer.fx ? { ...layer.fx } : null,
    // canvas/source/mask are intentionally retained by reference. Preview
    // transforms REPLACE them rather than mutating these source canvases.
    canvas: layer.canvas,
    source: layer.source,
    mask: layer.mask,
  }
}

function restoreTransformSnapshot(snapshot: Layer) {
  const layer = engine.layerById(snapshot.id)
  if (!layer) return
  const restored = snapshotTransformLayer(snapshot)
  Object.assign(layer, restored)
  ;(layer as any)._cache = null
  ;(layer as any)._cacheKey = ''
}

function selectedTransformIds(): string[] {
  const doc = engine.activeDoc
  if (!doc?.activeLayerId) return []
  const ids = (doc.selectedLayerIds ?? []).filter(id => {
    const l = engine.layerById(id)
    return !!l && !l.locked && l.kind !== 'adjustment'
  })
  return ids.length > 1 && ids.includes(doc.activeLayerId) ? ids : []
}

/** handle currently hovered (cursor management) */
let hoverHandle: HandleId | null = null
let lastCursorCss = ''

const HANDLE_CURSOR: Record<HandleId, string> = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
}

/** handle positions (doc space) for a rect — 8 for raster/shape,
 *  4 corners for smart/text (they only scale uniformly) */
function handlePoints(r: Rect, uniformOnly: boolean): { id: HandleId; x: number; y: number }[] {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const pts: { id: HandleId; x: number; y: number }[] = [
    { id: 'nw', x: r.x, y: r.y },
    { id: 'ne', x: r.x + r.w, y: r.y },
    { id: 'sw', x: r.x, y: r.y + r.h },
    { id: 'se', x: r.x + r.w, y: r.y + r.h },
  ]
  if (!uniformOnly) pts.push(
    { id: 'n', x: cx, y: r.y },
    { id: 's', x: cx, y: r.y + r.h },
    { id: 'w', x: r.x, y: cy },
    { id: 'e', x: r.x + r.w, y: cy },
  )
  return pts
}

/** which handle (if any) is under the pointer? screen-space hit radius */
function hitTestHandle(docX: number, docY: number, r: Rect, uniformOnly: boolean, zoom: number): HandleId | null {
  if (r.w < 1 || r.h < 1) return null
  const tol = Math.max(8 / Math.max(zoom, 0.02), 2)
  let best: HandleId | null = null
  let bestD = Infinity
  for (const p of handlePoints(r, uniformOnly)) {
    const d = Math.hypot(docX - p.x, docY - p.y)
    if (d <= tol && d < bestD) { best = p.id; bestD = d }
  }
  return best
}

/** active-layer transformability for handle drags */
function transformableLayerId(): string | null {
  const doc = engine.activeDoc
  if (!doc?.activeLayerId) return null
  const l = engine.layerById(doc.activeLayerId)
  if (!l || l.locked || l.kind === 'adjustment') return null
  return l.id
}

function setCursor(css: string) {
  if (css === lastCursorCss) return
  lastCursorCss = css
  const vp = (window as any).__zphotoViewport
  vp?.setCursorCss?.(css)
}

export const moveTool: Tool = {
  id: 'move',
  cursor: 'move',
  onPointerDown(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc) return

    // ---- on-canvas free-transform: selected group first ----
    const moveOpts = getOptions('move')
    const transformIds = selectedTransformIds()
    if (transformIds.length > 1 && !p.ctrl && moveOpts.showTransformControls !== false) {
      const groupRect = unionRects(transformIds.map(id => engine.layerContentRect(id)).filter((r): r is Rect => !!r))
      const uniformOnly = transformIds.some(id => {
        const l = engine.layerById(id)
        return l?.kind === 'smart' || l?.kind === 'text'
      })
      const h = groupRect ? hitTestHandle(p.docX, p.docY, groupRect, uniformOnly, doc.view.zoom) : null
      if (groupRect && h) {
        const pts = Object.fromEntries(handlePoints(groupRect, uniformOnly).map(pt => [pt.id, pt]))
        const hp = pts[h]!
        const center = { x: groupRect.x + groupRect.w / 2, y: groupRect.y + groupRect.h / 2 }
        let ax: number, ay: number
        if (p.alt) { ax = center.x; ay = center.y }
        else {
          const opp: HandleId = ({ nw: 'se', se: 'nw', ne: 'sw', sw: 'ne', n: 's', s: 'n', e: 'w', w: 'e' } as Record<HandleId, HandleId>)[h]
          const op = pts[opp] ?? center
          ax = op.x; ay = op.y
        }
        const snapshots = transformIds.map(id => engine.layerById(id)).filter((l): l is Layer => !!l).map(snapshotTransformLayer)
        if (snapshots.length === transformIds.length) {
          groupTransform = { ids: transformIds.slice(), snapshots, rect: groupRect }
          movingIds = transformIds.slice()
          tdrag = {
            handle: h, rect: groupRect, hx: hp.x, hy: hp.y, ax, ay,
            startPx: p.docX, startPy: p.docY,
            uniformOnly,
            mode: 'scale', sx: 1, sy: 1, rotation: 0,
            cx: center.x, cy: center.y,
          }
          live = null
          doc._liveDrag = null
          engine.requestRender()
          return
        }
      }
    }

    // ---- on-canvas free-transform: grab a handle of the active layer ----
    const target0 = transformableLayerId()
    if (target0 && !p.ctrl && moveOpts.showTransformControls !== false) {
      const r = engine.layerContentRect(target0)
      const layer0 = engine.layerById(target0)!
      const uniformOnly = layer0.kind === 'smart' || layer0.kind === 'text'
      const h = r ? hitTestHandle(p.docX, p.docY, r, uniformOnly, doc.view.zoom) : null
      if (r && h) {
        const pts = Object.fromEntries(handlePoints(r, uniformOnly).map(pt => [pt.id, pt]))
        const hp = pts[h]!
        // anchor: opposite corner/edge; Alt = scale from the center
        const center = { x: r.x + r.w / 2, y: r.y + r.h / 2 }
        let ax: number, ay: number
        if (p.alt) { ax = center.x; ay = center.y }
        else {
          const opp: HandleId = ({ nw: 'se', se: 'nw', ne: 'sw', sw: 'ne', n: 's', s: 'n', e: 'w', w: 'e' } as Record<HandleId, HandleId>)[h]
          const op = pts[opp] ?? { x: center.x, y: center.y }
          ax = op.x; ay = op.y
        }
        const ld = buildLiveDrag(doc, target0)
        if (ld) {
          ld.dx = 0; ld.dy = 0
          ld.liveTransform = { sx: 1, sy: 1, rotation: 0, ax, ay }
          doc._liveDrag = ld
          live = ld
          tdrag = {
            handle: h, rect: r, hx: hp.x, hy: hp.y, ax, ay,
            startPx: p.docX, startPy: p.docY,
            uniformOnly,
            mode: 'scale', sx: 1, sy: 1, rotation: 0,
            cx: center.x, cy: center.y,
          }
          // clip-stack extent (children transform with their base)
          const idx = doc.layers.findIndex(l => l.id === target0)
          const end = (function scan(): number {
            let j = idx + 1
            while (j < doc.layers.length && doc.layers[j].clipped) j++
            return j
          })()
          movingIds = doc.layers.slice(idx, end).map(l => l.id)
          engine.requestRender()
          return
        }
      }
    }

    // ---- regular move drag ----
    const opts = getOptions('move')
    let target = doc.activeLayerId
    if (opts.autoSelect !== false || p.ctrl) {
      const hit = pickLayerAt(p.docX, p.docY)
      if (hit) {
        target = hit
        const selected = doc.selectedLayerIds ?? []
        const alreadySelected = selected.includes(hit)
        doc.activeLayerId = hit
        // Clicking an unselected canvas layer should make it the sole selection.
        // Preserve an existing multi-selection when the grabbed layer is already
        // selected so any selected member can still drag the whole group.
        if (!alreadySelected || selected.length === 0) doc.selectedLayerIds = [hit]
        engine.emit()
      }
    }
    if (!target) return

    // Photoshop muscle memory: Alt/Option-drag duplicates the layer and moves
    // the duplicate, leaving the original in place. Handle drags already use
    // Alt for scale-from-center, so duplication only applies to body drags.
    if (p.alt) {
      const dup = engine.duplicateLayer(target)
      if (dup) target = dup.id
    }

    const layer = engine.layerById(target)
    if (!layer || layer.locked || layer.kind === 'adjustment') return

    // If the clicked/active layer is part of a multi-layer selection, drag the
    // whole selection together. The single-layer below/stack/above cache can't
    // represent arbitrary non-contiguous stacks, so groups use the exact full
    // composite while moving and commit one history entry on release.
    const selected = (doc.selectedLayerIds ?? []).filter(id => {
      const l = engine.layerById(id)
      return !!l && !l.locked && l.kind !== 'adjustment'
    })
    if (!p.alt && selected.length > 1 && selected.includes(target)) {
      movingIds = selected
      const startBounds = unionRects(selected.map(id => engine.layerContentRect(id)).filter((r): r is Rect => !!r))
      if (!startBounds) return
      groupMove = { ids: selected, lastDx: 0, lastDy: 0, startBounds }
      drag = { startX: p.docX, startY: p.docY, lastX: p.docX, lastY: p.docY, active: true }
      engine.requestRender()
      return
    }

    // build the cached below/stack/above split ONCE — per-frame composites are
    // then 3 drawImages instead of the full pipeline (60fps drag)
    const ld = buildLiveDrag(doc, target)
    if (!ld) return
    // clip-stack extent: a base drags its clipped children too
    const idx = doc.layers.findIndex(l => l.id === target)
    const end = idx < 0 ? idx : (function scan(): number {
      let j = idx + 1
      while (j < doc.layers.length && doc.layers[j].clipped) j++
      return j
    })()
    movingIds = doc.layers.slice(idx, end).map(l => l.id)
    doc._liveDrag = ld
    live = ld
    drag = { startX: p.docX, startY: p.docY, lastX: p.docX, lastY: p.docY, active: true }
    engine.requestRender()
  },

  onPointerMove(p: PointerInfo) {
    // ---- free-transform drag: update the live gesture map ----
    if (tdrag && (live || groupTransform)) {
      const doc = engine.activeDoc
      if (!doc) return
      const t = tdrag
      const px = p.docX, py = p.docY

      // corner drags switch to rotate when the pointer swings outside the
      // box AWAY from the diagonal (pulling straight outward still scales;
      // once rotating, it stays until the pointer re-enters the box)
      const isCorner = t.handle.length === 2
      if (isCorner) {
        const m = 10 / Math.max(doc.view.zoom, 0.02)
        const insideBox = px > t.rect.x - m && px < t.rect.x + t.rect.w + m
          && py > t.rect.y - m && py < t.rect.y + t.rect.h + m
        const a0 = Math.atan2(t.startPy - t.cy, t.startPx - t.cx)
        const a1 = Math.atan2(py - t.cy, px - t.cx)
        let adiff = a1 - a0
        while (adiff > Math.PI) adiff -= Math.PI * 2
        while (adiff < -Math.PI) adiff += Math.PI * 2
        if (t.mode === 'rotate') {
          if (insideBox) t.mode = 'scale'
        } else if (!insideBox && Math.abs(adiff) > 0.26) {
          t.mode = 'rotate'
        }
      }

      if (t.mode === 'rotate') {
        const a0 = Math.atan2(t.startPy - t.cy, t.startPx - t.cx)
        const a1 = Math.atan2(py - t.cy, px - t.cx)
        t.rotation = a1 - a0
        // scale stays 1 while rotating (pure rotation gesture)
        t.sx = 1; t.sy = 1
      } else if (t.handle.length === 2) {
        // corner scale — signed projection on the start diagonal (flip when
        // dragged through the anchor); Shift = free non-uniform (raster/shape)
        const free = p.shift && !t.uniformOnly
        if (free) {
          t.sx = (px - t.ax) / (t.hx - t.ax || 1)
          t.sy = (py - t.ay) / (t.hy - t.ay || 1)
        } else {
          const vx = t.hx - t.ax, vy = t.hy - t.ay
          const len2 = vx * vx + vy * vy || 1
          const s = ((px - t.ax) * vx + (py - t.ay) * vy) / len2
          t.sx = s; t.sy = s
        }
      } else if (t.handle === 'n' || t.handle === 's') {
        t.sy = (py - t.ay) / (t.hy - t.ay || 1)
        t.sx = 1
      } else {
        t.sx = (px - t.ax) / (t.hx - t.ax || 1)
        t.sy = 1
      }

      // clamp magnitude (sign preserved — flips are allowed)
      const cl = (v: number) => {
        const a = Math.abs(v)
        if (a < 0.02) return v < 0 ? -0.02 : 0.02
        if (a > 64) return v < 0 ? -64 : 64
        return v
      }
      t.sx = cl(t.sx); t.sy = cl(t.sy)
      // rotate pivots around the rect CENTER (Photoshop default); scale keeps
      // the opposite corner/edge fixed (Alt = center)
      const pax = t.mode === 'rotate' ? t.cx : t.ax
      const pay = t.mode === 'rotate' ? t.cy : t.ay
      if (groupTransform) {
        for (const snapshot of groupTransform.snapshots) restoreTransformSnapshot(snapshot)
        for (const id of groupTransform.ids) {
          engine.directTransformLayer(id, {
            sx: t.sx, sy: t.sy, rotation: t.rotation, ax: pax, ay: pay,
          }, { skipHistory: true, silent: true })
        }
      } else if (live) {
        live.liveTransform = { sx: t.sx, sy: t.sy, rotation: t.rotation, ax: pax, ay: pay }
      }
      engine.requestRender()
      return
    }

    if (drag.active && groupMove) {
      const doc = engine.activeDoc
      if (!doc) return
      let dx = Math.round(p.docX - drag.startX)
      let dy = Math.round(p.docY - drag.startY)
      if (p.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0
        else dx = 0
      }
      ;({ dx, dy } = smartSnapRect(groupMove.startBounds, dx, dy, groupMove.ids, doc.view.zoom))
      const prefs = useEditorStore.getState().view
      if (prefs.snapGuides && doc.guides?.length) {
        const s = snapToGuides(doc, doc.view, drag.startX + dx, drag.startY + dy, 8)
        dx = Math.round(s.x - drag.startX)
        dy = Math.round(s.y - drag.startY)
      }
      if (prefs.snapGrid && (prefs.gridSize ?? 0) > 0) {
        const gs = prefs.gridSize as number
        dx = Math.round(dx / gs) * gs
        dy = Math.round(dy / gs) * gs
      }
      const incX = dx - groupMove.lastDx
      const incY = dy - groupMove.lastDy
      if (incX || incY) {
        engine.translateLayersPreview(groupMove.ids, incX, incY)
        groupMove.lastDx = dx
        groupMove.lastDy = dy
      }
      return
    }

    if (!drag.active || !live) return
    const doc = engine.activeDoc
    if (!doc) return
    let dx = Math.round(p.docX - drag.startX)
    let dy = Math.round(p.docY - drag.startY)
    // Photoshop: Shift constrains a move to the dominant axis. Do this before
    // snapping so guides/grid still refine the constrained coordinate.
    if (p.shift) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0
      else dx = 0
    }
    // snapping: guides first (grab point), then the grid (layer content edge)
    const prefs = useEditorStore.getState().view
    const x = drag.startX + dx, y = drag.startY + dy
    let snappedX = false, snappedY = false
    if (prefs.snapGuides && doc.guides?.length) {
      const s = snapToGuides(doc, doc.view, x, y, 8)
      dx = Math.round(s.x - drag.startX)
      dy = Math.round(s.y - drag.startY)
      snappedX = s.snappedX; snappedY = s.snappedY
    }
    const movingRect = engine.layerContentRect(movingIds[0])
    if (movingRect) {
      const s = smartSnapRect(movingRect, dx, dy, movingIds, doc.view.zoom)
      dx = Math.round(s.dx); dy = Math.round(s.dy)
      if (smartGuideX !== null) snappedX = true
      if (smartGuideY !== null) snappedY = true
    }
    if (prefs.snapGrid && (prefs.gridSize ?? 0) > 0 && !snappedX && !snappedY) {
      const gs = prefs.gridSize as number
      const t = 8 / doc.view.zoom // 8 screen px → doc px
      const base = engine.layerById(movingIds[0])
      // the moving content's left/top edge in doc space (pre-drag position)
      let ex = 0, ey = 0
      if (base?.kind === 'raster') { ex = base.offsetX ?? 0; ey = base.offsetY ?? 0 }
      else if (base?.kind === 'smart' && base.transform && base.source) {
        ex = base.transform.x - (base.source.width * base.transform.scale) / 2
        ey = base.transform.y - (base.source.height * base.transform.scale) / 2
      } else if (base?.text) { ex = base.text.x; ey = base.text.y }
      else if (base?.shape) { ex = base.shape.x; ey = base.shape.y }
      const nx = Math.round((ex + dx) / gs) * gs
      const ny = Math.round((ey + dy) / gs) * gs
      if (Math.abs(ex + dx - nx) <= t) dx += nx - (ex + dx)
      if (Math.abs(ey + dy - ny) <= t) dy += ny - (ey + dy)
    }
    if (dx === live.dx && dy === live.dy) return // no change → no recomposite
    live.dx = dx
    live.dy = dy
    engine.requestRender()
  },

  onPointerUp(p: PointerInfo) {
    // ---- free-transform commit ----
    if (tdrag && (live || groupTransform)) {
      const doc = engine.activeDoc
      const t = tdrag
      const gt = groupTransform
      const moved = Math.abs(t.sx - 1) > 0.002 || Math.abs(t.sy - 1) > 0.002 || Math.abs(t.rotation) > 0.002
      if (doc) doc._liveDrag = null

      if (gt) {
        if (moved && doc) {
          // Preview already transformed every layer from its clean snapshot;
          // committing only records ONE history state.
          engine.pushHistory(gt.ids.length > 1 ? 'Free Transform Layers' : 'Free Transform')
          engine.emit()
        } else {
          for (const snapshot of gt.snapshots) restoreTransformSnapshot(snapshot)
          engine.requestRender()
        }
        groupTransform = null
        live = null
        tdrag = null
      } else {
        live = null
        tdrag = null
        if (moved && doc) {
          // base first (history entry), then any clipped children (coalesced —
          // they transform with their base under the same gesture map)
          const pax = t.mode === 'rotate' ? t.cx : t.ax
          const pay = t.mode === 'rotate' ? t.cy : t.ay
          for (let i = 0; i < movingIds.length; i++) {
            engine.directTransformLayer(movingIds[i], {
              sx: t.sx, sy: t.sy, rotation: t.rotation, ax: pax, ay: pay,
            }, { skipHistory: i > 0 })
          }
        } else {
          engine.requestRender()
        }
      }

      movingIds = []
      smartGuideX = smartGuideY = null
      return
    }

    if (drag.active && groupMove) {
      const moved = Math.hypot(groupMove.lastDx, groupMove.lastDy) > 0.5
      drag.active = false
      const ids = groupMove.ids
      groupMove = null
      movingIds = []
      smartGuideX = smartGuideY = null
      if (moved) {
        engine.pushHistory(ids.length > 1 ? 'Move Layers' : 'Move')
        engine.emit()
      } else engine.requestRender()
      return
    }

    if (!drag.active || !live) return
    const doc = engine.activeDoc
    // use the last APPLIED offset (guide/grid snapping included) — the raw
    // pointer-up position would silently undo the snap
    const dx = live.dx
    const dy = live.dy
    const moved = Math.hypot(dx, dy) > 0.5
    drag.active = false
    void p
    // clear the live-drag FIRST so the commit + final composite use the exact
    // full pipeline again
    if (doc) doc._liveDrag = null
    live = null
    if (moved && doc) {
      const base = engine.layerById(movingIds[0])
      if (base) {
        // COW commits: raster moves shift the canvas REGISTRATION (offset) —
        // pixels beyond the canvas edge survive, moving back restores them
        // (Photoshop behavior); smart/text/shape keep their own transform
        // fields. Primitive offset fields are safe to mutate in place: history
        // snapshots are shallow copies that captured the old values.
        if (base.kind === 'raster' && base.canvas) {
          base.offsetX = (base.offsetX ?? 0) + dx
          base.offsetY = (base.offsetY ?? 0) + dy
          base._v++
        } else if (base.kind === 'smart' && base.transform) {
          base.transform = { ...base.transform, x: base.transform.x + dx, y: base.transform.y + dy }
          base._v++
        } else if (base.kind === 'text' && base.text) {
          base.text = { ...base.text, x: base.text.x + dx, y: base.text.y + dy }
          base._v++
        } else if (base.kind === 'shape' && base.shape) {
          base.shape = { ...base.shape, x: base.shape.x + dx, y: base.shape.y + dy }
          base._v++
        }
        // clip-stack children move with their base (same COW rules)
        for (const id of movingIds.slice(1)) {
          const l = engine.layerById(id)
          if (!l || l.kind === 'adjustment') continue
          if (l.kind === 'raster' && l.canvas) {
            l.offsetX = (l.offsetX ?? 0) + dx
            l.offsetY = (l.offsetY ?? 0) + dy
            l._v++
          } else if (l.kind === 'smart' && l.transform) {
            l.transform = { ...l.transform, x: l.transform.x + dx, y: l.transform.y + dy }
            l._v++
          } else if (l.kind === 'text' && l.text) {
            l.text = { ...l.text, x: l.text.x + dx, y: l.text.y + dy }
            l._v++
          } else if (l.kind === 'shape' && l.shape) {
            l.shape = { ...l.shape, x: l.shape.x + dx, y: l.shape.y + dy }
            l._v++
          }
        }
        engine.pushHistory('Move')
        engine.emit()
      }
    } else {
      engine.requestRender()
    }
    movingIds = []
    smartGuideX = smartGuideY = null
  },

  onKeyDown(e: KeyboardEvent) {
    // Escape cancels an in-flight free-transform drag (preview only — the
    // layer was never touched)
    if (e.key === 'Escape' && groupMove) {
      if (groupMove.lastDx || groupMove.lastDy) {
        engine.translateLayersPreview(groupMove.ids, -groupMove.lastDx, -groupMove.lastDy)
      }
      drag.active = false
      groupMove = null
      movingIds = []
      smartGuideX = smartGuideY = null
      engine.requestRender()
      return true
    }
    if (e.key === 'Escape' && tdrag) {
      const doc = engine.activeDoc
      if (groupTransform) {
        for (const snapshot of groupTransform.snapshots) restoreTransformSnapshot(snapshot)
        groupTransform = null
      }
      if (doc) doc._liveDrag = null
      live = null
      tdrag = null
      movingIds = []
      smartGuideX = smartGuideY = null
      engine.requestRender()
      return true
    }
    return false
  },

  renderOverlay(ctx, view, w, h, mouse) {
    drawCross(ctx, mouse)
    drawLayerHighlight(ctx, view, w, h, mouse)
    if (smartGuideX !== null || smartGuideY !== null) {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,55,180,.95)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      if (smartGuideX !== null) {
        const sx = view.panX + smartGuideX * view.zoom
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke()
      }
      if (smartGuideY !== null) {
        const sy = view.panY + smartGuideY * view.zoom
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke()
      }
      ctx.restore()
    }
  },

  onDeactivate() {
    smartGuideX = smartGuideY = null
  },
}

/** Active-layer bounds highlight (the move-tool "transform box"): frame +
 *  handles drawn in SCREEN space, deliberately NOT clipped to the document
 *  rect — the layer stays visible even while it hangs off-canvas or is moved
 *  fully outside it (pixels survive off-canvas since Task 11, so this is how
 *  you keep track of where they went). The name + X/Y/W/H badge is clamped
 *  into the viewport, so a completely off-screen layer remains findable.
 *  Live-drag aware: while dragging, the frame tracks the cached live offset.
 *  Free-transform aware: while transforming, the box maps through the live
 *  gesture transform (rotation-aware polygon + live scale/angle readout). */
function drawLayerHighlight(
  ctx: CanvasRenderingContext2D, view: ViewportState, w: number, h: number,
  mouse: { x: number; y: number } | null
) {
  const doc = engine.activeDoc
  if (!doc) return
  const targetId = live?.layerId ?? doc.activeLayerId
  if (!targetId) return
  const layer = engine.layerById(targetId)
  if (!layer || layer.kind === 'adjustment') return
  const groupIds = groupTransform?.ids ?? selectedTransformIds()
  const isGroup = groupIds.length > 1
  const r = groupTransform?.rect ?? (isGroup
    ? unionRects(groupIds.map(id => engine.layerContentRect(id)).filter((v): v is Rect => !!v))
    : engine.layerContentRect(targetId))
  if (!r || r.w <= 0 || r.h <= 0) return
  const dx = live && !tdrag ? live.dx : 0, dy = live && !tdrag ? live.dy : 0
  const dim = isGroup ? 1 : (layer.visible ? 1 : 0.45) // hidden layer: dimmed ghost frame

  // ---- map the box corners through the live gesture (scale/rotate/offset) ----
  const corners: [number, number][] = [
    [r.x + dx, r.y + dy],
    [r.x + r.w + dx, r.y + dy],
    [r.x + r.w + dx, r.y + r.h + dy],
    [r.x + dx, r.y + r.h + dy],
  ]
  const lt = tdrag
    ? (live?.liveTransform ?? {
        sx: tdrag.sx,
        sy: tdrag.sy,
        rotation: tdrag.rotation,
        ax: tdrag.mode === 'rotate' ? tdrag.cx : tdrag.ax,
        ay: tdrag.mode === 'rotate' ? tdrag.cy : tdrag.ay,
      })
    : null
  let mapped: [number, number][]
  if (lt) {
    const cos = Math.cos(lt.rotation), sin = Math.sin(lt.rotation)
    mapped = corners.map(([px, py]) => {
      const ux = px - lt.ax, uy = py - lt.ay
      return [lt.ax + ux * lt.sx * cos - uy * lt.sy * sin, lt.ay + ux * lt.sx * sin + uy * lt.sy * cos]
    })
  } else {
    mapped = corners
  }
  // doc → screen
  const scr = mapped.map(([px, py]) => [view.panX + px * view.zoom, view.panY + py * view.zoom] as [number, number])
  const sx0 = Math.min(...scr.map(p => p[0])), sy0 = Math.min(...scr.map(p => p[1]))
  const sx1 = Math.max(...scr.map(p => p[0])), sy1 = Math.max(...scr.map(p => p[1]))

  ctx.save()
  // frame: dark halo + amber line (readable on any background). While a
  // transform gesture is live, the box follows the rotation exactly.
  ctx.lineWidth = 3
  ctx.strokeStyle = `rgba(0,0,0,${(0.55 * dim).toFixed(3)})`
  ctx.beginPath()
  ctx.moveTo(scr[0][0], scr[0][1])
  for (let i = 1; i < 4; i++) ctx.lineTo(scr[i][0], scr[i][1])
  ctx.closePath()
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.strokeStyle = `rgba(232,163,61,${(0.95 * dim).toFixed(3)})`
  ctx.beginPath()
  ctx.moveTo(scr[0][0] - 0.5, scr[0][1] - 0.5)
  for (let i = 1; i < 4; i++) ctx.lineTo(scr[i][0] - 0.5, scr[i][1] - 0.5)
  ctx.closePath()
  ctx.stroke()

  // ---- transform handles at the MAPPED corners (and mid-edges when idle) ----
  const uniformOnly = isGroup
    ? groupIds.some(id => {
        const l = engine.layerById(id)
        return l?.kind === 'smart' || l?.kind === 'text'
      })
    : layer.kind === 'smart' || layer.kind === 'text'
  const idleBox = { x: sx0, y: sy0, w: sx1 - sx0, h: sy1 - sy0 }
  const sw = idleBox.w, sh = idleBox.h
  const canTransform = (isGroup
    ? groupIds.every(id => {
        const l = engine.layerById(id)
        return !!l && !l.locked && l.kind !== 'adjustment'
      })
    : !layer.locked) && getOptions('move').showTransformControls !== false
  let handleScr: { id: HandleId; x: number; y: number }[] = []
  if (canTransform && sw >= 10 && sh >= 10) {
    const mid = sw >= 22 && sh >= 22
    handleScr = [
      { id: 'nw', x: scr[0][0], y: scr[0][1] },
      { id: 'ne', x: scr[1][0], y: scr[1][1] },
      { id: 'se', x: scr[2][0], y: scr[2][1] },
      { id: 'sw', x: scr[3][0], y: scr[3][1] },
    ]
    if (mid && !uniformOnly && !tdrag) {
      handleScr.push(
        { id: 'n', x: (scr[0][0] + scr[1][0]) / 2, y: (scr[0][1] + scr[1][1]) / 2 },
        { id: 'e', x: (scr[1][0] + scr[2][0]) / 2, y: (scr[1][1] + scr[2][1]) / 2 },
        { id: 's', x: (scr[2][0] + scr[3][0]) / 2, y: (scr[2][1] + scr[3][1]) / 2 },
        { id: 'w', x: (scr[3][0] + scr[0][0]) / 2, y: (scr[3][1] + scr[0][1]) / 2 },
      )
    }
    for (const p of handleScr) {
      const active = tdrag?.handle === p.id || hoverHandle === p.id
      ctx.fillStyle = active ? 'rgba(232,163,61,0.98)' : `rgba(255,255,255,${(0.95 * dim).toFixed(3)})`
      ctx.strokeStyle = `rgba(15,15,17,${(0.9 * dim).toFixed(3)})`
      ctx.lineWidth = 1
      const s = active ? 9 : 7
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s)
      ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s)
    }
  }

  // ---- measurement badge ----
  // live transform: readout shows the live scale/angle; otherwise X/Y/W×H
  let text: string
  const flags = [layer.locked ? 'locked' : '', layer.visible ? '' : 'hidden'].filter(Boolean).join(', ')
  const subject = isGroup ? `${groupIds.length} layers` : `${layer.name}${flags ? ` (${flags})` : ''}`
  if (tdrag && lt) {
    const pct = Math.round(Math.abs((lt.sx + lt.sy) / 2) * 100)
    const deg = Math.round((lt.rotation * 180) / Math.PI)
    text = `${subject}  ·  ${pct}%${deg ? ` · ${deg}°` : ''}  ·  ${Math.round(r.w * Math.abs(lt.sx))}×${Math.round(r.h * Math.abs(lt.sy))}`
  } else {
    text = `${subject}  ·  X ${Math.round(r.x + dx)}  Y ${Math.round(r.y + dy)}  ·  ${Math.round(r.w)}×${Math.round(r.h)}`
  }
  ctx.font = '10px ui-monospace, SFMono-Regular, monospace'
  const tw = ctx.measureText(text).width
  const bx = clamp(sx0, 6, Math.max(6, w - tw - 16))
  const by = clamp(sy0 - 24, 6, Math.max(6, h - 23))
  ctx.fillStyle = 'rgba(15,15,17,0.88)'
  ctx.strokeStyle = `rgba(232,163,61,${(0.55 * dim).toFixed(3)})`
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(bx, by, tw + 10, 17, 3)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#f4c47c'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, bx + 5, by + 8.5)
  ctx.restore()

  // ---- hover cursor management (resize cursors over handles) ----
  if (!tdrag && !drag.active && canTransform && mouse) {
    const docX = (mouse.x - view.panX) / view.zoom
    const docY = (mouse.y - view.panY) / view.zoom
    // hover test against the live rect (with any drag offset applied)
    const rect = { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }
    hoverHandle = hitTestHandle(docX, docY, rect, uniformOnly, view.zoom)
    setCursor(hoverHandle ? HANDLE_CURSOR[hoverHandle] : 'move')
  } else if (tdrag) {
    setCursor(tdrag.mode === 'rotate' ? 'crosshair' : HANDLE_CURSOR[tdrag.handle])
  } else {
    hoverHandle = null
    setCursor('move')
  }
}
