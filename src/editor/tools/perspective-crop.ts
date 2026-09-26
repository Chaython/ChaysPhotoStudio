// Photoshop-style Perspective Crop tool.
// Draw a four-corner crop, adjust each corner independently, move the entire
// quad, then projectively rectify it into a rectangular document.
import type { Tool, PointerInfo } from '../types'
import { engine } from '../engine/engine'
import { getOptions, drawCross } from './shared'
import { useEditorStore } from '../store'
import { snapToGuides } from '../engine/guides'
import { quadOutputSize, type Point2 } from '../image-ops/perspective'

type Corner = 0 | 1 | 2 | 3
type DragState =
  | { mode: 'new'; start: Point2 }
  | { mode: 'corner'; corner: Corner }
  | { mode: 'move'; start: Point2; original: Point2[] }
  | null

let quad: Point2[] | null = null
let drag: DragState = null

function snap(x: number, y: number): Point2 {
  const doc = engine.activeDoc
  if (!doc) return { x, y }
  const prefs = useEditorStore.getState().view
  if (!prefs.snapGuides || !doc.guides?.length) return { x, y }
  const p = snapToGuides(doc, doc.view, x, y, 8)
  return { x: p.x, y: p.y }
}

function hitCorner(p: PointerInfo): Corner | null {
  const doc = engine.activeDoc
  if (!doc || !quad) return null
  const tol = 10 / Math.max(.02, doc.view.zoom)
  for (let i = 0; i < 4; i++) {
    if (Math.hypot(p.docX - quad[i].x, p.docY - quad[i].y) <= tol) return i as Corner
  }
  return null
}

function pointInQuad(x: number, y: number): boolean {
  if (!quad) return false
  let inside = false
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = quad[i], b = quad[j]
    if (((a.y > y) !== (b.y > y)) && x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-12) + a.x) inside = !inside
  }
  return inside
}

function bilerp(q: Point2[], u: number, v: number): Point2 {
  const top = { x: q[0].x + (q[1].x - q[0].x) * u, y: q[0].y + (q[1].y - q[0].y) * u }
  const bot = { x: q[3].x + (q[2].x - q[3].x) * u, y: q[3].y + (q[2].y - q[3].y) * u }
  return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v }
}

function quadArea(q: Point2[]): number {
  let a = 0
  for (let i = 0; i < 4; i++) {
    const p = q[i], n = q[(i + 1) % 4]
    a += p.x * n.y - n.x * p.y
  }
  return Math.abs(a) / 2
}

function validQuad(q: Point2[] | null): q is Point2[] {
  if (!q || q.length !== 4 || quadArea(q) < 16) return false
  // Require consistent winding / convexity to avoid folded projective maps.
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4]
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(z) < 1e-5) continue
    const s = Math.sign(z)
    if (!sign) sign = s
    else if (s !== sign) return false
  }
  return !!sign
}

function commit() {
  if (!validQuad(quad)) {
    engine.ui?.toast('Perspective crop needs a non-folded four-corner region', 'error')
    return
  }
  const opts = getOptions('perspective-crop')
  const target = opts.output === 'target'
    ? {
        targetW: Math.max(1, Math.round(Number(opts.targetWidth) || 1)),
        targetH: Math.max(1, Math.round(Number(opts.targetHeight) || 1)),
      }
    : {}
  engine.perspectiveCropTo(quad.map(p => ({ ...p })), {
    ...target,
    resolutionPpi: Number(opts.resolutionPpi) > 0 ? Number(opts.resolutionPpi) : undefined,
  })
  quad = null
  drag = null
  engine.pokeOverlay()
}

export const perspectiveCropTool: Tool = {
  id: 'perspective-crop',
  cursor: 'crosshair',

  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    if (quad) {
      const corner = hitCorner(p)
      if (corner !== null) {
        drag = { mode: 'corner', corner }
        return
      }
      if (pointInQuad(p.docX, p.docY)) {
        drag = { mode: 'move', start: { x: p.docX, y: p.docY }, original: quad.map(q => ({ ...q })) }
        return
      }
    }
    const s = snap(p.docX, p.docY)
    quad = [s, { ...s }, { ...s }, { ...s }]
    drag = { mode: 'new', start: s }
    engine.pokeOverlay()
  },

  onPointerMove(p: PointerInfo) {
    if (!quad || !drag) return
    if (drag.mode === 'new') {
      const e = snap(p.docX, p.docY)
      quad = [
        { x: Math.min(drag.start.x, e.x), y: Math.min(drag.start.y, e.y) },
        { x: Math.max(drag.start.x, e.x), y: Math.min(drag.start.y, e.y) },
        { x: Math.max(drag.start.x, e.x), y: Math.max(drag.start.y, e.y) },
        { x: Math.min(drag.start.x, e.x), y: Math.max(drag.start.y, e.y) },
      ]
    } else if (drag.mode === 'corner') {
      quad[drag.corner] = snap(p.docX, p.docY)
    } else {
      let dx = p.docX - drag.start.x, dy = p.docY - drag.start.y
      if (p.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0
        else dx = 0
      }
      quad = drag.original.map(q => ({ x: q.x + dx, y: q.y + dy }))
    }
    engine.pokeOverlay()
  },

  onPointerUp() { drag = null },

  onDoubleClick() { commit() },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && quad) { commit(); return true }
    if (e.key === 'Escape' && quad) {
      quad = null
      drag = null
      engine.pokeOverlay()
      return true
    }
    return false
  },

  onDeactivate() {
    drag = null
  },

  renderOverlay(ctx, view, w, h, mouse) {
    if (!quad) {
      drawCross(ctx, mouse)
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,.58)'
      ctx.fillRect(w / 2 - 190, h - 34, 380, 22)
      ctx.fillStyle = '#fff'
      ctx.font = '12px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Draw perspective crop · adjust corners · Enter / double-click applies', w / 2, h - 19)
      ctx.restore()
      return
    }

    const s = quad.map(p => ({ x: p.x * view.zoom + view.panX, y: p.y * view.zoom + view.panY }))
    ctx.save()
    // darken outside the crop polygon
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.moveTo(s[0].x, s[0].y)
    for (let i = 1; i < 4; i++) ctx.lineTo(s[i].x, s[i].y)
    ctx.closePath()
    ctx.clip('evenodd')
    ctx.fillStyle = 'rgba(0,0,0,.48)'
    ctx.fillRect(0, 0, w, h)
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = validQuad(quad) ? '#fff' : '#ff5b5b'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(s[0].x, s[0].y)
    for (let i = 1; i < 4; i++) ctx.lineTo(s[i].x, s[i].y)
    ctx.closePath()
    ctx.stroke()

    const grid = String(getOptions('perspective-crop').grid ?? 'thirds')
    ctx.strokeStyle = 'rgba(255,255,255,.42)'
    ctx.lineWidth = 1
    if (grid === 'thirds' || grid === 'grid') {
      const count = grid === 'thirds' ? 3 : 4
      for (let i = 1; i < count; i++) {
        const t = i / count
        const a = bilerp(quad, t, 0), b = bilerp(quad, t, 1)
        const c = bilerp(quad, 0, t), d = bilerp(quad, 1, t)
        ctx.beginPath(); ctx.moveTo(a.x * view.zoom + view.panX, a.y * view.zoom + view.panY); ctx.lineTo(b.x * view.zoom + view.panX, b.y * view.zoom + view.panY); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(c.x * view.zoom + view.panX, c.y * view.zoom + view.panY); ctx.lineTo(d.x * view.zoom + view.panX, d.y * view.zoom + view.panY); ctx.stroke()
      }
    } else if (grid === 'diagonal') {
      ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[2].x, s[2].y)
      ctx.moveTo(s[1].x, s[1].y); ctx.lineTo(s[3].x, s[3].y); ctx.stroke()
    }

    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = '#111'
      ctx.fillRect(s[i].x - 5, s[i].y - 5, 10, 10)
      ctx.strokeRect(s[i].x - 5.5, s[i].y - 5.5, 11, 11)
      ctx.fillStyle = '#111'
      ctx.font = '9px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText(String(i + 1), s[i].x, s[i].y + 3)
    }

    if (validQuad(quad)) {
      const auto = quadOutputSize(quad)
      const opts = getOptions('perspective-crop')
      const label = opts.output === 'target'
        ? `${auto.w} × ${auto.h} → ${Math.max(1, Number(opts.targetWidth) || 1)} × ${Math.max(1, Number(opts.targetHeight) || 1)} px`
        : `${auto.w} × ${auto.h} px`
      const cx = s.reduce((n, p) => n + p.x, 0) / 4
      const cy = s.reduce((n, p) => n + p.y, 0) / 4
      ctx.font = '11px ui-monospace, monospace'
      const tw = ctx.measureText(label).width + 12
      ctx.fillStyle = 'rgba(0,0,0,.72)'
      ctx.fillRect(cx - tw / 2, cy - 12, tw, 20)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, cx, cy + 2)
    }
    ctx.restore()
  },
}
