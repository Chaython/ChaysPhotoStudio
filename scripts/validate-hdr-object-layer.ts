import assert from 'node:assert/strict'
import { Engine } from '../src/editor/engine/engine'
import type { PsDocument } from '../src/editor/types'

class FakeImageData {
  data: Uint8ClampedArray; width: number; height: number
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data; this.width = width; this.height = height
  }
}
class FakeCanvas {
  width = 1; height = 1
  getContext() {
    return {
      getContextAttributes: () => ({ colorType: 'unorm8', colorSpace: 'srgb' }),
      getImageData: (_x: number, _y: number, w: number, h: number) =>
        new FakeImageData(new Uint8ClampedArray(w * h * 4), w, h),
      putImageData() {}, drawImage() {},
    }
  }
}
const prevDoc = Object.getOwnPropertyDescriptor(globalThis, 'document')
const prevImage = Object.getOwnPropertyDescriptor(globalThis, 'ImageData')
Object.defineProperty(globalThis, 'document', { configurable: true, value: {
  createElement: () => new FakeCanvas(),
}})
Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: FakeImageData })
try {
  const engine = new Engine()
  const doc = {
    id: 'hdr-object', width: 4, height: 3, workingBitDepth: 32, layers: [],
    activeLayerId: null, history: { states: [], index: -1 }, _epoch: 1,
  } as unknown as PsDocument
  engine.docs.push(doc)
  ;(engine as unknown as { _activeId: string })._activeId = doc.id
  const scene = new Float32Array(4 * 3 * 4)
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
    const i = (y * 4 + x) * 4
    scene[i] = x + y * 10 + 1.5
    scene[i + 1] = x * 2
    scene[i + 2] = y / 2
    scene[i + 3] = 0.75
  }
  let history = 0
  ;(engine as unknown as { pushHistory: () => void }).pushHistory = () => { history++ }
  ;(engine as unknown as { emit: () => void }).emit = () => {}
  ;(engine as unknown as { simpleHdrComposite: () => Float32Array | null }).simpleHdrComposite = () => scene
  const result = engine.addObjectLayer({ x: 1, y: 1, w: 2, h: 2 }, 'Subject')
  assert.ok(result)
  assert.equal(result.kind, 'raster')
  assert.equal(result.canvas?.width, 2)
  assert.equal(result.canvas?.height, 2)
  assert.equal(result.offsetX, 1)
  assert.equal(result.offsetY, 1)
  assert.equal(result.hdrColorSpace, 'linear-srgb')
  assert.deepEqual(Array.from(result.hdrPixels!), [
    ...scene.slice((1 * 4 + 1) * 4, (1 * 4 + 3) * 4),
    ...scene.slice((2 * 4 + 1) * 4, (2 * 4 + 3) * 4),
  ], 'Float32 source pixels above white are copied without clipping')
  assert.equal(history, 1)
  const count = doc.layers.length
  ;(engine as unknown as { simpleHdrComposite: () => Float32Array | null }).simpleHdrComposite = () => null
  assert.equal(engine.addObjectLayer({ x: 0, y: 0, w: 1, h: 1 }), null)
  assert.equal(doc.layers.length, count, 'unsupported complex HDR stack is a true no-op')
  assert.equal(history, 1)
  console.log('HDR object extraction preserves Float32 highlights, alpha, offsets and History')
} finally {
  if (prevDoc) Object.defineProperty(globalThis, 'document', prevDoc)
  else Reflect.deleteProperty(globalThis, 'document')
  if (prevImage) Object.defineProperty(globalThis, 'ImageData', prevImage)
  else Reflect.deleteProperty(globalThis, 'ImageData')
}
