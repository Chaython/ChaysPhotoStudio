// Layer Matting and trimming tests with fake Canvas2D pixel storage.
import assert from 'node:assert/strict'
import { Engine } from '../src/editor/engine/engine'
import type { PsDocument } from '../src/editor/types'

class FakeImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}
class Canvas {
  width = 3; height = 1
  pixels = new Uint8ClampedArray(12)
  constructor() {
    for (let i = 0; i < 12; i += 4) {
      this.pixels[i] = 200
      this.pixels[i + 1] = 100
      this.pixels[i + 2] = 50
      this.pixels[i + 3] = 255
    }
  }
  getContext() {
    return {
      getContextAttributes: () => ({ colorType: 'unorm8', colorSpace: 'srgb' }),
      getImageData: () => new FakeImageData(this.pixels.slice(), this.width, this.height),
      putImageData: (img: { data: Uint8ClampedArray }) => { this.pixels = img.data.slice() },
      drawImage: (src: Canvas) => { this.pixels = src.pixels.slice() },
    }
  }
}
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const oldImageData = Object.getOwnPropertyDescriptor(globalThis, 'ImageData')
Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: FakeImageData })
Object.defineProperty(globalThis, 'document', { configurable: true, value: {
  createElement: () => new Canvas(),
}})
try {
  const engine = new Engine()
  const layer = {
    id: 'l1', name: 'Image', kind: 'raster', locked: false,
    visible: true, opacity: 100, blendMode: 'normal', canvas: new Canvas(),
    source: null, mask: null, smartFilters: [], transform: null,
    _v: 1, _mv: 1,
  }
  const doc = {
    id: 'matte', width: 3, height: 1, workingBitDepth: 8,
    layers: [layer], activeLayerId: layer.id, savedChannels: [], savedPaths: [],
    channelView: 'rgb', selection: null, history: { states: [], index: -1 }, _epoch: 1,
  } as unknown as PsDocument
  engine.docs.push(doc)
  ;(engine as unknown as { _activeId: string })._activeId = doc.id
  const original = layer.canvas
  assert.equal(engine.removeLayerMatte(layer.id, 'white'), false)
  assert.equal(engine.defringeLayer(layer.id), false)
  assert.equal(layer.canvas, original, 'no-op must preserve raster identity')
  assert.equal(layer._v, 1, 'no-op must not increment version')
  assert.equal(doc.history.index, -1, 'no-op must not add History')
  layer.locked = true
  assert.equal(engine.trimLayerToContent(layer.id), false)
  assert.equal(layer.canvas, original)
  layer.locked = false
  layer.canvas.pixels[3] = 128
  assert.equal(engine.removeLayerMatte(layer.id, 'white'), true)
  assert.equal(layer._v, 2, 'successful matting has a single version bump')
  assert.equal(doc.history.index, 0, 'successful matting has one History entry')
  assert.notEqual(layer.canvas, original, 'successful edit commits a new buffer')
  assert.ok(layer.canvas.pixels[0] < 200, 'white matte removes excess white')
  console.log('Matting no-op, locked trim, atomic History and versioning passed')
} finally {
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
  else Reflect.deleteProperty(globalThis, 'document')
  if (oldImageData) Object.defineProperty(globalThis, 'ImageData', oldImageData)
  else Reflect.deleteProperty(globalThis, 'ImageData')
}
