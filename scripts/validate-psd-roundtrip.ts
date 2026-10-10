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
    { name: 'Base', canvas: bottom, left: 0, top: 0, opacity: 100, blendMode: 'normal', visible: true,
      blendingRanges: Uint8Array.from([0, 0, 255, 255, 0, 0, 255, 255]) },
    { name: 'Hidden ✓', canvas: hidden, left: 0, top: 0, opacity: 30, blendMode: 'normal', visible: false },
  ], bottom, { format, depth: 8, resolutionPpi: 300 })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)
  assert.equal(view.getUint16(4), format === 'psb' ? 2 : 1, 'version matches export format')
  assert.equal(view.getUint16(22), 8)
  assert.equal(view.getUint16(24), 3)
  const decoded = await decodePsd(bytes)
  assert.equal(decoded.layers.length, 2)
  assert.deepEqual(Array.from(decoded.layers[0].blendingRanges), [0,0,255,255,0,0,255,255], 'Photoshop Blend If ranges retained')
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


function sectionDivider(type: 1 | 2 | 3): Uint8Array {
  const block = new Uint8Array(16)
  block.set(new TextEncoder().encode('8BIMlsct'), 0)
  new DataView(block.buffer).setUint32(8, 4)
  new DataView(block.buffer).setUint32(12, type)
  return block
}

for (const format of ['psd', 'psb'] as const) {
  const image = canvas(80, 130, 180)
  const open = sectionDivider(1)
  const close = sectionDivider(3)
  const blob = buildPsd(2, 2, [
    { name: 'Folder A', canvas: image, left: 0, top: 0, opacity: 100,
      blendMode: 'normal', rawBlendKey: 'pass', visible: true,
      sectionMarker: true, additionalInfo: [open] },
    { name: 'Artwork', canvas: image, left: 0, top: 0, opacity: 100,
      blendMode: 'normal', visible: true },
    { name: '</Layer group>', canvas: image, left: 0, top: 0, opacity: 100,
      blendMode: 'normal', visible: true, sectionMarker: true,
      additionalInfo: [close] },
  ], image, { format, depth: 8 })
  const decoded = await decodePsd(new Uint8Array(await blob.arrayBuffer()))
  assert.equal(decoded.layers.length, 1, 'group boundaries must not become drawable layers')
  assert.deepEqual(decoded.sectionMarkers.map(m => m.beforeLayerIndex), [0, 1],
    'group marker positions are stable relative to drawable layers')
  assert.deepEqual(decoded.sectionMarkers.map(m => m.name), ['Folder A', '</Layer group>'])
  assert.equal(decoded.sectionMarkers[0].blendKey, 'pass', 'folder pass-through blending survives')
  assert.deepEqual(Array.from(decoded.sectionMarkers[0].additionalInfo[0]), Array.from(open))
  assert.deepEqual(Array.from(decoded.sectionMarkers[1].additionalInfo[0]), Array.from(close))
}


function cmykComposite(c: number, m: number, y: number, k: number): Uint8Array {
  // PSD: 26-byte header, three empty sections, raw planar CMYK composite.
  const bytes = new Uint8Array(26 + 4 + 4 + 4 + 2 + 4)
  bytes.set(new TextEncoder().encode('8BPS'))
  const view = new DataView(bytes.buffer)
  view.setUint16(4, 1)
  view.setUint16(12, 4)
  view.setUint32(14, 1)
  view.setUint32(18, 1)
  view.setUint16(22, 8)
  view.setUint16(24, 4)
  view.setUint16(38, 0)
  bytes.set([c, m, y, k], 40)
  return bytes
}
for (const [planes, expected] of [
  [[255, 255, 255, 255], [255, 255, 255]],
  [[0, 255, 255, 255], [0, 255, 255]],
  [[255, 255, 255, 0], [0, 0, 0]],
  [[128, 255, 255, 255], [128, 255, 255]],
] as const) {
  const decoded = await decodePsd(cmykComposite(...planes))
  assert.deepEqual(Array.from(decoded.canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data.slice(0, 3)),
    Array.from(expected), 'PSD CMYK channels must use Photoshop inverted ink storage')
}


for (const format of ['psd', 'psb'] as const) {
  const pixels = canvas(90, 80, 70)
  const adjustmentBlock = new Uint8Array(16)
  adjustmentBlock.set(new TextEncoder().encode('8BIMlevl'))
  new DataView(adjustmentBlock.buffer).setUint32(8, 4)
  const encoded = buildPsd(2, 2, [
    { name: 'Artwork', canvas: pixels, left: 0, top: 0, opacity: 100, visible: true, blendMode: 'normal' },
    { name: 'Levels', canvas: pixels, left: 0, top: 0, opacity: 100, visible: true,
      blendMode: 'normal', sectionMarker: true, additionalInfo: [adjustmentBlock] },
  ], pixels, { format, depth: 8 })
  const decoded = await decodePsd(new Uint8Array(await encoded.arrayBuffer()))
  assert.equal(decoded.layers.length, 1, 'unsupported Photoshop adjustment must not masquerade as raster')
  assert.equal(decoded.sectionMarkers.length, 1)
  assert.equal(decoded.sectionMarkers[0].kind, 'adjustment')
  assert.equal(decoded.sectionMarkers[0].beforeLayerIndex, 1)
  assert.deepEqual(Array.from(decoded.sectionMarkers[0].additionalInfo[0]), Array.from(adjustmentBlock))
  assert.ok(decoded.warnings.some(w => w.includes('not rendered or editable')))
}


function labComposite(l: number, a: number, b: number, depth: 8 | 16 = 8): Uint8Array {
  const bytes = new Uint8Array(26 + 4 + 4 + 4 + 2 + 3 * (depth >>> 3))
  bytes.set(new TextEncoder().encode('8BPS'))
  const view = new DataView(bytes.buffer)
  view.setUint16(4, 1)
  view.setUint16(12, 3)
  view.setUint32(14, 1)
  view.setUint32(18, 1)
  view.setUint16(22, depth)
  view.setUint16(24, 9) // Lab
  view.setUint16(38, 0) // raw composite channels
  if (depth === 8) bytes.set([l, a, b], 40)
  else for (const [i, value] of [l, a, b].entries()) view.setUint16(40 + i * 2, value, false)
  return bytes
}
for (const [color, white] of [
  [[255, 128, 128], true],
  [[0, 128, 128], false],
] as const) {
  const decoded = await decodePsd(labComposite(...color))
  const rgb = decoded.canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(rgb[i] - (white ? 255 : 0)) <= 2,
    'Photoshop Lab neutral white/black converts approximately to sRGB')
  assert.ok(decoded.warnings.some(w => w.includes('Lab was converted')))
}
const lab16 = await decodePsd(labComposite(65535, 32896, 32896, 16))
assert.equal(lab16.depth, 16)
assert.ok(lab16.canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[0] >= 253,
  'Photoshop 16-bit neutral Lab converts to a white preview')

console.log('PSD/PSB 8-/16-/32-bit round-trip: version, layers, visibility, alpha, Unicode PPI and folder structure and CMYK previews and Photoshop-only adjustment passthrough and Lab previews pass')

