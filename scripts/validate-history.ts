// Headless History regression test. Fake pixel canvases let us test snapshot
// ownership without a GUI, native canvas dependency or browser automation.
import assert from 'node:assert/strict'
import { Engine } from '../src/editor/engine/engine'
import type { HistoryState, Layer, PsDocument } from '../src/editor/types'

class TestCanvas {
  width = 2
  height = 2
  pixel = 0
  private context: {
    drawImage: (source: TestCanvas) => void
    getContextAttributes: () => { colorType: 'unorm8'; colorSpace: 'srgb' }
    getImageData: () => { data: Uint8ClampedArray }
  } | null = null
  getContext(_kind: string) {
    if (!this.context) this.context = {
      drawImage: (source: TestCanvas) => { this.pixel = source.pixel },
      getContextAttributes: () => ({ colorType: 'unorm8', colorSpace: 'srgb' }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    }
    return this.context
  }
}

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement: () => new TestCanvas() },
})

function canvas(pixel: number): HTMLCanvasElement {
  const result = new TestCanvas()
  result.pixel = pixel
  return result as unknown as HTMLCanvasElement
}
function value(c: HTMLCanvasElement | null | undefined): number | undefined {
  return c ? (c as unknown as TestCanvas).pixel : undefined
}
function draw(c: HTMLCanvasElement | null | undefined, pixel: number) {
  if (c) (c as unknown as TestCanvas).pixel = pixel
}

const layer: Layer = {
  id: 'l1', name: 'Layer 1', kind: 'raster', visible: true,
  opacity: 100, blendMode: 'normal', locked: false, clipped: false,
  canvas: canvas(10), source: canvas(20), mask: canvas(30),
  hdrPixels: new Float32Array([2, .5, 0, 1]),
  transform: null, smartFilters: [{ id: 'f1', type: 'gaussian-blur', params: { settings: { radius: 4 } }, enabled: true }],
  maskEnabled: true, vectorMask: null, adjustment: null, text: null, shape: null,
  blendIf: null, fx: null, _v: 1, _mv: 1,
}
const doc = {
  id: 'doc1', name: 'Test', width: 2, height: 2, activeLayerId: layer.id,
  layers: [layer],
  selection: { mask: canvas(40), bounds: { x: 0, y: 0, w: 1, h: 1 }, _v: 1, _paths: null, _pathsV: -1 },
  savedChannels: [{ id: 'alpha1', name: 'Alpha', mask: canvas(50), _v: 1 }],
  savedPaths: [], channelView: 'rgb', _epoch: 1,
} as unknown as PsDocument

// These helpers are intentionally private in production, but their buffer
// isolation is a correctness contract shared by Undo, Redo and Snapshots.
const engine = new Engine() as unknown as {
  captureState: (doc: PsDocument, label: string, previous?: HistoryState) => HistoryState
  restoreState: (doc: PsDocument, state: HistoryState) => void
}
const frozen = engine.captureState(doc, 'Before Edit')
assert.notEqual(frozen.layers[0].canvas, layer.canvas)
assert.notEqual(frozen.layers[0].mask, layer.mask)
assert.notEqual(frozen.selection?.mask, doc.selection?.mask)
assert.notEqual(frozen.savedChannels[0].mask, doc.savedChannels[0].mask)

draw(layer.canvas, 101)
draw(layer.source, 102)
draw(layer.mask, 103)
draw(doc.selection?.mask, 104)
draw(doc.savedChannels[0].mask, 105)
layer.hdrPixels![0] = 999
layer.smartFilters[0].params.settings.radius = 99
assert.equal(value(frozen.layers[0].canvas), 10)
assert.equal(value(frozen.layers[0].source), 20)
assert.equal(value(frozen.layers[0].mask), 30)
assert.equal(value(frozen.selection?.mask), 40)
assert.equal(value(frozen.savedChannels[0].mask), 50)
assert.equal(frozen.layers[0].hdrPixels![0], 2)
assert.equal(frozen.layers[0].smartFilters[0].params.settings.radius, 4)

engine.restoreState(doc, frozen)
assert.notEqual(doc.layers[0].canvas, frozen.layers[0].canvas)
draw(doc.layers[0].canvas, 106)
draw(doc.selection?.mask, 107)
assert.equal(value(frozen.layers[0].canvas), 10)
assert.equal(value(frozen.selection?.mask), 40)

// Explicit _v increments mark edited pixels: they must get a new snapshot.
doc.layers[0]._v++
const changed = engine.captureState(doc, 'Edit', frozen)
assert.notEqual(changed.layers[0].canvas, frozen.layers[0].canvas)
assert.equal(value(changed.layers[0].canvas), 106)

// Unchanged buffers are safely shared between two *frozen* states.
const unchanged = engine.captureState(doc, 'No Pixel Edit', changed)
assert.equal(unchanged.layers[0].canvas, changed.layers[0].canvas)
assert.equal(unchanged.savedChannels[0].mask, changed.savedChannels[0].mask)

console.log('History snapshot isolation, restored buffers and unchanged-pixel sharing passed')
