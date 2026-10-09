// RAW import controls applied before LibRaw demosaicing. Saves settings only,
// never image files or camera-identifying metadata.
export interface RawDevelopSettings {
  exposureEv: number
  whiteBalance: 'camera' | 'auto' | 'daylight'
  interpolation: 0 | 3 | 4
  highlight: number
  denoise: number
  halfSize: boolean
}
export const DEFAULT_RAW_SETTINGS: RawDevelopSettings = {
  exposureEv: 0, whiteBalance: 'camera', interpolation: 3,
  highlight: 0, denoise: 0, halfSize: false,
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
  }
}

export async function chooseRawDevelopSettings(fileName:string):Promise<RawDevelopSettings|null> {
  const current=rawSettingsFromSaved()
  if(typeof document==='undefined'||typeof HTMLDialogElement==='undefined')return current
  return await new Promise(resolve=>{
    const dialog=document.createElement('dialog')
    dialog.setAttribute('aria-label','Develop camera RAW image')
    dialog.style.cssText=[
      'background:var(--card)','color:var(--card-foreground)','border:1px solid var(--border)',
      'border-radius:12px','padding:20px','width:min(460px,calc(100vw - 24px))',
      'box-shadow:0 20px 80px rgba(0,0,0,.35)',
    ].join(';')
    const heading=document.createElement('h3')
    heading.textContent='RAW Import / Develop'
    heading.style.cssText='font-size:16px;font-weight:600;margin-bottom:6px'
    const caption=document.createElement('p')
    caption.textContent=fileName+' — 16-bit LibRaw development. Changes apply to the imported image; the source file is never modified.'
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
    const actions=document.createElement('div')
    actions.style.cssText='display:flex;justify-content:flex-end;gap:8px;margin-top:16px'
    const cancel=document.createElement('button'),apply=document.createElement('button')
    cancel.type='button';cancel.textContent='Cancel'
    apply.type='button';apply.textContent='Open RAW'
    cancel.style.cssText='padding:7px 14px;border:1px solid var(--border);border-radius:6px'
    apply.style.cssText='padding:7px 14px;border-radius:6px;background:var(--primary);color:var(--primary-foreground)'
    cancel.addEventListener('click',()=>dialog.close('cancel'))
    apply.addEventListener('click',()=>dialog.close('apply'))
    actions.append(cancel,apply);dialog.append(heading,caption,form,actions)
    dialog.addEventListener('close',()=>{
      const result=dialog.returnValue==='apply'?normalizeRawSettings({
        exposureEv:exposure.valueAsNumber,
        whiteBalance:whiteBalance.value as RawDevelopSettings['whiteBalance'],
        interpolation:Number(interpolation.value) as RawDevelopSettings['interpolation'],
        highlight:highlight.valueAsNumber,
        denoise:denoise.valueAsNumber,
        halfSize:half.value==='half',
      }):null
      if(result)try{localStorage.setItem(storageKey,JSON.stringify(result))}catch{}
      dialog.remove();resolve(result)
    },{once:true})
    document.body.append(dialog)
    try{dialog.showModal()}catch{dialog.remove();resolve(current)}
  })
}
