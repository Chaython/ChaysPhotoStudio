import assert from 'node:assert/strict'
import { compositeHdrRasters, type HdrCompositeLayer } from '../src/editor/image-ops/hdr-composite'

const bottom = new Float32Array([
  12, 2, 0, 1,  10, 0, 0, 1,
  7, 0, 0, .5, 9, 0, 0, 1,
])
const top = new Float32Array([
  2, 4, 0, 1, 6, 8, 0, .5,
])
const layers: HdrCompositeLayer[] = [
  { pixels: bottom, width: 2, height: 2, offsetX: 0, offsetY: 0, opacity: .5 },
  { pixels: top, width: 2, height: 1, offsetX: 0, offsetY: 0, opacity: .5,
    mask: new Uint8ClampedArray([255, 128, 255, 255]) },
]
const out = compositeHdrRasters(2, 2, layers)
assert.ok(Math.abs(out[3] - .75) < 1e-6, 'composite alpha includes both layer opacities')
assert.ok(Math.abs(out[0] - (12 * .25 + 2 * .5) / .75) < 1e-6,
  'source-over scene-linear RGB is alpha weighted (not alpha applied twice)')
const topA = .5 * .5 * 128 / 255
const bottomA = .5
const expectedA = topA + bottomA * (1 - topA)
assert.ok(Math.abs(out[7] - expectedA) < 1e-6, 'feathered layer mask is applied once')
assert.ok(Math.abs(out[4] - (6 * topA + 10 * bottomA * (1-topA)) / expectedA) < 1e-6)
assert.equal(out[8], 7, 'semi-transparent bottom layer retains original HDR colors')
assert.equal(out[11], .25)
assert.equal(out[12], 9)
assert.ok(out[0] > 1, 'HDR highlights are not clamped to SDR white')
assert.equal(bottom[0], 12, 'compositing never mutates source pixel buffers')
assert.equal(top[3], 1, 'top alpha is unchanged')
const out2 = compositeHdrRasters(2, 2, [{
  pixels: new Float32Array([35,2,0,1, 3,0,0,.8]),
  width: 2, height: 1, offsetX: -1, offsetY: 1, opacity: 1,
}])
assert.equal(out2[8], 3, 'off-canvas source maps to correct destination pixel')
assert.ok(Math.abs(out2[11] - .8) < 1e-6, 'off-canvas cropped alpha is retained')
assert.equal(out2[12], 0, 'no out-of-bounds pixels leak into the document')
const hidden = compositeHdrRasters(1, 1, [{
  pixels: new Float32Array([50, 0, 0, 1]),
  width: 1, height: 1, offsetX: 0, offsetY: 0, opacity: 0,
}])
assert.deepEqual([...hidden], [0,0,0,0])
assert.throws(() => compositeHdrRasters(0,1,[]), /Invalid HDR composite/)
assert.throws(() => compositeHdrRasters(1,1,[{
  pixels: new Float32Array(8), width: 1, height: 1,
  offsetX: 0, offsetY: 0, opacity: .5,
}]), /Invalid HDR composite layer/)
assert.throws(() => compositeHdrRasters(1,1,[{
  pixels: new Float32Array(4), width: 1, height: 1,
  offsetX: .5, offsetY: 0, opacity: 1,
}]), /Invalid HDR composite layer/)
console.log('HDR composite validates alpha, layer opacity, masks, offsets, and Float32 highlights')
