// Simulate a worker that mutates the transferred input and THEN throws.
// The client must never apply an operation again to those dirty pixels.
import assert from 'node:assert/strict'
import { PixelOpUnrecoverableError, runPixelOpAsync } from '../src/editor/engine/pixel-worker'

class PartiallyFailedWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  postMessage(message: { id: number; buffer: ArrayBuffer }) {
    const dirty = message.buffer.slice(0)
    new Float32Array(dirty)[0] = 999
    queueMicrotask(() => this.onmessage?.({
      data: { id: message.id, kind: 'error', buffer: dirty, message: 'test: partial filter failure' },
    } as MessageEvent))
  }
  terminate() {}
}

const previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
try {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: PartiallyFailedWorker })
  const data = new Float32Array(600 * 600 * 4)
  data[0] = 37
  const input = { width: 600, height: 600, data, precision: 'float32' as const, dynamicRange: 'sdr' as const }
  await assert.rejects(runPixelOpAsync(input, { kind: 'auto-tone' }), PixelOpUnrecoverableError)
  console.log('Partially mutated worker errors reject rather than re-applying image operations')
} finally {
  if (previousWorker) Object.defineProperty(globalThis, 'Worker', previousWorker)
  else Reflect.deleteProperty(globalThis, 'Worker')
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
}
