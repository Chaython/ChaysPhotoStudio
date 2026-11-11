import type { Layer, PointerInfo, Tool } from '../types'
import { engine } from '../engine/engine'
import { newLayer } from '../engine/document'
import { createCanvas, ctx2d } from '../utils/canvas'
import { getOptions, drawCross } from './shared'

type FrameGeometry = NonNullable<Layer['frame']>
export type FrameRef = { docId: string; layerId: string; geometry: FrameGeometry }
type Drag = { layerId: string | null; kind: 'new' | 'move' | 'resize'; startX: number; startY: number; original?: FrameGeometry; draft: FrameGeometry }
let drag: Drag | null = null
let selectedFrameId: string | null = null
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const frameLayers = (doc = engine.activeDoc) => doc?.layers.filter(layer => !!layer.frame) ?? []
function frameContains(frame: FrameGeometry, x: number, y: number): boolean {
  if (x < frame.x || y < frame.y || x > frame.x + frame.width || y > frame.y + frame.height) return false
  if (frame.shape !== 'ellipse') return true
  const nx = (x - (frame.x + frame.width / 2)) / Math.max(1, frame.width / 2)
  const ny = (y - (frame.y + frame.height / 2)) / Math.max(1, frame.height / 2)
  return nx * nx + ny * ny <= 1
}
export function findImageFrameAtDocPoint(x: number, y: number): FrameRef | null {
  const doc = engine.activeDoc
  if (!doc) return null
  for (const layer of [...frameLayers(doc)].reverse()) {
    if (layer.frame && frameContains(layer.frame, x, y)) return { docId: doc.id, layerId: layer.id, geometry: structuredClone(layer.frame) }
  }
  return null
}
export function findImageFrameAtScreen(clientX: number, clientY: number): FrameRef | null {
  const doc = engine.activeDoc
  const host = (window as any).__zphotoViewport?.host as HTMLElement | undefined
  if (!doc || !host) return null
  const rect = host.getBoundingClientRect()
  const sx = clientX - rect.left, sy = clientY - rect.top
  const angle = -(Number(doc.view.rotation) || 0) * Math.PI / 180
  const cx = host.clientWidth / 2, cy = host.clientHeight / 2
  const dx = sx - cx, dy = sy - cy
  const x = (cx + dx * Math.cos(angle) - dy * Math.sin(angle) - doc.view.panX) / doc.view.zoom
  const y = (cy + dx * Math.sin(angle) + dy * Math.cos(angle) - doc.view.panY) / doc.view.zoom
  return findImageFrameAtDocPoint(x, y)
}
function makeFrameMask(docWidth: number, docHeight: number, frame: FrameGeometry): HTMLCanvasElement {
  const mask = createCanvas(docWidth, docHeight)
  const ctx = ctx2d(mask)
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  if (frame.shape === 'ellipse') ctx.ellipse(frame.x + frame.width / 2, frame.y + frame.height / 2, frame.width / 2, frame.height / 2, 0, 0, Math.PI * 2)
  else if (frame.shape === 'rounded-rect' && frame.radius) ctx.roundRect(frame.x, frame.y, frame.width, frame.height, Math.min(frame.radius, frame.width / 2, frame.height / 2))
  else ctx.rect(frame.x, frame.y, frame.width, frame.height)
  ctx.fill()
  return mask
}
function fitContentLayer(doc: NonNullable<typeof engine.activeDoc>, frame: Layer, geometry: FrameGeometry) {
  const content = geometry.contentLayerId ? doc.layers.find(layer => layer.id === geometry.contentLayerId) : null
  if (!content?.source) return
  const scale = Math.max(geometry.width / content.source.width, geometry.height / content.source.height)
  content.transform = { ...(content.transform ?? { x: 0, y: 0, scale: 1, rotation: 0 }),
    x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2, scale, rotation: 0 }
  content.mask = makeFrameMask(doc.width, doc.height, geometry)
  content.maskEnabled = true
  content._v++
  content._mv++
  void frame
}
function createFrameLayer(x: number, y: number, width: number, height: number) {
  const doc = engine.activeDoc
  if (!doc) return
  const opts = getOptions('frame')
  const shape = (['rect', 'ellipse', 'rounded-rect'].includes(opts.shape) ? opts.shape : 'rect') as FrameGeometry['shape']
  const radius = clamp(Number(opts.radius) || 0, 0, Math.min(width, height) / 2)
  const layer = newLayer('shape', `Frame ${frameLayers(doc).length + 1}`, doc.width, doc.height)
  layer.canvas = null
  layer.frame = { shape, x, y, width, height, radius }
  layer.shape = { shape: shape === 'rounded-rect' ? 'rounded-rect' : shape, x, y, w: width, h: height, radius,
    fill: '#273449', fillOpacity: 82, stroke: '#f59e0b', strokeWidth: 2, strokeOpacity: 100,
    lineCap: 'round', dash: 'dashed', sides: 5, starInset: 45 }
  doc.layers.push(layer)
  doc.activeLayerId = layer.id
  doc.selectedLayerIds = [layer.id]
  selectedFrameId = layer.id
  engine.pushHistory('Create Frame')
  engine.emit()
}
function drawFrameBounds(ctx: CanvasRenderingContext2D, frame: FrameGeometry, zoom: number, panX: number, panY: number, selected: boolean) {
  const x = panX + frame.x * zoom, y = panY + frame.y * zoom, w = frame.width * zoom, h = frame.height * zoom
  ctx.save()
  ctx.lineWidth = selected ? 2 : 1
  ctx.strokeStyle = selected ? '#fbbf24' : 'rgba(255,255,255,.8)'
  ctx.setLineDash(selected ? [] : [5, 4])
  ctx.beginPath()
  if (frame.shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  else if (frame.shape === 'rounded-rect' && frame.radius) ctx.roundRect(x, y, w, h, Math.min(frame.radius * zoom, w / 2, h / 2))
  else ctx.rect(x, y, w, h)
  ctx.stroke()
  ctx.setLineDash([])
  if (!frame.contentLayerId) {
    const size = Math.max(10, Math.min(24, Math.min(w, h) * .18))
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5
    ctx.strokeRect(x + w / 2 - size / 2, y + h / 2 - size / 2, size, size)
    ctx.beginPath()
    ctx.moveTo(x + w / 2 - size / 2, y + h / 2); ctx.lineTo(x + w / 2 + size / 2, y + h / 2)
    ctx.moveTo(x + w / 2, y + h / 2 - size / 2); ctx.lineTo(x + w / 2, y + h / 2 + size / 2)
    ctx.stroke()
  }
  if (selected) { ctx.fillStyle = '#fbbf24'; ctx.fillRect(x + w - 4, y + h - 4, 8, 8) }
  ctx.restore()
}
export const frameTool: Tool = {
  id: 'frame', cursor: 'crosshair',
  onPointerDown(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc || p.button !== 0) return
    const tolerance = 9 / Math.max(.05, doc.view.zoom)
    const hit = [...frameLayers(doc)].reverse().find(layer => layer.frame &&
      (frameContains(layer.frame, p.docX, p.docY) ||
       Math.hypot(p.docX - layer.frame.x - layer.frame.width, p.docY - layer.frame.y - layer.frame.height) <= tolerance))
    if (hit?.frame) {
      selectedFrameId = hit.id; doc.activeLayerId = hit.id; doc.selectedLayerIds = [hit.id]
      const f = hit.frame
      const resize = Math.hypot(p.docX - f.x - f.width, p.docY - f.y - f.height) <= tolerance
      drag = { layerId: hit.id, kind: resize ? 'resize' : 'move', startX: p.docX, startY: p.docY, original: structuredClone(f), draft: structuredClone(f) }
      engine.emitOverlay(); return
    }
    if (p.docX < 0 || p.docY < 0 || p.docX >= doc.width || p.docY >= doc.height) return
    drag = { layerId: null, kind: 'new', startX: p.docX, startY: p.docY, draft: { shape: 'rect', x: p.docX, y: p.docY, width: 1, height: 1 } }
    engine.pokeOverlay()
  },
  onPointerMove(p: PointerInfo) {
    const d = drag, doc = engine.activeDoc
    if (!d || !doc) return
    const dx = p.docX - d.startX, dy = p.docY - d.startY
    if (d.kind === 'new') {
      let w = dx, h = dy
      if (p.shift) { const side = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * side; h = Math.sign(h || 1) * side }
      const x = clamp(Math.min(d.startX, d.startX + w), 0, doc.width - 1)
      const y = clamp(Math.min(d.startY, d.startY + h), 0, doc.height - 1)
      d.draft = { ...d.draft, x, y, width: Math.max(1, Math.min(doc.width - x, Math.abs(w))), height: Math.max(1, Math.min(doc.height - y, Math.abs(h))) }
    } else if (d.kind === 'move' && d.original) d.draft = { ...d.original, x: clamp(d.original.x + dx, 0, doc.width - d.original.width), y: clamp(d.original.y + dy, 0, doc.height - d.original.height) }
    else if (d.original) {
      const width = clamp(d.original.width + dx, 2, doc.width - d.original.x)
      const height = p.shift ? Math.min(width, doc.height - d.original.y) : clamp(d.original.height + dy, 2, doc.height - d.original.y)
      d.draft = { ...d.original, width, height }
    }
    engine.pokeOverlay()
  },
  onPointerUp(p: PointerInfo) {
    const d = drag, doc = engine.activeDoc
    if (!d || !doc) return
    this.onPointerMove?.(p); drag = null
    if (d.kind === 'new') {
      if (d.draft.width < 8 || d.draft.height < 8) { engine.pokeOverlay(); return }
      createFrameLayer(Math.round(d.draft.x), Math.round(d.draft.y), Math.round(d.draft.width), Math.round(d.draft.height)); return
    }
    const layer = d.layerId ? doc.layers.find(item => item.id === d.layerId) : null
    if (!layer?.frame || !d.original || JSON.stringify(layer.frame) === JSON.stringify(d.draft)) { engine.pokeOverlay(); return }
    layer.frame = { ...d.draft }
    if (layer.shape) layer.shape = { ...layer.shape, x: d.draft.x, y: d.draft.y, w: d.draft.width, h: d.draft.height, radius: d.draft.radius ?? 0 }
    fitContentLayer(doc, layer, d.draft); layer._v++
    engine.pushHistory(d.kind === 'move' ? 'Move Frame' : 'Resize Frame')
    engine.emit()
  },
  onKeyDown(e: KeyboardEvent) {
    const doc = engine.activeDoc
    if (!doc) return false
    if (e.key === 'Escape') { drag = null; engine.pokeOverlay(); return true }
    const layer = selectedFrameId ? doc.layers.find(item => item.id === selectedFrameId) : null
    if (!layer?.frame) return false
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const contentId = layer.frame.contentLayerId
      doc.layers = doc.layers.filter(item => item.id !== layer.id && (!contentId || item.id !== contentId))
      doc.activeLayerId = doc.layers.at(-1)?.id ?? null; doc.selectedLayerIds = doc.activeLayerId ? [doc.activeLayerId] : []
      selectedFrameId = null; engine.pushHistory('Delete Frame'); engine.emit(); return true
    }
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] }
    const delta = dirs[e.key]
    if (!delta || e.ctrlKey || e.metaKey) return false
    const step = e.shiftKey ? 10 : 1
    const next = { ...layer.frame, x: clamp(layer.frame.x + delta[0] * step, 0, doc.width - layer.frame.width), y: clamp(layer.frame.y + delta[1] * step, 0, doc.height - layer.frame.height) }
    layer.frame = next
    if (layer.shape) layer.shape = { ...layer.shape, x: next.x, y: next.y }
    fitContentLayer(doc, layer, next); engine.pushHistory('Nudge Frame'); engine.emit(); return true
  },
  onDeactivate() { drag = null; engine.pokeOverlay() },
  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h
    const doc = engine.activeDoc
    if (!doc) { drawCross(ctx, mouse); return }
    for (const layer of frameLayers(doc)) if (layer.frame) drawFrameBounds(ctx, drag?.layerId === layer.id ? drag.draft : layer.frame, view.zoom, view.panX, view.panY, layer.id === selectedFrameId || layer.id === drag?.layerId)
    if (drag?.kind === 'new') drawFrameBounds(ctx, drag.draft, view.zoom, view.panX, view.panY, true)
    else if (!selectedFrameId) drawCross(ctx, mouse)
  },
}
