/** Minimal, generated ICC v2 display sRGB profile for the display-referred
 * LibRaw output. Matrix/TRC uses standard D50-adapted sRGB primaries and
 * sampled IEC 61966-2-1 transfer curves. No third-party profile bundled.
 * Embedding is metadata only: it must never re-encode or recolor the pixels.
 */
const ascii=(buffer:Uint8Array,offset:number,value:string)=>{
  for(let i=0;i<value.length;i++)buffer[offset+i]=value.charCodeAt(i)
}
const u32=(buffer:Uint8Array,offset:number,value:number)=>{
  new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength).setUint32(offset,value>>>0,false)
}
const fixed=(buffer:Uint8Array,offset:number,value:number)=>{
  new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength).setInt32(offset,Math.round(value*65536),false)
}
const aligned=(value:number)=>(value+3)&~3
const sig=(name:string)=>new Uint8Array([...name].map(char=>char.charCodeAt(0)))
const xyz=(x:number,y:number,z:number)=>{
  const data=new Uint8Array(20)
  ascii(data,0,'XYZ ')
  fixed(data,8,x);fixed(data,12,y);fixed(data,16,z)
  return data
}
const textType=(value:string)=>{
  const data=new Uint8Array(aligned(8+value.length+1))
  ascii(data,0,'text');ascii(data,8,value)
  return data
}
const description=(name:string)=>{
  // ICC v2 textDescriptionType includes ASCII, Unicode and Mac placeholders.
  const data=new Uint8Array(aligned(12+name.length+1+4+4+2+1+67))
  ascii(data,0,'desc')
  u32(data,8,name.length+1)
  ascii(data,12,name)
  return data
}
const srgbCurve=()=>{
  const count=1024, data=new Uint8Array(12+count*2),dv=new DataView(data.buffer)
  ascii(data,0,'curv');u32(data,8,count)
  for(let i=0;i<count;i++){
    const encoded=i/(count-1)
    const linear=encoded<=0.04045?encoded/12.92:Math.pow((encoded+0.055)/1.055,2.4)
    dv.setUint16(12+i*2,Math.round(linear*65535),false)
  }
  return data
}
/** Returns a fresh profile to prevent call sites from mutating cached data. */
export function generateSrgbIccV2():Uint8Array{
  const curve=srgbCurve()
  const tags=[
    {name:'desc',data:description("Chay's Photo Studio sRGB")},
    {name:'cprt',data:textType('Generated sRGB matrix/TRC profile for Chay\'s Photo Studio')},
    {name:'wtpt',data:xyz(0.9642,1,0.8249)},
    {name:'rXYZ',data:xyz(0.4360747,0.2225045,0.0139322)},
    {name:'gXYZ',data:xyz(0.3850649,0.7168786,0.0971045)},
    {name:'bXYZ',data:xyz(0.1430804,0.0606169,0.7141733)},
    {name:'rTRC',data:curve},
    {name:'gTRC',data:curve},
    {name:'bTRC',data:curve},
  ]
  let next=128+4+tags.length*12
  const offsets=tags.map(t=>{next=aligned(next);const start=next;next+=t.data.length;return start})
  const out=new Uint8Array(aligned(next)),dv=new DataView(out.buffer)
  dv.setUint32(0,out.length,false)
  dv.setUint32(8,0x02100000,false) // ICC 2.1: matrix + sampled curve
  ascii(out,12,'mntr');ascii(out,16,'RGB ');ascii(out,20,'XYZ ')
  for(const [i,v] of [2026,1,1,0,0,0].entries())dv.setUint16(24+i*2,v,false)
  ascii(out,36,'acsp')
  dv.setUint32(64,0,false)
  fixed(out,68,0.9642);fixed(out,72,1);fixed(out,76,0.8249)
  ascii(out,80,'ChPS')
  dv.setUint32(128,tags.length,false)
  for(let i=0;i<tags.length;i++){
    const offset=132+i*12,tag=tags[i]
    ascii(out,offset,tag.name)
    dv.setUint32(offset+4,offsets[i],false)
    dv.setUint32(offset+8,tag.data.length,false)
    out.set(tag.data,offsets[i])
  }
  return out
}
const id=sig('ICC_PROFILE\0')
/** APP2 ICC chunks inserted just after SOI. We reject existing ICC markers
 * rather than silently attaching two contradictory profiles to one JPEG.
 * Canvas export for RAW is a freshly generated JPEG and normally has none.
 */
export function embedSrgbIccJpeg(jpeg:Uint8Array,icc:Uint8Array=generateSrgbIccV2()):Uint8Array{
  if(jpeg.length<4||jpeg[0]!==0xff||jpeg[1]!==0xd8)throw Error('Invalid JPEG header')
  if(icc.length<128||icc.length>65519*255)throw Error('Invalid ICC profile size')
  let position=2
  // Check pre-scan application metadata to prevent duplicate/contradictory tags.
  while(position+4<=jpeg.length && jpeg[position]===0xff){
    const marker=jpeg[position+1]
    if(marker===0xda||marker===0xd9||marker===0xd8||marker===0x00)break
    if(marker===0xff){position++;continue}
    if(marker>=0xd0&&marker<=0xd7){position+=2;continue}
    const n=(jpeg[position+2]<<8)|jpeg[position+3]
    if(n<2||position+2+n>jpeg.length)throw Error('Malformed JPEG marker length')
    if(marker===0xe2&&n>=16&&id.every((value,i)=>jpeg[position+4+i]===value))
      throw Error('JPEG already has an ICC profile')
    position+=n+2
  }
  const chunkSize=65519,parts=Math.ceil(icc.length/chunkSize)
  if(parts<1||parts>255)throw Error('ICC exceeds JPEG APP2 chunk limit')
  const headers:Uint8Array[]=[]
  for(let p=0;p<parts;p++){
    const chunk=icc.subarray(p*chunkSize,Math.min(icc.length,(p+1)*chunkSize))
    const len=chunk.length+14+2
    const app=new Uint8Array(2+len)
    app[0]=0xff;app[1]=0xe2;app[2]=len>>8;app[3]=len&255
    app.set(id,4);app[16]=p+1;app[17]=parts;app.set(chunk,18)
    headers.push(app)
  }
  // Preserve original compressed scan and every existing JPEG marker byte.
  const total=jpeg.length+headers.reduce((n,part)=>n+part.length,0)
  const out=new Uint8Array(total)
  out.set(jpeg.subarray(0,2),0)
  let offset=2
  for(const header of headers){out.set(header,offset);offset+=header.length}
  out.set(jpeg.subarray(2),offset)
  return out
}
