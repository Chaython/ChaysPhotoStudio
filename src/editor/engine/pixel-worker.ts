// ============================================================
// pixel-worker.ts — main-thread wrapper + pool for the pixel-op
// Web Worker (Task 7-b). Offloads HEAVY one-shot pixel operations
// (dialog OK commits, menu filter commands, auto-correct, match
// color) off the main thread, proving the strict-threading
// architecture incrementally without rewriting the engine.
//
// Usage contract:
//   runPixelOpAsync(img, op)  — async; by default CONSUMES `img`'s
//     buffer (zero-copy transfer to the worker and back). Pass a
//     buffer you own — e.g. a fresh getImageData() result. The
//     promise resolves with a NEW ImageData (worker path) or the
//     SAME ImageData mutated in place (sync path: images below
//     SIZE_THRESHOLD_PX or any worker failure).
//     opts.keepInput — clones the input buffer first so the caller's
//     ImageData survives the call (one extra copy). The match-color
//     source is always copied, never consumed.
//
//   runPixelOpFromCanvas(canvas, op) — zero-risk convenience for
//     engine commit paths: pulls pixels from the canvas (disposable),
//     and on an unrecoverable worker failure re-fetches and runs
//     synchronously. The canvas is never touched until the caller
//     putImageData()s the result, so history/undo are unaffected.
//
// Pooling: max 2 workers, spawned lazily; a pending queue drains as
// workers go idle. Heavy blur filters get a much longer timeout so a legitimate
// long-running worker is never killed only to be re-run on the UI thread.
// Graceful degradation: any spawn failure / worker error / timeout latches the pool OFF for
// the session (one console warning) and every op runs synchronously
// through the very same image-ops functions.
//
// History integration stays on the main thread: the wrapper only
// computes pixels; callers write results back with putImageData and
// push history exactly like the sync path.
// ============================================================
import { applyFilter, applyAdjustment } from '../image-ops'
import { autoTone, autoContrast, autoColor, matchColor } from '../image-ops/auto'
import { getImageData } from '../utils/canvas'
import type { AdjustmentType, FilterType } from '../types'

export type PixelOpKind =
  | 'filter' | 'adjustment'
  | 'auto-tone' | 'auto-contrast' | 'auto-color'
  | 'match-color'

/** Structured-cloneable op descriptor — closures cannot cross the worker boundary. */
export interface PixelOpSpec {
  kind: PixelOpKind
  /** filter/adjustment registry key */
  type?: string
  /** op parameters (merged over registry defaults inside image-ops) */
  params?: Record<string, any>
  /** match-color only: source stats image. NEVER consumed — always copied (must survive fallback re-runs). */
  source?: ImageData
}

export interface PixelOpRunOptions {
  /** keep the input ImageData usable after the call — the wrapper copies its buffer before transferring
   *  (the match-color source is ALWAYS copied and never consumed) */
  keepInput?: boolean
  /** forwarded from worker 'progress' messages (reserved — no op reports progress yet) */
  onProgress?: (p: number) => void
}

/** Thrown when the worker path loses the input pixels (timeout / load failure) and they
 *  cannot be re-run synchronously. Callers holding the source canvas can re-fetch. */
export class PixelOpUnrecoverableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PixelOpUnrecoverableError'
  }
}

// ------------------------------------------------------------ tuning
const MAX_WORKERS = 2
/** below this many pixels the worker round-trip costs more than the op — run sync */
export const SIZE_THRESHOLD_PX = 300_000 // 0.3 MP
const OP_TIMEOUT_MS = 20_000
const HEAVY_FILTER_TIMEOUT_MS = 180_000

function timeoutForJob(job: InternalJob): number {
  if (job.op.kind !== 'filter') return OP_TIMEOUT_MS
  const type = job.op.type
  if (type === 'gaussian-blur' || type === 'box-blur' || type === 'motion-blur' || type === 'radial-blur') {
    return HEAVY_FILTER_TIMEOUT_MS
  }
  return OP_TIMEOUT_MS
}

// ------------------------------------------------------------ pool state (client only — never touched during SSR)
interface InternalJob {
  id: number
  op: PixelOpSpec
  width: number
  height: number
  buffer: ArrayBuffer
  sourceBuffer: ArrayBuffer | null
  sourceWidth: number
  sourceHeight: number
  /** keepInput mode: the caller's untouched input to re-run synchronously on failure */
  original: ImageData | null
  onProgress?: (p: number) => void
  resolve: (img: ImageData) => void
  reject: (err: unknown) => void
  entry: WorkerEntry | null
  timer: ReturnType<typeof setTimeout> | null
}

interface WorkerEntry {
  worker: Worker
  ready: boolean
  job: InternalJob | null
}

let pool: WorkerEntry[] = []
let pending: InternalJob[] = []
let nextJobId = 1
/** session latch — once any worker path fails, everything runs sync until page reload */
let broken = false
let warned = false

function warnOnce(reason: string): void {
  broken = true
  if (!warned) {
    warned = true
    console.warn(`[zphoto] pixel worker unavailable (${reason}) — running pixel ops synchronously for this session`)
  }
}

// ------------------------------------------------------------ synchronous dispatch (identical to the worker's)
/** Run a pixel op directly on the main thread, mutating `img` in place. Same dispatch table as the worker. */
export function runPixelOpSync(img: ImageData, op: PixelOpSpec): ImageData {
  switch (op.kind) {
    case 'filter': applyFilter(img, op.type as FilterType, op.params ?? {}); break
    case 'adjustment': applyAdjustment(img, op.type as AdjustmentType, op.params ?? {}); break
    case 'auto-tone': autoTone(img); break
    case 'auto-contrast': autoContrast(img); break
    case 'auto-color': autoColor(img); break
    case 'match-color': {
      if (!op.source) throw new Error('match-color requires a source ImageData')
      matchColor(img, op.source, (op.params ?? {}) as never)
      break
    }
    default: throw new Error(`runPixelOpSync: unknown op "${String((op as PixelOpSpec).kind)}"`)
  }
  return img
}

// ------------------------------------------------------------ worker plumbing
function spawnWorker(): WorkerEntry | null {
  try {
    // Turbopack (Next.js 16 dev server) statically resolves this URL and swaps it
    // for a blob: bootstrap whose preamble loads the compiled worker chunks via
    // `importScripts(...)` — a CLASSIC-worker API. Spawning with { type:'module' }
    // crashes that bootstrap (importScripts is undefined in module workers), so
    // the worker is spawned CLASSIC; the bundler still compiles pixel-op.worker.ts
    // (a normal TS module) into those chunks. VERIFIED in the dev server: the blob
    // bootstrap + all three chunks return 200 and the op round-trips. Any load
    // failure still falls back to synchronous execution (see onerror below).
    const worker = new Worker(new URL('../workers/pixel-op.worker.ts', import.meta.url))
    const entry: WorkerEntry = { worker, ready: false, job: null }
    worker.onmessage = (ev: MessageEvent) => handleWorkerMessage(entry, ev)
    worker.onerror = (ev: ErrorEvent) => {
      // script load failure / uncaught worker crash — the pool is unusable
      const detail = ev && (ev.message || ev.filename)
        ? ` (${[ev.message, ev.filename, ev.lineno && `line ${ev.lineno}`].filter(Boolean).join(' @ ')})`
        : ''
      warnOnce(`worker failed to load or crashed${detail}`)
      shutdownPool()
    }
    return entry
  } catch (err) {
    warnOnce(`spawn threw: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** terminate every worker; recover in-flight jobs; run queued jobs synchronously */
function shutdownPool(): void {
  for (const entry of pool) {
    const job = entry.job
    try { entry.worker.terminate() } catch { /* already dead */ }
    if (job) recoverJob(job, 'worker pool shut down')
  }
  pool = []
  flushPendingSync()
}

/** queued jobs were never transferred — their buffers are still attached; run them sync */
function flushPendingSync(): void {
  const queued = pending
  pending = []
  for (const job of queued) {
    try {
      const img = new ImageData(new Uint8ClampedArray(job.buffer), job.width, job.height)
      job.resolve(runPixelOpSync(img, job.op))
    } catch (err) {
      job.reject(err)
    }
  }
}

/** finish an in-flight job whose worker died / timed out: pixels are gone unless we kept the input */
function recoverJob(job: InternalJob, reason: string): void {
  if (job.timer) clearTimeout(job.timer)
  job.timer = null
  if (job.entry) job.entry.job = null
  job.entry = null
  if (job.original) {
    // keepInput — the caller's ImageData was never transferred; re-run synchronously
    try {
      job.resolve(runPixelOpSync(job.original, job.op))
    } catch (err) {
      job.reject(err)
    }
    return
  }
  job.reject(new PixelOpUnrecoverableError(
    `pixel worker lost the input buffer (${reason}); pass keepInput or re-fetch pixels from the source canvas`,
  ))
}

function handleWorkerMessage(entry: WorkerEntry, ev: MessageEvent): void {
  const msg = ev.data as { id?: number; kind?: string; buffer?: ArrayBuffer; message?: string; p?: number }
  if (!msg || typeof msg.kind !== 'string') return
  if (msg.kind === 'ready') {
    entry.ready = true
    drainQueue()
    return
  }
  const job = entry.job
  if (!job || msg.id !== job.id) return // stale / unknown response
  if (msg.kind === 'progress') {
    if (typeof msg.p === 'number') job.onProgress?.(msg.p)
    return
  }
  // terminal — clear timer, free the worker
  if (job.timer) clearTimeout(job.timer)
  job.timer = null
  entry.job = null
  job.entry = null
  if (msg.kind === 'done' && msg.buffer) {
    job.resolve(new ImageData(new Uint8ClampedArray(msg.buffer), job.width, job.height))
    drainQueue()
    return
  }
  if (msg.kind === 'error') {
    warnOnce(`op error: ${msg.message ?? 'unknown'}`)
    // the whole pool is latched off for the session — shut it down (this worker's
    // job is already detached above, so no double recovery)
    try { entry.worker.terminate() } catch { /* already dead */ }
    const others = pool
    pool = []
    for (const e of others) {
      if (e === entry) continue
      const j = e.job
      try { e.worker.terminate() } catch { /* already dead */ }
      if (j) recoverJob(j, 'worker pool shut down')
    }
    flushPendingSync()
    // the worker posted the buffer back — pixels may be pristine (env failure,
    // e.g. no ImageData constructor in that worker) or partially mutated (the op
    // threw mid-run; a deterministic op fails identically on re-run, so this is
    // either a correct result or the same error surfaces again).
    if (msg.buffer) {
      try {
        const img = new ImageData(new Uint8ClampedArray(msg.buffer), job.width, job.height)
        job.resolve(runPixelOpSync(img, job.op))
      } catch (err) {
        job.reject(err)
      }
    } else if (job.original) {
      try {
        job.resolve(runPixelOpSync(job.original, job.op))
      } catch (err) {
        job.reject(err)
      }
    } else {
      job.reject(new PixelOpUnrecoverableError(`pixel worker error without buffer: ${msg.message ?? 'unknown'}`))
    }
    return
  }
}

function dispatch(entry: WorkerEntry, job: InternalJob): void {
  entry.job = job
  job.entry = entry
  const timeoutMs = timeoutForJob(job)
  job.timer = setTimeout(() => {
    warnOnce(`op timed out after ${Math.round(timeoutMs / 1000)}s`)
    try { entry.worker.terminate() } catch { /* already dead */ }
    pool = pool.filter(e => e !== entry)
    recoverJob(job, 'timeout')
    flushPendingSync()
  }, timeoutMs)
  const transfer: ArrayBuffer[] = [job.buffer]
  if (job.sourceBuffer) transfer.push(job.sourceBuffer)
  entry.worker.postMessage(
    {
      id: job.id,
      kind: 'op',
      op: job.op.kind,
      type: job.op.type,
      params: job.op.params,
      width: job.width,
      height: job.height,
      // the buffers MUST be referenced here — a transfer-list entry without a
      // matching message property is transferred but unreachable (undefined
      // on the worker side). This was the original bug: transfer worked, but
      // req.buffer was undefined inside the worker.
      buffer: job.buffer,
      sourceBuffer: job.sourceBuffer ?? undefined,
      sourceWidth: job.sourceBuffer ? job.sourceWidth : undefined,
      sourceHeight: job.sourceBuffer ? job.sourceHeight : undefined,
    },
    transfer,
  )
}

function drainQueue(): void {
  if (broken || !pending.length) return
  while (pending.length) {
    let entry = pool.find(e => e.job === null)
    if (!entry) {
      if (pool.length >= MAX_WORKERS) return
      const spawned = spawnWorker()
      if (!spawned) {
        // spawn failed + latched broken — flush what we hold synchronously
        flushPendingSync()
        return
      }
      pool.push(spawned)
      // messages queue inside the worker until its script loads — safe to dispatch now
      entry = spawned
    }
    dispatch(entry, pending.shift()!)
  }
}

// ------------------------------------------------------------ public API
/**
 * Run a heavy one-shot pixel op, off the main thread when worthwhile.
 *
 * CONTRACT: consumes `img`'s ArrayBuffer unless opts.keepInput — the input
 * ImageData is transferred to the worker and comes back as the RESOLVED value
 * (a new ImageData object wrapping the same buffer). Below SIZE_THRESHOLD_PX,
 * or after any worker failure, the op runs synchronously and the SAME ImageData
 * object (mutated in place) is returned. Either way, callers write the result
 * back with putImageData.
 */
export function runPixelOpAsync(img: ImageData, op: PixelOpSpec, opts: PixelOpRunOptions = {}): Promise<ImageData> {
  // small images: the worker round-trip (post + transfer + spawn) costs more than the op
  if (img.width * img.height < SIZE_THRESHOLD_PX) {
    return Promise.resolve(runPixelOpSync(img, op))
  }
  if (broken || typeof window === 'undefined') {
    return Promise.resolve(runPixelOpSync(img, op))
  }

  const keepInput = opts.keepInput === true
  // keepInput → hand the worker a copy so the caller's buffer stays valid
  const sendBuffer = keepInput ? new Uint8ClampedArray(img.data).buffer : (img.data.buffer as ArrayBuffer)
  // the source ImageData is NEVER consumed — always a copy. It is typically a small
  // stats downsample and must stay intact for the synchronous fallback re-run.
  let sourceBuffer: ArrayBuffer | null = null
  let sourceWidth = 0
  let sourceHeight = 0
  if (op.source) {
    sourceBuffer = new Uint8ClampedArray(op.source.data).buffer
    sourceWidth = op.source.width
    sourceHeight = op.source.height
  }

  return new Promise<ImageData>((resolve, reject) => {
    const job: InternalJob = {
      id: nextJobId++,
      op,
      width: img.width,
      height: img.height,
      buffer: sendBuffer,
      sourceBuffer,
      sourceWidth,
      sourceHeight,
      original: keepInput ? img : null,
      onProgress: opts.onProgress,
      resolve,
      reject,
      entry: null,
      timer: null,
    }
    // always route through the queue so older jobs are never starved by new ones
    pending.push(job)
    if (pool.length < MAX_WORKERS && !pool.find(e => e.job === null)) {
      const entry = spawnWorker()
      if (entry) pool.push(entry)
      else {
        // spawn failed + latched broken — flush synchronously (buffers still attached)
        flushPendingSync()
        return
      }
    }
    drainQueue()
  })
}

/**
 * Zero-risk entry point for engine commit paths: pixels come from (and only ever
 * touch) the layer canvas after the caller putImageData()s the result. On an
 * unrecoverable worker failure the canvas pixels are re-fetched and the op runs
 * synchronously — the observable behavior is identical to the sync path.
 */
export async function runPixelOpFromCanvas(canvas: HTMLCanvasElement, op: PixelOpSpec): Promise<ImageData> {
  const img = getImageData(canvas) // fresh + disposable → zero-copy transfer
  try {
    return await runPixelOpAsync(img, op)
  } catch (err) {
    if (err instanceof PixelOpUnrecoverableError) {
      // the canvas was never written — re-fetch and run synchronously
      return runPixelOpSync(getImageData(canvas), op)
    }
    throw err
  }
}

// ------------------------------------------------------------ debug bridge (client only)
if (typeof window !== 'undefined') {
  ;(window as any).__zphotoPixelWorker = {
    /** pool state for debugging / verification */
    getState(): { workers: number; busy: number; pending: number; broken: boolean; threshold: number } {
      return {
        workers: pool.length,
        busy: pool.filter(e => e.job !== null).length,
        pending: pending.length,
        broken,
        threshold: SIZE_THRESHOLD_PX,
      }
    },
    /** test hook: simulate a total worker failure (sync fallback must still complete the op) */
    forceFailure(): void {
      warnOnce('forced failure (debug bridge)')
      shutdownPool()
    },
    runPixelOpAsync,
    runPixelOpSync,
    runPixelOpFromCanvas,
    PixelOpUnrecoverableError,
  }
}
