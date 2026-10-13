'use client'

import { useEffect, useRef, useState } from 'react'
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEditorStore } from '../../store'
import { DEFAULT_RAW_SETTINGS, makeBatchSafeRawSettings, rawSettingsFromSaved } from '../../formats/raw-develop'
import { runRawBatchExport, MAX_BATCH_RAW_FILES, type BatchRawExportFormat } from '../../formats/raw-batch-export'
import { rawToCanvas } from '../../formats/decoders'
import { encodeTiff, encodeTiff16 } from '../../formats/encoders'
import { generateSrgbIccV2, embedSrgbIccJpeg } from '../../formats/srgb-icc'
import { encodeCanvas } from '../../formats'
import { downloadBlob } from '../../utils/canvas'
import { publishedFormatKind } from '../../formats/photopea-formats'
import type { DialogProps } from './generic-dialogs'

type WritableDirectory={
  getFileHandle:(name:string,opts?:{create?:boolean})=>Promise<{
    createWritable:()=>Promise<{write:(blob:Blob)=>Promise<void>;close:()=>Promise<void>;abort?:()=>Promise<void>}>
  }>
}
const MAX_RAW_BYTES=256*1024*1024
async function findNewFileName(directory:WritableDirectory,name:string):Promise<string>{
  // Never silently replace an existing user's photograph or export.
  const extension=name.lastIndexOf('.')
  const stem=extension>0?name.slice(0,extension):name
  const suffix=extension>0?name.slice(extension):''
  for(let i=1;i<=9999;i++){
    const candidate=i===1?name:stem+'-'+i+suffix
    try{await directory.getFileHandle(candidate);continue}
    catch(error){
      if((error as {name?:string})?.name==='NotFoundError')return candidate
      throw error
    }
  }
  throw Error('No available output filename for '+name)
}
async function saveInto(directory:WritableDirectory,name:string,blob:Blob):Promise<void>{
  const unique=await findNewFileName(directory,name)
  const handle=await directory.getFileHandle(unique,{create:true})
  const writable=await handle.createWritable()
  try{
    await writable.write(blob)
    await writable.close()
  }catch(err){
    try{await writable.abort?.()}catch{}
    throw err
  }
}
const formatLabels:Record<BatchRawExportFormat,string>={
  jpeg:'JPEG · adjustable quality, 8-bit',
  tiff8:'TIFF · 8-bit LZW',
  tiff16:'TIFF · native 16-bit LZW',
}
export function RawBatchExportDialog({onClose}:DialogProps){
  const [files,setFiles]=useState<File[]>([])
  const [format,setFormat]=useState<BatchRawExportFormat>('jpeg')
  const [quality,setQuality]=useState(92)
  const [preset,setPreset]=useState<'current'|'neutral'>('current')
  const [directory,setDirectory]=useState<WritableDirectory|null>(null)
  const [destination,setDestination]=useState('Browser downloads')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const cancel=useRef(false)
  useEffect(()=>()=>{cancel.current=true},[])
  const store=useEditorStore.getState()
  const canChooseFolder=typeof window!=='undefined'&&
    typeof (window as Window & {showDirectoryPicker?:unknown}).showDirectoryPicker==='function'
  const chooseFolder=async()=>{
    const picker=(window as Window & {showDirectoryPicker?:()=>Promise<WritableDirectory>}).showDirectoryPicker
    if(!picker)return
    try{
      const selected=await picker()
      setDirectory(selected)
      setDestination('Selected output folder')
    }catch(error){
      if((error as {name?:string})?.name!=='AbortError')
        setMessage('Folder selection failed: '+(error instanceof Error?error.message:String(error)))
    }
  }
  const exportBatch=async()=>{
    if(busy||!files.length)return
    setBusy(true);cancel.current=false;setMessage('')
    let usedDownloads=0
    try{
      const recipe=makeBatchSafeRawSettings(preset==='current'?rawSettingsFromSaved():DEFAULT_RAW_SETTINGS)
      // A batch export produces final-resolution developed photos, never the
      // half-size preview; the original RAW is read but never written.
      recipe.halfSize=false
      const {decodeCameraRaw}=await import('../../formats/wasm-codecs')
      const srgbIcc=generateSrgbIccV2()
      const result=await runRawBatchExport(files,format,async(file,name)=>{
        if(publishedFormatKind(file.name)!=='raw')throw Error('Not a recognized camera RAW file')
        if(file.size<=0||file.size>MAX_RAW_BYTES)
          throw Error('RAW input must be between 1 byte and 256 MiB')
        const decoded=await decodeCameraRaw(await file.arrayBuffer(),recipe)
        let blob:Blob
        if(format==='tiff16'){
          if(!decoded.rgba16)throw Error('Decoder returned no 16-bit samples; refusing 8-bit substitution')
          const bytes=encodeTiff16(decoded.rgba16,decoded.width,decoded.height,true,{iccProfile:srgbIcc})
          blob=new Blob([new Uint8Array(bytes)],{type:'image/tiff'})
        }else if(format==='tiff8'){
          const bytes=encodeTiff(decoded.rgba,decoded.width,decoded.height,true,{iccProfile:srgbIcc})
          blob=new Blob([new Uint8Array(bytes)],{type:'image/tiff'})
        }else{
          const canvas=rawToCanvas(decoded)
          const jpeg=await encodeCanvas(canvas,'jpeg',{
            quality,includeMetadata:false,background:'#ffffff',
          })
          const tagged=embedSrgbIccJpeg(new Uint8Array(await jpeg.arrayBuffer()),srgbIcc)
          blob=new Blob([new Uint8Array(tagged)],{type:'image/jpeg'})
        }
        if(directory)await saveInto(directory,name,blob)
        else{
          downloadBlob(blob,name)
          usedDownloads++
          // Multiple automatic downloads can require site permission. No
          // claim is made that the browser completed every download.
          await new Promise(resolve=>setTimeout(resolve,125))
        }
      },{
        isCancelled:()=>cancel.current,
        onProgress:state=>{
          store.setProgress({active:true,
            label:'RAW batch '+(state.index+1)+'/'+state.total+': '+state.fileName,
            value:state.total?state.index/state.total:0})
          setMessage('Processing '+(state.index+1)+'/'+state.total+': '+state.fileName)
        },
      })
      const finalMessage=result.exported+' processed, '+result.failed+' failed'+
        (result.cancelled?' (cancelled)':'')+
        (usedDownloads?' — Browser requested '+usedDownloads+' downloads; check its download permission/settings.':'')
      setMessage(finalMessage+(result.errors.length?
        '\n'+result.errors.slice(0,5).map(e=>e.fileName+': '+e.reason).join('\n'):''))
      store.pushToast(finalMessage,result.failed?'info':'success')
      if(result.exported>0&&!result.failed&&!result.cancelled)onClose()
    }catch(error){
      const reason=error instanceof Error?error.message:String(error)
      setMessage('Batch export stopped: '+reason)
      store.pushToast('Batch RAW export failed — '+reason,'error')
    }finally{
      store.setProgress(null)
      setBusy(false)
    }
  }
  return <>
    <DialogHeader><DialogTitle>Batch RAW Export</DialogTitle></DialogHeader>
    <div className="space-y-3 py-1">
      <p className="text-xs text-muted-foreground">
        Develop source RAW photos sequentially using the saved global recipe or
        neutral settings. Each input remains unchanged. Camera/lens-specific
        calibration and local/brush masks are not copied across images.
      </p>
      <div className="space-y-1">
        <Label className="text-xs">RAW source files (up to {MAX_BATCH_RAW_FILES})</Label>
        <Input type="file" multiple accept=".cr2,.cr3,.nef,.nrw,.arw,.srf,.sr2,.raf,.rw2,.orf,.pef,.dng,.3fr,.fff,.iiq,.k25,.kdc,.mos,.mrw,.mef,.raw,.erf,.bay,.cap,.data,.eip" disabled={busy}
          onChange={event=>{
            const chosen=Array.from(event.target.files??[])
            setFiles(chosen.slice(0,MAX_BATCH_RAW_FILES))
            setMessage(chosen.length>MAX_BATCH_RAW_FILES?
              'Only the first '+MAX_BATCH_RAW_FILES+' files were selected.':'')
          }} />
        <p className="text-[11px] text-muted-foreground">{files.length} file(s) selected</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Export format</Label>
          <Select value={format} onValueChange={v=>setFormat(v as BatchRawExportFormat)} disabled={busy}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(formatLabels).map(([id,label])=>
                <SelectItem key={id} value={id}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Develop recipe</Label>
          <Select value={preset} onValueChange={v=>setPreset(v as 'current'|'neutral')} disabled={busy}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="current">Saved global RAW settings</SelectItem>
              <SelectItem value="neutral">Neutral camera defaults</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {format==='jpeg'&&<div className="space-y-1">
        <Label className="text-xs">JPEG quality: {quality}%</Label>
        <Input type="range" min={40} max={100} value={quality} disabled={busy}
          onChange={e=>setQuality(Number(e.target.value))} />
      </div>}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {canChooseFolder&&<Button variant="outline" size="sm" disabled={busy} onClick={chooseFolder}>
          Choose output folder…
        </Button>}
        <span className="text-muted-foreground">{destination}</span>
      </div>
      {!directory&&<p className="text-xs text-muted-foreground">
        Individual browser downloads may be blocked until multiple downloads are allowed.
        {canChooseFolder?' Choose an output folder for more reliable multi-photo saving.':''}
      </p>}
      <p className="text-[11px] text-muted-foreground">
        JPEG and both TIFF variants embed a generated sRGB ICC profile without\n        changing developed pixel values. Existing files in an output folder are not overwritten. 16-bit TIFF retains
        decoded 16-bit samples; JPEG and 8-bit TIFF are display-referred. Camera RAW
        development runs on the main thread and cancellation takes effect between photos.
      </p>
      {message&&<p role="status" className="text-xs whitespace-pre-wrap break-words max-h-36 overflow-y-auto">{message}</p>}
    </div>
    <DialogFooter>
      {busy?<Button variant="outline" size="sm" onClick={()=>{cancel.current=true;setMessage('Cancelling after the current photo…')}}>
        Cancel remaining
      </Button>:<Button variant="outline" size="sm" onClick={onClose}>Close</Button>}
      <Button size="sm" disabled={busy||files.length===0} onClick={()=>{void exportBatch()}}>
        {busy?'Exporting…':'Export '+files.length+' RAW photo'+(files.length===1?'':'s')}
      </Button>
    </DialogFooter>
  </>
}
