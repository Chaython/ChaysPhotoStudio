import assert from 'node:assert/strict'
import { applyFloat32RetouchDab, type HdrRetouchDab } from '../src/editor/image-ops/hdr-retouch'
import { readFileSync } from 'node:fs'

function single(rgb: [number, number, number], a = 0.73) {
  return new Float32Array([...rgb, a])
}
function apply(pixels: Float32Array, overrides: Partial<HdrRetouchDab> = {}) {
  return applyFloat32RetouchDab({
    pixels, width: 1, height: 1, offsetX: 0, offsetY: 0,
    x: 0, y: 0, radius: 2, strength: 0.4, mode: 'dodge',
    range: 'highlights', alpha: () => 1, ...overrides,
  })
}

const original = single([2.4, 1.25, 0.375])
assert.ok(apply(original), 'Dodge must edit a visible HDR pixel')
assert.ok(original[0] > 2.4 && original[1] > 1.25, 'HDR values above display white cannot clip to 1')
assert.equal(original[3], Math.fround(0.73), 'Alpha must not be edited')
assert.ok(original[0] !== Math.round(original[0] * 255) / 255, 'Float32 precision is retained')

const burn = single([1.4, 0.81, 0.38])
assert.ok(apply(burn, { mode: 'burn', range: 'all', protectTones: false }))
assert.ok(burn[0] < 1.4 && burn[0] > 0)
assert.equal(burn[3], Math.fround(0.73))

const untouched = single([2, 1, 0.5])
const before = Array.from(untouched)
assert.equal(apply(untouched, { x: 100, y: 100 }), false)
assert.deepEqual(Array.from(untouched), before, 'Off-canvas HDR dab cannot mutate data')
assert.equal(apply(untouched, { x: NaN }), false)
assert.equal(apply(untouched, { alpha: () => 0 }), false)
assert.equal(apply(untouched, { strength: 0 }), false)
assert.deepEqual(Array.from(untouched), before)

const masked = single([2, 1, 0.5])
const noSelection = { x: 0, y: 0, width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0]) }
assert.equal(apply(masked, { selection: noSelection, hasSelection: true }), false)
assert.deepEqual(Array.from(masked), before)
assert.equal(apply(masked, { hasSelection: true }), false, 'Empty selection intersection is a no-op')

const selected = single([2, 1, 0.5])
assert.ok(apply(selected, {
  selection: { ...noSelection, data: new Uint8ClampedArray([0, 0, 0, 128]) },
  hasSelection: true,
}))
assert.ok(selected[0] > 2 && selected[0] < original[0], 'Half selection alpha must weaken the dab')

const shifted = single([1.2, 0.7, 0.3])
assert.ok(apply(shifted, {
  x: 13, y: 23, offsetX: 13, offsetY: 23,
  selection: { x: 13, y: 23, width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) },
  hasSelection: true,
}), 'Offset layers and document-space masks stay aligned')

const saturate = single([1.8, 0.7, 0.12])
const faded = single([1.8, 0.7, 0.12])
assert.ok(apply(saturate, { mode: 'sponge', saturate: true, range: 'midtones' }))
assert.ok(apply(faded, { mode: 'sponge', saturate: false, range: 'midtones' }))
assert.ok(saturate[0] > faded[0], 'Saturation and desaturation must have opposite directions')
assert.ok(saturate[0] > 1, 'Sponge must not clip HDR highlights')
assert.equal(saturate[3], Math.fround(0.73))
assert.equal(faded[3], Math.fround(0.73))

const transparent = single([0.4, 0.2, 0.1], 0)
assert.equal(apply(transparent, { range: 'midtones' }), false)
assert.deepEqual(Array.from(transparent), Array.from(single([0.4, 0.2, 0.1], 0)))

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const retouch = read('src/editor/tools/retouch.ts')
assert.match(retouch, /applyFloat32RetouchDab\(/)
assert.match(retouch, /flushHdrPreview\(\)/)
assert.match(retouch, /hdrFloat32ToPreviewCanvas\(/)
assert.match(retouch, /if \(engine\.activeDoc\?\.workingBitDepth === 32\)/)
assert.match(retouch, /layer\.hdrPixels\.length !== layer\.canvas\.width \* layer\.canvas\.height \* 4/)
const byteGuard = read('src/editor/tools/shared.ts')
assert.match(byteGuard, /if \(doc\.workingBitDepth === 8\) return true/, 'Unsupported high-depth tools still reject byte processing')
console.log('Float32 HDR Dodge/Burn/Sponge precision, selection, offsets and guard checks passed')
