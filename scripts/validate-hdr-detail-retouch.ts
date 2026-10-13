import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyFloat32DetailDab, type Float32DetailDab } from '../src/editor/image-ops/hdr-detail-retouch'

const n = 7, cx = 3, cy = 3
function makeScene(): Float32Array {
  const data = new Float32Array(n * n * 4)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4
    data[i] = .125; data[i + 1] = .35; data[i + 2] = 2.25
    data[i + 3] = 0.75
  }
  const i = (cy * n + cx) * 4
  data[i] = 3.75; data[i + 1] = 1.45; data[i + 2] = 3.45
  return data
}
function apply(data: Float32Array, options: Partial<Float32DetailDab> = {}) {
  return applyFloat32DetailDab({
    pixels: data, width: n, height: n, x: cx, y: cy,
    offsetX: 0, offsetY: 0, radius: 2, kernelRadius: 1,
    strength: 0.8, mode: 'blur', alpha: () => 1, ...options,
  })
}
const center = (cy * n + cx) * 4
const input = makeScene()
const snapshot = Array.from(input)
assert.equal(apply(input), true)
assert.ok(input[center] < snapshot[center], 'Blur lowers the bright center')
assert.ok(input[center] > .125, 'Blur does not completely remove the center')
assert.ok(input[center + 2] > 1, 'HDR highlights retain values above display white')
assert.equal(input[center + 3], Math.fround(.75), 'Alpha remains untouched')
assert.equal(input[0], snapshot[0], 'Pixels outside brush remain untouched')
assert.equal(input[3], snapshot[3], 'Other alpha values remain intact')

const sharpened = makeScene()
assert.equal(apply(sharpened, { mode: 'sharpen', protectDetail: false, threshold: 0 }), true)
assert.ok(sharpened[center] > snapshot[center], 'Sharpen increases local center contrast')
assert.equal(sharpened[center + 3], Math.fround(.75))
assert.ok(sharpened[center] > 1)

const uniform = new Float32Array(n * n * 4)
for (let i = 0; i < uniform.length; i += 4) {
  uniform[i] = Math.fround(.25); uniform[i + 1] = Math.fround(.5)
  uniform[i + 2] = 2; uniform[i + 3] = 1
}
const baseline = Array.from(uniform)
assert.equal(apply(uniform), false, 'Uniform regions do not create false history edits')
assert.deepEqual(Array.from(uniform), baseline)
assert.equal(apply(uniform, { mode: 'sharpen' }), false)

const noSelection = { x: 0, y: 0, width: n, height: n, data: new Uint8ClampedArray(n * n * 4) }
const masked = makeScene()
assert.equal(apply(masked, { selection: noSelection, hasSelection: true }), false)
assert.deepEqual(Array.from(masked), snapshot)
assert.equal(apply(masked, { hasSelection: true }), false)
assert.equal(apply(masked, { x: Infinity }), false)
assert.equal(apply(masked, { x: -300 }), false)
assert.deepEqual(Array.from(masked), snapshot)

const selected = makeScene()
noSelection.data[center + 3] = 128
assert.equal(apply(selected, { selection: noSelection, hasSelection: true }), true)
assert.ok(selected[center] < snapshot[center] && selected[center] > input[center],
  'Partial alpha selection weakens the center dab')
assert.equal(selected[center + 3], Math.fround(.75))

const offset = makeScene()
assert.equal(apply(offset, { x: 23, y: 43, offsetX: 20, offsetY: 40 }), true,
  'Offset raster coordinates must use document-space brush coordinates')
assert.ok(Math.abs(offset[center] - input[center]) < 1e-6)

const transparent = makeScene()
transparent[center + 3] = 0
const transparentBefore = transparent.slice()
apply(transparent)
assert.equal(transparent[center], transparentBefore[center], 'Hidden RGB stays intact')
assert.equal(transparent[center + 3], 0)

const onlyVisible = makeScene()
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  if (x !== cx || y !== cy) onlyVisible[(y * n + x) * 4 + 3] = 0
}
const edgeBefore = onlyVisible[center]
assert.equal(apply(onlyVisible), false,
  'Premultiplied blur must not dilute visible pixels with transparent neighbors')
assert.equal(onlyVisible[center], edgeBefore)

const retouch = readFileSync(new URL('../src/editor/tools/retouch.ts', import.meta.url), 'utf8')
assert.match(retouch, /applyFloat32DetailDab\(/)
assert.match(retouch, /float32DetailDab\('blur'/)
assert.match(retouch, /float32DetailDab\('sharpen'/)
assert.match(retouch, /opts\.output === 'new'/, 'New Layer output must be guarded for HDR')
assert.match(retouch, /mutated = !hdrRetouch/, 'HDR no-op strokes must not enter history')
console.log('Float32 HDR Blur/Sharpen: scene-linear precision, alpha, mask, bounds and Undo guards passed')
