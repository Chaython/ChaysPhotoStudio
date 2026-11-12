// ============================================================
// LUT core — the 3D table type, the session registry and the
// tetrahedral sampler shared by every LUT source (built-in looks,
// Adobe/Resolve .cube, Lustre .3dl and SpeedGrade .look).
//
// The table layout is ours and stays fixed across every format:
//   idx = (b*N + g)*N + r   (red varies fastest)
// so the sampler has exactly one indexing scheme to reason about
// regardless of how the source file ordered its nodes.
//
// SERIALIZATION CONTRACT (critical): history snapshots / action
// steps JSON-ify layer params, so an adjustment layer only ever
// stores { lutId: string, strength: number } — the Float32Array
// tables live HERE, in the module-level registry, never inside
// params. Built-ins bake deterministically in every module instance
// (main thread AND the pixel worker — same code), so built-in ids
// resolve everywhere. Imported tables are registered on the main
// thread only; the generic dialog routes custom-LUT commits through
// the synchronous main-thread engine path for exactly that reason
// (see generic-dialogs.tsx).
//
// Pure functions + module state — no DOM / engine imports.
// ============================================================

import { clamp } from '../utils/canvas'

export interface LutDef {
  id: string
  name: string
  /** grid edge length N — table.length === N*N*N*3 */
  size: number
  /** 0..1 rgb triples in cube order: idx = (b*N + g)*N + r (r varies fastest) */
  table: Float32Array
  builtin: boolean
  /**
   * Optional 1-D *input* curve carried by a Lustre `.3dl` "shaper"
   * row: it is applied to each channel ahead of the 3-D lookup, the
   * way Photoshop reads such files.
   *
   * The curve is kept exact rather than baked into the cube grid. A
   * baked shaper has to be resampled onto the cube's node spacing,
   * which bends the curve's own breakpoints; keeping the curve
   * separate costs one extra table lookup per channel and stays
   * faithful for any knot count.
   */
  shaper?: Float32Array
}

export const LUT_REGISTRY = new Map<string, LutDef>()

/**
 * Evaluate a 1-D shaper curve at `x` (0..1) with linear interpolation.
 * The curve's samples are spread evenly over 0..1.
 */
export function sampleShaper(shaper: Float32Array, x: number): number {
  const m = shaper.length
  if (m === 0) return x
  if (m === 1) return clamp(shaper[0], 0, 1)
  const p = clamp(x, 0, 1) * (m - 1)
  const i = Math.min(m - 2, Math.floor(p))
  const f = p - i
  return clamp(shaper[i] + (shaper[i + 1] - shaper[i]) * f, 0, 1)
}

// ---------------------------------------------------------------- registry

let customSeq = 0

/** strided compare (stride 97 ≈ coprime with 3) — enough to dedupe
 *  re-imports of the same file without a 100k-float walk */
function tablesClose(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length || a.length === 0) return a.length === b.length
  for (let i = 0; i < a.length; i += 97) if (a[i] !== b[i]) return false
  return a[a.length - 1] === b[b.length - 1]
}

function shapersClose(a: Float32Array | undefined, b: Float32Array | undefined): boolean {
  if (!a || !b) return !a && !b
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Register a freshly parsed table under a fresh id, or return the
 * existing entry when an identical table is already in the registry
 * (re-importing the same file should not pile up duplicates).
 */
export function registerCustomLut(
  table: Float32Array,
  size: number,
  name: string,
  prefix: string,
  shaper?: Float32Array,
): LutDef {
  for (const l of LUT_REGISTRY.values()) {
    if (l.builtin || l.name !== name || l.size !== size) continue
    if (!tablesClose(l.table, table)) continue
    if (!shapersClose(l.shaper, shaper)) continue
    return l
  }
  const def: LutDef = { id: `${prefix}-${++customSeq}`, name, size, table, builtin: false }
  if (shaper) def.shaper = shaper
  LUT_REGISTRY.set(def.id, def)
  return def
}
