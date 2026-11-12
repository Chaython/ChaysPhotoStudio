// ============================================================
// Channel editing targets — engine adapter
// ------------------------------------------------------------
// Bridges the pure plane math in image-ops/channel-restrict.ts to
// the engine's canvas-backed layers (8-bit unorm8 or native
// float16) and resolves which target an operation should honour:
// an explicit target in recorded action args always wins over the
// panel state, so replayed actions re-create their original edit.
// ============================================================
import type { ChannelTarget, PsDocument, Rect } from '../types'
import {
  capturePlanes,
  capturePlanesF32,
  erasePaintData,
  parseChannelTarget,
  protectedPlanes,
  restorePlanes,
  restorePlanesF32,
  docRectToLayerRect,
  type PlaneSnapshot,
  type PlaneSnapshotF32,
} from '../image-ops/channel-restrict'
import { canvasProfile, createCanvas, ctx2d, getFloat16ImageData, hexToRgb, putImageData } from '../utils/canvas'

/** Resolve the editing target an operation must honour. An explicit target
 *  (recorded with an action, or passed by a dialog that captured the panel
 *  state when it opened) wins over the live panel state; invalid values are
 *  refused before any mutation. */
export function resolveChannelTarget(doc: PsDocument, argTarget?: unknown): { target: ChannelTarget; restrict: boolean } {
  let target: ChannelTarget | null
  if (argTarget !== undefined && argTarget !== null) {
    target = parseChannelTarget(argTarget)
    if (!target) throw new Error('Unknown channel editing target')
  } else {
    target = doc.channelTarget ?? 'composite'
  }
  return { target, restrict: target !== 'composite' }
}

/** True when the document's panel state constrains writes to a colour subset. */
export function channelRestricts(doc: PsDocument): boolean {
  return !!doc.channelTarget && doc.channelTarget !== 'composite'
}

export interface CanvasPlaneSnapshot {
  snapshot: PlaneSnapshot
  /** Native float16 backing store — restore must round-trip through the
   *  float16 pixel format instead of plain ImageData. */
  float16: boolean
}

/** Snapshot the protected planes of a layer canvas region before a
 *  channel-targeted commit. `rect` is layer-space and must already be
 *  clipped to the canvas. Returns null when the target protects nothing. */
export function captureCanvasPlanes(
  canvas: HTMLCanvasElement,
  rect: Rect,
  target: ChannelTarget,
): CanvasPlaneSnapshot | null {
  const components = protectedPlanes(target)
  if (!components.length) return null
  if (canvasProfile(canvas).bitDepth === 16) {
    // Float16 readback is full-canvas; capture at canvas-space rect with
    // canvas width as stride.
    const img = getFloat16ImageData(canvas)
    if (!img) throw new Error('Float16 pixel readback unavailable; refusing 8-bit fallback')
    const snap = capturePlanes(img.data as unknown as Uint8ClampedArray, canvas.width, rect, components)
    return { snapshot: snap, float16: true }
  }
  // 8-bit: read full canvas so data-space and canvas-space offsets match.
  const full = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height)
  const snap = capturePlanes(full.data, canvas.width, rect, components)
  return { snapshot: snap, float16: false }
}

/** Restore protected planes after the operation committed. Reads the canvas,
 *  splices the snapshot planes in, and writes back so targeted components
 *  keep their new values. */
export function restoreCanvasPlanes(canvas: HTMLCanvasElement, captured: CanvasPlaneSnapshot): void {
  const snap = captured.snapshot
  if (captured.float16) {
    const img = getFloat16ImageData(canvas)
    if (!img) throw new Error('Float16 pixel readback unavailable; refusing 8-bit fallback')
    restorePlanes(img.data as unknown as Uint8ClampedArray, snap)
    const image = new (ImageData as any)(img.data, canvas.width, canvas.height, {
      pixelFormat: 'rgba-float16',
      colorSpace: canvasProfile(canvas).colorSpace,
    })
    ;(ctx2d(canvas) as any).putImageData(image, 0, 0)
    return
  }
  const full = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height)
  restorePlanes(full.data, snap)
  ctx2d(canvas).putImageData(full, 0, 0)
}

/** Snapshot the protected planes of a layer's authoritative Float32 pixels
 *  (scene-linear HDR documents). Raw copies preserve HDR/NaN payloads. */
export function captureHdrPlanes(
  pixels: Float32Array,
  width: number,
  rect: Rect,
  target: ChannelTarget,
): PlaneSnapshotF32 | null {
  const components = protectedPlanes(target)
  if (!components.length) return null
  return capturePlanesF32(pixels, width, rect, components)
}

export function restoreHdrPlanes(pixels: Float32Array, snap: PlaneSnapshotF32): void {
  restorePlanesF32(pixels, snap)
}

/** Build a background-colour paint buffer from an eraser's coverage stroke
 *  (erase-under-colour-target semantics). Returns a new canvas; the stroke
 *  canvas is untouched. */
export function translateEraseStrokeToColor(stroke: HTMLCanvasElement, bgHex: string): HTMLCanvasElement {
  const img = ctx2d(stroke).getImageData(0, 0, stroke.width, stroke.height)
  const [r, g, b] = hexToRgb(bgHex)
  const out = erasePaintData(img.data, { r, g, b })
  const tmp = createCanvas(stroke.width, stroke.height, canvasProfile(stroke))
  const idata = new ImageData(stroke.width, stroke.height)
  idata.data.set(out)
  putImageData(tmp, idata)
  return tmp
}
