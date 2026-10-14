// Regression guard: importing MP4/WebM/MKV must open the timeline and return
// the user's selected timestamp, never an automatically decoded early frame.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isVideoImport, decodeVideoFrame } from '../src/editor/formats/photopea-formats'
import { pickVideoFrame } from '../src/editor/formats/video-frame-picker'

assert.equal(isVideoImport({ name: 'clip.mp4', type: '' }), true)
assert.equal(isVideoImport({ name: 'clip.WEBM', type: '' }), true)
assert.equal(isVideoImport({ name: 'clip.mkv', type: '' }), true)
assert.equal(isVideoImport({ name: 'drop', type: 'video/mp4' }), true)
assert.equal(isVideoImport({ name: 'still.png', type: 'image/png' }), false)
assert.equal(isVideoImport({ name: 'poster.webp', type: '' }), false)

const io = readFileSync('src/editor/engine/io.ts', 'utf8')
const shell = readFileSync('src/editor/components/shell/editor-app.tsx', 'utf8')
assert.match(shell, /f\.type\.startsWith\('image\/'\) \|\| isVideoImport\(f\)/,
  'Drag and drop should accept video MIME types as well as extensions')
const formats = readFileSync('src/editor/formats/index.ts', 'utf8')
assert.match(io, /if \(isVideoImport\(file\)\) \{\s*const decoded = await decodeFile\(file\)/,
  'Open / Place must decode videos via the picker before image decoding')
assert.match(io, /if \(err instanceof Error && err.name === 'AbortError'\) continue/,
  'Cancel must not be presented as an import failure')
const decoder = formats.slice(formats.indexOf('export async function decodeFile('))
assert.ok(decoder.indexOf('if (isVideoImport(file as File))') >= 0 &&
  decoder.indexOf('if (isVideoImport(file as File))') < decoder.indexOf('await file.arrayBuffer()'),
  'Universal decodeFile must start with video picker before buffering bytes')
assert.match(decoder, /await pickVideoFrame\(file\)/)

type Listener = (event: Record<string, any>) => void
class FakeNode {
  listeners = new Map<string, Listener[]>()
  disabled = false
  value = ''
  textContent = ''
  innerHTML = ''
  className = ''
  src = ''
  removed = false
  isConnected = true
  constructor(readonly tag: string) {}
  addEventListener(name: string, listener: Listener) {
    const entries = this.listeners.get(name) ?? []
    entries.push(listener)
    this.listeners.set(name, entries)
  }
  dispatch(name: string, data: Record<string, any> = {}) {
    const event = {
      type: name, target: this, stopPropagation() {}, preventDefault() {}, ...data,
    }
    for (const listener of this.listeners.get(name) ?? []) listener(event)
  }
  setAttribute(_name: string, _value: string) {}
  getAttribute(_name: string) { return null }
  getClientRects() { return [{ width: 1, height: 1 }] }
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
  focus() { documentFake.activeElement = this }
  remove() { this.removed = true; this.isConnected = false }
  querySelector(selector: string): FakeNode | null { return controls.get(selector) ?? null }
  querySelectorAll(_selector: string): FakeNode[] { return [...controls.values()].filter(node => (node.tag === 'button' || node.tag === 'input' || node.tag === 'select') && !node.disabled) }
}

class FakeVideo extends FakeNode {
  duration = 20
  videoWidth = 640
  videoHeight = 360
  readyState = 2
  seeking = false
  paused = true
  muted = false
  playsInline = false
  preload = ''
  private time = 0
  constructor() { super('video') }
  get currentTime() { return this.time }
  set currentTime(v: number) {
    this.time = v
    this.seeking = true
    this.dispatch('seeking')
  }
  completeSeek() { this.seeking = false; this.dispatch('seeked') }
  pause() { this.paused = true; this.dispatch('pause') }
  async play() { this.paused = false; this.dispatch('play') }
  load() {
    if (!this.src) return
    this.dispatch('loadedmetadata')
    this.dispatch('loadeddata')
  }
}
class FakeCanvas extends FakeNode {
  width = 0
  height = 0
  selectedTime: number | null = null
  constructor() { super('canvas') }
  getContext(type: string) {
    return type === '2d'
      ? { drawImage: (video: FakeVideo) => { this.selectedTime = video.currentTime } }
      : null
  }
}

let controls = new Map<string, FakeNode>()
const previousFocus = new FakeNode('button')
let overlay: FakeNode | null = null
let activeVideo: FakeVideo | null = null
let lastCanvas: FakeCanvas | null = null
let revokedUrls: string[] = []
const documentFake = {
  activeElement: previousFocus as FakeNode | null,
  body: { appendChild(node: FakeNode) { overlay = node } },
  createElement(tag: string) {
    if (tag === 'div') {
      controls = new Map()
      for (const name of ['name', 'close', 'play', 'timeline', 'clock', 'time', 'status', 'cancel', 'import', 'prev', 'next', 'fps']) {
        const element = name === 'timeline' || name === 'time' ? new FakeNode('input') : new FakeNode(name === 'fps' ? 'select' : 'button')
        if (name === 'fps') element.value = '30'
        controls.set('[data-video-' + name + ']', element)
      }
      const video = new FakeVideo()
      activeVideo = video
      controls.set('[data-video-preview]', video)
      return new FakeNode('div')
    }
    if (tag === 'canvas') return lastCanvas = new FakeCanvas()
    throw Error('Unexpected DOM element: ' + tag)
  },
}
const currentOverlay = (): FakeNode => {
  if (!overlay) throw Error('Video overlay did not mount')
  return overlay
}
const currentVideo = (): FakeVideo => {
  if (!activeVideo) throw Error('Video element did not mount')
  return activeVideo
}
Object.assign(globalThis, {
  document: documentFake,
  HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
  HTMLElement: FakeNode,
})
const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL
URL.createObjectURL = () => 'blob:local-video-test'
URL.revokeObjectURL = url => { revokedUrls.push(url) }
const movie = new Blob(['fake video'], { type: 'video/mp4' }) as Blob & { name: string }
movie.name = 'example.mp4'
try {
  // The direct picker should wait for a real user selection.
  const direct = pickVideoFrame(movie)
  assert.ok(!currentOverlay().removed, 'picker shown')
  const timeline = controls.get('[data-video-timeline]')!
  const importButton = controls.get('[data-video-import]')!
  assert.equal(timeline.disabled, false, 'timeline enabled when metadata loads')
  assert.equal(controls.get('[data-video-prev]')!.disabled, false)
  assert.equal(controls.get('[data-video-next]')!.disabled, false)
  timeline.value = '12.25'
  timeline.dispatch('input')
  assert.equal(importButton.disabled, true, 'cannot capture a stale frame while seeking')
  assert.equal(currentVideo().currentTime, 12.25)
  currentVideo().dispatch('timeupdate')
  assert.equal(timeline.value, '12.25', 'media events cannot snap the slider back')
  timeline.value = '14.75'
  timeline.dispatch('input')
  // Simulate a delayed seeked callback for the previous 12.25s target.
  currentVideo().currentTime = 12.25
  currentVideo().seeking = false
  currentVideo().dispatch('seeked')
  assert.equal(importButton.disabled, true, 'stale seeked at an older timestamp cannot unlock import')
  assert.equal(timeline.value, '14.75', 'stale seeked must retain the requested target')
  currentVideo().currentTime = 14.75
  currentVideo().completeSeek()
  assert.equal(importButton.disabled, false, 'selected frame ready for capture')
  controls.get('[data-video-fps]')!.value = '25'
  controls.get('[data-video-next]')!.dispatch('click')
  assert.equal(currentVideo().currentTime, 14.79, 'step forward uses the selected assumed FPS')
  assert.equal(importButton.disabled, true, 'stepping also waits for decoded frame')
  controls.get('[data-video-next]')!.dispatch('click')
  assert.equal(currentVideo().currentTime, 14.83, 'repeated stepping accumulates requested timestamps')
  currentVideo().completeSeek()
  controls.get('[data-video-prev]')!.dispatch('click')
  assert.equal(currentVideo().currentTime, 14.79, 'step backward uses the selected rate')
  currentVideo().completeSeek()
  assert.equal(importButton.disabled, false, 'final selected frame ready for capture')
  importButton.dispatch('click')
  const selected = await direct as unknown as FakeCanvas
  assert.equal(selected.selectedTime, 14.79)
  assert.equal(selected.width, 640)
  assert.equal(selected.height, 360)
  assert.equal(currentOverlay().removed, true)
  assert.equal(documentFake.activeElement, previousFocus, 'original keyboard focus must be restored')
  assert.equal(revokedUrls.length, 1)

  // Frame-rate selects must participate in the modal keyboard focus cycle.
  const keyboardImport = pickVideoFrame(movie)
  const keyboardOverlay = currentOverlay()
  const focusables = keyboardOverlay.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')
  const fpsControl = controls.get('[data-video-fps]')!
  assert.ok(focusables.includes(fpsControl))
  fpsControl.focus()
  keyboardOverlay.dispatch('keydown', { key: 'Tab', shiftKey: true })
  assert.equal(documentFake.activeElement, fpsControl, 'Tab from a select must remain available to normal navigation')
  focusables[focusables.length - 1].focus()
  keyboardOverlay.dispatch('keydown', { key: 'Tab', shiftKey: false })
  assert.equal(documentFake.activeElement, focusables[0], 'forward Tab wraps to first control')
  focusables[0].focus()
  keyboardOverlay.dispatch('keydown', { key: 'Tab', shiftKey: true })
  assert.equal(documentFake.activeElement, focusables[focusables.length - 1], 'reverse Tab wraps to last control')
  controls.get('[data-video-cancel]')!.dispatch('click')
  await assert.rejects(keyboardImport, error => error instanceof Error && error.name === 'AbortError')

  // The legacy decoder must also open the picker, not pick a timestamp itself.
  const oldPath = decodeVideoFrame(movie)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(!currentOverlay().removed)
  controls.get('[data-video-cancel]')!.dispatch('click')
  await assert.rejects(oldPath, error => error instanceof Error && error.name === 'AbortError')
  assert.equal(revokedUrls.length, 3)

  // The public decoder must route early, before requesting the video's bytes.
  const { decodeFile } = await import('../src/editor/formats/index')
  const trapped = Object.assign(new Blob(['video bytes'], { type: 'video/mp4' }), {
    name: 'movie.webm',
    arrayBuffer() { throw Error('video was buffered instead of opening picker') },
  }) as unknown as File
  const decoded = decodeFile(trapped)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(!currentOverlay().removed)
  assert.equal(currentVideo().src, 'blob:local-video-test')
  const time = controls.get('[data-video-time]')!
  time.value = '6.5'
  time.dispatch('change')
  currentVideo().completeSeek()
  controls.get('[data-video-import]')!.dispatch('click')
  const frame = await decoded
  assert.equal((frame.canvas as unknown as FakeCanvas).selectedTime, 6.5)
  assert.equal(frame.width, 640)
  assert.equal(frame.height, 360)
  assert.equal(revokedUrls.length, 4)

  // A codec error can race with a late metadata event. Controls must stay
  // disabled rather than accepting a broken/stale frame.
  const failedImport = pickVideoFrame(movie)
  currentVideo().dispatch('error')
  const failedControls = ['play', 'timeline', 'time', 'import', 'prev', 'next']
  for (const name of failedControls)
    assert.equal(controls.get('[data-video-' + name + ']')!.disabled, true)
  currentVideo().dispatch('loadedmetadata')
  currentVideo().dispatch('loadeddata')
  for (const name of failedControls)
    assert.equal(controls.get('[data-video-' + name + ']')!.disabled, true,
      'media controls cannot revive after decoding failed: ' + name)
  controls.get('[data-video-cancel]')!.dispatch('click')
  await assert.rejects(failedImport, (error: unknown) => error instanceof Error && error.name === 'AbortError')
  assert.equal(revokedUrls.length, 5)
} finally {
  URL.createObjectURL = realCreate
  URL.revokeObjectURL = realRevoke
}
console.log('Video frame picker: timeline, precise timestamp, import, cancel, decode routing and URL cleanup passed')
