// Non-destructive *parameters* stored with camera RAW Smart Objects.
// Explicit user-calibrated coefficients, NOT a substitute for calibrated Lensfun profiles.
import type { RawImage } from './decoders'
import type { LensfunCalibration } from './lensfun-xml'

export interface LensProfile {
  /** User supplied identity, e.g. camera/lens + focal length; never auto-claimed. */
  name: string
  /** Brown radial forward/inverse-map approximation: k1*r² + k2*r⁴. */
  k1: number
  k2: number
  /** Relative radial magnification difference, red vs blue (green is anchor). */
  tca: number
  /** Radial exposure compensation strength. */
  vignette: number
  /** Matched, source-identified Lensfun calibration (optional). */
  lensfun?: LensfunCalibration
}

export const DEFAULT_LENS_PROFILE: LensProfile = { name: '', k1: 0, k2: 0, tca: 0, vignette: 0 }

const finite = (value:unknown,min:number,max:number) => {
  const n=Number(value)
  return Number.isFinite(n)?Math.max(min,Math.min(max,n)):0
}
export function normalizeLensProfile(value:Partial<LensProfile>|null|undefined):LensProfile {
  return {
    name:typeof value?.name==='string'?value.name.trim().slice(0,120):'',
    k1:finite(value?.k1,-0.5,0.5),
    k2:finite(value?.k2,-0.25,0.25),
    tca:finite(value?.tca,-0.05,0.05),
    vignette:finite(value?.vignette,-0.6,0.6),
    lensfun:value?.lensfun?.source==='lensfun-xml'?structuredClone(value.lensfun):undefined,
  }
}
export const hasLensCorrections=(p:LensProfile):boolean=>
  p.k1!==0||p.k2!==0||p.tca!==0||p.vignette!==0||!!p.lensfun?.distortion||!!p.lensfun?.tca||!!p.lensfun?.vignetting

/** Remap per channel so distortion and transverse CA stay undoable by redeveloping RAW.
 *  Source remains untouched, output keeps its 16-bit/float backing array. */
export function applyLensProfile(image:RawImage,input:LensProfile):RawImage {
  const p=normalizeLensProfile(input)
  if(!hasLensCorrections(p))return image
  const {width:w,height:h}=image
  if(w<2||h<2) return image
  const pixels=w*h
  const src16=image.rgba16,srcFloat=image.rgbaFloat
  const dst16=src16?new Uint16Array(pixels*4):undefined
  const dstFloat=srcFloat?new Float32Array(pixels*4):undefined
  const out8=new Uint8ClampedArray(pixels*4)
  const cx=(w-1)/2,cy=(h-1)/2,norm=Math.max(cx,cy)
  const read=(array:Uint8ClampedArray|Uint16Array|Float32Array,x:number,y:number,c:number):number=>{
    // Edge clamp is preferable to black wedges for small profile corrections.
    const px=Math.max(0,Math.min(w-1,x)),py=Math.max(0,Math.min(h-1,y))
    const x0=Math.floor(px),y0=Math.floor(py),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1)
    const tx=px-x0,ty=py-y0
    const a=array[(y0*w+x0)*4+c],b=array[(y0*w+x1)*4+c]
    const d=array[(y1*w+x0)*4+c],e=array[(y1*w+x1)*4+c]
    return (a*(1-tx)+b*tx)*(1-ty)+(d*(1-tx)+e*tx)*ty
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const dx=(x-cx)/norm,dy=(y-cy)/norm,r2=dx*dx+dy*dy
    const r=Math.sqrt(r2)
    const cal=p.lensfun
    let radial=1+p.k1*r2+p.k2*r2*r2
    if(cal?.distortion){
      const d=cal.distortion
      // Lensfun polynomial correction maps; input stays untouched.
      if(d.model==='poly3')radial*=1-(d.k1??0)+(d.k1??0)*r2
      if(d.model==='ptlens')radial*=1-(d.a??0)-(d.b??0)-(d.c??0)+
        (d.c??0)*r+(d.b??0)*r2+(d.a??0)*r2*r
    }
    let gain=Math.max(0.1,Math.min(4,1+p.vignette*r2))
    if(cal?.vignetting?.model==='pa'){
      const v=cal.vignetting
      const attenuation=1+(v.k1??0)*r2+(v.k2??0)*r2*r2+(v.k3??0)*r2*r2*r2
      gain*=Math.max(0.1,Math.min(4,1/Math.max(0.1,attenuation)))
    }
    const dst=(y*w+x)*4
    for(let c=0;c<4;c++){
      const shift=c===0?p.tca:c===2?-p.tca:0
      let magnification=c===3?radial:radial+shift*r2
      if(c!==3&&cal?.tca){
        const t=cal.tca
        const factor=c===0?(t.vr??1)+(t.br??0)*r2:
          c===2?(t.vb??1)+(t.bb??0)*r2:1
        magnification*=factor
      }
      const sx=cx+(x-cx)*magnification
      const sy=cy+(y-cy)*magnification
      const correction=c===3?1:gain
      if(dst16)dst16[dst+c]=Math.max(0,Math.min(65535,Math.round(read(src16!,sx,sy,c)*correction)))
      if(dstFloat)dstFloat[dst+c]=read(srcFloat!,sx,sy,c)*correction
      const v=dst16?dst16[dst+c]/257:dstFloat?dstFloat[dst+c]*255:read(image.rgba,sx,sy,c)*correction
      out8[dst+c]=Math.max(0,Math.min(255,Math.round(v)))
    }
  }
  return {...image,rgba:out8 as Uint8ClampedArray<ArrayBuffer>,rgba16:dst16,rgbaFloat:dstFloat}
}
