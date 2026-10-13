// Reversible post-demosaic RAW detail corrections. Works on native 16-bit
// integer RGB data when available; 8-bit fallback never promotes precision.
// These display-referred filters are not a substitute for camera-native,
// multi-scale RAW noise modeling or Adobe Lightroom's sharpening engine.
import type { RawImage } from './decoders'

export interface RawDetailSettings {
  luminanceDenoise: number // 0..100
  colorDenoise: number // 0..100
  sharpenAmount: number // 0..200
  sharpenRadius: number // integer 1..3 px at developed resolution
  sharpenThreshold: number // 0..100 maps to 0..0.05 luminance
}
export const DEFAULT_RAW_DETAIL: RawDetailSettings={
  luminanceDenoise:0,colorDenoise:0,sharpenAmount:0,sharpenRadius:1,sharpenThreshold:0,
}
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v))
const number=(raw:unknown,fallback:number,min:number,max:number)=>{
  const n=typeof raw==='number'?raw:NaN
  return Number.isFinite(n)?clamp(n,min,max):fallback
}
export function normalizeRawDetail(raw:Partial<RawDetailSettings>|null|undefined):RawDetailSettings {
  return {
    luminanceDenoise:number(raw?.luminanceDenoise,0,0,100),
    colorDenoise:number(raw?.colorDenoise,0,0,100),
    sharpenAmount:number(raw?.sharpenAmount,0,0,200),
    sharpenRadius:Math.round(number(raw?.sharpenRadius,1,1,3)),
    sharpenThreshold:number(raw?.sharpenThreshold,0,0,100),
  }
}
const luminance=(r:number,g:number,b:number)=>r*0.2126+g*0.7152+b*0.0722
const viewAt=(x:number,y:number,width:number)=>((y*width+x)*4)
const rgbAt=(data:Uint16Array|Uint8ClampedArray,index:number,scale:number)=>
  [data[index]/scale,data[index+1]/scale,data[index+2]/scale] as const

/** Joint-bilateral 3x3 smooth in Y, (R-Y), (B-Y): chroma noise reduction
 * doesn't blur luminance. Neighbors across high-contrast edges contribute
 * less. RGB clipping is bounded, alpha is copied byte-exactly.
 *
 * A box-like multiscale/AI denoiser should eventually replace this conservative
 * CPU fallback. This is intentionally much cheaper than a sensor-domain model.
 */
export function applyRawDetail(image:RawImage,input:Partial<RawDetailSettings>|null|undefined):RawImage {
  const settings=normalizeRawDetail(input)
  if(settings.luminanceDenoise===0&&settings.colorDenoise===0&&settings.sharpenAmount===0)
    return image
  if(image.rgbaFloat||image.sourceColorSpace==='linear-srgb')return image
  const {width,height}=image,count=width*height
  if(!Number.isSafeInteger(count)||count<1||width<1||height<1)return image
  const src=image.rgba16??image.rgba
  if(src.length!==count*4)return image
  const high=!!image.rgba16,scale=high?65535:255
  const lumaAmount=settings.luminanceDenoise/100
  const chromaAmount=settings.colorDenoise/100
  const filtering=lumaAmount>0||chromaAmount>0
  // Used only when denoising is on. High-depth intermediate stays 16 bit.
  const mid=filtering?(high?new Uint16Array(src.length):new Uint8ClampedArray(src.length)):src
  if(filtering){
    const edgeTolerance=0.028+Math.max(lumaAmount,chromaAmount)*0.09
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const idx=viewAt(x,y,width)
      const [r,g,b]=rgbAt(src,idx,scale),centerY=luminance(r,g,b)
      if(src[idx+3]===0){
        for(let c=0;c<4;c++)mid[idx+c]=src[idx+c]
        continue
      }
      let sum=0,sumY=0,sumU=0,sumV=0
      for(let dy=-1;dy<=1;dy++){
        const sy=clamp(y+dy,0,height-1)
        for(let dx=-1;dx<=1;dx++){
          const sx=clamp(x+dx,0,width-1),offset=viewAt(sx,sy,width)
          const alpha=src[offset+3]/scale
          if(alpha===0)continue
          const nr=src[offset]/scale,ng=src[offset+1]/scale,nb=src[offset+2]/scale
          const ny=luminance(nr,ng,nb),delta=(ny-centerY)/edgeTolerance
          const weight=(dx===0&&dy===0?1:dx===0||dy===0?0.74:0.55)*alpha/(1+delta*delta*4)
          sum+=weight;sumY+=ny*weight;sumU+=(nr-ny)*weight;sumV+=(nb-ny)*weight
        }
      }
      const smoothY=sum>0?sumY/sum:centerY
      const targetY=centerY+(smoothY-centerY)*lumaAmount
      const u=(r-centerY)*(1-chromaAmount)+(sum>0?sumU/sum:r-centerY)*chromaAmount
      const v=(b-centerY)*(1-chromaAmount)+(sum>0?sumV/sum:b-centerY)*chromaAmount
      // Reconstitute G so the intended luminance is retained.
      const nr=clamp(targetY+u,0,1),nb=clamp(targetY+v,0,1)
      const ng=clamp((targetY-nr*0.2126-nb*0.0722)/0.7152,0,1)
      mid[idx]=Math.round(nr*scale);mid[idx+1]=Math.round(ng*scale)
      mid[idx+2]=Math.round(nb*scale);mid[idx+3]=src[idx+3]
    }
  }
  let dest:Uint16Array|Uint8ClampedArray=mid
  if(settings.sharpenAmount>0){
    dest=high?new Uint16Array(src.length):new Uint8ClampedArray(src.length)
    const amount=settings.sharpenAmount/100
    const radius=settings.sharpenRadius
    const threshold=settings.sharpenThreshold/2000
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const idx=viewAt(x,y,width)
      const r=mid[idx]/scale,g=mid[idx+1]/scale,b=mid[idx+2]/scale
      const center=luminance(r,g,b)
      if(mid[idx+3]===0){
        for(let c=0;c<4;c++)dest[idx+c]=mid[idx+c]
        continue
      }
      let sum=center*4,weights=4
      for(const [dx,dy] of [[-radius,0],[radius,0],[0,-radius],[0,radius]]){
        const ix=clamp(x+dx,0,width-1),iy=clamp(y+dy,0,height-1)
        const neighbor=viewAt(ix,iy,width)
        const w=mid[neighbor+3]/scale
        if(w===0)continue
        sum+=luminance(mid[neighbor]/scale,mid[neighbor+1]/scale,mid[neighbor+2]/scale)*w
        weights+=w
      }
      const difference=center-sum/weights
      const delta=Math.sign(difference)*Math.max(0,Math.abs(difference)-threshold)*amount
      // Uniform luminance correction avoids inventing color at edges.
      const result=clamp(delta,-0.25,0.25)
      dest[idx]=Math.round(clamp(r+result,0,1)*scale)
      dest[idx+1]=Math.round(clamp(g+result,0,1)*scale)
      dest[idx+2]=Math.round(clamp(b+result,0,1)*scale)
      dest[idx+3]=mid[idx+3]
    }
  }
  if(high){
    const rgba16=dest as Uint16Array
    const rgba=new Uint8ClampedArray(dest.length)
    for(let i=0;i<dest.length;i++)rgba[i]=Math.round(dest[i]/257)
    return {...image,rgba:rgba as Uint8ClampedArray<ArrayBuffer>,rgba16}
  }
  return {...image,rgba:dest as Uint8ClampedArray<ArrayBuffer>,rgba16:undefined}
}
