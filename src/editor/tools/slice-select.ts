// Photoshop-style Slice Select tool. It edits existing rectangular slices
// without creating new regions or touching hotspot annotations.
import type { PointerInfo, Tool } from '../types'
import { engine } from '../engine/engine'
import { normalizeWebRegions, type WebRegion } from '../web-assets'
import { moveRegionRect, rectChanged, regionPoint, type RegionRect } from './web-region-geometry'
import { drawCross } from './shared'

type Drag = {
  docId: string
  id: string
  mode: 'move' | 'resize'
  start: { x: number; y: number }
  original: RegionRect
  draft: RegionRect
}
let drag: Drag | null = null

function regions(): WebRegion[] {
  const doc = engine.activeDoc
  return doc ? normalizeWebRegions(doc.webRegions, doc.width, doc.height).filter(r => r.kind === 'slice') : []
}
function select(docId: string, id: string | null) {
  const doc = engine.docs.find(d => d.id === docId)
  if (!doc) return
  doc.activeWebRegionId = id
  engine.emit()
  engine.pokeOverlay()
}
function commit(d: Drag) {
  const doc = engine.activeDoc
  if (!doc || doc.id !== d.docId || !rectChanged(d.original, d.draft)) return
  const all = normalizeWebRegions(doc.webRegions, doc.width, doc.height)
  doc.webRegions = all.map(r => r.id === d.id && r.kind === 'slice' ? { ...r, ...d.draft } : r)
  engine.pushHistory(d.mode === 'move' ? 'Move Web Slice' : 'Resize Web Slice', doc)
  engine.emit()
  engine.pokeOverlay()
}
function activeId(): string | null {
  const doc = engine.activeDoc
  const id = doc?.activeWebRegionId
  return id && regions().some(r => r.id === id) ? id : null
}
function keydown(e: KeyboardEvent): boolean {
  const doc = engine.activeDoc, id = activeId()
  if (e.key === 'Escape') {
    if (drag) { drag = null; engine.pokeOverlay(); return true }
    if (doc && doc.activeWebRegionId) { select(doc.id, null); return true }
  }
  if (!doc || !id || e.ctrlKey || e.metaKey) return false
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const before = normalizeWebRegions(doc.webRegions, doc.width, doc.height)
    const next = before.filter(r => r.id !== id)
    if (next.length !== before.length) {
      doc.webRegions = next
      engine.pushHistory('Delete Web Slice', doc)
      select(doc.id, null)
      engine.emit()
    }
    return true
  }
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  }
  const step = delta[e.key]
  if (!step) return false
  const current = regions().find(r => r.id === id)
  if (!current) return false
  const moved = moveRegionRect(current, step[0] * (e.shiftKey ? 10 : 1), step[1] * (e.shiftKey ? 10 : 1), doc.width, doc.height)
  if (rectChanged(current, moved)) {
    doc.webRegions = normalizeWebRegions(doc.webRegions, doc.width, doc.height)
      .map(r => r.id === id ? { ...r, ...moved } : r)
    engine.pushHistory('Nudge Web Slice', doc)
    engine.emit()
    engine.pokeOverlay()
  }
  return true
}

export const sliceSelectTool: Tool = {
  id: 'slice-select',
  cursor: 'default',
  onPointerDown(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc || p.button !== 0) return
    const slices = regions()
    const hit = [...slices].reverse().find(r =>
      p.docX >= r.x && p.docX < r.x + r.width && p.docY >= r.y && p.docY < r.y + r.height)
    if (!hit) { drag = null; select(doc.id, null); return }
    select(doc.id, hit.id)
    const tolerance = Math.max(3, 9 / Math.max(.1, doc.view.zoom))
    const resize = Math.abs(p.docX - (hit.x + hit.width)) <= tolerance &&
      Math.abs(p.docY - (hit.y + hit.height)) <= tolerance
    const original = { x: hit.x, y: hit.y, width: hit.width, height: hit.height }
    drag = { docId: doc.id, id: hit.id, mode: resize ? 'resize' : 'move',
      start: regionPoint(p.docX, p.docY, doc.width, doc.height), original, draft: original }
  },
  onPointerMove(p: PointerInfo) {
    const d = drag, doc = engine.activeDoc
    if (!d || !doc || doc.id !== d.docId) return
    const point = regionPoint(p.docX, p.docY, doc.width, doc.height)
    if (d.mode === 'move') {
      d.draft = moveRegionRect(d.original, point.x - d.start.x, point.y - d.start.y, doc.width, doc.height)
    } else {
      d.draft = { ...d.original,
        width: Math.max(1, Math.min(doc.width - d.original.x, point.x - d.original.x + 1)),
        height: Math.max(1, Math.min(doc.height - d.original.y, point.y - d.original.y + 1)),
      }
    }
    engine.pokeOverlay()
  },
  onPointerUp() {
    if (!drag) return
    const current = drag
    drag = null
    commit(current)
  },
  onDeactivate() { drag = null; engine.pokeOverlay() },
  onKeyDown: keydown,
  renderOverlay(ctx, view, _w, _h, mouse) {
    const doc = engine.activeDoc
    if (!doc) return
    const selected = activeId()
    const showLabels = true
    ctx.save()
    ctx.font = '11px ui-sans-serif, sans-serif'
    for (const r of regions()) {
      const preview = drag?.docId === doc.id && drag.id === r.id ? drag.draft : r
      const x = preview.x * view.zoom + view.panX
      const y = preview.y * view.zoom + view.panY
      const w = preview.width * view.zoom, h = preview.height * view.zoom
      const active = r.id === selected
      ctx.strokeStyle = active ? '#facc15' : '#38bdf8'
      ctx.lineWidth = active ? 2 : 1
      ctx.setLineDash(active ? [] : [5, 3])
      ctx.strokeRect(x + .5, y + .5, w, h)
      ctx.setLineDash([])
      if (active) {
        ctx.fillStyle = '#facc15'
        ctx.fillRect(x + w - 4, y + h - 4, 8, 8)
      }
      if (showLabels) {
        const label = r.name || 'Slice'
        const tw = Math.min(180, ctx.measureText(label).width + 10)
        ctx.fillStyle = 'rgba(0,0,0,.78)'
        ctx.fillRect(x, y - 18, tw, 17)
        ctx.fillStyle = '#fff'
        ctx.fillText(label, x + 4, y - 6, tw - 6)
      }
    }
    ctx.restore()
    drawCross(ctx, mouse)
  },
}
