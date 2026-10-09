// Optional heavy codecs. Importing this module does not load their WASM payloads.
// Each decoder module is fetched only after the user opens that format.
import type { RawImage } from './decoders'
import type { RawDevelopSettings } from './raw-develop'
import { DEFAULT_RAW_SETTINGS, normalizeRawSettings } from './raw-develop'

function shape(width:number,height:number){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>64*1024*1024)
    throw Error('Decoder returned unsafe image dimensions')
  return width*height
}
function fromImageData(data:ImageData):RawImage{
  shape(data.width,data.height)
  if(data.data.length!==data.width*data.height*4)throw Error('Decoder returned invalid RGBA pixels')
  return {width:data.width,height:data.height,rgba:new Uint8ClampedArray(data.data) as Uint8ClampedArray<ArrayBuffer>,sourceBitDepth:8}
}

/** Full LibRaw sensor unpack/demosaic, producing native 16-bit RGBA samples. */
export async function decodeCameraRaw(buffer:ArrayBuffer,options?:RawDevelopSettings):Promise<RawImage>{
  const settings=normalizeRawSettings(options ?? DEFAULT_RAW_SETTINGS)
  const {default:LibRaw}=await import('libraw-wasm')
  const decoder=new LibRaw()
  try{
    await decoder.open(new Uint8Array(buffer),{
      outputBps:16,outputColor:1,
      useCameraWb:settings.whiteBalance==='camera',
      useAutoWb:settings.whiteBalance==='auto',
      noAutoBright:true,
      userQual:settings.interpolation,
      highlight:settings.highlight,
      threshold:settings.denoise,
      halfSize:settings.halfSize,
      expCorrec:settings.exposureEv!==0,
      expShift:Math.pow(2,settings.exposureEv),
      expPreser:settings.highlight>0?0.5:0,
    })
    const output=await decoder.imageData()
    if(!output)throw Error('LibRaw returned no processed image')
    const {width,height,colors,bits,data}=output
    const pixels=shape(width,height)
    if(colors!==3&&colors!==4&&colors!==1)throw Error('Unsupported LibRaw output component count')
    if(bits!==8&&bits!==16)throw Error('Unsupported LibRaw output bit depth')
    if(data.length!==pixels*colors)throw Error('Truncated LibRaw output pixels')
    const rgba=new Uint8ClampedArray(pixels*4)
    const rgba16=bits===16?new Uint16Array(pixels*4):undefined
    for(let i=0;i<pixels;i++){
      const src=i*colors,dst=i*4
      for(let c=0;c<3;c++){
        const value=data[src+(colors===1?0:c)]
        rgba[dst+c]=bits===16?Math.round(value/257):value
        if(rgba16)rgba16[dst+c]=value
      }
      const alpha=colors===4?data[src+3]:bits===16?65535:255
      rgba[dst+3]=bits===16?Math.round(alpha/257):alpha
      if(rgba16)rgba16[dst+3]=alpha
    }
    return {
      width,height,rgba:rgba as Uint8ClampedArray<ArrayBuffer>,rgba16,
      sourceBitDepth:bits,
    }
  }finally{decoder.dispose()}
}

export async function decodeModernWasm(buffer:ArrayBuffer,format:'jxl'|'heic'|'jxr'):Promise<RawImage>{
  let decoded:ImageData
  if(format==='jxl'){
    const codecModule=await import('@jsquash/jxl')
    decoded=await codecModule.decode(buffer)
  }else if(format==='heic'){
    const codecModule=await import('@discourse/heic')
    decoded=await codecModule.decode(buffer)
  }else{
    const codecModule=await import('@discourse/jxr')
    decoded=await codecModule.decode(buffer)
  }
  return fromImageData(decoded)
}

/** JPEG-LS ISO/IEC 14495 using CharLS. Grayscale and sample-interleaved RGB. */
export async function decodeJpegLs(buffer:ArrayBuffer):Promise<RawImage>{
  const {createJpegLSDecoder}=await import('@team-charls/charls-wasm')
  const decoder=await createJpegLSDecoder()
  const decoded=decoder.decode(new Uint8Array(buffer))
  const info=decoder.getFrameInfo()
  const {width,height,bitsPerSample,componentCount}=info
  const count=shape(width,height)
  if(![1,3].includes(componentCount)||bitsPerSample<1||bitsPerSample>16)
    throw Error('Unsupported JPEG-LS frame layout')
  if(componentCount===3 && decoder.getInterleaveMode()!==2)
    throw Error('JPEG-LS planar/line-interleaved RGB is not supported by this importer')
  const rgba=new Uint8ClampedArray(count*4)
  const bps=bitsPerSample<=8?1:2
  if(decoded.byteLength<count*componentCount*bps)throw Error('Truncated JPEG-LS samples')
  const view=new DataView(decoded.buffer,decoded.byteOffset,decoded.byteLength)
  const scale=(sample:number)=>Math.round(sample*255/(2**bitsPerSample-1))
  for(let i=0;i<count;i++){
    for(let c=0;c<3;c++){
      const sampleIndex=i*componentCount+(componentCount===1?0:c)
      const raw=sampleIndex*bps
      const sample=bps===1?decoded[raw]:view.getUint16(raw,true)
      rgba[i*4+c]=scale(sample)
    }
    rgba[i*4+3]=255
  }
  return {width,height,rgba:rgba as Uint8ClampedArray<ArrayBuffer>,sourceBitDepth:bitsPerSample}
}

/** Pure-JavaScript JP2/J2K decoder. Tiles must be 8-bit contiguous RGB/grayscale. */
export async function decodeJpeg2000(buffer:ArrayBuffer):Promise<RawImage>{
  const {JpxImage}=await import('jpeg2000')
  const decoder=new JpxImage()
  decoder.parse(new Uint8Array(buffer))
  const width=decoder.width,height=decoder.height
  const count=shape(width,height),colors=decoder.componentsCount
  if(![1,3,4].includes(colors))throw Error('Unsupported JPEG 2000 color layout')
  const rgba=new Uint8ClampedArray(count*4)
  for(const tile of decoder.tiles){
    const tileWidth=tile.width,tileHeight=tile.height
    if(!tile.items||tile.items.length!==tileWidth*tileHeight*colors)
      throw Error('JPEG 2000 decoder returned an unsupported tile')
    for(let y=0;y<tileHeight;y++)for(let x=0;x<tileWidth;x++){
      const destX=tile.left+x,destY=tile.top+y
      if(destX<0||destY<0||destX>=width||destY>=height)throw Error('Invalid JPEG 2000 tile position')
      const dst=(destY*width+destX)*4,src=(y*tileWidth+x)*colors
      for(let c=0;c<3;c++)rgba[dst+c]=tile.items[src+(colors===1?0:c)]
      rgba[dst+3]=colors===4?tile.items[src+3]:255
    }
  }
  return {width,height,rgba:rgba as Uint8ClampedArray<ArrayBuffer>,sourceBitDepth:8}
}
