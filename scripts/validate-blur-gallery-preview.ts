import { getBlurGalleryPreviewPoint } from '../src/editor/utils/blur-gallery-preview'

let passed=0,failed=0
function check(name:string,actual:unknown,expected:unknown){
  const equal=JSON.stringify(actual)===JSON.stringify(expected)
  if(equal){passed++;console.log('PASS '+name)}else{failed++;console.error('FAIL '+name+' expected '+JSON.stringify(expected)+' got '+JSON.stringify(actual))}
}
const bounds={left:100,top:50,width:680,height:430}
const center=getBlurGalleryPreviewPoint(440,265,bounds,640,400,680,430)
check('maps preview center to image center',center?{x:center.x,y:center.y}:{x:null,y:null},{x:0.5,y:0.5})
check('rejects pointer in letterboxed margin',getBlurGalleryPreviewPoint(105,265,bounds,640,400,680,430),null)
const left=getBlurGalleryPreviewPoint(100,265,bounds,640,400,680,430,true)
check('clamps captured drag to left image edge',left?{x:left.x,y:left.y}:{x:null,y:null},{x:0,y:0.5})
const right=getBlurGalleryPreviewPoint(900,265,bounds,640,400,680,430,true)
check('clamps captured drag to right image edge',right?{x:right.x,y:right.y}:{x:null,y:null},{x:1,y:0.5})
const top=getBlurGalleryPreviewPoint(440,0,bounds,640,400,680,430,true)
check('clamps captured drag to top image edge',top?{x:top.x,y:top.y}:{x:null,y:null},{x:0.5,y:0})
check('rejects zero-sized preview bounds',getBlurGalleryPreviewPoint(1,1,{...bounds,width:0},640,400,680,430),null)
check('rejects invalid source dimensions',getBlurGalleryPreviewPoint(1,1,bounds,0,400,680,430),null)
console.log('Blur Gallery pointer geometry: '+passed+' passed, '+failed+' failed')
if(failed)process.exit(1)
