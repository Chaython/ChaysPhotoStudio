import assert from 'node:assert/strict'
import { buildPsd, decodePsd, restorePsdPrediction } from '../src/editor/formats/psd'

// Minimal 8-bit Canvas2D fixture; tests the real binary writer and reader
// without requiring a graphics stack or a browser installation.
class TestImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}
class TestCanvas {
  width = 1
  height = 1
  pixels = new Uint8ClampedArray(0)
  getContext() {
    const canvas = this
    return {
      getContextAttributes: () => ({ colorType: 'unorm8', colorSpace: 'srgb' }),
      getImageData(x: number, y: number, w: number, h: number) {
        const data = new Uint8ClampedArray(w * h * 4)
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const source = ((y + j) * canvas.width + x + i) * 4
          const dest = (j * w + i) * 4
          data.set(canvas.pixels.subarray(source, source + 4), dest)
        }
        return new TestImageData(data, w, h)
      },
      putImageData(img: TestImageData, x: number, y: number) {
        if (canvas.pixels.length !== canvas.width * canvas.height * 4) canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4)
        for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) {
          const source = (j * img.width + i) * 4
          const dest = ((y + j) * canvas.width + x + i) * 4
          canvas.pixels.set(img.data.subarray(source, source + 4), dest)
        }
      },
      drawImage() { throw new Error('Unexpected Canvas2D flattening in PSD round-trip test') },
    }
  }
}
;(globalThis as any).ImageData = TestImageData
;(globalThis as any).document = { createElement: (tag: string) => {
  assert.equal(tag, 'canvas')
  return new TestCanvas()
} }

function canvas(r: number, g: number, b: number, a = 255): HTMLCanvasElement {
  const c = new TestCanvas()
  c.width = 2
  c.height = 2
  c.pixels = new Uint8ClampedArray(Array.from({ length: 4 }, () => [r, g, b, a]).flat())
  return c as unknown as HTMLCanvasElement
}

for (const format of ['psd', 'psb'] as const) {
  const bottom = canvas(200, 0, 0)
  const hidden = canvas(0, 180, 0, 127)
  const blob = buildPsd(2, 2, [
    { name: 'Base', canvas: bottom, left: 0, top: 0, opacity: 100, blendMode: 'normal', visible: true },
    { name: 'Hidden ✓', canvas: hidden, left: 0, top: 0, opacity: 30, blendMode: 'normal', visible: false },
  ], bottom, { format, depth: 8, resolutionPpi: 300 })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)
  assert.equal(view.getUint16(4), format === 'psb' ? 2 : 1, 'version matches export format')
  assert.equal(view.getUint16(22), 8)
  assert.equal(view.getUint16(24), 3)
  const decoded = await decodePsd(bytes)
  assert.equal(decoded.layers.length, 2)
  assert.deepEqual(decoded.layers.map(l => l.name), ['Base', 'Hidden ✓'])
  assert.deepEqual(decoded.layers.map(l => l.visible), [true, false], 'Photoshop hidden flag is inverted')
  assert.equal(decoded.layers[1].opacity, 30)
  assert.equal(decoded.layers[0].canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[0], 200)
  assert.equal(decoded.layers[1].canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[3], 127)
  assert.ok(Math.abs(decoded.resolutionPpi - 300) < 0.01)
}

for (const format of ['psd', 'psb'] as const) {
  const image = canvas(84, 173, 246, 200)
  const samples = new Float32Array([
    2.5, 0.5, 0.25, 1,
    1.25, 0.125, 0, 0.75,
    0, 0.5, 3.75, 1,
    0.25, 0.25, 0.25, 0.5,
  ])
  const blob = buildPsd(2, 2, [{
    name: 'HDR layer', canvas: image, left: 0, top: 0, opacity: 100,
    blendMode: 'normal', visible: true, hdrPixels: samples,
  }], image, { format, depth: 32, compositeHdrPixels: samples })
  const data = new Uint8Array(await blob.arrayBuffer())
  assert.equal(new DataView(data.buffer).getUint16(22), 32)
  const decoded = await decodePsd(data)
  assert.equal(decoded.depth, 32)
  assert.ok(decoded.hdrPixels)
  assert.deepEqual(Array.from(decoded.hdrPixels), Array.from(samples), 'HDR composite survives Photoshop float round-trip')
  assert.ok(decoded.layers[0].hdrPixels)
  assert.deepEqual(Array.from(decoded.layers[0].hdrPixels), Array.from(samples), 'HDR layer survives Photoshop float round-trip')
  assert.throws(() => buildPsd(2, 2, [{
    name: 'Missing HDR', canvas: image, left: 0, top: 0, opacity: 100,
    blendMode: 'normal', visible: true,
  }], image, { format, depth: 32, compositeHdrPixels: samples }), /full-resolution Float32/)
}


for (const format of ['psd', 'psb'] as const) {
  const image = canvas(50, 100, 150, 255)
  const blob = buildPsd(2, 2, [{
    name: '16-bit RGB', canvas: image, left: 0, top: 0,
    opacity: 100, blendMode: 'normal', visible: true,
  }], image, { format, depth: 16 })
  const data = new Uint8Array(await blob.arrayBuffer())
  assert.ok(Buffer.from(data).includes(Buffer.from('Lr16')), 'Photoshop high-depth layer section is present')
  const decoded = await decodePsd(data)
  assert.equal(decoded.depth, 16)
  assert.equal(decoded.layers.length, 1, 'Lr16 contains editable layer records')
  assert.equal(decoded.layers[0].name, '16-bit RGB')
  assert.equal(decoded.layers[0].canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[0], 50)
}
assert.deepEqual(Array.from(restorePsdPrediction(Uint8Array.from([10,10,10]), 3, 1, 8)), [10,20,30])
assert.deepEqual(Array.from(restorePsdPrediction(Uint8Array.from([0,10,0,10]), 2, 1, 16)), [0,10,0,20])
const floats = new Uint8Array(8)
const floatsView = new DataView(floats.buffer)
floatsView.setFloat32(0, 2.5, false)
floatsView.setFloat32(4, 0.125, false)
const shuffled = Uint8Array.from([floats[0],floats[4],floats[1],floats[5],floats[2],floats[6],floats[3],floats[7]])
for (let i = shuffled.length - 1; i > 0; i--) shuffled[i] = (shuffled[i] - shuffled[i - 1] + 256) & 255
assert.deepEqual(Array.from(restorePsdPrediction(shuffled, 2, 1, 32)), Array.from(floats))
assert.throws(() => restorePsdPrediction(Uint8Array.from([1,2,3]), 2, 1, 32), /Invalid PSD predicted/)

console.log('PSD/PSB 8-/16-/32-bit round-trip: version, layers, visibility, alpha, Unicode and PPI pass')\n
