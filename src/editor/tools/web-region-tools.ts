// Fireworks-style Slice and Hotspot tools. Regions are document annotations,
// not pixel layers; both tools use the same source of truth as Web Assets export.
// Hotspots support rectangular, circular and polygon image-map shapes; slices stay rectangular.
import type { PointerInfo, Tool, ToolId } from '../types'
import { engine } from '../engine/engine'
import { useEditorStore } from '../store'
import { drawCross, getOptions } from './shared'
import { uid } from '../utils/canvas'
import {
  MAX_WEB_REGIONS, MAX_WEB_REGION_POINTS, circleMetrics, regionShape,
  normalizeWebRegions, type WebRegion, type WebRegionKind, type WebRegionShape,
} from '../web-assets'
import {
  findWebRegion, findRegionVertex, moveRegion, moveRegionRect, moveRegionVertex,
  rectChanged, regionBounds, regionChanged, regionFromDrag, regionPoint,
  resizeRegionRect, type RegionPoint, type RegionRect,
} from './web-region-geometry'

type DragState = {
  docId: string
  mode: 'create' | 'move' | 'resize' | 'vertex'
  kind: WebRegionKind
  shape: WebRegionShape
  id: string | null
  start: RegionPoint
  original: RegionRect | null
  draft: RegionRect | null
  draftRegion: WebRegion | null
  vertex: number
}

let drag: DragState | null = null
let selected: { docId: string; id: string } | null = null
let polyDraft: { docId: string; points: number[] } | null = null
let polyCursor: RegionPoint | null = null

function selectedId(): string | null {
  return selected && selected.docId === engine.activeDoc?.id ? selected.id : null
}
function setSelectedRegion(docId: string, id: string | null) {
  selected = id ? { docId, id } : null
  const doc = engine.docs.find(item => item.id === docId)
  if (doc) doc.activeWebRegionId = id
  // The canvas overlay redraw alone does not rerender the React inspector.
  engine.emit()
}
function currentRegions(): WebRegion[] {
  const doc = engine.activeDoc
  return doc ? normalizeWebRegions(doc.webRegions, doc.width, doc.height) : []
}
function writeRegions(next: WebRegion[], expectedDocId: string, historyLabel = 'Edit Web Region') {
  const doc = engine.activeDoc
  if (!doc || doc.id !== expectedDocId) return
  doc.webRegions = normalizeWebRegions(next, doc.width, doc.height)
  engine.pushHistory(historyLabel, doc)
  engine.emit()
  engine.pokeOverlay()
}
function remove(id: string) {
  const doc = engine.activeDoc
  if (!doc) return
  const before = currentRegions()
  if (!before.some(r => r.id === id)) return
  writeRegions(before.filter(r => r.id !== id), doc.id, 'Delete Web Region')
  if (selectedId() === id) setSelectedRegion(doc.id, null)
}
function atPointer(p: PointerInfo): RegionPoint | null {
  const doc = engine.activeDoc
  if (!doc) return null
  return regionPoint(p.docX, p.docY, doc.width, doc.height)
}
function drawShape(kind: WebRegionKind): WebRegionShape {
  // Slices are always rectangular; the Shape option applies to hotspots only.
  return kind === 'hotspot' ? (getOptions('hotspot').shape as WebRegionShape) || 'rect' : 'rect'
}
function finishPolygon(): boolean {
  const draft = polyDraft, doc = engine.activeDoc
  if (!draft || !doc || doc.id !== draft.docId) return false
  const points = draft.points
  const bounds = regionBounds(points)
  const regions = currentRegions()
  if (points.length >= 6 && bounds.width >= 3 && bounds.height >= 3) {
    if (regions.length >= MAX_WEB_REGIONS) {
      useEditorStore.getState().pushToast('Maximum ' + MAX_WEB_REGIONS + ' web regions', 'error')
    } else {
      const count = regions.filter(r => r.kind === 'hotspot').length + 1
      const id = uid()
      writeRegions([...regions, {
        id, kind: 'hotspot', shape: 'poly', points: points.slice(),
        name: 'Hotspot ' + count, ...bounds, href: '', alt: '', target: '_self',
      }], doc.id, 'Create Polygon Hotspot')
      setSelectedRegion(doc.id, id)
    }
  }
  polyDraft = null
  polyCursor = null
  engine.pokeOverlay()
  return true
}
function begin(p: PointerInfo, kind: WebRegionKind) {
  if (p.button !== 0) return
  const doc = engine.activeDoc, pos = atPointer(p)
  if (!doc || !pos) return
  const shape = drawShape(kind)
  const handleTol = Math.max(2, 9 / Math.max(.1, doc.view.zoom))
  if (shape === 'poly') {
    if (polyDraft && polyDraft.docId === doc.id) {
      const points = polyDraft.points
      const last = points.length - 2
      // A click on the first vertex closes the polygon.
      if (points.length >= 6 && Math.hypot(p.docX - points[0], p.docY - points[1]) <= handleTol) {
        finishPolygon()
        return
      }
      // Ignore accidental double-click duplicates at the same spot.
      if (Math.hypot(p.docX - points[last], p.docY - points[last + 1]) > 1) {
        if (points.length / 2 < MAX_WEB_REGION_POINTS) polyDraft.points.push(pos.x, pos.y)
      }
      polyCursor = pos
      engine.pokeOverlay()
      return
    }
    // No draft yet: selecting/editing an existing region still works.
    const hit = findWebRegion(currentRegions(), p.docX, p.docY)
    if (p.alt && hit) { remove(hit.id); return }
    if (hit) {
      setSelectedRegion(doc.id, hit.id)
      const vertex = regionShape(hit) === 'poly' ? findRegionVertex(hit, p.docX, p.docY, handleTol) : -1
      drag = {
        docId: doc.id, mode: vertex >= 0 ? 'vertex' : 'move', kind, shape: regionShape(hit),
        id: hit.id, start: pos,
        original: { x: hit.x, y: hit.y, width: hit.width, height: hit.height },
        draft: { x: hit.x, y: hit.y, width: hit.width, height: hit.height },
        draftRegion: hit, vertex,
      }
      engine.pokeOverlay()
      return
    }
    setSelectedRegion(doc.id, null)
    polyDraft = { docId: doc.id, points: [pos.x, pos.y] }
    polyCursor = pos
    engine.pokeOverlay()
    return
  }
  const regions = currentRegions()
  // Hit-testing works in document coordinates and tolerates zoom levels.
  const hit = findWebRegion(regions, p.docX, p.docY)
  if (p.alt && hit) { drag = null; remove(hit.id); return }
  const resize = hit && Math.hypot(p.docX - (hit.x + hit.width - 1), p.docY - (hit.y + hit.height - 1)) <= handleTol
  setSelectedRegion(doc.id, hit?.id ?? null)
  drag = {
    docId: doc.id, mode: hit ? (resize ? 'resize' : 'move') : 'create',
    kind, shape: hit ? regionShape(hit) : shape, id: hit?.id ?? null, start: pos,
    original: hit ? { x: hit.x, y: hit.y, width: hit.width, height: hit.height } : null,
    draft: hit ? { x: hit.x, y: hit.y, width: hit.width, height: hit.height } : null,
    draftRegion: hit, vertex: -1,
  }
  engine.pokeOverlay()
}
function update(p: PointerInfo) {
  const doc = engine.activeDoc, d = drag, pos = atPointer(p)
  if (polyDraft && (!d || d.mode === 'vertex')) { if (pos) polyCursor = pos; engine.pokeOverlay() }
  if (!doc || !d || !pos || doc.id !== d.docId) { drag = null; return }
  if (d.mode === 'create') d.draft = regionFromDrag(d.start, pos, doc.width, doc.height, d.shape === 'circle')
  else if (d.mode === 'vertex' && d.draftRegion) {
    d.draftRegion = moveRegionVertex(d.draftRegion, d.vertex, pos, doc.width, doc.height)
  } else if (d.original) d.draft = d.mode === 'move'
    ? moveRegionRect(d.original, pos.x - d.start.x, pos.y - d.start.y, doc.width, doc.height)
    : resizeRegionRect(d.original, pos, doc.width, doc.height, p.shift || d.shape === 'circle')
  engine.pokeOverlay()
}
function finish(p: PointerInfo) {
  const d = drag, doc = engine.activeDoc
  if (!d) return
  if (!doc || doc.id !== d.docId) { drag = null; return }
  if (d.mode === 'vertex') {
    update(p)
    drag = null
    const next = d.draftRegion
    if (next && d.id && next.points) {
      const regions = currentRegions()
      const original = regions.find(r => r.id === d.id)
      if (original && regionChanged(original, next)) {
        writeRegions(regions.map(r => r.id === d.id ? { ...r, points: next.points!.slice(), ...regionBounds(next.points!) } : r),
          doc.id, 'Reshape Web Region')
      }
    }
    engine.pokeOverlay()
    return
  }
  update(p)
  drag = null
  const draft = d.draft
  if (!draft) { engine.pokeOverlay(); return }
  const regions = currentRegions()
  if (d.mode === 'create') {
    // A click only selects a region. Avoid accidental 1×1 annotations.
    if (draft.width < 3 || draft.height < 3) { engine.pokeOverlay(); return }
    if (regions.length >= MAX_WEB_REGIONS) {
      useEditorStore.getState().pushToast('Maximum ' + MAX_WEB_REGIONS + ' web regions', 'error')
      return
    }
    const count = regions.filter(r => r.kind === d.kind).length + 1
    const id = uid()
    writeRegions([...regions, {
      id, kind: d.kind, ...(d.shape === 'circle' ? { shape: 'circle' as const } : {}),
      name: (d.kind === 'slice' ? 'Slice ' : 'Hotspot ') + count,
      ...draft, href: '', alt: '', target: '_self',
    }], doc.id, d.kind === 'slice' ? 'Create Web Slice'
      : d.shape === 'circle' ? 'Create Circle Hotspot' : 'Create Web Hotspot')
    setSelectedRegion(doc.id, id)
  } else if (d.mode === 'move' && d.id && d.draftRegion && regionShape(d.draftRegion) === 'poly') {
    const next = moveRegion(d.draftRegion, draft.x - d.original!.x, draft.y - d.original!.y, doc.width, doc.height)
    if (rectChanged(d.original!, draft)) {
      writeRegions(currentRegions().map(r => r.id === d.id ? { ...r, ...next, points: next.points!.slice() } : r),
        doc.id, 'Move Web Region')
    }
  } else if (d.original && d.id && rectChanged(d.original, draft)) {
    writeRegions(regions.map(r => r.id === d.id ? { ...r, ...draft } : r), doc.id,
      d.mode === 'move' ? 'Move Web Region' : 'Resize Web Region')
  }
  engine.pokeOverlay()
}
function keydown(e: KeyboardEvent): boolean {
  const doc = engine.activeDoc
  if (e.key === 'Escape') {
    if (drag) { drag = null; engine.pokeOverlay(); return true }
    if (polyDraft) { polyDraft = null; polyCursor = null; engine.pokeOverlay(); return true }
  }
  if (e.key === 'Enter' && polyDraft) { finishPolygon(); return true }
  const id = selectedId()
  if (!doc || !id || e.ctrlKey || e.metaKey) return false
  if (e.key === 'Escape') { setSelectedRegion(doc.id, null); engine.pokeOverlay(); return true }
  if (e.key === 'Delete' || e.key === 'Backspace') { remove(id); return true }
  if (e.key === 'Enter') { useEditorStore.getState().openDialog('web-assets', { regionId: id }); return true }
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  }
  const dir = delta[e.key]
  if (!dir) return false
  const regs = currentRegions(), r = regs.find(r => r.id === id)
  if (!r) return false
  const step = e.shiftKey ? 10 : 1
  const next = moveRegion(r, dir[0] * step, dir[1] * step, doc.width, doc.height)
  if (regionChanged(r, next)) writeRegions(regs.map(x => x.id === id ? { ...x, ...next, points: next.points?.slice() } : x), doc.id, 'Nudge Web Region')
  return true
}
function overlay(ctx: CanvasRenderingContext2D, view: { zoom: number; panX: number; panY: number },
  w: number, h: number, mouse: { x: number; y: number } | null, toolId: ToolId) {
  const doc = engine.activeDoc
  if (!doc) return
  const regions = currentRegions()
  const preview = drag?.docId === doc.id ? drag : null
  const selection = selectedId()
  const showLabels = getOptions(toolId).showLabels !== false
  ctx.save()
  ctx.font = '11px ui-sans-serif, sans-serif'
  for (const r of regions) {
    let candidate: WebRegion = r
    if (preview?.id === r.id) {
      if (preview.mode === 'vertex' && preview.draftRegion) candidate = preview.draftRegion
      else if (preview.draft) {
        if (regionShape(r) === 'poly' && r.points && preview.mode === 'move' && preview.original) {
          // Live whole-shape drag feedback: shift vertices with the bounding box.
          const sx = preview.draft.x - preview.original.x, sy = preview.draft.y - preview.original.y
          candidate = { ...r, ...preview.draft, points: r.points.map((n, i) => i % 2 === 0 ? n + sx : n + sy) }
        } else candidate = { ...r, ...preview.draft }
      }
    }
    drawRegion(ctx, candidate, view, candidate.id === selection, showLabels)
  }
  if (preview?.mode === 'create' && preview.draft) {
    drawRegion(ctx, { id: 'draft', ...preview.draft, kind: preview.kind,
      ...(preview.shape === 'circle' ? { shape: 'circle' as const } : {}),
      name: 'New ' + preview.kind }, view, true, false)
  }
  if (polyDraft && polyDraft.docId === doc.id) {
    drawPolyDraft(ctx, polyDraft.points, polyCursor, view)
  }
  ctx.restore()
  drawCross(ctx, mouse)
}
function drawRegion(ctx: CanvasRenderingContext2D, r: WebRegion,
  view: { zoom: number; panX: number; panY: number }, active: boolean, label: boolean) {
  const x = r.x * view.zoom + view.panX, y = r.y * view.zoom + view.panY
  const width = r.width * view.zoom, height = r.height * view.zoom
  const stroke = active ? '#facc15' : r.kind === 'slice' ? '#38bdf8' : '#34d399'
  ctx.strokeStyle = stroke
  ctx.lineWidth = active ? 2 : 1.3
  ctx.setLineDash(active ? [] : [5, 3])
  const shape = regionShape(r)
  if (shape === 'circle') {
    const c = circleMetrics(r)
    ctx.beginPath()
    ctx.arc(c.cx * view.zoom + view.panX, c.cy * view.zoom + view.panY, c.radius * view.zoom, 0, Math.PI * 2)
    ctx.stroke()
  } else if (shape === 'poly' && r.points && r.points.length >= 6) {
    ctx.beginPath()
    for (let i = 0; i + 1 < r.points.length; i += 2) {
      const px = r.points[i] * view.zoom + view.panX, py = r.points[i + 1] * view.zoom + view.panY
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.stroke()
    if (active) {
      ctx.fillStyle = stroke
      for (let i = 0; i + 1 < r.points.length; i += 2) {
        const px = r.points[i] * view.zoom + view.panX, py = r.points[i + 1] * view.zoom + view.panY
        ctx.fillRect(px - 3, py - 3, 6, 6)
      }
    }
  } else {
    ctx.strokeRect(x + .5, y + .5, width, height)
  }
  ctx.setLineDash([])
  if (active && shape !== 'poly') {
    ctx.fillStyle = stroke
    ctx.fillRect(x + width - 4, y + height - 4, 8, 8)
  }
  if (label) {
    const title = r.name || r.kind
    const size = Math.min(220, ctx.measureText(title).width + 10)
    ctx.fillStyle = 'rgba(0,0,0,.78)'
    ctx.fillRect(x, y - 19, size, 18)
    ctx.fillStyle = '#fff'
    ctx.fillText(title, x + 4, y - 6, size - 6)
  }
}
function drawPolyDraft(ctx: CanvasRenderingContext2D, points: number[], cursor: RegionPoint | null,
  view: { zoom: number; panX: number; panY: number }) {
  if (!points.length) return
  const px = (n: number) => n * view.zoom + view.panX
  ctx.strokeStyle = '#facc15'
  ctx.lineWidth = 1.6
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(px(points[0]), px(points[1]))
  for (let i = 2; i + 1 < points.length; i += 2) ctx.lineTo(px(points[i]), px(points[i + 1]))
  if (cursor) ctx.lineTo(px(cursor.x), px(cursor.y))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#facc15'
  for (let i = 0; i + 1 < points.length; i += 2) ctx.fillRect(px(points[i]) - 2.5, px(points[i + 1]) - 2.5, 5, 5)
  // Highlight the first vertex once the polygon can be closed.
  if (points.length >= 6) {
    ctx.beginPath()
    ctx.arc(px(points[0]), px(points[1]), 5, 0, Math.PI * 2)
    ctx.stroke()
  }
}
function tool(id: 'slice' | 'hotspot'): Tool {
  const kind: WebRegionKind = id === 'slice' ? 'slice' : 'hotspot'
  return {
    id, cursor: 'crosshair',
    onPointerDown: p => begin(p, kind),
    onPointerMove: update,
    onPointerUp: finish,
    onDeactivate() { drag = null; polyDraft = null; polyCursor = null; engine.pokeOverlay() },
    onKeyDown: keydown,
    onDoubleClick() {
      if (polyDraft) { finishPolygon(); return }
      if (engine.activeDoc) useEditorStore.getState().openDialog('web-assets', { regionId: selectedId() })
    },
    renderOverlay: (ctx, view, w, h, mouse) => overlay(ctx, view, w, h, mouse, id),
  }
}
export const sliceTool = tool('slice')
export const hotspotTool = tool('hotspot')
