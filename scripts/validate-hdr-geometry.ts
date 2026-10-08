import assert from 'node:assert/strict'
import { cropHdrPixels, flipHdrPixels, rotateHdrPixels, resampleHdrPixels } from '../src/editor/image-ops/hdr-geometry'

function image(values: number[]): Float32Array {
  const pixels = new Float32Array(values.length * 4)
  values.forEach((r, i) => { pixels[i * 4] = r; pixels[i * 4 + 3] = 1 })
  return pixels
}
function red(p: Float32Array): number[] {
  return Array.from({ length: p.length / 4 }, (_, i) => p[i * 4])
}
const source = image([1, 2, 3, 4, 5, 12]) // 2×3 HDR
assert.deepEqual(red(cropHdrPixels(source, 2, 3, 2, 2, 0, 1)), [3, 4, 5, 12])
assert.deepEqual(red(cropHdrPixels(source, 2, 3, 3, 2, -1, 1)), [0, 3, 4, 0, 5, 12])
assert.deepEqual(red(flipHdrPixels(source, 2, 3, 'horizontal')), [2, 1, 4, 3, 12, 5])
assert.deepEqual(red(flipHdrPixels(source, 2, 3, 'vertical')), [5, 12, 3, 4, 1, 2])
assert.deepEqual(red(rotateHdrPixels(source, 2, 3, 90)), [5, 3, 1, 12, 4, 2])
assert.deepEqual(red(rotateHdrPixels(source, 2, 3, -90)), [2, 4, 12, 1, 3, 5])
assert.deepEqual(red(rotateHdrPixels(source, 2, 3, 180)), [12, 5, 4, 3, 2, 1])
assert.deepEqual(red(rotateHdrPixels(rotateHdrPixels(source, 2, 3, 90), 3, 2, -90)), red(source))
assert.deepEqual(red(resampleHdrPixels(source, 2, 3, 2, 3)), red(source))
assert.deepEqual(red(resampleHdrPixels(image([1, 9]), 2, 1, 3, 1)), [1, 5, 9])
const alpha = image([12, 2])
alpha[7] = 0 // fully transparent opposite pixel cannot tint middle sample
const scaled = resampleHdrPixels(alpha, 2, 1, 3, 1)
assert.equal(scaled[4], 12, 'premultiplied interpolation must not make dark fringe')
assert.ok(Math.abs(scaled[7] - .5) < 1e-6, 'resampled alpha is fractional')
assert.throws(() => rotateHdrPixels(source, 2, 3, 45), /quarter turns/)
assert.throws(() => cropHdrPixels(source, 4, 3, 1, 1, 0, 0), /Invalid HDR/)
console.log('HDR crop, scale, flip and rotation keep 32-bit scene-linear pixels and alpha')
