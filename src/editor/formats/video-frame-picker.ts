// Browser-native, single-frame import for MP4/WebM/MKV. The file stays local.
// This UI is deliberately independent of the editor store: decodeFile() can
// be invoked by Open, Place, and other import paths without changing callers.
export function pickVideoFrame(file: File | Blob): Promise<HTMLCanvasElement> {
  if (typeof document === 'undefined') return Promise.reject(new Error('Video frame selection requires a browser'))
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const overlay = document.createElement('div')
    overlay.className = 'fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-3 md:p-6'
    overlay.setAttribute('role', 'presentation')
    overlay.innerHTML = [
      '<section role="dialog" aria-modal="true" aria-label="Import frame from video" class="flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-panel text-foreground shadow-2xl">',
      ' <header class="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">',
      '  <div class="min-w-0"><h2 class="text-sm font-semibold">Import a video frame</h2><p data-video-name class="truncate text-xs text-muted-foreground"></p></div>',
      '  <button type="button" data-video-close class="rounded px-2 py-1 text-sm hover:bg-accent" aria-label="Cancel video import">✕</button>',
      ' </header>',
      ' <div class="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black p-2">',
      '  <video data-video-preview playsinline muted preload="auto" class="max-h-[55vh] max-w-full object-contain" aria-label="Video frame preview"></video>',
      ' </div>',
      ' <div class="flex shrink-0 flex-col gap-3 px-4 py-3">',
      '  <div class="flex items-center gap-3">',
      '   <button type="button" data-video-play class="min-w-16 rounded border border-border px-2 py-1 text-xs hover:bg-accent" disabled>Play</button>',
      '   <input data-video-timeline type="range" min="0" max="0" step="0.01" value="0" disabled class="min-w-0 flex-1" aria-label="Select video frame time"/>',
      '   <span data-video-clock class="min-w-28 text-right font-mono text-xs text-muted-foreground">00:00.000</span>',
      '  </div>',
      '  <div class="flex flex-wrap items-center justify-between gap-2">',
      '   <label class="flex items-center gap-2 text-xs text-muted-foreground">Time (seconds)',
      '    <input data-video-time type="number" min="0" step="0.001" value="0" disabled class="w-24 rounded border border-input bg-background px-2 py-1 text-xs text-foreground" aria-label="Video frame timestamp in seconds" />',
      '   </label>',
      '   <span data-video-status class="text-xs text-muted-foreground" role="status" aria-live="polite">Loading video…</span>',
      '  </div>',
      '  <footer class="flex justify-end gap-2 border-t border-border pt-3">',
      '   <button type="button" data-video-cancel class="rounded border border-border px-3 py-1.5 text-xs hover:bg-accent">Cancel</button>',
      '   <button type="button" data-video-import class="rounded bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled>Import frame</button>',
      '  </footer>',
      ' </div>',
      '</section>',
    ].join('')
    const get = <T extends HTMLElement>(selector: string) => {
      const element = overlay.querySelector<T>(selector)
      if (!element) throw new Error('Video picker control missing: ' + selector)
      return element
    }
    const video = get<HTMLVideoElement>('[data-video-preview]')
    const timeline = get<HTMLInputElement>('[data-video-timeline]')
    const timeInput = get<HTMLInputElement>('[data-video-time]')
    const clock = get<HTMLElement>('[data-video-clock]')
    const status = get<HTMLElement>('[data-video-status]')
    const play = get<HTMLButtonElement>('[data-video-play]')
    const importFrame = get<HTMLButtonElement>('[data-video-import]')
    const cancel = get<HTMLButtonElement>('[data-video-cancel]')
    const close = get<HTMLButtonElement>('[data-video-close]')
    get<HTMLElement>('[data-video-name]').textContent = (file as File).name || 'Video'
    video.muted = true
    video.playsInline = true
    let finished = false
    let duration = 0
    let loadTimeout: ReturnType<typeof setTimeout> | null = null

    const fmt = (seconds: number) => {
      const millis = Math.round(Math.max(0, seconds) * 1000)
      const mins = Math.floor(millis / 60000).toString().padStart(2, '0')
      const secs = Math.floor((millis % 60000) / 1000).toString().padStart(2, '0')
      return mins + ':' + secs + '.' + (millis % 1000).toString().padStart(3, '0')
    }
    const seekMax = () => Math.max(0, duration - 0.001)
    const canCapture = () => !!video.videoWidth && !!video.videoHeight && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !video.seeking
    const update = () => {
      if (finished) return
      const seconds = Number.isFinite(video.currentTime) ? video.currentTime : 0
      timeline.value = String(Math.min(seconds, seekMax()))
      if (document.activeElement !== timeInput) timeInput.value = seconds.toFixed(3)
      clock.textContent = fmt(seconds) + ' / ' + fmt(duration)
      importFrame.disabled = !canCapture()
      if (canCapture()) status.textContent = video.videoWidth + ' × ' + video.videoHeight + ' px'
      play.textContent = video.paused ? 'Play' : 'Pause'
    }
    const fail = (message: string) => {
      if (finished) return
      video.pause()
      play.disabled = true
      importFrame.disabled = true
      status.textContent = message
    }
    const cleanup = () => {
      if (finished) return false
      finished = true
      if (loadTimeout) clearTimeout(loadTimeout)
      video.pause()
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      overlay.remove()
      return true
    }
    const abort = () => {
      if (!cleanup()) return
      const err = new Error('Video frame import cancelled')
      err.name = 'AbortError'
      reject(err)
    }
    const seek = (requested: number) => {
      if (!Number.isFinite(requested) || !duration) return
      const next = Math.min(Math.max(0, requested), seekMax())
      video.pause()
      importFrame.disabled = true
      status.textContent = 'Seeking…'
      try { video.currentTime = next } catch { fail('Unable to seek to this frame') }
      update()
    }

    video.addEventListener('loadedmetadata', () => {
      if (finished) return
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        fail('This video does not expose a seekable duration')
        return
      }
      duration = video.duration
      timeline.max = String(seekMax())
      timeInput.max = String(seekMax())
      timeline.disabled = false
      timeInput.disabled = false
      play.disabled = false
      update()
    })
    video.addEventListener('loadeddata', () => {
      if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null }
      update()
    })
    video.addEventListener('seeked', update)
    video.addEventListener('timeupdate', update)
    video.addEventListener('play', update)
    video.addEventListener('pause', update)
    video.addEventListener('error', () => fail('Video codec/container is not supported by this browser'))
    timeline.addEventListener('input', () => seek(Number(timeline.value)))
    timeInput.addEventListener('change', () => seek(Number(timeInput.value)))
    play.addEventListener('click', () => {
      if (!video.paused) { video.pause(); return }
      void video.play().catch(() => fail('The browser blocked video playback'))
    })
    importFrame.addEventListener('click', () => {
      if (!canCapture() || finished) return
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D is unavailable')
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        if (cleanup()) resolve(canvas)
      } catch (err) {
        fail(err instanceof Error ? err.message : 'Could not capture frame')
      }
    })
    cancel.addEventListener('click', abort)
    close.addEventListener('click', abort)
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) abort() })
    overlay.addEventListener('keydown', e => {
      // Block global editor hotkeys while choosing a frame.
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); abort() }
      if (e.key === 'Tab') {
        const focusable = Array.from(overlay.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
        if (!focusable.length) return
        const index = focusable.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey && index <= 0) { e.preventDefault(); focusable[focusable.length - 1].focus() }
        if (!e.shiftKey && index === focusable.length - 1) { e.preventDefault(); focusable[0].focus() }
      }
    })
    document.body.appendChild(overlay)
    cancel.focus()
    loadTimeout = setTimeout(() => fail('Timed out loading the video. Try another codec or file.'), 20000)
    video.src = url
    video.load()
  })
}
