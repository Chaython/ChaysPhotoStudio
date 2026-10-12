// Display-referred, reversible five-knot RAW point curves.
// This is not a substitute for camera-space tone mapping or ICC transforms.
import type { RawImage } from './decoders'

export const RAW_CURVE_CHANNELS = ['rgb','red','green','blue'] as const
export type RawCurveChannel = typeof RAW_CURVE_CHANNELS[number]
export type RawCurvePoints = [number,number,number,number,number]
export type RawPointCurves = Record<RawCurveChannel, RawCurvePoints>
const makeIdentity = (): RawCurvePoints => [0,25,50,75,100]
export const DEFAULT_RAW_CURVES: RawPointCurves = {
  rgb:makeIdentity(),red:makeIdentity(),green:makeIdentity(),blue:makeIdentity(),
}
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value))
const identity=makeIdentity()
/** Store five fixed-X output levels (0..100). Bad or older recipes are neutral. */
export function normalizeRawCurves(value:Partial<Record<RawCurveChannel,unknown>>|null|undefined):RawPointCurves {
  const result={} as RawPointCurves
  for(const channel of RAW_CURVE_CHANNELS){
    const incoming=value?.[channel]
    if(!Array.isArray(incoming)||incoming.length!==5){
      result[channel]=makeIdentity()
      continue
    }
    result[channel]=incoming.map((raw,i)=>{
      const num=typeof raw==='number'?raw:NaN
      return Number.isFinite(num)?clamp(num,0,100):identity[i]
    }) as RawCurvePoints
  }
  return result
}
export const hasRawCurves=(value:RawPointCurves):boolean=>
  RAW_CURVE_CHANNELS.some(channel=>value[channel].some((n,i)=>n!==identity[i]))

/** Monotone cubic Hermite interpolation on uniformly spaced X knots.
 * Slopes vanish at local turning points to avoid cubic overshoot. Deliberately
 * supports creative non-monotonic curves, but bounds all output to [0,1]. */
export function evaluateRawCurve(points:RawCurvePoints,x:number):number {
  const t=clamp(Number.isFinite(x)?x:0,0,1)*4
  const index=Math.min(3,Math.floor(t))
  const u=t-index
  const y=points.map(v=>v/100)
  const slope=[0,0,0,0] as number[]
  for(let i=0;i<4;i++)slope[i]=y[i+1]-y[i]
  const derivative=[0,0,0,0,0]
  derivative[0]=slope[0];derivative[4]=slope[3]
  for(let i=1;i<4;i++){
    const a=slope[i-1],b=slope[i]
    derivative[i]=a*b<=0?0:2*a*b/(a+b)
  }
  const h00=(1+2*u)*(1-u)*(1-u)
  const h10=u*(1-u)*(1-u)
  const h01=u*u*(3-2*u)
  const h11=u*u*(u-1)
  return clamp(h00*y[index]+h10*derivative[index]+h01*y[index+1]+h11*derivative[index+1],0,1)
}

/** Composite curve first, then per-channel RGB curves. Supports high-depth
 * integer buffers; alpha and the source buffers remain unchanged. */
export function applyRawCurves(image:RawImage,raw:Partial<RawPointCurves>|null|undefined):RawImage {
  const curves=normalizeRawCurves(raw)
  if(!hasRawCurves(curves)||image.rgbaFloat||image.sourceColorSpace==='linear-srgb')return image
  const src=image.rgba16??image.rgba
  const width=image.width,height=image.height,pixels=width*height
  if(!Number.isSafeInteger(pixels)||pixels<1||src.length!==pixels*4)return image
  const high=!!image.rgba16,range=high?65535:255
  const tables:Uint16Array[]=[]
  for(let channel=1;channel<4;channel++){
    const result=new Uint16Array(range+1)
    for(let i=0;i<=range;i++){
      const first=evaluateRawCurve(curves.rgb,i/range)
      const second=evaluateRawCurve(curves[RAW_CURVE_CHANNELS[channel]],first)
      result[i]=Math.round(second*range)
    }
    tables.push(result)
  }
  const dest8=new Uint8ClampedArray(src.length)
  const dest16=high?new Uint16Array(src.length):undefined
  for(let i=0;i<src.length;i+=4){
    for(let channel=0;channel<3;channel++){
      const value=tables[channel][src[i+channel]]
      dest8[i+channel]=high?Math.round(value/257):value
      if(dest16)dest16[i+channel]=value
    }
    dest8[i+3]=high?Math.round(src[i+3]/257):src[i+3]
    if(dest16)dest16[i+3]=src[i+3]
  }
  return {...image,rgba:dest8 as Uint8ClampedArray<ArrayBuffer>,rgba16:dest16}
}
