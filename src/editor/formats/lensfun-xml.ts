// Optional Lensfun XML importer: no database or WASM is loaded during editor startup.
// Users import license-cleared Lensfun XML, and matching is deliberately conservative.
import type { ImageMetadata } from '../types'
export interface LensfunCurve {
  model: 'poly3' | 'poly5' | 'ptlens' | 'linear' | 'pa'
  focal: number
  aperture?: number
  distance?: number
  k1?: number; k2?: number; k3?: number
  a?: number; b?: number; c?: number
  /** Linear TCA channel scale factors. */
  kr?: number; kb?: number
  /** Polynomial TCA coefficients (red/blue). */
  vr?: number; vb?: number; br?: number; bb?: number; cr?: number; cb?: number
}
export interface LensfunCalibration {
  source: 'lensfun-xml'
  lens: string
  maker: string
  focal: number
  crop: number
  distortion?: LensfunCurve
  tca?: LensfunCurve
  vignetting?: LensfunCurve
}
export interface LensfunLensRecord {
  maker: string
  model: string
  crop: number
  curves: { distortion: LensfunCurve[]; tca: LensfunCurve[]; vignetting: LensfunCurve[] }
}
const database: LensfunLensRecord[]=[]
const canon = (v:string) => v.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')
const value = (node:Element, tag:string) =>
  Array.from(node.children).find(n=>n.localName===tag && !n.getAttribute('lang'))?.textContent?.trim()||''
const numeric = (text:string|null):number|undefined => {
  if(text==null||text.trim()==='')return undefined
  const n=Number(text)
  return Number.isFinite(n)?n:undefined
}
export type LensfunCalibrationKind='distortion'|'tca'|'vignetting'

/** Keep calibration models scoped to the Lensfun XML element that defines them.
 * Unsupported ACM variants and cross-kind models are deliberately not imported. */
export function isSupportedLensfunModel(kind:LensfunCalibrationKind,model:string|null):boolean {
  if(kind==='distortion')return model==='poly3'||model==='poly5'||model==='ptlens'
  if(kind==='tca')return model==='linear'||model==='poly3'
  return model==='pa'
}

function parseCurve(element:Element,kind:LensfunCalibrationKind):LensfunCurve|null {
  const model=element.getAttribute('model')
  if(!isSupportedLensfunModel(kind,model))return null
  const focal=numeric(element.getAttribute('focal'))
  if(focal===undefined||focal<=0)return null
  const result:LensfunCurve={model:model as LensfunCurve['model'],focal}
  for(const prop of ['aperture','distance','k1','k2','k3','a','b','c','kr','kb','vr','vb','br','bb','cr','cb'] as const){
    const n=numeric(element.getAttribute(prop))
    if(n!==undefined)result[prop]=n
  }
  return result
}
export function importLensfunXml(xml:string):number {
  if(xml.length>3*1024*1024)throw Error('Lensfun XML exceeds 3 MiB; import smaller individual database files')
  if(typeof DOMParser==='undefined')throw Error('Lensfun XML import requires a browser DOMParser')
  const doc=new DOMParser().parseFromString(xml,'application/xml')
  if(doc.querySelector('parsererror')||doc.documentElement.localName!=='lensdatabase')
    throw Error('Invalid Lensfun lensdatabase XML')
  let imported=0
  for(const lens of Array.from(doc.documentElement.children).filter(n=>n.localName==='lens')){
    if(database.length>=6000)throw Error('Lensfun profile limit reached (6000)')
    const maker=value(lens,'maker'),model=value(lens,'model')
    if(!model)continue
    const calibration=Array.from(lens.children).find(n=>n.localName==='calibration')
    if(!calibration)continue
    const curves={distortion:[] as LensfunCurve[],tca:[] as LensfunCurve[],vignetting:[] as LensfunCurve[]}
    for(const node of Array.from(calibration.children)){
      if(node.localName==='distortion'||node.localName==='tca'||node.localName==='vignetting'){
        const curve=parseCurve(node,node.localName as LensfunCalibrationKind)
        if(curve)curves[node.localName].push(curve)
      }
    }
    if(!curves.distortion.length&&!curves.tca.length&&!curves.vignetting.length)continue
    const crop=numeric(value(lens,'cropfactor'))||1
    const record:LensfunLensRecord={maker,model,crop,curves}
    const existing=database.findIndex(x=>canon(x.maker)===canon(maker)&&canon(x.model)===canon(model))
    if(existing<0)database.push(record)
    else database[existing]=record
    imported++
  }
  return imported
}
export function loadedLensfunCount():number {return database.length}
function field(meta:ImageMetadata|undefined, pattern:RegExp):string {
  return meta?.fields.find(f=>pattern.test(f.label)||pattern.test(f.tag))?.value?.trim()||''
}
export interface CameraExif {
  maker:string
  model:string
  lens:string
  focal:number
  aperture:number
  distance:number
}
export function cameraExif(meta:ImageMetadata|undefined):CameraExif {
  const lens=field(meta,/^(lens model|lens type|lens specification)$/i)
  const maker=field(meta,/^(make|camera make|manufacturer)$/i)
  const model=field(meta,/^(model|camera model)$/i)
  const focal=parseFloat(field(meta,/^focal length$/i))||0
  const aperture=parseFloat(field(meta,/^(f number|aperture|f-number)$/i))||0
  const distance=parseFloat(field(meta,/^subject distance$/i))||1000
  return {maker,model,lens,focal,aperture,distance}
}
/** Select a genuine focal sample or interpolate between compatible neighbors.
 * No extrapolation, and duplicate conflicting calibration records are rejected. */
export function chooseLensfunCurve(curves: LensfunCurve[], exif: CameraExif): LensfunCurve | undefined {
  if (!curves.length || !Number.isFinite(exif.focal) || exif.focal <= 0) return undefined
  const sorted = curves.filter(x => Number.isFinite(x.focal) && x.focal > 0)
    .slice().sort((a,b) => a.focal - b.focal)
  const exact = sorted.filter(x => x.focal === exif.focal)
  if (exact.length > 0) {
    // Multiple records at one focal can represent different apertures,
    // focus distances, or calibration revisions. Don't guess among them.
    if (exact.length !== 1) return undefined
    return { ...exact[0] }
  }
  const lower=sorted.filter(x=>x.focal<exif.focal)
  const upper=sorted.filter(x=>x.focal>exif.focal)
  const lowerFocal=lower.at(-1)?.focal,upperFocal=upper[0]?.focal
  if(lowerFocal===undefined||upperFocal===undefined)return undefined
  const lowerSamples=lower.filter(x=>x.focal===lowerFocal)
  const upperSamples=upper.filter(x=>x.focal===upperFocal)
  // Never interpolate through duplicate focal samples: without an aperture,
  // distance, or revision selector they are not a unique calibration endpoint.
  if(lowerSamples.length!==1||upperSamples.length!==1)return undefined
  const a=lowerSamples[0],b=upperSamples[0]
  if(a.model!==b.model||b.focal<=a.focal)return undefined
  const t=(exif.focal-a.focal)/(b.focal-a.focal)
  const result:LensfunCurve={model:a.model,focal:exif.focal}
  const defaults={k1:0,k2:0,k3:0,a:0,b:0,c:0,kr:1,kb:1,vr:1,vb:1,br:0,bb:0,cr:0,cb:0} as const
  for(const key of Object.keys(defaults) as (keyof typeof defaults)[]){
    if(a[key]!==undefined||b[key]!==undefined){
      const av=a[key]??defaults[key],bv=b[key]??defaults[key]
      result[key]=av*(1-t)+bv*t
    }
  }
  if(a.aperture===b.aperture)result.aperture=a.aperture
  if(a.distance===b.distance)result.distance=a.distance
  return result
}
/** Lensfun radial distortion scale at normalized source radius. */
export function lensfunDistortionScale(curve:LensfunCurve,radius:number):number {
  if(!Number.isFinite(radius))return 1
  const r=Math.max(0,Math.min(2,radius)),r2=r*r
  if(curve.model==='poly3')return 1-(curve.k1??0)+(curve.k1??0)*r2
  if(curve.model==='poly5')return 1+(curve.k1??0)*r2+(curve.k2??0)*r2*r2
  if(curve.model==='ptlens')return 1-(curve.a??0)-(curve.b??0)-(curve.c??0)+
    (curve.c??0)*r+(curve.b??0)*r2+(curve.a??0)*r2*r
  return 1
}
/** Lensfun TCA channel scale at normalized source radius. Linear uses kr/kb;
 * poly3 uses b*r² + c*r + v independently for red and blue. */
export function lensfunTcaScale(curve:LensfunCurve,channel:'red'|'blue',radius:number):number {
  if(!Number.isFinite(radius))return 1
  if(curve.model==='linear')return channel==='red'?(curve.kr??1):(curve.kb??1)
  if(curve.model!=='poly3')return 1
  const r=Math.max(0,Math.min(2,radius))
  return channel==='red'?
    (curve.br??0)*r*r+(curve.cr??0)*r+(curve.vr??1):
    (curve.bb??0)*r*r+(curve.cb??0)*r+(curve.vb??1)
}
/** Choose one vignetting sample per focal length using EXIF aperture and
 * focus distance. Lensfun uses >=100 m as its infinity calibration convention. */
export function selectLensfunVignettingSamples(curves:LensfunCurve[],exif:CameraExif):LensfunCurve[] {
  if(!Number.isFinite(exif.aperture)||exif.aperture<=0)return []
  const focals=[...new Set(curves.map(x=>x.focal).filter(x=>Number.isFinite(x)&&x>0))].sort((a,b)=>a-b)
  const selected:LensfunCurve[]=[]
  for(const focal of focals){
    const candidates=curves.filter(x=>x.focal===focal&&x.aperture!==undefined&&
      Math.abs(x.aperture-exif.aperture)<=0.35&&
      // A near-focus EXIF distance must not silently fall back to an infinity
      // or unspecified-distance vignette calibration.
      (exif.distance>=100||(x.distance!==undefined&&x.distance<100)))
    if(!candidates.length)continue
    const distanceScore=(sample:LensfunCurve)=>{
      const d=sample.distance
      if(exif.distance>=100)return d!==undefined&&d>=100?0:1000+(d===undefined?100:Math.abs(100-d))
      if(d!==undefined&&d<100)return Math.abs(d-exif.distance)
      return 1000
    }
    const ranked=candidates.map(sample=>({sample,aperture:Math.abs(sample.aperture!-exif.aperture),
      distance:distanceScore(sample)})).sort((a,b)=>a.aperture-b.aperture||a.distance-b.distance)
    const best=ranked[0],next=ranked[1]
    if(next&&next.aperture===best.aperture&&next.distance===best.distance)continue
    selected.push({...best.sample})
  }
  return selected
}
/** Score only defensible model-string matches. Exact EXIF model matches win;
 * longer contained model names are accepted to accommodate EXIF vendor prefixes.
 * Short generic names are never fuzzy-matched, and equal best scores stay ambiguous. */
export function scoreLensfunModelMatch(model:string, exifLens:string):number {
  const candidate=canon(model),target=canon(exifLens)
  if(!candidate||!target)return 0
  if(candidate===target)return 10000+candidate.length
  const shorter=Math.min(candidate.length,target.length)
  if(shorter<12)return 0
  if(!candidate.includes(target)&&!target.includes(candidate))return 0
  return 1000+shorter
}
export function matchLensfunRecords(records:LensfunLensRecord[],meta:ImageMetadata|undefined):LensfunCalibration|null {
  const exif=cameraExif(meta)
  if(!exif.lens||!exif.focal)return null
  const ranked=records.map(lens=>({lens,score:scoreLensfunModelMatch(lens.model,exif.lens)}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score)
  if(!ranked.length||ranked[1]?.score===ranked[0].score)return null
  const lens=ranked[0].lens
  // Vignetting depends strongly on aperture and subject distance; unlike
  // distortion, it must never pick an arbitrary calibration when EXIF is absent.
  const vignetteSamples=selectLensfunVignettingSamples(lens.curves.vignetting,exif)
  return {source:'lensfun-xml',maker:lens.maker,lens:lens.model,crop:lens.crop,
    focal:exif.focal,distortion:chooseLensfunCurve(lens.curves.distortion,exif),
    tca:chooseLensfunCurve(lens.curves.tca,exif),
    vignetting:chooseLensfunCurve(vignetteSamples,exif)}
}
export function matchLensfun(meta:ImageMetadata|undefined):LensfunCalibration|null {
  return matchLensfunRecords(database,meta)
}
