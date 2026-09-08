// ============================================================
// LUT engine — Color Lookup adjustment (Task 9-b).
//  - 10 analytic built-ins, lazily baked into 33³ float tables
//    (~430 KB each) on first use
//  - Adobe .cube parser: LUT_3D_SIZE 8–65, LUT_1D_SIZE (baked to a
//    diagonal 3D), TITLE, DOMAIN_MIN/MAX, # comments
//  - tetrahedral-interpolated apply (sharper gradients than
//    trilinear) with a strength lerp toward the original
//
// SERIALIZATION CONTRACT (critical): history snapshots / action
// steps JSON-ify layer params, so an adjustment layer only ever
// stores { lutId: string, strength: number } — the Float32Array
// tables live HERE, in the module-level registry, never inside
// params. Built-ins bake deterministically in every module
// instance (main thread AND the pixel worker — same code), so
// built-in ids resolve everywhere. Imported .cube tables are
// registered on the main thread only; the generic dialog routes
// custom-LUT commits through the synchronous main-thread engine
// path for exactly that reason (see generic-dialogs.tsx).
// Pure functions + module state — no DOM / engine imports.
// ============================================================

import { clamp } from '../utils/canvas'
import { smoothRamp } from './interp'

export interface LutDef {
  id: string
  name: string
  /** grid edge length N — table.length === N*N*N*3 */
  size: number
  /** 0..1 rgb triples in cube order: idx = (b*N + g)*N + r (r varies fastest) */
  table: Float32Array
  builtin: boolean
}

export const LUT_REGISTRY = new Map<string, LutDef>()

/** built-in bake resolution */
const BAKE_SIZE = 33

// ---------------------------------------------------------------- helpers

const LUM = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

type RgbFn = (r: number, g: number, b: number, out: number[]) => void

/**
 * Tetrahedral-interpolated sample of a 3D LUT.
 * r/g/b in 0..1; result written to out[0..2] (0..1).
 *
 * The cell's 8 corners are never all blended (trilinear); instead the
 * fractional components are sorted, picking one of the 6 tetrahedra that
 * tile the cube — 4 corner fetches, no wasted weights, and visibly sharper
 * gradients on saturated LUTs. On diagonal (per-channel) tables the result
 * is exactly per-channel linear interpolation.
 */
export function sampleLUT(lut: LutDef, r: number, g: number, b: number, out: number[]): void {
  const N = lut.size
  const t = lut.table
  const x = clamp(r, 0, 1) * (N - 1)
  const y = clamp(g, 0, 1) * (N - 1)
  const z = clamp(b, 0, 1) * (N - 1)
  let x0 = x | 0
  let y0 = y | 0
  let z0 = z | 0
  // keep the upper neighbors in range (fx becomes 1 at the very edge)
  if (x0 > N - 2) x0 = N - 2
  if (y0 > N - 2) y0 = N - 2
  if (z0 > N - 2) z0 = N - 2
  const fx = x - x0
  const fy = y - y0
  const fz = z - z0
  const base = ((z0 * N + y0) * N + x0) * 3
  const dX = 3          // +1 in r
  const dY = 3 * N      // +1 in g
  const dZ = 3 * N * N  // +1 in b
  const c3 = base + dX + dY + dZ // always the 111 corner
  let c1: number
  let c2: number
  let w0: number
  let w1: number
  let w2: number
  if (fx >= fy) {
    if (fy >= fz) {
      // x ≥ y ≥ z : path 000 → 100 → 110 → 111
      w0 = 1 - fx; w1 = fx - fy; w2 = fy - fz
      c1 = base + dX; c2 = base + dX + dY
    } else if (fx >= fz) {
      // x ≥ z > y : path 000 → 100 → 101 → 111
      w0 = 1 - fx; w1 = fx - fz; w2 = fz - fy
      c1 = base + dX; c2 = base + dX + dZ
    } else {
      // z > x ≥ y : path 000 → 001 → 101 → 111
      w0 = 1 - fz; w1 = fz - fx; w2 = fx - fy
      c1 = base + dZ; c2 = base + dZ + dX
    }
  } else {
    if (fz >= fy) {
      // z ≥ y > x : path 000 → 001 → 011 → 111
      w0 = 1 - fz; w1 = fz - fy; w2 = fy - fx
      c1 = base + dZ; c2 = base + dZ + dY
    } else if (fz >= fx) {
      // y > z ≥ x : path 000 → 010 → 011 → 111
      w0 = 1 - fy; w1 = fy - fz; w2 = fz - fx
      c1 = base + dY; c2 = base + dY + dZ
    } else {
      // y > x > z : path 000 → 010 → 110 → 111
      w0 = 1 - fy; w1 = fy - fx; w2 = fx - fz
      c1 = base + dY; c2 = base + dY + dX
    }
  }
  const w3 = 1 - w0 - w1 - w2 // fz / fy / fx remainder — always lands on 111
  for (let ch = 0; ch < 3; ch++) {
    out[ch] = t[base + ch] * w0 + t[c1 + ch] * w1 + t[c2 + ch] * w2 + t[c3 + ch] * w3
  }
}

// ---------------------------------------------------------------- built-ins
// Every look is an analytic rgb→rgb function baked into a 33³ table.
// Values are in 0..1; shadow/highlight split-toning uses smoothRamp so the
// transitions stay C0-smooth (no banding after 8-bit quantization).

interface BuiltinSpec { id: string; name: string; fn: RgbFn }

const BUILTIN_SPECS: BuiltinSpec[] = [
  {
    id: 'teal-orange', name: 'Teal & Orange (Cinematic)',
    fn(r, g, b, o) {
      const l = LUM(r, g, b)
      // filmic S-contrast, then split-tone: teal lift in shadows, orange in highlights
      let v = l * l * (3 - 2 * l)
      v = 0.5 + (v - 0.5) * 1.08
      const sh = 1 - smoothRamp(v, 0, 0.62)
      const hi = smoothRamp(v, 0.45, 1)
      let nr = r + (v - r) * 0.18
      let ng = g + (v - g) * 0.14
      let nb = b + (v - b) * 0.18
      nr -= sh * 0.075; ng += sh * 0.012; nb += sh * 0.062
      nr += hi * 0.058; ng += hi * 0.026; nb -= hi * 0.055
      o[0] = nr; o[1] = ng; o[2] = nb
    },
  },
  {
    id: 'noir', name: 'Noir (High-Contrast B&W)',
    fn(r, _g, _b, o) {
      let v = LUM(r, _g, _b)
      // double crush: deep blacks, punchy mids
      v = clamp((v - 0.06) / 0.94, 0, 1)
      v = v * v * (3 - 2 * v)
      v = clamp((v - 0.04) / 0.96, 0, 1)
      // faint cool silver in the top end
      o[0] = v * 0.985
      o[1] = v * 0.995
      o[2] = v
    },
  },
  {
    id: 'faded-film', name: 'Faded Film',
    fn(r, g, b, o) {
      const l = LUM(r, g, b)
      // lifted blacks + rolled highlights
      const v = 0.055 + l * 0.875
      let nr = v + (r - l) * 0.65
      let ng = v + (g - l) * 0.65
      let nb = v + (b - l) * 0.65
      // cyan in the lifted shadow floor, faint warm roll-off up top
      const sh = 1 - smoothRamp(v, 0, 0.55)
      const hi = smoothRamp(v, 0.6, 1)
      nr -= sh * 0.022; ng += sh * 0.004; nb += sh * 0.030
      nr += hi * 0.012; ng += hi * 0.006; nb -= hi * 0.010
      o[0] = nr; o[1] = ng; o[2] = nb
    },
  },
  {
    id: 'cross-process', name: 'Cross Process',
    fn(r, g, b, o) {
      const l = LUM(r, g, b)
      const v = 0.5 + (l - 0.5) * 1.12
      const sh = 1 - smoothRamp(v, 0, 0.66)
      const hi = smoothRamp(v, 0.42, 1)
      let nr = r + (v - l) * 0.1
      let ng = g + (v - l) * 0.1
      let nb = b + (v - l) * 0.1
      // green shadows, yellow highlights
      nr -= sh * 0.050; ng += sh * 0.050; nb -= sh * 0.060
      nr += hi * 0.045; ng += hi * 0.038; nb -= hi * 0.075
      o[0] = nr; o[1] = ng; o[2] = nb
    },
  },
  {
    id: 'bleach-bypass', name: 'Bleach Bypass',
    fn(r, g, b, o) {
      const l = LUM(r, g, b)
      // heavy desat + heavy contrast (silver-retention look)
      let v = clamp((l - 0.5) * 1.45 + 0.5, 0, 1)
      v = v * v * (3 - 2 * v) * 0.75 + v * 0.25
      o[0] = v + (r - l) * 0.28
      o[1] = v + (g - l) * 0.28
      o[2] = v + (b - l) * 0.28
    },
  },
  {
    id: 'velvia', name: 'Velvia (Saturation Punch)',
    fn(r, g, b, o) {
      const l = LUM(r, g, b)
      // ~1.42× chroma + soft black crush (the slide-film signature)
      const nr = l + (r - l) * 1.42
      const ng = l + (g - l) * 1.42
      const nb = l + (b - l) * 1.42
      o[0] = nr <= 0 ? 0 : Math.pow(nr, 1.09)
      o[1] = ng <= 0 ? 0 : Math.pow(ng, 1.09)
      o[2] = nb <= 0 ? 0 : Math.pow(nb, 1.09)
    },
  },
  {
    id: 'moonlight', name: 'Moonlight (Steel)',
    fn(r, g, b, o) {
      const l = LUM(r, g, b)
      const v = 0.5 + (l - 0.5) * 1.05
      let nr = v + (r - l) * 0.55
      let ng = v + (g - l) * 0.60
      let nb = v + (b - l) * 0.62
      // steel/teal shadows (deliberately NOT saturated blue) + neutral-cool highlights
      const sh = 1 - smoothRamp(v, 0, 0.6)
      const hi = smoothRamp(v, 0.55, 1)
      nr -= sh * 0.055; ng -= sh * 0.012; nb += sh * 0.028
      nr -= hi * 0.012; nb += hi * 0.012
      o[0] = nr; o[1] = ng; o[2] = nb
    },
  },
  {
    id: 'sepia-tone', name: 'Sepia Tone',
    fn(r, g, b, o) {
      let v = LUM(r, g, b)
      v = v * v * (3 - 2 * v) * 0.85 + v * 0.15
      // classic warm-brown duotone ramp
      const hi = smoothRamp(v, 0.35, 1)
      o[0] = 0.06 + v * 0.94 + hi * 0.02
      o[1] = 0.045 + v * 0.78 - hi * 0.01
      o[2] = 0.03 + v * 0.55
    },
  },
  {
    id: 'golden-hour', name: 'Golden Hour',
    fn(r, g, b, o) {
      const l = LUM(r, g, b)
      const v = 0.5 + (l - 0.5) * 1.05
      const hi = smoothRamp(v, 0.3, 1)
      const sh = 1 - smoothRamp(v, 0, 0.55)
      // amber highlights, gently cooled shadows for balance
      let nr = v + (r - l) * 0.9 + hi * 0.075
      let ng = v + (g - l) * 0.92 + hi * 0.020
      let nb = v + (b - l) * 0.88 - hi * 0.070
      nr -= sh * 0.018; ng -= sh * 0.004; nb += sh * 0.022
      o[0] = nr; o[1] = ng; o[2] = nb
    },
  },
  {
    id: 'cyberpunk', name: 'Cyberpunk (Magenta/Teal)',
    fn(r, g, b, o) {
      const l = LUM(r, g, b)
      const v = 0.5 + (l - 0.5) * 1.14
      const sh = 1 - smoothRamp(v, 0, 0.58)
      const hi = smoothRamp(v, 0.48, 1)
      let nr = v + (r - l) * 1.25
      let ng = v + (g - l) * 1.05
      let nb = v + (b - l) * 1.25
      // teal shadows, magenta highlights
      nr -= sh * 0.070; ng += sh * 0.020; nb += sh * 0.055
      nr += hi * 0.070; ng -= hi * 0.028; nb += hi * 0.075
      o[0] = nr; o[1] = ng; o[2] = nb
    },
  },
]

function bakeBuiltin(spec: BuiltinSpec): LutDef {
  const N = BAKE_SIZE
  const table = new Float32Array(N * N * N * 3)
  const out = [0, 0, 0]
  let p = 0
  for (let bi = 0; bi < N; bi++) {
    for (let gi = 0; gi < N; gi++) {
      for (let ri = 0; ri < N; ri++) {
        spec.fn(ri / (N - 1), gi / (N - 1), bi / (N - 1), out)
        table[p++] = out[0]
        table[p++] = out[1]
        table[p++] = out[2]
      }
    }
  }
  return { id: spec.id, name: spec.name, size: N, table, builtin: true }
}

/** built-ins first (spec order), then session-imported customs */
export function listLuts(): LutDef[] {
  for (const spec of BUILTIN_SPECS) {
    if (!LUT_REGISTRY.has(spec.id)) LUT_REGISTRY.set(spec.id, bakeBuiltin(spec))
  }
  const builtins = BUILTIN_SPECS.map(s => LUT_REGISTRY.get(s.id)!)
  const customs = [...LUT_REGISTRY.values()].filter(l => !l.builtin)
  return [...builtins, ...customs]
}

/** lookup by id — built-ins bake on demand (cheap single-table lazy path,
 *  also used inside the pixel worker); unknown ids return undefined */
export function getLut(id: string): LutDef | undefined {
  const existing = LUT_REGISTRY.get(id)
  if (existing) return existing
  const spec = BUILTIN_SPECS.find(s => s.id === id)
  if (!spec) return undefined
  const baked = bakeBuiltin(spec)
  LUT_REGISTRY.set(id, baked)
  return baked
}

// ---------------------------------------------------------------- .cube parser

let cubeSeq = 0

function tablesClose(a: Float32Array, b: Float32Array): boolean {
  // strided compare (stride 97 ≈ coprime with 3) — enough to dedupe
  // re-imports of the same file without a 100k-float walk
  if (a.length !== b.length || a.length === 0) return a.length === b.length
  for (let i = 0; i < a.length; i += 97) if (a[i] !== b[i]) return false
  return a[a.length - 1] === b[b.length - 1]
}

function registerCustom(table: Float32Array, size: number, name: string): LutDef {
  for (const l of LUT_REGISTRY.values()) {
    if (l.builtin || l.name !== name || l.size !== size) continue
    if (tablesClose(l.table, table)) return l
  }
  const def: LutDef = { id: `cube-${++cubeSeq}`, name, size, table, builtin: false }
  LUT_REGISTRY.set(def.id, def)
  return def
}

/**
 * Parse an Adobe .cube LUT (text). Supports:
 *   TITLE "…", # comments, DOMAIN_MIN/MAX (values normalized to 0..1),
 *   LUT_3D_SIZE N (8–65, r varies fastest) and LUT_1D_SIZE N — 1D tables
 *   are resampled to 33 entries and baked as a DIAGONAL 3D table
 *   (out(r,g,b) = (fr(r), fg(g), fb(b)); tetrahedral sampling of a
 *   diagonal is exactly per-channel interpolation, so the 3D apply path
 *   stays the only path). Rows may carry a 4th (weight) column — ignored.
 * The parsed LutDef is registered under a fresh `cube-<n>` id and returned.
 */
export function parseCube(text: string, name: string): LutDef {
  const rows: number[][] = []
  let title = ''
  let size3d = 0
  let size1d = 0
  let dmin = [0, 0, 0]
  let dmax = [1, 1, 1]

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const lower = line.toLowerCase()
    if (lower.startsWith('title')) {
      title = line.slice(5).trim().replace(/^"+/, '').replace(/"+$/, '')
      continue
    }
    if (lower.startsWith('lut_3d_size')) { size3d = parseInt(line.slice(11).trim(), 10) || 0; continue }
    if (lower.startsWith('lut_1d_size')) { size1d = parseInt(line.slice(11).trim(), 10) || 0; continue }
    if (lower.startsWith('domain_min') || lower.startsWith('domain_max')) {
      const v = line.slice(10).trim().split(/\s+/).map(Number)
      if (v.length >= 3 && v.slice(0, 3).every(n => Number.isFinite(n))) {
        const dst = lower.startsWith('domain_min') ? dmin : dmax
        dst[0] = v[0]; dst[1] = v[1]; dst[2] = v[2]
      }
      continue
    }
    const parts = line.split(/\s+/).map(Number)
    if (parts.length >= 3 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && Number.isFinite(parts[2])) {
      rows.push([parts[0], parts[1], parts[2]])
    }
  }

  const lutName = (name || title || 'Custom LUT').trim() || 'Custom LUT'
  // domain span (per channel) — normalize table values into 0..1
  const span = [
    Math.abs(dmax[0] - dmin[0]) || 1,
    Math.abs(dmax[1] - dmin[1]) || 1,
    Math.abs(dmax[2] - dmin[2]) || 1,
  ]
  const norm = (v: number, c: number) => (v - dmin[c]) / span[c]

  if (size3d > 0) {
    if (size3d < 8 || size3d > 65) throw new Error(`unsupported LUT_3D_SIZE ${size3d} (8–65 supported)`)
    const count = size3d * size3d * size3d
    if (rows.length < count) throw new Error(`truncated .cube: expected ${count} rows, found ${rows.length}`)
    const N = size3d
    const table = new Float32Array(count * 3)
    let p = 0
    for (let i = 0; i < count; i++) {
      const row = rows[i]
      table[p++] = norm(row[0], 0)
      table[p++] = norm(row[1], 1)
      table[p++] = norm(row[2], 2)
    }
    return registerCustom(table, N, lutName)
  }

  if (size1d > 0) {
    if (rows.length < size1d) throw new Error(`truncated 1D .cube: expected ${size1d} rows, found ${rows.length}`)
    // resample each column onto 33 control points (linear), then bake the
    // diagonal 3D — handles both per-channel and shared-curve 1D LUTs
    const N = BAKE_SIZE
    const curves: Float32Array[] = []
    for (let c = 0; c < 3; c++) {
      const curve = new Float32Array(N)
      for (let i = 0; i < N; i++) {
        const t = (i / (N - 1)) * (size1d - 1)
        const i0 = t | 0
        const i1 = Math.min(i0 + 1, size1d - 1)
        const f = t - i0
        const v0 = norm(rows[i0][c], c)
        const v1 = norm(rows[i1][c], c)
        curve[i] = v0 + (v1 - v0) * f
      }
      curves.push(curve)
    }
    const table = new Float32Array(N * N * N * 3)
    let p = 0
    for (let bi = 0; bi < N; bi++) {
      for (let gi = 0; gi < N; gi++) {
        for (let ri = 0; ri < N; ri++) {
          table[p++] = curves[0][ri]
          table[p++] = curves[1][gi]
          table[p++] = curves[2][bi]
        }
      }
    }
    return registerCustom(table, N, `${lutName} (1D)`)
  }

  throw new Error('no LUT_3D_SIZE / LUT_1D_SIZE found')
}

// ---------------------------------------------------------------- apply

/**
 * Apply a LUT to ImageData in place. `strength` 0–100 lerps the result
 * toward the original pixels. Unknown ids are a no-op (e.g. a custom
 * .cube id from a previous session).
 */
export function applyLUT(img: ImageData, lutId: string, strength: number): void {
  const lut = getLut(lutId)
  if (!lut) return
  const t = clamp(strength, 0, 100) / 100
  if (t <= 0) return
  const d = img.data
  const out = [0, 0, 0]
  if (t >= 1) {
    for (let i = 0; i < d.length; i += 4) {
      sampleLUT(lut, d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, out)
      d[i] = out[0] * 255
      d[i + 1] = out[1] * 255
      d[i + 2] = out[2] * 255
    }
    return
  }
  const src = new Uint8ClampedArray(d)
  for (let i = 0; i < d.length; i += 4) {
    sampleLUT(lut, d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, out)
    d[i] = src[i] + (out[0] * 255 - src[i]) * t
    d[i + 1] = src[i + 1] + (out[1] * 255 - src[i + 1]) * t
    d[i + 2] = src[i + 2] + (out[2] * 255 - src[i + 2]) * t
  }
}
