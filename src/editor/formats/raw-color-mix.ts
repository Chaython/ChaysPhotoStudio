// Camera RAW Color Mixer: eight hue sectors, each with hue / saturation /
// luminance. Operates on display-referred, post-demosaic sRGB samples; not a
// substitute for calibrated DCP/ICC camera color profiles.
import type { RawImage } from './decoders'

export const RAW_MIX_BANDS = ['red','orange','yellow','green','aqua','blue','purple','magenta'] as const
export type RawMixBand = typeof RAW_MIX_BANDS[number]
export type RawMixChannel = { hue: number; saturation: number; luminance: number }
export type RawColorMix = Record<RawMixBand, RawMixChannel>
const neutral = (): RawMixChannel => ({hue:0,saturation:0,luminance:0})
export const DEFAULT_RAW_COLOR_MIX: RawColorMix = {
  red:neutral(),orange:neutral(),yellow:neutral(),green:neutral(),
  aqua:neutral(),blue:neutral(),purple:neutral(),magenta:neutral(),
}
const clamp = (n:number,min:number,max:number) => Math.max(min,Math.min(max,n))
const normalized = (v:unknown):number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? clamp(n,-100,100) : 0
}
export function normalizeRawColorMix(value: Partial<Record<RawMixBand, Partial<RawMixChannel>>> | undefined | null): RawColorMix {
  return Object.fromEntries(RAW_MIX_BANDS.map(band => {
    const v=value?.[band]
    return [band,{hue:normalized(v?.hue),saturation:normalized(v?.saturation),luminance:normalized(v?.luminance)}]
  })) as RawColorMix
}
export function hasRawColorMix(settings:RawColorMix):boolean {
  return RAW_MIX_BANDS.some(b => {
    const c=settings[b]
    return c.hue!==0 || c.saturation!==0 || c.luminance!==0
  })
}
const centers = [0,30,60,120,180,240,275,315] as const
const influence = (h:number, center:number):number => {
  const distance=Math.abs(h-center)
  const d=Math.min(distance,360-distance)
  if(d>=45)return 0
  const t=1-d/45
  return t*t*(3-2*t)
}
/** Safe no-op when all sliders are neutral. HSL color-mix is an optional stage,
 * retained at 16 bits and never applied to the original embedded RAW file. */
export function applyRawColorMix(image:RawImage,input:Partial<RawColorMix>|undefined):RawImage {
  const settings=normalizeRawColorMix(input)
  if(!hasRawColorMix(settings) || image.rgbaFloat || image.sourceColorSpace==='linear-srgb')return image
  const {width,height}=image,pixels=width*height
  const src=image.rgba16??image.rgba
  if(!Number.isSafeInteger(pixels)||pixels<=0||src.length!==pixels*4)return image
  const high=!!image.rgba16,scale=high?65535:255
  const out16=high?new Uint16Array(src.length):undefined
  const out8=new Uint8ClampedArray(src.length)
  const active=RAW_MIX_BANDS.map((band,index)=>({center:centers[index],...settings[band]}))
    .filter(channel=>channel.hue!==0||channel.saturation!==0||channel.luminance!==0)
  for(let i=0;i<src.length;i+=4){
    let r=src[i]/scale,g=src[i+1]/scale,b=src[i+2]/scale
    const max=Math.max(r,g,b),min=Math.min(r,g,b),difference=max-min
    let lightness=(max+min)/2
    // Achromatic colors have no hue, so Color Mix must not tint them.
    if(difference>1e-8){
      let hue=max===r?((g-b)/difference)%6:max===g?(b-r)/difference+2:(r-g)/difference+4
      hue=(hue*60+360)%360
      let saturation=difference/(1-Math.abs(2*lightness-1))
      let hueDelta=0,satDelta=0,lumDelta=0
      for(const channel of active){
        const w=influence(hue,channel.center)
        hueDelta+=channel.hue*0.3*w
        satDelta+=channel.saturation*0.01*w
        lumDelta+=channel.luminance*0.01*w
      }
      saturation=satDelta<0?saturation*(1+clamp(satDelta,-1,0)):
        saturation+(1-saturation)*clamp(satDelta,0,1)
      lightness=lumDelta<0?lightness*(1+clamp(lumDelta,-1,0)):
        lightness+(1-lightness)*clamp(lumDelta,0,1)
      hue=(hue+clamp(hueDelta,-45,45)+360)%360
      const chroma=(1-Math.abs(2*lightness-1))*clamp(saturation,0,1)
      const x=chroma*(1-Math.abs((hue/60)%2-1))
      const m=lightness-chroma/2
      const sector=Math.floor(hue/60)%6
      const rgb=sector===0?[chroma,x,0]:sector===1?[x,chroma,0]:
        sector===2?[0,chroma,x]:sector===3?[0,x,chroma]:
        sector===4?[x,0,chroma]:[chroma,0,x]
      r=clamp(rgb[0]+m,0,1)
      g=clamp(rgb[1]+m,0,1)
      b=clamp(rgb[2]+m,0,1)
    }
    if(out16){
      out16[i]=Math.round(r*65535);out16[i+1]=Math.round(g*65535);out16[i+2]=Math.round(b*65535)
      out16[i+3]=src[i+3]
      out8[i]=Math.round(out16[i]/257);out8[i+1]=Math.round(out16[i+1]/257);out8[i+2]=Math.round(out16[i+2]/257)
      out8[i+3]=Math.round(out16[i+3]/257)
    }else{
      out8[i]=Math.round(r*255);out8[i+1]=Math.round(g*255);out8[i+2]=Math.round(b*255);out8[i+3]=src[i+3]
    }
  }
  return {...image,rgba:out8 as Uint8ClampedArray<ArrayBuffer>,rgba16:out16}
}
