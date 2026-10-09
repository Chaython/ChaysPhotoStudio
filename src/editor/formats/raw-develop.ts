import { DEFAULT_LENS_PROFILE, normalizeLensProfile, type LensProfile } from './lens-correction'
import type { ImageMetadata } from '../types'
import { cameraExif, importLensfunXml, loadedLensfunCount, matchLensfun } from './lensfun-xml'
// RAW import controls applied before LibRaw demosaicing. Saves settings only,
// never image files or camera-identifying metadata.
export interface RawDevelopSettings {
  exposureEv: number
  whiteBalance: 'camera' | 'auto' | 'daylight'
  interpolation: 0 | 3 | 4
  highlight: number
  denoise: number
  halfSize: boolean
  smartObject: boolean
  lensProfile: LensProfile
}
export const DEFAULT_RAW_SETTINGS: RawDevelopSettings = {
  exposureEv: 0, whiteBalance: 'camera', interpolation: 3,
  highlight: 0, denoise: 0, halfSize: false,
  smartObject: true, lensProfile: {...DEFAULT_LENS_PROFILE},
}
const storageKey = 'chaysstudio.raw-develop.v1'
export function rawSettingsFromSaved(): RawDevelopSettings {
  if (typeof window === 'undefined') return {...DEFAULT_RAW_SETTINGS}
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}')
    return normalizeRawSettings(value)
  } catch { return {...DEFAULT_RAW_SETTINGS} }
}
export function normalizeRawSettings(raw: Partial<RawDevelopSettings>): RawDevelopSettings {
  const ev = Number(raw.exposureEv), highlight=Number(raw.highlight), denoise=Number(raw.denoise)
  return {
    exposureEv: Number.isFinite(ev)?Math.max(-5,Math.min(5,ev)):0,
    whiteBalance: raw.whiteBalance === 'auto' || raw.whiteBalance === 'daylight' ? raw.whiteBalance : 'camera',
    interpolation:raw.interpolation===0||raw.interpolation===4?raw.interpolation:3,
    highlight:Number.isFinite(highlight)?Math.max(0,Math.min(9,Math.round(highlight))):0,
    denoise:Number.isFinite(denoise)?Math.max(0,Math.min(500,denoise)):0,
    halfSize:raw.halfSize===true,
    smartObject:raw.smartObject!==false,
    lensProfile:normalizeLensProfile(raw.lensProfile),
  }
}

export async function chooseRawDevelopSettings(fileName:string, initial?:RawDevelopSettings, metadata?:ImageMetadata):Promise<RawDevelopSettings|null> {
  const current=initial?normalizeRawSettings(initial):rawSettingsFromSaved()
  if(typeof document==='undefined'||typeof HTMLDialogElement==='undefined')return current
  return await new Promise(resolve=>{
    const dialog=document.createElement('dialog')
    dialog.setAttribute('aria-label','Develop camera RAW image')
    dialog.style.cssText=[
      'background:var(--card)','color:var(--card-foreground)','border:1px solid var(--border)',
      'border-radius:12px','padding:20px','width:min(520px,calc(100vw - 24px));max-height:90vh;overflow-y:auto',
      'box-shadow:0 20px 80px rgba(0,0,0,.35)',
    ].join(';')
    const heading=document.createElement('h3')
    heading.textContent='RAW Import / Develop'
    heading.style.cssText='font-size:16px;font-weight:600;margin-bottom:6px'
    const caption=document.createElement('p')
    caption.textContent=fileName+' — 16-bit LibRaw development. Smart Objects retain the original RAW and settings for later re-development. Lens coefficients are custom user calibrations, not automatically matched camera profiles.'
    caption.style.cssText='font-size:12px;opacity:.8;overflow-wrap:anywhere;margin-bottom:12px'
    const form=document.createElement('div')
    form.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:center'
    function field(labelText:string, type:'number'|'select', value:string, options?:string[]){
      const label=document.createElement('label')
      label.textContent=labelText
      label.style.cssText='font-size:12px'
      const input=type==='number'?document.createElement('input'):document.createElement('select')
      input.setAttribute('aria-label',labelText)
      input.style.cssText='padding:6px;border:1px solid var(--border);border-radius:6px;background:var(--background);color:var(--foreground);width:100%'
      if(type==='select'&&options)for(const str of options){
        const [id,name]=str.split('|')
        const option=document.createElement('option')
        option.value=id;option.textContent=name;input.append(option)
      }
      input.value=value
      form.append(label,input)
      return input
    }
    const exposure=field('Exposure (EV, -5 to +5)','number',String(current.exposureEv)) as HTMLInputElement
    exposure.min='-5';exposure.max='5';exposure.step='0.1'
    const whiteBalance=field('White balance','select',current.whiteBalance,['camera|Camera','auto|Auto','daylight|Neutral / daylight'])
    const interpolation=field('Demosaicing','select',String(current.interpolation),['0|Bilinear (fast)','3|AHD (balanced)','4|DCB (detail)'])
    const highlight=field('Highlight recovery (0–9)','number',String(current.highlight)) as HTMLInputElement
    highlight.min='0';highlight.max='9';highlight.step='1'
    const denoise=field('Wavelet denoise (0–500)','number',String(current.denoise)) as HTMLInputElement
    denoise.min='0';denoise.max='500';denoise.step='1'
    const half=field('Resolution','select',current.halfSize?'half':'full',['full|Full resolution','half|Half resolution (faster)'])
    const smart=field('Keep original RAW','select',current.smartObject?'yes':'no',['yes|Smart Object (editable)','no|Flatten on import'])
    const lensName=field('Lens profile label','number',current.lensProfile.name) as HTMLInputElement
    lensName.type='text'
    lensName.placeholder='Camera / lens / focal length'
    const k1=field('Distortion k1 (-0.5…0.5)','number',String(current.lensProfile.k1)) as HTMLInputElement
    k1.step='0.001';k1.min='-0.5';k1.max='0.5'
    const k2=field('Distortion k2 (-0.25…0.25)','number',String(current.lensProfile.k2)) as HTMLInputElement
    k2.step='0.001';k2.min='-0.25';k2.max='0.25'
    const tca=field('Color fringing (-0.05…0.05)','number',String(current.lensProfile.tca)) as HTMLInputElement
    tca.step='0.0001';tca.min='-0.05';tca.max='0.05'
    const vignette=field('Vignette correction (-0.6…0.6)','number',String(current.lensProfile.vignette)) as HTMLInputElement
    vignette.step='0.01';vignette.min='-0.6';vignette.max='0.6'
    const lensStatus=document.createElement('p')
    lensStatus.style.cssText='font-size:12px;overflow-wrap:anywhere;opacity:.85;margin-top:10px'
    const camera=cameraExif(metadata)
    lensStatus.textContent='Lensfun XML: '+loadedLensfunCount()+' lenses loaded. EXIF lens: '+(camera.lens||'not detected')
    let chosenLensfun=current.lensProfile.lensfun
    const applyMatched=()=>{
      const match=matchLensfun(metadata)
      if(!match){
        lensStatus.textContent='No unambiguous Lensfun match. Lens: '+(camera.lens||'not found in EXIF')+
          '; focal: '+(camera.focal||'unknown')+'mm. Manual controls remain available.'
        return
      }
      chosenLensfun=match
      lensName.value='Lensfun: '+match.lens+' @ '+match.focal+'mm'
      // No additive manual compensation when enabling a calibrated profile.
      k1.value='0';k2.value='0';tca.value='0';vignette.value='0'
      lensStatus.textContent='Matched Lensfun calibration: '+match.lens+' @ '+match.focal+
        'mm (loaded XML; distortion '+(match.distortion?'yes':'no')+', TCA '+
        (match.tca?'yes':'no')+', vignetting '+(match.vignetting?'yes':'no')+')'
    }
    const profileControls=document.createElement('div')
    profileControls.style.cssText='display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap'
    const load=document.createElement('button')
    load.type='button';load.textContent='Import Lensfun XML…'
    load.style.cssText='padding:7px 10px;border:1px solid var(--border);border-radius:6px'
    const matchButton=document.createElement('button')
    matchButton.type='button';matchButton.textContent='Match EXIF Lens'
    matchButton.style.cssText=load.style.cssText
    matchButton.addEventListener('click',applyMatched)
    load.addEventListener('click',()=>{
      const picker=document.createElement('input')
      picker.type='file';picker.multiple=true;picker.accept='.xml,application/xml,text/xml'
      picker.addEventListener('change',async()=>{
        try{
          let total=0
          for(const file of Array.from(picker.files||[])){
            if(file.size>3*1024*1024)throw Error('Individual XML file exceeds 3 MiB')
            total+=importLensfunXml(await file.text())
          }
          lensStatus.textContent='Imported '+total+' Lensfun lens records. Matching EXIF…'
          applyMatched()
        }catch(err){lensStatus.textContent='Lensfun import failed: '+(err instanceof Error?err.message:String(err))}
      },{once:true})
      picker.click()
    })
    profileControls.append(load,matchButton)
    if(loadedLensfunCount()&&!chosenLensfun)applyMatched()
    const actions=document.createElement('div')
    actions.style.cssText='display:flex;justify-content:flex-end;gap:8px;margin-top:16px'
    const cancel=document.createElement('button'),apply=document.createElement('button')
    cancel.type='button';cancel.textContent='Cancel'
    apply.type='button';apply.textContent='Open RAW'
    cancel.style.cssText='padding:7px 14px;border:1px solid var(--border);border-radius:6px'
    apply.style.cssText='padding:7px 14px;border-radius:6px;background:var(--primary);color:var(--primary-foreground)'
    cancel.addEventListener('click',()=>dialog.close('cancel'))
    apply.addEventListener('click',()=>dialog.close('apply'))
    actions.append(cancel,apply);dialog.append(heading,caption,form,profileControls,lensStatus,actions)
    dialog.addEventListener('close',()=>{
      const result=dialog.returnValue==='apply'?normalizeRawSettings({
        exposureEv:exposure.valueAsNumber,
        whiteBalance:whiteBalance.value as RawDevelopSettings['whiteBalance'],
        interpolation:Number(interpolation.value) as RawDevelopSettings['interpolation'],
        highlight:highlight.valueAsNumber,
        denoise:denoise.valueAsNumber,
        halfSize:half.value==='half',
        smartObject:smart.value==='yes',
        lensProfile:{name:lensName.value,k1:k1.valueAsNumber,k2:k2.valueAsNumber,tca:tca.valueAsNumber,vignette:vignette.valueAsNumber,lensfun:chosenLensfun},
      }):null
      if(result)try{localStorage.setItem(storageKey,JSON.stringify(result))}catch{}
      dialog.remove();resolve(result)
    },{once:true})
    document.body.append(dialog)
    try{dialog.showModal()}catch{dialog.remove();resolve(current)}
  })
}
