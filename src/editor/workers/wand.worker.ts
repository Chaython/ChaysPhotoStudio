// ============================================================
// wand.worker — off-main-thread perceptual Magic Wand selection.
// Keeps the expensive Lab/flood-fill pass away from the UI thread on
// large images. The source RGBA buffer is transferred in; the worker
// returns only the 1-byte-per-pixel alpha mask.
// ============================================================
import { perceptualWandMask, type PerceptualWandOptions } from '../image-ops/wand'

interface WandRequest {
  id: number
  kind: 'wand'
  width: number
  height: number
  x: number
  y: number
  options: PerceptualWandOptions
  buffer: ArrayBuffer
}

const post = (msg: unknown, transfer?: Transferable[]) => {
  const scope = self as unknown as { postMessage(m: unknown, t?: Transferable[]): void }
  if (transfer?.length) scope.postMessage(msg, transfer)
  else scope.postMessage(msg)
}

self.onmessage = (ev: MessageEvent) => {
  const req = ev.data as WandRequest | { kind?: string }
  if (!req || req.kind !== 'wand') return
  let sourceBuffer: ArrayBuffer | null = null
  try {
    sourceBuffer = req.buffer
    const img = new ImageData(new Uint8ClampedArray(req.buffer), req.width, req.height)
    const mask = perceptualWandMask(img, req.x, req.y, req.options)
    post({ id: req.id, kind: 'done', mask: mask.buffer }, [mask.buffer])
  } catch (err) {
    // Source pixels are not needed on the main thread after dispatch, so there
    // is no need to transfer them back. The caller can re-read its source
    // canvas if a bounded synchronous fallback is safe.
    post({ id: req.id, kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

post({ kind: 'ready' })
