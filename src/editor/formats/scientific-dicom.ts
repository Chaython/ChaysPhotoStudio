// Uncompressed DICOM Part-10 diagnostic-independent visual import.
// Files with encapsulated/compressed Pixel Data are deliberately rejected.
import type { RawImage } from './decoders'
import { stretchScientific } from './scientific-fits'
export interface DicomImage { image: RawImage; frames:RawImage[]; warnings:string[] }
const ascii=(b:Uint8Array,p:number,n:number)=>new TextDecoder('latin1').decode(b.subarray(p,p+n))
function readEntry(v:DataView,p:number,vr:string,implicit:boolean) {
  const wide=!implicit&&['OB','OW','SQ','UN','UT','OF','OD','OL','UC','UR'].includes(vr)
  const pos=p+(wide?12:8)
  if(pos>v.byteLength) throw Error('Truncated DICOM element header')
  const len=implicit||wide?v.getUint32(p+(wide?8:4),true):v.getUint16(p+6,true)
  if(len===0xffffffff) throw Error('Undefined-length or encapsulated DICOM requires a dedicated transfer-syntax decoder')
  if(len>v.byteLength-pos) throw Error('Truncated DICOM element')
  return {pos,len,next:pos+len}
}
export function decodeDicom(bytes:Uint8Array):DicomImage {
  if(bytes.length<132||ascii(bytes,128,4)!=='DICM') throw Error('Only DICOM Part 10 files with DICM preamble are supported')
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  let p=132,syntax='1.2.840.10008.1.2.1'
  while(p+8<=bytes.length && v.getUint16(p,true)===2){
    const vr=ascii(bytes,p+4,2),tag=v.getUint16(p+2,true)
    const e=readEntry(v,p,vr,false)
    if(tag===0x10)syntax=ascii(bytes,e.pos,e.len).replace(/\0/g,'').trim()
    p=e.next
  }
  const implicit=syntax==='1.2.840.10008.1.2'
  if(!implicit&&syntax!=='1.2.840.10008.1.2.1')throw Error('Compressed or big-endian DICOM transfer syntax is not yet supported: '+syntax)
  let w=0,h=0,bits=0,stored=0,signed=false,channels=1,planar=0,photometric='MONOCHROME2',count=1
  let wc:number|undefined,ww:number|undefined,start=-1,length=0
  const numberText=(pos:number,len:number)=>Number(ascii(bytes,pos,len).split('\\')[0].trim())
  for(let n=0;n<100000 && p+8<=bytes.length;n++){
    const group=v.getUint16(p,true),tag=v.getUint16(p+2,true)
    const vr=implicit?'':ascii(bytes,p+4,2)
    const e=readEntry(v,p,vr,implicit)
    if(group===0x7fe0 && tag===0x0010){start=e.pos;length=e.len;break}
    if(group===0x28){
      if(tag===0x10&&e.len>=2)h=v.getUint16(e.pos,true)
      if(tag===0x11&&e.len>=2)w=v.getUint16(e.pos,true)
      if(tag===0x100&&e.len>=2)bits=v.getUint16(e.pos,true)
      if(tag===0x101&&e.len>=2)stored=v.getUint16(e.pos,true)
      if(tag===0x103&&e.len>=2)signed=v.getUint16(e.pos,true)===1
      if(tag===0x02&&e.len>=2)channels=v.getUint16(e.pos,true)
      if(tag===0x06&&e.len>=2)planar=v.getUint16(e.pos,true)
      if(tag===0x04)photometric=ascii(bytes,e.pos,e.len).trim()
      if(tag===0x08)count=numberText(e.pos,e.len)
      if(tag===0x1050)wc=numberText(e.pos,e.len)
      if(tag===0x1051)ww=numberText(e.pos,e.len)
    }
    p=e.next
  }
  if(start<0) throw Error('DICOM Pixel Data element is missing')
  if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||w*h>64*1024*1024)throw Error('Invalid DICOM image geometry')
  if(bits!==8&&bits!==16)throw Error('Only 8/16-bit DICOM pixels are implemented')
  if(channels!==1&&!(channels===3&&bits===8&&photometric==='RGB'))throw Error('Only monochrome and 8-bit RGB DICOM are implemented')
  if(channels===1&&!['MONOCHROME1','MONOCHROME2'].includes(photometric))throw Error('Unsupported DICOM photometric interpretation')
  if(!Number.isSafeInteger(count)||count<1)throw Error('Invalid DICOM frame count')
  const pixels=w*h,size=pixels*channels*(bits/8)
  if(size*count>length)throw Error('Truncated DICOM pixel payload')
  const frames:RawImage[]=[]
  const limit=Math.min(count,24)
  for(let f=0;f<limit;f++){
    const offset=start+f*size
    let rgba:Uint8ClampedArray
    if(channels===3){
      rgba=new Uint8ClampedArray(pixels*4)
      for(let i=0;i<pixels;i++){
        for(let c=0;c<3;c++)rgba[i*4+c]=bytes[offset+(planar===1?c*pixels+i:i*3+c)]
        rgba[i*4+3]=255
      }
    }else{
      const values=new Float64Array(pixels)
      for(let i=0;i<pixels;i++){
        const pos=offset+i*bits/8
        let val=bits===8?(signed?v.getInt8(pos):v.getUint8(pos)):(signed?v.getInt16(pos,true):v.getUint16(pos,true))
        if(stored>0&&stored<bits){
          const mask=2**stored-1
          val&=mask
          if(signed&&val>=2**(stored-1))val-=2**stored
        }
        values[i]=val
      }
      rgba=stretchScientific(values,photometric==='MONOCHROME1',
        ww&&ww>0&&wc!==undefined?wc-ww/2:undefined,
        ww&&ww>0&&wc!==undefined?wc+ww/2:undefined)
    }
    frames.push({width:w,height:h,rgba:rgba as Uint8ClampedArray<ArrayBuffer>,sourceBitDepth:8})
  }
  return {image:frames[0],frames,warnings:[
    'DICOM is imported as a display rendering for graphic editing, not for diagnosis. Do not rely on this rendering for clinical decisions.',
    ...(count>limit?['Only first '+limit+' of '+count+' DICOM frames imported.']:[]),
  ]}
}
