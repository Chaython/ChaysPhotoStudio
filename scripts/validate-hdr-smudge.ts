import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyFloat32SmudgeDab, type Float32SmudgeDab } from '../src/editor/image-ops/hdr-smudge'

const w = 6, h = 5, row = 2
const at = (x: number, y = row) => (y * w + x) * 4
function image(): Float32Array {
  const data = new Float32Array(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = .2; data[i + 1] = .4; data[i + 2] = 1.6; data[i + 3] = 1
  }
  data[at(1)] = 4.75
  data[at(2)] = .5
  data[at(3)] = .75
  return data
}
function smear(pixels: Float32Array, opts: Partial<Float32SmudgeDab> = {}) {
  return applyFloat32SmudgeDab({
    pixels, width: w, height: h,
    offsetX: 0, offsetY: 0,
    previousX: 1, previousY: row,
    x: 2, y: row,
    radius: 1, strength: .75,
    alpha: (dx, dy) => Math.abs(dx) < .01 && Math.abs(dy) < .01 ? 1 : 0,
    ...opts,
  })
}

const pixels = image(), before = pixels.slice()
assert.equal(smear(pixels), true, 'Smudge must move color into the current brush position')
assert.ok(pixels[at(2)] > before[at(2)] + 1, 'Bright HDR source must be deposited')
assert.ok(pixels[at(2)] > 1, 'Smudge cannot clip HDR highlights to display white')
assert.equal(pixels[at(2) + 3], 1, 'Opaque alpha remains opaque')
assert.equal(pixels[at(1)], before[at(1)], 'Pickup does not overwrite the source')
assert.equal(pixels[at(3)], before[at(3)], 'Pixels outside the brush are untouched')

const offLayer = image(), clean = Array.from(offLayer)
assert.equal(smear(offLayer, { x: 500 }), false)
assert.equal(smear(offLayer, { previousX: 2 }), false, 'Stationary motion must not create Undo')
assert.equal(smear(offLayer, { strength: 0 }), false)
assert.equal(smear(offLayer, { x: NaN }), false)
assert.equal(smear(offLayer, { alpha: () => NaN }), false)
assert.deepEqual(Array.from(offLayer), clean)

const absent = image()
absent[at(1)] = 500
absent[at(1) + 3] = 0
const absentBefore = Array.from(absent)
assert.equal(smear(absent), false, 'Transparent hidden RGB must not bleed into visible pixels')
assert.deepEqual(Array.from(absent), absentBefore)

const mask = { x: 0, y: 0, width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
const masked = image()
assert.equal(smear(masked, { selection: mask, hasSelection: true }), false)
assert.equal(smear(masked, { hasSelection: true }), false, 'Missing selection region cannot bypass selection')
assert.deepEqual(Array.from(masked), clean)
mask.data[at(2) + 3] = 128
assert.equal(smear(masked, { selection: mask, hasSelection: true }), true)
assert.ok(masked[at(2)] > clean[at(2)] && masked[at(2)] < pixels[at(2)],
  'Partial selection alpha weakens Smudge')

const shifted = image()
assert.equal(smear(shifted, { x: 22, y: 32, previousX: 21, previousY: 32,
  offsetX: 20, offsetY: 30 }), true)
assert.ok(Math.abs(shifted[at(2)] - pixels[at(2)]) < 1e-6,
  'Layer offsets must use document-space brush coordinates')

const transparentDestination = image()
transparentDestination[at(2) + 3] = 0
const originalHidden = transparentDestination[at(2)]
assert.equal(smear(transparentDestination), true)
assert.ok(transparentDestination[at(2) + 3] > 0, 'Smudge can paint alpha into a transparent destination')
assert.ok(transparentDestination[at(2)] > originalHidden, 'Deposited HDR color is not clipped')

const fractional = image()
assert.equal(smear(fractional, { previousX: 1.5 }), true)
assert.ok(fractional[at(2)] > before[at(2)] && fractional[at(2)] < pixels[at(2)],
  'Bilinear Float32 sampling interpolates neighboring pickup pixels')

const staged = image()
const sourceAt2 = staged[at(2)]
assert.equal(smear(staged, {
  radius: 2,
  alpha: (dx, dy) => dy === 0 && (dx === 0 || dx === 1) ? 1 : 0,
}), true)
assert.ok(staged[at(3)] < 1.5, 'The same dab cannot read a previously overwritten source pixel')
assert.ok(staged[at(3)] > sourceAt2, 'The adjacent destination receives the original source color')

const code = readFileSync(new URL('../src/editor/tools/retouch.ts', import.meta.url), 'utf8')
assert.match(code, /applyFloat32SmudgeDab\(/)
assert.match(code, /id === 'smudge'\) && opts\.output === 'new'/)
assert.match(code, /opts\.sampleAllLayers === true \|\| opts\.fingerPainting === true/)
assert.match(code, /if \(engine\.activeDoc\?\.workingBitDepth === 32\) return origMove\(p\)/)
assert.match(code, /if \(changed\) noteHdrRetouchChange\(/)
assert.match(code, /mutated = !hdrRetouch/, 'No-op HDR strokes must not create history')
console.log('Float32 Smudge: HDR color, transparent edges, selection, offset, staging and mode guards passed')
