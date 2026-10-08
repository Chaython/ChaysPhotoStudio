import assert from 'node:assert/strict'
import { extendSelectionByColor } from '../src/editor/image-ops/selection-color'

function pixels(w: number, h: number, colors: number[][]): ImageData {
  assert.equal(colors.length, w * h)
  return {
    width: w, height: h,
    data: new Uint8ClampedArray(colors.flatMap(c => [...c, 255])),
  } as ImageData
}

const R = [250, 20, 20], B = [20, 20, 250], G = [20, 250, 20]
const row = [R, R, B, B, B, R, B]
const image = pixels(7, 3, [...row, ...row, ...row])
const selection = new Uint8ClampedArray(21)
selection[7] = 255 // left-hand connected red area

const grow = extendSelectionByColor(image, selection, 'grow', 12)
assert.equal(grow[7], 255)
assert.equal(grow[8], 255)
assert.equal(grow[0], 255)
assert.equal(grow[12], 0, 'Grow does not cross blue to an isolated matching red island')
assert.equal(grow[9], 0, 'Grow does not fill unrelated colors')

const similar = extendSelectionByColor(image, selection, 'similar', 12)
assert.equal(similar[12], 255, 'Similar finds disconnected matching colors')
assert.equal(similar[9], 0)
assert.equal(selection[8], 0, 'source mask is never mutated')

const multi = pixels(5, 1, [R, G, B, G, R])
const start = new Uint8ClampedArray([255, 255, 0, 0, 0])
assert.deepEqual([...extendSelectionByColor(multi, start, 'similar', 8)],
  [255, 255, 0, 255, 255], 'multi-color selections retain uncommon colors')

const softStart = new Uint8ClampedArray([128, 0, 0, 0, 0])
const soft = extendSelectionByColor(multi, softStart, 'similar', 8)
assert.equal(soft[0], 128, 'original feathered selection alpha survives')
assert.equal(soft[4], 255)

const transparent = pixels(2, 1, [R, R])
transparent.data[7] = 0 // hidden RGB is identical to the selected opaque pixel
assert.equal(extendSelectionByColor(transparent, new Uint8ClampedArray([255, 0]), 'similar', 8)[1], 0,
  'matching invisible RGB does not extend an opaque selection')

const empty = new Uint8ClampedArray(21)
assert.deepEqual(extendSelectionByColor(image, empty, 'grow'), empty)
assert.throws(() => extendSelectionByColor(image, new Uint8ClampedArray(2), 'grow'), /document-sized/)
assert.throws(() => extendSelectionByColor(image, selection, 'similar', NaN), /tolerance/)
console.log('Select Grow/Similar: contiguous, disconnected, multi-color, feather, transparency, guards passed')
