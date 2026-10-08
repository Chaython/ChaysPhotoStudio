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
  static fail(message = 'intentional operation failure') {
    const job = this.jobs.shift()
    assert.ok(job, 'worker received the failing operation')
    job.owner.onmessage?.({ data: { kind: 'error', id: job.id, message } } as MessageEvent)
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

  // A pending Auto Tone worker must not commit into an edited or switched
  // document. Patch COW access so the test focuses on worker ownership rather
  // than a full browser's Canvas2D implementation.
  const layer = doc.layers[0]
  let liveMutations = 0
  ;(editor as unknown as { mutateLayerPixels: () => typeof layer }).mutateLayerPixels = () => {
    liveMutations++
    return layer
  }
  const beforePixels = layer._v
  const beforeHistory = doc.history.states[doc.history.index]
  const autoJob = editor.applyRegionOpAsync('layer', { kind: 'auto-tone' }, 'Auto Tone')
  assert.equal(DeferredWorker.jobs.length, 1)
  doc.history.states[0] = { label: 'Later edit' } as PsDocument['history']['states'][number]
  DeferredWorker.finish()
  assert.equal(await autoJob, false, 'Auto Tone aborts when source history changes')
  assert.equal(liveMutations, 0, 'stale worker must not clone/rasterize the live layer')
  assert.equal(layer._v, beforePixels)
  assert.equal(doc.history.states[doc.history.index].label, 'Later edit')

  const adjustJob = editor.applyAdjustmentToLayerAsync('layer', 'exposure', { exposure: 1 })
  assert.equal(DeferredWorker.jobs.length, 1)
  // Simulate document switch without undo. A late worker must not write back
  // to an inactive document or append its History/action transcript.
  ;(editor as unknown as { _activeId: string })._activeId = 'unrelated-tab'
  DeferredWorker.finish()
  await adjustJob
  assert.equal(layer._v, beforePixels)
  assert.equal(doc.history.states[doc.history.index].label, 'Later edit')
  ;(editor as unknown as { _activeId: string })._activeId = doc.id
  const failedAdjustment = editor.applyAdjustmentToLayerAsync('layer', 'exposure', { exposure: 1 })
  assert.equal(DeferredWorker.jobs.length, 1)
  DeferredWorker.fail()
  await failedAdjustment
  assert.equal(liveMutations, 0, 'a failed worker must not mutate or rasterize the live layer')

  const filterJob = editor.applyFilterToLayerAsync('layer', 'offset',
    { horizontal: 1, vertical: 0, edgeMode: 'wrap' })
  assert.equal(DeferredWorker.jobs.length, 1)
  const beforeFilterVersion = layer._v
  const beforeFilterHistory = doc.history.index
  // A different layer being edited does not change our target's _v.
  // The filter still must not commit after the document History moves.
  doc.history.states[0] = { label: 'Other layer edited' } as PsDocument['history']['states'][number]
  DeferredWorker.finish()
  await filterJob
  assert.equal(layer._v, beforeFilterVersion, 'stale filter does not mutate target pixels')
  assert.equal(doc.history.index, beforeFilterHistory, 'stale filter does not create History')
  assert.equal(liveMutations, 0, 'stale filter worker must not clone/rasterize the live layer')

  layer.locked = true
  const oldVersion = layer._v
  const oldIndex = doc.history.index
  editor.fillSelection('#ff0000')
  assert.equal(layer._v, oldVersion, 'locked Fill must not mutate pixels')
  assert.equal(doc.history.index, oldIndex, 'locked Fill must not create History')
  // Even the legacy synchronous Auto Tone command must not claim success
  // or mutate a locked layer while its caller records an action.
  const actionCount = editor.actions.length
  editor.autoCorrect('tone')
  assert.equal(editor.actions.length, actionCount)
  assert.equal(layer._v, oldVersion)
  layer.locked = false
  doc.workingBitDepth = 32
  const beforeAutoCount = DeferredWorker.jobs.length
  const beforeAutoHistory = doc.history.index
  editor.autoCorrect('tone')
  await editor.autoCorrectAsync('contrast')
  assert.equal(await editor.applyRegionOpAsync('layer', { kind: 'auto-color' }, 'Auto Color'), false)
  assert.equal(DeferredWorker.jobs.length, beforeAutoCount,
    'HDR Auto Color/Tone/Contrast are rejected before dispatching workers')
  assert.equal(doc.history.index, beforeAutoHistory,
    'unsupported HDR automatic corrections must not create History')
  const beforeInpaintHistory = doc.history.index
  const beforeInpaintVersion = layer._v
  await editor.contentAwareFillMask(new Uint8ClampedArray(W * H).fill(255))
  assert.equal(layer._v, beforeInpaintVersion, 'HDR inpaint rejects before raster mutation')
  assert.equal(doc.history.index, beforeInpaintHistory, 'unsupported HDR inpaint does not change History')
  doc.workingBitDepth = 16
  await editor.contentAwareFillMask(new Uint8ClampedArray(W * H).fill(255))
  assert.equal(layer._v, beforeInpaintVersion, '16-bit float inpaint also rejects before 8-bit quantization')
  assert.equal(doc.history.index, beforeInpaintHistory)
  doc.workingBitDepth = 32
  const versionBeforeHdrRejection = layer._v
  editor.applyAdjustmentToLayer('layer', 'hue-saturation', {})
  editor.applyFilterToLayer('layer', 'smart-sharpen', {})
  await editor.applyAdjustmentToLayerAsync('layer', 'hue-saturation', {})
  await editor.applyFilterToLayerAsync('layer', 'smart-sharpen', {})
  assert.equal(layer._v, versionBeforeHdrRejection,
    'unsupported HDR operations must reject before raster mutation')
  console.log('Selection race, async pixel commits, locked layers and unsupported HDR guards passed')
} finally {
  if (descriptorWorker) Object.defineProperty(globalThis, 'Worker', descriptorWorker)
  else Reflect.deleteProperty(globalThis, 'Worker')
  if (descriptorWindow) Object.defineProperty(globalThis, 'window', descriptorWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (descriptorImageData) Object.defineProperty(globalThis, 'ImageData', descriptorImageData)
  else Reflect.deleteProperty(globalThis, 'ImageData')
}
