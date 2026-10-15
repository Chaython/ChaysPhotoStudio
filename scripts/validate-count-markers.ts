import { strict as assert } from 'node:assert'
import { countByGroup, MAX_COUNT_MARKERS, normalizeCountMarkers } from '../src/editor/count-markers'
import { normalizeArtboards, MAX_ARTBOARDS } from '../src/editor/artboards'
const sample=[
  {id:'a',x:12,y:16,group:'1'},
  {id:'b',x:18,y:21,group:'1'},
  {id:'c',x:22,y:25,group:'2'},
  {id:'c',x:20,y:20,group:'2'},
  {id:'d',x:-5,y:0,group:'1'},
  {id:'e',x:1,y:Number.NaN,group:'1'},
]
const markers=normalizeCountMarkers(sample,100,80)
assert.equal(markers.length,3,'reject malformed, duplicate and out-of-bounds markers')
assert.equal(countByGroup(markers)['1'],2,'first group count')
assert.equal(countByGroup(markers)['2'],1,'second group count')
assert.equal(Object.getPrototypeOf(countByGroup(markers)),null,'group stats are prototype safe')
const items=Array.from({length:MAX_COUNT_MARKERS+40},(_,i)=>({id:'marker-'+i,x:1,y:2,group:'1'}))
assert.equal(normalizeCountMarkers(items,80,80).length,MAX_COUNT_MARKERS,'bounded marker count')
assert.deepEqual(normalizeCountMarkers(null,200,200),[])
assert.equal(normalizeCountMarkers([{id:'unsafe',x:2,y:3,group:'__proto__'}],20,20)[0].group,'1')
assert.equal(normalizeArtboards([{id:'board',name:'Page',x:10,y:10,width:20,height:30}],100,100).length,1)
assert.equal(MAX_ARTBOARDS,64)
console.log('Count annotations: numeric validation, group counts, duplication and limits passed')
