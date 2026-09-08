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
//  - upscaleSmart: full local pipeline (denoise → Lanczos → detail)
//    with progress + cooperative yielding
//  - cloudUpscaleViaApi: calls the /api/ai-upscale backend (z-ai SDK
//    image edit model) for a neural detail pass, then Lanczos-fits
//    the result to the exact target dimensions
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

// ---------- cloud (neural) upscale via backend SDK ----------

export interface CloudUpscaleResult { canvas: HTMLCanvasElement; backendWidth: number; backendHeight: number }

/** pick the SDK-supported output size closest to the target aspect.
 * NOTE: dimensions must be multiples of 32 (upstream error 1214 rejects
 * 720) — 2:1/1:2 use 1472x736/736x1472. */
export function nearestBackendSize(aspect: number): string {
  const sizes: [string, number][] = [
    ['1024x1024', 1], ['768x1344', 768 / 1344], ['864x1152', 864 / 1152],
    ['1344x768', 1344 / 768], ['1152x864', 1152 / 864], ['1472x736', 2], ['736x1472', 0.5],
  ]
  let best = sizes[0], bestD = Infinity
  for (const s of sizes) {
    const dd = Math.abs(Math.log(aspect / s[1]))
    if (dd < bestD) { bestD = dd; best = s }
  }
  return best[0]
}

/** true when the neural backend's native output is strictly larger than the
 *  source in BOTH dimensions — i.e. it can genuinely add real pixels. The
 *  image-edit model emits fixed 720–1440 px outputs, so sources already at or
 *  above that size get re-fit (Lanczos) instead of truly enlarged. */
export function backendCanEnlarge(srcW: number, srcH: number): boolean {
  const [bw, bh] = nearestBackendSize(srcW / srcH).split('x').map(Number)
  return bw > srcW && bh > srcH
}

/**
 * Neural enhance: POST the composite to /api/ai-upscale (z-ai SDK image-edit),
 * then Lanczos-fit the returned image to the exact target size + local detail pass.
 */
export async function cloudUpscale(
  src: HTMLCanvasElement, opts: UpscaleOptions & { maxUpload?: number }
): Promise<CloudUpscaleResult> {
  const maxUpload = opts.maxUpload ?? 1152
  onProgressInfo?.('Preparing image for neural engine…')
  // 1) cap upload size (keep aspect)
  let upload = src
  const m = Math.max(src.width, src.height)
  if (m > maxUpload) {
    const k = maxUpload / m
    upload = createCanvas(Math.round(src.width * k), Math.round(src.height * k))
    const uc = ctx2d(upload)
    uc.imageSmoothingQuality = 'high'
    uc.drawImage(src, 0, 0, upload.width, upload.height)
  }
  // lossless PNG upload — a JPEG re-encode here would bake compression
  // artifacts into the source before the neural pass amplifies them.
  // (Route caps the request body at 8 MB; only fall back to high-quality
  // JPEG for pathological PNG payloads that wouldn't fit.)
  let dataUrl = upload.toDataURL('image/png')
  if (dataUrl.length > 7_000_000) dataUrl = upload.toDataURL('image/jpeg', 0.95)
  opts.onProgress?.(0.08)

  onProgressInfo?.('Neural engine is enhancing details…')
  const sizeStr = nearestBackendSize(src.width / src.height)
  const res = await fetch('/api/ai-upscale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl, size: sizeStr }),
  })
  opts.onProgress?.(0.55)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(err.error || `Upscale service error ${res.status}`)
  }
  const json = await res.json() as { image: string }
  opts.onProgress?.(0.62)

  // 2) load returned image
  const blob = await (await fetch(json.image)).blob()
  const bmp = await createImageBitmap(blob)
  const returned = createCanvas(bmp.width, bmp.height)
  ctx2d(returned).drawImage(bmp, 0, 0)
  bmp.close()
  opts.onProgress?.(0.68)

  // 3) Lanczos-fit to exact target + detail
  onProgressInfo?.('Fitting result to target resolution…')
  const w = Math.max(1, Math.round(src.width * opts.scale))
  const h = Math.max(1, Math.round(src.height * opts.scale))
  const fitted = await lanczosResample(returned, w, h, p => opts.onProgress?.(0.68 + p * 0.28))
  if ((opts.detail ?? 55) > 0) {
    const img = ctx2d(fitted).getImageData(0, 0, w, h)
    enhanceDetail(img, (opts.detail ?? 55) * 0.6) // gentler — neural pass already adds detail
    ctx2d(fitted).putImageData(img, 0, 0)
  }
  onProgressInfo?.(null)
  opts.onProgress?.(1)
  return { canvas: fitted, backendWidth: returned.width, backendHeight: returned.height }
}

/** status hook for dialogs (set by the AI Upscale dialog) */
let onProgressInfo: ((label: string | null) => void) | null = null
export function setUpscaleStatusHook(fn: ((label: string | null) => void) | null) {
  onProgressInfo = fn
}
