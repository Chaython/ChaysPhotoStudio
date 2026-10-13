/** Local-first searchable photo catalog. IndexedDB keeps metadata and bounded
 * thumbnails only, never the original photographs or device file paths.
 * To reopen after a restart, a user must explicitly relink an original file.
 */
export type PhotoFlag = 'none'|'pick'|'reject'
export interface CatalogPhoto {
  id:string
  name:string
  bytes:number
  modified:number
  addedAt:number
  kind:'raw'|'image'
  rating:number
  flag:PhotoFlag
  keywords:string[]
  camera:string
  takenAt:string
  width:number
  height:number
  thumbnail:Blob|null
}
export type CatalogSort = 'added'|'name'|'rating'|'date'
export interface CatalogFilter {
  search?:string
  ratingAtLeast?:number
  flag?:PhotoFlag|'all'
  kind?:'raw'|'image'|'all'
  sort?:CatalogSort
}
export const MAX_CATALOG_IMPORT=250
export const MAX_CATALOG_SOURCE_BYTES=256*1024*1024
const DATABASE='chays-photo-catalog'
const STORE='photos'
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n))
export function catalogKeywords(input:string|readonly string[]):string[] {
  const raw=typeof input==='string'?input.split(','):input
  const result:string[]=[]
  const unique=new Set<string>()
  for(const item of raw){
    if(typeof item!=='string')continue
    const cleaned=item.replace(/[\u0000-\u001f]/g,' ').trim().replace(/\s+/g,' ').slice(0,50)
    if(!cleaned)continue
    const normalized=cleaned.toLocaleLowerCase()
    if(unique.has(normalized))continue
    unique.add(normalized);result.push(cleaned)
    if(result.length===30)break
  }
  return result
}
export function catalogRating(input:number):number {
  return Number.isFinite(input)?Math.round(clamp(input,0,5)):0
}
export function catalogFilterPhotos(items:readonly CatalogPhoto[],filter:CatalogFilter={}):CatalogPhoto[]{
  const terms=(filter.search??'').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0,12)
  const minimum=catalogRating(filter.ratingAtLeast??0)
  const matched=items.filter(photo=>{
    if(photo.rating<minimum)return false
    if(filter.flag && filter.flag!=='all'&&photo.flag!==filter.flag)return false
    if(filter.kind && filter.kind!=='all'&&photo.kind!==filter.kind)return false
    if(!terms.length)return true
    const haystack=[photo.name,photo.camera,photo.takenAt,...photo.keywords]
      .join(' ').toLocaleLowerCase()
    return terms.every(term=>haystack.includes(term))
  })
  const sort=filter.sort??'added'
  matched.sort((a,b)=>{
    const diff=sort==='name'?a.name.localeCompare(b.name):sort==='rating'
      ?b.rating-a.rating:sort==='date'
      ?b.takenAt.localeCompare(a.takenAt):b.addedAt-a.addedAt
    return diff||a.id.localeCompare(b.id)
  })
  return matched
}
/** Fast content fingerprint for relinking: size and first/last 64KiB.
 * No filename/path is stored in fingerprint; same content survives rename.
 * It is not a cryptographic full-file integrity checksum. */
export async function catalogFingerprint(file:Blob):Promise<string>{
  const size=file.size
  const sample=65536
  const front=new Uint8Array(await file.slice(0,Math.min(sample,size)).arrayBuffer())
  const back=size>sample?new Uint8Array(await file.slice(Math.max(sample,size-sample),size).arrayBuffer())
    :new Uint8Array(0)
  const buffer=new Uint8Array(8+front.length+back.length)
  const view=new DataView(buffer.buffer)
  view.setUint32(0,Math.floor(size/2**32));view.setUint32(4,size>>>0)
  buffer.set(front,8);buffer.set(back,8+front.length)
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))
  return Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('')
}
function database():Promise<IDBDatabase>{
  if(typeof indexedDB==='undefined')return Promise.reject(Error('IndexedDB unavailable in this browser'))
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1)
    request.onupgradeneeded=()=>{
      const db=request.result
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'})
    }
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error??Error('Catalog database unavailable'))
    request.onblocked=()=>reject(Error('Another window is blocking the photo catalog database'))
  })
}
async function transaction<T>(
  mode:IDBTransactionMode,action:(store:IDBObjectStore,resolve:(value:T)=>void,reject:(err:Error)=>void)=>void,
):Promise<T>{
  const db=await database()
  try {
    return await new Promise<T>((resolve,reject)=>{
      const tx=db.transaction(STORE,mode)
      let result:T
      let completed=false
      tx.oncomplete=()=>{completed=true;resolve(result)}
      tx.onerror=()=>reject(tx.error??Error('Catalog storage failed'))
      tx.onabort=()=>reject(tx.error??Error('Catalog storage aborted'))
      try{
        action(tx.objectStore(STORE),(value:T)=>{result=value},(err:Error)=>{
          if(!completed){try{tx.abort()}catch{}}
          reject(err)
        })
      }catch(err){
        try{tx.abort()}catch{}
        reject(err)
      }
    })
  }finally{db.close()}
}
export function catalogList():Promise<CatalogPhoto[]>{
  return transaction<CatalogPhoto[]>('readonly',(store,done)=>{
    const req=store.getAll()
    req.onsuccess=()=>done(req.result as CatalogPhoto[])
  })
}
export function catalogPut(photo:CatalogPhoto):Promise<void>{
  return transaction<void>('readwrite',(store,done)=>{
    const req=store.put({...photo,rating:catalogRating(photo.rating),
      keywords:catalogKeywords(photo.keywords)})
    req.onsuccess=()=>done(undefined)
  })
}
export function catalogRemove(id:string):Promise<void>{
  return transaction<void>('readwrite',(store,done)=>{
    const req=store.delete(id)
    req.onsuccess=()=>done(undefined)
  })
}
