import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyNativeFloat16ToneDab, supportsNativeFloat16ToneCanvas } from '../src/editor/image-ops/native-float16-tone'

/** Float16-shaped readback double, not an emulator of half-float rounding. */
class Float16Array extends Float32Array {}

function fakeCanvas(opts: { mode?: 'half' | 'uint8' | 'error'; colorSpace?: 'srgb' | 'display-p3'; failWrite?: boolean } = {}) {
  const width = 6, height = 5
  const pixels = new Float32Array(width * height * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = .25; pixels[i + 1] = .5; pixels[i + 2] = 1.5
    pixels[i + 3] = .625
  }
  const source = pixels.slice()
  const calls = { reads: 0, writes: 0, rectangle: [] as number[] }
  const context = {
    getContextAttributes: () => ({ colorType: 'float16', colorSpace: opts.colorSpace ?? 'srgb' }),
    getImageData(x: number, y: number, w: number, h: number, attrs?: { pixelFormat?: string }) {
      if (opts.mode === 'error') throw new Error('Unavailable')
      calls.reads++
      assert.equal(attrs?.pixelFormat, 'rgba-float16')
      assert.ok(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= width && y + h <= height)
      const raw = new (opts.mode === 'uint8' ? Uint8ClampedArray : Float16Array)(w * h * 4)
      for (let row = 0; row < h; row++) {
        raw.set(pixels.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4)
      }
      return { data: raw, width: w, height: h,
        pixelFormat: opts.mode === 'uint8' ? 'rgba-unorm8' : 'rgba-float16' }
    },
    putImageData(img: { data: Float16Array; width: number; height: number }, x: number, y: number) {
      if (opts.failWrite) throw new Error('Write failed')
      calls.writes++; calls.rectangle = [x, y, img.width, img.height]
      for (let row = 0; row < img.height; row++) {
        pixels.set(img.data.subarray(row * img.width * 4, (row + 1) * img.width * 4),
          ((y + row) * width + x) * 4)
      }
    },
  }
  const canvas = { width, height, getContext: () => context } as unknown as HTMLCanvasElement
  return { canvas, pixels, source, calls }
}
const idx = (x: number, y: number) => (y * 6 + x) * 4
const options = {
  offsetX: 0, offsetY: 0, x: 2, y: 2, radius: 1.5,
  strength: .5, mode: 'dodge' as const, range: 'all',
  alpha: (dx: number, dy: number) => Math.abs(dx) < .001 && Math.abs(dy) < .001 ? 1 : 0,
}
const good = fakeCanvas()
assert.equal(supportsNativeFloat16ToneCanvas(good.canvas), true)
assert.equal(applyNativeFloat16ToneDab({ ...options, canvas: good.canvas }), true)
assert.ok(good.pixels[idx(2,2)] > good.source[idx(2,2)], '16-bit values must lighten')
assert.ok(good.pixels[idx(2,2)+2] > 1.5, 'HDR channel above 1 must not be clipped')
assert.equal(good.pixels[idx(2,2)+3], .625, 'Native half alpha is never rewritten')
assert.equal(good.pixels[idx(0,0)+1], good.source[idx(0,0)+1],
  'Outside the dab RGB remains untouched')
assert.ok(good.calls.rectangle[2] < 6 && good.calls.rectangle[3] < 5,
  'Only a local brush rectangle is written')

const selection = fakeCanvas()
const mask = new Uint8ClampedArray(6 * 5 * 4)
assert.equal(applyNativeFloat16ToneDab({ ...options, canvas: selection.canvas,
  selection: {x: 0,y: 0,width: 6,height: 5,data: mask}, hasSelection: true }), false)
assert.deepEqual(Array.from(selection.pixels), Array.from(selection.source))
mask[idx(2,2)+3] = 128
assert.equal(applyNativeFloat16ToneDab({ ...options, canvas: selection.canvas,
  selection: {x: 0,y: 0,width: 6,height: 5,data: mask}, hasSelection: true }), true)
assert.ok(selection.pixels[idx(2,2)] > selection.source[idx(2,2)]
  && selection.pixels[idx(2,2)] < good.pixels[idx(2,2)], 'Selection alpha attenuates the dab')

const offset = fakeCanvas()
assert.equal(applyNativeFloat16ToneDab({
  ...options, canvas: offset.canvas, x: 22, y: 32, offsetX: 20, offsetY: 30,
}), true)
assert.ok(Math.abs(offset.pixels[idx(2,2)] - good.pixels[idx(2,2)]) < .0001,
  'Layer offsets map document brush coordinates correctly')

const burn = fakeCanvas()
assert.equal(applyNativeFloat16ToneDab({ ...options, canvas: burn.canvas,
  mode: 'burn', protectTones: false }), true)
assert.ok(burn.pixels[idx(2,2)] < burn.source[idx(2,2)])
const sponge = fakeCanvas()
assert.equal(applyNativeFloat16ToneDab({ ...options, canvas: sponge.canvas,
  mode: 'sponge', saturate: false }), true)
assert.ok(sponge.pixels[idx(2,2)+2] < sponge.source[idx(2,2)+2])

const untouched = fakeCanvas()
assert.equal(applyNativeFloat16ToneDab({ ...options, canvas: untouched.canvas, x: -200 }), false)
assert.equal(untouched.calls.reads, 0, 'Off-canvas brush cannot trigger readback')
assert.equal(applyNativeFloat16ToneDab({ ...options, canvas: untouched.canvas, strength: 0 }), false)
assert.deepEqual(Array.from(untouched.pixels), Array.from(untouched.source))

const wrongFormat = fakeCanvas({mode: 'uint8'})
assert.equal(supportsNativeFloat16ToneCanvas(wrongFormat.canvas), false)
assert.throws(() => applyNativeFloat16ToneDab({ ...options, canvas: wrongFormat.canvas }),
  /non-Float16/, 'Fail closed when browser ignores float16 readback')
assert.equal(wrongFormat.calls.writes, 0)
const blockedRead = fakeCanvas({mode: 'error'})
assert.equal(supportsNativeFloat16ToneCanvas(blockedRead.canvas), false)
assert.throws(() => applyNativeFloat16ToneDab({ ...options, canvas: blockedRead.canvas }),
  /unavailable/, 'Never substitute Uint8 for an unavailable float16 API')
const wrongColor = fakeCanvas({colorSpace: 'display-p3'})
assert.equal(supportsNativeFloat16ToneCanvas(wrongColor.canvas), false)
assert.throws(() => applyNativeFloat16ToneDab({ ...options, canvas: wrongColor.canvas }),
  /sRGB raster/, 'Unimplemented Display-P3 color math must not run')
const failWrite = fakeCanvas({failWrite: true})
assert.throws(() => applyNativeFloat16ToneDab({ ...options, canvas: failWrite.canvas }),
  /writeback failed/)
assert.deepEqual(Array.from(failWrite.pixels), Array.from(failWrite.source))

const src = readFileSync(new URL('../src/editor/tools/retouch.ts', import.meta.url), 'utf8')
assert.match(src, /const native16Tone = doc\.workingBitDepth === 16/)
assert.match(src, /supportsNativeFloat16ToneCanvas\(layer\.canvas\)/)
assert.match(src, /native16ToneDab\(burn \? 'burn' : 'dodge'/)
assert.match(src, /native16ToneDab\('sponge'/)
assert.match(src, /retouchContext\?\.native16EverChanged/)
assert.match(src, /mutated = !\(hdrRetouch \|\| native16Tone\)/)
console.log('Native Float16 tonal retouch validated: local writeback, guards, alpha, selection and coordinates.')
