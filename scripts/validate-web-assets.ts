import assert from 'node:assert/strict'
import { buildImageMapHtml, normalizeWebRegions, webSafeHref, fileStem } from '../src/editor/web-assets'

const sample = [
  { id: 's1', kind: 'slice', name: 'Logo', x: 3, y: 4, width: 12, height: 10 },
  { id: 'h1', kind: 'hotspot', name: '<Contact>', x: 22, y: 20, width: 30, height: 20,
    href: 'https://example.com/?a=1&b=2', alt: 'Say "hello"', target: '_blank' },
]
assert.equal(normalizeWebRegions(sample, 100, 60).length, 2)
assert.equal(normalizeWebRegions([{ ...sample[0], x: 92, width: 30 }], 100, 60)[0].width, 8)
assert.equal(normalizeWebRegions([{ ...sample[0], x: 101 }], 100, 60).length, 0)
assert.equal(normalizeWebRegions([{ ...sample[0], width: 0 }], 100, 60).length, 0)
assert.equal(normalizeWebRegions([{ ...sample[0], width: 2.5 }], 100, 60).length, 0)
assert.equal(normalizeWebRegions([sample[0], sample[0]], 100, 60).length, 1)
assert.equal(normalizeWebRegions(Array(150).fill(null).map((_, i) => ({ ...sample[0], id: String(i) })), 100, 60).length, 128)
assert.equal(webSafeHref('javascript:alert(1)'), '')
assert.equal(webSafeHref('data:text/html,test'), '')
assert.equal(webSafeHref('java\nscript:foo'), '')
assert.equal(webSafeHref('//evil.example'), '')
assert.equal(webSafeHref('https://example.com/path'), 'https://example.com/path')
assert.equal(webSafeHref('#section'), '#section')
assert.equal(fileStem('nice/photo.jpg'), 'nice-photo')
const html = buildImageMapHtml('photo"evil.png', 100, 60, sample)
assert.match(html, /src="photo&quot;evil.png"/)
assert.match(html, /coords="22,20,52,40"/)
assert.match(html, /alt="Say &quot;hello&quot;"/)
assert.match(html, /href="https:\/\/example.com\/\?a=1&amp;b=2"/)
assert.match(html, /rel="noopener noreferrer"/)
assert.doesNotMatch(html, /coords="3,4,15,14"/)
const unsafe = buildImageMapHtml('full.png', 100, 60, [{ ...sample[1], href: 'javascript:alert(1)' }])
assert.doesNotMatch(unsafe, /<area/)
assert.doesNotMatch(unsafe, /usemap/)
console.log('Web slice/hotspot geometry, safe URL rules, HTML escaping and image-map output verified')
