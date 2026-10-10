import assert from 'node:assert/strict'
import { buildPsd, decodePsd } from '../src/editor/formats/psd'

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
console.log('PSD/PSB 8-bit round-trip: version, layers, visibility, alpha, Unicode and PPI pass')
