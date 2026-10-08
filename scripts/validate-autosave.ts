import assert from 'node:assert/strict'
import { engine } from '../src/editor/engine/engine'
import { startAutoSave } from '../src/editor/engine/autosave'
import type { PsDocument } from '../src/editor/types'

const originalSetTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout
const originalDocs = [...engine.docs]
const scheduled = new Map<number, () => void>()
let timerId = 0
let schedules = 0
const fakeEvents = { addEventListener() {}, removeEventListener() {} }

try {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeEvents })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeEvents })
  globalThis.setTimeout = ((fn: () => void) => {
    const id = ++timerId
    schedules++
    scheduled.set(id, fn)
    return id as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    scheduled.delete(id as unknown as number)
  }) as typeof clearTimeout

  engine.docs.splice(0, engine.docs.length, { id: 'autosave-test', dirty: true } as PsDocument)
  const stop = startAutoSave()
  try {
    assert.equal(schedules, 1, 'opening a document starts one recovery timer')
    for (let i = 0; i < 30; i++) engine.emit()
    assert.equal(schedules, 1, 'frequent editor updates must not postpone the timer')
    assert.equal(scheduled.size, 1, 'only one timer may be pending per document')

    engine.docs.splice(0, engine.docs.length)
    engine.emit()
    assert.equal(scheduled.size, 0, 'closing a document cancels its pending timer')

    engine.docs.push({ id: 'autosave-test', dirty: true } as PsDocument)
    engine.emit()
    assert.equal(schedules, 2, 'reopening the same document starts a new recovery timer')
  } finally {
    stop()
  }
  assert.equal(scheduled.size, 0, 'unsubscribing cancels all timers')
  console.log('Autosave schedules once during continuous edits, cancels closed documents and restarts after reopen')
} finally {
  engine.docs.splice(0, engine.docs.length, ...originalDocs)
  globalThis.setTimeout = originalSetTimeout
  globalThis.clearTimeout = originalClearTimeout
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'document')
}
