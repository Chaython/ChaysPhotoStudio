import type { Layer } from '../types'

/** Rasterize the CONTENT of an editable layer, not its live mask/styles.
 * prepareLayer() composites mask, vector mask and FX into its output by
 * default. Baking those and retaining them would double-apply the effects.
 * Work with a detached proxy and invalidate its cached render signature. */
export function layerContentForRasterization(layer: Layer): Layer {
  return {
    ...layer,
    maskEnabled: false,
    vectorMask: layer.vectorMask ? { ...layer.vectorMask, enabled: false } : null,
    fx: null,
    _v: layer._v + 1,
    _mv: layer._mv + 1,
  }
}
