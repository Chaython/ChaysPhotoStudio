import { getBlurGalleryPreviewPoint } from '../src/editor/utils/blur-gallery-preview'
import { findBlurGalleryPin, moveBlurGalleryPin, removeBlurGalleryPin, type BlurGalleryPin, type BlurGalleryPointerPoint } from '../src/editor/utils/blur-gallery-interaction'

let passed=0,failed=0
function check(name:string,actual:unknown,expected:unknown){
  const equal=JSON.stringify(actual)===JSON.stringify(expected)
  if(equal){passed++;console.log('PASS '+name)}else{failed++;console.error('FAIL '+name+' expected '+JSON.stringify(expected)+' got '+JSON.stringify(actual))}
}
const pins:BlurGalleryPin[]=[{x:.2,y:.3,radius:12},{x:.7,y:.6,radius:24},{x:.9,y:.9,radius:8}]
const point:BlurGalleryPointerPoint={x:.705,y:.605,width:680,height:430}
check('selects the nearest pin within hit radius',findBlurGalleryPin(pins,point),1)
check('does not select a pin outside hit radius',findBlurGalleryPin(pins,{...point,x:.45,y:.45}),-1)
check('adds no accidental hit when pin list is empty',findBlurGalleryPin([],point),-1)
check('rejects invalid pointer geometry for hit testing',findBlurGalleryPin(pins,{...point,width:0}),-1)
check('ignores malformed pin coordinates',findBlurGalleryPin([{x:NaN,y:.5,radius:4}],point),-1)
const moved=moveBlurGalleryPin(pins,1,{...point,x:.4,y:.5})
check('moves only the selected pin',moved,[pins[0],{x:.4,y:.5,radius:24},pins[2]])
check('preserves blur strength when moving a pin',moved[1].radius,24)
check('invalid move leaves original pins untouched',moveBlurGalleryPin(pins,-1,point),pins)
check('non-finite move leaves original pins untouched',moveBlurGalleryPin(pins,1,{...point,x:NaN}),pins)
check('move clamps normalized coordinates to image bounds',moveBlurGalleryPin(pins,0,{...point,x:2,y:-1}),[{x:1,y:0,radius:12},pins[1],pins[2]])
const removed=removeBlurGalleryPin(pins,1)
check('removes selected pin',removed.pins,[pins[0],pins[2]])
check('selects previous remaining pin after removal',removed.selectedIndex,0)
const firstRemoved=removeBlurGalleryPin(pins,0)
check('removing first pin selects new first pin',firstRemoved.selectedIndex,0)
const lastRemoved=removeBlurGalleryPin(pins,2)
check('removing last pin selects previous pin',lastRemoved.selectedIndex,1)
const allRemoved=removeBlurGalleryPin(pins.slice(0,1),0)
check('empty pin list resets selection index',allRemoved.selectedIndex,0)
check('invalid removal does not change pin collection',removeBlurGalleryPin(pins,9).pins,pins)
check('non-finite removal does not accidentally delete a pin',removeBlurGalleryPin(pins,NaN).pins,pins)
const bounds={left:100,top:50,width:680,height:430}
const center=getBlurGalleryPreviewPoint(440,265,bounds,640,400,680,430)
check('maps preview center to image center',center?{x:center.x,y:center.y}:{x:null,y:null},{x:.5,y:.5})
check('rejects pointer in letterboxed margin',getBlurGalleryPreviewPoint(105,265,bounds,640,400,680,430),null)
const left=getBlurGalleryPreviewPoint(100,265,bounds,640,400,680,430,true)
check('clamps captured drag to left image edge',left?{x:left.x,y:left.y}:{x:null,y:null},{x:0,y:.5})
const right=getBlurGalleryPreviewPoint(900,265,bounds,640,400,680,430,true)
check('clamps captured drag to right image edge',right?{x:right.x,y:right.y}:{x:null,y:null},{x:1,y:.5})
const top=getBlurGalleryPreviewPoint(440,0,bounds,640,400,680,430,true)
check('clamps captured drag to top image edge',top?{x:top.x,y:top.y}:{x:null,y:null},{x:.5,y:0})
check('rejects zero-sized preview bounds',getBlurGalleryPreviewPoint(1,1,{...bounds,width:0},640,400,680,430),null)
check('rejects invalid source dimensions',getBlurGalleryPreviewPoint(1,1,bounds,0,400,680,430),null)
console.log('Blur Gallery interactions and pointer geometry: '+passed+' passed, '+failed+' failed')
if(failed)process.exit(1)
