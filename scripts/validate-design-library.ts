import assert from 'node:assert/strict'
import {
  MAX_TEMPLATE_BYTES, normalizeHex, normalizeTemplate, normalizeBrandKit,
  parseTemplateFile, parseBrandKitFile, safeDesignFilename,
} from '../src/editor/library/design-library'

const project = JSON.stringify({
  format: 'z-photo-project', version: 5,
  doc: { name: 'Test', width: 640, height: 480 },
  layers: [{ props: { id: 'layer-1', kind: 'text', name: 'Title' } }],
})
const template = normalizeTemplate({
  id: 'template-1', name: ' Social \n Poster ', category: 'Social', createdAt: 1, updatedAt: 2,
  projectJson: project, thumbnail: 'data:image/jpeg;base64,AA==',
})
assert.equal(template.name, 'Social   Poster')
assert.equal(template.width, 640)
assert.equal(template.height, 480)
assert.equal(template.projectJson, project, 'editable layer project JSON must remain intact')
assert.deepEqual(parseTemplateFile({ format: 'chays-design-template', version: 1, entry: template }), template)
assert.throws(() => parseTemplateFile({ format: 'z-photo-project', doc: {} }), /Unsupported template/)
assert.throws(() => normalizeTemplate({ ...template, projectJson: '{"format":"wrong"}' }), /editable/)
assert.throws(() => normalizeTemplate({ ...template, projectJson: JSON.stringify({format:'z-photo-project',doc:{width:99999,height:80},layers:[]}) }), /dimensions/)
assert.throws(() => normalizeTemplate({ ...template, projectJson: JSON.stringify({format:'z-photo-project',doc:{width:80,height:80},layers:Array(501).fill({})}) }), /layer count/)
assert.throws(() => normalizeTemplate({ ...template, projectJson: 'x'.repeat(MAX_TEMPLATE_BYTES + 1) }), /exceeds/)
assert.throws(() => normalizeTemplate({ ...template, id: 'bad/id' }), /Invalid design library/)
assert.equal(normalizeHex('#abc'), '#AABBCC')
assert.equal(normalizeHex('#0055ff'), '#0055FF')
assert.equal(normalizeHex('url(javascript:alert(1))'), null)
assert.equal(normalizeHex('#ffff'), null)
assert.equal(safeDesignFilename('../../<evil>\\paper?'), 'evil--paper-')

const kit = normalizeBrandKit({
  id: 'brand1', name: 'My brand',
  swatches: [{id:'sw1',name:'Primary',color:'#abc'}, {id:'sw1',color:'#fff'}, {id:'bad',color:'red'}],
  fonts: [{id:'font1',name:'Heading',family:'Arial'}, {id:'font1',family:'Monaco'}],
  logos: [
    {id:'logo1',name:'Logo',dataUrl:'data:image/png;base64,AA=='},
    {id:'logo2',name:'bad',dataUrl:'data:image/svg+xml;base64,AA=='},
    {id:'logo3',name:'bad',dataUrl:'data:image/png;base64,<script>'},
  ],
})
assert.equal(kit.swatches.length, 1)
assert.equal(kit.swatches[0].color, '#AABBCC')
assert.equal(kit.fonts.length, 1)
assert.equal(kit.logos.length, 1)
assert.deepEqual(parseBrandKitFile({ format:'chays-brand-kit', version:1, kit }), kit)
assert.throws(() => parseBrandKitFile({ format:'chays-brand-kit', version: 2, kit }), /Unsupported/)
assert.equal(normalizeBrandKit({ ...kit, logos: [{ id:'logo1', name:'bad', dataUrl:'data:image/svg+xml;base64,AA==' }] }).logos.length, 0)
assert.equal(normalizeBrandKit({ ...kit, swatches: Array.from({length:50},(_,i)=>({id:'s'+i,name:'color',color:'#AABBCC'})) }).swatches.length, 32)
console.log('Validated native editable design templates, bounded imports, brand palettes, fonts and logo safety')
