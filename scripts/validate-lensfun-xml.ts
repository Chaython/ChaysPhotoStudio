import {
  hasRequiredLensfunCoefficients,
  isSupportedLensfunModel,
  type LensfunCurve,
} from '../src/editor/formats/lensfun-xml'

let passed=0,failed=0
function check(name:string,actual:boolean,expected=true){
  if(actual===expected){passed++;console.log('PASS '+name)}
  else{failed++;console.error('FAIL '+name+' (expected '+expected+', got '+actual+')')}
}
const curve=(model:LensfunCurve['model'],values:Partial<LensfunCurve>={}):LensfunCurve=>({
  model,focal:35,...values,
})

for(const [kind,model] of [
  ['distortion','poly3'],['distortion','poly5'],['distortion','ptlens'],
  ['tca','linear'],['tca','poly3'],['vignetting','pa'],
] as const)check(kind+' accepts '+model,isSupportedLensfunModel(kind,model))
check('distortion rejects ACM',isSupportedLensfunModel('distortion','acm'),false)
check('TCA rejects distortion model',isSupportedLensfunModel('tca','poly5'),false)
check('vignetting rejects TCA model',isSupportedLensfunModel('vignetting','linear'),false)

check('poly3 distortion requires k1',hasRequiredLensfunCoefficients('distortion',curve('poly3',{k1:0.02})))
check('poly3 distortion rejects missing k1',hasRequiredLensfunCoefficients('distortion',curve('poly3')),false)
check('poly5 distortion requires k1 and k2',hasRequiredLensfunCoefficients('distortion',curve('poly5',{k1:0.01,k2:-0.002})))
check('poly5 distortion rejects missing k2',hasRequiredLensfunCoefficients('distortion',curve('poly5',{k1:0.01})),false)
check('PTLens requires a, b and c',hasRequiredLensfunCoefficients('distortion',curve('ptlens',{a:0,b:0,c:0})))
check('PTLens rejects incomplete row',hasRequiredLensfunCoefficients('distortion',curve('ptlens',{a:0,b:0})),false)
check('linear TCA requires kr and kb',hasRequiredLensfunCoefficients('tca',curve('linear',{kr:1.001,kb:0.999})))
check('linear TCA rejects missing blue scale',hasRequiredLensfunCoefficients('tca',curve('linear',{kr:1})),false)
check('poly3 TCA requires six coefficients',hasRequiredLensfunCoefficients('tca',curve('poly3',{vr:1,br:0,cr:0,vb:1,bb:0,cb:0})))
check('poly3 TCA rejects missing coefficient',hasRequiredLensfunCoefficients('tca',curve('poly3',{vr:1,br:0,cr:0,vb:1,bb:0})),false)
check('PA vignetting requires aperture, distance and k1-k3',
  hasRequiredLensfunCoefficients('vignetting',curve('pa',{aperture:4,distance:1000,k1:0.1,k2:0.01,k3:0.001})))
check('PA vignetting rejects missing distance',
  hasRequiredLensfunCoefficients('vignetting',curve('pa',{aperture:4,k1:0.1,k2:0.01,k3:0.001})),false)
check('PA vignetting rejects negative distance',
  hasRequiredLensfunCoefficients('vignetting',curve('pa',{aperture:4,distance:-1,k1:0.1,k2:0.01,k3:0.001})),false)
check('PA vignetting rejects zero aperture',
  hasRequiredLensfunCoefficients('vignetting',curve('pa',{aperture:0,distance:1000,k1:0.1,k2:0.01,k3:0.001})),false)

console.log('Lensfun XML calibration validation: '+passed+' passed, '+failed+' failed')
if(failed)process.exit(1)
