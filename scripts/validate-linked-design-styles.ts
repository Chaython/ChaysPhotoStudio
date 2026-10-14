import assert from 'node:assert/strict'
import type { Layer, PsDocument } from '../src/editor/types'
import type { BrandKit } from '../src/editor/library/design-library'
import {
  designStyleId, linkBrandStyle, normalizeLayerStyleReferences,
  normalizeLinkedDesignStyles, synchronizeLinkedBrandKit, unlinkLayerStyle,
} from '../src/editor/linked-design-styles'

const kit: BrandKit = {
  id: 'my-kit', name: 'My Kit', createdAt: 1, updatedAt: 1,
  swatches: [{ id: 'primary', name: 'Primary', color: '#AABBCC' }],
  fonts: [{ id: 'title', name: 'Title', family: 'Arial' }], logos: [],
}
const shape = {
  id: 'shape', kind: 'shape', shape: { fill: '#FFFFFF' }, text: null, _v: 1,
} as unknown as Layer
const text = {
  id: 'text', kind: 'text', text: { content: 'Hello', color: '#FFFFFF', fontFamily: 'Calibri' },
  shape: null, _v: 1,
} as unknown as Layer
const plain = {
  id: 'plain', kind: 'shape', shape: { fill: '#00FF00' }, text: null, _v: 1,
} as unknown as Layer
const doc = { id: 'doc', layers: [shape, text, plain], _epoch: 1 } as unknown as PsDocument

assert.equal(linkBrandStyle(doc, shape, kit, 'color', 'primary'), true)
assert.equal(shape.shape?.fill, '#AABBCC')
assert.equal(shape.linkedDesignStyles?.fill, designStyleId(kit, 'color', 'primary'))
assert.equal(linkBrandStyle(doc, text, kit, 'color', 'primary'), true)
assert.equal(text.text?.color, '#AABBCC')
assert.equal(doc.linkedDesignStyles?.length, 1, 'shared kit color has just one document token')
assert.equal(linkBrandStyle(doc, text, kit, 'font', 'title'), true)
assert.equal(text.text?.fontFamily, 'Arial')
assert.equal(doc.linkedDesignStyles?.length, 2)
assert.equal(linkBrandStyle(doc, shape, kit, 'font', 'title'), false)
assert.equal(linkBrandStyle(doc, plain, kit, 'color', 'unknown'), false)
assert.deepEqual(normalizeLinkedDesignStyles(doc.linkedDesignStyles), doc.linkedDesignStyles)
assert.equal(normalizeLinkedDesignStyles([{ id:'bad', kind:'color', value:'javascript:evil', sourceKitId:'ok',
  sourceItemId:'test', name:'Unsafe' }]).length, 0)
assert.equal(normalizeLayerStyleReferences({ fill:'kit-color', wrong:'other', fontFamily:42 }),
  { fill:'kit-color' })

const beforeEpoch = doc._epoch
const nextKit: BrandKit = {
  ...kit,
  swatches: [{ ...kit.swatches[0], color:'#112233', name:'Accent' }],
  fonts: [{ ...kit.fonts[0], family:'Georgia' }],
}
assert.equal(synchronizeLinkedBrandKit(doc, nextKit), 2, 'one changed color + one changed font')
assert.equal(shape.shape?.fill, '#112233')
assert.equal(text.text?.color, '#112233')
assert.equal(text.text?.fontFamily, 'Georgia')
assert.equal(plain.shape?.fill, '#00FF00', 'unlinked layer remains unaffected')
assert.ok(doc._epoch > beforeEpoch)
assert.equal(synchronizeLinkedBrandKit(doc, nextKit), 0, 'no-op kit sync must not dirty document')

assert.equal(unlinkLayerStyle(text, 'textColor'), true)
const lastColor = text.text!.color
const further: BrandKit = { ...nextKit, swatches:[{...nextKit.swatches[0],color:'#FF0000'}] }
assert.equal(synchronizeLinkedBrandKit(doc, further), 1)
assert.equal(shape.shape?.fill, '#FF0000')
assert.equal(text.text?.color, lastColor, 'unlinked text appearance is retained')
assert.equal(text.text?.fontFamily, 'Georgia')
assert.equal(unlinkLayerStyle(text, 'textColor'), false)
const removed: BrandKit = { ...further, swatches:[], fonts:[] }
assert.equal(synchronizeLinkedBrandKit(doc, removed), 0)
assert.equal(shape.shape?.fill, '#FF0000', 'missing kit colors retain the last embedded value')
assert.equal(normalizeLinkedDesignStyles([{ id:'a',kind:'font',value:'Arial',name:'Label',
  sourceKitId:'one',sourceItemId:'x' },{ id:'a',kind:'font',value:'Helvetica',
    name:'Duplicate',sourceKitId:'one',sourceItemId:'x' }]).length, 1)
console.log('Linked brand styles: assignment, shared tokens, propagation, unlink, fallback and validation passed')
