import type { ProofSettings, PsDocument } from '../types'
import { createCanvas, ctx2d, getImageData } from '../utils/canvas'

type Mat3 = [number, number, number, number, number, number, number, number, number]

const SRGB_TO_XYZ: Mat3 = [
  0.4124564, 0.3575761, 0.1804375,
  0.2126729, 0.7151522, 0.0721750,
  0.0193339, 0.1191920, 0.9503041,
]
const P3_TO_XYZ: Mat3 = [
  0.48657095, 0.26566769, 0.19821729,
  0.22897456, 0.69173852, 0.07928691,
  0.00000000, 0.04511338, 1.04394437,
]
const ADOBE_RGB_TO_XYZ: Mat3 = [
  0.5767309, 0.1855540, 0.1881852,
  0.2973769, 0.6273491, 0.0752741,
  0.0270343, 0.0706872, 0.9911085,
]

// Bradford chromatic adaptation between browser RGB D65 and ICC PCS D50.
const D65_TO_D50: Mat3 = [
   1.0478112,  0.0228866, -0.0501270,
   0.0295424,  0.9904844, -0.0170491,
  -0.0092345,  0.0150436,  0.7521316,
]
const D50_TO_D65: Mat3 = [
   0.9555766, -0.0230393,  0.0631636,
  -0.0282895,  1.0099416,  0.0210077,
   0.0122982, -0.0204830,  1.3299098,
]

export const DEFAULT_PROOF_SETTINGS: ProofSettings = {
  enabled: false,
  gamutWarning: false,
  profile: 'cmyk-swop',
  intent: 'relative',
  blackPointCompensation: true,
  simulatePaperColor: false,
}

const proofCache = new WeakMap<PsDocument, {
  source: HTMLCanvasElement
  epoch: number
  key: string
  canvas: HTMLCanvasElement
}>()

function mul(m: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

function inv(m: Mat3): Mat3 | null {
  const a=m[0],b=m[1],c=m[2],d=m[3],e=m[4],f=m[5],g=m[6],h=m[7],i=m[8]
  const A=e*i-f*h, B=c*h-b*i, C=b*f-c*e
  const D=f*g-d*i, E=a*i-c*g, F=c*d-a*f
  const G=d*h-e*g, H=b*g-a*h, I=a*e-b*d
  const det=a*A+b*D+c*G
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  const k=1/det
  return [A*k,B*k,C*k,D*k,E*k,F*k,G*k,H*k,I*k]
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v }

function srgbDecode(v: number): number {
  v = clamp01(v)
  return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)
}
function srgbEncode(v: number): number {
  v = clamp01(v)
  return v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1/2.4) - .055
}
function adobeDecode(v: number): number { return Math.pow(clamp01(v), 2.19921875) }
function adobeEncode(v: number): number { return Math.pow(clamp01(v), 1/2.19921875) }

function profileMatrix(settings: ProofSettings): { matrix: Mat3; customPcs: boolean; adobeGamma: boolean } | null {
  if (settings.profile === 'srgb') return { matrix: SRGB_TO_XYZ, customPcs: false, adobeGamma: false }
  if (settings.profile === 'display-p3') return { matrix: P3_TO_XYZ, customPcs: false, adobeGamma: false }
  if (settings.profile === 'adobe-rgb') return { matrix: ADOBE_RGB_TO_XYZ, customPcs: false, adobeGamma: true }
  if (settings.profile === 'custom-rgb' && settings.customMatrix?.length === 9) {
    return { matrix: settings.customMatrix, customPcs: true, adobeGamma: false }
  }
  return null
}

function sourceMatrix(doc: PsDocument): Mat3 {
  return doc.workingColorSpace === 'display-p3' ? P3_TO_XYZ : SRGB_TO_XYZ
}

function compressToGamut(v: [number, number, number], intent: ProofSettings['intent']): [number, number, number] {
  if (intent === 'relative' || intent === 'absolute') return [clamp01(v[0]), clamp01(v[1]), clamp01(v[2])]
  let lo=Math.min(v[0],v[1],v[2]), hi=Math.max(v[0],v[1],v[2])
  if (lo >= 0 && hi <= 1) return v
  // Perceptual/saturation approximation: preserve hue relationships by fitting
  // the whole triplet into destination range rather than clipping channels.
  const span=Math.max(1e-9,hi-lo)
  let out: [number,number,number]=[(v[0]-lo)/span,(v[1]-lo)/span,(v[2]-lo)/span]
  if (intent === 'perceptual') {
    out=[.04+.92*out[0],.04+.92*out[1],.04+.92*out[2]]
  }
  return out
}

function proofRgb(
  rgb: [number,number,number],
  srcMatrix: Mat3,
  settings: ProofSettings,
): { rgb: [number,number,number]; out: boolean } {
  const target=profileMatrix(settings)
  if (!target) return { rgb, out:false }
  let xyz=mul(srcMatrix,[srgbDecode(rgb[0]),srgbDecode(rgb[1]),srgbDecode(rgb[2])])
  if (target.customPcs) xyz=mul(D65_TO_D50,xyz)
  const inverse=inv(target.matrix)
  if (!inverse) return { rgb, out:false }
  let dev=mul(inverse,xyz)
  if (target.adobeGamma) {
    // matrix operates on linear values; gamma is applied only when representing
    // target device values before the round trip.
    dev=[adobeDecode(adobeEncode(dev[0])),adobeDecode(adobeEncode(dev[1])),adobeDecode(adobeEncode(dev[2]))]
  }
  const out=dev.some(v=>v < -1e-5 || v > 1.00001)
  dev=compressToGamut(dev,settings.intent)
  let proofXyz=mul(target.matrix,dev)
  if (target.customPcs) proofXyz=mul(D50_TO_D65,proofXyz)
  const srcInv=inv(srcMatrix) ?? inv(SRGB_TO_XYZ)!
  let back=mul(srcInv,proofXyz)
  if (settings.blackPointCompensation) {
    back=[Math.max(0,back[0]),Math.max(0,back[1]),Math.max(0,back[2])]
  }
  return { rgb:[srgbEncode(back[0]),srgbEncode(back[1]),srgbEncode(back[2])], out }
}

function proofCmyk(rgb: [number,number,number], settings: ProofSettings): { rgb:[number,number,number]; out:boolean } {
  const r=srgbDecode(rgb[0]), g=srgbDecode(rgb[1]), b=srgbDecode(rgb[2])
  let c=1-r, m=1-g, y=1-b
  let k=Math.min(c,m,y)*.88
  c=Math.max(0,c-k); m=Math.max(0,m-k); y=Math.max(0,y-k)
  let total=c+m+y+k
  const out=total > 3.0 || Math.max(c,m,y,k) > 1
  if (total > 3.0) {
    const scale=(3.0-k)/Math.max(1e-9,c+m+y)
    c*=scale; m*=scale; y*=scale
    total=c+m+y+k
  }
  // Approximate coated SWOP ink/paper response and dot gain.
  const dot=(v:number)=>Math.pow(clamp01(v),.88)
  c=dot(c);m=dot(m);y=dot(y);k=dot(k)
  let rr=(1-c)*(1-k), gg=(1-m)*(1-k), bb=(1-y)*(1-k)
  if (settings.blackPointCompensation) {
    rr=.012+.988*rr; gg=.012+.988*gg; bb=.012+.988*bb
  }
  return { rgb:[srgbEncode(rr),srgbEncode(gg),srgbEncode(bb)],out }
}

function proofGray(rgb:[number,number,number]): { rgb:[number,number,number];out:boolean } {
  const r=srgbDecode(rgb[0]),g=srgbDecode(rgb[1]),b=srgbDecode(rgb[2])
  const y=.2126*r+.7152*g+.0722*b
  // Approximate Gray Gamma 2.2 with 20% dot gain.
  const ink=1-y
  const dot=Math.min(1,ink + .2*ink*(1-ink))
  const gray=srgbEncode(1-dot)
  const chroma=Math.max(r,g,b)-Math.min(r,g,b)
  return {rgb:[gray,gray,gray],out:chroma>.08}
}

function applyPaper(rgb:[number,number,number]): [number,number,number] {
  const paper:[number,number,number]=[.965,.952,.91]
  return [
    .035*paper[0]+.965*rgb[0],
    .035*paper[1]+.965*rgb[1],
    .035*paper[2]+.965*rgb[2],
  ]
}

function settingsKey(s: ProofSettings): string {
  return JSON.stringify(s)
}

export function proofDisplayCanvas(doc: PsDocument, source: HTMLCanvasElement): HTMLCanvasElement {
  const settings={...DEFAULT_PROOF_SETTINGS,...doc.proof}
  if (!settings.enabled && !settings.gamutWarning) return source
  const key=settingsKey(settings)
  const cached=proofCache.get(doc)
  if (cached && cached.source===source && cached.epoch===doc._epoch && cached.key===key) return cached.canvas

  const out=createCanvas(source.width,source.height)
  const src=getImageData(source)
  const image=new ImageData(new Uint8ClampedArray(src.data),src.width,src.height)
  const d=image.data
  const srcMatrix=sourceMatrix(doc)
  const warning:[number,number,number]=[128/255,128/255,128/255]

  for(let i=0;i<d.length;i+=4){
    if(d[i+3]===0) continue
    const input:[number,number,number]=[d[i]/255,d[i+1]/255,d[i+2]/255]
    let result:{rgb:[number,number,number];out:boolean}
    if(settings.profile==='cmyk-swop') result=proofCmyk(input,settings)
    else if(settings.profile==='gray-20') result=proofGray(input)
    else result=proofRgb(input,srcMatrix,settings)

    let rgb=settings.enabled ? result.rgb : input
    if(settings.enabled && settings.simulatePaperColor) rgb=applyPaper(rgb)
    if(settings.gamutWarning && result.out) rgb=warning
    d[i]=Math.round(clamp01(rgb[0])*255)
    d[i+1]=Math.round(clamp01(rgb[1])*255)
    d[i+2]=Math.round(clamp01(rgb[2])*255)
  }
  ctx2d(out).putImageData(image,0,0)
  proofCache.set(doc,{source,epoch:doc._epoch,key,canvas:out})
  return out
}

function sig(bytes:Uint8Array,offset:number):string{
  if(offset<0||offset+4>bytes.length)return ''
  return String.fromCharCode(bytes[offset],bytes[offset+1],bytes[offset+2],bytes[offset+3])
}
function s15Fixed16(view:DataView,offset:number):number{return view.getInt32(offset,false)/65536}

export function parseMatrixRgbIcc(bytes:Uint8Array,fileName='Custom RGB ICC'): {
  name:string
  matrix:[number,number,number,number,number,number,number,number,number]
}|null {
  if(bytes.length<132||sig(bytes,36)!=='acsp'||sig(bytes,16)!=='RGB ')return null
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  const count=Math.min(2048,view.getUint32(128,false))
  const xyz:Record<string,[number,number,number]>={}
  let profileName=fileName.replace(/\.(icc|icm)$/i,'')||'Custom RGB ICC'
  for(let i=0;i<count;i++){
    const p=132+i*12
    if(p+12>bytes.length)break
    const tag=sig(bytes,p), off=view.getUint32(p+4,false), size=view.getUint32(p+8,false)
    if(off<0||size<0||off+size>bytes.length)continue
    if((tag==='rXYZ'||tag==='gXYZ'||tag==='bXYZ')&&size>=20&&sig(bytes,off)==='XYZ '){
      xyz[tag]=[s15Fixed16(view,off+8),s15Fixed16(view,off+12),s15Fixed16(view,off+16)]
    } else if(tag==='desc'&&size>=13&&sig(bytes,off)==='desc'){
      const n=Math.min(view.getUint32(off+8,false),size-12)
      if(n>1){
        let text=''
        for(let q=0;q<n-1&&off+12+q<bytes.length;q++)text+=String.fromCharCode(bytes[off+12+q])
        if(text.trim())profileName=text.trim()
      }
    }
  }
  if(!xyz.rXYZ||!xyz.gXYZ||!xyz.bXYZ)return null
  return {
    name:profileName,
    matrix:[
      xyz.rXYZ[0],xyz.gXYZ[0],xyz.bXYZ[0],
      xyz.rXYZ[1],xyz.gXYZ[1],xyz.bXYZ[1],
      xyz.rXYZ[2],xyz.gXYZ[2],xyz.bXYZ[2],
    ],
  }
}
