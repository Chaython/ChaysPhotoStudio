import assert from 'node:assert/strict'
import { MAX_ARTBOARDS, artboardCrop, buildArtboardRolloverHtml, gridArtboards, layersForArtboard, normalizeArtboardLayerIds, normalizeArtboardRollover, normalizeArtboards, scaleArtboards, translateArtboards } from '../src/editor/artboards'

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


const moved = translateArtboards([first], 100, 80, 4, 7, 110, 90)
assert.deepEqual([moved[0].x, moved[0].y, moved[0].width, moved[0].height], [5, 9, 20, 10])
const cropped = translateArtboards([first], 100, 80, -10, -8, 80, 60)
assert.deepEqual([cropped[0]?.x, cropped[0]?.y, cropped[0]?.width, cropped[0]?.height], [0, 0, 11, 4])
const removed = translateArtboards([first], 100, 80, -80, 0, 20, 80)
assert.equal(removed.length, 0)
const resized = scaleArtboards(gridArtboards(101, 71, 2, 1, (() => { let i=0;return () => String(++i) })()), 101, 71, 202, 142)
assert.deepEqual(resized.map(a => [a.x, a.width, a.height]), [[0, 100, 142], [100, 102, 142]])
assert.equal(scaleArtboards([first], 100, 80, 0, 40).length, 0)

const layers = [{ id: 'bottom', name: 'Background' }, { id: 'middle' }, { id: 'top' }]
const defaultBoard = { ...first, visibleLayerIds: undefined }
assert.deepEqual(layersForArtboard(layers, defaultBoard), layers)
assert.notEqual(layersForArtboard(layers, defaultBoard), layers, 'returned layer array is detached')
assert.deepEqual(layersForArtboard(layers, { ...first, visibleLayerIds: [] }), [])
assert.deepEqual(layersForArtboard(layers, { ...first, visibleLayerIds: ['top', 'bottom'] }).map(l => l.id), ['bottom','top'],
  'filtered layers must retain original compositing stack order')
assert.deepEqual(normalizeArtboardLayerIds(['top','top','missing',12,'']), ['top','missing'])
assert.equal(normalizeArtboardLayerIds('top'), undefined)
const explicitlyEmpty = normalizeArtboards([{ ...first, visibleLayerIds: [] }], 100, 80)
assert.deepEqual(explicitlyEmpty[0].visibleLayerIds, [], 'empty means blank, not default-all')
const legacy = normalizeArtboards([first], 100, 80)
assert.equal(legacy[0].visibleLayerIds, undefined, 'legacy projects must export all layers')
const scoped = normalizeArtboards([{ ...first, visibleLayerIds: ['top', 'middle'] }], 100, 80)
assert.deepEqual(scoped[0].visibleLayerIds, ['top','middle'])
assert.deepEqual(scaleArtboards(scoped, 100, 80, 200, 160)[0].visibleLayerIds, ['top','middle'])
assert.deepEqual(translateArtboards(scoped, 100, 80, 2, 1, 105, 85)[0].visibleLayerIds, ['top','middle'])

assert.deepEqual(normalizeArtboardRollover({
  normalCompId: 'normal', hoverCompId: 'hover', pressedCompId: 4,
}), { normalCompId: 'normal', hoverCompId: 'hover' })
assert.equal(normalizeArtboardRollover({ hoverCompId: ' ' .repeat(101) }), undefined)
const withRollover = normalizeArtboards([{ ...first, rollover: { hoverCompId: 'hover' } }], 100, 80)
assert.deepEqual(withRollover[0].rollover, { hoverCompId: 'hover' })
assert.deepEqual(scaleArtboards(withRollover, 100, 80, 200, 160)[0].rollover, { hoverCompId: 'hover' })
const html = buildArtboardRolloverHtml('Press <this> & "that"', 40, 20, {
  normal: 'default image.png', hover: 'hover & image.png', pressed: 'pressed.png',
})
assert.match(html, /<button class="rollover" type="button"/)
assert.match(html, /aria-label="Press &lt;this&gt; &amp; &quot;that&quot; interactive states"/)
assert.match(html, /background-image:url\("default%20image.png"\)/)
assert.match(html, /background-image:url\("hover%20%26%20image.png"\)/)
assert.match(html, /\.rollover:hover, \.rollover:focus-visible/)
assert.match(html, /\.rollover:active/)
assert.doesNotMatch(html, /<script/i)
const injected = buildArtboardRolloverHtml('<script>alert(1)</script>', 8, 8, {
  normal: '</style><script>alert(1)</script>.png',
})
assert.doesNotMatch(injected, /<script/i)
assert.doesNotMatch(injected, /<\/style><script/i)
assert.doesNotMatch(injected, /\.rollover:hover/)
assert.throws(() => buildArtboardRolloverHtml('bad', 0, 3, { normal: 'a.png' }), /Invalid artboard dimensions/)

console.log('Artboard geometry, independent layers, rollover HTML safety and crop bounds validated')
