import type { RawImage } from './decoders'
import { bytesToCanvas } from './parser-utils'

function raw(width:number,height:number,rgba:Uint8ClampedArray):RawImage{
  return{width,height,rgba:rgba as Uint8ClampedArray<ArrayBuffer>,sourceBitDepth:8}
}
function four(bytes:Uint8Array,off:number):string{
  return String.fromCharCode(bytes[off]??0,bytes[off+1]??0,bytes[off+2]??0,bytes[off+3]??0)
}
function rgb565(v:number):[number,number,number]{
  return[
    Math.round(((v>>11)&31)*255/31),
    Math.round(((v>>5)&63)*255/63),
    Math.round((v&31)*255/31),
  ]
}
function putPixel(out:Uint8ClampedArray,w:number,h:number,x:number,y:number,c:[number,number,number,number]){
  if(x<0||y<0||x>=w||y>=h)return
  const o=(y*w+x)*4;out[o]=c[0];out[o+1]=c[1];out[o+2]=c[2];out[o+3]=c[3]
}
function alphaBlock(src:Uint8Array,off:number):number[]{
  const a0=src[off],a1=src[off+1]
  const table=[a0,a1]
  if(a0>a1){
    for(let i=1;i<=6;i++)table.push(Math.round(((7-i)*a0+i*a1)/7))
  }else{
    for(let i=1;i<=4;i++)table.push(Math.round(((5-i)*a0+i*a1)/5))
    table.push(0,255)
  }
  const out:number[]=[]
  for(let i=0;i<16;i++){
    const bit=i*3,bi=off+2+(bit>>3),shift=bit&7
    let code=(src[bi]>>shift)&7
    if(shift>5)code=((src[bi]>>shift)|(src[bi+1]<<(8-shift)))&7
    out.push(table[code]??255)
  }
  return out
}
function bc4Values(src:Uint8Array,off:number):number[]{return alphaBlock(src,off)}

function decodeBc(bytes:Uint8Array,off:number,w:number,h:number,kind:'bc1'|'bc2'|'bc3'|'bc4'|'bc5'):Uint8ClampedArray{
  const out=new Uint8ClampedArray(w*h*4)
  const blockBytes=kind==='bc1'||kind==='bc4'?8:16
  let p=off
  for(let by=0;by<Math.ceil(h/4);by++)for(let bx=0;bx<Math.ceil(w/4);bx++){
    if(p+blockBytes>bytes.length)throw new Error('Truncated DDS block data')
    let alpha:number[]|null=null,red:number[]|null=null,green:number[]|null=null
    let colorOff=p
    if(kind==='bc2'){
      alpha=[]
      for(let i=0;i<16;i++){
        const byte=bytes[p+(i>>1)]
        alpha.push(((i&1)?(byte>>4):(byte&15))*17)
      }
      colorOff=p+8
    }else if(kind==='bc3'){alpha=alphaBlock(bytes,p);colorOff=p+8}
    else if(kind==='bc4'){red=bc4Values(bytes,p)}
    else if(kind==='bc5'){red=bc4Values(bytes,p);green=bc4Values(bytes,p+8)}

    if(kind==='bc4'||kind==='bc5'){
      for(let i=0;i<16;i++){
        const x=bx*4+(i&3),y=by*4+(i>>2)
        const r=red?.[i]??0,g=green?.[i]??r
        putPixel(out,w,h,x,y,[r,g,kind==='bc5'?Math.max(0,Math.min(255,Math.round(255*Math.sqrt(Math.max(0,1-(r/127.5-1)**2-(g/127.5-1)**2))))):r,255])
      }
      p+=blockBytes;continue
    }

    const c0=bytes[colorOff]|(bytes[colorOff+1]<<8),c1=bytes[colorOff+2]|(bytes[colorOff+3]<<8)
    const a=rgb565(c0),b=rgb565(c1)
    const table:[number,number,number,number][]=[
      [a[0],a[1],a[2],255],[b[0],b[1],b[2],255],
      [0,0,0,255],[0,0,0,255],
    ]
    if(c0>c1||kind!=='bc1'){
      table[2]=[Math.round((2*a[0]+b[0])/3),Math.round((2*a[1]+b[1])/3),Math.round((2*a[2]+b[2])/3),255]
      table[3]=[Math.round((a[0]+2*b[0])/3),Math.round((a[1]+2*b[1])/3),Math.round((a[2]+2*b[2])/3),255]
    }else{
      table[2]=[Math.round((a[0]+b[0])/2),Math.round((a[1]+b[1])/2),Math.round((a[2]+b[2])/2),255]
      table[3]=[0,0,0,0]
    }
    const idx=(bytes[colorOff+4]|(bytes[colorOff+5]<<8)|(bytes[colorOff+6]<<16)|(bytes[colorOff+7]<<24))>>>0
    for(let i=0;i<16;i++){
      const c=[...table[(idx>>>(i*2))&3]] as [number,number,number,number]
      if(alpha)c[3]=alpha[i]
      putPixel(out,w,h,bx*4+(i&3),by*4+(i>>2),c)
    }
    p+=blockBytes
  }
  return out
}

function maskInfo(mask:number):{shift:number;bits:number}{
  if(!mask)return{shift:0,bits:0}
  let shift=0;while(shift<32&&((mask>>>shift)&1)===0)shift++
  let bits=0;while(shift+bits<32&&((mask>>>(shift+bits))&1)===1)bits++
  return{shift,bits}
}
function masked(v:number,mask:number):number{
  if(!mask)return 255
  const m=maskInfo(mask),raw=(v&mask)>>>m.shift,max=(1<<Math.min(30,m.bits))-1
  return max?Math.round(raw*255/max):0
}

export function decodeDds(bytes:Uint8Array):RawImage{
  if(bytes.length<128||four(bytes,0)!=='DDS ')throw new Error('Not a DDS file')
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  if(v.getUint32(4,true)!==124)throw new Error('Invalid DDS header')
  const h=v.getUint32(12,true),w=v.getUint32(16,true)
  if(!w||!h||w*h>268435456)throw new Error('Invalid DDS dimensions')
  const pfSize=v.getUint32(76,true),pfFlags=v.getUint32(80,true),fcc=four(bytes,84)
  if(pfSize!==32)throw new Error('Invalid DDS pixel format')
  let dataOff=128,kind:string=fcc
  if(fcc==='DX10'){
    if(bytes.length<148)throw new Error('Truncated DDS DX10 header')
    const dxgi=v.getUint32(128,true);dataOff=148
    kind=({28:'rgba8',87:'bgra8',71:'DXT1',74:'DXT3',77:'DXT5',80:'ATI1',83:'ATI2'} as Record<number,string>)[dxgi]??`DXGI:${dxgi}`
  }
  if(kind==='DXT1')return raw(w,h,decodeBc(bytes,dataOff,w,h,'bc1'))
  if(kind==='DXT3')return raw(w,h,decodeBc(bytes,dataOff,w,h,'bc2'))
  if(kind==='DXT5')return raw(w,h,decodeBc(bytes,dataOff,w,h,'bc3'))
  if(kind==='ATI1'||kind==='BC4U')return raw(w,h,decodeBc(bytes,dataOff,w,h,'bc4'))
  if(kind==='ATI2'||kind==='BC5U')return raw(w,h,decodeBc(bytes,dataOff,w,h,'bc5'))

  const bits=v.getUint32(88,true)
  const rMask=v.getUint32(92,true),gMask=v.getUint32(96,true),bMask=v.getUint32(100,true),aMask=v.getUint32(104,true)
  if(kind==='rgba8'||kind==='bgra8'||((pfFlags&0x40)!==0&&(bits===24||bits===32))){
    const bpp=bits===24?3:4
    const out=new Uint8ClampedArray(w*h*4)
    for(let i=0;i<w*h;i++){
      const p=dataOff+i*bpp
      if(p+bpp>bytes.length)break
      if(kind==='rgba8'){
        out[i*4]=bytes[p];out[i*4+1]=bytes[p+1];out[i*4+2]=bytes[p+2];out[i*4+3]=bytes[p+3]
      }else if(kind==='bgra8'){
        out[i*4]=bytes[p+2];out[i*4+1]=bytes[p+1];out[i*4+2]=bytes[p];out[i*4+3]=bytes[p+3]
      }else{
        let px=0;for(let j=0;j<bpp;j++)px|=bytes[p+j]<<(j*8)
        out[i*4]=masked(px>>>0,rMask);out[i*4+1]=masked(px>>>0,gMask);out[i*4+2]=masked(px>>>0,bMask);out[i*4+3]=aMask?masked(px>>>0,aMask):255
      }
    }
    return raw(w,h,out)
  }
  throw new Error(`Unsupported DDS format ${kind||fcc||'unknown'}`)
}

function be16(b:Uint8Array,o:number){return((b[o]<<8)|b[o+1])>>>0}
function be32(b:Uint8Array,o:number){return((b[o]*0x1000000)+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3])>>>0}
function byteRun1(src:Uint8Array,expected:number):Uint8Array{
  const out=new Uint8Array(expected);let ip=0,op=0
  while(ip<src.length&&op<expected){
    const n=src[ip++]
    if(n<=127){const count=n+1;if(ip+count>src.length)throw new Error('Truncated IFF ByteRun1 literal');out.set(src.subarray(ip,ip+count),op);ip+=count;op+=count}
    else if(n>=129){const count=257-n;if(ip>=src.length)throw new Error('Truncated IFF ByteRun1 repeat');const x=src[ip++];out.fill(x,op,Math.min(expected,op+count));op+=count}
  }
  if(op<expected)throw new Error('IFF BODY decompressed short')
  return out
}

export function decodeIff(bytes:Uint8Array):RawImage{
  if(bytes.length<12||four(bytes,0)!=='FORM')throw new Error('Not an IFF FORM')
  let form=four(bytes,8),start=12
  if(form==='ANIM'){
    // First complete FORM/ILBM inside an ANIM is the key frame.
    for(let i=12;i+12<=bytes.length;i++){
      if(four(bytes,i)==='FORM'&&four(bytes,i+8)==='ILBM'){
        const len=Math.min(bytes.length-i,8+be32(bytes,i+4))
        return decodeIff(bytes.subarray(i,i+len))
      }
    }
    throw new Error('IFF ANIM contains no ILBM key frame')
  }
  if(form!=='ILBM'&&form!=='PBM ')throw new Error(`Unsupported IFF FORM ${form}`)
  let bmhd:Uint8Array|null=null,cmap:Uint8Array|null=null,body:Uint8Array|null=null,camg=0
  let p=start
  while(p+8<=bytes.length){
    const id=four(bytes,p),len=be32(bytes,p+4),ds=p+8,de=Math.min(bytes.length,ds+len)
    if(id==='BMHD')bmhd=bytes.slice(ds,de)
    else if(id==='CMAP')cmap=bytes.slice(ds,de)
    else if(id==='BODY')body=bytes.slice(ds,de)
    else if(id==='CAMG'&&len>=4)camg=be32(bytes,ds)
    p=ds+len+(len&1)
  }
  if(!bmhd||bmhd.length<20||!body)throw new Error('IFF image is missing BMHD/BODY')
  const w=be16(bmhd,0),h=be16(bmhd,2),planes=bmhd[8],masking=bmhd[9],compression=bmhd[10],transparent=be16(bmhd,12)
  if(!w||!h||w*h>268435456||planes<1||planes>24)throw new Error('Invalid IFF dimensions/planes')
  if(camg&0x0800)throw new Error('HAM IFF images are not yet supported')
  const palette: [number,number,number][]=[]
  if(cmap)for(let i=0;i+2<cmap.length;i+=3)palette.push([cmap[i],cmap[i+1],cmap[i+2]])
  if(camg&0x0080&&palette.length){
    const base=palette.slice(0,32)
    for(const c of base)palette.push([Math.round(c[0]/2),Math.round(c[1]/2),Math.round(c[2]/2)])
  }
  const rowBytes=((w+15)>>4)<<1
  const rows= form==='ILBM' ? h*(planes+(masking===1?1:0))*rowBytes : h*((w+1)&~1)
  const data=compression===1?byteRun1(body,rows):body
  const out=new Uint8ClampedArray(w*h*4)
  if(form==='PBM '){
    const stride=(w+1)&~1
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const idx=data[y*stride+x],c=palette[idx]??[idx,idx,idx],o=(y*w+x)*4
      out[o]=c[0];out[o+1]=c[1];out[o+2]=c[2];out[o+3]=(masking===2&&idx===transparent)?0:255
    }
  }else{
    const planeStride=rowBytes,scanStride=rowBytes*(planes+(masking===1?1:0))
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let idx=0
      const bit=7-(x&7),bo=x>>3
      for(let pl=0;pl<planes;pl++)idx|=((data[y*scanStride+pl*planeStride+bo]>>bit)&1)<<pl
      let alpha=255
      if(masking===1)alpha=((data[y*scanStride+planes*planeStride+bo]>>bit)&1)?255:0
      else if(masking===2&&idx===transparent)alpha=0
      const c=palette[idx]??[idx&255,(idx>>8)&255,(idx>>16)&255],o=(y*w+x)*4
      out[o]=c[0];out[o+1]=c[1];out[o+2]=c[2];out[o+3]=alpha
    }
  }
  return raw(w,h,out)
}

export async function decodeIcns(bytes:Uint8Array):Promise<HTMLCanvasElement>{
  if(bytes.length<8||four(bytes,0)!=='icns')throw new Error('Not an ICNS file')
  const declared=be32(bytes,4),end=Math.min(bytes.length,declared)
  const candidates:{type:string;data:Uint8Array;score:number}[]=[]
  const score:Record<string,number>={ic10:1024,ic09:512,ic14:512,ic08:256,ic13:256,ic07:128,ic12:64,ic11:32}
  let p=8
  while(p+8<=end){
    const type=four(bytes,p),len=be32(bytes,p+4)
    if(len<8||p+len>end)break
    const data=bytes.slice(p+8,p+len)
    const isPng=data.length>=8&&data[0]===0x89&&four(data,1)==='PNG\r'
    const isJp2=data.length>=12&&data[4]===0x6a&&data[5]===0x50
    if(isPng||isJp2)candidates.push({type,data,score:score[type]??data.length})
    p+=len
  }
  candidates.sort((a,b)=>b.score-a.score)
  for(const c of candidates){
    try{return await bytesToCanvas(c.data,c.data[0]===0x89?'image/png':'image/jp2')}catch{/* next */}
  }
  throw new Error('ICNS contains no browser-decodable PNG/JP2 icon representation')
}
