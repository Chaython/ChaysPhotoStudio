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
const rawEngine = new Engine()
const engine = rawEngine as unknown as {
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


// Photoshop Duplicate Image retains editable document structure; never flatten.
const originalDoc: PsDocument = {
  ...doc,
  name: 'Multi-layer HDR',
  workingBitDepth: 32,
  sourceBitDepth: 32,
  workingColorSpace: 'srgb',
  metadata: { fileName: 'source.psd', format: 'PSD/PSB', fileSize: 100, mimeType: 'image/vnd.adobe.photoshop', fields: [], editable: { title: 'Source' } },
  psdImageResources: ['original-payload'],
  guides: [{ id: 'guide1', orientation: 'h', pos: 10 }],
  view: { zoom: 1, panX: 0, panY: 0 },
  selectedLayerIds: ['l1'],
  history: { states: [], index: -1 },
  proof: { enabled: true, gamutWarning: false, profile: 'srgb', intent: 'relative', blackPointCompensation: true, simulatePaperColor: false },
  layerComps: [{
    id: 'comp1', name: 'Before', createdAt: 1, updatedAt: 1,
    options: { visibility: true, position: false, appearance: false },
    layers: { l1: { visible: true } },
  }],
  activeLayerCompId: 'comp1',
  frames: [{ id: 'frame1', name: 'Frame', delayMs: 100, layers: { l1: { visible: false } } }],
  _stroke: null, _strokeLayerId: null, _strokeErase: false, _strokeOpacity: 1,
  _strokeBlendMode: 'normal', _strokeBbox: null, _strokeV: 0, _liveDrag: null,
  dirty: false,
}
rawEngine.docs.push(originalDoc)
rawEngine.setActiveDocument(originalDoc.id)
const duplicated = rawEngine.duplicateDocument()
assert.ok(duplicated)
assert.equal(duplicated!.layers.length, originalDoc.layers.length)
assert.equal(duplicated!.workingBitDepth, 32)
assert.notEqual(duplicated!.layers[0].id, originalDoc.layers[0].id)
assert.notEqual(duplicated!.layers[0].canvas, originalDoc.layers[0].canvas)
assert.notEqual(duplicated!.layers[0].hdrPixels, originalDoc.layers[0].hdrPixels)
assert.equal(duplicated!.layers[0].hdrPixels?.[0], 2)
assert.notEqual(duplicated!.savedChannels[0].mask, originalDoc.savedChannels[0].mask)
assert.equal(duplicated!.metadata?.editable?.title, 'Source')
assert.notEqual(duplicated!.metadata, originalDoc.metadata)
assert.notEqual(duplicated!.activeLayerId, originalDoc.activeLayerId)
assert.equal(duplicated!.selectedLayerIds?.[0], duplicated!.activeLayerId)
assert.notEqual(duplicated!.activeLayerCompId, originalDoc.activeLayerCompId)
assert.equal(duplicated!.layerComps?.[0].layers[duplicated!.layers[0].id]?.visible, true)
assert.equal(duplicated!.frames?.[0].layers[duplicated!.layers[0].id]?.visible, false)
assert.equal(duplicated!.history.index, 0)
assert.equal(duplicated!.history.states.length, 1)
assert.equal(originalDoc.history.index, -1)

draw(duplicated!.layers[0].canvas, 201)
assert.notEqual(value(originalDoc.layers[0].canvas), 201)
console.log('Duplicate Document preserves layers, HDR, selections, metadata, layer comps and animation without shared buffers')

const priorSelection = duplicated!.selection!
assert.ok(priorSelection, 'Duplicate retains an active selection to reselect')
const beforeDeselectPixel = value(priorSelection.mask)
assert.equal(rawEngine.canReselectSelection(), false, 'Reselect is disabled while selection is active')
rawEngine.deselect()
assert.equal(duplicated!.selection, null)
assert.equal(rawEngine.canReselectSelection(), true)
draw(priorSelection.mask, 201)
rawEngine.setActiveDocument(originalDoc.id)
assert.equal(rawEngine.canReselectSelection(), false, 'Reselect is scoped to the active document')
rawEngine.setActiveDocument(duplicated!.id)
rawEngine.reselectSelection()
assert.ok(duplicated!.selection)
assert.equal(value(rawEngine.activeDoc?.selection?.mask), beforeDeselectPixel, 'Reselect must restore the independent selection mask')
assert.equal(rawEngine.canReselectSelection(), false)
assert.equal(duplicated!.history.states[duplicated!.history.index].label, 'Reselect')
rawEngine.undo()
assert.equal(duplicated!.selection, null, 'Undo Reselect clears the selection')
rawEngine.redo()
assert.equal(value(rawEngine.activeDoc?.selection?.mask), beforeDeselectPixel, 'Redo Reselect restores its history-safe mask')
console.log('Select > Reselect is independent, per-document and undo/redo-safe')


// The engine already had Photoshop-style geometry operations, but they were
// absent from the Layer menu. Verify that editable layer positions move once
// per command, preserve the primary layer, and undo/redo round-trip.
const alignDoc = duplicated!
alignDoc.width = 200
alignDoc.height = 100
const anchor = alignDoc.layers[0]
anchor.kind = 'raster'
anchor.locked = false
anchor.canvas = canvas(7)
anchor.offsetX = 20
anchor.offsetY = 30
const movable: Layer = {
  ...anchor, id: 'alignment-movable', name: 'Movable',
  canvas: canvas(8), offsetX: 120, offsetY: 70, _v: 1,
  hdrPixels: null, source: null, mask: null,
}
alignDoc.layers.push(movable)
alignDoc.activeLayerId = anchor.id
alignDoc.selectedLayerIds = [anchor.id, movable.id]
rawEngine.pushHistory('Before Align', alignDoc)
rawEngine.alignSelected('left', 'primary')
assert.equal(anchor.offsetX, 20, 'primary layer must not move')
assert.equal(movable.offsetX, 20, 'other layer aligns to primary')
assert.equal(alignDoc.history.states[alignDoc.history.index].label, 'Align Layers')
rawEngine.undo()
assert.equal(alignDoc.layers.find(l => l.id === movable.id)?.offsetX, 120)
rawEngine.redo()
assert.equal(alignDoc.layers.find(l => l.id === movable.id)?.offsetX, 20)

const top = alignDoc.layers.find(l => l.id === anchor.id)!
const middle = alignDoc.layers.find(l => l.id === movable.id)!
top.offsetX = 20
middle.offsetX = 50
const end: Layer = { ...middle, id: 'alignment-end', name: 'End', canvas: canvas(9), offsetX: 180, _v: 2 }
alignDoc.layers.push(end)
alignDoc.selectedLayerIds = [top.id, middle.id, end.id]
rawEngine.pushHistory('Before Spacing', alignDoc)
rawEngine.distributeSelectedSpacing('horizontal')
assert.equal(middle.offsetX, 100, 'spacing distributes gaps between retained endpoints')
assert.equal(end.offsetX, 180, 'last layer remains fixed')
rawEngine.undo()
assert.equal(alignDoc.layers.find(l => l.id === middle.id)?.offsetX, 50)
console.log('Align and Distribute preserve editable layers and history')


// Photoshop Canvas Size anchor offset must consistently shift every
// document-space mask, channel and vector reference, not just raster layers.
const resizeDoc = alignDoc
resizeDoc.width = 100
resizeDoc.height = 60
resizeDoc.layers = [resizeDoc.layers[0]]
resizeDoc.layers[0].offsetX = 10
resizeDoc.layers[0].offsetY = 5
resizeDoc.selection = { mask: canvas(81), bounds: { x: 0, y: 0, w: 1, h: 1 }, _v: 2, _paths: null, _pathsV: -1 }
resizeDoc.savedChannels = [{ id: 'alpha-canvas', name: 'Alpha', mask: canvas(82), _v: 2 }]
resizeDoc.savedPaths = [{ id: 'path-canvas', name: 'Path', closed: false, visible: true,
  anchors: [{ x: 8, y: 10, inX: 0, inY: 0, outX: 0, outY: 0, pair: true }] }]
resizeDoc.guides = [{ id: 'guide-canvas', orientation: 'v', pos: 20 }]
resizeDoc.colorSamplers = [{ id: 'sampler-canvas', x: 3, y: 5 }]
resizeDoc.measurements = [{ id: 'measurement-canvas', name: 'Distance',
  segments: [{ a: { x: 5, y: 5 }, b: { x: 25, y: 15 } }],
  unit: 'px', pixelsPerUnit: 1, totalLengthPx: 22, createdAt: 1 }]
resizeDoc.frames = [{ id: 'frame-canvas', name: 'Frame', delayMs: 100,
  layers: { [resizeDoc.layers[0].id]: { visible: true, x: 10, y: 5 } } }]
rawEngine.pushHistory('Before Canvas Size', resizeDoc)
rawEngine.resizeCanvas({ w: 120, h: 80, anchor: 'bottom-right' })
assert.equal(resizeDoc.layers[0].offsetX, 30)
assert.equal(resizeDoc.layers[0].offsetY, 25)
assert.equal(resizeDoc.selection?.mask.width, 120)
assert.equal(resizeDoc.selection?.mask.height, 80)
assert.equal(resizeDoc.savedChannels[0].mask.width, 120)
assert.equal(resizeDoc.savedPaths?.[0].anchors[0].x, 28)
assert.equal(resizeDoc.savedPaths?.[0].anchors[0].y, 30)
assert.equal(resizeDoc.guides[0].pos, 40)
assert.equal(resizeDoc.colorSamplers?.[0].x, 23)
assert.equal(resizeDoc.measurements?.[0].segments[0].a.x, 25)
assert.equal(resizeDoc.frames?.[0].layers[resizeDoc.layers[0].id].x, 30)
rawEngine.undo()
assert.equal(resizeDoc.width, 100)
assert.equal(resizeDoc.selection?.mask.width, 2, 'undo restores the original selection backing store')
assert.equal(resizeDoc.guides[0].pos, 20, 'Undo restores guide coordinates')
assert.equal(resizeDoc.colorSamplers?.[0].x, 3, 'Undo restores color sampler coordinates')
assert.equal(resizeDoc.measurements?.[0].segments[0].a.x, 5, 'Undo restores ruler measurements')
assert.equal(resizeDoc.frames?.[0].layers[resizeDoc.layers[0].id].x, 10, 'Undo restores animation geometry')
rawEngine.redo()
assert.equal(resizeDoc.guides[0].pos, 40, 'Redo restores adjusted guide coordinates')
rawEngine.undo()
console.log('Canvas Size transforms and undoes all document-space metadata')

// Photoshop Layer > Arrange must invalidate stale flattened-composite caches
// even when every layer has matching pixel versions and blend properties.
const stackDoc = resizeDoc
const firstLayer = stackDoc.layers[0]
const secondLayer: Layer = { ...firstLayer, id: 'arrange-middle', name: 'Middle', canvas: canvas(17) }
const thirdLayer: Layer = { ...firstLayer, id: 'arrange-top', name: 'Top', canvas: canvas(18) }
stackDoc.layers = [firstLayer, secondLayer, thirdLayer]
stackDoc.activeLayerId = firstLayer.id
stackDoc.selectedLayerIds = [firstLayer.id]
rawEngine.pushHistory('Before Arrange', stackDoc)
;(stackDoc as PsDocument & { _flatCache?: object | null; _flatCacheKey?: string | null })._flatCache = {}
;(stackDoc as PsDocument & { _flatCacheKey?: string | null })._flatCacheKey = 'stale'
rawEngine.reorderLayer(firstLayer.id, 2)
assert.deepEqual(stackDoc.layers.map(l => l.id), [secondLayer.id, thirdLayer.id, firstLayer.id])
assert.equal((stackDoc as PsDocument & { _flatCache?: object | null })._flatCache, null,
  'Arranging must invalidate stale composite output')
assert.equal(stackDoc.history.states[stackDoc.history.index].label, 'Reorder Layer')
rawEngine.undo()
assert.deepEqual(stackDoc.layers.map(l => l.id), [firstLayer.id, secondLayer.id, thirdLayer.id])
rawEngine.redo()
assert.deepEqual(stackDoc.layers.map(l => l.id), [secondLayer.id, thirdLayer.id, firstLayer.id])
const previousHistoryIndex = stackDoc.history.index
rawEngine.reorderLayer(firstLayer.id, 2)
assert.equal(stackDoc.history.index, previousHistoryIndex, 'No-op arrangement must not add History')
rawEngine.moveLayerBy(firstLayer.id, 1)
assert.equal(stackDoc.history.index, previousHistoryIndex, 'Bring Forward at front is a no-op')
console.log('Layer Arrange updates stack order, invalidates the composite and supports Undo/Redo')


// Image > Reveal All grows the canvas around visible off-canvas Smart Object
// geometry without flattening its source or changing any original pixel values.
const revealDoc = stackDoc
revealDoc.width = 100
revealDoc.height = 60
const revealSmart: Layer = {
  ...revealDoc.layers[0], id: 'reveal-smart', name: 'Off-canvas Smart Object',
  kind: 'smart', visible: true, source: canvas(29), canvas: null, hdrPixels: null,
  transform: { x: -4, y: 10, scale: 1, rotation: 0 }, mask: null,
}
revealDoc.layers = [revealSmart]
revealDoc.activeLayerId = revealSmart.id
revealDoc.selectedLayerIds = [revealSmart.id]
revealDoc.frames = [{ id: 'reveal-frame', name: 'Frame', delayMs: 200,
  layers: { [revealSmart.id]: { x: -4, y: 10, visible: true } } }]
revealDoc.measurements = [{ id: 'reveal-measurement', name: 'Measure',
  segments: [{ a: { x: -3, y: 5 }, b: { x: 7, y: 5 } }],
  unit: 'px', pixelsPerUnit: 1, totalLengthPx: 10, createdAt: 2 }]
rawEngine.pushHistory('Before Reveal All', revealDoc)
assert.equal(rawEngine.revealAll(), true)
assert.equal(revealDoc.width, 105)
assert.equal(revealDoc.height, 60)
assert.equal(revealDoc.layers[0].kind, 'smart', 'Reveal All must preserve Smart Object editing')
assert.equal(revealDoc.layers[0].transform?.x, 1, 'off-canvas source shifted into expanded frame')
assert.equal(revealDoc.frames?.[0].layers[revealSmart.id]?.x, 1, 'animation offsets translated with Reveal All')
assert.equal(revealDoc.measurements?.[0].segments[0].a.x, 2, 'ruler measurements translated with Reveal All')
assert.equal(revealDoc.history.states[revealDoc.history.index].label, 'Reveal All')
assert.equal(rawEngine.revealAll(), false, 'Reveal All is a no-op when all content is in-frame')
rawEngine.undo()
assert.equal(revealDoc.width, 100)
assert.equal(revealDoc.layers[0].transform?.x, -4)
assert.equal(revealDoc.frames?.[0].layers[revealSmart.id]?.x, -4, 'Undo restores animation offsets')
assert.equal(revealDoc.measurements?.[0].segments[0].a.x, -3, 'Undo restores ruler measurements')
console.log('Image > Reveal All preserves off-canvas Smart Objects and Undo')
