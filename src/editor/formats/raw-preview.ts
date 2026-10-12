// Bounded display-only camera RAW preview and histogram helpers.
// These helpers are deliberately independent from DOM and never modify the
// decoded sensor buffer or the full-resolution development recipe.
import type { RawImage } from './decoders'

export function downsampleRawPreview(image: RawImage, maxEdge = 480): RawImage {
  const {width, height} = image
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
    image.rgba.length !== width * height * 4) throw Error('Invalid RAW preview source')
  const edge = Math.max(32, Math.min(1024, Math.floor(Number.isFinite(maxEdge) ? maxEdge : 480)))
  const factor = Math.min(1, edge / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * factor))
  const targetHeight = Math.max(1, Math.round(height * factor))
  if (targetWidth === width && targetHeight === height) return image
  const result8 = new Uint8ClampedArray(targetWidth * targetHeight * 4)
  const result16 = image.rgba16 ? new Uint16Array(result8.length) : undefined
  for (let y=0; y<targetHeight; y++) {
    const fromY = Math.min(height-1, Math.floor((y+0.5)*height/targetHeight))
    for(let x=0; x<targetWidth; x++) {
      const fromX = Math.min(width-1, Math.floor((x+0.5)*width/targetWidth))
      const src=(fromY*width+fromX)*4, dst=(y*targetWidth+x)*4
      for(let c=0;c<4;c++) {
        result8[dst+c]=image.rgba[src+c]
        if(result16)result16[dst+c]=image.rgba16![src+c]
      }
    }
  }
  return {...image,width:targetWidth,height:targetHeight,
    rgba:result8 as Uint8ClampedArray<ArrayBuffer>,rgba16:result16}
}

export interface RawHistogram {
  /** Interleaved 256-bin RGB/luma histogram, channels in [R, G, B, luminance] order. */
  bins: Uint32Array
  pixels: number
  clippedShadows: number
  clippedHighlights: number
}
export function rawPreviewHistogram(image: RawImage): RawHistogram {
  const src = image.rgba16 ?? image.rgba
  const max = image.rgba16 ? 65535 : 255
  if (!Number.isSafeInteger(image.width*image.height) || image.width < 1 || image.height < 1 ||
    src.length !== image.width*image.height*4) throw Error('Invalid RAW histogram source')
  const bins = new Uint32Array(256*4)
  let pixels=0,clippedShadows=0,clippedHighlights=0
  for (let i=0;i<src.length;i+=4) {
    if(src[i+3]===0)continue
    const r=Math.min(255,Math.floor(src[i]*256/(max+1)))
    const g=Math.min(255,Math.floor(src[i+1]*256/(max+1)))
    const b=Math.min(255,Math.floor(src[i+2]*256/(max+1)))
    const lum=Math.min(255,Math.floor((0.2126*src[i]+0.7152*src[i+1]+0.0722*src[i+2])*256/(max+1)))
    bins[r]++;bins[256+g]++;bins[512+b]++;bins[768+lum]++
    if(r===0&&g===0&&b===0)clippedShadows++
    if(r===255||g===255||b===255)clippedHighlights++
    pixels++
  }
  return {bins,pixels,clippedShadows,clippedHighlights}
}
