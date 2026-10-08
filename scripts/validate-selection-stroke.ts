import assert from 'node:assert/strict'
import { renderSelectionStroke, selectionStrokeAlpha } from '../src/editor/image-ops/selection-stroke'
const square = new Uint8ClampedArray(49)
for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) square[y * 7 + x] = 255
const inside = selectionStrokeAlpha(square, 7, 7, 1, 'inside')
assert.equal(inside[3 * 7 + 2], 255)
assert.equal(inside[3 * 7 + 3], 0, '1px inside stroke keeps the interior empty')
assert.equal(inside[3 * 7 + 1], 0)
const outside = selectionStrokeAlpha(square, 7, 7, 1, 'outside')
assert.equal(outside[3 * 7 + 1], 255)
assert.equal(outside[3 * 7 + 2], 0)
assert.equal(outside[0], 0)
const center = selectionStrokeAlpha(square, 7, 7, 1, 'center')
assert.ok(center[3 * 7 + 1] >= 125 && center[3 * 7 + 1] <= 130)
assert.ok(center[3 * 7 + 2] >= 125 && center[3 * 7 + 2] <= 130)
assert.equal(center[3 * 7 + 3], 0)
const full = new Uint8ClampedArray(49).fill(255)
assert.equal(selectionStrokeAlpha(full, 7, 7, 1, 'inside')[0], 255, 'canvas edge acts as boundary')
assert.equal(selectionStrokeAlpha(full, 7, 7, 1, 'inside')[24], 0)
const feather = new Uint8ClampedArray(9)
feather[4] = 128
assert.equal(selectionStrokeAlpha(feather, 3, 3, 1, 'inside')[4], 128)
const img = { width: 7, height: 7, data: new Uint8ClampedArray(49 * 4) } as ImageData
for (let i = 0; i < 49; i++) img.data[i * 4 + 3] = square[i]
renderSelectionStroke(img, { width: 1, placement: 'outside', color: '#2266aa', opacity: 50 })
assert.deepEqual([...img.data.slice((3 * 7 + 1) * 4, (3 * 7 + 2) * 4)], [34, 102, 170, 128])
assert.equal(img.data[(3 * 7 + 2) * 4 + 3], 0)
assert.equal(square[3 * 7 + 1], 0)
assert.throws(() => selectionStrokeAlpha(square, 7, 7, 0, 'inside'), /width/)
assert.throws(() => selectionStrokeAlpha(square, 7, 6, 1, 'inside'), /document-sized/)
assert.throws(() => renderSelectionStroke(img, { width: 1, placement: 'outside', color: '#ggffff', opacity: 100 }), /color/)
console.log('Stroke Selection: placement, feather, canvas edges, opacity and validation passed')
