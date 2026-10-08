// Real asynchronous worker regression: late Magic Wand results must never
// replace a newer selection or edits made after the worker was dispatched.
import assert from 'node:assert/strict'
import { Engine } from '../src/editor/engine/engine'
import type { PsDocument } from '../src/editor/types'

const W = 600, H = 600
const descriptorWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
const descriptorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const descriptorImageData = Object.getOwnPropertyDescriptor(globalThis, 'ImageData')
class FakeImageData {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data; this.width = width; this.height = height
  }
}
class DeferredWorker {
  static jobs: { owner: DeferredWorker; id: number; buffer: ArrayBuffer }[] = []
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: ErrorEvent) => void) | null = null
  postMessage(msg: { id: number; buffer: ArrayBuffer }) {
    DeferredWorker.jobs.push({ owner: this, id: msg.id, buffer: msg.buffer })
  }
  terminate() {}
  static finish() {
    const job = this.jobs.shift()
    assert.ok(job, 'worker received the operation')
    // Returning the original pixels suffices: only the async ownership is
    // under test. The real worker supplies the computed selection mask.
    job.owner.onmessage?.({ data: { kind: 'done', id: job.id, buffer: job.buffer } } as MessageEvent)
  }
}
const pixelCanvas = {
  width: W, height: H,
  getContext: () => ({ getImageData: () => new FakeImageData(new Uint8ClampedArray(W * H * 4), W, H) }),
} as unknown as HTMLCanvasElement
const selection = (version: number) => ({
  mask: pixelCanvas, bounds: { x: 0, y: 0, w: 1, h: 1 },
  _v: version, _paths: null, _pathsV: -1,
})
try {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: FakeImageData })
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: DeferredWorker })
  const editor = new Engine()
  const initialSelection = selection(1)
  const doc = {
    id: 'selection-race', name: 'Selection Race', width: W, height: H,
    workingBitDepth: 8, workingColorSpace: 'srgb',
    layers: [{ id: 'layer', name: 'Layer', kind: 'raster', locked: false,
      canvas: pixelCanvas, _v: 1, _mv: 1, visible: true, opacity: 100 }],
    activeLayerId: 'layer', selectedLayerIds: ['layer'],
    selection: initialSelection,
    history: { states: [{ label: 'Initial' }], index: 0 },
    _epoch: 1, _strokeV: 0,
  } as unknown as PsDocument
  editor.docs.push(doc)
  // Don't instantiate the GUI; test the same document and layer-access paths.
  ;(editor as unknown as { _activeId: string })._activeId = doc.id
  ;(editor as unknown as { layerCanvasDocSpace: () => HTMLCanvasElement }).layerCanvasDocSpace = () => pixelCanvas
  const opts = { tolerance: 24, contiguous: true, sample: 'layer' as const, mode: 'new' as const }
  const older = editor.magicWand(1, 1, opts)
  assert.equal(DeferredWorker.jobs.length, 1, 'Magic Wand was dispatched to a worker')
  const newer = selection(2)
  doc.selection = newer
  DeferredWorker.finish()
  await older
  assert.equal(doc.selection, newer, 'late Magic Wand must not overwrite the newer selection')

  const historyJob = editor.magicWand(1, 1, opts)
  assert.equal(DeferredWorker.jobs.length, 1)
  doc.history.states[0] = { label: 'Newer edit' } as PsDocument['history']['states'][number]
  DeferredWorker.finish()
  await historyJob
  assert.equal(doc.selection, newer, 'worker must discard results after a document edit')

  const layer = doc.layers[0]
  layer.locked = true
  const oldVersion = layer._v
  const oldIndex = doc.history.index
  editor.fillSelection('#ff0000')
  assert.equal(layer._v, oldVersion, 'locked Fill must not mutate pixels')
  assert.equal(doc.history.index, oldIndex, 'locked Fill must not create History')
  console.log('Selection race: late Magic Wand results discarded; locked Fill guarded')
} finally {
  if (descriptorWorker) Object.defineProperty(globalThis, 'Worker', descriptorWorker)
  else Reflect.deleteProperty(globalThis, 'Worker')
  if (descriptorWindow) Object.defineProperty(globalThis, 'window', descriptorWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (descriptorImageData) Object.defineProperty(globalThis, 'ImageData', descriptorImageData)
  else Reflect.deleteProperty(globalThis, 'ImageData')
}
