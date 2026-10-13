// Small, pure controller for multi-file camera RAW export. No background work,
// no source-file writes and no global state. All files are processed serially.
export type BatchRawExportFormat = 'jpeg' | 'tiff8' | 'tiff16'
export interface BatchRawFile { name: string }
export interface BatchRawProgress {
  index: number
  total: number
  fileName: string
  completed: number
  failed: number
}
export interface BatchRawResult {
  exported: number
  failed: number
  cancelled: boolean
  errors: { fileName: string; reason: string }[]
}
export const MAX_BATCH_RAW_FILES = 150

const extension=(format:BatchRawExportFormat):string => format==='jpeg'?'jpg':'tif'
const reserved=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
/** Safe on Windows, macOS and Linux, including duplicate/case-conflicting names. */
export function rawBatchOutputNames(files:readonly BatchRawFile[],format:BatchRawExportFormat,suffix='-developed'):string[] {
  const claimed=new Set<string>()
  return files.map((file,index)=>{
    const base=file.name.replace(/\.[^./\\]+$/,'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-')
      .replace(/[. ]+$/g,'').replace(/^\.+/g,'').trim().slice(0,100)
    const root=(base&&!reserved.test(base)?base:'RAW-'+String(index+1).padStart(3,'0'))
    const safeSuffix=suffix.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-')
      .replace(/[. ]+$/g,'').slice(0,32)
    const stem=root+safeSuffix
    let target=stem+'.'+extension(format),counter=2
    while(claimed.has(target.toLowerCase())){
      target=stem+'-'+counter+'.'+extension(format)
      counter++
    }
    claimed.add(target.toLowerCase())
    return target
  })
}
/** Isolated per-file progress/error handling and cooperative cancellation. */
export async function runRawBatchExport<T extends BatchRawFile>(
  files:readonly T[],
  format:BatchRawExportFormat,
  process:(file:T,name:string,index:number)=>Promise<void>,
  options:{
    isCancelled?:()=>boolean
    onProgress?:(state:BatchRawProgress)=>void
    suffix?:string
  }={},
):Promise<BatchRawResult>{
  if(files.length>MAX_BATCH_RAW_FILES)throw Error('Select at most '+MAX_BATCH_RAW_FILES+' RAW photos per batch')
  const names=rawBatchOutputNames(files,format,options.suffix)
  const result:BatchRawResult={exported:0,failed:0,cancelled:false,errors:[]}
  for(let i=0;i<files.length;i++){
    if(options.isCancelled?.()){result.cancelled=true;break}
    const file=files[i]
    options.onProgress?.({index:i,total:files.length,fileName:file.name,
      completed:result.exported,failed:result.failed})
    try {
      await process(file,names[i],i)
      result.exported++
    } catch (err) {
      result.failed++
      result.errors.push({fileName:file.name,
        reason:err instanceof Error?err.message:String(err)})
    }
  }
  return result
}
