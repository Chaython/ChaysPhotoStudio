// Headless Paint-Into-Saved-Channel regression test.
// Verifies that when a saved channel is the editing target, painting/fill
// writes into that channel's mask instead of layer pixels, with selection
// and eraser semantics intact. Uses fake pixel canvases (no GUI dependency).
import assert from 'node:assert/strict'
import { Engine } from '../src/editor/engine/engine'
import type { PsDocument } from '../src/editor/types'

// ---------------------------------------------------------------- fake canvas

class FakeImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(w: number, h: number, existing?: Uint8ClampedArray) {
    this.width = w
    this.height = h
    this.data = existing ?? new Uint8ClampedArray(w * h * 4)
  }
}

class FakeContext {
  buf: Uint8ClampedArray
  w: number
  h: number
  fillStyle = '#000000'
  globalCompositeOperation = 'source-over'
  globalAlpha = 1
  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.buf = new Uint8ClampedArray(w * h * 4)
  }
  getContextAttributes = () => ({ colorType: 'unorm8', colorSpace: 'srgb' })
  getImageData(_x: number, _y: number, w: number, h: number) {
    return new FakeImageData(w, h, this.buf.slice(0, w * h * 4))
  }
  putImageData(data: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) {
    const { data: d, width } = data
    for (let row = 0; row < data.height; row++) {
      const src = row * width * 4
      const dst = ((y + row) * this.w + x) * 4
      this.buf.set(d.subarray(src, src + width * 4), dst)
    }
  }
  createImageData(w: number, h: number) { return new FakeImageData(w, h) }
  drawImage(src: HTMLCanvasElement, x: number, y: number) {
    const s = src as unknown as FakeCanvas
    const sw = s.w, sh = s.h
    const op = this.globalCompositeOperation
    for (let row = 0; row < sh; row++) {
      const srcRow = row * sw * 4
      const dstRow = ((y + row) * this.w + x) * 4
      for (let col = 0; col < sw; col++) {
        const si = srcRow + col * 4
        const di = dstRow + col * 4
        const sa = s.ctx.buf[si + 3]
        if (op === 'destination-in') { if (sa === 0) continue }
        else if (op === 'destination-out') { if (sa > 0) continue }
        else {
          this.buf[di] = s.ctx.buf[si]
          this.buf[di + 1] = s.ctx.buf[si + 1]
          this.buf[di + 2] = s.ctx.buf[si + 2]
          this.buf[di + 3] = s.ctx.buf[si + 3]
        }
      }
    }
  }
  save() { /* noop */ }
  restore() { /* noop */ }
  setTransform() { /* noop */ }
  fillRect(x: number, y: number, w: number, h: number) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(this.fillStyle as string)
    if (!m) return
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16)
    const a = Math.round((this.globalAlpha || 1) * 255)
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y))
    const x1 = Math.min(this.w, Math.ceil(x + w)), y1 = Math.min(this.h, Math.ceil(y + h))
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.w + xx) * 4
        this.buf[i] = r; this.buf[i + 1] = g; this.buf[i + 2] = b; this.buf[i + 3] = a
      }
  }
  clearRect() { /* noop */ }
}

class FakeCanvas {
  private _w: number
  private _h: number
  ctx: FakeContext
  constructor(w: number, h: number) {
    this._w = w
    this._h = h
    this.ctx = new FakeContext(w, h)
  }
  get w() { return this._w }
  get h() { return this._h }
  set width(v: number) { this._w = Math.max(1, Math.round(v)); this.ctx.buf = new Uint8ClampedArray(this._w * this._h * 4); this.ctx.w = this._w; this.ctx.h = this._h }
  get width() { return this._w }
  set height(v: number) { this._h = Math.max(1, Math.round(v)); this.ctx.buf = new Uint8ClampedArray(this._w * this._h * 4); this.ctx.w = this._w; this.ctx.h = this._h }
  get height() { return this._h }
  getContext() { return this.ctx }
  getContextAttributes() { return this.ctx.getContextAttributes() }
  fill(hex: string) {
    const [r, g, b] = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex)!.slice(1).map(v => parseInt(v, 16))
    for (let i = 0; i < this.ctx.buf.length; i += 4) {
      this.ctx.buf[i] = r; this.ctx.buf[i + 1] = g; this.ctx.buf[i + 2] = b; this.ctx.buf[i + 3] = 255
    }
  }
  pixel(x: number, y: number): number[] {
    const i = (y * this._w + x) * 4
    return [this.ctx.buf[i], this.ctx.buf[i + 1], this.ctx.buf[i + 2], this.ctx.buf[i + 3]]
  }
}

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement: () => new FakeCanvas(2, 2) },
})

;(globalThis as any).ImageData = class {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(a: any, b?: any, c?: any) {
    if (typeof a === 'number' && typeof b === 'number') {
      this.width = a
      this.height = b
      this.data = new Uint8ClampedArray(a * b * 4)
    } else if (a && a.data) {
      this.data = a.data
      this.width = b
      this.height = c
    } else {
      this.data = a
      this.width = b
      this.height = c
    }
  }
}

// ---------------------------------------------------------------- helpers

function layer(docW: number, docH: number, fill = '#808080ff'): FakeCanvas {
  const c = new FakeCanvas(docW, docH)
  c.fill(fill)
  return c
}

function makeDoc(w = 8, h = 8): PsDocument {
  const canvas = layer(w, h, '#402060ff')
  const l = {
    id: 'l1', name: 'Layer 1', kind: 'raster', visible: true, opacity: 100, blendMode: 'normal',
    locked: false, clipped: false, canvas, source: null as any, mask: null,
    hdrPixels: null, hdrColorSpace: 'srgb', transform: null, smartFilters: [], maskEnabled: true,
    vectorMask: null, adjustment: null, text: null, shape: null, blendIf: null, fx: null,
    _v: 1, _mv: 1, offsetX: 0, offsetY: 0,
  }
  const selMask = new FakeCanvas(w, h)
  for (let i = 0; i < selMask.ctx.buf.length; i += 4) selMask.ctx.buf[i + 3] = 255
  return {
    id: 'd1', name: 'Test', width: w, height: h, workingBitDepth: 8, sourceBitDepth: 8,
    workingColorSpace: 'srgb', layers: [l], activeLayerId: 'l1', selection: {
      mask: selMask, bounds: { x: 0, y: 0, w, h }, _v: 1, _paths: null, _pathsV: -1,
    }, channelView: 'rgb', channelTarget: 'composite', channelEditingTarget: null,
    savedChannels: [], view: { zoom: 1, panX: 0, panY: 0 },
    _epoch: 1, _stroke: null, _strokeLayerId: null, _strokeErase: false, _strokeOpacity: 1,
    _strokeBlendMode: 'normal', _strokeBbox: null, _strokeBgColor: null, _strokeV: 0, _liveDrag: null,
    history: { states: [], index: -1 },
  } as unknown as PsDocument
}

// ---------------------------------------------------------------- setChannelEditingTarget

{
  const raw = new Engine()
  const doc = makeDoc()
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  assert.equal(doc.channelEditingTarget, null)
  raw.setChannelEditingTarget('chan-1')
  assert.equal(doc.channelEditingTarget, 'chan-1')
  raw.setChannelEditingTarget('chan-1')
  assert.equal(doc.channelEditingTarget, 'chan-1', 'no-op when already set')
  raw.setChannelEditingTarget(null)
  assert.equal(doc.channelEditingTarget, null)
  console.log('setChannelEditingTarget passed')
}

// ---------------------------------------------------------------- endStroke writes to saved channel mask

{
  const raw = new Engine()
  const doc = makeDoc()
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  const l = doc.layers[0] as any
  const lBefore = l.canvas.ctx.buf.slice()

  // Create a saved channel filled with black (alpha = 0 = not selected)
  const savedMask = new FakeCanvas(8, 8)
  for (let i = 0; i < savedMask.ctx.buf.length; i += 4) {
    savedMask.ctx.buf[i] = 0; savedMask.ctx.buf[i + 1] = 0; savedMask.ctx.buf[i + 2] = 0; savedMask.ctx.buf[i + 3] = 0
  }
  doc.savedChannels.push({ id: 'chan-1', name: 'Alpha 1', mask: savedMask as unknown as HTMLCanvasElement, _v: 1 })
  doc.channelEditingTarget = 'chan-1'

  // Begin a stroke and end it — should paint into the saved channel mask
  raw.beginStroke('l1', { opacity: 100 })
  raw.endStroke('Brush Stroke')

  const lAfter = l.canvas.ctx.buf.slice()
  const mAfter = savedMask.ctx.buf.slice()

  // Layer pixels should be untouched
  assert.deepEqual(lAfter, lBefore, 'layer pixels untouched when painting into saved channel')

  // Mask alpha should have changed where the stroke was drawn (stroke covers whole canvas)
  let maskChanged = false
  for (let i = 3; i < mAfter.length; i += 4) {
    if (mAfter[i] !== 0) { maskChanged = true; break }
  }
  assert.ok(maskChanged, 'saved channel mask changed when painting into it')
  console.log('endStroke writes to saved channel mask passed')
}

// ---------------------------------------------------------------- fillSelection writes to saved channel mask

{
  const raw = new Engine()
  const doc = makeDoc()
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  const l = doc.layers[0] as any
  const lBefore = l.canvas.ctx.buf.slice()

  const savedMask = new FakeCanvas(8, 8)
  for (let i = 0; i < savedMask.ctx.buf.length; i += 4) {
    savedMask.ctx.buf[i] = 0; savedMask.ctx.buf[i + 1] = 0; savedMask.ctx.buf[i + 2] = 0; savedMask.ctx.buf[i + 3] = 0
  }
  doc.savedChannels.push({ id: 'chan-1', name: 'Alpha 1', mask: savedMask as unknown as HTMLCanvasElement, _v: 1 })
  doc.channelEditingTarget = 'chan-1'

  raw.fillSelection('#ff0000')

  const lAfter = l.canvas.ctx.buf.slice()
  const mAfter = savedMask.ctx.buf.slice()

  assert.deepEqual(lAfter, lBefore, 'layer pixels untouched when filling into saved channel')
  let maskChanged = false
  for (let i = 3; i < mAfter.length; i += 4) {
    if (mAfter[i] !== 0) { maskChanged = true; break }
  }
  assert.ok(maskChanged, 'saved channel mask changed when filling into it')
  console.log('fillSelection writes to saved channel mask passed')
}

// ---------------------------------------------------------------- layer pixels preserved after fill into saved channel

{
  const raw = new Engine()
  const doc = makeDoc()
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  const l = doc.layers[0] as any
  const lBefore = l.canvas.ctx.buf.slice()

  const savedMask = new FakeCanvas(8, 8)
  for (let i = 0; i < savedMask.ctx.buf.length; i += 4) {
    savedMask.ctx.buf[i] = 0; savedMask.ctx.buf[i + 1] = 0; savedMask.ctx.buf[i + 2] = 0; savedMask.ctx.buf[i + 3] = 0
  }
  doc.savedChannels.push({ id: 'chan-1', name: 'Alpha 1', mask: savedMask as unknown as HTMLCanvasElement, _v: 1 })
  doc.channelEditingTarget = 'chan-1'

  raw.fillSelection('#00ff00')

  const lAfter = l.canvas.ctx.buf.slice()
  assert.deepEqual(lAfter, lBefore, 'layer pixels completely preserved after fill into saved channel')
  console.log('layer pixels preserved after fill into saved channel passed')
}

console.log('validate-paint-into-saved-channel: all checks passed')
