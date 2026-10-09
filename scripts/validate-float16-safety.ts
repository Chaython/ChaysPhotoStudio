import assert from 'node:assert/strict'
import { getProcessingPixelData, putProcessingPixelData } from '../src/editor/utils/canvas'

// Simulate a browser that advertises float16 Canvas2D but ignores the
// pixelFormat argument or cannot construct float16 ImageData.
const testImage = { width: 1, height: 1, data: new Uint8ClampedArray([255, 100, 50, 128]) }
let writeCalls = 0
const ctx = {
  getContextAttributes: () => ({ colorType: 'float16', colorSpace: 'srgb' }),
  getImageData: () => testImage,
  putImageData: () => { writeCalls++ },
}
const fake = { width: 1, height: 1, getContext: () => ctx } as unknown as HTMLCanvasElement
assert.throws(() => getProcessingPixelData(fake), /Float16 pixel readback unavailable/,
  'legacy Uint8 readback must not silently degrade a float16 layer')

const originalImageData = Object.getOwnPropertyDescriptor(globalThis, 'ImageData')
const originalFloat16 = Object.getOwnPropertyDescriptor(globalThis, 'Float16Array')
try {
  Object.defineProperty(globalThis, 'Float16Array', { configurable: true, value: undefined })
  assert.throws(() => putProcessingPixelData(fake, {
    width: 1, height: 1, precision: 'float32', data: new Float32Array([400, 125.5, 50, 255]),
  }), /Float16 pixel writeback unavailable/, 'failed float16 writes cannot fall back to Uint8')
  assert.equal(writeCalls, 0, 'no lower-precision pixels should be committed')
  const floatReadback = {
    width: 1, height: 1, pixelFormat: 'rgba-float16',
    data: new Float32Array([1.5, 0.25, 0.5, 0.75]),
  }
  ctx.getImageData = () => floatReadback as unknown as typeof testImage
  const pixels = getProcessingPixelData(fake)
  assert.ok(pixels.data instanceof Float32Array)
  assert.equal(pixels.data[0], 1.5 * 255)
  assert.equal(pixels.data[3], 0.75 * 255)
  console.log('Float16 readback and writeback refuse silent Uint8 quantization')
} finally {
  if (originalImageData) Object.defineProperty(globalThis, 'ImageData', originalImageData)
  if (originalFloat16) Object.defineProperty(globalThis, 'Float16Array', originalFloat16)
  else Reflect.deleteProperty(globalThis, 'Float16Array')
}
