// Photoshop-style Select > Grow / Similar on the visible, document-space image.
// Selection alpha is kept separate from pixels: no edits to layer content.
import { rgbToLab } from './color'

export type SelectionColorMode = 'grow' | 'similar'

interface Swatch {
  L: number
  a: number
  b: number
  alpha: number
  count: number
}

interface Accumulator {
  r: number
  g: number
  b: number
  alpha: number
  count: number
}

const MAX_SWATCHES = 32

/** Match against colors *already in* a selection, not a moving flood-fill mean.
 * That prevents a gradual gradient from leaking across unrelated colors.
 * In grow mode, only 4-connected matching neighbors can be added.
 * Similar mode examines all document pixels, including disconnected islands.
 */
export function extendSelectionByColor(
  img: Pick<ImageData, 'width' | 'height' | 'data'>,
  original: Uint8ClampedArray,
  mode: SelectionColorMode,
  tolerance = 32,
): Uint8ClampedArray {
  const { width: w, height: h, data } = img
  const n = w * h
  if (!Number.isSafeInteger(n) || n < 0 || data.length !== n * 4 || original.length !== n) {
    throw new Error('Selection color match requires document-sized pixels and selection')
  }
  if (mode !== 'grow' && mode !== 'similar') throw new Error('Unsupported selection color-match mode')
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) {
    throw new Error('Selection color tolerance must be between 0 and 100')
  }
  const out = new Uint8ClampedArray(original)
  if (!n) return out

  // Quantize selected colors into a bounded histogram. Using every selected
  // pixel as a reference would make a multi-megapixel selection prohibitively slow.
  const bins = new Map<number, Accumulator>()
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (original[p] < 128) continue
    const key = (data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | (data[i + 2] >> 4)
    let acc = bins.get(key)
    if (!acc) { acc = { r: 0, g: 0, b: 0, alpha: 0, count: 0 }; bins.set(key, acc) }
    acc.r += data[i]; acc.g += data[i + 1]; acc.b += data[i + 2]
    acc.alpha += data[i + 3]
    acc.count++
  }
  if (!bins.size) return out

  const lab = [0, 0, 0]
  const candidates: Swatch[] = []
  for (const acc of bins.values()) {
    rgbToLab(acc.r / acc.count, acc.g / acc.count, acc.b / acc.count, lab)
    candidates.push({ L: lab[0], a: lab[1], b: lab[2], alpha: acc.alpha / acc.count, count: acc.count })
  }

  // Farthest-point representatives retain uncommon hues rather than
  // discarding them when a selection contains a much larger dominant color.
  candidates.sort((a, b) => b.count - a.count)
  const swatches: Swatch[] = [candidates[0]]
  const chosen = new Set([0])
  while (swatches.length < MAX_SWATCHES && swatches.length < candidates.length) {
    let best = -1
    let bestScore = -1
    for (let i = 1; i < candidates.length; i++) {
      if (chosen.has(i)) continue
      const c = candidates[i]
      let dist2 = Infinity
      for (const s of swatches) {
        const dl = c.L - s.L, da = c.a - s.a, db = c.b - s.b
        dist2 = Math.min(dist2, dl * dl + da * da + db * db)
      }
      const score = dist2 * (1 + Math.log2(1 + c.count) * .12)
      if (score > bestScore) { bestScore = score; best = i }
    }
    if (best < 0) break
    chosen.add(best)
    swatches.push(candidates[best])
  }

  const threshold = 1.5 + tolerance * .535
  const softEnd = threshold + Math.max(2.5, threshold * .30)
  const threshold2 = threshold * threshold
  const softEnd2 = softEnd * softEnd

  const match = (p: number): number => {
    const i = p * 4
    rgbToLab(data[i], data[i + 1], data[i + 2], lab)
    let best2 = Infinity
    // Include transparency in the score. Opaque selections must not leak
    // into transparent regions whose hidden RGB happens to be identical.
    for (const s of swatches) {
      const dl = lab[0] - s.L
      const da = lab[1] - s.a
      const db = lab[2] - s.b
      const alphaPenalty = Math.abs(data[i + 3] - s.alpha) / 255 * 24
      const d2 = dl * dl + da * da + db * db + alphaPenalty * alphaPenalty
      if (d2 < best2) best2 = d2
    }
    if (best2 <= threshold2) return 255
    if (best2 >= softEnd2) return 0
    const t = 1 - (Math.sqrt(best2) - threshold) / (softEnd - threshold)
    return Math.max(1, Math.round(t * t * (3 - 2 * t) * 254))
  }

  if (mode === 'similar') {
    for (let p = 0; p < n; p++) {
      if (out[p] === 255) continue
      out[p] = Math.max(out[p], match(p))
    }
    return out
  }

  // Start at the selection boundary, not at a single arbitrary sample point.
  // Every pixel is enqueued at most once, and only hard matches propagate;
  // soft anti-aliased edge pixels do not bridge into dissimilar regions.
  const seen = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0, tail = 0
  const enqueue = (p: number) => {
    if (original[p] >= 128 || seen[p]) return
    seen[p] = 1
    queue[tail++] = p
  }
  for (let p = 0; p < n; p++) {
    if (original[p] < 128) continue
    const x = p % w
    if (x > 0) enqueue(p - 1)
    if (x + 1 < w) enqueue(p + 1)
    if (p >= w) enqueue(p - w)
    if (p + w < n) enqueue(p + w)
  }
  while (head < tail) {
    const p = queue[head++]
    const a = match(p)
    if (a > out[p]) out[p] = a
    if (a < 128) continue
    const x = p % w
    if (x > 0) enqueue(p - 1)
    if (x + 1 < w) enqueue(p + 1)
    if (p >= w) enqueue(p - w)
    if (p + w < n) enqueue(p + w)
  }
  return out
}
