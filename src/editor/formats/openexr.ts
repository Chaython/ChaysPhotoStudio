// OpenEXR 2 regular image importer: single/multipart, scanline/single-level tiled.
// Supported compression: NONE, RLE, ZIPS, ZIP. Deep images are never silently flattened.
import type { RawImage } from './decoders'

const MAX_PIXELS = 64 * 1024 * 1024
const MAX_UNPACKED_CHUNK = 256 * 1024 * 1024
const MAX_PARTS = 16
const MAX_CHUNKS = 131072
const ascii = (bytes: Uint8Array, from: number, to: number) =>
  new TextDecoder().decode(bytes.subarray(from, to))

type ExrChannel = { name: string; pixelType: number; bpp: number }
interface ExrPart {
  name: string
  type: string
  channels: ExrChannel[]
  compression: number
  x0: number; y0: number; width: number; height: number
  tileWidth: number; tileHeight: number
  tiled: boolean
  chunkCount: number
  offsetIndex: number
}
export interface ExrDecodedPart { name: string; image: RawImage }

function readString(bytes: Uint8Array, at: number, end: number): [string, number] {
  let p=at
  while (p<end && bytes[p]!==0) p++
  if (p>=end) throw Error('Unterminated OpenEXR string')
  return [ascii(bytes,at,p),p+1]
}
function half(v: number): number {
  const sign=(v&0x8000)?-1:1, exp=(v>>>10)&31, fraction=v&1023
  return exp===0 ? sign*Math.pow(2,-14)*fraction/1024
    : exp===31 ? (fraction ? NaN : sign*Infinity)
      : sign*Math.pow(2,exp-15)*(1+fraction/1024)
}
function undoPredictor(src: Uint8Array): Uint8Array {
  for (let i=1;i<src.length;i++) src[i]=(src[i-1]+src[i]-128)&255
  const out=new Uint8Array(src.length)
  const midpoint=Math.ceil(src.length/2)
  for(let i=0;i<midpoint;i++)out[i*2]=src[i]
  for(let i=midpoint;i<src.length;i++)out[(i-midpoint)*2+1]=src[i]
  return out
}
function unRle(bytes:Uint8Array, expected:number):Uint8Array {
  const out=new Uint8Array(expected)
  let p=0,q=0
  while(p<bytes.length && q<expected){
    const n=(bytes[p++]<<24)>>24
    if(n<0){
      const len=-n
      if(p+len>bytes.length || q+len>expected)throw Error('Invalid EXR RLE literal')
      out.set(bytes.subarray(p,p+len),q);p+=len;q+=len
    }else{
      const len=n+1
      if(p>=bytes.length || q+len>expected)throw Error('Invalid EXR RLE repeat')
      out.fill(bytes[p++],q,q+len);q+=len
    }
  }
  if(q!==expected||p!==bytes.length)throw Error('Incomplete EXR RLE chunk')
  return undoPredictor(out)
}
async function inflate(src:Uint8Array,expected:number):Promise<Uint8Array> {
  if(typeof DecompressionStream==='undefined')throw Error('EXR ZIP requires browser DecompressionStream')
  if(expected<0||expected>MAX_UNPACKED_CHUNK)throw Error('EXR ZIP chunk exceeds size limit')
  const stream=new Blob([src as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  const reader=stream.getReader()
  const raw=new Uint8Array(expected)
  let at=0
  try{
    for(;;){
      const {value,done}=await reader.read()
      if(done)break
      if(at+value.length>expected)throw Error('EXR ZIP expanded beyond expected length')
      raw.set(value,at);at+=value.length
    }
  }finally{reader.releaseLock()}
  if(at!==expected)throw Error('Unexpected EXR ZIP unpacked size')
  return undoPredictor(raw)
}
function toDisplay(v:number):number {
  const n=Math.max(0,Math.min(1,v))
  return Math.round(255*(n<=0.0031308?12.92*n:1.055*Math.pow(n,1/2.4)-0.055))
}

export async function decodeExrParts(bytes:Uint8Array):Promise<ExrDecodedPart[]> {
  if(bytes.length<24)throw Error('Truncated OpenEXR')
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  if(view.getUint32(0,true)!==20000630)throw Error('Invalid OpenEXR signature')
  const flags=view.getUint32(4,true)
  const multi=(flags&0x1000)!==0
  if((flags&0x800)!==0)throw Error('Deep EXR contains variable per-pixel samples; a native deep-sample decoder is required')
  let pos=8
  const parts:ExrPart[]=[]
  let offsetIndex=0
  let totalPixels=0
  while(parts.length<MAX_PARTS) {
    const data:{
      name:string;type:string;channels:ExrChannel[];compression:number;
      x0:number;y0:number;x1:number;y1:number;tileWidth:number;tileHeight:number;
      levelMode:number;chunkCount:number
    }={name:'',type:'',channels:[],compression:-1,x0:0,y0:0,x1:-1,y1:-1,
      tileWidth:0,tileHeight:0,levelMode:-1,chunkCount:0}
    let terminated=false
    for(let a=0;a<1024;a++){
      const [name,p1]=readString(bytes,pos,bytes.length);pos=p1
      if(!name){terminated=true;break}
      const [type,p2]=readString(bytes,pos,bytes.length);pos=p2
      if(pos+4>bytes.length)throw Error('Truncated EXR attribute')
      const size=view.getUint32(pos,true);pos+=4
      if(size>bytes.length-pos)throw Error('EXR attribute extends past file')
      const end=pos+size
      if(name==='name'&&type==='string')data.name=ascii(bytes,pos,end).replace(/\0.*$/,'')
      if(name==='type'&&type==='string')data.type=ascii(bytes,pos,end).replace(/\0.*$/,'')
      if(name==='chunkCount'&&type==='int'&&size>=4)data.chunkCount=view.getUint32(pos,true)
      if(name==='compression'&&type==='compression'&&size>=1)data.compression=bytes[pos]
      if(name==='dataWindow'&&type==='box2i'&&size>=16){
        data.x0=view.getInt32(pos,true);data.y0=view.getInt32(pos+4,true)
        data.x1=view.getInt32(pos+8,true);data.y1=view.getInt32(pos+12,true)
      }
      if(name==='tiles'&&type==='tiledesc'&&size>=9){
        data.tileWidth=view.getUint32(pos,true);data.tileHeight=view.getUint32(pos+4,true)
        data.levelMode=bytes[pos+8]&15
      }
      if(name==='channels'&&type==='chlist'){
        let p=pos
        while(p<end&&bytes[p]!==0){
          const [channel,after]=readString(bytes,p,end);p=after
          if(p+16>end)throw Error('Truncated EXR channel description')
          const pixelType=view.getUint32(p,true)
          if(![0,1,2].includes(pixelType) || view.getUint32(p+8,true)!==1 || view.getUint32(p+12,true)!==1)
            throw Error('EXR subsampling/channel type is not supported')
          data.channels.push({name:channel,pixelType,bpp:pixelType===1?2:4})
          p+=16
        }
      }
      pos=end
    }
    if(!terminated)throw Error('Unterminated EXR part header')
    if(!data.channels.length && multi && parts.length && bytes[pos]===0){pos++;break}
    if(!data.channels.length)throw Error('EXR header contains no channels')
    const width=data.x1-data.x0+1,height=data.y1-data.y0+1
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||
       width*height>MAX_PIXELS)throw Error('Invalid EXR image dimensions')
    totalPixels+=width*height
    if(totalPixels>MAX_PIXELS)throw Error('EXR aggregate part geometry exceeds pixel budget')
    if(data.channels.length>64||data.channels.reduce((n,c)=>n+c.bpp,0)*width*height>MAX_UNPACKED_CHUNK*4)
      throw Error('EXR channel data exceeds decompression budget')
    if(![0,1,2,3].includes(data.compression))throw Error('EXR compression needs a PIZ/PXR24/B44/DWA decoder')
    const tiled=multi?data.type==='tiledimage':(flags&0x200)!==0
    if(multi && !['scanlineimage','tiledimage'].includes(data.type))
      throw Error('Unsupported EXR part type: '+data.type)
    if(tiled && (data.levelMode!==0||data.tileWidth<1||data.tileHeight<1||
        data.tileWidth>width*2||data.tileHeight>height*2))
      throw Error('Multilevel EXR tiles or invalid tile dimensions are unsupported')
    const count=tiled?Math.ceil(width/data.tileWidth)*Math.ceil(height/data.tileHeight)
      :Math.ceil(height/(data.compression===3?16:1))
    if(count<1||count>MAX_CHUNKS||offsetIndex+count>MAX_CHUNKS)
      throw Error('EXR file has excessive chunks')
    if((multi||data.chunkCount!==0) && data.chunkCount!==count)
      throw Error('EXR chunkCount does not match supported level geometry')
    parts.push({name:data.name||'Part '+(parts.length+1),type:data.type,channels:data.channels,
      compression:data.compression,x0:data.x0,y0:data.y0,width,height,
      tileWidth:data.tileWidth,tileHeight:data.tileHeight,tiled,chunkCount:count,offsetIndex})
    offsetIndex+=count
    if(!multi)break
    // In multipart EXR each header has its own NUL terminator; an additional
    // empty header terminates the header list, leaving the offset tables next.
    if(pos>=bytes.length)throw Error('Missing EXR multipart header terminator')
    if(bytes[pos]===0){pos++;break}
  }
  if(!parts.length||parts.length>=MAX_PARTS && multi && bytes[pos]!==0)
    throw Error('EXR has too many or no parts')
  if(pos+offsetIndex*8>bytes.length)throw Error('Truncated EXR chunk offsets')
  const table=pos
  const decoded:ExrDecodedPart[]=[]
  for(let partNumber=0;partNumber<parts.length;partNumber++){
    const part=parts[partNumber]
    const {width,height}=part
    const rgbaFloat=new Float32Array(width*height*4)
    for(let i=3;i<rgbaFloat.length;i+=4)rgbaFloat[i]=1
    const channels=part.channels
    const bytesPerPixel=channels.reduce((total,c)=>total+c.bpp,0)
    const seen=new Set<number>()
    for(let chunk=0;chunk<part.chunkCount;chunk++){
      const rawOffset=Number(view.getBigUint64(table+(part.offsetIndex+chunk)*8,true))
      const minBytes=(multi?4:0)+(part.tiled?20:8)
      if(!Number.isSafeInteger(rawOffset)||rawOffset<0||rawOffset+minBytes>bytes.length)
        throw Error('EXR chunk offset is outside the file')
      let at=rawOffset
      if(multi){
        if(view.getUint32(at,true)!==partNumber)throw Error('EXR part number mismatch')
        at+=4
      }
      let left=0,top=0,w=width,h=1,packed=0
      if(part.tiled){
        const tx=view.getInt32(at,true),ty=view.getInt32(at+4,true)
        const lx=view.getInt32(at+8,true),ly=view.getInt32(at+12,true)
        const nx=Math.ceil(width/part.tileWidth),ny=Math.ceil(height/part.tileHeight)
        if(tx<0||tx>=nx||ty<0||ty>=ny||lx!==0||ly!==0)
          throw Error('Unsupported EXR tile coordinates')
        const idx=ty*nx+tx
        if(seen.has(idx))throw Error('Duplicate EXR tile');seen.add(idx)
        left=tx*part.tileWidth;top=ty*part.tileHeight
        w=Math.min(part.tileWidth,width-left);h=Math.min(part.tileHeight,height-top)
        packed=view.getUint32(at+16,true);at+=20
      }else{
        top=view.getInt32(at,true)-part.y0
        h=Math.min(part.compression===3?16:1,height-top)
        const step=part.compression===3?16:1
        if(top<0||top>=height||(top%step)!==0)throw Error('Invalid EXR scanline chunk position')
        const idx=Math.floor(top/step)
        if(seen.has(idx))throw Error('Duplicate EXR scanline');seen.add(idx)
        packed=view.getUint32(at+4,true);at+=8
      }
      const expected=w*h*bytesPerPixel
      if(expected>MAX_UNPACKED_CHUNK)throw Error('EXR chunk unpacked size exceeds safety budget')
      if(packed>expected||packed>bytes.length-at)throw Error('Truncated or oversized EXR chunk')
      const payload=bytes.subarray(at,at+packed)
      const raw=part.compression===0||packed===expected?payload:
        part.compression===1?unRle(payload,expected):await inflate(payload,expected)
      if(raw.length!==expected)throw Error('Unexpected EXR chunk size')
      const data=new DataView(raw.buffer,raw.byteOffset,raw.byteLength)
      let q=0
      for(const ch of channels){
        const label=ch.name.split('.').pop()!.toUpperCase()
        const color=label==='R'?0:label==='G'?1:label==='B'?2:label==='A'?3:label==='Y'?4:-1
        for(let ry=0;ry<h;ry++)for(let x=0;x<w;x++){
          const dst=((top+ry)*width+left+x)*4
          const value=ch.pixelType===1?half(data.getUint16(q,true)):
            ch.pixelType===2?data.getFloat32(q,true):data.getUint32(q,true)
          q+=ch.bpp
          if(color===4){rgbaFloat[dst]=value;rgbaFloat[dst+1]=value;rgbaFloat[dst+2]=value}
          else if(color>=0)rgbaFloat[dst+color]=value
        }
      }
    }
    if(seen.size!==part.chunkCount)throw Error('Missing EXR chunks')
    const rgba=new Uint8ClampedArray(rgbaFloat.length)
    for(let i=0;i<rgbaFloat.length;i+=4){
      rgba[i]=toDisplay(rgbaFloat[i]);rgba[i+1]=toDisplay(rgbaFloat[i+1])
      rgba[i+2]=toDisplay(rgbaFloat[i+2])
      rgba[i+3]=Math.round(255*Math.max(0,Math.min(1,rgbaFloat[i+3])))
    }
    decoded.push({name:part.name,image:{width,height,rgba:rgba as Uint8ClampedArray<ArrayBuffer>,
      rgbaFloat,sourceColorSpace:'linear-srgb',sourceBitDepth:32}})
  }
  return decoded
}
export async function decodeExr(bytes:Uint8Array):Promise<RawImage> {
  const parts=await decodeExrParts(bytes)
  if(parts.length!==1)throw Error('EXR contains multiple parts: use decodeExrParts to preserve layers')
  return parts[0].image
}
