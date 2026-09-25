import { perceptualWandMask, type PerceptualWandOptions } from '../image-ops/wand'

const WORKER_THRESHOLD = 500_000
const NO_SYNC_FALLBACK_THRESHOLD = 2_000_000
const TIMEOUT_MS = 45_000

let worker: Worker | null = null
let broken = false
let nextId = 1
const pending = new Map<number, {
  resolve: (mask: Uint8ClampedArray) => void
  reject: (err: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

function shutdown(reason?: string) {
  broken = true
  try { worker?.terminate() } catch { /* noop */ }
  worker = null
  for (const [id, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error(reason || `Magic Wand worker stopped (job ${id})`))
  }
  pending.clear()
}

function ensureWorker(): Worker | null {
  if (broken || typeof window === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/wand.worker.ts', import.meta.url))
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { id?: number; kind?: string; mask?: ArrayBuffer; message?: string }
      if (!msg || msg.kind === 'ready') return
      if (typeof msg.id !== 'number') return
      const job = pending.get(msg.id)
      if (!job) return
      pending.delete(msg.id)
      clearTimeout(job.timer)
      if (msg.kind === 'done' && msg.mask) {
        job.resolve(new Uint8ClampedArray(msg.mask))
      } else {
        job.reject(new Error(msg.message || 'Magic Wand worker failed'))
      }
    }
    worker.onerror = e => shutdown(e.message || 'Magic Wand worker crashed')
    return worker
  } catch (err) {
    broken = true
    console.warn('[zphoto] Magic Wand worker unavailable', err)
    return null
  }
}

export async function runWandMaskAsync(
  img: ImageData,
  x: number,
  y: number,
  options: PerceptualWandOptions,
): Promise<Uint8ClampedArray> {
  const pixels = img.width * img.height
  if (pixels < WORKER_THRESHOLD || typeof window === 'undefined') {
    return perceptualWandMask(img, x, y, options)
  }

  const w = ensureWorker()
  if (!w) {
    if (pixels >= NO_SYNC_FALLBACK_THRESHOLD) {
      throw new Error('Magic Wand worker is unavailable; refusing a large synchronous selection that could freeze the editor')
    }
    return perceptualWandMask(img, x, y, options)
  }

  const id = nextId++
  // Preserve the source ImageData for a small-image fallback without detaching
  // the caller's buffer. Large images deliberately avoid a UI-thread rerun.
  const send = new Uint8ClampedArray(img.data).buffer
  return await new Promise<Uint8ClampedArray>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      try { worker?.terminate() } catch { /* noop */ }
      worker = null
      if (pixels >= NO_SYNC_FALLBACK_THRESHOLD) {
        reject(new Error('Magic Wand worker timed out; the selection was cancelled instead of freezing the editor'))
      } else {
        try { resolve(perceptualWandMask(img, x, y, options)) } catch (err) { reject(err) }
      }
    }, TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    w.postMessage({
      id,
      kind: 'wand',
      width: img.width,
      height: img.height,
      x,
      y,
      options,
      buffer: send,
    }, [send])
  })
}

export function wandWorkerState() {
  return { active: !!worker, broken, pending: pending.size, threshold: WORKER_THRESHOLD }
}
