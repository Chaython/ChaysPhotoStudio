import { strict as assert } from 'node:assert'
import { findWebRegion, moveRegionRect, rectChanged, regionFromDrag, regionPoint, resizeRegionRect } from '../src/editor/tools/web-region-geometry'
import { MAX_WEB_REGIONS, normalizeWebRegions, type WebRegion } from '../src/editor/web-assets'

const rect = regionFromDrag({x:75,y:70},{x:20,y:15},100,90)
assert.deepEqual(rect, {x:20,y:15,width:56,height:56}, 'reverse dragging must normalize')
const clipped = regionFromDrag({x:95,y:80},{x:200,y:300},100,90)
assert.deepEqual(clipped,{x:95,y:80,width:5,height:10},'drawing must clamp to document')
assert.deepEqual(regionPoint(-500,Infinity,100,90),{x:0,y:0},'out-of-range clicks must be bounded')
assert.deepEqual(moveRegionRect({x:85,y:50,width:15,height:20},80,80,100,90),
  {x:85,y:70,width:15,height:20},'move must retain size inside document')
assert.deepEqual(resizeRegionRect({x:20,y:20,width:15,height:10},{x:60,y:50},100,90),
  {x:20,y:20,width:41,height:31},'resize should preserve top-left anchor')
assert.deepEqual(resizeRegionRect({x:20,y:20,width:15,height:10},{x:60,y:50},100,90,true),
  {x:20,y:20,width:41,height:41},'shift-resize must constrain square')
assert(!rectChanged(rect, {...rect}), 'unchanged region should not dirty document')
assert(rectChanged(rect, {...rect, x:rect.x+1}), 'moved region must be detected')
const regions: WebRegion[] = [
  {id:'one',kind:'slice',name:'first',x:10,y:10,width:40,height:40},
  {id:'two',kind:'hotspot',name:'second',x:20,y:20,width:20,height:20},
]
assert.equal(findWebRegion(regions,25,25)?.id,'two','topmost overlapped region must be selectable')
assert.equal(findWebRegion(regions,50,50),null,'rectangle end coords are exclusive')
const normalized = normalizeWebRegions(regions,100,100)
assert.equal(normalized.length,2)
assert.equal(MAX_WEB_REGIONS,128,'guard against unbounded region count changing unnoticed')
console.log('Validated Slice and Hotspot region geometry, hit tests and document limits')
