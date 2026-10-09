// Scanline OpenEXR import: half/float/uint channels, NONE/ZIPS/ZIP compression.
// Tiles, deep data and multipart files are rejected explicitly.
import type { RawImage } from './decoders'
const readAscii = (b:Uint8Array,start:number,end:number) => new TextDecoder().decode(b.subarray(start,end))
const maxPix=64*1024*1024
type ExrChannel={name:string,type:number,bpp:number}
function half(value:number){
 const s=(value&0x8000)?-1:1,e=(value>>>10)&31,f=value&1023
 return e===0?s*Math.pow(2,-14)*f/1024:e===31?(f?NaN:s*Infinity):s*Math.pow(2,e-15)*(1+f/1024)
}
function str(bytes:Uint8Array,pos:number,limit:number):[string,number]{
 let end=pos
 while(end<limit&&bytes[end])end++
 if(end>=limit)throw Error('Unterminated OpenEXR attribute')
 return [readAscii(bytes,pos,end),end+1]
}
// RLE and ZIP share the EXR byte predictor + even/odd byte shuffle.
function undoPredictAndInterleave(output:Uint8Array):Uint8Array{
 for(let i=1;i<output.length;i++)output[i]=(output[i-1]+output[i]-128)&255
 const result=new Uint8Array(output.length)
 const first=Math.ceil(output.length/2)
 for(let i=0;i<first;i++)result[i*2]=output[i]
 for(let i=first;i<output.length;i++)result[(i-first)*2+1]=output[i]
 return result
}
function unrle(block:Uint8Array,expected:number):Uint8Array{
 const output=new Uint8Array(expected)
 let src=0,dst=0
 while(src<block.length && dst<expected){
   const count=(block[src++]<<24)>>24
   if(count<0){
     const length=-count
     if(src+length>block.length||dst+length>expected)throw Error('Truncated or oversized OpenEXR RLE literal')
     output.set(block.subarray(src,src+length),dst)
     src+=length;dst+=length
   }else{
     const length=count+1
     if(src>=block.length||dst+length>expected)throw Error('Truncated or oversized OpenEXR RLE repeat')
     output.fill(block[src++],dst,dst+length)
     dst+=length
   }
 }
 if(dst!==expected||src!==block.length)throw Error('OpenEXR RLE block size mismatch')
 return undoPredictAndInterleave(output)
}
async function unzip(block:Uint8Array,expected:number):Promise<Uint8Array>{
 const ds=new DecompressionStream('deflate')
 const output=new Uint8Array(await new Response(new Blob([block as BlobPart]).stream().pipeThrough(ds)).arrayBuffer())
 if(output.length!==expected)throw Error('Unexpected OpenEXR ZIP block length')
 return undoPredictAndInterleave(output)
}
function srgb(value:number){
 const v=Math.max(0,Math.min(1,value))
 return Math.round(255*(v<=0.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-0.055))
}
export async function decodeExr(bytes:Uint8Array):Promise<RawImage>{
 if(bytes.length<24)throw Error('Truncated OpenEXR')
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
 if(v.getUint32(0,true)!==20000630)throw Error('Invalid OpenEXR signature')
 const flags=v.getUint32(4,true)
 if((flags&0x200)!==0||(flags&0x800)!==0||(flags&0x1000)!==0)throw Error('Tiled, multipart or deep OpenEXR needs a dedicated decoder')
 let pos=8
 let channels:ExrChannel[]=[],compression=-1,x0=0,y0=0,x1=-1,y1=-1
 for(let attr=0;attr<1024;attr++){
   const [name,p]=str(bytes,pos,bytes.length);pos=p
   if(!name)break
   const [type,p2]=str(bytes,pos,bytes.length);pos=p2
   if(pos+4>bytes.length)throw Error('Truncated OpenEXR attribute length')
   const size=v.getUint32(pos,true);pos+=4
   if(size>bytes.length-pos)throw Error('Truncated OpenEXR attribute')
   const end=pos+size
   if(name==='compression'&&type==='compression'&&size>=1)compression=bytes[pos]
   if(name==='dataWindow'&&type==='box2i'&&size>=16){
     x0=v.getInt32(pos,true);y0=v.getInt32(pos+4,true)
     x1=v.getInt32(pos+8,true);y1=v.getInt32(pos+12,true)
   }
   if(name==='channels'&&type==='chlist'){
     let at=pos
     while(at<end && bytes[at]){
       const [channel,next]=str(bytes,at,end);at=next
       if(at+16>end)throw Error('Truncated OpenEXR channel')
       const pixelType=v.getUint32(at,true)
       const xSampling=v.getUint32(at+8,true),ySampling=v.getUint32(at+12,true)
       if(![0,1,2].includes(pixelType)||xSampling!==1||ySampling!==1)
         throw Error('Unsupported OpenEXR channel type/sampling')
       channels.push({name:channel,type:pixelType,bpp:pixelType===1?2:4});at+=16
     }
   }
   pos=end
   if(bytes[pos]===0){pos++;break}
 }
 const width=x1-x0+1,height=y1-y0+1
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>maxPix)
   throw Error('Invalid OpenEXR data window')
 if(!channels.length||![0,1,2,3].includes(compression))throw Error('Unsupported OpenEXR compression/channel header (supported NONE/RLE/ZIPS/ZIP)')
 const rowsPerBlock=compression===3?16:1
 const countBlocks=Math.ceil(height/rowsPerBlock)
 if(pos+countBlocks*8>bytes.length)throw Error('Truncated OpenEXR scanline offset table')
 const channelSamples=channels.reduce((s,c)=>s+c.bpp,0)
 const floatPixels=new Float32Array(width*height*4)
 for(let i=3;i<floatPixels.length;i+=4)floatPixels[i]=1
 const recognized=(name:string):number=>{
   const final=name.split('.').pop()!.toUpperCase()
   return final==='R'?0:final==='G'?1:final==='B'?2:final==='A'?3:final==='Y'?4:-1
 }
 const found=channels.map(ch=>recognized(ch.name))
 for(let blockIndex=0;blockIndex<countBlocks;blockIndex++){
   const rawOffset=Number(v.getBigUint64(pos+blockIndex*8,true))
   if(!Number.isSafeInteger(rawOffset)||rawOffset<0||rawOffset+8>bytes.length)throw Error('Invalid OpenEXR block offset')
   const scanline=v.getInt32(rawOffset,true),packed=v.getUint32(rawOffset+4,true)
   if(packed>bytes.length-rawOffset-8)throw Error('Truncated OpenEXR block')
   const row=scanline-y0
   if(row<0||row>=height)throw Error('Invalid OpenEXR scanline position')
   const rows=Math.min(rowsPerBlock,height-row)
   const expected=width*rows*channelSamples
   const packedData=bytes.subarray(rawOffset+8,rawOffset+8+packed)
   // EXR stores an uncompressed block when compression would not reduce its size.
   if(packed>expected)throw Error('OpenEXR compressed block exceeds its unpacked size')
   const raw=compression===0||packed===expected?packedData:
     compression===1?unrle(packedData,expected):await unzip(packedData,expected)
   if(raw.length!==expected)throw Error('OpenEXR scanline length mismatch')
   const pixels=new DataView(raw.buffer,raw.byteOffset,raw.byteLength)
   let p=0
   for(let ch=0;ch<channels.length;ch++){
     const desc=channels[ch],kind=found[ch]
     for(let ry=0;ry<rows;ry++)for(let x=0;x<width;x++){
       const dst=((row+ry)*width+x)*4
       const sample=desc.type===1?half(pixels.getUint16(p,true)):
         desc.type===2?pixels.getFloat32(p,true):pixels.getUint32(p,true)
       p+=desc.bpp
       if(kind===4){
         floatPixels[dst]=sample;floatPixels[dst+1]=sample;floatPixels[dst+2]=sample
       } else if(kind>=0)floatPixels[dst+kind]=sample
     }
   }
 }
 const rgba=new Uint8ClampedArray(floatPixels.length)
 for(let i=0;i<floatPixels.length;i+=4){
   rgba[i]=srgb(floatPixels[i]);rgba[i+1]=srgb(floatPixels[i+1])
   rgba[i+2]=srgb(floatPixels[i+2]);rgba[i+3]=Math.round(255*Math.max(0,Math.min(1,floatPixels[i+3])))
 }
 return {
   width,height,rgba:rgba as Uint8ClampedArray<ArrayBuffer>,rgbaFloat:floatPixels,
   sourceColorSpace:'linear-srgb',sourceBitDepth:32,
 }
}
