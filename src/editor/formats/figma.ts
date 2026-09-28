import { findEntry, jsonEntry, readZipEntries } from './archive'
import { decodeKiwiBinarySchema, decodeKiwiMessage } from './kiwi-runtime'
import type { ParsedDocument, ParsedDocumentLayer } from './document-parser-types'
import { bytesToCanvas, finite, percentOpacity, rgbaCss, safeName } from './parser-utils'
import { createCanvas, ctx2d } from '../utils/canvas'
import type { PathAnchor } from '../types'

type J = Record<string, any>
interface M { a:number;b:number;c:number;d:number;e:number;f:number }
const ID:M={a:1,b:0,c:0,d:1,e:0,f:0}

function mul(p:M,q:M):M{return{
  a:p.a*q.a+p.c*q.b,b:p.b*q.a+p.d*q.b,
  c:p.a*q.c+p.c*q.d,d:p.b*q.c+p.d*q.d,
  e:p.a*q.e+p.c*q.f+p.e,f:p.b*q.e+p.d*q.f+p.f,
}}
function nodeMatrix(n:J):M{
  const t=n?.transform
  return t?{a:finite(t.m00,1),b:finite(t.m10),c:finite(t.m01),d:finite(t.m11,1),e:finite(t.m02),f:finite(t.m12)}:ID
}
function pt(m:M,x:number,y:number){return{x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f}}
function guid(g:any):string|null{
  if(!g)return null
  const a=g.sessionID,b=g.localID
  return a==null||b==null?null:`${String(a)}:${String(b)}`
}
function imageHash(value:any):string|null{
  if(!value)return null
  if(typeof value.name==='string'&&/^[0-9a-f]{40}$/i.test(value.name))return value.name.toLowerCase()
  const h=value.hash
  if(typeof h==='string'&&/^[0-9a-f]{40}$/i.test(h))return h.toLowerCase()
  if(h instanceof Uint8Array&&h.length){
    return Array.from(h).map(v=>v.toString(16).padStart(2,'0')).join('')
  }
  return null
}
function mime(bytes:Uint8Array):string{
  if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)return'image/png'
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return'image/jpeg'
  if(bytes.length>=12&&String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP')return'image/webp'
  return'application/octet-stream'
}
async function decompress(data:Uint8Array,format:'deflate-raw'|'zstd'):Promise<Uint8Array>{
  const DS=(globalThis as any).DecompressionStream
  if(typeof DS!=='function')throw new Error(`${format} decompression is unavailable in this runtime`)
  let ds:any
  try{ds=new DS(format)}catch{throw new Error(`${format} decompression is unavailable in this runtime`)}
  const stream=new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
async function parseCanvasFig(data:Uint8Array):Promise<J>{
  if(data.length<20)throw new Error('Truncated Figma canvas.fig')
  const prelude=new TextDecoder('ascii').decode(data.subarray(0,8))
  if(!prelude.startsWith('fig-'))throw new Error(`Unknown Figma binary prelude ${prelude}`)
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength)
  let p=12
  const chunks:Uint8Array[]=[]
  while(p<data.length){
    if(p+4>data.length)throw new Error('Truncated Figma chunk length')
    const n=view.getUint32(p,true);p+=4
    if(n<0||p+n>data.length)throw new Error('Truncated Figma chunk')
    chunks.push(data.subarray(p,p+n));p+=n
  }
  if(chunks.length<2)throw new Error('Figma binary contains fewer than two chunks')
  const schema=decodeKiwiBinarySchema(await decompress(chunks[0],'deflate-raw'))
  const packed=chunks[1]
  const zstd=packed.length>=4&&packed[0]===0x28&&packed[1]===0xb5&&packed[2]===0x2f&&packed[3]===0xfd
  const message=await decompress(packed,zstd?'zstd':'deflate-raw')
  return decodeKiwiMessage(schema,message,'Message')
}

function firstPaint(paints:any[],type='SOLID'):any|null{
  return Array.isArray(paints)?paints.find(p=>p&&p.visible!==false&&p.type===type)??null:null
}
function fillColor(node:J,override?:J):string|null{
  const p=firstPaint(override?.fillPaints??node.fillPaints)
  if(!p?.color)return null
  return rgbaCss({...p.color,alpha:(p.color.a??1)*(p.opacity??1)},'#000000')
}
function stroke(node:J):{color:string|null;width:number}{
  const p=firstPaint(node.strokePaints)
  return{color:p?.color?rgbaCss({...p.color,alpha:(p.color.a??1)*(p.opacity??1)},'#000000'):null,width:Math.max(0,finite(node.strokeWeight))}
}
function blend(value:any):string{
  const v=String(value??'NORMAL').toUpperCase()
  const m:Record<string,string>={
    NORMAL:'normal',MULTIPLY:'multiply',SCREEN:'screen',OVERLAY:'overlay',DARKEN:'darken',LIGHTEN:'lighten',
    COLOR_DODGE:'color-dodge',COLOR_BURN:'color-burn',LINEAR_DODGE:'linear-dodge',HARD_LIGHT:'hard-light',
    SOFT_LIGHT:'soft-light',DIFFERENCE:'difference',EXCLUSION:'exclusion',HUE:'hue',SATURATION:'saturation',
    COLOR:'color',LUMINOSITY:'luminosity',
  }
  return m[v]??'normal'
}

function geometryPath(blob:Uint8Array,m:M):{anchors:PathAnchor[];closed:boolean}|null{
  const v=new DataView(blob.buffer,blob.byteOffset,blob.byteLength)
  let p=0,closed=false
  const anchors:PathAnchor[]=[]
  const f=()=>{if(p+4>blob.length)throw new Error('Truncated Figma vector blob');const n=v.getFloat32(p,true);p+=4;return n}
  const add=(x:number,y:number,inPt?:{x:number;y:number})=>{
    const q=pt(m,x,y),i=inPt?pt(m,inPt.x,inPt.y):q
    anchors.push({x:q.x,y:q.y,inX:i.x-q.x,inY:i.y-q.y,outX:0,outY:0,pair:false})
  }
  const prevOut=(x:number,y:number)=>{
    const a=anchors[anchors.length-1];if(!a)return
    const q=pt(m,x,y);a.outX=q.x-a.x;a.outY=q.y-a.y
  }
  try{
    while(p<blob.length){
      const op=blob[p++]
      if(op===0){closed=true;continue}
      if(op===1||op===2){add(f(),f());continue}
      if(op===4){
        const c1={x:f(),y:f()},c2={x:f(),y:f()},q={x:f(),y:f()}
        prevOut(c1.x,c1.y);add(q.x,q.y,c2);continue
      }
      return null
    }
  }catch{return null}
  return anchors.length>=2?{anchors,closed}:null
}
function vectorOverride(node:J,styleId:number):J|undefined{
  if(!styleId)return undefined
  return node?.vectorData?.styleOverrideTable?.find?.((x:any)=>finite(x?.styleID)===styleId)
}
function vectorLayers(node:J,m:M,blobs:any[],warnings:string[]):ParsedDocumentLayer[]{
  const out:ParsedDocumentLayer[]=[]
  const geos=Array.isArray(node.fillGeometry)?node.fillGeometry:[]
  for(let i=0;i<geos.length;i++){
    const g=geos[i],index=finite(g?.commandsBlob,-1)
    const blob=index>=0&&blobs[index] instanceof Uint8Array?blobs[index] as Uint8Array:null
    if(!blob)continue
    const path=geometryPath(blob,m)
    if(!path){warnings.push(`Figma vector “${safeName(node.name,'Vector')}” contains unsupported path commands`);continue}
    const ov=vectorOverride(node,finite(g?.styleID))
    out.push({
      kind:'shape',name:geos.length>1?`${safeName(node.name,'Vector')} ${i+1}`:safeName(node.name,'Vector'),
      visible:node.visible!==false,opacity:percentOpacity(node.opacity,100),blendMode:blend(node.blendMode),
      shape:{
        shape:'path',x:0,y:0,w:1,h:1,radius:0,
        fill:fillColor(node,ov),fillOpacity:100,stroke:null,strokeWidth:0,strokeOpacity:100,
        sides:5,starInset:50,pathAnchors:path.anchors,pathClosed:path.closed,
      },
      metadata:{sourceFormat:'fig',sourceType:'VECTOR',sourceGuid:guid(node.guid)},
    })
  }
  return out
}

async function bitmapLayer(node:J,m:M,images:Map<string,Uint8Array>,warnings:string[]):Promise<ParsedDocumentLayer|null>{
  const p=firstPaint(node.fillPaints,'IMAGE')
  if(!p)return null
  const hash=imageHash(p.image)??imageHash(p.imageThumbnail)
  if(!hash){warnings.push(`Figma image “${safeName(node.name,'Image')}” has no resolvable image hash`);return null}
  const bytes=images.get(hash)
  if(!bytes){warnings.push(`Figma image asset ${hash} is missing from the archive`);return null}
  let source:HTMLCanvasElement
  try{source=await bytesToCanvas(bytes,mime(bytes))}catch{warnings.push(`Figma image asset ${hash} could not be decoded`);return null}
  const w=Math.max(1,Math.round(Math.abs(finite(node?.size?.x,source.width)*m.a)))
  const h=Math.max(1,Math.round(Math.abs(finite(node?.size?.y,source.height)*m.d)))
  let canvas=source
  if(source.width!==w||source.height!==h){
    canvas=createCanvas(w,h);const c=ctx2d(canvas);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(source,0,0,w,h)
  }
  if(Math.abs(m.b)>1e-5||Math.abs(m.c)>1e-5)warnings.push(`Figma image “${safeName(node.name,'Image')}” rotation/skew is approximated`)
  return{
    kind:'raster',name:safeName(node.name,'Image'),canvas,left:m.e,top:m.f,
    visible:node.visible!==false,opacity:percentOpacity(node.opacity,100),blendMode:blend(node.blendMode),
    metadata:{sourceFormat:'fig',sourceType:'IMAGE',sourceGuid:guid(node.guid),imageHash:hash,imageScaleMode:p.imageScaleMode},
  }
}

function semanticLayer(node:J,m:M,warnings:string[]):ParsedDocumentLayer|null{
  const type=String(node.type??'')
  const size=node.size??{}
  const w=Math.max(1,Math.abs(finite(size.x,1)*m.a)),h=Math.max(1,Math.abs(finite(size.y,1)*m.d))
  const rotated=Math.abs(m.b)>1e-5||Math.abs(m.c)>1e-5
  if(type==='TEXT'){
    if(rotated)warnings.push(`Figma text “${safeName(node.name,'Text')}” rotation/skew is approximated`)
    const font=String(node?.fontName?.style??'')
    const lineRaw=finite(node?.lineHeight?.value,1.2)
    const trackingRaw=finite(node?.letterSpacing?.value,finite(node.textTracking,0))
    return{
      kind:'text',name:safeName(node.name,'Text'),visible:node.visible!==false,
      opacity:percentOpacity(node.opacity,100),blendMode:blend(node.blendMode),
      text:{
        content:String(node?.textData?.characters??''),
        fontFamily:String(node?.fontName?.family??'Arial'),
        fontSize:Math.max(1,finite(node.fontSize,16)*Math.abs(m.d)),
        color:fillColor(node)??'#000000',bold:/bold|semibold|demi|[6-9]00/i.test(font),
        italic:/italic|oblique/i.test(font),
        align:String(node.textAlignHorizontal??'LEFT')==='CENTER'?'center':String(node.textAlignHorizontal??'LEFT')==='RIGHT'?'right':'left',
        lineHeight:lineRaw>10?lineRaw/100:Math.max(.5,lineRaw),
        tracking:String(node?.letterSpacing?.units??'').toUpperCase()==='PERCENT'?trackingRaw*finite(node.fontSize,16)/100:trackingRaw,
        boxWidth:w,boxHeight:h,x:m.e,y:m.f+Math.max(1,finite(node.fontSize,16)*Math.abs(m.d)),
      },
      metadata:{sourceFormat:'fig',sourceType:type,sourceGuid:guid(node.guid)},
    }
  }

  let shape:'rect'|'rounded-rect'|'ellipse'|'star'|'polygon'|'line'|null=null
  if(type==='ROUNDED_RECTANGLE'||type==='RECTANGLE'||type==='FRAME')shape=finite(node.cornerRadius)>0?'rounded-rect':'rect'
  else if(type==='ELLIPSE')shape='ellipse'
  else if(type==='STAR')shape='star'
  else if(type==='POLYGON')shape='polygon'
  else if(type==='LINE')shape='line'
  if(!shape)return null
  if(rotated)warnings.push(`Figma ${type} “${safeName(node.name,type)}” rotation/skew is approximated`)
  const st=stroke(node)
  return{
    kind:'shape',name:safeName(node.name,type),visible:node.visible!==false,
    opacity:percentOpacity(node.opacity,100),blendMode:blend(node.blendMode),
    shape:{
      shape,x:m.e,y:m.f,w,h,radius:Math.max(0,finite(node.cornerRadius)),
      fill:fillColor(node),fillOpacity:100,stroke:st.color,strokeWidth:st.width,strokeOpacity:100,
      sides:Math.max(3,Math.round(finite(node.pointCount,5))),starInset:Math.max(1,Math.min(99,finite(node.innerRadius,0.5)*100)),
    },
    metadata:{sourceFormat:'fig',sourceType:type,sourceGuid:guid(node.guid)},
  }
}

function bounds(nodes:J[],matrixFor:(n:J)=>M){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity
  for(const n of nodes){
    if(!n?.size)continue
    const m=matrixFor(n),w=finite(n.size.x),h=finite(n.size.y)
    const pts=[pt(m,0,0),pt(m,w,0),pt(m,0,h),pt(m,w,h)]
    for(const p of pts){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y)}
  }
  return Number.isFinite(minX)?{x:minX,y:minY,w:Math.max(1,maxX-minX),h:Math.max(1,maxY-minY)}:{x:0,y:0,w:1024,h:768}
}

export async function parseFigma(bytes:Uint8Array,fileName='Figma document'):Promise<ParsedDocument>{
  let canvasFig=bytes,thumbnail:Uint8Array|null=null,meta:J|null=null
  const images=new Map<string,Uint8Array>()
  if(bytes[0]===0x50&&bytes[1]===0x4b){
    const entries=await readZipEntries(bytes)
    const canvas=findEntry(entries,n=>/(^|\/)canvas\.fig$/i.test(n))
    if(!canvas)throw new Error('Figma archive contains no canvas.fig')
    canvasFig=canvas.data
    const thumb=findEntry(entries,n=>/(^|\/)thumbnail\.png$/i.test(n));if(thumb)thumbnail=thumb.data
    const metaEntry=[...entries.keys()].find(n=>/(^|\/)meta\.json$/i.test(n));if(metaEntry)meta=jsonEntry<J>(entries,metaEntry)
    for(const [name,entry] of entries){
      const m=/(?:^|\/)images\/([0-9a-f]{40})$/i.exec(name)
      if(m)images.set(m[1].toLowerCase(),entry.data)
    }
  }

  let message:J
  try{message=await parseCanvasFig(canvasFig)}
  catch(error){
    if(thumbnail){
      const c=await bytesToCanvas(thumbnail,'image/png')
      return{width:c.width,height:c.height,name:String(meta?.name??fileName),sourceBitDepth:8,layers:[
        {kind:'raster',name:'Figma Thumbnail',canvas:c,left:0,top:0,metadata:{sourceFormat:'fig',semanticDecode:false}},
      ],composite:c,warnings:[`Figma semantic decode unavailable: ${error instanceof Error?error.message:String(error)}`]}
    }
    throw error
  }

  const nodes=(Array.isArray(message.nodeChanges)?message.nodeChanges:[]) as J[]
  if(!nodes.length)throw new Error('Figma message contains no nodeChanges')
  const byId=new Map<string,J>()
  for(const n of nodes){const id=guid(n.guid);if(id)byId.set(id,n)}
  const matrixCache=new Map<J,M>()
  const stack=new Set<J>()
  const matrixFor=(n:J):M=>{
    const cached=matrixCache.get(n);if(cached)return cached
    if(stack.has(n))return nodeMatrix(n)
    stack.add(n)
    const pid=guid(n?.parentIndex?.guid),parent=pid?byId.get(pid):undefined
    const m=parent?mul(matrixFor(parent),nodeMatrix(n)):nodeMatrix(n)
    stack.delete(n);matrixCache.set(n,m);return m
  }
  const visual=nodes.filter(n=>n&&n.visible!==false&&!['DOCUMENT','CANVAS','PAGE','SLIDE_GRID'].includes(String(n.type??'')))
  const b=bounds(visual,matrixFor)
  const shift:M={...ID,e:-b.x,f:-b.y}
  const blobs=Array.isArray(message.blobs)?message.blobs:[]
  const layers:ParsedDocumentLayer[]=[]
  const warnings:string[]=[]

  // nodeChanges is in document/render order; later nodes render on top.
  for(const node of visual){
    const m=mul(shift,matrixFor(node))
    if(String(node.type)==='VECTOR'){
      layers.push(...vectorLayers(node,m,blobs,warnings));continue
    }
    const bitmap=await bitmapLayer(node,m,images,warnings)
    if(bitmap){layers.push(bitmap);continue}
    const semantic=semanticLayer(node,m,warnings)
    if(semantic)layers.push(semantic)
  }

  let composite:HTMLCanvasElement|null=null
  if(thumbnail){try{composite=await bytesToCanvas(thumbnail,'image/png')}catch{/* optional */}}
  if(!layers.length&&composite)layers.push({kind:'raster',name:'Figma Thumbnail',canvas:composite,left:0,top:0})
  if(!layers.length)throw new Error('Figma parser found no editable visual nodes')
  return{
    width:Math.max(1,Math.ceil(b.w)),height:Math.max(1,Math.ceil(b.h)),
    name:String(meta?.name??fileName),sourceBitDepth:8,layers,composite,warnings,
  }
}
