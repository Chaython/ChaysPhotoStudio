import assert from 'node:assert/strict'
import { offsetPixels } from '../src/editor/image-ops/offset'
import type { PixelImage } from '../src/editor/image-ops/pixel-data'

function image(): ImageData {
  return { width: 3, height: 2, data: new Uint8ClampedArray([
    10,0,0,255, 20,0,0,255, 30,0,0,255,
    40,0,0,100, 50,0,0,150, 60,0,0,200,
  ]) } as ImageData
}
const reds = (img: PixelImage) => Array.from({length: img.width * img.height}, (_, p) => img.data[p * 4])
const alpha = (img: PixelImage) => Array.from({length: img.width * img.height}, (_, p) => img.data[p * 4 + 3])
const wrapped = image()
offsetPixels(wrapped, {horizontal: 1, vertical: 0, edgeMode: 'wrap'})
assert.deepEqual(reds(wrapped), [30,10,20,60,40,50])
assert.deepEqual(alpha(wrapped), [255,255,255,200,100,150])
const vertically = image()
offsetPixels(vertically, {horizontal: 0, vertical: 1, edgeMode: 'wrap'})
assert.deepEqual(reds(vertically), [40,50,60,10,20,30])
const transparent = image()
offsetPixels(transparent, {horizontal: 1, vertical: 0, edgeMode: 'transparent'})
assert.deepEqual(reds(transparent), [0,10,20,0,40,50])
assert.deepEqual(alpha(transparent), [0,255,255,0,100,150])
const repeated = image()
offsetPixels(repeated, {horizontal: 1, vertical: 1, edgeMode: 'repeat-edge'})
assert.deepEqual(reds(repeated), [10,10,20,10,10,20])
const inverse = image()
offsetPixels(inverse, {horizontal: -1, vertical: 0, edgeMode: 'wrap'})
assert.deepEqual(reds(inverse), [20,30,10,50,60,40])
const hdr: PixelImage = {width: 2,height: 1,precision: 'float32', dynamicRange: 'scene-linear',
 data: new Float32Array([500,0,0,1, 1200,200,0,0.5])}
offsetPixels(hdr, {horizontal: 1, vertical: 0, edgeMode: 'wrap'})
assert.deepEqual(Array.from(hdr.data), [1200,200,0,0.5,500,0,0,1], 'HDR values and alpha survive without clipping')
assert.throws(()=>offsetPixels(image(),{horizontal: NaN,vertical:0,edgeMode:'wrap'}),/finite/)
console.log('Offset: wrap, transparent, repeated edges, signed X/Y and Float32 HDR passed')
