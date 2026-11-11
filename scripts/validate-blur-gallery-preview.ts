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
const moved=moveBlurGalleryPin(pins,1,{...point,x:.4,y:.5})
check('moves only the selected pin',moved,[pins[0],{x:.4,y:.5,radius:24},pins[2]])
check('preserves blur strength when moving a pin',moved[1].radius,24)
check('invalid move leaves original pins untouched',moveBlurGalleryPin(pins,-1,point),pins)
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
console.log('Blur Gallery pin interactions: '+passed+' passed, '+failed+' failed')
if(failed)process.exit(1)
