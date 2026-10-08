// Timeout isolation regression. A hung pixel job should reject; it must not
// latch the worker pool off and force future image processing onto the UI thread.
import assert from 'node:assert/strict'
import { PixelOpUnrecoverableError, runPixelOpAsync } from '../src/editor/engine/pixel-worker'

class SimulatedWorker {
  static created = 0
  static dispatched = 0
  readonly index: number
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  constructor() {
    this.index = SimulatedWorker.created++
  }
  postMessage(message: { id: number; buffer: ArrayBuffer }) {
    SimulatedWorker.dispatched++
    if (this.index === 0) return // first worker hangs forever
    const returned = message.buffer.slice(0)
    queueMicrotask(() => this.onmessage?.({
      data: { id: message.id, kind: 'done', buffer: returned },
    } as MessageEvent))
  }
  terminate() { this.terminated = true }
}
const prevWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
const prevWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const prevTimer = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout')
const callbacks: Array<() => void> = []
const input = () => {
  const data = new Float32Array(600 * 600 * 4)
  data[0] = 37
  return { width: 600, height: 600, data, precision: 'float32' as const, dynamicRange: 'sdr' as const }
}
try {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: SimulatedWorker })
  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    value: (cb: () => void) => { callbacks.push(cb); return 123 },
  })
  const hung = runPixelOpAsync(input(), { kind: 'auto-tone' })
  assert.equal(SimulatedWorker.dispatched, 1)
  assert.ok(callbacks.length, 'worker timeout is scheduled')
  callbacks.shift()!()
  await assert.rejects(hung, PixelOpUnrecoverableError)
  const recovered = await runPixelOpAsync(input(), { kind: 'auto-tone' })
  assert.equal(recovered.data[0], 37)
  assert.equal(SimulatedWorker.created, 2, 'replacement worker started after timeout')
  assert.equal(SimulatedWorker.dispatched, 2, 'the next operation was offloaded rather than run synchronously')
  console.log('A worker timeout rejects the lost job while later jobs still run on a replacement worker')
} finally {
  if (prevWorker) Object.defineProperty(globalThis, 'Worker', prevWorker)
  else Reflect.deleteProperty(globalThis, 'Worker')
  if (prevWindow) Object.defineProperty(globalThis, 'window', prevWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (prevTimer) Object.defineProperty(globalThis, 'setTimeout', prevTimer)
  else Reflect.deleteProperty(globalThis, 'setTimeout')
}
