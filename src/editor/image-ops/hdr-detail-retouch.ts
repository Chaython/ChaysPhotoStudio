import type { HdrSelectionRegion } from './hdr-retouch'

/** Pure Float32 scene-linear Blur/Sharpen. No Canvas2D color reads or 8-bit conversions. */
export interface Float32DetailDab {
  pixels: Float32Array
  width: number
  height: number
  offsetX: number
  offsetY: number
  x: number
  y: number
  radius: number
  kernelRadius: number
  strength: number
  mode: 'blur' | 'sharpen'
  alpha(dx: number, dy: number): number
  selection?: HdrSelectionRegion
  hasSelection?: boolean
  protectEdges?: boolean
  edgeThreshold?: number
  threshold?: number
  protectDetail?: boolean
  reduceNoise?: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const smoothstep = (a: number, b: number, n: number) => {
  const t = clamp((n - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** A partially transparent neighbor contributes proportionally, preventing hidden colors bleeding into visible pixels. */
export function applyFloat32DetailDab(d: Float32DetailDab): boolean {
  const { pixels, width, height, x, y, offsetX, offsetY, radius, selection } = d
  if (![width, height, x, y, offsetX, offsetY, radius, d.kernelRadius, d.strength].every(Number.isFinite)
    || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || radius <= 0 || pixels.length !== width * height * 4
    || d.strength <= 0 || d.kernelRadius < 1) return false
  if (d.hasSelection && !selection) return false
  if (selection && (
    !Number.isInteger(selection.width) || !Number.isInteger(selection.height)
    || selection.width < 1 || selection.height < 1
    || selection.data.length !== selection.width * selection.height * 4
  )) return false

  const rad = clamp(Math.round(d.kernelRadius), 1, 60)
  const x0 = Math.max(0, Math.floor(x - radius - offsetX))
  const y0 = Math.max(0, Math.floor(y - radius - offsetY))
  const x1 = Math.min(width, Math.ceil(x + radius - offsetX))
  const y1 = Math.min(height, Math.ceil(y + radius - offsetY))
  if (x0 >= x1 || y0 >= y1) return false
  const sx0 = Math.max(0, x0 - rad - 1), sy0 = Math.max(0, y0 - rad - 1)
  const sx1 = Math.min(width, x1 + rad + 1), sy1 = Math.min(height, y1 + rad + 1)
  const sw = sx1 - sx0, sh = sy1 - sy0
  const rw = x1 - x0, rh = y1 - y0
  // Snapshot only the dab + convolution halo, never an entire HDR photograph.
  const original = new Float32Array(sw * sh * 4)
  for (let row = 0; row < sh; row++) {
    original.set(
      pixels.subarray(((sy0 + row) * width + sx0) * 4, ((sy0 + row) * width + sx1) * 4),
      row * sw * 4,
    )
  }

  // A two-pass box filter over premultiplied colors; alpha itself is NEVER written.
  // Repeated edge samples match the 8-bit filter while retaining scene-linear intensities.
  const horizontal = new Float32Array(original.length)
  const blurred = new Float32Array(rw * rh * 4)
  const sample = (col: number, row: number, channel: number) => {
    const i = (row * sw + col) * 4
    const a = Number.isFinite(original[i + 3]) ? clamp(original[i + 3], 0, 1) : 0
    if (channel === 3) return a
    const rgb = original[i + channel]
    return Number.isFinite(rgb) ? rgb * a : 0
  }
  const norm = 1 / (rad * 2 + 1)
  for (let row = 0; row < sh; row++) {
    for (let channel = 0; channel < 4; channel++) {
      let total = 0
      for (let k = -rad; k <= rad; k++) total += sample(clamp(k, 0, sw - 1), row, channel)
      for (let col = 0; col < sw; col++) {
        horizontal[(row * sw + col) * 4 + channel] = total * norm
        total += sample(clamp(col + rad + 1, 0, sw - 1), row, channel)
          - sample(clamp(col - rad, 0, sw - 1), row, channel)
      }
    }
  }
  for (let col = 0; col < rw; col++) {
    const sx = x0 + col - sx0
    for (let channel = 0; channel < 4; channel++) {
      const hval = (row: number) => horizontal[(clamp(row, 0, sh - 1) * sw + sx) * 4 + channel]
      let total = 0
      const start = y0 - sy0
      for (let k = -rad; k <= rad; k++) total += hval(start + k)
      for (let row = 0; row < rh; row++) {
        blurred[(row * rw + col) * 4 + channel] = total * norm
        total += hval(start + row + rad + 1) - hval(start + row - rad)
      }
    }
  }

  const luma = (col: number, row: number) => {
    const i = (clamp(row, 0, sh - 1) * sw + clamp(col, 0, sw - 1)) * 4
    const r = original[i], g = original[i + 1], b = original[i + 2]
    return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
      ? r * .2126 + g * .7152 + b * .0722 : 0
  }
  const staged = new Float32Array(rw * rh * 3)
  const write = new Uint8Array(rw * rh)
  const strength = clamp(d.strength, 0, 1)
  let changed = false
  for (let row = 0; row < rh; row++) {
    for (let col = 0; col < rw; col++) {
      const localX = x0 + col, localY = y0 + row
      const docX = localX + offsetX, docY = localY + offsetY
      const coverage = d.alpha(docX - x, docY - y)
      if (!Number.isFinite(coverage) || coverage <= 0) continue
      let f = clamp(coverage, 0, 1) * strength
      if (selection) {
        const mx = Math.floor(docX) - selection.x, my = Math.floor(docY) - selection.y
        if (mx < 0 || my < 0 || mx >= selection.width || my >= selection.height) continue
        f *= selection.data[(my * selection.width + mx) * 4 + 3] / 255
      }
      if (f <= 0) continue
      const srcX = localX - sx0, srcY = localY - sy0
      const srcIdx = (srcY * sw + srcX) * 4
      const outIdx = (row * rw + col) * 4
      const a = original[srcIdx + 3], blurA = blurred[outIdx + 3]
      if (!Number.isFinite(a) || a <= 0 || blurA <= 1e-12) continue
      const edge = Math.hypot(
        luma(srcX + 1, srcY) - luma(srcX - 1, srcY),
        luma(srcX, srcY + 1) - luma(srcX, srcY - 1),
      ) * .5
      if (d.mode === 'blur' && d.protectEdges) {
        const t = clamp((d.edgeThreshold ?? 35) / 100, .01, 1)
        f *= 1 - .92 * smoothstep(t * .45, t * 1.35, edge)
      }
      if (f <= 0) continue
      const dest = (row * rw + col) * 3
      let any = false
      for (let channel = 0; channel < 3; channel++) {
        const base = original[srcIdx + channel]
        if (!Number.isFinite(base)) continue
        const blurredRgb = blurred[outIdx + channel] / blurA
        let next = base + (blurredRgb - base) * f
        if (d.mode === 'sharpen') {
          const detail = base - blurredRgb
          const floor = (Math.max(0, d.threshold ?? 0) + clamp(d.reduceNoise ?? 0, 0, 100) * .32) / 255
          if (Math.abs(detail) <= floor) continue
          const edgeWeight = d.protectDetail === false ? 1 : (.45 + .55 * smoothstep(3 / 255, 42 / 255, edge))
          const maxCorrection = d.protectDetail === false ? Infinity : (18 / 255 + edge * .75)
          const correction = clamp(detail * (0.4 + strength * 1.8) * edgeWeight, -maxCorrection, maxCorrection)
          next = base + correction * f
        }
        if (Number.isFinite(next) && Math.abs(next - base) > 1e-7 * Math.max(1, Math.abs(base))) {
          staged[dest + channel] = next
          any = true
        } else {
          staged[dest + channel] = base
        }
      }
      if (any) { write[row * rw + col] = 1; changed = true }
    }
  }
  if (!changed) return false
  for (let row = 0; row < rh; row++) {
    for (let col = 0; col < rw; col++) {
      if (!write[row * rw + col]) continue
      const di = ((y0 + row) * width + x0 + col) * 4
      const si = (row * rw + col) * 3
      pixels[di] = staged[si]
      pixels[di + 1] = staged[si + 1]
      pixels[di + 2] = staged[si + 2]
    }
  }
  return true
}
