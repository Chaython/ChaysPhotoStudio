import type { BlendMode } from '../types'
import { BLEND_GCO } from '../constants/tools'
import {
  canvasProfile, cloneCanvas, createCanvas, ctx2d,
  getProcessingPixelData, putProcessingPixelData,
} from '../utils/canvas'

export type ApplyImageChannel = 'rgb' | 'red' | 'green' | 'blue' | 'alpha'

export interface ApplyImageOptions {
  channel: ApplyImageChannel
  blendMode: BlendMode
  opacity: number
  invert?: boolean
  preserveTransparency?: boolean
  /** Registration of the target canvas in document coordinates. */
  targetOffsetX?: number
  targetOffsetY?: number
  /** Document-space selection mask. */
  selectionMask?: HTMLCanvasElement | null
}

/** Photoshop-style Apply Image core. The source is document-space; the target
 * may be a native-size offset raster layer. Returns a detached result canvas. */
export function applyImageToCanvas(
  target: HTMLCanvasElement,
  sourceDocSpace: HTMLCanvasElement,
  opts: ApplyImageOptions,
): HTMLCanvasElement {
  const out = cloneCanvas(target)
  const ox = Math.round(opts.targetOffsetX ?? 0)
  const oy = Math.round(opts.targetOffsetY ?? 0)

  // Re-register the source into target-layer coordinates without scaling.
  const source = createCanvas(target.width, target.height, canvasProfile(target))
  const sc = ctx2d(source)
  sc.drawImage(sourceDocSpace, -ox, -oy)

  if (opts.channel !== 'rgb' || opts.invert) {
    const img = getProcessingPixelData(source)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2]
      if (opts.channel === 'red') g = b = r
      else if (opts.channel === 'green') r = b = g
      else if (opts.channel === 'blue') r = g = b
      else if (opts.channel === 'alpha') {
        r = g = b = d[i + 3]
        d[i + 3] = 255
      }
      if (opts.invert) {
        r = 255 - r
        g = 255 - g
        b = 255 - b
      }
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
    }
    putProcessingPixelData(source, img)
  }

  // Apply the document selection to the incoming source only, matching normal
  // destructive edit semantics: pixels outside the selection remain unchanged.
  if (opts.selectionMask) {
    sc.save()
    sc.globalCompositeOperation = 'destination-in'
    sc.drawImage(opts.selectionMask, -ox, -oy)
    sc.restore()
  }

  const original = opts.preserveTransparency ? getProcessingPixelData(out) : null
  const oc = ctx2d(out)
  oc.save()
  oc.globalAlpha = Math.max(0, Math.min(1, Number(opts.opacity) / 100))
  try {
    oc.globalCompositeOperation = BLEND_GCO[opts.blendMode] || 'source-over'
  } catch {
    oc.globalCompositeOperation = 'source-over'
  }
  oc.drawImage(source, 0, 0)
  oc.restore()

  // "Preserve Transparency" means preserve the target alpha exactly rather
  // than merely clipping the source, which would increase semi-transparent
  // alpha under source-over style blends.
  if (original) {
    const result = getProcessingPixelData(out)
    for (let i = 3; i < result.data.length; i += 4) result.data[i] = original.data[i]
    putProcessingPixelData(out, result)
  }

  return out
}
