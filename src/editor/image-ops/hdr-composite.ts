/** Composites simple RGBA Float32 raster layers in document space.
 * All RGB channels remain scene-linear and can be larger than SDR white.
 * Back-to-front source-over uses straight-alpha storage with premultiplied
 * intermediate arithmetic. The input arrays are never modified. */
export interface HdrCompositeLayer {
  pixels: Float32Array
  width: number
  height: number
  offsetX: number
  offsetY: number
  opacity: number // [0, 1]
  mask?: Uint8Array | Uint8ClampedArray // document-space alpha
}

export function compositeHdrRasters(
  width: number, height: number, layers: readonly HdrCompositeLayer[],
): Float32Array {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) ||
      !Number.isSafeInteger(width * height * 4)) throw new Error('Invalid HDR composite size')
  const output = new Float32Array(width * height * 4)
  for (const layer of layers) {
    if (![layer.width, layer.height].every(n => Number.isSafeInteger(n) && n > 0) ||
        !Number.isSafeInteger(layer.width * layer.height * 4) ||
        layer.pixels.length !== layer.width * layer.height * 4 ||
        !Number.isSafeInteger(layer.offsetX) || !Number.isSafeInteger(layer.offsetY) ||
        !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 ||
        (layer.mask && layer.mask.length !== width * height)) {
      throw new Error('Invalid HDR composite layer')
    }
    if (layer.opacity === 0) continue
    const x0 = Math.max(0, layer.offsetX), x1 = Math.min(width, layer.offsetX + layer.width)
    const y0 = Math.max(0, layer.offsetY), y1 = Math.min(height, layer.offsetY + layer.height)
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const docIndex = y * width + x
      const si = ((y - layer.offsetY) * layer.width + (x - layer.offsetX)) * 4
      const di = docIndex * 4
      const rawAlpha = layer.pixels[si + 3]
      if (!Number.isFinite(rawAlpha) || rawAlpha <= 0) continue
      const sourceAlpha = Math.min(1, rawAlpha) * layer.opacity *
        (layer.mask ? layer.mask[docIndex] / 255 : 1)
      if (sourceAlpha <= 0) continue
      const destAlpha = output[di + 3]
      const contribution = destAlpha * (1 - sourceAlpha)
      const outputAlpha = sourceAlpha + contribution
      for (let channel = 0; channel < 3; channel++) {
        output[di + channel] =
          (layer.pixels[si + channel] * sourceAlpha + output[di + channel] * contribution) / outputAlpha
      }
      output[di + 3] = outputAlpha
    }
  }
  return output
}
