// Non-destructive local photographic masks for LibRaw-developed sRGB images.
// Coordinates are normalized to the current developed frame, not sensor CFA
// locations. Masks are applied after global tone, curves and Color Mixer.
import type { RawImage } from './decoders'

export interface RawBrushPoint { x:number; y:number }
export interface RawBrushStroke {
  mode:'add' | 'erase'
  /** Brush diameter and feather as percentages (0..100). */
  size:number
  feather:number
  points:RawBrushPoint[]
}
export const MAX_RAW_BRUSH_STROKES = 48
export const MAX_RAW_BRUSH_POINTS = 128
export interface RawLocalMask {
  id: string
  name: string
  enabled: boolean
  kind: 'radial' | 'linear' | 'brush'
  invert: boolean
  /** Coordinates and ellipse radii in 0..1 fractions of developed image size. */
  x: number
  y: number
  x2: number
  y2: number
  radiusX: number
  radiusY: number
  feather: number
  strength: number
  exposureEv: number
  saturation: number
  warmth: number
  strokes?: RawBrushStroke[]
}
export const MAX_RAW_LOCAL_MASKS = 8
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v))
const finite=(raw:unknown,fallback:number,min:number,max:number):number=>
  typeof raw==='number' && Number.isFinite(raw)?clamp(raw,min,max):fallback
const safeName=(raw:unknown)=>typeof raw==='string'?raw.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,64):''
export function makeRawLocalMask(kind:'radial'|'linear'|'brush',id:string):RawLocalMask {
  return {id,name:kind==='radial'?'Radial mask':kind==='linear'?'Linear gradient':'Brush mask',
    enabled:true,kind,invert:false,x:kind==='radial'?0.5:0.25,y:kind==='radial'?0.5:0.25,
    x2:0.75,y2:0.75,radiusX:0.35,radiusY:0.35,feather:0.4,
    strength:100,exposureEv:0,saturation:0,warmth:0,strokes:kind==='brush'?[]:undefined}
}
export function normalizeRawBrushStrokes(raw:unknown):RawBrushStroke[] {
  if(!Array.isArray(raw))return []
  const strokes:RawBrushStroke[]=[]
  for(const item of raw.slice(0,MAX_RAW_BRUSH_STROKES)){
    if(!item || typeof item!=='object' || !Array.isArray(item.points))continue
    const points:RawBrushPoint[]=[]
    for(const value of item.points.slice(0,MAX_RAW_BRUSH_POINTS)){
      if(!value||typeof value!=='object'||typeof value.x!=='number'||
        typeof value.y!=='number'||!Number.isFinite(value.x)||!Number.isFinite(value.y))continue
      points.push({x:clamp(value.x,0,1),y:clamp(value.y,0,1)})
    }
    if(!points.length)continue
    strokes.push({mode:item.mode==='erase'?'erase':'add',
      size:finite(item.size,8,1,40),feather:finite(item.feather,0.4,0,1),points})
  }
  return strokes
}
export function normalizeRawLocalMasks(raw:unknown):RawLocalMask[] {
  if(!Array.isArray(raw))return []
  const seen=new Set<string>()
  const result:RawLocalMask[]=[]
  for(let index=0;index<raw.length && result.length<MAX_RAW_LOCAL_MASKS;index++){
    const obj=raw[index]
    if(!obj || typeof obj!=='object' || (obj.kind!=='radial'&&obj.kind!=='linear'&&obj.kind!=='brush'))continue
    const fallback=makeRawLocalMask(obj.kind,'mask-'+(index+1))
    const candidateId=typeof obj.id==='string'?obj.id.trim().slice(0,64):''
    const id=candidateId && /^[a-zA-Z0-9_-]+$/.test(candidateId) && !seen.has(candidateId)
      ? candidateId : fallback.id
    if(seen.has(id))continue
    seen.add(id)
    result.push({
      id,name:safeName(obj.name)||fallback.name,kind:obj.kind,
      enabled:obj.enabled!==false,invert:obj.invert===true,
      x:finite(obj.x,fallback.x,0,1),y:finite(obj.y,fallback.y,0,1),
      x2:finite(obj.x2,fallback.x2,0,1),y2:finite(obj.y2,fallback.y2,0,1),
      radiusX:finite(obj.radiusX,fallback.radiusX,0.01,1),
      radiusY:finite(obj.radiusY,fallback.radiusY,0.01,1),
      feather:finite(obj.feather,fallback.feather,0,1),
      strength:finite(obj.strength,fallback.strength,0,100),
      exposureEv:finite(obj.exposureEv,0,-3,3),
      saturation:finite(obj.saturation,0,-100,100),
      warmth:finite(obj.warmth,0,-100,100),
      strokes:obj.kind==='brush'?normalizeRawBrushStrokes(obj.strokes):undefined,
    })
  }
  return result
}
const smooth=(x:number)=>{const t=clamp(x,0,1);return t*t*(3-2*t)}
/** Mask coverage at normalized frame coordinates, with safe zero-length line.
 * Radial radius is elliptical, with feather forming an inward blend margin.
 * Linear gradient fades from start (100%) to end (0%). */
export function rawMaskCoverage(mask:RawLocalMask,x:number,y:number):number {
  let coverage=0
  if(mask.kind==='brush')return 0 // brush requires frame dimensions
  if(mask.kind==='radial'){
    const dx=(x-mask.x)/mask.radiusX,dy=(y-mask.y)/mask.radiusY
    const radius=Math.sqrt(dx*dx+dy*dy),inner=1-mask.feather
    coverage=mask.feather<=0?(radius<=1?1:0):1-smooth((radius-inner)/mask.feather)
  }else{
    const dx=mask.x2-mask.x,dy=mask.y2-mask.y,denom=dx*dx+dy*dy
    // Coincident endpoints have no meaningful direction. Reject as neutral,
    // rather than affecting the entire photo unintentionally.
    if(denom<1e-8)return 0
    const projection=((x-mask.x)*dx+(y-mask.y)*dy)/denom
    coverage=1-smooth(projection)
  }
  return (mask.invert?1-coverage:coverage)*mask.strength/100
}
// Spatial index for brush segments: each 64×64 tile only contains dabs
// intersecting that tile. Avoid O(image pixels × every saved stroke point).
interface BrushSegment {
  x1:number;y1:number;x2:number;y2:number;radius:number;feather:number;erase:boolean
}
const BRUSH_TILE = 64
function indexedBrush(mask:RawLocalMask,width:number,height:number):{
  buckets:Map<number,BrushSegment[]>; tilesWide:number
} {
  const buckets=new Map<number,BrushSegment[]>()
  const tilesWide=Math.ceil(width/BRUSH_TILE)
  const tilesHigh=Math.ceil(height/BRUSH_TILE)
  for(const stroke of mask.strokes??[]){
    const radius=Math.max(0.5,stroke.size/200*Math.min(width,height))
    for(let i=0;i<stroke.points.length;i++){
      const first=stroke.points[Math.max(0,i-1)],last=stroke.points[i]
      const segment:BrushSegment={
        x1:first.x*width,y1:first.y*height,x2:last.x*width,y2:last.y*height,
        radius,feather:stroke.feather,erase:stroke.mode==='erase',
      }
      const x0=Math.max(0,Math.floor((Math.min(segment.x1,segment.x2)-radius)/BRUSH_TILE))
      const x1=Math.min(tilesWide-1,Math.floor((Math.max(segment.x1,segment.x2)+radius)/BRUSH_TILE))
      const y0=Math.max(0,Math.floor((Math.min(segment.y1,segment.y2)-radius)/BRUSH_TILE))
      const y1=Math.min(tilesHigh-1,Math.floor((Math.max(segment.y1,segment.y2)+radius)/BRUSH_TILE))
      for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){
        const key=ty*tilesWide+tx
        const bucket=buckets.get(key)
        if(bucket)bucket.push(segment)
        else buckets.set(key,[segment])
      }
    }
  }
  return {buckets,tilesWide}
}
function brushCoverage(segments:readonly BrushSegment[]|undefined,x:number,y:number):number {
  let coverage=0
  if(!segments)return 0
  for(const s of segments){
    const vx=s.x2-s.x1,vy=s.y2-s.y1,length=vx*vx+vy*vy
    const t=length>1e-8?clamp(((x-s.x1)*vx+(y-s.y1)*vy)/length,0,1):0
    const dx=x-(s.x1+vx*t),dy=y-(s.y1+vy*t)
    const distance=Math.sqrt(dx*dx+dy*dy)
    if(distance>s.radius)continue
    const inner=s.radius*(1-s.feather)
    const dab=s.feather<=0?1:1-smooth((distance-inner)/Math.max(1e-8,s.radius*s.feather))
    coverage=s.erase?coverage*(1-dab):Math.max(coverage,dab)
  }
  return coverage
}
/** Reference evaluator for preview/tests; production uses indexed tile lookup. */
export function rawBrushCoverage(mask:RawLocalMask,x:number,y:number,width:number,height:number):number {
  if(mask.kind!=='brush'||width<=0||height<=0)return 0
  const indexed=indexedBrush(mask,width,height)
  const px=clamp(x,0,1)*width,py=clamp(y,0,1)*height
  const tx=Math.min(Math.ceil(width/BRUSH_TILE)-1,Math.floor(px/BRUSH_TILE))
  const ty=Math.min(Math.ceil(height/BRUSH_TILE)-1,Math.floor(py/BRUSH_TILE))
  const raw=brushCoverage(indexed.buckets.get(ty*indexed.tilesWide+tx),px,py)
  return (mask.invert?1-raw:raw)*mask.strength/100
}

export function applyRawLocalMasks(image:RawImage,raw:unknown):RawImage {
  const masks=normalizeRawLocalMasks(raw).filter(mask=>mask.enabled && mask.strength>0 &&
    (mask.exposureEv!==0 || mask.saturation!==0 || mask.warmth!==0))
  if(!masks.length||image.rgbaFloat||image.sourceColorSpace==='linear-srgb')return image
  const {width,height}=image,pixels=width*height
  const src=image.rgba16??image.rgba
  if(!Number.isSafeInteger(pixels)||pixels<=0||src.length!==pixels*4)return image
  const high=!!image.rgba16,unit=high?65535:255
  const out16=high?new Uint16Array(src.length):undefined
  const out8=new Uint8ClampedArray(src.length)
  const indexed=masks.map(mask=>mask.kind==='brush'?indexedBrush(mask,width,height):null)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,normalizedX=(x+0.5)/width,normalizedY=(y+0.5)/height
    let r=src[i]/unit,g=src[i+1]/unit,b=src[i+2]/unit
    for(let mi=0;mi<masks.length;mi++){
      const mask=masks[mi]
      const brush=indexed[mi]
      const w=brush?(()=>{
        const bucket=brush.buckets.get(Math.floor(y/BRUSH_TILE)*brush.tilesWide+Math.floor(x/BRUSH_TILE))
        const alpha=brushCoverage(bucket,x+0.5,y+0.5)
        return (mask.invert?1-alpha:alpha)*mask.strength/100
      })():rawMaskCoverage(mask,normalizedX,normalizedY)
      if(w<=0)continue
      if(mask.exposureEv!==0){
        const gain=Math.pow(2,mask.exposureEv*w)
        r=clamp(r*gain,0,1);g=clamp(g*gain,0,1);b=clamp(b*gain,0,1)
      }
      if(mask.warmth!==0){
        const warmth=mask.warmth/100*w
        r=clamp(r*(1+0.15*warmth),0,1)
        b=clamp(b*(1-0.15*warmth),0,1)
      }
      if(mask.saturation!==0){
        const luminance=r*0.2126+g*0.7152+b*0.0722
        const factor=clamp(1+mask.saturation/100*w,0,2)
        r=clamp(luminance+(r-luminance)*factor,0,1)
        g=clamp(luminance+(g-luminance)*factor,0,1)
        b=clamp(luminance+(b-luminance)*factor,0,1)
      }
    }
    if(out16){
      out16[i]=Math.round(r*unit);out16[i+1]=Math.round(g*unit);out16[i+2]=Math.round(b*unit)
      out16[i+3]=src[i+3]
      out8[i]=Math.round(out16[i]/257);out8[i+1]=Math.round(out16[i+1]/257)
      out8[i+2]=Math.round(out16[i+2]/257);out8[i+3]=Math.round(src[i+3]/257)
    }else{
      out8[i]=Math.round(r*unit);out8[i+1]=Math.round(g*unit);out8[i+2]=Math.round(b*unit)
      out8[i+3]=src[i+3]
    }
  }
  return {...image,rgba:out8 as Uint8ClampedArray<ArrayBuffer>,rgba16:out16}
}
