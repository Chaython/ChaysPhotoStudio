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
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
  focus() { documentFake.activeElement = this }
  remove() { this.removed = true }
  querySelector(selector: string): FakeNode | null { return controls.get(selector) ?? null }
  querySelectorAll(_selector: string): FakeNode[] { return [...controls.values()] }
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
let overlay: FakeNode | null = null
let activeVideo: FakeVideo | null = null
let lastCanvas: FakeCanvas | null = null
let revokedUrls: string[] = []
const documentFake = {
  activeElement: null as FakeNode | null,
  body: { appendChild(node: FakeNode) { overlay = node } },
  createElement(tag: string) {
    if (tag === 'div') {
      controls = new Map()
      for (const name of ['name', 'close', 'play', 'timeline', 'clock', 'time', 'status', 'cancel', 'import']) {
        const element = name === 'timeline' || name === 'time' ? new FakeNode('input') : new FakeNode('button')
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
  timeline.value = '12.25'
  timeline.dispatch('input')
  assert.equal(importButton.disabled, true, 'cannot capture a stale frame while seeking')
  assert.equal(currentVideo().currentTime, 12.25)
  currentVideo().completeSeek()
  assert.equal(importButton.disabled, false, 'selected frame ready for capture')
  importButton.dispatch('click')
  const selected = await direct as unknown as FakeCanvas
  assert.equal(selected.selectedTime, 12.25)
  assert.equal(selected.width, 640)
  assert.equal(selected.height, 360)
  assert.equal(currentOverlay().removed, true)
  assert.equal(revokedUrls.length, 1)

  // The legacy decoder must also open the picker, not pick a timestamp itself.
  const oldPath = decodeVideoFrame(movie)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(!currentOverlay().removed)
  controls.get('[data-video-cancel]')!.dispatch('click')
  await assert.rejects(oldPath, error => error instanceof Error && error.name === 'AbortError')
  assert.equal(revokedUrls.length, 2)

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
  assert.equal(revokedUrls.length, 3)
} finally {
  URL.createObjectURL = realCreate
  URL.revokeObjectURL = realRevoke
}
console.log('Video frame picker: timeline, precise timestamp, import, cancel, decode routing and URL cleanup passed')
