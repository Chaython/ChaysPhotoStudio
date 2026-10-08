// Pixel-accurate Photoshop Edit > Stroke Selection engine. No DOM or layer mutations.
export type StrokePlacement = 'inside' | 'center' | 'outside'
export interface SelectionStrokeOptions { width: number; placement: StrokePlacement; color: string; opacity: number }
const INF = 1e12

/** Exact 1-D squared Euclidean distance transform, O(n).
 * Felzenszwalb-Huttenlocher lower envelope of parabolas.
 */
function edt1d(f: Float64Array): Float64Array {
  const n = f.length
  const out = new Float64Array(n)
  if (!n) return out
  const v = new Int32Array(n), z = new Float64Array(n + 1)
  let k = 0
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s: number
    while (true) {
      const vk = v[k]
      s = (f[q] + q * q - f[vk] - vk * vk) / (2 * (q - vk))
      if (s > z[k] || k === 0) break
      k--
    }
    if (s <= z[k] && k === 0) {
      v[0] = q; z[1] = Infinity
    } else {
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity
    }
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dx = q - v[k]
    out[q] = dx * dx + f[v[k]]
  }
  return out
}

/** Squared distance to pixels of the requested binary class.
 * A one-pixel unselected frame makes document edges count as selection edges.
 */
function distanceTo(alpha: Uint8ClampedArray, width: number, height: number, feature: 'selected' | 'unselected'): Float32Array {
  const w = width + 2, h = height + 2
  const horizontal = new Float32Array(w * h)
  const f = new Float64Array(Math.max(w, h))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const frame = !x || !y || x === w - 1 || y === h - 1
      const selected = !frame && alpha[(y - 1) * width + x - 1] >= 128
      f[x] = (feature === 'selected' ? selected : !selected) ? 0 : INF
    }
    horizontal.set(edt1d(f.subarray(0, w)), y * w)
  }
  const result = new Float32Array(width * height)
  for (let x = 1; x < w - 1; x++) {
    for (let y = 0; y < h; y++) f[y] = horizontal[y * w + x]
    const d = edt1d(f.subarray(0, h))
    for (let y = 1; y < h - 1; y++) result[(y - 1) * width + x - 1] = d[y]
  }
  return result
}

/** Stroke alpha image, independent of layer pixels and of the source selection.
 * 1 px centered strokes split coverage across both sides of the contour.
 */
export function selectionStrokeAlpha(
  alpha: Uint8ClampedArray, w: number, h: number, width: number, placement: StrokePlacement,
): Uint8ClampedArray {
  if (!Number.isSafeInteger(w * h) || w <= 0 || h <= 0 || alpha.length !== w * h)
    throw new Error('Stroke requires a valid document-sized selection')
  if (!Number.isInteger(width) || width < 1 || width > 200)
    throw new Error('Stroke width must be an integer between 1 and 200')
  if (!['inside', 'center', 'outside'].includes(placement))
    throw new Error('Invalid stroke placement')
  const out = new Uint8ClampedArray(alpha.length)
  if (!alpha.some(a => a >= 128)) return out
  const inside = placement !== 'outside' ? distanceTo(alpha, w, h, 'unselected') : null
  const outside = placement !== 'inside' ? distanceTo(alpha, w, h, 'selected') : null
  const radius = placement === 'center' ? width / 2 : width
  for (let p = 0; p < alpha.length; p++) {
    const selected = alpha[p] >= 128
    if (placement === 'inside' && !selected || placement === 'outside' && selected) continue
    const dist2 = selected ? inside?.[p] : outside?.[p]
    if (dist2 === undefined) continue
    const geometric = Math.max(0, Math.min(1, radius + 1 - Math.sqrt(dist2)))
    const feather = placement === 'inside' ? alpha[p] / 255
      : placement === 'outside' ? 1 - alpha[p] / 255 : 1
    out[p] = Math.round(255 * geometric * feather)
  }
  return out
}

/** Input is a disposable worker-owned selection ImageData (alpha mask).
 * Output is the stroke as new colored RGBA pixels, not a replacement selection.
 */
export function renderSelectionStroke(img: ImageData, options: SelectionStrokeOptions): void {
  const { width: w, height: h, data } = img
  if (!options || !Number.isFinite(options.opacity) || options.opacity < 0 || options.opacity > 100)
    throw new Error('Stroke opacity must be between 0 and 100')
  if (!/^#[0-9a-f]{6}$/i.test(options.color))
    throw new Error('Stroke color must be a six-digit hex color')
  const mask = new Uint8ClampedArray(w * h)
  for (let p = 0, j = 3; p < mask.length; p++, j += 4) mask[p] = data[j]
  const coverage = selectionStrokeAlpha(mask, w, h, options.width, options.placement)
  const color = Number.parseInt(options.color.slice(1), 16)
  const r = color >>> 16 & 255, g = color >>> 8 & 255, b = color & 255
  for (let p = 0, j = 0; p < coverage.length; p++, j += 4) {
    data[j] = r; data[j + 1] = g; data[j + 2] = b
    data[j + 3] = Math.round(coverage[p] * options.opacity / 100)
  }
}
