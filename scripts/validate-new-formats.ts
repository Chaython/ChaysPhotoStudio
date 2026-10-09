import { decodeFits } from '../src/editor/formats/scientific-fits'
import { decodeDicom } from '../src/editor/formats/scientific-dicom'
import { decodeExr } from '../src/editor/formats/openexr'
import { decodeTiff, tiffPageOffsets, decodePcx, dcxPageOffsets } from '../src/editor/formats/decoders'
function check(v:unknown,description:string) { if(!v)throw new Error(description) }
const enc=new TextEncoder()
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
const d=decodeDicom(new Uint8Array(pieces))
check(d.image.width===2 && d.image.height===1,'DICOM dimensions')
check(d.image.rgba[0]<d.image.rgba[4],'DICOM grayscale gradient')

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
console.log('Scientific, EXR and multipage TIFF/DCX tests passed')
