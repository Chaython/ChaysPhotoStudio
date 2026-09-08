// ============================================================
// FILTERS registry — production-quality filter implementations.
// Every entry keeps a `controls` schema + `defaults` and mutates
// ImageData in place. Pure functions — no DOM / engine imports.
// ============================================================

import type { FilterDef, FilterType } from '../types'
import { clamp } from '../utils/canvas'
import { luma } from './color'
import { mulberry32, smoothRamp } from './interp'
import { blurImageData, boxBlurFloat, sobel } from './blur'

// ---------------------------------------------------------------- helpers

/** bilinear RGB sample from a raw RGBA buffer (clamped edges) */
function bilinearRGB(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: number[]): void {
  if (x < 0) x = 0
  if (y < 0) y = 0
  if (x > w - 1) x = w - 1
  if (y > h - 1) y = h - 1
  const x0 = x | 0, y0 = y | 0
  const x1 = x0 + 1 < w ? x0 + 1 : x0
  const y1 = y0 + 1 < h ? y0 + 1 : y0
  const fx = x - x0, fy = y - y0
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4
  const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4
  for (let c = 0; c < 3; c++) {
    const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx
    const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx
    out[c] = top * (1 - fy) + bot * fy
  }
}

/** luma field of an image as Float32 (0..255) */
function lumaField(img: ImageData): Float32Array {
  const { width: w, height: h, data } = img
  const out = new Float32Array(w * h)
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
  }
  return out
}

// ---------------------------------------------------------------- median
/**
 * Median filter with a sliding two-level histogram (Huang's algorithm,
 * 16+16 bins): O(1) median lookup per pixel instead of sorting each
 * window. Runs on all three channels simultaneously.
 */
function medianFilter(img: ImageData, radius: number): void {
  const { width: w, height: h, data } = img
  const r = Math.min(12, Math.max(1, Math.round(radius)))
  const win = 2 * r + 1
  const src = new Uint8ClampedArray(data)
  const K = win * win
  const half = (K + 1) >> 1
  const coarse = [new Uint32Array(16), new Uint32Array(16), new Uint32Array(16)]
  const fine = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]

  for (let y = 0; y < h; y++) {
    // rebuild the window histogram at x = 0 (clamped columns)
    for (let c = 0; c < 3; c++) { coarse[c].fill(0); fine[c].fill(0) }
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy < 0 ? 0 : y + dy > h - 1 ? h - 1 : y + dy
      for (let dx = -r; dx <= r; dx++) {
        const xx = dx < 0 ? 0 : dx
        const i = (yy * w + xx) * 4
        coarse[0][src[i] >> 4]++; fine[0][src[i]]++
        coarse[1][src[i + 1] >> 4]++; fine[1][src[i + 1]]++
        coarse[2][src[i + 2] >> 4]++; fine[2][src[i + 2]]++
      }
    }
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        // walk coarse bins to the one holding the median, then its 16 fine bins
        let acc = 0
        let med = 255
        for (let b = 0; b < 16; b++) {
          const cnt = coarse[c][b]
          if (cnt === 0) continue
          if (acc + cnt >= half) {
            const base = b << 4
            for (let v = base; v < base + 16; v++) {
              acc += fine[c][v]
              if (acc >= half) { med = v; break }
            }
            break
          }
          acc += cnt
        }
        data[(y * w + x) * 4 + c] = med
      }
      if (x + 1 < w) {
        // slide window right: drop clamped column x-r, add clamped column x+r+1
        const colOut = x - r < 0 ? 0 : x - r
        const colIn = x + r + 1 > w - 1 ? w - 1 : x + r + 1
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy < 0 ? 0 : y + dy > h - 1 ? h - 1 : y + dy
          const iO = (yy * w + colOut) * 4
          coarse[0][src[iO] >> 4]--; fine[0][src[iO]]--
          coarse[1][src[iO + 1] >> 4]--; fine[1][src[iO + 1]]--
          coarse[2][src[iO + 2] >> 4]--; fine[2][src[iO + 2]]--
          const iI = (yy * w + colIn) * 4
          coarse[0][src[iI] >> 4]++; fine[0][src[iI]]++
          coarse[1][src[iI + 1] >> 4]++; fine[1][src[iI + 1]]++
          coarse[2][src[iI + 2] >> 4]++; fine[2][src[iI + 2]]++
        }
      }
    }
  }
}

// ---------------------------------------------------------------- morphology (minimum / maximum)
function minMaxFilter(img: ImageData, radius: number, isMax: boolean, round: boolean): void {
  const { width: w, height: h, data } = img
  const r = Math.min(50, Math.max(1, Math.round(radius)))
  if (!round) {
    // separable rectangular morphology: two O(r) passes per channel
    const src = new Uint8ClampedArray(data)
    const tmp = new Uint8ClampedArray(data)
    for (let c = 0; c < 3; c++) {
      // horizontal
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let v = isMax ? 0 : 255
          const lo = Math.max(0, x - r), hi = Math.min(w - 1, x + r)
          for (let xx = lo; xx <= hi; xx++) {
            const s = src[(y * w + xx) * 4 + c]
            if (isMax ? s > v : s < v) v = s
          }
          tmp[(y * w + x) * 4 + c] = v
        }
      }
      // vertical
      for (let y = 0; y < h; y++) {
        const lo = Math.max(0, y - r), hi = Math.min(h - 1, y + r)
        for (let x = 0; x < w; x++) {
          let v = isMax ? 0 : 255
          for (let yy = lo; yy <= hi; yy++) {
            const s = tmp[(yy * w + x) * 4 + c]
            if (isMax ? s > v : s < v) v = s
          }
          data[(y * w + x) * 4 + c] = v
        }
      }
    }
    return
  }
  // circular structuring element: per-pixel scan over column extents;
  // stride widens for big radii to keep it interactive
  const src = new Uint8ClampedArray(data)
  const stride = r <= 12 ? 1 : Math.ceil(r / 12)
  const extents: number[] = []
  for (let dx = -r; dx <= r; dx += 1) extents.push(Math.floor(Math.sqrt(r * r - dx * dx)))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let v = isMax ? 0 : 255
        for (let k = 0; k < extents.length; k += stride) {
          const dx = -r + k
          const xx = x + dx < 0 ? 0 : x + dx > w - 1 ? w - 1 : x + dx
          const dyMax = extents[k]
          for (let dy = -dyMax; dy <= dyMax; dy += 1) {
            const yy = y + dy < 0 ? 0 : y + dy > h - 1 ? h - 1 : y + dy
            const s = src[(yy * w + xx) * 4 + c]
            if (isMax ? s > v : s < v) v = s
          }
        }
        data[(y * w + x) * 4 + c] = v
      }
    }
  }
}

// ================================================================ registry
// Task 9-b: annotated Partial — image-ops/index.ts merges this with FILTERS2
// (filters2.ts) into the complete Record<FilterType, FilterDef> that every
// consumer imports from the index. All consumers access the merged record.
export const FILTERS: Partial<Record<FilterType, FilterDef>> = {

  // ---------------------------------------------------------------- blur
  'gaussian-blur': {
    type: 'gaussian-blur', label: 'Gaussian Blur', group: 'blur',
    controls: [{ key: 'radius', label: 'Radius', type: 'slider', min: 0.1, max: 250, step: 0.5, unit: 'px' }],
    defaults: { radius: 4 },
    apply(img, p) {
      // 3 box passes sized to match a true gaussian (Kovesi decomposition)
      blurImageData(img, p.radius ?? 4)
    },
  },

  'box-blur': {
    type: 'box-blur', label: 'Box Blur', group: 'blur',
    controls: [{ key: 'radius', label: 'Radius', type: 'slider', min: 1, max: 250, step: 1, unit: 'px' }],
    defaults: { radius: 4 },
    apply(img, p) {
      const r = Math.round(p.radius ?? 4)
      if (r < 1) return
      const { width: w, height: h, data } = img
      const ch = new Float32Array(w * h)
      for (let c = 0; c < 3; c++) {
        for (let i = 0, j = c; i < ch.length; i++, j += 4) ch[i] = data[j]
        boxBlurFloat(ch, w, h, r)
        for (let i = 0, j = c; i < ch.length; i++, j += 4) data[j] = ch[i]
      }
    },
  },

  'motion-blur': {
    type: 'motion-blur', label: 'Motion Blur', group: 'blur',
    controls: [
      { key: 'angle', label: 'Angle', type: 'angle' },
      { key: 'distance', label: 'Distance', type: 'slider', min: 1, max: 500, step: 1, unit: 'px' },
    ],
    defaults: { angle: 0, distance: 20 },
    apply(img, p) {
      const dist = clamp(p.distance ?? 20, 1, 999)
      const rad = ((p.angle ?? 0) * Math.PI) / 180
      const dx = Math.cos(rad), dy = -Math.sin(rad)
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      // sub-pixel taps along the segment; cap tap count for interactivity
      const taps = Math.max(4, Math.min(72, Math.round(dist)))
      const step = dist / (taps - 1)
      const half = dist / 2
      const inv = 1 / taps
      const rgb = [0, 0, 0]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0
          const sx0 = x - dx * half, sy0 = y - dy * half
          for (let t = 0; t < taps; t++) {
            bilinearRGB(src, w, h, sx0 + dx * step * t, sy0 + dy * step * t, rgb)
            r += rgb[0]; g += rgb[1]; b += rgb[2]
          }
          const o = (y * w + x) * 4
          data[o] = r * inv
          data[o + 1] = g * inv
          data[o + 2] = b * inv
        }
      }
    },
  },

  'radial-blur': {
    type: 'radial-blur', label: 'Radial Blur', group: 'blur',
    controls: [
      { key: 'amount', label: 'Amount', type: 'slider', min: 1, max: 100, step: 1 },
      { key: 'method', label: 'Method', type: 'select', options: [{ label: 'Spin', value: 'spin' }, { label: 'Zoom', value: 'zoom' }] },
      { key: 'quality', label: 'Quality', type: 'select', options: [{ label: 'Draft', value: 'draft' }, { label: 'Good', value: 'good' }, { label: 'Best', value: 'best' }] },
    ],
    defaults: { amount: 20, method: 'spin', quality: 'good' },
    apply(img, p) {
      const amount = clamp(p.amount ?? 20, 1, 100) / 100
      const zoom = p.method === 'zoom'
      const n = p.quality === 'best' ? 28 : p.quality === 'draft' ? 8 : 16
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      const cx = w / 2, cy = h / 2
      const totalAng = amount * 1.7      // spin: max ~±49°
      const zoomExp = amount * 2.2       // zoom: geometric scale spread
      const rgb = [0, 0, 0]
      const inv = 1 / n
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = x - cx, dy = y - cy
          let r = 0, g = 0, b = 0
          for (let s = 0; s < n; s++) {
            const t = s * inv - 0.5
            let sx: number, sy: number
            if (zoom) {
              const sc = Math.pow(2, t * zoomExp)
              sx = cx + dx * sc
              sy = cy + dy * sc
            } else {
              const a = t * totalAng
              const ca = Math.cos(a), sa = Math.sin(a)
              sx = cx + dx * ca - dy * sa
              sy = cy + dx * sa + dy * ca
            }
            bilinearRGB(src, w, h, sx, sy, rgb)
            r += rgb[0]; g += rgb[1]; b += rgb[2]
          }
          const o = (y * w + x) * 4
          data[o] = r * inv
          data[o + 1] = g * inv
          data[o + 2] = b * inv
        }
      }
    },
  },

  // ---------------------------------------------------------------- sharpen
  'smart-sharpen': {
    type: 'smart-sharpen', label: 'Unsharp Mask', group: 'sharpen',
    controls: [
      { key: 'amount', label: 'Amount', type: 'slider', min: 0, max: 300, step: 1, unit: '%' },
      { key: 'radius', label: 'Radius', type: 'slider', min: 0.5, max: 50, step: 0.5, unit: 'px' },
      { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 100, step: 1 },
    ],
    defaults: { amount: 80, radius: 2, threshold: 2 },
    apply(img, p) {
      const amount = (p.amount ?? 80) / 100
      const radius = p.radius ?? 2
      const threshold = p.threshold ?? 2
      const orig = new Uint8ClampedArray(img.data)
      const blur = new ImageData(img.width, img.height)
      blur.data.set(orig)
      blurImageData(blur, radius)
      const d = img.data, bd = blur.data
      // halo guard: cap the sharpening delta near the value extremes
      const cap = 90 + radius * 4
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const diff = orig[i + c] - bd[i + c]
          const mag = Math.abs(diff)
          if (mag <= threshold) continue
          // soft knee over the threshold so the transition isn't banded
          const knee = smoothRamp(mag, threshold, threshold + 6)
          let add = diff * amount * knee
          if (add > cap) add = cap
          else if (add < -cap) add = -cap
          d[i + c] = clamp(orig[i + c] + add, 0, 255)
        }
      }
    },
  },

  // ---------------------------------------------------------------- noise
  'add-noise': {
    type: 'add-noise', label: 'Add Noise', group: 'noise',
    controls: [
      { key: 'amount', label: 'Amount', type: 'slider', min: 0.1, max: 400, step: 0.5, unit: '%' },
      { key: 'distribution', label: 'Distribution', type: 'select', options: [{ label: 'Uniform', value: 'uniform' }, { label: 'Gaussian', value: 'gaussian' }] },
      { key: 'monochromatic', label: 'Monochromatic', type: 'toggle' },
    ],
    defaults: { amount: 12, distribution: 'uniform', monochromatic: false },
    apply(img, p) {
      const amt = ((p.amount ?? 12) / 100) * 127
      const gauss = p.distribution === 'gaussian'
      const mono = p.monochromatic === true
      const d = img.data
      const box = () => {
        // Box–Muller for gaussian; ±amt for uniform
        if (!gauss) return (Math.random() * 2 - 1) * amt
        let u = 0, v = 0
        while (u <= 1e-7) u = Math.random()
        while (v <= 1e-7) v = Math.random()
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * amt * 0.42
      }
      for (let i = 0; i < d.length; i += 4) {
        if (mono) {
          const n = box()
          d[i] = clamp(d[i] + n, 0, 255)
          d[i + 1] = clamp(d[i + 1] + n, 0, 255)
          d[i + 2] = clamp(d[i + 2] + n, 0, 255)
        } else {
          d[i] = clamp(d[i] + box(), 0, 255)
          d[i + 1] = clamp(d[i + 1] + box(), 0, 255)
          d[i + 2] = clamp(d[i + 2] + box(), 0, 255)
        }
      }
    },
  },

  'median': {
    type: 'median', label: 'Median', group: 'noise',
    controls: [{ key: 'radius', label: 'Radius', type: 'slider', min: 1, max: 10, step: 1, unit: 'px' }],
    defaults: { radius: 2 },
    apply(img, p) { medianFilter(img, p.radius ?? 2) },
  },

  'dust-scratches': {
    type: 'dust-scratches', label: 'Dust & Scratches', group: 'noise',
    controls: [
      { key: 'radius', label: 'Radius', type: 'slider', min: 1, max: 5, step: 1, unit: 'px' },
      { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 100, step: 1 },
    ],
    defaults: { radius: 2, threshold: 10 },
    apply(img, p) {
      const orig = new Uint8ClampedArray(img.data)
      medianFilter(img, p.radius ?? 2)
      const th = p.threshold ?? 10
      const d = img.data
      // only keep the median where it differs enough (dust) — protect texture
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          if (Math.abs(d[i + c] - orig[i + c]) < th) d[i + c] = orig[i + c]
        }
      }
    },
  },

  // ---------------------------------------------------------------- pixelate
  'mosaic': {
    type: 'mosaic', label: 'Mosaic (Pixelate)', group: 'pixelate',
    controls: [{ key: 'size', label: 'Cell Size', type: 'slider', min: 2, max: 200, step: 1, unit: 'px' }],
    defaults: { size: 12 },
    apply(img, p) {
      const s = Math.max(2, Math.round(p.size ?? 12))
      const { width: w, height: h, data } = img
      for (let y = 0; y < h; y += s) {
        for (let x = 0; x < w; x += s) {
          let r = 0, g = 0, b = 0, a = 0, n = 0
          const yEnd = Math.min(y + s, h), xEnd = Math.min(x + s, w)
          for (let yy = y; yy < yEnd; yy++) {
            for (let xx = x; xx < xEnd; xx++) {
              const i = (yy * w + xx) * 4
              r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3]; n++
            }
          }
          r /= n; g /= n; b /= n; a /= n
          for (let yy = y; yy < yEnd; yy++) {
            for (let xx = x; xx < xEnd; xx++) {
              const i = (yy * w + xx) * 4
              data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a
            }
          }
        }
      }
    },
  },

  'crystallize': {
    type: 'crystallize', label: 'Crystallize', group: 'pixelate',
    controls: [{ key: 'size', label: 'Cell Size', type: 'slider', min: 3, max: 200, step: 1, unit: 'px' }],
    defaults: { size: 20 },
    apply(img, p) {
      const s = Math.max(3, Math.round(p.size ?? 20))
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      const cols = Math.max(1, Math.ceil(w / s))
      const rows = Math.max(1, Math.ceil(h / s))
      // deterministic jittered grid — one seed per cell (Voronoi sites)
      const rand = mulberry32(0x9e3779b9 ^ (w * 31 + h * 17 + s))
      const seedX = new Float32Array(cols * rows)
      const seedY = new Float32Array(cols * rows)
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const i = cy * cols + cx
          seedX[i] = cx * s + rand() * s
          seedY[i] = cy * s + rand() * s
        }
      }
      // toroidal (wraparound) delta so edge cells see neighbors across the seam
      const wrapDx = (dx: number) => {
        if (dx > w * 0.5) dx -= w
        else if (dx < -w * 0.5) dx += w
        return dx
      }
      const wrapDy = (dy: number) => {
        if (dy > h * 0.5) dy -= h
        else if (dy < -h * 0.5) dy += h
        return dy
      }
      for (let y = 0; y < h; y++) {
        const gy = Math.floor(y / s)
        for (let x = 0; x < w; x++) {
          const gx = Math.floor(x / s)
          let best = -1
          let bestD = Infinity
          for (let oy = -1; oy <= 1; oy++) {
            // wrapped cell lookup
            const sy = ((gy + oy) % rows + rows) % rows
            for (let ox = -1; ox <= 1; ox++) {
              const sx = ((gx + ox) % cols + cols) % cols
              const si = sy * cols + sx
              const dx = wrapDx(x - seedX[si])
              const dy = wrapDy(y - seedY[si])
              const dd = dx * dx + dy * dy
              if (dd < bestD) { bestD = dd; best = si }
            }
          }
          const bx = Math.min(w - 1, Math.max(0, Math.round(seedX[best])))
          const by = Math.min(h - 1, Math.max(0, Math.round(seedY[best])))
          const si = (by * w + bx) * 4
          const o = (y * w + x) * 4
          data[o] = src[si]; data[o + 1] = src[si + 1]; data[o + 2] = src[si + 2]; data[o + 3] = src[si + 3]
        }
      }
    },
  },

  // ---------------------------------------------------------------- stylize
  'find-edges': {
    type: 'find-edges', label: 'Find Edges', group: 'stylize',
    controls: [],
    defaults: {},
    apply(img) {
      // Sobel magnitude on luminance, grayscale output (bright edges on dark,
      // matching Photoshop's Stylize ▸ Find Edges result)
      const { width: w, height: h, data } = img
      const g = lumaField(img)
      const { gx, gy } = sobel(g, w, h)
      for (let i = 0; i < w * h; i++) {
        const mag = Math.min(255, Math.abs(gx[i]) + Math.abs(gy[i]))
        data[i * 4] = mag
        data[i * 4 + 1] = mag
        data[i * 4 + 2] = mag
      }
    },
  },

  'emboss': {
    type: 'emboss', label: 'Emboss', group: 'stylize',
    controls: [
      { key: 'angle', label: 'Angle', type: 'angle' },
      { key: 'height', label: 'Height', type: 'slider', min: 1, max: 10, step: 1 },
      { key: 'amount', label: 'Amount', type: 'slider', min: 1, max: 500, step: 1, unit: '%' },
    ],
    defaults: { angle: 135, height: 2, amount: 100 },
    apply(img, p) {
      const a = ((p.angle ?? 135) * Math.PI) / 180
      const dx = Math.cos(a), dy = -Math.sin(a)
      const hF = p.height ?? 2
      const amount = (p.amount ?? 100) / 100
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      const rgb = [0, 0, 0]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          bilinearRGB(src, w, h, x + dx * hF, y + dy * hF, rgb)
          const i = (y * w + x) * 4
          // directional difference on luminance, grayscale relief around 128
          const l0 = luma(src[i], src[i + 1], src[i + 2])
          const l1 = luma(rgb[0], rgb[1], rgb[2])
          const v = clamp(128 + (l0 - l1) * amount, 0, 255)
          data[i] = v; data[i + 1] = v; data[i + 2] = v
        }
      }
    },
  },

  'wind': {
    type: 'wind', label: 'Wind', group: 'stylize',
    controls: [
      { key: 'method', label: 'Method', type: 'select', options: [{ label: 'Wind', value: 'wind' }, { label: 'Stagger', value: 'stagger' }] },
      { key: 'direction', label: 'Direction', type: 'select', options: [{ label: 'From the Right', value: 'right' }, { label: 'From the Left', value: 'left' }] },
      { key: 'strength', label: 'Strength', type: 'slider', min: 1, max: 30, step: 1 },
    ],
    defaults: { method: 'wind', direction: 'right', strength: 8 },
    apply(img, p) {
      // Wind from the right blows leftward: streaks trail LEFT of edges.
      // Each pixel takes the color of the nearest strong edge upwind.
      const fromRight = p.direction !== 'left'
      const str = Math.round(clamp(p.strength ?? 8, 1, 40))
      const stagger = p.method === 'stagger'
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      const rowLuma = new Float32Array(w)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          rowLuma[x] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]
        }
        // gusts: staggered rows get longer/shorter streaks
        const gust = stagger ? (y % 4 === 0 ? str : y % 2 === 0 ? (str >> 1) + 1 : str) : str
        for (let x = 0; x < w; x++) {
          const dir = fromRight ? 1 : -1
          let best = -1
          const xEnd = dir > 0 ? Math.min(w - 1, x + gust) : Math.max(0, x - gust)
          for (let xx = x; xx !== xEnd + dir; xx += dir) {
            const xn = xx - dir
            if (xn < 0 || xn >= w) continue
            if (Math.abs(rowLuma[xx] - rowLuma[xn]) > 26) { best = xx; break }
          }
          const srcX = best >= 0 ? best : x
          const i = (y * w + x) * 4
          const j = (y * w + srcX) * 4
          data[i] = src[j]; data[i + 1] = src[j + 1]; data[i + 2] = src[j + 2]
        }
      }
    },
  },

  'oil-paint': {
    type: 'oil-paint', label: 'Oil Paint (Kuwahara)', group: 'stylize',
    controls: [
      { key: 'radius', label: 'Radius', type: 'slider', min: 1, max: 8, step: 1, unit: 'px' },
      { key: 'brush', label: 'Brush Detail', type: 'slider', min: 1, max: 4, step: 1 },
    ],
    defaults: { radius: 3, brush: 2 },
    apply(img, p) {
      // generalized Kuwahara: 4 quadrant windows, pick the one with the
      // lowest normalized luminance variance, output its mean color
      const r = Math.round(clamp(p.radius ?? 3, 1, 8))
      const sectors = Math.max(1, Math.min(4, Math.round(p.brush ?? 2))) // 1 = plain mean
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      const quads = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (sectors === 1) {
            // plain box mean
            let sr = 0, sg = 0, sb = 0, n = 0
            for (let dy = -r; dy <= r; dy++) {
              const yy = clamp(y + dy, 0, h - 1)
              for (let dx = -r; dx <= r; dx++) {
                const xx = clamp(x + dx, 0, w - 1)
                const i = (yy * w + xx) * 4
                sr += src[i]; sg += src[i + 1]; sb += src[i + 2]; n++
              }
            }
            const o = (y * w + x) * 4
            data[o] = sr / n; data[o + 1] = sg / n; data[o + 2] = sb / n
            continue
          }
          let bestVar = Infinity, bestR = 0, bestG = 0, bestB = 0
          for (const [qx, qy] of quads) {
            const x0 = qx < 0 ? x - r : x
            const x1 = qx < 0 ? x : x + r
            const y0 = qy < 0 ? y - r : y
            const y1 = qy < 0 ? y : y + r
            let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0, n = 0
            for (let yy = Math.max(0, y0); yy <= Math.min(h - 1, y1); yy++) {
              for (let xx = Math.max(0, x0); xx <= Math.min(w - 1, x1); xx++) {
                const i = (yy * w + xx) * 4
                const l = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]
                sr += src[i]; sg += src[i + 1]; sb += src[i + 2]
                sl += l; sl2 += l * l; n++
              }
            }
            if (n === 0) continue
            // normalized variance (per-pixel) so quadrant sizes don't bias
            const v = sl2 / n - (sl / n) * (sl / n)
            if (v < bestVar) {
              bestVar = v
              bestR = sr / n; bestG = sg / n; bestB = sb / n
            }
          }
          const o = (y * w + x) * 4
          data[o] = bestR; data[o + 1] = bestG; data[o + 2] = bestB
        }
      }
    },
  },

  // ---------------------------------------------------------------- other
  'high-pass': {
    type: 'high-pass', label: 'High Pass', group: 'other',
    controls: [{ key: 'radius', label: 'Radius', type: 'slider', min: 0.5, max: 100, step: 0.5, unit: 'px' }],
    defaults: { radius: 3 },
    apply(img, p) {
      const orig = new Uint8ClampedArray(img.data)
      blurImageData(img, p.radius ?? 3)
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) d[i + c] = clamp(orig[i + c] - d[i + c] + 128, 0, 255)
      }
    },
  },

  'custom-kernel': {
    type: 'custom-kernel', label: 'Custom (5×5 Convolution)', group: 'other',
    controls: [{ key: 'kernel', label: 'Kernel', type: 'custom', customId: 'kernel-editor' }],
    defaults: { kernel: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, -4, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], scale: 1, offset: 0 },
    apply(img, p) {
      const k: number[] = p.kernel ?? []
      const scale = p.scale ?? 1
      const offset = p.offset ?? 0
      if (k.length < 25 || scale === 0) return
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      const inv = 1 / scale
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0
          for (let ky = -2; ky <= 2; ky++) {
            const yy = y + ky < 0 ? 0 : y + ky > h - 1 ? h - 1 : y + ky
            for (let kx = -2; kx <= 2; kx++) {
              const kv = k[(ky + 2) * 5 + (kx + 2)]
              if (!kv) continue
              const xx = x + kx < 0 ? 0 : x + kx > w - 1 ? w - 1 : x + kx
              const i = (yy * w + xx) * 4
              r += src[i] * kv; g += src[i + 1] * kv; b += src[i + 2] * kv
            }
          }
          const o = (y * w + x) * 4
          data[o] = r * inv + offset
          data[o + 1] = g * inv + offset
          data[o + 2] = b * inv + offset
        }
      }
    },
  },

  'minimum': {
    type: 'minimum', label: 'Minimum', group: 'other',
    controls: [
      { key: 'radius', label: 'Radius', type: 'slider', min: 1, max: 50, step: 1, unit: 'px' },
      { key: 'shape', label: 'Shape', type: 'select', options: [{ label: 'Square', value: 'square' }, { label: 'Round', value: 'round' }] },
    ],
    defaults: { radius: 2, shape: 'round' },
    apply(img, p) { minMaxFilter(img, p.radius ?? 2, false, p.shape !== 'square') },
  },

  'maximum': {
    type: 'maximum', label: 'Maximum', group: 'other',
    controls: [
      { key: 'radius', label: 'Radius', type: 'slider', min: 1, max: 50, step: 1, unit: 'px' },
      { key: 'shape', label: 'Shape', type: 'select', options: [{ label: 'Square', value: 'square' }, { label: 'Round', value: 'round' }] },
    ],
    defaults: { radius: 2, shape: 'round' },
    apply(img, p) { minMaxFilter(img, p.radius ?? 2, true, p.shape !== 'square') },
  },

  // ---------------------------------------------------------------- distort
  'twirl': {
    type: 'twirl', label: 'Twirl', group: 'distort',
    controls: [
      { key: 'angle', label: 'Angle', type: 'angle' },
      { key: 'radius', label: 'Radius', type: 'slider', min: 10, max: 2000, step: 10, unit: 'px' },
    ],
    defaults: { angle: 50, radius: 300 },
    apply(img, p) {
      const angle = ((p.angle ?? 50) * Math.PI) / 180
      const radius = p.radius ?? 300
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      const cx = w / 2, cy = h / 2
      const rgb = [0, 0, 0]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = x - cx, dy = y - cy
          const d = Math.sqrt(dx * dx + dy * dy)
          let sx = x, sy = y
          if (d < radius) {
            // smooth falloff: full twist at center, none at the rim
            const t = 1 - d / radius
            const a = angle * t * t
            const ca = Math.cos(a), sa = Math.sin(a)
            sx = cx + dx * ca - dy * sa
            sy = cy + dx * sa + dy * ca
          }
          const o = (y * w + x) * 4
          bilinearRGB(src, w, h, sx, sy, rgb)
          data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]
        }
      }
    },
  },

  'wave': {
    type: 'wave', label: 'Wave', group: 'distort',
    controls: [
      { key: 'amplitude', label: 'Amplitude', type: 'slider', min: 1, max: 200, step: 1, unit: 'px' },
      { key: 'wavelength', label: 'Wavelength', type: 'slider', min: 4, max: 600, step: 1, unit: 'px' },
      { key: 'type', label: 'Type', type: 'select', options: [{ label: 'Sine', value: 'sine' }, { label: 'Triangle', value: 'triangle' }, { label: 'Square', value: 'square' }] },
    ],
    defaults: { amplitude: 20, wavelength: 120, type: 'sine' },
    apply(img, p) {
      const amp = p.amplitude ?? 20
      const wl = Math.max(2, p.wavelength ?? 120)
      const type = p.type ?? 'sine'
      // periodic oscillator, phase in cycles
      const osc = (phase: number) => {
        const t = phase - Math.floor(phase)
        if (type === 'triangle') return 4 * Math.abs(t - 0.5) - 1
        if (type === 'square') return t < 0.5 ? 1 : -1
        return Math.sin(t * Math.PI * 2)
      }
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      const rgb = [0, 0, 0]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = x + osc(y / wl) * amp
          const sy = y + osc(x / wl) * amp
          const o = (y * w + x) * 4
          bilinearRGB(src, w, h, sx, sy, rgb)
          data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]
        }
      }
    },
  },

  'spherize': {
    type: 'spherize', label: 'Spherize', group: 'distort',
    controls: [
      { key: 'amount', label: 'Amount', type: 'slider', min: -100, max: 100, step: 1, unit: '%' },
    ],
    defaults: { amount: 50 },
    apply(img, p) {
      const amt = (p.amount ?? 50) / 100
      const { width: w, height: h, data } = img
      const src = new Uint8ClampedArray(data)
      const cx = w / 2, cy = h / 2
      const R = Math.min(w, h) / 2
      const rgb = [0, 0, 0]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = (x - cx) / R, dy = (y - cy) / R
          const d = Math.sqrt(dx * dx + dy * dy)
          let sx = x, sy = y
          if (d < 1) {
            // positive: bulge (sample closer to center); negative: pinch
            const f = 1 - amt * (1 - d * d) * (1 - d * d * 0.35)
            sx = cx + dx * R * f
            sy = cy + dy * R * f
          }
          const o = (y * w + x) * 4
          bilinearRGB(src, w, h, sx, sy, rgb)
          data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]
        }
      }
    },
  },

  // ---------------------------------------------------------------- render
  'clouds': {
    type: 'clouds', label: 'Clouds', group: 'render',
    controls: [
      { key: 'scale', label: 'Scale', type: 'slider', min: 1, max: 10, step: 0.5 },
      { key: 'roughness', label: 'Roughness', type: 'slider', min: 0.2, max: 1, step: 0.05 },
      { key: 'color1', label: 'Color 1', type: 'color' },
      { key: 'color2', label: 'Color 2', type: 'color' },
    ],
    defaults: { scale: 4, roughness: 0.55, color1: '#000000', color2: '#ffffff' },
    apply(img, p) {
      const scale = Math.max(0.5, p.scale ?? 4)
      const rough = clamp(p.roughness ?? 0.55, 0.2, 1)
      const c1 = (p.color1 ?? '#000000').replace('#', '')
      const c2 = (p.color2 ?? '#ffffff').replace('#', '')
      const hx = (s: string, i: number) => parseInt(s.slice(i * 2, i * 2 + 2), 16) || 0
      const r1 = hx(c1, 0), g1 = hx(c1, 1), b1 = hx(c1, 2)
      const r2 = hx(c2, 0), g2 = hx(c2, 1), b2 = hx(c2, 2)
      const { width: w, height: h, data } = img
      // multi-octave (fBm) value noise on a wrapping lattice — seamless clouds
      const OCTAVES = 6
      const grids: Float32Array[] = []
      const sizes: number[] = []
      let gN = 8
      for (let o = 0; o < OCTAVES; o++) {
        const g = new Float32Array((gN + 1) * (gN + 1))
        for (let i = 0; i < g.length; i++) g[i] = Math.random()
        grids.push(g)
        sizes.push(gN)
        gN *= 2
      }
      // amplitude series from roughness (0 = smooth, 1 = full detail)
      const persistence = 0.45 + rough * 0.35
      let ampSum = 0
      const amps: number[] = []
      for (let o = 0; o < OCTAVES; o++) {
        const a = Math.pow(persistence, o)
        amps.push(a)
        ampSum += a
      }
      const base = 1 / scale
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let v = 0
          for (let o = 0; o < OCTAVES; o++) {
            const grid = grids[o]
            const n = sizes[o]
            const fx = (x / w) * base * n
            const fy = (y / h) * base * n
            const x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n
            const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy)
            const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
            const i00 = y0 * (n + 1) + x0
            const g00 = grid[i00], g10 = grid[i00 + 1]
            const g01 = grid[i00 + n + 1], g11 = grid[i00 + n + 2]
            const top = g00 * (1 - sx) + g10 * sx
            const bot = g01 * (1 - sx) + g11 * sx
            v += (top * (1 - sy) + bot * sy) * amps[o]
          }
          v = clamp(v / ampSum * 1.35, 0, 1)
          const i = (y * w + x) * 4
          data[i] = r1 + (r2 - r1) * v
          data[i + 1] = g1 + (g2 - g1) * v
          data[i + 2] = b1 + (b2 - b1) * v
          data[i + 3] = 255
        }
      }
    },
  },

  'lens-flare': {
    type: 'lens-flare', label: 'Lens Flare', group: 'render',
    controls: [
      { key: 'brightness', label: 'Brightness', type: 'slider', min: 10, max: 300, step: 1, unit: '%' },
      { key: 'x', label: 'Center X', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'y', label: 'Center Y', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    ],
    defaults: { brightness: 100, x: 35, y: 35 },
    apply(img, p) {
      const { width: w, height: h, data } = img
      const cx = ((p.x ?? 35) / 100) * w
      const cy = ((p.y ?? 35) / 100) * h
      const br = (p.brightness ?? 100) / 100
      const R = Math.hypot(w, h)
      // ghost orbs along the flare axis (through the image center)
      const vx = w / 2 - cx, vy = h / 2 - cy
      const ghosts = [
        { t: -0.35, r: 0.055, i: 40, tint: [0.9, 0.95, 1.0] },
        { t: 0.10, r: 0.028, i: 55, tint: [1.0, 0.9, 0.8] },
        { t: 0.34, r: 0.042, i: 45, tint: [0.85, 0.95, 1.0] },
        { t: 0.58, r: 0.065, i: 32, tint: [1.0, 0.85, 0.75] },
        { t: 0.82, r: 0.035, i: 50, tint: [0.9, 1.0, 0.95] },
        { t: 1.15, r: 0.080, i: 26, tint: [0.95, 0.9, 1.0] },
      ]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = x - cx, dy = y - cy
          const d = Math.sqrt(dx * dx + dy * dy)
          const i = (y * w + x) * 4
          let ar = 0, ag = 0, ab = 0
          // core hotspot (gaussian)
          const core = Math.exp(-d / (R * 0.022))
          ar += core * 255 * br * 1.5; ag += core * 255 * br * 1.5; ab += core * 250 * br * 1.45
          // wide ambient glow
          const glow = Math.exp(-d / (R * 0.11))
          ar += glow * 70 * br; ag += glow * 68 * br; ab += glow * 78 * br
          // ring halo
          const ring = Math.exp(-(((d - R * 0.05) / (R * 0.012)) ** 2))
          ar += ring * 45 * br; ag += ring * 45 * br; ab += ring * 55 * br
          // horizontal anamorphic streak (wide soft + thin bright)
          if (Math.abs(dx) < w * 0.48) {
            const sx = 1 - Math.abs(dx) / (w * 0.48)
            const wide = Math.exp(-((dy / (h * 0.012)) ** 2))
            const thin = Math.exp(-((dy / (h * 0.004)) ** 2))
            const streak = (wide * 0.4 + thin * 1.0) * sx
            ar += streak * 95 * br; ag += streak * 110 * br; ab += streak * 150 * br
          }
          // 8-ray star near the core
          if (d < R * 0.3) {
            const ang = Math.atan2(dy, dx)
            const spokes = Math.pow(Math.abs(Math.cos(ang * 4)), 24)
            const rays = spokes * Math.exp(-d / (R * 0.09)) * 60 * br
            ar += rays; ag += rays; ab += rays * 1.1
          }
          // chromatic ghost orbs
          for (const g of ghosts) {
            const gx = cx + vx * g.t, gy = cy + vy * g.t
            const gd = Math.hypot(x - gx, y - gy)
            const gr = R * g.r
            if (gd < gr) {
              const f = 1 - gd / gr
              const ff = f * f
              ar += ff * g.i * br * g.tint[0]
              ag += ff * g.i * br * g.tint[1]
              ab += ff * g.i * br * g.tint[2]
            }
          }
          // screen-blend style additive compositing
          if (ar > 0 || ag > 0 || ab > 0) {
            data[i] = clamp(data[i] + ar, 0, 255)
            data[i + 1] = clamp(data[i + 1] + ag, 0, 255)
            data[i + 2] = clamp(data[i + 2] + ab, 0, 255)
          }
        }
      }
    },
  },

  // ================================================================ new filters (GIMP/PS parity)
  'newsprint': {
    type: 'newsprint', label: 'Newsprint', group: 'pixelate',
    controls: [
      { key: 'cell', label: 'Cell Size', type: 'slider', min: 2, max: 32, step: 1, unit: 'px' },
      { key: 'angle', label: 'Screen Angle', type: 'slider', min: 0, max: 90, step: 1, unit: '°' },
      { key: 'levels', label: 'Levels', type: 'slider', min: 2, max: 8, step: 1 },
    ],
    defaults: { cell: 6, angle: 45, levels: 4 },
    apply(img, p) {
      // classic halftone: rotated grid of round dots whose radius encodes
      // luminance — GIMP Newsprint / comic-book print look
      const cell = Math.max(2, p.cell ?? 6)
      const angle = ((p.angle ?? 45) * Math.PI) / 180
      const levels = Math.max(2, Math.round(p.levels ?? 4))
      const d = img.data
      const w = img.width, h = img.height
      const cos = Math.cos(-angle), sin = Math.sin(-angle)
      const quant = 255 / (levels - 1)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          // luminance → quantized ink coverage
          const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
          const ink = Math.round(Math.round(lum * (levels - 1)) * quant / 255) / (quant / 255 * (levels - 1) || 1)
          // position in rotated grid
          const gx = x * cos - y * sin, gy = x * sin + y * cos
          const fx = gx / cell - Math.floor(gx / cell) - 0.5
          const fy = gy / cell - Math.floor(gy / cell) - 0.5
          const dist = Math.hypot(fx, fy) * 2 // 0..~1.41 of half-cell
          // dot radius ∝ ink coverage (dark → big dot)
          const r = Math.sqrt(ink) * 1.25
          const on = dist < r
          const v = on ? 0 : 255
          d[i] = v; d[i + 1] = v; d[i + 2] = v
        }
      }
    },
  },

  'vignette': {
    type: 'vignette', label: 'Vignette', group: 'render',
    controls: [
      { key: 'amount', label: 'Amount', type: 'slider', min: -100, max: 100, step: 1, unit: '%' },
      { key: 'feather', label: 'Feather', type: 'slider', min: 5, max: 100, step: 1, unit: '%' },
      { key: 'roundness', label: 'Roundness', type: 'slider', min: 0, max: 100, step: 1, unit: '%' },
    ],
    defaults: { amount: 45, feather: 55, roundness: 50 },
    apply(img, p) {
      const amt = (p.amount ?? 45) / 100
      if (amt === 0) return
      const feather = clamp((p.feather ?? 55) / 100, 0.05, 1)
      const round = (p.roundness ?? 50) / 100
      const w = img.width, h = img.height
      const d = img.data
      const cx = w / 2, cy = h / 2
      // superellipse blend between rect (0) and ellipse (1) falloff
      const n = 2 + round * 6
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const nx = (x - cx) / (w / 2), ny = (y - cy) / (h / 2)
          const r = Math.pow(Math.pow(Math.abs(nx), n) + Math.pow(Math.abs(ny), n), 1 / n)
          // edge starts at feather distance from the border
          const edge = 1 - feather * 0.9
          const t = r <= edge ? 0 : clamp((r - edge) / Math.max(0.05, 1 - edge), 0, 1)
          const f = t * t * (3 - 2 * t)
          const k = 1 - amt * f
          const i = (y * w + x) * 4
          d[i] = clamp(d[i] * k, 0, 255)
          d[i + 1] = clamp(d[i + 1] * k, 0, 255)
          d[i + 2] = clamp(d[i + 2] * k, 0, 255)
        }
      }
    },
  },

  'bloom': {
    type: 'bloom', label: 'Bloom', group: 'render',
    controls: [
      { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 255, step: 1 },
      { key: 'radius', label: 'Radius', type: 'slider', min: 1, max: 120, step: 1, unit: 'px' },
      { key: 'amount', label: 'Amount', type: 'slider', min: 0, max: 200, step: 1, unit: '%' },
    ],
    defaults: { threshold: 190, radius: 24, amount: 60 },
    apply(img, p) {
      const th = p.threshold ?? 190
      const radius = Math.max(1, p.radius ?? 24)
      const amt = (p.amount ?? 60) / 100
      if (amt === 0) return
      // bright-pass → blur → screen-add back (glow bloom)
      const w = img.width, h = img.height
      const d = img.data
      const bright = new ImageData(w, h)
      const bd = bright.data
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        const k = lum > th ? (lum - th) / Math.max(1, 255 - th) : 0
        bd[i] = d[i] * k; bd[i + 1] = d[i + 1] * k; bd[i + 2] = d[i + 2] * k; bd[i + 3] = 255
      }
      blurImageData(bright, radius)
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const s = d[i + c] / 255, g = bd[i + c] / 255 * amt
          // screen blend: 1 - (1-a)(1-b)
          d[i + c] = clamp((1 - (1 - s) * (1 - Math.min(1, g))) * 255, 0, 255)
        }
      }
    },
  },

  'chromatic-aberration': {
    type: 'chromatic-aberration', label: 'Chromatic Aberration', group: 'distort',
    controls: [
      { key: 'amountX', label: 'Horizontal Shift', type: 'slider', min: -20, max: 20, step: 0.5, unit: 'px' },
      { key: 'amountY', label: 'Vertical Shift', type: 'slider', min: -20, max: 20, step: 0.5, unit: 'px' },
      { key: 'radial', label: 'Radial Mode', type: 'toggle' },
    ],
    defaults: { amountX: 3, amountY: 0, radial: true },
    apply(img, p) {
      // red channel samples inward/outward vs blue (lens dispersion look)
      const ax = p.amountX ?? 3, ay = p.amountY ?? 0
      if (ax === 0 && ay === 0) return
      const radial = p.radial !== false
      const w = img.width, h = img.height
      const d = img.data
      const src = new Uint8ClampedArray(d) // copy
      const cx = w / 2, cy = h / 2
      const maxR = Math.hypot(cx, cy)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let dx = ax, dy = ay
          if (radial) {
            const rx = (x - cx) / maxR, ry = (y - cy) / maxR
            dx = ax * rx
            dy = ay * ry
          }
          const i = (y * w + x) * 4
          // red shifted by −d, blue by +d (green fixed)
          const xr = clamp(Math.round(x - dx), 0, w - 1), yr = clamp(Math.round(y - dy), 0, h - 1)
          const xb = clamp(Math.round(x + dx), 0, w - 1), yb = clamp(Math.round(y + dy), 0, h - 1)
          d[i] = src[(yr * w + xr) * 4]
          d[i + 2] = src[(yb * w + xb) * 4]
        }
      }
    },
  },
}
