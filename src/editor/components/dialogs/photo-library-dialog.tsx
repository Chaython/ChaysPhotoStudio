'use client'

import {useEffect,useMemo,useRef,useState} from 'react'
import {DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select'
import {readImageMetadata} from '../../formats/metadata'
import {decodePublishedFormatPreview,publishedFormatKind} from '../../formats/photopea-formats'
import {openFiles} from '../../engine/io'
import {useEditorStore} from '../../store'
import {
  catalogFilterPhotos,catalogFingerprint,catalogKeywords,catalogList,catalogPut,
  catalogRemove,catalogRating,MAX_CATALOG_IMPORT,MAX_CATALOG_SOURCE_BYTES,
  type CatalogPhoto,type CatalogSort,type PhotoFlag,
} from '../../library/photo-catalog'
import type {DialogProps} from './generic-dialogs'

const allowed=(file:File):boolean=>{
  const kind=publishedFormatKind(file.name)
  return kind==='raw'||kind==='raster'||file.type.startsWith('image/')
}
const metadataValue=(fields:{tag:string;label:string;value:string}[],keys:string[])=>{
  const target=keys.map(k=>k.toLowerCase())
  return fields.find(field=>target.includes(field.tag.toLowerCase())||
    target.includes(field.label.toLowerCase()))?.value??''
}
async function makeThumbnail(file:File):Promise<{blob:Blob|null;width:number;height:number}>{
  try{
    let image:HTMLCanvasElement|ImageBitmap
    if(publishedFormatKind(file.name)==='raw'){
      // Embedded JPEG previews avoid full LibRaw sensor decoding for library thumbnails.
      image=await decodePublishedFormatPreview(file,file.name)
    }else{
      try{image=await createImageBitmap(file)}
      catch{image=(await (await import('../../formats')).decodeFile(file)).canvas}
    }
    const width=image.width,height=image.height
    const ratio=Math.min(1,320/Math.max(width,height))
    const out=document.createElement('canvas')
    out.width=Math.max(1,Math.round(width*ratio))
    out.height=Math.max(1,Math.round(height*ratio))
    const ctx=out.getContext('2d')
    if(!ctx)throw Error('Canvas2D unavailable')
    ctx.imageSmoothingQuality='high'
    ctx.drawImage(image,0,0,out.width,out.height)
    if('close' in image&&typeof image.close==='function')image.close()
    const blob=await new Promise<Blob|null>(resolve=>out.toBlob(resolve,'image/jpeg',0.76))
    return {blob,width,height}
  }catch{
    // An unsupported RAW preview still produces a searchable metadata record.
    return {blob:null,width:0,height:0}
  }
}
export function PhotoLibraryDialog({onClose}:DialogProps){
  const [entries,setEntries]=useState<CatalogPhoto[]>([])
  const [search,setSearch]=useState('')
  const [kind,setKind]=useState<'all'|'raw'|'image'>('all')
  const [flag,setFlag]=useState<PhotoFlag|'all'>('all')
  const [minRating,setMinRating]=useState('0')
  const [sort,setSort]=useState<CatalogSort>('added')
  const [selectedId,setSelectedId]=useState('')
  const [keywordDraft,setKeywordDraft]=useState('')
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const [thumbnails,setThumbnails]=useState<Record<string,string>>({})
  const sessionFiles=useRef(new Map<string,File>())
  const cancelled=useRef(false)
  const store=useEditorStore.getState()
  useEffect(()=>{
    let alive=true
    catalogList().then(list=>{
      if(alive){setEntries(list);setSelectedId(list[0]?.id??'')}
    }).catch(err=>{if(alive)setNotice('Library storage unavailable: '+String(err))})
    return ()=>{alive=false;cancelled.current=true}
  },[])
  useEffect(()=>{
    const next:Record<string,string>={}
    for(const p of entries)if(p.thumbnail)next[p.id]=URL.createObjectURL(p.thumbnail)
    setThumbnails(next)
    return ()=>{Object.values(next).forEach(url=>URL.revokeObjectURL(url))}
  },[entries])
  const photos=useMemo(()=>catalogFilterPhotos(entries,{
    search,kind,flag,ratingAtLeast:Number(minRating),sort,
  }),[entries,search,kind,flag,minRating,sort])
  const selected=entries.find(p=>p.id===selectedId)
  useEffect(()=>{setKeywordDraft(selected?.keywords.join(', ')??'')},[selectedId,selected?.keywords.join(',')])
  const update=async(changes:Partial<CatalogPhoto>)=>{
    if(!selected)return
    const next={...selected,...changes}
    try{
      await catalogPut(next)
      setEntries(old=>old.map(p=>p.id===next.id?next:p))
    }catch(err){setNotice('Could not save library changes: '+String(err))}
  }
  const importPhotos=async(files:File[])=>{
    if(busy||!files.length)return
    if(files.length>MAX_CATALOG_IMPORT){
      setNotice('Select at most '+MAX_CATALOG_IMPORT+' photos per import.')
      return
    }
    cancelled.current=false;setBusy(true)
    let added=0,duplicates=0,failed=0,noPreview=0
    const known=new Map(entries.map(p=>[p.id,p]))
    try{
      for(let i=0;i<files.length;i++){
        if(cancelled.current)break
        const file=files[i]
        setNotice('Indexing '+(i+1)+'/'+files.length+': '+file.name)
        await new Promise(resolve=>setTimeout(resolve,0))
        if(!allowed(file)||file.size===0||file.size>MAX_CATALOG_SOURCE_BYTES){
          failed++;continue
        }
        try{
          const id=await catalogFingerprint(file)
          sessionFiles.current.set(id,file)
          if(known.has(id)){duplicates++;continue}
          const metadata=await readImageMetadata(file).catch(()=>null)
          const fields=metadata?.fields??[]
          const make=metadataValue(fields,['Make','Camera Make'])
          const model=metadataValue(fields,['Model','Camera Model'])
          const camera=[make,model].filter(Boolean).join(' ').slice(0,120)
          const takenAt=metadataValue(fields,['DateTimeOriginal','Date/Time Original','Date Time Original','Create Date'])
            .slice(0,48)
          const thumb=await makeThumbnail(file)
          if(!thumb.blob)noPreview++
          const item:CatalogPhoto={
            id,name:file.name,bytes:file.size,modified:file.lastModified,addedAt:Date.now(),
            kind:publishedFormatKind(file.name)==='raw'?'raw':'image',
            rating:0,flag:'none',keywords:[],camera,takenAt,
            width:thumb.width,height:thumb.height,thumbnail:thumb.blob,
          }
          await catalogPut(item)
          known.set(id,item)
          added++
          setEntries([...known.values()])
          setSelectedId(id)
        }catch{
          failed++
        }
      }
      setNotice('Indexed '+added+' new photo(s); '+duplicates+' already indexed; '+
        failed+' failed or unsupported'+(noPreview?', '+noPreview+' without thumbnails':'')+
        (cancelled.current?'. Cancelled.':'. Originals stay on your disk.'))
    }finally{setBusy(false)}
  }
  const remove=async()=>{
    if(!selected||busy)return
    if(!window.confirm('Remove '+selected.name+' from this local catalog? The original photograph is not deleted.'))return
    try{
      await catalogRemove(selected.id)
      sessionFiles.current.delete(selected.id)
      setEntries(old=>old.filter(p=>p.id!==selected.id))
      setSelectedId('')
      setNotice('Catalog entry removed. The source file was not changed.')
    }catch(err){setNotice('Cannot remove catalog entry: '+String(err))}
  }
  const openSelected=async()=>{
    if(!selected)return
    const file=sessionFiles.current.get(selected.id)
    if(!file){setNotice('Original not linked in this session. Re-select that photo using Relink original.');return}
    onClose()
    await openFiles([file])
  }
  const relink=async(file?:File)=>{
    if(!file||!selected)return
    try{
      const id=await catalogFingerprint(file)
      if(id!==selected.id){setNotice('This original does not match the catalog fingerprint. No link was changed.');return}
      sessionFiles.current.set(id,file)
      setNotice('Original relinked for this session. You can open it for editing.')
    }catch(err){setNotice('Unable to relink original: '+String(err))}
  }
  const fmt=(n:number)=>n>=1024**2?(n/1024**2).toFixed(1)+' MiB':Math.round(n/1024)+' KiB'
  return <>
    <DialogHeader><DialogTitle>Photo Library</DialogTitle></DialogHeader>
    <p className="text-xs text-muted-foreground">
      Local searchable library for RAW and other photographs. Only catalog metadata and
      small previews are saved in this browser; originals are never uploaded or copied.
      After reopening the app, relink an original to edit it.
    </p>
    <div className="flex items-center gap-2 flex-wrap">
      <Input type="file" multiple accept="image/*,.dng,.cr2,.cr3,.nef,.nrw,.arw,.raf,.rw2,.orf,.pef,.3fr,.iiq,.mos,.mrw,.mef,.raw,.erf,.srf,.sr2"
        disabled={busy} className="max-w-xs text-xs"
        onChange={e=>{void importPhotos(Array.from(e.target.files??[]));e.target.value=''}}/>
      <span className="text-xs text-muted-foreground">{entries.length} indexed</span>
      {busy&&<Button size="sm" variant="outline" onClick={()=>{cancelled.current=true}}>Cancel after current photo</Button>}
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div className="col-span-2 space-y-1"><Label className="text-xs">Search name, camera, date and keywords</Label>
        <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search library…" className="h-8 text-xs"/></div>
      <div className="space-y-1"><Label className="text-xs">Filter</Label>
        <Select value={kind} onValueChange={v=>setKind(v as typeof kind)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="all">All photos</SelectItem><SelectItem value="raw">RAW</SelectItem><SelectItem value="image">Other images</SelectItem></SelectContent>
        </Select></div>
      <div className="space-y-1"><Label className="text-xs">Sort</Label>
        <Select value={sort} onValueChange={v=>setSort(v as CatalogSort)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="added">Recently indexed</SelectItem><SelectItem value="date">Capture date</SelectItem><SelectItem value="rating">Top rated</SelectItem><SelectItem value="name">Filename</SelectItem></SelectContent>
        </Select></div>
      <div className="space-y-1"><Label className="text-xs">Rating</Label>
        <Select value={minRating} onValueChange={setMinRating}>
          <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
          <SelectContent>{[0,1,2,3,4,5].map(i=><SelectItem key={i} value={String(i)}>{i===0?'Any rating':i+'+ stars'}</SelectItem>)}</SelectContent>
        </Select></div>
      <div className="space-y-1"><Label className="text-xs">Flag</Label>
        <Select value={flag} onValueChange={v=>setFlag(v as PhotoFlag|'all')}>
          <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="all">All flags</SelectItem><SelectItem value="pick">Picked</SelectItem><SelectItem value="reject">Rejected</SelectItem><SelectItem value="none">Unflagged</SelectItem></SelectContent>
        </Select></div>
    </div>
    <div className="text-xs text-muted-foreground">
      {photos.length} matching photo(s){photos.length>200?' · showing first 200':''}
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto zphoto-scroll">
      {photos.slice(0,200).map(p=><button key={p.id} type="button" onClick={()=>setSelectedId(p.id)}
        className={'text-left rounded-md border p-1.5 space-y-1 hover:bg-muted/40 '+(selectedId===p.id?'border-primary':'border-border')}
        aria-pressed={selectedId===p.id}>
        <div className="h-24 bg-muted/30 rounded flex justify-center items-center overflow-hidden">
          {thumbnails[p.id]?<img src={thumbnails[p.id]} alt="" loading="lazy" className="max-w-full max-h-full object-contain"/>:
            <span className="text-[11px] text-muted-foreground">Preview unavailable</span>}
        </div>
        <div className="truncate text-[11px]" title={p.name}>{p.name}</div>
        <div className="text-[10px] text-muted-foreground">{'★'.repeat(p.rating)}{'☆'.repeat(5-p.rating)} {p.flag==='pick'?'✓':p.flag==='reject'?'×':''}</div>
      </button>)}
    </div>
    {selected&&<div className="border-t pt-2 space-y-2">
      <p className="text-xs font-medium break-all">{selected.name} · {fmt(selected.bytes)}
        {selected.camera?' · '+selected.camera:''}
        {selected.width?' · '+selected.width+'×'+selected.height:''}</p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-xs mr-1">Rating:</span>
        {[0,1,2,3,4,5].map(n=><Button key={n} type="button" size="sm"
          variant={selected.rating===n?'default':'outline'} className="h-7 min-w-7 px-2"
          onClick={()=>{void update({rating:catalogRating(n)})}}>{n===0?'—':n+'★'}</Button>)}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {(['none','pick','reject'] as const).map(value=><Button key={value}
          type="button" size="sm" variant={selected.flag===value?'default':'outline'}
          onClick={()=>{void update({flag:value})}}>{value==='none'?'Unflag':value==='pick'?'Pick':'Reject'}</Button>)}
      </div>
      <div className="flex gap-2 items-end">
        <div className="flex-1 space-y-1"><Label className="text-xs">Keywords (comma-separated)</Label>
          <Input className="h-8 text-xs" value={keywordDraft} maxLength={1500}
            onChange={e=>setKeywordDraft(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void update({keywords:catalogKeywords(keywordDraft)})}}}/></div>
        <Button size="sm" type="button" onClick={()=>{void update({keywords:catalogKeywords(keywordDraft)})}}>Save tags</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" type="button" onClick={()=>{void openSelected()}}>Open original</Button>
        <Input type="file" aria-label="Relink original" className="text-xs max-w-48" onChange={e=>{void relink(e.target.files?.[0]);e.target.value=''}}/>
        <Button size="sm" variant="destructive" type="button" onClick={()=>{void remove()}}>Remove from catalog</Button>
        <span className="text-[11px] text-muted-foreground">{sessionFiles.current.has(selected.id)?'Original linked this session':'Relink original to edit'}</span>
      </div>
    </div>}
    {notice&&<p role="status" className="text-xs text-muted-foreground whitespace-pre-wrap">{notice}</p>}
    <DialogFooter><Button variant="outline" size="sm" onClick={onClose}>Close</Button></DialogFooter>
  </>
}
