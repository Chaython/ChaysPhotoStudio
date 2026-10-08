import assert from 'node:assert/strict'
import { splitHdrSelectionPixels } from '../src/editor/image-ops/selection-pixels'

const src = new Float32Array([
  12, .5, 1.8, 1,       4, 1, 0, .8,     0, 0, 0, 0,
  3, 2, 5, 1,          9, 0, 1, .75,     6, 2, 1, .4,
])
const original = new Float32Array(src)
// Source extends left of the document, offset X=-1; selection x=0 samples
// source x=1, so off-canvas HDR data must never leak into the lifted layer.
const selected = new Uint8ClampedArray([255, 0, 128, 255])
const result = splitHdrSelectionPixels(src, 3, 2, -1, 0,
  { x: 0, y: 0, w: 2, h: 2 }, selected, true)
assert.equal(result.hasPixels, true)
assert.equal(result.pixels[0], 4, 'first copied pixel maps offset raster correctly')
assert.ok(Math.abs(result.pixels[3] - .8) < 1e-6)
assert.equal(result.pixels[4], 0, 'unselected transparent source stays transparent')
assert.equal(result.pixels[7], 0, 'transparent source stays transparent')
assert.equal(result.pixels[8], 9, 'HDR RGB values above 1 stay intact')
assert.ok(Math.abs(result.pixels[11] - .75 * 128 / 255) < 1e-6)
assert.equal(result.pixels[12], 6)
assert.ok(Math.abs(result.pixels[15] - .4) < 1e-6)
assert.ok(result.remaining)
assert.equal(result.remaining![3], 1, 'off-canvas source alpha is untouched')
assert.equal(result.remaining![7], 0, 'fully cut selection removes only selected source')
assert.ok(Math.abs(result.remaining![19] - .75 * (1 - 128 / 255)) < 1e-6)
assert.deepEqual(src, original, 'splitting does not modify the source buffer')

const mask = new Uint8ClampedArray([128, 255, 0, 255])
const masked = splitHdrSelectionPixels(src, 3, 2, -1, 0,
  { x: 0, y: 0, w: 2, h: 2 }, selected, false, mask)
assert.ok(Math.abs(masked.pixels[3] - .8 * 128 / 255) < 1e-6,
  'copied visible pixels respect the source layer mask')
assert.equal(masked.remaining, null, 'Layer via Copy never mutates the source')
assert.throws(() => splitHdrSelectionPixels(src, 3, 2, -1, 0,
  { x: 0, y: 0, w: 2, h: 3 }, selected), /Invalid HDR selection/)

const nothing = splitHdrSelectionPixels(src, 3, 2, -1, 0,
  { x: 0, y: 0, w: 2, h: 2 }, new Uint8ClampedArray(4), true)
assert.equal(nothing.hasPixels, false)
assert.deepEqual(nothing.remaining, src)
console.log('Layer via Copy/Cut: feathered alpha, masks, HDR, offsets and source integrity passed')
