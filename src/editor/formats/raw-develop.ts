import { DEFAULT_RAW_TONE, normalizeRawTone, applyRawTone, type RawToneSettings } from './raw-tone'
import { RAW_MIX_BANDS, DEFAULT_RAW_COLOR_MIX, normalizeRawColorMix, applyRawColorMix, type RawColorMix, type RawMixChannel } from './raw-color-mix'
import { downsampleRawPreview, rawPreviewHistogram } from './raw-preview'
import { RAW_CURVE_CHANNELS, DEFAULT_RAW_CURVES, normalizeRawCurves, applyRawCurves, evaluateRawCurve, type RawPointCurves, type RawCurveChannel } from './raw-curves'
import type { RawImage } from './decoders'
import { applyRawLocalMasks, normalizeRawLocalMasks, makeRawLocalMask, MAX_RAW_LOCAL_MASKS, MAX_RAW_BRUSH_STROKES, MAX_RAW_BRUSH_POINTS, type RawLocalMask } from './raw-local-masks'
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
  tone: RawToneSettings
  curves: RawPointCurves
  colorMix: RawColorMix
  localMasks: RawLocalMask[]
}
export const DEFAULT_RAW_SETTINGS: RawDevelopSettings = {
  exposureEv: 0, whiteBalance: 'camera', interpolation: 3,
  highlight: 0, denoise: 0, halfSize: false,
  smartObject: true, lensProfile: {...DEFAULT_LENS_PROFILE}, tone: {...DEFAULT_RAW_TONE}, curves: structuredClone(DEFAULT_RAW_CURVES), colorMix: structuredClone(DEFAULT_RAW_COLOR_MIX), localMasks:[],
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
    tone:normalizeRawTone(raw.tone),
    curves:normalizeRawCurves(raw.curves),
    colorMix:normalizeRawColorMix(raw.colorMix),
    localMasks:normalizeRawLocalMasks(raw.localMasks),
  }
}

export async function chooseRawDevelopSettings(fileName:string, initial?:RawDevelopSettings, metadata?:ImageMetadata, sourceFile?:File):Promise<RawDevelopSettings|null> {
  const current=initial?normalizeRawSettings(initial):rawSettingsFromSaved()
  // Local mask geometry belongs to a particular image. Opening a different
  // RAW must not silently apply a previous photo's coordinates/adjustments.
  // Redeveloping an existing RAW Smart Object keeps its embedded mask recipe.
  if(!initial)current.localMasks=[]
  // Never carry a calibrated lens from a previously opened camera into a new
  // unrelated RAW. Re-match using this file's EXIF or leave only manual values.
  if(!initial && current.lensProfile.lensfun){
    current.lensProfile={...current.lensProfile,lensfun:undefined}
    if(current.lensProfile.name.startsWith('Lensfun: '))current.lensProfile.name=''
  }
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
    function field(labelText:string, type:'number'|'select'|'text', value:string, options?:string[], target:HTMLElement=form){
      const label=document.createElement('label')
      label.textContent=labelText
      label.style.cssText='font-size:12px'
      const input=type==='select'?document.createElement('select'):document.createElement('input')
      if(type!=='select')(input as HTMLInputElement).type=type
      input.setAttribute('aria-label',labelText)
      input.style.cssText='padding:6px;border:1px solid var(--border);border-radius:6px;background:var(--background);color:var(--foreground);width:100%'
      if(type==='select'&&options)for(const str of options){
        const [id,name]=str.split('|')
        const option=document.createElement('option')
        option.value=id;option.textContent=name;input.append(option)
      }
      input.value=value
      target.append(label,input)
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
    // Group controls by workflow so expanding Color Mixer does not turn
    // the Develop dialog into a permanently oversized 30-field form.
    function group(title:string,expanded=false){
      const details=document.createElement('details')
      details.open=expanded
      details.style.cssText='border-top:1px solid var(--border);padding-top:10px;margin-top:12px'
      const summary=document.createElement('summary')
      summary.textContent=title
      summary.style.cssText='cursor:pointer;font-size:13px;font-weight:600'
      const grid=document.createElement('div')
      grid.style.cssText=form.style.cssText+';margin-top:10px'
      details.append(summary,grid)
      return {details,grid}
    }
    // Link familiar Lightroom-style range sliders to exact numeric entry.
    // Dispatch the same input event so the preview and all consumers remain
    // synchronized without maintaining a second copy of each setting.
    const sliders=new Map<HTMLInputElement,HTMLInputElement>()
    function sliderFor(input:HTMLInputElement){
      const wrapper=document.createElement('div')
      wrapper.style.cssText='display:flex;align-items:center;gap:6px;min-width:0'
      const slider=document.createElement('input')
      slider.type='range'
      slider.min=input.min||'-100';slider.max=input.max||'100'
      slider.step=input.step||'1';slider.value=input.value
      slider.style.cssText='flex:1;min-width:0;accent-color:var(--primary)'
      input.style.cssText+=';width:68px;flex:none'
      input.replaceWith(wrapper)
      wrapper.append(slider,input)
      slider.addEventListener('input',()=>{
        input.value=slider.value
        input.dispatchEvent(new Event('input',{bubbles:true}))
      })
      input.addEventListener('input',()=>{
        if(input.value.trim()!=='')slider.value=input.value
      })
      sliders.set(input,slider)
    }
    const basic=group('Basic tone and color (non-destructive)',true)
    const toneInputs={} as Record<keyof RawToneSettings,HTMLInputElement>
    for(const [key,label] of [
      ['contrast','Contrast'],['highlights','Highlights'],['shadows','Shadows'],
      ['whites','Whites'],['blacks','Blacks'],['vibrance','Vibrance'],
      ['saturation','Saturation'],['temperature','Warmth (post-develop)'],
      ['tint','Tint (green / magenta)'],
    ] as [keyof RawToneSettings,string][]){
      const input=field(label+' (-100 to +100)','number',String(current.tone[key]),undefined,basic.grid) as HTMLInputElement
      input.min='-100';input.max='100';input.step='1'
      toneInputs[key]=input
      sliderFor(input)
    }
    const curve=group('Point Tone Curves — RGB / individual channels',false)
    const curveChannel=field('Curve channel','select','rgb',
      ['rgb|Composite RGB','red|Red','green|Green','blue|Blue'],curve.grid)
    const curveCanvas=document.createElement('canvas')
    curveCanvas.width=256;curveCanvas.height=256
    curveCanvas.style.cssText='width:min(100%,256px);height:auto;aspect-ratio:1/1;background:#161616;border:1px solid var(--border);touch-action:none;cursor:crosshair;grid-column:1/-1'
    curveCanvas.setAttribute('aria-label','Editable point tone curve; drag handles vertically or use the numerical controls')
    curve.grid.append(curveCanvas)
    const curveInputs={} as Record<RawCurveChannel,HTMLInputElement[]>
    const curveRows={} as Record<RawCurveChannel,HTMLDivElement[]>
    const curveLabels=['Black','Dark','Midtone','Light','White']
    const curveColors:Record<RawCurveChannel,string>={rgb:'#e5e7eb',red:'#f87171',green:'#4ade80',blue:'#60a5fa'}
    const redrawCurve=()=>{
      const selected=curveChannel.value as RawCurveChannel
      for(const channel of RAW_CURVE_CHANNELS)
        curveRows[channel].forEach(row=>{row.style.display=channel===selected?'grid':'none'})
      const ctx=curveCanvas.getContext('2d')
      if(!ctx)return
      const width=curveCanvas.width
      ctx.clearRect(0,0,width,width)
      ctx.strokeStyle='#4b5563';ctx.lineWidth=1
      for(let i=0;i<=4;i++){
        const p=i*width/4
        ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,width)
        ctx.moveTo(0,p);ctx.lineTo(width,p);ctx.stroke()
      }
      ctx.setLineDash([4,4]);ctx.strokeStyle='#6b7280'
      ctx.beginPath();ctx.moveTo(0,width);ctx.lineTo(width,0);ctx.stroke()
      ctx.setLineDash([])
      const points=curveInputs[selected].map(input=>input.valueAsNumber) as RawPointCurves['rgb']
      ctx.strokeStyle=curveColors[selected];ctx.lineWidth=2
      ctx.beginPath()
      for(let x=0;x<=width;x++){
        const y=(1-evaluateRawCurve(points,x/width))*width
        if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)
      }
      ctx.stroke()
      ctx.fillStyle=curveColors[selected]
      for(let i=0;i<5;i++){
        ctx.beginPath();ctx.arc(i*width/4,(1-points[i]/100)*width,5,0,Math.PI*2);ctx.fill()
      }
    }
    for(const channel of RAW_CURVE_CHANNELS){
      curveRows[channel]=[]
      curveInputs[channel]=[]
      for(let i=0;i<5;i++){
        const row=document.createElement('div')
        row.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:center'
        curve.grid.append(row)
        const input=field(curveLabels[i]+' output (0–100)','number',
          String(current.curves[channel][i]),undefined,row) as HTMLInputElement
        input.min='0';input.max='100';input.step='1'
        sliderFor(input)
        input.addEventListener('input',redrawCurve)
        curveInputs[channel].push(input)
        curveRows[channel].push(row)
      }
    }
    curveChannel.addEventListener('change',redrawCurve)
    const resetCurve=document.createElement('button')
    resetCurve.type='button';resetCurve.textContent='Reset selected curve'
    resetCurve.style.cssText='grid-column:1/-1;padding:7px 10px;border:1px solid var(--border);border-radius:6px'
    resetCurve.addEventListener('click',()=>{
      const channel=curveChannel.value as RawCurveChannel
      DEFAULT_RAW_CURVES[channel].forEach((value,i)=>{
        const input=curveInputs[channel][i]
        input.value=String(value)
        input.dispatchEvent(new Event('input',{bubbles:true}))
      })
      redrawCurve()
    })
    curve.grid.append(resetCurve)
    let activeCurveHandle=-1
    const curvePointer=(event:PointerEvent)=>{
      if(activeCurveHandle<0)return
      const box=curveCanvas.getBoundingClientRect()
      const normalizedY=Math.max(0,Math.min(1,(event.clientY-box.top)/Math.max(box.height,1)))
      const input=curveInputs[curveChannel.value as RawCurveChannel][activeCurveHandle]
      input.value=String(Math.round((1-normalizedY)*100))
      input.dispatchEvent(new Event('input',{bubbles:true}))
    }
    curveCanvas.addEventListener('pointerdown',event=>{
      const rect=curveCanvas.getBoundingClientRect()
      const x=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(rect.width,1)))
      activeCurveHandle=Math.round(x*4)
      curveCanvas.setPointerCapture(event.pointerId)
      curvePointer(event)
    })
    curveCanvas.addEventListener('pointermove',curvePointer)
    const stopCurveDrag=()=>{activeCurveHandle=-1}
    curveCanvas.addEventListener('pointerup',stopCurveDrag)
    curveCanvas.addEventListener('pointercancel',stopCurveDrag)
    redrawCurve()
    const mix=group('Color Mixer — 8-band HSL',false)
    const mixInputs={} as Record<keyof RawColorMix,Record<keyof RawMixChannel,HTMLInputElement>>
    const mixProperties=['hue','saturation','luminance'] as const
    for(const band of RAW_MIX_BANDS){
      const inputs={} as Record<keyof RawMixChannel,HTMLInputElement>
      for(const property of mixProperties){
        const input=field(band[0].toUpperCase()+band.slice(1)+' '+property+' (-100 to +100)',
          'number',String(current.colorMix[band][property]),undefined,mix.grid) as HTMLInputElement
        input.min='-100';input.max='100';input.step='1'
        inputs[property]=input
        sliderFor(input)
      }
      mixInputs[band]=inputs
    }
    const local=group('Local adjustments — radial, linear and painted brush masks',false)
    const localMasks:RawLocalMask[]=normalizeRawLocalMasks(current.localMasks)
    let localCounter=0
    let notifyLocalPreview=()=>{}
    const selectedMask=field('Selected mask','select','',[],local.grid) as HTMLSelectElement
    const localActions=document.createElement('div')
    localActions.style.cssText='display:flex;gap:6px;flex-wrap:wrap;grid-column:1/-1'
    const localMessage=document.createElement('p')
    localMessage.style.cssText='grid-column:1/-1;font-size:12px;opacity:.8'
    localMessage.textContent='Paint or erase brush strokes on the After preview. Load the RAW preview first. Brush size is a percentage of the shorter image edge; strokes are editable non-destructively.'
    const addRadial=document.createElement('button'),addLinear=document.createElement('button'),addBrush=document.createElement('button'),removeMask=document.createElement('button')
    for(const button of [addRadial,addLinear,addBrush,removeMask]){
      button.type='button'
      button.style.cssText='padding:6px 9px;border:1px solid var(--border);border-radius:6px'
    }
    addRadial.textContent='Add radial';addLinear.textContent='Add linear';addBrush.textContent='Add brush';removeMask.textContent='Remove selected'
    localActions.append(addRadial,addLinear,addBrush,removeMask)
    local.grid.append(localActions,localMessage)
    const maskName=field('Mask name','text','',undefined,local.grid) as HTMLInputElement
    const maskKind=field('Shape','select','radial',
      ['radial|Radial ellipse','linear|Linear gradient','brush|Painted brush'],local.grid) as HTMLSelectElement
    const maskEnabled=field('Enabled','select','yes',['yes|Yes','no|No'],local.grid) as HTMLSelectElement
    const maskInvert=field('Invert area','select','no',['no|No','yes|Yes'],local.grid) as HTMLSelectElement
    function localNumber(label:string,min:number,max:number,step:number):HTMLInputElement {
      const input=field(label,'number','0',undefined,local.grid) as HTMLInputElement
      input.min=String(min);input.max=String(max);input.step=String(step)
      sliderFor(input)
      return input
    }
    const localX=localNumber('Start / center X (%)',0,100,1)
    const localY=localNumber('Start / center Y (%)',0,100,1)
    const localX2=localNumber('Gradient end X (%)',0,100,1)
    const localY2=localNumber('Gradient end Y (%)',0,100,1)
    const localRadiusX=localNumber('Ellipse radius X (%)',1,100,1)
    const localRadiusY=localNumber('Ellipse radius Y (%)',1,100,1)
    const localFeather=localNumber('Ellipse feather (%)',0,100,1)
    const localStrength=localNumber('Mask opacity (%)',0,100,1)
    const localEv=localNumber('Exposure (EV)',-3,3,0.1)
    const localSat=localNumber('Saturation (-100 to 100)',-100,100,1)
    const localWarmth=localNumber('Warmth (-100 to 100)',-100,100,1)
    const brushMode=field('Brush action','select','add',
      ['add|Paint','erase|Erase'],local.grid) as HTMLSelectElement
    const brushSize=field('Brush diameter (% of short edge)','number','8',undefined,local.grid) as HTMLInputElement
    brushSize.min='1';brushSize.max='40';brushSize.step='1';sliderFor(brushSize)
    const brushFeather=field('Brush feather (%)','number','40',undefined,local.grid) as HTMLInputElement
    brushFeather.min='0';brushFeather.max='100';brushFeather.step='1';sliderFor(brushFeather)
    const undoBrush=document.createElement('button'),clearBrush=document.createElement('button')
    for(const control of [undoBrush,clearBrush]){
      control.type='button';control.style.cssText='padding:6px 9px;border:1px solid var(--border);border-radius:6px'
    }
    undoBrush.textContent='Undo last stroke'
    clearBrush.textContent='Clear brush strokes'
    const brushActions=document.createElement('div')
    brushActions.style.cssText='grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px'
    brushActions.append(undoBrush,clearBrush)
    local.grid.append(brushActions)
    const syncBrushControls=()=>{
      const selected=localMasks.find(mask=>mask.id===selectedMask.value)
      const enabled=selected?.kind==='brush'
      for(const control of [brushMode,brushSize,brushFeather,undoBrush,clearBrush])control.disabled=!enabled
      if(enabled){
        undoBrush.disabled=!selected?.strokes?.length
        clearBrush.disabled=!selected?.strokes?.length
      }
    }
    const editBrushStrokes=(clear:boolean)=>{
      const mask=localMasks.find(mask=>mask.id===selectedMask.value)
      if(mask?.kind!=='brush')return
      if(clear)mask.strokes=[]
      else mask.strokes?.pop()
      syncBrushControls()
      notifyLocalPreview()
    }
    undoBrush.addEventListener('click',()=>editBrushStrokes(false))
    clearBrush.addEventListener('click',()=>editBrushStrokes(true))
    const localNumbers=[localX,localY,localX2,localY2,localRadiusX,localRadiusY,
      localFeather,localStrength,localEv,localSat,localWarmth]
    const atSelected=()=>localMasks.find(mask=>mask.id===selectedMask.value)
    function updateMaskSelection(){
      selectedMask.replaceChildren()
      for(const mask of localMasks){
        const opt=document.createElement('option')
        opt.value=mask.id;opt.textContent=mask.name+(mask.enabled?'':' (off)')
        selectedMask.append(opt)
      }
      const mask=atSelected()??localMasks[0]
      if(mask)selectedMask.value=mask.id
      const available=!!mask
      removeMask.disabled=!available
      for(const control of [maskName,maskKind,maskEnabled,maskInvert,...localNumbers])control.disabled=!available
      syncBrushControls()
      if(!mask)return
      maskName.value=mask.name
      maskKind.value=mask.kind
      maskEnabled.value=mask.enabled?'yes':'no'
      maskInvert.value=mask.invert?'yes':'no'
      const numbers=[mask.x*100,mask.y*100,mask.x2*100,mask.y2*100,mask.radiusX*100,
        mask.radiusY*100,mask.feather*100,mask.strength,mask.exposureEv,mask.saturation,mask.warmth]
      localNumbers.forEach((input,i)=>{
        input.value=String(Math.round(numbers[i]*100)/100)
        const slider=sliders.get(input)
        if(slider)slider.value=input.value
      })
    }
    function updateMask(){
      const mask=atSelected()
      if(!mask)return
      const values={
        ...mask,name:maskName.value,kind:maskKind.value as RawLocalMask['kind'],
        enabled:maskEnabled.value==='yes',invert:maskInvert.value==='yes',
        x:localX.valueAsNumber/100,y:localY.valueAsNumber/100,
        x2:localX2.valueAsNumber/100,y2:localY2.valueAsNumber/100,
        radiusX:localRadiusX.valueAsNumber/100,radiusY:localRadiusY.valueAsNumber/100,
        feather:localFeather.valueAsNumber/100,strength:localStrength.valueAsNumber,
        exposureEv:localEv.valueAsNumber,saturation:localSat.valueAsNumber,
        warmth:localWarmth.valueAsNumber,
      }
      const clean=normalizeRawLocalMasks([values])[0]
      if(!clean)return
      Object.assign(mask,clean)
      syncBrushControls()
      // Do not rebuild a text field on every keystroke.
      for(const option of Array.from(selectedMask.options))
        if(option.value===mask.id)option.textContent=mask.name+(mask.enabled?'':' (off)')
      notifyLocalPreview()
    }
    for(const input of [maskName,maskKind,maskEnabled,maskInvert,...localNumbers])
      input.addEventListener('input',updateMask)
    selectedMask.addEventListener('change',()=>{
      const selected=localMasks.find(x=>x.id===selectedMask.value)
      if(!selected)return
      // Rebuilding the options would discard the user's selection.
      maskName.value=selected.name
      maskKind.value=selected.kind;maskEnabled.value=selected.enabled?'yes':'no'
      maskInvert.value=selected.invert?'yes':'no'
      const values=[selected.x*100,selected.y*100,selected.x2*100,selected.y2*100,
        selected.radiusX*100,selected.radiusY*100,selected.feather*100,
        selected.strength,selected.exposureEv,selected.saturation,selected.warmth]
      localNumbers.forEach((input,i)=>{
        input.value=String(Math.round(values[i]*100)/100)
        const slider=sliders.get(input);if(slider)slider.value=input.value
      })
      syncBrushControls()
      notifyLocalPreview()
    })
    const addMask=(kind:'radial'|'linear'|'brush')=>{
      if(localMasks.length>=MAX_RAW_LOCAL_MASKS){
        localMessage.textContent='Maximum of '+MAX_RAW_LOCAL_MASKS+' local masks reached.'
        return
      }
      const id='local-'+Date.now().toString(36)+'-'+(++localCounter)
      localMasks.push(makeRawLocalMask(kind,id))
      updateMaskSelection()
      selectedMask.value=id
      // Force the new row values to match newly selected mask.
      selectedMask.dispatchEvent(new Event('change'))
      notifyLocalPreview()
    }
    addRadial.addEventListener('click',()=>addMask('radial'))
    addLinear.addEventListener('click',()=>addMask('linear'))
    addBrush.addEventListener('click',()=>addMask('brush'))
    removeMask.addEventListener('click',()=>{
      const index=localMasks.findIndex(mask=>mask.id===selectedMask.value)
      if(index<0)return
      localMasks.splice(index,1)
      updateMaskSelection()
      notifyLocalPreview()
    })
    updateMaskSelection()
    const optics=group('Optics and Lensfun calibration',false)
    const lensName=field('Lens profile label','text',current.lensProfile.name,undefined,optics.grid) as HTMLInputElement
    lensName.placeholder='Camera / lens / focal length'
    const k1=field('Distortion k1 (-0.5…0.5)','number',String(current.lensProfile.k1),undefined,optics.grid) as HTMLInputElement
    k1.step='0.001';k1.min='-0.5';k1.max='0.5'
    const k2=field('Distortion k2 (-0.25…0.25)','number',String(current.lensProfile.k2),undefined,optics.grid) as HTMLInputElement
    k2.step='0.001';k2.min='-0.25';k2.max='0.25'
    const tca=field('Color fringing (-0.05…0.05)','number',String(current.lensProfile.tca),undefined,optics.grid) as HTMLInputElement
    tca.step='0.0001';tca.min='-0.05';tca.max='0.05'
    const vignette=field('Vignette correction (-0.6…0.6)','number',String(current.lensProfile.vignette),undefined,optics.grid) as HTMLInputElement
    vignette.step='0.01';vignette.min='-0.6';vignette.max='0.6'
    const lensStatus=document.createElement('p')
    lensStatus.style.cssText='font-size:12px;overflow-wrap:anywhere;opacity:.85;margin-top:10px'
    const camera=cameraExif(metadata)
    lensStatus.textContent='Lensfun XML: '+loadedLensfunCount()+' lenses loaded. EXIF lens: '+(camera.lens||'not detected')
    let chosenLensfun=current.lensProfile.lensfun
    let notifySensorChange=()=>{}
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
      notifySensorChange()
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
    optics.details.append(profileControls,lensStatus)
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
    const presetTools=document.createElement('div')
    presetTools.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px'
    const presetStatus=document.createElement('span')
    presetStatus.style.cssText='font-size:12px;opacity:.8'
    presetStatus.textContent='Presets save tone, curves and HSL only, not camera data or lens calibration.'
    const savePreset=document.createElement('button')
    savePreset.type='button';savePreset.textContent='Export color preset'
    savePreset.style.cssText=cancel.style.cssText
    savePreset.addEventListener('click',()=>{
      const recipe={format:'chaysstudio-raw-color-preset',version:1,
        tone:normalizeRawTone(Object.fromEntries(Object.entries(toneInputs).map(([key,input])=>[key,input.valueAsNumber]))),
        colorMix:normalizeRawColorMix(Object.fromEntries(RAW_MIX_BANDS.map(band=>[
          band,Object.fromEntries(mixProperties.map(property=>[property,mixInputs[band][property].valueAsNumber])),
        ]))),
        curves:normalizeRawCurves(Object.fromEntries(RAW_CURVE_CHANNELS.map(channel=>[
          channel,curveInputs[channel].map(input=>input.valueAsNumber),
        ])))}
      const url=URL.createObjectURL(new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'}))
      const anchor=document.createElement('a')
      anchor.href=url;anchor.download='chaysstudio-raw-color-preset.json'
      document.body.append(anchor);anchor.click();anchor.remove()
      setTimeout(()=>URL.revokeObjectURL(url),1000)
    })
    let refreshEditedPreview=()=>{}
    const loadPreset=document.createElement('button')
    loadPreset.type='button';loadPreset.textContent='Import color preset…'
    loadPreset.style.cssText=cancel.style.cssText
    loadPreset.addEventListener('click',()=>{
      const input=document.createElement('input')
      input.type='file';input.accept='.json,application/json'
      input.addEventListener('change',async()=>{
        const file=input.files?.[0]
        if(!file)return
        try{
          if(file.size>64*1024)throw Error('Preset exceeds 64 KiB')
          const parsed=JSON.parse(await file.text())
          if(!parsed || parsed.format!=='chaysstudio-raw-color-preset' || parsed.version!==1)
            throw Error('Not a supported Chay Studio RAW color preset')
          const loadedTone=normalizeRawTone(parsed.tone)
          const loadedMix=normalizeRawColorMix(parsed.colorMix)
          const loadedCurves=normalizeRawCurves(parsed.curves)
          for(const key of Object.keys(toneInputs) as (keyof RawToneSettings)[])
            toneInputs[key].value=String(loadedTone[key])
          for(const band of RAW_MIX_BANDS)for(const property of mixProperties)
            mixInputs[band][property].value=String(loadedMix[band][property])
          for(const channel of RAW_CURVE_CHANNELS)
            loadedCurves[channel].forEach((value,i)=>{curveInputs[channel][i].value=String(value)})
          for(const [input,slider] of sliders)slider.value=input.value
          redrawCurve()
          presetStatus.textContent='Color preset imported; changes apply to this RAW on Open.'
          refreshEditedPreview()
        }catch(error){
          presetStatus.textContent='Preset import failed: '+(error instanceof Error?error.message:String(error))
        }
      },{once:true})
      input.click()
    })
    const readSettings=():RawDevelopSettings=>normalizeRawSettings({
      exposureEv:exposure.valueAsNumber,
      whiteBalance:whiteBalance.value as RawDevelopSettings['whiteBalance'],
      interpolation:Number(interpolation.value) as RawDevelopSettings['interpolation'],
      highlight:highlight.valueAsNumber,
      denoise:denoise.valueAsNumber,
      halfSize:half.value==='half',
      smartObject:smart.value==='yes',
      tone:normalizeRawTone(Object.fromEntries(Object.entries(toneInputs).map(([key,input])=>[key,input.valueAsNumber]))),
      colorMix:normalizeRawColorMix(Object.fromEntries(RAW_MIX_BANDS.map(band=>[
        band,Object.fromEntries(mixProperties.map(property=>[property,mixInputs[band][property].valueAsNumber])),
      ]))),
      curves:normalizeRawCurves(Object.fromEntries(RAW_CURVE_CHANNELS.map(channel=>[
        channel,curveInputs[channel].map(input=>input.valueAsNumber),
      ]))),
      lensProfile:{name:lensName.value,k1:k1.valueAsNumber,k2:k2.valueAsNumber,
        tca:tca.valueAsNumber,vignette:vignette.valueAsNumber,lensfun:chosenLensfun},
      localMasks:normalizeRawLocalMasks(localMasks),
    })
    // The LibRaw sensor stage is expensive. Decode it only on explicit request
    // at half resolution, then update Basic/HSL adjustments on a bounded
    // 480 px high-depth sample as controls change. No preview touches the RAW.
    const previewSection=document.createElement('details')
    previewSection.open=true
    previewSection.style.cssText='border-top:1px solid var(--border);margin-top:12px;padding-top:10px'
    const previewSummary=document.createElement('summary')
    previewSummary.textContent='Develop Preview / RGB Histogram'
    previewSummary.style.cssText='cursor:pointer;font-weight:600;font-size:13px'
    const previewPanel=document.createElement('div')
    previewPanel.style.cssText='margin-top:8px'
    const previewButton=document.createElement('button')
    previewButton.type='button'
    previewButton.textContent='Load / Refresh RAW preview'
    previewButton.style.cssText=cancel.style.cssText
    previewButton.disabled=!sourceFile || sourceFile.size>256*1024*1024
    const previewStatus=document.createElement('p')
    previewStatus.style.cssText='font-size:12px;opacity:.8;overflow-wrap:anywhere;margin:8px 0'
    previewStatus.setAttribute('role','status')
    previewStatus.textContent=!sourceFile?'Preview not available for this source':
      sourceFile.size>256*1024*1024?'Preview disabled for RAW files over 256 MiB':
      'Load once to enable live Basic/HSL preview. Sensor and lens changes require Refresh.'
    const compare=document.createElement('div')
    compare.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px'
    const makePane=(title:string)=>{
      const pane=document.createElement('div')
      const label=document.createElement('div')
      label.textContent=title
      label.style.cssText='font-size:12px;margin-bottom:4px'
      const canvas=document.createElement('canvas')
      canvas.style.cssText='width:100%;height:auto;max-height:250px;object-fit:contain;background:#171717;border:1px solid var(--border);border-radius:6px'
      canvas.setAttribute('aria-label',title+' preview')
      canvas.width=1;canvas.height=1
      pane.append(label,canvas)
      compare.append(pane)
      return canvas
    }
    const beforeCanvas=makePane('Before: camera and optics')
    const afterCanvas=makePane('After: Basic tone and HSL')
    // Paint on the After preview only, never directly on the 16-bit image.
    // CSS object-fit:contain may letterbox very tall/wide images; account
    // for the actual picture bounds before mapping pointer coordinates.
    let activeBrushPointer:number|null=null
    const afterPoint=(event:PointerEvent)=>{
      const rect=afterCanvas.getBoundingClientRect()
      if(!previewBase||rect.width<=0||rect.height<=0)return null
      const aspect=previewBase.width/previewBase.height
      const viewWidth=Math.min(rect.width,rect.height*aspect)
      const viewHeight=Math.min(rect.height,rect.width/aspect)
      const left=rect.left+(rect.width-viewWidth)/2
      const top=rect.top+(rect.height-viewHeight)/2
      const x=(event.clientX-left)/viewWidth,y=(event.clientY-top)/viewHeight
      if(x<0||x>1||y<0||y>1)return null
      return {x,y}
    }
    const paintBrushPoint=(event:PointerEvent)=>{
      if(activeBrushPointer!==event.pointerId)return
      const mask=localMasks.find(mask=>mask.id===selectedMask.value)
      if(mask?.kind!=='brush')return
      const stroke=mask.strokes?.[mask.strokes.length-1]
      if(!stroke||stroke.points.length>=MAX_RAW_BRUSH_POINTS)return
      const point=afterPoint(event)
      if(!point)return
      const last=stroke.points[stroke.points.length-1]
      const pixelDistance=last?Math.hypot((point.x-last.x)*afterCanvas.width,
        (point.y-last.y)*afterCanvas.height):Infinity
      if(pixelDistance<1.5)return
      stroke.points.push(point)
      notifyLocalPreview()
    }
    afterCanvas.addEventListener('pointerdown',event=>{
      const mask=localMasks.find(mask=>mask.id===selectedMask.value)
      if(!previewBase||!local.details.open||mask?.kind!=='brush'||
        (event.pointerType==='mouse'&&event.button!==0)||activeBrushPointer!==null)return
      if((mask.strokes?.length??0)>=MAX_RAW_BRUSH_STROKES){
        localMessage.textContent='Brush stroke limit reached; undo or clear strokes to continue.'
        return
      }
      const point=afterPoint(event)
      if(!point)return
      mask.strokes??=[]
      mask.strokes.push({mode:brushMode.value==='erase'?'erase':'add',
        size:Math.max(1,Math.min(40,brushSize.valueAsNumber||8)),
        feather:Math.max(0,Math.min(1,(brushFeather.valueAsNumber||0)/100)),
        points:[point]})
      activeBrushPointer=event.pointerId
      afterCanvas.setPointerCapture(event.pointerId)
      afterCanvas.style.touchAction='none'
      syncBrushControls()
      notifyLocalPreview()
      event.preventDefault()
    })
    afterCanvas.addEventListener('pointermove',paintBrushPoint)
    const finishBrush=(event:PointerEvent)=>{
      if(activeBrushPointer!==event.pointerId)return
      if(event.type==='pointerup')paintBrushPoint(event)
      activeBrushPointer=null
      afterCanvas.style.touchAction=''
      notifyLocalPreview()
    }
    afterCanvas.addEventListener('pointerup',finishBrush)
    afterCanvas.addEventListener('pointercancel',finishBrush)
    const histogramCanvas=document.createElement('canvas')
    histogramCanvas.width=256;histogramCanvas.height=100
    histogramCanvas.style.cssText='width:100%;height:100px;margin-top:8px;border-radius:6px;background:#171717'
    histogramCanvas.setAttribute('aria-label','RGB and luminance histogram for adjusted preview')
    previewPanel.append(previewButton,previewStatus,compare,histogramCanvas)
    previewSection.append(previewSummary,previewPanel)
    let previewBase:RawImage|null=null
    let previewKey=''
    let previewGeneration=0
    let previewLoading=false
    let previewTimer:ReturnType<typeof setTimeout>|undefined
    const sensorKey=(settings:RawDevelopSettings)=>JSON.stringify({
      ev:settings.exposureEv,wb:settings.whiteBalance,interpolation:settings.interpolation,
      highlight:settings.highlight,denoise:settings.denoise,lens:settings.lensProfile,
    })
    const paint=(canvas:HTMLCanvasElement,image:RawImage)=>{
      const ctx=canvas.getContext('2d')
      if(!ctx)return
      canvas.width=image.width;canvas.height=image.height
      ctx.putImageData(new ImageData(image.rgba,image.width,image.height),0,0)
    }
    const renderPreview=()=>{
      if(!previewBase||!dialog.isConnected)return
      const settings=readSettings()
      if(sensorKey(settings)!==previewKey){
        previewStatus.textContent='Sensor or optics settings changed. Refresh RAW preview to see their effect.'
        return
      }
      const adjusted=applyRawLocalMasks(applyRawColorMix(applyRawCurves(applyRawTone(previewBase,settings.tone),settings.curves),settings.colorMix),settings.localMasks)
      paint(beforeCanvas,previewBase);paint(afterCanvas,adjusted)
      // Shape overlay exists only on the UI preview canvas. The histogram,
      // original RAW, Smart Object source and exported pixels never include it.
      const selected=local.details.open?localMasks.find(mask=>mask.id===selectedMask.value):undefined
      const overlay=afterCanvas.getContext('2d')
      if(selected && overlay){
        const w=afterCanvas.width,h=afterCanvas.height
        overlay.save()
        overlay.strokeStyle='#facc15';overlay.fillStyle='#facc15'
        overlay.lineWidth=Math.max(1,w/350)
        overlay.setLineDash([Math.max(3,w/90),Math.max(2,w/150)])
        if(selected.kind==='radial'){
          overlay.beginPath()
          overlay.ellipse(selected.x*w,selected.y*h,selected.radiusX*w,selected.radiusY*h,0,0,Math.PI*2)
          overlay.stroke()
          if(selected.feather>0){
            overlay.strokeStyle='#fff';overlay.beginPath()
            overlay.ellipse(selected.x*w,selected.y*h,
              selected.radiusX*w*(1-selected.feather),selected.radiusY*h*(1-selected.feather),
              0,0,Math.PI*2)
            overlay.stroke()
          }
        }else if(selected.kind==='linear'){
          overlay.beginPath()
          overlay.moveTo(selected.x*w,selected.y*h)
          overlay.lineTo(selected.x2*w,selected.y2*h)
          overlay.stroke()
          overlay.setLineDash([])
          for(const [x,y] of [[selected.x,selected.y],[selected.x2,selected.y2]]){
            overlay.beginPath();overlay.arc(x*w,y*h,Math.max(3,w/120),0,Math.PI*2)
            overlay.fill()
          }
        }else if(selected.kind==='brush'){
          overlay.setLineDash([])
          for(const stroke of selected.strokes??[]){
            overlay.beginPath()
            overlay.strokeStyle=stroke.mode==='erase'?'#fda4af':'#facc15'
            overlay.lineWidth=Math.max(2,stroke.size/100*Math.min(w,h))
            overlay.lineCap='round';overlay.lineJoin='round'
            stroke.points.forEach((p,i)=>{
              if(i===0)overlay.moveTo(p.x*w,p.y*h)
              else overlay.lineTo(p.x*w,p.y*h)
            })
            if(stroke.points.length===1){
              const p=stroke.points[0]
              overlay.arc(p.x*w,p.y*h,0.1,0,Math.PI*2)
            }
            overlay.globalAlpha=0.5;overlay.stroke()
          }
        }
        overlay.restore()
      }
      const hist=rawPreviewHistogram(adjusted)
      const ctx=histogramCanvas.getContext('2d')
      if(ctx){
        const h=histogramCanvas.height,w=histogramCanvas.width
        ctx.clearRect(0,0,w,h)
        const maximum=Math.max(1,...hist.bins)
        const colors=['#f87171','#86efac','#93c5fd','#dedede']
        for(let channel=0;channel<4;channel++){
          ctx.beginPath();ctx.strokeStyle=colors[channel];ctx.lineWidth=1
          for(let bin=0;bin<256;bin++){
            const x=bin*w/255,y=h-(hist.bins[channel*256+bin]/maximum)*(h-3)
            if(bin===0)ctx.moveTo(x,y)
            else ctx.lineTo(x,y)
          }
          ctx.stroke()
        }
      }
      const ratio=hist.pixels?100/hist.pixels:0
      previewStatus.textContent='Live tone/HSL preview (not final export) — '+
        previewBase.width+' × '+previewBase.height+
        '; clipped shadows '+(hist.clippedShadows*ratio).toFixed(1)+'%, highlights '+
        (hist.clippedHighlights*ratio).toFixed(1)+'%.'
    }
    const schedulePreview=()=>{
      if(!previewBase||previewLoading)return
      if(previewTimer!==undefined)clearTimeout(previewTimer)
      previewTimer=setTimeout(()=>{previewTimer=undefined;renderPreview()},100)
    }
    previewButton.addEventListener('click',async()=>{
      if(!sourceFile||previewLoading||!dialog.open)return
      previewLoading=true
      const generation=++previewGeneration
      previewButton.disabled=true
      apply.disabled=true
      previewStatus.textContent='Developing half-resolution preview from original RAW…'
      const settings=readSettings()
      const fingerprint=sensorKey(settings)
      try{
        // Lazy import: the heavy WASM decoder is not loaded at editor startup.
        const {decodeCameraRaw}=await import('./wasm-codecs')
        const decoded=await decodeCameraRaw(await sourceFile.arrayBuffer(),{
          ...settings,halfSize:true,tone:{...DEFAULT_RAW_TONE},
          colorMix:normalizeRawColorMix(DEFAULT_RAW_COLOR_MIX),curves:normalizeRawCurves(DEFAULT_RAW_CURVES),localMasks:[],
        })
        if(generation!==previewGeneration||!dialog.open)return
        previewBase=downsampleRawPreview(decoded,480)
        previewKey=fingerprint
        renderPreview()
      }catch(error){
        if(generation===previewGeneration&&dialog.open)
          previewStatus.textContent='RAW preview failed: '+(error instanceof Error?error.message:String(error))
      }finally{
        if(generation===previewGeneration){
          previewLoading=false
          if(dialog.open){previewButton.disabled=false;apply.disabled=false}
        }
      }
    })
    for(const input of Object.values(toneInputs))input.addEventListener('input',schedulePreview)
    for(const channel of RAW_CURVE_CHANNELS)
      curveInputs[channel].forEach(input=>input.addEventListener('input',schedulePreview))
    for(const band of RAW_MIX_BANDS)
      for(const property of mixProperties)mixInputs[band][property].addEventListener('input',schedulePreview)
    const sensorInputs=[exposure,whiteBalance,interpolation,highlight,denoise,
      k1,k2,tca,vignette,lensName]
    for(const input of sensorInputs){
      input.addEventListener('input',schedulePreview)
      input.addEventListener('change',schedulePreview)
    }
    notifySensorChange=schedulePreview
    // Imported presets update input values programmatically and do not
    // dispatch input events. Refresh the live preview explicitly.
    refreshEditedPreview=schedulePreview
    notifyLocalPreview=schedulePreview
    local.details.addEventListener('toggle',schedulePreview)
    presetTools.append(savePreset,loadPreset,presetStatus)
    actions.append(cancel,apply)
    dialog.append(heading,caption,previewSection,form,basic.details,curve.details,mix.details,local.details,optics.details,presetTools,actions)
    dialog.addEventListener('close',()=>{
      previewGeneration++
      previewBase=null
      if(previewTimer!==undefined)clearTimeout(previewTimer)
      const result=dialog.returnValue==='apply'?readSettings():null
      if(result)try{localStorage.setItem(storageKey,JSON.stringify(result))}catch{}
      dialog.remove();resolve(result)
    },{once:true})
    document.body.append(dialog)
    try{dialog.showModal()}catch{dialog.remove();resolve(current)}
  })
}
