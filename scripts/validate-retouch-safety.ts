import assert from 'node:assert/strict'
import { engine } from '../src/editor/engine/engine'
import {
  beginDeferredRegionStroke, canUseByteRetouch, deferredRegionProcess,
} from '../src/editor/tools/shared'
import type { PsDocument } from '../src/editor/types'

// Small Canvas2D double: enough to validate a real deferred 8-bit stroke,
// the no-op path, out-of-bounds rejection, and high-depth guards.
class FakeCanvas {
  width = 4
  height = 4
  private pixels = new Uint8ClampedArray(4 * 4 * 4)
  constructor() {
    for (let i = 0; i < this.pixels.length; i += 4) {
      this.pixels[i] = 220; this.pixels[i + 1] = 30; this.pixels[i + 2] = 20; this.pixels[i + 3] = 255
    }
  }
  private resize() {
    if (this.pixels.length !== this.width * this.height * 4) this.pixels = new Uint8ClampedArray(this.width * this.height * 4)
  }
  getContext() {
    const owner = this
    return {
      getContextAttributes: () => ({ colorType: 'unorm8', colorSpace: 'srgb' }),
      getImageData(x: number, y: number, w: number, h: number) {
        owner.resize()
        const data = new Uint8ClampedArray(w * h * 4)
        for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
          const sx = x + px, sy = y + py
          if (sx < 0 || sy < 0 || sx >= owner.width || sy >= owner.height) continue
          data.set(owner.pixels.slice((sy * owner.width + sx) * 4, (sy * owner.width + sx) * 4 + 4), (py * w + px) * 4)
        }
        return { data, width: w, height: h }
      },
      putImageData(img: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) {
        owner.resize()
        for (let py = 0; py < img.height; py++) for (let px = 0; px < img.width; px++) {
          const dx = x + px, dy = y + py
          if (dx < 0 || dy < 0 || dx >= owner.width || dy >= owner.height) continue
          owner.pixels.set(img.data.slice((py * img.width + px) * 4, (py * img.width + px) * 4 + 4), (dy * owner.width + dx) * 4)
        }
      },
      drawImage(src: FakeCanvas) {
        owner.resize(); src.resize()
        owner.pixels.set(src.pixels.slice(0, owner.pixels.length))
      },
    }
  }
  red(x: number, y: number) { this.resize(); return this.pixels[(y * this.width + x) * 4] }
}
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new FakeCanvas() } })

try {
  const canvas = new FakeCanvas()
  const layer = {
    id: 'stroke-layer', kind: 'raster', name: 'Test raster', locked: false,
    visible: true, canvas, opacity: 100, blendMode: 'normal',
    _v: 1, _mv: 1, mask: null, smartFilters: [],
  }
  const doc = {
    id: 'stroke-test', width: 4, height: 4, workingBitDepth: 8,
    workingColorSpace: 'srgb', layers: [layer], activeLayerId: layer.id,
    history: { states: [], index: -1 }, _epoch: 1, selection: null,
  } as unknown as PsDocument
  engine.docs.push(doc)
  ;(engine as unknown as { _activeId: string })._activeId = doc.id

  const stroke = beginDeferredRegionStroke(layer.id)
  assert.ok(stroke)
  const noOp = deferredRegionProcess(stroke!, 1.5, 1.5, 1, () => {})
  assert.equal(noOp, false)
  assert.equal(stroke!.committed, false)
  assert.equal(layer.canvas, canvas, 'no-op must not clone or rasterize')
  assert.equal(layer._v, 1)
  assert.equal(doc.history.index, -1)

  const offCanvas = deferredRegionProcess(stroke!, 500, 500, 1, r => { r.data[0] = 0 })
  assert.equal(offCanvas, false, 'fully off-canvas dab must be ignored')

  const changed = deferredRegionProcess(stroke!, 1.5, 1.5, 1, (r, falloff) => {
    for (let i = 0; i < falloff.length; i++) if (falloff[i] > 0.5) r.data[i * 4] = 80
  })
  assert.equal(changed, true)
  assert.equal(stroke!.committed, true)
  assert.notEqual(layer.canvas, canvas, 'real stroke should copy on write')
  assert.equal(layer._v, 2)
  assert.equal(canvas.red(1, 1), 220, 'source canvas remains unchanged')
  assert.equal((layer.canvas as FakeCanvas).red(1, 1), 80)
  assert.equal(doc.history.index, -1, 'the tool commits one history entry on pointer-up, not per dab')

  doc.workingBitDepth = 16
  assert.equal(beginDeferredRegionStroke(layer.id), null)
  assert.equal(canUseByteRetouch('Test retouch'), false)
  assert.equal(layer._v, 2, 'high-bit rejection must not modify source')
  doc.workingBitDepth = 32
  assert.equal(beginDeferredRegionStroke(layer.id), null)
  assert.equal(canUseByteRetouch('Test retouch'), false)
  assert.equal(layer._v, 2)
  console.log('Deferred retouch: no-op, actual COW, off-canvas and 16/32-bit guards passed')
} finally {
  engine.docs.splice(engine.docs.findIndex(d => d.id === 'stroke-test'), 1)
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
  else Reflect.deleteProperty(globalThis, 'document')
}
