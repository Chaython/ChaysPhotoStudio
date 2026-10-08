// Headless History regression test. Fake pixel canvases let us test snapshot
// ownership without a GUI, native canvas dependency or browser automation.
import assert from 'node:assert/strict'
import { Engine } from '../src/editor/engine/engine'
import { invertMaskAlpha } from '../src/editor/engine/selection'
import type { HistoryState, Layer, PsDocument } from '../src/editor/types'

class TestCanvas {
  width = 2
  height = 2
  pixel = 0
  private context: {
    drawImage: (source: TestCanvas) => void
    getContextAttributes: () => { colorType: 'unorm8'; colorSpace: 'srgb' }
    getImageData: () => { data: Uint8ClampedArray }
    putImageData: (data: { data: Uint8ClampedArray }) => void
  } | null = null
  getContext(_kind: string) {
    if (!this.context) this.context = {
      drawImage: (source: TestCanvas) => { this.pixel = source.pixel },
      getContextAttributes: () => ({ colorType: 'unorm8', colorSpace: 'srgb' }),
      getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }),
      putImageData: () => {},
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


// Photoshop Filter > Last Filter should work on Smart Objects without
// rasterizing, retain a frozen copy of settings, and respect layer locks.
const repeatDoc = stackDoc
const smart: Layer = {
  ...repeatDoc.layers[0], id: 'repeat-smart', kind: 'smart', name: 'Smart Filters',
  locked: false, canvas: null, hdrPixels: null, source: canvas(29),
  smartFilters: [], transform: { x: 1, y: 1, scale: 1, rotation: 0 },
}
repeatDoc.layers.push(smart)
repeatDoc.activeLayerId = smart.id
repeatDoc.selectedLayerIds = [smart.id]
assert.equal(rawEngine.canRepeatLastFilter(), false, 'Repeat is disabled until a filter succeeds')
const params = { radius: 3, advanced: { strength: 7 } }
rawEngine.addSmartFilter(smart.id, 'gaussian-blur', params)
assert.equal(smart.smartFilters.length, 1)
assert.equal(rawEngine.canRepeatLastFilter(), true)
params.radius = 99
params.advanced.strength = 99
await rawEngine.repeatLastFilter()
assert.equal(smart.smartFilters.length, 2, 'Repeat adds another non-destructive Smart Filter')
assert.equal(smart.smartFilters[1].params.radius, 3, 'Repeat uses immutable saved parameters')
assert.equal(smart.smartFilters[1].params.advanced.strength, 7)
assert.equal(repeatDoc.history.states[repeatDoc.history.index].label, 'Smart Filter: Gaussian Blur')
smart.locked = true
assert.equal(rawEngine.canRepeatLastFilter(), false, 'Locked layer cannot run Last Filter')
await rawEngine.repeatLastFilter()
assert.equal(smart.smartFilters.length, 2)
smart.locked = false
rawEngine.setActiveDocument(originalDoc.id)
assert.equal(rawEngine.canRepeatLastFilter(), false, 'Last Filter settings are document-scoped')
console.log('Filter > Last Filter supports Smart Filters, parameter isolation and locked-layer safety')


// Selection modifiers with zero or invalid widths are no-ops and cannot
// erase a selection or allocate a History snapshot.
rawEngine.setActiveDocument(originalDoc.id)
const originalSelection = originalDoc.selection
assert.ok(originalSelection)
const historyBeforeInvalidModify = originalDoc.history.index
for (const bad of [0, -2, Number.NaN, Infinity]) {
  rawEngine.selectionModify('smooth', bad)
  rawEngine.selectionModify('contract', bad)
}
assert.equal(originalDoc.selection, originalSelection)
assert.equal(originalDoc.history.index, historyBeforeInvalidModify)
console.log('Select > Modify invalid radii cannot destroy selection state')


// Layer > Lock / Unlock acts on all selected layers, including layers already
// locked (which selectedLayers() intentionally omits for move/align commands).
rawEngine.setActiveDocument(repeatDoc.id)
repeatDoc.selectedLayerIds = repeatDoc.layers.slice(0, 2).map(l => l.id)
for (const l of repeatDoc.layers.slice(0, 2)) l.locked = false
const selectedIdsForLock = [...repeatDoc.selectedLayerIds]
assert.equal(rawEngine.canSetSelectedLayersLocked(true), true)
rawEngine.setSelectedLayersLocked(true)
assert.ok(selectedIdsForLock.every(id => repeatDoc.layers.find(l => l.id === id)?.locked))
assert.equal(repeatDoc.history.states[repeatDoc.history.index].label, 'Lock Layers')
const beforeNoOpLock = repeatDoc.history.index
rawEngine.setSelectedLayersLocked(true)
assert.equal(repeatDoc.history.index, beforeNoOpLock, 'locking already-locked layers is a no-op')
rawEngine.setSelectedLayersLocked(false)
assert.ok(selectedIdsForLock.every(id => !repeatDoc.layers.find(l => l.id === id)?.locked))
rawEngine.undo()
assert.ok(selectedIdsForLock.every(id => repeatDoc.layers.find(l => l.id === id)?.locked),
  'Undo restores the whole locked selection')
rawEngine.redo()
assert.ok(selectedIdsForLock.every(id => !repeatDoc.layers.find(l => l.id === id)?.locked))
console.log('Layer Lock/Unlock acts on multi-selection with one undoable History entry')


// Fake pixel canvases do not require a browser ImageData implementation,
// but HDR preview creation exercises putImageData in its 8-bit fallback.
const imageDataDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ImageData')
if (typeof ImageData === 'undefined') {
  Object.defineProperty(globalThis, 'ImageData', {
    configurable: true,
    value: class ImageData {
      data: Uint8ClampedArray
      width: number
      height: number
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data; this.width = width; this.height = height
      }
    },
  })
}
// The internal clipboard must retain Float32 HDR highlights during Copy/Paste.
// The OS PNG clipboard remains SDR by design, but internal 32-bit documents
// preserve full source values and paste from an independent pixel allocation.
rawEngine.setActiveDocument(repeatDoc.id)
repeatDoc.selection = null
repeatDoc.workingBitDepth = 32
repeatDoc.width = 2
repeatDoc.height = 2
const hdrSource = repeatDoc.layers[0]
hdrSource.kind = 'raster'
hdrSource.locked = false
hdrSource.canvas = canvas(33)
hdrSource.offsetX = 0
hdrSource.offsetY = 0
hdrSource.hdrPixels = new Float32Array([
  12, 2, .25, 1, 3, .2, 1, .5,
  1, 2, 3, 1, 6, 4, .5, .25,
])
hdrSource._hdrPreviewBefore = null
repeatDoc.activeLayerId = hdrSource.id
repeatDoc.selectedLayerIds = [hdrSource.id]
assert.equal(rawEngine.copyLayer(false), true, 'HDR copy succeeds')
assert.equal(rawEngine.pasteLayer(), true, 'HDR paste succeeds')
const pastedHdr = repeatDoc.layers.find(l => l.id === repeatDoc.activeLayerId)!
assert.ok(pastedHdr.hdrPixels)
assert.equal(pastedHdr.hdrPixels![0], 12, 'pasting preserves values above SDR white')
assert.equal(pastedHdr.hdrPixels![12], 6)
assert.notEqual(pastedHdr.hdrPixels, hdrSource.hdrPixels, 'clipboard and pasted HDR buffers are separate')
pastedHdr.hdrPixels![0] = 0
assert.equal(hdrSource.hdrPixels![0], 12, 'editing the paste does not modify its source')
console.log('HDR internal Copy/Paste preserves Float32 scene-linear pixels')



// Paste Into keeps the copied artwork editable, with a detached document-space
// layer mask. Changing the selection afterward cannot alter pasted artwork.
rawEngine.setActiveDocument(repeatDoc.id)
repeatDoc.selection = {
  mask: canvas(67), bounds: { x: 0, y: 0, w: 1, h: 1 }, _v: 4, _paths: null, _pathsV: -1,
}
assert.equal(rawEngine.canPasteIntoSelection(), true)
assert.equal(rawEngine.pasteIntoSelection(), true)
const intoLayer = repeatDoc.layers.find(l => l.id === repeatDoc.activeLayerId)!
assert.equal(intoLayer.maskEnabled, true)
assert.notEqual(intoLayer.mask, repeatDoc.selection.mask)
assert.equal(value(intoLayer.mask), 67)
assert.equal(intoLayer.hdrPixels?.[0], 12, 'HDR paste keeps original Float32 pixels')
assert.equal(repeatDoc.history.states[repeatDoc.history.index].label, 'Paste Into Selection')
draw(repeatDoc.selection.mask, 199)
assert.equal(value(intoLayer.mask), 67, 'layer mask is independent of editable selection')
rawEngine.undo()
assert.ok(!repeatDoc.layers.some(l => l.id === intoLayer.id))
rawEngine.redo()
assert.equal(value(repeatDoc.layers.find(l => l.id === intoLayer.id)?.mask), 67)
repeatDoc.selection = null
assert.equal(rawEngine.canPasteIntoSelection(), false)
assert.equal(rawEngine.pasteIntoSelection(), false)
console.log('Paste Into Selection creates independent, undoable HDR-safe layer masks')


// Deleting the active middle layer must select the adjacent surviving layer,
// not jump to the top of the stack. Deleted multi-selection IDs must disappear.
rawEngine.setActiveDocument(repeatDoc.id)
assert.ok(repeatDoc.layers.length >= 3)
const removeAt = 1
const doomedId = repeatDoc.layers[removeAt].id
const neighborId = repeatDoc.layers[removeAt + 1].id
const retainedId = repeatDoc.layers[0].id
repeatDoc.activeLayerId = doomedId
repeatDoc.selectedLayerIds = [doomedId, retainedId]
rawEngine.pushHistory('Before Deleting Middle Layer', repeatDoc)
rawEngine.deleteLayer(doomedId)
assert.equal(repeatDoc.activeLayerId, neighborId, 'deleting middle layer retains stack position')
assert.ok(!repeatDoc.selectedLayerIds?.includes(doomedId), 'deleted ID is purged from selection')
assert.ok(repeatDoc.selectedLayerIds?.includes(neighborId), 'replacement active layer is selected')
rawEngine.undo()
assert.equal(repeatDoc.activeLayerId, doomedId, 'Undo restores active layer identity')
assert.ok(repeatDoc.layers.some(l => l.id === doomedId))
rawEngine.redo()
assert.equal(repeatDoc.activeLayerId, neighborId, 'Redo selects the correct adjacent layer')
console.log('Delete Layer retains nearest stack position and cleans stale selected IDs')

// External application images can now be pasted INTO the active selection.
// Stubs keep this browser-only clipboard interaction headless in CI.
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const originalCreateImageBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')
const clipboardLayer = repeatDoc
rawEngine.setActiveDocument(clipboardLayer.id)
clipboardLayer.width = 2
clipboardLayer.height = 2
clipboardLayer.selection = {
  mask: canvas(73), bounds: { x: 0, y: 0, w: 2, h: 2 }, _v: 7, _paths: null, _pathsV: -1,
}
const raw = rawEngine as unknown as { _clip: unknown }
const originalInternalClip = raw._clip
raw._clip = null
let bitmapWasClosed = false
try {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    clipboard: { read: async () => [{
      types: ['image/png'],
      getType: async () => new Blob(['dummy-image'], { type: 'image/png' }),
    }] },
  } })
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => ({ width: 2, height: 2, close() { bitmapWasClosed = true } }),
  })
  assert.equal(rawEngine.canPasteIntoSelection(), true, 'external clipboard enables Paste Into')
  const pending = rawEngine.pasteIntoSelection()
  assert.ok(pending instanceof Promise, 'external clipboard paste is asynchronous')
  assert.equal(await pending, true)
  const externalLayer = clipboardLayer.layers.find(l => l.id === clipboardLayer.activeLayerId)!
  assert.equal(externalLayer.name, 'Pasted Image')
  assert.equal(externalLayer.maskEnabled, true)
  assert.equal(externalLayer.hdrPixels?.length, 16, 'external bitmap becomes HDR backing data in 32-bit documents')
  assert.equal(value(externalLayer.mask), 73)
  assert.notEqual(externalLayer.mask, clipboardLayer.selection!.mask)
  assert.equal(clipboardLayer.history.states[clipboardLayer.history.index].label, 'Paste Into Selection')
  assert.equal(bitmapWasClosed, true)
  draw(clipboardLayer.selection!.mask, 2)
  assert.equal(value(externalLayer.mask), 73, 'editing selection never modifies external paste mask')
  // Force an external read even when an older internal clipboard remains
  // populated; otherwise Paste might silently use stale internal artwork.
  raw._clip = originalInternalClip
  const beforeForcedExternal = clipboardLayer.layers.length
  assert.equal(await rawEngine.pasteFromSystemClipboard(true), true)
  assert.equal(clipboardLayer.layers.length, beforeForcedExternal + 1)
  const forcedExternal = clipboardLayer.layers.find(l => l.id === clipboardLayer.activeLayerId)!
  assert.equal(forcedExternal.name, 'Pasted Image')
  assert.equal(forcedExternal.maskEnabled, true)
  assert.equal(forcedExternal.hdrPixels?.[0], 0, 'forced system paste must not use stale internal HDR pixels')
  raw._clip = null
  rawEngine.undo()
  assert.ok(!clipboardLayer.layers.some(l => l.id === forcedExternal.id),
    'Undo removes the explicitly pasted system image')
  rawEngine.undo()
  assert.ok(!clipboardLayer.layers.some(l => l.id === externalLayer.id))
  rawEngine.redo()
  assert.ok(clipboardLayer.layers.some(l => l.id === externalLayer.id))
  rawEngine.redo()
  assert.ok(clipboardLayer.layers.some(l => l.id === forcedExternal.id))
  // The explicit external Paste Outside path must honor the alpha complement
  // and use a separate mask, even when the internal clipboard is empty.
  const beforeOutsideSystem = clipboardLayer.layers.length
  assert.equal(await rawEngine.pasteFromSystemClipboard(false, true), true)
  assert.equal(clipboardLayer.layers.length, beforeOutsideSystem + 1)
  const outsideSystem = clipboardLayer.layers.find(l => l.id === clipboardLayer.activeLayerId)!
  assert.equal(outsideSystem.maskEnabled, true)
  assert.notEqual(outsideSystem.mask, clipboardLayer.selection!.mask)
  assert.equal(clipboardLayer.history.states[clipboardLayer.history.index].label, 'Paste Outside Selection')
  assert.equal(outsideSystem.offsetX, 0, 'external Paste Outside centers on the document')
  rawEngine.undo()
  assert.ok(!clipboardLayer.layers.some(l => l.id === outsideSystem.id))
  rawEngine.redo()
  assert.ok(clipboardLayer.layers.some(l => l.id === outsideSystem.id))

  // External Paste as a normal layer must be directly above the selected
  // anchor layer (not unconditionally at the very top of the layer stack).
  const stackAnchor = clipboardLayer.layers[0].id
  clipboardLayer.activeLayerId = stackAnchor
  clipboardLayer.selectedLayerIds = [stackAnchor]
  const anchorIndex = clipboardLayer.layers.findIndex(l => l.id === stackAnchor)
  assert.equal(await rawEngine.pasteFromSystemClipboard(false), true)
  const pastedOnAnchor = clipboardLayer.layers.find(l => l.id === clipboardLayer.activeLayerId)!
  assert.equal(clipboardLayer.layers[anchorIndex + 1]?.id, pastedOnAnchor.id)
  assert.deepEqual(clipboardLayer.selectedLayerIds, [pastedOnAnchor.id])
  assert.equal(clipboardLayer.history.states[clipboardLayer.history.index].label, 'Place Layer')
  rawEngine.undo()
  assert.ok(!clipboardLayer.layers.some(l => l.id === pastedOnAnchor.id))
  rawEngine.redo()
  assert.equal(clipboardLayer.layers[anchorIndex + 1]?.id, pastedOnAnchor.id)
  // Simulate tab switch while the OS clipboard read is pending. The bitmap
  // may decode, but it must not land in the newly focused document.
  clipboardLayer.selection = {
    mask: canvas(74), bounds: { x: 0, y: 0, w: 2, h: 2 }, _v: 8, _paths: null, _pathsV: -1,
  }
  rawEngine.setActiveDocument(clipboardLayer.id)
  const originalCount = clipboardLayer.layers.length
  const deferred: { finishRead?: () => void } = {}
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    clipboard: { read: () => new Promise(resolve => {
      deferred.finishRead = () => resolve([{
        types: ['image/png'],
        getType: async () => new Blob(['dummy-image'], { type: 'image/png' }),
      }])
    }) },
  } })
  const delayed = rawEngine.pasteIntoSelection()
  rawEngine.setActiveDocument(originalDoc.id)
  deferred.finishRead?.()
  assert.equal(await delayed, false, 'switching tabs cancels the asynchronous paste')
  assert.equal(clipboardLayer.layers.length, originalCount)
  assert.equal(rawEngine.activeDoc?.id, originalDoc.id)
} finally {
  raw._clip = originalInternalClip
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else Reflect.deleteProperty(globalThis, 'navigator')
  if (originalCreateImageBitmap) Object.defineProperty(globalThis, 'createImageBitmap', originalCreateImageBitmap)
  else Reflect.deleteProperty(globalThis, 'createImageBitmap')
}
console.log('Paste Into supports external PNG clipboard with tab-switch and mask-snapshot safety')
// Paste Outside must complement alpha, including fractional feather edges.
// It cannot mutate the underlying selection; Undo restores only the new layer.
const initialAlpha = new Uint8ClampedArray([0, 32, 128, 255])
assert.deepEqual(Array.from(invertMaskAlpha(initialAlpha)), [255, 223, 127, 0])
assert.deepEqual(Array.from(initialAlpha), [0, 32, 128, 255])
rawEngine.setActiveDocument(repeatDoc.id)
repeatDoc.selection = {
  mask: canvas(29), bounds: { x: 0, y: 0, w: 2, h: 2 },
  _v: 9, _paths: null, _pathsV: -1,
}
assert.equal(rawEngine.canPasteOutsideSelection(), true)
const beforeOutside = repeatDoc.layers.length
assert.equal(rawEngine.pasteOutsideSelection(), true)
assert.equal(repeatDoc.layers.length, beforeOutside + 1)
const outsideLayer = repeatDoc.layers.find(l => l.id === repeatDoc.activeLayerId)!
assert.equal(outsideLayer.maskEnabled, true)
assert.notEqual(outsideLayer.mask, repeatDoc.selection.mask)
assert.equal(repeatDoc.history.states[repeatDoc.history.index].label, 'Paste Outside Selection')
rawEngine.undo()
assert.ok(!repeatDoc.layers.some(l => l.id === outsideLayer.id))
rawEngine.redo()
assert.ok(repeatDoc.layers.some(l => l.id === outsideLayer.id))
repeatDoc.selection = null
assert.equal(rawEngine.pasteOutsideSelection(), false)
console.log('Paste Outside Selection uses complement alpha, independent masks and Undo')

// Paste at Canvas Center is an explicit alternative to the editor's
// backwards-compatible place-at-original-offset Paste. Both remain HDR safe.
rawEngine.setActiveDocument(repeatDoc.id)
repeatDoc.width = 14
repeatDoc.height = 10
const previousCenterClip = raw._clip
raw._clip = {
  canvas: canvas(91),
  hdrPixels: new Float32Array([14, 1, 0, 1, 3, 0, 1, 1, 2, 0, 1, .5, 9, 0, 0, 1]),
  offsetX: -25, offsetY: 99, name: 'Clipboard Test',
}
try {
  assert.equal(rawEngine.pasteAtCanvasCenter(), true)
  const centered = repeatDoc.layers.find(l => l.id === repeatDoc.activeLayerId)!
  assert.equal(centered.offsetX, 6)
  assert.equal(centered.offsetY, 4)
  assert.equal(centered.hdrPixels?.[0], 14)
  assert.equal(repeatDoc.history.states[repeatDoc.history.index].label, 'Paste at Canvas Center')
  rawEngine.undo()
  assert.ok(!repeatDoc.layers.some(l => l.id === centered.id))
  rawEngine.redo()
  assert.equal(repeatDoc.layers.find(l => l.id === centered.id)?.offsetX, 6)
  assert.equal(rawEngine.pasteLayer(), true)
  const inPlace = repeatDoc.layers.find(l => l.id === repeatDoc.activeLayerId)!
  assert.equal(inPlace.offsetX, -25, 'ordinary Paste retains original clipboard position')
  assert.equal(inPlace.offsetY, 99)
  assert.equal(inPlace.hdrPixels?.[0], 14)
} finally {
  raw._clip = previousCenterClip
}
console.log('Paste at Canvas Center retains Float32 HDR and original Paste positioning')

if (imageDataDescriptor) Object.defineProperty(globalThis, 'ImageData', imageDataDescriptor)
else Reflect.deleteProperty(globalThis, 'ImageData')


// Photoshop mask operations must not silently erase an editable Smart Object
// or a locked layer. Disabled toggles must not create redundant History states.
rawEngine.setActiveDocument(repeatDoc.id)
const maskGuard = repeatDoc.layers.find(l => l.kind === 'smart')!
maskGuard.mask = canvas(33)
maskGuard.maskEnabled = true
maskGuard.locked = false
const smartMask = maskGuard.mask
rawEngine.deleteLayerMask(maskGuard.id, true)
assert.equal(maskGuard.mask, smartMask, 'Apply on Smart Object retains editable mask')
maskGuard.locked = true
rawEngine.deleteLayerMask(maskGuard.id, false)
assert.equal(maskGuard.mask, smartMask, 'locked layer keeps mask')
maskGuard.locked = false
const beforeMaskToggle = repeatDoc.history.index
rawEngine.setLayerMaskEnabled(maskGuard.id, true)
assert.equal(repeatDoc.history.index, beforeMaskToggle, 'unchanged mask toggle is a no-op')
rawEngine.setLayerMaskEnabled(maskGuard.id, false)
assert.equal(maskGuard.maskEnabled, false)
rawEngine.undo()
assert.equal(repeatDoc.layers.find(l => l.id === maskGuard.id)?.maskEnabled, true,
  'Undo restores the snapshotted mask state')
rawEngine.redo()
assert.equal(repeatDoc.layers.find(l => l.id === maskGuard.id)?.maskEnabled, false,
  'Redo reapplies mask disable')
console.log('Layer Mask apply guards and no-op toggle Undo/Redo pass')


// Mask-as-channel workflow preserves the source mask, even when its rendering
// is disabled; the new channel participates in History/Undo/Redo as normal.
rawEngine.setActiveDocument(repeatDoc.id)
const maskSource = repeatDoc.layers.find(l => l.id === maskGuard.id)!
assert.ok(maskSource.mask)
const beforeChannelSave = repeatDoc.savedChannels.length
const sourceMaskBeforeSave = maskSource.mask
const newChannelId = rawEngine.saveLayerMaskAsChannel(maskSource.id)
assert.ok(newChannelId)
assert.equal(repeatDoc.savedChannels.length, beforeChannelSave + 1)
assert.equal(repeatDoc.savedChannels.at(-1)?.name, maskSource.name + ' Mask')
assert.notEqual(repeatDoc.savedChannels.at(-1)?.mask, sourceMaskBeforeSave,
  'alpha channel gets independent raster storage')
assert.equal(maskSource.mask, sourceMaskBeforeSave)
assert.equal(repeatDoc.history.states[repeatDoc.history.index].label, 'Save Layer Mask as Channel')
rawEngine.undo()
assert.equal(repeatDoc.savedChannels.length, beforeChannelSave)
rawEngine.redo()
assert.equal(repeatDoc.savedChannels.at(-1)?.id, newChannelId)
console.log('Save Layer Mask as Channel preserves mask and supports Undo/Redo')
