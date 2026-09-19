// ============================================================
// Image operations library — adjustments, filters, AI selections, inpainting
// Production rewrite (Task 2-a). Module map:
//   ./color       — HSV / HSL / Lab (D65) / hex / hue-family math
//   ./interp      — monotone cubic curves, smoothstep, seeded RNG
//   ./blur        — exact gaussian box decomposition, bilinear resample, sobel
//   ./adjustments — ADJUSTMENTS registry (tone & color ops)
//   ./filters     — FILTERS registry (all filter groups)
//   ./filters2    — FILTERS2 registry (Task 9-b: average, diffuse-glow,
//                   glass, ocean-ripple, zigzag, pinch, shear, displace,
//                   fibers, difference-clouds, lens-correction)
//   ./lut         — Color Lookup engine: 10 built-in LUTs, .cube parser,
//                   tetrahedral applyLUT (backing the color-lookup
//                   adjustment — tables live in a module registry, params
//                   only carry { lutId, strength })
//   ./selection   — selectSubject / objectSelect / quickSelectRegion /
//                   colorRange / focusArea / refineMask / decontaminateColors
//   ./inpaint     — Content-Aware Fill (pyramid diffusion + PatchMatch)
//   ./core        — engine-owned primitives (re-exported below)
//
// REQUIRED EXPORT CONTRACT (unchanged):
//   ADJUSTMENTS: Record<AdjustmentType, AdjustmentDef>
//   FILTERS: Record<FilterType, FilterDef>
//   applyAdjustment(img, type, params): void  — in place
//   applyFilter(img, type, params): void      — in place
//   selectSubject(img): Uint8ClampedArray (mask, 255 = fg)
//   objectSelect(img, x, y, w, h): Uint8ClampedArray
//   quickSelectRegion(img, x, y, radius, tolerance, prevMask?): Uint8ClampedArray
//   colorRange(img, params): Uint8ClampedArray
//   focusArea(img, params): Uint8ClampedArray
//   refineMask(mask, w, h, params): Uint8ClampedArray
//   decontaminateColors(img, mask, amount): void
//   inpaint(img, mask, onProgress?): Promise<void> — fills masked area
//   floodFillMask, computeHistogram (re-export from ./core)
// ============================================================

import type { AdjustmentType, FilterDef, FilterType } from '../types'
import { ADJUSTMENTS } from './adjustments'
import { FILTERS as FILTERS_BASE } from './filters'
import { FILTERS2 } from './filters2'
import {
  colorRange, decontaminateColors, focusArea, objectSelect,
  quickSelectRegion, refineMask, selectSubject,
} from './selection'
import { inpaint } from './inpaint'

// ------------------------------------------------------------------ registries
/** Combined filter registry. filters.ts keeps the original entries as a
 *  Partial; FILTERS2 (Task 9-b) completes the FilterType set — THIS merged
 *  record is the Record<FilterType, FilterDef> every consumer sees (the
 *  export contract documented above is unchanged). */
const FILTERS: Record<FilterType, FilterDef> = {
  ...FILTERS_BASE,
  ...FILTERS2,
} as Record<FilterType, FilterDef>

// compile-time exhaustiveness guard — errors here if a FilterType key has
// no entry in either registry half (prevents silent dead menu items)
type _UncoveredFilters = Exclude<FilterType, keyof typeof FILTERS_BASE | keyof typeof FILTERS2>
const _filtersComplete: [_UncoveredFilters] extends [never]
  ? true
  : ['MISSING FILTER REGISTRY ENTRIES', _UncoveredFilters] = true
void _filtersComplete

export { ADJUSTMENTS, FILTERS }

export function applyAdjustment(img: ImageData, type: AdjustmentType, params: Record<string, any>) {
  const def = ADJUSTMENTS[type]
  if (!def) return
  const merged = { ...def.defaults, ...params }
  def.apply(img, merged)
}

export function applyFilter(img: ImageData, type: FilterType, params: Record<string, any>) {
  const def = FILTERS[type]
  if (!def) return
  const merged = { ...def.defaults, ...params }
  def.apply(img, merged)
}

// ---- LUT engine (color-lookup adjustment + .cube import) ----
export {
  LUT_REGISTRY, listLuts, getLut, parseCube, applyLUT, sampleLUT,
  type LutDef,
} from './lut'

// ---- filters2 registry (direct access for tooling that wants only the
//      Task 9-b half — the merged FILTERS above is the public surface) ----
export { FILTERS2, type NewFilterType } from './filters2'

// ---- AI / analysis selections ----
export { selectSubject, objectSelect, quickSelectRegion, colorRange, focusArea, refineMask, decontaminateColors }

// ---- content-aware fill ----
export { inpaint }

// ---- AI upscaler (on-device) ----
export {
  lanczosResample, upscaleSmart, type UpscaleOptions,
} from './upscale'

// ---- object detection (on-device) ----
export { detectObjects, type DetectedObject } from './detect'

// ---- AI image generation (text-to-image) ----
export {
  aiGenerate, dataUrlToFile, dataUrlToCanvas, composePrompt,
  AI_GEN_SIZES, AI_STYLE_PRESETS, AI_GEN_MAX_PROMPT,
  loadCustomGenConfig, saveCustomGenConfig,
  type AiGenerateOptions, type AiGenProvider, type AiGenMeta, type CustomGenConfig,
} from './generate'

// ---- auto corrections & match color (PS Image menu) ----
export { autoTone, autoContrast, autoColor, matchColor, type MatchColorOptions } from './auto'

// ---- content-aware scale (seam carving) ----
export { seamCarve, boxResampleMask, type SeamCarveOptions, type SeamCarveResult } from './seam-carve'

// ---- core primitives (kept in the public surface for the engine/tools) ----
export { floodFillMask, computeHistogram } from './core'

// ---- perceptual Magic Wand / Select Similar ----
export { perceptualWandMask, type PerceptualWandOptions } from './wand'
