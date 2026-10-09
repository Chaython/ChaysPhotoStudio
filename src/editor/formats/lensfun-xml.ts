// Optional Lensfun XML importer: no database or WASM is loaded during editor startup.
// Users import license-cleared Lensfun XML, and matching is deliberately conservative.
import type { ImageMetadata } from '../types'
export interface LensfunCurve {
  model: 'poly3' | 'ptlens' | 'linear' | 'pa'
  focal: number
  aperture?: number
  distance?: number
  k1?: number; k2?: number; k3?: number
  a?: number; b?: number; c?: number
  vr?: number; vb?: number; br?: number; bb?: number
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
interface DatabaseLens {
  maker: string
  model: string
  crop: number
  curves: { distortion: LensfunCurve[]; tca: LensfunCurve[]; vignetting: LensfunCurve[] }
}
const database: DatabaseLens[]=[]
const canon = (v:string) => v.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')
const value = (node:Element, tag:string) =>
  Array.from(node.children).find(n=>n.localName===tag && !n.getAttribute('lang'))?.textContent?.trim()||''
const numeric = (text:string|null):number|undefined => {
  if(text==null||text.trim()==='')return undefined
  const n=Number(text)
  return Number.isFinite(n)?n:undefined
}
function parseCurve(element:Element):LensfunCurve|null {
  const model=element.getAttribute('model')
  if(!['poly3','ptlens','linear','pa'].includes(model||''))return null
  const focal=numeric(element.getAttribute('focal'))
  if(focal===undefined||focal<=0)return null
  const result:LensfunCurve={model:model as LensfunCurve['model'],focal}
  for(const prop of ['aperture','distance','k1','k2','k3','a','b','c','vr','vb','br','bb'] as const){
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
        const curve=parseCurve(node)
        if(curve)curves[node.localName].push(curve)
      }
    }
    if(!curves.distortion.length&&!curves.tca.length&&!curves.vignetting.length)continue
    const crop=numeric(value(lens,'cropfactor'))||1
    const record:DatabaseLens={maker,model,crop,curves}
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
  const a = sorted.filter(x => x.focal < exif.focal).at(-1)
  const b = sorted.find(x => x.focal > exif.focal)
  if (!a || !b || a.model !== b.model || b.focal <= a.focal) return undefined
  const t = (exif.focal - a.focal) / (b.focal - a.focal)
  const result: LensfunCurve = { model: a.model, focal: exif.focal }
  for (const key of ['k1','k2','k3','a','b','c','vr','vb','br','bb'] as const) {
    if (a[key] !== undefined && b[key] !== undefined)
      result[key] = a[key]! * (1-t) + b[key]! * t
  }
  if (a.aperture === b.aperture) result.aperture = a.aperture
  if (a.distance === b.distance) result.distance = a.distance
  return result
}
export function matchLensfun(meta:ImageMetadata|undefined):LensfunCalibration|null {
  const exif=cameraExif(meta)
  if(!exif.lens||!exif.focal)return null
  const candidates=database.filter(x=>{
    const lens=canon(x.model),target=canon(exif.lens)
    return lens===target || (target.length>12&&(lens.includes(target)||target.includes(lens)))
  })
  // Ambiguous lens strings must not select a plausible but wrong calibration.
  if(candidates.length!==1)return null
  const lens=candidates[0]
  // Vignetting depends strongly on aperture and subject distance; unlike
  // distortion, it must never pick an arbitrary calibration when EXIF is absent.
  const closeVignettes=exif.aperture>0?
    lens.curves.vignetting.filter(c=>c.aperture!==undefined&&
      Math.abs(c.aperture-exif.aperture)<=0.35):[]
  const farDistance=closeVignettes.filter(c=>!c.distance||c.distance>=100)
  const vignetteSamples=farDistance.length?farDistance:closeVignettes.filter(c=>
    c.distance!==undefined && Math.abs(c.distance-exif.distance)<=Math.max(0.25,exif.distance*0.15))
  return {source:'lensfun-xml',maker:lens.maker,lens:lens.model,crop:lens.crop,
    focal:exif.focal,distortion:chooseLensfunCurve(lens.curves.distortion,exif),
    tca:chooseLensfunCurve(lens.curves.tca,exif),
    vignetting:chooseLensfunCurve(vignetteSamples,exif)}
}
