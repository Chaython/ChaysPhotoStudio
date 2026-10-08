import assert from 'node:assert/strict'
import { applyHdrRasterMask, createLayerMaskAlpha } from '../src/editor/image-ops/layer-mask'

// The same partially transparent alpha is used in a selection mask and its inverse.
const selection = new Uint8ClampedArray([0, 64, 128, 255])
assert.deepEqual(Array.from(createLayerMaskAlpha(2, 2, 'reveal-all')), [255,255,255,255])
assert.deepEqual(Array.from(createLayerMaskAlpha(2, 2, 'hide-all')), [0,0,0,0])
assert.deepEqual(Array.from(createLayerMaskAlpha(2, 2, 'reveal-selection', selection)), [0,64,128,255])
assert.deepEqual(Array.from(createLayerMaskAlpha(2, 2, 'hide-selection', selection)), [255,191,127,0])
assert.deepEqual(Array.from(selection), [0,64,128,255], 'creating a mask does not mutate selection')
assert.throws(() => createLayerMaskAlpha(2, 2, 'reveal-selection'), /requires/)
assert.throws(() => createLayerMaskAlpha(0, 2, 'hide-all'), /Invalid layer mask/)

// A 3×1 HDR layer at document offset (-1,1) crosses the document edge.
// Mask must index document-space pixels, preserve HDR channel values and
// preserve original pixel storage. Pixels outside the document become transparent.
const source = new Float32Array([
  17, 3, 0, 1,
  9, 4, .5, .8,
  25, 1, 0, .5,
])
const before = new Float32Array(source)
const mask = new Uint8ClampedArray([
  255,255,255,
  128,64,255,
])
const masked = applyHdrRasterMask(source, 3, 1, -1, 1, mask, 3, 2)
assert.equal(masked[3], 0, 'pixel outside document disappears')
assert.ok(Math.abs(masked[7] - .8 * 128/255) < 1e-6, 'offset mask uses document pixel (0,1)')
assert.ok(Math.abs(masked[11] - .5 * 64/255) < 1e-6, 'feathered alpha is multiplied, not replaced')
assert.equal(masked[0], 17)
assert.equal(masked[8], 25, 'Float32 HDR RGB channels remain above SDR white')
assert.deepEqual(source, before, 'baking a mask never mutates a shared History buffer')
assert.notEqual(masked, source)
assert.throws(() => applyHdrRasterMask(source,3,1,-1,1,new Uint8ClampedArray(4),3,2), /Invalid HDR/)
assert.throws(() => applyHdrRasterMask(source,4,1,0,0,mask,3,2), /Invalid HDR/)
console.log('Layer mask creation, HDR alpha baking, offsets, feathering and History isolation pass')
