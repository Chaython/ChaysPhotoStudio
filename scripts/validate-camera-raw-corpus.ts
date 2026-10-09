/** Explicit opt-in regression corpus for real camera RAW compression variants.
 *  Never downloads user photos, never accepts embedded previews as a pass.
 *  Manifest paths are relative to its containing directory.
 */
import { readFile } from 'node:fs/promises'
import { resolve, dirname, basename, isAbsolute, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { decodeCameraRaw } from '../src/editor/formats/wasm-codecs'
import { DEFAULT_RAW_SETTINGS } from '../src/editor/formats/raw-develop'

interface Sample {
  file: string
  make: string
  model: string
  compression: string
  sha256?: string
  expect: 'decode' | 'unsupported'
  minWidth?: number
  minHeight?: number
}
const manifestFile=resolve(process.argv[2] || 'fixtures/raw/corpus.json')
let samples:Sample[]
try{
  const parsed=JSON.parse(await readFile(manifestFile,'utf8')) as {samples:Sample[]}
  if(!Array.isArray(parsed.samples)||!parsed.samples.length)throw Error('Manifest must contain real camera samples')
  samples=parsed.samples
}catch(err){
  console.error('Camera RAW corpus unavailable. Supply a local manifest at '+manifestFile+
    '\\nSee docs/RAW_CODEC_CORPUS.md. This test never silently passes without real samples.')
  process.exit(2)
}
const root=dirname(manifestFile)
let failures=0,passed=0
const results:{camera:string;compression:string;outcome:string}[]=[]
for(const sample of samples){
  const file=resolve(root,sample.file)
  if(isAbsolute(sample.file)||relative(root,file).startsWith('..'+sep)||relative(root,file)==='..'){
    failures++;console.error('Unsafe corpus fixture path: '+sample.file);continue
  }
  const label=[sample.make,sample.model,sample.compression].join(' / ')
  try{
    const bytes=await readFile(file)
    if(bytes.length>256*1024*1024)throw Error('Fixture exceeds 256 MiB limit')
    if(sample.sha256 && createHash('sha256').update(bytes).digest('hex').toLowerCase()!==sample.sha256.toLowerCase())
      throw Error('SHA-256 mismatch')
    const data=await decodeCameraRaw(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,DEFAULT_RAW_SETTINGS)
    if(sample.expect==='unsupported')throw Error('This compression variant unexpectedly decoded; update the baseline after verifying pixels')
    if(data.width<(sample.minWidth??1)||data.height<(sample.minHeight??1))throw Error('Unexpected RAW geometry')
    if(data.rgba.length!==data.width*data.height*4)throw Error('Incomplete decoded pixels')
    // Sensor decoding is the only acceptable result: do not call the JPEG preview importer.
    const count=data.width*data.height
    let variation=false
    const first=data.rgba[0]
    for(let i=0;i<count;i+=Math.max(1,Math.floor(count/1024))){
      if(data.rgba[i*4]!==first){variation=true;break}
    }
    if(!variation)throw Error('Decoded image appears constant/blank')
    passed++;results.push({camera:label,compression:sample.compression,outcome:'sensor decoded'})
  }catch(err){
    const message=err instanceof Error?err.message:String(err)
    const expected=sample.expect==='unsupported' && !message.startsWith('This compression variant unexpectedly')
    if(expected)passed++
    else failures++
    results.push({camera:label,compression:sample.compression,outcome:expected?'unsupported (expected)':'FAILED: '+message})
  }
}
for(const result of results)console.log(result.camera+': '+result.outcome)
console.log('Real camera RAW fixtures: '+passed+' passed, '+failures+' unexpected results of '+samples.length)
if(failures)process.exit(1)
