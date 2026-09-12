'use client'
// ============================================================
// Native bridges — client glue between the web app and its
// distribution shells. Renders nothing.
//  1. PWA: registers the service worker (production only, so
//     `next dev` / HMR are never cached).
//  2. Electron desktop: relays "open image file" launches (file
//     associations / second-instance argv / macOS open-file) into
//     a DOM CustomEvent `chays:open-file` with a real File — the
//     editor app listens for it and runs the normal openFiles()
//     pipeline. The bridge is inert in a plain browser.
// ============================================================
import { useEffect } from 'react'

export function AppBridges() {
  useEffect(() => {
    // ---- 1. service worker (production, http(s) pages only) ----
    // Skipped inside browser extensions / non-web contexts, where
    // registration is not permitted (the catch() would swallow it,
    // but skipping outright keeps the console clean).
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production'
        && /^https?:$/.test(location.protocol)) {
      // relative: resolves correctly on root hosting and sub-path
      // hosting (GitHub Pages) alike; the worker derives its own BASE.
      const register = () => { navigator.serviceWorker.register('sw.js').catch(() => {}) }
      if (document.readyState === 'complete') register()
      else window.addEventListener('load', register, { once: true })
    }

    // ---- 2. Electron open-file bridge ----
    const api = (window as unknown as {
      chaysPhotoStudio?: {
        onOpenFile?: (cb: (p: { name: string; type: string; data: ArrayBuffer | Uint8Array }) => void) => () => void
        onMenuCommand?: (cb: (cmd: string) => void) => () => void
      }
    }).chaysPhotoStudio
    if (typeof api?.onOpenFile === 'function') {
      try {
        api.onOpenFile((payload) => {
          if (!payload?.data) return
          // normalize (Node Buffer | ArrayBuffer | TypedArray) → fresh Uint8Array
          const bytes = new Uint8Array(payload.data as Uint8Array | ArrayBuffer)
          const file = new File([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], payload.name || 'image.png', {
            type: payload.type || 'image/png',
          })
          window.dispatchEvent(new CustomEvent('chays:open-file', { detail: file }))
        })
      } catch {
        // bridge present but unavailable — ignore
      }
    }
    // Electron's own File > Open Image… → file picker → app open pipeline
    if (typeof api?.onMenuCommand === 'function') {
      try {
        api.onMenuCommand((cmd) => {
          if (cmd !== 'open') return
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'image/*,.zproj.json'
          input.multiple = true
          input.onchange = () => {
            const files = Array.from(input.files ?? [])
            if (files.length) window.dispatchEvent(new CustomEvent('chays:open-file', { detail: files }))
          }
          input.click()
        })
      } catch {
        // ignore
      }
    }
  }, [])

  return null
}
