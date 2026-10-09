import assert from 'node:assert/strict'
import { Engine } from '../src/editor/engine/engine'
import type { PsDocument } from '../src/editor/types'
const created: Canvas[] = []
class Canvas {
  width: number; height: number; selectionAlpha: number
  constructor(w = 3, h = 3, selectionAlpha = 0) {
    this.width = w; this.height = h; this.selectionAlpha = selectionAlpha
  }
  getContext() {
    const self = this
    return {
      getContextAttributes: () => ({ colorType: 'unorm8', colorSpace: 'srgb' }),
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4)
        for (let i = 3; i < data.length; i += 4) data[i] = self.selectionAlpha
        return { data, width: w, height: h }
      },
      save() {}, restore() {}, fillRect() {}, drawImage() {},
      set fillStyle(_v: string) {},
      set globalCompositeOperation(_v: string) {},
    }
  }
}
const before = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'document', { configurable: true, value: {
  createElement: () => { const c = new Canvas(); created.push(c); return c },
}})
try {
  const editor = new Engine()
  const layer = { id: 'raster', kind: 'raster', locked: false,
    canvas: new Canvas(1000, 800), offsetX: 0, offsetY: 0, _v: 1,
    visible: true, opacity: 100 }
  const mask = new Canvas(1000, 800, 0)
  const doc = { id: 'fill-test', width: 1000, height: 800, workingBitDepth: 8,
    activeLayerId: layer.id, layers: [layer],
    selection: { mask, bounds: { x: 20, y: 30, w: 10, h: 15 }, _v: 1 },
    history: { states: [], index: -1 }, _epoch: 1 } as unknown as PsDocument
  editor.docs.push(doc)
  ;(editor as unknown as { _activeId: string })._activeId = doc.id
  let mutations = 0, history = 0
  ;(editor as unknown as { mutateLayerPixels: () => typeof layer }).mutateLayerPixels = () => {
    mutations++; return layer
  }
  ;(editor as unknown as { pushHistory: () => void }).pushHistory = () => { history++ }
  ;(editor as unknown as { recordStep: () => void }).recordStep = () => {}
  ;(editor as unknown as { emit: () => void }).emit = () => {}
  editor.fillSelection('#f00')
  assert.equal(mutations, 0, 'zero-alpha selection is not modified')
  assert.equal(history, 0)
  mask.selectionAlpha = 128
  editor.fillSelection('#f00')
  assert.equal(mutations, 1)
  assert.equal(history, 1)
  assert.ok(created.some(c => c.width === 10 && c.height === 15), 'scratch canvas is selection-sized')
  assert.ok(!created.some(c => c.width === 1000 && c.height === 800), 'no full-document scratch canvas')
  doc.selection = null
  layer.offsetX = 2000
  editor.fillSelection('#f00')
  assert.equal(mutations, 1, 'off-canvas Fill cannot mutate raster')
  assert.equal(history, 1, 'off-canvas Fill cannot create History')
  console.log('Fill: empty selection, bounded scratch canvas, and off-canvas no-op passed')
} finally {
  if (before) Object.defineProperty(globalThis, 'document', before)
  else Reflect.deleteProperty(globalThis, 'document')
}
