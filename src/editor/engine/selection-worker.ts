// ============================================================
// selection-worker.ts — main-thread wrapper for heavy selection math.
// Currently offloads perceptual Magic Wand flood/global matching so large
// photographs do not monopolize the UI thread on a click.
// ============================================================
import { perceptualWandMask, type PerceptualWandOptions } from '../image-ops/wand'
import { getImageData } from '../utils/canvas'

export const WAND_WORKER_THRESHOLD_PX = 500_000
const SAFE_SYNC_FALLBACK_PX = 2_000_000
const WAND_TIMEOUT_MS = 60_000

let worker: Worker | null = null
let ready = false
let broken = false
let nextId = 1

interface Pending {
  resolve: (mask: Uint8ClampedArray) => void
  reject: (err: unknown) => void
  timer: ReturnType<typeof setTimeout>
}
const pending = new Map<number, Pending>()

function failAll(reason: string) {
  broken = true
  ready = false
  try { worker?.terminate() } catch { /* already gone */ }
  worker = null
  const jobs = [...pending.values()]
  pending.clear()
  for (const job of jobs) {
    clearTimeout(job.timer)
    job.reject(new Error(reason))
  }
}

function ensureWorker(): Worker | null {
  if (broken || typeof window === 'undefined') return null
  if (worker) return worker
  try {
    const w = new Worker(new URL('../workers/wand.worker.ts', import.meta.url))
    w.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { id?: number; kind?: string; mask?: ArrayBuffer; message?: string }
      if (msg.kind === 'ready') { ready = true; return }
      if (!msg.id) return
      const job = pending.get(msg.id)
      if (!job) return
      pending.delete(msg.id)
      clearTimeout(job.timer)
      if (msg.kind === 'done' && msg.mask) job.resolve(new Uint8ClampedArray(msg.mask))
      else job.reject(new Error(msg.message ?? 'Magic Wand worker failed'))
    }
    w.onerror = e => failAll('Magic Wand worker crashed: ' + (e.message || 'unknown error'))
    worker = w
    return w
  } catch (err) {
    broken = true
    console.warn('[zphoto] Magic Wand worker unavailable:', err)
    return null
  }
}

/**
 * Compute a wand mask off-thread when the image is large enough. The ImageData
 * is disposable because its RGBA buffer is transferred to the worker.
 */
export function runWandMaskAsync(
  img: ImageData,
  x: number,
  y: number,
  options: PerceptualWandOptions,
): Promise<Uint8ClampedArray> {
  const pixels = img.width * img.height
  if (pixels < WAND_WORKER_THRESHOLD_PX || typeof window === 'undefined') {
    return Promise.resolve(perceptualWandMask(img, x, y, options))
  }

  const w = ensureWorker()
  if (!w) {
    if (pixels <= SAFE_SYNC_FALLBACK_PX) return Promise.resolve(perceptualWandMask(img, x, y, options))
    return Promise.reject(new Error('Magic Wand worker is unavailable; refusing a large synchronous selection that could freeze the editor'))
  }

  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const job = pending.get(id)
      if (!job) return
      pending.delete(id)
      reject(new Error(
        pixels <= SAFE_SYNC_FALLBACK_PX
          ? 'Magic Wand worker timed out'
          : 'Magic Wand worker timed out; selection cancelled to keep the UI responsive',
      ))
    }, WAND_TIMEOUT_MS)

    pending.set(id, { resolve, reject, timer })
    try {
      w.postMessage({
        id,
        kind: 'wand',
        width: img.width,
        height: img.height,
        x,
        y,
        options,
        buffer: img.data.buffer,
      }, [img.data.buffer as ArrayBuffer])
    } catch (err) {
      pending.delete(id)
      clearTimeout(timer)
      reject(err)
    }
  })
}

/**
 * Safe engine entry point. Re-reads the source canvas for synchronous fallback
 * when the worker fails and the image is small enough.
 */
export async function runWandMaskFromCanvas(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  options: PerceptualWandOptions,
): Promise<Uint8ClampedArray> {
  const pixels = canvas.width * canvas.height
  const img = getImageData(canvas)
  try {
    return await runWandMaskAsync(img, x, y, options)
  } catch (err) {
    if (pixels <= SAFE_SYNC_FALLBACK_PX) return perceptualWandMask(getImageData(canvas), x, y, options)
    throw err
  }
}

export function wandWorkerState() {
  return { active: !!worker, ready, broken, pending: pending.size, threshold: WAND_WORKER_THRESHOLD_PX }
}

if (typeof window !== 'undefined') {
  ;(window as any).__zphotoWandWorker = { runWandMaskAsync, runWandMaskFromCanvas, wandWorkerState }
}
