// A failed worker operation may mutate its private buffer before throwing.
// Reject that operation without ever retrying dirty pixels, but keep healthy
// workers available for later jobs.
import assert from 'node:assert/strict'
import { PixelOpOperationError, runPixelOpAsync } from '../src/editor/engine/pixel-worker'

class PartiallyFailedWorker {
  static created = 0
  static dispatched = 0
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  constructor() { PartiallyFailedWorker.created++ }
  postMessage(message: { id: number; buffer: ArrayBuffer }) {
    PartiallyFailedWorker.dispatched++
    const first = PartiallyFailedWorker.dispatched === 1
    const result = message.buffer.slice(0)
    if (first) new Float32Array(result)[0] = 999
    queueMicrotask(() => this.onmessage?.({
      data: first
        ? { id: message.id, kind: 'error', buffer: result, message: 'test: partial filter failure' }
        : { id: message.id, kind: 'done', buffer: result },
    } as MessageEvent))
  }
  terminate() {}
}

const previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
try {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: PartiallyFailedWorker })
  const input = () => {
    const data = new Float32Array(600 * 600 * 4)
    data[0] = 37
    return { width: 600, height: 600, data, precision: 'float32' as const, dynamicRange: 'sdr' as const }
  }
  await assert.rejects(runPixelOpAsync(input(), { kind: 'auto-tone' }), PixelOpOperationError)
  assert.equal(PartiallyFailedWorker.dispatched, 1, 'failed operation must not re-run on partially mutated buffer')
  const result = await runPixelOpAsync(input(), { kind: 'auto-tone' })
  assert.equal(result.data[0], 37, 'following operation returns the uncorrupted fresh input')
  assert.equal(PartiallyFailedWorker.created, 1, 'valid worker reused after operation error')
  assert.equal(PartiallyFailedWorker.dispatched, 2)
  console.log('Worker operation exceptions reject safely without disabling the pool or replaying dirty pixels')
} finally {
  if (previousWorker) Object.defineProperty(globalThis, 'Worker', previousWorker)
  else Reflect.deleteProperty(globalThis, 'Worker')
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
}
