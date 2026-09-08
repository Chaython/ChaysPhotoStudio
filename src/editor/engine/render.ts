// Viewport: canvas host, pan/zoom, rAF render loop, marching ants, pointer routing
//
// Rendering layers (bottom → top):
//   main    — composited document + checkerboard (redrawn only when content/view changes)
//   overlay — marching ants + tool overlays (redrawn on content change, ants frames, pointer events)
//   cursor  — brush rings / precise crosshairs (redrawn EVERY frame with a mouse and
//             immediately on pointermove at input rate, so the cursor never lags or
//             disappears even while the composite engine is busy)
import type { PointerInfo, PsDocument, Tool, ToolId } from '../types'
import { ctx2d, clamp } from '../utils/canvas'
import { compositeDocument } from './document'
import { drawAnts } from './selection'
import { getTool } from '../tools/registry'
import { engine } from './engine'
import { RULER_W, drawRulers, drawGuides, drawGrid, drawPixelGrid, hitGuide } from './guides'
import { useEditorStore } from '../store'

export class Viewport {
  host: HTMLElement | null = null
  canvas: HTMLCanvasElement | null = null
  overlay: HTMLCanvasElement | null = null
  cursorCanvas: HTMLCanvasElement | null = null
  private dpr = 1
  private rafId = 0
  private needsComposite = true
  private needsDraw = true
  /** overlay needs a repaint (mouse moved / tool state changed / content changed) */
  private overlayDirty = true
  private composite: HTMLCanvasElement | null = null
  private antsOffset = 0
  private lastT = 0
  private spaceDown = false
  private panning = false
  private panStart = { x: 0, y: 0, panX: 0, panY: 0 }
  private lastMouse: { x: number; y: number } | null = null
  private lastPointerInfo: PointerInfo | null = null
  private pointers = new Map<number, { x: number; y: number }>()
  private pinchDist = 0
  private activePointerId: number | null = null
  private cursorThrottle = 0
  private resizeObs: ResizeObserver | null = null
  /** cached host rect — avoids repeated layout reads on pointer events */
  private hostRect: DOMRect | null = null
  private hostRectT = 0
  /** cached workspace background color (getComputedStyle is expensive per-frame) */
  private bgCache = '#1e1e1e'
  private bgCacheT = 0

  private lastW = 0
  private lastH = 0
  /** guide drag state: creating from ruler OR moving an existing guide */
  private guideDrag: { mode: 'create' | 'move'; orientation: 'h' | 'v'; guideId?: string; pos: number } | null = null
  /** cached checkerboard pattern (8px cells) — replaces per-cell fillRect loop */
  private checkerPattern: CanvasPattern | null = null

  mount(host: HTMLElement, main: HTMLCanvasElement, overlay: HTMLCanvasElement, cursorLayer?: HTMLCanvasElement) {
    this.host = host
    this.canvas = main
    this.overlay = overlay
    this.cursorCanvas = cursorLayer ?? null
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.resizeObs = new ResizeObserver(() => {
      const prevW = this.lastW, prevH = this.lastH
      this.hostRect = null // layout changed
      this.resize()
      // re-fit when the viewport changes dramatically (e.g. device rotate / panel
      // toggle) — but only for docs the user hasn't zoomed/panned themselves
      // (autoFit false = sticky per-doc view, keep it exactly)
      const doc = engine.activeDoc
      const dw = Math.abs(host.clientWidth - prevW), dh = Math.abs(host.clientHeight - prevH)
      if (prevW > 0 && (dw / prevW > 0.25 || dh / Math.max(1, prevH) > 0.25)) {
        if (doc?.view.autoFit !== false) this.fit()
      }
    })
    this.resizeObs.observe(host)
    this.lastW = host.clientWidth
    this.lastH = host.clientHeight
    this.resize()

    main.addEventListener('pointerdown', this.onPointerDown)
    main.addEventListener('pointermove', this.onPointerMove)
    main.addEventListener('pointerup', this.onPointerUp)
    main.addEventListener('pointercancel', this.onPointerUp)
    main.addEventListener('pointerleave', this.onPointerLeave)
    main.addEventListener('pointerenter', this.onPointerEnter)
    main.addEventListener('dblclick', this.onDoubleClick)
    main.addEventListener('wheel', this.onWheel, { passive: false })
    main.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    engine.setRenderer(this)
    this.rafId = requestAnimationFrame(this.loop)
  }

  unmount() {
    cancelAnimationFrame(this.rafId)
    this.resizeObs?.disconnect()
    const main = this.canvas
    if (main) {
      main.removeEventListener('pointerdown', this.onPointerDown)
      main.removeEventListener('pointermove', this.onPointerMove)
      main.removeEventListener('pointerup', this.onPointerUp)
      main.removeEventListener('pointercancel', this.onPointerUp)
      main.removeEventListener('pointerleave', this.onPointerLeave)
      main.removeEventListener('pointerenter', this.onPointerEnter)
      main.removeEventListener('dblclick', this.onDoubleClick)
      main.removeEventListener('wheel', this.onWheel)
      main.removeEventListener('contextmenu', this.onContextMenu)
    }
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.lastMouse = null
  }

  requestRender() {
    this.needsComposite = true
    this.needsDraw = true
    this.overlayDirty = true
  }

  /** repaint overlay + cursor only (no recomposite) — cheap */
  pokeOverlay() {
    this.overlayDirty = true
  }

  private resize() {
    const host = this.host, main = this.canvas, ov = this.overlay
    if (!host || !main || !ov) return
    const w = host.clientWidth, h = host.clientHeight
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    for (const c of [main, ov, this.cursorCanvas]) {
      if (!c) continue
      c.width = Math.max(1, Math.round(w * this.dpr))
      c.height = Math.max(1, Math.round(h * this.dpr))
      c.style.width = `${w}px`
      c.style.height = `${h}px`
    }
    this.needsDraw = true
    this.needsComposite = true
    this.overlayDirty = true
    this.lastW = host.clientWidth
    this.lastH = host.clientHeight
  }

  private loop = (t: number) => {
    this.rafId = requestAnimationFrame(this.loop)
    const dt = t - this.lastT
    this.lastT = t
    const doc = engine.activeDoc
    const hasAnts = !!doc?.selection
    if (hasAnts) this.antsOffset = (this.antsOffset + dt / 40) % 8
    if (this.needsComposite && doc) {
      // reuse the composite canvas (avoids a full-size allocation every frame)
      this.composite = compositeDocument(doc, this.composite ?? undefined)
      this.needsComposite = false
      this.needsDraw = true
      this.overlayDirty = true
    }
    // main canvas: only when content/view actually changed (NOT on ants frames)
    if (this.needsDraw) {
      this.drawMain()
      this.needsDraw = false
    }
    // overlay: content changes, ants animation, or any pointer activity
    if (this.overlayDirty || hasAnts) {
      this.drawOverlay()
      this.overlayDirty = false
    }
    // cursor: every frame while a mouse is over the canvas — never freezes
    if (this.lastMouse) this.drawCursor()
  }

  private workspaceBg(): string {
    const now = performance.now()
    if (now - this.bgCacheT > 500 && this.host) {
      this.bgCacheT = now
      try {
        const v = getComputedStyle(this.host).getPropertyValue('--workspace-bg')
        if (v && v.trim()) this.bgCache = v.trim()
      } catch { /* keep cached */ }
    }
    return this.bgCache
  }

  private drawMain() {
    const main = this.canvas
    const doc = engine.activeDoc
    if (!main || !doc) return
    const ctx = main.getContext('2d')!
    const w = main.width / this.dpr, h = main.height / this.dpr
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    // workspace bg
    ctx.fillStyle = this.workspaceBg()
    ctx.fillRect(0, 0, w, h)
    if (!this.composite) return
    const v = doc.view
    // doc rect, snapped to DEVICE pixels: at fractional zoom/pan the doc edge
    // would otherwise land between device pixels and shimmer frame-to-frame
    // while dragging along the canvas border (edges "flickering in and out")
    const dx = Math.round(v.panX * this.dpr) / this.dpr
    const dy = Math.round(v.panY * this.dpr) / this.dpr
    const dw = Math.round(doc.width * v.zoom * this.dpr) / this.dpr
    const dh = Math.round(doc.height * v.zoom * this.dpr) / this.dpr
    // checkerboard behind doc
    if (dw > 2 && dh > 2) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(dx, dy, dw, dh)
      ctx.clip()
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(dx, dy, dw, dh)
      const pattern = this.checker()
      if (pattern) {
        // pattern is anchored to the translated origin → moves with pan,
        // matching the previous per-cell alignment (phase = floor(pan/8)*8)
        ctx.save()
        ctx.translate(dx, dy)
        ctx.fillStyle = pattern
        ctx.fillRect(0, 0, dw, dh)
        ctx.restore()
      } else {
        const cell = 8
        ctx.fillStyle = '#cccccc'
        const startX = Math.floor(dx / cell) * cell, startY = Math.floor(dy / cell) * cell
        for (let y = startY; y < dy + dh; y += cell) {
          for (let x = startX; x < dx + dw; x += cell) {
            if ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0) ctx.fillRect(x, y, cell, cell)
          }
        }
      }
      // doc content
      ctx.imageSmoothingEnabled = v.zoom < 3
      ctx.drawImage(this.composite, dx, dy, dw, dh)
      ctx.restore()
    }
    // live-drag ghost: the moving layer's pixels that hang OUTSIDE the
    // document, dimmed to 35%. Without this the dragged-out edges simply
    // vanish at the canvas border (they survive — off-canvas pixels are
    // preserved — but nothing shows where they went, which reads as
    // "edges cut / flickering in and out"). The ghost keeps the drag
    // visually continuous; it disappears on release like Photoshop.
    const ld = doc._liveDrag
    if (ld && doc.channelView === 'rgb' && !doc.previewAdjustment && dw > 2 && dh > 2) {
      const gx = dx + ld.dx * v.zoom, gy = dy + ld.dy * v.zoom
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, w, h)
      ctx.rect(dx, dy, dw, dh)
      ctx.clip('evenodd')
      ctx.imageSmoothingEnabled = v.zoom < 3
      ctx.globalAlpha = 0.35
      const lt = ld.liveTransform
      if (lt) {
        // live free-transform: the same anchor map the composite fast path
        // renders (p → a + R·S·(p − a)) so the ghost matches the preview
        const asx = dx + lt.ax * v.zoom, asy = dy + lt.ay * v.zoom
        ctx.translate(asx, asy)
        ctx.rotate(lt.rotation)
        ctx.scale(lt.sx, lt.sy)
        ctx.translate(-asx, -asy)
      }
      ctx.drawImage(ld.stack, gx, gy, dw, dh)
      ctx.restore()
    }
    // border
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 1
    ctx.strokeRect(dx - 0.5, dy - 0.5, dw + 1, dh + 1)
  }

  /** 8px screen-space checkerboard as a cached pattern (≈100× faster than fillRect loops) */
  private checker(): CanvasPattern | null {
    if (this.checkerPattern) return this.checkerPattern
    const c = document.createElement('canvas')
    c.width = 16
    c.height = 16
    const cc = c.getContext('2d')!
    cc.fillStyle = '#ffffff'
    cc.fillRect(0, 0, 16, 16)
    cc.fillStyle = '#cccccc'
    cc.fillRect(0, 0, 8, 8)
    cc.fillRect(8, 8, 8, 8)
    const main = this.canvas
    if (main) this.checkerPattern = main.getContext('2d')!.createPattern(c, 'repeat')
    return this.checkerPattern
  }

  private drawOverlay() {
    const ov = this.overlay
    const doc = engine.activeDoc
    if (!ov || !doc) return
    const ctx = ov.getContext('2d')!
    const w = ov.width / this.dpr, h = ov.height / this.dpr
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const v = doc.view
    // ants
    if (doc.selection) {
      ctx.save()
      ctx.translate(v.panX, v.panY)
      ctx.scale(v.zoom, v.zoom)
      drawAnts(ctx, doc.selection, v.zoom, this.antsOffset)
      ctx.restore()
    }
    // tool overlay (brush rings live on the cursor layer, not here)
    const tool = getTool(((engine as any)._activeToolId ?? currentToolId()) as ToolId)
    if (tool?.renderOverlay) tool.renderOverlay(ctx, v, w, h, this.lastMouse)
    // measurement grid beneath guides/rulers (labels + cursor badge)
    const prefs = useEditorStore.getState().view
    if (prefs.showGrid) {
      drawGrid(ctx, doc, v, w, h, this.lastMouse, { gridSize: prefs.gridSize, labels: prefs.showGridLabels })
    }
    // pixel grid (1-doc-px cells) — self-gating: only draws at zoom >= 4
    // with a bounded visible-cell count, so no zoom check needed here
    if (prefs.showPixelGrid !== false) drawPixelGrid(ctx, doc, v, w, h)
    // guides + rulers on top (drawn every overlay frame; cheap line work)
    if (prefs.showGuides && doc.guides?.length) drawGuides(ctx, doc, v, w, h)
    if (prefs.showRulers) drawRulers(ctx, doc, v, w, h, this.lastMouse, prefs.rulerUnits)
    // live guide drag preview
    if (this.guideDrag) {
      ctx.save()
      ctx.strokeStyle = 'rgba(105,204,255,0.95)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      if (this.guideDrag.orientation === 'h') {
        const sy = Math.round(v.panY + this.guideDrag.pos * v.zoom) + 0.5
        ctx.moveTo(0, sy); ctx.lineTo(w, sy)
      } else {
        const sx = Math.round(v.panX + this.guideDrag.pos * v.zoom) + 0.5
        ctx.moveTo(sx, 0); ctx.lineTo(sx, h)
      }
      ctx.stroke()
      ctx.restore()
      // doc-space position badge near the ruler edge (drawGrid cursor-pill style)
      const text = String(Math.round(this.guideDrag.pos))
      ctx.save()
      ctx.font = '10px ui-monospace, SFMono-Regular, monospace'
      const tw = ctx.measureText(text).width
      const bw = tw + 10, bh = 16
      let bx: number, by: number
      if (this.guideDrag.orientation === 'h') {
        const sy = Math.round(v.panY + this.guideDrag.pos * v.zoom)
        bx = RULER_W + 6
        by = Math.min(Math.max(sy - bh / 2, RULER_W + 2), Math.max(RULER_W + 2, h - bh - 2))
      } else {
        const sx = Math.round(v.panX + this.guideDrag.pos * v.zoom)
        bx = Math.min(Math.max(sx + 6, RULER_W + 2), Math.max(RULER_W + 2, w - bw - 2))
        by = RULER_W + 6
      }
      ctx.fillStyle = 'rgba(15,15,17,0.82)'
      ctx.strokeStyle = 'rgba(232,163,61,0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(bx, by, bw, bh, 3)
      ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#f4c47c'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, bx + 5, by + 8)
      ctx.restore()
    }
  }

  /** the always-on-top cursor layer — brushed at input rate + every frame */
  private drawCursor() {
    const cc = this.cursorCanvas
    const doc = engine.activeDoc
    if (!cc || !doc) return
    const ctx = cc.getContext('2d')!
    const w = cc.width / this.dpr, h = cc.height / this.dpr
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (!this.lastMouse) return
    const tool = getTool(((engine as any)._activeToolId ?? currentToolId()) as ToolId)
    if (tool?.renderCursor) tool.renderCursor(ctx, doc.view, w, h, this.lastMouse)
  }

  /** immediate cursor repaint (called straight from the pointermove handler) */
  private renderCursorNow() {
    if (this.lastMouse) this.drawCursor()
  }

  // ---------- pointer routing ----------

  /** cached host rect; refreshed via ResizeObserver + at most every 250 ms */
  private rect(): DOMRect | null {
    const now = performance.now()
    if (this.hostRect && now - this.hostRectT < 250) return this.hostRect
    if (!this.host) return null
    this.hostRect = this.host.getBoundingClientRect()
    this.hostRectT = now
    return this.hostRect
  }

  private toDocAt(sx: number, sy: number) {
    const doc = engine.activeDoc
    if (!doc) return { x: 0, y: 0 }
    return { x: (sx - doc.view.panX) / doc.view.zoom, y: (sy - doc.view.panY) / doc.view.zoom }
  }

  private makeInfoAt(e: PointerEvent | MouseEvent, sx: number, sy: number, isStart = false, isEnd = false): PointerInfo {
    const p = this.toDocAt(sx, sy)
    return {
      docX: p.x, docY: p.y,
      rawX: sx, rawY: sy,
      shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey,
      pressure: (e as PointerEvent).pressure && (e as PointerEvent).pressure > 0 ? (e as PointerEvent).pressure : 0.5,
      button: e.button, pointerType: (e as PointerEvent).pointerType ?? 'mouse',
      isStart, isEnd,
    }
  }

  private makeInfo(e: PointerEvent | MouseEvent, isStart = false, isEnd = false): PointerInfo {
    const rect = this.rect() ?? { left: 0, top: 0 }
    return this.makeInfoAt(e, e.clientX - rect.left, e.clientY - rect.top, isStart, isEnd)
  }

  private get tool(): Tool | null {
    return getTool(currentToolId() as ToolId)
  }

  private onPointerDown = (e: PointerEvent) => {
    const main = this.canvas!
    this.activePointerId = e.pointerId
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try { main.setPointerCapture(e.pointerId) } catch { /* synthetic/unknown pointer id — keep going */ }
    // pinch
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()]
      this.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      return
    }
    if (this.spaceDown || e.button === 1) {
      const doc = engine.activeDoc
      if (doc) {
        this.panning = true
        this.panStart = { x: e.clientX, y: e.clientY, panX: doc.view.panX, panY: doc.view.panY }
      }
      return
    }
    if (e.button === 2) return // context menu
    const rect = this.rect()
    if (!rect) return
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top
    this.lastMouse = { x: sx, y: sy }

    // ---- rulers & guides ----
    const doc = engine.activeDoc
    const prefs = useEditorStore.getState().view
    if (doc && prefs.showRulers && e.button === 0) {
      const inTopRuler = sy < RULER_W && sx >= RULER_W
      const inLeftRuler = sx < RULER_W && sy >= RULER_W
      if (inTopRuler || inLeftRuler) {
        this.guideDrag = {
          mode: 'create',
          orientation: inTopRuler ? 'h' : 'v',
          pos: inTopRuler ? (sy - doc.view.panY) / doc.view.zoom : (sx - doc.view.panX) / doc.view.zoom,
        }
        this.overlayDirty = true
        return
      }
      // move-tool grabs existing guides; dragging them back into a ruler deletes them
      const grabbed = hitGuide(doc, doc.view, sx, sy, 6)
      if (grabbed && currentToolId() === 'move') {
        this.guideDrag = { mode: 'move', orientation: grabbed.orientation, guideId: grabbed.id, pos: grabbed.pos }
        this.overlayDirty = true
        return
      }
    }

    this.overlayDirty = true
    this.tool?.onPointerDown?.(this.makeInfo(e, true))
  }

  private onPointerMove = (e: PointerEvent) => {
    const rect = this.rect()
    if (rect) this.lastMouse = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // repaint the cursor immediately at input rate (before any heavy frame work)
    this.renderCursorNow()
    // pinch zoom
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()]
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      if (this.pinchDist > 0) this.zoomAtClient((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, d / this.pinchDist)
      this.pinchDist = d
      return
    }
    // live guide drag
    if (this.guideDrag) {
      const doc = engine.activeDoc
      if (doc && this.lastMouse) {
        const v = doc.view
        this.guideDrag.pos = this.guideDrag.orientation === 'h'
          ? (this.lastMouse.y - v.panY) / v.zoom
          : (this.lastMouse.x - v.panX) / v.zoom
        this.overlayDirty = true
      }
      return
    }
    const info = this.makeInfo(e)
    // status bar cursor position (lightweight — no store-wide sync)
    const now = performance.now()
    if (now - this.cursorThrottle > 60) {
      this.cursorThrottle = now
      this.lastPointerInfo = info
      try { onCursorMove?.(info.docX, info.docY) } catch { /* noop */ }
    }
    if (this.panning) {
      const doc = engine.activeDoc
      if (doc) {
        doc.view.panX = this.panStart.panX + (e.clientX - this.panStart.x)
        doc.view.panY = this.panStart.panY + (e.clientY - this.panStart.y)
        doc.view.autoFit = false // user pan → sticky per-doc view
        this.needsDraw = true
        this.overlayDirty = true
      }
      return
    }
    this.overlayDirty = true
    this.tool?.onPointerMove?.(info)
  }

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.pinchDist = 0
    this.overlayDirty = true
    // finish guide drag: release over the canvas → place/move; over a ruler → discard/delete
    if (this.guideDrag) {
      const doc = engine.activeDoc
      const rect = this.rect()
      const gd = this.guideDrag
      this.guideDrag = null
      if (doc && rect && this.lastMouse) {
        const sx = this.lastMouse.x, sy = this.lastMouse.y
        const overRuler = sx < RULER_W || sy < RULER_W
        if (gd.mode === 'create') {
          if (!overRuler) engine.addGuide(gd.orientation, gd.pos)
        } else if (gd.guideId) {
          if (overRuler) engine.removeGuide(gd.guideId)
          else engine.moveGuide(gd.guideId, gd.pos)
        }
      }
      this.overlayDirty = true
      return
    }
    if (this.panning) { this.panning = false; return }
    if (e.button === 2) return
    this.tool?.onPointerUp?.(this.makeInfo(e, false, true))
  }

  private onPointerLeave = () => {
    this.lastMouse = null
    this.needsDraw = true
    this.overlayDirty = true
    const cc = this.cursorCanvas
    if (cc) {
      const ctx = cc.getContext('2d')!
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
      ctx.clearRect(0, 0, cc.width / this.dpr, cc.height / this.dpr)
    }
  }

  private onPointerEnter = () => {
    this.hostRect = null // refresh rect on re-entry
    this.overlayDirty = true
  }

  private onDoubleClick = (e: MouseEvent) => {
    // double-click a ruler strip → new guide at that (rounded) doc position.
    // The plain clicks before the dblclick only arm/discard a guide drag
    // (pointer stays inside the strip), so this is the sole creation path.
    const doc = engine.activeDoc
    const prefs = useEditorStore.getState().view
    if (doc && prefs.showRulers && e.button === 0) {
      const rect = this.rect()
      if (rect) {
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top
        const inTopRuler = sy < RULER_W && sx >= RULER_W
        const inLeftRuler = sx < RULER_W && sy >= RULER_W
        if (inTopRuler || inLeftRuler) {
          const v = doc.view
          if (inTopRuler) engine.addGuide('h', Math.round((sy - v.panY) / v.zoom))
          else engine.addGuide('v', Math.round((sx - v.panX) / v.zoom))
          return
        }
      }
    }
    this.tool?.onDoubleClick?.(this.makeInfo(e))
  }

  private onContextMenu = (e: Event) => {
    // Move tool + a layer: let the event bubble UN-prevented so the Radix
    // context menu (canvas-workspace, layer functions at the pointer) can
    // open — Radix suppresses the native menu itself when it takes over.
    // Everything else: keep suppressing the browser's context menu on canvas.
    if (engine.activeDoc?.activeLayerId && currentToolId() === 'move') return
    e.preventDefault()
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const rect = this.rect()
    if (!rect) return
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    this.zoomAtClient(e.clientX - rect.left, e.clientY - rect.top, factor)
  }

  private zoomAtClient(cx: number, cy: number, factor: number) {
    const doc = engine.activeDoc
    if (!doc) return
    const v = doc.view
    const nz = clamp(v.zoom * factor, 0.02, 32)
    const k = nz / v.zoom
    v.panX = cx - (cx - v.panX) * k
    v.panY = cy - (cy - v.panY) * k
    v.zoom = nz
    v.autoFit = false // explicit user zoom → sticky per-doc view
    this.needsDraw = true
    this.overlayDirty = true
    onZoomChange?.(nz)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !this.spaceDown) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      this.spaceDown = true
      if (this.canvas) this.canvas.style.cursor = 'grab'
      e.preventDefault()
      return
    }
    // route keys to the active tool (Enter/Escape/Backspace for lassos, crop,
    // measure, magnetic lasso…). This listener registers BEFORE the global
    // shortcut hook (React child effects run first), so a tool handling a key
    // with preventDefault() wins over global Delete/Backspace handling.
    if (e.code !== 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      const target = e.target as HTMLElement
      const activeEl = document.activeElement as HTMLElement | null
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
        || !!activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')
      if (!typing) {
        const tool = getTool(currentToolId() as ToolId)
        if (tool?.onKeyDown) {
          const handled = tool.onKeyDown(e)
          if (handled) e.preventDefault()
        }
      }
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      this.spaceDown = false
      if (this.canvas) this.canvas.style.cursor = ''
    }
  }

  fit() {
    const doc = engine.activeDoc
    const host = this.host
    if (!doc || !host) return
    engine.fitToScreen(host.clientWidth, host.clientHeight)
    this.needsComposite = true
    this.needsDraw = true
    this.overlayDirty = true
  }

  /** "Fit blank space": zoom to the layer content bounds (ignores the
   *  transparent/background margins between layers). */
  fitContent() {
    const doc = engine.activeDoc
    const host = this.host
    if (!doc || !host) return
    engine.fitToContent(host.clientWidth, host.clientHeight)
    this.needsComposite = true
    this.needsDraw = true
    this.overlayDirty = true
    onZoomChange?.(doc.view.zoom)
  }

  setCursorCss(css: string) {
    if (this.canvas) this.canvas.style.cursor = css
  }
}

// current tool is stored in the zustand store; avoid cycle by late binding
let currentToolIdRef: () => string = () => 'move'
let onCursorMove: ((x: number, y: number) => void) | null = null
let onZoomChange: ((z: number) => void) | null = null

export function setCurrentToolIdProvider(fn: () => string) { currentToolIdRef = fn }
function currentToolId(): string { return currentToolIdRef() }
export function setCursorCallbacks(cb: { onCursorMove?: (x: number, y: number) => void; onZoomChange?: (z: number) => void }) {
  onCursorMove = cb.onCursorMove ?? null
  onZoomChange = cb.onZoomChange ?? null
}

let viewportInstance: Viewport | null = null
export function getViewport(): Viewport {
  if (!viewportInstance) viewportInstance = new Viewport()
  return viewportInstance
}
