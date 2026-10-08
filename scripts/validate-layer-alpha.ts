import assert from 'node:assert/strict'
import { rasterTransparencyAlpha } from '../src/editor/image-ops/layer-transparency'

// 3×2 layer shifted left one pixel relative to 3×2 document.
// Alpha maps from raster coords (1,0) and (2,0) into doc x 0 and 1.
const rgba = new Uint8ClampedArray([
  9,9,9,45,  3,3,3,255, 4,4,4,128,
  1,1,1,0,   2,2,2,64,  8,8,8,200,
])
const out = rasterTransparencyAlpha(rgba,3,2,3,2,-1,0)
assert.deepEqual(Array.from(out),[255,128,0,64,200,0])
assert.equal(rgba[3],45,'source must remain unchanged')

// Float32 RGB may contain scene-linear HDR highlights above 1.0; only alpha
// contributes to the selection. Fractional alpha is rounded to 8-bit.
const hdr = new Float32Array([20,3,5,.5, 12,3,2,1, 10,0,0,0])
assert.deepEqual(Array.from(rasterTransparencyAlpha(hdr,3,1,4,2,1,1)),
  [0,0,0,0,0,128,255,0])
const clipped = rasterTransparencyAlpha(new Float32Array([2,0,0,-1, 9,0,0,2, 0,0,0,NaN]),3,1,3,1,0,0)
assert.deepEqual(Array.from(clipped),[0,255,0])
assert.deepEqual(Array.from(rasterTransparencyAlpha(rgba,3,2,3,2,5,5)),[0,0,0,0,0,0])
assert.throws(() => rasterTransparencyAlpha(new Float32Array(7),3,1,2,2,0,0),/Invalid layer/)
assert.throws(() => rasterTransparencyAlpha(rgba,3,2,0,2,0,0),/Invalid layer/)
console.log('Layer transparency: off-canvas alignment, Float32 HDR, fractional alpha, clamping and guards passed')
