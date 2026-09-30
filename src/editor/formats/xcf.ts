// Dedicated GIMP XCF parser.
//
// The XCF layout / RLE interpretation follows the public GIMP XCF format and
// was cross-checked against xcfreader by Andi McLean (MIT, 2026).
// https://github.com/andimclean/xcfreader
//
// This implementation is dependency-free and emits native raster layers.
// It supports 32/64-bit XCF pointers, RGB/gray/indexed layers, 8/16/32-bit
// integer and half/float/double channel precision, NONE/RLE compression, layer
// offsets/visibility/opacity and the classic GIMP blend-mode ids.

import type { ParsedDocument, ParsedDocumentLayer } from './document-parser-types'
import { createCanvas, ctx2d } from '../utils/canvas'

interface Prop { type: number; data: Uint8Array }
interface LayerRec {
  width: number; height: number; type: number; name: string
  props: Map<number, Prop>; hierarchy: number; mask: number
}

const PROP = {
  END: 0, COLORMAP: 1, OPACITY: 6, MODE: 7, VISIBLE: 8, OFFSETS: 15,
  COMPRESSION: 17, RESOLUTION: 19, PARASITES: 21, GROUP_ITEM: 29, FLOAT_OPACITY: 33,
} as const

class R {
  constructor(public readonly bytes: Uint8Array, public p = 0) {}
  need(n: number) { if (this.p < 0 || this.p + n > this.bytes.length) throw new Error('Truncated XCF data') }
  u8() { this.need(1); return this.bytes[this.p++] }
  u32() { this.need(4); const v=new DataView(this.bytes.buffer,this.bytes.byteOffset+this.p,4).getUint32(0,false);this.p+=4;return v }
  i32() { this.need(4); const v=new DataView(this.bytes.buffer,this.bytes.byteOffset+this.p,4).getInt32(0,false);this.p+=4;return v }
  f32be() { this.need(4);const v=new DataView(this.bytes.buffer,this.bytes.byteOffset+this.p,4).getFloat32(0,false);this.p+=4;return v }
  buf(n:number){this.need(n);const v=this.bytes.slice(this.p,this.p+n);this.p+=n;return v}
  ptr64(){const hi=this.u32(),lo=this.u32();const v=hi*0x100000000+lo;if(!Number.isSafeInteger(v))throw new Error('XCF pointer exceeds JavaScript safe integer range');return v}
}

function ascii(bytes: Uint8Array): string {
  let s=''; for(const b of bytes)s+=String.fromCharCode(b); return s
}
function zstr(data: Uint8Array): string {
  const zero=data.indexOf(0);return new TextDecoder('utf-8',{fatal:false}).decode(zero>=0?data.subarray(0,zero):data)
}
function properties(r:R): Map<number,Prop>{
  const out=new Map<number,Prop>()
  for(let i=0;i<100000;i++){
    const type=r.u32(), len=r.u32()
    if(len>512*1024*1024)throw new Error('XCF property is too large')
    const data=r.buf(len)
    out.set(type,{type,data})
    if(type===PROP.END)break
  }
  return out
}
function propU32(props:Map<number,Prop>,type:number,fallback:number):number{
  const p=props.get(type)?.data;if(!p||p.length<4)return fallback
  return new DataView(p.buffer,p.byteOffset,p.byteLength).getUint32(0,false)
}
function propI32Pair(props:Map<number,Prop>,type:number):[number,number]{
  const p=props.get(type)?.data;if(!p||p.length<8)return[0,0]
  const v=new DataView(p.buffer,p.byteOffset,p.byteLength);return[v.getInt32(0,false),v.getInt32(4,false)]
}
function readPtr(r:R,v11:boolean):number{return v11?r.ptr64():r.u32()}
function readPtrList(r:R,v11:boolean,limit=100000):number[]{
  const out:number[]=[]
  for(let i=0;i<limit;i++){const p=readPtr(r,v11);if(!p)break;out.push(p)}
  return out
}

function halfToFloat(h:number):number{
  const s=(h>>15)&1,e=(h>>10)&0x1f,f=h&0x3ff
  if(e===0)return f===0?(s?-0:0):(s?-1:1)*Math.pow(2,-14)*(f/1024)
  if(e===31)return f?NaN:(s?-Infinity:Infinity)
  return(s?-1:1)*Math.pow(2,e-15)*(1+f/1024)
}
function channelValue(bytes:Uint8Array,off:number,bpc:number,float:boolean):number{
  if(off<0||off+bpc>bytes.length)return 0
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  let n=0
  if(bpc===1)n=bytes[off]
  else if(bpc===2)n=float?halfToFloat(v.getUint16(off,false))*255:v.getUint16(off,false)/257
  else if(bpc===4)n=float?v.getFloat32(off,false)*255:v.getUint32(off,false)/16843009
  else if(bpc===8)n=v.getFloat64(off,false)*255
  return Math.max(0,Math.min(255,Math.round(Number.isFinite(n)?n:0)))
}

/** XCF RLE. Each color channel is encoded independently, then interleaved. */
function rleDecode(data:Uint8Array,pixels:number,bpp:number):Uint8Array{
  const out=new Uint8Array(pixels*bpp)
  let ip=0
  for(let channel=0;channel<bpp;channel++){
    let remaining=pixels,op=channel
    while(remaining>0){
      if(ip>=data.length)throw new Error('Truncated XCF RLE tile')
      const length=data[ip++]
      if(length<127){
        const count=length+1
        if(ip>=data.length||count>remaining)throw new Error('Invalid XCF RLE repeat run')
        const byte=data[ip++]
        for(let n=0;n<count;n++){out[op]=byte;op+=bpp}
        remaining-=count
      }else if(length===127){
        if(ip+2>=data.length)throw new Error('Truncated XCF RLE long repeat')
        const count=(data[ip]<<8)|data[ip+1];ip+=2
        if(count<1||count>remaining)throw new Error('Invalid XCF RLE long repeat')
        const byte=data[ip++]
        for(let n=0;n<count;n++){out[op]=byte;op+=bpp}
        remaining-=count
      }else if(length===128){
        if(ip+1>=data.length)throw new Error('Truncated XCF RLE long literal')
        const count=(data[ip]<<8)|data[ip+1];ip+=2
        if(count<1||count>remaining||ip+count>data.length)throw new Error('Invalid XCF RLE long literal')
        for(let n=0;n<count;n++){out[op]=data[ip++];op+=bpp}
        remaining-=count
      }else{
        const count=256-length
        if(count>remaining||ip+count>data.length)throw new Error('Invalid XCF RLE literal')
        for(let n=0;n<count;n++){out[op]=data[ip++];op+=bpp}
        remaining-=count
      }
    }
  }
  return out
}

function precisionInfo(version:number,precision:number|undefined){
  const p=version>=11?(precision??150):150
  const bpc=p>=700?8:p>=600?4:p>=500?2:p>=300?4:p>=200?2:1
  return{bpc,float:p>=500,bits:bpc*8}
}

function blendMode(mode:number):string{
  const map:Record<number,string>={
    0:'normal',3:'multiply',4:'screen',5:'overlay',6:'difference',7:'linear-dodge',
    9:'darken',10:'lighten',11:'hue',12:'saturation',13:'color',14:'luminosity',
    16:'color-dodge',17:'color-burn',18:'hard-light',19:'soft-light',
  }
  return map[mode]??'normal'
}

function paletteFrom(props:Map<number,Prop>):Uint8Array|null{
  const d=props.get(PROP.COLORMAP)?.data
  if(!d||d.length<4)return null
  const v=new DataView(d.buffer,d.byteOffset,d.byteLength),n=v.getUint32(0,false)
  if(n<1||n>256||d.length<4+n*3)return null
  return d.slice(4,4+n*3)
}

function opacityOf(props:Map<number,Prop>):number{
  const fp=props.get(PROP.FLOAT_OPACITY)?.data
  if(fp&&fp.length>=4){
    const n=new DataView(fp.buffer,fp.byteOffset,fp.byteLength).getFloat32(0,false)
    if(Number.isFinite(n))return Math.max(0,Math.min(100,n*100))
  }
  const n=propU32(props,PROP.OPACITY,255)
  return Math.max(0,Math.min(100,n<=1?n*100:n*100/255))
}
function resolutionOf(props:Map<number,Prop>):number|undefined{
  const d=props.get(PROP.RESOLUTION)?.data
  if(!d||d.length<8)return undefined
  const v=new DataView(d.buffer,d.byteOffset,d.byteLength)
  // GIMP historically wrote these floats in native/little-endian order.
  const x=v.getFloat32(0,true),y=v.getFloat32(4,true),n=(x+y)/2
  return Number.isFinite(n)&&n>=1&&n<=12000?n:undefined
}

function layerRecord(bytes:Uint8Array,ptr:number,v11:boolean):LayerRec{
  if(ptr<=0||ptr>=bytes.length)throw new Error('XCF layer pointer is outside the file')
  const r=new R(bytes,ptr)
  const width=r.u32(),height=r.u32(),type=r.u32(),nameLen=r.u32()
  if(width<0||height<0||width*height>268435456||nameLen>1024*1024)throw new Error('Invalid XCF layer dimensions/name')
  const name=zstr(r.buf(nameLen))
  const props=properties(r)
  const hierarchy=readPtr(r,v11),mask=readPtr(r,v11)
  return{width,height,type,name,props,hierarchy,mask}
}

function hierarchy(bytes:Uint8Array,ptr:number,v11:boolean){
  if(ptr<=0||ptr>=bytes.length)throw new Error('Invalid XCF hierarchy pointer')
  const r=new R(bytes,ptr)
  const width=r.u32(),height=r.u32(),bpp=r.u32(),level=readPtr(r,v11)
  return{width,height,bpp,level}
}
function level(bytes:Uint8Array,ptr:number,v11:boolean){
  if(ptr<=0||ptr>=bytes.length)throw new Error('Invalid XCF level pointer')
  const r=new R(bytes,ptr)
  const width=r.u32(),height=r.u32(),tiles=readPtrList(r,v11,1000000)
  return{width,height,tiles}
}

function imageType(type:number):{base:'rgb'|'gray'|'indexed';alpha:boolean}{
  switch(type){
    case 0:return{base:'rgb',alpha:false};case 1:return{base:'rgb',alpha:true}
    case 2:return{base:'gray',alpha:false};case 3:return{base:'gray',alpha:true}
    case 4:return{base:'indexed',alpha:false};case 5:return{base:'indexed',alpha:true}
    default:return{base:'rgb',alpha:true}
  }
}

async function inflateZlib(data:Uint8Array):Promise<Uint8Array>{
  const DS=(globalThis as any).DecompressionStream
  if(typeof DS!=='function')throw new Error('Zlib-compressed XCF needs DecompressionStream')
  const stream=new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DS('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function layerCanvas(
  bytes:Uint8Array,rec:LayerRec,v11:boolean,compression:number,
  bpc:number,isFloat:boolean,palette:Uint8Array|null,
):Promise<HTMLCanvasElement>{
  const h=hierarchy(bytes,rec.hierarchy,v11)
  const lev=level(bytes,h.level,v11)
  const expectedTiles=Math.ceil(rec.width/64)*Math.ceil(rec.height/64)
  if(lev.tiles.length<expectedTiles)throw new Error('XCF layer has too few tiles')
  const rgba=new Uint8ClampedArray(rec.width*rec.height*4)
  const info=imageType(rec.type)
  const channels=Math.max(1,Math.floor(h.bpp/bpc))
  for(let ti=0;ti<expectedTiles;ti++){
    const tx=(ti%Math.ceil(rec.width/64))*64,ty=Math.floor(ti/Math.ceil(rec.width/64))*64
    const tw=Math.min(64,rec.width-tx),th=Math.min(64,rec.height-ty)
    const pixels=tw*th,expected=pixels*h.bpp
    const ptr=lev.tiles[ti]
    if(ptr<=0||ptr>=bytes.length)throw new Error('Invalid XCF tile pointer')
    let tile:Uint8Array
    if(compression===0)tile=bytes.subarray(ptr,Math.min(bytes.length,ptr+expected))
    else if(compression===1)tile=rleDecode(bytes.subarray(ptr),pixels,h.bpp)
    else if(compression===2){
      const next=lev.tiles.slice(ti+1).find(v=>v>ptr)
      const packed=bytes.subarray(ptr,next??bytes.length)
      const raw=await inflateZlib(packed)
      tile=raw.length>=expected?raw.subarray(0,expected):raw
    }else throw new Error(`Unsupported XCF compression ${compression}`)
    if(tile.length<expected)throw new Error('Truncated XCF tile payload')
    const view=new DataView(tile.buffer,tile.byteOffset,tile.byteLength)
    void view
    for(let y=0;y<th;y++)for(let x=0;x<tw;x++){
      const pi=y*tw+x,si=pi*h.bpp,di=((ty+y)*rec.width+(tx+x))*4
      const cv=(c:number)=>channelValue(tile,si+c*bpc,bpc,isFloat)
      if(info.base==='rgb'){
        rgba[di]=cv(0);rgba[di+1]=channels>1?cv(1):rgba[di];rgba[di+2]=channels>2?cv(2):rgba[di]
        rgba[di+3]=info.alpha&&channels>3?cv(3):255
      }else if(info.base==='gray'){
        const g=cv(0);rgba[di]=g;rgba[di+1]=g;rgba[di+2]=g;rgba[di+3]=info.alpha&&channels>1?cv(1):255
      }else{
        const idx=cv(0),po=idx*3
        rgba[di]=palette?.[po]??idx;rgba[di+1]=palette?.[po+1]??idx;rgba[di+2]=palette?.[po+2]??idx
        rgba[di+3]=info.alpha&&channels>1?cv(1):255
      }
    }
  }
  const c=createCanvas(rec.width,rec.height)
  ctx2d(c).putImageData(new ImageData(rgba,rec.width,rec.height),0,0)
  return c
}

export async function parseXcf(bytes:Uint8Array,fileName='GIMP XCF'):Promise<ParsedDocument>{
  if(bytes.length<32||ascii(bytes.subarray(0,9))!=='gimp xcf ')throw new Error('Not a GIMP XCF file')
  const versionText=ascii(bytes.subarray(9,13))
  const version=versionText==='file'?0:Number.parseInt(versionText.replace(/^v/,''),10)
  if(!Number.isFinite(version)||version<0||version>999)throw new Error(`Unsupported XCF version ${versionText}`)
  if(bytes[13]!==0)throw new Error('Invalid XCF header terminator')
  const v11=version>=11
  const r=new R(bytes,14)
  const width=r.u32(),height=r.u32(),baseType=r.u32()
  if(width<1||height<1||width*height>268435456)throw new Error('Invalid XCF dimensions')
  const precision=v11?r.u32():undefined
  const mainProps=properties(r)
  const layerPtrs=readPtrList(r,v11)
  // channel pointers follow the layer list; not needed for layer import.
  const compression=mainProps.get(PROP.COMPRESSION)?.data?.[0]??1
  const palette=paletteFrom(mainProps)
  const pinfo=precisionInfo(version,precision)
  const warnings:string[]=[]
  const layers:ParsedDocumentLayer[]=[]

  // XCF stores the layer list in UI stack order (top first). Chay's internal
  // array is bottom first, so decode then reverse.
  for(const ptr of layerPtrs){
    try{
      const rec=layerRecord(bytes,ptr,v11)
      if(rec.props.has(PROP.GROUP_ITEM)||!rec.hierarchy)continue
      const canvas=await layerCanvas(bytes,rec,v11,compression,pinfo.bpc,pinfo.float,palette)
      const [x,y]=propI32Pair(rec.props,PROP.OFFSETS)
      const mode=propU32(rec.props,PROP.MODE,0)
      if(mode>21)warnings.push(`XCF layer “${rec.name}” uses GIMP blend mode id ${mode}; imported as Normal`)
      layers.push({
        kind:'raster',name:rec.name||'Layer',canvas,left:x,top:y,
        visible:propU32(rec.props,PROP.VISIBLE,1)!==0,
        opacity:opacityOf(rec.props),blendMode:blendMode(mode),
        metadata:{sourceFormat:'xcf',xcfVersion:version,layerType:rec.type,blendModeId:mode},
      })
    }catch(error){
      warnings.push(`XCF layer could not be decoded: ${error instanceof Error?error.message:String(error)}`)
    }
  }
  layers.reverse()
  if(!layers.length)throw new Error('XCF parser found no decodable raster layers')
  const sourceBitDepth=pinfo.bits
  return{
    width,height,name:fileName,layers,warnings,
    sourceBitDepth,
    resolutionPpi:resolutionOf(mainProps),
  }
}
