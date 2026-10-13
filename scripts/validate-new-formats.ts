import { chooseLensfunCurve, type CameraExif } from '../src/editor/formats/lensfun-xml'
import { decodeFits } from '../src/editor/formats/scientific-fits'
import { decodeDicom } from '../src/editor/formats/scientific-dicom'
import { decodeExr, decodeExrParts } from '../src/editor/formats/openexr'
import { applyLensProfile } from '../src/editor/formats/lens-correction'
import { applyRawTone, normalizeRawTone } from '../src/editor/formats/raw-tone'
import { applyRawDetail, normalizeRawDetail, DEFAULT_RAW_DETAIL } from '../src/editor/formats/raw-detail'
import { catalogKeywords, catalogRating, catalogFilterPhotos, catalogFingerprint } from '../src/editor/library/photo-catalog'
import type { CatalogPhoto } from '../src/editor/library/photo-catalog'
import { encodeTiff, encodeTiff16 } from '../src/editor/formats/encoders'
import { generateSrgbIccV2, embedSrgbIccJpeg } from '../src/editor/formats/srgb-icc'
import { rawBatchOutputNames, runRawBatchExport, MAX_BATCH_RAW_FILES } from '../src/editor/formats/raw-batch-export'
import { DEFAULT_RAW_SETTINGS, normalizeRawSettings, makeBatchSafeRawSettings } from '../src/editor/formats/raw-develop'
import { normalizeWbMultipliers, normalizeCameraMatrix, rawCameraColorOptions } from '../src/editor/formats/raw-camera-color'
import { applyRawCurves, evaluateRawCurve, normalizeRawCurves, DEFAULT_RAW_CURVES } from '../src/editor/formats/raw-curves'
import { applyRawLocalMasks, rawMaskCoverage, normalizeRawLocalMasks, makeRawLocalMask } from '../src/editor/formats/raw-local-masks'
import { rawBrushCoverage, normalizeRawBrushStrokes, MAX_RAW_BRUSH_STROKES, MAX_RAW_BRUSH_POINTS } from '../src/editor/formats/raw-local-masks'
import { applyRawColorMix, normalizeRawColorMix, DEFAULT_RAW_COLOR_MIX } from '../src/editor/formats/raw-color-mix'
import { downsampleRawPreview, rawPreviewHistogram } from '../src/editor/formats/raw-preview'
import { detectFormat, decodeTiff, tiffPageOffsets, decodePcx, dcxPageOffsets } from '../src/editor/formats/decoders'
function check(v:unknown,description:string) { if(!v)throw new Error(description) }
const enc=new TextEncoder()
// Persistent photo-library indexing is side-effect free: tags are bounded,
// search matches camera/date/names/tags, and relinking uses source content.
check(catalogKeywords('  Sunset, trip, SUNSET, indoor  ').join('|')==='Sunset|trip|indoor',
  'Photo catalog keyword trimming, case-insensitive dedupe and ordering')
check(catalogKeywords(Array.from({length:50},(_,i)=>'tag'+i)).length===30,
  'Photo catalog limits keyword count')
check(catalogRating(-10)===0 && catalogRating(3.6)===4 &&
  catalogRating(100)===5 && catalogRating(NaN)===0,
  'Photo catalog ratings normalize into 0..5')
const makePhoto=(id:string,name:string,extras:Partial<CatalogPhoto>={}):CatalogPhoto=>({
  id,name,bytes:123,modified:10,addedAt:20,kind:'raw',rating:0,flag:'none',
  keywords:[],camera:'',takenAt:'',width:0,height:0,thumbnail:null,...extras,
})
const libraryPhotos=[
  makePhoto('a','IMG_100.NEF',{rating:5,flag:'pick',keywords:['mountains'],
    camera:'Nikon Z6',takenAt:'2025:01:02 08:00:00'}),
  makePhoto('b','Beach.ARW',{rating:3,flag:'none',keywords:['vacation','ocean'],
    camera:'Sony A7',takenAt:'2025:02:03 11:00:00'}),
  makePhoto('c','Flower.JPG',{kind:'image',rating:1,flag:'reject',
    keywords:['garden'],camera:'Canon R6'}),
]
check(catalogFilterPhotos(libraryPhotos,{search:'NIKON mountains',
  ratingAtLeast:4,kind:'raw',flag:'pick'}).map(x=>x.id).join(',')==='a',
  'Catalog combines normalized search, rating, RAW, and flag filters')
check(catalogFilterPhotos(libraryPhotos,{search:'sony ocean'}).length===1 &&
  catalogFilterPhotos(libraryPhotos,{kind:'image'}).length===1,
  'Catalog matches keywords/camera and filters regular photos')
check(catalogFilterPhotos(libraryPhotos,{sort:'rating'})[0].id==='a' &&
  catalogFilterPhotos(libraryPhotos,{sort:'date'})[0].id==='b',
  'Catalog stable rating and capture-date sorting')
const fingerprint1=await catalogFingerprint(new Blob([enc.encode('RAW source data sample')]))
const fingerprint2=await catalogFingerprint(new Blob([enc.encode('RAW source data sample')]))
const fingerprint3=await catalogFingerprint(new Blob([enc.encode('Different camera RAW sample')]))
check(fingerprint1===fingerprint2 && fingerprint1!==fingerprint3 &&
  /^[0-9a-f]{64}$/.test(fingerprint1),
  'Catalog content fingerprint allows same-file relinking and rejects different samples')


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

// RAW Detail remains reversible, channel-aware and 16-bit. Synthetic fixtures
// verify tonal edge handling without relying on display/browser image APIs.
const detailW=7,detailH=5,detailPixelCount=detailW*detailH
const detail16=new Uint16Array(detailPixelCount*4)
const detail8=new Uint8ClampedArray(detailPixelCount*4)
for(let y=0;y<detailH;y++)for(let x=0;x<detailW;x++){
  const index=(y*detailW+x)*4
  const value=x>=4?49000:14500
  for(let c=0;c<3;c++){detail16[index+c]=value;detail8[index+c]=Math.round(value/257)}
  detail16[index+3]=65535;detail8[index+3]=255
}
const detailCenter=(2*detailW+2)*4
const detailNoisy=detail16.slice(),detailNoisy8=detail8.slice()
for(let c=0;c<3;c++){
  detailNoisy[detailCenter+c]=21000
  detailNoisy8[detailCenter+c]=Math.round(21000/257)
}
const detailImage={width:detailW,height:detailH,
  rgba:detailNoisy8 as Uint8ClampedArray<ArrayBuffer>,
  rgba16:detailNoisy,sourceBitDepth:16}
const beforeDetail=detailNoisy.slice()
check(applyRawDetail(detailImage,DEFAULT_RAW_DETAIL)===detailImage,
  'Neutral RAW detail is an identity operation')
const smoothDetail=applyRawDetail(detailImage,{luminanceDenoise:100})
check(smoothDetail.rgba16![detailCenter]<detailImage.rgba16[detailCenter] &&
  smoothDetail.rgba16![detailCenter]>14000,'Luminance noise reduction smooths a pixel outlier')
check(smoothDetail.rgba16![(2*detailW+4)*4]>44000,
  'Luminance noise reduction must preserve a high-contrast edge')
check(detailNoisy.every((sample,i)=>sample===beforeDetail[i]),
  '16-bit RAW detail cannot mutate original decoded samples')
check(smoothDetail.rgba16![detailCenter+3]===65535 &&
  smoothDetail.sourceBitDepth===16,
  'RAW detail keeps high bit depth and transparency')
const chroma16=detail16.slice()
const chroma8=detail8.slice()
chroma16[detailCenter]=25500;chroma16[detailCenter+1]=13500;chroma16[detailCenter+2]=13000
for(let c=0;c<3;c++)chroma8[detailCenter+c]=Math.round(chroma16[detailCenter+c]/257)
const colorInput={width:detailW,height:detailH,sourceBitDepth:16,
  rgba:chroma8 as Uint8ClampedArray<ArrayBuffer>,rgba16:chroma16}
const denoiseColor=applyRawDetail(colorInput,{colorDenoise:100})
check(Math.abs(denoiseColor.rgba16![detailCenter]-denoiseColor.rgba16![detailCenter+2])<
  Math.abs(chroma16[detailCenter]-chroma16[detailCenter+2]),
  'Chroma denoise reduces isolated color differences')
const colorCenterLum=(sample:Uint16Array)=>(
  sample[detailCenter]*0.2126+sample[detailCenter+1]*0.7152+sample[detailCenter+2]*0.0722)
check(Math.abs(colorCenterLum(denoiseColor.rgba16!)-colorCenterLum(chroma16))<400,
  'Chroma-only denoise preserves approximate pixel luminance')
const sharpenedDetail=applyRawDetail({width:detailW,height:detailH,
  rgba:detail8 as Uint8ClampedArray<ArrayBuffer>,rgba16:detail16,sourceBitDepth:16},{
  sharpenAmount:120,sharpenRadius:1,sharpenThreshold:0,
})
const edge=(2*detailW+3)*4
check(sharpenedDetail.rgba16![edge]<detail16[edge],
  'Sharpening should darken shadow side of contrast edge')
check(sharpenedDetail.rgba16![detailCenter]===detail16[detailCenter],
  'Sharpening must leave flat midtone regions unchanged')
const guarded=applyRawDetail({width:detailW,height:detailH,
  rgba:detail8 as Uint8ClampedArray<ArrayBuffer>,rgba16:detail16,sourceBitDepth:16},{
  sharpenAmount:120,sharpenThreshold:100,
})
check(guarded.rgba16![detailCenter]===detail16[detailCenter],
  'High sharpening threshold suppresses flat-region sharpening')
const transparent16=detail16.slice(),transparent8=detail8.slice()
transparent16[3]=0;transparent8[3]=0
transparent16[0]=65535;transparent8[0]=255
const alphaDetail=applyRawDetail({width:detailW,height:detailH,
  rgba:transparent8 as Uint8ClampedArray<ArrayBuffer>,rgba16:transparent16,sourceBitDepth:16
},{luminanceDenoise:75,sharpenAmount:65})
check(alphaDetail.rgba16![3]===0&&alphaDetail.rgba16![0]===65535,
  'Transparent RAW pixels preserve their values and alpha')
check(normalizeRawDetail({luminanceDenoise:Infinity,sharpenAmount:900,
  sharpenRadius:2.6,sharpenThreshold:-20}).sharpenRadius===3 &&
  normalizeRawDetail({sharpenAmount:900}).sharpenAmount===200,
  'RAW detail settings clamp malformed values and integer sharpening radius')
check(normalizeRawDetail(undefined).sharpenAmount===0,
  'Older RAW Smart Object recipes default to neutral detail')
const detail8Only=applyRawDetail({width:detailW,height:detailH,
  rgba:detail8 as Uint8ClampedArray<ArrayBuffer>,sourceBitDepth:8},{sharpenAmount:65})
check(!detail8Only.rgba16 && detail8Only.rgba.length===detail8.length,
  'RAW detail 8-bit compatibility path never claims nonexistent precision')

// A multi-photo develop recipe transfers only global settings. In particular,
 // reusing manual lens calibration or image-relative masks would silently
 // change unrelated photos, so those must be strictly isolated per file.
const batchInput=normalizeRawSettings({
  ...DEFAULT_RAW_SETTINGS,
  exposureEv:1.5,whiteBalance:'camera',highlight:2,interpolation:4,denoise:50,
  halfSize:false,smartObject:true,
  tone:{...DEFAULT_RAW_SETTINGS.tone,contrast:35,shadows:-25},
  curves:{...DEFAULT_RAW_SETTINGS.curves,red:[0,30,50,75,100]},
  colorMix:{...DEFAULT_RAW_SETTINGS.colorMix,blue:{hue:14,saturation:20,luminance:-10}},
  detail:{...DEFAULT_RAW_DETAIL,colorDenoise:30,sharpenAmount:80},
  lensProfile:{...DEFAULT_RAW_SETTINGS.lensProfile,name:'Specific 85mm',
    k1:0.05,k2:-0.02,tca:0.003,vignette:0.14},
  localMasks:[{...makeRawLocalMask('brush','batch-local'),exposureEv:1,
    strokes:[{mode:'add',size:10,feather:0.4,points:[{x:0.25,y:0.3}]}]}],
})
const batchFirstFileJSON=JSON.stringify(batchInput)
const transferred=makeBatchSafeRawSettings(batchInput)
check(transferred.exposureEv===1.5 && transferred.whiteBalance==='camera' &&
  transferred.highlight===2 && transferred.interpolation===4 && transferred.denoise===50,
  'Batch developing carries the global sensor recipe and reevaluates camera WB per file')
check(transferred.tone.contrast===35 && transferred.tone.shadows===-25 &&
  transferred.curves.red[1]===30 && transferred.colorMix.blue.hue===14 &&
  transferred.detail.sharpenAmount===80 && transferred.detail.colorDenoise===30,
  'Batch developing includes global tone/curves/HSL/detail adjustments')
check(transferred.localMasks.length===0 &&
  transferred.lensProfile.k1===0 && transferred.lensProfile.tca===0 &&
  transferred.lensProfile.name==='' && !transferred.lensProfile.lensfun,
  'Batch developing excludes per-image masks and camera/lens calibration')
transferred.curves.red[1]=60
transferred.colorMix.blue.saturation=75
transferred.tone.contrast=0
check(JSON.stringify(batchInput)===batchFirstFileJSON,
  'Batch settings never alias or mutate the source photo recipe')
const batchThird=makeBatchSafeRawSettings(transferred)
check(batchThird.localMasks.length===0 &&
  batchThird.lensProfile.name==='' && batchThird.curves.red[1]===60,
  'Subsequent batch photos receive distinct settings, without local-mask leakage')

// RAW batch export planning never overwrites a same-batch name, never
// requires a document in the editor, and remains platform-safe.
const names=rawBatchOutputNames([
  {name:'DSC_0001.NEF'},{name:'dsc_0001.CR2'},{name:'CON.dng'},
  {name:'site: bad/shot.arw'},{name:'.dng'},{name:'DSC_0001.NEF'},
], 'tiff16')
check(names.length===6&&new Set(names.map(x=>x.toLowerCase())).size===6,
  'RAW batch output names are unique even for case-insensitive file systems')
check(names.every(x=>x.endsWith('.tif')&&!/[<>:"/\\|?*]/.test(x)),
  'RAW batch output names are TIFF extensions and safe for filesystem output')
check(names[0]==='DSC_0001-developed.tif'&&names[1]==='dsc_0001-developed-2.tif',
  'Case-insensitive duplicate RAW names are numbered')
check(names[2].startsWith('RAW-003'),'Windows device filenames cannot escape sanitization')
check(rawBatchOutputNames([{name:'my.NEF'}],'jpeg')[0]==='my-developed.jpg',
  'JPEG batch extension and RAW suffix are correct')
const batchInputs=[{name:'a.nef'},{name:'broken.cr2'},{name:'b.dng'}]
const seenBatch:string[]=[]
const progressBatch:number[]=[]
const finishedBatch=await runRawBatchExport(batchInputs,'jpeg',async(file,name)=>{
  seenBatch.push(name)
  if(file.name.startsWith('broken'))throw Error('bad camera RAW')
},{onProgress:s=>progressBatch.push(s.index)})
check(finishedBatch.exported===2&&finishedBatch.failed===1 &&
  !finishedBatch.cancelled && finishedBatch.errors[0]?.fileName==='broken.cr2' &&
  seenBatch.length===3 && progressBatch.join(',')==='0,1,2',
  'RAW batch continues after individual decoding failures and reports exact files')
let cancelledFlag=false
const cancelledBatch=await runRawBatchExport(batchInputs,'tiff8',async()=>{
  cancelledFlag=true
},{isCancelled:()=>cancelledFlag})
check(cancelledBatch.cancelled&&cancelledBatch.exported===1&&cancelledBatch.failed===0,
  'RAW batch cancellation stops before beginning next file')
let excessiveBatchRejected=false
try{
  await runRawBatchExport(Array.from({length:MAX_BATCH_RAW_FILES+1},
    (_,i)=>({name:'raw'+i+'.dng'})),'jpeg',async()=>{})
}catch{excessiveBatchRejected=true}
check(excessiveBatchRejected,'RAW batch file count must be bounded')
// Direct native Uint16 TIFF output must preserve the original 16-bit sample
// bytes, including values not representable by 8-bit conversion.
const nativeTiffPixels=new Uint16Array([1001,29001,60002,65535,271,32003,43343,50000])
const nativeTiff=encodeTiff16(nativeTiffPixels,2,1,false)
const decodedNative=await decodeTiff(nativeTiff)
check(decodedNative.width===2&&decodedNative.height===1 &&
  decodedNative.rgba16?.[0]===1001 && decodedNative.rgba16?.[1]===29001 &&
  decodedNative.rgba16?.[6]===43343 && decodedNative.rgba16?.[7]===50000,
  'Native 16-bit TIFF encoder preserves exact LibRaw samples without 8-bit roundtrip')

// Generated sRGB ICC v2: complete matrix/TRC display profile. This is
// metadata for already-sRGB RAW pixels, not a color-space conversion.
const srgbIcc=generateSrgbIccV2()
const iccView=new DataView(srgbIcc.buffer)
const iccAscii=(bytes:Uint8Array,start:number,length:number)=>
  String.fromCharCode(...bytes.subarray(start,start+length))
check(iccView.getUint32(0,false)===srgbIcc.length &&
  iccAscii(srgbIcc,12,4)==='mntr' && iccAscii(srgbIcc,16,4)==='RGB ' &&
  iccAscii(srgbIcc,20,4)==='XYZ ' && iccAscii(srgbIcc,36,4)==='acsp',
  'Generated ICC has valid declared size, display profile, sRGB/XYZ signatures and acsp header')
const tagCount=iccView.getUint32(128,false)
const iccTags=new Map<string,{offset:number,length:number}>()
for(let i=0;i<tagCount;i++){
  const at=132+i*12, name=iccAscii(srgbIcc,at,4)
  const offset=iccView.getUint32(at+4,false),length=iccView.getUint32(at+8,false)
  check(offset%4===0 && offset>=132+tagCount*12 && offset+length<=srgbIcc.length,
    'ICC tags are aligned and stay inside complete profile payload')
  iccTags.set(name,{offset,length})
}
check(['desc','cprt','wtpt','rXYZ','gXYZ','bXYZ','rTRC','gTRC','bTRC']
  .every(key=>iccTags.has(key)),'Generated sRGB ICC has required display matrix/TRC tags')
const redCurve=iccTags.get('rTRC')!
const redCurveCount=iccView.getUint32(redCurve.offset+8,false)
check(iccAscii(srgbIcc,redCurve.offset,4)==='curv' &&
  redCurveCount===1024 && iccView.getUint16(redCurve.offset+12,false)===0 &&
  iccView.getUint16(redCurve.offset+12+(redCurveCount-1)*2,false)===65535,
  'ICC red transfer curve is valid sampled sRGB with black/white endpoints')
check(iccView.getUint16(redCurve.offset+12+512*2,false)<
  iccView.getUint16(redCurve.offset+12+768*2,false),
  'ICC sampled transfer curve is increasing')
const scanIccTiff=(tiff:Uint8Array)=>{
  const v=new DataView(tiff.buffer,tiff.byteOffset,tiff.byteLength)
  const ifd=v.getUint32(4,true),count=v.getUint16(ifd,true)
  for(let i=0;i<count;i++){
    const pos=ifd+2+i*12
    if(v.getUint16(pos,true)!==34675)continue
    const type=v.getUint16(pos+2,true),n=v.getUint32(pos+4,true),off=v.getUint32(pos+8,true)
    check(type===7&&off%2===0&&off+n<=tiff.length,
      'TIFF ICC profile must use UNDEFINED tag 34675 and aligned bounded offset')
    return tiff.subarray(off,off+n)
  }
  return null
}
const exactIcc=(actual:Uint8Array|null)=>{
  check(!!actual&&actual.length===srgbIcc.length&&actual.every((v,i)=>v===srgbIcc[i]),
    'Encoded TIFF embeds the complete original sRGB ICC profile without alteration')
}
const colorSample8=new Uint8ClampedArray([11,122,201,255,240,43,7,128])
const taggedTiff8=encodeTiff(colorSample8,2,1,true,{iccProfile:srgbIcc})
const taggedTiff16=encodeTiff16(nativeTiffPixels,2,1,true,{iccProfile:srgbIcc})
exactIcc(scanIccTiff(taggedTiff8))
exactIcc(scanIccTiff(taggedTiff16))
const tiff8Decoded=await decodeTiff(taggedTiff8)
const tiff16Decoded=await decodeTiff(taggedTiff16)
check(tiff8Decoded.rgba[0]===11 && tiff8Decoded.rgba[4]===240 &&
  tiff16Decoded.rgba16?.[0]===1001&&tiff16Decoded.rgba16?.[6]===43343,
  'ICC TIFF8/TIFF16 exports preserve original pixels through decode round trip')
const fakeJpeg=new Uint8Array([0xff,0xd8,0xff,0xe0,0x00,0x04,0x4a,0x46,
  0xff,0xda,0x00,0x02,0xab,0xcd,0xff,0xd9])
const taggedJpeg=embedSrgbIccJpeg(fakeJpeg,srgbIcc)
const appLength=(taggedJpeg[4]<<8)|taggedJpeg[5]
check(taggedJpeg[2]===0xff&&taggedJpeg[3]===0xe2 &&
  iccAscii(taggedJpeg,6,12)==='ICC_PROFILE\\0'.replace('\\0','\\u0000') &&
  taggedJpeg[18]===1&&taggedJpeg[19]===1,
  'JPEG APP2 ICC segment carries identifier and single-part sequence numbering')
check(appLength===srgbIcc.length+16 &&
  taggedJpeg.subarray(20,20+srgbIcc.length).every((v,i)=>v===srgbIcc[i]) &&
  taggedJpeg.subarray(taggedJpeg.length-fakeJpeg.length+2)
    .every((v,i)=>v===fakeJpeg[i+2]),
  'JPEG ICC APP2 insertion preserves entire encoded JPEG stream byte-for-byte')
let duplicateRejected=false
try{embedSrgbIccJpeg(taggedJpeg,srgbIcc)}catch{duplicateRejected=true}
check(duplicateRejected,'JPEG export must refuse duplicate existing ICC profile tags')
const largeProfile=new Uint8Array(66000)
largeProfile.set(srgbIcc)
const taggedLargeJpeg=embedSrgbIccJpeg(fakeJpeg,largeProfile)
check(taggedLargeJpeg[18]===1&&taggedLargeJpeg[19]===2,
  'JPEG ICC large-profile APP2 splitting respects marker size and ordering')

// LibRaw camera matrices: embedded DNG/file transforms must work even when
// the user selects Auto or Daylight, which previously disabled matrix use for
// many non-DNG sources under useCameraMatrix:1.
const profileAuto=rawCameraColorOptions({
  whiteBalance:'auto',cameraMatrix:'embedded',whiteBalanceMultipliers:[1,1,1,1],
})
check(profileAuto.useAutoWb && !profileAuto.useCameraWb &&
  profileAuto.useCameraMatrix===3 && !('userMul' in profileAuto),
  'Embedded camera matrix is preferred independently of auto white balance')
const profileBuiltIn=rawCameraColorOptions({
  whiteBalance:'daylight',cameraMatrix:'built-in',whiteBalanceMultipliers:[1,1,1,1],
})
check(!profileBuiltIn.useAutoWb&&!profileBuiltIn.useCameraWb&&
  profileBuiltIn.useCameraMatrix===0,
  'User can disable embedded color matrix in favor of LibRaw built-in calibration')
const customSensor=rawCameraColorOptions({
  whiteBalance:'custom',cameraMatrix:'embedded',whiteBalanceMultipliers:[2.25,1,1.72,0.99],
})
check(!customSensor.useCameraWb&&!customSensor.useAutoWb &&
  'userMul' in customSensor && customSensor.userMul?.[0]===2.25 &&
  customSensor.userMul?.[3]===0.99,
  'Custom sensor white balance passes 4 raw multipliers to LibRaw before conversion')
check(normalizeWbMultipliers([0,Infinity,20,3]).join(',')==='0.1,1,16,3' &&
  normalizeWbMultipliers([2,1]).join(',')==='1,1,1,1' &&
  normalizeCameraMatrix('invalid')==='embedded',
  'Malformed custom sensor WB and camera profile settings are bounded and neutral')
const oldRawColor=normalizeRawSettings({...DEFAULT_RAW_SETTINGS,
  cameraMatrix:undefined,whiteBalanceMultipliers:undefined})
check(oldRawColor.cameraMatrix==='embedded' &&
  oldRawColor.whiteBalanceMultipliers.join(',')==='1,1,1,1',
  'Existing RAW Smart Objects without color fields normalize with safe defaults')
const customSaved=normalizeRawSettings({...DEFAULT_RAW_SETTINGS,
  whiteBalance:'custom',cameraMatrix:'built-in',whiteBalanceMultipliers:[2.1,1,1.8,1]})
const cameraSafe=makeBatchSafeRawSettings(customSaved)
check(customSaved.whiteBalance==='custom'&&
  cameraSafe.whiteBalance==='camera'&&
  cameraSafe.cameraMatrix==='built-in'&&
  cameraSafe.whiteBalanceMultipliers.join(',')==='1,1,1,1',
  'Batch RAW recipes keep color policy but do not leak camera-specific WB coefficients')
const sensorRoundTrip=normalizeRawSettings(JSON.parse(JSON.stringify(customSaved)))
check(sensorRoundTrip.whiteBalance==='custom' &&
  sensorRoundTrip.whiteBalanceMultipliers[0]===2.1 &&
  sensorRoundTrip.cameraMatrix==='built-in',
  'RAW Smart Objects preserve deliberate custom white balance for same-image redevelopment')

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

// Painted brush masks: bounded, serializable stroke geometry; erase order;
 // 16-bit full-resolution processing must preserve alpha and input image.
const painted=makeRawLocalMask('brush','painted')
painted.exposureEv=1
painted.strokes=[{
  mode:'add',size:28,feather:0.3,
  points:[{x:0.5,y:0.5},{x:0.6,y:0.5}],
}]
const centerBrush=rawBrushCoverage(painted,0.5,0.5,50,50)
check(centerBrush>0.99,'Brush center receives full coverage')
check(rawBrushCoverage(painted,0.02,0.02,50,50)===0,
  'Brush does not affect pixels outside painted shape')
const brushEdited=applyRawLocalMasks(localInput,[painted])
check(brushEdited.rgba16![12*4]>localBefore[12*4] &&
  brushEdited.rgba16![0]===localBefore[0],
  '16-bit brush changes painted center but not distant corner')
check(brushEdited.rgba16![12*4+3]===65535 &&
  localInput.rgba16.every((v,i)=>v===localBefore[i]),
  'Brush alpha and source samples stay intact')
const erased=normalizeRawLocalMasks([{
  ...painted,strokes:[...painted.strokes!,{
    mode:'erase',size:30,feather:0,points:[{x:0.5,y:0.5}],
  }],
}])[0]
check(rawBrushCoverage(erased,0.5,0.5,50,50)===0,
  'Eraser removes preceding brush coverage')
const brushPaintOnly={...painted,strokes:[painted.strokes![0]]}
const singleEraser={...brushPaintOnly,strokes:[
  painted.strokes![0],{mode:'erase' as const,size:20,feather:1,
    points:[{x:0.5,y:0.5}]},
]}
const repeatedEraser={...brushPaintOnly,strokes:[
  painted.strokes![0],{mode:'erase' as const,size:20,feather:1,
    points:[{x:0.5,y:0.5},{x:0.5,y:0.5}]},
]}
check(Math.abs(rawBrushCoverage(singleEraser,0.58,0.5,50,50)-
  rawBrushCoverage(repeatedEraser,0.58,0.5,50,50))<1e-6,
  'Repeated brush segments within one stroke must not compound erasure')
check(rawBrushCoverage(erased,0.59,0.5,50,50)<1,
  'Erase stroke affects neighboring pixels inside its diameter')
check(applyRawLocalMasks(localInput,[{...painted,strokes:[],invert:true}])===localInput,
  'Empty inverted brush mask must be a no-op')
check(applyRawLocalMasks(localInput,[{
  ...painted,strokes:[{mode:'erase',size:20,feather:0,points:[{x:0.5,y:0.5}]}],
  invert:true,
}])===localInput,'Erase-only inverted brush mask must be a no-op')
const savedBrush=JSON.parse(JSON.stringify(painted))
const restoredBrush=normalizeRawLocalMasks([savedBrush])[0]
check(restoredBrush.kind==='brush' && restoredBrush.strokes?.[0].points[1].x===0.6,
  'Brush strokes persist through JSON-based RAW Smart Object recipes')
const manyStrokes=normalizeRawBrushStrokes(Array.from({length:100},()=>({
  mode:'add',size:999,feather:3,points:Array.from({length:400},()=>({x:0.5,y:0.5})),
})))
check(manyStrokes.length===MAX_RAW_BRUSH_STROKES &&
  manyStrokes[0].points.length===MAX_RAW_BRUSH_POINTS &&
  manyStrokes[0].size===40 && manyStrokes[0].feather===1,
  'Brush recipes bound stroke count, sample count, size and feather')
check(normalizeRawBrushStrokes([{mode:'add',points:[{x:NaN,y:0.5},{x:2,y:-2}]}])[0].points[0].x===1,
  'Invalid brush points are skipped and out-of-bounds points clamped')

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
