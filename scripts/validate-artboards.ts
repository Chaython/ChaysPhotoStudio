import assert from 'node:assert/strict'
import { MAX_ARTBOARDS, artboardCrop, gridArtboards, normalizeArtboards } from '../src/editor/artboards'

const first = { id: 'a', name: ' Page A ', x: 1, y: 2, width: 20, height: 10 }
assert.deepEqual(normalizeArtboards([first], 100, 80), [{ ...first, name: 'Page A' }])
assert.equal(normalizeArtboards([first, first], 100, 80).length, 1, 'duplicate ids skipped')
assert.equal(normalizeArtboards([{ ...first, id: '' }], 100, 80).length, 0)
assert.equal(normalizeArtboards([{ ...first, width: 0 }], 100, 80).length, 0)
assert.equal(normalizeArtboards([{ ...first, x: 100 }], 100, 80).length, 0)
assert.equal(normalizeArtboards([{ ...first, width: Infinity }], 100, 80).length, 0)
assert.equal(normalizeArtboards([{ ...first, width: '25' }], 100, 80).length, 0)
assert.equal(normalizeArtboards([{ ...first, name: ' ' }], 100, 80).length, 0)

const clipped = normalizeArtboards([{ ...first, x: -5, y: -4, width: 9, height: 8 }], 100, 80)[0]
assert.deepEqual([clipped.x, clipped.y, clipped.width, clipped.height], [0, 0, 4, 4],
  'clipping must not expand an off-canvas rectangle')
assert.deepEqual(artboardCrop({ ...first, x: 99, y: 79, width: 20, height: 10 }, 100, 80),
  { sx: 99, sy: 79, sw: 1, sh: 1 })
assert.equal(artboardCrop({ ...first, x: 150 }, 100, 80), null)
const split = gridArtboards(101, 71, 3, 2, (() => { let id = 0; return () => String(++id) })())
assert.equal(split.length, 6)
assert.equal(new Set(split.map(a => a.id)).size, 6)
assert.equal(split.reduce((sum, a) => sum + a.width * a.height, 0), 101 * 71)
for (let i = 0; i < 101; i++) for (let j = 0; j < 71; j++) {
  assert.equal(split.filter(a => i >= a.x && i < a.x + a.width && j >= a.y && j < a.y + a.height).length, 1)
}
assert.equal(gridArtboards(1, 10, 2, 1, () => 'x').length, 0)
assert.equal(gridArtboards(100, 100, 9, 8, () => 'x').length, 0)
assert.equal(normalizeArtboards(Array.from({ length: MAX_ARTBOARDS + 8 }, (_, i) => ({ ...first, id: String(i) })), 100, 80).length, MAX_ARTBOARDS)
assert.equal(normalizeArtboards([{ ...first, x: NaN }], 100, 80).length, 0)

console.log('Artboard geometry, grids, project normalization and crop safety validated')
