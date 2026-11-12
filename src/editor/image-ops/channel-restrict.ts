// ============================================================
// Channel editing targets — pure plane math
// ------------------------------------------------------------
// Photoshop-style channel-targeted editing: when the Channels
// panel targets a subset of the colour channels, pixel commits
// must write ONLY those components. Every unselected component
// (the other colour planes and the layer alpha) is preserved
// byte-for-byte. Strategy: run the operation normally against
// the full-colour input, then restore the protected planes
// from a pre-operation snapshot. Selected components therefore
// match what a composite edit would have produced (cross
// component inputs stay intact), and unselected components are
// exact — including HDR payloads beyond 1.0.
// ============================================================
import type { ChannelTarget, Rect } from '../types'

/** Colour components targeted by an editing target, in RGBA plane order. */
export function channelTargetComponents(target: ChannelTarget): number[] {
  switch (target) {
    case 'r': return [0]
    case 'g': return [1]
    case 'b': return [2]
    case 'rg': return [0, 1]
    case 'rb': return [0, 2]
    case 'gb': return [1, 2]
    default: return [0, 1, 2] // 'composite' — no plane is protected
  }
}

/** Components a channel-targeted commit must preserve: the unselected colour
 *  planes plus the layer alpha (colour targets never edit alpha). */
export function protectedPlanes(target: ChannelTarget): number[] {
  if (target === 'composite') return []
  const on = new Set(channelTargetComponents(target))
  return [0, 1, 2, 3].filter(c => !on.has(c))
}

/** Validate a serialized target (project files, recorded action args). */
export function parseChannelTarget(v: unknown): ChannelTarget | null {
  return v === 'composite' || v === 'r' || v === 'g' || v === 'b' || v === 'rg' || v === 'rb' || v === 'gb'
    ? v
    : null
}

export interface PlaneSnapshot {
  /** Offset (in pixels) within the data buffer where the region starts. */
  x: number
  y: number
  /** Region dimensions (in pixels). */
  w: number
  h: number
  /** Row stride of the data buffer (in pixels). */
  stride: number
  /** Protected RGBA component index for each packed plane buffer. */
  components: number[]
  /** One packed row-major single-plane buffer per protected component. */
  planes: Uint8Array[]
}

/** Snapshot protected planes of an 8-bit RGBA buffer. `width` is the buffer's
 *  row stride in pixels; `rect` is a data-space rectangle within that buffer. */
export function capturePlanes(data: Uint8ClampedArray, width: number, rect: Rect, components: number[]): PlaneSnapshot {
  const planes = components.map(() => new Uint8Array(rect.w * rect.h))
  for (let y = 0; y < rect.h; y++) {
    let src = ((rect.y + y) * width + rect.x) * 4
    let dst = y * rect.w
    for (let x = 0; x < rect.w; x++, src += 4, dst++) {
      for (let p = 0; p < components.length; p++) planes[p][dst] = data[src + components[p]]
    }
  }
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h, stride: width, components, planes }
}

/** Splice a snapshot's planes back into a post-operation RGBA buffer so only
 *  the targeted components keep their new values. `data` must have row stride
 *  `snap.stride`; the snapshot's x/y are data-space offsets into it. */
export function restorePlanes(data: Uint8ClampedArray, snap: PlaneSnapshot): void {
  const { x, y, w, h, stride, components, planes } = snap
  for (let p = 0; p < components.length; p++) {
    const component = components[p]
    const plane = planes[p]
    for (let row = 0; row < h; row++) {
      let src = ((y + row) * stride + x) * 4
      let dst = row * w
      for (let i = 0; i < w; i++, src += 4, dst++) {
        data[src + component] = plane[dst]
      }
    }
  }
}

export interface PlaneSnapshotF32 {
  x: number
  y: number
  w: number
  h: number
  stride: number
  components: number[]
  /** Raw Float32 copies keep HDR values, signed zeros and NaN payloads. */
  planes: Float32Array[]
}

/** Snapshot protected planes of a Float32 RGBA buffer. */
export function capturePlanesF32(data: Float32Array, width: number, rect: Rect, components: number[]): PlaneSnapshotF32 {
  const planes = components.map(() => new Float32Array(rect.w * rect.h))
  for (let y = 0; y < rect.h; y++) {
    let src = ((rect.y + y) * width + rect.x) * 4
    let dst = y * rect.w
    for (let x = 0; x < rect.w; x++, src += 4, dst++) {
      for (let p = 0; p < components.length; p++) planes[p][dst] = data[src + components[p]]
    }
  }
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h, stride: width, components, planes }
}

export function restorePlanesF32(data: Float32Array, snap: PlaneSnapshotF32): void {
  const { x, y, w, h, stride, components, planes } = snap
  for (let p = 0; p < components.length; p++) {
    const component = components[p]
    const plane = planes[p]
    for (let row = 0; row < h; row++) {
      let src = ((y + row) * stride + x) * 4
      let dst = row * w
      for (let i = 0; i < w; i++, src += 4, dst++) {
        data[src + component] = plane[dst]
      }
    }
  }
}

/** Erase-under-colour-target translation. An eraser normally subtracts alpha;
 *  with a colour target it paints the toolbox background colour into the
 *  selected components instead, so the coverage mask becomes an opaque
 *  colour paint whose alpha carries the stroke. The plane snapshot then
 *  restores the layer's true alpha and the unselected colour planes. */
export function erasePaintData(
  stroke: Uint8ClampedArray,
  bg: { r: number; g: number; b: number },
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(stroke.length)
  for (let i = 0; i < stroke.length; i += 4) {
    out[i] = bg.r
    out[i + 1] = bg.g
    out[i + 2] = bg.b
    out[i + 3] = stroke[i + 3]
  }
  return out
}

/** Intersect a document-space rectangle with a layer-space backing canvas
 *  (offset by the layer registration). Returns null when there is no overlap. */
export function docRectToLayerRect(
  rect: Rect,
  canvasWidth: number,
  canvasHeight: number,
  offsetX: number,
  offsetY: number,
): Rect | null {
  const x0 = Math.max(0, rect.x - offsetX)
  const y0 = Math.max(0, rect.y - offsetY)
  const x1 = Math.min(canvasWidth, rect.x + rect.w - offsetX)
  const y1 = Math.min(canvasHeight, rect.y + rect.h - offsetY)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
