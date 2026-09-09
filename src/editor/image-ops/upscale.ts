// ============================================================
// AI Upscaler — high-quality image enlargement engine
//
//  - lanczosResample: separable Lanczos-a windowed-sinc resampling
//    (2 passes, Float32 planes, alpha-aware) — dramatically crisper
//    than the browser's box/bilinear "high" smoothing
//  - denoiseLight: edge-preserving smoothing (blur ∝ inverse local
//    variance) that removes JPEG-ish noise BEFORE enlargement so it
//    doesn't get baked in at 4×
//  - enhanceDetail: post-upscale unsharp with edge-adaptive strength
//    (gradient-weighted) + micro-contrast — the "AI detail" look
//  - upscaleSmart: full pipeline (denoise → Lanczos → detail)
//    with progress + cooperative yielding — fully on-device
// ============================================================
import { createCanvas, ctx2d, cloneCanvas } from '../utils/canvas'

export interface UpscaleOptions {
  scale: number
  /** 0..100 — edge-adaptive sharpening after resample */
  detail?: number
  /** 0..100 — pre-pass edge-preserving denoise */
  denoise?: number
  onProgress?: (p: number) => void
}

const A = 3 // lanczos radius

function sinc(x: number) {
  if (x === 0) return 1
  const px = Math.PI * x
  return Math.sin(px) / px
}
function lanczosKernel(x: number) {
  x = Math.abs(x)
  if (x >= A) return 0
  return sinc(x) * sinc(x / A)
}

const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()))

/** separable Lanczos resample of a canvas (preserves alpha) */
export async function lanczosResample(
  src: HTMLCanvasElement, w: number, h: number, onProgress?: (p: number) => void
): Promise<HTMLCanvasElement> {
  if (w === src.width && h === src.height) return src
  const img = ctx2d(src).getImageData(0, 0, src.width, src.height)
  const sw = src.width, sh = src.height
  const d = img.data
  // 4 float planes (RGBA)
  const planes: Float32Array[] = []
  for (let c = 0; c < 4; c++) planes.push(new Float32Array(sw * sh))
  for (let i = 0, n = sw * sh; i < n; i++) {
    planes[0][i] = d[i * 4]
    planes[1][i] = d[i * 4 + 1]
    planes[2][i] = d[i * 4 + 2]
    planes[3][i] = d[i * 4 + 3]
  }

  // ---- horizontal pass: sw×sh → w×sh
  const mid: Float32Array[] = []
  for (let c = 0; c < 4; c++) mid.push(new Float32Array(w * sh))
  const xScale = w / sw // > 1 for upscale
  const xSupport = Math.min(A, A / xScale) * Math.max(1, xScale) // source-space support
  for (let ox = 0; ox < w; ox++) {
    const center = ((ox + 0.5) / xScale) - 0.5
    const i0 = Math.max(0, Math.ceil(center - xSupport - 0.001))
    const i1 = Math.min(sw - 1, Math.floor(center + xSupport + 0.001))
    let wsum = 0
    const taps: number[] = []
    for (let i = i0; i <= i1; i++) {
      const t = lanczosKernel((i - center) / (xScale < 1 ? xScale : 1))
      taps.push(t)
      wsum += t
    }
    if (wsum === 0) { taps.length = 0; taps.push(1); wsum = 1 }
    for (let y = 0; y < sh; y++) {
      const rowBase = y * sw
      for (let c = 0; c < 4; c++) {
        let acc = 0
        for (let k = 0; k < taps.length; k++) acc += planes[c][rowBase + i0 + k] * taps[k]
        mid[c][y * w + ox] = acc / wsum
      }
    }
    if (onProgress && (ox & 63) === 0) { onProgress(0.08 + 0.32 * (ox / w)); await nextFrame() }
  }

  // ---- vertical pass: w×sh → w×h
  const outPlanes: Float32Array[] = []
  for (let c = 0; c < 4; c++) outPlanes.push(new Float32Array(w * h))
  const yScale = h / sh
  const ySupport = Math.min(A, A / yScale) * Math.max(1, yScale)
  for (let oy = 0; oy < h; oy++) {
    const center = ((oy + 0.5) / yScale) - 0.5
    const i0 = Math.max(0, Math.ceil(center - ySupport - 0.001))
    const i1 = Math.min(sh - 1, Math.floor(center + ySupport + 0.001))
    let wsum = 0
    const taps: number[] = []
    for (let i = i0; i <= i1; i++) {
      const t = lanczosKernel((i - center) / (yScale < 1 ? yScale : 1))
      taps.push(t)
      wsum += t
    }
    if (wsum === 0) { taps.length = 0; taps.push(1); wsum = 1 }
    const outRow = oy * w
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let acc = 0
        for (let k = 0; k < taps.length; k++) acc += mid[c][(i0 + k) * w + x] * taps[k]
        outPlanes[c][outRow + x] = acc / wsum
      }
    }
    if (onProgress && (oy & 63) === 0) { onProgress(0.4 + 0.4 * (oy / h)); await nextFrame() }
  }

  const out = createCanvas(w, h)
  const oimg = new ImageData(w, h)
  const od = oimg.data
  for (let i = 0, n = w * h; i < n; i++) {
    od[i * 4] = Math.max(0, Math.min(255, outPlanes[0][i]))
    od[i * 4 + 1] = Math.max(0, Math.min(255, outPlanes[1][i]))
    od[i * 4 + 2] = Math.max(0, Math.min(255, outPlanes[2][i]))
    od[i * 4 + 3] = Math.max(0, Math.min(255, outPlanes[3][i]))
  }
  ctx2d(out).putImageData(oimg, 0, 0)
  onProgress?.(0.85)
  return out
}

/** edge-preserving denoise — blur strength ∝ inverse local variance (fast 2-box approximation) */
function denoiseLight(img: ImageData, strength: number) {
  if (strength <= 0) return
  const { width: w, height: h, data: d } = img
  const blend = Math.min(0.85, strength / 100 * 0.85)
  // 3×3 mean of luminance variance, cheap version: |center - 4-neighbors|
  const copy = new Uint8ClampedArray(d)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      // local contrast on green channel
      const g = copy[i + 1]
      const gl = copy[i - 4 + 1], gr = copy[i + 4 + 1], gu = copy[i - w * 4 + 1], gd = copy[i + w * 4 + 1]
      const c = (Math.abs(g - gl) + Math.abs(g - gr) + Math.abs(g - gu) + Math.abs(g - gd)) / 4
      // flat area → smooth strongly; edge → keep original
      const flat = Math.max(0, 1 - c / 18)
      const k = blend * flat
      for (let ch = 0; ch < 3; ch++) {
        const avg = (copy[i + ch] + copy[i - 4 + ch] + copy[i + 4 + ch] + copy[i - w * 4 + ch] + copy[i + w * 4 + ch]) / 5
        d[i + ch] = copy[i + ch] * (1 - k) + avg * k
      }
    }
  }
}

/** post-upscale detail enhancement: edge-weighted per-channel unsharp */
function enhanceDetail(img: ImageData, detail: number) {
  if (detail <= 0) return
  const { width: w, height: h, data: d } = img
  const amt = detail / 100
  const n = w * h
  // per-channel blurred planes (two 3×3 box passes ≈ gaussian σ1.2)
  const blur: Float32Array[] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  for (let c = 0; c < 3; c++) {
    for (let pass = 0; pass < 2; pass++) {
      const cur = blur[c]
      const tmp = new Float32Array(n)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          const v = pass === 0 ? d[i * 4 + c] : cur[i]
          const xl = x > 0 ? (pass === 0 ? d[(i - 1) * 4 + c] : cur[i - 1]) : v
          const xr = x < w - 1 ? (pass === 0 ? d[(i + 1) * 4 + c] : cur[i + 1]) : v
          const yu = y > 0 ? (pass === 0 ? d[(i - w) * 4 + c] : cur[i - w]) : v
          const yd = y < h - 1 ? (pass === 0 ? d[(i + w) * 4 + c] : cur[i + w]) : v
          tmp[i] = (v + xl + xr + yu + yd) / 5
        }
      }
      cur.set(tmp)
    }
  }
  // edge-weighted unsharp
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const hi = d[i * 4 + c] - blur[c][i]
      // edge weight: strong response only where structure exists
      const edge = Math.min(1, Math.abs(hi) / 10)
      const gain = amt * (0.35 + 0.65 * edge)
      d[i * 4 + c] = Math.max(0, Math.min(255, d[i * 4 + c] + hi * gain * 1.35))
    }
  }
}

/** local smart upscale: denoise → Lanczos → detail (async, progress-reported, never mutates src) */
export async function upscaleSmart(
  src: HTMLCanvasElement, opts: UpscaleOptions
): Promise<HTMLCanvasElement> {
  const { scale } = opts
  const detail = opts.detail ?? 55
  const denoise = opts.denoise ?? 20
  const onProgress = opts.onProgress
  onProgress?.(0.02)
  let work = src
  if (denoise > 0) {
    work = cloneCanvas(src)
    const img = ctx2d(work).getImageData(0, 0, work.width, work.height)
    denoiseLight(img, denoise)
    ctx2d(work).putImageData(img, 0, 0)
    onProgress?.(0.08)
    await nextFrame()
  }
  const w = Math.max(1, Math.round(src.width * scale))
  const h = Math.max(1, Math.round(src.height * scale))
  const out = await lanczosResample(work, w, h, p => onProgress?.(p * 0.8))
  if (detail > 0) {
    await nextFrame()
    const img = ctx2d(out).getImageData(0, 0, w, h)
    enhanceDetail(img, detail)
    ctx2d(out).putImageData(img, 0, 0)
  }
  onProgress?.(1)
  return out
}

