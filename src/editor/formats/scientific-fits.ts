// FITS astronomy import: big-endian primary images and basic data cubes.
// Rendering uses a percentile stretch; original calibrated values are not preserved.
import type { RawImage } from './decoders'
export interface ScientificImage { image: RawImage; frames: RawImage[]; warnings: string[] }
const text = (b: Uint8Array, p: number, n: number) => new TextDecoder('latin1').decode(b.subarray(p,p+n))
function check(w:number,h:number) {
  if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||w*h>64*1024*1024) throw Error('Invalid FITS dimensions')
  return w*h
}
export function stretchScientific(data:Float64Array, invert=false, low?:number, high?:number):Uint8ClampedArray {
  const samples:number[]=[]
  const step=Math.max(1,Math.floor(data.length/65536))
  for(let i=0;i<data.length;i+=step) if(Number.isFinite(data[i])) samples.push(data[i])
  if(!samples.length) throw Error('No finite image samples')
  if(low===undefined||high===undefined){
    samples.sort((a,b)=>a-b)
    low=samples[Math.floor((samples.length-1)*0.005)]
    high=samples[Math.floor((samples.length-1)*0.995)]
  }
  if(!(high>low)) high=low+1
  const out=new Uint8ClampedArray(data.length*4)
  for(let i=0;i<data.length;i++){
    const normalized=Number.isFinite(data[i])?Math.max(0,Math.min(1,(data[i]-low)/(high-low))):0
    const shade=Math.round((invert?1-normalized:normalized)*255)
    out[i*4]=out[i*4+1]=out[i*4+2]=shade
    out[i*4+3]=255
  }
  return out
}
export function decodeFits(bytes:Uint8Array):ScientificImage {
  if(bytes.length<2880 || !text(bytes,0,9).startsWith('SIMPLE  =')) throw Error('Not a FITS primary image')
  const header=new Map<string,string>()
  let start=-1
  for(let p=0;p+80<=bytes.length && p<=2880*256;p+=80){
    const key=text(bytes,p,8).trim()
    if(key==='END'){start=Math.ceil((p+80)/2880)*2880;break}
    if(text(bytes,p+8,2)==='= ') header.set(key,text(bytes,p+10,70).split('/')[0].trim())
  }
  if(start<0) throw Error('FITS END card is missing')
  const bitpix=Number(header.get('BITPIX')), axes=Number(header.get('NAXIS'))
  const w=Number(header.get('NAXIS1')),h=Number(header.get('NAXIS2')),count=check(w,h)
  if(![-64,-32,8,16,32,64].includes(bitpix)||!Number.isInteger(axes)||axes<2||axes>3) throw Error('Unsupported FITS dimensions/BITPIX')
  const slices=axes===3?Number(header.get('NAXIS3')):1
  if(!Number.isSafeInteger(slices)||slices<1) throw Error('Invalid FITS cube')
  const bpp=Math.abs(bitpix)/8
  if(start>bytes.length||slices*count*bpp>bytes.length-start) throw Error('Truncated FITS data')
  const zero=Number(header.get('BZERO')??0),scale=Number(header.get('BSCALE')??1)
  if(!Number.isFinite(zero)||!Number.isFinite(scale)) throw Error('Invalid FITS calibration')
  const blank=header.has('BLANK')?Number(header.get('BLANK')):undefined
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  const frames:RawImage[]=[]
  const imported=Math.min(slices,24)
  for(let z=0;z<imported;z++){
    const values=new Float64Array(count)
    const offset=start+z*count*bpp
    for(let i=0;i<count;i++){
      const p=offset+i*bpp
      let x:number
      switch(bitpix){
        case 8:x=v.getUint8(p);break
        case 16:x=v.getInt16(p,false);break
        case 32:x=v.getInt32(p,false);break
        case 64:x=Number(v.getBigInt64(p,false));break
        case -32:x=v.getFloat32(p,false);break
        default:x=v.getFloat64(p,false)
      }
      values[i]=x===blank?NaN:x*scale+zero
    }
    frames.push({width:w,height:h,rgba:stretchScientific(values) as Uint8ClampedArray<ArrayBuffer>,sourceBitDepth:8})
  }
  return {
    image:frames[0],frames,
    warnings:['FITS image data has been contrast-stretched into display RGB; original scientific samples are not retained.',
      ...(slices>imported?['Only first '+imported+' FITS planes imported.']:[])],
  }
}
