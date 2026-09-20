import { createCanvas, ctx2d, getImageData, putImageData, clamp, rgbToHsv, hsvToRgb } from '../utils/canvas'
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


/** Local portrait/detail restoration assist. This is deliberately not marketed
 * as a neural face model: it uses skin/chroma likelihood, flat-region denoise
 * and edge-aware high-frequency recovery. The result is returned as a new
 * editable layer so users can mask/blend it, or replace it with a ComfyUI face
 * restoration workflow when a neural model is desired. */
export function localPortraitRestore(src: HTMLCanvasElement, strength = 55): HTMLCanvasElement {
  const amount = clamp(strength, 0, 100) / 100
  const original = getImageData(src)
  const cleanCanvas = localDenoise(src, 24 + amount * 18)
  const clean = getImageData(cleanCanvas)
  const blurCanvas = createCanvas(src.width, src.height)
  ctx2d(blurCanvas).drawImage(src, 0, 0)
  const blur = getImageData(blurCanvas)
  applyFilter(blur, 'gaussian-blur', { radius: 1.1 + amount * .9 })

  const out = new ImageData(original.width, original.height)
  const od = original.data, cd = clean.data, bd = blur.data, d = out.data
  for (let i = 0; i < od.length; i += 4) {
    const r = od[i], g = od[i + 1], b = od[i + 2], alpha = od[i + 3]
    if (!alpha) continue
    // Broad YCbCr skin likelihood. This is intentionally permissive so the
    // assist also recovers hair/eyes adjacent to faces instead of drawing a
    // hard semantic face mask.
    const cb = 128 - .168736 * r - .331264 * g + .5 * b
    const cr = 128 + .5 * r - .418688 * g - .081312 * b
    const skin = clamp(1 - Math.max(Math.abs(cb - 105) / 42, Math.abs(cr - 150) / 48), 0, 1)
    const lum = r * .2126 + g * .7152 + b * .0722
    const detail = Math.abs(r - bd[i]) + Math.abs(g - bd[i + 1]) + Math.abs(b - bd[i + 2])
    const edge = clamp(detail / 70, 0, 1)
    const portraitWeight = clamp(.22 + skin * .62 + edge * .25, 0, 1)

    // Flat regions lean toward the denoised source; edges pull restored
    // high-frequency detail from the original against a small Gaussian base.
    const smoothWeight = amount * portraitWeight * (1 - edge) * .48
    const detailBoost = amount * portraitWeight * (.45 + edge * .85)
    for (let ch = 0; ch < 3; ch++) {
      const base = od[i + ch] * (1 - smoothWeight) + cd[i + ch] * smoothWeight
      const hi = od[i + ch] - bd[i + ch]
      d[i + ch] = clamp(Math.round(base + hi * detailBoost), 0, 255)
    }

    // Gentle eye/hair micro-contrast: darker portrait details remain defined.
    if (lum < 105 && portraitWeight > .35) {
      const k = 1 - amount * portraitWeight * .035
      d[i] = clamp(Math.round(d[i] * k), 0, 255)
      d[i + 1] = clamp(Math.round(d[i + 1] * k), 0, 255)
      d[i + 2] = clamp(Math.round(d[i + 2] * k), 0, 255)
    }
    d[i + 3] = alpha
  }
  const result = createCanvas(out.width, out.height)
  putImageData(result, out)
  return result
}

/** Deterministic offline colorization assist for grayscale/low-chroma images.
 * Existing color is preserved; low-chroma pixels receive a restrained
 * luminance/spatial split-tone prior. It is useful as a starting layer rather
 * than pretending to infer semantic object colors like a neural model. */
export function localColorize(src: HTMLCanvasElement, strength = 58): HTMLCanvasElement {
  const img = getImageData(src)
  const { width: w, height: h, data } = img
  const mix = clamp(strength, 0, 100) / 100

  for (let y = 0; y < h; y++) {
    const yn = h > 1 ? y / (h - 1) : .5
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (!data[i + 3]) continue
      const [oh, os, ov] = rgbToHsv(data[i], data[i + 1], data[i + 2])
      // Leave already-colored pixels mostly alone; this makes the tool useful
      // on partially colorized/restored scans as well as true monochrome.
      const lowChroma = clamp(1 - os / 24, 0, 1)
      if (lowChroma <= .01) continue

      // Spatial/luminance prior: upper bright regions trend cool (sky-like),
      // midtones trend warm, and deep shadows get a subtle cool bias.
      let hue: number
      if (ov < 28) hue = 218
      else if (yn < .42 && ov > 58) hue = 205 + (1 - yn / .42) * 12
      else if (ov > 76) hue = 44
      else hue = 28 + (ov / 100) * 12

      const sat = clamp(10 + (1 - Math.abs(ov - 58) / 58) * 20 + (yn < .35 ? 5 : 0), 7, 34)
      const [rr, gg, bb] = hsvToRgb(hue, sat, ov)
      const a = mix * lowChroma
      data[i] = Math.round(data[i] * (1 - a) + rr * a)
      data[i + 1] = Math.round(data[i + 1] * (1 - a) + gg * a)
      data[i + 2] = Math.round(data[i + 2] * (1 - a) + bb * a)

      // If the source already had a hint of color, retain its hue by mixing
      // back a small HSV reconstruction rather than washing it out.
      if (os > 2) {
        const [or, og, ob] = hsvToRgb(oh, os, ov)
        const keep = clamp(os / 24, 0, 1) * .55
        data[i] = Math.round(data[i] * (1 - keep) + or * keep)
        data[i + 1] = Math.round(data[i + 1] * (1 - keep) + og * keep)
        data[i + 2] = Math.round(data[i + 2] * (1 - keep) + ob * keep)
      }
    }
  }

  const out = createCanvas(w, h)
  putImageData(out, img)
  return out
}
