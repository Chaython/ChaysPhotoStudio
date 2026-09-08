'use client'
// ============================================================
// Liquify workspace — Photoshop Filter > Liquify… / GIMP IWarp.
//
// Live preview is GPU-accelerated (WebGL2 via gl-core): the source
// layer is downscaled to ≤ 700 px and uploaded once as an RGBA8
// texture; the warp mesh goes into an RGBA32F data texture (dx, dy)
// that is re-uploaded whenever a dab mutates it, and a fragment
// shader reproduces the exact CPU math (bilinear mesh displacement,
// inverse sampling). Every failure path (no GL, shader error,
// readPixels throw) latches a CPU bilinear fallback so the preview
// always works. OK commits the warp at FULL resolution on the CPU
// (warpCanvas), then follows the engine commit path used by
// Content-Aware Fill: mutateLayerPixels → draw → invalidateFlat →
// pushHistory('Liquify') → emit.
// ============================================================
import { useEffect, useRef, useState, useCallback } from 'react'
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Waves, MoveRight, Shrink, Maximize2, RotateCw, RotateCcw, Eraser, Undo2, Zap, Cpu, Info,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { engine } from '../../engine/engine'
import { useEditorStore } from '../../store'
import { invalidateFlat } from '../../engine/document'
import { createCanvas, ctx2d, clamp, resampleCanvas } from '../../utils/canvas'
import {
  createMesh, applyLiquifyDab, warpCanvas, meshDirtyBounds,
  type LiquifyMesh, type LiquifyToolId, type LiquifyBrushOptions,
} from '../../image-ops/liquify'
import {
  getGL, glAvailable, compileProgram, drawQuad, bindTarget, acquireFBO, releaseFBO, bindUniformTex,
} from '../../engine/gl/gl-core'
import type { DialogProps } from './generic-dialogs'
import { cn } from '@/lib/utils'

// NOTE: the mesh displacement is fetched with texelFetch, which is GLSL
// ES 3.00 — so this pass needs its own #version-300 vertex shader
// (gl-core's QUAD_VS is ES 1.00 and has no texelFetch).

const LIQUIFY_VS = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const LIQUIFY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uSrc;   // downscaled source, RGBA8, LINEAR, CLAMP
uniform sampler2D uMesh;  // (cols x rows) RGBA32F (dx, dy, 0, 0), NEAREST
uniform vec2 uDocSize;    // doc size in px
uniform vec2 uCell;       // mesh cell size in doc px
uniform vec2 uMeshSize;   // (cols, rows)

vec2 dispAt(vec2 pos) {
  vec2 g = pos / uCell;
  vec2 fi = floor(g);
  vec2 f = clamp(g - fi, vec2(0.0), vec2(1.0));
  ivec2 n = ivec2(uMeshSize) - ivec2(1);
  ivec2 i0 = clamp(ivec2(fi), ivec2(0), n);
  ivec2 i1 = min(i0 + ivec2(1), n);
  vec2 d00 = texelFetch(uMesh, ivec2(i0.x, i0.y), 0).xy;
  vec2 d10 = texelFetch(uMesh, ivec2(i1.x, i0.y), 0).xy;
  vec2 d01 = texelFetch(uMesh, ivec2(i0.x, i1.y), 0).xy;
  vec2 d11 = texelFetch(uMesh, ivec2(i1.x, i1.y), 0).xy;
  return mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);
}

void main() {
  // mesh displacement is in doc px; uv shift = disp / docSize
  vec2 d = dispAt(vUV * uDocSize);
  vec2 uv2 = vUV - d / uDocSize;
  fragColor = texture(uSrc, clamp(uv2, vec2(0.0), vec2(1.0)));
}`

const PREVIEW_MAX = 700 // px on the long side

interface SrcInfo {
  img: ImageData        // downscaled source pixels (preview res)
  pw: number
  ph: number
  docW: number
  docH: number
  cpuOut: ImageData     // reusable output for the CPU fallback path
}

interface GLAssets {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  srcTex: WebGLTexture
  meshTex: WebGLTexture
  meshBuf: Float32Array // (cols*rows*4) interleaved dx, dy, 0, 0
  outImage: ImageData
  uDocSize: WebGLUniformLocation | null
  uCell: WebGLUniformLocation | null
  uMeshSize: WebGLUniformLocation | null
}

interface ToolDefL {
  id: LiquifyToolId
  label: string
  icon: LucideIcon
  key: string
  hint: string
}

const TOOLS: ToolDefL[] = [
  { id: 'forward', label: 'Forward Warp', icon: MoveRight, key: 'W', hint: 'Drag to push pixels along the stroke' },
  { id: 'pucker', label: 'Pucker', icon: Shrink, key: 'P', hint: 'Hold to contract toward the brush center' },
  { id: 'bloat', label: 'Bloat', icon: Maximize2, key: 'B', hint: 'Hold to expand away from the brush center' },
  { id: 'twirl-cw', label: 'Twirl Clockwise', icon: RotateCw, key: 'S', hint: 'Hold to rotate pixels clockwise' },
  { id: 'twirl-ccw', label: 'Twirl Counter-Clockwise', icon: RotateCcw, key: 'S', hint: 'Hold to rotate pixels counter-clockwise' },
  { id: 'reconstruct', label: 'Reconstruct', icon: Eraser, key: 'R', hint: 'Drag to restore the original pixels' },
]

const KIND_LABEL: Record<string, string> = {
  raster: 'raster', smart: 'smart object', text: 'text', shape: 'shape', adjustment: 'adjustment',
}

function brushStep(size: number): number {
  return size < 10 ? 1 : size < 25 ? 2 : size < 50 ? 5 : size < 100 ? 10 : 25
}

/** alt inverts the radial/twirl tools (PS behavior) */
function effectiveTool(tool: LiquifyToolId, alt: boolean): LiquifyToolId {
  if (!alt) return tool
  if (tool === 'pucker') return 'bloat'
  if (tool === 'bloat') return 'pucker'
  if (tool === 'twirl-cw') return 'twirl-ccw'
  if (tool === 'twirl-ccw') return 'twirl-cw'
  return tool
}

// ---------------- GPU helpers ----------------

function initGLAssets(gl: WebGL2RenderingContext, src: SrcInfo, mesh: LiquifyMesh): GLAssets | null {
  const program = compileProgram(gl, 'liquify-warp', LIQUIFY_VS, LIQUIFY_FS)
  if (!program) return null
  try {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    const srcTex = gl.createTexture()
    if (!srcTex) return null
    gl.bindTexture(gl.TEXTURE_2D, srcTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.pw, src.ph, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.img.data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const meshBuf = new Float32Array(mesh.cols * mesh.rows * 4)
    const meshTex = gl.createTexture()
    if (!meshTex) return null
    gl.bindTexture(gl.TEXTURE_2D, meshTex)
    // RGBA32F sampled with NEAREST + texelFetch needs no float-linear extension
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, mesh.cols, mesh.rows, 0, gl.RGBA, gl.FLOAT, meshBuf)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
    return {
      gl, program, srcTex, meshTex, meshBuf,
      outImage: new ImageData(src.pw, src.ph),
      uDocSize: gl.getUniformLocation(program, 'uDocSize'),
      uCell: gl.getUniformLocation(program, 'uCell'),
      uMeshSize: gl.getUniformLocation(program, 'uMeshSize'),
    }
  } catch {
    return null
  }
}

function renderGL(a: GLAssets, src: SrcInfo, mesh: LiquifyMesh, previewCtx: CanvasRenderingContext2D): void {
  const { gl, program } = a
  // refresh the mesh data texture (dx, dy, 0, 0)
  const { cols, rows, disp } = mesh
  const mb = a.meshBuf
  for (let i = 0, j = 0, k = 0; i < cols * rows; i++, j += 4, k += 2) {
    mb[j] = disp[k]
    mb[j + 1] = disp[k + 1]
    mb[j + 2] = 0
    mb[j + 3] = 0
  }
  gl.bindTexture(gl.TEXTURE_2D, a.meshTex)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.FLOAT, mb)
  const fbo = acquireFBO(gl, src.pw, src.ph)
  if (!fbo) throw new Error('Liquify FBO unavailable')
  try {
    bindTarget(gl, fbo)
    gl.useProgram(program)
    bindUniformTex(gl, program, 'uSrc', a.srcTex, 0)
    bindUniformTex(gl, program, 'uMesh', a.meshTex, 1)
    gl.uniform2f(a.uDocSize, src.docW, src.docH)
    gl.uniform2f(a.uCell, mesh.cellW, mesh.cellH)
    gl.uniform2f(a.uMeshSize, cols, rows)
    drawQuad(gl, program)
    // orientation contract: FBO storage row 0 = image top → maps 1:1 onto ImageData
    gl.readPixels(0, 0, src.pw, src.ph, gl.RGBA, gl.UNSIGNED_BYTE, a.outImage.data)
  } finally {
    releaseFBO(gl, fbo)
    bindTarget(gl, null)
  }
  previewCtx.putImageData(a.outImage, 0, 0)
}

// ---------------- CPU fallback preview ----------------

function renderCPUPreview(src: SrcInfo, mesh: LiquifyMesh, out: ImageData, previewCtx: CanvasRenderingContext2D): void {
  const sd = src.img.data
  const od = out.data
  const pw = src.pw, ph = src.ph
  const fxDoc = src.docW / pw // doc px per preview px (x)
  const fyDoc = src.docH / ph
  const { cols, rows, cellW, cellH, disp } = mesh
  const colLimit = Math.max(0, cols - 2)
  const rowLimit = Math.max(0, rows - 2)
  for (let py = 0; py < ph; py++) {
    const docY = (py + 0.5) * fyDoc
    const gy = clamp(docY / cellH, 0, rows - 1)
    const gr = Math.min(Math.floor(gy), rowLimit)
    const ty = clamp(gy - gr, 0, 1)
    const row0 = gr * cols
    const row1 = (gr + 1) * cols
    const h0 = 1 - ty, h1 = ty
    for (let px = 0; px < pw; px++) {
      const docX = (px + 0.5) * fxDoc
      const gx = clamp(docX / cellW, 0, cols - 1)
      const gc = Math.min(Math.floor(gx), colLimit)
      const tx = clamp(gx - gc, 0, 1)
      const i00 = (row0 + gc) * 2
      const i10 = (row0 + gc + 1) * 2
      const i01 = (row1 + gc) * 2
      const i11 = (row1 + gc + 1) * 2
      const w0 = 1 - tx, w1 = tx
      const dxDoc = (disp[i00] * w0 + disp[i10] * w1) * h0 + (disp[i01] * w0 + disp[i11] * w1) * h1
      const dyDoc = (disp[i00 + 1] * w0 + disp[i10 + 1] * w1) * h0 + (disp[i01 + 1] * w0 + disp[i11 + 1] * w1) * h1
      const sx = px - dxDoc / fxDoc
      const sy = py - dyDoc / fyDoc
      const fx = sx - Math.floor(sx)
      const fy = sy - Math.floor(sy)
      const ix = Math.floor(sx)
      const iy = Math.floor(sy)
      const xa = Math.min(Math.max(ix, 0), pw - 1)
      const xb = Math.min(Math.max(ix + 1, 0), pw - 1)
      const ya = Math.min(Math.max(iy, 0), ph - 1)
      const yb = Math.min(Math.max(iy + 1, 0), ph - 1)
      const p00 = (ya * pw + xa) << 2
      const p10 = (ya * pw + xb) << 2
      const p01 = (yb * pw + xa) << 2
      const p11 = (yb * pw + xb) << 2
      const o = (py * pw + px) << 2
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy
      od[o] = sd[p00] * w00 + sd[p10] * w10 + sd[p01] * w01 + sd[p11] * w11
      od[o + 1] = sd[p00 + 1] * w00 + sd[p10 + 1] * w10 + sd[p01 + 1] * w01 + sd[p11 + 1] * w11
      od[o + 2] = sd[p00 + 2] * w00 + sd[p10 + 2] * w10 + sd[p01 + 2] * w01 + sd[p11 + 2] * w11
      od[o + 3] = sd[p00 + 3] * w00 + sd[p10 + 3] * w10 + sd[p01 + 3] * w01 + sd[p11 + 3] * w11
    }
  }
  previewCtx.putImageData(out, 0, 0)
}

// ============================================================

export function LiquifyDialog({ onClose }: DialogProps) {
  const doc = engine.activeDoc
  const layer = engine.activeLayer

  const [tool, setTool] = useState<LiquifyToolId>('forward')
  const [size, setSize] = useState(() => clamp(Math.round(Math.max(doc?.width ?? 800, doc?.height ?? 800) / 6), 16, 400))
  const [density, setDensity] = useState(50)
  const [pressure, setPressure] = useState(100)
  const [showMesh, setShowMesh] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [gpu, setGpu] = useState<boolean | null>(null) // null = probing
  const [stats, setStats] = useState({ grid: '—', moved: 0 })

  const previewRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const meshRef = useRef<LiquifyMesh | null>(null)
  const srcRef = useRef<SrcInfo | null>(null)
  const glRef = useRef<GLAssets | null>(null)
  const dirtyRef = useRef(true)
  const rafRef = useRef(0)
  const holdRafRef = useRef(0)
  const busyRef = useRef(false)
  const statsTRef = useRef(0)
  const ringRef = useRef<{ x: number; y: number } | null>(null)
  const pointerRef = useRef({
    down: false, x: 0, y: 0, lastX: 0, lastY: 0, lastT: 0, dirX: 0, dirY: 0,
  })
  // latest-ref pattern: stable rAF callbacks read the freshest closures
  const settingsRef = useRef({ tool, size, density, pressure, showMesh })
  settingsRef.current = { tool, size, density, pressure, showMesh }
  const drawOverlayRef = useRef<() => void>(() => { })

  const brushOpts = (s: { size: number; density: number; pressure: number }): LiquifyBrushOptions => ({
    size: s.size, density: s.density, pressure: s.pressure,
  })

  // ---------------- preview render loop ----------------

  const renderFrame = useCallback(() => {
    const mesh = meshRef.current
    const src = srcRef.current
    const pc = previewRef.current
    if (!mesh || !src || !pc) return
    const previewCtx = ctx2d(pc)
    const a = glRef.current
    if (a) {
      try {
        renderGL(a, src, mesh, previewCtx)
      } catch {
        // any GL failure latches the CPU fallback for good
        glRef.current = null
        try {
          renderCPUPreview(src, mesh, src.cpuOut, previewCtx)
        } catch { /* noop */ }
        setGpu(false)
      }
    } else {
      renderCPUPreview(src, mesh, src.cpuOut, previewCtx)
    }
    drawOverlayRef.current()
    // throttled mesh stats for the info panel
    const now = performance.now()
    if (now - statsTRef.current > 350) {
      statsTRef.current = now
      let moved = 0
      const d = mesh.disp
      for (let i = 0; i < d.length; i += 2) {
        if (d[i] !== 0 || d[i + 1] !== 0) moved++
      }
      setStats({ grid: `${mesh.cols}×${mesh.rows}`, moved })
    }
  }, [])

  const scheduleRender = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      if (!dirtyRef.current) return
      dirtyRef.current = false
      renderFrame()
    })
  }, [renderFrame])

  const markDirty = useCallback(() => {
    dirtyRef.current = true
    scheduleRender()
  }, [scheduleRender])

  // ---------------- overlay (ring / mesh / selection) ----------------

  const drawOverlay = () => {
    const oc = overlayRef.current
    const stage = stageRef.current
    const src = srcRef.current
    if (!oc || !stage || !src) return
    const rect = stage.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = rect.width, H = rect.height
    const bw = Math.max(1, Math.round(W * dpr)), bh = Math.max(1, Math.round(H * dpr))
    if (oc.width !== bw || oc.height !== bh) {
      oc.width = bw
      oc.height = bh
    }
    const ctx = oc.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    // letterboxed image rect (same math as the pointer mapping)
    const fit = Math.min(W / src.pw, H / src.ph)
    const ox = (W - src.pw * fit) / 2
    const oy = (H - src.ph * fit) / 2
    const k = fit * src.pw / src.docW // doc px → display px
    const mesh = meshRef.current
    const s = settingsRef.current

    // Show Mesh: the warped grid — nodes drawn at their displaced
    // positions, amber intensity ∝ displacement magnitude
    if (s.showMesh && mesh) {
      const { cols, rows, cellW, cellH, disp } = mesh
      const step = cols > 80 || rows > 80 ? 4 : 2
      const norm = mesh.cellW * 1.5
      ctx.lineWidth = 1
      for (let r = 0; r < rows; r += step) {
        for (let c = 0; c < cols - 1; c++) {
          const i0 = (r * cols + c) * 2
          const i1 = (r * cols + c + 1) * 2
          const m = Math.max(Math.hypot(disp[i0], disp[i0 + 1]), Math.hypot(disp[i1], disp[i1 + 1]))
          if (m < 0.01) continue
          const a = Math.min(0.9, 0.25 + m / norm)
          ctx.strokeStyle = `rgba(231, 162, 60, ${a.toFixed(3)})`
          ctx.beginPath()
          ctx.moveTo(ox + (c * cellW + disp[i0]) * k, oy + (r * cellH + disp[i0 + 1]) * k)
          ctx.lineTo(ox + ((c + 1) * cellW + disp[i1]) * k, oy + (r * cellH + disp[i1 + 1]) * k)
          ctx.stroke()
        }
      }
      for (let c = 0; c < cols; c += step) {
        for (let r = 0; r < rows - 1; r++) {
          const i0 = (r * cols + c) * 2
          const i1 = ((r + 1) * cols + c) * 2
          const m = Math.max(Math.hypot(disp[i0], disp[i0 + 1]), Math.hypot(disp[i1], disp[i1 + 1]))
          if (m < 0.01) continue
          const a = Math.min(0.9, 0.25 + m / norm)
          ctx.strokeStyle = `rgba(231, 162, 60, ${a.toFixed(3)})`
          ctx.beginPath()
          ctx.moveTo(ox + (c * cellW + disp[i0]) * k, oy + (r * cellH + disp[i0 + 1]) * k)
          ctx.lineTo(ox + (c * cellW + disp[i1]) * k, oy + ((r + 1) * cellH + disp[i1 + 1]) * k)
          ctx.stroke()
        }
      }
    }

    // selection bounds (the commit respects the selection mask)
    if (doc?.selection) {
      const b = doc.selection.bounds
      ctx.save()
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = 'rgba(231, 162, 60, 0.75)'
      ctx.lineWidth = 1
      ctx.strokeRect(ox + b.x * k, oy + b.y * k, b.w * k, b.h * k)
      ctx.restore()
    }

    // brush ring
    const ring = ringRef.current
    if (ring) {
      const rr = Math.max(2.5, (s.size / 2) * k)
      ctx.save()
      ctx.lineWidth = 1.25
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
      ctx.beginPath()
      ctx.arc(ring.x, ring.y, rr + 1, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = s.tool === 'reconstruct' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(231, 162, 60, 0.95)'
      ctx.beginPath()
      ctx.arc(ring.x, ring.y, rr, 0, Math.PI * 2)
      ctx.stroke()
      if (rr < 4) {
        // precise crosshair for tiny brushes
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
        ctx.beginPath()
        ctx.moveTo(ring.x - 5, ring.y)
        ctx.lineTo(ring.x + 5, ring.y)
        ctx.moveTo(ring.x, ring.y - 5)
        ctx.lineTo(ring.x, ring.y + 5)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.moveTo(ring.x - 4, ring.y)
        ctx.lineTo(ring.x + 4, ring.y)
        ctx.moveTo(ring.x, ring.y - 4)
        ctx.lineTo(ring.x, ring.y + 4)
        ctx.stroke()
      }
      ctx.restore()
    }
  }
  drawOverlayRef.current = drawOverlay

  // ---------------- init (source + mesh + GL) ----------------

  useEffect(() => {
    if (!doc || !layer || layer.kind === 'adjustment') return
    let cancelled = false
    // deferred one frame: canvas refs exist, setState runs outside the effect body
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      // doc-space source (raster layers may be offset after a move)
      const source = engine.layerCanvasDocSpace(layer.id)
      if (!source || !doc) return
      const long = Math.max(doc.width, doc.height)
      const f = Math.min(1, PREVIEW_MAX / Math.max(1, long))
      const pw = Math.max(2, Math.round(doc.width * f))
      const ph = Math.max(2, Math.round(doc.height * f))
      const small = resampleCanvas(source, pw, ph)
      const img = ctx2d(small).getImageData(0, 0, pw, ph)
      srcRef.current = { img, pw, ph, docW: doc.width, docH: doc.height, cpuOut: new ImageData(pw, ph) }
      meshRef.current = createMesh(doc.width, doc.height)
      const pc = previewRef.current
      if (pc) {
        pc.width = pw
        pc.height = ph
        const c = ctx2d(pc)
        c.clearRect(0, 0, pw, ph)
        c.putImageData(img, 0, 0)
      }
      // GPU feature-detect, once
      let ok = false
      try {
        const gl = getGL()
        if (gl && glAvailable()) {
          const assets = initGLAssets(gl, srcRef.current, meshRef.current)
          if (assets) {
            glRef.current = assets
            ok = true
          }
        }
      } catch {
        ok = false
      }
      setGpu(ok)
      dirtyRef.current = true
      markDirty()
      drawOverlayRef.current()
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      cancelAnimationFrame(holdRafRef.current)
      holdRafRef.current = 0
      const a = glRef.current
      if (a) {
        try {
          a.gl.deleteTexture(a.srcTex)
          a.gl.deleteTexture(a.meshTex)
        } catch { /* noop */ }
        glRef.current = null
      }
    }
  }, [doc?.id, layer?.id])

  // ---------------- pointer → doc mapping + stroke ----------------

  const toDoc = (e: { clientX: number; clientY: number }): { x: number; y: number; dispX: number; dispY: number } | null => {
    const stage = stageRef.current
    const src = srcRef.current
    if (!stage || !src) return null
    const rect = stage.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return null
    const fit = Math.min(rect.width / src.pw, rect.height / src.ph)
    const ox = rect.left + (rect.width - src.pw * fit) / 2
    const oy = rect.top + (rect.height - src.ph * fit) / 2
    const px = (e.clientX - ox) / fit // preview bitmap px
    const py = (e.clientY - oy) / fit
    return {
      x: px * (src.docW / src.pw),
      y: py * (src.docH / src.ph),
      dispX: e.clientX - rect.left,
      dispY: e.clientY - rect.top,
    }
  }

  const startHoldLoop = () => {
    if (holdRafRef.current) return
    const tick = () => {
      holdRafRef.current = 0
      const st = pointerRef.current
      const mesh = meshRef.current
      if (!st.down || !mesh || busyRef.current) return
      const now = performance.now()
      const idle = now - st.lastT
      const s = settingsRef.current
      // stationary tools keep working while the pointer is held still
      if (idle > 90 && s.tool !== 'forward') {
        const ticks = clamp(idle / 16.7, 0.25, 3)
        applyLiquifyDab(mesh, effectiveTool(s.tool, false), st.x, st.y, brushOpts(s), ticks, 0, 0)
        st.lastT = now
        markDirty()
      }
      holdRafRef.current = requestAnimationFrame(tick)
    }
    holdRafRef.current = requestAnimationFrame(tick)
  }

  const stopHoldLoop = () => {
    if (holdRafRef.current) {
      cancelAnimationFrame(holdRafRef.current)
      holdRafRef.current = 0
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (busyRef.current) return
    const p = toDoc(e)
    const mesh = meshRef.current
    if (!p || !mesh) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch { /* synthetic pointer ids can throw — ignore */ }
    const st = pointerRef.current
    st.down = true
    st.x = p.x
    st.y = p.y
    st.lastX = p.x
    st.lastY = p.y
    st.lastT = performance.now()
    st.dirX = 0
    st.dirY = 0
    const s = settingsRef.current
    // stationary tools act immediately on press
    if (s.tool !== 'forward') {
      applyLiquifyDab(mesh, effectiveTool(s.tool, e.altKey), p.x, p.y, brushOpts(s), 1, 0, 0)
    }
    startHoldLoop()
    markDirty()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toDoc(e)
    if (!p) return
    const st = pointerRef.current
    ringRef.current = { x: p.dispX, y: p.dispY }
    drawOverlay() // ring at input rate
    if (!st.down || busyRef.current) return
    const mesh = meshRef.current
    if (!mesh) return
    const s = settingsRef.current
    const opts = brushOpts(s)
    const eff = effectiveTool(s.tool, e.altKey)
    const now = performance.now()
    const dx = p.x - st.lastX
    const dy = p.y - st.lastY
    const dist = Math.hypot(dx, dy)
    const ticks = clamp((now - st.lastT) / 16.7, 0.25, 4)
    st.x = p.x
    st.y = p.y
    if (eff === 'forward') {
      if (dist > 0.5) {
        const ux = dx / dist
        const uy = dy / dist
        st.dirX = ux
        st.dirY = uy
        // sub-dabs along the segment keep fast drags continuous
        const spacing = Math.max(3, s.size / 8)
        const steps = Math.min(64, Math.max(1, Math.ceil(dist / spacing)))
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          applyLiquifyDab(mesh, 'forward', st.lastX + dx * t, st.lastY + dy * t, opts, dist / steps, ux, uy)
        }
        st.lastX = p.x
        st.lastY = p.y
        st.lastT = now
      }
    } else {
      applyLiquifyDab(mesh, eff, p.x, p.y, opts, ticks, 0, 0)
      st.lastX = p.x
      st.lastY = p.y
      st.lastT = now
    }
    markDirty()
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = pointerRef.current
    if (!st.down) return
    st.down = false
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    } catch { /* noop */ }
    stopHoldLoop()
  }

  const onPointerLeave = () => {
    ringRef.current = null
    drawOverlay()
  }

  // ---------------- wheel = brush size, keys = tool hotkeys ----------------

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (busyRef.current) return
      e.preventDefault()
      const step = brushStep(settingsRef.current.size)
      const delta = e.deltaY > 0 ? -step : step
      setSize(v => clamp(Math.round(v + delta), 4, 500))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [doc?.id, layer?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busyRef.current) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // typing guard — never swallow keys aimed at a focused field (stacked dialogs)
      const t = e.target as HTMLElement | null
      const focus = document.activeElement as HTMLElement | null
      const typing = (el: HTMLElement | null) =>
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (typing(t) || typing(focus)) return
      const k = e.key.toLowerCase()
      if (k === 'w') setTool('forward')
      else if (k === 'p') setTool('pucker')
      else if (k === 'b') setTool('bloat')
      else if (k === 's') setTool(t => (t === 'twirl-cw' ? 'twirl-ccw' : 'twirl-cw'))
      else if (k === 'r') setTool('reconstruct')
      else if (k === '[') setSize(v => clamp(v - brushStep(v), 4, 500))
      else if (k === ']') setSize(v => clamp(v + brushStep(v), 4, 500))
      else return
      e.preventDefault()
      e.stopPropagation() // capture-phase: keep the global shortcut hook quiet
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // ---------------- commit ----------------

  const apply = async () => {
    const d = engine.activeDoc
    const l = engine.activeLayer
    const mesh = meshRef.current
    if (!d || !l || !mesh || busyRef.current) return
    const store = useEditorStore.getState()
    if (l.kind === 'adjustment') {
      store.pushToast('Adjustment layers have no pixels — rasterize or pick a pixel layer', 'error')
      return
    }
    if (l.locked) {
      store.pushToast('Layer is locked', 'error')
      return
    }
    if (!meshDirtyBounds(mesh)) {
      store.pushToast('No distortion applied yet — paint with a tool first', 'info')
      return
    }
    busyRef.current = true
    setBusy(true)
    setProgress(0.01)
    store.setProgress({ active: true, label: 'Liquify', value: 0 })
    try {
      let layer = l
      if (layer.kind !== 'raster') {
        // smart / text / shape: rasterize (same id) before warping
        engine.rasterizeLayer(layer.id)
        layer = engine.layerById(l.id)!
        store.pushToast(`“${l.name}” rasterized for Liquify`, 'info')
      }
      const fresh = engine.mutateLayerPixels(layer.id)
      if (!fresh?.canvas) throw new Error('Layer has no pixels to warp')
      // the warp mesh is doc-space — bake any offset first
      if (fresh.offsetX || fresh.offsetY) engine.bakeRasterLayer(layer.id)
      const warped = await warpCanvas(fresh.canvas, mesh, p => {
        setProgress(p)
        useEditorStore.getState().setProgress({ active: true, label: 'Liquify', value: p })
      })
      // selection: warped pixels inside, original outside, feathered at the edge
      const out = createCanvas(d.width, d.height)
      const c = ctx2d(out)
      c.drawImage(fresh.canvas, 0, 0)
      if (d.selection) {
        const masked = createCanvas(d.width, d.height)
        const m = ctx2d(masked)
        m.drawImage(warped, 0, 0)
        m.globalCompositeOperation = 'destination-in'
        m.drawImage(d.selection.mask, 0, 0)
        c.drawImage(masked, 0, 0)
      } else {
        c.drawImage(warped, 0, 0)
      }
      const lc = ctx2d(fresh.canvas)
      lc.clearRect(0, 0, d.width, d.height)
      lc.drawImage(out, 0, 0)
      invalidateFlat(d)
      engine.pushHistory('Liquify')
      engine.emit()
      store.pushToast('Liquify applied', 'success')
      onClose()
    } catch (err: any) {
      store.pushToast(err?.message ?? 'Liquify failed', 'error')
    } finally {
      useEditorStore.getState().setProgress(null)
      setProgress(0)
      busyRef.current = false
      setBusy(false)
    }
  }

  const restoreAll = () => {
    const mesh = meshRef.current
    if (!mesh || busyRef.current) return
    mesh.disp.fill(0)
    markDirty()
  }

  // ---------------- guards ----------------

  if (!doc || !layer || layer.kind === 'adjustment' || !engine.layerCanvas(layer.id)) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Waves size={15} className="text-primary" /> Liquify</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5 py-4 text-xs text-muted-foreground">
          {!doc && <div>No active document.</div>}
          {doc && !layer && <div>No active layer — select a pixel layer first.</div>}
          {doc && layer && (layer.kind === 'adjustment' || !engine.layerCanvas(layer.id)) && (
            <div>“{layer.name}” has no pixels to warp (adjustment layer) — rasterize it or select a pixel layer.</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </>
    )
  }

  const activeInfo = TOOLS.find(t => t.id === tool)!
  const movedPct = meshRef.current ? Math.round((stats.moved / (meshRef.current.cols * meshRef.current.rows)) * 100) : 0

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Waves size={15} className="text-primary" />
          Liquify
          <span className="ml-1 text-[11px] font-normal text-muted-foreground">
            {doc.name} · {doc.width} × {doc.height} · {layer.name}
          </span>
        </DialogTitle>
      </DialogHeader>

      <div className="flex gap-2.5 py-1">
        {/* tool rail */}
        <div className="flex w-11 shrink-0 flex-col gap-1">
          {TOOLS.map(t => {
            const Icon = t.icon
            const active = tool === t.id
            return (
              <button
                key={t.id}
                type="button"
                title={`${t.label} (${t.key})`}
                aria-pressed={active}
                onClick={() => setTool(t.id)}
                className={cn(
                  'group relative flex h-9 w-9 items-center justify-center rounded border transition-colors',
                  active
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon size={15} strokeWidth={active ? 2.2 : 1.8} />
                <span className="absolute bottom-0 right-0.5 text-[8px] font-mono leading-none text-muted-foreground/80">
                  {t.key}
                </span>
              </button>
            )
          })}
          <div className="mt-auto flex h-9 items-end justify-center text-[8px] text-muted-foreground/70">
            Alt ↔
          </div>
        </div>

        {/* center: preview stage */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-[10px]">
            <span className="truncate text-muted-foreground">{activeInfo.hint}</span>
            <span className="flex shrink-0 items-center gap-1 font-mono">
              {gpu === null ? (
                <span className="text-muted-foreground">preview…</span>
              ) : gpu ? (
                <>
                  <Zap size={10} className="text-primary" />
                  <span className="text-primary">GPU · WebGL2</span>
                </>
              ) : (
                <>
                  <Cpu size={10} className="text-muted-foreground" />
                  <span className="text-muted-foreground">CPU preview</span>
                </>
              )}
            </span>
          </div>

          <div
            ref={stageRef}
            className="relative touch-none select-none overflow-hidden rounded border border-border bg-[repeating-conic-gradient(#3a3a3a_0%_25%,#2c2c2c_0%_50%)] [background-size:12px_12px]"
            style={{ height: 'min(52vh, 420px)', cursor: 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
          >
            <canvas
              ref={previewRef}
              className="absolute inset-0 h-full w-full object-contain"
              aria-label="Liquify preview"
            />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
          </div>

          {busy ? (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <div className="text-[10px] text-primary animate-pulse">Warping {doc.width} × {doc.height} px…</div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Info size={10} className="shrink-0" />
              <span className="truncate">
                Wheel or [ ] resizes the brush · Alt inverts pucker/bloat &amp; twirl{doc.selection ? ' · result masked to selection' : ''}
              </span>
            </div>
          )}
        </div>

        {/* right: brush controls */}
        <div className="zphoto-scroll w-[176px] shrink-0 space-y-2.5 overflow-y-auto border-l border-border pl-2.5">
          <div className="space-y-1.5">
            <Label className="flex items-center justify-between text-[11px]">
              Size
              <span className="font-mono text-muted-foreground">{size} px</span>
            </Label>
            <Slider value={[size]} min={4} max={500} step={1} onValueChange={v => setSize(v[0])} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center justify-between text-[11px]">
              Density
              <span className="font-mono text-muted-foreground">{density}%</span>
            </Label>
            <Slider value={[density]} min={1} max={100} step={1} onValueChange={v => setDensity(v[0])} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center justify-between text-[11px]">
              Pressure
              <span className="font-mono text-muted-foreground">{pressure}%</span>
            </Label>
            <Slider value={[pressure]} min={1} max={100} step={1} onValueChange={v => setPressure(v[0])} disabled={busy} />
          </div>

          <Button
            variant="secondary"
            size="sm"
            className="h-7 w-full text-[11px]"
            onClick={restoreAll}
            disabled={busy || stats.moved === 0}
          >
            <Undo2 size={12} className="mr-1.5" />
            Restore All
          </Button>

          <label className="flex cursor-pointer items-center justify-between rounded border border-border px-2 py-1.5 text-[11px]">
            <span>Show Mesh</span>
            <Switch checked={showMesh} onCheckedChange={setShowMesh} disabled={busy} />
          </label>

          <div className="space-y-1 rounded border bg-muted/40 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            <div className="flex justify-between"><span>document</span><span className="text-foreground">{doc.width}×{doc.height}</span></div>
            <div className="flex justify-between"><span>layer</span><span className="max-w-[92px] truncate text-foreground" title={layer.name}>{layer.name}</span></div>
            <div className="flex justify-between"><span>type</span><span className="text-foreground">{KIND_LABEL[layer.kind] ?? layer.kind}</span></div>
            <div className="flex justify-between"><span>grid</span><span className="text-foreground">{stats.grid}</span></div>
            <div className="flex justify-between"><span>warped</span><span className="text-primary">{stats.moved} nodes · {movedPct}%</span></div>
            <div className="flex justify-between"><span>engine</span><span className="text-foreground">{gpu === null ? '…' : gpu ? 'WebGL2' : 'CPU'}</span></div>
            <div className="flex justify-between"><span>commit</span><span className="text-foreground">full res · CPU</span></div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={busy}>
          <Waves size={13} className="mr-1.5" />
          {busy ? 'Warping…' : 'Apply Liquify'}
        </Button>
      </DialogFooter>
    </>
  )
}
