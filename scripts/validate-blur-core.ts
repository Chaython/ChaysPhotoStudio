import assert from 'node:assert/strict'
import { blurImageData, boxBlurFloat, gaussianBlurFloat } from '../src/editor/image-ops/blur'
import type { PixelImage } from '../src/editor/image-ops/pixel-data'

// ============================================================
// The blur core was rewritten for speed: the row pass splits into
// head / middle / tail so the interior needs no clamping, and the
// column pass gathers a transposed strip instead of walking a
// strided column.
//
// The rewrite must not move a single pixel, so this script keeps the
// previous kernels as a reference implementation and compares the two
// bit-for-bit (a Float32 comparison, not a tolerance).
// ============================================================

// ---------------------------------------------------------------- reference

function refBoxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1)
  let wl = Math.floor(wIdeal)
  if (wl % 2 === 0) wl--
  if (wl < 1) wl = 1
  const wu = wl + 2
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)
  const m = Math.round(mIdeal)
  const sizes: number[] = []
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu)
  return sizes
}

/** the previous row pass: every tap went through a clamping index */
function refBoxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (r + r + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let i = -r; i <= r; i++) acc += src[row + (i < 0 ? 0 : i > w - 1 ? w - 1 : i)]
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * norm
      const add = x + r + 1
      const sub = x - r
      acc += src[row + (add > w - 1 ? w - 1 : add)] - src[row + (sub < 0 ? 0 : sub)]
    }
  }
}

/** the previous column pass: one strided walk per column */
function refBoxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (r + r + 1)
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let i = -r; i <= r; i++) acc += src[(i < 0 ? 0 : i > h - 1 ? h - 1 : i) * w + x]
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * norm
      const add = y + r + 1
      const sub = y - r
      acc += src[(add > h - 1 ? h - 1 : add) * w + x] - src[(sub < 0 ? 0 : sub) * w + x]
    }
  }
}

function refGaussianBlurFloat(buf: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (!(sigma >= 0.4)) return buf
  const boxes = refBoxesForGauss(sigma, 3)
  let a = buf
  let b = new Float32Array(buf.length)
  for (const size of boxes) {
    const r = (size - 1) >> 1
    if (r < 1) continue
    refBoxBlurH(a, b, w, h, r)
    refBoxBlurV(b, a, w, h, r)
  }
  return a
}

function refBoxBlurFloat(buf: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return buf
  const tmp = new Float32Array(buf.length)
  refBoxBlurH(buf, tmp, w, h, r)
  refBoxBlurV(tmp, buf, w, h, r)
  return buf
}

/** the previous full-resolution RGB blur: one float plane per channel */
function refBlurExact(img: PixelImage, sigma: number): void {
  const { width: w, height: h, data } = img
  const n = w * h
  const ch = new Float32Array(n)
  for (let c = 0; c < 3; c++) {
    for (let i = 0, j = c; i < n; i++, j += 4) ch[i] = data[j]
    refGaussianBlurFloat(ch, w, h, sigma)
    for (let i = 0, j = c; i < n; i++, j += 4) data[j] = ch[i]
  }
}

// ---------------------------------------------------------------- helpers

/** a deterministic pseudo-random plane (no Math.random, so failures reproduce) */
function noise(w: number, h: number, seed = 1): Float32Array {
  const out = new Float32Array(w * h)
  let s = seed >>> 0
  for (let i = 0; i < out.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out[i] = (s >>> 8) / 16777216
  }
  return out
}

/** byte-for-byte comparison of two float planes */
function assertIdentical(a: Float32Array, b: Float32Array, what: string): void {
  assert.equal(a.length, b.length, `${what}: same length`)
  const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
  for (let i = 0; i < av.length; i++) {
    if (av[i] !== bv[i]) {
      const p = i >> 2
      assert.fail(
        `${what}: differs at float ${p} (byte ${i}) — new ${a[p]} vs old ${b[p]}`,
      )
    }
  }
}

/** byte-for-byte comparison of two 8-bit buffers */
function assertBytesIdentical(a: Uint8ClampedArray, b: Uint8ClampedArray, what: string): void {
  assert.equal(a.length, b.length, `${what}: same length`)
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      assert.fail(`${what}: differs at byte ${i} — new ${a[i]} vs old ${b[i]}`)
    }
  }
}

function image(w: number, h: number, seed = 7, alpha = 255): ImageData {
  const data = new Uint8ClampedArray(w * h * 4)
  const plane = noise(w, h, seed)
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    data[j] = Math.round(plane[i] * 255)
    data[j + 1] = Math.round(plane[i] * 200)
    data[j + 2] = Math.round(plane[i] * 120)
    data[j + 3] = alpha
  }
  return { width: w, height: h, data } as ImageData
}

// ---------------------------------------------------------------- box blur

/** radii that exercise every branch of the head / middle / tail split */
const RADII = [1, 2, 3, 5, 8, 16, 31]

for (const [w, h] of [[1, 1], [1, 8], [8, 1], [2, 2], [3, 3], [7, 5], [16, 9], [17, 17], [64, 33], [129, 71]]) {
  const src = noise(w, h, w * 31 + h)
  for (const r of RADII) {
    const a = src.slice()
    const b = src.slice()
    boxBlurFloat(a, w, h, r)
    refBoxBlurFloat(b, w, h, r)
    assertIdentical(a, b, `boxBlurFloat ${w}x${h} r=${r}`)
  }
}

// a radius of zero is a no-op, and a radius wider than the line is a
// fully clamped average
{
  const src = noise(5, 4, 3)
  const a = src.slice()
  const b = src.slice()
  boxBlurFloat(a, 5, 4, 0)
  refBoxBlurFloat(b, 5, 4, 0)
  assertIdentical(a, b, 'boxBlurFloat r=0')

  const c = src.slice()
  const d = src.slice()
  boxBlurFloat(c, 5, 4, 99)
  refBoxBlurFloat(d, 5, 4, 99)
  assertIdentical(c, d, 'boxBlurFloat r > width')
}

// ---------------------------------------------------------------- gaussian

for (const [w, h] of [[1, 1], [2, 3], [5, 4], [16, 16], [31, 17], [64, 64], [100, 37]]) {
  const src = noise(w, h, w * 17 + h * 3)
  for (const sigma of [0.4, 0.5, 1, 2.5, 4, 7.5, 12]) {
    const a = src.slice()
    const b = src.slice()
    gaussianBlurFloat(a, w, h, sigma)
    refGaussianBlurFloat(b, w, h, sigma)
    assertIdentical(a, b, `gaussianBlurFloat ${w}x${h} sigma=${sigma}`)
  }
}

// ---------------------------------------------------------------- RGB blur

for (const [w, h] of [[1, 1], [2, 3], [5, 4], [16, 16], [33, 21], [64, 48]]) {
  for (const sigma of [0.4, 1, 2.5, 5, 9]) {
    const a = image(w, h, w * 13 + h)
    const b = image(w, h, w * 13 + h)
    blurImageData(a, sigma)
    refBlurExact(b, sigma)
    assertBytesIdentical(a.data, b.data, `blurImageData ${w}x${h} sigma=${sigma}`)
  }
}

// the alpha channel is never touched
{
  const a = image(24, 16, 99, 200)
  const b = image(24, 16, 99, 200)
  blurImageData(a, 3)
  refBlurExact(b, 3)
  for (let i = 3; i < a.data.length; i += 4) {
    assert.equal(a.data[i], 200, 'the alpha channel is preserved')
  }
}

// a 32-bit float buffer takes the same path and keeps its precision
{
  const w = 40
  const h = 30
  const plane = noise(w, h, 5)
  const mk = (): PixelImage => ({
    width: w, height: h, precision: 'float32',
    data: new Float32Array(w * h * 4),
  })
  const a = mk()
  const b = mk()
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    a.data[j] = plane[i]; a.data[j + 1] = plane[i] * 0.5; a.data[j + 2] = plane[i] * 0.25; a.data[j + 3] = 1
    b.data[j] = plane[i]; b.data[j + 1] = plane[i] * 0.5; b.data[j + 2] = plane[i] * 0.25; b.data[j + 3] = 1
  }
  blurImageData(a, 3)
  refBlurExact(b, 3)
  assertIdentical(a.data as Float32Array, b.data as Float32Array, 'blurImageData on a float32 buffer')
}

// ---------------------------------------------------------------- fallback path

// A very tall, narrow image makes the transposed strip narrower than
// two columns, so the column pass falls back to the strided walk.
// The result must still be identical.
{
  const w = 3
  const h = 9000
  const src = noise(w, h, 11)
  const a = src.slice()
  const b = src.slice()
  boxBlurFloat(a, w, h, 4)
  refBoxBlurFloat(b, w, h, 4)
  assertIdentical(a, b, 'boxBlurFloat on a tall narrow image (fallback path)')
}

// ---------------------------------------------------------------- benchmark

/** warm the JIT up, then take the fastest of several runs */
function timeIt(fn: () => void, reps = 5): number {
  fn()
  fn()
  let best = Infinity
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now()
    fn()
    const dt = performance.now() - t0
    if (dt < best) best = dt
  }
  return best
}

const bw = 1024
const bh = 1024
const benchPlane = noise(bw, bh, 42)
const benchImage = image(bw, bh, 42)
const benchPristine = image(bw, bh, 42)

const oldBox = timeIt(() => refBoxBlurFloat(benchPlane.slice(), bw, bh, 8))
const newBox = timeIt(() => boxBlurFloat(benchPlane.slice(), bw, bh, 8))
const oldGauss = timeIt(() => refGaussianBlurFloat(benchPlane.slice(), bw, bh, 4))
const newGauss = timeIt(() => gaussianBlurFloat(benchPlane.slice(), bw, bh, 4))
// both variants reset the buffer to the same picture first, so the
// comparison is like-for-like
const oldRgb = timeIt(() => {
  benchImage.data.set(benchPristine.data)
  refBlurExact(benchImage, 4)
})
const newRgb = timeIt(() => {
  benchImage.data.set(benchPristine.data)
  blurImageData(benchImage, 4)
})

console.log(`  box  ${bw}x${bh} r=8 : old ${oldBox.toFixed(1)} ms -> new ${newBox.toFixed(1)} ms`)
console.log(`  gauss ${bw}x${bh} s=4 : old ${oldGauss.toFixed(1)} ms -> new ${newGauss.toFixed(1)} ms`)
console.log(`  rgb   ${bw}x${bh} s=4 : old ${oldRgb.toFixed(1)} ms -> new ${newRgb.toFixed(1)} ms`)

console.log('Blur core: head/middle/tail row pass, transposed column strip and the fused RGB path are bit-identical to the previous kernels')
