// Fireworks-style Slice and Hotspot tools. Regions are document annotations,
// not pixel layers; both tools use the same source of truth as Web Assets export.
import type { PointerInfo, Tool, ToolId } from '../types'
import { engine } from '../engine/engine'
import { useEditorStore } from '../store'
import { drawCross, getOptions } from './shared'
import { uid } from '../utils/canvas'
import { MAX_WEB_REGIONS, normalizeWebRegions, type WebRegion, type WebRegionKind } from '../web-assets'
import {
  findWebRegion, moveRegionRect, rectChanged, regionFromDrag,
  regionPoint, resizeRegionRect, type RegionPoint, type RegionRect,
} from './web-region-geometry'

type DragState = {
  docId: string
  mode: 'create' | 'move' | 'resize'
  kind: WebRegionKind
  id: string | null
  start: RegionPoint
  original: RegionRect | null
  draft: RegionRect | null
}

let drag: DragState | null = null
let selected: { docId: string; id: string } | null = null

function selectedId(): string | null {
  return selected && selected.docId === engine.activeDoc?.id ? selected.id : null
}
function currentRegions(): WebRegion[] {
  const doc = engine.activeDoc
  return doc ? normalizeWebRegions(doc.webRegions, doc.width, doc.height) : []
}
function writeRegions(next: WebRegion[], expectedDocId: string) {
  const doc = engine.activeDoc
  if (!doc || doc.id !== expectedDocId) return
  doc.webRegions = normalizeWebRegions(next, doc.width, doc.height)
  doc.dirty = true
  engine.emit()
  engine.pokeOverlay()
}
function remove(id: string) {
  const doc = engine.activeDoc
  if (!doc) return
  const before = currentRegions()
  if (!before.some(r => r.id === id)) return
  writeRegions(before.filter(r => r.id !== id), doc.id)
  if (selectedId() === id) selected = null
}
function atPointer(p: PointerInfo): RegionPoint | null {
  const doc = engine.activeDoc
  if (!doc) return null
  return regionPoint(p.docX, p.docY, doc.width, doc.height)
}
function begin(p: PointerInfo, kind: WebRegionKind) {
  if (p.button !== 0) return
  const doc = engine.activeDoc, pos = atPointer(p)
  if (!doc || !pos) return
  const regions = currentRegions()
  // Hit-testing works in document coordinates and tolerates zoom levels.
  const hit = findWebRegion(regions, p.docX, p.docY)
  if (p.alt && hit) { drag = null; remove(hit.id); return }
  const handleTol = Math.max(2, 9 / Math.max(.1, doc.view.zoom))
  const resize = hit && Math.hypot(p.docX - (hit.x + hit.width - 1), p.docY - (hit.y + hit.height - 1)) <= handleTol
  selected = hit ? { docId: doc.id, id: hit.id } : null
  drag = {
    docId: doc.id, mode: hit ? (resize ? 'resize' : 'move') : 'create',
    kind, id: hit?.id ?? null, start: pos,
    original: hit ? { x: hit.x, y: hit.y, width: hit.width, height: hit.height } : null,
    draft: hit ? { x: hit.x, y: hit.y, width: hit.width, height: hit.height } : null,
  }
  engine.pokeOverlay()
}
function update(p: PointerInfo) {
  const doc = engine.activeDoc, d = drag, pos = atPointer(p)
  if (!doc || !d || !pos || doc.id !== d.docId) { drag = null; return }
  if (d.mode === 'create') d.draft = regionFromDrag(d.start, pos, doc.width, doc.height, p.shift)
  else if (d.original) d.draft = d.mode === 'move'
    ? moveRegionRect(d.original, pos.x - d.start.x, pos.y - d.start.y, doc.width, doc.height)
    : resizeRegionRect(d.original, pos, doc.width, doc.height, p.shift)
  engine.pokeOverlay()
}
function finish(p: PointerInfo) {
  const d = drag, doc = engine.activeDoc
  if (!d) return
  if (!doc || doc.id !== d.docId) { drag = null; return }
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
      id, kind: d.kind, name: (d.kind === 'slice' ? 'Slice ' : 'Hotspot ') + count,
      ...draft, href: '', alt: '', target: '_self',
    }], doc.id)
    selected = { docId: doc.id, id }
  } else if (d.original && d.id && rectChanged(d.original, draft)) {
    writeRegions(regions.map(r => r.id === d.id ? { ...r, ...draft } : r), doc.id)
  }
  engine.pokeOverlay()
}
function keydown(e: KeyboardEvent): boolean {
  const doc = engine.activeDoc
  if (e.key === 'Escape' && drag) { drag = null; engine.pokeOverlay(); return true }
  const id = selectedId()
  if (!doc || !id || e.ctrlKey || e.metaKey) return false
  if (e.key === 'Escape') { selected = null; engine.pokeOverlay(); return true }
  if (e.key === 'Delete' || e.key === 'Backspace') { remove(id); return true }
  if (e.key === 'Enter') { useEditorStore.getState().openDialog('web-assets'); return true }
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  }
  const dir = delta[e.key]
  if (!dir) return false
  const regs = currentRegions(), r = regs.find(r => r.id === id)
  if (!r) return false
  const step = e.shiftKey ? 10 : 1
  const next = moveRegionRect(r, dir[0] * step, dir[1] * step, doc.width, doc.height)
  if (rectChanged(r, next)) writeRegions(regs.map(x => x.id === id ? { ...x, ...next } : x), doc.id)
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
    const candidate = preview?.id === r.id && preview?.draft ? { ...r, ...preview.draft } : r
    drawRegion(ctx, candidate, view, candidate.id === selection, showLabels)
  }
  if (preview?.mode === 'create' && preview.draft) {
    drawRegion(ctx, { ...preview.draft, kind: preview.kind, name: 'New ' + preview.kind },
      view, true, false)
  }
  ctx.restore()
  drawCross(ctx, mouse)
}
function drawRegion(ctx: CanvasRenderingContext2D, r: Pick<WebRegion, 'x' | 'y' | 'width' | 'height' | 'kind' | 'name'>,
  view: { zoom: number; panX: number; panY: number }, active: boolean, label: boolean) {
  const x = r.x * view.zoom + view.panX, y = r.y * view.zoom + view.panY
  const width = r.width * view.zoom, height = r.height * view.zoom
  const stroke = active ? '#facc15' : r.kind === 'slice' ? '#38bdf8' : '#34d399'
  ctx.strokeStyle = stroke
  ctx.lineWidth = active ? 2 : 1.3
  ctx.setLineDash(active ? [] : [5, 3])
  ctx.strokeRect(x + .5, y + .5, width, height)
  ctx.setLineDash([])
  if (active) {
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
function tool(id: 'slice' | 'hotspot'): Tool {
  const kind: WebRegionKind = id === 'slice' ? 'slice' : 'hotspot'
  return {
    id, cursor: 'crosshair',
    onPointerDown: p => begin(p, kind),
    onPointerMove: update,
    onPointerUp: finish,
    onDeactivate() { drag = null; engine.pokeOverlay() },
    onKeyDown: keydown,
    onDoubleClick() { if (engine.activeDoc) useEditorStore.getState().openDialog('web-assets') },
    renderOverlay: (ctx, view, w, h, mouse) => overlay(ctx, view, w, h, mouse, id),
  }
}
export const sliceTool = tool('slice')
export const hotspotTool = tool('hotspot')
