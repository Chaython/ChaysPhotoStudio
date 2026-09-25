// Crop / Eyedropper / Hand / Zoom tools — Photoshop-style interaction pass
import type { Tool, PointerInfo, Rect } from '../types'
import { engine } from '../engine/engine'
import { getOptions, newDrag, drawCross, drawDashedRect } from './shared'
import { rectFromPoints, clamp, createCanvas, ctx2d, getImageData, putImageData } from '../utils/canvas'
import { useEditorStore } from '../store'
import { snapToGuides } from '../engine/guides'
import { colorReadoutLines } from './color-readout'
import { newLayer } from '../engine/document'
import * as imageOps from '../image-ops'

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
let straightenStart: { x: number; y: number } | null = null
let straightenEnd: { x: number; y: number } | null = null
let cropCommitting = false

function ratioValue(raw: unknown): number | null {
  if (!raw || raw === 'free') return null
  if (raw === 'custom') {
    const opts = getOptions('crop')
    const a = Math.max(0.001, Number(opts.ratioW) || 1)
    const b = Math.max(0.001, Number(opts.ratioH) || 1)
    return a / b
  }
  if (raw === 'target') {
    const opts = getOptions('crop')
    const a = Math.max(1, Number(opts.targetWidth) || 1)
    const b = Math.max(1, Number(opts.targetHeight) || 1)
    return a / b
  }
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
    if (getOptions('crop').straighten === true) {
      straightenStart = { x: p.docX, y: p.docY }
      straightenEnd = { x: p.docX, y: p.docY }
      cropDrag.active = false
      engine.pokeOverlay()
      return
    }
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
    if (straightenStart) {
      straightenEnd = { x: p.docX, y: p.docY }
      engine.pokeOverlay()
      return
    }
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
    if (straightenStart && straightenEnd) {
      const dx = straightenEnd.x - straightenStart.x
      const dy = straightenEnd.y - straightenStart.y
      const len = Math.hypot(dx, dy)
      straightenStart = null
      straightenEnd = null
      if (len >= 4) {
        const deg = Math.atan2(dy, dx) * 180 / Math.PI
        if (Math.abs(deg) >= 0.01) engine.rotateCanvas(-deg)
        const doc = engine.activeDoc
        if (doc) cropRect = { x: 0, y: 0, w: doc.width, h: doc.height }
      }
      useEditorStore.getState().setToolOption('crop', 'straighten', false)
      engine.pokeOverlay()
      return
    }
    cropDrag.active = false
    cropStartRect = null
    cropHandle = null
  },

  onDoubleClick() { void commitCrop() },

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && straightenStart) {
      straightenStart = null
      straightenEnd = null
      useEditorStore.getState().setToolOption('crop', 'straighten', false)
      engine.pokeOverlay()
      return true
    }
    if (e.key === 'Enter' && cropRect) { void commitCrop(); return true }
    if (e.key === 'Escape' && cropRect) {
      cropRect = null; cropStartRect = null; cropHandle = null; cropDrag.active = false
      engine.pokeOverlay(); return true
    }
    return false
  },

  renderOverlay(ctx, view, w, h, mouse) {
    if (straightenStart && straightenEnd) {
      const ax = straightenStart.x * view.zoom + view.panX
      const ay = straightenStart.y * view.zoom + view.panY
      const bx = straightenEnd.x * view.zoom + view.panX
      const by = straightenEnd.y * view.zoom + view.panY
      const deg = Math.atan2(straightenEnd.y - straightenStart.y, straightenEnd.x - straightenStart.x) * 180 / Math.PI
      ctx.save()
      ctx.strokeStyle = '#e8a33d'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
      ctx.fillStyle = 'rgba(0,0,0,.75)'
      const label = `${deg.toFixed(2)}°`
      ctx.font = '11px ui-monospace, monospace'
      const tw = ctx.measureText(label).width + 10
      const mx = (ax + bx) / 2, my = (ay + by) / 2
      ctx.fillRect(mx - tw / 2, my - 22, tw, 17)
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.fillText(label, mx, my - 10)
      ctx.restore()
      return
    }
    const r = cropRect
    if (!r) {
      drawCross(ctx, mouse)
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(w / 2 - 154, h - 34, 308, 22)
      ctx.fillStyle = '#fff'
      ctx.font = '12px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(getOptions('crop').straighten === true ? 'Drag along a horizon/edge to straighten' : 'Drag crop · Alt from center · Enter / double-click applies', w / 2, h - 19)
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
    const cropOpts = getOptions('crop')
    const targetText = cropOpts.ratio === 'target'
      ? ` → ${Math.max(1, Math.round(Number(cropOpts.targetWidth) || 1))} × ${Math.max(1, Math.round(Number(cropOpts.targetHeight) || 1))} px`
      : ''
    const label = `${Math.round(r.w)} × ${Math.round(r.h)} px${targetText}`
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
    straightenStart = null
    straightenEnd = null
  },
}

async function commitCrop() {
  const doc = engine.activeDoc
  if (!doc || !cropRect || cropCommitting) return
  const r = {
    x: Math.round(cropRect.x),
    y: Math.round(cropRect.y),
    w: Math.max(1, Math.round(cropRect.w)),
    h: Math.max(1, Math.round(cropRect.h)),
  }
  if (r.w < 1 || r.h < 1) { cropRect = null; engine.pokeOverlay(); return }
  const opts = getOptions('crop')
  const target = opts.ratio === 'target'
    ? {
        targetW: Math.max(1, Math.round(Number(opts.targetWidth) || r.w)),
        targetH: Math.max(1, Math.round(Number(opts.targetHeight) || r.h)),
      }
    : {}

  cropCommitting = true
  try {
    const expands = r.x < 0 || r.y < 0 || r.x + r.w > doc.width || r.y + r.h > doc.height
    if (opts.contentAware === true && expands) {
      const store = useEditorStore.getState()
      store.setProgress({ active: true, label: 'Content-Aware Crop', value: 0 })

      // Build the requested crop in target-local coordinates. The synthesis
      // mask covers ONLY pixels outside the original canvas, so transparency
      // that already existed inside the artwork remains untouched.
      const flat = engine.flatComposite()
      if (flat) {
        const work = createCanvas(r.w, r.h)
        ctx2d(work).drawImage(flat, -r.x, -r.y)
        const img = getImageData(work)
        const mask = new Uint8ClampedArray(r.w * r.h)
        let masked = 0
        for (let y = 0; y < r.h; y++) {
          const gy = r.y + y
          const outsideY = gy < 0 || gy >= doc.height
          for (let x = 0; x < r.w; x++) {
            const gx = r.x + x
            if (outsideY || gx < 0 || gx >= doc.width) {
              mask[y * r.w + x] = 255
              masked++
            }
          }
        }

        if (masked > 0) {
          await imageOps.inpaint(img, mask, p => {
            store.setProgress({ active: true, label: 'Content-Aware Crop', value: p })
          })

          // Keep only the generated extension on a separate editable layer.
          // Add it before cropTo without its own history entry: cropTo will
          // include this layer in the single Crop history state.
          for (let i = 0; i < mask.length; i++) {
            if (mask[i]) continue
            img.data[i * 4 + 3] = 0
          }
          const fillCanvas = createCanvas(r.w, r.h)
          putImageData(fillCanvas, img)
          const fill = newLayer('raster', 'Content-Aware Crop Fill', r.w, r.h)
          fill.canvas = fillCanvas
          fill.offsetX = r.x
          fill.offsetY = r.y
          doc.layers.push(fill)
          doc.activeLayerId = fill.id
          doc.selectedLayerIds = [fill.id]
        }
      }
    }

    cropRect = null
    engine.cropTo(r, { deletePixels: opts.deletePixels !== false, ...target })
  } catch (err) {
    engine.ui?.toast(err instanceof Error ? err.message : 'Content-Aware Crop failed', 'error')
  } finally {
    useEditorStore.getState().setProgress(null)
    cropCommitting = false
    engine.pokeOverlay()
  }
}

// ============================================================
// Eyedropper
// ============================================================
function eyedropRadius(): number {
  // UI stores Photoshop-style sample size (1,3,5,7,11...), engine expects radius.
  return Math.max(0, Math.floor(((Number(getOptions('eyedropper').radius) || 1) - 1) / 2))
}

let eyedropDragging = false
let eyedropToBackground = false
let eyedropSampleKey = ''

function sampleEyedropper(p: PointerInfo, commit: boolean) {
  const opts = getOptions('eyedropper')
  const radius = eyedropRadius()
  const scope = opts.sample ?? 'composite'
  const key = `${scope}:${radius}:${Math.round(p.docX)}:${Math.round(p.docY)}`

  // Pointer hardware often reports several sub-pixel events inside the same
  // sampled pixel. Reuse the readout instead of repeating getImageData.
  if (key === eyedropSampleKey && eyedropPreview) {
    if (commit) {
      const store = useEditorStore.getState()
      if (eyedropToBackground) store.setBgColor(eyedropPreview)
      else store.setFgColor(eyedropPreview)
    }
    return
  }

  const hex = engine.sampleColor(p.docX, p.docY, scope, radius)
  eyedropSampleKey = key
  if (!hex) {
    eyedropPreview = null
    engine.pokeOverlay()
    return
  }
  eyedropPreview = hex
  if (commit) {
    const store = useEditorStore.getState()
    if (eyedropToBackground) store.setBgColor(hex)
    else store.setFgColor(hex)
  }
  engine.pokeOverlay()
}

export const eyedropperTool: Tool = {
  id: 'eyedropper',
  cursor: 'crosshair',
  onPointerDown(p: PointerInfo) {
    if (p.button !== 0) return
    eyedropDragging = true
    eyedropToBackground = p.alt
    sampleEyedropper(p, true)
  },
  onPointerMove(p: PointerInfo) {
    // Photoshop samples continuously while the mouse is held; hover still
    // updates the preview chip without changing the foreground/background.
    sampleEyedropper(p, eyedropDragging)
  },
  onPointerUp() { eyedropDragging = false },
  onDeactivate() { eyedropPreview = null; eyedropDragging = false; eyedropSampleKey = '' },
  renderOverlay(ctx, view, w, h, mouse) {
    void view; void w; void h
    if (mouse && eyedropPreview) {
      const lines = colorReadoutLines(eyedropPreview, String(getOptions('eyedropper').hud ?? 'all'))
      ctx.save()
      ctx.font = '10px ui-monospace, monospace'
      const lineH = 13
      const textW = Math.max(...lines.map(t => ctx.measureText(t).width))
      const boxW = Math.max(98, textW + 37)
      const boxH = Math.max(25, 8 + lines.length * lineH)
      const bx = mouse.x + 11
      const by = mouse.y - boxH - 8
      ctx.fillStyle = 'rgba(10,10,12,.88)'
      ctx.fillRect(bx, by, boxW, boxH)
      // sampled-color ring + swatch make subtle changes visible over the image
      ctx.fillStyle = eyedropPreview
      ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 8, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke()
      ctx.fillRect(bx + 4, by + 5, 20, 20)
      ctx.strokeRect(bx + 3.5, by + 4.5, 21, 21)
      ctx.fillStyle = '#fff'
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], bx + 30, by + 13 + i * lineH)
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
let handVelocity = { x: 0, y: 0 }
let handLastT = 0
let handInertiaFrame = 0

function stopHandInertia() {
  if (handInertiaFrame) cancelAnimationFrame(handInertiaFrame)
  handInertiaFrame = 0
  handVelocity = { x: 0, y: 0 }
}

function startHandInertia() {
  const doc = engine.activeDoc
  const opts = getOptions('hand')
  if (!doc || opts.inertia === false) return
  if (Math.hypot(handVelocity.x, handVelocity.y) < 80) return
  const friction = clamp((Number(opts.friction) || 92) / 100, .7, .98)
  let last = performance.now()
  const step = (now: number) => {
    const d = engine.activeDoc
    if (!d || handDrag.active) { stopHandInertia(); return }
    const dt = Math.min(.034, Math.max(.001, (now - last) / 1000))
    last = now
    d.view.panX += handVelocity.x * dt
    d.view.panY += handVelocity.y * dt
    // Normalize friction to 60Hz so motion is frame-rate independent.
    const decay = Math.pow(friction, dt * 60)
    handVelocity.x *= decay
    handVelocity.y *= decay
    engine.viewChanged()
    if (Math.hypot(handVelocity.x, handVelocity.y) < 8) { stopHandInertia(); return }
    handInertiaFrame = requestAnimationFrame(step)
  }
  handInertiaFrame = requestAnimationFrame(step)
}

export const handTool: Tool = {
  id: 'hand',
  cursor: 'grab',
  onPointerDown(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc || p.button !== 0) return
    stopHandInertia()
    handLastT = performance.now()
    handDrag = { startX: p.rawX, startY: p.rawY, lastX: p.rawX, lastY: p.rawY, active: true }
  },
  onPointerMove(p: PointerInfo) {
    const doc = engine.activeDoc
    if (!doc || !handDrag.active) return
    const dx = p.rawX - handDrag.lastX
    const dy = p.rawY - handDrag.lastY
    const now = performance.now()
    const dt = Math.max(.001, (now - handLastT) / 1000)
    doc.view.panX += dx
    doc.view.panY += dy
    // Smooth instantaneous velocity so one noisy pointer event does not launch
    // an absurdly fast flick.
    const vx = dx / dt, vy = dy / dt
    handVelocity.x = handVelocity.x * .55 + vx * .45
    handVelocity.y = handVelocity.y * .55 + vy * .45
    handLastT = now
    handDrag.lastX = p.rawX
    handDrag.lastY = p.rawY
    engine.viewChanged()
  },
  onPointerUp() { handDrag.active = false; startHandInertia() },
  onDoubleClick() {
    // Photoshop: double-click Hand = Fit on Screen.
    ;(window as any).__zphotoViewport?.fit?.()
  },
  onDeactivate() { handDrag.active = false; stopHandInertia() },
}

// ============================================================
// Zoom
// ============================================================
let zoomDrag: { lastX: number; moved: boolean } | null = null
let zoomAreaStart: { x: number; y: number } | null = null
let zoomArea: Rect | null = null

function maybeResizeWindowToFit() {
  const doc = engine.activeDoc
  if (!doc || getOptions('zoom').resizeWindowToFit !== true) return
  const vp = (window as any).__zphotoViewport
  const host = vp?.host as HTMLElement | undefined
  const chromeW = Math.max(0, window.outerWidth - window.innerWidth)
  const chromeH = Math.max(0, window.outerHeight - window.innerHeight)
  const hostW = host?.clientWidth ?? window.innerWidth
  const hostH = host?.clientHeight ?? window.innerHeight
  const nonCanvasW = Math.max(0, window.innerWidth - hostW)
  const nonCanvasH = Math.max(0, window.innerHeight - hostH)
  const pad = 64
  const desiredW = Math.ceil(doc.width * doc.view.zoom + nonCanvasW + chromeW + pad)
  const desiredH = Math.ceil(doc.height * doc.view.zoom + nonCanvasH + chromeH + pad)
  const maxW = Math.max(320, window.screen?.availWidth ?? desiredW)
  const maxH = Math.max(240, window.screen?.availHeight ?? desiredH)
  try { window.resizeTo(Math.min(maxW, desiredW), Math.min(maxH, desiredH)) } catch { /* browsers may deny resizeTo */ }
}

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
  maybeResizeWindowToFit()
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
      zoomAreaStart = { x: p.docX, y: p.docY }
      zoomArea = null
      engine.pokeOverlay()
    }
  },
  onPointerMove(p: PointerInfo) {
    if (zoomAreaStart) {
      zoomArea = rectFromPoints(zoomAreaStart.x, zoomAreaStart.y, p.docX, p.docY)
      engine.pokeOverlay()
      return
    }
    if (!zoomDrag) return
    const dx = p.rawX - zoomDrag.lastX
    if (Math.abs(dx) < 1) return
    zoomDrag.lastX = p.rawX
    zoomDrag.moved = true
    zoomAt(p, Math.exp(dx * 0.012))
  },
  onPointerUp(p: PointerInfo) {
    if (zoomAreaStart) {
      const r = zoomArea ?? rectFromPoints(zoomAreaStart.x, zoomAreaStart.y, p.docX, p.docY)
      zoomAreaStart = null
      zoomArea = null
      const doc = engine.activeDoc
      const vp = (window as any).__zphotoViewport
      const vw = vp?.host?.clientWidth ?? window.innerWidth
      const vh = vp?.host?.clientHeight ?? window.innerHeight
      if (doc && r.w * doc.view.zoom >= 6 && r.h * doc.view.zoom >= 6 && !p.alt) {
        const pad = 24
        const next = clamp(Math.min((vw - pad * 2) / Math.max(1, r.w), (vh - pad * 2) / Math.max(1, r.h)), .02, 32)
        doc.view.zoom = next
        doc.view.panX = (vw - r.w * next) / 2 - r.x * next
        doc.view.panY = (vh - r.h * next) / 2 - r.y * next
        doc.view.autoFit = false
        engine.viewChanged()
        maybeResizeWindowToFit()
      } else {
        const opts = getOptions('zoom')
        const dir = p.alt ? 'out' : opts.mode ?? 'in'
        zoomAt(p, dir === 'in' ? 1.35 : 1 / 1.35)
      }
      engine.pokeOverlay()
      return
    }
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
  onDeactivate() { zoomDrag = null; zoomAreaStart = null; zoomArea = null },
  renderOverlay(ctx, view, w, h, mouse) {
    void w; void h; void mouse
    if (!zoomArea) return
    const x = zoomArea.x * view.zoom + view.panX
    const y = zoomArea.y * view.zoom + view.panY
    const rw = zoomArea.w * view.zoom, rh = zoomArea.h * view.zoom
    ctx.save()
    ctx.fillStyle = 'rgba(232,163,61,.08)'
    ctx.fillRect(x, y, rw, rh)
    ctx.restore()
    drawDashedRect(ctx, x, y, rw, rh)
  },
}
