import { chooseLensfunCurve, type CameraExif } from '../src/editor/formats/lensfun-xml'
import { decodeFits } from '../src/editor/formats/scientific-fits'
import { decodeDicom } from '../src/editor/formats/scientific-dicom'
import { decodeExr, decodeExrParts } from '../src/editor/formats/openexr'
import { applyLensProfile } from '../src/editor/formats/lens-correction'
import { applyRawTone, normalizeRawTone } from '../src/editor/formats/raw-tone'
import { applyRawCurves, evaluateRawCurve, normalizeRawCurves, DEFAULT_RAW_CURVES } from '../src/editor/formats/raw-curves'
import { applyRawLocalMasks, rawMaskCoverage, normalizeRawLocalMasks, makeRawLocalMask } from '../src/editor/formats/raw-local-masks'
import { applyRawColorMix, normalizeRawColorMix, DEFAULT_RAW_COLOR_MIX } from '../src/editor/formats/raw-color-mix'
import { downsampleRawPreview, rawPreviewHistogram } from '../src/editor/formats/raw-preview'
import { detectFormat, decodeTiff, tiffPageOffsets, decodePcx, dcxPageOffsets } from '../src/editor/formats/decoders'
function check(v:unknown,description:string) { if(!v)throw new Error(description) }
const enc=new TextEncoder()
check(detectFormat(Uint8Array.from([0x42,0x50,0x47,0xfb,0]))==='bpg','BPG magic detection never routes to a generic image fallback')
function fitCard(key:string,val?:string):Uint8Array {
  return enc.encode((key.padEnd(8,' ')+(val===undefined?'':'= '+val.padStart(20,' '))).padEnd(80,' '))
}
const fits=new Uint8Array(2880+4)
fits.set(fitCard('SIMPLE','T'),0)
fits.set(fitCard('BITPIX','16'),80)
fits.set(fitCard('NAXIS','2'),160)
fits.set(fitCard('NAXIS1','2'),240)
fits.set(fitCard('NAXIS2','1'),320)
fits.set(fitCard('END'),400)
const fv=new DataView(fits.buffer)
fv.setInt16(2880,100,false);fv.setInt16(2882,200,false)
const f=decodeFits(fits)
check(f.image.width===2 && f.image.height===1,'FITS dimensions')
check(f.image.rgba[0]===0 && f.image.rgba[4]===255,'FITS contrast stretch')

// Uncompressed explicit little-endian DICOM with two grayscale pixels.
const pieces:number[]=[...new Uint8Array(128),...enc.encode('DICM')]
function word(n:number){pieces.push(n&255,(n>>>8)&255)}
function dword(n:number){word(n&0xffff);word(n>>>16)}
function dicomElement(group:number,tag:number,vr:string,data:number[]){
  word(group);word(tag);pieces.push(...enc.encode(vr))
  if(['OB','OW','SQ','UN','UT'].includes(vr)){word(0);dword(data.length)}
  else word(data.length)
  pieces.push(...data)
}
const number16=(n:number)=>[n&255,n>>>8]
const ts=Array.from(enc.encode('1.2.840.10008.1.2.1\0'))
dicomElement(2,0x10,'UI',ts)
dicomElement(0x28,0x10,'US',number16(1)) // rows
dicomElement(0x28,0x11,'US',number16(2)) // columns
dicomElement(0x28,0x100,'US',number16(8))
dicomElement(0x28,0x101,'US',number16(8))
dicomElement(0x28,0x02,'US',number16(1))
dicomElement(0x28,0x04,'CS',Array.from(enc.encode('MONOCHROME2 ')))
dicomElement(0x7fe0,0x10,'OB',[10,240])
const d=await decodeDicom(new Uint8Array(pieces))
check(d.image.width===2 && d.image.height===1,'DICOM dimensions')
check(d.image.rgba[0]<d.image.rgba[4],'DICOM grayscale gradient')


// RLE-lossless DICOM, 2 pixels (10, 240). One fragment, no BOT offsets.
const rp:number[]=[...new Uint8Array(128),...enc.encode('DICM')]
const rw=(n:number)=>rp.push(n&255,(n>>>8)&255)
const rd=(n:number)=>{rw(n&65535);rw(n>>>16)}
const re=(g:number,t:number,vr:string,data:number[])=>{
 rw(g);rw(t);rp.push(...enc.encode(vr))
 if(['OB','OW','SQ','UN','UT'].includes(vr)){rw(0);rd(data.length)}
 else rw(data.length)
 rp.push(...data)
}
re(2,0x10,'UI',Array.from(enc.encode('1.2.840.10008.1.2.5\0')))
re(0x28,0x10,'US',number16(1))
re(0x28,0x11,'US',number16(2))
re(0x28,0x100,'US',number16(8))
re(0x28,0x101,'US',number16(8))
re(0x28,0x02,'US',number16(1))
re(0x28,0x04,'CS',Array.from(enc.encode('MONOCHROME2 ')))
rw(0x7fe0);rw(0x0010);rp.push(...enc.encode('OB'));rw(0);rd(0xffffffff)
rw(0xfffe);rw(0xe000);rd(0) // empty basic offset table
const rleBytes=new Uint8Array(68)
const rleView=new DataView(rleBytes.buffer)
rleView.setUint32(0,1,true)
rleView.setUint32(4,64,true)
rleBytes.set([1,10,240,128],64) // PackBits literal, pad to even length
rw(0xfffe);rw(0xe000);rd(rleBytes.length);rp.push(...rleBytes)
rw(0xfffe);rw(0xe0dd);rd(0)
const rleDicom=await decodeDicom(Uint8Array.from(rp))
check(rleDicom.image.width===2&&rleDicom.image.rgba[0]<rleDicom.image.rgba[4],'DICOM RLE grayscale')

// Synthetic OpenEXR 1x1, 32-bit RGB no compression.
const out:number[]=[]
function bytes(b:number[]|Uint8Array){out.push(...b)}
function u32(n:number){bytes([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255])}
function name(s:string){bytes(enc.encode(s));out.push(0)}
function attr(s:string,t:string,data:number[]){name(s);name(t);u32(data.length);bytes(data)}
const channel:number[]=[]
function addCh(nameText:string){
  channel.push(...enc.encode(nameText),0,2,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0)
}
addCh('R');addCh('G');addCh('B');channel.push(0)
u32(20000630);u32(2)
attr('channels','chlist',channel)
attr('compression','compression',[0])
attr('dataWindow','box2i',[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0])
out.push(0)
const tableOffset=out.length
for(let i=0;i<8;i++)out.push(0)
const scanlineOffset=out.length
u32(0);u32(12)
const temp=new DataView(new ArrayBuffer(12))
temp.setFloat32(0,1,true);temp.setFloat32(4,0.5,true);temp.setFloat32(8,0,true)
bytes(new Uint8Array(temp.buffer))
const ev=new DataView(Uint8Array.from(out).buffer)
ev.setBigUint64(tableOffset,BigInt(scanlineOffset),true)
const exr=await decodeExr(new Uint8Array(ev.buffer))
check(exr.width===1 && exr.height===1,'EXR dimensions')
check(exr.rgbaFloat?.[0]===1 && exr.rgbaFloat[1]===0.5,'EXR floating RGB')


// Same OpenEXR payload using the EXR RLE compression + predictor + byte shuffle.
function exrRleImage():Uint8Array{
 const base=new Uint8Array(ev.buffer)
 const header=new Uint8Array(base)
 // Rebuild a minimal RLE EXR using the existing channel/dataWindow fixtures.
 // Twelve zero bytes become [0, 128, ...128] after EXR prediction.
 // RLE: one literal zero followed by a repeated 128 run.
 const encoded:number[]=[0,0,10,128]
 // Use same prefix including attribute list, change compression attribute value.
 const bytes=Array.from(header.subarray(0,tableOffset))
 const cmp=Array.from(enc.encode('compression'))
 let at=-1
 for(let i=0;i<bytes.length-cmp.length;i++){
   if(cmp.every((value,j)=>bytes[i+j]===value)){at=i;break}
 }
 if(at<0)throw Error('EXR compression test header missing')
 bytes[at+cmp.length+1+'compression'.length+1+4]=1
 const offset=bytes.length+8
 const frame=Uint8Array.from([...bytes,...new Uint8Array(8),0,0,0,0,encoded.length,0,0,0,...encoded])
 new DataView(frame.buffer).setBigUint64(tableOffset,BigInt(offset),true)
 return frame
}
const rex=await decodeExr(exrRleImage())
check(rex.rgbaFloat?.[0]===0 && rex.rgbaFloat[1]===0,'OpenEXR RLE RGB')


// One-level, one-tile OpenEXR: same channels and pixel values as the scanline fixture.
const tiledHeader=out.slice(0,tableOffset-1)
const tileAttr=(nameText:string,typeText:string,data:number[])=>{
  tiledHeader.push(...enc.encode(nameText),0,...enc.encode(typeText),0)
  const n=data.length
  tiledHeader.push(n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255,...data)
}
tileAttr('tiles','tiledesc',[1,0,0,0,1,0,0,0,0])
tiledHeader.push(0)
const tileTable=tiledHeader.length
const tileStart=tileTable+8
const tilePayload=Array.from(new Uint8Array(temp.buffer))
const tiled=Uint8Array.from([
  ...tiledHeader,...new Uint8Array(8),
  0,0,0,0, // tile X
  0,0,0,0, // tile Y
  0,0,0,0, // level X
  0,0,0,0, // level Y
  12,0,0,0, // packed size
  ...tilePayload,
])
const tiledView=new DataView(tiled.buffer)
tiledView.setUint32(4,0x202,true)
tiledView.setBigUint64(tileTable,BigInt(tileStart),true)
const tiledExr=await decodeExr(tiled)
check(tiledExr.width===1&&tiledExr.rgbaFloat?.[0]===1&&tiledExr.rgbaFloat[1]===0.5,'OpenEXR tiled RGB')

// EXR v2 multipart: two separately named 1x1 scanline parts, each with its
// own chunk offset table and part-number-prefixed block.
const chunkCount=(n:number)=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]
const multipartHeader:number[]=[]
const appendAttr=(dest:number[],key:string,kind:string,data:number[])=>{
 dest.push(...enc.encode(key),0,...enc.encode(kind),0,...chunkCount(data.length),...data)
}
for(const label of ['Beauty','Normals']){
 appendAttr(multipartHeader,'channels','chlist',channel)
 appendAttr(multipartHeader,'compression','compression',[0])
 appendAttr(multipartHeader,'dataWindow','box2i',[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0])
 appendAttr(multipartHeader,'name','string',Array.from(enc.encode(label)))
 appendAttr(multipartHeader,'type','string',Array.from(enc.encode('scanlineimage')))
 appendAttr(multipartHeader,'chunkCount','int',chunkCount(1))
 multipartHeader.push(0)
}
multipartHeader.push(0)
const mpTable=8+multipartHeader.length
const mpPixels=Array.from(new Uint8Array(temp.buffer))
const mpChunk=(partIndex:number,data:number[])=>[...chunkCount(partIndex),0,0,0,0,12,0,0,0,...data]
const part0=mpChunk(0,mpPixels),part1=mpChunk(1,mpPixels)
const mp=Uint8Array.from([
 ...chunkCount(20000630),...chunkCount(0x1002),
 ...multipartHeader,...new Uint8Array(16),...part0,...part1
])
const mpView=new DataView(mp.buffer)
mpView.setBigUint64(mpTable,BigInt(mpTable+16),true)
mpView.setBigUint64(mpTable+8,BigInt(mpTable+16+part0.length),true)
const decodedParts=await decodeExrParts(mp)
check(decodedParts.length===2 && decodedParts[0].name==='Beauty' && decodedParts[1].name==='Normals',
  'EXR multipart part labels')
check(decodedParts.every(p=>p.image.rgbaFloat?.[0]===1 && p.image.rgbaFloat[1]===0.5),
  'EXR multipart floating pixels')
try{
 await decodeExr(mp)
 throw Error('Single-image EXR entrypoint must not discard extra parts')
}catch(err){
 check(err instanceof Error && err.message.includes('multiple parts'), 'Multipart EXR must not silently discard parts')
}

// A lossless 16-bit correction path must preserve bit depth and input data.
const sample16=new Uint16Array(5*5*4)
const sample8=new Uint8ClampedArray(5*5*4)
for(let pixel=0;pixel<25;pixel++)for(let c=0;c<4;c++){
  sample16[pixel*4+c]=c===3?65535:pixel*500+c*100
  sample8[pixel*4+c]=Math.round(sample16[pixel*4+c]/257)
}
const original16=sample16.slice()
const corrected=applyLensProfile({
  width:5,height:5,rgba:sample8 as Uint8ClampedArray<ArrayBuffer>,rgba16:sample16,sourceBitDepth:16,
},{name:'Test profile',k1:0.1,k2:-0.03,tca:0.005,vignette:0.1})
check(corrected.sourceBitDepth===16 && corrected.rgba16?.length===sample16.length,'Lens 16-bit preservation')
check(sample16.every((value,i)=>value===original16[i]),'Lens source samples must not mutate')
check(corrected.rgba16?.[12*4]===sample16[12*4],'Lens optical center stays fixed')


const rawToneSample = {width:3,height:1,sourceBitDepth:16,rgba:new Uint8ClampedArray([
  48,48,48,255, 128,110,96,255, 210,210,210,255
]) as Uint8ClampedArray<ArrayBuffer>,rgba16:Uint16Array.from([
  12336,12336,12336,65535, 32896,28270,24672,65535, 53970,53970,53970,65535
])}
const originalToneBytes = rawToneSample.rgba16.slice()
check(applyRawTone(rawToneSample,{}).rgba16===rawToneSample.rgba16,'Neutral RAW develop must be an identity operation')
const shadowTone=applyRawTone(rawToneSample,{shadows:60})
check(shadowTone.rgba16![0]>rawToneSample.rgba16[0],'Shadow control must lift dark pixels')
const contrastTone=applyRawTone(rawToneSample,{contrast:60})
check(contrastTone.rgba16![0]<rawToneSample.rgba16[0],'Contrast should darken shadow pixels')
const colorTone=applyRawTone(rawToneSample,{temperature:80,vibrance:40})
check(colorTone.rgba16![4]>colorTone.rgba16![6],'Warmth should increase red relative to blue')
check(rawToneSample.rgba16.every((v,i)=>v===originalToneBytes[i]),'RAW source samples must remain unchanged')
check(colorTone.rgba16![3]===65535 && colorTone.rgba16![7]===65535,'RAW alpha must not receive tonal changes')
check(normalizeRawTone({contrast:Number.POSITIVE_INFINITY, saturation:400}).contrast===0,'Invalid RAW tone input must normalize')
check(normalizeRawTone({saturation:400}).saturation===100,'RAW tone must enforce control range')

// RAW tone curves: independent composite and RGB 16-bit LUTs, older recipes,
// safe endpoints, alpha, neutral identity, and conservative input normalization.
const neutralCurve=applyRawCurves(rawToneSample,DEFAULT_RAW_CURVES)
check(neutralCurve===rawToneSample && neutralCurve.rgba16===rawToneSample.rgba16,
  'Neutral RAW point curves must be a zero-allocation identity')
check(evaluateRawCurve([0,25,50,75,100],0.125)===0.125,
  'Identity point curve must preserve values between knots')
check(Math.abs(evaluateRawCurve([0,20,50,85,100],0.5)-0.5)<1e-8,
  'Midpoint curve hits its authored knot')
check(evaluateRawCurve([0,20,50,85,100],0.75)===0.85,
  'Point curve reaches the authored highlight knot')
const brightCurve=normalizeRawCurves({rgb:[0,35,60,86,100]})
const developedCurve=applyRawCurves(rawToneSample,brightCurve)
check(developedCurve.rgba16![0]>rawToneSample.rgba16[0] &&
  developedCurve.rgba16![8]>rawToneSample.rgba16[8],
  'RGB point curve lifts highlights and shadow values in 16-bit buffer')
check(developedCurve.rgba16![3]===65535 &&
  rawToneSample.rgba16.every((v,i)=>v===originalToneBytes[i]),
  'RAW curves keep alpha and original sensor samples untouched')
const redOnly=applyRawCurves(rawToneSample,{red:[0,30,60,80,100]})
check(redOnly.rgba16![4]>rawToneSample.rgba16[4] &&
  Math.abs(redOnly.rgba16![5]-rawToneSample.rgba16[5])<=1 &&
  Math.abs(redOnly.rgba16![6]-rawToneSample.rgba16[6])<=1,
  'Per-channel red curve changes red without altering green/blue')
check(normalizeRawCurves(undefined).blue[2]===50 &&
  normalizeRawCurves({rgb:[-100,25,Infinity,99,250]}).rgb.join(',')==='0,25,50,99,100',
  'Missing and corrupt curve recipes default safely')
const invertedCurve=normalizeRawCurves({rgb:[100,75,50,25,0]})
check(evaluateRawCurve(invertedCurve.rgb,0)===1 &&
  evaluateRawCurve(invertedCurve.rgb,1)===0,
  'Creative inverted curves stay inside bounds with valid endpoints')
const eightBitCurve=applyRawCurves({
  width:1,height:1,rgba:new Uint8ClampedArray([128,64,32,192]) as Uint8ClampedArray<ArrayBuffer>,
  sourceBitDepth:8,
},{rgb:[0,40,60,80,100]})
check(eightBitCurve.rgba[0]>128 && eightBitCurve.rgba[3]===192 && !eightBitCurve.rgba16,
  'Display-only 8-bit fallback does not invent source precision')

const correctedLensfun=applyLensProfile({
  width:5,height:5,rgba:sample8 as Uint8ClampedArray<ArrayBuffer>,rgba16:sample16,sourceBitDepth:16,
},{
  name:'Example calibrated lens',k1:0,k2:0,tca:0,vignette:0,
  lensfun:{source:'lensfun-xml',maker:'Example',lens:'50 mm',crop:1,focal:50,
    distortion:{model:'poly3',focal:50,k1:0.02},
    tca:{model:'poly3',focal:50,vr:1.001,vb:0.999,br:0.001,bb:-0.001},
    vignetting:{model:'pa',focal:50,k1:-0.2,k2:0.1,k3:-0.02}
  }
})
check(correctedLensfun.rgba16?.length===sample16.length && correctedLensfun.sourceBitDepth===16,
  'Lensfun-calibrated RAW remap retains 16-bit geometry')
check(sample16.every((v,i)=>v===original16[i]),'Lensfun correction does not mutate RAW samples')

// Color Mixer: true 16-bit output, neutral identity, hue bands, safe alpha.
const mixSample={width:3,height:1,sourceBitDepth:16,
  rgba:new Uint8ClampedArray([255,0,0,255,0,0,255,255,128,128,128,255]) as Uint8ClampedArray<ArrayBuffer>,
  rgba16:Uint16Array.from([65535,0,0,65535,0,0,65535,65535,32768,32768,32768,65535])}
const mixOriginal=mixSample.rgba16.slice()
check(applyRawColorMix(mixSample,{}).rgba16===mixSample.rgba16,'Neutral HSL Color Mix is no-op')
const desaturated=applyRawColorMix(mixSample,{red:{hue:0,saturation:-100,luminance:0}})
check(desaturated.rgba16 && Math.abs(desaturated.rgba16[0]-desaturated.rgba16[1])<2 &&
  Math.abs(desaturated.rgba16[1]-desaturated.rgba16[2])<2,'Red saturation -100 removes chroma')
check(desaturated.rgba16![4]===0 && desaturated.rgba16![6]===65535,'Red mix does not change unrelated blue')
const mixedHue=applyRawColorMix(mixSample,{blue:{hue:-100,saturation:0,luminance:30}})
check(mixedHue.rgba16![4]!==mixOriginal[4]||mixedHue.rgba16![5]!==mixOriginal[5],
  'Blue hue/luminance controls edit matching blue')
check(mixedHue.rgba16![8]===32768 && mixedHue.rgba16![9]===32768,'Color Mixer does not tint neutrals')
check(mixSample.rgba16.every((v,i)=>v===mixOriginal[i]),'Color Mixer keeps original 16-bit samples')
check(mixedHue.rgba16![7]===65535,'Color Mixer alpha preservation')
check(normalizeRawColorMix({red:{hue:500,saturation:Number.NaN,luminance:-300}}).red.hue===100 &&
  normalizeRawColorMix({red:{hue:500,saturation:Number.NaN,luminance:-300}}).red.luminance===-100,
  'Color Mixer must bound persisted/user values')
check(DEFAULT_RAW_COLOR_MIX.red.saturation===0,'Default RAW mixer neutral')

// RAW local adjustments: normalized elliptical/ramp coverage and immutable
// 16-bit editing from the original source, including disable/invert/alpha.
const radial=makeRawLocalMask('radial','radial-test')
radial.radiusX=0.27;radial.radiusY=0.27
radial.exposureEv=1
check(rawMaskCoverage(radial,0.5,0.5)===1,'Radial mask fully covers optical center')
check(rawMaskCoverage(radial,0.02,0.02)===0,'Radial mask excludes distant corner')
const localBase16=new Uint16Array(5*5*4)
const localBase8=new Uint8ClampedArray(5*5*4)
for(let i=0;i<25;i++){
  for(let c=0;c<3;c++){localBase16[i*4+c]=16000;localBase8[i*4+c]=62}
  localBase16[i*4+3]=65535;localBase8[i*4+3]=255
}
const localInput={width:5,height:5,rgba:localBase8 as Uint8ClampedArray<ArrayBuffer>,
  rgba16:localBase16,sourceBitDepth:16}
const localBefore=localBase16.slice()
const localEdit=applyRawLocalMasks(localInput,[radial])
check(localEdit.rgba16![12*4]>localBefore[12*4],'Radial exposure adjusts selected center')
check(localEdit.rgba16![0]===localBefore[0],'Radial exposure leaves out-of-mask pixels unchanged')
check(localInput.rgba16.every((v,i)=>v===localBefore[i]),
  'Local adjustment never modifies source 16-bit data')
check(localEdit.rgba16![12*4+3]===65535,'Local adjustments never modify alpha')
const offMask={...radial,enabled:false}
check(applyRawLocalMasks(localInput,[offMask])===localInput,'Disabled local mask is no-op')
const zeroMask={...radial,exposureEv:0}
check(applyRawLocalMasks(localInput,[zeroMask])===localInput,'Neutral local mask is no-op')
const invertMask={...radial,invert:true}
check(rawMaskCoverage(invertMask,0.5,0.5)===0 &&
  rawMaskCoverage(invertMask,0.02,0.02)===1,'Invert local coverage swaps inside/outside')
const gradient=makeRawLocalMask('linear','linear-test')
gradient.x=0.1;gradient.y=0.5;gradient.x2=0.9;gradient.y2=0.5
gradient.saturation=80
check(rawMaskCoverage(gradient,0.1,0.5)===1 &&
  rawMaskCoverage(gradient,0.9,0.5)===0 &&
  rawMaskCoverage(gradient,0.5,0.5)>0.4 &&
  rawMaskCoverage(gradient,0.5,0.5)<0.6,
  'Linear mask interpolates coverage between endpoints')
check(rawMaskCoverage({...gradient,x2:gradient.x,y2:gradient.y},0.9,0.5)===0,
  'Degenerate gradient cannot accidentally alter the whole photo')
const localColor=applyRawLocalMasks(mixSample,[{...gradient,saturation:0,warmth:80}])
check(localColor.rgba16![6]<mixSample.rgba16[6],
  'Local warmth changes selected pixels')
check(localColor.rgba16![3]===65535 && mixSample.rgba16[0]===mixOriginal[0],
  'Local color grade retains full alpha and source')
const malformedMasks=normalizeRawLocalMasks(Array.from({length:15},(_,i)=>({
  ...radial,id:'bad-'+i,x:Infinity,exposureEv:99,strength:-9,name:'  Hello  ',
})))
check(malformedMasks.length===8 && malformedMasks[0].x===0.5 &&
  malformedMasks[0].exposureEv===3 && malformedMasks[0].strength===0 &&
  malformedMasks[0].name==='Hello','Local mask recipe bounds and defaults')
check(normalizeRawLocalMasks([{},null,{kind:'invalid'}]).length===0,
  'Reject invalid persisted mask records')

// RAW preview sampling must be bounded and lossless for selected 16-bit
// samples, keep alpha, and never mutate the original decoded sensor image.
const previewFull16=new Uint16Array(64*8*4)
const previewFull8=new Uint8ClampedArray(64*8*4)
for(let y=0;y<8;y++)for(let x=0;x<64;x++){
  const i=(y*64+x)*4
  previewFull16[i]=x*500;previewFull16[i+1]=y*5000
  previewFull16[i+2]=32768;previewFull16[i+3]=65535
  previewFull8[i]=Math.round(previewFull16[i]/257)
  previewFull8[i+1]=Math.round(previewFull16[i+1]/257)
  previewFull8[i+2]=128;previewFull8[i+3]=255
}
const fullPreview={width:64,height:8,rgba:previewFull8 as Uint8ClampedArray<ArrayBuffer>,
  rgba16:previewFull16,sourceBitDepth:16}
const smallPreview=downsampleRawPreview(fullPreview,32)
check(smallPreview.width===32&&smallPreview.height===4,'RAW preview must bound longest edge')
const chosenX=Math.min(63,Math.floor((0.5)*64/32))
const chosenY=Math.min(7,Math.floor((0.5)*8/4))
check(smallPreview.rgba16?.[0]===previewFull16[(chosenY*64+chosenX)*4],
  'RAW preview must preserve selected 16-bit source samples')
check(smallPreview.rgba16?.[3]===65535,'RAW preview preserves alpha')
check(fullPreview.rgba16[0]===0&&fullPreview.rgba16[4]===500,'RAW preview leaves source untouched')
const histSample={width:3,height:1,rgba:new Uint8ClampedArray([
  0,0,0,255,255,0,0,255,255,255,255,0,
]) as Uint8ClampedArray<ArrayBuffer>,sourceBitDepth:8}
const hist=rawPreviewHistogram(histSample)
check(hist.pixels===2&&hist.clippedShadows===1&&hist.clippedHighlights===1,
  'RAW histogram must count only visible pixels and track clipping')
check(hist.bins[0]===1&&hist.bins[255]===1&&hist.bins[256]===2,
  'RAW histogram RGB channel alignment')
const histHigh=rawPreviewHistogram(mixSample)
check(histHigh.pixels===3&&histHigh.bins[255]===1&&histHigh.bins[256+0]===2,
  'RAW histogram handles native 16-bit pixel buffers')
check(downsampleRawPreview(mixSample)===mixSample,'Small RAW preview should reuse source')
// Two separate TIFF IFDs, each containing an 8-bit grayscale page.
const tiff=new Uint8Array(258);const tv=new DataView(tiff.buffer)
tiff[0]=73;tiff[1]=73;tv.setUint16(2,42,true);tv.setUint32(4,8,true)
function tiffPage(pos:number,next:number,strip:number){
  const fields:[[number,number]]|any=[
    [256,1],[257,1],[258,8],[259,1],[262,1],[273,strip],[277,1],[278,1],[279,1],
  ]
  tv.setUint16(pos,fields.length,true)
  for(let i=0;i<fields.length;i++){
    const [tag,val]=fields[i],p=pos+2+i*12
    tv.setUint16(p,tag,true);tv.setUint16(p+2,tag===273?4:3,true)
    tv.setUint32(p+4,1,true)
    if(tag===273)tv.setUint32(p+8,val,true)
    else tv.setUint16(p+8,val,true)
  }
  tv.setUint32(pos+2+fields.length*12,next,true)
}
tiffPage(8,128,256);tiffPage(128,0,257)
tiff[256]=10;tiff[257]=240
check(tiffPageOffsets(tiff).length===2,'TIFF two IFD pages')
const [t1,t2]=await Promise.all([decodeTiff(tiff,0),decodeTiff(tiff,1)])
check(t1.rgba[0]===10 && t2.rgba[0]===240,'TIFF page selection')

// DCX: two PCX 1x1 24-bit RGB pages.
function pcx(r:number,g:number,b:number){
  const out=new Uint8Array(134)
  const v=new DataView(out.buffer)
  out[0]=10;out[1]=5;out[2]=0;out[3]=8;out[65]=3
  v.setUint16(66,2,true)
  out.set([r,0,g,0,b,0],128)
  return out
}
const dcx=new Uint8Array(4100+268)
const cv=new DataView(dcx.buffer)
cv.setUint32(0,0xb168de3a,true)
cv.setUint32(4,4100,true);cv.setUint32(8,4234,true)
dcx.set(pcx(10,20,30),4100);dcx.set(pcx(40,50,60),4234)
check(dcxPageOffsets(dcx).length===2,'DCX pages')
check(decodePcx(dcx,0).rgba[0]===10 && decodePcx(dcx,1).rgba[0]===40,'DCX page selection')

// Lensfun duplicate focal records used to divide by zero and generate NaNs.
const lensExif: CameraExif = {maker:'Test', model:'Body',lens:'50mm',focal:50,aperture:4,distance:1000}
check(chooseLensfunCurve([{model:'poly3',focal:50,k1:0.1}],lensExif)?.k1===0.1,'Exact Lensfun focal curve')
check(chooseLensfunCurve([{model:'poly3',focal:50,k1:0.1},{model:'poly3',focal:50,k1:0.2}],lensExif)===undefined,'Ambiguous same-focal records are rejected')
const sampleCurve=chooseLensfunCurve([{model:'poly3',focal:20,k1:0.1},{model:'poly3',focal:80,k1:0.3}],lensExif)
check(sampleCurve && Math.abs((sampleCurve.k1??0)-0.2)<1e-8,'Lensfun focal interpolation stays finite')
check(chooseLensfunCurve([{model:'poly3',focal:60,k1:0.3}],lensExif)===undefined,'Lensfun never extrapolates beyond known focal calibrations')
check(chooseLensfunCurve([{model:'poly3',focal:20,k1:0.1},{model:'ptlens',focal:80,a:0.1}],lensExif)===undefined,'Lensfun does not mix incompatible curve models')
console.log('Scientific, DICOM-RLE, EXR, Lensfun calibration and multipage TIFF/DCX tests passed')
