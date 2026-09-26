// ============================================================
// pixel-op.worker — module Web Worker for heavy one-shot pixel
// operations (Task 7-b). Runs PURE ImageData functions from the
// image-ops library off the main thread.
//
// Verified pure (no DOM / canvas / engine imports, mutate ImageData
// in place): image-ops/index.ts applyFilter + applyAdjustment
// (registry dispatch over filters.ts / adjustments.ts), and
// image-ops/auto.ts autoTone / autoContrast / autoColor / matchColor.
// The full image-ops import graph is import-safe in a worker — no
// module in the chain touches the DOM at load time.
//
// Message contract:
//   main → worker (request, buffer is TRANSFERRED):
//     { id, kind:'op', op, type?, params?, width, height,
//       sourceWidth?, sourceHeight? }  + data: { buffer, sourceBuffer? }
//       · buffer       — ImageData.data ArrayBuffer of the target pixels
//       · sourceBuffer — optional second ImageData buffer (match-color
//                        source stats; its dims travel in sourceWidth/
//                        sourceHeight)
//   worker → main:
//     { kind:'ready' }                                  on startup
//     { id, kind:'progress', p }                        reserved (no image-ops
//                                                        op reports progress yet)
//     { id, kind:'done', buffer }                       buffer TRANSFERRED back
//     { id, kind:'error', message, buffer? }            buffer transferred back
//                                                        when recoverable so the
//                                                        main thread can re-run
//                                                        synchronously
//
// The ImageData constructor IS available in workers (spec'd on the
// global scope, not window-bound); new Uint8ClampedArray(buffer) is a
// zero-copy view, so the op mutates the transferred buffer directly
// and we post the very same buffer home.
// ============================================================
import { applyFilter, applyAdjustment } from '../image-ops'
import { autoTone, autoContrast, autoColor, matchColor } from '../image-ops/auto'
import { perceptualWandMask } from '../image-ops/wand'

export type PixelOpKind =
  | 'filter' | 'adjustment'
  | 'auto-tone' | 'auto-contrast' | 'auto-color'
  | 'match-color'
  | 'wand-mask'

interface OpRequestMessage {
  id: number
  kind: 'op'
  op: PixelOpKind
  type?: string
  params?: Record<string, any>
  width: number
  height: number
  sourceWidth?: number
  sourceHeight?: number
  buffer: ArrayBuffer
  sourceBuffer?: ArrayBuffer
}

/** worker-scope postMessage (DedicatedWorkerGlobalScope signature, transfer list second arg) */
const post = (msg: unknown, transfer?: Transferable[]): void => {
  const scope = self as unknown as { postMessage(m: unknown, t?: Transferable[]): void }
  if (transfer && transfer.length) scope.postMessage(msg, transfer)
  else scope.postMessage(msg)
}

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as OpRequestMessage | { kind: string }
  if (!msg || msg.kind !== 'op') return
  const req = msg as OpRequestMessage
  let img: ImageData | null = null
  try {
    img = new ImageData(new Uint8ClampedArray(req.buffer), req.width, req.height)
    switch (req.op) {
      case 'filter':
        applyFilter(img, req.type as never, req.params ?? {})
        break
      case 'adjustment':
        applyAdjustment(img, req.type as never, req.params ?? {})
        break
      case 'auto-tone': autoTone(img); break
      case 'auto-contrast': autoContrast(img); break
      case 'auto-color': autoColor(img); break
      case 'match-color': {
        if (!req.sourceBuffer || !req.sourceWidth || !req.sourceHeight) {
          throw new Error('match-color requires a source ImageData (sourceBuffer + sourceWidth + sourceHeight)')
        }
        const source = new ImageData(new Uint8ClampedArray(req.sourceBuffer), req.sourceWidth, req.sourceHeight)
        matchColor(img, source, (req.params ?? {}) as never)
        break
      }
      case 'wand-mask': {
        const p = req.params ?? {}
        const x = Math.max(0, Math.min(req.width - 1, Math.round(Number(p.x) || 0)))
        const y = Math.max(0, Math.min(req.height - 1, Math.round(Number(p.y) || 0)))
        const mask = perceptualWandMask(img, x, y, p as never)
        // Return through the existing ImageData transport: encode the grayscale
        // selection in alpha so no second worker protocol/buffer pool is needed.
        for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
          img.data[j] = 255
          img.data[j + 1] = 255
          img.data[j + 2] = 255
          img.data[j + 3] = mask[i]
        }
        break
      }
      default:
        throw new Error(`pixel-op.worker: unknown op "${String(req.op)}"`)
    }
    // the buffer is either the exact one we received (modern engines do not
    // copy in the ImageData constructor) or the worker's own — both are safe
    // to transfer back; the main thread re-wraps it into a fresh ImageData.
    try {
      post({ id: req.id, kind: 'done', buffer: img.data.buffer }, [img.data.buffer])
    } catch (postErr) {
      // diagnostic fallback — report WHY the transfer post failed (dev debugging)
      post({
        id: req.id,
        kind: 'error',
        message: `done-post failed: ${postErr instanceof Error ? postErr.message : String(postErr)}; bufType=${Object.prototype.toString.call(img.data.buffer)}; bufLen=${img.data.buffer.byteLength}; transferLen=${(img.data.buffer as unknown as { length?: number }).length}`,
      })
    }
  } catch (err) {
    // give the pixels back when we still hold them so the main thread can
    // fall back to a synchronous re-run (partial mutation is fine: a
    // deterministic op that failed once fails the same way again).
    const recovered = img ? img.data.buffer : req.buffer
    try {
      post(
        { id: req.id, kind: 'error', message: err instanceof Error ? err.message : String(err), buffer: recovered },
        [recovered],
      )
    } catch (postErr) {
      post({
        id: req.id,
        kind: 'error',
        message: `op failed (${err instanceof Error ? err.message : String(err)}) AND error-post failed: ${postErr instanceof Error ? postErr.message : String(postErr)}; recoveredType=${Object.prototype.toString.call(recovered)}`,
      })
    }
  }
}

post({ kind: 'ready' })
