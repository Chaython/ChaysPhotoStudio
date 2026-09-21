import { createCanvas, ctx2d, getImageData, putImageData, clamp } from '../utils/canvas'
import { applyFilter } from '../image-ops'

/** Lightweight local "depth-like" estimate for editing workflows.
 * It is intentionally deterministic and private: luminance, local gradient,
 * centre prior and alpha are fused into a grayscale map. Neural depth remains
 * available through ComfyUI/native providers. */
export function localDepthMap(src: HTMLCanvasElement): HTMLCanvasElement {
  const img = getImageData(src)
  const { width: w, height: h, data } = img
  const lum = new Float32Array(w * h)
  for (let i = 0, p = 0; p < lum.length; p++, i += 4) lum[p] = (data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722) / 255
  const out = new ImageData(w, h)
  const cx = (w - 1) / 2, cy = (h - 1) / 2
  const norm = Math.max(1, Math.hypot(cx, cy))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = p * 4
    const xm = Math.max(0, x - 1), xp = Math.min(w - 1, x + 1)
    const ym = Math.max(0, y - 1), yp = Math.min(h - 1, y + 1)
    const gx = lum[y * w + xp] - lum[y * w + xm]
    const gy = lum[yp * w + x] - lum[ym * w + x]
    const edge = Math.min(1, Math.hypot(gx, gy) * 2.4)
    const center = 1 - Math.min(1, Math.hypot(x - cx, y - cy) / norm)
    const alpha = data[i + 3] / 255
    // Bright, central, low-edge regions trend nearer. This is not metric depth;
    // it is an immediately useful editable mask for blur/relight workflows.
    const v = clamp(Math.round((lum[p] * .42 + center * .38 + (1 - edge) * .20) * alpha * 255), 0, 255)
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v
    out.data[i + 3] = 255
  }
  const c = createCanvas(w, h); putImageData(c, out); return c
}

/** Conservative one-click denoise: median rejects impulse/JPEG speckle while a
 * small Gaussian pass reduces chroma grit. Returned canvas is a new layer. */
export function localDenoise(src: HTMLCanvasElement, strength = 35): HTMLCanvasElement {
  const img = getImageData(src)
  const radius = strength < 34 ? 1 : strength < 68 ? 2 : 3
  applyFilter(img, 'median', { radius })
  if (strength > 55) applyFilter(img, 'gaussian-blur', { radius: Math.max(.4, (strength - 50) / 45) })
  const c = createCanvas(img.width, img.height); putImageData(c, img); return c
}

/** Relight using a grayscale depth/mask map. Positive amount lifts foreground
 * and gently suppresses background; negative amount reverses the lighting. */
export function localRelight(src: HTMLCanvasElement, depth: HTMLCanvasElement, amount = 35): HTMLCanvasElement {
  const img = getImageData(src), dep = getImageData(depth)
  const a = clamp(amount, -100, 100) / 100
  for (let i = 0; i < img.data.length; i += 4) {
    const d = dep.data[i] / 255
    const gain = 1 + (d - .45) * a * .9
    img.data[i] = clamp(Math.round(img.data[i] * gain), 0, 255)
    img.data[i + 1] = clamp(Math.round(img.data[i + 1] * gain), 0, 255)
    img.data[i + 2] = clamp(Math.round(img.data[i + 2] * gain), 0, 255)
  }
  const c = createCanvas(img.width, img.height); putImageData(c, img); return c
}

/** Raster-to-vector helper output: quantized high-contrast edge mask suitable
 * for Select & Mask or tracing with the Pen tool. */
export function localVectorGuide(src: HTMLCanvasElement): HTMLCanvasElement {
  const img = getImageData(src), { width: w, height: h, data } = img
  const out = new ImageData(w, h)
  const l = (x:number,y:number) => { const i=(clamp(y,0,h-1)*w+clamp(x,0,w-1))*4; return data[i]*.299+data[i+1]*.587+data[i+2]*.114 }
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const gx = -l(x-1,y-1)-2*l(x-1,y)-l(x-1,y+1)+l(x+1,y-1)+2*l(x+1,y)+l(x+1,y+1)
    const gy = -l(x-1,y-1)-2*l(x,y-1)-l(x+1,y-1)+l(x-1,y+1)+2*l(x,y+1)+l(x+1,y+1)
    const v = Math.hypot(gx,gy) > 120 ? 255 : 0, i=(y*w+x)*4
    out.data[i]=out.data[i+1]=out.data[i+2]=v; out.data[i+3]=255
  }
  const c=createCanvas(w,h); putImageData(c,out); return c
}
