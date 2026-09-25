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

self.onmessage = (ev: MessageEvent<WandRequest>) => {
  const req = ev.data
  if (!req || req.kind !== 'wand') return
  try {
    const img = new ImageData(new Uint8ClampedArray(req.buffer), req.width, req.height)
    const mask = perceptualWandMask(img, req.x, req.y, req.options)
    post({ id: req.id, kind: 'done', mask: mask.buffer }, [mask.buffer])
  } catch (err) {
    post({ id: req.id, kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

post({ kind: 'ready' })
