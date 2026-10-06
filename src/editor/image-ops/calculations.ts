import type { BlendMode } from '../types'
import { BLEND_GCO } from '../constants/tools'
import {
  canvasProfile, createCanvas, ctx2d, getImageData, getProcessingPixelData,
  putProcessingPixelData,
} from '../utils/canvas'
import { extractSourceChannel } from './apply-image'

export type CalculationChannel = 'gray' | 'red' | 'green' | 'blue' | 'alpha'
export type CalculationBlendMode = BlendMode | 'subtract'

export interface CalculationSource {
  canvas: HTMLCanvasElement
  channel: CalculationChannel
  invert?: boolean
}

export interface CalculationOptions {
  width: number
  height: number
  blendMode: CalculationBlendMode
  opacity: number
  selectionMask?: HTMLCanvasElement | null
}

/** Register a source at document origin and turn it into an opaque grayscale
 * channel so Canvas blending performs channel math instead of alpha compositing. */
function calculationChannel(
  source: CalculationSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const registered = createCanvas(width, height, canvasProfile(source.canvas))
  // Keep transparent areas transparent until after channel extraction so the
  // Alpha source reads the real source alpha instead of an opaque matte.
  ctx2d(registered).drawImage(source.canvas, 0, 0)

  const out = extractSourceChannel(registered, source.channel, !!source.invert)
  const img = getProcessingPixelData(out)
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255
  putProcessingPixelData(out, img)
  return out
}

/** Photoshop-style Calculations core: combine two source channels into an
 * 8-bit alpha mask. Inputs can be 8/16-bit canvases; output is intentionally
 * a mask because selections/saved alpha channels are 0..255 in the editor. */
export function calculateChannelMask(
  source1: CalculationSource,
  source2: CalculationSource,
  opts: CalculationOptions,
): Uint8ClampedArray {
  const width = Math.max(1, Math.round(opts.width))
  const height = Math.max(1, Math.round(opts.height))
  const a = calculationChannel(source1, width, height)
  const b = calculationChannel(source2, width, height)
  const opacity = Math.max(0, Math.min(1, Number(opts.opacity) / 100))

  if (opts.blendMode === 'subtract') {
    const ai = getProcessingPixelData(a)
    const bi = getProcessingPixelData(b)
    for (let i = 0; i < ai.data.length; i += 4) {
      const base = ai.data[i]
      const subtracted = Math.max(0, base - bi.data[i])
      const value = base + (subtracted - base) * opacity
      ai.data[i] = ai.data[i + 1] = ai.data[i + 2] = value
      ai.data[i + 3] = 255
    }
    putProcessingPixelData(a, ai)
  } else {
    const ac = ctx2d(a)
    ac.save()
    ac.globalAlpha = opacity
    try {
      ac.globalCompositeOperation = BLEND_GCO[opts.blendMode] || 'source-over'
    } catch {
      ac.globalCompositeOperation = 'source-over'
    }
    ac.drawImage(b, 0, 0)
    ac.restore()
  }

  const result = getImageData(a)
  const mask = new Uint8ClampedArray(width * height)
  let selection: Uint8ClampedArray | null = null
  if (opts.selectionMask) {
    const sm = createCanvas(width, height)
    ctx2d(sm).drawImage(opts.selectionMask, 0, 0)
    selection = getImageData(sm).data
  }

  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    let value = result.data[i]
    if (selection) value = value * (selection[i + 3] / 255)
    mask[p] = Math.max(0, Math.min(255, Math.round(value)))
  }
  return mask
}
