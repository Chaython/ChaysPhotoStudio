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
  if(len===0xffffffff) throw Error('Undefined-length DICOM sequence requires a dedicated decoder')
  if(len>v.byteLength-pos) throw Error('Truncated DICOM element')
  return {pos,len,next:pos+len}
}

// DICOM RLE Lossless (1.2.840.10008.1.2.5) stores one PackBits segment
// per component and byte-plane. Segment byte order is most-significant first.
function packBits(segment:Uint8Array,expected:number):Uint8Array{
 const out=new Uint8Array(expected)
 let p=0,q=0
 while(p<segment.length&&q<expected){
   const n=(segment[p++]<<24)>>24
   if(n>=0){
     const count=n+1
     if(p+count>segment.length||q+count>expected)throw Error('Invalid DICOM RLE literal')
     out.set(segment.subarray(p,p+count),q)
     p+=count;q+=count
   }else if(n!==-128){
     const count=1-n
     if(p>=segment.length||q+count>expected)throw Error('Invalid DICOM RLE repeat')
     out.fill(segment[p++],q,q+count);q+=count
   }
 }
 if(q!==expected)throw Error('Truncated DICOM RLE segment')
 return out
}
function decodeRleFrame(frame:Uint8Array,pixels:number,channels:number,bits:number):Uint8Array{
 if(frame.length<64)throw Error('Truncated DICOM RLE header')
 const v=new DataView(frame.buffer,frame.byteOffset,frame.byteLength)
 const segments=v.getUint32(0,true),planes=bits/8
 if(segments!==channels*planes||segments<1||segments>15)throw Error('Unsupported DICOM RLE segment layout')
 const offsets:number[]=[]
 for(let i=0;i<segments;i++){
   const at=v.getUint32(4+i*4,true)
   if(at<64||at>=frame.length||(i&&at<=offsets[i-1]))throw Error('Invalid DICOM RLE offsets')
   offsets.push(at)
 }
 const decoded=offsets.map((start,i)=>packBits(frame.subarray(start,offsets[i+1]??frame.length),pixels))
 const out=new Uint8Array(pixels*channels*planes)
 for(let pixel=0;pixel<pixels;pixel++)for(let component=0;component<channels;component++)
   for(let bytePlane=0;bytePlane<planes;bytePlane++){
     const dst=(pixel*channels+component)*planes+(planes-1-bytePlane)
     out[dst]=decoded[component*planes+bytePlane][pixel]
   }
 return out
}
// Encapsulated RLE: one or more fragments per frame, with optional basic offset table.
function readRleFrames(bytes:Uint8Array,start:number,count:number):Uint8Array[]{
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
 let p=start
 const fragments:Uint8Array[]=[]
 let offsets:number[]=[]
 let first=true
 for(let n=0;n<100000&&p+8<=bytes.length;n++){
   const group=v.getUint16(p,true),tag=v.getUint16(p+2,true),length=v.getUint32(p+4,true)
   p+=8
   if(group===0xfffe&&tag===0xe0dd)break
   if(group!==0xfffe||tag!==0xe000||length===0xffffffff||length>bytes.length-p)
     throw Error('Invalid DICOM encapsulated pixel fragments')
   if(first){
     first=false
     if(length%4)throw Error('Invalid DICOM basic offset table')
     for(let i=0;i<length;i+=4)offsets.push(v.getUint32(p+i,true))
   }else fragments.push(bytes.subarray(p,p+length))
   p+=length
 }
 if(first||!fragments.length)throw Error('Missing DICOM RLE fragments')
 // Without a basic offset table only a single frame can be reconstructed safely.
 if(!offsets.length){
   if(count!==1)throw Error('Multiframe DICOM RLE without offsets is unsupported')
   return [concatFragments(fragments)]
 }
 if(offsets.length<count)throw Error('DICOM RLE offset table has too few frames')
 // Basic offsets are measured from the first item tag, including item headers.
 const withPos:{start:number;data:Uint8Array}[]=[]
 let cursor=0
 for(const fragment of fragments){
   withPos.push({start:cursor,data:fragment})
   cursor+=8+fragment.length
 }
 return Array.from({length:count},(_,frame)=>{
   const from=offsets[frame],to=frame+1<count?offsets[frame+1]:cursor
   if(from>=to||to>cursor)throw Error('Invalid DICOM frame offset')
   const chunks=withPos.filter(x=>x.start>=from&&x.start<to)
   if(!chunks.length||chunks[0].start!==from)throw Error('DICOM RLE frame offset is not an item boundary')
   return concatFragments(chunks.map(x=>x.data))
 })
}
function concatFragments(parts:Uint8Array[]):Uint8Array{
 const total=parts.reduce((n,x)=>n+x.length,0)
 if(total>512*1024*1024)throw Error('DICOM frame exceeds size limit')
 const out=new Uint8Array(total)
 let at=0
 for(const part of parts){out.set(part,at);at+=part.length}
 return out
}

export async function decodeDicom(bytes:Uint8Array):Promise<DicomImage> {
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
  const rle=syntax==='1.2.840.10008.1.2.5'
  const jpegLs=['1.2.840.10008.1.2.4.80','1.2.840.10008.1.2.4.81'].includes(syntax)
  const jpeg2000=['1.2.840.10008.1.2.4.90','1.2.840.10008.1.2.4.91'].includes(syntax)
  const jpegBaseline=syntax==='1.2.840.10008.1.2.4.50'
  const encapsulated=rle||jpegLs||jpeg2000||jpegBaseline
  if(!implicit&&syntax!=='1.2.840.10008.1.2.1'&&!encapsulated)
    throw Error('Unsupported DICOM transfer syntax: '+syntax)
  let w=0,h=0,bits=0,stored=0,signed=false,channels=1,planar=0,photometric='MONOCHROME2',count=1
  let wc:number|undefined,ww:number|undefined,start=-1,length=0
  const numberText=(pos:number,len:number)=>Number(ascii(bytes,pos,len).split('\\')[0].trim())
  for(let n=0;n<100000 && p+8<=bytes.length;n++){
    const group=v.getUint16(p,true),tag=v.getUint16(p+2,true)
    const vr=implicit?'':ascii(bytes,p+4,2)
    if(group===0x7fe0 && tag===0x0010 && encapsulated){
      const pixelStart=p+(vr==='OB'||vr==='OW'||vr==='UN'?12:8)
      if(pixelStart>bytes.length||v.getUint32(p+8,true)!==0xffffffff)throw Error('Compressed DICOM requires undefined-length encapsulated pixel data')
      start=pixelStart;length=bytes.length-start;break
    }
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
  if(!encapsulated&&size*count>length)throw Error('Truncated DICOM pixel payload')
  if(encapsulated&&count>24)throw Error('Encapsulated DICOM frame count exceeds 24-frame import limit')
  const compressedFrames=encapsulated?readRleFrames(bytes,start,count):[]
  const frames:RawImage[]=[]
  const limit=Math.min(count,24)
  for(let f=0;f<limit;f++){
    const offset=start+f*size
    const frameBytes=rle?decodeRleFrame(compressedFrames[f],pixels,channels,bits):bytes
    const frameOffset=rle?0:offset
    const frameView=rle?new DataView(frameBytes.buffer,frameBytes.byteOffset,frameBytes.byteLength):v
    if(jpegLs||jpeg2000||jpegBaseline){
      const encoded=compressedFrames[f]
      let image:RawImage
      if(jpegLs){
        const {decodeJpegLs}=await import('./wasm-codecs')
        image=await decodeJpegLs(encoded.slice().buffer)
      }else if(jpeg2000){
        const {decodeJpeg2000}=await import('./wasm-codecs')
        image=await decodeJpeg2000(encoded.slice().buffer)
      }else{
        const bitmap=await createImageBitmap(new Blob([encoded as BlobPart],{type:'image/jpeg'}))
        try{
          if(bitmap.width!==w||bitmap.height!==h)throw Error('DICOM JPEG frame dimensions differ from metadata')
          const canvas=document.createElement('canvas')
          canvas.width=w;canvas.height=h
          const context=canvas.getContext('2d',{willReadFrequently:true})
          if(!context)throw Error('DICOM JPEG canvas context unavailable')
          context.drawImage(bitmap,0,0)
          image={width:w,height:h,rgba:new Uint8ClampedArray(context.getImageData(0,0,w,h).data) as Uint8ClampedArray<ArrayBuffer>,sourceBitDepth:8}
        }finally{bitmap.close()}
      }
      if(image.width!==w||image.height!==h)throw Error('Compressed DICOM frame dimensions differ from metadata')
      if(channels===1&&photometric==='MONOCHROME1'){
        for(let i=0;i<image.rgba.length;i+=4){
          image.rgba[i]=255-image.rgba[i];image.rgba[i+1]=255-image.rgba[i+1];image.rgba[i+2]=255-image.rgba[i+2]
        }
      }
      frames.push(image)
      continue
    }
    let rgba:Uint8ClampedArray
    if(channels===3){
      rgba=new Uint8ClampedArray(pixels*4)
      for(let i=0;i<pixels;i++){
        for(let c=0;c<3;c++)rgba[i*4+c]=frameBytes[frameOffset+(rle?i*3+c:planar===1?c*pixels+i:i*3+c)]
        rgba[i*4+3]=255
      }
    }else{
      const values=new Float64Array(pixels)
      for(let i=0;i<pixels;i++){
        const pos=frameOffset+i*bits/8
        let val=bits===8?(signed?frameView.getInt8(pos):frameView.getUint8(pos)):(signed?frameView.getInt16(pos,true):frameView.getUint16(pos,true))
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
    ...(encapsulated?['Imported '+syntax+' compressed frames as display RGB(A); calibrated source samples are not preserved.']:[]),
    ...(count>limit?['Only first '+limit+' of '+count+' DICOM frames imported.']:[]),
  ]}
}
