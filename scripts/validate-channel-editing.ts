// Headless Channel Editing Target regression test.
// Exercises the pure plane math, the engine adapter, and the painting/fill
// commit paths with fake pixel canvases (no GUI, no native canvas dependency).
import assert from 'node:assert/strict'
import {
  channelTargetComponents, protectedPlanes, parseChannelTarget,
  capturePlanes, restorePlanes, capturePlanesF32, restorePlanesF32,
  erasePaintData, docRectToLayerRect, type PlaneSnapshot,
} from '../src/editor/image-ops/channel-restrict'
import {
  resolveChannelTarget, captureCanvasPlanes, restoreCanvasPlanes,
  translateEraseStrokeToColor,
} from '../src/editor/engine/channel-target'
import type { ChannelTarget, PsDocument, Rect } from '../src/editor/types'
import { Engine } from '../src/editor/engine/engine'

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
  getContextAttributes = () => ({ colorType: this.bitDepth === 16 ? 'float16' : 'unorm8', colorSpace: 'srgb' })
  buf: Uint8ClampedArray
  w: number
  h: number
  bitDepth: number
  constructor(w: number, h: number, bitDepth: number) {
    this.w = w
    this.h = h
    this.bitDepth = bitDepth
    this.buf = new Uint8ClampedArray(w * h * 4)
  }
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
    const sctx = s.ctx
    const sw = s.w, sh = s.h
    const op = this.globalCompositeOperation
    for (let row = 0; row < sh; row++) {
      const srcRow = row * sw * 4
      const dstRow = ((y + row) * this.w + x) * 4
      for (let col = 0; col < sw; col++) {
        const si = srcRow + col * 4
        const di = dstRow + col * 4
        const sa = sctx.buf[si + 3]
        if (op === 'destination-in') {
          if (sa === 0) continue // outside mask: drop destination
        } else if (op === 'destination-out') {
          if (sa > 0) continue // inside mask: drop destination
        } else {
          // source-over: copy source
          this.buf[di] = sctx.buf[si]
          this.buf[di + 1] = sctx.buf[si + 1]
          this.buf[di + 2] = sctx.buf[si + 2]
          this.buf[di + 3] = sctx.buf[si + 3]
        }
      }
    }
  }
  fillStyle = '#000000'
  globalCompositeOperation = 'source-over'
  globalAlpha = 1
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
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.w + xx) * 4
        this.buf[i] = r; this.buf[i + 1] = g; this.buf[i + 2] = b; this.buf[i + 3] = a
      }
    }
  }
  clearRect() { /* noop */ }
}

class FakeCanvas {
  private _w: number
  private _h: number
  ctx: FakeContext
  constructor(w: number, h: number, bitDepth: number = 8) {
    this._w = w
    this._h = h
    this.ctx = new FakeContext(w, h, bitDepth)
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
    const [r, g, b] = hexToRgb(hex)
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

// ImageData is a browser global; shim a minimal version for headless restore paths.
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

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})[0-9a-f]{2}?$/i.exec(hex)
  if (!m) throw new Error('bad hex ' + hex)
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

function layer(docW: number, docH: number, fill = '#80808080', bitDepth: number = 8): FakeCanvas {
  const c = new FakeCanvas(docW, docH, bitDepth)
  c.fill(fill)
  return c
}

function makeDoc(w = 8, h = 8, bitDepth: number = 8, channelTarget: ChannelTarget = 'composite'): PsDocument {
  const canvas = layer(w, h, '#402060ff', bitDepth)
  const l = {
    id: 'l1', name: 'Layer 1', kind: 'raster', visible: true, opacity: 100, blendMode: 'normal',
    locked: false, clipped: false, canvas, source: null as any, mask: null,
    hdrPixels: bitDepth === 32 ? new Float32Array(w * h * 4).fill(0).map((_, i) => (i % 4 === 3) ? 1 : 0.5) : null,
    hdrColorSpace: 'linear-srgb', transform: null, smartFilters: [], maskEnabled: true,
    vectorMask: null, adjustment: null, text: null, shape: null, blendIf: null, fx: null,
    _v: 1, _mv: 1, offsetX: 0, offsetY: 0,
  }
  const selMask = new FakeCanvas(w, h)
  for (let i = 0; i < selMask.ctx.buf.length; i += 4) selMask.ctx.buf[i + 3] = 255
  return {
    id: 'd1', name: 'Test', width: w, height: h, workingBitDepth: bitDepth, sourceBitDepth: bitDepth,
    workingColorSpace: 'srgb', layers: [l], activeLayerId: 'l1', selection: {
      mask: selMask, bounds: { x: 0, y: 0, w, h }, _v: 1, _paths: null, _pathsV: -1,
    }, channelView: 'rgb', channelTarget, savedChannels: [], view: { zoom: 1, panX: 0, panY: 0 },
    _epoch: 1, _stroke: null, _strokeLayerId: null, _strokeErase: false, _strokeOpacity: 1,
    _strokeBlendMode: 'normal', _strokeBbox: null, _strokeBgColor: null, _strokeV: 0, _liveDrag: null,
    history: { states: [], index: -1 },
  } as unknown as PsDocument
}

// ---------------------------------------------------------------- pure math

{
  assert.deepEqual(channelTargetComponents('composite'), [0, 1, 2])
  assert.deepEqual(channelTargetComponents('r'), [0])
  assert.deepEqual(channelTargetComponents('g'), [1])
  assert.deepEqual(channelTargetComponents('b'), [2])
  assert.deepEqual(channelTargetComponents('rg'), [0, 1])
  assert.deepEqual(channelTargetComponents('rb'), [0, 2])
  assert.deepEqual(channelTargetComponents('gb'), [1, 2])
  assert.deepEqual(protectedPlanes('composite'), [])
  assert.deepEqual(protectedPlanes('r'), [1, 2, 3])
  assert.deepEqual(protectedPlanes('rb'), [1, 3])
  assert.deepEqual(protectedPlanes('gb'), [0, 3])
  assert.equal(parseChannelTarget('rg'), 'rg')
  assert.equal(parseChannelTarget('composite'), 'composite')
  assert.equal(parseChannelTarget('bogus'), null)
  assert.equal(parseChannelTarget(undefined), null)
  console.log('plane math passed')
}

// ---------------------------------------------------------------- capture/restore (8-bit)

{
  const w = 6, h = 5
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 10; data[i + 1] = 20; data[i + 2] = 30; data[i + 3] = 40
  }
  const rect: Rect = { x: 1, y: 1, w: 3, h: 2 }
  const snap = capturePlanes(data, w, rect, [0, 3]) // protect R and A
  // Mutate everything
  for (let i = 0; i < data.length; i += 4) { data[i] = 90; data[i + 1] = 91; data[i + 2] = 92; data[i + 3] = 99 }
  restorePlanes(data, snap)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const inRect = x >= 1 && x < 4 && y >= 1 && y < 3
      if (inRect) {
        assert.equal(data[i], 10, `R restored at ${x},${y}`)
        assert.equal(data[i + 1], 91, `G changed at ${x},${y}`)
        assert.equal(data[i + 2], 92, `B changed at ${x},${y}`)
        assert.equal(data[i + 3], 40, `A restored at ${x},${y}`)
      } else {
        assert.equal(data[i], 90, `R untouched outside rect at ${x},${y}`)
      }
    }
  }
  console.log('8-bit capture/restore passed')
}

// ---------------------------------------------------------------- capture/restore (Float32, NaN/signed zero)

{
  const w = 2, h = 2
  const data = new Float32Array(w * h * 4)
  // pixel 0: R=-0.0 (protected), G=1 (not), B=NaN (protected), A=0.75 (not)
  // pixel 1: R=0.1 (protected), G=2 (not), B=0.3 (protected), A=1 (not)
  data[0] = -0.0; data[1] = 1; data[2] = NaN; data[3] = 0.75
  data[4] = 0.1; data[5] = 2; data[6] = 0.3; data[7] = 1
  const rect: Rect = { x: 0, y: 0, w: 2, h: 1 }
  const snap = capturePlanesF32(data, w, rect, [0, 2]) // protect R and B
  for (let i = 0; i < data.length; i++) data[i] = 99
  restorePlanesF32(data, snap)
  assert.equal(Object.is(data[0], -0.0), true, 'signed zero R preserved')
  assert.equal(data[1], 99, 'unprotected G overwritten')
  assert.equal(Number.isNaN(data[2]), true, 'NaN B preserved')
  assert.equal(data[3], 99, 'unprotected A overwritten')
  assert.ok(Math.abs(data[4] - 0.1) < 1e-5, 'pixel 1 R preserved')
  assert.equal(data[5], 99, 'pixel 1 G overwritten')
  assert.ok(Math.abs(data[6] - 0.3) < 1e-5, 'pixel 1 B preserved')
  assert.equal(data[7], 99, 'pixel 1 A overwritten')
  console.log('Float32 capture/restore passed')
}

// ---------------------------------------------------------------- erasePaintData

{
  const stroke = new Uint8ClampedArray([100, 50, 25, 128, 200, 100, 50, 0])
  const out = erasePaintData(stroke, { r: 10, g: 20, b: 30 })
  assert.deepEqual(Array.from(out), [10, 20, 30, 128, 10, 20, 30, 0])
  assert.deepEqual(Array.from(stroke), [100, 50, 25, 128, 200, 100, 50, 0], 'source untouched')
  console.log('erasePaintData passed')
}

// ---------------------------------------------------------------- docRectToLayerRect

{
  assert.deepEqual(docRectToLayerRect({ x: 10, y: 10, w: 20, h: 20 }, 100, 100, 0, 0), { x: 10, y: 10, w: 20, h: 20 })
  assert.deepEqual(docRectToLayerRect({ x: 10, y: 10, w: 20, h: 20 }, 100, 100, 5, 5), { x: 5, y: 5, w: 20, h: 20 })
  assert.equal(docRectToLayerRect({ x: 200, y: 200, w: 20, h: 20 }, 100, 100, 0, 0), null)
  assert.equal(docRectToLayerRect({ x: -50, y: -50, w: 10, h: 10 }, 100, 100, 0, 0), null)
  console.log('docRectToLayerRect passed')
}

// ---------------------------------------------------------------- resolveChannelTarget

{
  const doc = { channelTarget: 'rb' } as unknown as PsDocument
  assert.deepEqual(resolveChannelTarget(doc), { target: 'rb', restrict: true })
  assert.deepEqual(resolveChannelTarget(doc, 'g'), { target: 'g', restrict: true })
  assert.deepEqual(resolveChannelTarget(doc, 'composite'), { target: 'composite', restrict: false })
  const composite = { channelTarget: 'composite' } as unknown as PsDocument
  assert.deepEqual(resolveChannelTarget(composite), { target: 'composite', restrict: false })
  assert.throws(() => resolveChannelTarget(doc, 'bogus'), /Unknown channel editing target/)
  console.log('resolveChannelTarget passed')
}

// ---------------------------------------------------------------- captureCanvasPlanes / restoreCanvasPlanes (8-bit)

{
  const w = 6, h = 5
  const canvas = layer(w, h, '#402060ff') // R=0x40 G=0x20 B=0x60 A=0xff
  const snap = captureCanvasPlanes(canvas as unknown as HTMLCanvasElement, { x: 1, y: 1, w: 3, h: 2 }, 'r') // protect G,B,A
  assert.ok(snap && !snap.float16)
  // Paint everything red (R=255) — protected planes must come back within the rect
  const ctx = canvas.ctx
  for (let row = 1; row < 3; row++) {
    for (let col = 1; col < 4; col++) {
      const i = (row * 6 + col) * 4
      ctx.buf[i] = 255; ctx.buf[i + 1] = 0; ctx.buf[i + 2] = 0; ctx.buf[i + 3] = 255
    }
  }
  restoreCanvasPlanes(canvas as unknown as HTMLCanvasElement, snap!)
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 6; x++) {
      const [r, g, b, a] = canvas.pixel(x, y)
      const inRect = x >= 1 && x < 4 && y >= 1 && y < 3
      if (inRect) {
        assert.equal(r, 255, `R painted at ${x},${y}`)
        assert.equal(g, 0x20, `G protected at ${x},${y}`)
        assert.equal(b, 0x60, `B protected at ${x},${y}`)
        assert.equal(a, 0xff, `A protected at ${x},${y}`)
      } else {
        assert.equal(r, 0x40, `R untouched outside rect at ${x},${y}`)
        assert.equal(g, 0x20, `G untouched outside rect at ${x},${y}`)
        assert.equal(b, 0x60, `B untouched outside rect at ${x},${y}`)
        assert.equal(a, 0xff, `A untouched outside rect at ${x},${y}`)
      }
    }
  }
  console.log('8-bit canvas capture/restore passed')
}

// ---------------------------------------------------------------- captureCanvasPlanes / restoreCanvasPlanes (float16)

{
  const w = 4, h = 4
  const canvas = layer(w, h, '#402060ff', 16)
  const snap = captureCanvasPlanes(canvas as unknown as HTMLCanvasElement, { x: 0, y: 0, w, h }, 'gb') // protect R and A
  assert.ok(snap && snap.float16)
  // Overwrite everything
  const ctx = canvas.ctx
  for (let i = 0; i < ctx.buf.length; i += 4) { ctx.buf[i] = 255; ctx.buf[i + 1] = 0; ctx.buf[i + 2] = 0; ctx.buf[i + 3] = 255 }
  restoreCanvasPlanes(canvas as unknown as HTMLCanvasElement, snap!)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = canvas.pixel(x, y)
      assert.equal(r, 0x40, `R protected at ${x},${y}`)
      assert.equal(g, 0, `G painted at ${x},${y}`)
      assert.equal(b, 0, `B painted at ${x},${y}`)
      assert.equal(a, 0xff, `A protected at ${x},${y}`)
    }
  }
  console.log('float16 canvas capture/restore passed')
}

// ---------------------------------------------------------------- translateEraseStrokeToColor

{
  const stroke = new FakeCanvas(2, 2)
  stroke.fill('#ff0000ff') // red opaque stroke
  const out = translateEraseStrokeToColor(stroke as unknown as HTMLCanvasElement, '#0000ff') as unknown as FakeCanvas
  for (let i = 0; i < 4; i++) {
    const [r, g, b, a] = out.pixel(i % 2, Math.floor(i / 2))
    assert.equal(r, 0, `erase→bg R at pixel ${i}`)
    assert.equal(g, 0, `erase→bg G at pixel ${i}`)
    assert.equal(b, 0xff, `erase→bg B at pixel ${i}`)
    assert.equal(a, 0xff, `erase→bg alpha carries coverage at pixel ${i}`)
  }
  assert.deepEqual((stroke as FakeCanvas).pixel(0, 0), [0xff, 0, 0, 0xff], 'source stroke untouched')
  console.log('translateEraseStrokeToColor passed')
}

// ---------------------------------------------------------------- engine integration: fillSelection (8-bit)

{
  const raw = new Engine()
  const doc = makeDoc(8, 8, 8, 'r') // target red only
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  const l = doc.layers[0] as any
  const before = l.canvas.ctx.buf.slice()
  raw.fillSelection('#ff0000') // fill red into selected area
  const after = l.canvas.ctx.buf.slice()
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4
      assert.equal(after[i], 0xff, `R filled at ${x},${y}`)
      assert.equal(after[i + 1], before[i + 1], `G protected at ${x},${y}`)
      assert.equal(after[i + 2], before[i + 2], `B protected at ${x},${y}`)
      assert.equal(after[i + 3], before[i + 3], `A protected at ${x},${y}`)
    }
  }
  console.log('engine fillSelection (8-bit, target r) passed')
}

// ---------------------------------------------------------------- engine integration: fillSelection (32-bit HDR)

{
  const raw = new Engine()
  const doc = makeDoc(8, 8, 32, 'b') // target blue only
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  const l = doc.layers[0] as any
  const before = new Float32Array(l.hdrPixels!)
  raw.fillSelection('#0000ff') // HDR fill blue
  const after = l.hdrPixels!
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const base = (y * 8 + x) * 4
      // B and A get the fill color; R and G preserved from before
      assert.ok(after[base] === before[base], `R preserved at ${x},${y}`)
      assert.ok(after[base + 1] === before[base + 1], `G preserved at ${x},${y}`)
      assert.ok(after[base + 3] === before[base + 3], `A preserved at ${x},${y}`)
    }
  }
  // canvas mirror matches hdrPixels
  const ctx = l.canvas.ctx
  for (let i = 0; i < ctx.buf.length; i += 4) {
    const base = i
    assert.equal(ctx.buf[base + 2], 0xff, `B painted in canvas at ${i / 4}`)
  }
  console.log('engine fillSelection (32-bit, target b) passed')
}

// ---------------------------------------------------------------- engine: refusal guard

{
  const raw = new Engine()
  const doc = makeDoc(8, 8, 8, 'rb')
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  // moveLayerPixels must refuse
  const l = doc.layers[0] as any
  const beforeX = l.offsetX
  raw.moveLayerPixels('l1', 10, 0)
  assert.equal(l.offsetX, beforeX, 'move refused under channel target')
  console.log('refusal guard passed')
}

// ---------------------------------------------------------------- engine: channelTarget round trips through history

{
  const raw = new Engine()
  const doc = makeDoc(8, 8, 8, 'rb')
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  // captureState / restoreState are private; access via structural cast for the test
  // @ts-ignore — accessing private members for test
  const eng = raw as unknown as {
    captureState: (d: PsDocument, label: string, previous?: import('../src/editor/types').HistoryState) => import('../src/editor/types').HistoryState
    restoreState: (d: PsDocument, s: import('../src/editor/types').HistoryState) => void
  }
  const st = eng.captureState(doc, 'targeted')
  assert.equal(st.channelTarget, 'rb', 'channelTarget captured in history')
  eng.restoreState(doc, st)
  assert.equal(doc.channelTarget, 'rb', 'channelTarget restored on undo')
  console.log('history channelTarget round trip passed')
}

// ---------------------------------------------------------------- engine: adjustments/filters honour channel target

{
  const raw = new Engine()
  const doc = makeDoc(8, 8, 8, 'r') // target red only
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  const l = doc.layers[0] as any
  const before = l.canvas.ctx.buf.slice()
  // Invert under target 'r': only R should invert
  assert.equal(raw.applyAdjustmentToLayer('l1', 'invert', {}), true)
  const after = l.canvas.ctx.buf.slice()
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4
      assert.equal(after[i], 255 - before[i], `R inverted at ${x},${y}`)
      assert.equal(after[i + 1], before[i + 1], `G preserved at ${x},${y}`)
      assert.equal(after[i + 2], before[i + 2], `B preserved at ${x},${y}`)
      assert.equal(after[i + 3], before[i + 3], `A preserved at ${x},${y}`)
    }
  }
  console.log('engine applyAdjustmentToLayer honours target (r) passed')
}

{
  const raw = new Engine()
  const doc = makeDoc(8, 8, 8, 'b') // target blue only
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  const l = doc.layers[0] as any
  // Fill with a varying pattern so blur actually changes values
  const ctx = l.canvas.ctx
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4
      ctx.buf[i] = x * 32       // R gradient
      ctx.buf[i + 1] = y * 32   // G gradient
      ctx.buf[i + 2] = (x + y) * 16 // B gradient
      ctx.buf[i + 3] = 255
    }
  }
  const before = l.canvas.ctx.buf.slice()
  // Gaussian blur under target 'b': only B should change
  assert.equal(raw.applyFilterToLayer('l1', 'gaussian-blur', { radius: 2 }), true)
  const after = l.canvas.ctx.buf.slice()
  let bChanged = false
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4
      assert.equal(after[i], before[i], `R preserved at ${x},${y}`)
      assert.equal(after[i + 1], before[i + 1], `G preserved at ${x},${y}`)
      assert.equal(after[i + 3], before[i + 3], `A preserved at ${x},${y}`)
      if (after[i + 2] !== before[i + 2]) bChanged = true
    }
  }
  assert.ok(bChanged, 'B channel changed by blur')
  console.log('engine applyFilterToLayer honours target (b) passed')
}

// camera-raw and hdr-toning must refuse under a channel target
{
  for (const [fn, args, type] of [
    ['applyAdjustmentToLayer', ['l1', 'camera-raw', {}], 'camera-raw'] as const,
    ['applyAdjustmentToLayer', ['l1', 'hdr-toning', {}], 'hdr-toning'] as const,
  ]) {
    const raw = new Engine()
    const doc = makeDoc(8, 8, 8, 'rb')
    raw.docs.push(doc)
    raw.setActiveDocument(doc.id)
    const before = JSON.stringify((doc.layers[0].canvas as unknown as FakeCanvas).ctx.buf)
    assert.equal((raw as any)[fn](...args), false, `${type} refused under channel target`)
    assert.equal(JSON.stringify((doc.layers[0].canvas as unknown as FakeCanvas).ctx.buf), before, `${type}: no pixel change`)
  }
  console.log('camera-raw/hdr-toning refused under channel target passed')
}

// ---------------------------------------------------------------- engine: Curves/Levels combined channel entries

{
  const raw = new Engine()
  const doc = makeDoc(8, 8, 8, 'rb') // target red+blue only
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  const l = doc.layers[0] as any
  // Fill with a varying pattern
  const ctx = l.canvas.ctx
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4
      ctx.buf[i] = x * 32       // R gradient
      ctx.buf[i + 1] = y * 32   // G gradient
      ctx.buf[i + 2] = (x + y) * 16 // B gradient
      ctx.buf[i + 3] = 255
    }
  }
  const before = l.canvas.ctx.buf.slice()

  // Curves with channel=rb should only affect R and B
  assert.equal(raw.applyAdjustmentToLayer('l1', 'curves', { channel: 'rb', points: [{ x: 0, y: 0 }, { x: 255, y: 128 }] }), true)
  const afterCurves = l.canvas.ctx.buf.slice()
  let rbChanged = false
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4
      assert.equal(afterCurves[i + 1], before[i + 1], `G preserved at ${x},${y} under curves rb`)
      if (afterCurves[i] !== before[i] || afterCurves[i + 2] !== before[i + 2]) rbChanged = true
    }
  }
  assert.ok(rbChanged, 'Curves rb changed R and/or B')
  console.log('engine Curves combined channel (rb) passed')

  // Levels with channel=rg should only affect R and G
{
  const raw2 = new Engine()
  const doc2 = makeDoc(8, 8, 8, 'rg')
  raw2.docs.push(doc2)
  raw2.setActiveDocument(doc2.id)
  const l2 = doc2.layers[0] as any
  const ctx2 = l2.canvas.ctx
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4
      ctx2.buf[i] = x * 32
      ctx2.buf[i + 1] = y * 32
      ctx2.buf[i + 2] = (x + y) * 16
      ctx2.buf[i + 3] = 255
    }
  }
  const before2 = l2.canvas.ctx.buf.slice()
  assert.equal(raw2.applyAdjustmentToLayer('l1', 'levels', { channel: 'rg', inBlack: 0, inWhite: 128 }), true)
  const afterLevels = l2.canvas.ctx.buf.slice()
  let rgChanged = false
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4
      assert.equal(afterLevels[i + 2], before2[i + 2], `B preserved at ${x},${y} under levels rg`)
      if (afterLevels[i] !== before2[i] || afterLevels[i + 1] !== before2[i + 1]) rgChanged = true
    }
  }
  assert.ok(rgChanged, 'Levels rg changed R and/or G')
  console.log('engine Levels combined channel (rg) passed')
}
}

// ---------------------------------------------------------------- engine: Curves/Levels default (rgb) still affects all channels

{
  const raw = new Engine()
  const doc = makeDoc(8, 8, 8, 'composite')
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  const l = doc.layers[0] as any
  const ctx = l.canvas.ctx
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4
      ctx.buf[i] = x * 32
      ctx.buf[i + 1] = y * 32
      ctx.buf[i + 2] = (x + y) * 16
      ctx.buf[i + 3] = 255
    }
  }
  const before = l.canvas.ctx.buf.slice()
  assert.equal(raw.applyAdjustmentToLayer('l1', 'curves', { channel: 'rgb', points: [{ x: 0, y: 0 }, { x: 255, y: 128 }] }), true)
  const after = l.canvas.ctx.buf.slice()
  let rChanged = false, gChanged = false, bChanged = false
  for (let i = 0; i < after.length; i += 4) {
    if (after[i] !== before[i]) rChanged = true
    if (after[i + 1] !== before[i + 1]) gChanged = true
    if (after[i + 2] !== before[i + 2]) bChanged = true
  }
  assert.ok(rChanged && gChanged && bChanged, 'Curves rgb changed all three channels')
  console.log('engine Curves default (rgb) affects all channels passed')
}

// ---------------------------------------------------------------- engine: feathered selection constrains subset

{
  const raw = new Engine()
  const doc = makeDoc(8, 8, 8, 'r') // target red only
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  const l = doc.layers[0] as any
  const ctx = l.canvas.ctx
  // Fill with midgray
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4
      ctx.buf[i] = 128; ctx.buf[i + 1] = 128; ctx.buf[i + 2] = 128; ctx.buf[i + 3] = 255
    }
  }
  // Create a feathered selection: fully selected in center, fading to 0 at edges
  const selMask = (doc.selection!.mask as unknown as FakeCanvas)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4
      // Distance-based feather: center fully selected, edges unselected
      const dx = x - 3.5, dy = y - 3.5
      const d = Math.sqrt(dx * dx + dy * dy)
      const alpha = d <= 2 ? 255 : d <= 3.5 ? Math.round(255 * (3.5 - d) / 1.5) : 0
      selMask.ctx.buf[i + 3] = alpha
    }
  }
  const before = l.canvas.ctx.buf.slice()
  assert.equal(raw.applyAdjustmentToLayer('l1', 'invert', {}), true)
  const after = l.canvas.ctx.buf.slice()
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4
      const selAlpha = selMask.ctx.buf[i + 3] / 255
      // R is targeted, so it should invert attenuated by selection alpha
      const expectedR = Math.round(128 * (1 - selAlpha) + (255 - 128) * selAlpha)
      assert.equal(after[i], expectedR, `R feathered at ${x},${y} (selAlpha=${selAlpha})`)
      // G and B are protected, should NOT change
      assert.equal(after[i + 1], 128, `G preserved at ${x},${y}`)
      assert.equal(after[i + 2], 128, `B preserved at ${x},${y}`)
    }
  }
  console.log('engine feathered selection constrains subset adjustment passed')
}

// ---------------------------------------------------------------- engine: non-paint commands refuse channel target

{
  const raw = new Engine()
  const doc = makeDoc(8, 8, 8, 'rb') // target red+blue
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  const l = doc.layers[0] as any
  const beforeOffsetX = l.offsetX

  // moveLayerPixels must refuse under channel target
  raw.moveLayerPixels('l1', 10, 0)
  assert.equal(l.offsetX, beforeOffsetX, 'moveLayerPixels refused under channel target')

  // deleteSelectionPixels must refuse under channel target
  raw.deleteSelectionPixels()
  const l2 = doc.layers[0] as any
  const beforeBuf = l2.canvas.ctx.buf.slice()
  raw.deleteSelectionPixels()
  const afterBuf = l2.canvas.ctx.buf.slice()
  assert.deepEqual(afterBuf, beforeBuf, 'deleteSelectionPixels refused under channel target')

  console.log('engine non-paint commands refuse channel target passed')
}

// ---------------------------------------------------------------- engine: only pixel editing paint commands follow color set

{
  // Non-paint commands (transform, filter via smart filter, etc.) must NOT
  // silently honor the channel target - they are refused transactionally.
  const raw = new Engine()
  const doc = makeDoc(8, 8, 8, 'r')
  raw.docs.push(doc)
  raw.setActiveDocument(doc.id)
  const l = doc.layers[0] as any

  // Smart filter add must refuse under channel target
  raw.addSmartFilter('l1', 'gaussian-blur', { radius: 2 })
  const l2 = doc.layers[0] as any
  assert.equal(l2.smartFilters.length, 0, 'smart filter add refused under channel target')

  console.log('engine only pixel editing paint commands follow color set passed')
}

console.log('validate-channel-editing: all checks passed')
