// ============================================================
// gl-core — WebGL2 acceleration core for Chay's Photo Studio
//
// Provides a singleton WebGL2 context (own offscreen canvas), a shader
// program cache, canvas→texture upload cache, an FBO pool for
// ping-pong compositing, and small helpers (LUT textures, quad setup).
//
// Orientation contract (IMPORTANT — read before writing shaders):
//   * Canvas textures are uploaded with UNPACK_FLIP_Y_WEBGL = false,
//     so texture v=0 is the TOP row of the canvas.
//   * All fullscreen passes use the quad uv = aPos*0.5+0.5, so a
//     fragment at clip y=-1 (FBO storage row 0) samples source v=0.
//     Therefore FBO storage row 0 = image TOP row for every pass and
//     FBO-rendered textures follow the SAME convention (v=0 = top).
//   * gl.readPixels(0, 0, w, h, RGBA, UNSIGNED_BYTE, …) from such an
//     FBO returns rows starting at storage row 0 = image top row →
//     the buffer maps DIRECTLY onto ImageData with no flip.
//
// All blend math is done in fragment shaders (GL blending is disabled),
// so textures store straight (non-premultiplied) RGBA like ImageData.
// ============================================================

export interface GLInfo {
  supported: boolean
  vendor: string
  renderer: string
  maxTextureSize: number
  /** software rasterizer (SwiftShader/llvmpipe) — GPU compositing defaults OFF */
  software: boolean
  /** RGBA16F color-attachment support for higher-precision compositing. */
  float16Framebuffer: boolean
}

let glCtx: WebGL2RenderingContext | null = null
let glTried = false
let glInfoCache: GLInfo | null = null
/** global kill-switch: user toggle (persisted) + runtime failure latch */
let glEnabled = true
let glFailed = false

function probeFloat16Framebuffer(gl: WebGL2RenderingContext): boolean {
  if (!gl.getExtension('EXT_color_buffer_float')) return false
  const tex = gl.createTexture()
  const fb = gl.createFramebuffer()
  if (!tex || !fb) {
    if (tex) gl.deleteTexture(tex)
    if (fb) gl.deleteFramebuffer(fb)
    return false
  }
  let ok = false
  try {
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  } catch {
    ok = false
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.deleteFramebuffer(fb)
    gl.deleteTexture(tex)
  }
  return ok
}

/** read the persisted user preference once (undefined = auto) */
function storedPref(): boolean | undefined {
  try {
    const v = localStorage.getItem('zphoto-gpu')
    if (v === '1') return true
    if (v === '0') return false
  } catch { /* noop */ }
  return undefined
}

function applyInitialToggle(): void {
  const pref = storedPref()
  if (pref !== undefined) { glEnabled = pref; return }
  // auto: disable when the renderer is a known software rasterizer
  const info = glInfo()
  glEnabled = !(info.supported && info.software)
}

export function glAvailable(): boolean {
  glInfo() // ensures the software-renderer auto-toggle was applied
  return glEnabled && !glFailed && !!getGL()
}

export function setGlEnabled(on: boolean): void {
  glEnabled = on
  try { localStorage.setItem('zphoto-gpu', on ? '1' : '0') } catch { /* noop */ }
}

export function isGlEnabled(): boolean {
  glInfo()
  return glEnabled && !glFailed
}

export function getGL(): WebGL2RenderingContext | null {
  if (glCtx) return glCtx
  if (glTried || typeof document === 'undefined') return null
  glTried = true
  try {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    const gl = c.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    })
    if (!gl) return null
    // probe: force a real compile to catch broken drivers early
    const vs = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vs, 'void main(){gl_Position=vec4(0.);}')
    gl.compileShader(vs)
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) return null
    gl.deleteShader(vs)
    glCtx = gl
  } catch {
    return null
  }
  return glCtx
}

export function glInfo(): GLInfo {
  if (glInfoCache) return glInfoCache
  const gl = getGL()
  if (!gl) {
    glInfoCache = { supported: false, vendor: '', renderer: '', maxTextureSize: 0, software: false, float16Framebuffer: false }
    applyInitialToggle()
    return glInfoCache
  }
  let vendor = '', renderer = ''
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR))
    renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.RENDERER)
  } catch { /* noop */ }
  const software = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(`${vendor} ${renderer}`)
  glInfoCache = {
    supported: true,
    vendor, renderer, software,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    float16Framebuffer: probeFloat16Framebuffer(gl),
  }
  applyInitialToggle()
  return glInfoCache
}

/** permanently disable GL after an unrecoverable error (lost context etc.) */
export function glFatal(): void {
  glFailed = true
  try { glCtx?.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* noop */ }
  glCtx = null
}

// ---------------- shader programs ----------------

const programCache = new Map<string, WebGLProgram>()

export function compileProgram(gl: WebGL2RenderingContext, key: string, vsSrc: string, fsSrc: string): WebGLProgram | null {
  const cached = programCache.get(key)
  if (cached) return cached
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(`[gl-core] shader compile failed (${key}):`, gl.getShaderInfoLog(sh))
      gl.deleteShader(sh)
      return null
    }
    return sh
  }
  const vs = compile(gl.VERTEX_SHADER, vsSrc)
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc)
  if (!vs || !fs) return null
  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(`[gl-core] program link failed (${key}):`, gl.getProgramInfoLog(prog))
    gl.deleteProgram(prog)
    return null
  }
  programCache.set(key, prog)
  return prog
}

// fullscreen quad (two triangles) — uv = pos*0.5+0.5
const QUAD = new Float32Array([
  -1, -1, 1, -1, -1, 1,
  -1, 1, 1, -1, 1, 1,
])

let quadBuf: WebGLBuffer | null = null

/** draw a fullscreen quad with the given program (binds its aPos attribute) */
export function drawQuad(gl: WebGL2RenderingContext, program: WebGLProgram): void {
  if (!quadBuf) {
    quadBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }
  gl.useProgram(program)
  gl.bindVertexArray(null)
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
  const loc = gl.getAttribLocation(program, 'aPos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
}

// ---------------- textures ----------------

interface TexEntry { tex: WebGLTexture; key: string }

/** canvas → texture cache; key should encode content version */
const canvasTexCache = new WeakMap<HTMLCanvasElement, TexEntry>()

export function uploadCanvas(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement, key: string): WebGLTexture | null {
  const hit = canvasTexCache.get(canvas)
  if (hit && hit.key === key) return hit.tex
  if (canvas.width === 0 || canvas.height === 0) return null
  const tex = hit?.tex ?? gl.createTexture()
  if (!tex) return null
  try {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  } catch {
    return null
  }
  canvasTexCache.set(canvas, { tex, key })
  return tex
}

/** upload raw RGBA bytes (top-down rows) as a texture — for LUTs use uploadLUT */
export function uploadBytes(gl: WebGL2RenderingContext, w: number, h: number, bytes: Uint8Array, key: string, owner: object): WebGLTexture | null {
  const cache = bytesTexCache.get(owner)
  if (cache && cache.key === key) return cache.tex
  const tex = cache?.tex ?? gl.createTexture()
  if (!tex) return null
  try {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  } catch {
    return null
  }
  bytesTexCache.set(owner, { tex, key })
  return tex
}
const bytesTexCache = new WeakMap<object, TexEntry>()

/** 256×1 RGBA LUT texture (linear filter → smooth curves) */
export function uploadLUT(gl: WebGL2RenderingContext, lut: Uint8Array | Uint8ClampedArray, key: string): WebGLTexture | null {
  if (lut.length !== 256 * 4) return null
  return uploadBytes(gl, 256, 1, new Uint8Array(lut.buffer, lut.byteOffset, 1024), key, LUT_HOLDER)
}
const LUT_HOLDER = { name: 'lut' }

// ---------------- FBO pool ----------------

export type FBOPrecision = 'u8' | 'f16'
export interface FBO { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number; precision: FBOPrecision }

const fboPool: FBO[] = []

export function acquireFBO(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  precision: FBOPrecision = 'u8',
): FBO | null {
  for (let i = 0; i < fboPool.length; i++) {
    const f = fboPool[i]
    if (f.w === w && f.h === h && f.precision === precision) {
      fboPool.splice(i, 1)
      return f
    }
  }
  if (precision === 'f16' && !glInfo().float16Framebuffer) return null
  const tex = gl.createTexture()
  const fb = gl.createFramebuffer()
  if (!tex || !fb) return null
  gl.bindTexture(gl.TEXTURE_2D, tex)
  if (precision === 'f16') {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    // Compositing passes are same-resolution; nearest sampling avoids
    // requiring a float-linear extension and keeps texel registration exact.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  if (!ok) {
    gl.deleteFramebuffer(fb)
    gl.deleteTexture(tex)
    return null
  }
  return { fb, tex, w, h, precision }
}

export function releaseFBO(gl: WebGL2RenderingContext, f: FBO | null): void {
  if (!f) return
  if (fboPool.length > 8) {
    gl.deleteFramebuffer(f.fb)
    gl.deleteTexture(f.tex)
    return
  }
  fboPool.push(f)
}

/** bind f as render target; viewport set to full size */
export function bindTarget(gl: WebGL2RenderingContext, f: FBO | null): void {
  if (f) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb)
    gl.viewport(0, 0, f.w, f.h)
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  }
}

/** bind a WebGLTexture to a sampler uniform slot */
export function bindUniformTex(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, tex: WebGLTexture, unit: number): boolean {
  const loc = gl.getUniformLocation(program, name)
  if (!loc) return false
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.uniform1i(loc, unit)
  return true
}

// ---------------- common vertex shader ----------------

export const QUAD_VS = `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`
